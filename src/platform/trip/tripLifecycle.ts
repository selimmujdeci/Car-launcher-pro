/**
 * tripLifecycle.ts — TRIP YAŞAM DÖNGÜSÜ VE KANONİK DÖNÜŞÜM (SAF).
 *
 * ── İKİ İŞ ────────────────────────────────────────────────────────────
 *  1. §3 yaşam döngüsü geçiş kuralları (tek otorite).
 *  2. Mevcut `TripRecord`'u kanonik `TripSummary`'ye **dürüstçe** çevirmek.
 *
 * ── DÜRÜSTLÜK: TAHMİN ÖLÇÜM GİBİ GÖSTERİLMEZ ─────────────────────────
 * `tripLogService` yakıtı `distanceKm/100 × 8.5` ile TAHMİN ediyor ve
 * maliyeti sabit `45 TL/L` ile çarpıyor. Bu değerler KORUNUR (geriye uyum)
 * ama `ESTIMATED` olarak işaretlenir. Fleet UI ve Cost Analysis bu etiketi
 * okur; "8.5 L/100km varsayımı" ile "araçtan okunan gerçek tüketim" bir
 * daha karıştırılamaz.
 *
 * `TripRecord`'da HİÇ OLMAYAN metrikler (idle/moving time · stop count ·
 * max rpm · max temp · speed violations) **UYDURULMAZ** → `UNAVAILABLE`.
 * Bunları üretmek `tripLogService`'e yeni ölçüm eklemek demektir; o
 * "mevcut davranışı bozma" kapsamında AYRI bir turdur (açık borç).
 *
 * SAF: I/O YOK · timer YOK · `Date.now()` YOK · React YOK · global durum YOK.
 */

import {
  metric,
  buildTripKey,
  deriveTripConfidence,
  EMPTY_TRIP_METRICS,
  EMPTY_TRIP_COVERAGE,
  UNAVAILABLE_METRIC,
  UNAVAILABLE_PRICE_SNAPSHOT,
  type Metric,
  type TripMetrics,
  type TripSummary,
  type TripState,
  type TripEvent,
  type TripStatistics,
  type MetricSource,
  type TripPriceSnapshot,
  type TripCoverage,
  type FuelUnit,
} from './tripCanonicalModel';

/* ── §3 Geçiş kuralları ────────────────────────────────────────────────── */

export type TripTransition =
  | 'MOVE_STARTED'    // hız eşiği aşıldı
  | 'MOVE_STOPPED'    // hız sıfıra düştü
  | 'IDLE_EXPIRED'    // duruş penceresi doldu → trip kapanır
  | 'UPLOAD_ACCEPTED' // sunucu kabul etti
  | 'ARCHIVE';        // yerel saklama penceresinden çıktı

/**
 * İzinli geçişler. Tanımsız geçiş **YOK SAYILIR** (durum korunur) —
 * geçersiz geçişi sessizce uygulamak yaşam döngüsünü bozar.
 *
 * `RESUMED` bir GEÇİŞ durumudur: duruştan sonra ilk hareket. Bir sonraki
 * `MOVE_STARTED` onu `RUNNING`'e taşır — böylece "kaç kez durup devam
 * etti" (stop count) sayılabilir hâle gelir.
 */
const TRANSITIONS: Readonly<Record<TripState, Partial<Record<TripTransition, TripState>>>> = {
  RUNNING:   { MOVE_STOPPED: 'PAUSED', IDLE_EXPIRED: 'COMPLETED' },
  PAUSED:    { MOVE_STARTED: 'RESUMED', IDLE_EXPIRED: 'COMPLETED' },
  RESUMED:   { MOVE_STARTED: 'RUNNING', MOVE_STOPPED: 'PAUSED', IDLE_EXPIRED: 'COMPLETED' },
  COMPLETED: { UPLOAD_ACCEPTED: 'UPLOADED', ARCHIVE: 'ARCHIVED' },
  UPLOADED:  { ARCHIVE: 'ARCHIVED' },
  ARCHIVED:  {},
};

export interface TransitionResult {
  readonly state: TripState;
  /** Geçiş gerçekleşti mi — `false` ise durum DEĞİŞMEDİ. */
  readonly changed: boolean;
  /** Reddedilen geçiş (varsa) — sessiz yutma YOK. */
  readonly rejected: TripTransition | null;
}

export function applyTransition(state: TripState, t: TripTransition): TransitionResult {
  const next = TRANSITIONS[state]?.[t];
  if (next === undefined) return { state, changed: false, rejected: t };
  return { state: next, changed: true, rejected: null };
}

/** Bu durumdan bu geçiş yapılabilir mi (yan etkisiz sorgu). */
export function canTransition(state: TripState, t: TripTransition): boolean {
  return TRANSITIONS[state]?.[t] !== undefined;
}

/* ── Mevcut kayıt biçimi (tripLogService sözleşmesi) ───────────────────── */

/**
 * `tripLogService.TripRecord` alanları. Burada YENİDEN TANIMLANIR ki bu saf
 * modül `tripLogService`'i import etmek zorunda kalmasın (döngüsel bağımlılık
 * ve test edilebilirlik).
 */
export interface LegacyTripRecord {
  readonly id: string;
  readonly startTime: number;
  readonly endTime: number;
  readonly distanceKm: number;
  readonly durationMin: number;
  readonly avgSpeedKmh: number;
  readonly maxSpeedKmh: number;
  readonly fuelConsumptionL: number;
  readonly fuelCostTL: number;
  readonly drivingScore: number;
  readonly harshEvents: number;

  /* P2 alanlari (hepsi OPSIYONEL). Eski kayitlarda YOKTUR -> undefined ->
     UNAVAILABLE. Bu, "metrik uretilmedi" ile "metrik 0" ayrimini KORUR. */
  readonly harshBrakeCount?: number;
  readonly harshAccelCount?: number;
  readonly movingMin?: number;
  readonly idleMin?: number;
  readonly unknownMin?: number;
  readonly stopCount?: number;
  readonly maxRpm?: number;
  readonly maxEngineTempC?: number;
  readonly fuelUsedPercent?: number;
  readonly fuelSource?: MetricSource;
  readonly fuelRejectReason?: string;
  readonly costSource?: MetricSource;
  readonly fuelUnitPrice?: number;
  readonly currency?: string;
  readonly priceSource?: string;
  readonly priceCapturedAtMs?: number;
  readonly distanceSource?: MetricSource;
  readonly confidence?: 'VERY_HIGH' | 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN';
  readonly confidenceLimitedBy?: string;
  readonly speedSampleCount?: number;
  readonly obdCoverage?: number;
  readonly timeCoverage?: number;
  readonly dataGapCount?: number;
  readonly sourceSwitchCount?: number;
  readonly metricsVersion?: number;
}

/**
 * Kanonik dönüşüm için EK bağlam.
 *
 * `tripLogService` bu alanları KALICI OLARAK SAKLAMIYOR (yalnız RAM'de
 * yaşıyor veya hiç yok). Canlı trip kapanırken elde varsa geçilir; geçmiş
 * kayıtlar için `undefined` kalır ve alan `UNAVAILABLE` olur.
 */
export interface TripConversionContext {
  /** Sert fren sayısı — `ActiveTrip.harshBrakeEvents` (kalıcı DEĞİL). */
  readonly harshBrakeCount?: number;
  /** Ani hızlanma sayısı — `ActiveTrip.harshAccelEvents` (kalıcı DEĞİL). */
  readonly harshAccelCount?: number;
  /** Hız örneği sayısı — `ActiveTrip.speedCount` (kalıcı DEĞİL). */
  readonly speedSampleCount?: number;
  /** Mesafenin gerçek kaynağı: GPS haversine → MEASURED, OBD Euler → DERIVED. */
  readonly distanceSource?: MetricSource;
  /** Trip içi olaylar (koordinat İÇERMEZ). */
  readonly events?: readonly TripEvent[];
  /** Yakıt OBD seviyesinden ÖLÇÜLDÜ mü (bugün: hayır). */
  readonly fuelMeasured?: boolean;
  /** Kullanıcının gerçek yakıt fiyatı biliniyorsa maliyet ESTIMATED olmaz. */
  readonly fuelPriceKnown?: boolean;
}

/* ── Kanonik dönüşüm ───────────────────────────────────────────────────── */

/** Pozitif sonlu sayı mı (0 dahil) — aksi halde bilinmiyor. */
function nonNegative(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null;
}

/**
 * P2 metrik secici: KAYIT degeri > baglam degeri > UNAVAILABLE.
 *
 * Neden bu sira: kalici kayit canli baglamdan daha guvenilirdir (gecmis
 * trip okunurken baglam zaten yoktur). Ikisi de yoksa UYDURULMAZ.
 */
function pick(
  recorded: number | undefined,
  fallback: number | undefined,
  source: MetricSource,
): Metric {
  const v = recorded !== undefined ? recorded : fallback;
  if (v === undefined) return UNAVAILABLE_METRIC;
  const n = nonNegative(v);
  return n === null ? UNAVAILABLE_METRIC : metric(n, source);
}

/**
 * `LegacyTripRecord` → kanonik `TripSummary`.
 *
 * Kaynak etiketleri:
 *   · `distanceKm`  → bağlamdan (GPS `MEASURED` / OBD `DERIVED`); bilinmiyorsa `DERIVED`
 *   · `durationMin` → `MEASURED` (monotonik `performance.now()` deltası)
 *   · `avgSpeedKmh` → `DERIVED` (hız örneklerinin ortalaması)
 *   · `maxSpeedKmh` → `MEASURED` (gözlenen tepe)
 *   · `fuelUsedL`   → `fuelMeasured` ise `MEASURED`, değilse **`ESTIMATED`**
 *   · `estimatedCost` → `fuelPriceKnown` ise `DERIVED`, değilse **`ESTIMATED`**
 *   · olmayan metrikler → `UNAVAILABLE` (UYDURULMAZ)
 */
export function toCanonicalTripSummary(
  record: LegacyTripRecord,
  state: TripState,
  ctx: TripConversionContext = {},
): TripSummary {
  const distance = nonNegative(record.distanceKm);
  const duration = nonNegative(record.durationMin);

  /* P2: kaynak etiketleri artik KAYITTAN gelir (tripLogService uretiyor);
     yoksa P1 davranisina dusulur - hicbir durumda MEASURED IDDIA EDILMEZ. */
  const distanceSource: MetricSource =
    distance === null ? 'UNAVAILABLE'
    : (record.distanceSource ?? ctx.distanceSource ?? 'DERIVED');
  const durationSource: MetricSource = duration === null ? 'UNAVAILABLE' : 'MEASURED';
  const fuelSource: MetricSource =
    nonNegative(record.fuelConsumptionL) === null
      ? 'UNAVAILABLE'
      : (record.fuelSource ?? (ctx.fuelMeasured === true ? 'MEASURED' : 'ESTIMATED'));
  const costSource: MetricSource =
    nonNegative(record.fuelCostTL) === null
      ? 'UNAVAILABLE'
      : (record.costSource ?? (ctx.fuelPriceKnown === true ? 'DERIVED' : 'ESTIMATED'));

  const metrics: TripMetrics = {
    ...EMPTY_TRIP_METRICS,
    distanceKm:      metric(distance, distanceSource),
    durationMin:     metric(duration, durationSource),
    averageSpeedKmh: metric(nonNegative(record.avgSpeedKmh), 'DERIVED'),
    maximumSpeedKmh: metric(nonNegative(record.maxSpeedKmh), 'MEASURED'),
    fuelUsedL:       metric(nonNegative(record.fuelConsumptionL), fuelSource),
    estimatedCost:   metric(nonNegative(record.fuelCostTL), costSource),
    /* P2: sert manevralar artik KALICI. Kayitta varsa ONDAN okunur
       (oncelik); yoksa baglamdan; ikisi de yoksa UYDURULMAZ. */
    harshBrakeCount: pick(record.harshBrakeCount, ctx.harshBrakeCount, 'MEASURED'),
    harshAccelCount: pick(record.harshAccelCount, ctx.harshAccelCount, 'MEASURED'),

    /* P2: sure siniflandirmasi. `unknownMin` BILINMEYEN suredir ve
       idle SAYILMAZ (ayri kovada tutulur). */
    movingTimeMin:  pick(record.movingMin, undefined, 'MEASURED'),
    idleTimeMin:    pick(record.idleMin, undefined, 'MEASURED'),
    unknownTimeMin: pick(record.unknownMin, undefined, 'MEASURED'),
    stopCount:      pick(record.stopCount, undefined, 'MEASURED'),

    /* P2: tepe degerler - YALNIZ taze OBD'den uretildi. */
    maxRpm:         pick(record.maxRpm, undefined, 'MEASURED'),
    maxEngineTempC: pick(record.maxEngineTempC, undefined, 'MEASURED'),

    /* GERCEK hiz limiti kaynagi YOK -> ihlal URETILMEZ. mapSource
       "GERCEK IO YOK" diyor; SPEED_LIMIT_KMH sabit bir global, yol limiti
       veya filo tanimi DEGIL. Bu alan BILINCLI olarak UNAVAILABLE kalir. */
  };

  return {
    tripId: record.id,
    tripKey: buildTripKey({
      startedAtMs: record.startTime,
      endedAtMs: record.endTime,
      distanceKm: distance,
    }),
    state,
    startedAtMs: record.startTime,
    endedAtMs: nonNegative(record.endTime),
    metrics,
    score: typeof record.drivingScore === 'number' && Number.isFinite(record.drivingScore)
      ? Math.max(0, Math.min(100, Math.round(record.drivingScore)))
      : null,
    /* P2: tripLogService artik KANITA DAYALI confidence uretiyor
       (kapsama, bosluk, kaynak gecisi, kapanis). Varsa O kullanilir;
       yoksa P1'in daha kaba turetmesine dusulur. */
    confidence: record.confidence ?? deriveTripConfidence({
      distanceSource,
      durationSource,
      speedSampleCount: record.speedSampleCount ?? ctx.speedSampleCount ?? 0,
      fuelSource,
    }),
    events: ctx.events ?? [],
    revision: 1,

    /* ── P2 taşıyıcıları ────────────────────────────────────────────────
       Hepsi KAYITTAN okunur. Eski (P1) kayıtlarda bu alanlar YOKTUR →
       `UNAVAILABLE` / `null` kalır; UYDURULMAZ. */

    /* Ölçülen yakıt YÜZDESİ yalnız tüm kapılar geçtiyse yazılmıştır;
       varsa ölçümdür (`MEASURED`), litre dönüşümü ayrı ve DERIVED'dır. */
    fuelUsedPercent: pick(record.fuelUsedPercent, undefined, 'MEASURED'),

    /* Litre alanının hangi anlamda dolduğu: gerçek ölçüm yüzdeye dayanıp
       depoyla litreye çevrildiyse `L`; hiç ölçüm yoksa yine `L` ama
       kaynağı `ESTIMATED`'dır (birim ile güvenilirlik AYRI eksenlerdir). */
    fuelUnit: nonNegative(record.fuelConsumptionL) === null
      ? null
      : ('L' satisfies FuelUnit),

    fuelRejectReason: typeof record.fuelRejectReason === 'string'
      && record.fuelRejectReason.length > 0
        ? record.fuelRejectReason
        : null,

    price: buildPriceSnapshot(record),
    coverage: buildCoverage(record),

    metricsVersion: typeof record.metricsVersion === 'number'
      && Number.isFinite(record.metricsVersion)
        ? record.metricsVersion
        : null,
  };
}

/* ── P2 yardımcıları ───────────────────────────────────────────────────── */

/** Sonlu sayı ise değeri, değilse `null` (0 dahil geçerlidir). */
function finite(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** `0`–`1` aralığındaki oran; dışıysa `null` (bozuk kanıt taşınmaz). */
function ratio(v: unknown): number | null {
  const n = finite(v);
  return n === null || n < 0 || n > 1 ? null : n;
}

/**
 * Fiyat anlık görüntüsünü kayıttan kurar.
 *
 * Birim fiyat YOKSA snapshot boştur — para birimi veya kaynak tek başına
 * bir fiyat İDDİASI değildir.
 */
function buildPriceSnapshot(r: LegacyTripRecord): TripPriceSnapshot {
  const unitPrice = finite(r.fuelUnitPrice);
  if (unitPrice === null || unitPrice < 0) return UNAVAILABLE_PRICE_SNAPSHOT;
  return {
    unitPrice,
    currency: typeof r.currency === 'string' && r.currency.length > 0 ? r.currency : null,
    source: typeof r.priceSource === 'string' && r.priceSource.length > 0
      ? r.priceSource : null,
    capturedAtMs: finite(r.priceCapturedAtMs),
  };
}

/** Confidence kanıtını kayıttan kurar. Eksik kanıt `null` — `0` DEĞİL. */
function buildCoverage(r: LegacyTripRecord): TripCoverage {
  const out: TripCoverage = {
    ...EMPTY_TRIP_COVERAGE,
    speedSampleCount: finite(r.speedSampleCount),
    obdCoverage: ratio(r.obdCoverage),
    timeCoverage: ratio(r.timeCoverage),
    dataGapCount: finite(r.dataGapCount),
    sourceSwitchCount: finite(r.sourceSwitchCount),
    limitedBy: typeof r.confidenceLimitedBy === 'string'
      && r.confidenceLimitedBy.length > 0
        ? r.confidenceLimitedBy
        : null,
  };
  return out;
}

/* ── §2 İstatistik toplama ─────────────────────────────────────────────── */

/** `null` değerleri ATLAYARAK toplar; hiç geçerli değer yoksa `UNAVAILABLE`. */
function sumMetric(values: readonly Metric[], source: MetricSource): Metric {
  let total = 0;
  let seen = 0;
  let anyEstimated = false;
  for (const m of values) {
    if (m.value === null) continue;
    total += m.value;
    seen += 1;
    if (m.source === 'ESTIMATED') anyEstimated = true;
  }
  if (seen === 0) return UNAVAILABLE_METRIC;
  /* Toplamda TEK BİR tahmin varsa toplam da tahminidir — dürüstlük
     yukarı doğru taşınır (en zayıf halka). */
  return {
    value: Math.round(total * 100) / 100,
    source: anyEstimated ? 'ESTIMATED' : source,
  };
}

export function buildTripStatistics(
  summaries: readonly TripSummary[],
): TripStatistics {
  const scores: number[] = [];
  for (const s of summaries) if (s.score !== null) scores.push(s.score);

  return {
    tripCount: summaries.length,
    totalDistanceKm: sumMetric(summaries.map((s) => s.metrics.distanceKm), 'MEASURED'),
    totalDurationMin: sumMetric(summaries.map((s) => s.metrics.durationMin), 'MEASURED'),
    totalFuelL: sumMetric(summaries.map((s) => s.metrics.fuelUsedL), 'MEASURED'),
    totalCost: sumMetric(summaries.map((s) => s.metrics.estimatedCost), 'DERIVED'),
    averageScore: scores.length === 0
      ? null
      : Math.round(scores.reduce((a, b) => a + b, 0) / scores.length),
    pendingUploadCount: summaries.filter((s) => s.state === 'COMPLETED').length,
    failedUploadCount: 0,   // yükleme koordinatörü doldurur
  };
}
