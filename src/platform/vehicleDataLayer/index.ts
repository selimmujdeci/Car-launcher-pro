import { CanAdapter }          from './CanAdapter';
import { ObdAdapter }          from './ObdAdapter';
import { GpsAdapter }          from './GpsAdapter';
import { VehicleSignalResolver } from './VehicleSignalResolver';
import { telemetryService }    from '../telemetryService';
import { useUnifiedVehicleStore } from './UnifiedVehicleStore';
import { startRemoteCommands, stopRemoteCommands } from '../remoteCommandService';
import { startLiveStyleEngine }                    from '../liveStyleEngine';
import { updateGpsSpeedForValidation, onOBDData }  from '../obdService';
import type { VehicleState, WorkerGeofenceZone }   from './types';
import { applyProfileGate }    from '../canBus/ProfileSignalGate';
import { runVehicleHandshake } from '../canBus/VehicleHandshake';
import { startConnectivityManager } from '../canBus/VehicleConnectivityManager';
import { recordEvent, recordDiagLine } from '../canBus/EventRecorder';
import { isNative }            from '../bridge';
import { CarLauncher }         from '../nativePlugin';
import {
  startCanSignalValidator,
  registerCandidate,
  submitSample,
} from '../canBus/CanSignalValidator';

export { useUnifiedVehicleStore }                 from './UnifiedVehicleStore';
export { useUnifiedVehicleStore as useVehicleStore } from './UnifiedVehicleStore'; // backward compat alias
export { setRemoteCommandContext }        from '../remoteCommandService';
export { onVehicleEvent, dispatchMaintenanceRequired, dispatchCrashDetected } from './VehicleEventHub';
export type { VehicleEvent, VehicleEventType }         from './VehicleEventHub';
export type { VehicleState, WorkerGeofenceZone }       from './types';
export type { GPSLocation }                            from './types';

// Resolver referansı — geofence güncellemelerini worker'a iletmek için
let _activeResolver: VehicleSignalResolver | null = null;

/* ── Yaşam döngüsü teşhisi (B-2) ──────────────────────────────────────────────
   SALT GÖZLEM: aşağıdaki sayaçlar ve `getVehicleDataLayerLifecycleDiagnostics()`
   hiçbir karar veya kontrol akışında OKUNMAZ; adapter/resolver başlatma sırası,
   cleanup sırası ve zamanlamalar bunlardan ETKİLENMEZ. */

/** Teşhis sayaçlarının DOYGUN üst sınırı (SystemBoot B-1 ile aynı desen). */
export const VDL_DIAG_COUNTER_MAX = 1_000_000;

/** Doygun artış — `VDL_DIAG_COUNTER_MAX`'ta sabitlenir (taşma/sınırsız büyüme yok). */
function _satInc(n: number): number {
  return n >= VDL_DIAG_COUNTER_MAX ? VDL_DIAG_COUNTER_MAX : n + 1;
}

let _dlStarts = 0;
let _dlStops  = 0;
let _dlLastStartedAtMs: number | null = null;
let _dlLastStoppedAtMs: number | null = null;

/** VehicleDataLayer yaşam döngüsü teşhis anlık görüntüsü (salt-okunur, bounded). */
export interface VehicleDataLayerLifecycleDiagnostics {
  /** Katman şu an ayakta mı — `_activeResolver !== null` türevi. */
  readonly active: boolean;
  /** TAMAMLANMIŞ başlatma sayısı (herhangi bir adım throw ederse SAYILMAZ). */
  readonly starts: number;
  /** GERÇEKLEŞEN dispose sayısı (idempotent guard sayesinde cleanup başına en fazla 1). */
  readonly stops: number;
  /** Son tamamlanan başlatmanın anı (ms) — hiç başlatılmadıysa null. */
  readonly lastStartedAtMs: number | null;
  /** Son gerçekleşen dispose'un anı (ms) — hiç dispose olmadıysa null. */
  readonly lastStoppedAtMs: number | null;
  /** Sayaç doygunluk sınırı (tüketici doygunluğu ayırt edebilsin). */
  readonly counterMax: number;
}

/**
 * VehicleDataLayer yaşam döngüsü teşhisinin senkron, salt-okuma anlık görüntüsü.
 *
 * YAN ETKİSİZ: hiçbir alanı değiştirmez, timer/abonelik kurmaz, servis başlatmaz;
 *   yalnız mevcut modül durumunu okur ve DONDURULMUŞ kopya döner. Tekrarlanan
 *   çağrılar durumu MUTASYONA UĞRATMAZ.
 * BOUNDED: sabit sayıda skaler alan — dizi/geçmiş YOK.
 * GİZLİLİK: yalnız sayı/boolean/zaman damgası. VIN · GPS · OBD değeri · hata metni ·
 *   token · kimlik · kullanıcı verisi İÇERMEZ.
 */
export function getVehicleDataLayerLifecycleDiagnostics(): VehicleDataLayerLifecycleDiagnostics {
  return Object.freeze({
    active:          _activeResolver !== null,
    starts:          _dlStarts,
    stops:           _dlStops,
    lastStartedAtMs: _dlLastStartedAtMs,
    lastStoppedAtMs: _dlLastStoppedAtMs,
    counterMax:      VDL_DIAG_COUNTER_MAX,
  });
}

/**
 * Geofence zona listesini Worker'a gönderir.
 * startVehicleDataLayer() çağrısından önce çağrılırsa sessizce yok sayılır.
 */
export function updateGeofenceZones(zones: WorkerGeofenceZone[]): void {
  _activeResolver?.sendGeofence(zones);
}

/**
 * Crash recovery: native storage'dan kurtarılan km değerini çalışan worker'a ilet.
 * VehicleSignalResolver henüz başlamamışsa sessizce yok sayılır.
 */
export function restoreOdometer(km: number): void {
  _activeResolver?.restoreOdometer(km);
}

/**
 * DEV-only kaos: VehicleCompute worker'ında _odoTMR bit-flip simülasyonu tetikler.
 * Üretimde no-op (DEV guard) — ChaosReceiver yalnızca DEV'de çağırır.
 */
export function chaosTriggerBitflip(): void {
  if (!import.meta.env.DEV) return;
  _activeResolver?.chaosBitflip();
}

/**
 * Bir CanAdapterData nesnesinin en az bir alanı var mı? (K24 perf düzeltmesi)
 *
 * Eskiden `Object.keys(d).length > 0` kullanılıyordu — bu her çağrıda TÜM
 * anahtarları içeren bir dizi allocate ediyordu (CAN hot-path'te her frame'de).
 * for...in ilk anahtarda erken döner → allocation YOK, aynı semantik sonuç
 * ("en az bir own-enumerable alan var mı") — plain object olduğu için
 * (CanAdapterData literal/spread ile üretilir, custom prototype yok) inherited
 * property riski de yok.
 */
export function _hasAnyField(d: object): boolean {
  for (const _k in d) return true;
  return false;
}

/**
 * startVehicleDataLayer — OBD/GPS/CAN veri hattını, telemetri push'unu
 * ve uzaktan komut kanalını başlatır.
 *
 * RAF-Batched Zustand Güncellemeleri:
 *   VehicleCompute.worker'dan gelen STATE_UPDATE patch'leri pre-allocated
 *   bir "pending" nesnesinde birikir. requestAnimationFrame() tetiklendiğinde
 *   tüm değişiklikler tek updateVehicleState olarak flush edilir.
 *
 *   Güvenlik kritik exception: reverse state → hemen flush (kamera gecikmez).
 *
 * Heading ve location: GPS tarafı (gpsService mirror subscriber) yetkilidir;
 * worker'dan gelen heading/location patch'leri biriktirilmez.
 */
export function startVehicleDataLayer(opts?: { onWorkerCrash?: () => void }): () => void {
  const can      = new CanAdapter();
  const obd      = new ObdAdapter();
  const gps      = new GpsAdapter();
  const resolver = new VehicleSignalResolver(can, obd, gps, opts?.onWorkerCrash);
  _activeResolver = resolver;

  // ── RAF-Batched UI State Update ─────────────────────────────────────────
  // Yalnızca worker'dan gelen vehicle sinyalleri (speed, rpm, fuel, odometer, reverse)
  // biriktirilir; heading ve location GPS mirror'dan gelir.
  const _pendingPatch: Partial<VehicleState> = {};
  let   _hasPending  = false;
  let   _rafId       = 0;

  function _flush(): void {
    _rafId = 0;
    if (!_hasPending) return;
    _hasPending = false;
    useUnifiedVehicleStore.getState().updateVehicleState(_pendingPatch);
  }

  function _scheduleFlush(): void {
    if (_rafId) return;
    _rafId = requestAnimationFrame(_flush);
  }

  resolver.onResolved((patch) => {
    // Güvenlik kritik: reverse → anında flush (kamera gecikme olmaz)
    if ('reverse' in patch) {
      if (_rafId) { cancelAnimationFrame(_rafId); _rafId = 0; }
      _hasPending = false;
      const immediate: Partial<VehicleState> = { reverse: patch.reverse };
      if ('speed'    in _pendingPatch) immediate.speed    = _pendingPatch.speed;
      if ('fuel'     in _pendingPatch) immediate.fuel     = _pendingPatch.fuel;
      if ('odometer' in _pendingPatch) immediate.odometer = _pendingPatch.odometer;
      useUnifiedVehicleStore.getState().updateVehicleState(immediate);
      _pendingPatch.speed = _pendingPatch.fuel = undefined;
      _pendingPatch.odometer = undefined;
      return;
    }

    if ('speed'    in patch) _pendingPatch.speed    = patch.speed;
    if ('fuel'     in patch) _pendingPatch.fuel      = patch.fuel;
    if ('odometer' in patch) _pendingPatch.odometer  = patch.odometer;
    // rpm: SAB kanalından gelir, index.ts'e STATE_UPDATE ile gelmez; gerekirse buraya ekle
    _hasPending = true;

    _scheduleFlush();
  });

  // CAN extras — worker'a gerek yok, doğrudan store'a yaz
  // Gate uygula: Safe Mode'da CAN-only alanlar (reverse/door/gear vb.) bloklanır.
  const unsubCanExtras = can.onData((raw) => {
    const d = applyProfileGate(raw);   // Patch 5: gate bypass düzeltmesi
    // K24 perf düzeltmesi: eski `d !== raw || Object.keys(d).length > 0` her
    // çağrıda dizi allocate ediyordu VE d!==raw kısmı OR'da kısa devre yaparak
    // ifadeyi fiilen HER ZAMAN true'ya düşürüyordu (Safe Mode'da tüm alanlar
    // undefined olsa bile d yeni bir referans olduğu için true dönüyordu).
    // _hasAnyField allocation-free ve "en az bir alan geçti mi" semantiğini
    // doğru yansıtır — normal/spike/safe-mode akışlarının HEPSİNDE aynı sonucu
    // üretir, yalnız tamamen boş safe-mode köşe durumunda (artık doğru şekilde) false döner.
    recordEvent('signal', 'MCU', `CAN frame`, { accepted: _hasAnyField(d) });
    useUnifiedVehicleStore.getState().updateCanExtras({
      // Kapı / aydınlatma
      doorOpen:          d.doorOpen,
      headlightsOn:      d.headlightsOn,
      highBeam:          d.highBeam,
      turnLeft:          d.turnLeft,
      turnRight:         d.turnRight,
      hazard:            d.hazard,
      tpms:              d.tpms?.length === 4
                           ? (d.tpms as [number, number, number, number])
                           : undefined,
      // Motor
      rpm:               d.rpm         ?? null,
      coolantTemp:       d.coolantTemp ?? null,
      oilTemp:           d.oilTemp     ?? null,
      throttle:          d.throttle    ?? null,
      // Elektrik / vites / çevre
      batteryVolt:       d.batteryVolt ?? null,
      gearPos:           d.gearPos     ?? null,
      ambientTemp:       d.ambientTemp ?? null,
      // Şasi güvenliği
      abs:               d.abs,
      tractionControl:   d.tractionControl,
      stabilityControl:  d.stabilityControl,
      // Gövde / konfor
      parkingBrake:      d.parkingBrake,
      seatbelt:          d.seatbelt,
      wipers:            d.wipers,
      airCondition:      d.airCondition,
      cruiseControl:     d.cruiseControl,
    });
  });

  // ValidationGuard GPS beslemesi — GPS hızını obdService'e ilet (döngüsel import olmadan)
  const unsubGpsValidation = gps.onData((d) => {
    if (d.speed != null) {
      // GpsAdapterData.speed ham m/s — km/h'e çevir (deadzone uygulamadan)
      updateGpsSpeedForValidation(d.speed * 3.6);
    }
  });

  // Telemetri push hattı — cloud push için gecikme kabul edilemez; RAF dışı
  telemetryService.start(resolver);

  // Uzaktan komut kanalı — Supabase Realtime
  void startRemoteCommands();

  // Live CSS custom property sync
  const cleanupLiveStyle = startLiveStyleEngine();

  resolver.start();

  // ── Connectivity Manager ────────────────────────────────────────────────
  const stopConnectivity = startConnectivityManager();

  // ── CAN Sinyal Validator ─────────────────────────────────────────────────
  const stopValidator = startCanSignalValidator();

  // Fiat Doblo aday sinyallerini validator'a kaydet (doğrulanmamış)
  registerCandidate(0x1D0, 'speed',   'byte[2-3]×0.01 km/h');
  registerCandidate(0x1D2, 'reverse', 'byte[0] bit5');
  registerCandidate(0x345, 'doorFl',  'byte[0] bit0');
  registerCandidate(0x345, 'doorFr',  'byte[0] bit1');

  // ── MCU Sniffer — 12s gecikmeyle başlat (startup CPU rahatlatma) ────────
  let _mcuSniffStarted = false;
  if (isNative) {
    // canDiag listener hemen kur — ama sniffer'ı 12s sonra başlat
    CarLauncher.addListener('canDiag', (ev: { msg: string }) => {
      recordDiagLine(ev.msg, 'MCU');
      _feedValidatorFromDiag(ev.msg);
    }).catch(() => {});

    setTimeout(() => {
      if (!_mcuSniffStarted) {
        _mcuSniffStarted = true;
        CarLauncher.startMcuSniff?.().catch(() => {});
      }
    }, 12_000);
  }

  // ── VehicleHandshake — OBD bağlandığında tek seferlik çalıştır ──────────
  // Yalnızca OBD (Bluetooth) aktifken. Native CAN (Hiworld) her zaman trusted.
  let _handshakeDone = false;
  const unsubHandshake = onOBDData(() => {
    if (_handshakeDone) return;
    _handshakeDone = true;
    // One-shot: artık OBD dinlemesine gerek yok
    unsubHandshake();
    // Handshake'i arka planda çalıştır — main thread'i bloke etme
    setTimeout(() => {
      void runVehicleHandshake('', '').then(outcome => {
        resolver.setHandshakeOutcome(outcome);
        recordEvent('signal', 'OBD', `Handshake: ${outcome.profile.id} safe=${outcome.safeMode}`);
      }).catch(() => {});
    }, 0);
  });

  // TEŞHİS (B-2): başlatma zinciri TAMAMLANDIKTAN sonra sayılır. Yukarıdaki
  // adımlardan biri throw ederse buraya ulaşılmaz → yarım başlatma SAYILMAZ.
  _dlStarts          = _satInc(_dlStarts);
  _dlLastStartedAtMs = Date.now();

  // Dispose bir kez çalışır: ikinci çağrı no-op (çift stop sayımı ve
  // gereksiz tekrar-teardown YOK).
  let _disposed = false;

  return () => {
    if (_disposed) return;
    _disposed = true;

    if (_rafId) { cancelAnimationFrame(_rafId); _rafId = 0; }
    _hasPending = false;
    unsubCanExtras();
    unsubGpsValidation();
    stopConnectivity();
    stopValidator();
    if (isNative) CarLauncher.stopMcuSniff?.().catch(() => {});

    _activeResolver = null;
    stopRemoteCommands();
    cleanupLiveStyle();
    telemetryService.stop();
    resolver.stop();

    // TEŞHİS (B-2): gerçek dispose tamamlandıktan SONRA — yalnız defter tutma.
    _dlStops          = _satInc(_dlStops);
    _dlLastStoppedAtMs = Date.now();
  };
}

// ── canDiag → CanSignalValidator besleme ─────────────────────────────────────
// Format: "[CAN] 1D0  FF0032000000  ← speed=50.0 km/h  ts=1716123456"
// Sadece decode edilmiş sinyalleri parse eder — ham hex'e dokunmaz.

const _CAN_MULTI_RE = /(\w+)=([\d.]+|true|false)/g;

function _feedValidatorFromDiag(msg: string): void {
  if (!msg.startsWith('[CAN]') || !msg.includes('←')) return;

  // CAN ID'yi parse et
  const idMatch = msg.match(/^\[CAN\]\s+([0-9A-Fa-f]+)/);
  if (!idMatch) return;
  const canId = parseInt(idMatch[1], 16);
  if (isNaN(canId)) return;

  // Sinyal adı=değer çiftlerini parse et: "speed=50.0 km/h", "reverse=true"
  const decoded = msg.slice(msg.indexOf('←') + 1);
  const matches = decoded.matchAll(_CAN_MULTI_RE);
  for (const m of matches) {
    const name  = m[1];
    const raw   = m[2];
    const value: number | boolean | null =
      raw === 'true'  ? true  :
      raw === 'false' ? false :
      isNaN(parseFloat(raw)) ? null : parseFloat(raw);
    if (value === null) continue;
    submitSample(canId, name, value);
  }
}

