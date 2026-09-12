/**
 * tripAiSources.ts — TRIP AI motorlarının TEK okuma katmanı (CAROS LAB).
 *
 * ── NEDEN VAR (envanter denetimi E-02/E-03) ────────────────────────────
 * `tripCorridorEngine` ve `tripRecommendationEngine` yazılmış, testli ve SAF
 * motorlardı ama ürün yolunda **hiçbir çağıranları yoktu** — ürettikleri hiçbir
 * yüzeye ulaşmıyordu. Bu katman onları ürün yoluna bağlar.
 *
 * ── GÜVENLİK SINIRI (pazarlıksız) ──────────────────────────────────────
 * · Rota **DEĞİŞTİRİLMEZ** — `writeActiveRoute` bu dosyadan ÇAĞRILMAZ.
 * · **AĞA ÇIKILMAZ** — POI kaynağı yerel IndexedDB, motorlar saf hesap.
 *   (`tripApplyComposition`/`legRouterAdapter` ağ ister ve rota YAZAR → bu
 *   katmanın DIŞINDADIR ve bilinçli olarak bağlanmamıştır.)
 * · Timer/abonelik KURULMAZ — yalnız elle tetiklenen tek okuma.
 * · Navigasyon başlatılmaz/durdurulmaz, ETA'ya dokunulmaz.
 *
 * ── GİZLİLİK (gözlemlenebilirlik kuralı 6) ─────────────────────────────
 * POI **adı · adresi · koordinatı bu katmandan ÇIKMAZ.** Kayıtlı yerler
 * kullanıcı verisidir. Dışarı yalnız ADET · MESAFE · SKOR · KATEGORİ ·
 * GEREKÇE KODU verilir. Maskeleme `tripAiModel` içinde yapılır; ham
 * `StoredLocation` bu modülün dışına asla sızmaz.
 */

import { getRouteState } from '../routingService';
import { getRecentLocations, type StoredLocation } from '../offlineSearchService';

/** Motorlara beslenecek ham girdiler — hiçbiri ekrana çıkmaz. */
export interface TripAiRawInputs {
  readonly readAt: number;
  /** Aktif rota geometrisi `[lon, lat][]`. `null` = rota yok. */
  readonly geometry: readonly [number, number][] | null;
  /** Yerel kayıtlı yerler. Boş dizi = kayıt yok (okuma hatası da boş verir). */
  readonly pois: readonly StoredLocation[];
  /** POI deposu OKUNABİLDİ mi — `false` ise "0 POI" değil "okunamadı". */
  readonly poiStoreReadable: boolean;
}

/** Bu turda kullanılan koridor yarı-genişliği (metre). */
export const TRIP_AI_CORRIDOR_M = 5_000;

/** Ekrana taşınacak azami aday — bounded (düşük-uç render bütçesi). */
export const TRIP_AI_MAX_CANDIDATES = 20;

/** Motorlara beslenen azami POI — O(N×M) hesabın üst sınırı. */
export const TRIP_AI_MAX_POIS = 200;

/**
 * Tek atışlık okuma. **Elle tetiklenir**; açılışta kendiliğinden koşmaz —
 * ekran açmak bir hesabı tetiklememelidir (düşük-uç bütçesi).
 */
export async function readTripAiInputs(): Promise<TripAiRawInputs> {
  const readAt = Date.now();

  let geometry: readonly [number, number][] | null = null;
  try {
    const route = getRouteState();
    const g = route?.geometry;
    geometry = Array.isArray(g) && g.length >= 2 ? (g as [number, number][]) : null;
  } catch { geometry = null; }

  let pois: readonly StoredLocation[] = [];
  let poiStoreReadable = false;
  try {
    pois = await getRecentLocations(TRIP_AI_MAX_POIS);
    poiStoreReadable = true;
  } catch {
    pois = [];
    poiStoreReadable = false;   // "0 kayıt" ile "okunamadı" AYRI
  }

  return { readAt, geometry, pois, poiStoreReadable };
}
