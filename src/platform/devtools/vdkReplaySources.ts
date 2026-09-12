/**
 * vdkReplaySources.ts — VDK REPLAY blokunun TEK okuma noktası (P0-VDK-F2B).
 *
 * ── PAZARLIKSIZ SINIRLAR ────────────────────────────────────────────────────
 *  · YALNIZ SENKRON, YAN ETKİSİZ getter. Hiçbir replay BAŞLATMAZ/DURDURMAZ.
 *  · Araca/adaptöre tek bayt GİTMEZ; iz DOSYASI okumaz, import ÇALIŞTIRMAZ.
 *  · Her okuma try/catch içinde; kaynak patlarsa `null` → alan KAYNAK YOK.
 *  · Yeni store/singleton/replay motoru KURULMAZ.
 *
 * ── GİZLİLİK ────────────────────────────────────────────────────────────────
 *  Ham istek/yanıt gövdesi bu katmandan DIŞARI ÇIKMAZ. LAB yalnız SAYIM ve
 *  SONUÇ SINIFI görür (`matched` · `mismatched` · `PARITY_MISMATCH`). Ham hex
 *  geliştiricinin verisidir ve kendi ekranında (Evidence Viewer) kalır; burada
 *  tekrarlanması gizlilik yüzeyini gereksiz büyütürdü.
 */

import {
  getActiveReplayRun, getReplayDeliveries, isReplayActive, vdkPduTransport,
} from '../obd/vdkTransport';
import type { PduCapabilities } from '../obd/pduTransport';
import { replayRunStats } from '../obd/virtualTransport';
import { getTraceEvents, getTraceProvenanceMode } from '../obd/canonicalTrace';
import {
  getFunctionalDtcEvidence, functionalDtcGapSignals,
  type FunctionalDtcEvidenceEntry,
} from '../obd/functionalDtcEvidence';
import {
  getGapRegistry, getGapRegistryDropped, type GapEntry,
} from '../obd/gapRegistry';
import { getLastConformanceRun } from '../obd/conformanceLedger';
import type { ConformanceRunResult } from '../obd/conformanceRun';
import type { ReplayGapSignal, ReplayMode, ReplayOutcome } from '../obd/virtualTransport';
import type { TraceProvenance } from '../obd/canonicalTrace';

function _safe<T>(fn: () => T): T | null {
  try {
    const v = fn();
    return v === undefined ? null : v;
  } catch {
    return null;
  }
}

/**
 * Tek seferlik senkron okuma.
 *
 * ⚠️ `null` alan "sıfır" DEĞİLDİR: koşu hiç açılmadıysa sayaçlar da YOKTUR ve
 * ekranda `0` değil KAYNAK YOK basılır. Sahte sıfır, bu ürünün defalarca
 * ödediği kusur sınıfıdır.
 */
export interface VdkReplayRawSnapshot {
  readonly active: boolean;
  readonly replayRunId: string | null;
  readonly sourceTraceId: string | null;
  readonly mode: ReplayMode | null;
  /** Kaynak izdeki toplam olay. */
  readonly sourceEventCount: number | null;
  /* ── muhasebe (koşu yoksa TAMAMI null) ─────────────────────────────────── */
  readonly requested: number | null;
  readonly matched: number | null;
  readonly mismatched: number | null;
  readonly exhausted: number | null;
  readonly noRecordedResponse: number | null;
  readonly cancelled: number | null;
  readonly timingInvalid: number | null;
  readonly unconsumed: number | null;
  readonly gapSignals: readonly ReplayGapSignal[] | null;
  /** Teslim sonuç dağılımı — sınıf → adet. */
  readonly outcomeCounts: Readonly<Partial<Record<ReplayOutcome, number>>> | null;
  /* ── canlı defterin damgası (karışım denetimi) ─────────────────────────── */
  readonly traceProvenanceMode: TraceProvenance | null;
  readonly liveTraceEventCount: number | null;
  readonly replayStampedEventCount: number | null;
  /* ── P0-VDK-F2C1 · fonksiyonel çözümleyici ────────────────────────────────
     Mode 03/07/0A çözümünü KİMİN yaptığı (kanonik TS · legacy native) ve
     kanonik/native çelişkisi. Hiç tur koşmadıysa BOŞ dizi — sahte satır YOK. */
  readonly functionalEntries: readonly FunctionalDtcEvidenceEntry[];
  /** Fonksiyonel çözümden türeyen yapısal boşluk sinyalleri. */
  readonly functionalGapSignals: readonly ReplayGapSignal[];
  /* ── P0-VDK-F2C2 · uygunluk koşusu + boşluk sicili ────────────────────────
     Koşu HİÇ yapılmadıysa `null` — "geçti" varsayılmaz (fail-closed). */
  readonly conformance: ConformanceRunResult | null;
  readonly gapRegistry: readonly GapEntry[];
  readonly gapRegistryDropped: number | null;
  /* ── P0-VDK-F3A · PDU taşıma yeteneği ─────────────────────────────────────
     Hangi taşımanın aktif olduğu ve GERÇEKTEN hangi servisleri taşıyabildiği.
     Okunamadıysa `null` — "her şeyi taşır" VARSAYILMAZ. */
  readonly pduCapabilities: PduCapabilities | null;
}

const EMPTY: VdkReplayRawSnapshot = Object.freeze({
  active: false, replayRunId: null, sourceTraceId: null, mode: null,
  sourceEventCount: null, requested: null, matched: null, mismatched: null,
  exhausted: null, noRecordedResponse: null, cancelled: null, timingInvalid: null,
  unconsumed: null, gapSignals: null, outcomeCounts: null,
  traceProvenanceMode: null, liveTraceEventCount: null, replayStampedEventCount: null,
  functionalEntries: [], functionalGapSignals: [],
  conformance: null, gapRegistry: [], gapRegistryDropped: null,
  pduCapabilities: null,
});

export function readVdkReplaySnapshot(): VdkReplayRawSnapshot {
  const active = _safe(() => isReplayActive()) ?? false;
  const run = _safe(() => getActiveReplayRun());
  const stats = run === null ? null : _safe(() => replayRunStats(run));
  const deliveries = _safe(() => getReplayDeliveries()) ?? [];
  const events = _safe(() => getTraceEvents()) ?? [];

  let counts: Partial<Record<ReplayOutcome, number>> | null = null;
  if (deliveries.length > 0) {
    counts = {};
    for (const d of deliveries) counts[d.outcome] = (counts[d.outcome] ?? 0) + 1;
  }

  return Object.freeze({
    ...EMPTY,
    active,
    replayRunId: run?.replayRunId ?? null,
    sourceTraceId: run?.sourceTraceId ?? null,
    mode: run?.mode ?? null,
    sourceEventCount: run?.events.length ?? null,
    requested: stats?.requested ?? null,
    matched: stats?.matched ?? null,
    mismatched: stats?.mismatched ?? null,
    exhausted: stats?.exhausted ?? null,
    noRecordedResponse: stats?.noRecordedResponse ?? null,
    cancelled: stats?.cancelled ?? null,
    timingInvalid: stats?.timingInvalid ?? null,
    unconsumed: stats?.unconsumed ?? null,
    gapSignals: stats?.gapSignals ?? null,
    outcomeCounts: counts,
    traceProvenanceMode: _safe(() => getTraceProvenanceMode()),
    liveTraceEventCount: events.length,
    replayStampedEventCount: events.filter((e) => e.provenance === 'replay').length,
    functionalEntries: _safe(() => getFunctionalDtcEvidence()) ?? [],
    functionalGapSignals: _safe(() => functionalDtcGapSignals()) ?? [],
    conformance: _safe(() => getLastConformanceRun()),
    gapRegistry: _safe(() => getGapRegistry()) ?? [],
    gapRegistryDropped: _safe(() => getGapRegistryDropped()),
    pduCapabilities: _safe(() => vdkPduTransport().capabilities),
  });
}
