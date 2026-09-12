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
 * Rota bandı üstü sokak adı "pill" arkaplan imajları (kütük #635 görsel borcu).
 *
 * Kalkanla AYNI gerekçe: stilde `sprite` YOKTUR → arkaplan çalışma zamanında
 * canvas'ta üretilip `addImage` ile kaydedilir. Gündüz/gece ayrı imaj; ikisi de
 * 9-patch (`stretchX/stretchY/content`) olarak kaydedilir ki `icon-text-fit`
 * "0451. Sokak" ile "Mavi Bulvar"ı AYNI imajla, köşe yarıçapı yamulmadan sarsın.
 *
 * ⚠️ Kimlikler burada durur (leaf) — imajı üreten ve katmanı kuran taraf aynı
 * modül olsa bile, kalkanda sahada ölçülen `icon-image: 'undefined'` sınıfı
 * kusurun (#552) tekrar etmemesi için tek ev korunur.
 */
export const ROUTE_PILL_IMG_DAY   = 'route-step-pill-day';
export const ROUTE_PILL_IMG_NIGHT = 'route-step-pill-night';

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
/**
 * #622 — GECE ZEMİNİ GOOGLE SEVİYESİNE ÇIKARILDI (kullanıcı hedefi: *"Google
 * Maps seviyesinde olacak"*).
 *
 * ÖLÇÜM — mutlak yüzey parlaklığı (WCAG relative luminance; yüksek = okunur yüzey):
 *     Google Maps gece zemini `#242f3e` → **0,028**
 *     bizim ham palet        `#161c28` → 0,012
 *     bizim EKRANDA (o günkü `brightness(0.8)` filtresiyle) → **0,008**
 * Yani kontrast ORANLARIMIZ Google'dan yüksekti (tali yol 2,47 vs 1,31) ama
 * yüzeyin kendisi **3,5 kat daha karanlıktı** — harita bu yüzden "ölü/boş"
 * görünüyordu. Kusur ilişki değil, MUTLAK parlaklıktı; onca kontrast turunda
 * ölçtüğüm oranlar doğruydu, yanlış olan zemindi.
 *
 * Yeni değer `#222c3c` → 0,025 (Google'ın 0,028'ine yakın), ve gece filtresi
 * KALDIRILDI (bkz. FullMapView #622): gece görünümü artık TEK otoriteden,
 * paletten gelir. Önceki değer 2026-08-04'te `#131822 → #161c28` yapılmıştı
 * (tile boşluğu saf siyah görünüyordu); bu tur aynı yönde ikinci adımdır.
 */
export const MAP_BG_NIGHT = '#222c3c';
/**
 * GÜNDÜZ ZEMİNİ — 2026-09-09 kartografi kalibrasyonu.
 *
 * ── NEDEN DEĞİŞTİ (ölçüm, tahmin değil) ───────────────────────────────────
 * Eski değer `#e9eef3` SOĞUK MAVİ-GRİYDİ (RGB hue 210°, kroma 0,039) ve
 * yapısal ailedeki 10 rengin 10'u da AYNI 210–220° penceresindeydi. Yani
 * harita zemin · bina · kasa · yol · arazi olarak tek hue ailesine yığılmıştı —
 * bu, 2026-09-06'da kullanıcının REDDETTİĞİ amber paletin (12/12 renk 40–48°)
 * kusurunun SOĞUK TARAFTAKİ İKİZİDİR; yalnız şiddeti daha düşüktü.
 *
 * ÖLÇÜLEN SONUÇ (CIEDE2000, büyük yüzeyler): zemin↔tarım 2,46 · tarım↔konut
 * **0,43** · konut↔sanayi 2,04 · sanayi↔bina 1,94. Yani haritanın TÜM zemin
 * ailesi tek düz kütle olarak okunuyordu (ΔE<2,3 = geniş alanda ayırt edilemez)
 * — sahadaki "soğuk/klinik, CAD çizimi gibi, soluk" izleniminin sayısal
 * karşılığı budur.
 *
 * YENİ DEĞER `#eee9e3`: aynı KROMA BÜYÜKLÜĞÜ (0,043 ≈ eski 0,039) ama yön
 * soğuktan SICAK-NÖTRE döndü (hue 33°) ve açıklık bir tık indi (L* 93,9→92,6).
 * Sepia DEĞİLDİR: reddedilen paletin ortalama kroması 0,0705, tepe 0,114 idi —
 * bu değer onun ~%60'ı ve yalnız ZEMİN ailesine uygulanır; yol gövdeleri ve
 * kasaları AKROMATİKTİR (kroma 0,000). Aile düzeyinde hue ayrımı, "her şey tek
 * krem ağ" çöküşünü yapısal olarak imkânsız kılar (bkz. `mapDayPaletteContrast`
 * §AMBER/SEPIA invariantı ve `DAY_PALETTE` gerekçesi).
 *
 * Raster ve vektör yolu AYNI tokeni yazar (tek gündüz zemini sözleşmesi).
 */
export const MAP_BG_DAY   = '#eee9e3';

/**
 * #609 — Verilen kaynak TÜRÜ zemini (basemap) çizen bir KARO kaynağı mı?
 *
 * `tileError` bayrağı "harita çizilemiyor" demektir; hem arıza sayacı hem
 * iyileşme YALNIZ bu yükleme göre karar vermelidir.
 *
 * `raster-dem` (yükselti verisi) BİLEREK dışarıdadır: yokluğu haritayı
 * çizilemez yapmaz, yalnız kabartmayı kapatır. Sahada tam olarak bu oldu —
 * vektör stilindeki `terrain-rgb` kaynağının 404'leri zemin karosu arızası
 * sayılıp mini haritada kalıcı "HARİTA YÜKLENEMİYOR" üretiyordu; oysa `omv`
 * karoları sorunsuz çiziliyordu.
 *
 * Kimlik DEĞİL TÜR sorulur: karo kaynağının adı stilden stile değişir
 * (`omv` · `map-tiles` · `satellite-tiles`) ve sabit bir ada bağlanan mantık
 * diğer stillerde sessizce ölür — kusurun temizleme tarafı tam olarak buydu.
 *
 * Saf ve yaprak: bu modülün hiçbir importu yoktur (bkz. dosya başlığındaki
 * dairesel bağımlılık tuzağı), bu yüzden doğrudan test edilebilir.
 */
export function isBasemapTileSourceType(type: string | undefined): boolean {
  return type === 'raster' || type === 'vector';
}
