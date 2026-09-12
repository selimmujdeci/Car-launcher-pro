/**
 * _mapSurfaceInternals — P0-NAV-02 · `FullMapView` ile ayrıştırılan hook'ların
 * PAYLAŞTIĞI iki küçük yardımcı.
 *
 * Bu dosya `FullMapView.tsx` içindeki tanımların **taşınmış hâlidir**, kopyası
 * değil: davranış birebir aynı kalsın diye ikinci bir tanım BIRAKILMADI.
 * (İki `_routeHash` olsaydı biri değişip diğeri değişmediğinde rota çizimi
 * sessizce iki farklı dedup anahtarı kullanırdı.)
 */

/** MapLibre haritası + tek seferlik ilk-konum bayrağı. */
export type MapRef = import('maplibre-gl').Map & { _fullMapInitialized?: boolean };

/**
 * Rota geometrisinin dedup anahtarı — aynı geometri iki kez ÇİZİLMESİN.
 * Uç noktalar + nokta sayısı yeterlidir; tüm diziyi hash'lemek sıcak yolda
 * gereksiz maliyettir.
 */
export function routeHash(geometry: [number, number][] | null | undefined): string {
  if (!geometry || geometry.length < 2) return '';
  const f = geometry[0];
  const l = geometry[geometry.length - 1];
  return `${geometry.length}:${f[0].toFixed(5)},${f[1].toFixed(5)}:${l[0].toFixed(5)},${l[1].toFixed(5)}`;
}

/* routingService mutex bayrağı `window` üzerinden paylaşılır (modüller arası tek
   nokta). Global `Window` arayüzünü genişletmek yerine dar bir görünüm kullanılır:
   bayrak yalnız harita yüzeyinde ve routingService'te okunur/yazılır. */
interface MapMutexWindow { __MAP_MUTEX__?: boolean }

export const mapMutexWindow = (): MapMutexWindow => window as unknown as MapMutexWindow;
