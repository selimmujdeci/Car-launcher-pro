/**
 * fleetIntelligenceView.ts — FLEET DASHBOARD GÖRÜNÜM MODELİ (SAF).
 *
 * ── CEVAPLANAN SORU ───────────────────────────────────────────────────
 * Filo panosunda: **"Bu filo hakkında ne KANITLANDI, ne DEĞİŞİYOR ve ne
 * kadarını hâlâ BİLMİYORUZ?"**
 *
 * ── BU BİR ÖNERİ PANELİ DEĞİLDİR ──────────────────────────────────────
 * Cümle üretilmez, tavsiye verilmez, uyarı metni yazılmaz. Kartlar yalnız
 * kanıt sayılarını, trend yönlerini ve **bilinmeyenleri** gösterir.
 * Mavi ileride bu kanıtı kullanarak cümleyi KENDİSİ kuracaktır.
 *
 * ── İKİ OTORİTE YASAĞI (BAĞLAYICI) ────────────────────────────────────
 * Güven/trend/sağlık FORMÜLLERİ burada YENİDEN YAZILMAZ. Sunucu (migration
 * 054) kararı verir; bu katman yalnız daraltır ve gösterir.
 *
 * SAF: I/O YOK · timer YOK · `Date.now()` YOK · React YOK · LLM YOK.
 */

/* ── Sözleşme (054 ile birebir) ────────────────────────────────────────── */

export const INSIGHT_CONFIDENCES =
  ['VERY_HIGH', 'HIGH', 'MEDIUM', 'LOW', 'UNKNOWN'] as const;
export type InsightConfidence = (typeof INSIGHT_CONFIDENCES)[number];

export const TREND_DIRECTIONS = ['RISING', 'FALLING', 'FLAT', 'UNKNOWN'] as const;
export type TrendDirection = (typeof TREND_DIRECTIONS)[number];

export const HEALTH_STATES = ['GOOD', 'WATCH', 'POOR', 'UNKNOWN'] as const;
export type HealthState = (typeof HEALTH_STATES)[number];

/** `get_fleet_intelligence()` satırı — alanlar eksik/bozuk gelebilir. */
export interface FleetIntelligenceRow {
  readonly company_id?: string | null;
  readonly insight_count?: number | null;
  readonly active_insight_count?: number | null;
  readonly evidence_count?: number | null;
  readonly unknown_insight_count?: number | null;
  readonly single_vehicle_insight_count?: number | null;
  readonly trend_count?: number | null;
  readonly drifting_trend_count?: number | null;
  readonly unknown_trend_count?: number | null;
  readonly health_unknown_count?: number | null;
  readonly health_dimension_count?: number | null;
  readonly coverage?: number | string | null;
  readonly vehicles_total?: number | null;
  readonly vehicles_reporting?: number | null;
  readonly learning_started_at?: string | null;
  readonly last_update_at?: string | null;
}

/** Panodaki tek kart — sayı + gerekçe; asla cümle. */
export interface FleetCard {
  readonly key: 'INSIGHTS' | 'TRENDS' | 'RISKS' | 'LEARNING' | 'COVERAGE' | 'UNKNOWNS';
  readonly label: string;
  /** `null` = bilinmiyor (0 DEĞİL). */
  readonly value: number | null;
  readonly unit: 'COUNT' | 'PERCENT' | 'DAYS';
  /** Kartın ikinci satırı — kanıt bağlamı, yorum DEĞİL. */
  readonly detail: string;
  readonly known: boolean;
}

export interface FleetIntelligenceView {
  readonly present: boolean;
  readonly cards: readonly FleetCard[];
  readonly coverage: number | null;
  readonly vehiclesTotal: number | null;
  readonly vehiclesReporting: number | null;
  readonly learningAgeDays: number | null;
  readonly unknownTotal: number;
  readonly driftingTrendCount: number;
  readonly singleVehicleInsightCount: number;
  /** Veri yoksa NEDEN yok — sessiz boşluk YOK. */
  readonly absentReason: 'NO_ROW' | 'NO_EVIDENCE' | null;
}

export const EMPTY_FLEET_INTELLIGENCE_VIEW: FleetIntelligenceView = Object.freeze({
  present: false,
  cards: Object.freeze([]) as readonly FleetCard[],
  coverage: null, vehiclesTotal: null, vehiclesReporting: null,
  learningAgeDays: null, unknownTotal: 0, driftingTrendCount: 0,
  singleVehicleInsightCount: 0, absentReason: 'NO_ROW',
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

const DAY_MS = 86_400_000;

/**
 * Sunucu satırını pano görünümüne çevirir.
 *
 * @param nowMs Öğrenme yaşı için dış saat (SAF kalmak için parametre).
 */
export function buildFleetIntelligenceView(
  row: FleetIntelligenceRow | null | undefined,
  nowMs: number,
): FleetIntelligenceView {
  if (row === null || row === undefined) return EMPTY_FLEET_INTELLIGENCE_VIEW;

  const insightCount = num(row.insight_count);
  const activeCount = num(row.active_insight_count);
  const evidenceCount = num(row.evidence_count);
  const trendCount = num(row.trend_count);
  const drifting = num(row.drifting_trend_count) ?? 0;
  const unknownInsights = num(row.unknown_insight_count) ?? 0;
  const unknownTrends = num(row.unknown_trend_count) ?? 0;
  const healthUnknown = num(row.health_unknown_count) ?? 0;
  const singleVehicle = num(row.single_vehicle_insight_count) ?? 0;
  const coverage = num(row.coverage);
  const vehiclesTotal = num(row.vehicles_total);
  const vehiclesReporting = num(row.vehicles_reporting);
  const startedAt = ms(row.learning_started_at);

  const learningAgeDays = startedAt === null
    ? null : Math.max(0, Math.floor((nowMs - startedAt) / DAY_MS));

  const unknownTotal = unknownInsights + unknownTrends + healthUnknown;

  /* Hiç kanıt yoksa pano DOLU GÖSTERİLMEZ — gerekçe yazılır. */
  if ((evidenceCount ?? 0) === 0 && (insightCount ?? 0) === 0) {
    return {
      ...EMPTY_FLEET_INTELLIGENCE_VIEW,
      coverage, vehiclesTotal, vehiclesReporting,
      learningAgeDays, unknownTotal,
      absentReason: 'NO_EVIDENCE',
    };
  }

  const cards: FleetCard[] = [
    {
      key: 'INSIGHTS', label: 'Yeni içgörüler',
      value: activeCount, unit: 'COUNT',
      detail: `${evidenceCount ?? 0} kanıt satırından`,
      known: activeCount !== null,
    },
    {
      key: 'TRENDS', label: 'Trendler',
      value: trendCount, unit: 'COUNT',
      detail: `${drifting} tanesi yön değiştiriyor`,
      known: trendCount !== null,
    },
    {
      /* "Risk" burada bir TAHMİN değil, KANITLI değişimin sayısıdır. */
      key: 'RISKS', label: 'Dikkat gerektiren değişim',
      value: drifting, unit: 'COUNT',
      detail: singleVehicle > 0
        ? `${singleVehicle} içgörü yalnız tek araçtan (filo iddiası değil)`
        : 'Filo düzeyinde kanıtla',
      known: true,
    },
    {
      key: 'LEARNING', label: 'Öğrenme durumu',
      value: learningAgeDays, unit: 'DAYS',
      detail: learningAgeDays === null
        ? 'Henüz kanıt birikmedi' : `${insightCount ?? 0} içgörü birikti`,
      known: learningAgeDays !== null,
    },
    {
      key: 'COVERAGE', label: 'Veri kapsamı',
      value: coverage === null ? null : Math.round(coverage * 100), unit: 'PERCENT',
      detail: vehiclesTotal === null
        ? 'Araç sayısı bilinmiyor'
        : `${vehiclesReporting ?? 0}/${vehiclesTotal} araç veri gönderiyor`,
      known: coverage !== null,
    },
    {
      key: 'UNKNOWNS', label: 'Bilinmeyenler',
      value: unknownTotal, unit: 'COUNT',
      detail: 'Kanıtı olmayan içgörü · trend · sağlık boyutu',
      known: true,
    },
  ];

  return {
    present: true, cards,
    coverage, vehiclesTotal, vehiclesReporting, learningAgeDays,
    unknownTotal, driftingTrendCount: drifting,
    singleVehicleInsightCount: singleVehicle,
    absentReason: null,
  };
}

/** Kanıt yoksa kullanıcıya dürüst açıklama (boş pano YOK). */
export function fleetIntelligenceAbsenceExplanation(
  v: FleetIntelligenceView,
): string | null {
  if (v.present) return null;
  if (v.absentReason === 'NO_EVIDENCE') {
    return 'Henüz kanıt birikmedi. Filo hakkında iddia üretmek için '
         + 'birden çok araçtan ölçüm gerekir — az veriden çıkarım yapılmaz.';
  }
  return 'Bu şirket için filo zekâsı kaydı bulunamadı.';
}

export function confidenceLabel(c: InsightConfidence): string {
  switch (c) {
    case 'VERY_HIGH': return 'Çok yüksek';
    case 'HIGH':      return 'Yüksek';
    case 'MEDIUM':    return 'Orta';
    case 'LOW':       return 'Düşük';
    case 'UNKNOWN':   return 'Bilinmiyor';
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

export function healthStateLabel(s: HealthState): string {
  switch (s) {
    case 'GOOD':    return 'İyi';
    case 'WATCH':   return 'İzlenmeli';
    case 'POOR':    return 'Zayıf';
    case 'UNKNOWN': return 'Bilinmiyor';
  }
}
