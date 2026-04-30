/**
 * spatialUtils.ts — Zero-allocation spatial math for the Eagle Eye radar engine.
 *
 * All functions operate on primitive stack values only.
 * No object creation, no closures, no GC pressure — safe for 10 Hz GPS polling.
 */

/** Pre-computed π/180 — avoids repeated division in hot path */
const DEG2RAD = Math.PI / 180;

/** WGS-84 mean Earth radius in meters */
const R_M = 6_371_000;

/**
 * Haversine great-circle distance between two GPS coordinates.
 *
 * @returns Distance in meters (always ≥ 0)
 */
export function haversineMeters(
  lat1: number, lng1: number,
  lat2: number, lng2: number,
): number {
  const φ1    = lat1 * DEG2RAD;
  const φ2    = lat2 * DEG2RAD;
  const Δφ    = (lat2 - lat1) * DEG2RAD;
  const Δλ    = (lng2 - lng1) * DEG2RAD;
  const sinΔφ = Math.sin(Δφ * 0.5);
  const sinΔλ = Math.sin(Δλ * 0.5);
  const a     = sinΔφ * sinΔφ + Math.cos(φ1) * Math.cos(φ2) * sinΔλ * sinΔλ;
  return R_M * 2.0 * Math.atan2(Math.sqrt(a), Math.sqrt(1.0 - a));
}

/**
 * Forward azimuth (bearing) from point A → point B.
 *
 * @returns Degrees in [0, 360)
 */
export function bearingDeg(
  lat1: number, lng1: number,
  lat2: number, lng2: number,
): number {
  const φ1 = lat1 * DEG2RAD;
  const φ2 = lat2 * DEG2RAD;
  const Δλ = (lng2 - lng1) * DEG2RAD;
  const y  = Math.sin(Δλ) * Math.cos(φ2);
  const x  = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return ((Math.atan2(y, x) / DEG2RAD) + 360) % 360;
}

/**
 * Shortest angular difference between two headings (wrap-safe).
 *
 * angularDiffAbs(350, 10) === 20
 * angularDiffAbs(10, 350) === 20
 *
 * @returns Degrees in [0, 180]
 */
export function angularDiffAbs(a: number, b: number): number {
  return Math.abs(((a - b + 540) % 360) - 180);
}
