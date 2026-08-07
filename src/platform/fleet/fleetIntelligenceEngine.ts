/**
 * fleetIntelligenceEngine.ts — KANIT · GÜVEN · TREND · SAPMA · SAĞLIK MOTORU (SAF).
 *
 * ── NE YAPAR ───────────────────────────────────────────────────────────
 * Kanıt satırlarını biriktirir, kanıttan içgörü KURAR, güveni kanıt
 * ağırlığından TÜRETİR, filo düzeyinde trend ve sapma hesaplar, sağlığı
 * boyutlara ayırır ve veri kapsamını ölçer.
 *
 * ── NE YAPMAZ (BAĞLAYICI) ──────────────────────────────────────────────
 * · **LLM ÇAĞIRMAZ**, model eğitmez, tahmin etmez, öneri üretmez.
 * · Doğal dil cümle KURMAZ — insight bir cümle değil, kanıt kümesidir.
 * · Eksik veriyi doldurmaz: kanıt yoksa içgörü/trend ÜRETİLMEZ.
 * · **Tek filo puanı üretmez** (bkz. `fleetHealthSingleScore`).
 * · Driver DNA · Trip Engine · Vehicle Identity · Driver Authentication
 *   katmanlarını ÇAĞIRMAZ ve DEĞİŞTİRMEZ (yalnız çıktılarını KANIT olarak
 *   kabul eder — o da çağıranın sorumluluğundadır).
 *
 * ── İDEMPOTENS ─────────────────────────────────────────────────────────
 * Aynı kanıt iki kez birikmez (`evidenceKey` tekilliği). Çevrimdışı kuyruk
 * aynı yolculuğu 10 kez yüklerse içgörü 10 kat güçlenmez.
 *
 * SAF: I/O YOK · timer YOK · `Date.now()` YOK · React YOK · LLM YOK.
 */

import {
  INSIGHT_MIN_EVIDENCE, INSIGHT_MIN_VEHICLES_FOR_HIGH,
  INSIGHT_MIN_VEHICLES_FOR_VERY_HIGH, INSIGHT_MIN_TRIPS_FOR_HIGH,
  INSIGHT_DEFAULT_TTL_MS, INSIGHT_TYPES_WITHOUT_EVIDENCE,
  TREND_MIN_SAMPLES_PER_WINDOW, TREND_MIN_VEHICLES, TREND_RELATIVE_THRESHOLD,
  FLEET_DRIFT_THRESHOLD, HEALTH_DIMENSIONS,
  evidenceKey, unknownInsight, unknownTrend,
  type EvidenceProvenance, type FleetDriftEvidence, type FleetDriftState,
  type FleetHealth, type FleetInsight, type FleetTrend,
  type HealthDimension, type HealthDimensionResult, type HealthState,
  type InsightConfidence, type InsightEvidence, type InsightSource,
  type InsightType, type TrendDirection, type TrendMetric,
} from './fleetIntelligence';

/* ── Kanıt birikimi ────────────────────────────────────────────────────── */

/**
 * Bir içgörü adayının kanıt birikimi.
 *
 * Kanıt satırları KİMLİKLERİYLE tutulur: aynı (kind|refId|metric) ikinci kez
 * eklenmez → tekrar oynatma (replay) içgörüyü güçlendiremez.
 */
export interface InsightDraft {
  readonly companyId: string;
  readonly type: InsightType;
  readonly source: InsightSource;
  readonly evidence: readonly InsightEvidence[];
}

export function emptyDraft(
  companyId: string, type: InsightType, source: InsightSource,
): InsightDraft {
  return { companyId, type, source, evidence: [] };
}

/**
 * Kanıt ekler (SAF — girdi değişmez).
 *
 * Değeri `null` ve provenance'ı `UNKNOWN` olan satır **kanıt değildir** ve
 * eklenmez: bilinmeyeni kanıt saymak, kanıt sayısını şişirip güveni
 * yalancı yapardı.
 */
export function addEvidence(draft: InsightDraft, e: InsightEvidence): InsightDraft {
  if (e.refId.length === 0 || e.metric.length === 0) return draft;
  if (e.value === null && e.provenance === 'UNKNOWN') return draft;
  const key = evidenceKey(e);
  if (draft.evidence.some((x) => evidenceKey(x) === key)) return draft;   // ← REPLAY
  return { ...draft, evidence: [...draft.evidence, e] };
}

function distinctCount(ev: readonly InsightEvidence[], kind: string): number {
  const s = new Set<string>();
  for (const e of ev) if (e.kind === kind) s.add(e.refId);
  return s.size;
}

/* ── Güven motoru ──────────────────────────────────────────────────────── */

/**
 * Kanıt ağırlığından güven türetir.
 *
 * ⚠️ **TEK ARAÇTAN `HIGH` ÇIKMAZ** — pazarlıksız. Bir aracın davranışı filo
 * hakkında bir iddia değildir; tek araç kanıtı `MEDIUM` tavanına takılır.
 * `VERY_HIGH` ayrıca çok araç + çok yolculuk + ölçülmüş kanıt ister.
 */
export function computeInsightConfidence(input: {
  readonly evidenceCount: number;
  readonly vehicleCount: number;
  readonly tripCount: number;
  readonly measuredRatio: number;   // 0..1
}): InsightConfidence {
  const { evidenceCount, vehicleCount, tripCount, measuredRatio } = input;
  if (evidenceCount < INSIGHT_MIN_EVIDENCE) return 'UNKNOWN';
  if (vehicleCount < 1) return 'UNKNOWN';

  /* TEK ARAÇ TAVANI — filo iddiası olamaz. */
  if (vehicleCount < INSIGHT_MIN_VEHICLES_FOR_HIGH) {
    return measuredRatio >= 0.5 ? 'MEDIUM' : 'LOW';
  }

  if (vehicleCount >= INSIGHT_MIN_VEHICLES_FOR_VERY_HIGH
      && tripCount >= INSIGHT_MIN_TRIPS_FOR_HIGH
      && measuredRatio >= 0.8) {
    return 'VERY_HIGH';
  }
  if (tripCount >= INSIGHT_MIN_TRIPS_FOR_HIGH && measuredRatio >= 0.6) return 'HIGH';
  if (measuredRatio >= 0.4) return 'MEDIUM';
  return 'LOW';
}

function measuredRatioOf(ev: readonly InsightEvidence[]): number {
  if (ev.length === 0) return 0;
  const measured = ev.filter((e) => e.provenance === 'MEASURED').length;
  return measured / ev.length;
}

/* ── İçgörü kurulumu ───────────────────────────────────────────────────── */

export interface BuildInsightInput {
  readonly draft: InsightDraft;
  readonly id: string;
  readonly createdAt: number;
  readonly ttlMs?: number;
  readonly revision?: number;
}

/**
 * Kanıttan içgörü kurar.
 *
 * **KANITSIZ İÇGÖRÜ OLUŞMAZ:** kanıt yoksa veya eşik altındaysa `DRAFT`
 * durumunda, `UNKNOWN` güvenle ve GEREKÇESİYLE döner — asla `ACTIVE` olmaz.
 * Kanıt kaynağı OLMAYAN tipler (akü/bakım) hiç üretilmez.
 */
export function buildInsight(input: BuildInsightInput): FleetInsight {
  const { draft, id, createdAt } = input;
  const ttl = input.ttlMs ?? INSIGHT_DEFAULT_TTL_MS;
  const revision = input.revision ?? 1;

  if (INSIGHT_TYPES_WITHOUT_EVIDENCE.includes(draft.type)) {
    return {
      ...unknownInsight(draft.companyId, draft.type, 'NO_EVIDENCE_SOURCE', createdAt),
      id, source: draft.source, revision,
    };
  }

  const ev = draft.evidence;
  if (ev.length === 0) {
    return {
      ...unknownInsight(draft.companyId, draft.type, 'NO_EVIDENCE', createdAt),
      id, source: draft.source, revision,
    };
  }

  const vehicleCount = distinctCount(ev, 'VEHICLE');
  const driverCount = distinctCount(ev, 'DRIVER');
  const tripCount = distinctCount(ev, 'TRIP');

  const base = {
    id, companyId: draft.companyId, type: draft.type, source: draft.source,
    createdAt, expiresAt: createdAt + ttl,
    evidenceCount: ev.length, vehicleCount, driverCount, tripCount,
    evidence: ev, revision,
  };

  if (ev.length < INSIGHT_MIN_EVIDENCE) {
    return {
      ...base, state: 'DRAFT' as const, confidence: 'UNKNOWN' as const,
      unknownReason: 'INSUFFICIENT_EVIDENCE' as const,
    };
  }

  const confidence = computeInsightConfidence({
    evidenceCount: ev.length, vehicleCount, tripCount,
    measuredRatio: measuredRatioOf(ev),
  });

  if (confidence === 'UNKNOWN') {
    return {
      ...base, state: 'DRAFT' as const, confidence,
      unknownReason: 'INSUFFICIENT_EVIDENCE' as const,
    };
  }

  return {
    ...base, state: 'ACTIVE' as const, confidence,
    /* Tek araçtan gelen içgörü YAYIMLANIR ama filo iddiası olmadığı
       gerekçesiyle işaretlenir — tüketici bunu bilmek zorundadır. */
    unknownReason: vehicleCount < INSIGHT_MIN_VEHICLES_FOR_HIGH
      ? ('SINGLE_VEHICLE_ONLY' as const) : null,
  };
}

/** İçgörü verilen anda hâlâ geçerli mi (süresiz içgörü YOK). */
export function isInsightActive(i: FleetInsight, nowMs: number): boolean {
  return i.state === 'ACTIVE' && nowMs < i.expiresAt;
}

/**
 * Süresi dolan içgörüyü kapatır (SAF · İDEMPOTENT).
 *
 * Kapanmış/geri alınmış içgörü YENİDEN kapatılmaz — durumu değişmez.
 */
export function settleInsight(i: FleetInsight, nowMs: number): FleetInsight {
  if (i.state !== 'ACTIVE') return i;
  if (nowMs < i.expiresAt) return i;
  return { ...i, state: 'EXPIRED' };
}

/* ── Trend motoru ──────────────────────────────────────────────────────── */

export interface TrendWindow {
  readonly sum: number;
  readonly sampleCount: number;
  readonly vehicleCount: number;
}

export const EMPTY_TREND_WINDOW: TrendWindow = Object.freeze({
  sum: 0, sampleCount: 0, vehicleCount: 0,
});

/**
 * Taban ve son pencereden trend üretir.
 *
 * **MİNİMUM VERİ ŞARTI:** her iki pencerede de en az
 * `TREND_MIN_SAMPLES_PER_WINDOW` örnek ve en az `TREND_MIN_VEHICLES` araç
 * gerekir. İki noktadan "trend" çıkarmak gürültüyü bilgi gibi sunmaktır.
 */
export function computeTrend(
  metric: TrendMetric, baseline: TrendWindow, recent: TrendWindow,
): FleetTrend {
  if (baseline.sampleCount < TREND_MIN_SAMPLES_PER_WINDOW
      || recent.sampleCount < TREND_MIN_SAMPLES_PER_WINDOW) {
    return unknownTrend(metric, 'INSUFFICIENT_EVIDENCE');
  }
  const vehicleCount = Math.min(baseline.vehicleCount, recent.vehicleCount);
  if (vehicleCount < TREND_MIN_VEHICLES) {
    return { ...unknownTrend(metric, 'SINGLE_VEHICLE_ONLY'), vehicleCount };
  }

  const b = baseline.sum / baseline.sampleCount;
  const r = recent.sum / recent.sampleCount;
  const rel = (r - b) / Math.max(Math.abs(b), 1e-9);

  const direction: TrendDirection =
    Math.abs(rel) < TREND_RELATIVE_THRESHOLD ? 'FLAT' : rel > 0 ? 'RISING' : 'FALLING';

  return {
    metric, direction,
    baselineValue: b, recentValue: r, relativeChange: rel,
    baselineSampleCount: baseline.sampleCount,
    recentSampleCount: recent.sampleCount,
    vehicleCount,
    confidence: computeInsightConfidence({
      evidenceCount: baseline.sampleCount + recent.sampleCount,
      vehicleCount,
      tripCount: baseline.sampleCount + recent.sampleCount,
      measuredRatio: 1,
    }),
    unknownReason: null,
  };
}

/* ── Filo sapması ──────────────────────────────────────────────────────── */

/**
 * FİLO düzeyinde sapma — **araç bazında DEĞİL**.
 *
 * Tek aracın değişimi filo sapması sayılmaz; bu yüzden her metrik en az
 * `TREND_MIN_VEHICLES` araç kanıtı istemek zorundadır. Sapma bir SUÇLAMA
 * değildir: mevsim, güzergâh veya iş hacmi de değişmiş olabilir — bu yüzden
 * YORUM ÜRETİLMEZ, yalnız kanıt taşınır.
 */
export function detectFleetDrift(
  trends: readonly FleetTrend[],
): { readonly state: FleetDriftState; readonly evidence: FleetDriftEvidence[] } {
  const evidence: FleetDriftEvidence[] = [];
  let comparable = 0;

  for (const t of trends) {
    if (t.direction === 'UNKNOWN' || t.relativeChange === null
        || t.baselineValue === null || t.recentValue === null) continue;
    if (t.vehicleCount < TREND_MIN_VEHICLES) continue;
    comparable += 1;
    if (Math.abs(t.relativeChange) >= FLEET_DRIFT_THRESHOLD) {
      evidence.push({
        metric: t.metric,
        baselineValue: t.baselineValue, recentValue: t.recentValue,
        relativeChange: t.relativeChange, vehicleCount: t.vehicleCount,
        baselineSampleCount: t.baselineSampleCount,
        recentSampleCount: t.recentSampleCount,
      });
    }
  }

  if (comparable === 0) return { state: 'INSUFFICIENT', evidence: [] };
  return { state: evidence.length > 0 ? 'DRIFTING' : 'STABLE', evidence };
}

/* ── Filo sağlığı ──────────────────────────────────────────────────────── */

/** Bir sağlık boyutunun HAM girdisi — hepsi ölçülmüş sayımlardır. */
export interface HealthDimensionInput {
  readonly dimension: HealthDimension;
  /** 0..1 endeksi; ölçülemiyorsa `null` → boyut `UNKNOWN` olur. */
  readonly index: number | null;
  readonly vehicleCount: number;
  readonly tripCount: number;
}

function healthStateOf(index: number): HealthState {
  if (index >= 0.75) return 'GOOD';
  if (index >= 0.45) return 'WATCH';
  return 'POOR';
}

/**
 * Sağlık boyutlarını hesaplar — **TEK PUAN ÜRETMEZ**.
 *
 * Ölçülemeyen boyut `UNKNOWN` kalır ve endeksi `null` olur; "veri yok" ile
 * "kötü" ASLA karıştırılmaz. Bir boyutun bilinmemesi diğerlerini de
 * belirsizleştirmez — her boyut kendi kanıtıyla durur.
 */
export function buildFleetHealth(input: {
  readonly companyId: string;
  readonly dimensions: readonly HealthDimensionInput[];
  readonly coverage: number | null;
  readonly coverageVehicleCount: number;
  readonly computedAt: number;
}): FleetHealth {
  const byDim = new Map<HealthDimension, HealthDimensionInput>();
  for (const d of input.dimensions) byDim.set(d.dimension, d);

  const results: HealthDimensionResult[] = HEALTH_DIMENSIONS.map((dimension) => {
    const d = byDim.get(dimension);
    if (d === undefined || d.index === null || !Number.isFinite(d.index)) {
      return {
        dimension, state: 'UNKNOWN' as const, index: null,
        confidence: 'UNKNOWN' as const,
        unknownReason: d === undefined
          ? ('NO_EVIDENCE' as const) : ('INSUFFICIENT_EVIDENCE' as const),
        vehicleCount: d?.vehicleCount ?? 0, tripCount: d?.tripCount ?? 0,
      };
    }
    const idx = Math.max(0, Math.min(1, d.index));
    return {
      dimension, state: healthStateOf(idx), index: idx,
      confidence: computeInsightConfidence({
        evidenceCount: Math.max(d.vehicleCount, d.tripCount),
        vehicleCount: d.vehicleCount, tripCount: d.tripCount, measuredRatio: 1,
      }),
      unknownReason: null,
      vehicleCount: d.vehicleCount, tripCount: d.tripCount,
    };
  });

  const coverage = input.coverage !== null && Number.isFinite(input.coverage)
    ? Math.max(0, Math.min(1, input.coverage)) : null;

  return {
    companyId: input.companyId,
    dimensions: results,
    coverage,
    coverageConfidence: coverage === null ? 'UNKNOWN'
      : computeInsightConfidence({
          evidenceCount: input.coverageVehicleCount,
          vehicleCount: input.coverageVehicleCount,
          tripCount: input.coverageVehicleCount, measuredRatio: 1,
        }),
    unknownDimensionCount: results.filter((r) => r.state === 'UNKNOWN').length,
    computedAt: input.computedAt,
  };
}

/**
 * VERİ KAPSAMI — filonun ne kadarı gerçekten ölçülüyor.
 *
 * Kapsam bir kalite ölçüsüdür, bir başarı ölçüsü değil: düşük kapsam
 * "filo kötü" demek değil, **"bilmiyoruz"** demektir. Araç yoksa `null`
 * döner (0 DEĞİL — bölme yapılamaz).
 */
export function computeCoverage(input: {
  readonly vehiclesTotal: number;
  readonly vehiclesReporting: number;
}): number | null {
  if (!Number.isFinite(input.vehiclesTotal) || input.vehiclesTotal <= 0) return null;
  const r = input.vehiclesReporting / input.vehiclesTotal;
  return Math.max(0, Math.min(1, r));
}

/* ── Cihaz tarafı gözlem yüzeyi (LAB) ──────────────────────────────────── */

export interface FleetIntelligenceSnapshot {
  readonly insights: readonly FleetInsight[];
  readonly trends: readonly FleetTrend[];
  readonly health: FleetHealth | null;
  readonly driftState: FleetDriftState;
  readonly driftEvidence: readonly FleetDriftEvidence[];
  /** İlk kanıtın işlendiği an — öğrenme yaşı buradan hesaplanır. */
  readonly learningStartedAtMs: number | null;
  readonly lastUpdateAtMs: number | null;
}

export const EMPTY_FLEET_INTELLIGENCE: FleetIntelligenceSnapshot = Object.freeze({
  insights: Object.freeze([]) as readonly FleetInsight[],
  trends: Object.freeze([]) as readonly FleetTrend[],
  health: null,
  driftState: 'INSUFFICIENT',
  driftEvidence: Object.freeze([]) as readonly FleetDriftEvidence[],
  learningStartedAtMs: null, lastUpdateAtMs: null,
});

/**
 * Fleet Intelligence deposu — **head unit'te BİLİNÇLİ OLARAK BOŞTUR.**
 *
 * Filo zekâsı FİLO düzeyinde birikir (sunucu, migration 054): tek bir araç
 * kendi başına filo hakkında bir iddia üretemez. Head unit'te üreten bir yol
 * YOKTUR; bu depo yalnız gelecekte bir okuma köprüsü bağlandığında dolacak
 * sözleşmeyi ve LAB'ın dürüst "henüz yok" cevabını sağlar.
 */
class FleetIntelligenceStore {
  private _snap: FleetIntelligenceSnapshot = EMPTY_FLEET_INTELLIGENCE;
  private _source: 'NONE' | 'SERVER' = 'NONE';

  /** Sunucudan okunmuş anlık görüntüyü yerleştirir. Head unit HESAPLAMAZ. */
  setFromServer(snap: FleetIntelligenceSnapshot): void {
    this._snap = snap;
    this._source = 'SERVER';
  }

  clear(): void {
    this._snap = EMPTY_FLEET_INTELLIGENCE;
    this._source = 'NONE';
  }

  /** LAB salt-okur — ASLA fırlatmaz, hiçbir şey tetiklemez. */
  read(nowMs: number): {
    readonly snapshot: FleetIntelligenceSnapshot;
    readonly source: 'NONE' | 'SERVER';
    readonly insightCount: number;
    readonly activeInsightCount: number;
    readonly evidenceCount: number;
    readonly trendCount: number;
    readonly unknownCount: number;
    readonly learningAgeMs: number | null;
    readonly coverage: number | null;
    readonly healthUnknownCount: number;
  } {
    try {
      const s = this._snap;
      const unknownInsights = s.insights.filter((i) => i.confidence === 'UNKNOWN').length;
      const unknownTrends = s.trends.filter((t) => t.direction === 'UNKNOWN').length;
      return {
        snapshot: s,
        source: this._source,
        insightCount: s.insights.length,
        activeInsightCount: s.insights.filter((i) => isInsightActive(i, nowMs)).length,
        evidenceCount: s.insights.reduce((n, i) => n + i.evidenceCount, 0),
        trendCount: s.trends.length,
        unknownCount: unknownInsights + unknownTrends
          + (s.health?.unknownDimensionCount ?? 0),
        learningAgeMs: s.learningStartedAtMs === null
          ? null : Math.max(0, nowMs - s.learningStartedAtMs),
        coverage: s.health?.coverage ?? null,
        healthUnknownCount: s.health?.unknownDimensionCount ?? 0,
      };
    } catch {
      return {
        snapshot: EMPTY_FLEET_INTELLIGENCE, source: 'NONE',
        insightCount: 0, activeInsightCount: 0, evidenceCount: 0,
        trendCount: 0, unknownCount: 0, learningAgeMs: null,
        coverage: null, healthUnknownCount: 0,
      };
    }
  }

  /** @internal — testler arası izolasyon. */
  _resetForTest(): void { this.clear(); }
}

export const fleetIntelligenceStore = new FleetIntelligenceStore();

/** LAB salt-okuma yüzeyi — içgörü ÜRETMEZ, yalnız okur. */
export function readFleetIntelligence(nowMs: number) {
  return fleetIntelligenceStore.read(nowMs);
}

/** @internal — testler arası izolasyon. */
export function _resetFleetIntelligenceStoreForTest(): void {
  fleetIntelligenceStore._resetForTest();
}

/** Kanıt provenance'ı ölçülmüş mü — dışarıya açık yardımcı (tek tanım). */
export function isMeasuredProvenance(p: EvidenceProvenance): boolean {
  return p === 'MEASURED';
}
