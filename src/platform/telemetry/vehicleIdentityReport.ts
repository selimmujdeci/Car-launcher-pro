/**
 * vehicleIdentityReport.ts — ARAÇ KİMLİK ÖZETİ SÖZLEŞMESİ (SAF).
 *
 * ── AMAÇ ──────────────────────────────────────────────────────────────
 * Head unit'in öğrendiği araç kimliğini (VIN · marka/model/yıl · parmak izi
 * · aktif OBD protokolü) sunucuya `record_vehicle_identity` RPC'siyle
 * taşımak. Bu modül YALNIZ gönderilecek gövdeyi ÜRETİR ve DOĞRULAR;
 * ağ çağrısı yapmaz (test edilebilirlik + hot-path'e girmeme).
 *
 * ── DÜRÜSTLÜK KURALLARI ───────────────────────────────────────────────
 *   1. VIN ŞEKLİ geçersizse GÖNDERİLMEZ (uydurma kimlik yasak). Sunucu da
 *      ikinci kapı olarak 11–17 hane ve karakter kümesini doğrular.
 *   2. VIN'in NEREDEN geldiği taşınır (`OBD_MODE09` ölçüm · `MANUAL` kullanıcı
 *      girdisi · `UNVERIFIED` doğrulanmamış) — kaynak uydurulmaz.
 *   3. Bilinmeyen alan gönderilmez (`undefined`); `null`/boş metin ile
 *      "biliniyor ama boş" izlenimi verilmez.
 *   4. Güven puanı İSTEMCİDE ÜRETİLMEZ — sunucu tek otoritedir (istemci
 *      kendi güvenini yükseltemez). Bu yüzden gövdede güven alanı YOKTUR.
 *   5. Ham VIN loglanmaz; bu modülün ürettiği hata/gözlem çıktısında VIN
 *      yalnız MASKELİ görünür.
 *
 * SAF: I/O YOK · timer YOK · `Date.now()` YOK · global durum YOK.
 */

/* ── VIN ───────────────────────────────────────────────────────────────── */

/** ISO 3779: I·O·Q kullanılmaz (1/0 ile karışır). */
const VIN_ALLOWED = /^[A-HJ-NPR-Z0-9]+$/;
export const VIN_MIN_LENGTH = 11;
export const VIN_MAX_LENGTH = 17;

export const VIN_SOURCES = ['OBD_MODE09', 'MANUAL', 'UNVERIFIED'] as const;
export type VinSource = (typeof VIN_SOURCES)[number];

/**
 * VIN'i normalize eder. Geçersizse `null` — KISALTMAZ, TAMAMLAMAZ, UYDURMAZ.
 * (Kısa/uzun VIN'i "düzeltmek" yanlış araca yazmak demektir.)
 */
export function normalizeVin(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const vin = raw.trim().toUpperCase();
  if (vin.length < VIN_MIN_LENGTH || vin.length > VIN_MAX_LENGTH) return null;
  if (!VIN_ALLOWED.test(vin)) return null;
  return vin;
}

/** Log/gözlem için maskeli VIN — TAM VIN ASLA yazılmaz. */
export function maskVin(vin: string | null): string {
  if (!vin) return 'UNKNOWN';
  return vin.length <= 6 ? '••••••' : `•••${vin.slice(-6)}`;
}

export function normalizeVinSource(raw: unknown): VinSource {
  return (VIN_SOURCES as readonly string[]).includes(String(raw))
    ? (raw as VinSource)
    : 'UNVERIFIED';
}

/* ── Girdi ─────────────────────────────────────────────────────────────── */

/** Head unit'in kimlik hakkında BİLDİĞİ her şey — hepsi opsiyonel. */
export interface IdentityObservation {
  readonly vin?: unknown;
  readonly vinSource?: unknown;
  readonly make?: unknown;
  readonly model?: unknown;
  readonly modelYear?: unknown;
  readonly fingerprintHash?: unknown;
  readonly fingerprintVersion?: unknown;
  readonly activeObdProtocol?: unknown;
}

/* ── Çıktı ─────────────────────────────────────────────────────────────── */

/** `record_vehicle_identity` RPC gövdesi (api_key ÇAĞIRAN tarafından eklenir). */
export interface IdentityRpcBody {
  p_vin?: string;
  p_vin_source?: VinSource;
  p_make?: string;
  p_model?: string;
  p_model_year?: number;
  p_fingerprint_hash?: string;
  p_fingerprint_version?: string;
  p_active_obd_protocol?: string;
}

export interface IdentityReport {
  readonly body: IdentityRpcBody;
  /** Gövdede yer alan alanlar — LAB gözlemi için. */
  readonly presentKeys: readonly string[];
  /** Reddedilen alanlar ve nedeni — sessiz yutma YOK. */
  readonly rejected: Readonly<Record<string, string>>;
  /**
   * Gönderilmeye DEĞER mi? Parmak izi ve VIN'in İKİSİ de yoksa sunucuya
   * kimliksiz satır yazmanın anlamı yoktur → `false`.
   */
  readonly sendable: boolean;
  /** Gözlem/log için maskeli VIN. TAM VIN İÇERMEZ. */
  readonly maskedVin: string;
}

/* ── Yardımcılar ───────────────────────────────────────────────────────── */

/** Kısa metin alanı; boş/aşırı uzun ise reddedilir. */
function shortText(raw: unknown, maxLen: number): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  if (s.length === 0 || s.length > maxLen) return null;
  return s;
}

/** Makul model yılı — uydurma tarih/0 yasak. */
function modelYearOf(raw: unknown): number | null {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return null;
  const y = Math.trunc(raw);
  return y >= 1950 && y <= 2100 ? y : null;
}

/** Parmak izi hash'i — onaltılık/base ayrımı yapmaz, şekli sınırlar. */
function fingerprintOf(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  if (s.length < 8 || s.length > 128) return null;
  if (!/^[A-Za-z0-9_\-=+/]+$/.test(s)) return null;
  return s;
}

/* ── Kurucu ────────────────────────────────────────────────────────────── */

export function buildIdentityReport(obs: IdentityObservation): IdentityReport {
  const body: IdentityRpcBody = {};
  const rejected: Record<string, string> = {};

  /* VIN — geçersizse KAYNAK DA gönderilmez (kaynaksız VIN yalanı olmaz). */
  const vin = normalizeVin(obs.vin);
  if (vin !== null) {
    body.p_vin = vin;
    body.p_vin_source = normalizeVinSource(obs.vinSource);
  } else if (obs.vin !== undefined && obs.vin !== null) {
    rejected.vin = 'gecersiz_vin_sekli';
  }

  const make = shortText(obs.make, 64);
  if (make !== null) body.p_make = make;
  else if (obs.make !== undefined && obs.make !== null) rejected.make = 'gecersiz_metin';

  const model = shortText(obs.model, 64);
  if (model !== null) body.p_model = model;
  else if (obs.model !== undefined && obs.model !== null) rejected.model = 'gecersiz_metin';

  const year = modelYearOf(obs.modelYear);
  if (year !== null) body.p_model_year = year;
  else if (obs.modelYear !== undefined && obs.modelYear !== null) rejected.modelYear = 'aralik_disi';

  const fp = fingerprintOf(obs.fingerprintHash);
  if (fp !== null) {
    body.p_fingerprint_hash = fp;
    const fpv = shortText(obs.fingerprintVersion, 32);
    if (fpv !== null) body.p_fingerprint_version = fpv;
  } else if (obs.fingerprintHash !== undefined && obs.fingerprintHash !== null) {
    rejected.fingerprintHash = 'gecersiz_hash_sekli';
  }

  const proto = shortText(obs.activeObdProtocol, 48);
  if (proto !== null) body.p_active_obd_protocol = proto;
  else if (obs.activeObdProtocol !== undefined && obs.activeObdProtocol !== null) {
    rejected.activeObdProtocol = 'gecersiz_metin';
  }

  return {
    body,
    presentKeys: Object.keys(body),
    rejected,
    /* Kimliksiz satır yazmanın anlamı yok. */
    sendable: body.p_vin !== undefined || body.p_fingerprint_hash !== undefined,
    maskedVin: maskVin(vin),
  };
}

/* ── Sunucu yanıtı ─────────────────────────────────────────────────────── */

export const IDENTITY_STATES = ['CREATED', 'UPDATED', 'IDENTITY_CONFLICT', 'UNCHANGED'] as const;
export type IdentityState = (typeof IDENTITY_STATES)[number];

export interface IdentityAck {
  readonly state: IdentityState | 'UNKNOWN';
  readonly conflict: boolean;
  readonly identityConfidence: number | null;
  readonly reason: string | null;
  /**
   * Sunucudaki kimlik revizyonu. Protokol değişimi gibi ÇAKIŞMA OLMAYAN
   * ilerlemelerde artar. Sunucu tek otoritedir; istemci ÜRETMEZ.
   * Yanıt taşımıyorsa `null` (uydurma 1 YASAK).
   */
  readonly identityRevision: number | null;
}

/**
 * RPC yanıtını güvenle daraltır.
 *
 * Sunucu yalnız `{state, conflict, identityConfidence, reason?}` döndürür —
 * api_key veya ham VIN DÖNMEZ. Beklenmeyen alanlar YOK SAYILIR; eksik güven
 * `null` kalır (uydurma 1.0 YASAK).
 */
export function parseIdentityAck(raw: unknown): IdentityAck {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const stateRaw = String(o.state ?? '');
  const state = (IDENTITY_STATES as readonly string[]).includes(stateRaw)
    ? (stateRaw as IdentityState)
    : 'UNKNOWN';
  const conf = o.identityConfidence;
  const rev = o.identityRevision;
  return {
    state,
    conflict: o.conflict === true || state === 'IDENTITY_CONFLICT',
    identityConfidence:
      typeof conf === 'number' && Number.isFinite(conf) && conf >= 0 && conf <= 1 ? conf : null,
    reason: typeof o.reason === 'string' && o.reason.length > 0 ? o.reason : null,
    /* Revizyon pozitif tam sayı olmalı; aksi halde bilinmiyor. */
    identityRevision:
      typeof rev === 'number' && Number.isFinite(rev) && rev >= 0 && Number.isInteger(rev)
        ? rev : null,
  };
}
