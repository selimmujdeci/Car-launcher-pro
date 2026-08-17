/**
 * routeTrimGate — "kat edilen rotayı ne zaman yeniden çizmeli" kararının SAF katmanı.
 *
 * Bu dosya SAFTIR: I/O · timer · `Date.now` · `Math.random` · global durum ·
 * React importu YOKTUR. Aynı girdi her zaman aynı çıktıyı verir.
 *
 * ── KÜTÜK #601 · CİHAZDA ÖLÇÜLEN KUSUR (2026-08-16) ────────────────────────
 * Kullanıcı: *"rota arkasına siliniyor ama geç kalıyor; aracın arkası mavi
 * olmamalı."*
 *
 * ÖLÇÜLEN KÖK: hem `FullMapView` hem `MiniMapWidget` kırpmayı YALNIZ rota
 * **segment indeksi değişince** çiziyordu:
 *
 *     if (prog.segIdx !== lastTrimSegRef.current) { trimRouteGeometry(...) }
 *
 * Yani araç bir segmentin İÇİNDE ilerlerken çizgi, o segmente GİRDİĞİ noktada
 * kalıyordu. Şehir içinde segmentler kısa olduğu için kusur görünmüyordu
 * (#570'te Siverek rotasında segmentlerin %23'ü <5 m ölçülmüştü); ama
 * OTOYOLDA segmentler uzundur.
 *
 * Adana-Şanlıurfa Otoyolu · Gaziantep→Mersin · 277,1 km · 2711 segment
 * (OSRM `overview=full`), 115 km/h'te ölçülen GECİKME:
 *
 *     segment p50  88 m →  2,8 s        p90 188 m →  5,9 s
 *     segment p99 340 m → 10,6 s        MAX 1956 m → 61,2 s
 *
 * Yani en kötü durumda araç, arkasında ~2 km boyanmış rotayla bir dakika
 * boyunca ilerliyordu.
 *
 * ── DÜZELTME: dedup ANAHTARI segment değil, KAT EDİLEN MESAFE ──────────────
 * Segment değişimi hâlâ tetikler (ucuz ve doğru), ek olarak snap noktası
 * `ROUTE_TRIM_ADVANCE_M`den fazla ilerlediyse de tetikler.
 *
 * ── EŞİK NEDEN 25 m (tahmin değil, ÖLÇÜM) ──────────────────────────────────
 * Eşiğin amacı hız sınırlamak DEĞİLDİR — çağrı zaten GPS fix tick'ine bağlı
 * ve o cihazda **1,06 Hz** ölçüldü (60 örnek). Yani en kötü ihtimalle saniyede
 * BİR `setData` olur; karşılaştırma için `updateUserMarker` aynı source deseniyle
 * ~16 Hz yazar ve sorunsuz çalışır (#572'de kanıtlandı). Eşiğin gerçek amacı
 * **duran araçta GPS drift'inin boşuna çizim tetiklemesini** engellemektir:
 * aynı sürüşte GPS doğruluğu **1,6–2,2 m** ölçüldü; 25 m bu gürültünün ~10 katıdır.
 * 115 km/h'te 25 m ≈ 0,8 s → çizgi fiilen aracın arkasına yapışır.
 */

/**
 * Snap noktası bu mesafeden fazla ilerlediyse, segment değişmese bile rota
 * yeniden kırpılır. Gerekçe için dosya başlığına bakın.
 */
export const ROUTE_TRIM_ADVANCE_M = 25;

/** Son kırpmanın işareti. `geom` REFERANS kimliği taşır (reroute tespiti). */
export interface RouteTrimMark {
  /** Son kırpmada kullanılan rota segment indeksi; hiç kırpılmadıysa -1. */
  readonly segIdx: number;
  /** Son kırpmadaki snap noktası boylamı; hiç kırpılmadıysa null. */
  readonly lon: number | null;
  /** Son kırpmadaki snap noktası enlemi; hiç kırpılmadıysa null. */
  readonly lat: number | null;
  /** Son kırpmada kullanılan geometri dizisinin REFERANSI (içeriği değil). */
  readonly geom: unknown;
}

/** Şu anki ilerleme durumu. */
export interface RouteTrimInput {
  readonly segIdx: number;
  readonly lon: number;
  readonly lat: number;
  readonly geom: unknown;
}

/** Hiç kırpılmamış başlangıç işareti. */
export const EMPTY_TRIM_MARK: RouteTrimMark = Object.freeze({
  segIdx: -1,
  lon: null,
  lat: null,
  geom: null,
});

/**
 * İki nokta arası büyük-daire mesafesi (m).
 * Zero-allocation: ara nesne/dizi YARATMAZ (hot-path sözleşmesi).
 */
function distanceM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLon = (lon2 - lon1) * rad;
  const s1 = Math.sin(dLat / 2);
  const s2 = Math.sin(dLon / 2);
  const a = s1 * s1 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * s2 * s2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * Rota yeniden kırpılmalı mı?
 *
 * `true` döner:
 *   1. Hiç kırpılmamışsa (ilk çizim),
 *   2. Geometri REFERANSI değiştiyse (reroute → yeni rota, hemen çiz),
 *   3. Segment indeksi değiştiyse (eski davranış — korundu),
 *   4. Snap noktası son kırpmadan bu yana `advanceM`den fazla ilerlediyse (#601).
 *
 * Geçersiz koordinat (NaN/Infinity) → `false`: uydurma veriyle çizim YAPILMAZ.
 */
export function shouldTrimRoute(
  prev: RouteTrimMark,
  next: RouteTrimInput,
  advanceM: number = ROUTE_TRIM_ADVANCE_M,
): boolean {
  if (!Number.isFinite(next.lon) || !Number.isFinite(next.lat)) return false;
  if (!Number.isFinite(next.segIdx)) return false;

  // (2) reroute — geometri referansı değişti
  if (prev.geom !== next.geom) return true;

  // (3) segment atladı
  if (prev.segIdx !== next.segIdx) return true;

  // (1) daha önce hiç kırpılmadı (segIdx eşit olsa bile konum bilinmiyor)
  if (prev.lon === null || prev.lat === null) return true;

  // (4) aynı segment içinde yeterince ilerledik mi
  return distanceM(prev.lat, prev.lon, next.lat, next.lon) >= advanceM;
}

/** Kırpma yapıldıktan sonra kaydedilecek yeni işaret. */
export function nextTrimMark(next: RouteTrimInput): RouteTrimMark {
  return { segIdx: next.segIdx, lon: next.lon, lat: next.lat, geom: next.geom };
}
