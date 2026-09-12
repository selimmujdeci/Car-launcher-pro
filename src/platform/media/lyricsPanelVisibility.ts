/**
 * lyricsPanelVisibility — MUSIC F16 · Sözler paneli için minimal PRESENTATION
 * durumu (Cross-Domain §14: UI projeksiyonu, domain truth DEĞİL).
 *
 * `videoModeStore.ts` ile AYNI desen: MediaScreen yerel `useState` yerine
 * bunu okur (`useSyncExternalStore`); böylece Mavi/sesli komut UI DIŞINDAN
 * `showLyricsPanel()`/`hideLyricsPanel()` ile tetikleyebilir — F9 router
 * "UI görünürlüğünü TALEP EDER" (spec §8), kendi lyrics/playback state'ini
 * KURMAZ. Zero-alloc, dış bağımlılık yok.
 */

let _visible = false;
const _subs = new Set<() => void>();

export function getLyricsPanelVisible(): boolean {
  return _visible;
}

export function setLyricsPanelVisible(on: boolean): void {
  if (_visible === on) return;
  _visible = on;
  _subs.forEach((f) => { try { f(); } catch { /* abone hatası diğerlerini etkilemesin */ } });
}

export function toggleLyricsPanelVisible(): void {
  setLyricsPanelVisible(!_visible);
}

export function subscribeLyricsPanelVisible(cb: () => void): () => void {
  _subs.add(cb);
  return () => { _subs.delete(cb); };
}

export function _resetLyricsPanelVisibilityForTest(): void {
  _visible = false;
}
