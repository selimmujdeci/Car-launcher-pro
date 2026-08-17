/**
 * _mapIds.ts — harita katman/imaj kimliklerinin DÖNGÜSÜZ ortak evi.
 *
 * ── NEDEN AYRI DOSYA (kütük #552 · 2026-08-12) ──────────────────────────────
 * Bu sabitler eskiden `_mapState.ts` içindeydi ve `mapStyleBuilders.ts` onları
 * oradan import ediyordu. Ama `_mapState.ts` de `mapStyleBuilders.ts`'ten
 * `RASTER_PAINT_*` alıyordu → **döngüsel bağımlılık**:
 *
 *     mapStyleBuilders ──▶ _mapState ──▶ mapStyleBuilders
 *
 * Yükleme sırası `_mapState` ile başladığında `mapStyleBuilders` yarı-kurulmuş
 * bir modül görüyor ve `SHIELD_IMG_*` binding'i HENÜZ DEĞERLENMEMİŞ oluyordu.
 * Paletler (`NIGHT_PALETTE`/`DAY_PALETTE`) modül üst seviyesinde kurulduğu
 * için `shieldImage: undefined` ile **DONUYOR** — sonradan da düzelmiyordu.
 *
 * Sahada gözlenen sonuç (gerçek cihaz, hata kütüğü):
 *   `layers[23].layout.icon-image: 'undefined' value invalid. Use null instead.`
 * → `road-shield` katmanı reddediliyor, yol numarası kalkanları (E-5 · D-100)
 *   haritada HİÇ çizilmiyordu.
 *
 * Kimlikler burada durdukça ok tek yönlüdür ve döngü yapısal olarak kurulamaz:
 *   mapStyleBuilders ──▶ _mapIds ◀── _mapState
 *
 * ⚠️ Buraya YALNIZ sabit değer konur — import, tip, yan etki EKLENMEZ. Bir
 * bağımlılık eklendiği anda döngü geri gelebilir.
 */

/**
 * Yol numarası kalkanı (E-5 · D-100 · O-4) arkaplan imajları.
 *
 * Stilde `sprite` TANIMLI DEĞİLDİR — bu yüzden kalkan `icon-image` ile statik
 * bir sprite'tan gelemez; çalışma zamanında canvas'ta üretilip `addImage` ile
 * kaydedilir (mevcut Rover/badge deseniyle aynı). Katman `mapStyleBuilders`
 * içinde, imaj `MapLayerManager` içinde tanımlıdır → id'ler burada PAYLAŞILIR
 * ki ikisi sessizce ayrışmasın (kilit: mapRoadTopologyLayers.test).
 */
export const SHIELD_IMG_DAY   = 'road-shield-day';
export const SHIELD_IMG_NIGHT = 'road-shield-night';

/**
 * Harita arka plan token'ları — gece/gündüz (tek kaynak).
 *
 * ── NEDEN BURAYA TAŞINDI (kütük #605 · 2026-08-16) ──────────────────────────
 * Bu ikili `_mapState.ts` içindeydi ve oradaki yorumu "zaten paylaşılan
 * sabitlerin evi olan LEAF modüle konur; döngü YOK" DİYORDU — ama `_mapState`
 * leaf DEĞİL: `mapStyleBuilders`'tan `RASTER_PAINT_*` import ediyor. Yani
 * #552'de `SHIELD_IMG_*` için kapatılan döngünün İKİNCİ YARISI açık kalmıştı:
 *
 *     mapStyleBuilders ──▶ _mapState ──▶ mapStyleBuilders
 *
 * ÖLÇÜLDÜ (2026-08-16, Vite dev, gerçek tarayıcı, üç çözünürlükte de):
 *   `Cannot access 'MAP_BG_NIGHT' before initialization`
 * → uygulama AÇILIŞTA çöküyor (DOM'da 4 kutu kalıyor). `NIGHT_PALETTE`
 *   modül üst seviyesinde kurulduğu için, yükleme `_mapState` ile başladığında
 *   `MAP_BG_NIGHT` binding'i henüz TDZ'de oluyor.
 *
 * Paketlenmiş üründe (Rollup) modül sırası bugün ters olduğu için belirti
 * görünmüyordu — yani kusur gizliydi, YOK değildi: #552'nin sahada ölçülen
 * sonucu (`icon-image: 'undefined' value invalid`) bu ailenin aynısıdır ve
 * burada karşılığı `background-color: undefined` olurdu.
 *
 * Gece değeri 2026-08-04'te #131822 → #161c28: tile boşluğu neredeyse saf
 * siyahtı ve mini haritada "delik" gibi duruyordu.
 */
export const MAP_BG_NIGHT = '#161c28';
export const MAP_BG_DAY   = '#e9eef3';
