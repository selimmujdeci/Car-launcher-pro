import { _lerpAngle, _clamp01 } from './gpsMath';

// ── Heading blend eşikleri ────────────────────────────────────
// < COMPASS_ONLY_KMH → %100 pusula
// > GPS_ONLY_KMH     → %100 GPS course
// arasında → kademeli lerp
export const COMPASS_ONLY_KMH = 3;
export const GPS_ONLY_KMH     = 10;
/** Çıktı low-pass ağırlığı: 0.35 @2s tick ≈ 4 güncellemede %90 yakınsama */
export const HEADING_SMOOTH_α = 0.35;
/** Pusula low-pass ağırlığı: 0.25 @60 Hz ≈ ~67 ms gecikme */
export const COMPASS_SMOOTH_α = 0.25;

/**
 * Ham pusula okumasını mevcut smooth değere uygular.
 * İlk okumada (currentCompass === null) yeni değeri doğrudan döner.
 */
export function applyCompassSmoothing(
  currentCompass: number | null,
  newReading: number,
): number {
  return currentCompass === null
    ? newReading
    : _lerpAngle(currentCompass, newReading, COMPASS_SMOOTH_α);
}

export interface BlendedHeadingResult {
  /** 0.1° hassasiyetinde blended+smoothed heading; kaynak yoksa null */
  heading: number | null;
  /** Bir sonraki çağrıya aktarılacak smoothed değer */
  nextSmoothed: number | null;
}

/**
 * GPS course ve pusula başlığını hıza göre harmanlayıp tek heading döner.
 * Tamamen saf — DOM, Window veya store'a dokunmaz.
 *
 * @param gpsBearing         coords.heading (0–360°) veya null
 * @param speedMs            Anlık hız m/s
 * @param compassHeading     Son smooth edilmiş pusula değeri veya null
 * @param prevSmoothedHeading Bir önceki çıktının nextSmoothed değeri veya null
 */
export function computeBlendedHeading(
  gpsBearing: number | null,
  speedMs: number,
  compassHeading: number | null,
  prevSmoothedHeading: number | null,
): BlendedHeadingResult {
  const speedKmh = speedMs * 3.6;
  const hasGPS   = gpsBearing !== null && Number.isFinite(gpsBearing);
  const hasCmps  = compassHeading !== null;

  let raw: number | null = null;

  if (speedKmh <= COMPASS_ONLY_KMH) {
    raw = hasCmps ? compassHeading : (hasGPS ? gpsBearing : null);
  } else if (speedKmh >= GPS_ONLY_KMH) {
    raw = hasGPS ? gpsBearing : (hasCmps ? compassHeading : null);
  } else {
    const α = _clamp01((speedKmh - COMPASS_ONLY_KMH) / (GPS_ONLY_KMH - COMPASS_ONLY_KMH));
    if (hasGPS && hasCmps)      raw = _lerpAngle(compassHeading!, gpsBearing!, α);
    else if (hasGPS)            raw = gpsBearing;
    else if (hasCmps)           raw = compassHeading;
  }

  if (raw === null) return { heading: null, nextSmoothed: prevSmoothedHeading };

  const nextSmoothed = prevSmoothedHeading === null
    ? raw
    : _lerpAngle(prevSmoothedHeading, raw, HEADING_SMOOTH_α);

  return {
    heading:     Math.round(nextSmoothed * 10) / 10, // 0.1° hassasiyet
    nextSmoothed,
  };
}
