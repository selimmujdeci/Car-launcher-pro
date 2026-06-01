/**
 * Stream Music Service — kullanıcının eklediği internet ses akışlarını (radyo /
 * doğrudan ses URL'si) UYGULAMA İÇİNDE HTML5 Audio ile çalar.
 *
 * Harici uygulamaya geçilmez; ses doğrudan bu uygulamada decode edilir.
 * Now-playing durumu mediaService üzerinden güncellenir → çalma ekranı kartı,
 * progress bar ve oynat/duraklat butonu bu kaynakla senkron çalışır.
 *
 * activePackage = STREAM_PKG ile işaretlenir; mediaService.togglePlayPause ve
 * MediaScreen kontrolleri bu pakete göre stream'e yönlenir.
 *
 * NOT: Web + native WebView'da çalışır (yerel müzik servisinin aksine).
 */
import { updateMediaState, getMediaState } from './mediaService';
import { logError } from './crashLogger';

/** Stream kaynağı için sözde paket adı — yerel/harici kaynaklardan ayırır. */
export const STREAM_PKG = 'com.cockpitos.pro.stream';

let _audio: HTMLAudioElement | null = null;
let _onEnded: (() => void) | null = null;
// Tek-atış bitiş bayrağı: 'ended' ile timeupdate-yedeğinin çift ilerletmesini önler.
// Her yeni kaynak yüklenince ('loadstart') sıfırlanır.
let _endedFired = false;

/** Parça doğal olarak bittiğinde çağrılacak kanca (kuyruk ilerletme için katman bağlar). */
export function setStreamOnEnded(cb: (() => void) | null): void {
  _onEnded = cb;
}

function _isStreamSession(): boolean {
  return getMediaState().activePackage === STREAM_PKG;
}

function _ensureAudio(): HTMLAudioElement {
  if (_audio) return _audio;
  const a = new Audio();
  a.preload = 'none';

  // Yeni kaynak yüklenmeye başlayınca bitiş bayrağını sıfırla (sonraki parça için).
  a.addEventListener('loadstart', () => { _endedFired = false; });
  a.addEventListener('timeupdate', () => {
    if (!_isStreamSession()) return;
    const dur = a.duration;
    updateMediaState({
      track: {
        ...getMediaState().track,
        positionSec: a.currentTime || 0,
        durationSec: Number.isFinite(dur) ? dur : 0,
      },
    });
    // Bazı akışlar (Audius CDN: Content-Length yok) 'ended' tetiklemez → süre
    // biliniyorsa bitişe ~0.4 sn kala kuyruğu yedek olarak ilerlet (fail-soft).
    if (Number.isFinite(dur) && dur > 1 && a.currentTime >= dur - 0.4 && !_endedFired) {
      _endedFired = true;
      updateMediaState({ playing: false });
      _onEnded?.();
    }
  });
  a.addEventListener('play',  () => { if (_isStreamSession()) updateMediaState({ playing: true }); });
  a.addEventListener('pause', () => { if (_isStreamSession()) updateMediaState({ playing: false }); });
  a.addEventListener('ended', () => {
    if (!_isStreamSession() || _endedFired) return;
    _endedFired = true;
    updateMediaState({ playing: false });
    _onEnded?.();
  });
  a.addEventListener('error', () => {
    if (!_isStreamSession()) return;
    logError('Stream:Audio', new Error('stream playback error'));
    updateMediaState({ playing: false });
  });

  _audio = a;
  return a;
}

/**
 * Bir internet akışını uygulama içinde çalmaya başlar.
 * @param name   Kaynak adı (now-playing rozeti + başlık)
 * @param url    Doğrudan ses akışı / radyo URL'si
 * @param artist Alt başlık (varsayılan "Canlı Yayın")
 */
export async function playStream(name: string, url: string, artist = 'Canlı Yayın'): Promise<void> {
  const a = _ensureAudio();

  // Çakışma önleme: harici MediaSession çalıyorsa duraklat
  try {
    const st = getMediaState();
    if (st.playing && st.activePackage && st.activePackage !== STREAM_PKG && st.activePackage !== 'com.cockpitos.pro') {
      const { CarLauncher } = await import('./nativePlugin');
      CarLauncher.sendMediaAction({ action: 'pause' }).catch(() => {});
    }
  } catch { /* ignore */ }

  // Yerel müzik çalıyorsa durdur (tek aktif kaynak)
  try {
    const { isLocalMusicActive, stopLocalMusic } = await import('./localMusicService');
    if (isLocalMusicActive()) stopLocalMusic();
  } catch { /* ignore */ }

  updateMediaState({
    playing:       false,
    hasSession:    true,
    source:        'unknown',
    activePackage: STREAM_PKG,
    activeAppName: name,
    track: {
      title:       name,
      artist,
      albumArt:    undefined,
      durationSec: 0,
      positionSec: 0,
    },
  });

  try {
    a.src = url;
    a.load();
    await a.play();
    updateMediaState({ playing: true });
  } catch (e) {
    logError('Stream:Play', e);
    updateMediaState({ playing: false });
  }
}

export function streamTogglePlayPause(): void {
  const a = _audio;
  if (!a) return;
  if (a.paused) a.play().catch((e) => logError('Stream:Resume', e));
  else a.pause();
}

export function streamSeek(positionSec: number): void {
  const a = _audio;
  if (!a) return;
  try { a.currentTime = positionSec; } catch { /* ignore */ }
}

export function streamStop(): void {
  const a = _audio;
  if (a) {
    a.pause();
    a.removeAttribute('src');
    a.load();
  }
  if (_isStreamSession()) {
    updateMediaState({ playing: false, hasSession: false });
  }
}

export function isStreamActive(): boolean {
  return _isStreamSession();
}
