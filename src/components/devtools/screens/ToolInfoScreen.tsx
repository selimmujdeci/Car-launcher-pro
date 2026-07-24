/**
 * ToolInfoScreen — PLACEHOLDER araçlar için bilgi ekranı.
 *
 * HİÇBİR SERVİS BAŞLATMAZ: yalnız kataloğun beyanını basar. "Yakında" / "çalışıyor"
 * gibi belirsiz ifade YOK — neyin eksik olduğu kataloğun `note` alanından gelir
 * (görev §E: sahte durum üretme yasağı).
 */

import { memo } from 'react';
import { AlertTriangle } from 'lucide-react';
import type { CarosLabTool } from '../../../platform/devtools/carosLabCatalog';

export const ToolInfoScreen = memo(function ToolInfoScreen({ tool }: { tool: CarosLabTool }) {
  return (
    <div className="flex h-full flex-col items-start gap-3 overflow-y-auto p-1" data-testid="tool-info-screen">
      <div className="flex items-center gap-2 rounded border border-amber-500/40 bg-amber-500/10 px-3 py-2 font-mono text-[11px] text-amber-200">
        <AlertTriangle size={14} />
        DURUM: {tool.status}
      </div>

      <div className="w-full rounded border border-white/10 bg-white/[0.03] p-3">
        <div className="font-mono text-sm text-white/85">{tool.name}</div>
        {tool.layer && (
          <div className="mt-1 inline-block rounded border border-white/15 px-1.5 py-0.5 font-mono text-[10px] text-white/45">
            {tool.layer}
          </div>
        )}
        <p className="mt-2 text-[11px] leading-relaxed text-white/55">{tool.desc}</p>
        {tool.note && (
          <p className="mt-3 border-t border-white/10 pt-2 font-mono text-[10px] leading-relaxed text-white/45">
            {tool.note}
          </p>
        )}
      </div>

      <p className="font-mono text-[10px] leading-relaxed text-white/30">
        Bu ekran hiçbir servis, abonelik veya tarama başlatmaz.
      </p>
    </div>
  );
});
