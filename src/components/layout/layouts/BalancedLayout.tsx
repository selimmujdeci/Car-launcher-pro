/**
 * BalancedLayout — Mercedes / Glass-Pro / Midnight / default — Dark Premium Edition
 *
 * Drag-to-dismiss: 3-second long press on any panel → drag left/right to hide.
 * Panel IDs: 'nav' | 'speed' | 'media'
 * Visibility stored in settings.widgetVisible.
 */
import { memo, useMemo, useRef, useState, useCallback } from 'react';
import { NavHero, MediaPanel, DockShortcuts } from '../LayoutWidgets';
import { PremiumSpeedometer } from '../PremiumSpeedometer';
import type { LayoutProps } from './LayoutProps';

const DEFAULT_ORDER = ['nav', 'speed', 'media'] as const;
const HOLD_MS        = 3000;
const DISMISS_PX     = 100; // pixel threshold to trigger hide

export const BalancedLayout = memo(function BalancedLayout({
  settings,
  smart,
  appMap,
  handleLaunch,
  setFullMapOpen,
  fullMapOpen,
  updateSettings,
}: LayoutProps) {

  const order = useMemo<string[]>(() => {
    const raw = settings.widgetOrder;
    if (Array.isArray(raw) && raw.length >= 3 && DEFAULT_ORDER.every(id => raw.includes(id))) {
      return raw.filter(id => DEFAULT_ORDER.includes(id as typeof DEFAULT_ORDER[number]));
    }
    return [...DEFAULT_ORDER];
  }, [settings.widgetOrder]);

  // panels: useMemo ile sadece bağımlılıklar değişince yeniden oluşturulur
  // Bu olmadan her BalancedLayout re-render'ında tüm panel JSX yeniden yaratılır
  const panels: Record<string, React.ReactNode> = useMemo(() => ({
    nav: (
      <div className="flex-[1.4] min-w-0 min-h-0 rounded-[2.5rem] overflow-hidden relative glass-card">
        <NavHero
          defaultNav={settings.defaultNav as 'maps' | 'waze' | 'yandex'}
          onLaunch={handleLaunch}
          onOpenMap={() => setFullMapOpen(true)}
          offlineMap={settings.offlineMap}
          fullMapOpen={fullMapOpen}
        />
      </div>
    ),
    speed: (
      <div className="flex-[1.2] min-w-0 min-h-0 rounded-[2.5rem] overflow-hidden relative glass-card">
        <PremiumSpeedometer numSize="lg" />
      </div>
    ),
    media: (
      <div className="flex-1 min-w-0 min-h-0 flex flex-col gap-3">
        <div className="flex-[1.7] min-h-0 rounded-[2.5rem] overflow-hidden glass-card relative">
          <MediaPanel defaultMusic={settings.defaultMusic as import('../../../data/apps').MusicOptionKey} />
        </div>
        <div className="flex-[1] min-h-0 rounded-[2.5rem] overflow-hidden glass-card">
          <DockShortcuts
            dockIds={smart.dockIds}
            onLaunch={handleLaunch}
            appMap={appMap}
          />
        </div>
      </div>
    ),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [
    settings.defaultNav, settings.offlineMap, settings.defaultMusic,
    smart.dockIds, appMap, handleLaunch, setFullMapOpen, fullMapOpen,
  ]);

  const flexClass: Record<string, string> = {
    nav:   'flex-[1.4]',
    speed: 'flex-[1.2]',
    media: 'flex-1',
  };

  const hidePanel = useCallback((id: string) => {
    updateSettings({
      widgetVisible: { ...settings.widgetVisible, [id]: false },
    });
  }, [settings.widgetVisible, updateSettings]);

  // Gizlenen panelleri flex sırasından çıkar — boş slot bırakmaz, kalan paneller alanı paylaşır
  const visibleOrder = order.filter(id => settings.widgetVisible[id] !== false);

  return (
    <div className="flex gap-3 w-full h-full p-1 overflow-hidden">
      {visibleOrder.map(id => (
        <SwipeDismissPanel
          key={id}
          id={id}
          flexClass={flexClass[id]}
          onDismiss={hidePanel}
        >
          {panels[id]}
        </SwipeDismissPanel>
      ))}
    </div>
  );
});

/* ── SwipeDismissPanel ───────────────────────────────────── */

interface SwipeDismissProps {
  id: string;
  flexClass: string;
  onDismiss: (id: string) => void;
  children: React.ReactNode;
}

function SwipeDismissPanel({ id, flexClass, onDismiss, children }: SwipeDismissProps) {
  const holdTimerRef  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startXRef     = useRef(0);
  const startYRef     = useRef(0);
  const [held,        setHeld]        = useState(false);
  const [translateX,  setTranslateX]  = useState(0);
  const [dismissing,  setDismissing]  = useState(false);

  const cancelHold = useCallback(() => {
    if (holdTimerRef.current) { clearTimeout(holdTimerRef.current); holdTimerRef.current = null; }
  }, []);

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    // Skip interactive elements inside the panel
    const tgt = e.target as Element;
    if (tgt.closest('button, input, a, canvas, [role="button"], [data-no-drag]')) return;

    e.currentTarget.setPointerCapture(e.pointerId);
    startXRef.current = e.clientX;
    startYRef.current = e.clientY;

    holdTimerRef.current = setTimeout(() => {
      setHeld(true);
    }, HOLD_MS);
  }, []);

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const dx = e.clientX - startXRef.current;
    const dy = e.clientY - startYRef.current;

    if (!held) {
      // Cancel hold if user moves more than 8px
      if (Math.abs(dx) > 8 || Math.abs(dy) > 8) cancelHold();
      return;
    }

    setTranslateX(dx);
  }, [held, cancelHold]);

  const handlePointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    cancelHold();

    if (!held) return;

    const dx = e.clientX - startXRef.current;
    setHeld(false);

    if (Math.abs(dx) >= DISMISS_PX) {
      // Fly off in drag direction, then hide
      setTranslateX(dx > 0 ? 600 : -600);
      setDismissing(true);
      setTimeout(() => onDismiss(id), 280);
    } else {
      // Snap back
      setTranslateX(0);
    }
  }, [held, cancelHold, id, onDismiss]);

  const opacity    = held ? Math.max(0.4, 1 - Math.abs(translateX) / 400) : 1;
  const transition = held ? 'none' : 'transform 0.28s cubic-bezier(0.22,1,0.36,1), opacity 0.28s ease';

  if (dismissing) return null;

  return (
    <div
      className={`${flexClass} min-w-0 min-h-0 flex flex-col overflow-hidden touch-none`}
      style={{
        transform:  `translateX(${translateX}px)`,
        opacity,
        transition,
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    >
      {children}
      {/* Subtle hold-active indicator — no text, no badge */}
      {held && (
        <div className="absolute inset-0 rounded-[2.5rem] ring-2 ring-blue-500/40 pointer-events-none z-50 transition-opacity" />
      )}
    </div>
  );
}
