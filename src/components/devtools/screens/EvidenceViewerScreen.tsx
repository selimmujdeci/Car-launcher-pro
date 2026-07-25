/**
 * EvidenceViewerScreen — CAROS LAB · Runtime · Evidence Viewer.
 *
 * YENİ BACKEND YOK: üç MEVCUT salt-okunur kaynağı tek zaman çizgisinde birleştirir
 * (`getDiagnosticTrail` · `getLastAiMechanicResult` · `getValidationSnapshot`).
 * Hiçbir servis başlatılmaz, hiçbir abonelik açılmaz, TIMER YOKTUR — okuma yalnız
 * ekran açılışında ve "YENİLE" düğmesinde yapılır (Mali-400 bütçesi).
 *
 * Tüm birleştirme/maskeleme/sınıflandırma saf modelde: `platform/devtools/evidenceViewerModel`.
 */

import { memo, useCallback, useMemo, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { getDiagnosticTrail } from '../../../platform/diagnosticTrail';
import { getLastAiMechanicResult } from '../../../platform/system/platformCoreAiRuntimeWiring';
import { getValidationSnapshot } from '../../../platform/validation/validationRecorder';
import {
  buildEvidenceRows, filterEvidenceRows, countByChannel,
  EVIDENCE_CHANNELS, EVIDENCE_CHANNEL_LABEL, EVIDENCE_SEVERITY_LABEL, MAX_EVIDENCE_ROWS,
  type EvidenceChannel, type EvidenceRow, type EvidenceSeverity,
} from '../../../platform/devtools/evidenceViewerModel';

const SEVERITY_CLASS: Record<EvidenceSeverity, string> = {
  info:     'border-[var(--oem-line-strong)] bg-[var(--oem-surface-2)] text-[var(--oem-ink-3)]',
  warn:     'border-[var(--oem-warn)] bg-[var(--oem-warn-soft)] text-[var(--oem-warn)]',
  error:    'border-[var(--oem-danger)] bg-[var(--oem-danger-soft)] text-[var(--oem-danger)]',
  critical: 'border-[var(--oem-danger)] bg-[var(--oem-danger-soft)] text-[var(--oem-danger)] font-bold',
};

/** Kaynakları OKU (fail-soft: biri patlarsa diğerleri gelir). */
function readRows(): EvidenceRow[] {
  let trail: ReturnType<typeof getDiagnosticTrail> | null = null;
  let ai: ReturnType<typeof getLastAiMechanicResult> = null;
  let validation: ReturnType<typeof getValidationSnapshot> | null = null;
  try { trail = getDiagnosticTrail(); } catch { /* fail-soft */ }
  try { ai = getLastAiMechanicResult(); } catch { /* fail-soft */ }
  try { validation = getValidationSnapshot(); } catch { /* fail-soft */ }
  return buildEvidenceRows({ trail, aiResult: ai, validation });
}

function fmtTime(ts: number): string {
  if (!ts) return '--:--:--';
  const d = new Date(ts);
  return [
    String(d.getHours()).padStart(2, '0'),
    String(d.getMinutes()).padStart(2, '0'),
    String(d.getSeconds()).padStart(2, '0'),
  ].join(':');
}

export const EvidenceViewerScreen = memo(function EvidenceViewerScreen() {
  const [rows, setRows] = useState<EvidenceRow[]>(() => readRows());
  const [channel, setChannel] = useState<EvidenceChannel | null>(null);

  const refresh = useCallback(() => { setRows(readRows()); }, []);

  const counts  = useMemo(() => countByChannel(rows), [rows]);
  const visible = useMemo(() => filterEvidenceRows(rows, channel), [rows, channel]);

  return (
    <div className="flex h-full flex-col gap-2">
      {/* Kontrol şeridi */}
      <div className="flex shrink-0 flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={refresh}
          className="flex items-center gap-1 rounded border border-[var(--oem-line-strong)] px-2 py-1 font-mono text-[10px] text-[var(--oem-ink-2)] hover:bg-[var(--oem-surface-2)]"
        >
          <RefreshCw size={11} /> YENİLE
        </button>

        <button
          type="button"
          onClick={() => setChannel(null)}
          className={`rounded border px-2 py-1 font-mono text-[10px] ${
            channel === null
              ? 'border-[var(--oem-info)] bg-[var(--oem-info-soft)] text-[var(--oem-info)]'
              : 'border-[var(--oem-line-strong)] text-[var(--oem-ink-3)] hover:bg-[var(--oem-surface-2)]'
          }`}
        >
          TÜMÜ ({rows.length})
        </button>

        {EVIDENCE_CHANNELS.map((c) => (
          <button
            key={c}
            type="button"
            data-testid={`evidence-filter-${c}`}
            onClick={() => setChannel(c)}
            className={`rounded border px-2 py-1 font-mono text-[10px] ${
              channel === c
                ? 'border-[var(--oem-info)] bg-[var(--oem-info-soft)] text-[var(--oem-info)]'
                : 'border-[var(--oem-line-strong)] text-[var(--oem-ink-3)] hover:bg-[var(--oem-surface-2)]'
            }`}
          >
            {EVIDENCE_CHANNEL_LABEL[c]} ({counts[c]})
          </button>
        ))}

        <span className="ml-auto font-mono text-[10px] text-[var(--oem-ink-3)]">
          {visible.length} / {MAX_EVIDENCE_ROWS} satır · maskeleme AÇIK
        </span>
      </div>

      {/* Başlıklar */}
      <div className="grid shrink-0 grid-cols-[4.5rem_6.5rem_8rem_1fr] gap-x-3 border-b border-[var(--oem-line)] px-2 pb-1 font-mono text-[10px] uppercase text-[var(--oem-ink-3)]">
        <span>Zaman</span>
        <span>Kanal</span>
        <span>Tür</span>
        <span>Ham Yük / Bağlam</span>
      </div>

      {/* Liste — bounded (model MAX_EVIDENCE_ROWS ile sınırlar) */}
      <div className="min-h-0 flex-1 overflow-y-auto" data-testid="evidence-list">
        {visible.length === 0 ? (
          <p className="px-2 py-4 font-mono text-[11px] leading-relaxed text-[var(--oem-ink-3)]">
            Bu kanalda kanıt yok. Kaynaklar: olay izi (diagnosticTrail) · AI Core son
            çalışması · saha doğrulama kütüğü. AI Core hiç çalışmadıysa yapay zekâ satırı
            olmaz; doğrulama oturumu açılmadıysa Doğrulama boş kalır — bu bir hata değil,
            dürüst "veri yok" durumudur.
          </p>
        ) : (
          visible.map((r) => (
            <div
              key={r.id}
              className="grid grid-cols-[4.5rem_6.5rem_8rem_1fr] gap-x-3 px-2 py-1 font-mono text-[11px] even:bg-[var(--oem-surface-2)]"
            >
              <span className="text-[var(--oem-ink-3)]">{fmtTime(r.ts)}</span>
              <span className="truncate text-[var(--oem-info)]">{EVIDENCE_CHANNEL_LABEL[r.channel]}</span>
              <span className="truncate text-[var(--oem-ink-2)]">{r.kind}</span>
              <div className="min-w-0">
                <span
                  data-severity={r.severity}
                  className={`mr-2 rounded border px-1 py-0.5 text-[9px] uppercase ${SEVERITY_CLASS[r.severity]}`}
                >
                  {EVIDENCE_SEVERITY_LABEL[r.severity]}
                </span>
                <span className="break-all text-[var(--oem-ink)]">{r.payload}</span>
                <div className="truncate text-[10px] text-[var(--oem-ink-3)]">{r.context}</div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
});
