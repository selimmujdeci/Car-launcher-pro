/**
 * ToolCallingScreen — CAROS LAB · Yapay Zekâ · Araç Çağrısı.
 *
 * SALT-OKUNUR. Araç ÇAĞIRMAZ, Mavi'yi tetiklemez, tool loop BAŞLATMAZ, defteri
 * temizlemez. Yalnız `toolCallEvidence` halka tamponunu okur.
 *
 * ZAMANLAYICI YOK: repodaki CAROS LAB deseni — açılışta tek okuma + elle YENİLE.
 *
 * ── GİZLİLİK ────────────────────────────────────────────────────────────────
 * `ToolTelemetry` tasarımı gereği ARGÜMAN ve SONUÇ TAŞIMAZ; bu ekran da yalnız
 * onu gösterir: araç ADI · etki sınıfı · başarı · hata KODU · süre · alan ADEDİ.
 * Kullanıcı sorusu, araç argümanı, araç çıktısı ve serbest metin BURAYA GELMEZ.
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw, ShieldCheck, Wrench } from 'lucide-react';
import {
  getToolCallEvidence, type ToolCallEvidence,
} from '../../../platform/ai/tools/toolCallEvidence';
import {
  buildToolCallFields, breakdownByTool, deriveToolCallVerdict,
  toolCallVerdictTone, TOOL_CALL_VERDICT_LABEL,
  type ToolCallTone,
} from '../../../platform/devtools/toolCallingModel';
import {
  formatAge, OBSERVABILITY_LABEL,
  type InspectorField, type Observability,
} from '../../../platform/devtools/sessionInspectorModel';

const CLASS_STYLE: Record<Observability, string> = {
  OBSERVED:    'border-[var(--oem-good)] bg-[var(--oem-good-soft)] text-[var(--oem-good)]',
  DERIVED:     'border-[var(--oem-info)] bg-[var(--oem-info-soft)] text-[var(--oem-info)]',
  UNAVAILABLE: 'border-[var(--oem-line-strong)] bg-[var(--oem-surface-2)] text-[var(--oem-ink-3)]',
  STALE:       'border-[var(--oem-warn)] bg-[var(--oem-warn-soft)] text-[var(--oem-warn)]',
};

const TONE_STYLE: Record<ToolCallTone, string> = {
  ok:    'border-[var(--oem-good)] bg-[var(--oem-good-soft)] text-[var(--oem-good)]',
  muted: 'border-[var(--oem-line-strong)] bg-[var(--oem-surface-2)] text-[var(--oem-ink-3)]',
  warn:  'border-[var(--oem-warn)] bg-[var(--oem-warn-soft)] text-[var(--oem-warn)]',
  bad:   'border-[var(--oem-danger)] bg-[var(--oem-danger-soft)] text-[var(--oem-danger)]',
};

const FieldRow = memo(function FieldRow({ field, nowMs }: { field: InspectorField; nowMs: number }) {
  const age = formatAge(field.updatedAt, nowMs);
  return (
    <div
      data-testid={`tc-field-${field.id}`}
      data-class={field.klass}
      className="grid grid-cols-[1fr_auto] gap-x-3 border-b border-[var(--oem-line)] px-2 py-1.5 last:border-b-0"
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="font-mono text-[11px] text-[var(--oem-ink-2)]">{field.label}</span>
          <span className="break-all font-mono text-[11px] text-[var(--oem-ink)]">{field.value}</span>
        </div>
        <div className="mt-0.5 font-mono text-[9px] text-[var(--oem-ink-3)]">
          {field.source}
          {age ? <> · {age}</> : <> · zaman damgası yok</>}
        </div>
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

export const ToolCallingScreen = memo(function ToolCallingScreen() {
  const [snap, setSnap] = useState<{ ev: ToolCallEvidence; at: number }>(
    () => ({ ev: getToolCallEvidence(), at: Date.now() }),
  );

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const refresh = useCallback(() => {
    if (mountedRef.current) setSnap({ ev: getToolCallEvidence(), at: Date.now() });
  }, []);

  const nowMs = snap.at;
  const ev = snap.ev;

  const verdict = useMemo(
    () => deriveToolCallVerdict({
      totalCalls: ev.totalCalls, failedCalls: ev.failedCalls, cappedLoops: ev.cappedLoops,
    }),
    [ev.totalCalls, ev.failedCalls, ev.cappedLoops],
  );

  const fields = useMemo(
    () => buildToolCallFields({
      records: ev.records.map((r) => ({
        toolName: r.toolName,
        effect: String(r.effect),
        ok: r.ok,
        errorCode: r.errorCode === null ? null : String(r.errorCode),
        durationMs: r.durationMs,
        resultFields: r.resultFields,
        atMs: r.atMs,
      })),
      capacity: ev.capacity,
      totalCalls: ev.totalCalls,
      failedCalls: ev.failedCalls,
      totalLoops: ev.totalLoops,
      cappedLoops: ev.cappedLoops,
      lastCallAtMs: ev.lastCallAtMs,
      nowMs,
    }),
    [ev, nowMs],
  );

  const breakdown = useMemo(
    () => breakdownByTool(ev.records.map((r) => ({
      toolName: r.toolName,
      effect: String(r.effect),
      ok: r.ok,
      errorCode: r.errorCode === null ? null : String(r.errorCode),
      durationMs: r.durationMs,
      resultFields: r.resultFields,
      atMs: r.atMs,
    }))),
    [ev.records],
  );

  return (
    <div className="flex h-full flex-col gap-2 overflow-y-auto" data-testid="tool-calling">
      <div className="shrink-0 rounded border border-[var(--oem-line)] bg-[var(--oem-surface-1)] px-3 py-2">
        <div className="flex flex-wrap items-center gap-2 font-mono text-[10px]">
          <span className="flex items-center gap-1 text-[11px] font-bold tracking-wide text-[var(--oem-info)]">
            <Wrench size={12} /> ARAÇ ÇAĞRISI
          </span>
          <span className="flex items-center gap-1 rounded border border-[var(--oem-good)] bg-[var(--oem-good-soft)] px-1.5 py-0.5 text-[var(--oem-good)]">
            <ShieldCheck size={11} /> SALT OKUNUR — araç çağırmaz
          </span>
          <button
            type="button"
            data-testid="tc-refresh"
            onClick={refresh}
            className="flex items-center gap-1 rounded border border-[var(--oem-line-strong)] px-2 py-1 text-[var(--oem-ink-2)] hover:bg-[var(--oem-surface-2)]"
          >
            <RefreshCw size={11} /> YENİLE
          </button>
          <span
            data-testid="tc-verdict"
            data-verdict={verdict}
            className={`rounded border px-1.5 py-0.5 ${TONE_STYLE[toolCallVerdictTone(verdict)]}`}
          >
            {TOOL_CALL_VERDICT_LABEL[verdict]}
          </span>
        </div>
        <p className="mt-1 font-mono text-[9px] leading-relaxed text-[var(--oem-ink-3)]">
          Kullanıcı sorusu, araç ARGÜMANI ve araç ÇIKTISI bu ekrana GELMEZ — yalnız araç adı,
          etki sınıfı, başarı, hata KODU, süre ve alan adedi. Defter süreç ömürlüdür
          (uygulama yeniden başlayınca boşalır).
        </p>
      </div>

      <div className="shrink-0 rounded border border-[var(--oem-line)] bg-[var(--oem-surface-1)]">
        {fields.map((f) => <FieldRow key={f.id} field={f} nowMs={nowMs} />)}
      </div>

      {breakdown.length > 0 && (
        <div className="shrink-0 rounded border border-[var(--oem-line)] bg-[var(--oem-surface-1)]">
          <div className="border-b border-[var(--oem-line)] px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-[var(--oem-ink-2)]">
            ARAÇ BAŞINA DAĞILIM (tampondaki kayıtlardan)
          </div>
          {breakdown.map((b) => (
            <div
              key={b.toolName}
              data-testid={`tc-tool-${b.toolName}`}
              className="flex items-center gap-3 border-b border-[var(--oem-line)] px-2 py-1.5 last:border-b-0"
            >
              <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-[var(--oem-ink)]">
                {b.toolName}
              </span>
              <span className="shrink-0 font-mono text-[10px] text-[var(--oem-ink-2)]">
                {b.calls} çağrı
              </span>
              <span
                className={`shrink-0 rounded border px-1.5 py-0.5 font-mono text-[9px] ${
                  b.failed > 0 ? TONE_STYLE.warn : TONE_STYLE.ok
                }`}
              >
                {b.failed} düştü
              </span>
              <span className="w-20 shrink-0 text-right font-mono text-[10px] text-[var(--oem-ink-3)]">
                {b.avgMs === null ? 'süre yok' : `ort ${b.avgMs} ms`}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
});
