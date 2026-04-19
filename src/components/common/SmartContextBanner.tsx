/**
 * SmartContextBanner — bağlam-farkındı akıllı öneri bandı.
 *
 * İki katmanlı öneri sistemi:
 *   1. CtxSuggestion[] — contextEngine'den gelen GPS/OBD/zaman önerileri
 *      (güvenlik uyarıları, rota önerileri)
 *   2. SmartSnapshot — smartEngine'den gelen kullanım alışkanlığı önerileri
 *      ve hızlı eylem chipleri
 */
import { memo, useState, useEffect, useCallback } from 'react';
import {
  X, Zap, Moon, Palette, Lightbulb, ChevronRight,
  AlertTriangle, Flame, Home, Briefcase, Navigation2, Wrench,
} from 'lucide-react';
import type { SmartSnapshot } from '../../platform/smartEngine';
import type { CtxSuggestion, CtxAction } from '../../platform/contextEngine';
import { APP_MAP } from '../../data/apps';

interface Props {
  smart:           SmartSnapshot;
  enabled:         boolean;
  onLaunch:        (appId: string) => void;
  ctxSuggestions?: CtxSuggestion[];
  onOpenMap?:      () => void;
  onOpenDrawer?:   (drawer: string) => void;
}

/* ── SmartEngine yardımcıları ────────────────────────────── */

function reasonLabel(reason: string): string {
  const map: Record<string, string> = {
    morning_commute_pattern:         'Sabah rutini',
    evening_entertainment_pattern:   'Akşam alışkanlığı',
    driving_mode_minimal_ui:         'Sürüş modu',
    idle_high_nav_usage:             'Navigasyon alışkanlığı',
    idle_high_music_usage:           'Müzik alışkanlığı',
    low_activity_idle:               'Düşük aktivite',
  };
  return map[reason] ?? 'Akıllı öneri';
}

function recIcon(type: string, value: string) {
  if (type === 'app') {
    const app = APP_MAP[value];
    if (app) return <span className="text-xl leading-none">{app.icon}</span>;
    return <Navigation2 className="w-5 h-5" />;
  }
  if (type === 'theme-style') return <Palette className="w-5 h-5" />;
  if (type === 'theme-pack')  return <Zap className="w-5 h-5" />;
  if (type === 'sleep-mode')  return <Moon className="w-5 h-5" />;
  return <Lightbulb className="w-5 h-5" />;
}

function recLabel(type: string, value: string): string {
  if (type === 'app') return APP_MAP[value]?.name ?? value;
  if (type === 'theme-style') {
    const m: Record<string, string> = { minimal: 'Minimal Arayüz', glass: 'Glass Stil', neon: 'Neon Stil' };
    return m[value] ?? value;
  }
  if (type === 'theme-pack') {
    const m: Record<string, string> = { 'big-cards': 'Büyük Kart', 'ai-center': 'AI Merkez', tesla: 'Tesla', bmw: 'BMW', mercedes: 'Mercedes' };
    return m[value] ?? value;
  }
  if (type === 'sleep-mode') return 'Uyku Modu';
  return value;
}

/* ── CtxSuggestion yardımcıları ──────────────────────────── */

function ctxIcon(kind: CtxSuggestion['kind']) {
  switch (kind) {
    case 'engine-warning':      return <Flame        className="w-5 h-5" />;
    case 'fuel-warning':        return <AlertTriangle className="w-5 h-5" />;
    case 'maintenance-warning': return <Wrench       className="w-5 h-5" />;
    case 'route-home':          return <Home         className="w-5 h-5" />;
    case 'route-work':          return <Briefcase    className="w-5 h-5" />;
  }
}

function isSafetyWarning(kind: CtxSuggestion['kind']): boolean {
  return kind === 'engine-warning' || kind === 'fuel-warning' || kind === 'maintenance-warning';
}

/* ── CtxSuggestion satırı ────────────────────────────────── */

const CtxRow = memo(function CtxRow({
  suggestion, onDismiss, onAction,
}: {
  suggestion: CtxSuggestion;
  onDismiss:  (id: string) => void;
  onAction:   (action: CtxAction) => void;
}) {
  const safety = isSafetyWarning(suggestion.kind);

  return (
    <div
      className="flex items-center gap-3 rounded-2xl px-4 py-2.5 border animate-fade-in"
      style={{
        background:   safety ? `${suggestion.color}18` : 'rgba(10,18,40,0.95)',
        borderColor:  `${suggestion.color}55`,
      }}
    >
      <div
        className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
        style={{ background: `${suggestion.color}22`, color: suggestion.color }}
      >
        {ctxIcon(suggestion.kind)}
      </div>

      <div className="flex-1 min-w-0">
        <div className="text-[10px] font-bold uppercase tracking-widest leading-none mb-0.5"
          style={{ color: suggestion.color }}>
          {safety ? '⚠ UYARI' : 'Öneri'}
        </div>
        <div className="text-primary text-sm font-black truncate">{suggestion.title}</div>
        <div className="text-slate-400 text-[11px] truncate">{suggestion.subtitle}</div>
      </div>

      <button
        onClick={() => { onAction(suggestion.action); onDismiss(suggestion.id); }}
        className="flex-shrink-0 flex items-center gap-1.5 px-4 py-2 rounded-xl text-primary text-xs font-black uppercase tracking-widest active:scale-95 transition-transform"
        style={{ background: suggestion.color }}
      >
        {suggestion.kind === 'route-home' || suggestion.kind === 'route-work'
          ? 'Başlat'
          : suggestion.kind === 'maintenance-warning'
          ? 'Bakım'
          : 'Görüntüle'}
        <ChevronRight className="w-3 h-3" />
      </button>

      {!safety && (
        <button
          onClick={() => onDismiss(suggestion.id)}
          className="w-7 h-7 rounded-full var(--panel-bg-secondary) border border-white/10 flex items-center justify-center text-slate-400 hover:text-primary active:scale-90 transition-all flex-shrink-0"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
});

/* ── Ana bileşen ─────────────────────────────────────────── */

export const SmartContextBanner = memo(function SmartContextBanner({
  smart, enabled, onLaunch, ctxSuggestions = [], onOpenMap, onOpenDrawer,
}: Props) {
  const [dismissed,    setDismissed]    = useState(false);
  const [dismissedCtx, setDismissedCtx] = useState<Set<string>>(new Set());
  const rec = smart.recommendation;

  useEffect(() => { if (rec) setDismissed(false); }, [rec?.reason, rec?.value]);
  useEffect(() => {
    if (!rec || dismissed || !enabled) return;
    const t = setTimeout(() => setDismissed(true), 8_000);
    return () => clearTimeout(t);
  }, [rec, dismissed, enabled]);

  const dismiss    = useCallback(() => setDismissed(true), []);
  const dismissCtx = useCallback((id: string) => {
    setDismissedCtx((prev) => new Set([...prev, id]));
  }, []);

  const handleCtxAction = useCallback((action: CtxAction) => {
    if (action.type === 'navigate')    { onOpenMap?.(); return; }
    if (action.type === 'open-drawer') { onOpenDrawer?.(action.drawer); return; }
    if (action.type === 'launch')      { onLaunch(action.appId); return; }
  }, [onLaunch, onOpenMap, onOpenDrawer]);

  const visibleCtx = ctxSuggestions.filter((s) => !dismissedCtx.has(s.id));
  const hasRec     = !!rec && !dismissed && enabled;

  if (!enabled || (!hasRec && visibleCtx.length === 0)) return null;

  return (
    <div className="flex-shrink-0 px-1 pb-2 flex flex-col gap-2">

      {/* ── Bağlam önerileri (GPS/OBD/zaman) ── */}
      {visibleCtx.map((s) => (
        <CtxRow
          key={s.id}
          suggestion={s}
          onDismiss={dismissCtx}
          onAction={handleCtxAction}
        />
      ))}

      {/* ── SmartEngine öneri bandı ── */}
      {hasRec && rec && (
        <div className="flex items-center gap-3 rounded-2xl px-4 py-2.5 border animate-fade-in"
          style={{ background: 'rgba(10,18,40,0.95)', borderColor: 'rgba(59,130,246,0.3)' }}>
          <div className="w-9 h-9 rounded-xl bg-blue-500/20 border border-blue-500/30 flex items-center justify-center flex-shrink-0 text-blue-300">
            {recIcon(rec.type, rec.value)}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-blue-400/80 text-[10px] font-bold uppercase tracking-widest leading-none mb-0.5">{reasonLabel(rec.reason)}</div>
            <div className="text-primary text-sm font-black truncate">{recLabel(rec.type, rec.value)} önerildi</div>
          </div>
          {rec.type === 'app' && (
            <button onClick={() => { onLaunch(rec.value); dismiss(); }}
              className="flex-shrink-0 flex items-center gap-1.5 px-4 py-2 rounded-xl bg-blue-600 text-primary text-xs font-black uppercase tracking-widest active:scale-95 transition-transform">
              Aç <ChevronRight className="w-3 h-3" />
            </button>
          )}
          <button onClick={dismiss}
            className="w-7 h-7 rounded-full var(--panel-bg-secondary) border border-white/10 flex items-center justify-center text-slate-400 hover:text-primary active:scale-90 transition-all flex-shrink-0">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

    </div>
  );
});


