/**
 * backendAdapters.ts — MÜZİK HUB PAKET A · Backend'lerin SourceCoordinator sözleşmesi.
 *
 * Backend'ler SİLİNMEDİ (geriye uyumluluk): YouTube IFrame, Spotify Connect ve
 * harici Android MediaSession yaşamaya devam ediyor. Değişen şey ŞU: artık hiçbiri
 * kendi başına global durum otoritesi değil. Hepsi
 *   - koordinatör kontrolünde başlar/durur,
 *   - durdurma sonucunu DOĞRULAR,
 *   - gözlenen durumu bildirir,
 *   - timeout ve hata kodu üretir.
 *
 * Yerel müzik ve internet akışı artık HTML5 Audio / ham MediaPlayer ile DEĞİL,
 * native otorite (CarosPlaybackService · ExoPlayer) üzerinden çalar.
 */

import type {
  BackendAdapter,
  PlayRequest,
  StartOutcome,
  StopOutcome,
} from './sourceCoordinator';
import type { SourceClass } from './sourceCapabilities';
import * as native from './nativeAuthorityBridge';

/* ── Ortak yardımcılar ───────────────────────────────────────────────────── */

const OK_STOP: StopOutcome = { accepted: true, verified: true, failureCode: null };

/** Kısa gözlem bekleme — "komut yolladım, oldu saydım" tuzağını kapatır. */
function waitMs(ms: number): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

/* ── 1) Native otorite (LOCAL · STREAM · INTERNET_RADIO) ─────────────────── */

/**
 * Tek gerçek yerel ses otoritesi. Üç kaynak sınıfı da AYNI ExoPlayer'ı kullanır;
 * bu yüzden aralarındaki geçiş doğal olarak tek-audible garantisini korur.
 */
export function createNativeAuthorityAdapter(sourceClass: SourceClass): BackendAdapter {
  return {
    sourceClass,

    isActive(): boolean {
      const s = native.getSnapshot();
      if (!s.authorityAvailable) return false;
      if (s.activeSource !== sourceClass) return false;
      return s.playing === true || (s.queueLength ?? 0) > 0;
    },

    async stop(): Promise<StopOutcome> {
      const res = await native.command('stop');
      const s = await native.refreshSnapshot();
      if (!s.authorityAvailable) {
        // Otorite yoksa ses de yoktur — durdurma DOĞRULANMIŞ sayılır.
        return { accepted: true, verified: true, failureCode: null };
      }
      const verified = s.playing === false && s.renderingVerified === false;
      return {
        accepted: res.accepted,
        verified,
        failureCode: verified ? null : (res.failureCode || 'stop_unverified'),
      };
    },

    async prepare(request: PlayRequest): Promise<{ ready: boolean; failureCode: string | null }> {
      if (request.items.length === 0) return { ready: false, failureCode: 'empty_queue' };
      const res = await native.command('setQueue', {
        source: sourceClass,
        startIndex: request.startIndex,
        positionMs: request.positionMs,
        play: false,   // hazırlık aşaması SES ÇIKARMAZ
        items: request.items.map((i) => ({
          id: i.id, uri: i.uri, title: i.title, artist: i.artist, artworkUri: i.artworkUri ?? '',
        })),
      });
      return { ready: res.accepted, failureCode: res.accepted ? null : (res.failureCode || 'prepare_failed') };
    },

    async start(request: PlayRequest): Promise<StartOutcome> {
      if (!request.autoPlay) {
        const s = native.getSnapshot();
        return {
          accepted: true,
          started: (s.queueLength ?? 0) > 0,
          renderingVerified: false,
          failureCode: null,
        };
      }
      const res = await native.command('play');
      if (!res.accepted) {
        return { accepted: false, started: false, renderingVerified: false, failureCode: res.failureCode || 'play_rejected' };
      }
      // Gözlem: ExoPlayer hazırlanması birkaç yüz ms sürebilir; bounded bekleme.
      let s = await native.refreshSnapshot();
      for (let i = 0; i < 6 && !s.renderingVerified; i++) {
        await waitMs(150);
        s = await native.refreshSnapshot();
      }
      return {
        accepted: true,
        started: s.playing === true || s.renderingVerified,
        renderingVerified: s.renderingVerified === true,
        failureCode: s.playing || s.renderingVerified ? null : (s.lastFailureCode || 'not_observed_playing'),
      };
    },
  };
}

/* ── 2) YouTube IFrame ───────────────────────────────────────────────────── */

/** `piped:` şeması ile taşınan video kimliğini çözer. */
function extractVideoId(uri: string): string {
  const idx = uri.indexOf(':');
  return idx >= 0 ? uri.slice(idx + 1) : uri;
}

export function createYouTubeAdapter(): BackendAdapter {
  return {
    sourceClass: 'YOUTUBE',

    isActive(): boolean {
      try {
        // Lazy require yerine senkron okuma: modül zaten yüklüyse durum okunur.
        const yt = _youtubeModule;
        return yt ? yt.isYouTubeActive() === true : false;
      } catch { return false; }
    },

    async stop(): Promise<StopOutcome> {
      try {
        const yt = await loadYouTube();
        yt.youtubeStop();
        await waitMs(120);
        const media = await loadMediaState();
        const verified = media().activePackage !== yt.YOUTUBE_PKG || media().playing === false;
        return { accepted: true, verified, failureCode: verified ? null : 'stop_unverified' };
      } catch {
        return { accepted: false, verified: false, failureCode: 'stop_threw' };
      }
    },

    async prepare(request: PlayRequest): Promise<{ ready: boolean; failureCode: string | null }> {
      const item = request.items[request.startIndex] ?? request.items[0];
      if (!item) return { ready: false, failureCode: 'empty_queue' };
      if (!extractVideoId(item.uri)) return { ready: false, failureCode: 'invalid_video_id' };
      try {
        const yt = await loadYouTube();
        await yt.ensureYouTubeReady();
        return { ready: true, failureCode: null };
      } catch {
        return { ready: false, failureCode: 'youtube_iframe_unavailable' };
      }
    },

    async start(request: PlayRequest): Promise<StartOutcome> {
      const item = request.items[request.startIndex] ?? request.items[0];
      if (!item) {
        return { accepted: false, started: false, renderingVerified: false, failureCode: 'empty_queue' };
      }
      try {
        const yt = await loadYouTube();
        await yt.playYouTube(extractVideoId(item.uri), item.title, item.artist, item.artworkUri);
        const media = await loadMediaState();
        // IFrame "PLAYING" der ama ses yolunu DOĞRULAYAMAZ → renderingVerified: false.
        const started = media().activePackage === yt.YOUTUBE_PKG;
        return {
          accepted: true,
          started,
          renderingVerified: false,
          failureCode: started ? null : 'not_observed_playing',
        };
      } catch {
        return { accepted: false, started: false, renderingVerified: false, failureCode: 'start_threw' };
      }
    },
  };
}

/* ── 3) Spotify Connect ──────────────────────────────────────────────────── */

const SPOTIFY_PKG = 'com.spotify.music';

export function createSpotifyAdapter(): BackendAdapter {
  return {
    sourceClass: 'SPOTIFY_CONNECT',

    isActive(): boolean {
      try {
        const media = _mediaStateGetter;
        if (!media) return false;
        const st = media();
        return st.activePackage === SPOTIFY_PKG && st.playing === true;
      } catch { return false; }
    },

    async stop(): Promise<StopOutcome> {
      try {
        const { CarLauncher } = await import('../../nativePlugin');
        const { isNative } = await import('../../bridge');
        if (isNative) {
          await CarLauncher.sendMediaAction({ action: 'pause' }).catch(() => undefined);
        }
        await waitMs(250);
        const media = await loadMediaState();
        const st = media();
        // Doğrulanan: BU cihazda Spotify artık ses üretmiyor.
        const verified = st.activePackage !== SPOTIFY_PKG || st.playing === false;
        return { accepted: true, verified, failureCode: verified ? null : 'stop_unverified' };
      } catch {
        return { accepted: false, verified: false, failureCode: 'stop_threw' };
      }
    },

    async prepare(request: PlayRequest): Promise<{ ready: boolean; failureCode: string | null }> {
      const item = request.items[request.startIndex] ?? request.items[0];
      if (!item) return { ready: false, failureCode: 'empty_queue' };
      try {
        const { isSpotifyConnected } = await import('../../spotify/spotifyAuth');
        return isSpotifyConnected()
          ? { ready: true, failureCode: null }
          : { ready: false, failureCode: 'spotify_not_connected' };
      } catch {
        return { ready: false, failureCode: 'spotify_unavailable' };
      }
    },

    async start(request: PlayRequest): Promise<StartOutcome> {
      const item = request.items[request.startIndex] ?? request.items[0];
      if (!item) {
        return { accepted: false, started: false, renderingVerified: false, failureCode: 'empty_queue' };
      }
      try {
        const { playSpotifyTrack } = await import('../../spotify/spotifyService');
        await playSpotifyTrack({
          id: item.id,
          uri: item.uri,
          title: item.title,
          artist: item.artist,
          albumArt: item.artworkUri,
          durationMs: 0,
        });
        // Uzak cihaz kabul etti; ses BİZDE üretilmiyor olabilir → doğrulama YOK.
        return { accepted: true, started: true, renderingVerified: false, failureCode: null };
      } catch {
        return { accepted: false, started: false, renderingVerified: false, failureCode: 'start_threw' };
      }
    },
  };
}

/* ── 4) Harici Android MediaSession (Bluetooth dahil) ────────────────────── */

export function createExternalSessionAdapter(sourceClass: SourceClass): BackendAdapter {
  return {
    sourceClass,

    isActive(): boolean {
      try {
        const media = _mediaStateGetter;
        if (!media) return false;
        const st = media();
        if (!st.hasSession || !st.playing) return false;
        // Uygulama-içi sözde paketler harici sayılmaz.
        return !st.activePackage.startsWith('com.cockpitos.pro') && st.activePackage !== SPOTIFY_PKG;
      } catch { return false; }
    },

    async stop(): Promise<StopOutcome> {
      try {
        const { CarLauncher } = await import('../../nativePlugin');
        const { isNative } = await import('../../bridge');
        if (!isNative) return OK_STOP;   // web'de harici oturum yok
        await CarLauncher.sendMediaAction({ action: 'pause' }).catch(() => undefined);
        await waitMs(250);
        const media = await loadMediaState();
        const st = media();
        const verified = st.playing === false;
        return { accepted: true, verified, failureCode: verified ? null : 'stop_unverified' };
      } catch {
        return { accepted: false, verified: false, failureCode: 'stop_threw' };
      }
    },

    async prepare(): Promise<{ ready: boolean; failureCode: string | null }> {
      // Harici uygulamanın kuyruğunu BİZ kuramayız — dürüst red.
      return { ready: false, failureCode: 'unsupported_capability' };
    },

    async start(): Promise<StartOutcome> {
      return {
        accepted: false, started: false, renderingVerified: false,
        failureCode: 'unsupported_capability',
      };
    },
  };
}

/* ── Lazy modül erişimi (döngüsel import kırma) ──────────────────────────── */

type YouTubeModule = typeof import('../../youtubeService');
type MediaStateGetter = () => import('../../mediaService').MediaState;

let _youtubeModule: YouTubeModule | null = null;
let _mediaStateGetter: MediaStateGetter | null = null;

async function loadYouTube(): Promise<YouTubeModule> {
  if (!_youtubeModule) _youtubeModule = await import('../../youtubeService');
  return _youtubeModule;
}

async function loadMediaState(): Promise<MediaStateGetter> {
  if (!_mediaStateGetter) {
    const m = await import('../../mediaService');
    _mediaStateGetter = m.getMediaState;
  }
  return _mediaStateGetter;
}

/** Test kancası — modül önbelleklerini enjekte/temizle. */
export function __setAdapterModulesForTest(mods: {
  youtube?: YouTubeModule | null;
  mediaState?: MediaStateGetter | null;
}): void {
  if (mods.youtube !== undefined) _youtubeModule = mods.youtube;
  if (mods.mediaState !== undefined) _mediaStateGetter = mods.mediaState;
}
