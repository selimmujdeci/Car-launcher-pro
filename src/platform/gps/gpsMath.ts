/** 0–360° aralığında en kısa yayı kullanarak açı interpolasyonu */
export function _lerpAngle(a: number, b: number, t: number): number {
  const diff = ((b - a + 540) % 360) - 180; // -180..+180
  return (a + diff * t + 360) % 360;
}

export function _clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/** İki nokta arası ileri azimut (bearing) — 0–360°, p1→p2 yönü.
 *  Araç "course over ground" hesabı için: GPS bearing'i yoksa konum farkından yön. */
export function _bearingDeg(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δλ = ((lng2 - lng1) * Math.PI) / 180;
  const y  = Math.sin(Δλ) * Math.cos(φ2);
  const x  = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/** Haversine mesafesi (metre) — ekvatorden uzaklaşınca doğru sonuç verir */
export function _haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R  = 6_371_000;
  const dL = ((lat2 - lat1) * Math.PI) / 180;
  const dG = ((lng2 - lng1) * Math.PI) / 180;
  const a  = Math.sin(dL / 2) ** 2 +
             Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) *
             Math.sin(dG / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
