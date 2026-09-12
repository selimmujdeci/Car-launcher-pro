/**
 * sttConditionSummaryModel.ts — MAVI-STT-LAB-3: koşul bazlı TOPLU özet (SAF model).
 *
 * SAF: I/O yok · timer yok · `Date.now()` yok · `Math.random()` yok · MODÜL SEVİYESİ
 * MUTABLE CACHE YOK · React importu yok. Girdi mevcut STT-LAB-2 defteridir; yeni
 * ölçüm kaynağı veya ikinci kalıcı depo KURULMAZ.
 *
 * ── İKİ SEVİYELİ İSTATİSTİK (karıştırılması YASAK) ──────────────────────────
 *  1. seviye — KAYIT İÇİ: bir ölçümün 21 örneğinden hesaplanan p50/p95 (LAB-2).
 *  2. seviye — KAYITLAR ARASI: aynı koşulun N ölçümünün p50 değerlerinin MEDYANI.
 * Bu dosya YALNIZ 2. seviyeyi üretir. Ham örnekler ne açılır ne saklanır — zaten
 * kayıtta yoktur (LAB-2 sözleşmesi). Bir kaydın kendi örnekleriyle başka bir kaydın
 * örnekleri ASLA aynı havuza konmaz.
 *
 * ── MERKEZ DEĞER: MEDYAN ────────────────────────────────────────────────────
 * Ortalama DEĞİL medyan kullanılır: tek bir bozuk ölçüm (kapı çarpması, geçici
 * kaynak kaybı) ortalamayı kaydırır, medyanı kaydırmaz. Medyan `percentileNearestRank`
 * ile hesaplanır (LAB-1/LAB-2 ile AYNI TEK GERÇEK) → deterministiktir ve dönen değer
 * HER ZAMAN gerçekten ölçülmüş bir kayda aittir.
 *
 * ── BU MODEL NE YAPMAZ ──────────────────────────────────────────────────────
 * Eşik ÖNERMEZ · "iyi/kötü/uygun" hükmü VERMEZ · nedensellik KURMAZ · koşul
 * ETİKETİNDEN gerçek hız/fan sonucu ÇIKARMAZ (etiket yalnız kullanıcı beyanıdır).
 *
 * ── GİZLİLİK (YAPISAL) ──────────────────────────────────────────────────────
 * Çıktı tipinde `measurementId` dahil hiçbir kayıt kimliği YOKTUR; transcript ·
 * n-best · wake sözcüğü · grammar KELİMESİ · ham ses TAŞIYAN ALAN BULUNMAZ.
 */

import { percentileNearestRank } from './sttMicModel';
import {
  STT_CONDITION_IDS, STT_CONDITION_LABEL,
  type SttConditionId, type SttMeasurementRecord,
} from './sttMeasurementModel';

/* ══════════════════════════════════════════════════════════════════════════
 * Sabitler
 * ════════════════════════════════════════════════════════════════════════ */

/** Bu sayının ALTINDA tekrar varsa toplu istatistik GÖSTERİLMEZ. */
export const STT_MIN_REPEATS = 3;

/** Dağılım listeleri bounded — koşul enum'u zaten 8 ile sınırlı. */
export const MAX_DISTRIBUTION_ENTRIES = 8;

export type SttSummaryStatus = 'NO_DATA' | 'INSUFFICIENT_REPEATS' | 'READY';

export const STT_SUMMARY_STATUS_LABEL: Readonly<Record<SttSummaryStatus, string>> = {
  NO_DATA:              'KAYNAK YOK',
  INSUFFICIENT_REPEATS: 'YETERSİZ TEKRAR',
  READY:                'YETERLİ TEKRAR',
} as const;

/* ── Toplulaştırılan metrikler ───────────────────────────────────────────── */

export const STT_AGG_METRIC_IDS = [
  'rmsP50', 'rmsP95',
  'floorP50', 'floorP95',
  'thrP50', 'thrP95',
  'speechRatio',
  'speedP50', 'speedP95',
  'validSampleRatio', 'missingSourceRatio',
] as const;

export type SttAggMetricId = (typeof STT_AGG_METRIC_IDS)[number];

export const STT_AGG_METRIC_LABEL: Readonly<Record<SttAggMetricId, string>> = {
  rmsP50:             'RMS p50',
  rmsP95:             'RMS p95',
  floorP50:           'gürültü tabanı p50',
  floorP95:           'gürültü tabanı p95',
  thrP50:             'VAD eşiği p50',
  thrP95:             'VAD eşiği p95',
  speechRatio:        'konuşma algılanma oranı',
  speedP50:           'hız p50 (km/s)',
  speedP95:           'hız p95 (km/s)',
  validSampleRatio:   'geçerli örnek oranı',
  missingSourceRatio: 'eksik kaynak oranı',
} as const;

/** Oran sınıfı metrikler yüzde olarak gösterilir. */
export const STT_AGG_METRIC_IS_RATIO: Readonly<Record<SttAggMetricId, boolean>> = {
  rmsP50: false, rmsP95: false, floorP50: false, floorP95: false,
  thrP50: false, thrP95: false, speechRatio: true,
  speedP50: false, speedP95: false,
  validSampleRatio: true, missingSourceRatio: true,
} as const;

/* ══════════════════════════════════════════════════════════════════════════
 * Kayıtlar arası toplulaştırma
 * ════════════════════════════════════════════════════════════════════════ */

export interface AggregateStats {
  /** Bu metrik için DEĞER ÜRETMİŞ kayıt sayısı (toplam kayıt sayısı DEĞİL). */
  readonly validRecords: number;
  readonly median: number;
  readonly min: number;
  readonly max: number;
  /** Dağılım genişliği = max − min. Tek kayıtta 0 olabilir (tekrar sayılmaz). */
  readonly spread: number;
}

/**
 * Kayıtlar arası özet. DIŞLANANLAR: `null` · `undefined` · `NaN` · `±Infinity` ·
 * negatif (`-1` sentinel). DAHİL: gerçek `0`.
 * Geçerli kayıt yoksa `null` — SIFIR İSTATİSTİĞİ UYDURULMAZ.
 */
export function aggregateAcrossRecords(
  values: readonly (number | null | undefined)[] | null | undefined,
): AggregateStats | null {
  if (!Array.isArray(values) || values.length === 0) return null;
  const vals: number[] = [];
  for (const v of values) {
    if (typeof v === 'number' && Number.isFinite(v) && v >= 0) vals.push(v);
  }
  if (vals.length === 0) return null;

  const sorted = vals.slice().sort((a, b) => a - b);
  const min = sorted[0]!;
  const max = sorted[sorted.length - 1]!;
  return {
    validRecords: vals.length,
    // MEDYAN — ortalama DEĞİL (tek bozuk ölçüm merkezi kaydırmasın).
    median: percentileNearestRank(sorted, 0.5),
    min, max,
    spread: max - min,
  };
}

/* ══════════════════════════════════════════════════════════════════════════
 * Dağılımlar
 * ════════════════════════════════════════════════════════════════════════ */

export interface DistributionEntry {
  readonly key: string;
  readonly count: number;
}

/**
 * Kararlı, bounded dağılım. Sıra: adet AZALAN, eşitlikte anahtar ALFABETİK →
 * aynı girdi HER ZAMAN aynı çıktıyı verir (deterministik markup).
 */
export function buildDistribution(keys: readonly string[]): DistributionEntry[] {
  const counts = new Map<string, number>();
  for (const k of Array.isArray(keys) ? keys : []) {
    if (typeof k !== 'string' || k.length === 0) continue;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => (b.count - a.count) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
    .slice(0, MAX_DISTRIBUTION_ENTRIES);
}

/** AEC/NS/AGC üçlüsünün kararlı gösterimi: M=mevcut · O=oluşturuldu · E=etkin. */
export function effectKey(rec: SttMeasurementRecord): string {
  const t = (av: boolean, cr: boolean, en: boolean): string =>
    `${av ? 'M' : '-'}${cr ? 'O' : '-'}${en ? 'E' : '-'}`;
  return `AEC ${t(rec.aecAvailable, rec.aecCreated, rec.aecEnabled)}`
    + ` · NS ${t(rec.nsAvailable, rec.nsCreated, rec.nsEnabled)}`
    + ` · AGC ${t(rec.agcAvailable, rec.agcCreated, rec.agcEnabled)}`;
}

/* ══════════════════════════════════════════════════════════════════════════
 * Koşul özeti
 * ════════════════════════════════════════════════════════════════════════ */

export interface SttConditionSummary {
  readonly conditionId: SttConditionId;
  readonly label: string;
  /** `complete` kayıt sayısı — TOPLU METRİKLERİN kaynağı yalnız bunlardır. */
  readonly completeCount: number;
  /** `source_lost` kayıt sayısı — AYRI sayılır, metriklere KARIŞMAZ. */
  readonly sourceLostCount: number;
  /** Defterdeki bu koşula ait TÜM kayıtlar (complete + source_lost). */
  readonly totalCount: number;
  readonly status: SttSummaryStatus;
  readonly hasEnoughRepeats: boolean;
  /** Duvar-saati damgaları; kayıt yoksa null ("şimdi" UYDURULMAZ). */
  readonly firstAt: number | null;
  readonly lastAt: number | null;
  readonly sourceDistribution: readonly DistributionEntry[];
  readonly sampleRateDistribution: readonly DistributionEntry[];
  readonly effectDistribution: readonly DistributionEntry[];
  readonly grammarDistribution: readonly DistributionEntry[];
  /** Hız kanıtı HİÇ üretmemiş `complete` kayıtların oranı. null = kayıt yok. */
  readonly speedUnknownRecordRatio: number | null;
  readonly metrics: Readonly<Record<SttAggMetricId, AggregateStats | null>>;
}

function _metricValue(rec: SttMeasurementRecord, id: SttAggMetricId): number | null {
  switch (id) {
    case 'rmsP50':   return rec.rms?.p50 ?? null;
    case 'rmsP95':   return rec.rms?.p95 ?? null;
    case 'floorP50': return rec.noiseFloor?.p50 ?? null;
    case 'floorP95': return rec.noiseFloor?.p95 ?? null;
    case 'thrP50':   return rec.threshold?.p50 ?? null;
    case 'thrP95':   return rec.threshold?.p95 ?? null;
    case 'speechRatio': return rec.speechDetectedRatio;
    case 'speedP50': return rec.speed?.p50 ?? null;
    case 'speedP95': return rec.speed?.p95 ?? null;
    /* Kayıt İÇİ oranlar — kayıtlar arası ikinci seviyede toplulaştırılır.
       Payda 0 ise oran ÜRETİLMEZ (sahte %0 yok). */
    case 'validSampleRatio':
      return rec.samplesTaken > 0 ? rec.samplesValid / rec.samplesTaken : null;
    case 'missingSourceRatio':
      return rec.samplesTaken > 0 ? rec.missingSourceCount / rec.samplesTaken : null;
    default: return null;
  }
}

function _emptyMetrics(): Record<SttAggMetricId, AggregateStats | null> {
  const out = {} as Record<SttAggMetricId, AggregateStats | null>;
  for (const id of STT_AGG_METRIC_IDS) out[id] = null;
  return out;
}

/**
 * Tek koşulun özeti.
 *
 * KURALLAR:
 *  · YALNIZ `complete` kayıtlar metriğe girer.
 *  · `cancelled` zaten deftere GİRMEZ (LAB-2 sözleşmesi); yine de burada da süzülür
 *    (savunma iki katlı — biri sözleşmeyi gevşetirse metrikler bozulmasın).
 *  · `source_lost` AYRI sayılır ve hiçbir metriğe, dağılıma veya damgaya KARIŞMAZ.
 *  · `completeCount < STT_MIN_REPEATS` ise metrikler yine HESAPLANIR ama durum
 *    YETERSİZ TEKRAR'dır — UI bu durumda toplu sayıyı öne çıkarmaz.
 */
export function summarizeCondition(
  conditionId: SttConditionId,
  ledger: readonly SttMeasurementRecord[],
): SttConditionSummary {
  const all = (Array.isArray(ledger) ? ledger : []).filter((r) => r && r.conditionId === conditionId);
  const complete = all.filter((r) => r.outcome === 'complete');
  const sourceLost = all.filter((r) => r.outcome === 'source_lost');
  const totalCount = complete.length + sourceLost.length;

  const metrics = _emptyMetrics();
  for (const id of STT_AGG_METRIC_IDS) {
    metrics[id] = aggregateAcrossRecords(complete.map((r) => _metricValue(r, id)));
  }

  /* Damgalar YALNIZ complete kayıtlardan (source_lost merkez/aralık bozmaz). */
  let firstAt: number | null = null;
  let lastAt: number | null = null;
  for (const r of complete) {
    if (typeof r.startedAt !== 'number' || !Number.isFinite(r.startedAt) || r.startedAt <= 0) continue;
    if (firstAt === null || r.startedAt < firstAt) firstAt = r.startedAt;
    if (lastAt === null || r.startedAt > lastAt) lastAt = r.startedAt;
  }

  const hasEnoughRepeats = complete.length >= STT_MIN_REPEATS;
  const status: SttSummaryStatus = totalCount === 0
    ? 'NO_DATA'
    : hasEnoughRepeats ? 'READY' : 'INSUFFICIENT_REPEATS';

  return {
    conditionId,
    label: STT_CONDITION_LABEL[conditionId],
    completeCount:   complete.length,
    sourceLostCount: sourceLost.length,
    totalCount,
    status,
    hasEnoughRepeats,
    firstAt, lastAt,
    sourceDistribution:     buildDistribution(complete.map((r) => r.selectedSourceName)),
    sampleRateDistribution: buildDistribution(complete.map((r) => (r.sampleRate > 0 ? `${r.sampleRate} Hz` : 'BİLİNMİYOR'))),
    effectDistribution:     buildDistribution(complete.map(effectKey)),
    grammarDistribution:    buildDistribution(complete.map((r) => r.grammarType)),
    /* Hız KANITI hiç üretmemiş kayıtların oranı — 0 km/s SAYILMAZ. */
    speedUnknownRecordRatio: complete.length > 0
      ? complete.filter((r) => r.speed === null).length / complete.length
      : null,
    metrics,
  };
}

/**
 * Tüm koşulların özeti — SABİT enum sırasında ve HER ZAMAN 8 satır.
 * Kayıt olmayan koşul da görünür (KAYNAK YOK) → "ölçüm alınmamış koşul" gizlenmez.
 */
export function buildConditionSummaries(
  ledger: readonly SttMeasurementRecord[],
): SttConditionSummary[] {
  return STT_CONDITION_IDS.map((id) => summarizeCondition(id, ledger));
}

/* ══════════════════════════════════════════════════════════════════════════
 * İki koşul karşılaştırması — YALNIZ MATEMATİKSEL FARK
 * ════════════════════════════════════════════════════════════════════════ */

export interface SttConditionDiffRow {
  readonly id: string;
  readonly label: string;
  readonly a: string;
  readonly b: string;
  readonly diff: string;
  readonly diffValue: number | null;
}

export interface SttConditionComparison {
  readonly aId: SttConditionId;
  readonly bId: SttConditionId;
  readonly rows: readonly SttConditionDiffRow[];
}

function _fmt(v: number | null, digits: number, asRatio: boolean): string {
  if (v === null || !Number.isFinite(v)) return '—';
  return asRatio ? `${(v * 100).toFixed(1)}%` : v.toFixed(digits);
}

function _diffText(d: number | null, digits: number, asRatio: boolean): string {
  if (d === null || !Number.isFinite(d)) return '—';
  const sign = d >= 0 ? '+' : '';
  return asRatio ? `${sign}${(d * 100).toFixed(1)} puan` : `${sign}${d.toFixed(digits)}`;
}

function _row(
  id: string, label: string,
  av: number | null, bv: number | null,
  digits: number, asRatio = false,
): SttConditionDiffRow {
  const d = av !== null && bv !== null && Number.isFinite(av) && Number.isFinite(bv) ? bv - av : null;
  return {
    id, label,
    a: _fmt(av, digits, asRatio),
    b: _fmt(bv, digits, asRatio),
    diff: _diffText(d, digits, asRatio),
    diffValue: d,
  };
}

/**
 * İki koşul özetinin farkı. **Hüküm, öneri veya nedensellik ÜRETMEZ:** satırlarda
 * "daha iyi", "uygun eşik", "hızdan kaynaklandı" gibi hiçbir yorum YOKTUR —
 * yalnız A, B ve B−A. Yorum tamamen okuyucuya aittir.
 */
export function compareConditionSummaries(
  a: SttConditionSummary,
  b: SttConditionSummary,
): SttConditionComparison {
  const m = (s: SttConditionSummary, id: SttAggMetricId): AggregateStats | null => s.metrics[id];
  const med = (s: SttConditionSummary, id: SttAggMetricId): number | null => m(s, id)?.median ?? null;

  return {
    aId: a.conditionId,
    bId: b.conditionId,
    rows: [
      _row('cdFloor',  'gürültü tabanı p50 medyanı', med(a, 'floorP50'), med(b, 'floorP50'), 4),
      _row('cdRms',    'RMS p50 medyanı',            med(a, 'rmsP50'),   med(b, 'rmsP50'),   4),
      _row('cdThr',    'VAD eşiği p50 medyanı',      med(a, 'thrP50'),   med(b, 'thrP50'),   4),
      _row('cdSpeech', 'konuşma algılanma oranı medyanı', med(a, 'speechRatio'), med(b, 'speechRatio'), 4, true),
      _row('cdSpeed',  'hız p50 medyanı (km/s)',     med(a, 'speedP50'), med(b, 'speedP50'), 1),
      _row('cdSpread', 'gürültü tabanı p50 dağılım genişliği',
        m(a, 'floorP50')?.spread ?? null, m(b, 'floorP50')?.spread ?? null, 4),
      _row('cdRepeats', 'tamamlanmış kayıt sayısı', a.completeCount, b.completeCount, 0),
    ],
  };
}
