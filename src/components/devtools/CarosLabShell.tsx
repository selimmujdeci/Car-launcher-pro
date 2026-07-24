/**
 * CarosLabShell — CAROS LAB geliştirici merkezi (FAZ A).
 *
 * SORUMLULUK: kategori sekmeleri + araç kartları + tek aktif araç ekranı. Shell'in
 * KENDİSİ hiçbir OBD/AI servisi başlatmaz — mount maliyeti yalnız statik katalog
 * render'ıdır. Servis dokunuşu YALNIZ açılan ekranın içindedir ve ekran kapanınca
 * unmount ile temizlenir (zero-leak).
 *
 * GERİ NAVİGASYON: araç açıkken "GERİ" katalog'a döner; katalogdayken "KAPAT"
 * çekmeceyi kapatır (MainLayout'un mevcut Android geri tuşu davranışı DEĞİŞMEZ —
 * donanım geri tuşu çekmeceyi kapatır, o yol hiç ellenmedi).
 */

import { memo, useCallback, useMemo, useReducer } from 'react';
import { ChevronLeft, FlaskConical, X } from 'lucide-react';
import {
  CAROS_LAB_CATEGORIES, CAROS_LAB_CATEGORY_LABEL, toolsByCategory,
  getCarosLabTool, statusTone,
  type CarosLabTool, type CarosLabToolId, type CarosLabToolStatus,
} from '../../platform/devtools/carosLabCatalog';
import {
  carosLabNavReduce, CAROS_LAB_INITIAL_NAV,
} from '../../platform/devtools/carosLabNavigation';
import { CarosLabToolHost } from './CarosLabToolHost';

const TONE_CLASS: Record<'ok' | 'muted' | 'blocked', string> = {
  ok:      'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
  muted:   'border-white/15 bg-white/5 text-white/40',
  blocked: 'border-rose-500/40 bg-rose-500/10 text-rose-300',
};

/* ── Araç kartı ──────────────────────────────────────────────────────────── */

const ToolCard = memo(function ToolCard({
  tool, onOpen,
}: { tool: CarosLabTool; onOpen: (id: CarosLabToolId) => void }) {
  const disabled = tool.status === 'DISABLED';
  const tone = statusTone(tool.status);

  // DISABLED kart için `disabled` + reducer'ın 'open' NO-OP'u iki katmanlı koruma sağlar.
  const handleClick = useCallback(() => { onOpen(tool.id); }, [tool.id, onOpen]);

  return (
    <button
      type="button"
      data-testid={`lab-card-${tool.id}`}
      data-status={tool.status}
      disabled={disabled}
      aria-disabled={disabled}
      onClick={handleClick}
      className={`flex flex-col items-start gap-1.5 rounded border p-3 text-left transition-colors ${
        disabled
          ? 'cursor-not-allowed border-white/10 bg-white/[0.02] opacity-60'
          : 'border-white/10 bg-white/[0.03] hover:border-cyan-400/40 hover:bg-cyan-500/[0.06]'
      }`}
    >
      <div className="flex w-full items-center gap-2">
        <span className="font-mono text-[12px] uppercase tracking-wide text-white/85">{tool.name}</span>
        <span className={`ml-auto shrink-0 rounded border px-1.5 py-0.5 font-mono text-[9px] ${TONE_CLASS[tone]}`}>
          {tool.status}
        </span>
      </div>

      {tool.layer && (
        <span className="rounded border border-white/12 px-1.5 py-0.5 font-mono text-[9px] text-white/40">
          {tool.layer}
        </span>
      )}

      <p className="text-[11px] leading-relaxed text-white/50">{tool.desc}</p>

      {tool.note && (
        <p className="mt-0.5 font-mono text-[9px] leading-relaxed text-white/30">{tool.note}</p>
      )}
    </button>
  );
});

/* ── Shell ───────────────────────────────────────────────────────────────── */

export const CarosLabShell = memo(function CarosLabShell({ onClose }: { onClose: () => void }) {
  const [nav, dispatch] = useReducer(carosLabNavReduce, CAROS_LAB_INITIAL_NAV);
  const { category, activeId } = nav;

  const tools  = useMemo(() => toolsByCategory(category), [category]);
  const active = useMemo(() => (activeId ? getCarosLabTool(activeId) : null), [activeId]);

  const openTool  = useCallback((id: CarosLabToolId) => dispatch({ type: 'open', id }), []);
  const backToHub = useCallback(() => dispatch({ type: 'back' }), []);

  return (
    <div className="flex h-full w-full flex-col bg-[#070b12] text-white" style={{ fontFamily: 'monospace' }}>
      {/* Başlık */}
      <div className="flex shrink-0 items-center gap-3 border-b border-white/10 bg-black/40 px-4 py-2">
        <FlaskConical size={16} className="text-cyan-400" />
        <span className="text-sm font-bold tracking-[0.2em] text-cyan-300">CAROS LAB</span>
        <span className="hidden text-[10px] text-white/30 sm:inline">FAZ A · DEVELOPER PLATFORM</span>

        {active && (
          <span data-testid="lab-breadcrumb" className="truncate text-[10px] text-white/40">
            / {CAROS_LAB_CATEGORY_LABEL[active.category]} / {active.name}
          </span>
        )}

        <button
          type="button"
          onClick={onClose}
          className="ml-auto flex shrink-0 items-center gap-1 rounded border border-white/15 px-2 py-1 text-[10px] text-white/60 hover:border-rose-500/40 hover:bg-rose-500/10"
        >
          <X size={11} /> KAPAT
        </button>
      </div>

      {active ? (
        /* ── Araç ekranı ── */
        <>
          <div className="flex shrink-0 items-center gap-2 border-b border-white/10 px-4 py-1.5">
            <button
              type="button"
              data-testid="lab-back"
              onClick={backToHub}
              className="flex items-center gap-1 rounded border border-white/15 px-2 py-1 text-[10px] text-white/70 hover:bg-white/10"
            >
              <ChevronLeft size={12} /> GERİ
            </button>
            <span className="font-mono text-[11px] uppercase text-white/70">{active.name}</span>
            <StatusChip status={active.status} />
            {active.layer && (
              <span className="rounded border border-white/12 px-1.5 py-0.5 text-[9px] text-white/40">
                {active.layer}
              </span>
            )}
          </div>
          <div className="min-h-0 flex-1 overflow-hidden p-3">
            <CarosLabToolHost tool={active} />
          </div>
        </>
      ) : (
        /* ── Katalog ── */
        <>
          <div className="flex shrink-0 gap-0 overflow-x-auto border-b border-white/10 bg-black/20">
            {CAROS_LAB_CATEGORIES.map((c) => (
              <button
                key={c}
                type="button"
                data-testid={`lab-category-${c}`}
                onClick={() => dispatch({ type: 'category', category: c })}
                className={`shrink-0 border-r border-white/5 px-4 py-2 text-[11px] uppercase tracking-wider transition-colors ${
                  category === c
                    ? 'border-b-2 border-b-cyan-400 bg-white/5 text-cyan-300'
                    : 'text-white/40 hover:bg-white/5 hover:text-white/70'
                }`}
              >
                {CAROS_LAB_CATEGORY_LABEL[c]}
              </button>
            ))}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {tools.map((t) => (
                <ToolCard key={t.id} tool={t} onOpen={openTool} />
              ))}
            </div>

            <p className="mt-4 font-mono text-[10px] leading-relaxed text-white/25">
              AVAILABLE = ekran gerçekten var ve açılıyor · PLACEHOLDER = ekran henüz yok ·
              DISABLED = güvenlik politikası gereği kapalı. Ekran içi FOUNDATION_ONLY /
              NOT_WIRED alt-durumları o ekranın kendi başlığında gösterilir.
            </p>
          </div>
        </>
      )}
    </div>
  );
});

const StatusChip = memo(function StatusChip({ status }: { status: CarosLabToolStatus }) {
  return (
    <span className={`rounded border px-1.5 py-0.5 text-[9px] ${TONE_CLASS[statusTone(status)]}`}>
      {status}
    </span>
  );
});
