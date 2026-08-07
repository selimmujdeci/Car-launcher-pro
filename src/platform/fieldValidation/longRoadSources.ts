/**
 * longRoadSources.ts — SAHA DOĞRULAMA GÖZLEMİNİN TEK OKUMA KATMANI.
 *
 * ── PAZARLIKSIZ SINIRLAR (görev §0 — "yalnız pasif gözlem") ─────────────────
 *  · YALNIZ SENKRON + YAN ETKİSİZ getter çağrılır (tek istisna aşağıda).
 *  · Hiçbir servis BAŞLATILMAZ/DURDURULMAZ · hiçbir abonelik açılmaz ·
 *    hiçbir bağlantı/reconnect/reset/komut/ağ çağrısı TETİKLENMEZ ·
 *    polling sırası veya süresi DEĞİŞTİRİLMEZ · timer KURULMAZ.
 *  · Her okuma `try/catch` içindedir; kaynak patlarsa `null` → ilgili alan
 *    UNAVAILABLE olur. SAHTE 0 / SAHTE "sağlıklı" ÜRETİLMEZ.
 *  · Yeni global store / singleton / paralel session engine KURULMAZ; mevcut
 *    CAROS LAB okuma katmanları (`sessionInspectorSources`,
 *    `fleetConnectivitySources`, `locationEngineRuntime`) YENİDEN KULLANILIR.
 *
 * ── TEK ASYNC İSTİSNA ───────────────────────────────────────────────────────
 * `readAsyncAugment()` çevrimdışı kuyruk BOYUNU ve cihaz pil düzeyini okur.
 * Bunlar yalnız ASYNC API ile okunabilir. Bu fonksiyon TICK'TE ÇAĞRILMAZ —
 * yalnız snapshot anında (oturum başına birkaç düzine kez) çağrılır ve hiçbir
 * kuyruk boşaltma/retry tetiklemez (`queueSize()` salt sayım yapar).
 *
 * ── GİZLİLİK ────────────────────────────────────────────────────────────────
 * Bu katman ASLA taşımaz: koordinat · TAM VIN · API anahtarı · JWT · telefon ·
 * e-posta · ham komut/transkript. Taşıdığı: VAR/YOK · ADET · DURUM ADI · SÜRE.
 */

import { readSessionRawSnapshot } from '../devtools/sessionInspectorSources';
import { readPairingAuthority, readTelemetryPushObservation } from '../devtools/fleetConnectivitySources';
import { getOBDDataSnapshot } from '../obdService';
import { readLocationEngineSnapshot } from '../location/locationEngineRuntime';
import { getGPSState } from '../gpsService';
import { getTripSnapshot } from '../tripLogService';
import { healthMonitor } from '../system/SystemHealthMonitor';
import { runtimeManager } from '../../core/runtime/AdaptiveRuntimeManager';
import { isAiGatewayEnabled } from '../ai/gateway/aiGatewayFlag';
import { connectivityService } from '../connectivityService';
import { safeGetRaw, safeRemoveRaw, safeSetRaw } from '../../utils/safeStorage';
import {
  LR_MAX_TOTAL_BYTES, emptyEnv, maskVehicleRef,
  type PreflightRow, type SessionEnv,
} from './longRoadModel';
import { measureUsedBytes } from './longRoadStore';
import type { LongRoadSample } from './longRoadDetect';

/* ── Fail-soft okuma kapısı ──────────────────────────────────────────────── */

function _safe<T>(read: () => T): T | null {
  try {
    const v = read();
    return v === undefined ? null : v;
  } catch {
    return null;
  }
}

/** `-1` sentinel'i (desteklenmiyor) `null`a çevirir — sahte 0 ÜRETİLMEZ. */
function _sig(v: number | undefined): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v !== -1 ? v : null;
}

function _numOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/* ══════════════════════════════════════════════════════════════════════════
 * 1 · Kaydedicinin sahip olduğu değerler
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * Kaydedicinin KENDİ sahip olduğu (abonelikle veya async okumayla elde ettiği)
 * değerler. Bu katman abonelik AÇMAZ — değerler dışarıdan enjekte edilir ki
 * okuma katmanı yan etkisiz kalsın.
 */
export interface SampleInjection {
  readonly memoryPressure: string | null;
  readonly appVisible: boolean | null;
  readonly offlineQueueSize: number | null;
  readonly batteryPercent: number | null;
  readonly charging: boolean | null;
}

export function emptyInjection(): SampleInjection {
  return {
    memoryPressure: null,
    appVisible: null,
    offlineQueueSize: null,
    batteryPercent: null,
    charging: null,
  };
}

/* ══════════════════════════════════════════════════════════════════════════
 * 2 · Örnek okuma (tick başına TEK çağrı)
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * Tüm kanalların TEK seferlik senkron okuması.
 *
 * `wallMs` ve `monoMs` ÇAĞIRANDAN gelir — bu dosya saat OKUMAZ (test edilebilirlik).
 */
export function readLongRoadSample(
  wallMs: number,
  monoMs: number,
  inj: SampleInjection,
): LongRoadSample {
  const sess = _safe(() => readSessionRawSnapshot());
  const data = _safe(() => getOBDDataSnapshot());
  const loc  = _safe(() => readLocationEngineSnapshot());
  const trip = _safe(() => getTripSnapshot());
  const tel  = _safe(() => readTelemetryPushObservation(wallMs));
  const mode = _safe(() => runtimeManager.getMode());
  const health = _safe(() => healthMonitor.getGlobalHealthSnapshot());

  const status = sess ? sess.obdStatus : null;
  const odata  = sess ? sess.obdData : null;
  const life   = sess ? sess.connLifecycle : null;
  const trans  = sess ? sess.transportStats : null;
  const hs     = sess ? sess.handshake : null;
  const kwp    = sess ? sess.kwp : null;
  const hal    = sess ? sess.hal : null;
  const hlth   = sess ? sess.health : null;

  const locSample = loc ? loc.sample : null;

  /* Template object literal — TÜM anahtarlar arayüzle AYNI sırada (V8 hidden-class). */
  return {
    wallMs,
    monoMs,

    obdTransportConnected: odata ? odata.transportConnected : null,
    obdDataFresh:          odata ? odata.dataFresh : null,
    obdConnectionState:    status ? status.connectionState : null,
    obdSource:             status ? status.source : null,
    obdLastPacketAgeMs:    hlth ? _numOrNull(hlth.lastPacketAgeMs) : null,
    handshakeOutcome:      hs ? hs.outcome : null,
    protocolActive:        hs ? hs.protocolActive : null,
    protocolTried:         hs ? hs.protocolTried : null,
    vinPresent:            hs ? hs.vinPresent : null,
    supportedPidCount:     hs ? _numOrNull(hs.supportedCount) : null,
    reconnectRequested:    life ? _numOrNull(life.reconnectRequestedCount) : null,
    resetRequested:        life ? _numOrNull(life.resetRequestedCount) : null,
    disconnectCalled:      life ? _numOrNull(life.disconnectCalledCount) : null,
    transportReconnectAttempts: trans ? _numOrNull(trans.reconnectAttempts) : null,
    kwpStatus:             kwp ? kwp.status : null,
    kwpRecoveryCount:      kwp ? _numOrNull(kwp.recoveryCount) : null,
    kwpSuppressedCount:    kwp ? _numOrNull(kwp.suppressedCount) : null,
    kwpAtpcFailures:       kwp ? _numOrNull(kwp.atpcSendFailures) : null,
    canRetryCount:         hal ? _numOrNull(hal.canRetryCount) : null,
    halActiveSource:       hal ? hal.activeSource : null,

    speed:          data ? _sig(data.speed) : null,
    rpm:            data ? _sig(data.rpm) : null,
    engineTemp:     data ? _sig(data.engineTemp) : null,
    throttle:       data ? _sig(data.throttle) : null,
    intakeTemp:     data ? _sig(data.intakeTemp) : null,
    fuelLevel:      data ? _sig(data.fuelLevel) : null,
    batteryVoltage: data ? _sig(data.batteryVoltage) : null,

    locationState:     loc ? loc.state : null,
    locationProvider:  loc ? loc.activeProvider : null,
    locationAccuracyM: locSample ? locSample.accuracyM : null,
    locationFixAgeMs:  locSample ? Math.max(0, wallMs - locSample.timestampMs) : null,
    gpsSwitchCount:    loc ? _numOrNull(loc.switchCount) : null,
    gpsFallbackCount:  loc ? _numOrNull(loc.fallbackCount) : null,

    tripActive:          trip ? trip.active : null,
    tripTotalDistanceKm: trip
      ? _numOrNull(trip.totalDistanceKm + (trip.current ? trip.current.liveDistanceKm : 0))
      : null,
    tripTotalCount:      trip ? _numOrNull(trip.totalTrips) : null,

    online: _safe(() => navigator.onLine),
    telemetryReportPresent: tel !== null,
    offlineQueueSize: inj.offlineQueueSize,

    runtimeMode:     mode ?? null,
    thermalLevel:    health ? _numOrNull(health.thermalLevel) : null,
    ramPressureRatio: health ? _numOrNull(health.ramPressureRatio) : null,
    uiFreezeCount:   health ? _numOrNull(health.uiFreezeCount) : null,
    workerRestartTotal: health ? _numOrNull(health.workerRestartTotal) : null,
    memoryPressure:  inj.memoryPressure,
    appVisible:      inj.appVisible,
    batteryPercent:  inj.batteryPercent,
    charging:        inj.charging,
  };
}

/* ══════════════════════════════════════════════════════════════════════════
 * 3 · Ortam kimliği (maskeli — görev §1)
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * Oturum ortamı. TAM VIN · koordinat · seri numarası ASLA taşınmaz.
 * Okunamayan alan `null` kalır — "UNKNOWN" dizesi uydurulmaz.
 */
export function readSessionEnv(): SessionEnv {
  const base = emptyEnv();
  const health = _safe(() => healthMonitor.getGlobalHealthSnapshot());
  const sess   = _safe(() => readSessionRawSnapshot());
  const status = sess ? sess.obdStatus : null;
  const trans  = sess ? sess.transportStats : null;
  const hs     = sess ? sess.handshake : null;

  const rawVin = _safe(() => localStorage.getItem('caros.vehicle.vin'));

  return {
    ...base,
    appVersion: health ? health.appVersion : null,
    buildType: _safe(() => (import.meta.env.MODE as string)) ?? null,
    /* APK SHA-256 ve git revizyonu bu katmandan OKUNAMAZ (native/CI alanı) →
       uydurulmaz, `null` kalır ve raporda UNAVAILABLE görünür. */
    apkSha256: null,
    gitRevision: _safe(() => (import.meta.env.VITE_GIT_REVISION as string)) ?? null,
    deviceModel: _safe(() => navigator.userAgent.slice(0, 120)) ?? null,
    androidRelease: null,
    sdkInt: null,
    obdAdapter: status ? status.source : null,
    transport: trans ? trans.transport : null,
    protocolActive: hs ? hs.protocolActive : null,
    vehicleRef: maskVehicleRef(rawVin),
    /* Şehir/bölge düzeyi bilgi ancak ters-coğrafi kodlama ile bulunur; bu
       katman AĞ ÇAĞRISI YAPMAZ → alan boş bırakılır (koordinat ASLA yazılmaz). */
    startRegion: null,
  };
}

/* ══════════════════════════════════════════════════════════════════════════
 * 4 · Preflight (görev §18)
 * ════════════════════════════════════════════════════════════════════════ */

const PROBE_KEY = 'caros.lab.longRoad.probe';

/**
 * Başlamadan önce kendini sınar. Eksik kapılar BLOCKED işaretlenir ama test
 * TAMAMEN ENGELLENMEZ — ölçülebilen alanlar ölçülmeye devam eder (görev §18).
 */
export function readPreflight(): readonly PreflightRow[] {
  const rows: PreflightRow[] = [];

  /* STORAGE + SESSION_PERSISTENCE — gerçek yaz/oku/sil denemesi. */
  const storageOk = (() => {
    try {
      safeSetRaw(PROBE_KEY, '1', 0, true);
      const back = safeGetRaw(PROBE_KEY);
      safeRemoveRaw(PROBE_KEY);
      return back === '1';
    } catch {
      return false;
    }
  })();
  /* Bütçe başlığı: bu modülün ŞU AN kullandığı bayt ile tavan arasındaki pay.
     NOT: İşletim sistemi düzeyindeki BOŞ DİSK alanı yalnız async API ile
     okunabilir; bu senkron katmanda okunmaz ve "yeterli" diye VARSAYILMAZ. */
  const used = _safe(() => measureUsedBytes());
  const headroom = used === null ? null : LR_MAX_TOTAL_BYTES - used;
  rows.push({
    id: 'STORAGE',
    verdict: !storageOk ? 'FAIL'
      : headroom === null ? 'DEGRADED'
      : headroom <= 0 ? 'DEGRADED' : 'PASS',
    detail: !storageOk
      ? 'Depolama yazılamıyor — kanıt saklanamaz.'
      : headroom === null
        ? 'Yaz/oku/sil başarılı ama kullanım ÖLÇÜLEMEDİ — bütçe payı bilinmiyor.'
        : `Yaz/oku/sil başarılı · kullanılan ${used} / tavan ${LR_MAX_TOTAL_BYTES} bayt ` +
          `(pay ${headroom}). İşletim sistemi boş alanı bu katmanda OKUNMAZ, yeterli VARSAYILMAZ.`,
  });
  rows.push({
    id: 'SESSION_PERSISTENCE',
    verdict: storageOk ? 'PASS' : 'FAIL',
    detail: storageOk ? 'safeStorage üzerinden versiyonlu kalıcılık hazır.' : 'Kalıcılık yok — oturum restore EDİLEMEZ.',
  });

  /* OBD gözlem yüzeyi. */
  const sess = _safe(() => readSessionRawSnapshot());
  const obdReadable = !!sess && sess.obdStatus !== null;
  rows.push({
    id: 'OBD_ACCESS',
    verdict: obdReadable ? 'PASS' : 'BLOCKED_HARDWARE',
    detail: obdReadable
      ? `OBD durum yüzeyi okunabiliyor (kaynak=${sess?.obdStatus?.source ?? '—'}).`
      : 'OBD durum yüzeyi okunamadı — araç verisi maddeleri gözlenemez.',
  });

  /* Konum gözlem yüzeyi + İZİN durumu.
     İzin otoritesi ürünün kendi `gpsService` durumudur — biz izin İSTEMEYİZ,
     yalnız mevcut durumu OKURUZ (görev §0: hiçbir izin isteği yok). */
  const loc = _safe(() => readLocationEngineSnapshot());
  const gps = _safe(() => getGPSState());
  const permissionDenied = !!gps && gps.unavailable === true && gps.error === 'GPS permission denied';
  rows.push({
    id: 'GPS_ACCESS',
    verdict: permissionDenied ? 'BLOCKED_POLICY' : loc ? 'PASS' : 'BLOCKED_HARDWARE',
    detail: permissionDenied
      ? 'KONUM İZNİ REDDEDİLMİŞ — konum maddeleri gözlenemez. İzin İSTENMEDİ (pasif gözlem).'
      : loc
        ? `Konum hakemi okunabiliyor (durum=${loc.state}` +
          `${gps ? `, izleme=${gps.isTracking ? 'AÇIK' : 'KAPALI'}` : ''}).`
        : 'Konum hakemi okunamadı — konum maddeleri gözlenemez.',
  });

  /* Fleet backend köprüsü — YOKLUĞU FAIL DEĞİLDİR (görev §7). */
  const pair = _safe(() => readPairingAuthority());
  const backendReady = !!pair && pair.vehicleRegistered && pair.apiKeyPresent;
  rows.push({
    id: 'BACKEND_ACCESS',
    verdict: backendReady ? 'PASS' : 'BLOCKED_BACKEND',
    detail: backendReady
      ? 'Araç kaydı ve anahtar VAR (değer okunmadı).'
      : 'Bu cihazda filo eşleştirmesi yok → bulut maddeleri BLOCKED_BACKEND.',
  });

  /* AI politikası — provider yalnız CONFIGURED ise READY SAYILMAZ (görev §8). */
  const aiOn = _safe(() => isAiGatewayEnabled());
  rows.push({
    id: 'AI_POLICY',
    verdict: aiOn === true ? 'NOT_OBSERVED' : 'BLOCKED_POLICY',
    detail: aiOn === true
      ? 'AI ana şalteri AÇIK; provider hazırlığı ayrıca kanıt ister (CONFIGURED ≠ READY).'
      : 'AI_DISABLED_BY_POLICY — ana şalter kapalı.',
  });

  /* Gözlemcinin kendi bileşenleri. */
  rows.push({
    id: 'SNAPSHOT_EXPORTER',
    verdict: sess ? 'PASS' : 'DEGRADED',
    detail: sess
      ? 'CAROS LAB oturum snapshot okuyucusu hazır.'
      : 'Snapshot kaynağı okunamadı — snapshot gövdeleri eksik olacak.',
  });
  rows.push({
    id: 'BLACKBOX_BUFFER',
    verdict: 'PASS',
    detail: 'Bellek içi bounded halka tamponu hazır (kalıcılık gerektirmez).',
  });

  return rows;
}

/* ══════════════════════════════════════════════════════════════════════════
 * 5 · Async ek okuma — YALNIZ snapshot anında (görev §11)
 * ════════════════════════════════════════════════════════════════════════ */

export interface AsyncAugment {
  readonly offlineQueueSize: number | null;
  readonly batteryPercent: number | null;
  readonly charging: boolean | null;
}

interface BatteryLike {
  readonly level: number;
  readonly charging: boolean;
}

/**
 * Yalnız SAYIM ve OKUMA yapar: kuyruk boşaltma / retry / gönderim TETİKLEMEZ.
 * Hata durumunda alanlar `null` döner (sahte 0 YOK).
 */
export async function readAsyncAugment(): Promise<AsyncAugment> {
  let queue: number | null = null;
  try {
    const n = await connectivityService.queueSize();
    queue = typeof n === 'number' && Number.isFinite(n) ? n : null;
  } catch { /* fail-soft */ }

  let batteryPercent: number | null = null;
  let charging: boolean | null = null;
  try {
    const nav = navigator as Navigator & { getBattery?: () => Promise<BatteryLike> };
    if (typeof nav.getBattery === 'function') {
      const b = await nav.getBattery();
      batteryPercent = typeof b.level === 'number' ? Math.round(b.level * 100) : null;
      charging = typeof b.charging === 'boolean' ? b.charging : null;
    }
  } catch { /* fail-soft — bu API her WebView'da yok */ }

  return { offlineQueueSize: queue, batteryPercent, charging };
}
