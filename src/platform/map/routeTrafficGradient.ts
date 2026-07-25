/**
 * routeTrafficGradient — NAV-5: rotayı trafik yoğunluğuna göre renklendirme.
 *
 * İKİ PARÇA:
 *   1. buildTrafficGradient — SAF fonksiyon: trafik seviyesi "stop"larından MapLibre
 *      `line-gradient` ifadesi üretir (line-progress 0-1 boyunca). Tam test edilebilir.
 *   2. sampleRouteTrafficStops — rota geometrisini K noktada örnekler, her nokta için HERE
 *      Flow jamFactor'ünü çeker → seviye → stop. Best-effort, bounded, fail-soft. BYOK
 *      (HERE anahtarı yoksa null → çağıran dekoratif gradient'te kalır).
 *
 * GÜVENLİK: gradient yalnız SEL_LAYER'ın `line-gradient` paint'ini değiştirir (setPaintProperty)
 * → rota ÇİZGİSİNİ bozamaz; en kötü ihtimal yanlış renk. Trafik verisi yoksa/başarısızsa
 * mevcut dekoratif gradient AYNEN kalır (MapLayerManager fallback).
 */
import { TRAFFIC_COLORS, fetchHereJamFactorAt, type TrafficLevel } from '../trafficService';

/** line-progress [0-1] konumunda bir trafik seviyesi. */
export interface TrafficStop {
  progress: number;
  level:    TrafficLevel;
}

/** jamFactor (0 serbest → 10 tıkalı) → seviye. trafficService ile aynı eşikler. */
export function jamToLevel(jf: number): TrafficLevel {
  if (jf < 2) return 'free';
  if (jf < 5) return 'moderate';
  if (jf < 8) return 'heavy';
  return 'standstill';
}

/**
 * Trafik stop'larından MapLibre `line-gradient` ifadesi. SAF + test edilebilir.
 * MapLibre kuralı: line-progress stop'ları KESİN ARTAN olmalı, [0,1] aralığında, ≥2 stop.
 * @returns gradient ifadesi VEYA null (stop yok → çağıran dekoratife düşer).
 */
export function buildTrafficGradient(stops: TrafficStop[]): unknown[] | null {
  if (!stops || stops.length === 0) return null;

  const sorted = stops
    .filter((s) => Number.isFinite(s.progress))
    .map((s) => ({ progress: Math.max(0, Math.min(1, s.progress)), color: TRAFFIC_COLORS[s.level] }))
    .sort((a, b) => a.progress - b.progress);
  if (sorted.length === 0) return null;

  // Tek stop → tüm rota tek renk (MapLibre ≥2 stop ister).
  if (sorted.length === 1) {
    return ['interpolate', ['linear'], ['line-progress'], 0, sorted[0].color, 1, sorted[0].color];
  }

  const expr: unknown[] = ['interpolate', ['linear'], ['line-progress']];
  let lastP = -1;
  for (const s of sorted) {
    let p = s.progress;
    if (p <= lastP) p = Math.min(1, lastP + 1e-4); // kesin artan garantisi
    expr.push(p, s.color);
    lastP = p;
  }
  return expr;
}

/** Haversine (m) — iki [lng,lat] arası. */
function _haversine(a: [number, number], b: [number, number]): number {
  const R = 6_371_000;
  const dLat = (b[1] - a[1]) * Math.PI / 180;
  const dLng = (b[0] - a[0]) * Math.PI / 180;
  const la1 = a[1] * Math.PI / 180, la2 = b[1] * Math.PI / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Rota geometrisini eşit-mesafe K noktada örnekler ve line-progress konumlarını döndürür.
 * SAF + store-bağımsız: kümülatif mesafe geometriden hesaplanır; progress_i = geçilen/toplam.
 * line-progress MapLibre'de yay-uzunluğu (mesafe) tabanlıdır → mesafe-progress doğru eşleşir.
 */
export function sampleRouteProgress(
  geometry:  [number, number][],
  sampleCount = 6,
): { lat: number; lng: number; progress: number }[] {
  const n = geometry.length;
  if (n < 2) return [];

  // Kümülatif mesafe (baştan): cum[i] = geometry[0]..geometry[i] toplam yay uzunluğu.
  const cum = new Float64Array(n);
  for (let i = 1; i < n; i++) cum[i] = cum[i - 1] + _haversine(geometry[i - 1], geometry[i]);
  const total = cum[n - 1];
  if (!(total > 0)) return [];

  const k = Math.max(2, Math.min(sampleCount, n));
  const out: { lat: number; lng: number; progress: number }[] = [];
  for (let s = 0; s < k; s++) {
    const targetProgress = s / (k - 1);          // eşit aralıklı 0..1
    const targetDist = total * targetProgress;
    let best = 0, bestDiff = Infinity;
    for (let i = 0; i < n; i++) {
      const diff = Math.abs(cum[i] - targetDist);
      if (diff < bestDiff) { bestDiff = diff; best = i; }
    }
    const [lng, lat] = geometry[best];
    out.push({ lat, lng, progress: cum[best] / total });
  }
  return out;
}

/**
 * Rota boyunca trafik stop'larını çeker (best-effort, BYOK). HERE anahtarı yoksa / veri yoksa
 * null. Her örnek nokta için bir jamFactor sorgusu → K sorgu (bounded). Fail-soft.
 */
export async function sampleRouteTrafficStops(
  geometry:  [number, number][],
  sampleCount = 6,
): Promise<TrafficStop[] | null> {
  const pts = sampleRouteProgress(geometry, sampleCount);
  if (pts.length === 0) return null;
  const stops: TrafficStop[] = [];
  for (const p of pts) {
    try {
      const jf = await fetchHereJamFactorAt(p.lat, p.lng);
      if (jf == null) return null; // anahtar yok / erişim yok → dekoratife düş
      stops.push({ progress: p.progress, level: jamToLevel(jf) });
    } catch { /* tek nokta düşerse atla (fail-soft) */ }
  }
  return stops.length >= 2 ? stops : null;
}
