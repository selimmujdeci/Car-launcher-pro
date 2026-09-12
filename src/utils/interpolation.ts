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
 *
 * ⚠️ DÜZELTİLEN GERÇEK KUSUR (NAVIGATION_MOTION_CAMERA_P0, testle yakalandı):
 * Eski gövde `((b - a + 180) % 360) - 180` idi. JavaScript'te `%` **kalan**
 * operatörüdür, matematiksel modulo DEĞİL: negatif girdide negatif döner.
 *   `lerpAngle(350, 10, 0.5)` → `(10-350+180) = -160` · `-160 % 360 = -160`
 *   → `diff = -340` → sonuç **180°**. Doğrusu 0°'dir.
 * Yani araç KUZEYE giderken (350° → 10°) işaretin yönü **tam ters dönüyordu**.
 * `lerpAngle(10, 350, 0.5)` doğru çalıştığı için kusur yalnız TEK yönde,
 * kuzey geçişinde ortaya çıkıyordu — bu yüzden bugüne kadar fark edilmedi.
 *
 * Düzeltme: farkı almadan önce gerçek modulo uygulanır.
 */
export function lerpAngle(a: number, b: number, t: number): number {
  const diff = (((b - a + 180) % 360) + 360) % 360 - 180;
  return ((a + diff * t) % 360 + 360) % 360;
}

export interface NavPoint {
  lat: number;
  lng: number;
  heading: number;
  ts: number;
}

/* ── Dead Reckoning (DR) ──────────────────────────────────────────────
 * GPS koptuğunda son bilinen noktadan OBD/GPS hız + heading ile ileri
 * projeksiyon yapan SAF matematik. rAF tick içinde gömülü olan formülün
 * birebir aynısıdır; test edilebilir olması için buraya taşındı.
 * Davranış FullMapView'daki orijinal blokla aynıdır.
 */

/**
 * DR projeksiyonu için pencere üst sınırı (saniye).
 * NAV-1 (2026-07-19): 5 → 60. Eski 5s clamp'i tünelde 5 saniye sonra projeksiyonu
 * DONDURUYORDU (araç ikonu + ETA + sesli anons takılı kalıyordu) — Türkiye tünellerinin
 * çoğu 5s'den çok uzun. 60s tipik tünelleri kapsar; hareket devam eder, GPS dönünce
 * gpsService fusion-ramp'i zaten yumuşak snap yapar. Üst sınır KORUNUR (sonsuz projeksiyon
 * yok): hız 0'ken (dur/park) distDeg=0 → ikon zaten sabit; yalnız gerçekten hareket varken
 * projeksiyon büyür ve 60s'de tavan yapar (bayat-hız edge'inde marker uçup gitmez).
 */
export const DR_MAX_DT_SEC = 60;
/** Bu süreye kadar DR "güvenilir"; üstünde "tahmini" (UI marker'ı soluklaştırıp işaretleyebilir). */
export const DR_CONFIDENT_SEC = 5;
/** Bir derece enlem ≈ bu kadar metre (WGS84 yaklaşık). */
export const DR_METERS_PER_DEG = 111_320;
/** cosLat bölme guard'ı — kutuplara yakın 0'a bölmeyi engeller. */
export const DR_COS_LAT_FLOOR = 0.001;

/**
 * DR konumu "tahmini" mi (GPS kaybı DR_CONFIDENT_SEC'i aştı)? UI bunu marker'ı soluklaştırıp
 * "~" işaretiyle göstermek için kullanabilir — kullanıcıya dürüst sinyal (kesin değil, tahmin).
 */
export function drIsEstimated(lastKnownTs: number, now: number): boolean {
  return (now - lastKnownTs) / 1000 > DR_CONFIDENT_SEC;
}

/**
 * DR için kullanılacak hızı (km/h) seçer.
 * OBD hızı > 0 ise onu tercih eder; aksi halde GPS hızına (m/s → km/h) düşer.
 * Negatif/null GPS hızları güvenli şekilde 0'a kıstırılır (ters yön projeksiyon yok).
 *
 * @param obdKmh      OBD'den gelen hız (km/h). 0/negatif ise yok sayılır.
 * @param gpsSpeedMs  Son geçerli GPS hızı (m/s) veya null.
 * @returns           Projeksiyonda kullanılacak hız (km/h), her zaman >= 0.
 */
export function resolveDrSpeed(obdKmh: number, gpsSpeedMs: number | null): number {
  if (Number.isFinite(obdKmh) && obdKmh > 0) return obdKmh;
  const gpsKmh = (gpsSpeedMs ?? 0) * 3.6;
  return Number.isFinite(gpsKmh) && gpsKmh > 0 ? gpsKmh : 0;
}

/**
 * Dead Reckoning projeksiyonu — son bilinen noktadan ileri konum tahmini.
 * s = v × t kartezyen tahmini, heading yönünde.
 *
 * Formül (FullMapView ile birebir aynı):
 *   dtSec   = min((now - lastKnown.ts) / 1000, DR_MAX_DT_SEC)
 *   distDeg = (speedKmh / 3.6) * dtSec / DR_METERS_PER_DEG
 *   headRad = lastKnown.heading * PI / 180
 *   cosLat  = max(DR_COS_LAT_FLOOR, cos(lastKnown.lat * PI / 180))
 *   drLat   = lastKnown.lat + distDeg * cos(headRad)
 *   drLng   = lastKnown.lng + distDeg * sin(headRad) / cosLat
 *
 * @param lastKnown  Son geçerli nokta {lat, lng, heading, ts}.
 * @param speedKmh   Projeksiyon hızı (km/h) — genelde resolveDrSpeed çıktısı.
 * @param now        Şu anki zaman (performance.now ile aynı time origin).
 * @returns          Tahmini {lat, lng}.
 */
export function projectDeadReckon(
  lastKnown: NavPoint,
  speedKmh: number,
  now: number,
): { lat: number; lng: number } {
  const dtSec   = Math.min((now - lastKnown.ts) / 1000, DR_MAX_DT_SEC);
  const distDeg = (speedKmh / 3.6) * dtSec / DR_METERS_PER_DEG;
  const headRad = (lastKnown.heading * Math.PI) / 180;
  const cosLat  = Math.max(DR_COS_LAT_FLOOR, Math.cos((lastKnown.lat * Math.PI) / 180));
  const drLat   = lastKnown.lat + distDeg * Math.cos(headRad);
  const drLng   = lastKnown.lng + distDeg * Math.sin(headRad) / cosLat;
  return { lat: drLat, lng: drLng };
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
