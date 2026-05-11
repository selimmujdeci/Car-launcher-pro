/**
 * Vehicle Interpolation Utils
 * 60 FPS akıcı araç hareketi için hesaplama yardımcıları.
 */

/** Lineer Interpolation (LERP) */
export function lerp(start: number, end: number, t: number): number {
  return start + (end - start) * t;
}

/** 
 * Açısal Interpolation (Açıların 0/360 geçişini akıllıca yönetir) 
 */
export function lerpAngle(a: number, b: number, t: number): number {
  const diff = ((b - a + 180) % 360) - 180;
  return (a + diff * t + 360) % 360;
}

export interface NavPoint {
  lat: number;
  lng: number;
  heading: number;
  ts: number;
}

/**
 * İki nokta arasında zaman damgasına göre ara değer hesaplar.
 * @param p1 Başlangıç noktası
 * @param p2 Bitiş noktası
 * @param nowMs Mevcut zaman (performance.now())
 */
export function interpolateNavPoint(p1: NavPoint, p2: NavPoint, nowMs: number): NavPoint {
  const duration = p2.ts - p1.ts;
  if (duration <= 0) return p2;

  // t [0, 1] aralığında ilerleme
  let t = (nowMs - p1.ts) / duration;
  
  // Ekstrapolasyon (GPS gecikirse son yöne doğru biraz daha ilerlet)
  // Maksimum 1.5 saniye ekstrapolasyon yap, sonra durdur (zombi hareket önleme)
  if (t > 1) t = Math.min(t, 2.5); 
  if (t < 0) t = 0;

  return {
    lat: lerp(p1.lat, p2.lat, t),
    lng: lerp(p1.lng, p2.lng, t),
    heading: lerpAngle(p1.heading, p2.heading, t),
    ts: nowMs,
  };
}
