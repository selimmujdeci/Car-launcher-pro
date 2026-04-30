/**
 * SentryOverlay — Tüm ekranlarda görünür Tesla tarzı gözetleme göstergesi.
 * App.tsx içinde <RadarAlertHUD /> ile aynı seviyede render edilir.
 * Sentry idle iken null döner (sıfır render maliyeti).
 */

import { memo } from 'react';
import { useSentryState } from '../../platform/security/sentryEngine';

export const SentryOverlay = memo(function SentryOverlay() {
  const s = useSentryState();
  if (s.status === 'idle') return null;

  const triggered = s.status === 'triggered';

  return (
    <div
      className={`
        fixed bottom-6 left-4 z-[9990] flex items-center gap-2
        rounded-2xl border px-3 py-2 shadow-xl backdrop-blur-sm
        transition-all select-none pointer-events-none
        ${triggered
          ? 'bg-red-900/95 border-red-400/50 shadow-[0_0_20px_rgba(239,68,68,0.4)]'
          : 'bg-red-950/90 border-red-600/30'}
      `}
    >
      <div
        className={`w-2 h-2 rounded-full bg-red-400 flex-shrink-0 ${
          triggered ? 'animate-ping' : 'animate-pulse'
        }`}
      />
      <span className="text-red-300 text-[11px] font-black tracking-widest uppercase">
        {triggered ? 'Darbe!' : 'Gözcü Aktif'}
      </span>
      {s.videoAvailable && (
        <span className="text-red-500/70 text-[9px]">●REC</span>
      )}
    </div>
  );
});
