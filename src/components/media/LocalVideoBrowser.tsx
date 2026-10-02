/**
 * Local Video Browser — cihaz video kütüphanesi tarayıcısı.
 * MediaScreen içinde "Video" sekmesi olarak gösterilir.
 * Videolar donanım çözücüyle CarOS arayüzünün arkasında, CarOS oynatıcısıyla
 * (VideoPlayerOverlay) oynatılır — dışarıya/başka uygulamaya çıkılmaz.
 */
import { memo, useEffect, useMemo, useState, useCallback } from 'react';
import { Video, Search, Play, Loader2, AlertCircle } from 'lucide-react';
import {
  useLocalVideo,
  initLocalVideo,
  loadVideoTracks,
  playVideo,
  closeVideo,
  getLocalVideoState,
} from '../../platform/localVideoService';
import { fmtTime } from '../../platform/mediaService';
import { VideoPlayerOverlay } from './VideoPlayerOverlay';

/* ── Yardımcı ────────────────────────────────────────────── */

function fmtMs(ms: number): string {
  return fmtTime(ms / 1000);
}

function fmtSize(bytes: number): string {
  if (bytes >= 1_073_741_824) return `${(bytes / 1_073_741_824).toFixed(1)} GB`;
  if (bytes >= 1_048_576)     return `${(bytes / 1_048_576).toFixed(0)} MB`;
  return `${(bytes / 1024).toFixed(0)} KB`;
}

/* ── Ana bileşen ─────────────────────────────────────────── */

export const LocalVideoBrowser = memo(function LocalVideoBrowser() {
  const { videos, activeUri, playing, loading, error } = useLocalVideo();
  const [query, setQuery] = useState('');

  useEffect(() => {
    void initLocalVideo();
    void loadVideoTracks();
    // Ekrandan çıkılırsa video arka planda (görünmez, sesli) sürmesin.
    return () => { if (getLocalVideoState().activeUri) void closeVideo(); };
  }, []);

  const filtered = useMemo(() => {
    if (!query.trim()) return videos;
    const q = query.toLowerCase();
    return videos.filter((v) => v.title.toLowerCase().includes(q));
  }, [videos, query]);

  const handlePlay = useCallback((uri: string, title: string) => {
    void playVideo(uri, title);
  }, []);

  /* ── Yükleniyor ── */
  if (loading) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-4 text-secondary">
        <Loader2 className="w-8 h-8 animate-spin text-purple-400/70" />
        <span className="text-sm font-bold uppercase tracking-widest">Videolar Taranıyor...</span>
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
          onClick={() => void loadVideoTracks()}
          className="px-6 py-2.5 rounded-xl glass-card text-sm font-black text-purple-400 active:scale-95 transition-all"
        >
          Tekrar Dene
        </button>
      </div>
    );
  }

  /* ── Boş kütüphane ── */
  if (!loading && videos.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-5 px-8 text-center">
        <div className="w-20 h-20 rounded-3xl glass-card flex items-center justify-center">
          <Video className="w-10 h-10 text-secondary opacity-40" />
        </div>
        <div>
          <div className="text-primary font-black text-lg">Video Bulunamadı</div>
          <div className="text-secondary text-sm mt-1.5 leading-relaxed max-w-[260px]">
            Cihaz depolamasında video dosyası yok. Dosyaları ekledikten sonra yenile.
          </div>
        </div>
        <button
          onClick={() => void loadVideoTracks()}
          className="px-6 py-2.5 rounded-xl glass-card text-sm font-black text-purple-400 active:scale-95 transition-all"
        >
          Yenile
        </button>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <VideoPlayerOverlay />

      {/* Arama */}
      <div className="flex-shrink-0 px-4 pt-3 pb-2">
        <div className="flex items-center gap-2.5 glass-card rounded-xl px-3 py-2.5 border border-white/10">
          <Search className="w-4 h-4 text-secondary flex-shrink-0" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Video ara..."
            className="flex-1 bg-transparent text-primary text-sm placeholder:text-secondary/50 outline-none font-medium"
          />
        </div>
        <div className="text-secondary text-[10px] font-bold uppercase tracking-widest mt-2 px-0.5">
          {filtered.length} video
        </div>
      </div>

      {/* Liste */}
      <div className="flex-1 overflow-y-auto scrollbar-none px-4 pb-4">
        <div className="flex flex-col gap-1">
          {filtered.map((video) => {
            const isActive = video.uri === activeUri;
            return (
              <button
                key={video.id}
                onClick={() => handlePlay(video.uri, video.title)}
                className="flex items-center gap-3 p-3 rounded-2xl text-left transition-all active:scale-[0.98] group"
                style={{
                  background:  isActive ? 'rgba(168,85,247,0.15)' : 'rgba(255,255,255,0.02)',
                  borderWidth: 1,
                  borderColor: isActive ? 'rgba(168,85,247,0.35)' : 'rgba(255,255,255,0.06)',
                  borderStyle: 'solid',
                }}
              >
                {/* İkon */}
                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                  style={{ background: isActive ? 'rgba(168,85,247,0.25)' : 'rgba(255,255,255,0.05)' }}
                >
                  {isActive && playing
                    ? <Video className="w-4 h-4 text-purple-400" />
                    : <Play  className={`w-4 h-4 ${isActive ? 'text-purple-400' : 'text-secondary opacity-50'}`} />
                  }
                </div>

                {/* Bilgi */}
                <div className="flex-1 min-w-0">
                  <div className={`text-sm font-black truncate ${isActive ? 'text-purple-300' : 'text-primary'}`}>
                    {video.title}
                  </div>
                  <div className="text-secondary text-[11px] mt-0.5 font-medium">
                    {fmtMs(video.durationMs)}
                    {video.sizeBytes > 0 && ` · ${fmtSize(video.sizeBytes)}`}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
});
