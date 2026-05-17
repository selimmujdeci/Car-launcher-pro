/** 0–360° aralığında en kısa yayı kullanarak açı interpolasyonu */
export function _lerpAngle(a: number, b: number, t: number): number {
  const diff = ((b - a + 540) % 360) - 180; // -180..+180
  return (a + diff * t + 360) % 360;
}

export function _clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
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
