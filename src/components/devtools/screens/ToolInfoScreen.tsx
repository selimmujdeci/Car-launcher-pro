/**
 * ToolInfoScreen — PLACEHOLDER araçlar için bilgi ekranı.
 *
 * HİÇBİR SERVİS BAŞLATMAZ: yalnız kataloğun beyanını basar. "Yakında" / "çalışıyor"
 * gibi belirsiz ifade YOK — neyin eksik olduğu kataloğun `note` alanından gelir
 * (görev §E: sahte durum üretme yasağı).
 */

import { memo } from 'react';
import { AlertTriangle } from 'lucide-react';
import { CAROS_LAB_STATUS_LABEL, type CarosLabTool } from '../../../platform/devtools/carosLabCatalog';

export const ToolInfoScreen = memo(function ToolInfoScreen({ tool }: { tool: CarosLabTool }) {
  return (
    <div className="flex h-full flex-col items-start gap-3 overflow-y-auto p-1" data-testid="tool-info-screen">
      <div
        data-status={tool.status}
        title={tool.status}
        className="flex items-center gap-2 rounded border border-[var(--oem-warn)] bg-[var(--oem-warn-soft)] px-3 py-2 font-mono text-[11px] text-[var(--oem-warn)]"
      >
        <AlertTriangle size={14} />
        DURUM: {CAROS_LAB_STATUS_LABEL[tool.status]}
      </div>

      <div className="w-full rounded border border-[var(--oem-line)] bg-[var(--oem-surface-1)] p-3">
        <div className="font-mono text-sm text-[var(--oem-ink)]">{tool.name}</div>
        {tool.layer && (
          <div className="mt-1 inline-block rounded border border-[var(--oem-line-strong)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--oem-ink-3)]">
            {tool.layer}
          </div>
        )}
        <p className="mt-2 text-[11px] leading-relaxed text-[var(--oem-ink-2)]">{tool.desc}</p>
        {tool.note && (
          <p className="mt-3 border-t border-[var(--oem-line)] pt-2 font-mono text-[10px] leading-relaxed text-[var(--oem-ink-3)]">
            {tool.note}
          </p>
        )}
      </div>

      <p className="font-mono text-[10px] leading-relaxed text-[var(--oem-ink-3)]">
        Bu ekran hiçbir servis, abonelik veya tarama başlatmaz.
      </p>
    </div>
  );
});
