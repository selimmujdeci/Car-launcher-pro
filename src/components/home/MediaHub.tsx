/**
 * Media Hub — premium medya kontrol kartı.
 *
 * Aktif session: album kapağı blur+gradient arka plan, renk glow, smooth fade geçişleri.
 * Pasif mod: hiçbir medya oturumu yokken zarif boş durum gösterir.
 */
import { memo, useEffect, useCallback } from 'react';
import { Play, Pause, SkipBack, SkipForward, Music2, Bluetooth, Radio } from 'lucide-react';
import {
  useMediaState,
  togglePlayPause,
  next,
  previous,
  fmtTime,
  startMediaHub,
  stopMediaHub,
} from '../../platform/mediaService';
import type { MediaSource } from '../../platform/mediaService';
import { MUSIC_OPTIONS } from '../../data/apps';
import { isNative } from '../../platform/bridge';
import { openMusicDrawer } from '../../platform/mediaUi';
import type { MusicOptionKey } from '../../data/apps';

/* ── Kaynak meta ─────────────────────────────────────────── */

interface SourceMeta {
  label: string;
  color: string;
  Icon:  React.ComponentType<{ className?: string }>;
}

const SOURCE_META: Record<MediaSource, SourceMeta> = {
  spotify:       { label: 'Spotify',   color: '#1db954', Icon: Music2    },
  youtube:       { label: 'YouTube',   color: '#ff4444', Icon: Radio     },
  youtube_music: { label: 'YT Music',  color: '#ff4444', Icon: Music2    },
  local:         { label: 'Müzik',     color: '#3b82f6', Icon: Music2    },
  bluetooth:     { label: 'Bluetooth', color: '#8b5cf6', Icon: Bluetooth },
  unknown:       { label: 'Medya',     color: '#64748b', Icon: Radio     },
};

/* ── Bileşen ─────────────────────────────────────────────── */

export const MediaHub = memo(function MediaHub({
  defaultMusic,
}: {
  defaultMusic: MusicOptionKey;
}) {
  useEffect(() => {
    startMediaHub();
    return () => stopMediaHub();
  }, []);

  const { playing, track, source, activeAppName, hasSession } = useMediaState();

  const srcMeta     = SOURCE_META[source] ?? SOURCE_META.unknown;
  const fallbackApp = MUSIC_OPTIONS[defaultMusic];

  const progressPct = track.durationSec > 0
    ? Math.min(100, Math.round((track.positionSec / track.durationSec) * 100))
    : 0;

  const handleOpen = useCallback(() => openMusicDrawer(), []);

  const displayName = activeAppName || srcMeta.label;

  /* ── Pasif mod — aktif medya oturumu yok ─────────────────── */
  if (!hasSession) {
    return (
      <div className="h-full glass-card border-none !shadow-none flex flex-col items-center justify-center gap-5 p-6 animate-fade-in">
        {/* İkon */}
        <div
          className="w-16 h-16 rounded-2xl flex items-center justify-center shadow-lg"
          style={{
            background:  `linear-gradient(135deg, ${srcMeta.color}22, ${srcMeta.color}0a)`,
            border:      `1px solid ${srcMeta.color}30`,
          }}
        >
          <Music2 className="w-8 h-8" style={{ color: `${srcMeta.color}cc` }} />
        </div>

        {/* Metin */}
        <div className="text-center">
          <div className="text-primary text-base font-bold">Müzik Çalmıyor</div>
          <div className="text-secondary text-xs mt-1.5 leading-tight font-medium">
            Bir medya uygulaması başlatın
          </div>
        </div>

        {/* Müzik uygulamasını aç */}
        <button
          onClick={handleOpen}
          className="flex items-center gap-2.5 px-6 py-3 rounded-xl text-sm font-black active:scale-95 transition-all shadow-md"
          style={{
            backgroundColor: `${srcMeta.color}20`,
            color:            srcMeta.color,
            border:          `1px solid ${srcMeta.color}35`,
          }}
        >
          <span className="text-lg leading-none">{fallbackApp.icon}</span>
          {fallbackApp.name.toUpperCase()} AÇ
        </button>
      </div>
    );
  }

  /* ── Aktif mod ───────────────────────────────────────────── */
  return (
    <div className="h-full glass-card border-none !shadow-none flex flex-col overflow-hidden relative animate-fade-in premium-card" data-editable="media-hub" data-editable-type="media">
      
      {/* Premium Aura */}
      <div className="media-aura" style={{ '--premium-accent-glow': `${srcMeta.color}44` } as any} />

      {/* Album kapağı blur arka planı — lower opacity for text contrast */}
      {track.albumArt && (
        <div
          key={track.albumArt}
          className="absolute inset-0 pointer-events-none animate-fade-in"
          style={{
            backgroundImage:    `url(${track.albumArt})`,
            backgroundSize:     'cover',
            backgroundPosition: 'center',
            opacity:            0.12,
            filter:             'blur(60px)',
            transform:          'scale(1.2)',
          }}
        />
      )}

      {/* Okunabilirlik için gradient */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: 'linear-gradient(to bottom, transparent 0%, rgba(255,255,255,0.2) 100%)',
        }}
      />

      {/* İçerik katmanı */}
      <div className="relative flex-1 p-6 flex flex-col gap-5 min-h-0" onClick={handleOpen}>

        {/* Üst satır: gösterge noktası + kaynak rozeti */}
        <div className="flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-2">
            <div
              className={`w-2 h-2 rounded-full ${playing ? 'animate-pulse shadow-[0_0_8px_currentColor]' : 'opacity-60'}`}
              style={{ backgroundColor: playing ? srcMeta.color : 'var(--text-muted)' }}
            />
            <span className="text-secondary text-[10px] tracking-[0.2em] uppercase font-black opacity-80">
              MEDYA HUB
            </span>
          </div>

          <div
            className="flex items-center gap-1.5 px-3 py-1 rounded-lg text-[10px] font-black uppercase tracking-wider shadow-sm border"
            style={{
              backgroundColor: `${srcMeta.color}15`,
              borderColor:     `${srcMeta.color}30`,
              color:            srcMeta.color,
            }}
          >
            <srcMeta.Icon className="w-3.5 h-3.5" />
            {displayName}
          </div>
        </div>

        {/* Album kapağı + parça bilgisi */}
        <div className="flex items-center gap-5 flex-shrink-0 w-full text-left">
          {track.albumArt ? (
            <img
              key={track.albumArt}
              src={track.albumArt}
              alt="Kapak"
              className="w-20 h-20 rounded-2xl flex-shrink-0 object-cover border border-black/5 animate-fade-in shadow-lg"
            />
          ) : (
            <div
              className="w-20 h-20 rounded-2xl flex-shrink-0 flex items-center justify-center text-4xl border border-black/5 shadow-md glass-inner-focus"
            >
              {fallbackApp.icon}
            </div>
          )}

          <div className="min-w-0 flex-1">
            <div className="text-primary text-xl font-black truncate leading-tight tracking-tight">
              {track.title || 'Müzik Çalmıyor'}
            </div>
            <div className="text-secondary text-[15px] truncate mt-1.5 leading-tight font-bold">
              {track.artist || '—'}
            </div>
          </div>
        </div>

        {/* İlerleme çubuğu */}
        <div className="flex-shrink-0 mt-auto">
          <div className="w-full h-2 bg-black/5 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-[width] duration-700 ease-out"
              style={{
                width:      `${progressPct}%`,
                background: `linear-gradient(90deg, ${srcMeta.color}cc, ${srcMeta.color})`,
                boxShadow:  `0 0 10px ${srcMeta.color}44`
              }}
            />
          </div>
          <div className="flex justify-between text-secondary text-[11px] mt-2.5 font-black tabular-nums tracking-wider">
            <span>{fmtTime(track.positionSec)}</span>
            <span>{fmtTime(track.durationSec)}</span>
          </div>
        </div>

        {/* Kontrol butonları — sadece native modda aktif */}
        <div className="flex gap-3 flex-shrink-0 h-14 mt-1" onClick={(e) => e.stopPropagation()}>
          <button
            onClick={previous}
            disabled={!isNative}
            className="flex-1 rounded-2xl rgba(255,255,255,0.4) border border-black/5 text-primary flex items-center justify-center active:scale-90 disabled:opacity-30 transition-all hover:bg-white/60 shadow-sm"
          >
            <SkipBack className="w-6 h-6 fill-current" />
          </button>

          <button
            onClick={togglePlayPause}
            disabled={!isNative}
            className="flex-[2.5] rounded-2xl text-white flex items-center justify-center active:scale-95 disabled:opacity-40 transition-all shadow-md"
            style={{
              backgroundColor: srcMeta.color,
              boxShadow:       isNative ? `0 8px 20px ${srcMeta.color}44` : 'none',
            }}
          >
            {playing
              ? <Pause className="w-7 h-7 fill-current" />
              : <Play  className="w-7 h-7 fill-current" />
            }
          </button>

          <button
            onClick={next}
            disabled={!isNative}
            className="flex-1 rounded-2xl rgba(255,255,255,0.4) border border-black/5 text-primary flex items-center justify-center active:scale-90 disabled:opacity-30 transition-all hover:bg-white/60 shadow-sm"
          >
            <SkipForward className="w-6 h-6 fill-current" />
          </button>
        </div>
      </div>
    </div>
  );
});


