import { Music2, Pause, Play, SkipForward } from 'lucide-react';
import { memo, useLayoutEffect } from 'react';
import { next, pause, play } from '../../platform/media/authority/mediaCommandGateway';
import { useMiniMusicViewModel } from './MusicViewModel';
import { markMusicArtworkReady, markNowPlayingInteraction, recordMiniPlayerCommit } from '../../platform/media/musicUiPerf';

interface Props { readonly onOpenNowPlaying: () => void; }

/** Persistent shell leaf. It reads only MusicViewModel and commands only the gateway. */
export const MiniPlayer = memo(function MiniPlayer({ onOpenNowPlaying }: Props) {
  const music = useMiniMusicViewModel();
  useLayoutEffect(() => { recordMiniPlayerCommit(); });
  if (!music.hasListeningContext) return null;
  const canNext = music.capabilities?.supportsQueue === true;
  const toggle = () => { void (music.isAudiblyPlaying ? pause(undefined, 'mini_player') : play(undefined, 'mini_player')); };
  return (
    <section data-music-surface="mini-player" aria-label="Mini oynatıcı"
      className="fixed left-3 right-3 z-[900] flex items-center gap-3 rounded-2xl border px-3 py-2 shadow-xl"
      /* SAHA BUGFIX (2026-09-03) · ÖLÇÜLEN KUSUR: `bottom: 12` DockBar'ın
         gerçek yüksekliğinden habersizdi — ikisi de `position: fixed` ile
         viewport altına çapalandığından MiniPlayer (z-index 900) dock'un
         (z-index 100) TAM ÜSTÜNE biniyor, dokunmayı yutuyordu. `--lp-dock-h`
         DockBar'ın KENDİ ResizeObserver'ının yayınladığı gerçek yükseklik —
         MapHudControls/NavigationHUD/TripSummaryBanner ZATEN aynı değişkenle
         dock'un üstüne çapalanıyor; MiniPlayer bu kanonik desene katılır
         (ikinci bir yerleşim otoritesi İCAT EDİLMEDİ). */
      style={{
        bottom: 'calc(var(--lp-dock-h, 68px) + 12px)',
        minHeight: 64,
        background: 'var(--oem-surface-0, #171a20)',
        borderColor: 'var(--oem-line, rgba(255,255,255,.14))',
      }}>
      <button onClick={() => { markNowPlayingInteraction(); onOpenNowPlaying(); }} aria-label="Şimdi çalanı aç" className="min-w-0 flex flex-1 items-center gap-3 overflow-hidden bg-transparent border-0 text-left">
        <span className="flex h-11 w-11 flex-shrink-0 items-center justify-center overflow-hidden rounded-xl" style={{ background: 'var(--oem-surface-2, #292d35)' }}>
          {music.artworkUrl ? <img src={music.artworkUrl} alt="" onLoad={markMusicArtworkReady} className="h-full w-full object-cover" /> : <Music2 className="h-5 w-5" />}
        </span>
        <span className="min-w-0"><span className="block truncate text-sm font-bold" style={{ color: 'var(--oem-ink, #fff)' }}>{music.title}</span><span className="block truncate text-xs" style={{ color: 'var(--oem-ink-2, #b9bec8)' }}>{music.artist} · {music.sourceLabel}</span></span>
      </button>
      <button onClick={toggle} className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full border-0" aria-label={music.isAudiblyPlaying ? 'Duraklat' : 'Çal'} style={{ background: 'var(--oem-amber, #e0a23c)', color: '#111' }}>
        {music.isAudiblyPlaying ? <Pause className="h-6 w-6" fill="currentColor" /> : <Play className="ml-0.5 h-6 w-6" fill="currentColor" />}
      </button>
      {canNext && <button onClick={() => void next(undefined, 'mini_player')} className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full border" aria-label="Sonraki" style={{ borderColor: 'var(--oem-line, rgba(255,255,255,.14))' }}><SkipForward className="h-5 w-5" /></button>}
    </section>
  );
});
