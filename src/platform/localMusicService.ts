/**
 * Local Music Service — cihaz kütüphanesi / metadata adaptörü.
 *
 * - loadMusicTracks() → mediaStoreRefreshExecutor (tek MediaStore tarayıcısı)
 * Çalma varsayılan olarak `mediaCommandGateway → CarosPlaybackService` üzerinden
 * yapılır. Eski MediaPlayer yalnız açık rollback bayrağıyla yaşar; bu modül
 * canonical playback truth üretmez.
 */
import { useSyncExternalStore } from 'react';
import { CarLauncher } from './nativePlugin';
import type { LocalMusicTrack } from './nativePlugin';
import { isNative } from './bridge';
import type { MediaCommandResult } from './mediaService';
import { logError } from './crashLogger';
import { getMusicLibrarySnapshot, type MusicTrack } from './media/musicIndex';
import { parseMediaTrackId } from './media/mediaIdentity';
import { refreshMusicLibrary } from './media/mediaStoreRefreshExecutor';

/** Acil rollback dışında legacy MediaPlayer ASLA açılmaz. */
export function isLegacyLocalPlayerEnabled(): boolean {
  return import.meta.env.VITE_USE_LEGACY_LOCAL_PLAYER === 'true';
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

/* ── Init / destroy ─────────────────────────────────────── */

export async function initLocalMusic(): Promise<void> {
  if (!isNative || _state.initialized) return;
  _set({ initialized: true });

  // Legacy event'ler canonical truth DEĞİLDİR. Varsayılan yolda hiç
  // dinlenmezler; rollback açıkken yalnız compatibility telemetry kalırlar.
  if (!isLegacyLocalPlayerEnabled()) return;

  try {
    const h1 = await CarLauncher.addListener('localMusicProgress', (data) => {
      _set({ positionMs: data.positionMs, durationMs: data.durationMs, playing: data.playing });
    });
    _progressStop = () => h1.remove();

    const h2 = await CarLauncher.addListener('localMusicStarted', (data) => {
      _set({ playing: true, durationMs: data.durationMs });
    });
    _startedStop = () => h2.remove();

    const h3 = await CarLauncher.addListener('localMusicCompleted', () => {
      _set({ playing: false, positionMs: 0 });
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
  if (isNative && isLegacyLocalPlayerEnabled()) CarLauncher.stopLocalTrack().catch(() => {});
}

/* ── Track listesi ─────────────────────────────────────── */

/**
 * MusicIndex projeksiyonunu legacy kuyruk şekline indirger.
 *
 * `id` KASITEN ham MediaStore kimliğidir: native kuyruk ve kurtarma kayıtları bu
 * değeri taşır; çok-volume kimliği (`media:<volume>:<id>`) kütüphane truth'unda
 * kalır, çalma kuyruğunun kimliğini geriye dönük bozmaz.
 */
function _toLegacyTrack(t: MusicTrack): LocalMusicTrack {
  return {
    id:          parseMediaTrackId(t.id)?.mediaStoreId ?? t.id,
    uri:         t.contentUri,
    title:       t.title ?? '',
    artist:      t.artist ?? '',
    album:       t.album ?? '',
    albumArtUri: t.artworkIdentity ?? '',
    durationMs:  t.durationMs ?? 0,
    albumArtist: t.albumArtist,
    mimeType:    t.mimeType,
    relativePath: t.folder,
    generationModified: t.generationModified,
    volumeName:  t.volumeName,
    storageKind: t.storageKind,
  };
}

/**
 * Kütüphane tazeleme. Tarama kararı ve MediaStore sorgusu ARTIK burada değil:
 * tek yürütücü `mediaStoreRefreshExecutor`'dır (UNCHANGED turunda sıfır sorgu).
 * Bu servis yalnız kuyruk projeksiyonunu ve UI durum bayraklarını taşır.
 */
export async function loadMusicTracks(): Promise<void> {
  if (!isNative) return;
  _set({ loading: true, error: null });
  try {
    const outcome = await refreshMusicLibrary();
    const snapshot = getMusicLibrarySnapshot();
    const tracks = snapshot.tracks.filter((t) => t.availability === 'AVAILABLE').map(_toLegacyTrack);
    _set({
      tracks,
      loading: false,
      error: outcome.status === 'FAILED' ? `Müzik listesi alınamadı: ${outcome.failureCode ?? outcome.reason}` : null,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Müzik listesi alınamadı';
    _set({ loading: false, error: msg });
    logError('LocalMusic:Load', e);
  }
}

/* ── Playback controls ─────────────────────────────────── */

export async function playLocalSelection(index: number): Promise<void> {
  if (!isNative || index < 0 || index >= _state.tracks.length) return;
  const track = _state.tracks[index];
  _set({ currentIndex: index, playing: false, positionMs: 0 });

  /* ── MÜZİK HUB PAKET A: çalma otoritesi CarosPlaybackService'tir ─────────
   * Ham MediaPlayer yolu audio focus istemiyor, focus kaybını dinlemiyor ve
   * kulaklık çıkarılınca susmuyordu. Artık kuyruk native otoriteye verilir;
   * odak · ducking · bildirim · medya tuşları oradan yönetilir.
   * Otorite hatası fail-closed kalır; eski yol yalnız rollback flag'idir. */
  if (!isLegacyLocalPlayerEnabled()) {
    await _playViaAuthority(index);
    return;
  }

  try {
    await CarLauncher.playLocalTrack({ uri: track.uri });
    _set({ playing: true });
  } catch (e) {
    logError('LocalMusic:Play', e);
    _set({ error: e instanceof Error ? e.message : 'Çalma hatası' });
  }
}

/** Kuyruğu canonical native otoriteye verir. Hata legacy fallback AÇMAZ. */
async function _playViaAuthority(index: number): Promise<void> {
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
    if (items.length === 0) return;

    noteQueue('LOCAL', items, index - start);
    const truth = await playSource({
      source: 'LOCAL',
      items,
      startIndex: index - start,
      autoPlay: true,
    });

    if (truth.outcome === 'VERIFIED' || truth.outcome === 'ACCEPTED_UNVERIFIED') {
      _set({ playing: truth.observedState === 'PLAYING' });
      return;
    }
    // Otorite hatası fail-closed kalır; ikinci audible backend açılmaz.
    if (truth.failureCode && truth.failureCode !== 'authority_unavailable') {
      _set({ error: `Çalma başarısız: ${truth.failureCode}` });
      return;
    }
    _set({ error: `Çalma başarısız: ${truth.failureCode ?? truth.outcome}` });
  } catch (e) {
    logError('LocalMusic:Authority', e);
    _set({ error: 'Playback authority kullanılamıyor' });
  }
}

export function localTogglePlayPause(): void {
  if (!isNative) return;
  if (!isLegacyLocalPlayerEnabled()) {
    void import('./mediaService').then(({ togglePlayPause }) => togglePlayPause());
    return;
  }
  if (_state.playing) {
    CarLauncher.pauseLocalTrack().catch((e) => logError('LocalMusic:Pause', e));
    _set({ playing: false });
  } else {
    CarLauncher.resumeLocalTrack().catch((e) => logError('LocalMusic:Resume', e));
    _set({ playing: true });
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
  if (!isLegacyLocalPlayerEnabled()) {
    void import('./media/authority/mediaCommandGateway').then((gw) => gw.next());
    return { dispatched: true, verified: false, failureCode: 'canonical_transport_pending' };
  }
  if (_state.tracks.length === 0) {
    return { dispatched: false, verified: false, failureCode: 'empty_queue' };
  }
  if (_state.currentIndex >= _state.tracks.length - 1) {
    return { dispatched: false, verified: false, failureCode: 'end_of_queue' };
  }
  void playLocalSelection(_state.currentIndex + 1);
  return { dispatched: true, verified: false, failureCode: 'legacy_transport_pending' };
}

/** Önceki parça — `localNext` ile AYNI sözleşme. */
export function localPrev(): MediaCommandResult {
  if (!isLegacyLocalPlayerEnabled()) {
    void import('./media/authority/mediaCommandGateway').then((gw) => gw.previous());
    return { dispatched: true, verified: false, failureCode: 'canonical_transport_pending' };
  }
  // 3 saniye geçtiyse aynı parçanın başına dön
  if (_state.positionMs > 3000) {
    CarLauncher.seekLocalTrack({ positionMs: 0 }).catch(() => {});
    _set({ positionMs: 0 });
    return { dispatched: true, verified: false, failureCode: 'legacy_transport_pending' };
  }
  if (_state.tracks.length === 0) {
    return { dispatched: false, verified: false, failureCode: 'empty_queue' };
  }
  if (_state.currentIndex <= 0) {
    return { dispatched: false, verified: false, failureCode: 'start_of_queue' };
  }
  void playLocalSelection(_state.currentIndex - 1);
  return { dispatched: true, verified: false, failureCode: 'legacy_transport_pending' };
}

export function localSeek(positionMs: number): void {
  if (!isNative) return;
  if (!isLegacyLocalPlayerEnabled()) {
    void import('./media/authority/mediaCommandGateway').then((gw) => gw.seek(positionMs / 1000));
    return;
  }
  CarLauncher.seekLocalTrack({ positionMs }).catch((e) => logError('LocalMusic:Seek', e));
  _set({ positionMs });
}

export function stopLocalMusic(): void {
  if (!isNative) return;
  if (!isLegacyLocalPlayerEnabled()) {
    void import('./media/authority/mediaCommandGateway').then((gw) => gw.stop());
    return;
  }
  CarLauncher.stopLocalTrack().catch(() => {});
  _set({ playing: false, currentIndex: -1, positionMs: 0 });
}

/** Canonical snapshot'un UI kütüphane projeksiyonu; truth/publisher değildir. */
export function reflectCanonicalLocalSnapshot(snapshot: {
  playing: boolean; positionMs?: number; durationMs?: number; currentTrackId?: string;
}): void {
  if (isLegacyLocalPlayerEnabled()) return;
  const index = snapshot.currentTrackId
    ? _state.tracks.findIndex((track) => track.id === snapshot.currentTrackId)
    : -1;
  _set({
    currentIndex: index >= 0 ? index : _state.currentIndex,
    playing: snapshot.playing === true,
    positionMs: snapshot.positionMs ?? _state.positionMs,
    durationMs: snapshot.durationMs ?? _state.durationMs,
  });
}

/** Şu an yerel müzik çalıyor mu? */
export function isLocalMusicActive(): boolean {
  return _state.playing;
}
