/**
 * routeVisibilityProbe.ts — "rota EKRANDA gerçekten var mı" ölçümü (#625).
 *
 * ── NEDEN VAR (cihazda ÖLÇÜLDÜ, 2026-08-18 07:31, Xiaomi 23090RA98I) ────────
 * #623'ün kökünü ararken `routeLayerProbe` (paint denetçisi) gece rotasının
 * boyasını KUSURSUZ okudu: kılıf `#f59e0b` · çekirdek gradient
 * `#79b0ff → #a5aaff → #34d399` · `line-opacity` 1,00 · blur YOK ·
 * kaynak `lineMetrics: true` · z-sırası 31<32<33<34<35. `#79b0ff`in WCAG
 * bağıl parlaklığı **0,424** — #622'nin hedeflediği 0,42'nin birebir kendisi.
 * Yani boya doğruydu. Ama aynı karede MapLibre'nin çizdiği rota özelliği sayısı
 * **5 katmanın hepsinde 0** ve rotanın **309 noktasının 0'ı** görüş alanındaydı:
 * araç ekranda (451,301), rotanın ilk noktası (465,**432**) — pencere yalnız
 * 902×405. Rota ekranın 27 px ALTINDA kalıyordu, çünkü kamera −42,5°
 * (kuzeybatı) bakarken rota güneybatıya gidiyordu.
 *
 * DERS: "paint doğru" ile "ekranda görünüyor" AYNI ŞEY DEĞİLDİR. Paint
 * denetçisi tek başına bu kökü YAPISAL OLARAK göremez — hiçbir kuralı
 * tetiklenmez ve "kök adayı yok" der. Bu modül o kör noktayı kapatır.
 *
 * ── PAZARLIKSIZ SINIRLAR ────────────────────────────────────────────────────
 *  · SALT-OKUNUR: hiçbir `setPaintProperty` / `setData` / kamera çağrısı yok.
 *    Haritayı OLUŞTURMAZ, stil YÜKLETMEZ, rota ÇİZDİRMEZ.
 *  · BOUNDED: geometri yankısı en çok `ROUTE_GEOM_SAMPLE_MAX` noktadır; ham
 *    rota KOPYALANMAZ (bellek + gizlilik). Ekrana koordinat GİTMEZ — yalnız
 *    sayımlar ve açılar dışarı verilir.
 *  · Her okuma try/catch; ölçülemeyen alan `null` → çağıran UNAVAILABLE gösterir.
 *    Sahte 0 / sahte "görünüyor" ÜRETİLMEZ.
 *  · PAHALI iş (MapLibre `queryRenderedFeatures`) YALNIZ açıkça istenince
 *    çalışır (`withRendered`) — sıcak yol (renk yazımı) bunu ASLA istemez.
 */

import type { Map as MapLibreMap } from 'maplibre-gl';
import { ROUTE_SHADOW, ROUTE_GLOW_SEL, ROUTE_CASE, SEL_LAYER, ROUTE_FLOW } from './_mapState';

/** Geometri yankısının üst sınırı — ham rota asla kopyalanmaz. */
export const ROUTE_GEOM_SAMPLE_MAX = 64;

/**
 * Ufuk-ötesi koruması: eğik kamerada (`pitch > 0`) kameranın ARKASINDA kalan
 * noktalar da ekran koordinatı üretir ve yanlışlıkla "içeride" sayılabilir.
 * `unproject(project(p))` gidiş-dönüşü bu noktalarda ORİJİNALE dönmez; sapma
 * bu kadar pikselin metre karşılığını aşarsa nokta "ekranda değil" sayılır.
 */
const ROUNDTRIP_TOLERANCE_PX = 4;

/** Rotanın "başı" — kameranın kaybetmemesi gereken kısım (örnek yüzdesi). */
const HEAD_FRACTION = 0.25;

/** Rota katman yığını — render kanıtı bu katmanlardan toplanır. */
const ROUTE_LAYERS: readonly string[] = [
  ROUTE_SHADOW, ROUTE_GLOW_SEL, ROUTE_CASE, SEL_LAYER, ROUTE_FLOW,
] as const;

function _safe<T>(fn: () => T): T | null {
  try {
    const v = fn();
    return v === undefined ? null : v;
  } catch {
    return null;
  }
}

/** Haritaya YAZILMIŞ rota geometrisinin bounded yankısı. */
export interface RouteGeometryEcho {
  /** Yankının alındığı an (duvar saati) — bayatlık bunun üzerinden ölçülür. */
  readonly at: number;
  /** Haritaya yazılan TOPLAM nokta sayısı (örnekleme öncesi). */
  readonly totalPoints: number;
  /** Bounded örnek — ilk ve son nokta DAİMA dâhildir. */
  readonly sample: readonly (readonly [number, number])[];
}

/** Tek seferlik görünürlük ölçümü. Ölçülemeyen alan `null`. */
export interface RouteVisibilitySample {
  readonly capturedAt: number;
  /** Geometri yankısının yaşı (ms) — yankı yoksa null. */
  readonly geometryAgeMs: number | null;
  readonly viewportW: number | null;
  readonly viewportH: number | null;
  readonly zoom: number | null;
  readonly pitch: number | null;
  readonly bearing: number | null;
  /** Haritaya yazılan toplam nokta (yankıdan). */
  readonly totalPoints: number | null;
  /** Projeksiyonu ölçülen örnek sayısı. */
  readonly sampled: number | null;
  /** Bu örneklerin kaçı görüş alanının İÇİNDE (ufuk-ötesi elenmiş). */
  readonly onScreen: number | null;
  /** Rotanın BAŞ kısmından ölçülen örnek sayısı. */
  readonly headSampled: number | null;
  /** Baş kısmından kaçı görüş alanında — "önümdeki yol görünüyor mu". */
  readonly headOnScreen: number | null;
  /** Rotanın baş yönü (derece 0..360) — örnek seyrek olduğu için gürültüsüz. */
  readonly routeBearing: number | null;
  /** |rota yönü − kamera yönü| en kısa açı (0..180). */
  readonly bearingDeltaDeg: number | null;
  /**
   * MapLibre'nin GERÇEKTEN çizdiği rota özelliği sayısı (OBSERVED).
   * `withRendered` istenmediyse null — türetilen `onScreen` ile birlikte
   * okunduğunda ikisi birbirini DENETLER (çelişki kendini ele verir).
   */
  readonly renderedFeatures: number | null;
}

/* ── Geometri yankısı ───────────────────────────────────────────────────────
 * Rota geometrisinin haritadaki TEK yazıcısı `MapLayerManager`dır (kurulum
 * `setData` + kat edilen kısmın kırpılması). Yankı ORADAN alınır; stili
 * `getStyle()` ile serialize etmek 36 katmanı + tüm kaynakları kopyalar ve
 * ölçüm yolunu ürün yolundan pahalı hâle getirirdi. */
let _echo: RouteGeometryEcho | null = null;

/**
 * Haritaya yazılan geometriyi yankıla — bounded örnekleme, tek geçiş.
 * Boş/kısa geometri yankıyı TEMİZLER (rota kaldırıldı demektir).
 */
export function rememberRouteGeometry(
  coords: readonly (readonly [number, number])[] | null | undefined,
  nowMs: number,
): void {
  if (!coords || coords.length < 2) { _echo = null; return; }
  const n = coords.length;
  const sample: (readonly [number, number])[] = [];
  if (n <= ROUTE_GEOM_SAMPLE_MAX) {
    for (let i = 0; i < n; i++) sample.push(coords[i]);
  } else {
    /* Son nokta için bir yer ayrılır → adım (MAX-1) aralığa bölünür. */
    const step = (n - 1) / (ROUTE_GEOM_SAMPLE_MAX - 1);
    for (let k = 0; k < ROUTE_GEOM_SAMPLE_MAX - 1; k++) {
      sample.push(coords[Math.round(k * step)]);
    }
    sample.push(coords[n - 1]);
  }
  _echo = { at: nowMs, totalPoints: n, sample };
}

/** Son yankı — hiç yazılmadıysa/temizlendiyse null. */
export function getRouteGeometryEcho(): RouteGeometryEcho | null {
  return _echo;
}

/** Test yalıtımı — üretim yolunda ÇAĞRILMAZ. */
export function _resetRouteGeometryEchoForTest(): void {
  _echo = null;
}

/* ── Ölçüm ────────────────────────────────────────────────────────────────── */

/** İki açının en kısa farkı (0..180). */
export function angleDelta(a: number, b: number): number {
  const d = (((a - b) % 360) + 540) % 360 - 180;
  return Math.abs(d);
}

/** Bir zoom/enlemde bir CSS pikselinin metre karşılığı (Web Mercator). */
export function metersPerPixel(zoom: number, latDeg: number): number {
  return (156543.03392 * Math.cos((latDeg * Math.PI) / 180)) / Math.pow(2, zoom);
}

/** İki lng/lat arası kaba düzlemsel mesafe (metre) — ölçüm toleransı için yeter. */
function _roughMeters(a: readonly [number, number], b: readonly [number, number]): number {
  const dLat = (b[1] - a[1]) * 110_540;
  const dLng = (b[0] - a[0]) * 111_320 * Math.cos((a[1] * Math.PI) / 180);
  return Math.sqrt(dLat * dLat + dLng * dLng);
}

/** Boş ölçüm — TEK şablon (hidden class kararlılığı, V8). */
const EMPTY_SAMPLE: RouteVisibilitySample = {
  capturedAt: 0,
  geometryAgeMs: null,
  viewportW: null,
  viewportH: null,
  zoom: null,
  pitch: null,
  bearing: null,
  totalPoints: null,
  sampled: null,
  onScreen: null,
  headSampled: null,
  headOnScreen: null,
  routeBearing: null,
  bearingDeltaDeg: null,
  renderedFeatures: null,
};

/**
 * Rotanın ekranda olup olmadığını ÖLÇ. Harita ya da geometri yankısı yoksa
 * sayımlar `null` kalır — "0 görünüyor" ile "ölçemedim" ASLA karıştırılmaz.
 *
 * @param withRendered `queryRenderedFeatures` de çalıştırılsın mı (PAHALI).
 */
export function captureRouteVisibility(
  map: MapLibreMap | null,
  nowMs: number,
  withRendered = false,
): RouteVisibilitySample {
  const echo = _echo;
  const geometryAgeMs = echo ? Math.max(0, nowMs - echo.at) : null;

  if (!map) return { ...EMPTY_SAMPLE, capturedAt: nowMs, geometryAgeMs };

  const container = _safe(() => map.getContainer());
  const viewportW = container ? _safe(() => container.clientWidth) : null;
  const viewportH = container ? _safe(() => container.clientHeight) : null;
  const zoom    = _safe(() => map.getZoom());
  const pitch   = _safe(() => map.getPitch());
  const bearing = _safe(() => map.getBearing());

  let renderedFeatures: number | null = null;
  if (withRendered) {
    renderedFeatures = _safe(() => {
      /* Yalnız var olan katmanlar sorulur: MapLibre bilinmeyen katman
         kimliğinde throw eder ve tek eksik katman ölçümün TAMAMINI düşürürdü. */
      const present = ROUTE_LAYERS.filter((id) => !!map.getLayer(id));
      if (present.length === 0) return 0;
      return map.queryRenderedFeatures({ layers: present as string[] }).length;
    });
  }

  if (!echo || viewportW === null || viewportH === null || viewportW <= 0 || viewportH <= 0) {
    return {
      ...EMPTY_SAMPLE,
      capturedAt: nowMs, geometryAgeMs,
      viewportW, viewportH, zoom, pitch, bearing,
      totalPoints: echo ? echo.totalPoints : null,
      renderedFeatures,
    };
  }

  const pts = echo.sample;
  const tolM = zoom !== null
    ? ROUNDTRIP_TOLERANCE_PX * metersPerPixel(zoom, pts[0][1]) + 1
    : Number.POSITIVE_INFINITY;

  const headCount = Math.max(1, Math.round(pts.length * HEAD_FRACTION));
  let onScreen = 0;
  let headOnScreen = 0;

  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = _safe(() => map.project(p as [number, number]));
    if (!q) continue;
    if (q.x < 0 || q.y < 0 || q.x > viewportW || q.y > viewportH) continue;
    /* Ufuk-ötesi eleme: eğik kamerada kameranın arkasındaki noktalar da ekran
       koordinatı üretir; gidiş-dönüş orijinale dönmezse nokta gerçekte
       çizilmiyordur. Tolerans ölçülemezse nokta SAYILMAZ (fail-closed). */
    const back = _safe(() => map.unproject([q.x, q.y]));
    if (!back) continue;
    if (!Number.isFinite(tolM) || _roughMeters(p, [back.lng, back.lat]) > tolM) continue;
    onScreen++;
    if (i < headCount) headOnScreen++;
  }

  /* Rotanın baş yönü — örnekleme seyrek olduğu için iki komşu ÖRNEK arasındaki
     yön yüzlerce metrelik bir taban kullanır ve GPS gürültüsü taşımaz. */
  let routeBearing: number | null = null;
  if (pts.length >= 2) {
    const a = pts[0], b = pts[1];
    const dLat = (b[1] - a[1]) * 110_540;
    const dLng = (b[0] - a[0]) * 111_320 * Math.cos((a[1] * Math.PI) / 180);
    if (Math.sqrt(dLat * dLat + dLng * dLng) > 1) {
      let deg = (Math.atan2(dLng, dLat) * 180) / Math.PI;
      if (deg < 0) deg += 360;
      routeBearing = deg;
    }
  }

  const bearingDeltaDeg = routeBearing !== null && bearing !== null
    ? angleDelta(routeBearing, bearing)
    : null;

  return {
    capturedAt: nowMs,
    geometryAgeMs,
    viewportW, viewportH, zoom, pitch, bearing,
    totalPoints: echo.totalPoints,
    sampled: pts.length,
    onScreen,
    headSampled: headCount,
    headOnScreen,
    routeBearing,
    bearingDeltaDeg,
    renderedFeatures,
  };
}
