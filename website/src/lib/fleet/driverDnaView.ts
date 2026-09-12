/**
 * driverDnaView.ts — SÜRÜCÜ DNA GÖRÜNÜM MODELİ (SAF).
 *
 * ── CEVAPLANAN SORU ───────────────────────────────────────────────────
 * Araç ve sürücü detayında: **"Bu sürücünün sürüş karakteri hakkında ne
 * KANITLANDI — ve ne kadarı hâlâ bilinmiyor?"**
 *
 * ── BU BİR PUAN KARTI DEĞİLDİR ────────────────────────────────────────
 * Not verilmez, sıralanmaz, "iyi/kötü sürücü" etiketi üretilmez. Kart,
 * kanıtın NE KADAR olduğunu ve NEREDE OLMADIĞINI gösterir.
 *
 * ── İKİ OTORİTE YASAĞI (BAĞLAYICI) ────────────────────────────────────
 * Metrik FORMÜLLERİ burada YENİDEN YAZILMAZ. Sunucu (migration 053)
 * yalnız **kanıt birikimini** döndürür; bu katman da yalnız TANIMSAL
 * oranları (toplam ÷ mesafe) gösterir. Karakter metriklerinin tek
 * otoritesi `src/platform/fleet/driverDnaEngine.ts`'tir ve o motor
 * buraya KOPYALANMAZ — kopyalansaydı iki ayrı "gerçek" oluşurdu.
 *
 * SAF: I/O YOK · timer YOK · `Date.now()` YOK · React YOK.
 */

/* ── Sözleşme (053 ile birebir) ────────────────────────────────────────── */

export const DNA_STATUSES = ['NO_DNA', 'FORMING', 'ACTIVE'] as const;
export type DnaStatus = (typeof DNA_STATUSES)[number];

export const DNA_LEARNING_LEVELS =
  ['NONE', 'NASCENT', 'DEVELOPING', 'ESTABLISHED', 'MATURE'] as const;
export type DnaLearningLevel = (typeof DNA_LEARNING_LEVELS)[number];

export const DNA_DRIFT_STATES = ['STABLE', 'DRIFTING', 'INSUFFICIENT'] as const;
export type DnaDriftState = (typeof DNA_DRIFT_STATES)[number];

/** `get_driver_dna()` satırı — alanlar eksik/bozuk gelebilir (savunmacı). */
export interface DriverDnaRow {
  readonly driver_id?: string | null;
  readonly status?: string | null;
  readonly learning_level?: string | null;
  readonly trip_count?: number | null;
  readonly total_distance_km?: number | string | null;
  readonly first_trip_at?: string | null;
  readonly last_trip_at?: string | null;
  readonly brake_sum?: number | string | null;
  readonly brake_count?: number | null;
  readonly brake_km?: number | string | null;
  readonly brake_measured_only?: boolean | null;
  readonly accel_sum?: number | string | null;
  readonly accel_count?: number | null;
  readonly accel_km?: number | string | null;
  readonly accel_measured_only?: boolean | null;
  readonly fuel_sum?: number | string | null;
  readonly fuel_count?: number | null;
  readonly fuel_km?: number | string | null;
  readonly idle_sum?: number | string | null;
  readonly idle_count?: number | null;
  readonly moving_sum?: number | string | null;
  readonly drift_state?: string | null;
  readonly drift_relative_change?: number | string | null;
  readonly integrity_state?: string | null;
  readonly retracted_trip_count?: number | null;
  readonly revision?: number | null;
  readonly updated_at?: string | null;
}

/** Kartta gösterilen TANIMSAL oran — formül değil, bölme. */
export interface DnaRate {
  readonly label: string;
  /** `null` = kanıt yok (0 DEĞİL). */
  readonly value: number | null;
  readonly unit: string;
  readonly provenance: 'MEASURED' | 'DERIVED' | 'UNKNOWN';
  readonly sampleCount: number;
}

export interface DriverDnaView {
  readonly present: boolean;
  readonly status: DnaStatus;
  readonly learningLevel: DnaLearningLevel;
  readonly tripCount: number | null;
  readonly totalDistanceKm: number | null;
  readonly firstTripAtMs: number | null;
  readonly lastTripAtMs: number | null;
  readonly driftState: DnaDriftState;
  readonly driftRelativeChange: number | null;
  readonly rates: readonly DnaRate[];
  /** Kaç oran bilinmiyor — dürüstlüğün ana göstergesi. */
  readonly unknownRateCount: number;
  /** Sürücü değişimi nedeniyle katkı geri alındı mı (gizlenmez). */
  readonly retracted: boolean;
  readonly retractedTripCount: number;
  readonly revision: number | null;
  readonly updatedAtMs: number | null;
  /** DNA yoksa NEDEN yok — sessiz boşluk YOK. */
  readonly absentReason: 'NO_ROW' | 'BELOW_THRESHOLD' | null;
}

export const EMPTY_DNA_VIEW: DriverDnaView = Object.freeze({
  present: false, status: 'NO_DNA', learningLevel: 'NONE',
  tripCount: null, totalDistanceKm: null,
  firstTripAtMs: null, lastTripAtMs: null,
  driftState: 'INSUFFICIENT', driftRelativeChange: null,
  rates: Object.freeze([]) as readonly DnaRate[],
  unknownRateCount: 0, retracted: false, retractedTripCount: 0,
  revision: null, updatedAtMs: null, absentReason: 'NO_ROW',
});

/* ── Savunmacı daraltma ────────────────────────────────────────────────── */

function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim().length > 0) {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function ms(v: unknown): number | null {
  if (typeof v !== 'string' || v.length === 0) return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : null;
}

function oneOf<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  return typeof v === 'string' && (allowed as readonly string[]).includes(v)
    ? (v as T) : fallback;
}

/**
 * 100 km başına oran — kanıt mesafesi yoksa `null` (sahte `0` YOK).
 *
 * ⚠️ Bu bir MODEL değildir: "toplam ÷ mesafe" tanımın kendisidir. Karakter
 * metrikleri (agresiflik, mekanik duyarlılık…) BURADA hesaplanmaz.
 */
function per100Km(
  label: string, sum: unknown, count: unknown, km: unknown,
  measuredOnly: unknown,
): DnaRate {
  const s = num(sum);
  const c = num(count) ?? 0;
  const d = num(km) ?? 0;
  if (s === null || c <= 0 || d <= 0) {
    return { label, value: null, unit: '/100km', provenance: 'UNKNOWN', sampleCount: c };
  }
  return {
    label, value: (s / d) * 100, unit: '/100km',
    provenance: measuredOnly === false ? 'DERIVED' : 'MEASURED',
    sampleCount: c,
  };
}

/**
 * Sunucu satırını görünüm modeline çevirir.
 *
 * Satır yoksa veya eşik altındaysa **DNA GÖSTERİLMEZ** ve nedeni yazılır —
 * yarım bir DNA, kullanıcıya kanıt gibi sunulan bir tahmindir.
 */
export function buildDriverDnaView(row: DriverDnaRow | null | undefined): DriverDnaView {
  if (row === null || row === undefined) return EMPTY_DNA_VIEW;

  const status = oneOf(row.status, DNA_STATUSES, 'NO_DNA');
  const tripCount = num(row.trip_count);
  const totalDistanceKm = num(row.total_distance_km);

  if (status === 'NO_DNA') {
    return {
      ...EMPTY_DNA_VIEW,
      tripCount, totalDistanceKm,
      learningLevel: oneOf(row.learning_level, DNA_LEARNING_LEVELS, 'NONE'),
      revision: num(row.revision), updatedAtMs: ms(row.updated_at),
      absentReason: 'BELOW_THRESHOLD',
    };
  }

  const idleSum = num(row.idle_sum);
  const movingSum = num(row.moving_sum);
  const idleCount = num(row.idle_count) ?? 0;
  const idleTotal = (idleSum ?? 0) + (movingSum ?? 0);

  const fuelSum = num(row.fuel_sum);
  const fuelKm = num(row.fuel_km) ?? 0;
  const fuelCount = num(row.fuel_count) ?? 0;

  const rates: DnaRate[] = [
    per100Km('Sert fren', row.brake_sum, row.brake_count, row.brake_km,
             row.brake_measured_only),
    per100Km('Sert hızlanma', row.accel_sum, row.accel_count, row.accel_km,
             row.accel_measured_only),
    fuelSum === null || fuelKm <= 0 || fuelCount <= 0
      ? { label: 'Yakıt', value: null, unit: 'L/100km',
          provenance: 'UNKNOWN' as const, sampleCount: fuelCount }
      : { label: 'Yakıt', value: (fuelSum / fuelKm) * 100, unit: 'L/100km',
          provenance: 'MEASURED' as const, sampleCount: fuelCount },
    idleCount <= 0 || idleTotal <= 0 || idleSum === null
      ? { label: 'Rölanti payı', value: null, unit: '',
          provenance: 'UNKNOWN' as const, sampleCount: idleCount }
      : { label: 'Rölanti payı', value: idleSum / idleTotal, unit: '',
          provenance: 'MEASURED' as const, sampleCount: idleCount },
  ];

  return {
    present: true,
    status,
    learningLevel: oneOf(row.learning_level, DNA_LEARNING_LEVELS, 'NONE'),
    tripCount, totalDistanceKm,
    firstTripAtMs: ms(row.first_trip_at),
    lastTripAtMs: ms(row.last_trip_at),
    driftState: oneOf(row.drift_state, DNA_DRIFT_STATES, 'INSUFFICIENT'),
    driftRelativeChange: num(row.drift_relative_change),
    rates,
    unknownRateCount: rates.filter((r) => r.provenance === 'UNKNOWN').length,
    retracted: row.integrity_state === 'RETRACTED',
    retractedTripCount: num(row.retracted_trip_count) ?? 0,
    revision: num(row.revision),
    updatedAtMs: ms(row.updated_at),
    absentReason: null,
  };
}

/* ── Etiketler ─────────────────────────────────────────────────────────── */

export function dnaStatusLabel(s: DnaStatus): string {
  switch (s) {
    case 'NO_DNA':  return 'Henüz oluşmadı';
    case 'FORMING': return 'Oluşuyor';
    case 'ACTIVE':  return 'Aktif';
  }
}

export function dnaLearningLevelLabel(l: DnaLearningLevel): string {
  switch (l) {
    case 'NONE':        return 'Henüz yok';
    case 'NASCENT':     return 'Yeni oluşuyor';
    case 'DEVELOPING':  return 'Gelişiyor';
    case 'ESTABLISHED': return 'Oturmuş';
    case 'MATURE':      return 'Olgun';
  }
}

export function dnaDriftLabel(d: DnaDriftState): string {
  switch (d) {
    case 'STABLE':       return 'Kararlı';
    case 'DRIFTING':     return 'Değişim var';
    case 'INSUFFICIENT': return 'Yeterli veri yok';
  }
}

/** DNA neden yok — kullanıcıya dürüst açıklama (boş kart YOK). */
export function dnaAbsenceExplanation(v: DriverDnaView): string | null {
  if (v.present) return null;
  if (v.absentReason === 'BELOW_THRESHOLD') {
    return 'Karakter oluşması için yeterli yolculuk birikmedi. '
         + 'Az veriden karakter çıkarmak tahmin olurdu, bu yüzden gösterilmiyor.';
  }
  return 'Bu sürücü için henüz hiç yolculuk kaydı işlenmedi.';
}
