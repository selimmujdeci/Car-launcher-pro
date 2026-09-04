/**
 * nowPlayingLayoutModel.ts — F11 · Now Playing YERLEŞİM modeli (SAF).
 *
 * NE YAPAR: ekranın ÖLÇÜLEN boyutundan (drawer içerik alanı) ve sürüş
 * durumundan, Now Playing yüzeyinin hangi YOĞUNLUKLA çizileceğini ve somut
 * piksel değerlerini (kapak boyutu · yazı boyutu · buton boyutu · tab bar
 * yoğunluğu) hesaplar.
 *
 * ÖLÇÜLEN KUSUR (F11 denetimi): albüm kapağı `min(280px, 70vw)` — GENİŞLİĞE
 * göre ölçekleniyordu, YÜKSEKLİĞE göre DEĞİL. 800×480 sınıfı aftermarket
 * ekranlarda (drawer içerik yüksekliği ≈ 400px) bu, kare kapağın kendi flex
 * hücresinden TAŞMASINA yol açıyordu — transport'un ezilmesi/kaybolması bu
 * kökten geliyordu. Bu modül kapağı HER İKİ eksene göre sınırlar.
 *
 * NE YAPMAZ: playback/queue/artwork otoritesi taşımaz, komut göndermez,
 * timer kurmaz. Yalnız ÖLÇÜLEN genişlik/yükseklik + sürüş durumundan saf bir
 * hesap üretir — `useScreenSense` (mevcut ResizeObserver kancası) çağıranındır.
 *
 * REGULAR yoğunluk, F11 ÖNCESİ tasarımla PİKSEL UYUMLUDUR (mevcut büyük
 * ekran deneyimi bozulmaz); COMPACT yalnız düşük yükseklikte veya sürüşte
 * devreye girer — bu bilinçli bir risk azaltma kararıdır.
 *
 * SAFLIK: I/O · timer · `Date.now` · global durum · React importu YOKTUR.
 */

export type NowPlayingDensity = 'REGULAR' | 'COMPACT';

/** Bu yükseklik/genişlik ALTINDA otomatik COMPACT — 800×480 sınıfı ekranlar. */
export const COMPACT_HEIGHT_BREAKPOINT_PX = 560;
export const COMPACT_WIDTH_BREAKPOINT_PX = 640;

/** Dokunma hedefi tabanı — hiçbir yoğunlukta bunun altına inilmez. */
export const MIN_TOUCH_TARGET_PX = 48;

export interface NowPlayingLayout {
  readonly density: NowPlayingDensity;
  /** Kapak kare kenarı (px) — hem genişlik hem yükseklik bütçesine göre sınırlı. */
  readonly artworkPx: number;
  readonly titleFontPx: number;
  readonly artistFontPx: number;
  /** Ana bloklar arası boşluk (px) — COMPACT'ta sıkışır, taşma önlenir. */
  readonly sectionGapPx: number;
  /** Çal/Duraklat düğmesi çapı — daima en güçlü kontrol. */
  readonly transportPrimaryPx: number;
  /** Önceki/Sonraki düğme çapı. */
  readonly transportSecondaryPx: number;
  /** Karıştır/Tekrarla düğme çapı (yalnız sürüş dışında zaten render edilir). */
  readonly transportTertiaryPx: number;
  /** Alt sekme çubuğu: yalnız simge mi, yoksa simge+etiket mi. */
  readonly tabBarCompact: boolean;
}

const clamp = (v: number, min: number, max: number): number => Math.max(min, Math.min(max, v));

/**
 * Yoğunluk sınıfı.
 *
 * Sürüşte HER ZAMAN COMPACT: derin gezinme/ikincil süs azalır, temel transport
 * ve kapak/başlık öncelikli kalır (§13). Bu, YENİ bir sürüş otoritesi DEĞİLDİR —
 * yalnız çağıranın verdiği mevcut `drivingMode`ı yorumlar.
 */
export function classifyNowPlayingDensity(
  contentWidthPx: number, contentHeightPx: number, drivingMode: 'idle' | 'normal' | 'driving',
): NowPlayingDensity {
  if (drivingMode === 'driving') return 'COMPACT';
  if (contentHeightPx < COMPACT_HEIGHT_BREAKPOINT_PX) return 'COMPACT';
  if (contentWidthPx < COMPACT_WIDTH_BREAKPOINT_PX) return 'COMPACT';
  return 'REGULAR';
}

/**
 * Kapak kare kenarı — GENİŞLİK ve YÜKSEKLİK bütçesinin İKİSİNE de saygılıdır.
 *
 * REGULAR bütçe eski `min(280px, 70vw)` davranışıyla aynı üst sınırı korur
 * (280px) ama artık yükseklik payını da hesaba katar — geniş-ama-alçak bir
 * ekranda (ör. 1280×480) kapak yine taşamaz.
 */
export function nowPlayingArtworkPx(
  contentWidthPx: number, contentHeightPx: number, density: NowPlayingDensity,
): number {
  if (density === 'COMPACT') {
    return Math.round(clamp(Math.min(contentWidthPx * 0.42, contentHeightPx * 0.34), 96, 176));
  }
  return Math.round(clamp(Math.min(contentWidthPx * 0.62, contentHeightPx * 0.46), 200, 280));
}

/** Now Playing'in çizeceği her yerleşim değeri — tek saf hesap. */
export function computeNowPlayingLayout(
  contentWidthPx: number, contentHeightPx: number, drivingMode: 'idle' | 'normal' | 'driving',
): NowPlayingLayout {
  const w = Number.isFinite(contentWidthPx) && contentWidthPx > 0 ? contentWidthPx : COMPACT_WIDTH_BREAKPOINT_PX;
  const h = Number.isFinite(contentHeightPx) && contentHeightPx > 0 ? contentHeightPx : COMPACT_HEIGHT_BREAKPOINT_PX;
  const density = classifyNowPlayingDensity(w, h, drivingMode);
  const compact = density === 'COMPACT';

  return Object.freeze({
    density,
    artworkPx: nowPlayingArtworkPx(w, h, density),
    titleFontPx: compact ? 18 : 24,
    artistFontPx: compact ? 11 : 12,
    sectionGapPx: compact ? 10 : 20,
    transportPrimaryPx: compact ? 64 : 80,
    transportSecondaryPx: compact ? 52 : 64,
    transportTertiaryPx: MIN_TOUCH_TARGET_PX,
    tabBarCompact: compact,
  });
}
