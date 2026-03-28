/**
 * Split Screen — Navigasyon + Müzik bölünmüş ekran modu.
 *
 * Düzen: sol %60 harita / navigasyon, sağ %40 müzik kontrolü.
 * Tam ekran overlay olarak açılır, tek tıkla kapanır.
 * Araçta dokunmatik kullanımı için büyük buton alanları.
 */

import { memo, useCallback, useState } from 'react';
import { X, Maximize2 } from 'lucide-react';
import { MiniMapWidget } from '../map/MiniMapWidget';
import { FullMapView } from '../map/FullMapView';
import {
  useMediaState,
  togglePlayPause,
  next,
  previous,
  fmtTime,
} from '../../platform/mediaService';
import { openMusic } from '../../platform/appLauncher';
import { useStore } from '../../store/useStore';
import {
  Play, Pause, SkipBack, SkipForward,
  Map as MapIcon, Music,
} from 'lucide-react';

/* ── Müzik paneli ────────────────────────────────────────── */

const SplitMusicPanel = memo(function SplitMusicPanel() {
  const { playing, track } = useMediaState();
  const { settings }       = useStore();
  const launch = useCallback(() => openMusic(settings.defaultMusic as any), [settings.defaultMusic]);

  const pct = track.durationSec > 0
    ? Math.min(100, (track.positionSec / track.durationSec) * 100)
    : 0;

  return (
    <div className="h-full flex flex-col bg-[#060d1a] p-4 gap-4">
      {/* Başlık */}
      <div className="flex items-center gap-2 flex-shrink-0">
        <Music className="w-4 h-4 text-blue-400" />
        <span className="text-slate-500 text-[10px] uppercase tracking-widest">Müzik</span>
      </div>

      {/* Albüm resmi / icon */}
      <button
        onClick={launch}
        className="flex-shrink-0 flex flex-col items-center gap-3 active:opacity-70 transition-opacity"
      >
        {track.albumArt ? (
          <img
            src={track.albumArt}
            alt="Albüm"
            className="w-full max-w-[140px] aspect-square rounded-2xl object-cover shadow-2xl border border-white/10"
          />
        ) : (
          <div className="w-full max-w-[140px] aspect-square rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center text-5xl">
            🎵
          </div>
        )}
        <div className="text-center w-full">
          <div className="text-white font-bold text-base leading-tight truncate px-2">
            {track.title || 'Çalmıyor'}
          </div>
          <div className="text-slate-400 text-sm truncate px-2 mt-0.5">
            {track.artist || '—'}
          </div>
        </div>
      </button>

      {/* İlerleme çubuğu */}
      <div className="flex-shrink-0">
        <div className="w-full h-1.5 bg-white/10 rounded-full overflow-hidden">
          <div
            className="h-full bg-blue-500 rounded-full transition-[width] duration-500"
            style={{ width: `${pct}%` }}
          />
        </div>
        <div className="flex justify-between text-slate-600 text-[10px] mt-1 tabular-nums">
          <span>{fmtTime(track.positionSec)}</span>
          <span>{fmtTime(track.durationSec)}</span>
        </div>
      </div>

      {/* Kontroller */}
      <div className="flex gap-3 flex-shrink-0 mt-auto">
        <button
          onClick={previous}
          className="flex-1 h-14 rounded-2xl bg-white/5 border border-white/5 text-white flex items-center justify-center active:bg-white/10 transition-colors"
        >
          <SkipBack className="w-6 h-6" />
        </button>
        <button
          onClick={togglePlayPause}
          className="flex-[2] h-14 rounded-2xl bg-blue-500 text-white shadow-lg shadow-blue-500/20 flex items-center justify-center active:scale-95 transition-all"
        >
          {playing
            ? <Pause className="w-7 h-7 fill-current" />
            : <Play  className="w-7 h-7 fill-current" />
          }
        </button>
        <button
          onClick={next}
          className="flex-1 h-14 rounded-2xl bg-white/5 border border-white/5 text-white flex items-center justify-center active:bg-white/10 transition-colors"
        >
          <SkipForward className="w-6 h-6" />
        </button>
      </div>
    </div>
  );
});

/* ── Ana Split Screen bileşeni ───────────────────────────── */

interface SplitScreenProps {
  onClose: () => void;
}

export const SplitScreen = memo(function SplitScreen({ onClose }: SplitScreenProps) {
  const [mapFullScreen, setMapFullScreen] = useState(false);

  if (mapFullScreen) {
    return <FullMapView onClose={() => setMapFullScreen(false)} />;
  }

  return (
    <div className="fixed inset-0 z-[60] flex bg-[#060d1a] animate-fade-in">
      {/* ─── Sol: Harita (60%) ─────────────────────────────── */}
      <div className="flex-[3] relative border-r border-white/5 min-h-0">
        {/* Üst başlık */}
        <div className="absolute top-0 inset-x-0 h-10 bg-gradient-to-b from-black/70 to-transparent z-10 flex items-center px-3 gap-2 pointer-events-none">
          <MapIcon className="w-3.5 h-3.5 text-blue-400" />
          <span className="text-slate-500 text-[10px] uppercase tracking-widest">Navigasyon</span>
        </div>

        <div className="h-full">
          <MiniMapWidget onFullScreenClick={() => setMapFullScreen(true)} />
        </div>

        {/* Tam ekran butonu */}
        <button
          onClick={() => setMapFullScreen(true)}
          className="absolute bottom-3 right-3 z-10 w-9 h-9 rounded-xl bg-black/60 backdrop-blur border border-white/10 flex items-center justify-center text-slate-400 hover:text-white active:scale-90 transition-all"
        >
          <Maximize2 className="w-4 h-4" />
        </button>
      </div>

      {/* ─── Sağ: Müzik (40%) ─────────────────────────────── */}
      <div className="flex-[2] flex flex-col min-h-0 overflow-hidden">
        {/* Kapat butonu */}
        <div className="flex-shrink-0 flex justify-end p-3 border-b border-white/5">
          <button
            onClick={onClose}
            className="w-9 h-9 rounded-xl bg-white/5 flex items-center justify-center text-slate-500 hover:text-white hover:bg-white/10 active:scale-90 transition-all"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-hidden">
          <SplitMusicPanel />
        </div>
      </div>
    </div>
  );
});

export default SplitScreen;
