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
