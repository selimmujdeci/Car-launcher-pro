/**
 * SmartContextBanner — bağlam-farkındı akıllı öneri bandı.
 *
 * - smart.recommendation varsa tek satır banner gösterir (oto-uygula veya öner)
 * - smart.quickActions'ı horizontal chip olarak sunar
 * - 8 saniye sonra otomatik kapanır; kullanıcı X ile erken kapatabilir
 * - settings.smartContextEnabled false ise render edilmez
 */
import { memo, useState, useEffect, useCallback } from 'react';
import {
  X, Navigation2, Music, Zap, Moon, Palette, Lightbulb,
} from 'lucide-react';
import type { SmartSnapshot } from '../../platform/smartEngine';
import { APP_MAP } from '../../data/apps';

interface Props {
  smart:   SmartSnapshot;
  enabled: boolean;
  onLaunch: (appId: string) => void;
}

/* ── Öneri mesajı ────────────────────────────────────────── */

function reasonLabel(reason: string): string {
  const map: Record<string, string> = {
    morning_commute_pattern:  'Sabah rutinine göre',
    evening_entertainment_pattern: 'Akşam alışkanlığına göre',
    driving_mode_minimal_ui:  'Sürüş için optimize edildi',
    idle_high_nav_usage:      'Navigasyon kullanımınıza göre',
    idle_high_music_usage:    'Müzik alışkanlığınıza göre',
    low_activity_idle:        'Düşük aktivite tespit edildi',
  };
  return map[reason] ?? 'Akıllı öneri';
}

function recIcon(type: string, value: string): React.ReactNode {
  if (type === 'app') {
    const app = APP_MAP[value];
    if (app) return <span className="text-base leading-none">{app.icon}</span>;
    return <Navigation2 className="w-4 h-4" />;
  }
  if (type === 'theme-style') return <Palette className="w-4 h-4" />;
  if (type === 'theme-pack')  return <Zap className="w-4 h-4" />;
  if (type === 'sleep-mode')  return <Moon className="w-4 h-4" />;
  return <Lightbulb className="w-4 h-4" />;
}

function recLabel(type: string, value: string): string {
  if (type === 'app') {
    return APP_MAP[value]?.name ?? value;
  }
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

/* ── Ana bileşen ─────────────────────────────────────────── */

export const SmartContextBanner = memo(function SmartContextBanner({
  smart,
  enabled,
  onLaunch,
}: Props) {
  const [dismissed, setDismissed] = useState(false);
  const rec = smart.recommendation;

  // Yeni öneri gelince dismiss sıfırla
  useEffect(() => {
    if (rec) setDismissed(false);
  }, [rec?.reason, rec?.value]);

  // 8 saniye sonra otomatik kapat
  useEffect(() => {
    if (!rec || dismissed || !enabled) return;
    const t = setTimeout(() => setDismissed(true), 8_000);
    return () => clearTimeout(t);
  }, [rec, dismissed, enabled]);

  const dismiss = useCallback(() => setDismissed(true), []);

  // Quick action chips (maks 3 — navigasyon ve müzik önde)
  const chips = smart.quickActions.slice(0, 3);
  const hasChips = chips.length > 0;
  const hasRec = !!rec && !dismissed && enabled;

  if (!enabled || (!hasRec && !hasChips)) return null;

  return (
    <div
      className="flex-shrink-0 relative z-20 px-3 pb-1 transition-all duration-500"
      style={{ animation: 'float-entrance 0.4s ease' }}
    >
      {/* Öneri bandı */}
      {hasRec && rec && (
        <div className="mb-1.5 flex items-center gap-2 bg-blue-500/10 border border-blue-400/15 rounded-2xl px-3 py-2 backdrop-blur-xl shadow-lg">
          {/* İkon */}
          <div className="w-7 h-7 rounded-xl bg-blue-500/20 border border-blue-400/20 flex items-center justify-center flex-shrink-0 text-blue-300">
            {recIcon(rec.type, rec.value)}
          </div>

          {/* Metin */}
          <div className="flex-1 min-w-0">
            <span className="text-[10px] text-blue-400/70 font-bold uppercase tracking-widest block leading-tight">
              {reasonLabel(rec.reason)}
            </span>
            <span className="text-white text-xs font-bold truncate block leading-tight">
              {recLabel(rec.type, rec.value)} önerildi
            </span>
          </div>

          {/* Uygula / Aç butonu */}
          {rec.type === 'app' && (
            <button
              onClick={() => { onLaunch(rec.value); dismiss(); }}
              className="flex-shrink-0 px-3 py-1.5 rounded-xl bg-blue-500/20 border border-blue-400/25 text-blue-300 text-[11px] font-black uppercase tracking-wide active:scale-95 transition-transform"
            >
              Aç
            </button>
          )}

          {/* Kapat */}
          <button
            onClick={dismiss}
            className="flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-slate-500 hover:text-slate-300 transition-colors active:scale-90"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Hızlı eylem chipleri */}
      {hasChips && (
        <div className="flex gap-2 overflow-x-auto pb-0.5 scrollbar-none">
          {chips.map((action) => {
            const app = APP_MAP[action.appId];
            return (
              <button
                key={action.id}
                onClick={() => onLaunch(action.appId)}
                className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/5 border border-white/8 backdrop-blur-md text-white text-[11px] font-bold active:scale-95 transition-transform hover:bg-white/10"
              >
                {app
                  ? <span className="text-sm leading-none">{app.icon}</span>
                  : action.icon.startsWith('🎵')
                    ? <Music className="w-3 h-3 text-purple-400" />
                    : <Navigation2 className="w-3 h-3 text-blue-400" />
                }
                <span className="truncate max-w-[80px]">{action.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
});
