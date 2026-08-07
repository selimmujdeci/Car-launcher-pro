/**
 * tripCostModel.ts — YAKIT MALİYETİ VE KANITA DAYALI CONFIDENCE (SAF).
 *
 * ── §4 MALİYET KURALI ─────────────────────────────────────────────────
 * `cost = fuelUsed × unitPrice` — **başka hiçbir yol yok.**
 *
 * Birim fiyat yoksa `cost = null` / `UNAVAILABLE`. Sabit global fiyat
 * (bugünkü `45 TL/L`) **gerçek maliyet gibi kullanılamaz**: yalnız açıkça
 * `ESTIMATED` etiketli, kaynağı/para birimi/snapshot anı belirtilmiş bir
 * varsayılan olarak kalabilir.
 *
 * **Fiyat SNAPSHOT'tır.** Trip kapandıktan sonra birim fiyat değişirse
 * geçmiş trip maliyeti DEĞİŞMEZ — snapshot trip ile birlikte saklanır.
 * Aksi halde geçen ayın raporu bu ayın fiyatıyla yeniden yazılır ve
 * Cost Analysis geçmişi sessizce bozulur.
 *
 * ── §9 CONFIDENCE KURALI ──────────────────────────────────────────────
 * Confidence tek sezgisel sayı DEĞİL: bağımsız kanıtlardan türer ve
 * **en zayıf kritik kanıt tavanı belirler**. Yakıt güveni mesafe
 * güveninden AYRI tutulur — OBD yokluğu mesafeyi geçersiz KILMAZ.
 *
 * SAF: I/O YOK · timer YOK · `Date.now()` YOK · React YOK.
 */

import type { MetricSource } from './tripCanonicalModel';
import type { CoverageReport } from './tripMetricsAccumulator';

/* ── Birim fiyat kaynağı ───────────────────────────────────────────────── */

export const PRICE_SOURCES = [
  'USER_DEFINED',      // kullanıcı ayarladı → maliyet DERIVED
  'DEFAULT_FALLBACK',  // uygulama varsayılanı → maliyet ESTIMATED
  'UNAVAILABLE',       // fiyat yok → maliyet null
] as const;
export type PriceSource = (typeof PRICE_SOURCES)[number];

/**
 * Trip başlangıcında alınan fiyat anlık görüntüsü.
 *
 * `currency` ZORUNLU: para birimi olmayan bir tutar Cost Analysis'te
 * anlamsızdır ve farklı para birimleri sessizce toplanır.
 */
export interface PriceSnapshot {
  /** Birim fiyat (para birimi / litre). Bilinmiyorsa `null`. */
  readonly unitPrice: number | null;
  readonly currency: string | null;
  readonly source: PriceSource;
  /** Snapshot anı (epoch ms) — trip başlangıcında alınır. */
  readonly capturedAtMs: number | null;
}

export const UNAVAILABLE_PRICE: PriceSnapshot = Object.freeze({
  unitPrice: null, currency: null, source: 'UNAVAILABLE', capturedAtMs: null,
});

/**
 * Uygulamanın bugünkü sabiti — **varsayılan fallback**, gerçek fiyat DEĞİL.
 *
 * `tripLogService.FUEL_PRICE_TL_PER_L = 45` değerinin kaynağı: kodda
 * doğrudan yazılmış sabit. Araç profiline, kullanıcı ayarına veya herhangi
 * bir fiyat servisine BAĞLI DEĞİL. Bu yüzden kullanıldığında maliyet
 * daima `ESTIMATED`'dır.
 */
export const DEFAULT_FUEL_PRICE = Object.freeze({
  unitPrice: 45,
  currency: 'TRY',
  source: 'DEFAULT_FALLBACK' as PriceSource,
});

/** Makul birim fiyat aralığı — dışı kullanıcı girdi hatası. */
const PRICE_RANGE = { min: 0.01, max: 1_000 } as const;

/**
 * Fiyat anlık görüntüsü kurar.
 *
 * Kullanıcı fiyatı GEÇERLİYSE `USER_DEFINED`; yoksa varsayılan `ESTIMATED`
 * olarak işaretlenir. `allowFallback=false` ise fiyat üretilmez (maliyet
 * `null` olur) — "fiyat bilmiyorum" demek uydurmaktan iyidir.
 */
export function capturePriceSnapshot(input: {
  userUnitPrice?: number | null;
  userCurrency?: string | null;
  nowMs: number;
  allowFallback?: boolean;
}): PriceSnapshot {
  const p = input.userUnitPrice;
  const valid = typeof p === 'number' && Number.isFinite(p)
    && p >= PRICE_RANGE.min && p <= PRICE_RANGE.max;

  if (valid) {
    const cur = typeof input.userCurrency === 'string' && input.userCurrency.trim().length > 0
      ? input.userCurrency.trim().toUpperCase()
      : DEFAULT_FUEL_PRICE.currency;   // para birimi eksikse yerel varsayılan
    return {
      unitPrice: p as number,
      currency: cur,
      source: 'USER_DEFINED',
      capturedAtMs: Number.isFinite(input.nowMs) ? input.nowMs : null,
    };
  }

  if (input.allowFallback === false) return UNAVAILABLE_PRICE;

  return {
    unitPrice: DEFAULT_FUEL_PRICE.unitPrice,
    currency: DEFAULT_FUEL_PRICE.currency,
    source: 'DEFAULT_FALLBACK',
    capturedAtMs: Number.isFinite(input.nowMs) ? input.nowMs : null,
  };
}

/* ── Maliyet hesabı ────────────────────────────────────────────────────── */

export interface CostResult {
  /** Tutar; hesaplanamadıysa `null`. */
  readonly cost: number | null;
  readonly currency: string | null;
  readonly source: MetricSource;
  /** Neden hesaplanamadı — sessiz `null` YOK. */
  readonly reason: CostRejectReason | null;
}

export type CostRejectReason = 'NO_FUEL' | 'NO_PRICE';

/**
 * `cost = fuelUsedL × unitPrice`.
 *
 * Kaynak zinciri **en zayıf halkaya** düşer:
 *   · yakıt `MEASURED` + fiyat `USER_DEFINED` → `DERIVED`
 *     (çarpım her zaman türetmedir; "ölçülmüş maliyet" diye bir şey yoktur)
 *   · yakıt veya fiyat `ESTIMATED` → `ESTIMATED`
 *   · biri yoksa → `null` + `UNAVAILABLE`
 */
export function computeTripCost(input: {
  fuelUsedL: number | null;
  fuelSource: MetricSource;
  price: PriceSnapshot;
}): CostResult {
  const { fuelUsedL, fuelSource, price } = input;

  if (fuelUsedL === null || !Number.isFinite(fuelUsedL) || fuelUsedL < 0) {
    return { cost: null, currency: price.currency, source: 'UNAVAILABLE', reason: 'NO_FUEL' };
  }
  if (price.unitPrice === null || price.source === 'UNAVAILABLE') {
    return { cost: null, currency: null, source: 'UNAVAILABLE', reason: 'NO_PRICE' };
  }

  const cost = Math.round(fuelUsedL * price.unitPrice * 100) / 100;

  /* Zincirde TEK bir tahmin varsa sonuç tahminidir. */
  const estimated = fuelSource === 'ESTIMATED' || price.source === 'DEFAULT_FALLBACK';

  return {
    cost,
    currency: price.currency,
    source: estimated ? 'ESTIMATED' : 'DERIVED',
    reason: null,
  };
}

/* ── §9 Kanıta dayalı confidence ───────────────────────────────────────── */

export const TRIP_CONFIDENCE_LEVELS = ['VERY_HIGH', 'HIGH', 'MEDIUM', 'LOW', 'UNKNOWN'] as const;
export type TripConfidenceLevel = (typeof TRIP_CONFIDENCE_LEVELS)[number];

const ORDER: readonly TripConfidenceLevel[] =
  ['UNKNOWN', 'LOW', 'MEDIUM', 'HIGH', 'VERY_HIGH'];

/** İki güvenin DAHA ZAYIFINI verir (en zayıf kritik kanıt kuralı). */
export function weakestConfidence(
  a: TripConfidenceLevel,
  b: TripConfidenceLevel,
): TripConfidenceLevel {
  return ORDER.indexOf(a) <= ORDER.indexOf(b) ? a : b;
}

export interface ConfidenceEvidence {
  readonly coverage: CoverageReport;
  readonly distanceSource: MetricSource;
  readonly durationSource: MetricSource;
  /** Trip kapanışı düzgün mü (idle penceresi doldu) yoksa kesildi mi. */
  readonly cleanClose: boolean;
  /** Toplam trip süresi (ms) — boşluk oranı için. */
  readonly durationMs: number | null;
}

export interface ConfidenceResult {
  /** Genel güven — kritik kanıtların EN ZAYIFI. */
  readonly overall: TripConfidenceLevel;
  /** Mesafe/süre güveni — OBD yokluğundan ETKİLENMEZ. */
  readonly distance: TripConfidenceLevel;
  /** Motor metrikleri güveni (OBD kapsaması). */
  readonly engine: TripConfidenceLevel;
  /** Hangi kanıt tavanı belirledi — gözlemlenebilirlik. */
  readonly limitedBy: string;
}

/**
 * Confidence'ı bağımsız kanıtlardan türetir (§9).
 *
 * Kritik kanıtlar (genel güveni SINIRLAR):
 *   · mesafe kaynağı        · süre kaynağı
 *   · hız örneği kapsaması  · zaman kapsaması (boşluk oranı)
 *   · kapanış güveni
 *
 * Kritik OLMAYAN kanıt:
 *   · OBD kapsaması → yalnız `engine` güvenini etkiler. **OBD yokluğu
 *     tüm trip'i geçersiz YAPMAZ** (GPS'li bir yolculuk hâlâ geçerlidir).
 *
 * `VERY_HIGH` için TÜM kritik kanıtların en üst kovada olması gerekir;
 * tek iyi GPS fix'i `HIGH` ÜRETMEZ (örnek kapsaması tavanı `MEDIUM`).
 */
export function deriveEvidenceConfidence(e: ConfidenceEvidence): ConfidenceResult {
  const c = e.coverage;

  /* Mesafe kaynağı tavanı. */
  const distCap: TripConfidenceLevel =
    e.distanceSource === 'MEASURED' ? 'VERY_HIGH'
    : e.distanceSource === 'DERIVED' ? 'MEDIUM'
    : e.distanceSource === 'ESTIMATED' ? 'LOW'
    : 'UNKNOWN';

  const durCap: TripConfidenceLevel =
    e.durationSource === 'MEASURED' ? 'VERY_HIGH'
    : e.durationSource === 'UNAVAILABLE' ? 'UNKNOWN'
    : 'MEDIUM';

  /* Hız örneği kapsaması — TEK FIX `HIGH` ÜRETMEZ. */
  const n = c.speedSampleCount;
  const sampleCap: TripConfidenceLevel =
    n >= 60 ? 'VERY_HIGH'
    : n >= 20 ? 'HIGH'
    : n >= 5 ? 'MEDIUM'
    : n >= 1 ? 'LOW'
    : 'UNKNOWN';

  /* Zaman kapsaması: bilinen süre / toplam. Boşluk çoksa güven düşer. */
  const tc = c.timeCoverage;
  const timeCap: TripConfidenceLevel =
    tc === null ? 'UNKNOWN'
    : tc >= 0.95 ? 'VERY_HIGH'
    : tc >= 0.80 ? 'HIGH'
    : tc >= 0.50 ? 'MEDIUM'
    : 'LOW';

  /* Kaynak geçişi çoksa süreklilik zayıftır. */
  const switchCap: TripConfidenceLevel =
    c.sourceSwitchCount <= 2 ? 'VERY_HIGH'
    : c.sourceSwitchCount <= 10 ? 'HIGH'
    : 'MEDIUM';

  const closeCap: TripConfidenceLevel = e.cleanClose ? 'VERY_HIGH' : 'MEDIUM';

  /* Mesafe güveni: OBD'den BAĞIMSIZ. */
  const distance = [durCap, sampleCap, timeCap, switchCap]
    .reduce(weakestConfidence, distCap);

  /* Motor güveni: OBD kapsamasına bağlı. */
  const oc = c.obdCoverage;
  const engine: TripConfidenceLevel =
    oc === null || oc === 0 ? 'UNKNOWN'
    : oc >= 0.5 ? 'HIGH'
    : oc >= 0.2 ? 'MEDIUM'
    : 'LOW';

  const overall = weakestConfidence(distance, closeCap);

  /* Hangi kanıt sınırladı — LAB gözlemi için. */
  const caps: ReadonlyArray<[string, TripConfidenceLevel]> = [
    ['distanceSource', distCap], ['durationSource', durCap],
    ['speedSamples', sampleCap], ['timeCoverage', timeCap],
    ['sourceSwitches', switchCap], ['tripClose', closeCap],
  ];
  let limitedBy = 'none';
  let weakest: TripConfidenceLevel = 'VERY_HIGH';
  for (const [name, cap] of caps) {
    if (ORDER.indexOf(cap) < ORDER.indexOf(weakest)) { weakest = cap; limitedBy = name; }
  }

  return { overall, distance, engine, limitedBy };
}
