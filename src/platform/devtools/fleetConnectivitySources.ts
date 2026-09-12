/**
 * fleetConnectivitySources.ts — FLEET BAĞLANTI GÖZLEMİ İÇİN TEK OKUMA KATMANI.
 *
 * CAROS LAB "Fleet Connectivity" ekranının TEK veri kaynağı. Desen A3–A8 ile
 * birebir aynı: her getter SENKRON, her getter kendi `try/catch`ine sarılı,
 * hata durumunda `null` döner (ekran `UNAVAILABLE` gösterir — sahte 0 YOK).
 *
 * ── GİZLİLİK KAPILARI (BAĞLAYICI) ─────────────────────────────────────
 * Bu katman ASLA taşımaz:
 *   · `api_key` / `api_key_hash` (ham veya kırpılmış)
 *   · 6 haneli ham eşleştirme kodu
 *   · JWT'nin tamamı veya okunabilir parçası
 *   · TAM VIN (yalnız maskeli son 6 hane)
 *   · TAM UUID (yalnız ilk 8 karakter)
 *   · GPS koordinatı, telefon numarası, e-posta, kullanıcı adı
 * Taşıdığı şey: VAR/YOK · ADET · DURUM ADI · ZAMAN FARKI.
 *
 * HİÇBİR ŞEY BAŞLATMAZ: yeni poll açmaz, ağ çağrısı yapmaz, OBD'ye
 * dokunmaz, timer kurmaz — yalnız mevcut anlık görüntüleri OKUR.
 */

import { telemetryService } from '../telemetryService';
import type { TelemetryBuildReport } from '../telemetry/telemetryContract';
import { maskVin } from '../telemetry/vehicleIdentityReport';

/* ── Yardımcılar ───────────────────────────────────────────────────────── */

/** Her okuma bu kapıdan geçer: fırlatırsa `null` (fail-soft). */
function safe<T>(read: () => T): T | null {
  try {
    const v = read();
    return v === undefined ? null : v;
  } catch {
    return null;
  }
}

/** UUID → yalnız ilk 8 karakter (tam kimlik SIZDIRILMAZ). */
export function shortId(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length === 0) return null;
  return raw.length <= 8 ? raw : `${raw.slice(0, 8)}…`;
}

/* ── Telemetri gönderim gözlemi ────────────────────────────────────────── */

export interface TelemetryPushObservation {
  /** Son kurulan payload'da BULUNAN alanlar (değer TAŞIMAZ, yalnız ad). */
  readonly presentFields: readonly string[];
  /** Reddedilen alanlar → neden. Değer TAŞIMAZ. */
  readonly rejectedFields: readonly string[];
  readonly obdSkipped: boolean;
  readonly obdSkipReason: string | null;
  readonly gpsSkipped: boolean;
  readonly gpsSkipReason: string | null;
  readonly source: string;
  readonly locationSource: string | null;
  /** Gözlem anının şimdiye göre yaşı (ms). Mutlak zaman damgası TAŞIMAZ. */
  readonly observedAgeMs: number | null;
  readonly obdObservedAgeMs: number | null;
  readonly gpsObservedAgeMs: number | null;
}

/**
 * Son telemetri payload'ının SÖZLEŞME gözlemi.
 * `null` → henüz hiç payload kurulmadı (uydurma "sağlıklı" YOK).
 */
export function readTelemetryPushObservation(nowMs: number): TelemetryPushObservation | null {
  return safe(() => {
    const svc = telemetryService;
    const report: TelemetryBuildReport | null =
      typeof svc?.getLastBuildReport === 'function' ? svc.getLastBuildReport() : null;
    if (!report) return null;

    const f = report.fields;
    const age = (v: number | undefined): number | null =>
      typeof v === 'number' && Number.isFinite(v) ? Math.max(0, nowMs - v) : null;

    return {
      presentFields:  [...report.presentKeys],
      rejectedFields: [...report.rejected],
      obdSkipped: report.obdSkipped,
      obdSkipReason: report.obdSkipReason ?? null,
      gpsSkipped: report.gpsSkipped,
      gpsSkipReason: report.gpsSkipReason ?? null,
      source: f.source ?? 'UNKNOWN',
      locationSource: f.locationSource ?? null,
      observedAgeMs:    age(f.observedAt),
      obdObservedAgeMs: age(f.obdObservedAt),
      gpsObservedAgeMs: age(f.gpsObservedAt),
    };
  });
}

/* ── Eşleştirme otoritesi ──────────────────────────────────────────────── */

export interface PairingAuthorityObservation {
  /** Kanonik akış adı — tek otorite. */
  readonly canonicalFlow: string;
  /** Bu cihazda araç kaydı VAR mı (kimlik/anahtar TAŞIMAZ). */
  readonly vehicleRegistered: boolean;
  /** Araç kimliğinin YALNIZ ilk 8 karakteri. */
  readonly vehicleIdShort: string | null;
  /** Cihazda API anahtarı VAR mı — DEĞERİ ASLA TAŞINMAZ. */
  readonly apiKeyPresent: boolean;
  /** Kapatılan ölü eşleştirme yollarının adedi. */
  readonly deprecatedRouteCount: number;
}

const CANONICAL_PAIRING_FLOW =
  'head unit register_vehicle → 6 haneli kod → Filo panosu → pair_vehicle_to_user';

/** Kapatılan ölü yollar (website tarafındaki kayıtla AYNI listedir). */
const DEPRECATED_PAIRING_PATHS = [
  '/api/pwa/pair',
  '/api/vehicle/register',
  '/api/vehicle/code',
] as const;

export function readPairingAuthority(): PairingAuthorityObservation | null {
  return safe(() => {
    /* Depolama anahtarları head unit'te `caros.fleet.*` önekiyle tutulur.
       DEĞER OKUNMAZ — yalnız VARLIK sınanır. */
    let vehicleId: string | null = null;
    let apiKeyPresent = false;
    try {
      vehicleId    = localStorage.getItem('caros.fleet.vehicleId');
      apiKeyPresent = localStorage.getItem('caros.fleet.apiKey') !== null;
    } catch { /* depolama kapalı → VAR/YOK bilinmiyor, false kalır */ }

    return {
      canonicalFlow: CANONICAL_PAIRING_FLOW,
      vehicleRegistered: vehicleId !== null,
      vehicleIdShort: shortId(vehicleId),
      apiKeyPresent,
      deprecatedRouteCount: DEPRECATED_PAIRING_PATHS.length,
    };
  });
}

export function readDeprecatedPairingPaths(): readonly string[] {
  return DEPRECATED_PAIRING_PATHS;
}

/* ── Araç kimliği ──────────────────────────────────────────────────────── */

export interface IdentityObservationRow {
  /** MASKELİ VIN (yalnız son 6 hane) veya `UNKNOWN`. */
  readonly maskedVin: string;
  readonly vinSource: string | null;
  /** Parmak izi hash'inin YALNIZ ilk 12 karakteri. */
  readonly fingerprintPrefix: string | null;
  readonly fingerprintVersion: string | null;
  readonly activeObdProtocol: string | null;
  /** Sunucu tarafından verilen güven (0–1). İstemci ÜRETMEZ. */
  readonly identityConfidence: number | null;
  readonly lastAckState: string | null;
  readonly conflict: boolean | null;
  readonly conflictReason: string | null;
}

/**
 * Son kimlik gönderiminin gözlemi.
 * `null` → henüz hiç kimlik gönderilmedi.
 */
export function readIdentityObservation(): IdentityObservationRow | null {
  return safe(() => {
    const svc = telemetryService;
    const snap =
      typeof svc?.getLastIdentityReport === 'function' ? svc.getLastIdentityReport() : null;
    if (!snap) return null;

    return {
      /* Gövdedeki VIN maskelenerek gösterilir — TAM VIN ASLA. */
      maskedVin: snap.maskedVin ?? maskVin(null),
      vinSource: snap.body?.p_vin_source ?? null,
      fingerprintPrefix: snap.body?.p_fingerprint_hash
        ? snap.body.p_fingerprint_hash.slice(0, 12)
        : null,
      fingerprintVersion: snap.body?.p_fingerprint_version ?? null,
      activeObdProtocol: snap.body?.p_active_obd_protocol ?? null,
      identityConfidence: snap.ack?.identityConfidence ?? null,
      lastAckState: snap.ack?.state ?? null,
      conflict: snap.ack ? snap.ack.conflict : null,
      conflictReason: snap.ack?.reason ?? null,
    };
  });
}

/* ── Sözleşme kapısı özeti ─────────────────────────────────────────────── */

export interface ContractGateObservation {
  /** Bilinmeyen alan payload'a `0` olarak GİRMİYOR mu? */
  readonly unknownNeverZero: boolean;
  /** RPC'nin okuduğu anahtarlar (`speed/fuel/temp/rpm/lat/lng/heading`). */
  readonly rpcCompatibleKeys: readonly string[];
  /** Bu payload'da gerçekten bulunan RPC anahtarları. */
  readonly rpcKeysPresent: readonly string[];
}

const RPC_KEYS = ['speed', 'fuel', 'temp', 'rpm', 'lat', 'lng', 'heading'] as const;

export function readContractGate(obs: TelemetryPushObservation | null): ContractGateObservation | null {
  if (!obs) return null;
  return safe(() => ({
    /* Sözleşme gereği: OBD atlandıysa hiçbir OBD anahtarı BULUNMAMALI. */
    unknownNeverZero: obs.obdSkipped
      ? !obs.presentFields.some((k) => k === 'rpm' || k === 'temp' || k === 'speed')
      : true,
    rpcCompatibleKeys: RPC_KEYS,
    rpcKeysPresent: obs.presentFields.filter((k) => (RPC_KEYS as readonly string[]).includes(k)),
  }));
}
