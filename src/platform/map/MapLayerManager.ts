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
import {
  NAV_SUPPRESS_LAYERS,
  NAV_SUPPRESS_TIERS,
  RASTER_PAINT_DAY,
  RASTER_PAINT_NIGHT,
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
  PULSE_TRANSPARENT,
  MOOD_THROTTLE_MS,
  MOOD_HYSTERESIS,
} from './_mapState';

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
  } as any);

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
    } as any,
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
    } as any,
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
    } as any,
  });

  // Katmanları en üste taşı — raster/vektör geçişlerinde veya OOM sonrası
  // diğer katmanların (rota, POI) üzerinde kalması garantilenir.
  try { map.moveLayer('user-glow'); }    catch { /* stil geçişi sırasında güvenli */ }
  try { map.moveLayer('user-ring'); }    catch { /* stil geçişi sırasında güvenli */ }
  try { map.moveLayer('user-vehicle'); } catch { /* stil geçişi sırasında güvenli */ }
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
  if ((moving || M.markerNavActive) && now - M.lastRingPulseMs > 150) {
    M.lastRingPulseMs = now;
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

  const feature = {
    type: 'Feature' as const,
    geometry: {
      type: 'Point' as const,
      coordinates: [longitude, latitude],
    },
    properties: { heading: heading ?? 0 },
  };

  source.setData({
    type: 'FeatureCollection',
    features: [feature],
  } as any);
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
 * Harita gün/gece geçişi — RESTYLE OLMADAN canlı paint güncellemesi (rota katmanları korunur).
 */
export function applyMapDayNight(night: boolean, mapArg?: ReturnType<typeof useMapStore.getState>['mapInstance']): void {
  setMapNight(night);
  setMarkerTheme(night);
  const map = mapArg ?? useMapStore.getState().mapInstance;
  if (!map) return;
  try {
    // 'tiles-layer' = buildRoadStyle/getOnlineTileStyle standardı; 'osm-tiles'/'osm-layer'
    // eski sabit stillerin id'leri — id eşleşmezse geçiş sessizce no-op oluyordu (gündüz
    // temada kalıcı gece harita). Hangisi varsa onu canlı patch'le.
    const rasterLayerId = ['tiles-layer', 'osm-tiles', 'osm-layer'].find((id) => map.getLayer(id));
    if (rasterLayerId) {
      // RASTER (OSM) → canlı paint: restyle yok, rota/marker korunur (en yaygın yol).
      const paint = night ? RASTER_PAINT_NIGHT : RASTER_PAINT_DAY;
      for (const [prop, val] of Object.entries(paint)) {
        map.setPaintProperty(rasterLayerId, prop as any, val as any);
      }
      if (map.getLayer('background')) {
        map.setPaintProperty('background', 'background-color', night ? '#131822' : '#e9eef3');
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
function _buildPulseGradient(p: number, riskScore = 0, isAttention = false): unknown[] {
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
      0, PULSE_TRANSPARENT, 1, PULSE_TRANSPARENT];
  }
  return [
    'interpolate', ['linear'], ['line-progress'],
    t0, PULSE_TRANSPARENT,
    t1, PULSE_TRANSPARENT,
    t2, M.pShoulderStr,
    t3, M.pPeakStr,
    t4, PULSE_TRANSPARENT,
    t5, PULSE_TRANSPARENT,
  ];
}

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
  const width          = Math.max(10, 22 + breath * 12 * visualRisk * amplitudeScale);

  try { map.setPaintProperty(ROUTE_GLOW_SEL, 'line-width', width); }
  catch { /* style reloading */ }
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
      map.addSource(ALT_SRC, { type: 'geojson', data: altData } as any);
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
      } as any);
    } else {
      (map.getSource(ALT_SRC) as any).setData(altData);
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
    if (!map.getSource(ALT_BADGE_SRC) || !map.getLayer(ALT_BADGE_LAYER)) {
      try { if (map.getLayer(ALT_BADGE_LAYER)) map.removeLayer(ALT_BADGE_LAYER); } catch { /* ignore */ }
      try { if (map.getSource(ALT_BADGE_SRC)) map.removeSource(ALT_BADGE_SRC); } catch { /* ignore */ }
      map.addSource(ALT_BADGE_SRC, { type: 'geojson', data: badgeData } as any);
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
      } as any);
    } else {
      (map.getSource(ALT_BADGE_SRC) as any).setData(badgeData);
    }

    // Head unit / düşük GPU tespiti — line-blur, line-gradient ve ekstra katmanlar atlanır
    const _isLowEnd = typeof document !== 'undefined' &&
      document.documentElement.classList.contains('perf-low');

    // ── Step 3: route stack — source + layer re-creation (robust) ──
    const _selSrcOk    = !!map.getSource(SEL_SRC);
    const _selLayersOk = _isLowEnd
      ? (!!map.getLayer(ROUTE_CASE) && !!map.getLayer(SEL_LAYER))
      : (!!map.getLayer(ROUTE_SHADOW)
         && !!map.getLayer(ROUTE_GLOW_SEL)
         && !!map.getLayer(ROUTE_CASE)
         && !!map.getLayer(SEL_LAYER)
         && !!map.getLayer(ROUTE_FLOW));

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
      } as any);

      // Layer 0 — Shadow: line-blur GPU yoğun, head unit'lerde atla
      if (!_isLowEnd) {
        map.addLayer({
          id: ROUTE_SHADOW,
          type: 'line',
          source: SEL_SRC,
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: {
            'line-color':  '#000000',
            'line-width':  ['interpolate', ['linear'], ['zoom'], 12, 8, 18, 22],
            'line-opacity': 0.20,
            'line-blur':    8,
            'line-offset':  3,
          },
        } as any);

        // Layer 1 — Outer Glow: blur ile neon halo, head unit'lerde atla
        map.addLayer({
          id: ROUTE_GLOW_SEL,
          type: 'line',
          source: SEL_SRC,
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: {
            'line-color':  '#4285f4',
            'line-width':  ['interpolate', ['linear'], ['zoom'], 12, 10, 18, 24],
            'line-opacity': 0.20,
            'line-blur':    10,
          },
        } as any);
      }

      // Layer 2 — Casing: beyaz sınır (Google Maps tarzı — ince ve net)
      map.addLayer({
        id: ROUTE_CASE,
        type: 'line',
        source: SEL_SRC,
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-color':  '#ffffff',
          'line-width':  ['interpolate', ['linear'], ['zoom'], 12, 6, 18, 14],
          'line-opacity': 0.95,
        },
      } as any);
      const _coreFillPaint: any = {
        'line-width':  ['interpolate', ['linear'], ['zoom'], 12, 4, 18, 10],
        'line-opacity': 1,
      };
      if (_isLowEnd) {
        _coreFillPaint['line-color'] = '#1A73E8'; // Solid Google blue — head unit safe
      } else {
        _coreFillPaint['line-gradient'] = [
          'interpolate', ['linear'], ['line-progress'],
          0,   '#1A73E8',  // departure — Google blue
          0.5, '#4F46E5',  // mid — indigo
          1,   '#10b981',  // arrival — emerald
        ];
      }
      map.addLayer({
        id: SEL_LAYER,
        type: 'line',
        source: SEL_SRC,
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: _coreFillPaint,
      } as any);

      // Layer 4 — Flow: cinematic light trail.
      if (!_isLowEnd) {
        map.addLayer({
          id: ROUTE_FLOW,
          type: 'line',
          source: SEL_SRC,
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: {
            'line-width':    ['interpolate', ['linear'], ['zoom'], 12, 4, 18, 14],
            'line-opacity':  0.85,
            'line-gradient': _buildPulseGradient(0.5),
          },
        } as any);

        // Light trail rAF loop başlat (singleton — çift çağrı güvenli)
        _startLightTrail();
      }

    } else {
      // Tüm katmanlar mevcut — sadece maneuver/perspective state sıfırla.
      M.lastPerspectiveScale = 1.0;
      M.lastManeuverTier     = 0;
      try {
        map.setPaintProperty(SEL_LAYER,      'line-opacity', 1);
        map.setPaintProperty(ROUTE_CASE,     'line-color',   '#ffffff');
        map.setPaintProperty(ROUTE_GLOW_SEL, 'line-color',   '#4285f4');
      } catch { /* style may be reloading */ }
    }

    // ── Step 4: set data ─────────────────────────────────────────
    const routeFeature = {
      type: 'Feature',
      properties: {},
      geometry: { type: 'LineString', coordinates: coords },
    };
    (map.getSource(SEL_SRC) as any).setData(routeFeature);

    // ── Step 5: z-ordering — alt→üst: shadow→glow→case→core→flow→araç ────────
    try { map.moveLayer(ALT_FILL); }        catch { /* ignore */ }
    try { map.moveLayer(ALT_BADGE_LAYER); } catch { /* ignore */ }
    try { map.moveLayer(ROUTE_SHADOW); }    catch { /* ignore */ }
    try { map.moveLayer(ROUTE_GLOW_SEL); } catch { /* ignore */ }
    try { map.moveLayer(ROUTE_CASE); }     catch { /* ignore */ }
    try { map.moveLayer(SEL_LAYER); }      catch { /* ignore */ }
    try { map.moveLayer(ROUTE_FLOW); }     catch { /* ignore */ }
    // Araç marker'ı tüm rota katmanlarının üstünde
    try { map.moveLayer('user-glow'); }    catch { /* ignore */ }
    try { map.moveLayer('user-ring'); }    catch { /* ignore */ }
    try { map.moveLayer('user-vehicle'); } catch { /* ignore */ }

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
    if (!map.isStyleLoaded() || !map.getSource(SEL_SRC)) return;
    (map.getSource(SEL_SRC) as any).setData({
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
  // Perspektif / manevra / intersection durumunu sıfırla
  M.lastPerspectiveScale  = 1.0;
  M.lastManeuverTier      = 0;
  M.lastIntersectionTier  = 0;
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
      if (map.getLayer(ROUTE_SHADOW)) {
        try { map.setPaintProperty(ROUTE_SHADOW,   'line-blur', blurNow ? 3  : 8);  } catch { /* noop */ }
      }
      if (map.getLayer(ROUTE_GLOW_SEL)) {
        try { map.setPaintProperty(ROUTE_GLOW_SEL, 'line-blur', blurNow ? 5  : 10); } catch { /* noop */ }
      }
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
