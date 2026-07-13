/**
 * OBD Service — Bluetooth ELM327 OBD-II with mock fallback.
 *
 * Architecture:
 *  - Module-level push state (same pattern as deviceApi / mediaService)
 *  - Connection state machine: idle → scanning → connecting → connected | error
 *  - Native path: CarLauncher.scanOBD() → connectOBD() → obdData events (every ~3 s)
 *  - Mock fallback: setInterval every 5 s — activated when no native or on error
 *  - useOBDState() hook only subscribes; no timers inside React
 *  - startOBD() is idempotent; stopOBD() fully cleans up
 */

import { useSyncExternalStore } from 'react';
import { Capacitor } from '@capacitor/core';
import type { PluginListenerHandle } from '@capacitor/core';
import { CarLauncher } from './nativePlugin';
import type { NativeOBDData } from './nativePlugin';
import { getConfig, onPerformanceModeChange } from './performanceMode';
import { runtimeManager }                     from '../core/runtime/AdaptiveRuntimeManager';
import { logError } from './crashLogger';
import { useRafSmoothed } from './rafSmoother';
import { parseBinaryOBDFrame, hasBinaryFrame, clearAccumulatedBuffer } from './obdBinaryParser';
import {
  hydrateCanSnapshotSync,
  hydrateCanSnapshotAsync,
  scheduleCanSnapshot,
  flushCanSnapshotNow,
  stopCanSnapshot,
} from './canSnapshotService';
import { buildHandshakeResult, classifyHandshakeResponse } from '../core/val/OBDHandshake';
import { vehicleProfileRegistry } from '../core/val/VehicleProfile';
import type { IVehicleProfile }   from '../core/val/VehicleProfile';
import { loadObdAddress, saveObdAddress, clearObdAddress, clearObdTransport, loadObdProfileId, saveObdProfileId, loadObdTransport, saveObdTransport, loadObdTransportVerified, saveObdTransportVerified, loadObdProtocol, saveObdProtocol, clearObdProtocol, isValidTcpAddress, markObdAddressVerified, type ObdTransport } from './obdStorage';
import { persistHandshakeVin } from './vehicleProfileService';
import { isFeatureEnabled, recordFault } from './safety/SafetyBrain';
import { useExpertStore } from '../store/useExpertStore';
import { sanitizeNativeOBDPacket } from './obdSanitizer';
import { computeFuelMetrics } from './obdMetrics';
import { getMockInitialData, generateMockUpdate } from './obdMockEngine';
import { getPidListForVehicle, refinePidList } from './obdPidConfig';
import { computeObdPollProfile } from './obd/AdaptivePollingController';
import { obdHealthMonitor, HEALTH_FIELDS } from './obd/ObdHealthMonitor';
import { notifyObdConnected as notifyExtendedPids, seedSupportedPids as seedExtendedSupported } from './obd/extendedPidService';
import { getDeviceTier } from './deviceCapabilities';
import { recordDiag } from './obdDiagnosticRecorder';
import { emitObdDiag, getLastObdDiagReason, classifyObdErrorReason } from './obdDiagEmitter';
import { shouldFallbackFromEV, shouldFallbackFromICE } from './obdValidation';
import {
  CONNECT_TIMEOUT_MS,
  STALE_THRESHOLD_MS,
  WATCHDOG_INTERVAL_MS,
  DATA_GATE_TIMEOUT_MS,
  DEEP_RECONNECT_INTERVAL_MS,
  getReconnectDelay,
  shouldAttemptReconnect,
  isDataStale,
} from './obdRetryPolicy';

/**
 * Doğrulanmamış (oturum başı / modal tahmini) bağlantıda BLE ÖNCE denenirken verilen
 * bounded timeout. GATT connect+discovery genelde <5s sürer; 8s gerçek BLE adaptöre yeter,
 * gerçek classic adaptörde ise 15s'lik classic timeout'a geçmeden hızlıca eler.
 */
const BLE_FIRST_TIMEOUT_MS = 8_000;

/* ── Types & Initial State ───────────────────────────────── */

import { INITIAL } from './obdTypes';
import type { OBDConnectionState, VehicleType, OBDData } from './obdTypes';
export type { OBDConnectionState, VehicleType, OBDData } from './obdTypes';
// Patch 7: OBD sağlık skorları (bağlantı kalitesi + sensör güvenilirliği) — UI/teşhis
// tek import yüzeyinden okusun diye buradan da dışa açılır.
export { getObdHealth } from './obd/ObdHealthMonitor';
export type { ObdHealthSnapshot } from './obd/ObdHealthMonitor';

/* ── Module state ────────────────────────────────────────── */

// Tier 1 (sync): localStorage'dan anlık hydration — sıfır gecikme.
// Snapshot kurtarıldıysa patch source='real' taşır (canSnapshotService._buildPatch)
// → _current.source 'none' yerine 'real' başlar, UI son bilinen değerleri ANINDA
// gösterir (boot'ta "veri yok / idle" boş gösterge görünmez). Computed yakıt
// alanları (fuelRemainingL/estimatedRangeKm) snapshot'ta yok; araç profili
// yüklenince setObdFuelConfig _current.fuelLevel'den yeniden hesaplar.
let _current: OBDData = { ...INITIAL, ...hydrateCanSnapshotSync() };
let _asyncHydrated = false; // Tier 2 hydration'ın tek sefer çalışmasını garantiler

// Two-set listener pattern — avoids `as any` casts for useSyncExternalStore.
// Data consumers (onOBDData) receive the full snapshot; React hooks only need a notify ping.
const _dataListeners         = new Set<(d: OBDData) => void>();
const _storeListeners        = new Set<() => void>();
/** @deprecated internal alias kept for _tickMock idle-skip guard */
const _listeners             = { get size() { return _dataListeners.size + _storeListeners.size; } };
let _mockTimerId: ReturnType<typeof setInterval> | null = null;
let _nativeHandles: PluginListenerHandle[] = [];
let _running                 = false;
let _lastNotifyTime          = 0;

// Exponential back-off reconnect state
let _reconnectAttempts = 0;
let _reconnectTimer: ReturnType<typeof setTimeout> | null = null;

// ── Patch 3: protokol döngüsü — YALNIZ UNABLE_TO_CONNECT sınıfı hatada ilerler ──
// Eskiden PROTOCOL_CYCLE doğrudan _reconnectAttempts'e (her türlü hata — BT/soket/
// timeout dahil) bağlıydı; bu, geçerli bir protokolü BT gürültüsü yüzünden gereksiz
// yere terk edip yanlış protokole geçmeye zorluyordu. Artık yalnızca native'in
// yapılandırılmış 'OBD_UNABLE_TO_CONNECT' reject kodu (ElmInitSequencer 0100 warm-up
// "UNABLE TO CONNECT" — araç/protokolden gerçekten yanıt alınamadı) bu sayacı artırır.
let _protocolCycleIndex = 0;

// Generation counter — prevents stale in-flight _startNative() from writing
// state after a stop/restart cycle. Each startOBD() call increments this.
let _nativeGeneration = 0;

// stopOBD() + startOBD() arasındaki native disconnect/connect race'ini önler.
// _startNative() bu promise'i await ederek önceki disconnectOBD() tamamlanmadan
// connectOBD() çağrısına girmez.
let _pendingDisconnect: Promise<void> | null = null;

// ── Stale-data watchdog ──────────────────────────────────────
let _lastRealDataMs = 0;
let _staleWatchdogTimer: ReturnType<typeof setInterval> | null = null;

// ── Data Validation Gate ─────────────────────────────────────
let _dataGateTimer: ReturnType<typeof setTimeout> | null = null;
let _dataGatePassed = false;

// ── Direct-reconnect: last known BT MAC ─────────────────────
// Persisted to localStorage so app restart skips full BT INQUIRY scan.
// BT INQUIRY = 10-30 s contention → GPS ±15 m jitter + A2DP glitch every ~10 s.
let _lastKnownAddress: string | null = loadObdAddress();

// Adaptör-değişimi koruması: kayıtlı MAC bu OTURUMDA en az bir kez RFCOMM ile
// bağlandı mı? false + tüm reconnect'ler tükendi → adres muhtemelen stale (yeni
// adaptör) → temizle. true (bağlanıp düştü = araç kapanması gibi) → adres korunur.
let _addressConnectedOnce = false;
let _lastKnownPin: string | null = null; // session-only, güvenlik için localStorage'a yazılmaz

// Son kullanılan taşıma katmanı ('classic' | 'ble'). MAC adresiyle birlikte persist edilir
// → direct-reconnect yolunda doğru transport ile bağlanılır. null = mevcut Classic varsayılanı.
let _lastKnownTransport: ObdTransport | null = loadObdTransport();
// Transport GERÇEKTEN doğrulandı mı (önceki BAŞARILI bağlantıdan)? Persist edilmiş transport
// yalnızca başarılı bağlantı sonrası yazılır → yüklendiğinde doğrulanmış sayılır. Modal/tarama
// seçimi ise yalnızca TAHMİN'dir (DUAL cihaz 'classic' görünebilir) → doğrulanmış DEĞİL.
// Bu ayrım fallback timeout'unu belirler: doğrulanmış → yanlış yolda 3s bekleme; tahmin →
// fallback'e TAM timeout ver (aksi halde doğru BLE yolu 3s'e açlık çeker, V-LINK bağlanamaz).
//
// HİBRİT FIX: Doğrulama YALNIZ bu oturumda GERÇEKLEŞEN başarılı bağlantıdan kazanılır.
// Persist edilmiş transport bir İPUCU'dur, doğrulama DEĞİL → her oturum başı false. Aksi
// halde modal tahmini (saveObdTransport ile kaydedilen 'classic') gelecek oturumda
// "doğrulanmış" sanılıp BLE fallback'i 3s'e sıkıştırıyordu (dual-mod V-LINK/iCar bağlanamıyordu).
let _transportConfirmed = false;

// A-fix (verified-transport-persist): persisted transport ÖNCEKİ oturumda CANLI PID verisiyle
// doğrulandı mı? `verified` yalnız veri-kapısı (_dataGatePassed) geçilince yazılır → true ise
// persisted transport boot'ta DOĞRUDAN primary denenir (gereksiz BLE-first turu ~10-15s atlanır).
// Modal/tarama tahmini veri akmadan ASLA verified olmaz → dual-mod adaptörde yanlış yönlendirme yok.
let _lastTransportVerified = loadObdTransportVerified();

// ── Vehicle Profile Auto-Detection ──────────────────────────
let _activeProfile: IVehicleProfile = vehicleProfileRegistry.getById(
  loadObdProfileId() ?? '',
) ?? vehicleProfileRegistry.getById('standard')!;

// ── Handshake capability discovery (W5-OBD-PR1) ──────────────
// Handshake bitmap keşfinden gelen KANIT (session-içi). Bir sonraki reconnect'te
// _getPidList refinePidList ile bunu kullanır → desteklenmeyen PID poll edilmez,
// desteklenen 0x2F (yakıt) oto-aktive olur. Kanıt yokken (null/boş) statik liste
// AYNEN kullanılır — fail-soft, mevcut poll zinciri regresyonsuz.
let _handshakeSupportedPids: Set<number> = new Set();
let _handshakeReadBlocks:    Set<number> = new Set();

// ValidationGuard: ardışık "OBD speed=0 iken GPS>10 km/h" sayacı
let _validationMisses = 0;
let _validationEnabled      = false; // Yalnızca EV profil seçilince aktif
// GPS hız cache — gpsService'ten beslenir, main thread döngüsünde güncellenir
let _lastKnownGpsSpeed      = 0;    // km/h

// Fix 1: ICE/Diesel Guard zamanlayıcı başlangıcı
let _iceRpmMissStart: number | null = null;

// Fix 3: ısınma (warm-up) erken çıkış kancası
let _warmupActive   = false;
let _warmupResolve: (() => void) | null = null;

// ── Fuel computation config ──────────────────────────────────
// Set via setObdFuelConfig() whenever the active vehicle profile changes.
let _fuelTankL        = 0;   // 0 = not configured
let _avgConsumL100    = 0;   // 0 = not configured (L per 100 km)

let _prevRpm: number | null = null;

// performanceMode değişiminde yalnızca reconnect timer'ı iptal et.
// Mock interval yönetimi merkezi RuntimeEngine (_unsubRuntime) tarafından yapılır.
const _unsubPerfMode = onPerformanceModeChange(() => {
  if (_reconnectTimer !== null) {
    clearTimeout(_reconnectTimer);
    _reconnectTimer = null;
  }
});

// RuntimeEngine mod değişimini dinle — obdPollingMs mock interval'ını güncelle.
// Zero-Leak: HMR dispose'da _unsubRuntime çağrılır.
const _unsubRuntime = runtimeManager.subscribe((_mode, config) => {
  if (!_running) return;
  // Patch 6 (AdaptivePollingController): gerçek bağlantıda mod değişimi → native FAST
  // grup poll periyodunu yeni moda göre güncelle (ör. termal kısıtlamada yavaşlat).
  if (_current.source === 'real') _applyObdPollProfile();
  if (_current.source !== 'mock' || _mockTimerId === null) return;
  // Merkezi runtime config'den gelen polling hızı → mock timer'ı yeniden kur
  clearInterval(_mockTimerId);
  _mockTimerId = setInterval(_tickMock, config.obdPollingMs);
});

/* ── Core helpers ────────────────────────────────────────── */

// DEV-only test override — production'da _testOBDOverride her zaman null'dur.
let _testOBDOverride: Partial<OBDData> | null = null;

function _notify(): void {
  const now = Date.now();
  const debounceMs = getConfig().obdListenerDebounce;
  // Clock Jump Protection (CLAUDE.md §4): sistem saati GERİYE sıçrarsa (NTP senkronu,
  // RTC/DST düzeltmesi, saat dilimi değişimi) `now - _lastNotifyTime` NEGATİF olur →
  // debounce koşulu sonsuza dek doğru kalır ve bildirim SESSİZCE boğulur (UI donmuş
  // görünür, `_current` güncellenmeye devam eder ama hiçbir dinleyici haberdar olmaz).
  // Negatif delta HER ZAMAN "debounce süresi dolmuş" sayılır — bildirim hemen geçer
  // ve saat referansı derhal düzeltilir.
  const elapsed = now - _lastNotifyTime;
  if (elapsed >= 0 && elapsed < debounceMs) return;
  _lastNotifyTime = now;
  // DEV: override varsa merge et, production build'de tree-shaked
  const snap: OBDData = (import.meta.env.DEV && _testOBDOverride)
    ? { ..._current, ..._testOBDOverride }
    : { ..._current };
  _dataListeners.forEach((fn) => fn(snap));
  _storeListeners.forEach((fn) => fn());
  // Gerçek CAN verisi geldiğinde WebView çökmesine karşı snapshot al.
  // scheduleCanSnapshot içeride 4s debounce ile safeStorage'a yazar.
  if (_current.source === 'real') scheduleCanSnapshot(_current);
}

/**
 * Teşhis timeline — connectionState GEÇİŞİNDE milestone kaydeder (pasif gözlemci).
 * Yalnızca durum değiştiğinde çağrılır; obdData paketleri connectionState'i
 * değiştirmediğinden canlı veride tetiklenmez (spam yok). Bağlantı akışına
 * etkisi yoktur — yalnızca recordDiag çağırır. scanning/connecting/initializing
 * modal tarafında (transport bilgisiyle) kaydedilir; burada yalnız sonuçlar.
 */
function _recordConnMilestone(prev: OBDConnectionState, next: OBDConnectionState): void {
  switch (next) {
    case 'connected':
      // connected == ilk geçerli veri paketi (data gate) → "canlı veri başladı".
      recordDiag({
        stage: 'liveData', status: 'success',
        userMessage: 'Bağlandı — canlı veri akıyor.',
        technicalMessage: `connectionState ${prev}→connected`,
      });
      break;
    case 'reconnecting':
      recordDiag({
        stage: 'retry', status: 'warn',
        userMessage: 'Bağlantı koptu, yeniden deneniyor…',
        technicalMessage: `connectionState ${prev}→reconnecting`,
      });
      break;
    case 'error':
      recordDiag({
        stage: 'disconnect', status: 'fail',
        userMessage: 'Bağlantı hatası oluştu.',
        technicalMessage: `connectionState ${prev}→error`,
      });
      break;
    case 'idle':
      // Aktif bir durumdan idle'a düşüş = gerçek disconnect (boot-idle değil).
      recordDiag({
        stage: 'disconnect', status: 'info',
        userMessage: 'Bağlantı kapatıldı.',
        technicalMessage: `connectionState ${prev}→idle`,
      });
      break;
    default:
      break; // scanning / connecting / initializing → modal kaydeder
  }
}

function _merge(partial: Partial<OBDData>): void {
  // Recompute fuel metrics whenever fuelLevel is updated
  if (partial.fuelLevel !== undefined && partial.fuelLevel >= 0) {
    const computed = computeFuelMetrics(partial.fuelLevel, _fuelTankL, _avgConsumL100);
    partial = { ...partial, ...computed };
  }
  const prevConnState = _current.connectionState;
  _current = { ..._current, ...partial };

  // Testability: connectionState geçişinde body attribute güncelle (CSS/logic etkilemez)
  if (typeof document !== 'undefined' && partial.connectionState !== undefined && partial.connectionState !== prevConnState) {
    if (_current.connectionState === 'connected') {
      document.body.setAttribute('data-obd-ready', 'true');
    } else {
      document.body.removeAttribute('data-obd-ready');
    }
  }

  // Teşhis timeline (pasif): yalnızca connectionState GEÇİŞİNDE milestone kaydet.
  if (partial.connectionState !== undefined && _current.connectionState !== prevConnState) {
    _recordConnMilestone(prevConnState, _current.connectionState);
  }

  _notify();
}


function _sanitizeNative(data: Partial<NativeOBDData>): Partial<OBDData> | null {
  const { patch, nextRpm } = sanitizeNativeOBDPacket(data, _prevRpm);
  _prevRpm = nextRpm;
  // Patch 7 (ObdHealthMonitor): alan bazlı kabul/red istatistiği — fail-soft gözlemci,
  // veri yolunu ASLA etkilemez. Sunulmayan (-1 sentinel = bu turda sorgulanmadı) alanlar
  // istatistiğe girmez (staggered polling güvenilirlik skorunu düşürmesin).
  try {
    for (const f of HEALTH_FIELDS) {
      const offered = data[f];
      if (offered === undefined || offered < 0) continue;
      const patchKey = f === 'voltage' ? 'batteryVoltage' : f; // ATRV → OBDData eşlemesi
      obdHealthMonitor.noteField(f, patch !== null && (patch as Record<string, unknown>)[patchKey] !== undefined);
    }
    if (patch) obdHealthMonitor.notePacketAccepted();
  } catch { /* gözlemci hatası veri akışını düşürmez */ }
  return patch;
}

/**
 * Patch 6 (AdaptivePollingController): cihaz sınıfı + aktif RuntimeMode'dan türetilen
 * poll profilini native tarafa iletir. Fail-soft: eski APK'da metod yoksa sessizce atlanır
 * (native varsayılan 3s ile devam eder — ESKİ davranışla birebir aynı).
 */
function _applyObdPollProfile(): void {
  if (!Capacitor.isNativePlatform() || !CarLauncher.setObdPollProfile) return;
  const profile = computeObdPollProfile(getDeviceTier(), runtimeManager.getConfig().obdPollingMs);
  // Patch 7: sağlık monitörü bayatlığı AKTİF periyoda göre ölçer (250ms'de 3s sessizlik
  // anormal, 15s weak modda normaldir).
  obdHealthMonitor.setExpectedIntervalMs(profile.fastMs);
  void CarLauncher.setObdPollProfile(profile)
    .catch(() => { /* eski native sürüm / geçici köprü hatası → varsayılan periyot kalır */ });
}

/* ── Mock simulation ─────────────────────────────────────── */

function _tickMock(): void {
  if (_listeners.size === 0) return; // UI abone yoksa CPU tasarrufu
  try {
    _merge(generateMockUpdate(_current));
  } catch (e) {
    logError('OBD:MockTick', e);
  }
}

function _startMock(): void {
  if (!MOCK_ENABLED) return;  // mock kapalıysa asla sahte veri başlatma
  if (_mockTimerId !== null) return;
  _merge({
    connectionState: 'connected',
    source: 'mock',
    deviceName: '',
    ...getMockInitialData(_current.vehicleType),
  });
  // Merkezi RuntimeEngine config — getConfig().obdPollInterval yerine
  _mockTimerId = setInterval(_tickMock, runtimeManager.getConfig().obdPollingMs);
}

/**
 * Yakıt hesaplama konfigürasyonunu güncelle.
 * useLayoutServices.ts'ten aktif profil değiştiğinde çağrılır.
 *
 * @param tankL        Depo hacmi (litre) — 0 = hesaplama devre dışı
 * @param avgL100      Ortalama tüketim (L/100 km) — 0 = menzil hesaplanamaz
 * @param knownAddress Önceden bilinen BT MAC adresi — scan'ı atlamak için
 */
export function setObdFuelConfig(tankL: number, avgL100: number, knownAddress?: string): void {
  useExpertStore.getState().assertWritesAllowed();
  _fuelTankL     = tankL;
  _avgConsumL100 = avgL100;
  if (knownAddress) _lastKnownAddress = knownAddress;
  // Anlık fuelLevel ile metrikleri yeniden hesapla
  if (_current.fuelLevel >= 0) {
    _merge(computeFuelMetrics(_current.fuelLevel, tankL, avgL100));
  }
}

/** Aktif araç tipini güncelle ve mock verisini resetle */
export function setObdVehicleType(type: VehicleType): void {
  useExpertStore.getState().assertWritesAllowed();
  _merge({ vehicleType: type });
  if (_current.source === 'mock') {
    _stopMock();
    _startMock();
  }
}

function _stopMock(): void {
  if (_mockTimerId !== null) {
    clearInterval(_mockTimerId);
    _mockTimerId = null;
  }
}

/* ── Remote tanı (obd_diag) ortak alanları ───────────────── */
// emitObdDiag çağrılarında tekrarlanan, kişisel-veri-içermeyen durum seti.
// MAC / cihaz adı / VIN / plaka / konum BİLİNÇLİ olarak burada YOK.
function _diagCommon(): { source: string; vehicleType: string; lastSeenMs: number } {
  return {
    source:      _current.source,
    vehicleType: _current.vehicleType,
    lastSeenMs:  _current.lastSeenMs,
  };
}

/* ── Stale-data watchdog ─────────────────────────────────── */

function _startStaleWatchdog(): void {
  if (_staleWatchdogTimer !== null) return;
  _lastRealDataMs = Date.now();
  _staleWatchdogTimer = setInterval(() => {
    if (!_running || _current.source !== 'real') return;
    if (isDataStale(_lastRealDataMs)) {
      // RFCOMM socket sessizce düştü — reconnect tetikle
      logError('OBD:StaleData', new Error(`${STALE_THRESHOLD_MS / 1000}s boyunca veri alınamadı`));
      emitObdDiag('stale_data', 'OBD_STALE_DATA', {
        ..._diagCommon(),
        transport: _lastKnownTransport,
        elapsedMs: Date.now() - _lastRealDataMs,
        msg:       'Veri akışı kesildi (RFCOMM sessiz drop)',
      });
      _stopStaleWatchdog();
      void _removeNativeHandles().then(() => _scheduleReconnect());
    }
  }, WATCHDOG_INTERVAL_MS);
}

function _stopStaleWatchdog(): void {
  if (_staleWatchdogTimer !== null) {
    clearInterval(_staleWatchdogTimer);
    _staleWatchdogTimer = null;
  }
}

/* ── Data Validation Gate ────────────────────────────────── */

function _clearDataGate(): void {
  if (_dataGateTimer) { clearTimeout(_dataGateTimer); _dataGateTimer = null; }
  _dataGatePassed = false;
}

/**
 * connectOBD + ısınma süresinden sonra çağrılır.
 * İlk geçerli hız/RPM verisi geldiğinde 'connected'/'real' state'e geçilir.
 * DATA_GATE_TIMEOUT_MS içinde PID akışı başlamazsa reconnect tetiklenir.
 */
function _startDataValidationGate(gen: number): void {
  _stopStaleWatchdog(); // ısınma sırasında erken gelen veri watchdog başlatmış olabilir
  _clearDataGate();
  _dataGateTimer = setTimeout(() => {
    _dataGateTimer = null;
    if (!_running || _nativeGeneration !== gen) return;
    if (!_dataGatePassed) {
      recordFault('OBD_DATA_GATE_TIMEOUT');
      logError('OBD:DataGate', new Error(`Bağlandı fakat ${DATA_GATE_TIMEOUT_MS / 1000}s içinde PID verisi alınamadı (Stale bağlantı)`));
      emitObdDiag('data_gate', 'OBD_DATA_GATE_TIMEOUT', {
        ..._diagCommon(),
        transport: _lastKnownTransport,
        attempts:  _reconnectAttempts,
        elapsedMs: DATA_GATE_TIMEOUT_MS,
        msg:       'Bağlandı fakat PID verisi alınamadı (stale bağlantı)',
      });
      _stopStaleWatchdog();
      void _removeNativeHandles().then(() => {
        if (isFeatureEnabled('obdDataGateAutoReconnect')) _scheduleReconnect();
      });
    }
  }, DATA_GATE_TIMEOUT_MS);
}

/**
 * Data gate'i açacak "araç gerçekten yanıt veriyor" sinyali — HERHANGİ bir çekirdek
 * ECU PID'i (hız/RPM/su/yakıt/gaz/emme/boost). Eskiden yalnız speed|rpm bakılıyordu;
 * ama 010C/010D bazı araçlarda (Renault EMS 7E0 header, motor kapalı, protokol sırası)
 * NO-DATA (-1) döner → sanitizer bunları patch'e koymaz → gate hiç açılmaz →
 * connectionState 'initializing'de takılır → araç bağlı + veri akarken UI "bağlan"
 * gösterir (saha hatası). batteryVoltage (ATRV) BİLİNÇLİ HARİÇ: adaptör seviyesinden
 * ECU'suz da gelebilir → yanlış "bağlı" pozitifi vermesin.
 */
function _hasEcuData(patch: Partial<OBDData>): boolean {
  return patch.speed !== undefined || patch.rpm !== undefined
    || patch.engineTemp !== undefined || patch.fuelLevel !== undefined
    || patch.throttle !== undefined || patch.intakeTemp !== undefined
    || patch.boostPressure !== undefined;
}

/**
 * Native veri olayı için merkezi yönlendirici.
 * Gate geçilmemişse: çekirdek ECU PID'i içeren ilk pakette 'connected'/'real'e geç.
 * Gate geçildikten sonra: tüm patch'ler doğrudan merge edilir.
 *
 * ValidationGuard: EV profili aktifken OBD speed=0 ama GPS speed>10 durumu
 * VALIDATION_THRESHOLD kez tekrar ederse StandardProfile'e döner.
 */
function _onRealData(patch: Partial<OBDData>): void {
  _lastRealDataMs = Date.now();

  // Fix 3: ısınma devam ediyorken geçerli çekirdek PID gelirse 2s deadline'ı iptal et
  if (_warmupActive && _warmupResolve && _hasEcuData(patch)) {
    _warmupResolve();
    return; // gate açılana kadar bu paket görmezden gelinir; sonraki paket connected'e geçirir
  }

  if (!_dataGatePassed) {
    if (_hasEcuData(patch)) {
      _dataGatePassed = true;
      if (_dataGateTimer) { clearTimeout(_dataGateTimer); _dataGateTimer = null; }
      _merge({ ...patch, lastSeenMs: _lastRealDataMs, connectionState: 'connected', source: 'real' });
      _startStaleWatchdog();
      // A-fix: CANLI PID verisi doğrulandı → aktif transport'u kalıcı "verified" işaretle.
      // Sonraki boot bu transport'u doğrudan dener (BLE-first turu atlanır). TCP hariç (ayrı yol).
      if (_lastKnownTransport != null && _lastKnownTransport !== 'tcp' && !_lastTransportVerified) {
        _lastTransportVerified = true;
        saveObdTransportVerified(true);
      }
      // Keşif kanıt defteri: gerçek ECU verisi AKTI → bu adres kanıtlanmış bir OBD
      // adaptörüdür. Tarama listesi bunu okuyup 'verified' rozeti basar (tahmin değil).
      // Kanıt anı BURASIDIR: bağlantı kurmak veri akıtmak demek değildir.
      if (_lastKnownAddress && _lastKnownTransport !== 'tcp') {
        markObdAddressVerified(_lastKnownAddress);
      }
    }
    return; // gate geçilmemişse diğer PID'ler ısınma dönemi boyunca görmezden gelinir
  }

  // ── ValidationGuard (EV profili) ────────────────────────────────────────────
  if (_validationEnabled && patch.speed !== undefined) {
    const { isInvalid, nextMisses } = shouldFallbackFromEV(patch.speed, _lastKnownGpsSpeed, _validationMisses);
    _validationMisses = nextMisses;
    if (isInvalid) {
      console.warn('[OBD:ValidationGuard] EV profili geçersiz: OBD speed=0 iken GPS speed=',
        _lastKnownGpsSpeed.toFixed(1), 'km/h → StandardProfile\'e geri dönülüyor');
      _validationEnabled = false;
      _applyDetectedProfile(vehicleProfileRegistry.getById('standard')!);
    }
  }

  // Fix 1: ICE/Diesel Guard — speed>10 km/h ama RPM 10s boyunca -1 → StandardProfile'e dön
  if (!_validationEnabled &&
      (_current.vehicleType === 'ice' || _current.vehicleType === 'diesel') &&
      patch.speed !== undefined) {
    const effectiveRpm = patch.rpm !== undefined ? patch.rpm : _current.rpm;
    const { isInvalid, nextMissStart } = shouldFallbackFromICE(patch.speed, effectiveRpm, _iceRpmMissStart);
    _iceRpmMissStart = nextMissStart;
    if (isInvalid) {
      console.warn('[OBD:ICEGuard] ICE profili geçersiz: speed=', patch.speed,
        'km/h iken 10s boyunca RPM=-1 → StandardProfile\'e geri dönülüyor');
      _applyDetectedProfile(vehicleProfileRegistry.getById('standard')!);
    }
  }

  _merge({ ...patch, lastSeenMs: _lastRealDataMs });
}

/* ── Exponential back-off reconnect ──────────────────────── */

/**
 * Schedule a reconnect attempt.
 * Delays: 1 s, 2 s, 4 s, 8 s, 16 s — then gives up and falls back to mock.
 * Mock data continues flowing between attempts so OBD panels stay alive.
 */
function _scheduleReconnect(): void {
  if (!_running) return;

  // Patch 7: gerçek kopma → sağlık monitörüne reconnect baskısı (sönümlü sayaç).
  obdHealthMonitor.noteReconnect();

  clearAccumulatedBuffer(); // T507: parçalı paket tamponunu temizle
  _clearDataGate();         // önceki gate/timer sızıntısını önle

  // Fix 2: A2DP glitch önleme — reconnect sırasında BT INQUIRY scan'i durdur.
  // BT inquiry scan sırasında PLL çakışması → GPS ±15 m jitter + A2DP sniff-mode askıya → müzik atlaması.
  if (Capacitor.isNativePlatform()) {
    try { void (CarLauncher as unknown as { stopScan?: () => Promise<void> }).stopScan?.(); } catch { /* ignore */ }
  }

  // OBD disconnect → RuntimeEngine'e bildir (bir adım downgrade — hysteresis bypass)
  runtimeManager.reportFailure('OBD');

  // Gerçek cihazda (native) sahte veri göstermek yasak — dürüst error state.
  // Mock sadece tarayıcı geliştirme modunda (MOCK_ENABLED=true, non-native) kullanılır.
  const nativePlatform = Capacitor.isNativePlatform();

  // Guard: BT INQUIRY scan reconnect sırasında yasak — GPS jitter + A2DP kesintisi.
  // Kayıtlı MAC yoksa kullanıcı manuel olarak OBDConnectModal'dan cihaz seçmelidir.
  if (!_lastKnownAddress) {
    _reconnectAttempts = 0;
    _merge({ connectionState: 'error', source: 'none' });
    if (MOCK_ENABLED && !nativePlatform) _startMock();
    return;
  }

  if (!shouldAttemptReconnect(_reconnectAttempts)) {
    // Üstel tur tükendi — tek tanı eventi (deneme sayısı sıfırlanmadan ÖNCE)
    emitObdDiag('reconnect', 'OBD_RECONNECT_EXHAUSTED', {
      ..._diagCommon(),
      transport: _lastKnownTransport,
      attempts:  _reconnectAttempts,
      msg: _addressConnectedOnce
        ? 'Üstel reconnect turu tükendi — derin döngüye geçildi'
        : 'Üstel reconnect turu tükendi — kayıtlı adres temizlendi',
    });
    _reconnectAttempts = 0;

    // ── Risk B çözümü: Automotive "Always-On" derin yeniden bağlanma ──────────
    // DOĞRULANMIŞ adaptör (bu oturumda en az bir kez RFCOMM/GATT açıldı = araç
    // kapanması gibi GEÇİCİ drop) → sistem ASLA pes etmez. 'reconnecting' durumunda
    // kalır ve DEEP_RECONNECT_INTERVAL_MS'de bir yeni üstel tur başlatır. Kontak
    // saatler sonra tekrar açılsa bile bağlantı kendiliğinden geri gelir.
    if (_addressConnectedOnce) {
      _merge({ connectionState: 'reconnecting', source: (MOCK_ENABLED && !nativePlatform) ? 'mock' : 'none', deviceName: '' });
      if (!nativePlatform) _startMock();
      _scheduleDeepReconnect();
      return;
    }

    // Adaptör-değişimi koruması: kayıtlı MAC bu oturumda HİÇ bağlanamadıysa (RFCOMM
    // hiç açılmadı) muhtemelen eski/yanlış adaptör → temizle ki sonraki başlatma
    // tam BT scan'e düşsün. Burada deep-loop YOK (yanlış adrese sonsuza dek asılmamak için).
    _lastKnownAddress = null;
    clearObdAddress();
    // Adres temizlenince transport da temizlenir: stale 'ble' transport bir sonraki
    // farklı adaptörde yanlış GATT dallanmasına yol açmasın (adres+transport birlikte persist).
    _lastKnownTransport = null;
    clearObdTransport();           // storage'da transport + verified silinir
    _lastTransportVerified = false; // adaptör değişti → doğrulama geçersiz
    // Patch 3: adaptör muhtemelen değişti — öğrenilen protokol de stale sayılır (yeni
    // adaptör/araç farklı protokol kullanabilir); bir sonraki bağlantı ATSP0'dan başlar.
    clearObdProtocol();
    _protocolCycleIndex = 0;
    if (MOCK_ENABLED && !nativePlatform) {
      _startMock();
    } else {
      _merge({ connectionState: 'error', source: 'none' });
    }
    return;
  }

  // Fix 2: muhafazakâr backoff — ilk deneme 2s, çarpan 2.0 (2 s, 4 s, 8 s, 16 s, 32 s)
  const delayMs = getReconnectDelay(_reconnectAttempts);
  _reconnectAttempts++;

  // Native platformda reconnect bekleme süresi boyunca 'reconnecting' + source: 'none'
  // (sahte veri yok). Web geliştirme modunda mock akışı sürdürülür.
  _merge({ connectionState: 'reconnecting', source: (MOCK_ENABLED && !nativePlatform) ? 'mock' : 'none', deviceName: '' });
  if (!nativePlatform) _startMock(); // web dev modu: mock no-op eğer MOCK_ENABLED=false

  if (_reconnectTimer) clearTimeout(_reconnectTimer);
  _reconnectTimer = setTimeout(() => {
    _reconnectTimer = null;
    if (!_running) return;

    _stopMock();
    _startNative({ trustBypass: true }).then(() => {
      // Success — reset counter
      _reconnectAttempts = 0;
    }).catch(async (e: unknown) => {
      logError('OBD:Reconnect', e);
      await _removeNativeHandles(); // await so handles are gone before next attempt
      _scheduleReconnect();
    });
  }, delayMs);
}

/**
 * Derin yeniden bağlanma (Automotive Always-On) — üstel backoff turu tükenen
 * DOĞRULANMIŞ adaptör için DEEP_RECONNECT_INTERVAL_MS'de bir yeni tur dener.
 *
 * Sistem bu sırada 'reconnecting' durumunda kalır; ASLA 'error'a düşmez. Başarısız
 * olursa _scheduleReconnect ile yeni bir üstel tur başlar, o da tükenirse tekrar bu
 * derin döngüye girilir → sonsuz, düşük-frekanslı (5 dk) yeniden deneme. Tek timer
 * (_reconnectTimer) kullanılır; ekstra bellek/FPS maliyeti yok.
 */
function _scheduleDeepReconnect(): void {
  if (!_running) return;
  if (_reconnectTimer) clearTimeout(_reconnectTimer);
  _reconnectTimer = setTimeout(() => {
    _reconnectTimer = null;
    if (!_running) return;

    _reconnectAttempts = 0;       // yeni üstel tur baştan başlar
    _stopMock();
    _startNative({ trustBypass: true }).then(() => {
      _reconnectAttempts = 0;     // başarılı — sayaç sıfır
    }).catch(async (e: unknown) => {
      logError('OBD:DeepReconnect', e);
      await _removeNativeHandles();
      _scheduleReconnect();       // yeni üstel tur; o da tükenirse yine deep-loop
    });
  }, DEEP_RECONNECT_INTERVAL_MS);
}

/* ── Native OBD helpers ──────────────────────────────────── */

async function _removeNativeHandles(): Promise<void> {
  const handles = _nativeHandles.splice(0);
  for (const h of handles) {
    try { await h.remove(); } catch { /* ignore */ }
  }
}


async function _startNative(opts?: { trustBypass?: boolean }): Promise<void> {
  if (!opts?.trustBypass) {
    useExpertStore.getState().assertWritesAllowed();
  }

  // Capture generation at entry — if stopOBD()/startOBD() fires mid-flight,
  // _nativeGeneration changes and stale continuations bail out safely.
  const myGen = ++_nativeGeneration;
  const _stale = () => !_running || _nativeGeneration !== myGen;
  // Tanı: faz süreleri için monotonic başlangıç (saat atlaması güvenli)
  const _diagT0 = performance.now();

  // Önceki stopOBD() disconnect'inin native tarafta tamamlanmasını bekle.
  // disconnectOBD() bitmeden connectOBD() gönderilirse BLE/TCP stack yarış yaşar.
  if (_pendingDisconnect) {
    await _pendingDisconnect;
    if (_stale()) return;
  }

  _nativeHandles = [];

  // ── Fix 3: Direct reconnect — BT INQUIRY scan atla ──────────
  // Full scanOBD() = Android BT INQUIRY mode (10–30 s, 1.6 s scan intervals).
  // Bu süre boyunca GPS combo-chip'te PLL çakışması → ±15 m GPS jitter;
  // A2DP sniff-mode askıya alınır → müzik glitch her ~10 s.
  // Bilinen MAC varsa direkt connect() dene; sadece başarısız olursa tara.
  let candidate: { name: string; address: string } | null = null;

  if (_lastKnownAddress) {
    // Bilinen adrese direkt bağlanmayı dene — scan yok
    candidate = { name: 'OBD Adaptörü', address: _lastKnownAddress };
    _merge({ connectionState: 'connecting', deviceName: candidate.name });
  } else {
    // PERF 2026-06-11: kayıtlı adres YOKKEN otomatik scanOBD() KALDIRILDI.
    // Açılışta tetiklenen BT INQUIRY (10-30 s) GPS jitter + A2DP glitch +
    // Capacitor Bridge tıkanması = "Latency Death" yaratıyordu. İlk bağlantı
    // HER ZAMAN kullanıcı eylemiyle kurulur: OBDConnectModal taraması →
    // startOBD(address) → adres persist → sonraki açılışlar direct-reconnect.
    emitObdDiag('scan', 'OBD_NO_DEVICE', {
      ..._diagCommon(),
      attempts:  _reconnectAttempts,
      elapsedMs: performance.now() - _diagT0,
      msg:       'Kayıtlı OBD adresi yok — otomatik tarama atlandı (manuel bağlantı gerekli)',
    });
    throw new Error('Kayıtlı OBD adresi yok — Ayarlar → OBD Bağlantısı\'ndan cihaz seçin');
  }

  // 2. Register disconnect / error listener — set handle immediately to ensure cleanup
  //
  // Patch 1 (obdStatus olay disiplini — reconnect fırtınası fix): native taraf obdStatus'u
  // ÜÇ farklı anlamda yayınlıyor (bkz. CarLauncherPlugin.java onStatusChanged/onFailed×2/
  // disconnectOBD). Eskiden İÇERİĞE BAKILMADAN her event reconnect tetikliyordu — özellikle
  // transport-fallback yolunda (aşağıda `CarLauncher.disconnectOBD()` çağrısı, satır ~753)
  // KENDİ disconnect'imizin yankısı aynı generation'daki bu handle'a "gerçek kopma" gibi
  // görünüp PARALEL bir reconnect turu başlatıyordu (BC8 kararsız döngü kök nedeni).
  // Fix: yalnız reason==='link_lost' VEYA reason alanı hiç yoksa (eski APK geri-uyum)
  // reconnect tetiklenir; 'connect_failed' ve 'user_disconnect' bilinçli olarak yok sayılır.
  const statusHandle = await CarLauncher.addListener(
    'obdStatus',
    (event: { reason?: 'link_lost' | 'connect_failed' | 'user_disconnect' }) => {
      if (!_running || _nativeGeneration !== myGen) return;
      if (event.reason !== undefined && event.reason !== 'link_lost') return;
      void _removeNativeHandles().then(() => _scheduleReconnect());
    },
  );

  if (_stale()) { void _removeNativeHandles(); return; }
  _nativeHandles = [statusHandle]; // track as soon as acquired

  // 3. Register data listener — throttled by the native 3 s polling interval
  const dataHandle = await CarLauncher.addListener(
    'obdData',
    (data: NativeOBDData) => {
      if (!_running || _nativeGeneration !== myGen) return;
      try {
        // ── Binary Fast-Path ──────────────────────────────────────────────
        // parseBinaryOBDFrame içinde T507 parçalı paket birikimi yapılır;
        // null dönerse ya fragment bekleniyor (→ bekle) ya da JSON fallback.
        if (hasBinaryFrame(data)) {
          const binaryPatch = parseBinaryOBDFrame(data.binaryFrame);
          if (binaryPatch) {
            _onRealData(binaryPatch);
            return; // JSON path atlandı
          }
          // null: fragment birikmede veya magic/version hatası → JSON fallback
        }

        // ── JSON Fallback Path ────────────────────────────────────────────
        const sanitized = _sanitizeNative(data);
        if (sanitized) _onRealData(sanitized);
      } catch (e) {
        logError('OBD:DataHandler', e);
      }
    },
  );

  if (_stale()) { void _removeNativeHandles(); return; }
  _nativeHandles = [statusHandle, dataHandle];

  // 4. Connect — resolves when ELM327 init completes, rejects on failure.
  //    Araç tipine göre PID listesi iletilir — EV'de ICE PID'leri atlanır.
  //    PROTOKOL DÖNGÜSÜ: araç CAN OLMAYABİLİR. Eski Fiat/Doblo, Punto vb. = KWP2000
  //    (ISO 14230) ya da ISO 9141 kullanır — CAN değil. Eskiden 2. denemeden itibaren
  //    HEP CAN ('6') zorlanıyordu → KWP araçta ECU init SONSUZA KADAR başarısız oluyordu
  //    ("Car Scanner bağlanıyor ama biz bağlanmıyoruz, hep aynı döngü"). Artık deneme
  //    sayısına göre ELM327 protokolü döndürülür → CAN, KWP ve ISO9141 araçlar da bağlanır.
  //    Race against a timeout so a non-responsive BT device doesn't hang.
  // W5-OBD-PR1: statik taban → handshake bitmap KANITIYLA rafine edilir.
  // Kanıt yoksa (ilk bağlantı / handshake başarısız) taban aynen kullanılır (fail-soft).
  const pidList = refinePidList(
    getPidListForVehicle(_current.vehicleType),
    _handshakeSupportedPids,
    _handshakeReadBlocks,
  );
  // ELM327 ATSP numaraları: undefined=ATSP0 otomatik · 6=CAN 11/500 · 5=KWP hızlı init ·
  // 4=KWP 5-baud · 3=ISO 9141-2 · 7=CAN 29/500. Otomatik çoğu aracı bulur; bulamazsa sırayla denenir.
  const PROTOCOL_CYCLE: (string | undefined)[] = [undefined, '6', '5', '4', '3', '7'];
  // Patch 3: ÖNCE bu oturumda/önceki oturumda ÖĞRENİLMİŞ protokolü (ElmInitSequencer ATDPN)
  // dene — ATSP0 otomatik arama YOK, ARAMASIZ bağlan. Yalnız gerçek bir UNABLE_TO_CONNECT
  // hatası yaşandıysa (_protocolCycleIndex>0) sırayla bir sonraki adaya geçilir.
  const _learnedProtocol = loadObdProtocol();
  const forcedProtocol = _protocolCycleIndex > 0
    ? PROTOCOL_CYCLE[_protocolCycleIndex % PROTOCOL_CYCLE.length]
    : (_learnedProtocol ?? PROTOCOL_CYCLE[0]);
  const cand = candidate!;

  // Tek transport ile bağlantı denemesi — verilen timeout ile yarışır (askıda kalmasın).
  // Patch 3: dönüş değeri {protocol?} taşır — ElmInitSequencer'ın ATDPN ile okuduğu aktif
  // protokol numarası (öğrenilirse persist edilip sonraki bağlantı aramasız yapılır).
  const _tryConnectTransport = (tp: ObdTransport, timeoutMs: number): Promise<{ protocol?: string } | void> => Promise.race([
    CarLauncher.connectOBD({
      address: cand.address,
      pids: pidList,
      ...(forcedProtocol ? { protocol: forcedProtocol } : {}),
      ...(_lastKnownPin ? { pin: _lastKnownPin } : {}),
      transport: tp,
    }),
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error(`OBD bağlantısı zaman aşımına uğradı (${Math.round(timeoutMs / 1000)}s): ${cand.name}`)),
        timeoutMs,
      )
    ),
  ]);

  /** Patch 3: native reject CODE'una göre sınıflandırır — mesaj string parse'ı YAPMAZ. */
  const _isUnableToConnectError = (e: unknown): boolean =>
    !!e && typeof e === 'object' && (e as { code?: string }).code === 'OBD_UNABLE_TO_CONNECT';

  // TRANSPORT BYPASS (zero-latency): _lastKnownTransport BİLİNİYORSA (önceki başarılı
  // bağlantıdan veya kullanıcı seçiminden) primary onu kullanır; fallback'e yalnızca KISA
  // 3 s verilir — yanlış transport'ta 15 s beklenmez. Transport bilinmiyorsa (ilk kör
  // bağlantı) her iki transport da tam timeout ile denenir (BLE↔classic güvenlik ağı korunur).
  // HİBRİT/OTOMATİK transport seçimi:
  //   • DOĞRULANMIŞ (bu oturumda gerçekten bağlanmış) → o transport primary (tam timeout),
  //     diğerine kısa 3s fallback → zero-latency reconnect.
  //   • DOĞRULANMAMIŞ (oturum başı / modal-tarama tahmini): dual-mod OBD adaptörleri Android'de
  //     'classic' raporlar ama verileri BLE GATT'tan akar → BLE'yi ÖNCE dene (bounded
  //     BLE_FIRST_TIMEOUT_MS); olmazsa classic'e TAM timeout ile geç. Böylece BLE adaptörde 15s
  //     classic timeout'u boşa beklenmez; gerçek classic adaptör de fallback'te bağlanır.
  // Patch 10: TCP (WiFi ELM327) kullanıcı/persist AÇIKÇA seçtiğinde devrededir — hibrit
  // ble↔classic otomatik fallback'ine KATILMAZ. Yanlış IP'de 15s BT taramasına düşmek
  // saçma olurdu; BT tarafı başarısız olunca TCP'ye sıçramak da YOK (TCP yalnız açık
  // seçimle). _fallbackTp === null → tek deneme, başarısızsa doğrudan reconnect zincirine düş.
  const _isTcp = _lastKnownTransport === 'tcp';
  // A-fix: persisted transport ÖNCEKİ oturumda canlı-veri ile doğrulandıysa (verified) ona
  // boot'ta güven → BLE-first turunu ATLA, doğrudan o transport'u primary dene. Doğrulanmamış
  // (tahmin) ise mevcut güvenli BLE-first fallback akışı korunur (dual-mod adaptör bozulmaz).
  const _trustPersisted = !_isTcp && _lastKnownTransport != null && _lastTransportVerified;
  const _directPrimary  = _transportConfirmed || _trustPersisted;
  const _primaryTp:  ObdTransport = _isTcp ? 'tcp' : (_directPrimary ? (_lastKnownTransport ?? 'ble') : 'ble');
  const _fallbackTp: ObdTransport | null = _isTcp ? null : (_primaryTp === 'ble' ? 'classic' : 'ble');
  const _primaryTimeoutMs  = _isTcp ? CONNECT_TIMEOUT_MS : (_directPrimary ? CONNECT_TIMEOUT_MS : BLE_FIRST_TIMEOUT_MS);
  // Oturum-içi doğrulanmış → yanlış yolda 3s hızlı-fallback. Persist-verified (ama bu oturumda
  // henüz bağlanmadı) → fallback'e TAM timeout (adaptör değiştiyse doğru yol açlık çekmesin).
  const _fallbackTimeoutMs = _transportConfirmed ? 3_000 : CONNECT_TIMEOUT_MS;
  let _connectedTp = _primaryTp;
  let _connectResult: { protocol?: string } | void;
  try {
    _connectResult = await _tryConnectTransport(_primaryTp, _primaryTimeoutMs);
  } catch (ePrimary) {
    if (_stale()) { void _removeNativeHandles(); return; }

    if (_fallbackTp === null) {
      // TCP: otomatik fallback YOK — tek deneme başarısız oldu, doğrudan yukarı fırlat
      // (çağıran _scheduleReconnect ile aynı transport'u tekrar dener; BLE/classic'e sıçramaz).
      if (_isUnableToConnectError(ePrimary)) {
        _protocolCycleIndex++;
        if (!_stale()) {
          recordDiag({
            stage: 'protocol', status: 'warn',
            transport: 'tcp',
            protocol: forcedProtocol ?? null,
            userMessage: 'Araç protokolü uyuşmadı, farklı protokol deneniyor…',
            technicalMessage: `UNABLE_TO_CONNECT (tcp) → protokol döngüsü ilerledi (index=${_protocolCycleIndex})`,
          });
        }
      }
      if (!_stale()) {
        const timedOut = ePrimary instanceof Error && ePrimary.message.includes('zaman aşımı');
        emitObdDiag('connect', timedOut ? 'OBD_CONNECT_TIMEOUT' : 'OBD_CONNECT_FAIL', {
          ..._diagCommon(),
          transport: 'tcp',
          protocol:  forcedProtocol ?? 'auto',
          attempts:  _reconnectAttempts,
          elapsedMs: performance.now() - _diagT0,
          reason:    classifyObdErrorReason(ePrimary),
          msg:       'WiFi (TCP) bağlantısı başarısız',
        });
      }
      throw ePrimary;
    }

    console.warn(`[OBD] ${_primaryTp} başarısız → ${_fallbackTp} deneniyor (${_fallbackTimeoutMs / 1000}s)`, ePrimary);
    _merge({ connectionState: 'connecting', deviceName: cand.name });
    try { await CarLauncher.disconnectOBD(); } catch { /* yoksay */ }
    if (_stale()) { void _removeNativeHandles(); return; }
    try {
      _connectResult = await _tryConnectTransport(_fallbackTp, _fallbackTimeoutMs); // bu da olmazsa throw → reconnect
    } catch (eFallback) {
      // Patch 3: PROTOCOL_CYCLE YALNIZ gerçek bir UNABLE_TO_CONNECT hatasında ilerler —
      // BT/soket/timeout kaynaklı hatalar geçerli bir protokol tahminini terk ETTİRMEZ.
      if (_isUnableToConnectError(ePrimary) || _isUnableToConnectError(eFallback)) {
        _protocolCycleIndex++;
        if (!_stale()) {
          recordDiag({
            stage: 'protocol', status: 'warn',
            transport: _fallbackTp === 'ble' ? 'ble' : 'classic',
            protocol: forcedProtocol ?? null,
            userMessage: 'Araç protokolü uyuşmadı, farklı protokol deneniyor…',
            technicalMessage: `UNABLE_TO_CONNECT → protokol döngüsü ilerledi (index=${_protocolCycleIndex})`,
          });
        }
      }
      // Her iki transport da başarısız — tanı eventi (cihaz adı/MAC YOK,
      // msg statik; alt hata mesajı cihaz adı içerdiğinden payload'a girmez)
      if (!_stale()) {
        const timedOut = eFallback instanceof Error && eFallback.message.includes('zaman aşımı');
        // Native soket hatasını PII-güvenli kategoriye sınıflandır (busy/refused/closed/…).
        // Fallback (son denenen transport) hatası daha alakalı; generic ise primary'e düş.
        const _rFb = classifyObdErrorReason(eFallback);
        const _reason = (_rFb !== 'other' && _rFb !== 'unknown') ? _rFb : classifyObdErrorReason(ePrimary);
        emitObdDiag('connect', timedOut ? 'OBD_CONNECT_TIMEOUT' : 'OBD_CONNECT_FAIL', {
          ..._diagCommon(),
          transport: `${_primaryTp}+${_fallbackTp}`,
          protocol:  forcedProtocol ?? 'auto',
          attempts:  _reconnectAttempts,
          elapsedMs: performance.now() - _diagT0,
          reason:    _reason,
          msg:       'Her iki transport ile bağlantı başarısız',
        });
      }
      throw eFallback;
    }
    _connectedTp = _fallbackTp;
  }
  // Çalışan transport'u kalıcılaştır → sonraki direkt-reconnect doğru yolu kullanır.
  // Artık DOĞRULANMIŞ: bu transport gerçekten bağlandı → sonraki sefer 3s hızlı-fallback geçerli.
  _transportConfirmed = true;
  if (_connectedTp !== _lastKnownTransport) {
    _lastKnownTransport = _connectedTp;
    saveObdTransport(_connectedTp);   // yeni transport → storage'da verified SIFIRLANIR
    _lastTransportVerified = false;   // canlı veri (data-gate) gelince tekrar true olur
  }

  // Patch 3: bağlantı BAŞARILI — protokol döngüsü sıfırlanır (bir sonraki oturum
  // yeniden ATSP0'dan değil, öğrenilen/doğrulanmış protokolden başlar). ATDPN ile
  // okunan protokol varsa persist edilir — sonraki bağlantı ARAMASIZ bağlanır.
  _protocolCycleIndex = 0;
  if (_connectResult && typeof _connectResult === 'object' && _connectResult.protocol) {
    saveObdProtocol(_connectResult.protocol);
    recordDiag({
      stage: 'protocol', status: 'success',
      transport: _connectedTp,
      protocol: _connectResult.protocol,
      userMessage: 'Araç protokolü öğrenildi.',
      technicalMessage: `ATDPN → protokol ${_connectResult.protocol} — sonraki bağlantı aramasız`,
    });
  }

  if (_stale()) { void _removeNativeHandles(); return; }

  // 5. MAC'i kaydet. ZERO-LATENCY: bağlantı kurulur kurulmaz veri akışı başlasın —
  //    2 s 'initializing' beklemesi YOK, handshake BEKLENMEZ. (Eski 2 s warm-up kaldırıldı:
  //    ilk geçerli PID gelince _onRealData zaten anında 'connected'e geçirir.)
  _lastKnownAddress = candidate.address;
  saveObdAddress(candidate.address);
  _addressConnectedOnce = true; // RFCOMM/GATT+init başarılı → bu adres bu oturumda doğrulandı
  _merge({ connectionState: 'initializing', source: 'none' });

  // 6. INSTANT DATA LOOP — veri kapısını HEMEN aç (handshake'ten ÖNCE). Native poll
  //    döngüsü bağlantıyla birlikte PID isteklerini göndermeye başlar; ilk geçerli PID
  //    gelince _onRealData 'connected'/'real'e geçirir.
  //    Patch 6: native poll başlarken FAST grup periyodu cihaz sınıfı + aktif moda göre
  //    ayarlanır (varsayılan 3s yerine 250-1000ms; weak head unit modunda moda uyar).
  _applyObdPollProfile();
  // Patch 7: bağlantı kuruldu — sağlık monitörünün bayatlık referansı sıfırlanır
  // (önceki oturumun sessizliği yeni bağlantının kalitesini düşürmesin).
  obdHealthMonitor.noteConnected();
  // Patch 8: extended PID izleyicisi varsa keşif + native liste tazelenir (yoksa no-op).
  notifyExtendedPids();
  _startDataValidationGate(myGen);

  // 7. PIN Resilience — bonding doğrulaması ARKA PLANDA (veri akışını BLOKLAMAZ).
  //    Cihaz Android'de bonded ise PIN'e bir daha gerek yok (bonding kalıcı) → session
  //    PIN temizlenir; sonraki reconnect'te gereksiz/yanlış silent-pair denenmez.
  if (CarLauncher.getObdBondState) {
    void CarLauncher.getObdBondState({ address: candidate.address })
      .then(({ bonded }) => { if (!_stale() && bonded) _lastKnownPin = null; })
      .catch(() => { /* native metod yok / sorgu başarısız → session PIN korunur */ });
  }

  // 8. OBD Handshake — PARALLELIZE: await ETME. VIN/desteklenen-PID tespiti veri akışını
  //    bloklamaz; sonuç gelince profil güncellenir (sonraki poll doğru PID listesini kullanır).
  //    performHandshake() opsiyoneldir (eski plugin'de yok) → guard + .catch ile korunur.
  if (CarLauncher.performHandshake) {
    void CarLauncher.performHandshake()
      .then((raw) => {
        if (_stale()) return;
        const result  = buildHandshakeResult(raw);
        const profile = vehicleProfileRegistry.findBestMatch(result.vin, result.supportedPids);
        _applyDetectedProfile(profile);
        persistHandshakeVin(result.vin ?? null);

        // Capability keşif kanıtını sakla — bir sonraki reconnect'te refinePidList
        // desteklenmeyen PID'i eler, desteklenen 0x2F yakıtı oto-aktive eder.
        _handshakeSupportedPids = result.supportedPids;
        _handshakeReadBlocks    = result.readBlocks;

        // Handshake keşfini extended katmana TOHUMLA — Canlı Test / SensorPanel extended
        // kanaldan YENİDEN bitmask keşfi beklemez (aksi halde _supported=null iken izlenen
        // tüm PID'ler native'e gidip NO-DATA fırtınasıyla keşfi tıkıyordu). Yalnız EKLER,
        // izleyici yoksa no-op. readBlocks boşsa (kanıt yok) seed boş → fail-soft dokunmaz.
        if (result.readBlocks.size > 0) seedExtendedSupported(result.supportedPids);

        // Timeout türü ayrımı (item 5): NO DATA / TIMEOUT / UNSUPPORTED sessizce
        // yutulmaz — VIN + zorunlu 0100 bloğunun sınıfı loglanır (teşhis şeffaflığı).
        const vinClass  = classifyHandshakeResponse(raw.raw09, '49', '02');
        const b00Class  = classifyHandshakeResponse(raw.raw0100, '41', '00');
        console.info('[OBD:Handshake]',
          result.vin ? 'VIN: ' + result.vin : `VIN yok (${vinClass}), PID heuristic`,
          `bitmap[00]=${b00Class} bloklar=${[...result.readBlocks].map((b) => b.toString(16)).join(',') || 'yok'}`,
          `desteklenen=${result.supportedPids.size} PID`,
          '→ profil:', profile.name,
          result.supportedPids.has(0x2F) ? '· yakıt(2F) destekli' : '');
      })
      .catch((err: unknown) => {
        persistHandshakeVin(null);
        // Eski native plugin veya ELM327 yanıt vermedi — mevcut profil korunur
        console.warn('[OBD:Handshake] El sıkışması başarısız, varsayılan profil:', _activeProfile.name, err);
        if (!_stale()) {
          emitObdDiag('handshake', 'OBD_HANDSHAKE_FAIL', {
            ..._diagCommon(),
            transport: _connectedTp,
            protocol:  forcedProtocol ?? 'auto',
            attempts:  _reconnectAttempts,
            elapsedMs: performance.now() - _diagT0,
            reason:    classifyObdErrorReason(err),
            msg:       'ELM327 el sıkışması başarısız (VIN/PID alınamadı)',
          });
        }
      });
  }
}

/* ── Profil uygulama ─────────────────────────────────────────────────────── */

/**
 * Tespit edilen profili aktif olarak ayarlar.
 *  • safeStorage'a yazar (4s debounce — normal yazım yolu)
 *  • vehicleType'ı günceller (bir sonraki reconnect doğru PID listesi kullanır)
 *  • EV profil seçilince ValidationGuard'ı aktif eder
 */
function _applyDetectedProfile(profile: IVehicleProfile): void {
  _activeProfile = profile;
  saveObdProfileId(profile.id);

  // vehicleType state'ini güncelle — bir sonraki reconnect'te _getPidList() bunu kullanır
  _merge({ vehicleType: profile.vehicleType });

  // ValidationGuard: yalnızca kısıtlayıcı EV profili seçilince aktif
  _validationMisses   = 0;
  _validationEnabled  = profile.vehicleType === 'ev';
}

/* ── Public API ──────────────────────────────────────────── */

/**
 * Eşleşmiş Bluetooth cihazlarını tara — SetupWizard için.
 * Sonuç { name, address }[] döner.
 */
export async function scanOBD(): Promise<Array<{ name: string; address: string }>> {
  useExpertStore.getState().assertWritesAllowed();
  if (!Capacitor.isNativePlatform()) return [];
  const { devices } = await CarLauncher.scanOBD();
  return devices;
}

/**
 * Belirli bir BT adresiyle OBD bağlantısı kur — SetupWizard için.
 */
export async function connectOBD(address: string): Promise<void> {
  useExpertStore.getState().assertWritesAllowed();
  await CarLauncher.connectOBD({ address });
}

const MOCK_ENABLED = import.meta.env['VITE_ENABLE_OBD_MOCK'] === 'true';

/**
 * Start OBD.
 * Tries native Bluetooth first; falls back to mock on any failure
 * unless VITE_DISABLE_OBD_MOCK=true is set.
 *
 * @param address — optional MAC address (from OBDConnectModal device selection).
 *   Provided → address is persisted and BT INQUIRY scan is skipped entirely;
 *   direct connectOBD() is attempted immediately (<3 s).
 *   If the service is already running but not yet connected, the in-flight
 *   scan/connect is cancelled and restarted with the given address.
 *   Omitted → uses _lastKnownAddress from localStorage (also skips scan);
 *   only falls back to full scan if no address was ever saved.
 *
 * @param transport — optional 'classic' | 'ble' | 'tcp'. Persisted alongside the address so
 *   direct-reconnect uses the correct transport. Omitted → keeps the current Classic
 *   RFCOMM default (backward compatible).
 *   'tcp' (Patch 10 — WiFi ELM327): address MUST be "ip:port"; does NOT participate in the
 *   automatic ble↔classic fallback — a single failed attempt goes straight to the reconnect
 *   chain (no silent jump to Bluetooth on a bad IP).
 */
export function startOBD(address?: string, pin?: string, transport?: ObdTransport): void {
  // Patch 10: WiFi ELM327 adresi "ip:port" biçiminde olmalı — kullanıcı elle girer,
  // native'e HİÇ gönderilmeden dürüst hata (yanlış format 15s BT taramasına düşmez,
  // TCP zaten fallback'e katılmaz — bu yüzden burada erken elenmezse tek deneme
  // anlamsız bir soket hatasıyla boşa gider).
  if (transport === 'tcp' && address && !isValidTcpAddress(address)) {
    logError('OBD:TcpAddressInvalid', new Error(`Geçersiz WiFi adaptör adresi (ip:port bekleniyor): ${address}`));
    _merge({ connectionState: 'error', source: 'none' });
    return;
  }
  if (address) {
    _lastKnownAddress = address;
    saveObdAddress(address);
    _addressConnectedOnce = false; // yeni adres: henüz doğrulanmadı
  }
  if (pin !== undefined) _lastKnownPin = pin || null; // boş string → null (PIN'siz)
  if (transport) {
    // Modal/tarama seçimi = TAHMİN (DUAL adaptör 'classic' raporlayabilir). Doğrulanmış
    // SAYILMAZ → ilk bağlantıda BLE-öncelikli hibrit akış + fallback'e tam timeout devreye girer.
    // Tahmin PERSIST EDİLMEZ: storage yalnız GERÇEKTEN bağlanmış (confirmed) transport'u tutar
    // (başarılı bağlantıda _startNative kaydeder) → bayat 'classic' tahmini gelecek oturumu kilitlemez.
    _transportConfirmed = false;
    _lastKnownTransport = transport;
  }

  if (_running) {
    // address provided while service is already running but not connected:
    // cancel the in-flight operation (scan / failed connect) and direct-connect.
    if (address && _current.connectionState !== 'connected') {
      try {
        useExpertStore.getState().assertWritesAllowed();
      } catch (e: unknown) {
        logError('OBD:TrustGate', e);
        return;
      }
      if (_reconnectTimer) { clearTimeout(_reconnectTimer); _reconnectTimer = null; }
      _reconnectAttempts = 0;
      _nativeGeneration++; // invalidate any stale _startNative() continuation
      void _removeNativeHandles().then(() => {
        if (!_running) return;
        void _startNative().catch(async (e: unknown) => {
          logError('OBD:DirectConnect', e);
          await _removeNativeHandles();
          _merge({ connectionState: 'error', source: 'none' });
        });
      });
    }
    return;
  }
  try {
    useExpertStore.getState().assertWritesAllowed();
  } catch (e: unknown) {
    logError('OBD:TrustGate', e);
    return;
  }
  _running = true;

  // Tier 2 async hydration — bir kez çalışır, BT bağlantısıyla yarışmaz.
  // Filesystem okuma (~50-150ms) tamamlandığında gerçek veri henüz yoksa patch uygular.
  if (!_asyncHydrated) {
    _asyncHydrated = true;
    hydrateCanSnapshotAsync().then((patch) => {
      if (Object.keys(patch).length === 0) return;
      // CANLI gerçek veri zaten aktıysa snapshot ile EZME. (source kontrolü
      // YETERSİZDİ: sync hydration source='real' yapıyor → canlı veri sinyali
      // _lastRealDataMs ile ayrılır; yalnız gerçek bağlantı bunu set eder.)
      if (_lastRealDataMs > 0) return;
      // Computed yakıt alanları snapshot'ta YOK ve hydration _merge'i bypass eder
      // → tank config varsa burada yeniden hesapla (instruction 3). Config yoksa
      // computeFuelMetrics -1 döner (zararsız); setObdFuelConfig sonradan düzeltir.
      const hydrated: Partial<OBDData> = (patch.fuelLevel !== undefined && patch.fuelLevel >= 0)
        ? { ...patch, ...computeFuelMetrics(patch.fuelLevel, _fuelTankL, _avgConsumL100) }
        : patch;
      _current = { ..._current, ...hydrated };
      _storeListeners.forEach((fn) => fn()); // React hook'larını tetikle
    }).catch(() => { /* Tier 1 localStorage fallback yeterli */ });
  }

  void (async () => {
    try {
      if (Capacitor.isNativePlatform()) {
        try {
          await _startNative();
          return; // success — don't start mock
        } catch (e) {
          // Native failed → dürüst error state, mock YOK.
          // Kullanıcı gerçek cihazda sahte 42 km/h görmemeli.
          logError('OBD:StartNative', e);
          await _removeNativeHandles();
          _merge({ connectionState: 'error', source: 'none', deviceName: '' });
          return; // native platformda hata sonrası mock'a düşme
        }
      }
      // Tarayıcı / geliştirme modu: mock akışı başlat
      if (MOCK_ENABLED) {
        _startMock();
      }
    } catch (e) {
      // Outer guard — startMock itself should never throw but just in case
      logError('OBD:StartOBD', e);
      _merge({ connectionState: 'error', source: 'none' });
    }
  })();
}

/**
 * Stop all OBD activity and reset state.
 */
export function stopOBD(): void {
  // Son gerçek CAN verisini native storage'a atomik olarak flush et
  // (bağlantı kesilmeden önce en güncel değerler korunur).
  if (_current.source === 'real') flushCanSnapshotNow(_current);
  stopCanSnapshot(); // Filesystem throttle timer'ı temizle (bellek sızıntısı önleme)

  _running = false;
  _nativeGeneration++; // invalidate any in-flight _startNative() continuations
  _lastNotifyTime = 0; // debounce sıfırla — sonraki bildirim her zaman geçer
  _prevRpm = null;     // jump-detection sıfırla — reconnect'te stale eşik kalmasın
  if (_reconnectTimer) { clearTimeout(_reconnectTimer); _reconnectTimer = null; }
  _reconnectAttempts = 0;
  _stopStaleWatchdog();
  _clearDataGate();
  // Fix 3: ısınma promise'ini çöz ve bayrağı sıfırla (Zero-Leak)
  if (_warmupResolve) { _warmupResolve(); _warmupResolve = null; }
  _warmupActive = false;
  // Fix 1: ICE RPM miss sayacı sıfırla
  _iceRpmMissStart = null;
  clearAccumulatedBuffer();
  _stopMock();
  _pendingDisconnect = _removeNativeHandles().then(() => {
    if (Capacitor.isNativePlatform()) {
      return CarLauncher.disconnectOBD().catch(() => {});
    }
  }).finally(() => { _pendingDisconnect = null; });
  _merge({ connectionState: 'idle', source: 'none', deviceName: '', lastSeenMs: 0 });
}

/**
 * Push live data directly from the native plugin (alternative to listener pattern).
 */
export function updateOBDData(partial: Partial<NativeOBDData>): void {
  const sanitized = _sanitizeNative(partial);
  if (sanitized) _merge({ ...sanitized, source: 'real', connectionState: 'connected' });
}

/**
 * ValidationGuard GPS hız beslemesi.
 * gpsService'i doğrudan import etmek döngüsel bağımlılık yaratır;
 * index.ts (vehicleDataLayer) bu fonksiyonu GPS güncellemelerinde çağırır.
 *
 * @param speedKmh  GPS Doppler hızı (km/h) — SignalNormalizer.fromGPS() çıktısı
 */
export function updateGpsSpeedForValidation(speedKmh: number): void {
  _lastKnownGpsSpeed = speedKmh;
}

/**
 * Aktif tespit edilen OBD araç profilini döner.
 * OBD panelleri ve ayarlar ekranı tarafından okunabilir.
 */
export function getActiveOBDProfile(): IVehicleProfile {
  return _activeProfile;
}

/* ── External subscription ───────────────────────────────── */

/**
 * Subscribe to every OBD state push from outside React.
 * Returns a cleanup function. Used by obdAlerts.ts.
 */
/**
 * OBD bağlantı durumunun hook-dışı anlık görüntüsü — remoteLogService
 * support_snapshot için. Bilinçli olarak DAR: deviceName/adres gibi
 * tanımlayıcı alanlar dahil DEĞİL (uzak log gizlilik kuralı).
 */
export function getOBDStatusSnapshot(): {
  connectionState: OBDData['connectionState'];
  source:          OBDData['source'];
  vehicleType:     OBDData['vehicleType'];
  lastSeenMs:      number;
} {
  return {
    connectionState: _current.connectionState,
    source:          _current.source,
    vehicleType:     _current.vehicleType,
    lastSeenMs:      _current.lastSeenMs,
  };
}

/**
 * Transport/Bağlantı Sağlığı tanı bölümü — anlık OBD adaptör transport
 * durumunun hook-dışı görünümü. remoteLogService support_snapshot için.
 * Bilinçli olarak DAR: adres/cihaz adı YOK (uzak log gizlilik kuralı).
 */
export function getTransportStats(): {
  transport:             ObdTransport | 'none';
  connected:             boolean;
  reconnectAttempts:     number;
  lastDisconnectReason:  string | null;
} {
  const reason = getLastObdDiagReason();
  return {
    transport:            _lastKnownTransport ?? 'none',
    connected:            _current.connectionState === 'connected',
    reconnectAttempts:    _reconnectAttempts,
    lastDisconnectReason: reason ? reason.errorCode : null,
  };
}

/**
 * Patch 9B: anlık tam OBD verisi (kopya) — sensorQueryService (sesli asistan veri
 * sorguları) senkron okur. React dışı tüketiciler için; UI hook'ları useOBDState kullanır.
 */
export function getOBDDataSnapshot(): OBDData {
  return { ..._current };
}

export function onOBDData(fn: (d: OBDData) => void): () => void {
  _dataListeners.add(fn);
  return () => _dataListeners.delete(fn);
}

/* ── DEV: Fault injection hook ───────────────────────────────────── */

/**
 * OBD verisinin üzerine anlık test değerleri yaz (DEV only).
 * `null` geçmek override'ı kaldırır ve gerçek veriye döner.
 *
 * Production APK'da no-op — import.meta.env.DEV tree-shaking ile elenir.
 */
export function setOBDTestOverride(data: Partial<OBDData> | null): void {
  if (!import.meta.env.DEV) return;
  useExpertStore.getState().assertWritesAllowed();
  _testOBDOverride = data;
  // Override'ı hemen yayınla (debounce'u atla — test anında görünmeli)
  const snap: OBDData = data ? { ..._current, ...data } : { ..._current };
  _dataListeners.forEach((fn) => fn(snap));
  _storeListeners.forEach((fn) => fn());
}

/* ── HMR cleanup — dev modda Hot Reload'da OBD timer/listener sızıntısını önle ── */
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    stopOBD();
    _unsubPerfMode();           // modül-seviyesi performans modu listener'ı temizle
    _unsubRuntime();            // modül-seviyesi runtime listener'ı temizle
    _dataListeners.clear();
    _storeListeners.clear();
  });
}

/* ── React hook ──────────────────────────────────────────── */

export function useOBDState(): OBDData {
  return useSyncExternalStore(
    (onStoreChange) => {
      _storeListeners.add(onStoreChange);
      return () => { _storeListeners.delete(onStoreChange); };
    },
    () => _current,
    () => INITIAL,
  );
}

/* ── Narrow selector hooks ───────────────────────────────────
 * Each hook only triggers a re-render when its specific field
 * changes. Use these instead of useOBDState() in components
 * that need only one or two OBD values (e.g. speedometer).
 * ─────────────────────────────────────────────────────────── */

function useOBDField<K extends keyof OBDData>(field: K): OBDData[K] {
  return useSyncExternalStore(
    (onStoreChange) => {
      _storeListeners.add(onStoreChange);
      return () => { _storeListeners.delete(onStoreChange); };
    },
    () => _current[field],
    () => INITIAL[field],
  );
}

/**
 * OBD hız hook'u — RAF linear interpolation ile 60 fps akıcılığı.
 * SADECE gösterge iğnesi (SVG arc, needle) için kullan.
 * Sayısal ekran için useOBDSpeedRaw() kullan — animasyon gecikme yaratır.
 *
 * lerpFactor=0.15: OBD 3 Hz poll rate'te bile gösterge iğnesi gibi kayar.
 */
export function useOBDSpeed(): number {
  const raw = useOBDField('speed');
  return useRafSmoothed(raw, 0.15);
}

/**
 * OBD anlık hız — animasyonsuz, gecikmesiz.
 * Sayısal hız ekranı bu hook'u kullanmalı.
 */
export function useOBDSpeedRaw(): number {
  return useOBDField('speed');
}

/** Only re-renders on connection state changes. */
export function useOBDConnectionState(): OBDConnectionState { return useOBDField('connectionState'); }

/**
 * RPM hook'u — RAF linear interpolation (α=0.20 — motor ibresi hızlı tepki).
 *
 * lerpFactor=0.20: RPM ani değişir (gaz kesmede hızlı düşüş, basımda hızlı yükseliş).
 * 0.15'ten daha agresif → gösterge "canlı" hissi verir, sürüklenme olmaz.
 */
export function useOBDRPM(): number {
  const raw = useOBDField('rpm');
  return useRafSmoothed(raw, 0.20);
}

/** Only re-renders when engine temp changes. */
export function useOBDEngineTemp(): number     { return useOBDField('engineTemp'); }
/** Only re-renders when fuel level changes. */
export function useOBDFuelLevel(): number      { return useOBDField('fuelLevel'); }
/** Only re-renders when headlight state toggles. */
export function useOBDHeadlights(): boolean    { return useOBDField('headlights'); }
/** Only re-renders when data source changes (real/mock/none). */
export function useOBDSource(): OBDData['source'] { return useOBDField('source'); }
/** Only re-renders when vehicle type changes (ice/diesel/ev/hybrid/phev). */
export function useOBDVehicleType(): VehicleType  { return useOBDField('vehicleType'); }
/** Only re-renders when battery SoC changes (EV/Hybrid). -1 = ICE only. */
export function useOBDBatteryLevel(): number      { return useOBDField('batteryLevel'); }
/** Only re-renders when battery temperature changes (EV/Hybrid). -1 = ICE only. */
export function useOBDBatteryTemp(): number       { return useOBDField('batteryTemp'); }
/** Only re-renders when estimated range changes. -1 = ICE only. */
export function useOBDRange(): number             { return useOBDField('range'); }
/** Only re-renders when motor power output changes (EV/Hybrid). -1 = not supported. */
export function useOBDMotorPower(): number        { return useOBDField('motorPower'); }
