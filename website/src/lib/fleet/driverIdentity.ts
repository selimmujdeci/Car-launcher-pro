/**
 * driverIdentity.ts — SÜRÜCÜ KİMLİĞİ VE ATAMA GÖRÜNÜM MODELİ (SAF).
 *
 * ── CEVAPLANAN SORU ───────────────────────────────────────────────────
 * "Bu aracı, bu zaman aralığında ve bu yolculuk sırasında KİM kullanıyordu?"
 *
 * Kanıtlanamıyorsa cevap **UNKNOWN_DRIVER**'dır.
 *
 * ── AYRI TUTULAN KAVRAMLAR ────────────────────────────────────────────
 * Bunlar AYNI ŞEY DEĞİLDİR ve tek bir `user_id` alanına indirgenemez:
 *   · Auth User        — sisteme giriş yapan
 *   · Company Member   — şirkette kayıtlı
 *   · Vehicle Owner    — sahiplik yetkisi taşıyan
 *   · Vehicle Observer — görüntüleme yetkisi olan
 *   · Driver Profile   — araç kullanabilecek gerçek KİŞİ
 *   · Driver Assignment— belirli aralıkta belirli araca atanmış sürücü
 *   · Trip Attribution — bir trip'in hangi sürücüye ait olduğu SONUCU
 *
 * **Bir kişinin Fleet hesabı olması onu sürücü YAPMAZ.**
 * **Bir aracın sahibi olması her trip'in sürücüsü olmak DEMEK DEĞİLDİR.**
 * **Araca erişebilmek onu sürmek DEMEK DEĞİLDİR.**
 *
 * ── BU MODÜL DRIVER DNA DEĞİLDİR ──────────────────────────────────────
 * Sürüş puanı · davranış profili · risk tahmini · ceza/ödül ÜRETMEZ.
 *
 * SAF: I/O YOK · timer YOK · `Date.now()` YOK · React YOK.
 */

/* ── Sürücü durumu ─────────────────────────────────────────────────────── */

export const DRIVER_STATUSES = ['ACTIVE', 'INACTIVE', 'SUSPENDED', 'ARCHIVED'] as const;
export type DriverStatus = (typeof DRIVER_STATUSES)[number];

export function isDriverStatus(v: unknown): v is DriverStatus {
  return typeof v === 'string' && (DRIVER_STATUSES as readonly string[]).includes(v);
}

/* ── Atama ─────────────────────────────────────────────────────────────── */

export const ASSIGNMENT_STATUSES =
  ['SCHEDULED', 'ACTIVE', 'COMPLETED', 'CANCELLED', 'CONFLICTED'] as const;
export type AssignmentStatus = (typeof ASSIGNMENT_STATUSES)[number];

/** P0'da yalnız ilk üçü ÜRETİLİR (enum şişirmesi yapılmadı). */
export const ASSIGNMENT_TYPES = ['PRIMARY', 'TEMPORARY', 'MANUAL'] as const;
export type AssignmentType = (typeof ASSIGNMENT_TYPES)[number];

/**
 * Atama kaynağı.
 *
 * P0'da **yalnız `FLEET_ADMIN` üretilir.** Diğerleri sözleşmede geleceğe
 * hazırlık olarak durur; gerçek üreticisi (head unit seçimi, NFC okuyucu,
 * telefon bağlantısı) bağlanana kadar **sahte üretilmez**.
 */
export const ASSIGNMENT_SOURCES = [
  'FLEET_ADMIN', 'DRIVER_SELF_SELECT', 'HEAD_UNIT_SELECT',
  'PHONE_HUB', 'NFC', 'BLUETOOTH', 'UNKNOWN',
] as const;
export type AssignmentSource = (typeof ASSIGNMENT_SOURCES)[number];

/* ── Trip attribution ──────────────────────────────────────────────────── */

export const ATTRIBUTION_STATUSES =
  ['ATTRIBUTED', 'UNKNOWN', 'CONFLICTED', 'MANUAL_REVIEW', 'LOCKED'] as const;
export type AttributionStatus = (typeof ATTRIBUTION_STATUSES)[number];

export const ATTRIBUTION_SOURCES = [
  'ACTIVE_ASSIGNMENT', 'MANUAL_TRIP_ASSIGNMENT', 'HEAD_UNIT_SELECTION',
  'PHONE_HUB', 'NFC', 'BLUETOOTH', 'UNKNOWN',
] as const;
export type AttributionSource = (typeof ATTRIBUTION_SOURCES)[number];

export const ATTRIBUTION_CONFIDENCES =
  ['VERY_HIGH', 'HIGH', 'MEDIUM', 'LOW', 'UNKNOWN'] as const;
export type AttributionConfidence = (typeof ATTRIBUTION_CONFIDENCES)[number];

/** Bilinmeyen değer UYDURULMAZ — listede yoksa `UNKNOWN`. */
export function normalizeAttributionStatus(v: unknown): AttributionStatus {
  return (ATTRIBUTION_STATUSES as readonly string[]).includes(String(v))
    ? (v as AttributionStatus) : 'UNKNOWN';
}
export function normalizeAttributionSource(v: unknown): AttributionSource {
  return (ATTRIBUTION_SOURCES as readonly string[]).includes(String(v))
    ? (v as AttributionSource) : 'UNKNOWN';
}
export function normalizeAttributionConfidence(v: unknown): AttributionConfidence {
  return (ATTRIBUTION_CONFIDENCES as readonly string[]).includes(String(v))
    ? (v as AttributionConfidence) : 'UNKNOWN';
}

/* ── Görünüm tipleri ───────────────────────────────────────────────────── */

/** `list_fleet_drivers()` satırı. */
export interface DriverRow {
  readonly driver_id?: string | null;
  readonly display_name?: string | null;
  readonly employee_code?: string | null;
  readonly status?: string | null;
  readonly has_linked_account?: boolean | null;
  readonly license_class?: string | null;
  readonly license_expires_at?: string | null;
  /** Sunucu YALNIZ maskeli gönderir (`•••1234`). Tam numara UI'a GELMEZ. */
  readonly license_masked?: string | null;
  /** Yalnız admin oturumunda dolu gelir. */
  readonly phone_visible?: string | null;
  readonly revision?: number | null;
  readonly active_vehicle_id?: string | null;
  readonly active_assignment_id?: string | null;
  readonly active_since?: string | null;
  readonly last_trip_at?: string | null;
  readonly created_at?: string | null;
}

export interface DriverView {
  readonly driverId: string;
  readonly displayName: string;
  readonly employeeCode: string | null;
  readonly status: DriverStatus;
  /** CAROS hesabı bağlı mı — **sürücü olmakla ilgisi YOK**, yalnız bilgi. */
  readonly hasLinkedAccount: boolean;
  readonly licenseClass: string | null;
  readonly licenseExpiresAtMs: number | null;
  /** Maskeli ehliyet (`•••1234`) veya `null`. Tam numara ASLA. */
  readonly licenseMasked: string | null;
  readonly phone: string | null;
  readonly activeVehicleId: string | null;
  readonly activeAssignmentId: string | null;
  readonly activeSinceMs: number | null;
  readonly lastTripAtMs: number | null;
  readonly revision: number | null;
}

/** ISO → epoch ms; geçersizse `null` (uydurma tarih YOK). */
export function driverTimeMs(raw: unknown): number | null {
  if (typeof raw !== 'string' || raw.length === 0) return null;
  const t = Date.parse(raw);
  return Number.isNaN(t) ? null : t;
}

function text(raw: unknown): string | null {
  return typeof raw === 'string' && raw.trim().length > 0 ? raw.trim() : null;
}

export function buildDriverView(row: DriverRow): DriverView {
  return {
    driverId: typeof row.driver_id === 'string' ? row.driver_id : '',
    displayName: text(row.display_name) ?? 'İsimsiz sürücü',
    employeeCode: text(row.employee_code),
    status: isDriverStatus(row.status) ? row.status : 'INACTIVE',
    hasLinkedAccount: row.has_linked_account === true,
    licenseClass: text(row.license_class),
    licenseExpiresAtMs: driverTimeMs(row.license_expires_at),
    licenseMasked: text(row.license_masked),
    phone: text(row.phone_visible),
    activeVehicleId: text(row.active_vehicle_id),
    activeAssignmentId: text(row.active_assignment_id),
    activeSinceMs: driverTimeMs(row.active_since),
    lastTripAtMs: driverTimeMs(row.last_trip_at),
    revision: typeof row.revision === 'number' && Number.isFinite(row.revision)
      ? row.revision : null,
  };
}

export function buildDriverViews(rows: readonly DriverRow[] | null): {
  readonly drivers: readonly DriverView[];
  readonly readable: boolean;
  readonly isEmpty: boolean;
} {
  /* Okunamadı ≠ sürücü yok — ikisi AYRI gösterilir. */
  if (rows === null) return { drivers: [], readable: false, isEmpty: false };
  const drivers = rows.map(buildDriverView).filter((d) => d.driverId.length > 0);
  return { drivers, readable: true, isEmpty: drivers.length === 0 };
}

/* ── Atama görünümü ────────────────────────────────────────────────────── */

export interface AssignmentRow {
  readonly assignment_id?: string | null;
  readonly driver_id?: string | null;
  readonly driver_name?: string | null;
  readonly starts_at?: string | null;
  readonly ends_at?: string | null;
  readonly assignment_type?: string | null;
  readonly source?: string | null;
  readonly confidence?: string | null;
  readonly status?: string | null;
  readonly revision?: number | null;
  readonly note?: string | null;
}

export interface AssignmentView {
  readonly assignmentId: string;
  readonly driverId: string | null;
  readonly driverName: string | null;
  readonly startsAtMs: number | null;
  /** `null` = AÇIK UÇLU aktif atama (bitiş belirtilmemiş). */
  readonly endsAtMs: number | null;
  readonly isOpenEnded: boolean;
  readonly type: string | null;
  readonly source: AssignmentSource;
  readonly status: AssignmentStatus;
  readonly revision: number | null;
  readonly note: string | null;
}

export function buildAssignmentView(row: AssignmentRow): AssignmentView {
  const ends = driverTimeMs(row.ends_at);
  return {
    assignmentId: typeof row.assignment_id === 'string' ? row.assignment_id : '',
    driverId: text(row.driver_id),
    driverName: text(row.driver_name),
    startsAtMs: driverTimeMs(row.starts_at),
    endsAtMs: ends,
    isOpenEnded: ends === null,
    type: text(row.assignment_type),
    source: (ASSIGNMENT_SOURCES as readonly string[]).includes(String(row.source))
      ? (row.source as AssignmentSource) : 'UNKNOWN',
    status: (ASSIGNMENT_STATUSES as readonly string[]).includes(String(row.status))
      ? (row.status as AssignmentStatus) : 'CONFLICTED',
    revision: typeof row.revision === 'number' && Number.isFinite(row.revision)
      ? row.revision : null,
    note: text(row.note),
  };
}

/**
 * Bir aracın ŞU ANKİ atamasını seçer.
 *
 * "Aktif" demek için zaman aralığı GERÇEKTEN kapsamalıdır: gelecekteki
 * (`SCHEDULED`) veya bitmiş bir atama "şu anki sürücü" DEĞİLDİR.
 * Zaman dışarıdan verilir (saf modül).
 */
export function selectActiveAssignment(
  views: readonly AssignmentView[],
  nowMs: number,
): AssignmentView | null {
  const covering = views.filter(
    (a) =>
      (a.status === 'ACTIVE' || a.status === 'SCHEDULED') &&
      a.startsAtMs !== null && a.startsAtMs <= nowMs &&
      (a.endsAtMs === null || a.endsAtMs > nowMs),
  );
  /* Birden fazla kapsayan atama ÇAKIŞMADIR — rastgele ilki SEÇİLMEZ. */
  if (covering.length !== 1) return null;
  return covering[0];
}

/** Kapsayan atama sayısı — 0 = yok, 1 = kesin, >1 = ÇAKIŞMA. */
export function countCoveringAssignments(
  views: readonly AssignmentView[],
  nowMs: number,
): number {
  return views.filter(
    (a) =>
      (a.status === 'ACTIVE' || a.status === 'SCHEDULED') &&
      a.startsAtMs !== null && a.startsAtMs <= nowMs &&
      (a.endsAtMs === null || a.endsAtMs > nowMs),
  ).length;
}

/* ── Trip attribution görünümü ─────────────────────────────────────────── */

export interface TripAttributionRow {
  readonly driver_id?: string | null;
  readonly driver_name?: string | null;
  readonly driver_attribution_status?: string | null;
  readonly driver_attribution_source?: string | null;
  readonly driver_attribution_confidence?: string | null;
  readonly driver_attributed_at?: string | null;
  readonly driver_attribution_revision?: number | null;
}

export interface TripAttributionView {
  readonly driverId: string | null;
  readonly driverName: string | null;
  readonly status: AttributionStatus;
  readonly source: AttributionSource;
  readonly confidence: AttributionConfidence;
  readonly attributedAtMs: number | null;
  readonly revision: number | null;
  /** Bir yönetici tarafından elle düzeltildi mi. */
  readonly isManual: boolean;
}

export function buildTripAttributionView(row: TripAttributionRow): TripAttributionView {
  const status = normalizeAttributionStatus(row.driver_attribution_status);
  const source = normalizeAttributionSource(row.driver_attribution_source);
  /* Sürücü kimliği yoksa "atanmış" İDDİA EDİLEMEZ — fail-closed. */
  const driverId = text(row.driver_id);
  return {
    driverId,
    driverName: text(row.driver_name),
    status: driverId === null && status === 'ATTRIBUTED' ? 'UNKNOWN' : status,
    source,
    confidence: normalizeAttributionConfidence(row.driver_attribution_confidence),
    attributedAtMs: driverTimeMs(row.driver_attributed_at),
    revision: typeof row.driver_attribution_revision === 'number'
      && Number.isFinite(row.driver_attribution_revision)
        ? row.driver_attribution_revision : null,
    isManual: source === 'MANUAL_TRIP_ASSIGNMENT',
  };
}

/* ── Kullanıcıya dönük etiketler ───────────────────────────────────────── */

export function driverStatusLabel(s: DriverStatus): string {
  switch (s) {
    case 'ACTIVE':    return 'Aktif';
    case 'INACTIVE':  return 'Pasif';
    case 'SUSPENDED': return 'Askıda';
    case 'ARCHIVED':  return 'Arşivlenmiş';
  }
}

export function assignmentStatusLabel(s: AssignmentStatus): string {
  switch (s) {
    case 'SCHEDULED':  return 'Planlandı';
    case 'ACTIVE':     return 'Aktif';
    case 'COMPLETED':  return 'Tamamlandı';
    case 'CANCELLED':  return 'İptal edildi';
    case 'CONFLICTED': return 'Çakışmalı';
  }
}

export function assignmentSourceLabel(s: AssignmentSource): string {
  switch (s) {
    case 'FLEET_ADMIN':       return 'Filo yöneticisi';
    case 'DRIVER_SELF_SELECT':return 'Sürücü seçimi';
    case 'HEAD_UNIT_SELECT':  return 'Araç ekranı';
    case 'PHONE_HUB':         return 'Telefon';
    case 'NFC':               return 'NFC kart';
    case 'BLUETOOTH':         return 'Bluetooth';
    case 'UNKNOWN':           return 'Bilinmiyor';
  }
}

/**
 * Trip sürücüsünün kullanıcıya gösterilecek metni.
 *
 * ── ASLA ────────────────────────────────────────────────────────────────
 *   · `null` → araç sahibi          (sahip sürücü DEĞİLDİR)
 *   · `null` → son giriş yapan      (erişim sürüş DEĞİLDİR)
 *   · `UNKNOWN` → "Sürücü yok"      (bilinmiyor ≠ yok)
 *   · `CONFLICTED` → ilk sürücü     (belirsizlik gizlenemez)
 */
export function tripDriverLabel(v: TripAttributionView): string {
  switch (v.status) {
    case 'ATTRIBUTED':
    case 'LOCKED':
      return v.driverName ?? 'Sürücü kaydı bulunamadı';
    case 'CONFLICTED':
      return 'Çakışma — birden fazla sürücü atanmış';
    case 'MANUAL_REVIEW':
      return 'İnceleme gerekiyor — atama yolculuğun tamamını kapsamıyor';
    case 'UNKNOWN':
      return 'Sürücü bilinmiyor';
  }
}

export function attributionStatusLabel(s: AttributionStatus): string {
  switch (s) {
    case 'ATTRIBUTED':   return 'Atamadan belirlendi';
    case 'LOCKED':       return 'Elle atandı';
    case 'CONFLICTED':   return 'Çakışmalı';
    case 'MANUAL_REVIEW':return 'İnceleme gerekiyor';
    case 'UNKNOWN':      return 'Bilinmiyor';
  }
}

export function attributionSourceLabel(s: AttributionSource): string {
  switch (s) {
    case 'ACTIVE_ASSIGNMENT':      return 'Aktif atama';
    case 'MANUAL_TRIP_ASSIGNMENT': return 'Elle düzeltildi';
    case 'HEAD_UNIT_SELECTION':    return 'Araç ekranından seçildi';
    case 'PHONE_HUB':              return 'Telefon';
    case 'NFC':                    return 'NFC kart';
    case 'BLUETOOTH':              return 'Bluetooth';
    case 'UNKNOWN':                return 'Kaynak yok';
  }
}

export function attributionConfidenceLabel(c: AttributionConfidence): string {
  switch (c) {
    case 'VERY_HIGH': return 'Çok yüksek';
    case 'HIGH':      return 'Yüksek';
    case 'MEDIUM':    return 'Orta';
    case 'LOW':       return 'Düşük';
    case 'UNKNOWN':   return 'Bilinmiyor';
  }
}

/**
 * Ehliyet geçerlilik durumu.
 *
 * Tarih yoksa "geçerli" DENMEZ — bilinmiyor. Süresi geçmiş ehliyet
 * yöneticiye görünmelidir, ama bu bir sürüş engeli olarak UYGULANMAZ
 * (bu paket yalnız kayıt tutar, kural dayatmaz).
 */
export type LicenseValidity = 'VALID' | 'EXPIRING_SOON' | 'EXPIRED' | 'UNKNOWN';

export function licenseValidity(
  expiresAtMs: number | null,
  nowMs: number,
  soonWindowMs = 30 * 24 * 60 * 60 * 1000,
): LicenseValidity {
  if (expiresAtMs === null) return 'UNKNOWN';
  if (expiresAtMs < nowMs) return 'EXPIRED';
  if (expiresAtMs - nowMs <= soonWindowMs) return 'EXPIRING_SOON';
  return 'VALID';
}

export function licenseValidityLabel(v: LicenseValidity): string {
  switch (v) {
    case 'VALID':         return 'Geçerli';
    case 'EXPIRING_SOON': return 'Yakında doluyor';
    case 'EXPIRED':       return 'Süresi dolmuş';
    case 'UNKNOWN':       return 'Bilinmiyor';
  }
}
