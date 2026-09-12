/**
 * telemetryService — Akıllı Telemetri Push Hattı
 *
 * OBD/GPS verilerini VehicleSignalResolver'dan alır; Supabase'e 3 katmanlı
 * throttling stratejisiyle fire-and-forget olarak iletir.
 *
 * ── Throttle Katmanları ──────────────────────────────────────────────
 *  1. Heartbeat      Her 10s tam durum paketi — veri değişmese bile (keep-alive)
 *  2. Event-Driven   Geri vites değişimi → gecikme sıfır, anında push
 *  3. Delta-Based    Hız Δ >10 km/h veya konum Δ >50m → throttle bypass
 *
 * ── Güvenlik & Bellek ───────────────────────────────────────────────
 *  - stop() heartbeat interval + resolver listener'ını tamamen temizler.
 *  - Network hataları pushVehicleEvent içinde sessizce yutulur; UI bloklanmaz.
 *  - Monotonic zaman damgası (performance.now Δ) — saat atlama koruması.
 *  - Tüm state private; _lastSent snapshotu push öncesi alınır (race-free).
 *  - start() idempotent koruyucuya sahip — çift başlatma güvenlidir.
 */

import type { VehicleState }         from './vehicleDataLayer/types';
import type { VehicleSignalResolver } from './vehicleDataLayer/VehicleSignalResolver';
import { pushVehicleEvent, callVehicleRpc } from './vehicleIdentityService';
import {
  buildIdentityReport, parseIdentityAck,
  type IdentityRpcBody, type IdentityAck,
} from './telemetry/vehicleIdentityReport';
import type { VehicleIdentityObservation } from './telemetry/vehicleIdentityObservation';
import { getFusedSpeed }              from './speedFusion';
import { healthMonitor }              from './system/SystemHealthMonitor';
import { getOBDDataSnapshot, getObdFreshWindowMs } from './obdService';
import {
  buildTelemetryFields,
  type TelemetryBuildReport,
  type TelemetryFields,
} from './telemetry/telemetryContract';

/* ── Sabitler ───────────────────────────────────────────────── */

/** Adaptive Heartbeat aralıkları (ms) — araç durumuna göre seçilir */
const HEARTBEAT_DRIVING_MS    =     5_000; //  5 saniye  — aktif sürüş
const HEARTBEAT_PARKED_MS     =   600_000; // 10 dakika  — park/rölanti
const HEARTBEAT_DEEP_SLEEP_MS = 3_600_000; //  1 saat    — derin uyku (akü kritik)

/** Derin uyku voltaj eşiği — bu değerin altında telemetri kısıtlanır (V) */
const DEEP_SLEEP_VOLTAGE_V = 11.8;
/** Sürüş tespiti için minimum hız eşiği (km/h) — hysteresis önleme */
const DRIVING_THRESHOLD_KMH = 2;

/** Anlık push için minimum hız değişimi (km/h) */
const SPEED_DELTA_KMH = 10;
/** OBD timeout sonrası ani spike'ı yumuşatma penceresi (ms) */
const OBD_SMOOTHING_MS = 500;
/** Anlık push için minimum konum değişimi (metre) */
const POS_DELTA_M     = 50;

/* ── Tipler ─────────────────────────────────────────────────── */

type TelemetryEventType =
  | 'heartbeat'
  | 'reverse'
  | 'speed_delta'
  | 'location_delta'
  | 'geofence_alert'
  | 'valet_alert'
  | 'system_health';

/** Sistem sağlık anlık görüntüsü push aralığı (ms) — 10 dakika (filo veri maliyeti optimizasyonu) */
const HEALTH_PUSH_INTERVAL_MS = 10 * 60_000;

/** Araç durumuna göre belirlenen telemetri gönderim modu */
type HeartbeatMode = 'driving' | 'parked' | 'deep_sleep';

function _heartbeatIntervalMs(mode: HeartbeatMode): number {
  if (mode === 'driving')    return HEARTBEAT_DRIVING_MS;
  if (mode === 'deep_sleep') return HEARTBEAT_DEEP_SLEEP_MS;
  return HEARTBEAT_PARKED_MS;
}

/**
 * Buluta giden gövde.
 *
 * ÖLÇÜM ALANLARI ARTIK `telemetryContract` tarafından üretilir
 * (`TelemetryFields`): bilinmeyen alan anahtarı HİÇ konmaz — `null`/`0`
 * yazılmaz. Böylece `push_vehicle_event` `NULLIF(...)` ile `NULL` görür ve
 * sunucudaki eski değer KORUNUR.
 */
type TelemetryPayload = TelemetryFields & {
  /** Monotonic Δms — saat atlama (clock-jump) güvenli */
  ts:        number;
  event:     TelemetryEventType;
  metadata?: Record<string, unknown>;
};

/**
 * Konum bayatlık penceresi (ms).
 *
 * Gerekçe: `parked` heartbeat 10 dk'dır; konum bundan daha eski ise "canlı"
 * sayılamaz. 5 dk, park halinde iki heartbeat arası tek bir taze düzeltmenin
 * yeterli olduğu, ama saatler önceki bir fix'in canlı gibi gönderilmediği
 * dengedir. Sunucu tarafı ayrıca kendi tazelik değerlendirmesini yapar.
 */
const GPS_FRESH_WINDOW_MS = 5 * 60_000;

/* ── Yardımcı: Haversine mesafesi (metre) ───────────────────── */

function haversineM(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R     = 6_371_000; // Dünya yarıçapı, metre
  const toRad = (d: number) => d * (Math.PI / 180);
  const dLat  = toRad(b.lat - a.lat);
  const dLng  = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(Math.min(1, h))); // clamp: floating-point güvenliği
}

/* ── TelemetryService ───────────────────────────────────────── */

export class TelemetryService {
  /** Resolver'dan gelen her patch ile güncellenen canlı durum */
  private _state: VehicleState = {
    speed: 0, reverse: false, fuel: null, heading: null, location: null,
  };

  /**
   * Son buluta gönderilen durumun dondurulmuş kopyası.
   * Delta hesaplamasında referans nokta — push öncesi atanır (race-free).
   */
  private _lastSent: VehicleState = { ...this._state };

  /** performance.now() başlangıç noktası — monotonic Δ için */
  private _origin = 0;

  /** OBD smoothing: ani spike'ları yumuşatmak için son sıfır-öncesi hız */
  private _lastNonZeroSpeed = 0;
  /** OBD smoothing: hız 0'a düştüğünde başlayan pencere (Date.now, ms) */
  private _zeroStartTs = 0;

  private _heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private _healthTimer:   ReturnType<typeof setInterval> | null = null;
  private _unsub: (() => void) | null = null;
  private _running = false;

  /** OBD'den beslenen akü voltajı (V); null = OBD bağlı değil veya henüz raporlanmadı */
  private _batteryVoltage: number | null = null;
  /** Son konum patch'inin alındığı an (Unix ms) — GPS bayatlık kapısı girdisi. */
  private _lastLocationAtMs = 0;
  /** Son kurulan payload raporu (LAB salt-okur). */
  private _lastBuild: TelemetryBuildReport | null = null;
  /* Dedupe artık `vehicleIdentityCoordinator`'ın işidir (tek otorite). */
  private _lastIdentity: {
    body: IdentityRpcBody;
    maskedVin: string;
    ack: IdentityAck | null;
  } | null = null;
  /** Anlık heartbeat modu — mod değişince interval yeniden kurulur */
  private _heartbeatMode: HeartbeatMode = 'parked';

  /* ── Yaşam Döngüsü ────────────────────────────────────────── */

  /**
   * Servisi başlat.
   * resolver.onResolved() abone olur + 10s heartbeat kurar.
   * İdempotent: ikinci çağrı etki yaratmaz.
   */
  start(resolver: VehicleSignalResolver): void {
    if (this._running) return;
    this._running = true;
    this._origin  = performance.now();

    // Resolver patch akışına abone ol
    this._unsub = resolver.onResolved((patch) => this._onPatch(patch));

    // Adaptive Heartbeat: başlangıç moduna göre interval kurulur
    this._scheduleHeartbeat();

    // Açılışta ANINDA bir heartbeat — park halindeki araç 10 dk (parked interval)
    // beklemeden hemen online görünsün. Web online'ı telemetri/konum tazeliğinden
    // türetir; bu ilk push backend'e "şu an buradayım" der. (api_key yoksa _push
    // sessizce no-op — güvenli.)
    this._push('heartbeat', { startup: true });

    // 10 dakikada bir sistem sağlık anlık görüntüsü push'la
    this._healthTimer = setInterval(() => {
      void this._pushHealthSnapshot();
    }, HEALTH_PUSH_INTERVAL_MS);
  }

  /**
   * Servisi durdur ve tüm kaynakları serbest bırak.
   * Bellek sızıntısı: sıfır — interval + listener tamamen temizlenir.
   * resolver.stop() öncesinde çağrılması önerilir.
   */
  stop(): void {
    if (!this._running) return;
    this._running = false;

    if (this._heartbeatTimer !== null) {
      clearInterval(this._heartbeatTimer);
      this._heartbeatTimer = null;
    }
    if (this._healthTimer !== null) {
      clearInterval(this._healthTimer);
      this._healthTimer = null;
    }
    if (this._unsub !== null) {
      this._unsub();
      this._unsub = null;
    }
  }

  /* ── Adaptive Heartbeat ───────────────────────────────────── */

  /** Anlık voltaj ve hıza göre heartbeat modunu belirler. */
  private _getHeartbeatMode(): HeartbeatMode {
    if (this._batteryVoltage !== null && this._batteryVoltage < DEEP_SLEEP_VOLTAGE_V) {
      return 'deep_sleep';
    }
    return (this._state.speed ?? 0) >= DRIVING_THRESHOLD_KMH ? 'driving' : 'parked';
  }

  /**
   * Heartbeat interval'ını mevcut moda göre yeniden kurar.
   * Mod değişiminde:
   *   1. Eski interval iptal edilir
   *   2. Anında bir heartbeat push'u gönderilir (geçiş anını kaybet)
   *   3. Yeni interval başlatılır
   */
  private _scheduleHeartbeat(): void {
    if (this._heartbeatTimer !== null) {
      clearInterval(this._heartbeatTimer);
      this._heartbeatTimer = null;
    }
    if (!this._running) return;

    const mode      = this._getHeartbeatMode();
    const changed   = mode !== this._heartbeatMode;
    this._heartbeatMode = mode;

    if (changed) {
      // Mod geçişini anında bildir — interval bekleme süresini atla
      this._push('heartbeat', { mode, transition: true });
    }

    const intervalMs = _heartbeatIntervalMs(mode);
    this._heartbeatTimer = setInterval(() => {
      const current = this._getHeartbeatMode();
      if (current !== this._heartbeatMode) {
        // Mod değişti (ör. araç hareket etmeye başladı) — yeniden kur
        this._scheduleHeartbeat();
        return;
      }
      this._push('heartbeat');
    }, intervalMs);
  }

  /**
   * Akü voltajını güncelle — OBD servisi her voltaj ölçümünde çağırır.
   * 11.8V eşik geçişinde heartbeat modu otomatik olarak yeniden hesaplanır.
   */
  setVoltage(voltage: number): void {
    if (!Number.isFinite(voltage) || voltage <= 0) return;
    this._batteryVoltage = voltage;
    // Eşik geçişini kontrol et — sadece mod değişiminde interval yeniden kurulur
    const newMode = this._getHeartbeatMode();
    if (newMode !== this._heartbeatMode && this._running) {
      this._scheduleHeartbeat();
    }
  }

  /* ── İç Patch İşleyici ────────────────────────────────────── */

  private _onPatch(patch: Partial<VehicleState>): void {
    // Canlı state'i birleştir (spread zinciri yerine tek tek atama — daha az GC)
    if ('speed' in patch) {
      const raw = patch.speed ?? 0;
      const safe = Number.isFinite(raw) ? raw : 0; // NaN / Infinity koruma
      // OBD timeout smoothing: ani 0-spike'ı OBD_SMOOTHING_MS içinde lineer interpolasyonla
      if (safe === 0 && this._lastNonZeroSpeed > 5) {
        if (this._zeroStartTs === 0) this._zeroStartTs = Date.now();
        const elapsed = Date.now() - this._zeroStartTs;
        this._state.speed = elapsed < OBD_SMOOTHING_MS
          ? Math.round(this._lastNonZeroSpeed * (1 - elapsed / OBD_SMOOTHING_MS))
          : 0;
      } else {
        this._zeroStartTs = 0;
        if (safe > 0) this._lastNonZeroSpeed = safe;
        this._state.speed = safe;
      }
    }
    if ('reverse'  in patch) this._state.reverse  = patch.reverse  ?? false;
    if ('fuel'     in patch) {
      const v = patch.fuel;
      this._state.fuel = (v != null && Number.isFinite(v)) ? v : null; // NaN / Infinity koruma
    }
    if ('heading'  in patch) {
      const v = patch.heading;
      this._state.heading = (v != null && Number.isFinite(v)) ? v : null; // NaN / Infinity koruma
    }
    if ('location' in patch) {
      this._state.location = patch.location ?? null;
      // Konum tazeliği için gözlem anı — bayat fix'i canlı gibi göndermeyi engeller.
      this._lastLocationAtMs = this._state.location ? Date.now() : 0;
    }

    // ── Heartbeat mod kontrolü: hız sürüş/park eşiğini geçtiyse yeniden kur ─
    if ('speed' in patch && this._running) {
      const newMode = this._getHeartbeatMode();
      if (newMode !== this._heartbeatMode) this._scheduleHeartbeat();
    }

    /* 1 ── REVERSE: event-driven — değişim milisaniyesinde push */
    if ('reverse' in patch && patch.reverse !== this._lastSent.reverse) {
      this._push('reverse');
      return; // diğer kontrolleri atla
    }

    /* 2 ── HIZ DELTA: >10 km/h sıçrama → throttle bypass */
    if ('speed' in patch && patch.speed != null) {
      if (Math.abs(patch.speed - (this._lastSent.speed ?? 0)) > SPEED_DELTA_KMH) {
        this._push('speed_delta');
        return;
      }
    }

    /* 3 ── KONUM DELTA: >50m yer değişimi → throttle bypass */
    if (
      'location' in patch &&
      patch.location != null &&
      this._lastSent.location != null
    ) {
      if (haversineM(this._lastSent.location, patch.location) > POS_DELTA_M) {
        this._push('location_delta');
      }
    }
  }

  /* ── Push ─────────────────────────────────────────────────── */

  private _push(event: TelemetryEventType, metadata?: Record<string, unknown>): void {
    // _lastSent önce snapshot'la — async push öncesi race koruması
    this._lastSent = {
      speed:    this._state.speed,
      reverse:  this._state.reverse,
      fuel:     this._state.fuel,
      heading:  this._state.heading,
      location: this._state.location,
    };

    /* ── SÖZLEŞME KURUCUSU ──────────────────────────────────────────────
     * ONARILAN KUSUR: burada elle kurulan payload `rpm` ve `temp` TAŞIMIYORDU;
     * `push_vehicle_event` RPC ise ikisini de okuyor → `vehicle_telemetry.rpm`
     * ve `.temp` HİÇ güncellenmiyor, veritabanında kalıcı `0` kalıyordu.
     * Ayrıca `speed: this._state.speed ?? 0` BİLİNMEYEN hızı `0` yapıyordu.
     * Artık alanlar `telemetryContract` tarafından KANIT'a göre kurulur:
     * bilinmeyen alan payload'a HİÇ girmez, bayat kaynak atlanır. */
    const nowMs = Date.now();
    const obdSnap = this._readObdSnapshot();
    const fused   = getFusedSpeed();

    const report: TelemetryBuildReport = buildTelemetryFields({
      nowMs,
      obd: obdSnap,
      gps: this._state.location
        ? {
            latitude:  this._state.location.lat,
            longitude: this._state.location.lng,
            headingDeg: this._state.heading ?? undefined,
            accuracyM:  this._state.location.accuracy ?? undefined,
            // Konum damgası resolver patch'inden gelir; yoksa şimdi kabul edilir
            // (patch az önce işlendi) — bayatlık penceresi aşağıdaki sabittir.
            lastFixMs: this._lastLocationAtMs > 0 ? this._lastLocationAtMs : nowMs,
            freshWindowMs: GPS_FRESH_WINDOW_MS,
          }
        : null,
      // OBD hızı yoksa füzyonlanmış hız yedeğe geçer (kaynak GPS olarak damgalanır).
      fusedSpeedKmh: this._state.speed ?? undefined,
      speedConfidence: fused.confidence,
      reverse: this._state.reverse,
    });

    this._lastBuild = report;

    const payload: TelemetryPayload = {
      ...report.fields,
      // Monotonic Δ — Date.now() yerine performance.now() ile saat atlaması engeli
      ts:    Math.round(performance.now() - this._origin),
      event,
      metadata,
    };

    // Fire-and-forget: pushVehicleEvent tüm network hatalarını sessizce yutar
    pushVehicleEvent(event, payload as unknown as Record<string, unknown>);
  }

  /**
   * OBD anlık görüntüsünü sözleşme girdisine çevirir.
   * FAIL-SOFT: OBD servisi okunamazsa `null` → OBD alanları hiç eklenmez
   * (sahte `0` üretmek yerine "bilinmiyor" doğrudur).
   */
  private _readObdSnapshot() {
    try {
      const s = getOBDDataSnapshot();
      return {
        connected:     s.transportConnected === true && s.source === 'real',
        fresh:         s.dataFresh === true,
        lastSeenMs:    typeof s.lastSeenMs === 'number' ? s.lastSeenMs : 0,
        freshWindowMs: getObdFreshWindowMs(),
        rpm:           s.rpm,
        engineTempC:   s.engineTemp,
        speedKmh:      s.speed,
        fuelPercent:   s.fuelLevel,
      };
    } catch {
      return null;
    }
  }

  /** Son kurulan payload raporu — CAROS LAB salt-okur (gözlemlenebilirlik). */
  getLastBuildReport(): TelemetryBuildReport | null {
    return this._lastBuild;
  }

  /**
   * ARAÇ KİMLİĞİNİN **TEK AĞ UCU** (`record_vehicle_identity`).
   *
   * ⚠️ Bu metot DOĞRUDAN ÇAĞRILMAZ. Tek meşru çağıran
   * `vehicleIdentityCoordinator`'dır; kimlik doğrulama (kanıt kapısı),
   * dedupe, retry ve çakışma yorumu ORADA yapılır. Buraya ikinci bir
   * çağıran eklemek "ikinci kimlik otoritesi" demektir ve kilit testiyle
   * engellenir.
   *
   * Hot-path'e GİRMEZ: kimlik nadiren değişir. Güven puanı ve revizyon
   * SUNUCUDA üretilir — istemci kendi güvenini yükseltemez.
   *
   * Fail-soft: `null` döner; telemetri akışı ETKİLENMEZ (kimlik, ölçüm
   * göndermenin ön koşulu DEĞİLDİR).
   */
  async publishIdentityObservation(
    obs: VehicleIdentityObservation,
  ): Promise<IdentityAck | null> {
    try {
      const report = buildIdentityReport({
        vin: obs.vin,
        vinSource: obs.vinSource,
        make: obs.make,
        model: obs.model,
        modelYear: obs.modelYear,
        fingerprintHash: obs.fingerprintHash,
        fingerprintVersion: obs.fingerprintVersion,
        activeObdProtocol: obs.activeProtocol,
      });
      /* Kanıtsız gövde gönderilmez (koordinatör de ayrıca kapatır —
         savunma katmanlı). */
      if (!report.sendable) return null;

      /* Araç nesli TÜREVDİR; gövdeye ayrı alan olarak eklenir çünkü
         sunucu onu saklar ama ÜRETMEZ. */
      const body: Record<string, unknown> = { ...report.body };
      if (obs.vehicleGeneration !== null) {
        body.p_vehicle_generation = obs.vehicleGeneration;
      }

      const raw = await callVehicleRpc('record_vehicle_identity', body);
      /* `null` = ağ/HTTP hatası → koordinatör retry'a düşer. Sunucunun
         verdiği hüküm ile ağ hatası KARIŞTIRILMAZ. */
      if (raw === null) return null;

      const ack = parseIdentityAck(raw);
      this._lastIdentity = { body: report.body, maskedVin: report.maskedVin, ack };
      return ack;
    } catch {
      /* Fail-soft — kimlik bildirimi ölçüm akışını ASLA durdurmaz. */
      return null;
    }
  }

  /**
   * Son kimlik gönderiminin anlık görüntüsü — CAROS LAB salt-okur.
   * TAM VIN İÇERMEZ (`maskedVin`); `api_key` hiç taşınmaz.
   */
  getLastIdentityReport(): {
    body: IdentityRpcBody;
    maskedVin: string;
    ack: IdentityAck | null;
  } | null {
    return this._lastIdentity;
  }

  /**
   * Throttle bypass: güvenlik olaylarını (geofence / valet) anında push eder.
   * Normal delta/heartbeat mekanizmasını atlar — ihlal verisi gecikme toleranssız.
   */
  pushAlert(
    event: 'geofence_alert' | 'valet_alert',
    metadata: Record<string, unknown>,
  ): void {
    this._push(event, metadata);
  }

  /**
   * Sistem sağlık anlık görüntüsünü hemen push eder.
   * Post-panic recovery veya acil durum tetiklemesi için — 5dk interval beklemez.
   */
  pushSystemHealthNow(): void {
    void this._pushHealthSnapshot();
  }

  private async _pushHealthSnapshot(): Promise<void> {
    const snapshot = healthMonitor.getGlobalHealthSnapshot();
    await pushVehicleEvent('system_health', snapshot as unknown as Record<string, unknown>);
  }
}

/** Modül singleton — geofenceService ve dış servisler doğrudan kullanabilir. */
export const telemetryService = new TelemetryService();
