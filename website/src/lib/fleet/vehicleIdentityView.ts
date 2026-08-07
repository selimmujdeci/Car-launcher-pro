/**
 * vehicleIdentityView.ts — FLEET ARAÇ KİMLİĞİ GÖRÜNÜM MODELİ (SAF).
 *
 * `list_company_vehicle_identity()` RPC'sinin döndürdüğü MASKELİ satırı
 * kullanıcıya dönük dürüst metinlere çevirir.
 *
 * ── DÜRÜSTLÜK KURALLARI ───────────────────────────────────────────────
 *   1. Kanıt yoksa `null` → "Veri yok". Sahte `0`, sahte tarih, sahte
 *      "doğrulandı" YASAK.
 *   2. Sunucu onayı yoksa **VERIFIED denmez** (`PENDING`).
 *   3. Çakışma GİZLENMEZ — kullanıcı "başka araç algılandı" bilgisini görür.
 *   4. RPC ham VIN döndürmez; bu katman da tam VIN ÜRETMEZ/BİRLEŞTİRMEZ.
 *   5. VIN **sahiplik kanıtı DEĞİLDİR** — bu görünüm sahiplik iddia etmez.
 *
 * SAF: I/O YOK · timer YOK · `Date.now()` YOK · React YOK.
 */

/* ── Durum ─────────────────────────────────────────────────────────────── */

export const IDENTITY_VIEW_STATUSES = [
  'UNKNOWN',   // hiç kimlik kaydı yok
  'PENDING',   // kayıt var ama güven düşük / onay yok
  'VERIFIED',  // güven yeterli, çakışma yok
  'CONFLICT',  // sunucu çakışma saydı
  'STALE',     // kayıt bayat
] as const;
export type IdentityViewStatus = (typeof IDENTITY_VIEW_STATUSES)[number];

/**
 * `VERIFIED` eşiği.
 *
 * Sunucu ilk VIN'li kayda 0.70 verir ve tekrar eden UYUMLU kanıtla +0.10
 * artırır (üst sınır 0.95). 0.70 = "VIN okundu ve çelişki yok" demektir;
 * bunun altı (0.50 VIN'siz, 0.30 çakışma sonrası) doğrulanmış SAYILMAZ.
 */
export const IDENTITY_VERIFIED_MIN_CONFIDENCE = 0.70;

/** Kimlik kaydı bu süreden eskiyse bayat sayılır (kanıt tazeliği). */
export const IDENTITY_STALE_AFTER_MS = 30 * 24 * 60 * 60_000;  // 30 gün

/* ── Girdi (RPC satırı — TÜMÜ MASKELİ) ─────────────────────────────────── */

export interface VehicleIdentityRow {
  readonly vehicle_id?: string | null;
  /** RPC'den MASKELİ gelir (`•••XXXXXX`). Ham VIN ASLA. */
  readonly vin_masked?: string | null;
  readonly vin_source?: string | null;
  readonly vin_observed_at?: string | null;
  readonly make?: string | null;
  readonly model?: string | null;
  readonly model_year?: number | null;
  /** İlk 12 karakter. */
  readonly fingerprint_hash_short?: string | null;
  readonly fingerprint_version?: string | null;
  readonly active_obd_protocol?: string | null;
  readonly vehicle_generation?: string | null;
  readonly identity_confidence?: number | null;
  readonly identity_revision?: number | null;
  readonly identity_updated_at?: string | null;
  readonly identity_conflict_count?: number | null;
  readonly last_conflict_reason?: string | null;
  readonly protocol_change_count?: number | null;
}

export interface IdentityViewInput {
  readonly now: number;
  /** Kayıt yoksa `null`. */
  readonly row: VehicleIdentityRow | null;
  /** Okuma BAŞARILI oldu mu — "yok" ile "okunamadı" ayrımı. */
  readonly readable: boolean;
}

/* ── Çıktı ─────────────────────────────────────────────────────────────── */

export interface VehicleIdentityView {
  readonly status: IdentityViewStatus;
  /** Maskeli VIN veya `null`. TAM VIN ASLA. */
  readonly vinMasked: string | null;
  readonly vinSource: string | null;
  readonly make: string | null;
  readonly model: string | null;
  readonly modelYear: number | null;
  readonly vehicleGeneration: string | null;
  readonly obdProtocol: string | null;
  readonly fingerprintShort: string | null;
  readonly fingerprintVersion: string | null;
  readonly confidence: number | null;
  readonly revision: number | null;
  readonly updatedAtMs: number | null;
  readonly conflictCount: number;
  readonly conflictReason: string | null;
  readonly protocolChangeCount: number;
}

const EMPTY_VIEW: VehicleIdentityView = Object.freeze({
  status: 'UNKNOWN', vinMasked: null, vinSource: null, make: null, model: null,
  modelYear: null, vehicleGeneration: null, obdProtocol: null,
  fingerprintShort: null, fingerprintVersion: null, confidence: null,
  revision: null, updatedAtMs: null, conflictCount: 0, conflictReason: null,
  protocolChangeCount: 0,
});

/* ── Yardımcılar ───────────────────────────────────────────────────────── */

function text(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  return s.length === 0 ? null : s;
}

function num(raw: unknown): number | null {
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
}

function count(raw: unknown): number {
  const n = num(raw);
  return n === null || n < 0 ? 0 : Math.trunc(n);
}

/** ISO → epoch ms; geçersizse `null` (uydurma tarih YOK). */
export function identityTimeMs(raw: unknown): number | null {
  if (typeof raw !== 'string') return null;
  const t = Date.parse(raw);
  return Number.isNaN(t) ? null : t;
}

/**
 * MASKELEME KAPISI — bu katmandan TAM VIN geçemez.
 *
 * RPC maskeli döndürür, ama savunma katmanlı davranıp burada da sınarız:
 * maske işareti taşımayan ve VIN uzunluğunda görünen bir değer GÖSTERİLMEZ
 * (sunucu sözleşmesi bozulursa UI sızıntı yapmasın).
 */
export function safeMaskedVin(raw: unknown): string | null {
  const s = text(raw);
  if (s === null) return null;
  if (s.includes('•')) return s;
  /* Maskesiz VIN benzeri değer → GÖSTERİLMEZ (sözleşme ihlali). */
  if (s.length >= 11) return null;
  return s;
}

/* ── Kurucu ────────────────────────────────────────────────────────────── */

export function buildVehicleIdentityView(input: IdentityViewInput): VehicleIdentityView {
  const { row, readable, now } = input;
  if (!readable || row === null) {
    /* Okunamadı ile "hiç kayıt yok" AYNI ŞEY DEĞİL; ikisi de UNKNOWN
       gösterilir ama etiket metni ayırır (bkz. identityStatusLabel). */
    return EMPTY_VIEW;
  }

  const vinMasked = safeMaskedVin(row.vin_masked);
  const confidence = num(row.identity_confidence);
  const updatedAtMs = identityTimeMs(row.identity_updated_at);
  const conflictCount = count(row.identity_conflict_count);

  const hasEvidence = vinMasked !== null || text(row.fingerprint_hash_short) !== null;

  let status: IdentityViewStatus;
  if (!hasEvidence) {
    status = 'UNKNOWN';
  } else if (conflictCount > 0) {
    /* Çakışma GİZLENMEZ — güven yüksek olsa bile önce çakışma bildirilir. */
    status = 'CONFLICT';
  } else if (updatedAtMs !== null && now - updatedAtMs > IDENTITY_STALE_AFTER_MS) {
    status = 'STALE';
  } else if (confidence !== null && confidence >= IDENTITY_VERIFIED_MIN_CONFIDENCE) {
    status = 'VERIFIED';
  } else {
    /* Güven eşiğin altında veya bilinmiyor → DOĞRULANDI DENMEZ. */
    status = 'PENDING';
  }

  return {
    status,
    vinMasked,
    vinSource: text(row.vin_source),
    make: text(row.make),
    model: text(row.model),
    modelYear: num(row.model_year),
    vehicleGeneration: text(row.vehicle_generation),
    obdProtocol: text(row.active_obd_protocol),
    fingerprintShort: text(row.fingerprint_hash_short),
    fingerprintVersion: text(row.fingerprint_version),
    confidence,
    revision: num(row.identity_revision),
    updatedAtMs,
    conflictCount,
    conflictReason: text(row.last_conflict_reason),
    protocolChangeCount: count(row.protocol_change_count),
  };
}

/* ── Kullanıcıya dönük etiketler (düz Türkçe, teknik sızıntı YOK) ─────── */

export function identityStatusLabel(status: IdentityViewStatus): string {
  switch (status) {
    case 'VERIFIED': return 'Doğrulandı';
    case 'PENDING':  return 'Doğrulanıyor';
    case 'CONFLICT': return 'Farklı araç algılandı';
    case 'STALE':    return 'Kimlik bilgisi eski';
    case 'UNKNOWN':  return 'Kimlik bilinmiyor';
  }
}

/** Değer yoksa TEK gösterim — sahte 0 / sahte metin YOK. */
export function identityFieldLabel(value: string | number | null): string {
  if (value === null) return 'Veri yok';
  return String(value);
}

/**
 * Çakışma açıklaması — teknik gerekçe kullanıcı diline çevrilir.
 * Bilinmeyen gerekçe UYDURULMAZ.
 */
export function identityConflictLabel(reason: string | null): string | null {
  if (reason === null) return null;
  switch (reason) {
    case 'VIN_MISMATCH':
      return 'Araçtan okunan şasi numarası kayıtlı numaradan farklı. Kayıtlı bilgi korundu.';
    case 'FINGERPRINT_MISMATCH':
      return 'Araç imzası kayıtlı imzadan farklı. Kayıtlı bilgi korundu.';
    default:
      return 'Araç kimliğinde çelişki algılandı. Kayıtlı bilgi korundu.';
  }
}

/** Güven yüzdesi — bilinmiyorsa "Veri yok" (sahte %0 YOK). */
export function identityConfidenceLabel(confidence: number | null): string {
  if (confidence === null) return 'Veri yok';
  return `%${Math.round(Math.max(0, Math.min(1, confidence)) * 100)}`;
}
