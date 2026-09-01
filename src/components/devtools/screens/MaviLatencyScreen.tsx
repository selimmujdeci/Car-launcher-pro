/**
 * MaviLatencyScreen — CAROS LAB · Yapay Zekâ · Mavi Gecikme (F0).
 *
 * SALT-OKUNUR. Mavi'yi TETİKLEMEZ, mikrofon AÇMAZ, TTS ÇALIŞTIRMAZ, telemetriyi
 * AÇIP KAPATMAZ, defteri TEMİZLEMEZ, timer KURMAZ. Yalnız `maviLatencyTrace`
 * halka tamponunu okur (açılışta tek okuma + elle YENİLE — repodaki LAB deseni).
 *
 * ── GİZLİLİK ────────────────────────────────────────────────────────────────
 * `maviLatencyTrace` tasarımı gereği TRANSCRIPT · PROMPT · CEVAP METNİ · KİŞİ ·
 * KONUM · VIN TAŞIMAZ. Bu ekran da yalnız süre, sabit marker adı, sanitize
 * edilmiş route/provider kodu, bounded enum ve sayaç gösterir.
 *
 * ── DÜRÜSTLÜK ───────────────────────────────────────────────────────────────
 * "İlk ses" iki AYRI satırdır: DOĞRULANMIŞ (platform `playing`/`onstart` bildirdi)
 * ve PROXY (`play()` çağrıldı). Android native TextToSpeech başlangıç bildirimi
 * VERMEDİĞİ için native yolda yalnız PROXY vardır — ekran bunu açıkça söyler ve
 * proxy'yi doğrulanmış gibi ETİKETLEMEZ.
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw, ShieldCheck, Timer, ChevronRight } from 'lucide-react';
import {
  getMaviLatencyEvidence, type MaviLatencyEvidence,
} from '../../../platform/assistant/maviLatencyTrace';
import {
  buildMaviLatencyFields, buildTraceRows, buildMarkRows, deriveMaviLatencyVerdict,
  maviLatencyVerdictTone, summarize, MAVI_LATENCY_VERDICT_LABEL,
  FIRST_AUDIO_EVIDENCE_LABEL,
  type MaviLatencyInput, type MaviLatencyTone, type TraceRow, type TraceShape,
} from '../../../platform/devtools/maviLatencyModel';
import {
  OBSERVABILITY_LABEL,
  type InspectorField, type Observability,
} from '../../../platform/devtools/sessionInspectorModel';

const CLASS_STYLE: Record<Observability, string> = {
  OBSERVED:    'border-[var(--oem-good)] bg-[var(--oem-good-soft)] text-[var(--oem-good)]',
  DERIVED:     'border-[var(--oem-info)] bg-[var(--oem-info-soft)] text-[var(--oem-info)]',
  UNAVAILABLE: 'border-[var(--oem-line-strong)] bg-[var(--oem-surface-2)] text-[var(--oem-ink-3)]',
  STALE:       'border-[var(--oem-warn)] bg-[var(--oem-warn-soft)] text-[var(--oem-warn)]',
};

const TONE_STYLE: Record<MaviLatencyTone, string> = {
  ok:    'border-[var(--oem-good)] bg-[var(--oem-good-soft)] text-[var(--oem-good)]',
  muted: 'border-[var(--oem-line-strong)] bg-[var(--oem-surface-2)] text-[var(--oem-ink-3)]',
  warn:  'border-[var(--oem-warn)] bg-[var(--oem-warn-soft)] text-[var(--oem-warn)]',
  bad:   'border-[var(--oem-danger)] bg-[var(--oem-danger-soft)] text-[var(--oem-danger)]',
};

const FieldRow = memo(function FieldRow({ field }: { field: InspectorField }) {
  return (
    <div
      data-testid={`ml-field-${field.id}`}
      data-class={field.klass}
      className="grid grid-cols-[1fr_auto] gap-x-3 border-b border-[var(--oem-line)] px-2 py-1.5 last:border-b-0"
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="font-mono text-[11px] text-[var(--oem-ink-2)]">{field.label}</span>
          <span className="break-all font-mono text-[11px] text-[var(--oem-ink)]">{field.value}</span>
        </div>
        <div className="mt-0.5 font-mono text-[9px] text-[var(--oem-ink-3)]">{field.source}</div>
        {field.note && (
          <div className="mt-0.5 text-[9px] leading-relaxed text-[var(--oem-ink-3)]">{field.note}</div>
        )}
      </div>
      <span
        title={field.klass}
        className={`h-fit shrink-0 rounded border px-1.5 py-0.5 font-mono text-[9px] ${CLASS_STYLE[field.klass]}`}
      >
        {OBSERVABILITY_LABEL[field.klass]}
      </span>
    </div>
  );
});

const SEG_LABEL: ReadonlyArray<[keyof TraceRow['segments'], string]> = [
  ['warmupMs', 'mikrofon ısınma'],
  ['sttCaptureMs', 'native STT'],
  ['cloudSttMs', 'bulut STT'],
  ['endpointToTextMs', 'endpoint → metin'],
  ['textToRouteMs', 'metin → karar'],
  ['routeToBrainMs', 'karar → beyin'],
  ['brainMs', 'beyin'],
  ['brainToTtsMs', 'beyin → TTS'],
  ['ttsSynthesisMs', 'TTS sentez'],
  ['ttsToFirstAudioMs', 'TTS → ses istendi'],
  ['requestedToConfirmedMs', 'istendi → doğrulandı'],
  ['speechEndToResponseCompleteMs', 'konuşma sonu → cevap bitti'],
  ['speechEndToFillerMs', 'konuşma sonu → ara söz (engellendi)'],
  ['speechEndToAckMs', 'konuşma sonu → semantik ACK'],
  ['speechStartToFirstPartialMs', 'konuşma başı → ilk kısmi'],
  ['speechEndToEndpointMs', 'konuşma sonu → cümle-sonu kararı'],
  ['endpointToFinalMs', 'karar → nihai transkript'],
  ['brainToFirstTokenMs', 'beyin isteği → ilk token'],
  ['firstTokenToChunkMs', 'ilk token → ilk konuşma parçası'],
  ['chunkToTtsMs', 'parça → sentez istendi'],
  ['firstAudioToStreamCompleteMs', 'ilk ses → akış bitti'],
  ['firstAudioToBargeInMs', 'ses → barge-in'],
];

const TraceCard = memo(function TraceCard({
  row, trace, open, onToggle,
}: {
  row: TraceRow;
  trace: TraceShape;
  open: boolean;
  onToggle: () => void;
}) {
  const marks = open ? buildMarkRows(trace) : [];
  return (
    <div data-testid={`ml-trace-${row.traceId}`} className="border-b border-[var(--oem-line)] last:border-b-0">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-2 px-2 py-1.5 text-left hover:bg-[var(--oem-surface-2)]"
      >
        <ChevronRight
          size={11}
          className={`shrink-0 text-[var(--oem-ink-3)] transition-transform ${open ? 'rotate-90' : ''}`}
        />
        <span className="w-10 shrink-0 font-mono text-[10px] text-[var(--oem-ink-3)]">#{row.traceId}</span>
        <span className="w-16 shrink-0 font-mono text-[10px] text-[var(--oem-ink-3)]">
          {row.turnId === null ? 'tur yok' : `tur ${row.turnId}`}
        </span>
        <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-[var(--oem-ink-2)]">
          {row.route ?? 'route yok'}{row.provider ? ` · ${row.provider}` : ''}
          {row.presence ? ` · ${row.presence === 'companion' ? 'yol arkadaşı' : 'asistan'}` : ''}
        </span>
        <span
          data-testid={`ml-headline-${row.traceId}`}
          className={`shrink-0 rounded border px-1.5 py-0.5 font-mono text-[9px] ${
            row.headlineMs === null ? TONE_STYLE.muted
              : row.headlineIsProxy ? TONE_STYLE.warn : TONE_STYLE.ok
          }`}
        >
          {row.headlineMs === null
            ? 'ÖLÇÜM YOK'
            : `${row.headlineMs} ms${row.headlineIsProxy ? ' (proxy)' : ''}`}
        </span>
        <span className="w-20 shrink-0 text-right font-mono text-[9px] text-[var(--oem-ink-3)]">
          {row.outcome}
        </span>
      </button>

      {open && (
        <div className="space-y-1 bg-[var(--oem-surface-2)] px-3 pb-2 pt-1">
          <div className="flex flex-wrap gap-1 font-mono text-[9px]">
            <span className={`rounded border px-1.5 py-0.5 ${
              row.firstAudio === 'CONFIRMED' ? TONE_STYLE.ok
                : row.firstAudio === 'REQUESTED' ? TONE_STYLE.warn : TONE_STYLE.muted
            }`}>
              İLK SES: {FIRST_AUDIO_EVIDENCE_LABEL[row.firstAudio]}
            </span>
            {row.speechEndDerived && (
              <span className={`rounded border px-1.5 py-0.5 ${TONE_STYLE.muted}`}>
                konuşma sonu TÜRETİLMİŞ (native VAD deltası)
              </span>
            )}
            {row.fillerCount > 0 && (
              <span className={`rounded border px-1.5 py-0.5 ${TONE_STYLE.bad}`}>
                YAPAY ARA SÖZ ENGELLENDİ ×{row.fillerCount}
              </span>
            )}
            {row.ackCount > 0 && (
              <span className={`rounded border px-1.5 py-0.5 ${TONE_STYLE.muted}`}>
                semantik ACK ×{row.ackCount}
              </span>
            )}
            {row.sttCapability && (
              <span className={`rounded border px-1.5 py-0.5 ${TONE_STYLE.muted}`}>
                STT: {row.sttCapability}
              </span>
            )}
            {row.partialCount > 0 && (
              <span className={`rounded border px-1.5 py-0.5 ${TONE_STYLE.muted}`}>
                kısmi ×{row.partialCount}
              </span>
            )}
            {row.speechChunkCount > 0 && (
              <span className={`rounded border px-1.5 py-0.5 ${TONE_STYLE.muted}`}>
                akış ×{row.speechChunkCount} parça
              </span>
            )}
            {row.llmCapability && (
              <span className={`rounded border px-1.5 py-0.5 ${TONE_STYLE.muted}`}>
                LLM: {row.llmCapability}
              </span>
            )}
            {row.streamEndReason && (
              <span className={`rounded border px-1.5 py-0.5 ${
                row.streamEndReason === 'COMPLETED' ? TONE_STYLE.ok : TONE_STYLE.warn
              }`}>
                akış: {row.streamEndReason}
              </span>
            )}
            {row.endpointReason && (
              <span className={`rounded border px-1.5 py-0.5 ${
                row.endpointCommanded ? TONE_STYLE.warn : TONE_STYLE.muted
              }`}>
                cümle-sonu: {row.endpointReason}{row.endpointCommanded ? ' (KOMUT)' : ' (gölge)'}
              </span>
            )}
            {row.bargeIn && (
              <span className={`rounded border px-1.5 py-0.5 ${TONE_STYLE.warn}`}>barge-in</span>
            )}
            {row.failureCode && (
              <span className={`rounded border px-1.5 py-0.5 ${TONE_STYLE.bad}`}>
                sebep: {row.failureCode}
              </span>
            )}
          </div>

          <div className="grid grid-cols-2 gap-x-4">
            {SEG_LABEL.map(([key, label]) => {
              const v = row.segments[key];
              return (
                <div key={String(key)} className="flex justify-between gap-2 font-mono text-[9px]">
                  <span className="truncate text-[var(--oem-ink-3)]">{label}</span>
                  <span className={v === null ? 'text-[var(--oem-ink-3)]' : 'text-[var(--oem-ink)]'}>
                    {v === null ? '—' : `${v} ms`}
                  </span>
                </div>
              );
            })}
          </div>

          <div className="mt-1 border-t border-[var(--oem-line)] pt-1">
            <div className="mb-0.5 font-mono text-[9px] uppercase tracking-wider text-[var(--oem-ink-3)]">
              HAM DAMGALAR (dinleme başlangıcına göre)
            </div>
            {marks.length === 0 ? (
              <div className="font-mono text-[9px] text-[var(--oem-ink-3)]">damga yok</div>
            ) : marks.map((m) => (
              <div key={m.marker} className="flex justify-between gap-2 font-mono text-[9px]">
                <span className="truncate text-[var(--oem-ink-2)]">
                  {m.marker}
                  {m.origin === 'derived' && (
                    <span className="ml-1 text-[var(--oem-info)]">[türetilmiş]</span>
                  )}
                </span>
                <span className="text-[var(--oem-ink)]">
                  {m.offsetMs === null ? '—' : `+${m.offsetMs} ms`}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
});

export const MaviLatencyScreen = memo(function MaviLatencyScreen() {
  const [snap, setSnap] = useState<MaviLatencyEvidence>(() => getMaviLatencyEvidence());
  const [openId, setOpenId] = useState<number | null>(null);

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const refresh = useCallback(() => {
    if (mountedRef.current) setSnap(getMaviLatencyEvidence());
  }, []);

  const input: MaviLatencyInput = useMemo(() => ({
    enabled: snap.enabled,
    traces: snap.traces as unknown as readonly TraceShape[],
    capacity: snap.capacity,
    openTraceId: snap.openTraceId,
    tracesOpened: snap.tracesOpened,
    tracesClosed: snap.tracesClosed,
    orphanMarks: snap.orphanMarks,
    invalidMarks: snap.invalidMarks,
    duplicateMarks: snap.duplicateMarks,
    foreignAudioMarks: snap.foreignAudioMarks,
  }), [snap]);

  const fields = useMemo(() => buildMaviLatencyFields(input), [input]);
  const rows = useMemo(() => buildTraceRows(input.traces), [input.traces]);
  const summary = useMemo(() => summarize(input.traces), [input.traces]);
  const verdict = useMemo(
    () => deriveMaviLatencyVerdict({
      enabled: input.enabled, traceCount: input.traces.length, summary,
    }),
    [input.enabled, input.traces.length, summary],
  );

  const byId = useMemo(() => {
    const m = new Map<number, TraceShape>();
    for (const t of input.traces) m.set(t.traceId, t);
    return m;
  }, [input.traces]);

  return (
    <div className="flex h-full flex-col gap-2 overflow-y-auto" data-testid="mavi-latency">
      <div className="shrink-0 rounded border border-[var(--oem-line)] bg-[var(--oem-surface-1)] px-3 py-2">
        <div className="flex flex-wrap items-center gap-2 font-mono text-[10px]">
          <span className="flex items-center gap-1 text-[11px] font-bold tracking-wide text-[var(--oem-info)]">
            <Timer size={12} /> MAVİ GECİKME
          </span>
          <span className="flex items-center gap-1 rounded border border-[var(--oem-good)] bg-[var(--oem-good-soft)] px-1.5 py-0.5 text-[var(--oem-good)]">
            <ShieldCheck size={11} /> SALT OKUNUR — Mavi'yi tetiklemez
          </span>
          <button
            type="button"
            data-testid="ml-refresh"
            onClick={refresh}
            className="flex items-center gap-1 rounded border border-[var(--oem-line-strong)] px-2 py-1 text-[var(--oem-ink-2)] hover:bg-[var(--oem-surface-2)]"
          >
            <RefreshCw size={11} /> YENİLE
          </button>
          <span
            data-testid="ml-verdict"
            data-verdict={verdict}
            className={`rounded border px-1.5 py-0.5 ${TONE_STYLE[maviLatencyVerdictTone(verdict)]}`}
          >
            {MAVI_LATENCY_VERDICT_LABEL[verdict]}
          </span>
        </div>
        <p className="mt-1 font-mono text-[9px] leading-relaxed text-[var(--oem-ink-3)]">
          Transcript, prompt ve cevap metni bu ekrana GELMEZ — yalnız süre, sabit marker adı,
          route/provider kodu ve sayaç. Defter süreç ömürlüdür. "PROXY" satırı bir KANIT
          DEĞİLDİR: yalnız oynatmanın istendiği anı ölçer. Android native TextToSpeech bu
          derlemede başlangıç bildirimi VERMEZ → native yolda doğrulama YAPILAMAZ.
          <strong className="text-[var(--oem-warn)]"> GERÇEK CİHAZ ÖLÇÜMÜ YAPILMADI —
          DEVICE VALIDATION REQUIRED (kütük F0).</strong>
        </p>
      </div>

      <div className="shrink-0 rounded border border-[var(--oem-line)] bg-[var(--oem-surface-1)]">
        {fields.map((f) => <FieldRow key={f.id} field={f} />)}
      </div>

      <div className="shrink-0 rounded border border-[var(--oem-line)] bg-[var(--oem-surface-1)]">
        <div className="border-b border-[var(--oem-line)] px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-[var(--oem-ink-2)]">
          İZLER (en yeni başta · satıra dokun → damga zinciri)
        </div>
        {rows.length === 0 ? (
          <div className="px-2 py-3 font-mono text-[10px] text-[var(--oem-ink-3)]">
            KAYNAK YOK — henüz ölçülmüş sesli tur yok.
            {!input.enabled && ' Telemetri KAPALI: localStorage["mavi.latencyTrace.enabled"]="true" ile açılır (sonraki tur ölçülür).'}
          </div>
        ) : rows.map((r) => {
          const t = byId.get(r.traceId);
          if (!t) return null;
          return (
            <TraceCard
              key={r.traceId}
              row={r}
              trace={t}
              open={openId === r.traceId}
              onToggle={() => setOpenId(openId === r.traceId ? null : r.traceId)}
            />
          );
        })}
      </div>
    </div>
  );
});

export default MaviLatencyScreen;
