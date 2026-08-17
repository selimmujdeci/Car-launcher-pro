// ══════════════════════════════════════════════════════════════════════════
// CarOS Pro — MapLayerManager
//
// Sorumluluk: layer tanımları, addSource/removeLayer/removeSource, GeoJSON
// güncelleme mantığı, marker (rover) katmanları, rota geometrisi, mood/focus
// ve sürüş-katmanı güncellemeleri.
//
// Bu modül yalnızca _mapState (paylaşılan state + sabitler) ve dış servislere
// bağımlıdır — başka harita modülünü import ETMEZ (saf "sink"). Davranış
// değişikliği YOK; mapService.ts'ten birebir taşındı.
// ══════════════════════════════════════════════════════════════════════════
import maplibregl, { Map as MapLibreMap, GeoJSONSource, Marker } from 'maplibre-gl';
import { setMapNight } from '../mapSourceManager';
import { safeMoveLayer, safeSetPaint } from './_safeLayerOps';
import type { PaintedArrowVerdict } from './core/paintedArrowModel';
import {
  _recordPaintedArrowVerdict, _recordPaintedArrowLayer,
} from './core/paintedArrowAccess';
import {
  computeRouteWidths, routeWidthExpression, breathingGlowWidth,
  type RouteWidths,
} from './core/routeWidthModel';
import {
  resolveRouteColor, ROUTE_COLOR_POLICY_VERSION,
  type RouteColorDecision,
} from './core/routeColorModel';
import { getMapNight, getMapMode } from '../mapSourceManager';
import {
  NAV_SUPPRESS_LAYERS,
  NAV_SUPPRESS_TIERS,
  RASTER_PAINT_DAY,
  RASTER_PAINT_NIGHT,
  MAP_BG_NIGHT,
  MAP_BG_DAY,
} from '../mapStyleBuilders';
import { useHazardStore }    from '../../store/useHazardStore';
import { useSafetyStore }    from '../../store/useSafetyStore';
import { useCognitiveStore } from '../../store/useCognitiveStore';
import {
  M,
  useMapStore,
  ROVER_IMG_DAY,
  ROVER_IMG_NIGHT,
  USER_LAYERS,
  ROUTE_SHADOW,
  ROUTE_GLOW_SEL,
  ROUTE_CASE,
  SEL_LAYER,
  ROUTE_FLOW,
  ALT_SRC,
  ALT_FILL,
  ALT_BADGE_SRC,
  ALT_BADGE_LAYER,
  DEBUG_SRC,
  DEBUG_LAYER,
  SEL_SRC,
  BADGE_IMAGE_ID,
  SHIELD_IMG_DAY,
  SHIELD_IMG_NIGHT,
  PAINTED_ARROW_SRC,
  PAINTED_ARROW_FILL,
  PAINTED_ARROW_EDGE,
  PULSE_TRANSPARENT,
  MOOD_THROTTLE_MS,
  MOOD_HYSTERESIS,
} from './_mapState';

// ── Zero-Allocation marker zarfı (V8 Hot-Path kuralı) ────────────────────
// updateUserMarker GPS tick'inde (~16fps, her 60ms) çağrılır. Her çağrıda taze
// GeoJSON nesnesi tahsis etmek (feature + geometry + coordinates + properties +
// FeatureCollection = çağrı başına 5 nesne) 32-bit heap'te sürekli minor GC
// tetikliyordu (ölçülen GC pause'ları 190–235ms → "Slow UI thread" jank). Modül
// seviyesinde TEK bir zarf önceden tahsis edilir; tick'te yalnız sayısal alanlar
// mutate edilir. Hidden-class kararlı (alan sırası ve tipleri hiç değişmez).
const _markerCoords: [number, number] = [0, 0];
const _markerGeometry   = { type: 'Point' as const,   coordinates: _markerCoords };
const _markerProps      = { heading: 0 };
const _markerFeature    = { type: 'Feature' as const, geometry: _markerGeometry, properties: _markerProps };
const _markerCollection = { type: 'FeatureCollection' as const, features: [_markerFeature] };

// ── CarOS Rover konum göstergesi (marka imzası) ──────────────────────────

/** Köşeleri yuvarlatılmış dikdörtgen yolu — ctx.roundRect tüm WebView'larda yok, kendi çiziyoruz. */
function _roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y,     x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x,     y + h, rr);
  ctx.arcTo(x,     y + h, x,     y,     rr);
  ctx.arcTo(x,     y,     x + w, y,     rr);
  ctx.closePath();
}

/**
 * Üstten görünüş CarOS Rover'ı verilen context'e çizer (ön = yukarı = heading 0°).
 */
function _drawRover(ctx: CanvasRenderingContext2D, size: number, night: boolean) {
  const cx = size / 2;
  const s  = size / 144;              // ölçek faktörü
  const P  = (n: number) => n * s;    // birim → piksel
  const X  = (n: number) => cx + n * s; // merkeze göre yatay
  const Y  = (n: number) => n * s;       // tepeden dikey (144-uzayı)
  ctx.clearRect(0, 0, size, size);
  ctx.lineJoin = 'round';

  const amber     = night ? '#FFB347' : '#E0A23C';
  const amberGlow = night ? 'rgba(255,170,60,0.95)' : 'rgba(224,162,60,0.55)';
  const glass     = night ? 'rgba(30,36,46,0.95)' : 'rgba(22,28,38,0.92)';
  const tireCol   = '#141417';

  // 1) Zemin gölgesi — radyal gradyan (filter'sız, tüm WebView'larda çalışır), aracı kaldırır
  const sh = ctx.createRadialGradient(cx, Y(78), 0, cx, Y(78), P(58));
  sh.addColorStop(0,   night ? 'rgba(0,0,0,0.50)' : 'rgba(30,22,10,0.36)');
  sh.addColorStop(0.7, night ? 'rgba(0,0,0,0.22)' : 'rgba(30,22,10,0.15)');
  sh.addColorStop(1,   'rgba(0,0,0,0)');
  ctx.fillStyle = sh;
  ctx.beginPath();
  ctx.ellipse(cx, Y(78), P(44), P(60), 0, 0, Math.PI * 2);
  ctx.fill();

  // 2) Tekerler — koyu lastik + tread çizgileri (off-road geniş duruş)
  const wheel = (wx: number, wy: number) => {
    ctx.fillStyle = tireCol;
    _roundRectPath(ctx, wx - P(7.5), wy - P(16), P(15), P(32), P(5));
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.07)';
    ctx.lineWidth = P(1);
    for (let i = -1; i <= 1; i++) {
      ctx.beginPath();
      ctx.moveTo(wx + i * P(4), wy - P(13));
      ctx.lineTo(wx + i * P(4), wy + P(13));
      ctx.stroke();
    }
  };
  wheel(X(-31), Y(42)); wheel(X(31), Y(42));    // ön
  wheel(X(-31), Y(102)); wheel(X(31), Y(102));  // arka

  // 3) Gövde — şampanya metalik (genişlik gradyanı: koyu kenar → parlak merkez)
  _roundRectPath(ctx, X(-30), Y(14), P(60), P(116), P(13));
  const wg = ctx.createLinearGradient(X(-30), 0, X(30), 0);
  if (night) {
    wg.addColorStop(0, '#2b2820'); wg.addColorStop(0.5, '#6a6353'); wg.addColorStop(1, '#2b2820');
  } else {
    wg.addColorStop(0, '#998969'); wg.addColorStop(0.5, '#e4d6b8'); wg.addColorStop(1, '#998969');
  }
  ctx.fillStyle = wg;
  ctx.fill();

  // 3b) Boy gradyanı (ön aydınlık → arka koyu) — gövde yoluna clip'lenir
  ctx.save();
  ctx.clip();
  const lg = ctx.createLinearGradient(0, Y(14), 0, Y(130));
  lg.addColorStop(0,   night ? 'rgba(255,200,120,0.12)' : 'rgba(255,255,255,0.18)');
  lg.addColorStop(0.4, 'rgba(0,0,0,0)');
  lg.addColorStop(1,   night ? 'rgba(0,0,0,0.38)' : 'rgba(60,45,25,0.22)');
  ctx.fillStyle = lg;
  ctx.fillRect(0, 0, size, size);
  ctx.restore();

  // 3c) Kenar ışığı (rim light)
  _roundRectPath(ctx, X(-30), Y(14), P(60), P(116), P(13));
  ctx.lineWidth = P(1.6);
  ctx.strokeStyle = night ? 'rgba(255,185,90,0.6)' : 'rgba(255,255,255,0.5)';
  ctx.stroke();

  // 4) Panel/kapı dikişleri
  ctx.strokeStyle = night ? 'rgba(0,0,0,0.4)' : 'rgba(70,55,35,0.35)';
  ctx.lineWidth = P(1);
  for (const seam of [[-26, 26, 46], [-30, 30, 74], [-26, 26, 112]]) {
    ctx.beginPath(); ctx.moveTo(X(seam[0]), Y(seam[2])); ctx.lineTo(X(seam[1]), Y(seam[2])); ctx.stroke();
  }

  // 5) Kaput havalandırma yarıkları
  ctx.fillStyle = night ? 'rgba(0,0,0,0.32)' : 'rgba(80,62,38,0.3)';
  _roundRectPath(ctx, X(-8), Y(30), P(16), P(3), P(1.5)); ctx.fill();
  _roundRectPath(ctx, X(-8), Y(35), P(16), P(3), P(1.5)); ctx.fill();

  // 6) Greenhouse — ön cam, tavan paneli, arka cam
  ctx.fillStyle = glass;
  _roundRectPath(ctx, X(-23), Y(48), P(46), P(12), P(4)); ctx.fill(); // ön cam
  ctx.fillStyle = night ? '#5a5343' : '#d8c9a8';
  _roundRectPath(ctx, X(-22), Y(60), P(44), P(40), P(6)); ctx.fill(); // tavan
  ctx.fillStyle = glass;
  _roundRectPath(ctx, X(-23), Y(100), P(46), P(10), P(4)); ctx.fill(); // arka cam

  // 6b) Tavan rafı (yan raylar + çapraz barlar)
  ctx.strokeStyle = night ? '#1f1c16' : '#6a5c42';
  ctx.lineWidth = P(2);
  ctx.beginPath(); ctx.moveTo(X(-19), Y(62)); ctx.lineTo(X(-19), Y(98)); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(X(19),  Y(62)); ctx.lineTo(X(19),  Y(98)); ctx.stroke();
  ctx.lineWidth = P(1.5);
  for (const yy of [68, 78, 88]) {
    ctx.beginPath(); ctx.moveTo(X(-19), Y(yy)); ctx.lineTo(X(19), Y(yy)); ctx.stroke();
  }

  // 7) Yan aynalar
  ctx.fillStyle = night ? '#4a4536' : '#b6a684';
  _roundRectPath(ctx, X(-35), Y(54), P(6), P(5), P(2)); ctx.fill();
  _roundRectPath(ctx, X(29),  Y(54), P(6), P(5), P(2)); ctx.fill();

  // 8) Ön tampon + CAROS amber ışık barı + farlar (Expedition imzası)
  ctx.fillStyle = night ? 'rgba(20,17,12,0.9)' : 'rgba(70,56,36,0.7)';
  _roundRectPath(ctx, X(-27), Y(16), P(54), P(6), P(3)); ctx.fill();
  ctx.save();
  ctx.shadowColor = amberGlow; ctx.shadowBlur = night ? P(11) : P(5);
  ctx.fillStyle = amber;
  _roundRectPath(ctx, X(-20), Y(18), P(40), P(3), P(1.5)); ctx.fill();      // ışık barı
  ctx.fillStyle = night ? '#FFD27A' : '#F0B85A';
  _roundRectPath(ctx, X(-26), Y(23), P(9), P(4), P(2)); ctx.fill();          // sol far
  _roundRectPath(ctx, X(17),  Y(23), P(9), P(4), P(2)); ctx.fill();          // sağ far
  ctx.restore();

  // 9) Arka stop lambaları
  ctx.save();
  if (night) { ctx.shadowColor = 'rgba(255,40,30,0.8)'; ctx.shadowBlur = P(6); }
  ctx.fillStyle = night ? 'rgba(255,70,55,0.95)' : 'rgba(190,55,42,0.85)';
  _roundRectPath(ctx, X(-25), Y(122), P(8), P(4), P(2)); ctx.fill();
  _roundRectPath(ctx, X(17),  Y(122), P(8), P(4), P(2)); ctx.fill();
  ctx.restore();
}

/**
 * Gündüz + gece Rover GPU image'larını kayıt eder.
 * force=true (stil reload / WebGL restore): GPU belleğini tazele, yeniden çiz.
 */
function ensureRoverImages(map: MapLibreMap, force?: boolean) {
  const size = 144;
  for (const [id, night] of [[ROVER_IMG_DAY, false], [ROVER_IMG_NIGHT, true]] as const) {
    if (!force && map.hasImage(id)) continue;
    if (map.hasImage(id)) { try { map.removeImage(id); } catch { /* ignore */ } }
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) continue;
    _drawRover(ctx, size, night);
    const imgData = ctx.getImageData(0, 0, size, size);
    map.addImage(id, { width: size, height: size, data: new Uint8Array(imgData.data.buffer) });
  }
}

export function addUserMarker(
  map: MapLibreMap,
  latitude: number,
  longitude: number,
  heading?: number
) {
  if (!map) return;

  // Stil yeniden yüklenince icon-size expression sıfırlanır —
  // bir sonraki updateUserMarker hız farkı ne olursa olsun yeniden uygulasın.
  M.lastScaleSpeedKmh = -1;

  const sourceId = 'user-location';

  // Remove old layers + source
  if (map.getSource(sourceId)) {
    for (const id of USER_LAYERS) {
      if (map.getLayer(id)) map.removeLayer(id);
    }
    map.removeSource(sourceId);
  }

  // Stil geçişi veya WebGL context yenilenmesinde GPU görseli bayatlar — zorla yenile
  ensureRoverImages(map, true);

  const feature = {
    type: 'Feature' as const,
    geometry: {
      type: 'Point' as const,
      coordinates: [longitude, latitude],
    },
    properties: { heading: heading ?? 0 },
  };

  map.addSource(sourceId, {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [feature] },
  });

  // 1. Amber glow halesi (en altta) — gece güçlü, gündüz sade. circle-blur ile yumuşak parıltı.
  map.addLayer({
    id: 'user-glow',
    type: 'circle',
    source: sourceId,
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 16, 15, 26, 18, 34],
      'circle-color': M.markerNight ? '#FF9E2C' : '#E0A23C',
      'circle-blur': 1,
      'circle-opacity': M.markerNight ? 0.42 : 0.22,
      'circle-pitch-alignment': 'map',
    },
  });

  // 2. Amber konum halkası — aracın altında çepeçevre, pulse/expand burada animasyonlu
  map.addLayer({
    id: 'user-ring',
    type: 'circle',
    source: sourceId,
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 11, 15, 17, 18, 22],
      'circle-color': 'rgba(0,0,0,0)',
      'circle-stroke-width': 2.5,
      'circle-stroke-color': M.markerNight ? '#FFB347' : '#E0A23C',
      'circle-stroke-opacity': 0.9,
      'circle-pitch-alignment': 'map',
    },
  });

  // 3. CarOS Rover — heading'e göre döner. pitch-alignment:map → 3D nav görünümünde
  // zemine yatık "decal" gibi durur. icon-size dar aralık: çok büyümez/küçülmez.
  map.addLayer({
    id: 'user-vehicle',
    type: 'symbol',
    source: sourceId,
    layout: {
      'icon-image': M.markerNight ? ROVER_IMG_NIGHT : ROVER_IMG_DAY,
      'icon-size': ['interpolate', ['linear'], ['zoom'], 10, 0.30, 14, 0.41, 18, 0.51],
      'icon-rotate': ['get', 'heading'],
      'icon-rotation-alignment': 'map',
      'icon-pitch-alignment': 'map',
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
      'icon-offset': [0, 0],
    },
  });

  // Katmanları en üste taşı — raster/vektör geçişlerinde veya OOM sonrası
  // diğer katmanların (rota, POI) üzerinde kalması garantilenir.
  for (const id of ['user-glow', 'user-ring', 'user-vehicle']) safeMoveLayer(map, id);
}

export function updateUserMarker(latitude: number, longitude: number, heading?: number, speedKmh?: number) {
  const map = useMapStore.getState().mapInstance;
  if (!map) return;

  const sourceId  = 'user-location';
  const rawSource = map.getSource(sourceId);
  const layerExists = !!map.getLayer('user-vehicle');
  // Self-Healing: source kayıpsa VEYA ana katman WebGL/OOM baskısında düştüyse yeniden oluştur.
  // Anti-Flicker: addUserMarker ağır işlemdir; yalnızca gerçekten eksikse tetiklenir.
  if (!rawSource || !layerExists) {
    if (map.isStyleLoaded()) addUserMarker(map, latitude, longitude, heading);
    return;
  }
  const source = rawSource as GeoJSONSource;

  // ── Durum makinesi: Park / Hareket / Navigasyon ──────────────────────────
  // Hareket veya nav aktifken alt halkada hafif pulse; nav aktifken halka genişler.
  // Park (hız≈0, nav yok): statik glow — pulse yok, GPS tick'i de durduğundan CPU sıfır.
  const moving = (speedKmh ?? 0) > 1.5;
  const now    = performance.now();
  /* ⚠️ NABIZ DURAKTA DA ÇALIŞIYORDU — ISINMANIN ÖLÇÜLEN KAYNAĞI (2026-08-03).
   * Koşul `(moving || markerNavActive)` idi: navigasyon AÇIKSA araç DURSA BİLE
   * nabız dönüyordu. Oysa hemen üstteki yorum tasarım niyetini zaten yazıyor:
   * "Park (hız≈0): pulse yok, CPU sıfır." OR bağlacı bu niyeti bozuyordu.
   *
   * CİHAZ ÖLÇÜMÜ (telefon, navigasyon aktif, araç PARK, 20 sn):
   *   `user-ring.circle-radius` 50 kez · `user-glow.circle-opacity` 50 kez
   *   → harita **31.2 çizim/sn** · uygulama CPU **%119** (bir çekirdekten fazla).
   * Her `setPaintProperty` haritayı baştan çizdirir; duran araçta nabız hiçbir
   * bilgi taşımaz ama sürekli GPU/CPU yakar.
   *
   * DÜZELTME: nabız YALNIZ gerçek harekette. Navigasyonun halka genişletmesi
   * (`navBoost`) bir ANİMASYON değil, statik bir boyuttur — durakta BİR KEZ
   * uygulanır ve bir daha yazılmaz (`markerPulseStatic`). */
  if (!moving) {
    if (!M.markerPulseStatic) {
      M.markerPulseStatic = true;
      const navBoost = M.markerNavActive ? 1.18 : 1.0;
      try {
        map.setPaintProperty('user-ring', 'circle-radius', [
          'interpolate', ['linear'], ['zoom'],
          10, 11 * navBoost,
          15, 17 * navBoost,
          18, 22 * navBoost,
        ]);
        map.setPaintProperty('user-glow', 'circle-opacity',
          (M.markerNight ? 0.42 : 0.22) * navBoost);
      } catch { /* stil yeniden yükleniyor */ }
    }
  } else if (now - M.lastRingPulseMs > 150) {
    M.lastRingPulseMs   = now;
    M.markerPulseStatic = false;
    const pulse    = Math.sin(now / 450) * 0.5 + 0.5;        // 0..1, ~2.8s periyot
    const navBoost = M.markerNavActive ? 1.18 : 1.0;          // nav: halka genişler
    const rScale   = navBoost * (1 + pulse * 0.10);
    try {
      map.setPaintProperty('user-ring', 'circle-radius', [
        'interpolate', ['linear'], ['zoom'],
        10, 11 * rScale,
        15, 17 * rScale,
        18, 22 * rScale,
      ]);
      const baseOp = M.markerNight ? 0.42 : 0.22;
      map.setPaintProperty('user-glow', 'circle-opacity', baseOp * (0.8 + pulse * 0.4) * navBoost);
    } catch { /* stil yeniden yükleniyor */ }
  }

  // C7.1 — hıza duyarlı ince ölçekleme (±3 km/h hysteresis) — araç çok az büyür
  if (speedKmh !== undefined && Math.abs(speedKmh - M.lastScaleSpeedKmh) >= 3) {
    M.lastScaleSpeedKmh = speedKmh;
    const clamped = Math.max(0, Math.min(100, speedKmh));
    const sf      = 0.95 + (clamped / 100) * 0.12;
    try {
      map.setLayoutProperty('user-vehicle', 'icon-size', [
        'interpolate', ['linear'], ['zoom'],
        10, 0.30 * sf,
        14, 0.41 * sf,
        18, 0.51 * sf,
      ]);
    } catch { /* stil yeniden yükleniyor */ }
  }

  // Zero-allocation: önceden tahsisli zarfı mutate et (yukarıdaki _marker* sabitleri).
  _markerCoords[0]     = longitude;
  _markerCoords[1]     = latitude;
  _markerProps.heading = heading ?? 0;
  source.setData(_markerCollection);
}

/**
 * Gündüz/gece temasını değiştir — Rover image variantını + halka/glow rengini günceller.
 * Idempotent; değişim yoksa hiçbir GPU işi yapmaz (re-render tetiklemez).
 */
export function setMarkerTheme(night: boolean): void {
  if (M.markerNight === night) return;
  M.markerNight = night;
  const map = useMapStore.getState().mapInstance;
  if (!map || !map.getLayer('user-vehicle')) return;
  try {
    map.setLayoutProperty('user-vehicle', 'icon-image', night ? ROVER_IMG_NIGHT : ROVER_IMG_DAY);
    map.setPaintProperty('user-ring', 'circle-stroke-color', night ? '#FFB347' : '#E0A23C');
    map.setPaintProperty('user-glow', 'circle-color',   night ? '#FF9E2C' : '#E0A23C');
    map.setPaintProperty('user-glow', 'circle-opacity', night ? 0.42 : 0.22);
  } catch { /* stil yeniden yükleniyor — sonraki addUserMarker doğru variantı kurar */ }
}

/**
 * NAV-1: DR "tahmini" konumda araç marker'ını soluklaştırır (icon-opacity 0.5) — GPS teyitli
 * DEĞİL, dürüst görsel sinyal. GPS dönünce 1'e döner. Yalnız paint değişir → marker'ı bozamaz.
 * Çağıran (FullMapView) durum DEĞİŞİMİNDE çağırır (her rAF tick'inde değil).
 */
export function setUserMarkerEstimated(estimated: boolean): void {
  const map = useMapStore.getState().mapInstance;
  if (!map || !map.getLayer('user-vehicle')) return;
  try {
    map.setPaintProperty('user-vehicle', 'icon-opacity', estimated ? 0.5 : 1);
    if (map.getLayer('user-ring')) map.setPaintProperty('user-ring', 'circle-opacity', estimated ? 0.4 : 1);
  } catch { /* stil reload — sonraki tick düzeltir */ }
}

/**
 * Harita gün/gece geçişi — RESTYLE OLMADAN canlı paint güncellemesi (rota katmanları korunur).
 */
export function applyMapDayNight(night: boolean, mapArg?: ReturnType<typeof useMapStore.getState>['mapInstance']): void {
  setMapNight(night);
  setMarkerTheme(night);
  const map = mapArg ?? useMapStore.getState().mapInstance;
  if (!map) return;
  // Boyanmış ok raster yolunda katmanını korur → rengi canlı tazelenmeli.
  // (Vektör yolunda tam restyle olur; `style.load` zaten sıfırlayıp yeniden kurar.)
  setPaintedArrowTheme(map, night);
  try {
    // 'tiles-layer' = buildRoadStyle/getOnlineTileStyle standardı; 'osm-tiles'/'osm-layer'
    // eski sabit stillerin id'leri — id eşleşmezse geçiş sessizce no-op oluyordu (gündüz
    // temada kalıcı gece harita). Hangisi varsa onu canlı patch'le.
    const rasterLayerId = ['tiles-layer', 'osm-tiles', 'osm-layer'].find((id) => map.getLayer(id));
    if (rasterLayerId) {
      // RASTER (OSM) → canlı paint: restyle yok, rota/marker korunur (en yaygın yol).
      const paint = night ? RASTER_PAINT_NIGHT : RASTER_PAINT_DAY;
      for (const [prop, val] of Object.entries(paint)) {
        // `paint` sözlüğü raster paint anahtarlarını taşır; MapLibre imzası
        // `name: string` kabul eder → cast gerekmiyor.
        map.setPaintProperty(rasterLayerId, prop, val);
      }
      if (map.getLayer('background')) {
        map.setPaintProperty('background', 'background-color', night ? MAP_BG_NIGHT : MAP_BG_DAY);
      }
    }
    // NOT: Vektör (offline .pbf) veya uydu/hibrit → burada setStyle ÇAĞIRMA.
    // Vektör stil gündüze canlı çevrilemez — FullMapView gün/gece effect'i IDLE'da
    // tam restyle (getMapStyle → gündüz raster fallback) tetikler.
  } catch { /* stil yeniden yükleniyor — sonraki getMapStyle doğru paleti kurar */ }
}

/**
 * Navigasyon aktiflik durumunu işaretle — alt halka genişler, glow güçlenir.
 * Yalnızca bayrak günceller; görsel etki updateUserMarker'ın pulse döngüsünde uygulanır.
 */
export function setMarkerNavActive(active: boolean): void {
  M.markerNavActive = active;
}

/* ── Cinematic light trail (rAF + line-gradient) ───────────────────────────── */

/**
 * @param p           Pulse ilerlemesi [0,1)
 * @param riskScore   Global tehlike skoru — pulse genişliği ve parlaklığını etkiler
 * @param isAttention ATTENTION durumunda pulse daha keskin ve parlak olur
 */
/* Dönüş tipi MapLibre'nin KENDİ ifade tipidir. İfade DİNAMİK kurulduğu için
   (durak sayısı/eşikler runtime'da hesaplanır) TypeScript onu `ExpressionSpecification`
   tuple birleşimine daraltamaz; bu yüzden dönüşlerde kütüphane tipine tek noktadan
   assert edilir. `any` DEĞİL: tip kütüphanenin sözleşmesidir ve çağıranlar tam
   denetime tabi kalır. */
function _buildPulseGradient(p: number, riskScore = 0, isAttention = false): maplibregl.ExpressionSpecification {
  // Renk string'leri: sadece risk veya attention değişince yeniden oluştur
  if (Math.abs(riskScore - M.pCacheRisk) > 0.01 || isAttention !== M.pCacheAttn) {
    M.pCacheRisk  = riskScore;
    M.pCacheAttn  = isAttention;
    const peak   = isAttention ? 0.96 : 0.80 + 0.15 * riskScore;
    const shldr  = 0.22 + 0.10 * riskScore;
    M.pPeakStr    = `rgba(255,255,255,${peak.toFixed(2)})`;
    M.pShoulderStr = `rgba(255,255,255,${shldr.toFixed(2)})`;
  }

  const W  = 0.10 - 0.04 * riskScore;
  const t0 = 0;
  const t1 = Math.max(0.001, p - W * 1.5);
  const t2 = Math.max(t1 + 0.001, p - W);
  const t3 = Math.max(t2 + 0.001, p);
  const t4 = Math.min(0.998, Math.max(t3 + 0.001, p + W * 0.4));
  const t5 = 1;

  if (t3 >= t4) {
    return ['interpolate', ['linear'], ['line-progress'],
      0, PULSE_TRANSPARENT, 1, PULSE_TRANSPARENT] as maplibregl.ExpressionSpecification;
  }
  return [
    'interpolate', ['linear'], ['line-progress'],
    t0, PULSE_TRANSPARENT,
    t1, PULSE_TRANSPARENT,
    t2, M.pShoulderStr,
    t3, M.pPeakStr,
    t4, PULSE_TRANSPARENT,
    t5, PULSE_TRANSPARENT,
  ] as maplibregl.ExpressionSpecification;
}

/* ── Rota kalınlığı: ölçüm + son uygulanan politika ────────────────────────
 *
 * Ölçüm harita CANVAS'ından alınır (pencereden DEĞİL): mini harita ile tam
 * ekran ayrı yüzeylerdir ve rota ikisinde aynı görsel ağırlığa ancak böyle
 * sahip olur. Yeni dinleyici/timer KURULMAZ — ölçüm yalnız kalınlığın zaten
 * yazıldığı anlarda (rota kurulumu · perspektif düzeltmesi) yapılır.
 *
 * Son sonuç modül düzeyinde saklanır çünkü nefes alan glow 12,5 Hz'te koşar;
 * orada her tick'te canvas ölçmek gereksiz düzen okuması (reflow riski)
 * olurdu. Saklanan değer bir KARAR değil, son ÖLÇÜMÜN sonucudur. */
let _routeWidths: RouteWidths | null = null;

/** Harita canvas'ının kısa kenarı (CSS px); ölçülemezse 0 → referans varsayılır. */
export function measureCanvasMinPx(map: MapLibreMap): number {
  try {
    const cv = map.getCanvas();
    const w = cv.clientWidth, h = cv.clientHeight;
    if (!(w > 0) || !(h > 0)) return 0;
    return Math.min(w, h);
  } catch {
    return 0;   // ölçemiyorsak SAHTE değer üretme — politika referansa düşer
  }
}

/** Politikayı ölç + hesapla + hatırla. Saf hesap `core/routeWidthModel`dedir. */
export function resolveRouteWidths(map: MapLibreMap, perspectiveScale = 1): RouteWidths {
  const w = computeRouteWidths({
    canvasMinPx: measureCanvasMinPx(map),
    perspectiveScale,
  });
  _routeWidths = w;
  return w;
}

/** Son uygulanan kalınlıklar — `null` = rota henüz çizilmedi (CAROS LAB okur). */
export function getRouteWidthsSnapshot(): RouteWidths | null { return _routeWidths; }

/** @internal — testler arası izolasyon. */
export function _resetRouteWidthsForTest(): void { _routeWidths = null; }

/* ══════════════════════════════════════════════════════════════════════════
   ROTA RENGİ — TEK YAZICI (PR-3a)
   ══════════════════════════════════════════════════════════════════════════
   `ROUTE_CASE.line-color` ve `ROUTE_GLOW_SEL.line-color` YALNIZ buradan
   yazılır. Eski hâlde iki ayrı blok (manevra vurgusu · dış risk uyarısı) aynı
   iki özelliği kendi önbelleğine bakarak yazıyor ve hakem olmadığı için
   manevra bloğu tehlike rengini siliyordu (K1 — tam dizi
   `core/routeColorModel` başlığında). İkinci bir yazıcı doğarsa kusur da
   geri döner; kilit testi bunu yapısal olarak denetler. */

/** Son uygulanan karar — `null` = rota rengi henüz hiç yazılmadı. */
let _routeColor: RouteColorDecision | null = null;
/** Ölçülen son girdiler (LAB gözlemi; karar DEĞİL, girdinin kaydı). */
let _routeColorInput: { maneuverTier: number; hazardHigh: boolean; lightBasemap: boolean } | null = null;

/**
 * Rotanın çizildiği zemin AÇIK mı — kılıf kutbunun TEK türetme yeri.
 *
 * ── NEDEN "GÜNDÜZ MÜ" DEĞİL ────────────────────────────────────────────────
 * `MapMode` (`road | hybrid | satellite`) ile `getMapNight()` birbirinden
 * BAĞIMSIZDIR. "Gündüz + uydu" gerçek bir kombinasyondur ve uydu görüntüsü
 * orta-koyu bir yüzeydir; orada koyu kılıf rotayı zeminde YOK EDERDİ. Doğru
 * ölçüt zaman değil ZEMİN PARLAKLIĞIdır:
 *
 *     gündüz + road      → AÇIK   (koyu kılıf)
 *     gündüz + hybrid    → koyu   (beyaz kılıf — bugünkü davranış)
 *     gündüz + satellite → koyu   (beyaz kılıf — bugünkü davranış)
 *     gece   + herhangi  → koyu   (beyaz kılıf — bugünkü davranış)
 *
 * FAIL-SOFT KUTUP: okunamazsa AÇIK SAYILMAZ. Yanlış tarafa düşmenin bedeli
 * simetrik değildir — koyu zeminde koyu kılıf rotayı yok eder, açık zeminde
 * beyaz kılıf yalnız siliktir. Varsayılan bugünkü davranıştır.
 */
export function resolveLightBasemap(): boolean {
  try {
    return !getMapNight() && getMapMode() === 'road';
  } catch {
    return false;
  }
}

/**
 * Düşük-uç (head unit / zayıf GPU) yüzeyi mi — `line-gradient` ve `line-blur`
 * bu yüzeyde atlanır. TEK türetme yeri: `perf-low` sınıfı CANLI okunur (sınıf
 * çalışma anında eklenip kaldırılabilir; önbelleğe alınmaz — bkz. #599).
 */
function _isPerfLowSurface(): boolean {
  return typeof document !== 'undefined' &&
    document.documentElement.classList.contains('perf-low');
}

/** Kararı haritaya uygula — boya yazan TEK yer. */
function _applyRouteColorDecision(map: MapLibreMap, d: RouteColorDecision): void {
  safeSetPaint(map, ROUTE_CASE,     'line-color',   d.casing);
  safeSetPaint(map, ROUTE_GLOW_SEL, 'line-color',   d.glow);
  safeSetPaint(map, SEL_LAYER,      'line-opacity', d.coreOpacity);
  /* #619 — ÇEKİRDEK de burada yazılır. Yazılmazsa gündüz↔gece geçişinde
   * (ya da road↔uydu mod değişiminde) kılıf/halo güncellenir ama çekirdek
   * KURULUM ANINDAKİ renkte asılı kalırdı — kararın yarısı uygulanmış olurdu.
   * Düşük-uçta gradient yok: orada düz renk yazılır (aynı karar, tek yazıcı). */
  if (_isPerfLowSurface()) {
    safeSetPaint(map, SEL_LAYER, 'line-color', d.coreStops[0]);
  } else {
    safeSetPaint(map, SEL_LAYER, 'line-gradient', [
      'interpolate', ['linear'], ['line-progress'],
      0,   d.coreStops[0],
      0.5, d.coreStops[1],
      1,   d.coreStops[2],
    ]);
  }
}

/**
 * Rota rengini anlık DURUMDAN türet ve gerekiyorsa uygula.
 *
 * Dedup tek anahtarladır (`routeColorKey`): anahtar aynıysa hiçbir boya
 * yazılmaz, farklıysa TÜM renkler BİRLİKTE uygulanır → bir katmanın
 * güncellenip diğerinin eskide kalması imkânsızdır.
 *
 * Gece/gündüz burada okunur; çağıranlar tema bilmez (ikinci tema otoritesi
 * kurulmaz). PR-3a'da tema kararı DEĞİŞTİRMEZ — yalnız anahtara girer.
 *
 * @param force  yeniden çizim sonrası boya sıfırlandığında dedup'ı atlar
 */
export function syncRouteColor(
  map: MapLibreMap, maneuverTier: number, hazardHigh: boolean, force = false,
): RouteColorDecision {
  const lightBasemap = resolveLightBasemap();
  const d = resolveRouteColor({ maneuverTier, hazardHigh, lightBasemap });
  _routeColorInput = { maneuverTier, hazardHigh, lightBasemap };

  if (!force && _routeColor !== null && _routeColor.routeColorKey === d.routeColorKey) return d;
  _routeColor = d;
  /* `getLayer` denetimi `safeSetPaint` içinde; katman yoksa sessizce geçer ve
     karar hatırlanır → katman doğduğunda kurulum yolu aynı kararı kullanır. */
  _applyRouteColorDecision(map, d);
  return d;
}

export interface RouteColorSnapshot {
  readonly policyVersion: string;
  /** `null` = rota rengi henüz hiç yazılmadı → LAB `UNAVAILABLE` gösterir. */
  readonly decision: RouteColorDecision | null;
  readonly input: { maneuverTier: number; hazardHigh: boolean; lightBasemap: boolean } | null;
}

/** Senkron okuma — CAROS LAB için. Sahte ölçüm ÜRETİLMEZ. */
export function getRouteColorSnapshot(): RouteColorSnapshot {
  return {
    policyVersion: ROUTE_COLOR_POLICY_VERSION,
    decision: _routeColor,
    input: _routeColorInput,
  };
}

/**
 * Renk kararını unut — rota silindiğinde çağrılır.
 *
 * Şart: bayat bir anahtar kalırsa bir sonraki rota için `syncRouteColor`
 * dedup'ta eşleşir ve boyayı HİÇ yazmaz → yeni rota eski renkte kalırdı.
 */
export function resetRouteColorState(): void {
  _routeColor = null;
  _routeColorInput = null;
}

/** @internal — testler arası izolasyon. */
export function _resetRouteColorForTest(): void { resetRouteColorState(); }

/**
 * Glow nefes animasyonu — H5: psikologik tempo (derin nefes modeli).
 */
function _applyBreathingGlow(map: MapLibreMap, nowMs: number, hazardRisk: number): void {
  if (!map.getLayer(ROUTE_GLOW_SEL)) return;

  // Bilişsel mod kısıtı: PROTECTION → genlik %70 azaltılır; CRITICAL/LIMP_HOME → glow kapalı
  const cogMode = useCognitiveStore.getState().currentMode;
  if (cogMode === 'CRITICAL' || cogMode === 'LIMP_HOME') return;
  const cogAmplitudeFactor = cogMode === 'PROTECTION' ? 0.30 : 1.0; // %70 azaltma

  // S4: Safety state'ten görsel risk katkısı — INTERVENTION en yüksek öncelik
  const { safetyState } = useSafetyStore.getState();
  const safetyRisk = safetyState === 'INTERVENTION' ? 0.85
    : safetyState === 'CAUTION'    ? 0.55
    : 0;

  // Blend: safety büyükse güvenlik görsel önceliği kazanır
  const visualRisk = Math.max(hazardRisk, safetyRisk);
  if (visualRisk < 0.05) return;

  let period: number;
  if      (safetyState === 'INTERVENTION') period = 1500;
  else if (safetyState === 'CAUTION')      period = 2000;
  else                                      period = 2500 - hazardRisk * 1000;

  const breath         = Math.sin((nowMs / period) * Math.PI * 2); // −1 → +1
  const amplitudeScale = (safetyState === 'INTERVENTION' ? 1.4 : 1.0) * cogAmplitudeFactor;

  /* ── NEFES ARTIK POLİTİKANIN ÜSTÜNE BİNER, ONU SİLMEZ ────────────────────
   * Eski hâl `max(10, 22 + nefes*12*risk)` sabit bir skalerdi ve glow'un zoom
   * ara değerini TAMAMEN değiştiriyordu. İki sonucu vardı:
   *   (a) glow zoom'dan koptu — uzaklaşınca rotadan bağımsız kalınlıkta kaldı,
   *   (b) sürüşte kılıf (≈46 px) bu değerin ~2× üstünde olduğu için glow
   *       kılıfın ALTINDA kalıp GÖRÜNMEZ oldu → risk arttıkça nefes alan
   *       güvenlik sinyali sürücüye HİÇ ULAŞMIYORDU.
   * Artık taban politikadan gelir (kılıfın dışında olduğu garanti) ve nefes
   * yalnız oransal genlik ekler. Politika henüz hesaplanmadıysa (rota yok)
   * dokunulmaz — uydurma taban üretilmez. */
  const w = _routeWidths;
  if (!w) return;
  const width = breathingGlowWidth(w.glow.z18, breath, visualRisk * amplitudeScale);

  safeSetPaint(map, ROUTE_GLOW_SEL, 'line-width', width);
}

/**
 * ALT_BADGE_LAYER için glassmorphic badge arkaplan imajı oluşturur ve haritaya kaydeder.
 */
function _ensureBadgeImage(map: MapLibreMap): void {
  if (map.hasImage(BADGE_IMAGE_ID)) return;
  const W = 80, H = 32, R = 8;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  // Yuvarlatılmış dikdörtgen — glassmorphic dark navy zemin
  ctx.beginPath();
  ctx.moveTo(R, 0);
  ctx.lineTo(W - R, 0); ctx.arcTo(W, 0,  W, R,     R);
  ctx.lineTo(W, H - R); ctx.arcTo(W, H,  W - R, H, R);
  ctx.lineTo(R, H);     ctx.arcTo(0, H,  0, H - R, R);
  ctx.lineTo(0, R);     ctx.arcTo(0, 0,  R, 0,     R);
  ctx.closePath();

  ctx.fillStyle = 'rgba(14,28,48,0.88)';
  ctx.fill();

  ctx.strokeStyle = 'rgba(224,162,60,0.45)';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  const imgData = ctx.getImageData(0, 0, W, H);
  map.addImage(BADGE_IMAGE_ID, {
    width:  W,
    height: H,
    data:   new Uint8Array(imgData.data.buffer),
  });
}

/* ── Yola boyanmış manevra oku ────────────────────────────────────────────── */

const _EMPTY_FC = { type: 'FeatureCollection' as const, features: [] as unknown[] };

/** Son uygulanan hüküm — aynı durum tekrar yazılmasın (GPS fix'i 1 Hz gelir). */
let _lastArrowKey = '';

/* Gözlem durumu bu modülde TUTULMAZ — yaprak `paintedArrowAccess` modülünde
   yaşar ki CAROS LAB onu okumak için maplibre-gl grafiğini import etmesin. */

/**
 * Boyanmış oku uygular. Görünmüyorsa kaynak BOŞ FeatureCollection'a çekilir —
 * katman silinmez, çünkü silip yeniden eklemek stil sırasını bozar ve her
 * manevrada katman yaratmak head unit'te GPU'yu gereksiz meşgul eder.
 *
 * Dedup: hüküm anahtarı değişmediyse `setData` HİÇ çağrılmaz. Ok geometrisi
 * yalnız manevra çapası değişince değişir; mesafe yalnız görünürlüğü etkiler.
 */
export function setPaintedArrow(
  map: MapLibreMap | null,
  verdict: PaintedArrowVerdict,
  anchorIndex: number,
  night: boolean,
): void {
  /* ── STİL KAPISI DARALTILDI (saha 2026-08-13) ──────────────────────────────
   * Buradaki kapı da `trimRouteGeometry`dekiyle AYNI kusur sınıfındaydı ve
   * fonksiyon İKİ İŞ yapıyor: (a) VAR OLAN source'a `setData` — yüklü stil
   * GEREKTİRMEZ; (b) source/katman YARATMA — gerektirir. Tepedeki tek kapı
   * ikisini birden öldürüyordu: sürüşte `isStyleLoaded()` kalıcı olarak false
   * olduğu için (aynı karedeki `updateUserMarker` setData'sı + sürekli tile
   * yüklemesi) ok bir kez kurulsa bile bir daha GÜNCELLENEMİYORDU.
   *
   * Kapı artık YALNIZ yaratma dalında (aşağıda). Dedup zaten güvenli: anahtar
   * kontrolü `&& map.getSource(...)` de sorduğu için, yaratma stil yüzünden
   * atlandıysa sonraki tick TEKRAR dener (bayat anahtar kilitlemez). */
  if (!map) return;

  const key = verdict.visible
    ? `v|${anchorIndex}|${verdict.turn}`
    : `h|${verdict.reason}`;
  if (key === _lastArrowKey && map.getSource(PAINTED_ARROW_SRC)) return;
  _lastArrowKey = key;

  _recordPaintedArrowVerdict(verdict.visible, verdict.reason);

  const data = verdict.visible
    ? {
        type: 'FeatureCollection' as const,
        features: [{
          type: 'Feature' as const,
          properties: {},
          // readonly → mutable kopya: MapLibre/GeoJSON tipleri değiştirilebilir
          // dizi ister; modelin çıktısı bilerek readonly'dir (saflık sözleşmesi).
          geometry: {
            type: 'Polygon' as const,
            coordinates: [verdict.ring.map((p) => [p[0], p[1]])],
          },
        }],
      }
    : _EMPTY_FC;

  try {
    const src = map.getSource(PAINTED_ARROW_SRC) as maplibregl.GeoJSONSource | undefined;
    if (src) {
      src.setData(data as unknown as GeoJSON.FeatureCollection);
      _recordPaintedArrowLayer(!!map.getLayer(PAINTED_ARROW_FILL));
      return;
    }

    /* YARATMA dalı — burada yüklü stil GERÇEKTEN gerekir (`addSource`/`addLayer`
       stil sözlüğüne yazar). Hazır değilse sessizce çıkılır; dedup anahtarı
       source yokluğunu gördüğü için sonraki tick yeniden dener. */
    if (!map.isStyleLoaded()) return;

    map.addSource(PAINTED_ARROW_SRC, {
      type: 'geojson',
      data: data as unknown as GeoJSON.FeatureCollection,
    });

    /* Rota çizgisinin ÜSTÜNE konur: ok rotanın üzerine boyanır, altına değil.
       Kullanıcı işaretçisi (USER_LAYERS) daha da üstte kalır — araç okun
       altında kaybolmamalı. */
    map.addLayer({
      id: PAINTED_ARROW_FILL,
      type: 'fill',
      source: PAINTED_ARROW_SRC,
      paint: {
        'fill-color': night ? '#5b96f7' : '#4285f4',
        'fill-opacity': night ? 0.80 : 0.86,
      },
    });
    map.addLayer({
      id: PAINTED_ARROW_EDGE,
      type: 'line',
      source: PAINTED_ARROW_SRC,
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: {
        'line-color': '#ffffff',
        'line-width': 1.8,
        'line-opacity': 0.9,
      },
    });
    _recordPaintedArrowLayer(true);
  } catch {
    /* fail-soft: ok çizilemezse navigasyon aynen sürer — ok bir SÜS değil ama
       KRİTİK de değildir; manevra bilgisi HUD'da zaten vardır. */
  }
}

/** Tema değişiminde okun rengini tazeler (katman yeniden kurulmaz). */
export function setPaintedArrowTheme(map: MapLibreMap | null, night: boolean): void {
  if (!map || !map.isStyleLoaded() || !map.getLayer(PAINTED_ARROW_FILL)) return;
  safeSetPaint(map, PAINTED_ARROW_FILL, 'fill-color', night ? '#5b96f7' : '#4285f4');
  safeSetPaint(map, PAINTED_ARROW_FILL, 'fill-opacity', night ? 0.80 : 0.86);
}

/** Stil yeniden yüklendiğinde katman/kaynak gider → dedup anahtarı sıfırlanmalı. */
export function _resetPaintedArrowCache(): void {
  _lastArrowKey = '';
  _recordPaintedArrowLayer(false);
}

/**
 * Yol numarası kalkanı (E-5 · D-100) arkaplan imajlarını üretir ve kaydeder.
 *
 * NEDEN ÇALIŞMA ZAMANINDA: stilde `sprite` tanımlı DEĞİLDİR, bu yüzden kalkan
 * statik bir sprite'tan gelemez. Canvas'ta üretmek ayrıca üç şey kazandırır:
 * ek asset yok (lisans yüzeyi büyümez) · offline'da da çalışır · gündüz/gece
 * ayrı üretilir.
 *
 * `stretchX/stretchY/content` ZORUNLUDUR: `icon-text-fit: 'both'` bunlar
 * olmadan TÜM imajı esnetir ve yuvarlatılmış köşeler yamulur. Stretch bölgesi
 * köşe yarıçapının içinde kalır → "E-5" ve "D-100" aynı imajla düzgün çıkar.
 *
 * force=true (stil reload / WebGL restore): GPU belleğindeki bayat imajı tazele.
 */
export function ensureRoadShieldImages(map: MapLibreMap, force?: boolean): void {
  const PR = 2;                                   // HiDPI: 2× çiz, pixelRatio 2 bildir
  const W = 40 * PR, H = 24 * PR, R = 5 * PR;

  for (const [id, night] of [[SHIELD_IMG_DAY, false], [SHIELD_IMG_NIGHT, true]] as const) {
    if (!force && map.hasImage(id)) continue;
    if (map.hasImage(id)) { try { map.removeImage(id); } catch { /* ignore */ } }

    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');
    if (!ctx) continue;

    // Avrupa/otoyol kalkanı: yeşil zemin + beyaz çerçeve (TR tabelasıyla aynı dil)
    ctx.beginPath();
    ctx.moveTo(R, 0);
    ctx.lineTo(W - R, 0); ctx.arcTo(W, 0, W, R, R);
    ctx.lineTo(W, H - R); ctx.arcTo(W, H, W - R, H, R);
    ctx.lineTo(R, H);     ctx.arcTo(0, H, 0, H - R, R);
    ctx.lineTo(0, R);     ctx.arcTo(0, 0, R, 0, R);
    ctx.closePath();

    ctx.fillStyle = night ? '#14602c' : '#1a7f37';
    ctx.fill();
    ctx.strokeStyle = night ? 'rgba(232,224,208,0.80)' : '#ffffff';
    ctx.lineWidth = 1.6 * PR;
    ctx.stroke();

    const imgData = ctx.getImageData(0, 0, W, H);
    map.addImage(
      id,
      { width: W, height: H, data: new Uint8Array(imgData.data.buffer) },
      {
        pixelRatio: PR,
        // Esneme yalnız köşe yarıçaplarının ARASINDA olur.
        stretchX: [[R + 2 * PR, W - R - 2 * PR]],
        stretchY: [[R + 1 * PR, H - R - 1 * PR]],
        // Metnin oturacağı iç alan (çerçeve payı bırakılır).
        content: [3 * PR, 2 * PR, W - 3 * PR, H - 2 * PR],
      },
    );
  }
}

function _startLightTrail(): void {
  if (M.flowRafId !== null) return;
  let lastMs = 0;
  const TICK_MS = 80;

  const frame = (nowMs: number) => {
    M.flowRafId = requestAnimationFrame(frame);
    if (nowMs - lastMs < TICK_MS) return;
    lastMs = nowMs;

    const map = useMapStore.getState().mapInstance;
    if (!map || !map.isStyleLoaded() || !map.getLayer(ROUTE_FLOW)) return;

    // Tehlike durumu — her tick'te store snapshot (sıfır allocation, sadece referans okuma)
    const { globalRiskScore, hazardStatus } = useHazardStore.getState();
    const isAttention = hazardStatus === 'ATTENTION';

    // PROTECTION modunda flow hızı ve risk boost dondurulur — sürücüyü yormama prensibi
    const cogMode     = useCognitiveStore.getState().currentMode;
    const isProtected = cogMode === 'PROTECTION' || cogMode === 'CRITICAL';
    const riskBoost   = isProtected ? 0 : 0.023 * globalRiskScore;
    const flowStep    = isProtected ? 0.010 : 0.022 * M.flowSpeedFactor; // sabit yavaş akış
    M.flowProgress = (M.flowProgress + flowStep + riskBoost) % 1;

    // Pulse gradyanı (risk ve dikkat durumuna duyarlı)
    try {
      map.setPaintProperty(
        ROUTE_FLOW,
        'line-gradient',
        _buildPulseGradient(M.flowProgress, globalRiskScore, isAttention),
      );
    } catch { /* style reloading */ }

    // Glow nefes animasyonu
    _applyBreathingGlow(map, nowMs, globalRiskScore);

    // Harita mood güncellemesi (200ms iç kısıtlama ile korunuyor)
    updateMapMood(map, globalRiskScore);
  };

  M.flowRafId = requestAnimationFrame(frame);
}

function _stopLightTrail(): void {
  if (M.flowRafId !== null) { cancelAnimationFrame(M.flowRafId); M.flowRafId = null; }
  M.flowProgress = 0;
}

/* ── Map Lite Mode köprüsü: rota akış rAF'ını etkileşimde geçici duraklat ──────
 * Pan/zoom sırasında ROUTE_FLOW KATMANINI gizlemek tek başına yetmez — flow rAF
 * döngüsü (setPaintProperty + breathing glow + mood, her 80ms; her kare rAF) çalışmaya
 * devam edip compositor'u her kare uyandırır. Zayıf GPU'da etkileşim boyunca döngüyü
 * tamamen durdurmak rota-aktif pan maliyetini düşürür. Yalnız mapLiteMode çağırır
 * (hasWeakGpu gate). Rota yoksa no-op; resume rota hâlâ varsa yeniden başlatır. */
let _flowPausedForInteraction = false;

export function pauseRouteFlowAnimation(): void {
  if (M.flowRafId !== null) {
    cancelAnimationFrame(M.flowRafId);
    M.flowRafId = null;
    _flowPausedForInteraction = true;
  }
}

export function resumeRouteFlowAnimation(): void {
  if (!_flowPausedForInteraction) return;
  _flowPausedForInteraction = false;
  const map = useMapStore.getState().mapInstance;
  // Yalnız rota hâlâ aktifse yeniden başlat (etkileşim sırasında rota iptal edilmiş olabilir)
  if (map && map.getLayer(ROUTE_FLOW)) _startLightTrail();
}

/* ── Movement Energy — pulse speed scales with vehicle velocity (Faz 3.3) ─── */
export function _updateFlowSpeed(speedKmh: number, deltaSpeed: number): void {
  // Hysteresis: hız veya delta değişmediğinde güncelleme atla
  if (Math.abs(speedKmh - M.lastFlowSpeedKmh) < 3 && Math.abs(deltaSpeed) < 2) return;
  M.lastFlowSpeedKmh = speedKmh;
  const baseSpeed   = Math.max(0.4, Math.min(1.4, 0.4 + speedKmh / 100));
  // Pozitif delta (hızlanma) → anlık pulse burst; negatif delta etkisiz (braking sönük)
  const accelBoost  = Math.max(0, deltaSpeed * 0.018);
  M.flowSpeedFactor  = Math.min(1.8, baseSpeed + accelBoost);
}

/* ── Map Mood Controller (Phase H3) ───────────────────────────────────────── */
export function updateMapMood(map: MapLibreMap, riskScore: number): void {
  if (!map || !map.isStyleLoaded()) return;
  const nowMs = performance.now();
  if (nowMs - M.lastMoodMs < MOOD_THROTTLE_MS) return;

  // PROTECTION modunda harita mood güncellemesi askıya alınır — GPU overdraw azaltılır
  const cogMode = useCognitiveStore.getState().currentMode;
  if (cogMode === 'PROTECTION' || cogMode === 'CRITICAL' || cogMode === 'LIMP_HOME') return;

  // S4: Safety state'i hysteresis'e dahil et — durum değişince mood güncellenir
  const { safetyState } = useSafetyStore.getState();
  if (Math.abs(riskScore - M.lastMoodScore) < MOOD_HYSTERESIS
    && safetyState === M.lastMoodSafetyState) return;
  M.lastMoodMs          = nowMs;
  M.lastMoodScore       = riskScore;
  M.lastMoodSafetyState = safetyState;

  // S4: Safety durumu → ek baskı (CAUTION +%15, INTERVENTION +%30)
  const safetyBoost = safetyState === 'INTERVENTION' ? 0.30
    : safetyState === 'CAUTION'    ? 0.15
    : 0;
  const r = Math.max(0, Math.min(1, riskScore + safetyBoost));

  // place-city — intersection tier listesinde YOK; mood'un özel hedefi
  if (map.getLayer('place-city')) {
    try { map.setPaintProperty('place-city', 'text-opacity', Math.max(0, 0.85 * (1 - r))); }
    catch { /* noop */ }
  }

  // road-label — min 0.60 (H5): sürücü tehlike anında bile cadde adını okuyabilmeli.
  if (map.getLayer('road-label') && M.lastIntersectionTier === 0) {
    try { map.setPaintProperty('road-label', 'text-opacity', Math.max(0.60, 1.0 - 0.40 * r)); }
    catch { /* noop */ }
  }

  // Background: OEM --map-bg-1 #131822 → riskte hafif koyulaşır (#0c0f19)
  const bR = Math.round(19 - 7 * r);
  const bG = Math.round(24 - 9 * r);
  const bB = Math.round(34 - 9 * r);
  if (map.getLayer('background')) {
    try { map.setPaintProperty('background', 'background-color', `rgb(${bR},${bG},${bB})`); }
    catch { /* noop */ }
  }

  // Road colors — OEM grafit paletiyle hizalı (style base ile aynı çıpa)
  if (map.getLayer('road-primary')) {
    const pR = Math.round(68 - 20 * r);
    const pG = Math.round(68 - 20 * r);
    const pB = Math.round(79 - 24 * r);
    try { map.setPaintProperty('road-primary', 'line-color', `rgb(${pR},${pG},${pB})`); }
    catch { /* noop */ }
  }
  if (map.getLayer('road-secondary')) {
    const sR = Math.round(56 - 18 * r);
    const sG = Math.round(56 - 18 * r);
    const sB = Math.round(64 - 20 * r);
    try { map.setPaintProperty('road-secondary', 'line-color', `rgb(${sR},${sG},${sB})`); }
    catch { /* noop */ }
  }
}

/* ── Navigation Focus Mode — adaptive road suppression (Faz 3.1 / 3.2) ────── */
function _applyFocusMode(map: MapLibreMap, active: boolean): void {
  if (!map || !map.isStyleLoaded()) return;
  for (const [id, prop, suppressedVal] of NAV_SUPPRESS_LAYERS) {
    if (map.getLayer(id)) {
      try { map.setPaintProperty(id, prop, active ? suppressedVal : 1.0); } catch { /* ignore */ }
    }
  }
}

/**
 * Intersection tier'a göre yol katmanlarını bastır.
 */
export function _applyIntersectionSuppression(map: MapLibreMap, tier: number): void {
  if (!map || !map.isStyleLoaded()) return;
  const entries = NAV_SUPPRESS_TIERS[Math.min(tier, NAV_SUPPRESS_TIERS.length - 1)] ?? NAV_SUPPRESS_TIERS[0];
  for (const [id, prop, val] of entries) {
    if (map.getLayer(id)) {
      try { map.setPaintProperty(id, prop as 'line-opacity' | 'text-opacity', val); } catch { /* ignore */ }
    }
  }
}

/** İsNavigating durumuna göre yol katmanlarının opaklığını güncelle. */
export function updateNavigationStyle(map: MapLibreMap, active: boolean): void {
  if (M.focusModeActive === active) return;
  M.focusModeActive = active;
  if (!active) {
    M.lastIntersectionTier = 0; // sonraki nav oturumu için sıfırla
  }
  _applyFocusMode(map, active);
}

/** setNavigationFocusMode → updateNavigationStyle alias (backward compat). */
export const setNavigationFocusMode = updateNavigationStyle;

/** Style switch sonrası mevcut focus + intersection tier'ı yeniden uygula. */
export function reapplyNavigationFocus(map: MapLibreMap): void {
  _applyFocusMode(map, M.focusModeActive);
  // Style switch tüm paint'leri sıfırlar — intersection tier'ı yeniden uygula
  if (M.focusModeActive) {
    _applyIntersectionSuppression(map, M.lastIntersectionTier);
  }
}

/* ── Rota çizgisi ───────────────────────────────────────────── */

/** mapService._isStyleChanging'i FullMapView mutex ile senkronize et. */
export function setMapStyleChanging(active: boolean): void {
  M.isStyleChanging = active;
}

/**
 * Haritada rota çizgisi göster ya da güncelle (hardened).
 */
export function setRouteGeometry(
  map:             MapLibreMap,
  coordinates:     [number, number][],
  alternatives:    [number, number][][] = [],
  altRealIndices?: number[],
  altDurations?:   number[],
  mainDuration?:   number,
): void {
  if (!map || !coordinates.length) return;

  M.cachedRoute          = { coords: coordinates, alts: alternatives, altIdx: altRealIndices, altDurs: altDurations, mainDur: mainDuration };
  M.pendingRouteGeometry = { coords: coordinates, alts: alternatives, altIdx: altRealIndices, altDurs: altDurations, mainDur: mainDuration };

  // Visibility / Deadlock Watchdog
  if (map.isStyleLoaded() && !map.getLayer(SEL_LAYER)) {
    if (M.isStyleChanging) M.isStyleChanging = false;
  }

  if (M.isStyleChanging) return;

  _applyRouteGeometry(map, coordinates, alternatives, altRealIndices, 0, altDurations, mainDuration);
}

export function _applyRouteGeometry(
  map:             MapLibreMap,
  coordinates:     [number, number][],
  alternatives:    [number, number][][],
  altRealIndices?: number[],
  retryCount       = 0,
  altDurations?:   number[],
  mainDuration?:   number,
): void {
  if (!map) return;

  if (!map.isStyleLoaded()) {
    if (retryCount < 40) {
      setTimeout(
        () => _applyRouteGeometry(map, coordinates, alternatives, altRealIndices, retryCount + 1, altDurations, mainDuration),
        50,
      );
    }
    return;
  }

  try {
    // routingService.normalizeCoords() already guarantees [lon, lat] order.
    const coords: [number, number][] = coordinates;

    // ── Alternatif rotalar (gri, arkada) ─────────────────────────
    const fixedAlts = alternatives;
    const altFeatures = fixedAlts.map((altCoords, i) => ({
      type: 'Feature' as const,
      geometry: { type: 'LineString' as const, coordinates: altCoords },
      properties: { altRealIdx: altRealIndices?.[i] ?? (i + 1) },
    }));
    const altData = { type: 'FeatureCollection' as const, features: altFeatures };
    // Robust: source orphan veya layer silinmiş → ikisini birden yeniden oluştur
    if (!map.getSource(ALT_SRC) || !map.getLayer(ALT_FILL)) {
      try { if (map.getLayer(ALT_FILL)) map.removeLayer(ALT_FILL); } catch { /* ignore */ }
      try { if (map.getSource(ALT_SRC)) map.removeSource(ALT_SRC); } catch { /* ignore */ }
      map.addSource(ALT_SRC, { type: 'geojson', data: altData });
      map.addLayer({
        id: ALT_FILL,
        type: 'line',
        source: ALT_SRC,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        // SAHA FİX 2026-06-12 ("alternatif rotayı Google/Yandex gibi göster"): eski gri
        // 0.50 opacity + sabit 6px ana rotanın altında kayboluyordu. Belirgin + zoom-ölçekli
        // (görünürlük + dokunma hedefi büyür); ana mavi rotanın ARKASINDA kalır, tıklanınca
        // selectAltRoute ile seçilir (car-route-alt-fill click köprüsü).
        paint: {
          'line-color':   '#9aa6ba',
          'line-width':   ['interpolate', ['linear'], ['zoom'], 12, 5, 16, 9, 18, 13],
          'line-opacity': 0.9,
        },
      });
    } else {
      (map.getSource(ALT_SRC) as GeoJSONSource).setData(altData);
    }

    // ── Alternatif rota zaman etiketleri (midpoint badge) ────────────────────
    const badgeFeatures = fixedAlts.map((altCoords, i) => {
      const mid = altCoords[Math.floor(altCoords.length / 2)] ?? altCoords[0];
      const altDur  = altDurations?.[i];
      const diffSec = altDur !== undefined && mainDuration !== undefined ? altDur - mainDuration : null;
      let label = '';
      if (diffSec !== null) {
        const mins = Math.round(Math.abs(diffSec) / 60);
        label = diffSec > 0 ? `+${mins} dk` : mins === 0 ? '' : `-${mins} dk`;
      }
      return {
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: mid },
        properties: { label },
      };
    }).filter(f => (f.properties.label as string).length > 0);
    const badgeData = { type: 'FeatureCollection' as const, features: badgeFeatures };
    /* Rozet etiketi `text-field` kullanır → stilde `glyphs` ZORUNLUDUR.
       RASTER stilde (buildRoadStyle / getOnlineTileStyle) `glyphs` BİLDİRİLMEZ —
       yalnız vektör stilinde vardır. Glyphs yokken katman eklenirse MapLibre
       doğrulaması reddeder ("use of text-field requires a style glyphs property")
       ve ardından gelen `moveLayer` çağrıları "layer does not exist" hatası
       yayınlar. Saha 2026-08-02: cihazdaki son 50 harita hatasının 14'ü tam
       olarak bu zincirdi. Glyphs yoksa rozet SESSİZCE atlanır — alternatif rota
       ÇİZGİLERİ (ALT_FILL) bundan etkilenmez, yalnız süre rozeti görünmez.
       AÇIK BORÇ: raster stile ticari kullanıma uygun bir `glyphs` kaynağı
       tanımlanana kadar rozet raster modda çalışmaz. */
    const _glyphsOk = (() => { try { return !!map.getStyle().glyphs; } catch { return false; } })();
    if (!_glyphsOk) {
      /* rozet katmanı atlanır — hata YAYINLANMAZ */
    } else if (!map.getSource(ALT_BADGE_SRC) || !map.getLayer(ALT_BADGE_LAYER)) {
      try { if (map.getLayer(ALT_BADGE_LAYER)) map.removeLayer(ALT_BADGE_LAYER); } catch { /* ignore */ }
      try { if (map.getSource(ALT_BADGE_SRC)) map.removeSource(ALT_BADGE_SRC); } catch { /* ignore */ }
      map.addSource(ALT_BADGE_SRC, { type: 'geojson', data: badgeData });
      _ensureBadgeImage(map); // C7.3 — badge arkaplan imajını hazırla
      map.addLayer({
        id:      ALT_BADGE_LAYER,
        type:    'symbol',
        source:  ALT_BADGE_SRC,
        minzoom: 10, // çok düşük zoom'da etiket gizlenir — kalabalık önleme
        layout: {
          'text-field':  ['get', 'label'],
          'text-font':   ['Open Sans Bold', 'Arial Unicode MS Bold'],
          'text-size':   ['interpolate', ['linear'], ['zoom'], 10, 10, 15, 14],
          'icon-image':            BADGE_IMAGE_ID,
          'icon-text-fit':         'both',
          'icon-text-fit-padding': [5, 10, 5, 10], // üst, sağ, alt, sol padding (px)
          'text-variable-anchor': ['top', 'bottom', 'left', 'right'],
          'text-justify':         'center',
          'text-letter-spacing':   0.03,
          'text-allow-overlap':    false,
          'text-ignore-placement': false,
        },
        paint: {
          'text-color':      '#ffffff',
          'text-halo-color': 'rgba(0,0,0,0.70)',
          'text-halo-width': 2,
          'icon-opacity':    0.92,
          'text-opacity':    1,
        },
      });
    } else {
      (map.getSource(ALT_BADGE_SRC) as GeoJSONSource).setData(badgeData);
    }

    // Head unit / düşük GPU tespiti — line-blur, line-gradient ve ekstra katmanlar atlanır.
    // #619: türetme TEK yerde (`_isPerfLowSurface`) — renk yazıcısı da aynı gerçeği okur,
    // yoksa kurulum gradient kurup canlı güncelleme düz renk yazabilirdi (iki gerçek).
    const _isLowEnd = _isPerfLowSurface();

    // ── Step 3: route stack — source + layer re-creation (robust) ──
    const _selSrcOk    = !!map.getSource(SEL_SRC);
    const _selLayersOk = _isLowEnd
      ? (!!map.getLayer(ROUTE_CASE) && !!map.getLayer(SEL_LAYER))
      : (!!map.getLayer(ROUTE_SHADOW)
         && !!map.getLayer(ROUTE_GLOW_SEL)
         && !!map.getLayer(ROUTE_CASE)
         && !!map.getLayer(SEL_LAYER)
         && !!map.getLayer(ROUTE_FLOW));

    /* ── ROTA KALINLIĞI — TEK OTORİTE ────────────────────────────────────────
     * Beş katmanın kalınlığı tek çekirdekten türer (`core/routeWidthModel`).
     * Eskiden burada beş bağımsız sabit çifti vardı ve sürüş başlayınca
     * perspektif düzeltmesi ikisini bambaşka sayılarla eziyordu → katman sırası
     * tersine dönüp neon halo ile derinlik gölgesi kayboluyordu.
     * Perspektif burada 1,0'dır: kurulum anı düz kameradır, sürüş görünümü
     * açılınca `setDrivingView` aynı politikayı perspektifle yeniden uygular. */
    const _rw = resolveRouteWidths(map, 1);

    /* ── ROTA RENGİ — YENİDEN ÇİZİMDE DE ANLIK DURUMDAN ────────────────────
     * K1'in İKİNCİ yolu buradaydı: eski kod kurulumda case'i KOŞULSUZ beyaza,
     * glow'u koşulsuz maviye çiziyor, `lastManeuverTier`ı sıfırlıyor ama
     * `lastExternalRiskAlert`i SIFIRLAMIYORDU. Risk yüksekken yeni rota
     * çizilirse amber siliniyor ve bayrak `true` kaldığı için bir daha
     * uygulanmıyordu. Artık kurulum da AYNI hakemden geçer.
     *
     * Kademe burada bilinmez (rota yeni çizildi, manevra mesafesi yok) → 0
     * varsayılır; `setDrivingView` bir sonraki tick'te kademeyi getirir ve
     * anahtar değişirse renk kendiliğinden düzelir. Tehlike ise BURADA da
     * okunur — kaybolan sinyal buydu. */
    const _hazardHighNow = useHazardStore.getState().globalRiskScore > 0.5;
    const _rc = resolveRouteColor({
      maneuverTier: 0,
      hazardHigh: _hazardHighNow,
      lightBasemap: resolveLightBasemap(),
    });

    if (!_selSrcOk || !_selLayersOk) {
      // Temizle — ters sırayla (üstten alta) kaldır
      for (const id of [ROUTE_FLOW, SEL_LAYER, ROUTE_CASE, ROUTE_GLOW_SEL, ROUTE_SHADOW]) {
        try { if (map.getLayer(id)) map.removeLayer(id); } catch { /* ignore */ }
      }
      try { if (map.getSource(SEL_SRC)) map.removeSource(SEL_SRC); } catch { /* ignore */ }

      // Source — lineMetrics: true, line-gradient ve line-progress için zorunlu
      map.addSource(SEL_SRC, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
        lineMetrics: !_isLowEnd, // perf-low'da gerekmiyor (gradient yok)
      });

      // Layer 0 — Shadow: line-blur GPU yoğun, head unit'lerde atla
      if (!_isLowEnd) {
        map.addLayer({
          id: ROUTE_SHADOW,
          type: 'line',
          source: SEL_SRC,
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: {
            'line-color':  '#000000',
            'line-width':  routeWidthExpression(_rw.shadow),
            'line-opacity': 0.20,
            'line-blur':    8,
            'line-offset':  3,
          },
        });

        // Layer 1 — Outer Glow: blur ile neon halo, head unit'lerde atla
        map.addLayer({
          id: ROUTE_GLOW_SEL,
          type: 'line',
          source: SEL_SRC,
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: {
            'line-color':  _rc.glow,
            'line-width':  routeWidthExpression(_rw.glow),
            'line-opacity': 0.20,
            'line-blur':    10,
          },
        });
      }

      // Layer 2 — Casing: beyaz sınır (Google Maps tarzı — ince ve net)
      map.addLayer({
        id: ROUTE_CASE,
        type: 'line',
        source: SEL_SRC,
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-color':  _rc.casing,
          'line-width':  routeWidthExpression(_rw.casing),
          'line-opacity': 0.95,
        },
      });
      /* Dinamik paint sözlüğü: düşük-uçta düz renk, aksi hâlde gradient eklenir.
         MapLibre'nin KENDİ line-paint tipiyle bağlanır — `any` değil. */
      const _coreFillPaint: NonNullable<maplibregl.LineLayerSpecification['paint']> = {
        'line-width':  routeWidthExpression(_rw.core),
        'line-opacity': _rc.coreOpacity,
      };
      if (_isLowEnd) {
        // #619 — düz renk de karardan gelir (gece parlak, gündüz Google mavisi).
        _coreFillPaint['line-color'] = _rc.coreStops[0];
      } else {
        _coreFillPaint['line-gradient'] = [
          'interpolate', ['linear'], ['line-progress'],
          0,   _rc.coreStops[0],  // departure
          0.5, _rc.coreStops[1],  // mid
          1,   _rc.coreStops[2],  // arrival
        ];
      }
      map.addLayer({
        id: SEL_LAYER,
        type: 'line',
        source: SEL_SRC,
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: _coreFillPaint,
      });

      // Layer 4 — Flow: cinematic light trail.
      if (!_isLowEnd) {
        map.addLayer({
          id: ROUTE_FLOW,
          type: 'line',
          source: SEL_SRC,
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: {
            'line-width':    routeWidthExpression(_rw.flow),
            'line-opacity':  0.85,
            'line-gradient': _buildPulseGradient(0.5),
          },
        });

        // Light trail rAF loop başlat (singleton — çift çağrı güvenli)
        _startLightTrail();
      }

    } else {
      // Tüm katmanlar mevcut — sadece maneuver/perspective state sıfırla.
      M.lastPerspectiveScale = 1.0;
      M.lastIntersectionTier = 0;
      /* Katmanlar duruyor ama YÜZEY değişmiş olabilir (mini harita ↔ tam ekran,
         ekran döndü). Perspektif de burada 1,0'a sıfırlandığı için kalınlıklar
         politikayla yeniden hizalanır; yoksa yeni rota eski yüzeyin ölçeğiyle
         çizilir ve iki görünüm arasında ağırlık farkı kalır. */
      safeSetPaint(map, ROUTE_SHADOW,   'line-width', routeWidthExpression(_rw.shadow));
      safeSetPaint(map, ROUTE_GLOW_SEL, 'line-width', routeWidthExpression(_rw.glow));
      safeSetPaint(map, ROUTE_CASE,     'line-width', routeWidthExpression(_rw.casing));
      safeSetPaint(map, SEL_LAYER,      'line-width', routeWidthExpression(_rw.core));
      safeSetPaint(map, ROUTE_FLOW,     'line-width', routeWidthExpression(_rw.flow));
    }

    /* Her İKİ dal da aynı hakemden geçer ve karar KAYDEDİLİR (`force`): yeni
       katmanlar `_rc` ile kuruldu, mevcut katmanlara aynı karar yazılır. Kayıt
       şart — yoksa bir sonraki `syncRouteColor` dedup'ta eski anahtarı görüp
       boyayı hiç yazmaz ve yeniden çizilen rota yanlış renkte kalır. */
    syncRouteColor(map, 0, _hazardHighNow, true);

    // ── Step 4: set data ─────────────────────────────────────────
    const routeFeature = {
      type: 'Feature' as const,
      properties: {},
      geometry: { type: 'LineString' as const, coordinates: coords },
    };
    (map.getSource(SEL_SRC) as GeoJSONSource).setData(routeFeature);

    // NAV-5: rotayı TRAFİK YOĞUNLUĞUNA göre renklendir (best-effort, BYOK, fail-soft).
    // Yalnız SEL_LAYER'ın line-gradient paint'ini değiştirir → rota ÇİZGİSİNİ bozamaz.
    // Trafik verisi yoksa (anahtar yok/hata) mevcut dekoratif gradient AYNEN kalır.
    // Düşük-uçta gradient zaten yok (solid renk) → atla.
    if (!_isLowEnd) void _refreshRouteTrafficGradient(map, coords as [number, number][]);

    // ── Step 5: z-ordering — alt→üst: shadow→glow→case→core→flow→araç ────────
    // `safeMoveLayer`: düşük-GPU'da shadow/glow/flow OLUŞTURULMAZ. MapLibre
    // olmayan katmanda throw ETMEZ, `error` olayı yayınlar → eski `try/catch`
    // hiçbir şey yakalamıyor, her kare hata defterini dolduruyordu (saha 2026-08-02).
    for (const id of [ALT_FILL, ALT_BADGE_LAYER, ROUTE_SHADOW, ROUTE_GLOW_SEL,
                      ROUTE_CASE, SEL_LAYER, ROUTE_FLOW,
                      // Araç marker'ı tüm rota katmanlarının üstünde
                      'user-glow', 'user-ring', 'user-vehicle']) {
      safeMoveLayer(map, id);
    }

    // ── Step 6: fit bounds (sadece preview modda) ───
    if (!useMapStore.getState().drivingMode) {
      try {
        if (coords.length >= 2) {
          const bounds = coords.reduce(
            (b, c) => b.extend(c as [number, number]),
            new maplibregl.LngLatBounds(coords[0] as [number, number], coords[0] as [number, number]),
          );
          map.fitBounds(bounds, { padding: 80, maxZoom: 15, duration: 500 });
        }
      } catch { /* fitBounds geometry hatası — yoksay */ }
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[MAP_WEBGL_ERROR]', msg);
    if (retryCount < 1) {
      setTimeout(() => _applyRouteGeometry(map, coordinates, alternatives, altRealIndices, 1, altDurations, mainDuration), 500);
    }
    return;
  }

  M.pendingRouteGeometry = null;
}

/* ── NAV-5: rota trafik-yoğunluğu gradient'i ───────────────────────────────
 * Rota çizilince trafik stop'larını örnekler ve SEL_LAYER line-gradient'ini günceller.
 * Generation guard: örnekleme uzun sürerken rota değişirse ESKİ sonuç UYGULANMAZ (yarış yok).
 * Fail-soft: veri yok / anahtar yok / hata → dekoratif gradient'e DOKUNULMAZ. */
let _trafficGradientGen = 0;
async function _refreshRouteTrafficGradient(map: MapLibreMap, coords: [number, number][]): Promise<void> {
  const gen = ++_trafficGradientGen;
  try {
    if (coords.length < 2) return;
    const { sampleRouteTrafficStops, buildTrafficGradient } = await import('./routeTrafficGradient');
    const stops = await sampleRouteTrafficStops(coords);
    if (gen !== _trafficGradientGen) return;               // rota değişti → eski sonucu bırak
    const grad = stops ? buildTrafficGradient(stops) : null;
    if (grad && map.getLayer(SEL_LAYER)) {
      try { map.setPaintProperty(SEL_LAYER, 'line-gradient', grad as unknown as maplibregl.ExpressionSpecification); }
      catch { /* stil reload — sonraki çizimde tekrar denenir */ }
    }
    // grad null → trafik verisi yok → dekoratif kalkış→varış gradient'i AYNEN korunur.
  } catch { /* fail-soft — trafik gradient'i rota akışını ASLA etkilemez */ }
}

/**
 * Kat edilen rotayı kırp — SEL_SRC verisini snapped noktadan İLERİYE kalan
 * geometriyle değiştirir (geride kalan çizgi silinir).
 *
 * setRouteGeometry'ye DOKUNMAZ: cache (M.cachedRoute) tam geometriyi tutmaya
 * devam eder — stil değişiminde tam rota geri çizilir, bir sonraki GPS tick'i
 * kırpmayı yeniden uygular (kendiliğinden iyileşir). Yalnız segment index
 * değişince çağrılır (FullMapView) → Mali-400'de setData yükü seyrek kalır.
 */
export function trimRouteGeometry(map: MapLibreMap, remaining: [number, number][]): void {
  if (!map || remaining.length < 2) return;
  if (M.isStyleChanging) return; // stil geçişi sürerken source'a dokunma
  try {
    /* ── STİL KAPISI KALDIRILDI (saha 2026-08-13) ────────────────────────────
     * Kullanıcı: *"konum ileri gittikçe rota silinmiyor."*
     *
     * Kök, bu projede DAHA ÖNCE kamerada bulunup düzeltilmiş kusurun İKİNCİ
     * kopyasıydı (bkz. regresyon kasası: "SÜRÜŞ KAMERASI STİL-KAPISI YASAĞI").
     * `isStyleLoaded()` sürüş sırasında İKİ NORMAL durumda `false` döner:
     *   1. Aynı karede başka bir `setData` stili kirletir — ve `updateUserMarker`
     *      tam olarak bunu **~16 fps** ile yapıyor (araç işaretçisi).
     *   2. Sürüşte sürekli yeni tile yüklenir → `sourceCache.loaded()` false.
     * Kırpma GPS tick'inde (~1 Hz) çağrıldığı için stilin "temiz" olduğu ana
     * denk gelmesi neredeyse imkânsızdı → fonksiyon SESSİZCE erken dönüyor,
     * kat edilen rota hiç silinmiyordu.
     *
     * Doğru desen zaten üründe kanıtlı: `updateUserMarker` VAR OLAN bir
     * source'a `setData`i **kapısız** çağırır ve saniyede 16 kez sorunsuz
     * çalışır. Var olan bir GeoJSON source'a veri yazmak yüklü stil GEREKTİRMEZ;
     * gereken tek şey source'un var olmasıdır — o da aşağıda kontrol edilir,
     * `try/catch` de yerinde duruyor. Kaldırılan yalnız SAHTE kapıdır. */
    if (!map.getSource(SEL_SRC)) return;
    (map.getSource(SEL_SRC) as GeoJSONSource).setData({
      type: 'Feature',
      properties: {},
      geometry: { type: 'LineString', coordinates: remaining },
    });
  } catch { /* stil yeniden yükleniyor olabilir — sonraki tick yeniden dener */ }
}

/** Rota çizgilerini (ana + alternatifler + debug) ve cache'i temizle. */
export function clearRouteGeometry(map: MapLibreMap): void {
  M.cachedRoute          = null;
  M.pendingRouteGeometry = null;
  // Light trail rAF loop durdur — cancelAnimationFrame garantili
  _stopLightTrail();
  // Perspektif / intersection durumunu sıfırla
  M.lastPerspectiveScale  = 1.0;
  M.lastIntersectionTier  = 0;
  /* Rota gitti → renk kararı da unutulur; sonraki rota anlık duruma göre
     BAŞTAN karar alır (bayat anahtar yüzünden boya atlanmaz). */
  resetRouteColorState();
  if (!map || M.isStyleChanging) return;
  try {
    if (map.getLayer(DEBUG_LAYER))     map.removeLayer(DEBUG_LAYER);
    if (map.getSource(DEBUG_SRC))      map.removeSource(DEBUG_SRC);
    // 5-layer stack — ters sırayla kaldır (üstten alta)
    if (map.getLayer(ROUTE_FLOW))      map.removeLayer(ROUTE_FLOW);
    if (map.getLayer(SEL_LAYER))       map.removeLayer(SEL_LAYER);
    if (map.getLayer(ROUTE_CASE))      map.removeLayer(ROUTE_CASE);
    if (map.getLayer(ROUTE_GLOW_SEL))  map.removeLayer(ROUTE_GLOW_SEL);
    if (map.getLayer(ROUTE_SHADOW))    map.removeLayer(ROUTE_SHADOW);
    if (map.getSource(SEL_SRC))        map.removeSource(SEL_SRC);
    if (map.getLayer(ALT_FILL))         map.removeLayer(ALT_FILL);
    if (map.getSource(ALT_SRC))         map.removeSource(ALT_SRC);
    if (map.getLayer(ALT_BADGE_LAYER))  map.removeLayer(ALT_BADGE_LAYER);
    if (map.getSource(ALT_BADGE_SRC))   map.removeSource(ALT_BADGE_SRC);
  } catch { /* ignore — style may already be reset */ }
  clearTurnFocus();
}

/* ── Dönüş odak noktası (turn focus marker) ────────────────── */

/**
 * Bir sonraki dönüş noktasını haritada vurgula (CSS animasyonlu DOM marker).
 */
export function setTurnFocus(map: MapLibreMap, lon: number, lat: number): void {
  if (!map) return;
  if (M.turnFocusMarker) {
    M.turnFocusMarker.setLngLat([lon, lat]);
    return;
  }
  const el = document.createElement('div');
  el.style.cssText = [
    'width:36px',
    'height:36px',
    'border-radius:50%',
    'background:rgba(245,158,11,0.22)',
    'border:2px solid rgba(245,158,11,0.82)',
    'box-shadow:0 0 18px rgba(245,158,11,0.45),0 0 6px rgba(245,158,11,0.7)',
    'animation:turnFocusPulse 1.4s ease-in-out infinite',
    'pointer-events:none',
  ].join(';');
  M.turnFocusMarker = new Marker({ element: el, anchor: 'center' })
    .setLngLat([lon, lat])
    .addTo(map);
}

/** Dönüş odak marker'ını kaldır. */
export function clearTurnFocus(): void {
  if (M.turnFocusMarker) {
    M.turnFocusMarker.remove();
    M.turnFocusMarker = null;
  }
}

/* ── Driving Layer Updater ──────────────────────────────────────────────── */

/**
 * Hız ve konuma göre harita katmanlarını dinamik güncelle.
 */
export function updateDrivingLayers(
  map: MapLibreMap,
  speedKmh: number,
  lat: number,
  lng: number,
): void {
  if (!map || !map.isStyleLoaded()) return;

  // ── Hız bazlı katman gizleme ─────────────────────────────
  const hideHighSpeed = speedKmh > 80;
  if (hideHighSpeed !== M.lastSpeedHide) {
    M.lastSpeedHide = hideHighSpeed;
    if (map.getLayer('building-3d')) {
      map.setPaintProperty('building-3d', 'fill-extrusion-opacity', hideHighSpeed ? 0 : 0.4);
    }
    if (map.getLayer('road-label')) {
      // Focus mode already reduces road-label opacity; only override when hiding fully
      if (!M.focusModeActive || hideHighSpeed) {
        map.setPaintProperty('road-label', 'text-opacity', hideHighSpeed ? 0.25 : 1);
      }
    }
  }

  // ── GPU overdraw guard — blur zımalaması browsing modda (pitch ≈ 0) ─────────
  if (M.lastShadowPitch <= 0) {
    const blurNow = speedKmh > 20;
    if (blurNow !== M.lastBlurReduced) {
      M.lastBlurReduced = blurNow;
      safeSetPaint(map, ROUTE_SHADOW,   'line-blur', blurNow ? 3 : 8);
      safeSetPaint(map, ROUTE_GLOW_SEL, 'line-blur', blurNow ? 5 : 10);
    }
  }

  // ── POI Proximity Glow — queryRenderedFeatures (~500m yarıçap) ───────────
  const poiLayers = ['poi-gas', 'poi-parking', 'poi-hospital', 'poi-police'];
  const visiblePOI = poiLayers.filter((l) => map.getLayer(l));
  if (visiblePOI.length === 0) return;

  const center = map.project([lng, lat]);
  const R_PX   = 120; // ~300–500m at nav zoom 17-18
  const nearby = map.queryRenderedFeatures(
    [[center.x - R_PX, center.y - R_PX], [center.x + R_PX, center.y + R_PX]],
    { layers: visiblePOI },
  );
  const nearbyByLayer = new Set(nearby.map((f) => f.layer.id));

  const glowStroke: Record<string, string> = {
    'poi-gas':      '#fde68a',
    'poi-parking':  '#93c5fd',
    'poi-hospital': '#fca5a5',
    'poi-police':   '#c4b5fd',
  };
  for (const layer of visiblePOI) {
    const hot = nearbyByLayer.has(layer);
    map.setPaintProperty(layer, 'circle-stroke-width', hot ? 3.5 : 1.5);
    map.setPaintProperty(layer, 'circle-opacity',      hot ? 1.0 : 0.55);
    if (hot) map.setPaintProperty(layer, 'circle-stroke-color', glowStroke[layer] ?? '#ffffff');
  }
}
