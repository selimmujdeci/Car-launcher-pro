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
  CAROS_LAB_CATEGORIES, CAROS_LAB_CATEGORY_LABEL, CAROS_LAB_STATUS_LABEL,
  toolsByCategory, getCarosLabTool, statusTone,
  type CarosLabTool, type CarosLabToolId, type CarosLabToolStatus,
} from '../../platform/devtools/carosLabCatalog';
import {
  carosLabNavReduce, CAROS_LAB_INITIAL_NAV,
} from '../../platform/devtools/carosLabNavigation';
import { CarosLabToolHost } from './CarosLabToolHost';

/* TEMA (SAHA 2026-07-25): CAROS LAB gündüz/aydınlık temada da SİYAH kalıyor ve
   düşük-opaklık metinler okunmuyordu — shell ve tüm araç ekranları sabit `#070b12`
   ve `text-white/xx` · `border-white/xx` değerleri kullanıyordu, yani hiçbir tema
   değişkenine abone DEĞİLDİ. Artık tasarım sisteminin `--oem-*` token'ları kullanılır:
   `html.light-ui` (aydınlık-pro) açık zemin + koyu mürekkep, gece koyu zemin + açık
   mürekkep OTOMATİK gelir; `sunlight-mode` de aynı token'ları ezdiği için güneş altı
   kontrastı bedava. Yeni palet katmanı YOK — mevcut tek katman (design-system.css).
   Kural: bu ağaçta sabit renk (hex / text-white / *-500) KULLANILMAZ.
   Not: soluk `--oem-ink-4` (α .34) güneşte okunmadığı için en soluk seviye
   `--oem-ink-3`'tür. Marka aksanı cyan yerine `--oem-info` (açık zeminde okunur). */
const TONE_CLASS: Record<'ok' | 'muted' | 'blocked', string> = {
  ok:      'border-[var(--oem-good)]   bg-[var(--oem-good-soft)]   text-[var(--oem-good)]',
  muted:   'border-[var(--oem-line-strong)] bg-[var(--oem-surface-2)] text-[var(--oem-ink-3)]',
  blocked: 'border-[var(--oem-danger)] bg-[var(--oem-danger-soft)] text-[var(--oem-danger)]',
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
          ? 'cursor-not-allowed border-[var(--oem-line)] bg-[var(--oem-surface-0)] opacity-60'
          : 'border-[var(--oem-line)] bg-[var(--oem-surface-1)] hover:border-[var(--oem-accent)] hover:bg-[var(--oem-accent-soft)]'
      }`}
    >
      <div className="flex w-full items-center gap-2">
        <span className="font-mono text-[12px] uppercase tracking-wide text-[var(--oem-ink)]">{tool.name}</span>
        <span
          data-status={tool.status}
          title={tool.status}
          className={`ml-auto shrink-0 rounded border px-1.5 py-0.5 font-mono text-[9px] ${TONE_CLASS[tone]}`}
        >
          {CAROS_LAB_STATUS_LABEL[tool.status]}
        </span>
      </div>

      {tool.layer && (
        <span className="rounded border border-[var(--oem-line-strong)] px-1.5 py-0.5 font-mono text-[9px] text-[var(--oem-ink-3)]">
          {tool.layer}
        </span>
      )}

      <p className="text-[11px] leading-relaxed text-[var(--oem-ink-2)]">{tool.desc}</p>

      {tool.note && (
        <p className="mt-0.5 font-mono text-[9px] leading-relaxed text-[var(--oem-ink-3)]">{tool.note}</p>
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
    <div className="flex h-full w-full flex-col bg-[var(--oem-bg)] text-[var(--oem-ink)]" style={{ fontFamily: 'monospace' }}>
      {/* Başlık */}
      <div className="flex shrink-0 items-center gap-3 border-b border-[var(--oem-line)] bg-[var(--oem-surface-0)] px-4 py-2">
        <FlaskConical size={16} className="text-[var(--oem-info)]" />
        <span className="text-sm font-bold tracking-[0.2em] text-[var(--oem-info)]">CAROS LAB</span>
        <span className="hidden text-[10px] text-[var(--oem-ink-3)] sm:inline">FAZ A · GELİŞTİRİCİ PLATFORMU</span>

        {active && (
          <span data-testid="lab-breadcrumb" className="truncate text-[10px] text-[var(--oem-ink-3)]">
            / {CAROS_LAB_CATEGORY_LABEL[active.category]} / {active.name}
          </span>
        )}

        <button
          type="button"
          onClick={onClose}
          className="ml-auto flex shrink-0 items-center gap-1 rounded border border-[var(--oem-line-strong)] px-2 py-1 text-[10px] text-[var(--oem-ink-2)] hover:border-[var(--oem-danger)] hover:bg-[var(--oem-danger-soft)]"
        >
          <X size={11} /> KAPAT
        </button>
      </div>

      {active ? (
        /* ── Araç ekranı ── */
        <>
          <div className="flex shrink-0 items-center gap-2 border-b border-[var(--oem-line)] px-4 py-1.5">
            <button
              type="button"
              data-testid="lab-back"
              onClick={backToHub}
              className="flex items-center gap-1 rounded border border-[var(--oem-line-strong)] px-2 py-1 text-[10px] text-[var(--oem-ink-2)] hover:bg-[var(--oem-surface-2)]"
            >
              <ChevronLeft size={12} /> GERİ
            </button>
            <span className="font-mono text-[11px] uppercase text-[var(--oem-ink-2)]">{active.name}</span>
            <StatusChip status={active.status} />
            {active.layer && (
              <span className="rounded border border-[var(--oem-line-strong)] px-1.5 py-0.5 text-[9px] text-[var(--oem-ink-3)]">
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
          <div className="flex shrink-0 gap-0 overflow-x-auto border-b border-[var(--oem-line)] bg-[var(--oem-surface-2)]">
            {CAROS_LAB_CATEGORIES.map((c) => (
              <button
                key={c}
                type="button"
                data-testid={`lab-category-${c}`}
                onClick={() => dispatch({ type: 'category', category: c })}
                className={`shrink-0 border-r border-[var(--oem-line)] px-4 py-2 text-[11px] uppercase tracking-wider transition-colors ${
                  category === c
                    ? 'border-b-2 border-b-[var(--oem-info)] bg-[var(--oem-surface-0)] text-[var(--oem-info)]'
                    : 'text-[var(--oem-ink-3)] hover:bg-[var(--oem-surface-0)] hover:text-[var(--oem-ink)]'
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

            <p className="mt-4 font-mono text-[10px] leading-relaxed text-[var(--oem-ink-3)]">
              HAZIR = ekran gerçekten var ve açılıyor · EKRAN YOK = araç henüz yazılmadı ·
              KAPALI = güvenlik politikası gereği kapalı. Ekran içi "YALNIZ ALTYAPI" /
              "BAĞLI DEĞİL" alt-durumları o ekranın kendi başlığında gösterilir.
            </p>
          </div>
        </>
      )}
    </div>
  );
});

const StatusChip = memo(function StatusChip({ status }: { status: CarosLabToolStatus }) {
  return (
    <span
      data-status={status}
      title={status}
      className={`rounded border px-1.5 py-0.5 text-[9px] ${TONE_CLASS[statusTone(status)]}`}
    >
      {CAROS_LAB_STATUS_LABEL[status]}
    </span>
  );
});
