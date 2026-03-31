/**
 * SmartContextBanner — bağlam-farkındı akıllı öneri bandı.
 */
import { memo, useState, useEffect, useCallback } from 'react';
import {
  X, Navigation2, Music, Zap, Moon, Palette, Lightbulb, ChevronRight,
} from 'lucide-react';
import type { SmartSnapshot } from '../../platform/smartEngine';
import { APP_MAP } from '../../data/apps';

interface Props {
  smart:    SmartSnapshot;
  enabled:  boolean;
  onLaunch: (appId: string) => void;
}

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

/* Uygulama ID'sine göre accent rengi */
const CHIP_COLORS: Record<string, { bg: string; border: string; icon: string }> = {
  maps:      { bg: 'rgba(37,99,235,0.18)',   border: 'rgba(59,130,246,0.35)',  icon: 'text-blue-400' },
  waze:      { bg: 'rgba(37,99,235,0.18)',   border: 'rgba(59,130,246,0.35)',  icon: 'text-blue-400' },
  spotify:   { bg: 'rgba(29,185,84,0.15)',   border: 'rgba(34,197,94,0.3)',    icon: 'text-emerald-400' },
  youtube:   { bg: 'rgba(239,68,68,0.15)',   border: 'rgba(239,68,68,0.3)',    icon: 'text-red-400' },
  phone:     { bg: 'rgba(34,197,94,0.15)',   border: 'rgba(34,197,94,0.3)',    icon: 'text-emerald-400' },
  browser:   { bg: 'rgba(168,85,247,0.15)',  border: 'rgba(168,85,247,0.3)',   icon: 'text-purple-400' },
};

const DEFAULT_CHIP = { bg: 'rgba(255,255,255,0.08)', border: 'rgba(255,255,255,0.15)', icon: 'text-white' };

export const SmartContextBanner = memo(function SmartContextBanner({ smart, enabled, onLaunch }: Props) {
  const [dismissed, setDismissed] = useState(false);
  const rec = smart.recommendation;

  useEffect(() => { if (rec) setDismissed(false); }, [rec?.reason, rec?.value]);
  useEffect(() => {
    if (!rec || dismissed || !enabled) return;
    const t = setTimeout(() => setDismissed(true), 8_000);
    return () => clearTimeout(t);
  }, [rec, dismissed, enabled]);

  const dismiss = useCallback(() => setDismissed(true), []);

  const chips = smart.quickActions.slice(0, 3);
  const hasChips = chips.length > 0;
  const hasRec = !!rec && !dismissed && enabled;

  if (!enabled || (!hasRec && !hasChips)) return null;

  return (
    <div className="flex-shrink-0 px-1 pb-2">

      {/* ── Öneri bandı ── */}
      {hasRec && rec && (
        <div className="mb-2 flex items-center gap-3 rounded-2xl px-4 py-2.5 border animate-fade-in"
          style={{ background: 'rgba(10,18,40,0.95)', borderColor: 'rgba(59,130,246,0.3)' }}>
          <div className="w-9 h-9 rounded-xl bg-blue-500/20 border border-blue-500/30 flex items-center justify-center flex-shrink-0 text-blue-300">
            {recIcon(rec.type, rec.value)}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-blue-400/80 text-[10px] font-bold uppercase tracking-widest leading-none mb-0.5">{reasonLabel(rec.reason)}</div>
            <div className="text-white text-sm font-black truncate">{recLabel(rec.type, rec.value)} önerildi</div>
          </div>
          {rec.type === 'app' && (
            <button onClick={() => { onLaunch(rec.value); dismiss(); }}
              className="flex-shrink-0 flex items-center gap-1.5 px-4 py-2 rounded-xl bg-blue-600 text-white text-xs font-black uppercase tracking-widest active:scale-95 transition-transform">
              Aç <ChevronRight className="w-3 h-3" />
            </button>
          )}
          <button onClick={dismiss}
            className="w-7 h-7 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-slate-400 hover:text-white active:scale-90 transition-all flex-shrink-0">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* ── Hızlı eylem chipleri ── */}
      {hasChips && (
        <div className="flex gap-2.5 overflow-x-auto no-scrollbar">
          {chips.map((action) => {
            const app = APP_MAP[action.appId];
            const c = CHIP_COLORS[action.appId] ?? DEFAULT_CHIP;
            return (
              <button
                key={action.id}
                onClick={() => onLaunch(action.appId)}
                className="flex-shrink-0 flex items-center gap-2.5 pl-3 pr-4 py-2 rounded-2xl border active:scale-[0.94] transition-all"
                style={{ background: c.bg, borderColor: c.border }}
              >
                {/* İkon kutusu */}
                <div className={`w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 ${c.icon}`}
                  style={{ background: c.border }}>
                  {app
                    ? <span className="text-base leading-none">{app.icon}</span>
                    : action.icon.startsWith('🎵')
                      ? <Music className="w-4 h-4" />
                      : <Navigation2 className="w-4 h-4" />
                  }
                </div>
                <span className="text-white text-[13px] font-black tracking-tight truncate max-w-[100px]">
                  {action.label}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
});
