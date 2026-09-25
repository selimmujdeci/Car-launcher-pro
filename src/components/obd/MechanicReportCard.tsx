/**
 * MechanicReportCard — Araç Ustası (Arıza Teşhisi paneli).
 *
 * Deterministik AI Usta'nın son değerlendirmesini sade Türkçe gösterir:
 * olası neden + güven, kanıt, KARŞI kanıt, güvenli kontroller, aciliyet.
 * Teşhis üretmez; `mechanicReportView` yalnız mevcut raporu okur.
 * Sonuç yoksa kart görünmez. Mavi erişimi mevcut fail-closed şaltere bağlıdır.
 */
import { memo, useCallback, useEffect, useState } from 'react';
import { Wrench, RefreshCw, Copy, Check, ShieldAlert } from 'lucide-react';
import { getLastAiMechanicResult } from '../../platform/system/platformCoreAiRuntimeWiring';
import {
  buildMechanicReportView, buildServiceReportText, formatReportAge, plainEvidence, type MechanicReportView,
} from '../../platform/ai/mechanic/mechanicReportView';
import {
  isAiGatewayEnabled, isMaviMechanicEnabled, setMaviMechanicEnabled,
} from '../../platform/ai/gateway/aiGatewayFlag';

const RISK_TONE: Record<string, string> = {
  'Düşük':  'border-[var(--oem-line-strong)] bg-[var(--oem-surface-2)] text-[color:var(--oem-ink-2)]',
  'Orta':   'border-[var(--oem-warn)] bg-[var(--oem-warn-soft)] text-[color:var(--oem-warn)]',
  'Yüksek': 'border-[var(--oem-danger)] bg-[var(--oem-danger-soft)] text-[color:var(--oem-danger)]',
  'Kritik': 'border-[var(--oem-danger)] bg-[var(--oem-danger-soft)] text-[color:var(--oem-danger)]',
};

function List({ title, items }: { title: string; items: readonly string[] }) {
  if (items.length === 0) return null;
  return (
    <div className="mt-2.5">
      <div className="text-[10px] font-black uppercase tracking-widest text-[color:var(--oem-ink-3)] mb-1">{title}</div>
      <ul className="space-y-0.5">
        {items.map((t) => <li key={t} className="text-[12px] leading-snug text-[color:var(--oem-ink-2)]">• {t}</li>)}
      </ul>
    </div>
  );
}

function MechanicReportCardInner({ dtcCodes, refreshKey }: { dtcCodes: readonly string[]; refreshKey: number }) {
  const [view, setView] = useState<MechanicReportView | null>(null);
  const [copied, setCopied] = useState(false);
  const [maviOn, setMaviOn] = useState(false);
  const gatewayOn = isAiGatewayEnabled();

  const refresh = useCallback(() => {
    setView(buildMechanicReportView(getLastAiMechanicResult(), Date.now()));
    setMaviOn(isMaviMechanicEnabled());
  }, []);
  useEffect(() => { refresh(); }, [refresh, refreshKey]);

  const copy = useCallback(() => {
    if (!view) return;
    try {
      void navigator.clipboard?.writeText(buildServiceReportText(view, dtcCodes, null))
        .then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }, () => {});
    } catch { /* pano yoksa sessiz */ }
  }, [view, dtcCodes]);

  if (!view) return null;
  const d = view.diagnosis;
  const causes = d.topCause ? [d.topCause, ...d.otherCauses] : [];

  return (
    <div className="rounded-2xl border border-[var(--oem-border)] bg-[var(--oem-surface-2)] p-4"
      data-editable="dtc.mechanic-report" data-editable-type="card">
      <div className="flex items-center gap-2 mb-2">
        <Wrench className="w-4 h-4 text-[color:var(--oem-accent)]" />
        <span className="font-black text-xs uppercase tracking-widest text-[color:var(--oem-ink)]">Araç Ustası</span>
        <span className="text-[10px] text-[color:var(--oem-ink-3)]">
          {view.stale ? `son değerlendirme ${formatReportAge(view.ageMs)}` : formatReportAge(view.ageMs)}
        </span>
        <span className={`ml-auto px-2 py-0.5 rounded-lg border text-[10px] font-black uppercase ${RISK_TONE[d.risk] ?? RISK_TONE['Düşük']}`}>
          {d.risk}
        </span>
        <button onClick={refresh} aria-label="Usta raporunu yenile" className="p-1.5 rounded-lg active:scale-95">
          <RefreshCw className="w-3.5 h-3.5 text-[color:var(--oem-ink-3)]" />
        </button>
      </div>

      <div className="text-[13px] font-bold text-[color:var(--oem-ink)] leading-snug">{view.displaySummary}</div>
      {d.safetyWarning && (
        <div className="flex items-start gap-2 mt-2 text-[12px] font-bold text-[color:var(--oem-danger)]">
          <ShieldAlert className="w-4 h-4 flex-shrink-0 mt-0.5" /><span>{d.safetyWarning}</span>
        </div>
      )}

      {causes.length > 0 ? (
        <div className="mt-2.5">
          <div className="text-[10px] font-black uppercase tracking-widest text-[color:var(--oem-ink-3)] mb-1">Olası nedenler</div>
          {causes.map((c) => (
            <div key={c.code} className="flex items-center gap-2 mb-1">
              <div className="flex-1 min-w-0 text-[12px] text-[color:var(--oem-ink)]">{c.description}</div>
              <div className="w-16 h-1.5 rounded-full bg-[var(--oem-surface-3)] overflow-hidden flex-shrink-0">
                <div className="h-full bg-[var(--oem-accent)]" style={{ width: `${c.confidence}%` }} />
              </div>
              <span className="w-9 text-right text-[11px] font-bold tabular-nums text-[color:var(--oem-ink-2)]">%{c.confidence}</span>
            </div>
          ))}
        </div>
      ) : d.insufficientDataNote ? (
        <div className="mt-2 text-[12px] text-[color:var(--oem-ink-3)]">{d.insufficientDataNote}</div>
      ) : null}

      <List title="Neye dayanıyor" items={d.evidence.map(plainEvidence)} />
      <List title="Aksini gösteren" items={d.counterEvidence.map(plainEvidence)} />
      <List title="Güvenle kontrol edebileceklerin" items={d.nextSteps} />

      <div className="flex flex-wrap items-center gap-2 mt-3 pt-3 border-t border-[var(--oem-line)]">
        <button onClick={copy}
          className="flex items-center gap-1.5 px-3 h-9 rounded-xl border border-[var(--oem-accent)] bg-[var(--oem-accent-soft)] text-[color:var(--oem-accent)] text-[11px] font-black uppercase tracking-wider active:scale-95">
          {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
          {copied ? 'Kopyalandı' : 'Servis raporunu kopyala'}
        </button>
        <label className={`flex items-center gap-2 ml-auto text-[11px] ${gatewayOn ? 'text-[color:var(--oem-ink-2)]' : 'text-[color:var(--oem-ink-3)] opacity-60'}`}>
          <input type="checkbox" checked={maviOn} disabled={!gatewayOn && !maviOn}
            onChange={(e) => { setMaviMechanicEnabled(e.target.checked); setMaviOn(isMaviMechanicEnabled()); }} />
          {gatewayOn ? 'Mavi bu raporu bilsin' : 'Mavi erişimi için AI Gateway açık olmalı'}
        </label>
      </div>
    </div>
  );
}

export const MechanicReportCard = memo(MechanicReportCardInner);
