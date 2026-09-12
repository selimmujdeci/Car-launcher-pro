/**
 * toolCallingModel — CAROS LAB · Araç Çağrısı SAF modeli.
 *
 * SAFLIK SÖZLEŞMESİ: I/O YOK · timer YOK · `Date.now()` YOK · global durum YOK ·
 * React importu YOK. Girdi YAPISALDIR (servis importu yok → mock'suz test).
 *
 * ── DÜRÜSTLÜK ───────────────────────────────────────────────────────────────
 *  · Hiç çağrı yoksa başarı oranı UYDURULMAZ (`null`) — "%100 başarılı" demek
 *    hiç denenmemiş bir sistemi sağlıklı göstermek olurdu.
 *  · Süre istatistiği yalnız ÖLÇÜLMÜŞ kayıtlardan çıkar.
 *  · Tavana takılan tur AYRI sayılır: model araç istiyordu ama alamadı; bu
 *    sessizce "araçsız cevap" üretilen durumdur ve başarısızlıkla KARIŞTIRILMAZ.
 */

import {
  observed, derived, unavailable, formatAge,
  type InspectorField,
} from './sessionInspectorModel';

const SRC_EVID = 'ai/tools/toolCallEvidence.getToolCallEvidence';

/** Girdi YAPISALDIR — `toolCallEvidence` çıktısının şeklidir. */
export interface ToolCallRecordShape {
  readonly toolName: string;
  readonly effect: string;
  readonly ok: boolean;
  readonly errorCode: string | null;
  readonly durationMs: number;
  readonly resultFields: number;
  readonly atMs: number;
}

export interface ToolCallingInput {
  readonly records: readonly ToolCallRecordShape[];
  readonly capacity: number;
  readonly totalCalls: number;
  readonly failedCalls: number;
  readonly totalLoops: number;
  readonly cappedLoops: number;
  readonly lastCallAtMs: number | null;
  readonly nowMs: number;
}

/* ── Hüküm ───────────────────────────────────────────────────────────────── */

export type ToolCallVerdict =
  /** Bu oturumda hiç araç çağrısı olmadı — hüküm YOK. */
  | 'NO_CALLS'
  /** Çağrılar var ve hepsi başarılı. */
  | 'HEALTHY'
  /** Bir kısmı düştü. */
  | 'DEGRADED'
  /** Hepsi düştü. */
  | 'FAILING'
  /** Turlar tavana takılıyor — model araç istiyor ama alamıyor. */
  | 'CAPPED';

export const TOOL_CALL_VERDICT_LABEL: Readonly<Record<ToolCallVerdict, string>> = {
  NO_CALLS: 'ÇAĞRI YOK — hüküm verilemez',
  HEALTHY:  'SAĞLIKLI',
  DEGRADED: 'KISMİ — bazı çağrılar düştü',
  FAILING:  'TÜM ÇAĞRILAR DÜŞTÜ',
  CAPPED:   'TUR TAVANI DOLUYOR — model araç istiyor, alamıyor',
} as const;

export type ToolCallTone = 'ok' | 'muted' | 'warn' | 'bad';

export function toolCallVerdictTone(v: ToolCallVerdict): ToolCallTone {
  switch (v) {
    case 'HEALTHY':  return 'ok';
    case 'NO_CALLS': return 'muted';
    case 'DEGRADED': return 'warn';
    case 'CAPPED':   return 'warn';
    case 'FAILING':  return 'bad';
  }
}

/**
 * Genel hüküm. `CAPPED`, `HEALTHY`'yi EZER: çağrılar başarılı olsa bile model
 * istediği aracı alamıyorsa cevap eksik veriyle üretiliyor demektir.
 */
export function deriveToolCallVerdict(input: {
  readonly totalCalls: number;
  readonly failedCalls: number;
  readonly cappedLoops: number;
}): ToolCallVerdict {
  if (input.totalCalls === 0) {
    return input.cappedLoops > 0 ? 'CAPPED' : 'NO_CALLS';
  }
  if (input.failedCalls >= input.totalCalls) return 'FAILING';
  if (input.cappedLoops > 0) return 'CAPPED';
  return input.failedCalls > 0 ? 'DEGRADED' : 'HEALTHY';
}

/** Başarı oranı (0..1); hiç çağrı yoksa `null` — UYDURULMAZ. */
export function successRate(input: {
  readonly totalCalls: number;
  readonly failedCalls: number;
}): number | null {
  if (input.totalCalls <= 0) return null;
  return (input.totalCalls - input.failedCalls) / input.totalCalls;
}

/** Araç adına göre çağrı/başarısızlık dağılımı. */
export interface ToolBreakdown {
  readonly toolName: string;
  readonly calls: number;
  readonly failed: number;
  /** Ölçülmüş sürelerin ortalaması (ms); ölçüm yoksa `null`. */
  readonly avgMs: number | null;
}

export function breakdownByTool(
  records: readonly ToolCallRecordShape[],
): readonly ToolBreakdown[] {
  const map = new Map<string, { calls: number; failed: number; sum: number; n: number }>();
  for (const r of records) {
    const e = map.get(r.toolName) ?? { calls: 0, failed: 0, sum: 0, n: 0 };
    e.calls += 1;
    if (!r.ok) e.failed += 1;
    if (Number.isFinite(r.durationMs) && r.durationMs > 0) { e.sum += r.durationMs; e.n += 1; }
    map.set(r.toolName, e);
  }
  return [...map.entries()]
    .map(([toolName, e]) => ({
      toolName, calls: e.calls, failed: e.failed,
      avgMs: e.n > 0 ? Math.round(e.sum / e.n) : null,
    }))
    .sort((a, b) => b.calls - a.calls);
}

/** En sık görülen hata kodu; hata yoksa `null`. */
export function dominantErrorCode(
  records: readonly ToolCallRecordShape[],
): string | null {
  const counts = new Map<string, number>();
  for (const r of records) {
    if (r.ok || r.errorCode === null) continue;
    counts.set(r.errorCode, (counts.get(r.errorCode) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestN = 0;
  for (const [code, n] of counts) if (n > bestN) { best = code; bestN = n; }
  return best;
}

/* ── Alanlar ─────────────────────────────────────────────────────────────── */

export function buildToolCallFields(i: ToolCallingInput): readonly InspectorField[] {
  const out: InspectorField[] = [];

  out.push(observed({
    id: 'tc-calls', label: 'Araç çağrısı', source: SRC_EVID,
    note: 'Oturum boyunca doyumlu sayaç — halka tampon taşsa bile artmaya devam eder.',
  }, `${i.totalCalls} (${i.failedCalls} düştü)`));

  const rate = successRate(i);
  out.push(rate === null
    ? unavailable({ id: 'tc-rate', label: 'Başarı oranı', source: SRC_EVID, note: '' },
        'Hiç çağrı yok — oran UYDURULMAZ ("%100 başarılı" hiç denenmemiş bir sistemi sağlıklı gösterirdi).')
    : derived({
        id: 'tc-rate', label: 'Başarı oranı', source: SRC_EVID,
        note: 'Yalnız gerçekleşen çağrılardan türetildi.',
      }, `%${Math.round(rate * 100)}`));

  out.push(observed({
    id: 'tc-loops', label: 'Tool loop turu', source: SRC_EVID,
    note: i.cappedLoops > 0
      ? 'TAVANA TAKILAN tur AYRI sayılır: model araç istiyordu ama alamadı — bu, sessizce "araçsız cevap" üretilen durumdur ve başarısızlıkla KARIŞTIRILMAZ.'
      : 'Tavana takılan tur yok.',
  }, `${i.totalLoops} tur · ${i.cappedLoops} tavan`));

  out.push(i.lastCallAtMs === null
    ? unavailable({ id: 'tc-last', label: 'Son çağrı yaşı', source: SRC_EVID, note: '' },
        'Hiç çağrı yok — damga YOK.')
    : derived({
        id: 'tc-last', label: 'Son çağrı yaşı', source: SRC_EVID,
        note: 'Damgadan türetildi.', updatedAt: i.lastCallAtMs,
      }, formatAge(i.lastCallAtMs, i.nowMs)));

  const dom = dominantErrorCode(i.records);
  out.push(dom === null
    ? observed({
        id: 'tc-error', label: 'Baskın hata kodu', source: SRC_EVID,
        note: 'Defterde başarısız çağrı yok.',
      }, 'yok')
    : observed({
        id: 'tc-error', label: 'Baskın hata kodu', source: SRC_EVID,
        note: 'Yalnız KOD — hata mesajı ve argüman TAŞINMAZ.',
      }, dom));

  out.push(observed({
    id: 'tc-buffer', label: 'Kanıt tamponu', source: SRC_EVID,
    note: 'Süreç ömürlü halka tampon; uygulama yeniden başlayınca boşalır (kalıcı depo YOK).',
  }, `${i.records.length}/${i.capacity}`));

  return out;
}
