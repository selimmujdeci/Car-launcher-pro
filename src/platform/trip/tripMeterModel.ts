/**
 * tripMeterModel.ts — RESETLENEBİLİR YOL SAYACI'nın SAF modeli (P0 · AŞAMA A).
 *
 * SAF: I/O yok · timer yok · `Date.now()` yok · React importu YOK · global durum
 * yok. Zaman DAİMA çağırandan parametre gelir (`nowMs`) → gerçek birim testi
 * mümkün.
 *
 * ── KANONİK MESAFE OTORİTESİ ─────────────────────────────────────────────
 * Bu dosya YENİ bir mesafe motoru DEĞİLDİR. Tek mesafe kaynağı
 * `useUnifiedVehicleStore.odometer`dir (GPS haversine + OdometerGuard ile
 * beslenen kümülatif km — zaten monotonicity guard'lı ve persist edilir).
 * Yol sayacı yalnızca `odometer − baseline` FARKIDIR. Emsal desen:
 * `src/platform/fieldValidation/longRoadModel.ts` → `OdometryLedger`.
 *
 * ── PAZARLIKSIZ KURALLAR ────────────────────────────────────────────────
 *  1. Negatif delta (odometre geriledi / GPS sıçraması) ASLA mesafeye EKLENMEZ.
 *  2. Bilinmeyen/geçersiz (`null`/`NaN`/negatif) odometre → kayıt DEĞİŞMEDEN
 *     döner; sahte `0` YAZILMAZ.
 *  3. Reset yalnız `distanceKm` ve zaman/baz alanlarını sıfırlar — `meterId`
 *     KALICI KİMLİKTİR, reset'te DEĞİŞMEZ.
 *  4. Bozuk kalıcı kayıt (`parseTripMeter`) fail-closed: kısmi kurtarma YAPILMAZ,
 *     boş sayaca dönülür.
 */

export const TRIP_METER_STATES = ['READY', 'NO_DISTANCE_SOURCE', 'RESTORING', 'CORRUPT', 'UNAVAILABLE'] as const;
export type TripMeterState = (typeof TRIP_METER_STATES)[number];

export const TRIP_METER_PERSISTENCE_VERSION = 1;

export type TripMeterDistanceSource = 'UNIFIED_ODOMETER' | 'UNAVAILABLE';
export type TripMeterConfidence = 'HIGH' | 'MEDIUM' | 'UNKNOWN';

export interface TripMeterRecord {
  readonly meterId: string;                    // kalıcı kimlik (reset'te DEĞİŞMEZ)
  readonly distanceKm: number;                  // son sıfırlamadan beri birikmiş km (>= 0)
  readonly baselineOdometerKm: number | null;    // farkın dayandığı odometre; null = henüz kaynak görülmedi
  readonly lastOdometerKm: number | null;
  readonly startedAtMs: number | null;           // son reset anı (epoch ms)
  readonly lastUpdatedAtMs: number | null;
  readonly resetCount: number;
  readonly distanceSource: TripMeterDistanceSource;
  readonly confidence: TripMeterConfidence;
  readonly state: TripMeterState;
  readonly persistenceVersion: number;
}

/** Boş sayaç — henüz hiç odometre kaynağı görmemiş. Şablon nesne: sabit alan sırası (V8 hidden-class). */
export function emptyTripMeter(meterId: string): TripMeterRecord {
  return {
    meterId,
    distanceKm: 0,
    baselineOdometerKm: null,
    lastOdometerKm: null,
    startedAtMs: null,
    lastUpdatedAtMs: null,
    resetCount: 0,
    distanceSource: 'UNAVAILABLE',
    confidence: 'UNKNOWN',
    state: 'NO_DISTANCE_SOURCE',
    persistenceVersion: TRIP_METER_PERSISTENCE_VERSION,
  };
}

/**
 * Yol sayacını tek bir odometre okumasıyla ilerletir (SAF).
 *
 * - `odometerKm` sonlu/negatif-değilse → kayıt DEĞİŞMEDEN döner.
 * - Baz (`baselineOdometerKm`) `null` ise → yalnız TOHUMLAMA (restore sonrası
 *   ilk kaynak görülmesi); `distanceKm` KORUNUR, artırılmaz.
 * - delta < 0 (odometre geriledi) → fail-soft yeniden tohumlama: mesafe
 *   eklenmez, baz kaydırılır, `confidence` MEDIUM'a düşer.
 * - delta === 0 → yalnız `lastUpdatedAtMs` güncellenir.
 * - delta > 0 → `distanceKm` artar, `confidence` HIGH.
 */
export function advanceTripMeter(
  rec: TripMeterRecord,
  odometerKm: number | null,
  nowMs: number,
): TripMeterRecord {
  if (odometerKm === null || !Number.isFinite(odometerKm) || odometerKm < 0) {
    return rec;
  }
  const validNow = Number.isFinite(nowMs);
  const nextUpdatedAt = validNow ? nowMs : rec.lastUpdatedAtMs;

  // İlk kaynak görülmesi / restore sonrası tohumlama — distanceKm KORUNUR.
  if (rec.baselineOdometerKm === null) {
    return {
      meterId: rec.meterId,
      distanceKm: rec.distanceKm,
      baselineOdometerKm: odometerKm,
      lastOdometerKm: odometerKm,
      startedAtMs: rec.startedAtMs,
      lastUpdatedAtMs: nextUpdatedAt,
      resetCount: rec.resetCount,
      distanceSource: 'UNIFIED_ODOMETER',
      confidence: 'HIGH',
      state: 'READY',
      persistenceVersion: rec.persistenceVersion,
    };
  }

  const lastOdo = rec.lastOdometerKm === null ? odometerKm : rec.lastOdometerKm;
  const delta = odometerKm - lastOdo;

  if (delta < 0) {
    // Fail-soft yeniden tohumlama: negatif ASLA eklenmez, baz yeni değere kaydırılır.
    return {
      meterId: rec.meterId,
      distanceKm: rec.distanceKm,
      baselineOdometerKm: odometerKm - rec.distanceKm,
      lastOdometerKm: odometerKm,
      startedAtMs: rec.startedAtMs,
      lastUpdatedAtMs: nextUpdatedAt,
      resetCount: rec.resetCount,
      distanceSource: 'UNIFIED_ODOMETER',
      confidence: 'MEDIUM',
      state: 'READY',
      persistenceVersion: rec.persistenceVersion,
    };
  }

  if (delta === 0) {
    if (!validNow) return rec; // gerçekten hiçbir şey değişmedi
    return { ...rec, lastUpdatedAtMs: nowMs };
  }

  return {
    meterId: rec.meterId,
    distanceKm: rec.distanceKm + delta,
    baselineOdometerKm: rec.baselineOdometerKm,
    lastOdometerKm: odometerKm,
    startedAtMs: rec.startedAtMs,
    lastUpdatedAtMs: nextUpdatedAt,
    resetCount: rec.resetCount,
    distanceSource: 'UNIFIED_ODOMETER',
    confidence: 'HIGH',
    state: 'READY',
    persistenceVersion: rec.persistenceVersion,
  };
}

/**
 * Sayacı sıfırlar. `meterId` AYNI KALIR — bu bir kimlik DEĞİL, birikim sıfırlamasıdır.
 * `odometerKm` o an okunamıyorsa (null/geçersiz) baz `null` kalır ve durum
 * `NO_DISTANCE_SOURCE`'a döner (bir sonraki geçerli okuma yeniden tohumlar).
 */
export function resetTripMeter(
  rec: TripMeterRecord,
  odometerKm: number | null,
  nowMs: number,
): TripMeterRecord {
  const validOdo = odometerKm !== null && Number.isFinite(odometerKm) && odometerKm >= 0;
  const validNow = Number.isFinite(nowMs);

  return {
    meterId: rec.meterId,
    distanceKm: 0,
    baselineOdometerKm: validOdo ? odometerKm : null,
    lastOdometerKm: validOdo ? odometerKm : null,
    startedAtMs: validNow ? nowMs : null,
    lastUpdatedAtMs: validNow ? nowMs : null,
    resetCount: rec.resetCount + 1,
    distanceSource: validOdo ? 'UNIFIED_ODOMETER' : 'UNAVAILABLE',
    confidence: validOdo ? 'HIGH' : 'UNKNOWN',
    state: validOdo ? 'READY' : 'NO_DISTANCE_SOURCE',
    persistenceVersion: rec.persistenceVersion,
  };
}

const _DISTANCE_SOURCES: ReadonlySet<string> = new Set<TripMeterDistanceSource>(['UNIFIED_ODOMETER', 'UNAVAILABLE']);
const _CONFIDENCES: ReadonlySet<string> = new Set<TripMeterConfidence>(['HIGH', 'MEDIUM', 'UNKNOWN']);

/** `null` → geçerli boş değer · sonlu sayı → geçerli · her şey diğeri → BOZUK işareti (`undefined`). */
function _readNullableFinite(v: unknown): number | null | undefined {
  if (v === null) return null;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  return undefined;
}

export interface ParseTripMeterResult {
  readonly record: TripMeterRecord;
  readonly restoreState: 'RESTORED' | 'CORRUPT' | 'EMPTY';
}

/**
 * Kalıcı depodan okunan ham veriyi ayrıştırır — FAIL-CLOSED: herhangi bir alan
 * geçersizse/uyumsuzsa, KISMİ KURTARMA YAPILMAZ; boş sayaç + `CORRUPT` döner.
 */
export function parseTripMeter(raw: unknown, fallbackMeterId: string): ParseTripMeterResult {
  if (raw === null || raw === undefined) {
    return { record: emptyTripMeter(fallbackMeterId), restoreState: 'EMPTY' };
  }
  if (typeof raw !== 'object') {
    return { record: emptyTripMeter(fallbackMeterId), restoreState: 'CORRUPT' };
  }

  const r = raw as Record<string, unknown>;
  const corrupt = (): ParseTripMeterResult => ({ record: emptyTripMeter(fallbackMeterId), restoreState: 'CORRUPT' });

  if (r.persistenceVersion !== TRIP_METER_PERSISTENCE_VERSION) return corrupt();
  if (typeof r.meterId !== 'string' || r.meterId.length === 0) return corrupt();
  if (typeof r.distanceKm !== 'number' || !Number.isFinite(r.distanceKm) || r.distanceKm < 0) return corrupt();
  if (typeof r.resetCount !== 'number' || !Number.isInteger(r.resetCount) || r.resetCount < 0) return corrupt();
  if (typeof r.distanceSource !== 'string' || !_DISTANCE_SOURCES.has(r.distanceSource)) return corrupt();
  if (typeof r.confidence !== 'string' || !_CONFIDENCES.has(r.confidence)) return corrupt();
  if (typeof r.state !== 'string' || !(TRIP_METER_STATES as readonly string[]).includes(r.state)) return corrupt();

  const baselineOdometerKm = _readNullableFinite(r.baselineOdometerKm);
  if (baselineOdometerKm === undefined) return corrupt();
  const lastOdometerKm = _readNullableFinite(r.lastOdometerKm);
  if (lastOdometerKm === undefined) return corrupt();
  const startedAtMs = _readNullableFinite(r.startedAtMs);
  if (startedAtMs === undefined) return corrupt();
  const lastUpdatedAtMs = _readNullableFinite(r.lastUpdatedAtMs);
  if (lastUpdatedAtMs === undefined) return corrupt();

  return {
    record: {
      meterId: r.meterId,
      distanceKm: r.distanceKm,
      baselineOdometerKm,
      lastOdometerKm,
      startedAtMs,
      lastUpdatedAtMs,
      resetCount: r.resetCount,
      distanceSource: r.distanceSource as TripMeterDistanceSource,
      confidence: r.confidence as TripMeterConfidence,
      state: r.state as TripMeterState,
      persistenceVersion: r.persistenceVersion as number,
    },
    restoreState: 'RESTORED',
  };
}

/** tr-TR biçimi, tam 1 ondalık: `128,4` · `1.248,6`. Eski WebView'de Intl yoksa manuel fallback. */
export function formatTripMeterKm(km: number | null): string {
  if (km === null || !Number.isFinite(km)) return '—';

  try {
    if (typeof Intl !== 'undefined' && typeof Intl.NumberFormat === 'function') {
      return new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(km);
    }
  } catch { /* aşağıdaki manuel fallback'e düş */ }

  return _manualTrFormat(km);
}

/** Intl olmayan eski WebView'ler için manuel tr-TR biçimlendirme (binlik nokta, ondalık virgül). */
function _manualTrFormat(km: number): string {
  const rounded = Math.round(km * 10) / 10;
  const fixed = rounded.toFixed(1); // örn. "-12.3" / "1248.6"
  const negative = fixed.startsWith('-');
  const abs = negative ? fixed.slice(1) : fixed;
  const [intPart, decPart] = abs.split('.');
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${negative ? '-' : ''}${grouped},${decPart}`;
}

export type TripMeterResetReason = 'PARKED' | 'MOVING' | 'SPEED_UNKNOWN';

/**
 * Reset kapısı için hızın DENKLİK SINIFI: `null` (bilinmiyor) · `0` (park) ·
 * `1` (hareket). Ana ekranda ham `speed` 10-20Hz akar; bileşen ham hıza abone
 * olursa satır saniyede onlarca kez yeniden render olur (CLAUDE.md §3 Render
 * Control). Bu fonksiyon hızı kapı açısından AYNI anlama gelen üç değere
 * indirger → seçici yalnız kapı sınıfı DEĞİŞİNCE yeni değer üretir.
 *
 * `canResetTripMeter(tripMeterGateSpeed(v)) === canResetTripMeter(v)` her v için.
 */
export function tripMeterGateSpeed(speedKmh: number | null): number | null {
  if (speedKmh === null || !Number.isFinite(speedKmh)) return null;
  return speedKmh === 0 ? 0 : 1;
}

/**
 * Reset güvenlik kapısı — FAIL-CLOSED: hız bilinmiyorsa reset REDDEDİLİR.
 * `speedKmh === null` (UnifiedVehicleStore sözleşmesinde "sensör yok") veya
 * sonlu değilse → `SPEED_UNKNOWN`. Yalnız tam park (`0`) izinlidir.
 */
export function canResetTripMeter(speedKmh: number | null): { allowed: boolean; reason: TripMeterResetReason } {
  if (speedKmh === null || !Number.isFinite(speedKmh)) {
    return { allowed: false, reason: 'SPEED_UNKNOWN' };
  }
  if (speedKmh === 0) return { allowed: true, reason: 'PARKED' };
  return { allowed: false, reason: 'MOVING' };
}

const _STATE_LABEL: Readonly<Record<TripMeterState, string>> = {
  READY:               'HAZIR',
  NO_DISTANCE_SOURCE:  'MESAFE KAYNAĞI YOK',
  RESTORING:           'GERİ YÜKLENİYOR',
  CORRUPT:             'BOZUK KAYIT',
  UNAVAILABLE:         'KULLANILAMIYOR',
};

export function tripMeterStateLabel(s: TripMeterState): string {
  return _STATE_LABEL[s] ?? 'BİLİNMİYOR';
}
