/**
 * TERS COĞRAFİ ÇÖZÜMLEME — araç noktası → okunur adres.
 *
 * KANITSIZ BİLGİ ÜRETİLMEZ: çözümleme başarısızsa `null` döner ve UI
 * "adres çözümlenemedi" der; koordinat ASLA uydurma bir adresle değiştirilmez.
 *
 * Nominatim kullanım politikası gereği:
 *  - koordinat ~11 m ızgaraya yuvarlanarak önbelleklenir (aynı park hâlindeki
 *    araç için tek istek),
 *  - eşzamanlı aynı istek TEK uçuşta birleşir,
 *  - ardışık istekler en az `MIN_INTERVAL_MS` aralıklı yapılır.
 *
 * Veri: © OpenStreetMap katkıcıları (ODbL).
 */

const ENDPOINT = 'https://nominatim.openstreetmap.org/reverse';
const MIN_INTERVAL_MS = 1_100;
const CACHE_TTL_MS = 10 * 60_000;
const CACHE_MAX = 200;

interface CacheEntry {
  address: string | null;
  at: number;
}

const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<string | null>>();
let lastRequestAt = 0;

/** ~11 m ızgara — GPS titremesi yeni istek doğurmasın. */
function cacheKey(lat: number, lng: number): string {
  return `${lat.toFixed(4)},${lng.toFixed(4)}`;
}

function rememberAddress(key: string, address: string | null): void {
  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, { address, at: Date.now() });
}

interface NominatimAddress {
  road?: string;
  neighbourhood?: string;
  suburb?: string;
  town?: string;
  city?: string;
  village?: string;
  district?: string;
  county?: string;
  state?: string;
}

/** Nominatim yanıtını kısa, okunur Türkçe adrese indirger. */
export function formatNominatimAddress(
  raw: { display_name?: string; address?: NominatimAddress } | null,
): string | null {
  if (!raw) return null;
  const a = raw.address;
  if (a) {
    const line1 = a.road ?? a.neighbourhood ?? a.suburb ?? null;
    const line2 = a.town ?? a.city ?? a.village ?? a.district ?? a.county ?? a.state ?? null;
    const parts = [line1, line2].filter((p): p is string => typeof p === 'string' && p.length > 0);
    if (parts.length > 0) return parts.join(', ');
  }
  const display = raw.display_name;
  if (typeof display === 'string' && display.length > 0) {
    return display.split(',').slice(0, 2).map((s) => s.trim()).join(', ');
  }
  return null;
}

/**
 * Koordinatı adrese çevirir. `null` = ÇÖZÜMLENEMEDİ (adres yok demek DEĞİL).
 */
export async function reverseGeocode(lat: number, lng: number): Promise<string | null> {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat === 0 && lng === 0) return null;

  const key = cacheKey(lat, lng);

  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.address;

  const pending = inflight.get(key);
  if (pending) return pending;

  const task = (async (): Promise<string | null> => {
    try {
      const wait = lastRequestAt + MIN_INTERVAL_MS - Date.now();
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
      lastRequestAt = Date.now();

      const url =
        `${ENDPOINT}?lat=${lat}&lon=${lng}&format=json&zoom=17&addressdetails=1&accept-language=tr`;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8_000);
      let address: string | null = null;
      try {
        const res = await fetch(url, { signal: controller.signal });
        if (res.ok) address = formatNominatimAddress(await res.json());
      } finally {
        clearTimeout(timer);
      }
      rememberAddress(key, address);
      return address;
    } catch {
      /* Ağ/iptal hatası ÖNBELLEKLENMEZ — sonraki deneme tekrar sorabilsin. */
      return null;
    } finally {
      inflight.delete(key);
    }
  })();

  inflight.set(key, task);
  return task;
}

/** Testler ve ekran değişimleri için — durum sızıntısını temizler. */
export function resetReverseGeocodeCache(): void {
  cache.clear();
  inflight.clear();
  lastRequestAt = 0;
}
