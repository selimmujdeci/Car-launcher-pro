/**
 * Split Screen — Navigasyon + Müzik bölünmüş ekran modu.
 *
 * Sol %60 harita / sağ %40 müzik kontrolü.
 * fixed inset-0 z-[200] — her şeyin üstünde, tam ekran overlay.
 * Sağ panel koyu arka plana sahip, harita kayması engellenmiş.
 */

import { memo, useCallback, useState } from 'react';
import { X, Maximize2, Music, Map as MapIcon } from 'lucide-react';
import { MiniMapWidget } from '../map/MiniMapWidget';
import { FullMapView } from '../map/FullMapView';
import {
  useMediaState,
  togglePlayPause,
  next,
  previous,
  fmtTime,
} from '../../platform/mediaService';
import { openMusicDrawer } from '../../platform/mediaUi';
import { Play, Pause, SkipBack, SkipForward } from 'lucide-react';

/* ── Müzik paneli ────────────────────────────────────────── */

const SplitMusicPanel = memo(function SplitMusicPanel() {
  const { playing, track } = useMediaState();
  const launch = useCallback(() => openMusicDrawer(), []);

  const pct = track.durationSec > 0
    ? Math.min(100, (track.positionSec / track.durationSec) * 100)
    : 0;

  return (
    <div className="h-full flex flex-col p-5 gap-4 overflow-hidden">
      {/* Üst etiket */}
      <div className="flex items-center gap-2 flex-shrink-0">
        <Music className="w-4 h-4 text-blue-400" />
        <span className="text-[10px] font-black uppercase tracking-widest" style={{ color: 'var(--text-muted, #64748b)' }}>Müzik</span>
      </div>

      {/* Albüm kapağı / ikon */}
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
          <div
            className="w-full max-w-[140px] aspect-square rounded-2xl border border-white/10 flex items-center justify-center text-5xl"
            style={{ background: 'rgba(255,255,255,0.06)' }}
          >
            🎵
          </div>
        )}
        <div className="text-center w-full">
          <div className="font-bold text-base leading-tight truncate px-2" style={{ color: 'var(--text-primary, #f1f5f9)' }}>
            {track.title || 'Çalmıyor'}
          </div>
          <div className="text-sm truncate px-2 mt-0.5" style={{ color: 'var(--text-muted, #64748b)' }}>
            {track.artist || '—'}
          </div>
        </div>
      </button>

      {/* İlerleme çubuğu */}
      <div className="flex-shrink-0">
        <div className="w-full h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.08)' }}>
          <div
            className="h-full bg-blue-500 rounded-full transition-[width] duration-500"
            style={{ width: `${pct}%` }}
          />
        </div>
        <div className="flex justify-between text-[10px] tabular-nums mt-1" style={{ color: 'var(--text-muted, #64748b)' }}>
          <span>{fmtTime(track.positionSec)}</span>
          <span>{fmtTime(track.durationSec)}</span>
        </div>
      </div>

      {/* Kontroller */}
      <div className="flex gap-3 flex-shrink-0 mt-auto">
        <button
          onClick={previous}
          className="flex-1 h-14 rounded-2xl border border-white/10 flex items-center justify-center active:scale-95 transition-all"
          style={{ background: 'rgba(255,255,255,0.06)', color: 'var(--text-primary, #f1f5f9)' }}
        >
          <SkipBack className="w-6 h-6" />
        </button>
        <button
          onClick={togglePlayPause}
          className="flex-[2] h-14 rounded-2xl bg-blue-500 shadow-lg flex items-center justify-center active:scale-95 transition-all"
          style={{ color: '#ffffff', boxShadow: '0 4px 20px rgba(59,130,246,0.35)' }}
        >
          {playing
            ? <Pause className="w-7 h-7 fill-current" />
            : <Play  className="w-7 h-7 fill-current" />
          }
        </button>
        <button
          onClick={next}
          className="flex-1 h-14 rounded-2xl border border-white/10 flex items-center justify-center active:scale-95 transition-all"
          style={{ background: 'rgba(255,255,255,0.06)', color: 'var(--text-primary, #f1f5f9)' }}
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
    <div
      className="fixed inset-0 z-[60] flex"
      style={{ background: 'var(--surface-base, #060d1a)' }}
    >
      {/* ─── Sol: Harita (60%) ─────────────────────────────── */}
      <div className="flex-[3] relative min-h-0 min-w-0 overflow-hidden">
        {/* Üst başlık şeridi */}
        <div
          className="absolute top-0 inset-x-0 h-14 z-10 flex items-center px-5 gap-3 pointer-events-none"
          style={{ background: 'linear-gradient(to bottom, rgba(6,13,26,0.7) 0%, transparent 100%)' }}
        >
          <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'rgba(59,130,246,0.15)' }}>
            <MapIcon className="w-4 h-4 text-blue-400" />
          </div>
          <span className="text-[10px] font-black uppercase tracking-[0.2em]" style={{ color: 'var(--text-secondary, #94a3b8)' }}>Navigasyon Paneli</span>
        </div>

        {/* Harita */}
        <div className="absolute inset-0">
          <MiniMapWidget onFullScreenClick={() => setMapFullScreen(true)} />
        </div>

        {/* Tam ekran butonu */}
        <button
          onClick={() => setMapFullScreen(true)}
          className="absolute bottom-5 right-5 z-10 w-12 h-12 rounded-2xl border border-white/20 flex items-center justify-center active:scale-90 transition-all shadow-lg"
          style={{ background: 'rgba(6,13,26,0.8)', backdropFilter: 'blur(12px)', color: 'var(--text-primary, #f1f5f9)' }}
        >
          <Maximize2 className="w-6 h-6" />
        </button>
      </div>

      {/* ─── Dikey ayırıcı çizgi ─────────────────────────── */}
      <div className="w-px flex-shrink-0" style={{ background: 'rgba(255,255,255,0.10)' }} />

      {/* ─── Sağ: Müzik (40%) — tam opak, harita kanaması yok ── */}
      <div
        data-solid-panel
        className="flex-[2] flex flex-col min-h-0 min-w-0 overflow-hidden"
        style={{ background: 'var(--surface-base, #0a1020)' }}
      >
        {/* Başlık + kapat */}
        <div
          className="flex-shrink-0 flex items-center justify-between px-5 py-3 border-b"
          style={{ borderColor: 'rgba(255,255,255,0.08)' }}
        >
          <span className="text-[11px] font-black uppercase tracking-widest" style={{ color: 'var(--text-muted, #64748b)' }}>
            Split Ekran
          </span>
          <button
            onClick={onClose}
            className="w-10 h-10 rounded-2xl border border-white/10 flex items-center justify-center active:scale-90 transition-all"
            style={{ background: 'rgba(255,255,255,0.06)', color: 'var(--text-secondary, #94a3b8)' }}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Müzik içeriği */}
        <div className="flex-1 min-h-0 overflow-hidden">
          <SplitMusicPanel />
        </div>
      </div>
    </div>
  );
});

export default SplitScreen;
