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
import { openMusic, openApp } from '../../platform/appLauncher';
import { APP_MAP, MUSIC_OPTIONS } from '../../data/apps';
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

const SOURCE_APP_ID: Partial<Record<MediaSource, string>> = {
  spotify: 'spotify',
  youtube: 'youtube',
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
  const appId       = SOURCE_APP_ID[source];
  const fallbackApp = MUSIC_OPTIONS[defaultMusic];

  const progressPct = track.durationSec > 0
    ? Math.min(100, Math.round((track.positionSec / track.durationSec) * 100))
    : 0;

  const handleOpen = useCallback(() => {
    if (appId && APP_MAP[appId]) openApp(APP_MAP[appId]);
    else openMusic(defaultMusic);
  }, [appId, defaultMusic]);

  const displayName = activeAppName || srcMeta.label;

  /* ── Pasif mod — aktif medya oturumu yok ─────────────────── */
  if (!hasSession) {
    return (
      <div className="h-full bg-[#0d1628] rounded-2xl border border-white/[0.08] flex flex-col items-center justify-center gap-4 p-6 animate-fade-in">
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
          <div className="text-slate-300 text-sm font-bold">Müzik Çalmıyor</div>
          <div className="text-slate-500 text-xs mt-1 leading-tight">
            Bir medya uygulaması başlatın
          </div>
        </div>

        {/* Açma butonu */}
        <button
          onClick={handleOpen}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold active:scale-95 transition-transform"
          style={{
            backgroundColor: `${srcMeta.color}20`,
            color:            srcMeta.color,
            border:          `1px solid ${srcMeta.color}35`,
          }}
        >
          <span className="text-base leading-none">{fallbackApp.icon}</span>
          {fallbackApp.name} Aç
        </button>
      </div>
    );
  }

  /* ── Aktif mod ───────────────────────────────────────────── */
  return (
    <div className="h-full rounded-2xl shadow-xl border border-white/5 flex flex-col overflow-hidden relative animate-fade-in" data-editable="media-hub" data-editable-type="media">

      {/* Koyu taban */}
      <div className="absolute inset-0 bg-[#0d1628]" />

      {/* Album kapağı blur arka planı — key değişince animate-fade-in tetiklenir */}
      {track.albumArt && (
        <div
          key={track.albumArt}
          className="absolute inset-0 pointer-events-none animate-fade-in"
          style={{
            backgroundImage:    `url(${track.albumArt})`,
            backgroundSize:     'cover',
            backgroundPosition: 'center',
            opacity:            0.28,
            filter:             'blur(30px)',
            transform:          'scale(1.15)',
          }}
        />
      )}

      {/* Okunabilirlik için koyu gradient */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: 'linear-gradient(to bottom, rgba(13,22,40,0.45) 0%, rgba(13,22,40,0.72) 38%, rgba(13,22,40,0.97) 78%)',
        }}
      />

      {/* Çalıyorken üst kenar glow çizgisi */}
      {playing && (
        <div
          className="absolute inset-x-0 top-0 h-px pointer-events-none"
          style={{
            background: `linear-gradient(90deg, transparent 0%, ${srcMeta.color}55 50%, transparent 100%)`,
          }}
        />
      )}

      {/* İçerik katmanı */}
      <div className="relative flex-1 p-4 flex flex-col gap-3 min-h-0">

        {/* Üst satır: gösterge noktası + kaynak rozeti */}
        <div className="flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-1.5">
            <div
              className={`w-1.5 h-1.5 rounded-full ${playing ? 'animate-pulse' : 'opacity-60'}`}
              style={{ backgroundColor: playing ? srcMeta.color : '#475569' }}
            />
            <span className="text-slate-600 text-[10px] tracking-widest uppercase font-bold">
              Medya Hub
            </span>
          </div>

          <div
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider"
            style={{
              backgroundColor: `${srcMeta.color}18`,
              border:          `1px solid ${srcMeta.color}35`,
              color:            srcMeta.color,
            }}
          >
            <srcMeta.Icon className="w-3 h-3" />
            {displayName}
          </div>
        </div>

        {/* Album kapağı + parça bilgisi — tıklayınca uygulamayı aç */}
        <button
          onClick={handleOpen}
          className="flex items-center gap-4 flex-shrink-0 w-full text-left active:opacity-70"
        >
          {track.albumArt ? (
            <img
              key={track.albumArt}
              src={track.albumArt}
              alt="Kapak"
              className="w-16 h-16 rounded-xl flex-shrink-0 object-cover border border-white/10 animate-fade-in"
              style={{ boxShadow: `0 0 22px ${srcMeta.color}42` }}
            />
          ) : (
            <div
              className="w-16 h-16 rounded-xl flex-shrink-0 flex items-center justify-center text-3xl border border-white/10"
              style={{ background: `linear-gradient(135deg, ${srcMeta.color}bb, ${srcMeta.color}44)` }}
            >
              {fallbackApp.icon}
            </div>
          )}

          <div className="min-w-0 flex-1">
            <div className="text-white text-base font-bold truncate leading-tight tracking-tight">
              {track.title || 'Bilinmiyor'}
            </div>
            <div className="text-slate-400 text-[13px] truncate mt-1 leading-tight font-medium">
              {track.artist || '—'}
            </div>
          </div>
        </button>

        {/* İlerleme çubuğu */}
        <div className="flex-shrink-0 mt-auto">
          <div className="w-full h-[3px] bg-white/10 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-[width] duration-700 ease-out"
              style={{
                width:      `${progressPct}%`,
                background: `linear-gradient(90deg, ${srcMeta.color}80, ${srcMeta.color})`,
              }}
            />
          </div>
          <div className="flex justify-between text-slate-600 text-[10px] mt-1.5 font-bold tabular-nums tracking-tight">
            <span>{fmtTime(track.positionSec)}</span>
            <span>{fmtTime(track.durationSec)}</span>
          </div>
        </div>

        {/* Kontrol butonları */}
        <div className="flex gap-2.5 flex-shrink-0 h-11">
          <button
            onClick={previous}
            className="flex-1 rounded-xl bg-white/5 border border-white/10 text-slate-300 flex items-center justify-center active:scale-95"
          >
            <SkipBack className="w-5 h-5" />
          </button>

          <button
            onClick={togglePlayPause}
            className="flex-[2] rounded-xl text-white flex items-center justify-center active:scale-95"
            style={{
              backgroundColor: srcMeta.color,
              boxShadow:       `0 2px 18px ${srcMeta.color}52`,
            }}
          >
            {playing
              ? <Pause className="w-5 h-5 fill-current" />
              : <Play  className="w-5 h-5 fill-current" />
            }
          </button>

          <button
            onClick={next}
            className="flex-1 rounded-xl bg-white/5 border border-white/10 text-slate-300 flex items-center justify-center active:scale-95"
          >
            <SkipForward className="w-5 h-5" />
          </button>
        </div>
      </div>
    </div>
  );
});
