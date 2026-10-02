/**
 * VideoPlayerOverlay — CarOS video oynatıcı arayüzü.
 *
 * Video native donanım çözücüyle CarOS arayüzünün ARKASINDA çizilir (bkz.
 * CarLauncherPlugin.playVideoNative). Bu bileşen açıkken kök arka planlar
 * şeffaf olur ve uygulamanın geri kalanı gizlenir (html.caros-video-native);
 * kontroller videonun ÜSTÜNDE CarOS tasarımıyla çizilir.
 */
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, Loader2, Pause, Play, RotateCcw, RotateCw } from 'lucide-react';
import {
  useLocalVideo,
  closeVideo,
  pauseVideo,
  resumeVideo,
  seekVideo,
} from '../../platform/localVideoService';
import { fmtTime } from '../../platform/mediaService';

const HIDE_AFTER_MS = 4000;
const SKIP_MS = 10_000;
const ACCENT = 'var(--oem-amber, #f5a524)';

function fmtMs(ms: number | null): string {
  return ms == null ? '--:--' : fmtTime(ms / 1000);
}

export const VideoPlayerOverlay = memo(function VideoPlayerOverlay() {
  const { activeUri, activeTitle, ready, playing, positionMs, durationMs } = useLocalVideo();
  const [controls, setControls] = useState(true);
  const [dragMs, setDragMs] = useState<number | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Video açıkken kök şeffaf + uygulama gizli → arkadaki video yüzeyi görünür.
  useEffect(() => {
    if (!activeUri) return;
    const root = document.documentElement;
    root.classList.add('caros-video-native');
    return () => root.classList.remove('caros-video-native');
  }, [activeUri]);

  const armHide = useCallback(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setControls(false), HIDE_AFTER_MS);
  }, []);

  // Oynarken kontroller kendiliğinden gizlenir; duraklatılınca/hazırlanırken açık kalır.
  useEffect(() => {
    if (ready && playing && controls && dragMs == null) armHide();
    else if (hideTimer.current) clearTimeout(hideTimer.current);
    return () => { if (hideTimer.current) clearTimeout(hideTimer.current); };
  }, [ready, playing, controls, dragMs, armHide]);

  const poke = useCallback(() => { setControls(true); }, []);

  if (!activeUri) return null;

  const shownPos = dragMs ?? positionMs;
  const canSeek = ready && durationMs != null && durationMs > 0;

  const togglePlay = (e: React.MouseEvent) => {
    e.stopPropagation();
    poke();
    void (playing ? pauseVideo() : resumeVideo());
  };
  const skip = (delta: number) => (e: React.MouseEvent) => {
    e.stopPropagation();
    poke();
    if (canSeek && positionMs != null) void seekVideo(positionMs + delta);
  };

  return createPortal(
    <div
      data-video-overlay
      className="fixed inset-0 select-none"
      style={{ zIndex: 2147483000, visibility: 'visible', background: 'transparent' }}
      onClick={() => setControls((c) => !c)}
    >
      {/* Hazırlanıyor — ilk kare gelene dek */}
      {!ready && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4" style={{ background: 'rgba(0,0,0,0.55)' }}>
          <Loader2 className="w-12 h-12 animate-spin" style={{ color: ACCENT }} />
          <div className="text-white/80 text-sm font-bold tracking-widest uppercase">Video hazırlanıyor</div>
        </div>
      )}

      <div
        className="absolute inset-0 flex flex-col justify-between transition-opacity duration-300"
        style={{ opacity: controls || !ready ? 1 : 0, pointerEvents: controls || !ready ? 'auto' : 'none' }}
      >
        {/* Üst çubuk */}
        <div
          className="flex items-center gap-3 px-4 pt-4 pb-10"
          style={{ background: 'linear-gradient(to bottom, rgba(0,0,0,0.7), transparent)' }}
        >
          <button
            onClick={(e) => { e.stopPropagation(); void closeVideo(); }}
            className="flex items-center gap-1.5 pl-2 pr-4 h-12 rounded-2xl text-white font-black active:scale-95 transition-all"
            style={{ background: 'rgba(255,255,255,0.12)', backdropFilter: 'blur(8px)' }}
            aria-label="Videoyu kapat"
          >
            <ChevronLeft className="w-6 h-6" /> Geri
          </button>
          <div className="flex-1 min-w-0 text-white text-lg font-black truncate">{activeTitle ?? 'Video'}</div>
        </div>

        {/* Orta kontroller */}
        {ready && (
          <div className="flex items-center justify-center gap-10">
            <button onClick={skip(-SKIP_MS)} disabled={!canSeek} aria-label="10 saniye geri"
              className="w-16 h-16 rounded-full flex items-center justify-center text-white active:scale-90 transition-all disabled:opacity-30"
              style={{ background: 'rgba(0,0,0,0.45)' }}>
              <RotateCcw className="w-7 h-7" />
            </button>
            <button onClick={togglePlay} aria-label={playing ? 'Duraklat' : 'Oynat'}
              className="w-24 h-24 rounded-full flex items-center justify-center active:scale-90 transition-all"
              style={{ background: ACCENT, color: '#111', boxShadow: '0 10px 30px rgba(0,0,0,0.5)' }}>
              {playing ? <Pause className="w-11 h-11" style={{ fill: 'currentColor' }} /> : <Play className="w-11 h-11 ml-1" style={{ fill: 'currentColor' }} />}
            </button>
            <button onClick={skip(SKIP_MS)} disabled={!canSeek} aria-label="10 saniye ileri"
              className="w-16 h-16 rounded-full flex items-center justify-center text-white active:scale-90 transition-all disabled:opacity-30"
              style={{ background: 'rgba(0,0,0,0.45)' }}>
              <RotateCw className="w-7 h-7" />
            </button>
          </div>
        )}

        {/* Alt çubuk — sarma */}
        <div
          className="px-5 pt-10 pb-5"
          style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.75), transparent)' }}
          onClick={(e) => e.stopPropagation()}
        >
          <input
            type="range"
            min={0}
            max={canSeek ? durationMs! : 1}
            step={1000}
            value={canSeek && shownPos != null ? shownPos : 0}
            disabled={!canSeek}
            onChange={(e) => { poke(); setDragMs(Number(e.target.value)); }}
            onPointerUp={() => { if (dragMs != null) { void seekVideo(dragMs); setDragMs(null); } }}
            className="w-full h-2 cursor-pointer disabled:opacity-40"
            style={{ accentColor: ACCENT }}
            aria-label="Video konumu"
          />
          <div className="flex justify-between mt-2 text-white/80 text-sm font-bold tabular-nums">
            <span>{fmtMs(shownPos)}</span>
            <span>{fmtMs(durationMs)}</span>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
});
