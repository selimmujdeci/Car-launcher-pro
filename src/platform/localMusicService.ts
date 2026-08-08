/**
 * Local Music Service — cihaz depolamasındaki müzikleri MediaPlayer ile çalar.
 *
 * - getMusicTracks()  → native MediaStore sorgusu
 * - playAtIndex()     → parça çal, mediaService state'ini güncelle
 * - localPause/Resume/Next/Prev/Seek
 * - MediaHub'a entegrasyon: yerel çalarken updateMediaState() → kart güncellenir
 */
import { useSyncExternalStore } from 'react';
import { CarLauncher } from './nativePlugin';
import type { LocalMusicTrack } from './nativePlugin';
import { isNative } from './bridge';
import { updateMediaState, getMediaState } from './mediaService';
/* Yalnız TİP (derlemede silinir) — mevcut `mediaService` kenarına ek yük YOK. */
import type { MediaCommandResult } from './mediaService';
import { logError } from './crashLogger';

/**
 * MediaStore content URI'sinden base64 kapak resmi yükler.
 * `convertFileSrc` content provider URI'lerini düzgün çevirmediği için
 * native taraftan base64 data URI alıyoruz.
 */
async function fetchAlbumArtDataUri(uri: string | undefined): Promise<string | undefined> {
  if (!uri || !isNative) return undefined;
  try {
    const { dataUri } = await CarLauncher.getMediaArtDataUri({ uri });
    return dataUri || undefined;
  } catch {
    return undefined;
  }
}

/* ── State ───────────────────────────────────────────────── */

export interface LocalMusicState {
  tracks:       LocalMusicTrack[];
  currentIndex: number;
  playing:      boolean;
  positionMs:   number;
  durationMs:   number;
  loading:      boolean;
  error:        string | null;
  initialized:  boolean;
}

let _state: LocalMusicState = {
  tracks:       [],
  currentIndex: -1,
  playing:      false,
  positionMs:   0,
  durationMs:   0,
  loading:      false,
  error:        null,
  initialized:  false,
};

const _subs = new Set<() => void>();
function _notify() { _subs.forEach((fn) => fn()); }
function _set(partial: Partial<LocalMusicState>) {
  _state = { ..._state, ...partial };
  _notify();
}

export function useLocalMusic(): LocalMusicState {
  return useSyncExternalStore(
    (cb) => { _subs.add(cb); return () => _subs.delete(cb); },
    () => _state,
    () => _state,
  );
}

export function getLocalMusicState(): LocalMusicState { return _state; }

/* ── Event listener handles ─────────────────────────────── */

type RemoveFn = () => void;
let _progressStop: RemoveFn | null = null;
let _startedStop:  RemoveFn | null = null;
let _completedStop:RemoveFn | null = null;
let _errorStop:    RemoveFn | null = null;

/* Parça doğal bitince kuyruğu üst katmanın (carosMediaLayer) ilerletmesi için callback.
 * Kayıtlı değilse kendi içinde sıradaki parçaya geçer (geriye dönük güvenli). */
let _onEnded: (() => void) | null = null;
export function setLocalOnEnded(cb: (() => void) | null): void { _onEnded = cb; }

/* ── Init / destroy ─────────────────────────────────────── */

export async function initLocalMusic(): Promise<void> {
  if (!isNative || _state.initialized) return;
  _set({ initialized: true });

  try {
    const h1 = await CarLauncher.addListener('localMusicProgress', (data) => {
      _set({ positionMs: data.positionMs, durationMs: data.durationMs, playing: data.playing });
      // mediaService state güncelle — MediaHub progress bar senkronu
      const cur = _state.currentIndex >= 0 ? _state.tracks[_state.currentIndex] : null;
      if (cur) {
        updateMediaState({
          playing: data.playing,
          track: {
            ...getMediaState().track,
            positionSec: data.positionMs / 1000,
            durationSec: data.durationMs / 1000,
          },
        });
      }
    });
    _progressStop = () => h1.remove();

    const h2 = await CarLauncher.addListener('localMusicStarted', (data) => {
      _set({ playing: true, durationMs: data.durationMs });
    });
    _startedStop = () => h2.remove();

    const h3 = await CarLauncher.addListener('localMusicCompleted', () => {
      _set({ playing: false, positionMs: 0 });
      updateMediaState({ playing: false });
      // Kuyruk yönetimi caros katmanındaysa oraya devret (tek tip + persist); yoksa kendi içinde ilerle.
      if (_onEnded) { _onEnded(); return; }
      if (_state.currentIndex < _state.tracks.length - 1) {
        void playAtIndex(_state.currentIndex + 1);
      }
    });
    _completedStop = () => h3.remove();

    const h4 = await CarLauncher.addListener('localMusicError', (data) => {
      logError('LocalMusic:Error', new Error(data.error));
      _set({ playing: false, error: data.error });
    });
    _errorStop = () => h4.remove();
  } catch (e) {
    logError('LocalMusic:Init', e);
  }
}

export function destroyLocalMusic(): void {
  _progressStop?.();
  _startedStop?.();
  _completedStop?.();
  _errorStop?.();
  _progressStop = _startedStop = _completedStop = _errorStop = null;
  _set({ initialized: false });
  if (isNative) CarLauncher.stopLocalTrack().catch(() => {});
}

/* ── Track listesi ─────────────────────────────────────── */

export async function loadMusicTracks(): Promise<void> {
  if (!isNative) return;
  _set({ loading: true, error: null });
  try {
    const { tracks } = await CarLauncher.getMusicTracks();
    _set({ tracks, loading: false });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Müzik listesi alınamadı';
    _set({ loading: false, error: msg });
    logError('LocalMusic:Load', e);
  }
}

/* ── Playback controls ─────────────────────────────────── */

export async function playAtIndex(index: number): Promise<void> {
  if (!isNative || index < 0 || index >= _state.tracks.length) return;
  const track = _state.tracks[index];
  _set({ currentIndex: index, playing: false, positionMs: 0 });

  // Çakışma önleme: başka native kaynak çalıyorsa MediaSession'ı durdur
  const { playing: nativePlaying, activePackage: nativePkg } = getMediaState();
  if (nativePlaying && nativePkg && nativePkg !== 'com.cockpitos.pro') {
    CarLauncher.sendMediaAction({ action: 'pause' }).catch(() => {});
  }

  // mediaService state'i hemen güncelle → MediaHub kart bilgisi
  // albumArt boş başlar — async fetch sonra dolduracak
  updateMediaState({
    playing:       false,
    hasSession:    true,
    source:        'local',
    activePackage: 'com.cockpitos.pro',
    activeAppName: 'Cihaz Müziği',
    track: {
      title:       track.title   || track.uri.split('/').pop() || 'Bilinmeyen Parça',
      artist:      track.artist  || track.album || 'Bilinmeyen Sanatçı',
      albumArt:    undefined,
      durationSec: track.durationMs / 1000,
      positionSec: 0,
    },
  });

  // Kapak resmini arka planda yükle ve hazır olunca state'i tazele
  void (async () => {
    const dataUri = await fetchAlbumArtDataUri(track.albumArtUri);
    if (dataUri && _state.currentIndex === index) {
      // Hâlâ aynı parça çalıyor — state'i güncelle
      updateMediaState({
        track: { ...getMediaState().track, albumArt: dataUri },
      });
    }
  })();

  /* ── MÜZİK HUB PAKET A: çalma otoritesi CarosPlaybackService'tir ─────────
   * Ham MediaPlayer yolu audio focus istemiyor, focus kaybını dinlemiyor ve
   * kulaklık çıkarılınca susmuyordu. Artık kuyruk native otoriteye verilir;
   * odak · ducking · bildirim · medya tuşları oradan yönetilir.
   * Otorite yoksa (eski cihaz / servis başlamadı) eski yol KORUNUR. */
  const viaAuthority = await _playViaAuthority(index);
  if (viaAuthority) return;

  try {
    await CarLauncher.playLocalTrack({ uri: track.uri });
    _set({ playing: true });
    updateMediaState({ playing: true });
  } catch (e) {
    logError('LocalMusic:Play', e);
    _set({ error: e instanceof Error ? e.message : 'Çalma hatası' });
  }
}

/** Kuyruğu native otoriteye verir. @returns otorite işi üstlendiyse true. */
async function _playViaAuthority(index: number): Promise<boolean> {
  try {
    const [{ playSource }, { noteQueue }] = await Promise.all([
      import('./media/authority/mediaCommandGateway'),
      import('./media/authority/mediaAuthorityRuntime'),
    ]);

    // Kütüphane binlerce parça olabilir; aktif parça çevresinde SINIRLI pencere
    // gönderilir (native kuyruk sınırı + bellek bütçesi).
    const WINDOW = 120;
    const start = Math.max(0, Math.min(index - Math.floor(WINDOW / 2), Math.max(0, _state.tracks.length - WINDOW)));
    const slice = _state.tracks.slice(start, start + WINDOW);
    const items = slice.map((t) => ({
      id: t.id,
      uri: t.uri,
      title: t.title || 'Bilinmeyen Parça',
      artist: t.artist || 'Bilinmeyen Sanatçı',
      artworkUri: t.albumArtUri,
    }));
    if (items.length === 0) return false;

    noteQueue('LOCAL', items, index - start);
    const truth = await playSource({
      source: 'LOCAL',
      items,
      startIndex: index - start,
      autoPlay: true,
    });

    if (truth.outcome === 'VERIFIED' || truth.outcome === 'ACCEPTED_UNVERIFIED') {
      _set({ playing: truth.observedState === 'PLAYING' });
      return true;
    }
    // Otorite yoksa eski yola düşülür; başka hata varsa DÜRÜSTÇE bildirilir.
    if (truth.failureCode && truth.failureCode !== 'authority_unavailable') {
      _set({ error: `Çalma başarısız: ${truth.failureCode}` });
      return true;   // eski yola düşüp ikinci bir ses kaynağı açmayız
    }
    return false;
  } catch {
    return false;   // fail-soft: otorite kurulamadıysa eski yol devrede
  }
}

export function localTogglePlayPause(): void {
  if (!isNative) return;
  if (_state.playing) {
    CarLauncher.pauseLocalTrack().catch((e) => logError('LocalMusic:Pause', e));
    _set({ playing: false });
    updateMediaState({ playing: false });
  } else {
    CarLauncher.resumeLocalTrack().catch((e) => logError('LocalMusic:Resume', e));
    _set({ playing: true });
    updateMediaState({ playing: true });
  }
}

/**
 * Sonraki parça.
 *
 * SONUÇ DÖNDÜRÜR (saha 2026-08-08): eskiden `void` idi ve kuyruk boşken ya da
 * SON parçadayken SESSİZCE hiçbir şey yapmıyordu — çağıran bunu ayırt edemediği
 * için sesli asistan yine "sonraki parça" diyordu (sahte onay).
 * Davranış DEĞİŞMEDİ (başa sarma EKLENMEDİ); yalnız "yapılmadı" artık söylenir.
 */
export function localNext(): MediaCommandResult {
  if (_state.tracks.length === 0) {
    return { dispatched: false, verified: false, failureCode: 'empty_queue' };
  }
  if (_state.currentIndex >= _state.tracks.length - 1) {
    return { dispatched: false, verified: false, failureCode: 'end_of_queue' };
  }
  void playAtIndex(_state.currentIndex + 1);
  return { dispatched: true, verified: true, failureCode: null };
}

/** Önceki parça — `localNext` ile AYNI sözleşme. */
export function localPrev(): MediaCommandResult {
  // 3 saniye geçtiyse aynı parçanın başına dön
  if (_state.positionMs > 3000) {
    CarLauncher.seekLocalTrack({ positionMs: 0 }).catch(() => {});
    _set({ positionMs: 0 });
    updateMediaState({ track: { ...getMediaState().track, positionSec: 0 } });
    return { dispatched: true, verified: true, failureCode: null };
  }
  if (_state.tracks.length === 0) {
    return { dispatched: false, verified: false, failureCode: 'empty_queue' };
  }
  if (_state.currentIndex <= 0) {
    return { dispatched: false, verified: false, failureCode: 'start_of_queue' };
  }
  void playAtIndex(_state.currentIndex - 1);
  return { dispatched: true, verified: true, failureCode: null };
}

export function localSeek(positionMs: number): void {
  if (!isNative) return;
  CarLauncher.seekLocalTrack({ positionMs }).catch((e) => logError('LocalMusic:Seek', e));
  _set({ positionMs });
  updateMediaState({ track: { ...getMediaState().track, positionSec: positionMs / 1000 } });
}

export function stopLocalMusic(): void {
  if (!isNative) return;
  CarLauncher.stopLocalTrack().catch(() => {});
  _set({ playing: false, currentIndex: -1, positionMs: 0 });
  updateMediaState({ playing: false, hasSession: false });
}

/** Şu an yerel müzik çalıyor mu? */
export function isLocalMusicActive(): boolean {
  return _state.playing || (_state.currentIndex >= 0 && getMediaState().activePackage === 'com.cockpitos.pro');
}
