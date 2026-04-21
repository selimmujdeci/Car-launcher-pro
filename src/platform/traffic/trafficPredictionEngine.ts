/**
 * Traffic Prediction Engine — Saatlik + Günlük Tarihsel Model
 *
 * Gerçek API verisi yokken tahmin üretir.
 * Kaynak: trafficService.ts'teki HOURLY_DENSITY mantığı buraya taşındı
 * ve segment-aware hale getirildi.
 *
 * Gelecekte: LearnedSegmentProfile ile kombine edilebilir.
 */

import {
  type LatLng,
  type SegmentTrafficState,
  type HourlyPrediction,
  makeSegmentId,
  levelFromDensity,
  refSpeedKmh,
} from './trafficTypes';
import { setCachedPrediction, getCachedPrediction } from './trafficCache';

/* ── Saatlik yoğunluk matrisi ────────────────────────────────── */

/**
 * 7 × 24 yoğunluk matrisi: [gün][saat] → 0.0–1.0
 * Gün: 0=Pazar, 1=Pazartesi, …, 6=Cumartesi
 * trafficService.ts ile aynı değerler — 7 güne genişletildi.
 */
const DENSITY_MATRIX: Readonly<number[][]> = Object.freeze([
  // Pazar — daha sakin sabah, öğleden sonra orta
  [0.04, 0.02, 0.02, 0.02, 0.03, 0.08, 0.18, 0.40, 0.55, 0.60, 0.55, 0.50,
   0.55, 0.58, 0.52, 0.50, 0.55, 0.65, 0.72, 0.62, 0.45, 0.30, 0.18, 0.08],
  // Pazartesi — sert sabah zirvesi
  [0.05, 0.03, 0.02, 0.02, 0.03, 0.12, 0.35, 0.80, 0.97, 0.82, 0.58, 0.52,
   0.62, 0.56, 0.52, 0.57, 0.72, 0.93, 0.97, 0.78, 0.52, 0.36, 0.20, 0.10],
  // Salı — Pazartesi gibi ama biraz düşük
  [0.05, 0.03, 0.02, 0.02, 0.03, 0.11, 0.33, 0.78, 0.95, 0.80, 0.56, 0.50,
   0.60, 0.54, 0.50, 0.55, 0.70, 0.91, 0.95, 0.76, 0.50, 0.34, 0.19, 0.09],
  // Çarşamba
  [0.05, 0.03, 0.02, 0.02, 0.03, 0.11, 0.32, 0.77, 0.94, 0.79, 0.55, 0.50,
   0.60, 0.54, 0.50, 0.55, 0.70, 0.90, 0.94, 0.75, 0.50, 0.34, 0.19, 0.09],
  // Perşembe
  [0.05, 0.03, 0.02, 0.02, 0.03, 0.11, 0.33, 0.78, 0.95, 0.80, 0.56, 0.50,
   0.60, 0.55, 0.51, 0.56, 0.71, 0.91, 0.95, 0.76, 0.51, 0.35, 0.19, 0.09],
  // Cuma — akşam zirvesi yüksek
  [0.05, 0.03, 0.02, 0.02, 0.03, 0.12, 0.34, 0.79, 0.96, 0.81, 0.57, 0.52,
   0.62, 0.58, 0.54, 0.60, 0.75, 0.95, 0.98, 0.82, 0.60, 0.42, 0.25, 0.12],
  // Cumartesi — sabah geç, akşam sakin
  [0.04, 0.02, 0.02, 0.02, 0.03, 0.07, 0.15, 0.35, 0.50, 0.58, 0.62, 0.60,
   0.62, 0.60, 0.55, 0.52, 0.58, 0.70, 0.75, 0.65, 0.48, 0.32, 0.18, 0.08],
]);

/* ── Konum bazlı varyasyon ───────────────────────────────────── */

/**
 * Aynı segment her seferinde aynı varyasyonu alır (deterministik).
 * Farklı segmentlerin aynı anda aynı değer göstermesini önler.
 */
function _locationVariation(segmentId: string, i: number): number {
  let hash = 0;
  for (let j = 0; j < segmentId.length; j++) {
    hash = (hash * 31 + segmentId.charCodeAt(j)) & 0xffffffff;
  }
  return ((Math.abs(hash) * (i + 1) * 17) % 30 - 15) / 100;
}

/* ── Prediction hesabı ───────────────────────────────────────── */

/**
 * Belirli bir segment, gün ve saat için tahmin üretir.
 * Önce cache'e bakar; yoksa hesaplar ve cache'e yazar.
 */
export function getPrediction(
  segmentId: string,
  dayOfWeek: number,   // 0–6
  hour:      number,   // 0–23
): HourlyPrediction {
  const cached = getCachedPrediction(segmentId, dayOfWeek, hour);
  if (cached) return cached;

  const safeDay  = Math.max(0, Math.min(6, dayOfWeek));
  const safeHour = Math.max(0, Math.min(23, hour));
  const base     = DENSITY_MATRIX[safeDay]![safeHour] ?? 0.3;
  const variation = _locationVariation(segmentId, safeHour);
  const density  = Math.max(0, Math.min(1, base + variation));
  const level    = levelFromDensity(density);

  const prediction: HourlyPrediction = {
    segmentId,
    hour:        safeHour,
    dayOfWeek:   safeDay,
    level,
    avgSpeedKmh: refSpeedKmh(level),
    sampleCount: 0, // historical = gözlem sayısız tahmin
  };

  setCachedPrediction(prediction);
  return prediction;
}

/**
 * Anlık tahmin — şu anki saat + gün kullanılır.
 */
export function getCurrentPrediction(segmentId: string): HourlyPrediction {
  const now = new Date();
  return getPrediction(segmentId, now.getDay(), now.getHours());
}

/* ── Segment bazlı trafik state üreteci ─────────────────────── */

/**
 * İki koordinat + anlık tahmin → SegmentTrafficState.
 * trafficEngine.ts bu fonksiyonu veri yoksa fallback olarak kullanır.
 */
export function predictSegmentState(
  start: LatLng,
  end:   LatLng,
): SegmentTrafficState {
  const segmentId  = makeSegmentId(start, end);
  const prediction = getCurrentPrediction(segmentId);
  const speedKmh   = prediction.avgSpeedKmh;

  // Segment uzunluğunu Haversine ile tahmin et
  const lengthM    = _haversineM(start, end);
  // Beklenen süre (s) = mesafe / hız — referans hıza göre gecikme farkı
  const freeSpeedS   = (lengthM / 1000) / 80 * 3600;
  const actualSpeedS = (lengthM / 1000) / Math.max(1, speedKmh) * 3600;
  const delaySec     = Math.max(0, Math.round(actualSpeedS - freeSpeedS));

  return {
    segmentId,
    level:            prediction.level,
    avgSpeedKmh:      speedKmh,
    expectedDelaySec: delaySec,
    confidence:       0.55, // historical: orta güven
    source:           'historical',
    timestampMs:      Date.now(),
  };
}

/* ── Bir rota için toplu tahmin ──────────────────────────────── */

/**
 * Rota koordinat listesinden (OSRM format: [lon, lat][]) segment
 * bazlı trafik state listesi üretir.
 *
 * @param osrmCoords OSRM [lon, lat] formatında koordinat dizisi
 * @param maxSegments Hesaplanacak maksimum segment sayısı (performans sınırı)
 */
export function predictRouteSegments(
  osrmCoords: [number, number][],
  maxSegments = 50,
): SegmentTrafficState[] {
  const result: SegmentTrafficState[] = [];
  const limit = Math.min(osrmCoords.length - 1, maxSegments);

  for (let i = 0; i < limit; i++) {
    const [sLon, sLat] = osrmCoords[i]!;
    const [eLon, eLat] = osrmCoords[i + 1]!;
    const start = { lat: sLat, lng: sLon };
    const end   = { lat: eLat, lng: eLon };

    // Çok kısa segmentleri atla (< 20m — OSRM artefakt koordinatları)
    if (_haversineM(start, end) < 20) continue;

    result.push(predictSegmentState(start, end));
  }

  return result;
}

/* ── Haversine (yerel — platform dışına bağımlılık yok) ─────── */

function _haversineM(a: LatLng, b: LatLng): number {
  const R    = 6_371_000;
  const dLat = (b.lat - a.lat) * (Math.PI / 180);
  const dLng = (b.lng - a.lng) * (Math.PI / 180);
  const h    =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * (Math.PI / 180)) *
    Math.cos(b.lat * (Math.PI / 180)) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}
