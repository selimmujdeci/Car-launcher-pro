import { memo } from 'react';
import { SkipBack, SkipForward, Play, Pause } from 'lucide-react';
import { useMediaState, togglePlayPause, next, previous } from '../../platform/mediaService';
import { useAutoBrightnessState } from '../../platform/autoBrightnessService';
import { useOBDState } from '../../platform/obdService';

export const DriveHUD = memo(function DriveHUD() {
  const obd          = useOBDState();
  const hudMedia     = useMediaState();
  const autoBrightness = useAutoBrightnessState();

  const isNightPhase = autoBrightness.phase === 'night'
    || autoBrightness.phase === 'evening'
    || autoBrightness.phase === 'dawn';

  return (
    <div data-drive-hud="main" className="flex-shrink-0 relative z-25 px-3">
      <div className="mb-1.5 px-4 py-2.5 rounded-2xl bg-black/75 backdrop-blur-xl border border-white/[0.08] flex items-center gap-4">
        {/* Speed */}
        <div className="flex items-baseline gap-1 flex-shrink-0 min-w-[72px]">
          <span className="text-4xl font-black text-white tabular-nums leading-none">
            {Math.round(obd.speed)}
          </span>
          <span className="text-slate-500 text-[10px] font-bold uppercase tracking-wide self-end mb-0.5">km/h</span>
        </div>

        <div className="w-px h-8 bg-white/10 flex-shrink-0" />

        {/* Track info */}
        <div className="flex-1 min-w-0">
          <div className="text-white text-sm font-bold truncate leading-tight">
            {hudMedia.track.title || '—'}
          </div>
          <div className="text-slate-500 text-xs truncate mt-0.5">
            {hudMedia.track.artist || '\u00a0'}
          </div>
        </div>

        {/* Media controls */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <button onClick={previous} className="w-9 h-9 rounded-xl bg-white/[0.07] border border-white/10 flex items-center justify-center active:scale-95">
            <SkipBack className="w-4 h-4 text-slate-300" />
          </button>
          <button onClick={togglePlayPause} className="w-11 h-11 rounded-xl bg-blue-500 flex items-center justify-center active:scale-95 shadow-[0_2px_12px_rgba(59,130,246,0.45)]">
            {hudMedia.playing ? <Pause className="w-5 h-5 fill-current" /> : <Play className="w-5 h-5 fill-current" />}
          </button>
          <button onClick={next} className="w-9 h-9 rounded-xl bg-white/[0.07] border border-white/10 flex items-center justify-center active:scale-95">
            <SkipForward className="w-4 h-4 text-slate-300" />
          </button>
        </div>

        {/* Night indicator */}
        {isNightPhase && <span className="flex-shrink-0 text-base leading-none select-none">🌙</span>}
      </div>
    </div>
  );
});
