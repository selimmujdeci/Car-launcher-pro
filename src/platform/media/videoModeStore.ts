/**
 * videoModeStore — YouTube tam ekran video modu için minimal global durum.
 *
 * MediaScreen yerel useState yerine bunu okur (useSyncExternalStore); böylece
 * sesli komut ("video moduna al") UI dışından setVideoMode(true) ile tetikler.
 * Zero-alloc, dış bağımlılık yok.
 */

let _videoMode = false;
const _subs = new Set<() => void>();

export function getVideoMode(): boolean {
  return _videoMode;
}

export function setVideoMode(on: boolean): void {
  if (_videoMode === on) return;
  _videoMode = on;
  _subs.forEach((f) => { try { f(); } catch { /* abone hatası diğerlerini etkilemesin */ } });
}

export function toggleVideoMode(): void {
  setVideoMode(!_videoMode);
}

export function subscribeVideoMode(cb: () => void): () => void {
  _subs.add(cb);
  return () => { _subs.delete(cb); };
}
