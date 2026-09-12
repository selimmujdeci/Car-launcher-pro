/**
 * ARAÇ GÖRÜNEN AD — TEK OTORİTE.
 *
 * Kusur (#661): `vehicles.service.ts` plaka boşsa `plate` alanına ARAÇ UUID'sini
 * yazıyordu (`plate: vehicle.plate ?? vehicle.id`). Sonuç: kullanıcı panelinde
 * plaka yerine `5758b3dd-d210-4799-a565-0ff3f968e5af` görüyordu ve araca isim
 * verecek hiçbir yüzey yoktu.
 *
 * Kural: KİMLİK YOKSA UYDURULMAZ. UUID bir plaka DEĞİLDİR; "Araç #5758b3dd"
 * olarak, kimliğin EKSİK olduğu görünür şekilde sunulur.
 *
 * Bu dosya saf: I/O · timer · `Date.now` · global durum · React importu YOK.
 */

export interface VehicleIdentityLike {
  id: string;
  plate?: string | null;
  name?: string | null;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** UUID biçimli mi — kullanıcıya plaka diye gösterilmemesi gereken değer. */
export function isUuidLike(value: string | null | undefined): boolean {
  if (!value) return false;
  return UUID_RE.test(value.trim());
}

/** Boş / yalnız boşluk / UUID olan değerler kimlik SAYILMAZ. */
function cleanIdentity(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  /* Eşleştirme katmanının "bilinmiyor" yer tutucuları kimlik SAYILMAZ. */
  if (trimmed === '—' || trimmed === '-' || trimmed === '--') return null;
  if (isUuidLike(trimmed)) return null;
  return trimmed;
}

/** Kısa teknik referans — `#5758b3dd`. Kimlik yerine GEÇMEZ, yanında durur. */
export function vehicleShortId(id: string): string {
  const clean = (id ?? '').trim();
  if (clean.length === 0) return '#—';
  return `#${clean.slice(0, 8)}`;
}

/** Kullanıcının verdiği plaka (yoksa `null`). */
export function vehiclePlate(v: VehicleIdentityLike): string | null {
  return cleanIdentity(v.plate);
}

/** Kullanıcının verdiği isim (yoksa `null`). Varsayılan "Araç" isim SAYILMAZ. */
export function vehicleName(v: VehicleIdentityLike): string | null {
  const name = cleanIdentity(v.name);
  if (name === null) return null;
  return name === 'Araç' ? null : name;
}

/** Kullanıcı araca isim ya da plaka verdi mi? */
export function hasVehicleIdentity(v: VehicleIdentityLike): boolean {
  return vehiclePlate(v) !== null || vehicleName(v) !== null;
}

/**
 * Birincil başlık: plaka → isim → `Araç #kısaid`.
 * UUID ASLA başlık olarak dönmez.
 */
export function vehicleTitle(v: VehicleIdentityLike): string {
  return vehiclePlate(v) ?? vehicleName(v) ?? `Araç ${vehicleShortId(v.id)}`;
}

/**
 * İkincil satır: başlık plakaysa isim, başlık isimse `#kısaid`,
 * hiç kimlik yoksa `null` (yer kaplayan boş metin YOK).
 */
export function vehicleSubtitle(v: VehicleIdentityLike): string | null {
  const plate = vehiclePlate(v);
  const name  = vehicleName(v);
  if (plate !== null) return name ?? vehicleShortId(v.id);
  if (name !== null)  return vehicleShortId(v.id);
  return null;
}

/** Başlık gerçek kimlik mi, yoksa `Araç #…` yedeği mi? */
export function isFallbackTitle(v: VehicleIdentityLike): boolean {
  return !hasVehicleIdentity(v);
}

/** Koordinat metni — sabit 5 hane (~1 m çözünürlük), uydurma hassasiyet YOK. */
export function formatCoords(lat: number, lng: number): string {
  return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
}

export const IDENTITY_LIMITS = {
  PLATE_MAX: 16,
  NAME_MAX: 40,
  DRIVER_MAX: 40,
} as const;

export interface IdentityPatch {
  plate?: string | null;
  name?: string | null;
  driver?: string | null;
}

export type IdentityValidation =
  | { ok: true; patch: { plate: string | null; name: string | null; driver_name: string | null } }
  | { ok: false; error: string };

/**
 * Kullanıcı girdisini doğrular. Boş bırakılan alan `null` olur (silme),
 * UUID girilmesi REDDEDİLİR (kimlik alanına teknik kimlik yazılamaz).
 */
export function validateIdentityPatch(patch: IdentityPatch): IdentityValidation {
  const plate  = typeof patch.plate  === 'string' ? patch.plate.trim()  : patch.plate  ?? null;
  const name   = typeof patch.name   === 'string' ? patch.name.trim()   : patch.name   ?? null;
  const driver = typeof patch.driver === 'string' ? patch.driver.trim() : patch.driver ?? null;

  if (plate && plate.length > IDENTITY_LIMITS.PLATE_MAX) {
    return { ok: false, error: `Plaka en fazla ${IDENTITY_LIMITS.PLATE_MAX} karakter olabilir.` };
  }
  if (name && name.length > IDENTITY_LIMITS.NAME_MAX) {
    return { ok: false, error: `İsim en fazla ${IDENTITY_LIMITS.NAME_MAX} karakter olabilir.` };
  }
  if (driver && driver.length > IDENTITY_LIMITS.DRIVER_MAX) {
    return { ok: false, error: `Sürücü adı en fazla ${IDENTITY_LIMITS.DRIVER_MAX} karakter olabilir.` };
  }
  if (isUuidLike(plate) || isUuidLike(name)) {
    return { ok: false, error: 'Plaka veya isim alanına araç kimliği (UUID) yazılamaz.' };
  }
  if (!plate && !name) {
    return { ok: false, error: 'En az bir alan doldurulmalı: plaka veya isim.' };
  }

  return {
    ok: true,
    patch: {
      plate:       plate  && plate.length  > 0 ? plate  : null,
      name:        name   && name.length   > 0 ? name   : null,
      driver_name: driver && driver.length > 0 ? driver : null,
    },
  };
}
