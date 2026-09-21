/**
 * videoModeStore — YouTube tam ekran video modu için minimal global durum.
 *
 * MediaScreen yerel useState yerine bunu okur (useSyncExternalStore); böylece
 * sesli komut ("video moduna al") UI dışından setVideoMode(true) ile tetikler.
 * Zero-alloc, dış bağımlılık yok.
 *
 * ── ÜRÜN KARARI 2026-09-05 · VİDEO OYNATMA VARSAYILAN AÇIK ────────────────
 * Kullanıcı: *"video oynatma açık olacak"*. Varsayılan `false` idi: YouTube
 * çalarken Müzik ekranı **kapak/ses modunda** açılıyor, videoyu görmek için her
 * seferinde kamera düğmesine basmak gerekiyordu.
 *
 * Bu, hız/hareket kapısının kaldırıldığı 2026-09-03 kararının (kütük #1204)
 * doğal devamıdır: ürün videoyu ARTIK ENGELLEMİYORDU, ama hâlâ **kapalı
 * başlatıyordu**. Artık açık başlıyor.
 *
 * ── SINIRLAR (bilinçli, korunuyor) ────────────────────────────────────────
 *  · Bu bayrak YALNIZ GÖRÜNÜRLÜKTÜR. Oynatma otoritesi DEĞİLDİR: ses zaten
 *    çalıyorsa çalmaya devam eder, çalmıyorsa bu bayrak onu başlatmaz
 *    (Cross-Domain §6 — görünüm katmanı playback truth üretmez).
 *  · Yalnız `isYouTube` iken bir etkisi vardır (`MediaScreen`); yerel/akış
 *    kaynaklarında video yüzeyi yoktur.
 *  · Kullanıcı kapatabilir (`toggleVideoMode`) ve seçim oturum boyunca korunur —
 *    varsayılan, kullanıcı tercihini EZMEZ.
 *  · Müzik ekranı KAPALIYKEN host ekran dışında park eder (yalnız ses);
 *    bu bayrak haritanın üstüne video AÇMAZ.
 */

/**
 * Varsayılan AÇIK (2026-09-05 ürün kararı). Kullanıcı kapatırsa oturum boyunca
 * kapalı kalır — bu yalnız BAŞLANGIÇ değeridir.
 */
let _videoMode = true;
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

/** @internal — testler arası izolasyon (varsayılana döner). */
export function _resetVideoModeForTest(): void {
  _videoMode = true;
  _subs.clear();
}
