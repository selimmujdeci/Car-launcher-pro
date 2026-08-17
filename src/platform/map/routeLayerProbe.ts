/**
 * routeLayerProbe.ts — rota katman yığınının SALT-OKUNUR paint fotoğrafı (#623).
 *
 * NEDEN VAR: #622'de cihazda ölçüldü ki gece rotası ekranda hâlâ soluk
 * (çekirdek lum 0,128–0,184; hedef 0,42) — ama kök TEŞHİS EDİLEMEDİ, çünkü
 * `apk:safe` artefaktında CDP kapalıdır ve MapLibre'nin GERÇEK paint değerleri
 * cihazdan okunamıyordu. Ekran görüntüsünden piksel okumak SONUCU gösterir,
 * SEBEBİ göstermez. Bu modül sebebi görünür kılar.
 *
 * ── PAZARLIKSIZ SINIRLAR ────────────────────────────────────────────────────
 *  · SALT-OKUNUR: hiçbir `setPaintProperty` / `addLayer` / `setData` çağrılmaz.
 *  · Haritayı OLUŞTURMAZ, stil YÜKLETMEZ, rota ÇİZDİRMEZ.
 *  · Her okuma try/catch içinde; kaynak patlarsa alan `null` → ekran
 *    UNAVAILABLE gösterir (uydurma YOK — sahte 0 / sahte renk YASAK).
 *  · Zaman damgası GERÇEK duvar saatidir (`Date.now`); yoksa bayatlık
 *    HESAPLANMAZ.
 *  · Bounded: yalnız 5 katman × sabit sayıda skaler alan. Geometri, koordinat,
 *    rota noktaları, adres KOPYALANMAZ (gizlilik + bellek).
 */

import type { Map as MapLibreMap } from 'maplibre-gl';
import {
  ROUTE_SHADOW, ROUTE_GLOW_SEL, ROUTE_CASE, SEL_LAYER, ROUTE_FLOW, SEL_SRC,
} from './_mapState';

/** Rota yığınının z-sırası (alt → üst) — kurulum sırasıyla AYNI olmalıdır. */
export const ROUTE_LAYER_ORDER: readonly string[] = [
  ROUTE_SHADOW, ROUTE_GLOW_SEL, ROUTE_CASE, SEL_LAYER, ROUTE_FLOW,
] as const;

/** Tek bir rota katmanının okunmuş paint gerçeği. */
export interface RouteLayerPaintProbe {
  readonly id: string;
  readonly present: boolean;
  /** `map.getStyle().layers` içindeki sıra — z-order kanıtı. Bilinmiyorsa null. */
  readonly zIndex: number | null;
  /** `line-color` düz renk olarak okunabildiyse; ifade/okunamadıysa null. */
  readonly lineColor: string | null;
  /** `line-color` bir İFADE ise true (düz renk değil). */
  readonly lineColorIsExpression: boolean;
  /** `line-color` hiç ayarlanmamışsa true → MapLibre VARSAYILANI (#000000) kullanır. */
  readonly lineColorUnset: boolean;
  readonly hasGradient: boolean;
  /** Gradient ifadesinden süzülen renk durakları (en çok 8). */
  readonly gradientStops: readonly string[];
  readonly lineOpacity: number | null;
  readonly lineBlur: number | null;
  /** `line-width` ifade mi düz sayı mı — kalınlık politikası ifadeyle gelir. */
  readonly widthIsExpression: boolean;
  readonly widthValue: number | null;
}

/** Tüm yığının tek seferlik fotoğrafı. */
export interface RouteLayerProbe {
  readonly capturedAt: number;
  /** Fotoğrafı ne tetikledi — 'geometry' | 'color' | 'manual'. */
  readonly reason: string;
  readonly mapPresent: boolean;
  readonly styleLoaded: boolean;
  /** `perf-low` sınıfı CANLI okunur (#599: çalışma anında değişebilir). */
  readonly perfLow: boolean;
  readonly sourcePresent: boolean;
  /** `line-gradient` için ZORUNLU. null = stil okunamadı. */
  readonly sourceLineMetrics: boolean | null;
  readonly layers: readonly RouteLayerPaintProbe[];
}

/** Boş/başarısız okuma için TEK şablon — hidden class kararlılığı (V8). */
const EMPTY_LAYER_PROBE: RouteLayerPaintProbe = {
  id: '',
  present: false,
  zIndex: null,
  lineColor: null,
  lineColorIsExpression: false,
  lineColorUnset: false,
  hasGradient: false,
  gradientStops: [],
  lineOpacity: null,
  lineBlur: null,
  widthIsExpression: false,
  widthValue: null,
};

function _safe<T>(fn: () => T): T | null {
  try {
    const v = fn();
    return v === undefined ? null : v;
  } catch {
    return null;
  }
}

/** Bir ifadeden renk benzeri string'leri süz (en çok 8) — bounded. */
function _extractColorStops(expr: unknown): string[] {
  const out: string[] = [];
  if (!Array.isArray(expr)) return out;
  for (const item of expr) {
    if (typeof item === 'string' && (item.startsWith('#') || item.startsWith('rgb'))) {
      out.push(item);
      if (out.length >= 8) break;
    }
  }
  return out;
}

function _probeLayer(map: MapLibreMap, id: string, order: readonly string[] | null): RouteLayerPaintProbe {
  const present = _safe(() => !!map.getLayer(id)) === true;
  if (!present) return { ...EMPTY_LAYER_PROBE, id };

  const rawColor = _safe(() => map.getPaintProperty(id, 'line-color'));
  const rawGrad  = _safe(() => map.getPaintProperty(id, 'line-gradient'));
  const rawOpa   = _safe(() => map.getPaintProperty(id, 'line-opacity'));
  const rawBlur  = _safe(() => map.getPaintProperty(id, 'line-blur'));
  const rawWidth = _safe(() => map.getPaintProperty(id, 'line-width'));

  const colorIsExpr = Array.isArray(rawColor);
  const zIdx = order ? order.indexOf(id) : -1;

  return {
    id,
    present: true,
    zIndex: zIdx >= 0 ? zIdx : null,
    lineColor: typeof rawColor === 'string' ? rawColor : null,
    lineColorIsExpression: colorIsExpr,
    /* MapLibre ayarlanmamış paint için undefined döner → `_safe` null'a çevirir.
       Bu AYRIMI korumak şart: "ayarlanmamış" demek, çizimde VARSAYILAN (#000000)
       kullanılıyor demektir — sahte bir renk uydurmak yerine bunu beyan ederiz. */
    lineColorUnset: rawColor === null && !colorIsExpr,
    hasGradient: rawGrad !== null,
    gradientStops: _extractColorStops(rawGrad),
    lineOpacity: typeof rawOpa === 'number' ? rawOpa : null,
    lineBlur: typeof rawBlur === 'number' ? rawBlur : null,
    widthIsExpression: Array.isArray(rawWidth),
    widthValue: typeof rawWidth === 'number' ? rawWidth : null,
  };
}

/**
 * Haritadan TEK seferlik fotoğraf çek. Harita yoksa `mapPresent:false` döner —
 * çağıran bunu UNAVAILABLE olarak gösterir.
 */
export function captureRouteLayerProbe(map: MapLibreMap | null, reason: string): RouteLayerProbe {
  const capturedAt = Date.now();
  const perfLow = _safe(() =>
    typeof document !== 'undefined' &&
    document.documentElement.classList.contains('perf-low')) === true;

  if (!map) {
    return {
      capturedAt, reason,
      mapPresent: false, styleLoaded: false, perfLow,
      sourcePresent: false, sourceLineMetrics: null, layers: [],
    };
  }

  const styleLoaded = _safe(() => map.isStyleLoaded()) === true;
  const style = _safe(() => map.getStyle());
  const order = style && Array.isArray(style.layers)
    ? style.layers.map((l) => l.id)
    : null;

  /* `lineMetrics` yalnız stil sözlüğünden okunabilir (GeoJSONSource nesnesinde
     genel bir getter'ı yok). Kaynak yoksa/okunamazsa null → UNAVAILABLE. */
  const srcSpec = style && style.sources ? style.sources[SEL_SRC] : undefined;
  const sourcePresent = _safe(() => !!map.getSource(SEL_SRC)) === true;
  let sourceLineMetrics: boolean | null = null;
  if (srcSpec && typeof srcSpec === 'object' && 'lineMetrics' in srcSpec) {
    const lm = (srcSpec as { lineMetrics?: unknown }).lineMetrics;
    sourceLineMetrics = typeof lm === 'boolean' ? lm : null;
  } else if (srcSpec) {
    /* Kaynak VAR ama `lineMetrics` alanı YOK → MapLibre varsayılanı `false`
       demektir. Bu, `line-gradient` için sessiz ölüm koşuludur; beyan edilir. */
    sourceLineMetrics = false;
  }

  return {
    capturedAt, reason,
    mapPresent: true,
    styleLoaded,
    perfLow,
    sourcePresent,
    sourceLineMetrics,
    layers: ROUTE_LAYER_ORDER.map((id) => _probeLayer(map, id, order)),
  };
}

/* ── Son fotoğrafın saklanması ──────────────────────────────────────────────
 * LAB ekranı açıldığında tam ekran harita UNMOUNT olmuş olabilir (harita örneği
 * geçişlerde yeniden yaratılıyor — #614'te ölçüldü). O yüzden rota BOYANDIĞI
 * ANDA alınan fotoğraf saklanır ve LAB onu STALE damgasıyla gösterebilir.
 * Tek nesne — büyümez, geçmiş tutulmaz. */
let _lastProbe: RouteLayerProbe | null = null;

/** Fotoğrafı sakla (yalnız probe modülünün kendi yazdığı alan). */
export function rememberRouteLayerProbe(p: RouteLayerProbe): void {
  _lastProbe = p;
}

/** Son saklanan fotoğraf — hiç alınmadıysa null. */
export function getLastRouteLayerProbe(): RouteLayerProbe | null {
  return _lastProbe;
}

/** Test yalıtımı — üretim yolunda ÇAĞRILMAZ. */
export function _resetRouteLayerProbeForTest(): void {
  _lastProbe = null;
}
