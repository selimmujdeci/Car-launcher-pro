/**
 * Geohash Level 6 Encoder — kütüphane bağımsız, saf TypeScript
 *
 * Level 6 hassasiyet: ~1.2km × 0.6km (lat × lng) — koordinat anonimleştirme için yeterli.
 * Algoritma: RFC benzeri standard geohash (base32, bit-interleaving).
 *
 * Güvenlik notu: Bu fonksiyon çağrıldıktan sonra gelen lat/lng referansları
 * caller tarafında silinmeli — communityService.ts bu garantiyi sağlar.
 */

const BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz';

/**
 * Level 6 geohash string'ini merkez koordinata geri dönüştürür.
 * Bilinmeyen karakterler silently atlanır.
 *
 * @param hash Geohash string (örn. "sxk37t")
 * @returns Merkez koordinat { lat, lng }
 */
export function decodeGeohash(hash: string): { lat: number; lng: number } {
  let latMin = -90.0,  latMax = 90.0;
  let lngMin = -180.0, lngMax = 180.0;
  let isLng  = true;

  for (const char of hash) {
    const idx = BASE32.indexOf(char);
    if (idx === -1) continue; // geçersiz karakter — atla

    for (let bit = 4; bit >= 0; bit--) {
      const bitval = (idx >> bit) & 1;
      if (isLng) {
        const mid = (lngMin + lngMax) * 0.5;
        if (bitval) lngMin = mid; else lngMax = mid;
      } else {
        const mid = (latMin + latMax) * 0.5;
        if (bitval) latMin = mid; else latMax = mid;
      }
      isLng = !isLng;
    }
  }

  return {
    lat: (latMin + latMax) * 0.5,
    lng: (lngMin + lngMax) * 0.5,
  };
}

/**
 * Enlem/boylam çiftini Level 6 geohash string'ine dönüştürür.
 * Kesin koordinatlar fonksiyon kapsamı dışına sızmaz.
 *
 * @param lat  Enlem  (-90  … +90)
 * @param lng  Boylam (-180 … +180)
 * @param precision Geohash uzunluğu (varsayılan 6)
 * @returns Geohash string (örn. "sxk37t")
 */
export function encodeGeohash(lat: number, lng: number, precision = 6): string {
  let latMin = -90.0;
  let latMax = 90.0;
  let lngMin = -180.0;
  let lngMax = 180.0;

  let hash = '';
  let charIdx = 0;  // 0-31 arası base32 index
  let bits = 0;     // geçerli karakterdeki bit sayısı (0-4)
  let isLng = true; // önce boylam, ardından enlem (geohash standardı)

  while (hash.length < precision) {
    if (isLng) {
      const mid = (lngMin + lngMax) * 0.5;
      if (lng >= mid) {
        charIdx = (charIdx << 1) | 1;
        lngMin = mid;
      } else {
        charIdx = charIdx << 1;
        lngMax = mid;
      }
    } else {
      const mid = (latMin + latMax) * 0.5;
      if (lat >= mid) {
        charIdx = (charIdx << 1) | 1;
        latMin = mid;
      } else {
        charIdx = charIdx << 1;
        latMax = mid;
      }
    }

    isLng = !isLng;
    bits++;

    if (bits === 5) {
      hash += BASE32[charIdx];
      charIdx = 0;
      bits = 0;
    }
  }

  return hash;
}
