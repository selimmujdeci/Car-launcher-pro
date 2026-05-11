/**
 * Local Music Browser — cihaz müzik kütüphanesi tarayıcısı.
 * MediaScreen içinde "Cihaz" sekmesi olarak gösterilir.
 */
import { memo, useEffect, useState, useCallback, useMemo } from 'react';
import { Capacitor } from '@capacitor/core';
import { Music2, Search, Play, Pause, Loader2, AlertCircle, ChevronUp } from 'lucide-react';
import {
  useLocalMusic,
  loadMusicTracks,
  playAtIndex,
  localTogglePlayPause,
  initLocalMusic,
} from '../../platform/localMusicService';
import { fmtTime } from '../../platform/mediaService';

/* ── Yardımcı: saniye formatı ────────────────────────────── */
function fmtMs(ms: number): string {
  return fmtTime(ms / 1000);
}

/* ── Ana bileşen ─────────────────────────────────────────── */

export const LocalMusicBrowser = memo(function LocalMusicBrowser() {
  const { tracks, currentIndex, playing, loading, error } = useLocalMusic();
  const [query, setQuery] = useState('');

  useEffect(() => {
    void initLocalMusic();
    void loadMusicTracks();
  }, []);

  const filtered = useMemo(() => {
    if (!query.trim()) return tracks;
    const q = query.toLowerCase();
    return tracks.filter(
      (t) => t.title.toLowerCase().includes(q) || t.artist.toLowerCase().includes(q),
    );
  }, [tracks, query]);

  const handlePlay = useCallback((index: number) => {
    // filtered index → tracks index
    const track = filtered[index];
    const realIndex = tracks.findIndex((t) => t.id === track.id);
    void playAtIndex(realIndex);
  }, [filtered, tracks]);

  /* ── Yükleniyor ── */
  if (loading) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-4 text-secondary">
        <Loader2 className="w-8 h-8 animate-spin text-blue-400/70" />
        <span className="text-sm font-bold uppercase tracking-widest">Müzikler Taranıyor...</span>
      </div>
    );
  }

  /* ── Hata ── */
  if (error) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-4 px-8 text-center">
        <AlertCircle className="w-10 h-10 text-red-400/70" />
        <div className="text-sm text-secondary font-medium leading-relaxed">{error}</div>
        <button
          onClick={() => void loadMusicTracks()}
          className="px-6 py-2.5 rounded-xl glass-card text-sm font-black text-blue-400 active:scale-95 transition-all"
        >
          Tekrar Dene
        </button>
      </div>
    );
  }

  /* ── Boş kütüphane ── */
  if (!loading && tracks.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-5 px-8 text-center">
        <div className="w-20 h-20 rounded-3xl glass-card flex items-center justify-center">
          <Music2 className="w-10 h-10 text-secondary opacity-40" />
        </div>
        <div>
          <div className="text-primary font-black text-lg">Müzik Bulunamadı</div>
          <div className="text-secondary text-sm mt-1.5 leading-relaxed max-w-[260px]">
            Cihaz depolamasında müzik dosyası yok. Dosyaları ekledikten sonra yenile.
          </div>
        </div>
        <button
          onClick={() => void loadMusicTracks()}
          className="px-6 py-2.5 rounded-xl glass-card text-sm font-black text-blue-400 active:scale-95 transition-all"
        >
          Yenile
        </button>
      </div>
    );
  }

  const currentTrack = currentIndex >= 0 ? tracks[currentIndex] : null;

  return (
    <div className="h-full flex flex-col overflow-hidden">

      {/* Şu an çalıyor — mini çubuk */}
      {currentTrack && (
        <div
          className="flex-shrink-0 flex items-center gap-3 px-4 py-3 border-b border-white/8"
          style={{ background: 'rgba(59,130,246,0.08)' }}
        >
          <div className="w-9 h-9 rounded-xl glass-card overflow-hidden flex items-center justify-center flex-shrink-0">
            {currentTrack.albumArtUri
              ? <img src={Capacitor.convertFileSrc(currentTrack.albumArtUri)} alt="" className="w-full h-full object-cover" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
              : <Music2 className="w-4 h-4 text-blue-400" />
            }
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-primary text-[13px] font-black truncate">{currentTrack.title}</div>
            <div className="text-secondary text-[10px] truncate">{currentTrack.artist}</div>
          </div>
          <button
            onClick={localTogglePlayPause}
            className="w-9 h-9 rounded-xl flex items-center justify-center text-white active:scale-90 transition-all"
            style={{ background: 'rgba(59,130,246,0.85)' }}
          >
            {playing
              ? <Pause className="w-4 h-4 fill-white" />
              : <Play  className="w-4 h-4 fill-white ml-0.5" />
            }
          </button>
          <ChevronUp className="w-4 h-4 text-secondary opacity-50 flex-shrink-0" />
        </div>
      )}

      {/* Arama */}
      <div className="flex-shrink-0 px-4 pt-3 pb-2">
        <div className="flex items-center gap-2.5 glass-card rounded-xl px-3 py-2.5 border border-white/10">
          <Search className="w-4 h-4 text-secondary flex-shrink-0" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Parça veya sanatçı ara..."
            className="flex-1 bg-transparent text-primary text-sm placeholder:text-secondary/50 outline-none font-medium"
          />
        </div>
        <div className="text-secondary text-[10px] font-bold uppercase tracking-widest mt-2 px-0.5">
          {filtered.length} parça
        </div>
      </div>

      {/* Liste */}
      <div className="flex-1 overflow-y-auto scrollbar-none px-4 pb-4">
        <div className="flex flex-col gap-1">
          {filtered.map((track, idx) => {
            const realIdx = tracks.findIndex((t) => t.id === track.id);
            const isActive = realIdx === currentIndex;
            return (
              <button
                key={track.id}
                onClick={() => handlePlay(idx)}
                className="flex items-center gap-3 p-3 rounded-2xl text-left transition-all active:scale-[0.98] group"
                style={{
                  background:   isActive ? 'rgba(59,130,246,0.15)' : 'rgba(255,255,255,0.02)',
                  borderWidth:  1,
                  borderColor:  isActive ? 'rgba(59,130,246,0.35)' : 'rgba(255,255,255,0.06)',
                  borderStyle:  'solid',
                }}
              >
                {/* Album art / çalıyor göstergesi */}
                <div className="w-10 h-10 rounded-xl overflow-hidden flex-shrink-0 relative"
                  style={{ background: isActive ? 'rgba(59,130,246,0.25)' : 'rgba(255,255,255,0.05)' }}>
                  {track.albumArtUri
                    ? <img src={Capacitor.convertFileSrc(track.albumArtUri)} alt="" className="w-full h-full object-cover" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display='none'; }} />
                    : <div className="w-full h-full flex items-center justify-center"><Music2 className={`w-4 h-4 ${isActive ? 'text-blue-400' : 'text-secondary opacity-50'}`} /></div>
                  }
                  {isActive && playing && (
                    <div className="absolute inset-0 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.55)' }}>
                      <Pause className="w-4 h-4 text-blue-400 fill-current" />
                    </div>
                  )}
                </div>

                {/* Bilgi */}
                <div className="flex-1 min-w-0">
                  <div className={`text-sm font-black truncate ${isActive ? 'text-blue-300' : 'text-primary group-hover:text-primary'}`}>
                    {track.title}
                  </div>
                  <div className="text-secondary text-[11px] truncate mt-0.5 font-medium">
                    {track.artist}
                    {track.album ? ` · ${track.album}` : ''}
                  </div>
                </div>

                {/* Süre */}
                <div className="flex-shrink-0 text-secondary text-[11px] font-black tabular-nums">
                  {fmtMs(track.durationMs)}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
});
