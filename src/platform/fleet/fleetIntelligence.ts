/**
 * fleetIntelligence.ts — FİLO ZEKÂSI: KANONİK MODEL VE SÖZLEŞME (P1).
 *
 * ── AMAÇ ───────────────────────────────────────────────────────────────
 * Klasik filo takibi "ne oldu" gösterir (grafik, tablo, toplam). Fleet
 * Intelligence farklı bir soruyu cevaplar: **"bu filoda ne DEĞİŞİYOR, hangi
 * KANITLA ve ne kadar EMİN olabiliriz?"**
 *
 * ── BU PAKET AI ÜRETMEZ (BAĞLAYICI) ────────────────────────────────────
 * LLM YOK · model YOK · tahmin YOK · öneri YOK · doğal dil YOK.
 * Üretilen şey, AI'nin GELECEKTE güvenle kullanabileceği **kanıt
 * altyapısıdır**. Bir insight burada bir CÜMLE değil, bir KANIT KÜMESİDİR:
 * hangi araçlardan, hangi sürücülerden, hangi yolculuklardan ve hangi
 * metriklerden oluştuğu tek tek izlenebilir.
 *
 * ── ÜÇ SÖZLEŞME KURALI ─────────────────────────────────────────────────
 *  1. **Kanıtsız insight OLUŞMAZ.** Kanıt sayısı 0 olan bir içgörü
 *     yayımlanamaz (`ACTIVE` olamaz) — hem TS hem DB tarafında kilitli.
 *  2. **Tek araçtan HIGH çıkmaz.** Bir aracın davranışı filo hakkında bir
 *     şey söylemez; filo iddiası için birden çok araç kanıtı gerekir.
 *  3. **UNKNOWN gerçek bir cevaptır.** Yeterli kanıt yoksa insight/trend
 *     üretilmez; "0" veya "normal" gibi bir varsayım YAZILMAZ.
 *
 * SAF: I/O YOK · timer YOK · `Date.now()` YOK · React YOK · LLM YOK.
 * Zaman ve kanıt DIŞARIDAN verilir.
 */

/* ── Insight tipleri ───────────────────────────────────────────────────── */

/**
 * Bir içgörünün NE HAKKINDA olduğu.
 *
 * ⚠️ Her tip bugün ÜRETİLEBİLİR DEĞİLDİR ve bu bilinçlidir: kanıt kaynağı
 * olmayan tip **hiç üretilmez** (uydurulmaz). Bkz.
 * {@link INSIGHT_TYPES_WITHOUT_EVIDENCE}.
 */
export const INSIGHT_TYPES = [
  'FUEL_OUTLIER',
  'DRIVER_OUTLIER',
  'VEHICLE_OUTLIER',
  'MAINTENANCE_TREND',
  'TEMPERATURE_TREND',
  'BATTERY_TREND',
  'BRAKE_PATTERN',
  'IDLE_PATTERN',
  'HIGH_UTILIZATION',
  'LOW_UTILIZATION',
  'DRIVER_CHANGE_PATTERN',
  'VEHICLE_CHANGE_PATTERN',
  'UNKNOWN',
] as const;
export type InsightType = (typeof INSIGHT_TYPES)[number];

/**
 * KANIT KAYNAĞI OLMAYAN tipler — yapısal eksik BEYANI.
 *
 *   · `BATTERY_TREND` — akü voltajı/şarj döngüsü yolculuk kaydında YOK
 *     (native ATRV okunuyor ama trip'e girmiyor; Driver DNA'da da aynı
 *     eksik `BATTERY_CARE` olarak beyan edilmişti).
 *   · `MAINTENANCE_TREND` — bakım kaydı (servis tarihi, parça değişimi)
 *     bu pakette YOK; sıcaklık/devirden "bakım gerekiyor" ÇIKARMAK bir
 *     tahmindir ve bu paket tahmin üretmez.
 *
 * Bu tipler için insight ÜRETİLMEZ; talep gelirse `UNKNOWN` durumla ve
 * gerekçesiyle döner. Liste testle kilitlidir: bir gün üretilmeye
 * başlarlarsa, kanıt kaynağının gerçekten eklendiği kanıtlanmalıdır.
 */
export const INSIGHT_TYPES_WITHOUT_EVIDENCE: readonly InsightType[] =
  Object.freeze(['BATTERY_TREND', 'MAINTENANCE_TREND']);

/** İçgörünün hangi kanıt hattından geldiği. */
export const INSIGHT_SOURCES = [
  'TRIP_METRICS',      // yolculuk ölçümleri (vehicle_trips)
  'DRIVER_DNA',        // sürücü DNA birikimi (salt-okunur tüketim)
  'FLEET_AGGREGATE',   // filo düzeyinde toplulaştırma
  'ATTRIBUTION',       // sürücü/araç değişim kayıtları
  'UNKNOWN',
] as const;
export type InsightSource = (typeof INSIGHT_SOURCES)[number];

/** İçgörünün yaşam durumu. */
export const INSIGHT_STATES = [
  'DRAFT',      // kanıt birikiyor, henüz yayımlanmadı
  'ACTIVE',     // kanıt eşiği aşıldı, geçerli
  'EXPIRED',    // geçerlilik penceresi doldu
  'SUPERSEDED', // aynı konu için daha yeni bir içgörü üretildi
  'RETRACTED',  // dayandığı kanıt geri alındı (ör. sürücü değişimi)
] as const;
export type InsightState = (typeof INSIGHT_STATES)[number];

/* ── Güven ─────────────────────────────────────────────────────────────── */

export const INSIGHT_CONFIDENCES =
  ['VERY_HIGH', 'HIGH', 'MEDIUM', 'LOW', 'UNKNOWN'] as const;
export type InsightConfidence = (typeof INSIGHT_CONFIDENCES)[number];

/**
 * GÜVEN EŞİKLERİ.
 *
 * ⚠️ `SINGLE_VEHICLE_CEILING` pazarlıksızdır: **tek araçtan HIGH çıkmaz.**
 * Bir aracın yakıtı artmışsa bu o araç hakkında bir gözlemdir; "filoda
 * yakıt artıyor" iddiası için birden çok araçtan kanıt gerekir. Aksi hâlde
 * tek bir arızalı sensör tüm filo hakkında bir "içgörü" üretirdi.
 */
export const INSIGHT_MIN_EVIDENCE = 3;
export const INSIGHT_MIN_VEHICLES_FOR_HIGH = 2;
export const INSIGHT_MIN_VEHICLES_FOR_VERY_HIGH = 5;
export const INSIGHT_MIN_TRIPS_FOR_HIGH = 20;
export const SINGLE_VEHICLE_CEILING: InsightConfidence = 'MEDIUM';

/* ── Kanıt ─────────────────────────────────────────────────────────────── */

/** Kanıtın neye işaret ettiği. */
export const EVIDENCE_KINDS = ['VEHICLE', 'DRIVER', 'TRIP', 'METRIC'] as const;
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];

/** Kanıtın ölçüm kalitesi — `vehicle_trips.*_source` ile aynı sözleşme. */
export const EVIDENCE_PROVENANCES =
  ['MEASURED', 'DERIVED', 'ESTIMATED', 'UNKNOWN'] as const;
export type EvidenceProvenance = (typeof EVIDENCE_PROVENANCES)[number];

/**
 * Tek bir kanıt satırı.
 *
 * ⚠️ Kişisel veri TAŞIMAZ: ad, plaka, VIN, konum, rota YOKTUR — yalnız
 * kimlik referansları, metrik adı ve sayısal değer.
 */
export interface InsightEvidence {
  readonly kind: EvidenceKind;
  /** Araç/sürücü/yolculuk kimliği; `METRIC` için metrik adı. */
  readonly refId: string;
  /** Hangi ölçüm (`fuel_l_per_100km`, `idle_ratio`…). */
  readonly metric: string;
  /** Ölçülen değer; bilinmiyorsa `null` (sahte 0 YASAK). */
  readonly value: number | null;
  readonly provenance: EvidenceProvenance;
}

/** Kanıt kimliği — tekrar (replay) kilidinin çekirdeği. */
export function evidenceKey(e: InsightEvidence): string {
  return `${e.kind}|${e.refId}|${e.metric}`;
}

/* ── Kanonik insight ───────────────────────────────────────────────────── */

/**
 * Bir filo içgörüsü.
 *
 * ⚠️ Bu bir CÜMLE değildir: `title`/`message`/`recommendation` gibi bir alan
 * BİLİNÇLİ OLARAK YOKTUR. Doğal dil üretmek bu paketin işi değildir; Mavi
 * ileride bu kanıt kümesini kullanarak cümleyi KENDİSİ kuracaktır.
 */
export interface FleetInsight {
  readonly id: string;
  readonly companyId: string;
  readonly type: InsightType;
  readonly source: InsightSource;
  readonly state: InsightState;
  readonly confidence: InsightConfidence;
  /** Epoch ms. */
  readonly createdAt: number;
  /** Geçerlilik sonu (epoch ms); süresiz içgörü YOKTUR. */
  readonly expiresAt: number;
  readonly evidenceCount: number;
  readonly vehicleCount: number;
  readonly driverCount: number;
  readonly tripCount: number;
  /** Kanıt satırları — izlenebilirlik (hangi araç/sürücü/yolculuk/metrik). */
  readonly evidence: readonly InsightEvidence[];
  /** Neden `UNKNOWN`/üretilemedi — bounded KOD. */
  readonly unknownReason: InsightUnknownReason | null;
  readonly revision: number;
}

export const INSIGHT_UNKNOWN_REASONS = [
  'NO_EVIDENCE',            // hiç kanıt yok
  'INSUFFICIENT_EVIDENCE',  // kanıt var ama eşik altında
  'NO_EVIDENCE_SOURCE',     // bu tipi üretecek kaynak YOK (yapısal)
  'SINGLE_VEHICLE_ONLY',    // yalnız tek araçtan kanıt — filo iddiası olamaz
  'CONTRADICTORY_EVIDENCE', // kanıtlar çelişiyor → fail-closed
] as const;
export type InsightUnknownReason = (typeof INSIGHT_UNKNOWN_REASONS)[number];

/** İÇGÖRÜ VARSAYILAN ÖMRÜ — süresiz içgörü bayat bilgiyi kanıt gibi sunar. */
export const INSIGHT_DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;   // 7 gün

/* ── Trend ─────────────────────────────────────────────────────────────── */

export const TREND_METRICS = [
  'FUEL_PER_100KM',
  'IDLE_RATIO',
  'HARSH_EVENTS_PER_100KM',
  'ENGINE_TEMP_PEAK',
  'UTILIZATION_KM_PER_VEHICLE',
  'DRIVER_CHANGE_RATE',
] as const;
export type TrendMetric = (typeof TREND_METRICS)[number];

export const TREND_DIRECTIONS = ['RISING', 'FALLING', 'FLAT', 'UNKNOWN'] as const;
export type TrendDirection = (typeof TREND_DIRECTIONS)[number];

/**
 * TREND OLUŞMA ŞARTI — altında trend ÜRETİLMEZ.
 *
 * İki noktadan "trend" çıkarmak, gürültüyü bilgi gibi sunmaktır.
 */
export const TREND_MIN_SAMPLES_PER_WINDOW = 5;
export const TREND_MIN_VEHICLES = 2;
/** Anlamlı sayılan en küçük göreli değişim (%10). */
export const TREND_RELATIVE_THRESHOLD = 0.10;

export interface FleetTrend {
  readonly metric: TrendMetric;
  readonly direction: TrendDirection;
  /** Taban ve son pencere ortalamaları; bilinmiyorsa `null`. */
  readonly baselineValue: number | null;
  readonly recentValue: number | null;
  readonly relativeChange: number | null;
  readonly baselineSampleCount: number;
  readonly recentSampleCount: number;
  readonly vehicleCount: number;
  readonly confidence: InsightConfidence;
  readonly unknownReason: InsightUnknownReason | null;
}

/* ── Filo sapması (drift) ──────────────────────────────────────────────── */

export const FLEET_DRIFT_STATES = ['STABLE', 'DRIFTING', 'INSUFFICIENT'] as const;
export type FleetDriftState = (typeof FLEET_DRIFT_STATES)[number];

/** Filo sapmasının anlamlı sayıldığı eşik (%8). */
export const FLEET_DRIFT_THRESHOLD = 0.08;

/**
 * FİLO düzeyinde sapma kanıtı.
 *
 * ⚠️ ARAÇ BAZINDA DEĞİL: tek aracın değişimi filo sapması değildir. Bu
 * yüzden her kanıt kaç araçtan geldiğini TAŞIR.
 */
export interface FleetDriftEvidence {
  readonly metric: TrendMetric;
  readonly baselineValue: number;
  readonly recentValue: number;
  readonly relativeChange: number;
  readonly vehicleCount: number;
  readonly baselineSampleCount: number;
  readonly recentSampleCount: number;
}

/* ── Filo sağlığı ──────────────────────────────────────────────────────── */

/**
 * Sağlık BOYUTLARI.
 *
 * ⚠️ **TEK PUAN ÜRETİLMEZ** (bağlayıcı). "Filo sağlığı: 72" gibi bir sayı,
 * birbiriyle ilgisiz altı gerçeği tek bir yalana indirger: veri kapsamı
 * düşük bir filo ile frenleri sert kullanılan bir filo aynı sayıyı alabilir
 * ve ikisi de yanlış anlaşılır.
 */
export const HEALTH_DIMENSIONS = [
  'VEHICLE_HEALTH',
  'DRIVER_HEALTH',
  'DATA_HEALTH',
  'TRIP_HEALTH',
  'CONNECTIVITY_HEALTH',
  'TELEMETRY_HEALTH',
] as const;
export type HealthDimension = (typeof HEALTH_DIMENSIONS)[number];

export const HEALTH_STATES = ['GOOD', 'WATCH', 'POOR', 'UNKNOWN'] as const;
export type HealthState = (typeof HEALTH_STATES)[number];

export interface HealthDimensionResult {
  readonly dimension: HealthDimension;
  readonly state: HealthState;
  /** 0..1 endeksi; `UNKNOWN` ise **daima `null`**. */
  readonly index: number | null;
  readonly confidence: InsightConfidence;
  readonly unknownReason: InsightUnknownReason | null;
  /** Kaç araçtan/kaç yolculuktan hesaplandı — kanıt ağırlığı. */
  readonly vehicleCount: number;
  readonly tripCount: number;
}

export interface FleetHealth {
  readonly companyId: string;
  readonly dimensions: readonly HealthDimensionResult[];
  /** Veri kapsamı (0..1): filonun ne kadarı gerçekten ölçülüyor. */
  readonly coverage: number | null;
  readonly coverageConfidence: InsightConfidence;
  /** Bilinmeyen boyut sayısı — dürüstlüğün ana göstergesi. */
  readonly unknownDimensionCount: number;
  readonly computedAt: number;
}

/** Sağlıkta TEK PUAN yoktur — bu fonksiyon bilinçli olarak `null` döner. */
export function fleetHealthSingleScore(): null {
  /* Bir "filo puanı" üretmek, farklı sebeplerden gelen farklı gerçekleri
     tek bir sayıya indirger ve yanlış karar aldırır. Bkz. HEALTH_DIMENSIONS. */
  return null;
}

/* ── Boş/güvenli değerler ──────────────────────────────────────────────── */

export const EMPTY_FLEET_HEALTH: FleetHealth = Object.freeze({
  companyId: '',
  dimensions: Object.freeze([]) as readonly HealthDimensionResult[],
  coverage: null, coverageConfidence: 'UNKNOWN',
  unknownDimensionCount: 0, computedAt: 0,
});

export function unknownInsight(
  companyId: string, type: InsightType, reason: InsightUnknownReason,
  createdAt: number,
): FleetInsight {
  return {
    id: '', companyId, type, source: 'UNKNOWN', state: 'DRAFT',
    confidence: 'UNKNOWN', createdAt, expiresAt: createdAt + INSIGHT_DEFAULT_TTL_MS,
    evidenceCount: 0, vehicleCount: 0, driverCount: 0, tripCount: 0,
    evidence: [], unknownReason: reason, revision: 0,
  };
}

export function unknownTrend(
  metric: TrendMetric, reason: InsightUnknownReason,
): FleetTrend {
  return {
    metric, direction: 'UNKNOWN',
    baselineValue: null, recentValue: null, relativeChange: null,
    baselineSampleCount: 0, recentSampleCount: 0, vehicleCount: 0,
    confidence: 'UNKNOWN', unknownReason: reason,
  };
}

/* ── Kullanıcıya dönük etiketler ───────────────────────────────────────── */

export function insightTypeLabel(t: InsightType): string {
  switch (t) {
    case 'FUEL_OUTLIER':           return 'Yakıt sapması';
    case 'DRIVER_OUTLIER':         return 'Sürücü sapması';
    case 'VEHICLE_OUTLIER':        return 'Araç sapması';
    case 'MAINTENANCE_TREND':      return 'Bakım eğilimi';
    case 'TEMPERATURE_TREND':      return 'Sıcaklık eğilimi';
    case 'BATTERY_TREND':          return 'Akü eğilimi';
    case 'BRAKE_PATTERN':          return 'Fren örüntüsü';
    case 'IDLE_PATTERN':           return 'Rölanti örüntüsü';
    case 'HIGH_UTILIZATION':       return 'Yüksek kullanım';
    case 'LOW_UTILIZATION':        return 'Düşük kullanım';
    case 'DRIVER_CHANGE_PATTERN':  return 'Sürücü değişim örüntüsü';
    case 'VEHICLE_CHANGE_PATTERN': return 'Araç değişim örüntüsü';
    case 'UNKNOWN':                return 'Bilinmiyor';
  }
}

export function insightStateLabel(s: InsightState): string {
  switch (s) {
    case 'DRAFT':      return 'Kanıt birikiyor';
    case 'ACTIVE':     return 'Geçerli';
    case 'EXPIRED':    return 'Süresi doldu';
    case 'SUPERSEDED': return 'Yerine yenisi geçti';
    case 'RETRACTED':  return 'Kanıtı geri alındı';
  }
}

export function trendMetricLabel(m: TrendMetric): string {
  switch (m) {
    case 'FUEL_PER_100KM':             return 'Yakıt tüketimi';
    case 'IDLE_RATIO':                 return 'Boşta çalışma';
    case 'HARSH_EVENTS_PER_100KM':     return 'Sert sürüş olayları';
    case 'ENGINE_TEMP_PEAK':           return 'Motor sıcaklığı';
    case 'UTILIZATION_KM_PER_VEHICLE': return 'Araç kullanımı';
    case 'DRIVER_CHANGE_RATE':         return 'Sürücü değişimi';
  }
}

export function trendDirectionLabel(d: TrendDirection): string {
  switch (d) {
    case 'RISING':  return 'Artıyor';
    case 'FALLING': return 'Azalıyor';
    case 'FLAT':    return 'Değişmiyor';
    case 'UNKNOWN': return 'Bilinmiyor';
  }
}

export function healthDimensionLabel(d: HealthDimension): string {
  switch (d) {
    case 'VEHICLE_HEALTH':      return 'Araç sağlığı';
    case 'DRIVER_HEALTH':       return 'Sürücü sağlığı';
    case 'DATA_HEALTH':         return 'Veri sağlığı';
    case 'TRIP_HEALTH':         return 'Yolculuk sağlığı';
    case 'CONNECTIVITY_HEALTH': return 'Bağlantı sağlığı';
    case 'TELEMETRY_HEALTH':    return 'Telemetri sağlığı';
  }
}

export function healthStateLabel(s: HealthState): string {
  switch (s) {
    case 'GOOD':    return 'İyi';
    case 'WATCH':   return 'İzlenmeli';
    case 'POOR':    return 'Zayıf';
    case 'UNKNOWN': return 'Bilinmiyor';
  }
}

export function insightUnknownReasonLabel(r: InsightUnknownReason): string {
  switch (r) {
    case 'NO_EVIDENCE':            return 'Kanıt yok';
    case 'INSUFFICIENT_EVIDENCE':  return 'Kanıt yetersiz';
    case 'NO_EVIDENCE_SOURCE':     return 'Bu bilgiyi üreten kaynak yok';
    case 'SINGLE_VEHICLE_ONLY':    return 'Yalnız tek araçtan kanıt';
    case 'CONTRADICTORY_EVIDENCE': return 'Kanıtlar çelişiyor';
  }
}
