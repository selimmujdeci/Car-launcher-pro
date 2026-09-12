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
/* ARCH-06/F1 — YALNIZ SAYAÇ. Koordinat, geometri ve rota verisi ölçüm
   katmanına TAŞINMAZ; MapLibre render otoritesi DEĞİŞMEDİ. */
import { bumpPerf } from '../perf/perfCounters';
import { setMapNight } from '../mapSourceManager';
import { safeMoveLayer, safeSetPaint } from './_safeLayerOps';
import { captureRouteLayerProbe, rememberRouteLayerProbe } from './routeLayerProbe';
import { rememberRouteGeometry } from './routeVisibilityProbe';
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
import {
  buildRouteStepLabelSegments,
  type RouteStepLabelInput,
} from './core/routeStepLabelsModel';
import type { RouteStep } from '../routingService';
import {
  resolveDeclutter, DECLUTTER_OWNED_LAYERS, DECLUTTER_POLICY_VERSION,
  type MapSurface, type DeclutterDecision,
} from './core/mapDeclutterModel';
import {
  resolveRouteEmphasis, routeConfidenceFrom, ROUTE_EMPHASIS_POLICY_VERSION,
  type RouteConfidence, type RouteEmphasisDecision,
} from './core/routeEmphasisModel';
import { getMapNight, getMapMode } from '../mapSourceManager';
import {
  NAV_SUPPRESS_LAYERS,
  NAV_SUPPRESS_TIERS,
  RASTER_PAINT_DAY,
  RASTER_PAINT_NIGHT,
  MAP_BG_NIGHT,
  MAP_BG_DAY,
  NIGHT_PALETTE,
  DAY_PALETTE,
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
  ROUTE_STEP_LABELS_SRC,
  ROUTE_STEP_LABELS_LAYER,
  DEBUG_SRC,
  DEBUG_LAYER,
  SEL_SRC,
  BADGE_IMAGE_ID,
  SHIELD_IMG_DAY,
  SHIELD_IMG_NIGHT,
  ROUTE_PILL_IMG_DAY,
  ROUTE_PILL_IMG_NIGHT,
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

// ── CarOS ego (konum) göstergesi ─────────────────────────────────────────
/* NOT: eski `_roundRectPath` yardımcısı YALNIZ eski SUV çiziminin panel/cam
   dikdörtgenleri için vardı; yeni disk+ok işaretçisi yalnız daire ve çokgen
   kullanır, bu yüzden ölü kod olarak KALDIRILDI (tsc TS6133 ile de zaten
   derlemeyi düşürüyordu). */

/**
 * Ego işaretçisini verilen context'e çizer (ön = yukarı = heading 0°).
 *
 * ── NEDEN YENİDEN ÇİZİLDİ (2026-09-05, ticari kartografi turu) ─────────────
 * Önceki işaretçi üstten görünüşlü, şampanya-metalik gradyanlı, tekerlekli,
 * camlı, tavan panelli, amber ışık barlı ve farlı bir SUV çizimiydi. Ürün
 * ölçütü (§14) şunu söylüyor: *clip-art değil · oyuncak değil · dekoratif 3B
 * oyuncak araba değil · yönü anında anlaşılır · düşük görsel karmaşa ·
 * otomotiv HMI seviyesinde.* O çizim bu ölçütün karşısındaydı: haritada
 * `icon-size` 0,30–0,51 ile ~40–70 px'e küçülüyor, gradyan/teker/cam
 * ayrıntıları bilinear örneklemede eriyip bulanık bir leke bırakıyordu ve
 * ekranda hangi yöne baktığı ancak dikkatle bakınca okunuyordu. Ayrıca terk
 * edilen dekoratif krem/altın dilini taşıyordu (`#e4d6b8` şampanya gövde).
 *
 * YENİ ÇİZİM: OEM navigasyon standardı — **disk + yön oku (chevron)**.
 *   · Yön TEK bir keskin üçgenle taşınır → 40 px'te bile tartışmasız okunur.
 *   · Disk zeminden ayırıcıdır; rota MAVİ olduğu için ok AMBER/nötr kalır ve
 *     rotayla renk yarışına girmez (CarOS aksan rengi zaten amber:
 *     `user-ring` / `user-glow` bu tonu kullanır — kimlik korunur).
 *   · Gradyan/doku YOK: küçültmede erimeyen düz alanlar ve tek bir halka.
 *
 * ⚠️ SINIR: bu değişiklik YALNIZ RENDER'dır. `navMarkerMotionRuntime`,
 * `cameraFollowAuthority`, `icon-rotate`/`icon-size` sözleşmeleri ve katman
 * kimlikleri (`user-vehicle` · `user-ring` · `user-glow`) DEĞİŞMEDİ.
 */
function _drawRover(ctx: CanvasRenderingContext2D, size: number, night: boolean) {
  const cx = size / 2;
  const cy = size / 2;
  const s  = size / 144;              // ölçek faktörü
  const P  = (n: number) => n * s;    // birim → piksel
  ctx.clearRect(0, 0, size, size);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  const discFill   = night ? '#141a23' : '#ffffff';
  const discRing   = night ? '#FFB347' : '#2f363e';
  const arrow      = night ? '#f2f5f8' : '#1b2026';
  const arrowEdge  = night ? '#141a23' : '#ffffff';

  /* 1) Zemin gölgesi — aracı zeminden kaldırır. Radyal gradyan `filter`
     kullanmaz; her WebView'da aynı çıkar. */
  const sh = ctx.createRadialGradient(cx, cy + P(3), P(10), cx, cy + P(3), P(52));
  sh.addColorStop(0,   night ? 'rgba(0,0,0,0.55)' : 'rgba(20,26,34,0.34)');
  sh.addColorStop(0.65, night ? 'rgba(0,0,0,0.22)' : 'rgba(20,26,34,0.13)');
  sh.addColorStop(1,   'rgba(0,0,0,0)');
  ctx.fillStyle = sh;
  ctx.beginPath();
  ctx.arc(cx, cy + P(3), P(52), 0, Math.PI * 2);
  ctx.fill();

  // 2) Disk gövdesi
  ctx.beginPath();
  ctx.arc(cx, cy, P(34), 0, Math.PI * 2);
  ctx.fillStyle = discFill;
  ctx.fill();

  /* 3) Halka — 3,5 px (144-uzayında) seçildi: 40 px'e küçülmede (÷3,6)
     ~1 px'e iner, yani hâlâ hayatta kalır. 2 px'lik bir halka bu ölçekte
     tamamen erirdi (önceki turun 1,6 → 2,0 px kenar ışığı dersi). */
  ctx.beginPath();
  ctx.arc(cx, cy, P(34), 0, Math.PI * 2);
  ctx.lineWidth = P(3.5);
  ctx.strokeStyle = discRing;
  ctx.stroke();

  /* 4) Yön oku — ileri (yukarı) bakan keskin chevron. Kuyruğu içe girintili
     olduğu için "yukarı" okunması dönme sırasında da kaybolmaz; simetrik bir
     üçgen 180° dönmüş hâliyle karışabilirdi. */
  const arrowPath = () => {
    ctx.beginPath();
    ctx.moveTo(cx,          cy - P(22));   // burun
    ctx.lineTo(cx + P(16),  cy + P(19));   // sağ omuz
    ctx.lineTo(cx,          cy + P(8));    // kuyruk girintisi
    ctx.lineTo(cx - P(16),  cy + P(19));   // sol omuz
    ctx.closePath();
  };
  // Okun etrafında ince kontur → disk rengiyle aynı; koyu/açık her zeminde ayırır.
  arrowPath();
  ctx.lineWidth = P(4);
  ctx.strokeStyle = arrowEdge;
  ctx.stroke();
  arrowPath();
  ctx.fillStyle = arrow;
  ctx.fill();
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

  /* 1. Amber glow halesi (en altta) — gece güçlü, gündüz sade. circle-blur ile
   * yumuşak parıltı.
   *
   * KÜÇÜLTÜLDÜ (2026-08-24, kullanıcı: gerçek cihazda glow/ring aracı
   * "boğuyor"du). ÖLÇÜLEN KÖK: `circle-blur:1` MapLibre'de kenar geçişini
   * TÜM yarıçapa yayar — görünür yumuşak kenar nominal radius'un ~2 katına
   * kadar uzar. Zoom 16'da (tipik nav zoom'u) nominal glow radius'u (≈28.7px)
   * aracın kendi yarıçapından (≈33.1px, icon-size ~0.46 × 144px/2) KÜÇÜKTÜ —
   * yani sayı olarak "araçtan büyük" değildi ama blur=1 ile görünür yayılma
   * ~57px'e çıkıyor, aracın silüetini aşıp üstteki HUD öğelerine (örn. #529
   * KONUM rozeti) bulaşıyordu. Üç değişken birden geri çekildi: blur 1→0.75
   * (yayılma ~%25 azalır), tepe yarıçap 34→30 (zoom18), opaklık gece 0.42→0.36
   * / gündüz 0.22→0.19. Nabız/GPS-canlı işlevi KORUNUR — yalnız boyut/güç
   * kısıldı, katman kaldırılmadı. */
  map.addLayer({
    id: 'user-glow',
    type: 'circle',
    source: sourceId,
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 14, 15, 23, 18, 30],
      'circle-color': M.markerNight ? '#FF9E2C' : '#E0A23C',
      'circle-blur': 0.75,
      'circle-opacity': M.markerNight ? 0.36 : 0.19,
      'circle-pitch-alignment': 'map',
    },
  });

  // 2. Amber konum halkası — aracın altında çepeçevre, pulse/expand burada animasyonlu.
  // Tepe yarıçap 22→19 (zoom18): halka artık aracın gövdesine daha SIKI sarılır.
  map.addLayer({
    id: 'user-ring',
    type: 'circle',
    source: sourceId,
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 10, 15, 15, 18, 19],
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
      /* P0-NAV-04: durakta da halka BÜYÜTÜLMEZ (bkz. hareket dalı gerekçesi). */
      const navBoost = 1.0;
      try {
        map.setPaintProperty('user-ring', 'circle-radius', [
          'interpolate', ['linear'], ['zoom'],
          10, 10 * navBoost,
          15, 15 * navBoost,
          18, 19 * navBoost,
        ]);
        map.setPaintProperty('user-glow', 'circle-opacity',
          _markerGlowOpacity() * navBoost);
      } catch { /* stil yeniden yükleniyor */ }
    }
  } else if (now - M.lastRingPulseMs > 150) {
    M.lastRingPulseMs   = now;
    M.markerPulseStatic = false;
    /* ── P0-NAV-04 · NABIZ REHBERLİKTE SUSAR ─────────────────────────────
     * Gerçek cihaz karesinde araç işareti çoklu turuncu halkayla bir OYUN
     * HUD'una benziyordu. Nabız, konumu ARAMAYA yarar (harita gezinirken
     * "buradayım"); rehberlik sürerken sürücü zaten aracını takip ediyor ve
     * pulsing halka rotanın üstünde görsel gürültüdür.
     * Rehberlik DIŞINDA nabız AYNEN korunur — kaldırılmadı, KAPSAMLANDI. */
    const pulse    = M.markerNavActive ? 0.5 : (Math.sin(now / 450) * 0.5 + 0.5);
    /* Nav halkası artık BÜYÜTÜLMÜYOR: 1,18 boyut artışı halkayı aracın
       siluetinden ayırıp ikinci bir daire gibi gösteriyordu. */
    const navBoost = 1.0;
    const rScale   = navBoost * (1 + pulse * 0.10);
    try {
      map.setPaintProperty('user-ring', 'circle-radius', [
        'interpolate', ['linear'], ['zoom'],
        10, 10 * rScale,
        15, 15 * rScale,
        18, 19 * rScale,
      ]);
      map.setPaintProperty('user-glow', 'circle-opacity',
        _markerGlowOpacity() * (0.8 + pulse * 0.4) * navBoost);
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
    map.setPaintProperty('user-glow', 'circle-opacity', night ? 0.36 : 0.19);
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
  // Rota sokak adı pill'i de raster yolunda katmanını korur → imajı canlı tazelenmeli.
  setRouteStepLabelsTheme(map, night);
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
    // Normal akış soğuk camgöbeğidir: beyaz şerit mavi çekirdeği pastel bir
    // banda çeviriyordu. ATTENTION beyaz kalır; güvenlik sinyali renklenmez.
    const rgb = isAttention ? '255,255,255' : '152,220,255';
    M.pPeakStr     = `rgba(${rgb},${peak.toFixed(2)})`;
    M.pShoulderStr = `rgba(${rgb},${shldr.toFixed(2)})`;
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

/* ═══════════════════════════════════════════════════════════════════════════
   ÖRNEK-BAŞINA BOYA DEDUP — SAHA KUSURU 2026-09-05
   ═══════════════════════════════════════════════════════════════════════════
   ÖLÇÜLEN KUSUR (kullanıcı, gerçek head unit, iki ekran görüntüsü yan yana):
   *"mini haritada rota mavi, tam ekranda değil; tam ekranda bazen mavi oluyor
   ama genelde bu renk"* — mini haritada rota doygun `#006CFF`, tam ekranda
   soluk açık mavi.

   KÖK NEDEN: bu modülde CANLI İKİ MapLibre örneği vardır (MiniMapWidget ve
   FullMapView ayrı `Map` nesneleri — `MiniMapWidget.tsx`'te "active = FullMap
   instance, mapRef = MiniMap instance" olarak zaten kayıtlı). Boya yazan
   fonksiyonlar `map` parametresi alıyordu ama **dedup anahtarları modül
   düzeyinde, örnekten BAĞIMSIZ** tutuluyordu:

       syncRouteColor(mini, …)  → anahtar yazılır, MİNİ boyanır
       syncRouteColor(full, …)  → anahtar AYNI → erken `return` → TAM EKRAN
                                  HİÇ boyanmaz, kurulum renginde kalır

   Yani kusur bir renk kararı hatası değil, **"kime uygulandı" defterinin
   yanlış yerde tutulmasıydı.** "Bazen doğru oluyor" da bununla açıklanır:
   anahtar tam ekran açıkken değişirse (tema/manevra/tehlike) o an tam ekran
   boyanır ve renk düzelir.

   ÇÖZÜM: karar hâlâ TEK modelden gelir (ikinci otorite YOK); yalnız
   "hangi haritaya hangi anahtar uygulandı" kaydı harita örneğine bağlanır.
   `WeakMap` kullanılır → harita yok edilince kayıt da düşer (zero-leak).
   Toplu geçersizleştirme (`rota silindi`, `yüzey değişti`) bir NESİL
   sayacıyla yapılır: `WeakMap` gezilemez, ama nesil değişince tüm eski
   anahtarlar eşleşmez olur.                                                 */

let _paintGen = 0;
const _appliedPaintKeys = new WeakMap<MapLibreMap, Record<string, string>>();

/** Bu harita ÖRNEĞİNE bu slot için aynı anahtar zaten uygulandı mı. */
function _paintApplied(map: MapLibreMap, slot: string, key: string): boolean {
  const rec = _appliedPaintKeys.get(map);
  return rec !== undefined && rec[slot] === `${_paintGen}|${key}`;
}
/** Uygulandı olarak işaretle. */
function _notePaint(map: MapLibreMap, slot: string, key: string): void {
  let rec = _appliedPaintKeys.get(map);
  if (rec === undefined) { rec = {}; _appliedPaintKeys.set(map, rec); }
  rec[slot] = `${_paintGen}|${key}`;
}
/** TÜM haritalarda dedup'ı geçersiz kıl (rota silindi · yüzey/stil değişti). */
function _invalidateAllPaint(): void { _paintGen++; }

/** @internal — testler arası izolasyon. */
export function _resetPaintDedupForTest(): void { _invalidateAllPaint(); }

/** Son uygulanan karar — `null` = rota rengi henüz hiç yazılmadı.
 *  ⚠️ Bu alan artık DEDUP İÇİN KULLANILMAZ (bkz. üstteki kusur kaydı);
 *  yalnız CAROS LAB gözlemi için son kararı tutar. */
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

/**
 * Rota kaynağının `lineMetrics` YETENEĞİ — kurulum anında ne yazıldıysa o.
 *
 * ── NEDEN HATIRLANIR (cihazda ölçüldü 2026-08-18, #633) ─────────────────────
 * `lineMetrics` kaynak KURULURKEN sabitlenir (`!_isLowEnd`), ama boya yazan yol
 * `_isPerfLowSurface()`i YAZMA ANINDA yeniden okuyordu. `perf-low` sınıfı
 * çalışma anında değişebilir (#599'da kanıtlandı) ve iki an ayrışınca:
 *   kurulum perf-low (lineMetrics:false) + yazma perf-low DEĞİL
 *      → `line-gradient` yazılır, kaynak desteklemediği için ÖLÜ kalır
 *      → çekirdek kurulum renginde donar (gece'de GÜNDÜZ mavisi #1A73E8)
 * Sahada ölçülen tam buydu: gece kılıf `#ffffff` (karar uygulanmış) ama
 * çekirdek `#1A73E8` → WCAG parlaklık **0,183**; #623'te piksel taramasıyla
 * ölçülen 0,128–0,184 ile üst sınırda BİREBİR. Beklenen `#79b0ff` = 0,423.
 */
let _routeSrcLineMetrics = false;

/** Test yalıtımı — üretim yolunda ÇAĞRILMAZ. */
export function _setRouteSrcLineMetricsForTest(v: boolean): void { _routeSrcLineMetrics = v; }
export function _getRouteSrcLineMetrics(): boolean { return _routeSrcLineMetrics; }

/** Kararı haritaya uygula — boya yazan TEK yer. */
function _applyRouteColorDecision(map: MapLibreMap, d: RouteColorDecision): void {
  safeSetPaint(map, ROUTE_CASE,     'line-color',   d.casing);
  safeSetPaint(map, ROUTE_GLOW_SEL, 'line-color',   d.glow);
  safeSetPaint(map, SEL_LAYER,      'line-opacity', d.coreOpacity);
  /* #619 — ÇEKİRDEK de burada yazılır. Yazılmazsa gündüz↔gece geçişinde
   * (ya da road↔uydu mod değişiminde) kılıf/halo güncellenir ama çekirdek
   * KURULUM ANINDAKİ renkte asılı kalırdı — kararın yarısı uygulanmış olurdu.
   * Düşük-uçta gradient yok: orada düz renk yazılır (aynı karar, tek yazıcı). */
  /* #633 — ÇEKİRDEK RENGİ HER KOŞULDA YAZILIR.
   * `line-color` önce ve KOŞULSUZ yazılır: gradient bir sebeple uygulanmazsa
   * (kaynak `lineMetrics` taşımıyor, ifade reddedildi, stil yeniden kuruluyor)
   * geriye SAHTE bir renk değil, KARARIN düz karşılığı kalır. Böylece "kararın
   * yarısı uygulandı" durumu — kılıf gece, çekirdek gündüz — imkânsızlaşır.
   * Gradient yalnız kaynağın GERÇEKTEN desteklediği yerde eklenir; bu bilgi
   * hesaplanmaz, kurulumdan HATIRLANIR (bkz. `_routeSrcLineMetrics`). */
  safeSetPaint(map, SEL_LAYER, 'line-color', d.coreStops[0]);
  if (_routeSrcLineMetrics) {
    safeSetPaint(map, SEL_LAYER, 'line-gradient', [
      'interpolate', ['linear'], ['line-progress'],
      0,   d.coreStops[0],
      0.5, d.coreStops[1],
      1,   d.coreStops[2],
    ]);
  }
  /* #623 — BOYA YAZILDIKTAN SONRA salt-okunur fotoğraf sakla (CAROS LAB).
     Burası boyanın TEK yazıcısıdır, dolayısıyla "haritada gerçekten ne var"
     sorusunun tek doğru ölçüm anıdır. Fotoğraf hiçbir şey yazmaz; try/catch
     ile sarılıdır — gözlem yolu ÜRÜN yolunu asla düşüremez. */
  try {
    rememberRouteLayerProbe(captureRouteLayerProbe(map, 'color'));
  } catch { /* gözlem başarısız — ürün akışı etkilenmez */ }
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

  /* DEDUP ÖRNEK-BAŞINADIR: aynı karar mini haritaya uygulanmış olsa bile tam
     ekran HENÜZ boyanmamış olabilir (saha kusuru 2026-09-05, üstteki kayıt). */
  if (!force && _paintApplied(map, 'routeColor', d.routeColorKey)) return d;
  _routeColor = d;
  /* `getLayer` denetimi `safeSetPaint` içinde; katman yoksa sessizce geçer ve
     karar hatırlanır → katman doğduğunda kurulum yolu aynı kararı kullanır. */
  _applyRouteColorDecision(map, d);
  _notePaint(map, 'routeColor', d.routeColorKey);
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
  _invalidateAllPaint();
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

/* ── Rota bandı üstü sokak adı etiketleri (kök 1, harita bilgi yoğunluğu) ──
 *
 * Google Maps rota çizgisi üstüne geçilen her sokağın adını mavi bir "pill"
 * ile basar. Bu katman aynı bağlamı verir: SAF modelin (`routeStepLabelsModel`)
 * ürettiği, isimli her rota segmenti için TEK bir ortalanmış etiket.
 *
 * GÖRSEL BORÇ KAPATILDI (kütük #635 → #638): ilk tur kalın renkli HALO
 * kullanıyordu (dolgu yok); artık `road-shield` (E-5/D-100) kalkanıyla AYNI
 * desende — canvas'ta üretilen 9-patch imaj + `icon-text-fit: 'both'` — gerçek
 * dolgu pill çiziliyor. İkinci bir teknik YAZILMADI, var olan kalkan deseni
 * tekrar kullanıldı.
 *
 * FAIL-SOFT: `icon-optional: true` — imaj herhangi bir nedenle kaydedilememişse
 * (WebGL restore, bellek baskısı) sembol METNİ yine çizilir; bu yüzden ince
 * karanlık halo KORUNUR (pill'siz durumda okunabilirlik sigortası). Yani pill
 * bir SÜS katmanıdır, etiketin varlık koşulu DEĞİLDİR.
 *
 * Saf/görsel bir eklentidir — kendi sağlığı/zamanlaması YOKTUR, CAROS LAB
 * gözlem ekranı gerektirmez (var olan rota geometrisinin türetilmiş görünümü).
 */
function _applyRouteStepLabels(
  map: MapLibreMap,
  geometry: readonly [number, number][] | null,
  steps: readonly RouteStep[],
  glyphsOk: boolean,
): void {
  /* Glyphs yoksa (raster stil) `text-field` taşıyan katman MapLibre'yi
     REDDETTİRİR (bkz. `_ensureBadgeImage` üstündeki aynı kusur sınıfı notu,
     saha 2026-08-02). Kaynak zaten kuruluysa boş veri yazılır — SİLİNMEZ
     (katman yaratıp silmek stil sırasını bozar, GPU'yu yorar). */
  if (!glyphsOk) {
    if (map.getSource(ROUTE_STEP_LABELS_SRC)) {
      try {
        (map.getSource(ROUTE_STEP_LABELS_SRC) as GeoJSONSource)
          .setData({ type: 'FeatureCollection', features: [] });
      } catch { /* stil geçişi — yoksay */ }
    }
    return;
  }

  const labelInputs: RouteStepLabelInput[] = steps.map(s => ({
    streetName:         s.streetName,
    coordinate:          s.coordinate,
    geometryPointCount:  s.geometryPointCount,
  }));
  const segments = buildRouteStepLabelSegments(geometry, labelInputs);

  const data = {
    type: 'FeatureCollection' as const,
    features: segments.map(seg => ({
      type: 'Feature' as const,
      properties: { name: seg.name },
      geometry: { type: 'LineString' as const, coordinates: seg.coordinates },
    })),
  };

  if (!map.getSource(ROUTE_STEP_LABELS_SRC) || !map.getLayer(ROUTE_STEP_LABELS_LAYER)) {
    try { if (map.getLayer(ROUTE_STEP_LABELS_LAYER)) map.removeLayer(ROUTE_STEP_LABELS_LAYER); } catch { /* ignore */ }
    try { if (map.getSource(ROUTE_STEP_LABELS_SRC)) map.removeSource(ROUTE_STEP_LABELS_SRC); } catch { /* ignore */ }
    map.addSource(ROUTE_STEP_LABELS_SRC, { type: 'geojson', data });
    /* İmaj katmandan ÖNCE kaydedilmeli: MapLibre `icon-image` doğrulamasını
       katman eklenirken yapar ve eksik imaj sahada `icon-image: 'undefined'
       value invalid` sınıfı reddine yol açar (kalkanda #552'de ölçüldü). */
    ensureRouteStepPillImages(map);
    const night = getMapNight();
    map.addLayer({
      id:      ROUTE_STEP_LABELS_LAYER,
      type:    'symbol',
      source:  ROUTE_STEP_LABELS_SRC,
      minzoom: 14, // düşük zoom'da anlamsız kalabalık — nav ekranı zaten z17-19 civarında
      layout: {
        'text-field':             ['get', 'name'],
        'text-font':              ['Noto Sans Bold'],
        'text-size':              ['interpolate', ['linear'], ['zoom'], 14, 11, 18, 13],
        'symbol-placement':       'line-center', // segment başına TEK ortalanmış etiket
        'text-rotation-alignment': 'map',        // rota yönünü izler (Google gibi)
        'text-pitch-alignment':    'viewport',    // sürüş kamerasında YATAY okunur kalır
        'text-allow-overlap':      false,
        'text-ignore-placement':   false,
        'text-padding':            6,
        'text-letter-spacing':     0.02,
        /* Dolgu "pill" — kalkanla AYNI teknik (9-patch + icon-text-fit).
           Hizalama İKİZLENİR: metin map-rotated/viewport-pitched olduğu için
           imaj da öyle olmalı, yoksa pill metinden ayrı düzlemde durur. */
        'icon-image':             night ? ROUTE_PILL_IMG_NIGHT : ROUTE_PILL_IMG_DAY,
        'icon-text-fit':          'both',
        'icon-text-fit-padding':  [3, 9, 3, 9], // üst, sağ, alt, sol (px)
        'icon-rotation-alignment': 'map',
        'icon-pitch-alignment':    'viewport',
        'icon-optional':           true,  // imaj yoksa METİN yine çizilir (fail-soft)
        'icon-allow-overlap':      false,
        'icon-ignore-placement':   false,
      },
      paint: {
        'text-color':      '#ffffff',
        /* Pill geldiği için halo artık ZEMİN değil, yalnız `icon-optional`
           devreye girerse okunabilirliği koruyan ince sigorta. */
        'text-halo-color': 'rgba(11,31,84,0.72)',
        'text-halo-width': 1.1,
        'text-halo-blur':  0.2,
        'icon-opacity':    1,
      },
    });
  } else {
    try {
      (map.getSource(ROUTE_STEP_LABELS_SRC) as GeoJSONSource).setData(data);
    } catch { /* stil geçişi — yoksay */ }
  }
}

/* ── Yola boyanmış manevra oku ────────────────────────────────────────────── */

const _EMPTY_FC = { type: 'FeatureCollection' as const, features: [] as unknown[] };

/* Son uygulanan hüküm artık ÖRNEK-BAŞINA `_appliedPaintKeys`te tutulur
   (2026-09-05 saha kusuru). Buradaki modül düzeyi anahtar KALDIRILDI: iki
   canlı harita varken hangi haritaya yazıldığını bilmediği için ikinci
   haritayı sessizce atlıyordu. */

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
  /* Örnek-başına dedup (renkle aynı kusur sınıfı) — kaynak denetimi KORUNDU:
     yaratma stil yüzünden atlandıysa sonraki tick yeniden dener. */
  if (_paintApplied(map, 'arrow', key) && map.getSource(PAINTED_ARROW_SRC)) return;
  _notePaint(map, 'arrow', key);

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
  /* ARCH-06/F1: stil yeniden yüklemesi TÜM katman/kaynağı yeniden kurdurur —
     en pahalı harita olayıdır ve sayılması gerekir. */
  bumpPerf('map.styleReload');
  _invalidateAllPaint();
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

/**
 * Rota sokak adı "pill" arkaplan imajlarını üretir ve kaydeder (gündüz + gece).
 *
 * `ensureRoadShieldImages` ile AYNI desen ve AYNI gerekçe: stilde `sprite`
 * yoktur → arkaplan canvas'ta üretilir (ek asset yok → lisans yüzeyi büyümez,
 * çevrimdışı çalışır, gündüz/gece ayrı üretilir).
 *
 * 9-PATCH ZORUNLU: `icon-text-fit: 'both'` `stretchX/stretchY/content` olmadan
 * TÜM imajı esnetir → pill'in yuvarlak uçları yamulur ve "Mavi Bulvar" ile
 * "0451. Sokak" farklı biçimlerde çıkardı. Esneme bölgesi köşe yarıçapının
 * İÇİNDE kalır, bu yüzden tek imaj her uzunlukta düzgün sarar.
 *
 * Stil yeniden yüklenince (gündüz/gece vektör geçişi, WebGL restore) imajlar
 * GPU'dan silinir; `_applyRouteStepLabels` katmanı yeniden kurarken burayı
 * yeniden çağırdığı için ek bir `style.load` kancası GEREKMEZ.
 *
 * force=true: bayat imajı tazele (aynı kalkan sözleşmesi).
 */
export function ensureRouteStepPillImages(map: MapLibreMap, force?: boolean): void {
  const PR = 2;                                   // HiDPI: 2x çiz, pixelRatio 2 bildir
  const W = 44 * PR, H = 22 * PR, R = H / 2;      // R = H/2 → tam yuvarlak uç (Google pill)

  for (const [id, night] of [[ROUTE_PILL_IMG_DAY, false], [ROUTE_PILL_IMG_NIGHT, true]] as const) {
    if (!force && map.hasImage(id)) continue;
    if (map.hasImage(id)) { try { map.removeImage(id); } catch { /* ignore */ } }

    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');
    if (!ctx) continue;

    ctx.beginPath();
    ctx.moveTo(R, 0);
    ctx.lineTo(W - R, 0); ctx.arcTo(W, 0, W, R, R);
    ctx.lineTo(W, H - R); ctx.arcTo(W, H, W - R, H, R);
    ctx.lineTo(R, H);     ctx.arcTo(0, H, 0, H - R, R);
    ctx.lineTo(0, R);     ctx.arcTo(0, 0, R, 0, R);
    ctx.closePath();

    /* Rota mavisiyle aynı aile; gece MUTLAK yüzey parlaklığı düşürülür
       (kütük #622 dersi: gece kararması oran değil MUTLAK parlaklık işidir).
       Beyaz metinle kontrast gündüz ~7,7:1, gece ~10:1 — OEM okunabilirlik. */
    ctx.fillStyle = night ? '#123a99' : '#1a4fd0';
    ctx.fill();
    /* İnce çerçeve: pill rota çizgisinin ÜSTÜNDE durur ve ikisi de mavidir —
       çerçeve olmadan bant ile pill birbirine karışır. */
    ctx.strokeStyle = night ? 'rgba(226,232,240,0.55)' : 'rgba(255,255,255,0.92)';
    ctx.lineWidth = 1.4 * PR;
    ctx.stroke();

    const imgData = ctx.getImageData(0, 0, W, H);
    map.addImage(
      id,
      { width: W, height: H, data: new Uint8Array(imgData.data.buffer) },
      {
        pixelRatio: PR,
        stretchX: [[R + 2 * PR, W - R - 2 * PR]],
        stretchY: [[H / 2 - 1 * PR, H / 2 + 1 * PR]],
        content:  [R * 0.5, 3 * PR, W - R * 0.5, H - 3 * PR],
      },
    );
  }
}

/**
 * Gün/gece geçişinde pill imajını canlı değiştirir (katman yeniden kurulmaz).
 *
 * NEDEN GEREKLİ: raster yolunda `applyMapDayNight` RESTYLE YAPMAZ — katman
 * ayakta kalır, yani `icon-image` elle tazelenmezse gece haritada gündüz pill'i
 * kalırdı (painted-arrow'da aynı kusur `setPaintedArrowTheme` ile kapatılmıştı).
 */
export function setRouteStepLabelsTheme(map: MapLibreMap | null, night: boolean): void {
  if (!map || !map.isStyleLoaded() || !map.getLayer(ROUTE_STEP_LABELS_LAYER)) return;
  try {
    /* İmaj stille birlikte silinmiş olabilir (vektör restyle) — önce garanti et. */
    ensureRouteStepPillImages(map);
    map.setLayoutProperty(
      ROUTE_STEP_LABELS_LAYER, 'icon-image',
      night ? ROUTE_PILL_IMG_NIGHT : ROUTE_PILL_IMG_DAY,
    );
  } catch { /* stil geçişi — bir sonraki _applyRouteStepLabels doğru variantı kurar */ }
}

function _startLightTrail(): void {
  if (M.flowRafId !== null) return;
  const TICK_MS = 80;

  const frame = () => {
    // Boya yalnız 80 ms'de bir değişiyor; aradaki her ekran karesine rAF bağlamak
    // Android WebView compositor'ını gereksiz yere sürekli açık tutuyordu.
    M.flowRafId = window.setTimeout(frame, TICK_MS);
    const nowMs = performance.now();

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

  M.flowRafId = window.setTimeout(frame, TICK_MS);
}

function _stopLightTrail(): void {
  if (M.flowRafId !== null) { clearTimeout(M.flowRafId); M.flowRafId = null; }
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
    clearTimeout(M.flowRafId);
    M.flowRafId = null;
    _flowPausedForInteraction = true;
  }
}

export function resumeRouteFlowAnimation(): void {
  if (!_flowPausedForInteraction) return;
  _flowPausedForInteraction = false;
  const map = useMapStore.getState().mapInstance;
  // Yalnız rota hâlâ aktif VE araç gerçekten hareketliyse yeniden başlat.
  if (map && map.getLayer(ROUTE_FLOW) && M.lastFlowSpeedKmh >= 1.5) _startLightTrail();
}

/* ── Movement Energy — pulse speed scales with vehicle velocity (Faz 3.3) ─── */
export function _updateFlowSpeed(speedKmh: number, deltaSpeed: number): void {
  const wasMoving = M.lastFlowSpeedKmh >= 1.5;
  const isMoving = Number.isFinite(speedKmh) && speedKmh >= 1.5;

  // Dekoratif rota akışı park hâlinde WebGL yüzeyini sürekli repaint etmemeli.
  // Bu kapı hysteresis'ten önce gelir; ilk 0 km/s örneği de mutlaka döngüyü keser.
  if (!isMoving) {
    M.lastFlowSpeedKmh = Number.isFinite(speedKmh) ? speedKmh : 0;
    M.flowSpeedFactor = 0.4;
    _stopLightTrail();
    return;
  }

  // Hysteresis: hız veya delta değişmediğinde güncelleme atla
  if (wasMoving && Math.abs(speedKmh - M.lastFlowSpeedKmh) < 3 && Math.abs(deltaSpeed) < 2) return;
  M.lastFlowSpeedKmh = speedKmh;
  const baseSpeed   = Math.max(0.4, Math.min(1.4, 0.4 + speedKmh / 100));
  // Pozitif delta (hızlanma) → anlık pulse burst; negatif delta etkisiz (braking sönük)
  const accelBoost  = Math.max(0, deltaSpeed * 0.018);
  M.flowSpeedFactor  = Math.min(1.8, baseSpeed + accelBoost);
  if (!wasMoving && !_flowPausedForInteraction) {
    const map = useMapStore.getState().mapInstance;
    if (map && map.getLayer(ROUTE_FLOW)) _startLightTrail();
  }
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

  /* ── #641 · MOOD ARTIK RENK İCAT ETMEZ (CİHAZDA ÖLÇÜLDÜ 2026-08-19) ───────
   * KULLANICI: *"ana yollar siyah, belli olmuyor."*
   * ÖLÇÜLDÜ (ekran pikseli): ana yol bandı **RGB(56,56,64)** — bu satırların
   * ESKİ hâlindeki `road-secondary` formülünün (r=0) birebir çıktısıydı. Yani
   * ekrandaki siyah bantlar paletten DEĞİL, buradan geliyordu.
   *
   * Kusur sınıfı: **İKİNCİ RENK OTORİTESİ.** Bu blok "OEM grafit" döneminden
   * kalma SABİT sayılarla yolları ve zemini yeniden boyuyordu ve ölçülerek
   * kazanılmış iki turu sessizce geri alıyordu:
   *   · #612/#619 yol merdiveni — palet `primary #a8adb6` / `secondary #8a8f9a`
   *     (zeminden AÇIK) iken buradan (68,68,79)/(56,56,64) yazılıyordu; ikisi de
   *     zemin (#222c3c) ve `minor` (#6f7581) tonundan KOYU → hiyerarşi TERSİNE
   *     dönüyor, en önemli yol en görünmez oluyordu.
   *   · #622 mutlak parlaklık — zemin ölçülerek `#131822` → `#222c3c`ye
   *     çıkarılmıştı; bu blok her mood güncellemesinde `#131822`ye geri yazıyordu.
   * Üstelik yazım KALICIDIR (paint property stil yeniden yüklenene kadar durur),
   * bu yüzden harita "önce doğru, ilk risk güncellemesinden sonra siyah" oluyordu.
   *
   * YENİ KURAL: renk PALETTEN gelir; risk yalnız o rengi ZEMİNE DOĞRU harmanlar
   * (en fazla %25). Harmanlama zemine yaklaştırdığı için hem gece (yol zeminden
   * açık) hem gündüz (yol zeminden koyu) paletinde "geri çekilme" anlamına gelir
   * — iki tema için ayrı politika YAZILMAZ. Merdiven sırası her r değerinde
   * korunur (kilit: mapMoodPaletteAuthority.test.ts). */
  const _pal   = getMapNight() ? NIGHT_PALETTE : DAY_PALETTE;
  const _bgHex = getMapNight() ? MAP_BG_NIGHT : MAP_BG_DAY;
  const _bg    = _hexToRgb(_bgHex);
  const _t     = 0.25 * r;                     // risk → en fazla %25 zemine harman

  if (map.getLayer('background')) {
    /* Zemin RİSKTE hafif koyulaşır ama TABAN paletten gelir (#622 kilidi). */
    const bg2 = _mixRgb(_bg, [0, 0, 0], 0.18 * r);
    try { map.setPaintProperty('background', 'background-color', `rgb(${bg2[0]},${bg2[1]},${bg2[2]})`); }
    catch { /* noop */ }
  }

  if (map.getLayer('road-primary')) {
    const c = _mixRgb(_hexToRgb(_pal.primary), _bg, _t);
    try { map.setPaintProperty('road-primary', 'line-color', `rgb(${c[0]},${c[1]},${c[2]})`); }
    catch { /* noop */ }
  }
  if (map.getLayer('road-secondary')) {
    const c = _mixRgb(_hexToRgb(_pal.secondary), _bg, _t);
    try { map.setPaintProperty('road-secondary', 'line-color', `rgb(${c[0]},${c[1]},${c[2]})`); }
    catch { /* noop */ }
  }
  /* ── AİLE BÜTÜN HARMANLANIR (2026-09-05 · gece yolları beyaz) ─────────────
   * Eskiden mood YALNIZ `primary` ve `secondary`yi zemine harmanlıyordu;
   * `tertiary` ve `minor` paletteki hâlinde kalıyordu. Yol merdiveni GENİŞ
   * aralıklıyken bu görünmüyordu, ama gece yolları beyaz aileye alınınca
   * (ton adımları 1,04–1,08) risk arttığında `secondary` `minor`ın ALTINA
   * düşüyor ve **hiyerarşi tersine dönüyordu** — kilidin (mapMoodPaletteAuthority)
   * yakaladığı gerçek kusur budur.
   *
   * Kural artık aileye BÜTÜN uygulanır: aynı `_t` ile hepsi birlikte geri
   * çekilir, sıralama her risk değerinde korunur. Yeni bir eşik/politika
   * EKLENMEDİ — var olan tek kural eksik uygulanıyordu. */
  if (map.getLayer('road-tertiary')) {
    const c = _mixRgb(_hexToRgb(_pal.secondary), _bg, _t);   // tertiary secondary TONUNU paylaşır
    try { map.setPaintProperty('road-tertiary', 'line-color', `rgb(${c[0]},${c[1]},${c[2]})`); }
    catch { /* noop */ }
  }
  if (map.getLayer('road-minor')) {
    const c = _mixRgb(_hexToRgb(_pal.minor), _bg, _t);
    try { map.setPaintProperty('road-minor', 'line-color', `rgb(${c[0]},${c[1]},${c[2]})`); }
    catch { /* noop */ }
  }
  if (map.getLayer('road-motorway')) {
    const c = _mixRgb(_hexToRgb(_pal.motorway), _bg, _t);
    try { map.setPaintProperty('road-motorway', 'line-color', `rgb(${c[0]},${c[1]},${c[2]})`); }
    catch { /* noop */ }
  }
}

/** `#rrggbb` → [r,g,b]. Geçersizse siyah döner (fail-soft; renk icat edilmez). */
export function _hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [0, 0, 0];
  const v = parseInt(m[1], 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

/** a→b arası doğrusal harman (t=0 → a, t=1 → b). */
export function _mixRgb(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
  t: number,
): [number, number, number] {
  const k = Math.max(0, Math.min(1, t));
  return [
    Math.round(a[0] + (b[0] - a[0]) * k),
    Math.round(a[1] + (b[1] - a[1]) * k),
    Math.round(a[2] + (b[2] - a[2]) * k),
  ];
}

/**
 * Konum işaretinin dış hale opaklığı — P0-NAV-04.
 *
 * Rehberlik sürerken hale KISILIR: rotanın üstünde duran turuncu bulut,
 * aracın kendisini ve altındaki rota çizgisini yutuyordu (cihaz karesinde
 * gözlendi). Rehberlik dışında (harita gezinme) eski değerler AYNEN korunur —
 * orada halenin işi konumu BULDURMAKTIR.
 */
function _markerGlowOpacity(): number {
  // 2026-08-24: 0.42/0.22 → 0.36/0.19 (bkz. addUserMarker'daki `user-glow` yorumu —
  // circle-blur:1 nominal yarıçapın ~2 katına yayılıyordu, araç silüetini/HUD'u boğuyordu).
  // Bu sabitler addUserMarker + setMarkerTheme ile AYNI kalmalı — üçü de tek gerçek kaynağı
  // (gece/gündüz baz opaklığı) temsil eder; biri değişirse üçü BİRDEN değişir.
  const base = M.markerNight ? 0.36 : 0.19;
  return M.markerNavActive ? base * 0.45 : base;
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
/* ── #639 — ROTA ADIMLARININ SAHİBİ HARİTA ÖRNEĞİDİR ───────────────────────
 * `M.cachedRoute` modül seviyesinde PAYLAŞILIR, ama harita örneği İKİ tanedir
 * (MiniMapWidget · FullMapView — sahiplik devreder). Adımları tek bir paylaşılan
 * alanda tutmak iki yönlü sızıntı üretiyordu:
 *   (a) mini haritanın adımsız çağrısı tam haritanın adımlarını SİLİYORDU
 *       (cihazda ölçüldü: tema geçişinden sonra sokak adı etiketleri öldü),
 *   (b) tersi de mümkündü — paylaşılan adımlar mini haritanın `style.load`
 *       geri kurmasında etiket çizdirir, #635 (f) kapsam kararını çiğnerdi.
 * Bu yüzden adımlar harita ÖRNEĞİNE bağlanır. WeakMap: harita yok olunca kayıt
 * da düşer (sıfır sızıntı — zero-leak invaryantı).
 */
const _stepsByMap = new WeakMap<MapLibreMap, RouteStep[]>();

/** Bu harita örneği için EN SON açıkça verilmiş rota adımları (yoksa boş). */
export function getRouteStepsFor(map: MapLibreMap | null): RouteStep[] {
  if (!map) return [];
  return _stepsByMap.get(map) ?? [];
}

export function setRouteGeometry(
  map:             MapLibreMap,
  coordinates:     [number, number][],
  alternatives:    [number, number][][] = [],
  altRealIndices?: number[],
  altDurations?:   number[],
  mainDuration?:   number,
  /** Kök 1 (2026-08-18) — rota bandı üstü sokak adı etiketleri için OSRM adımları.
   *  VERİLMEYEN (`undefined`) çağrı "adım yok" DEMEZ — "bu çağıran adımları
   *  bilmiyor" demektir; aşağıdaki #639 notuna bak. */
  steps?:          readonly RouteStep[],
): void {
  if (!map || !coordinates.length) return;

  /* ── #639 (CİHAZDA ÖLÇÜLDÜ 2026-08-18 22:0x) ──────────────────────────────
   * `M.cachedRoute` MODÜL SEVİYESİNDE PAYLAŞILIR ama harita ÖRNEĞİ iki tanedir
   * (MiniMapWidget ile FullMapView ayrı instance kurar, sahiplik devreder).
   * `MiniMapWidget` rotayı `setRouteGeometry(map, geom)` ile — adımları
   * BİLMEDEN — uyguluyor. Eski kod `steps` varsayılanını `[]` alıp önbelleğe
   * KOŞULSUZ yazdığı için mini haritanın her çağrısı TAM HARİTANIN adımlarını
   * siliyordu. Tam harita bir sonraki `style.load`'da (tema geçişi, WebGL
   * restore) rotayı bu önbellekten geri kurduğu için sokak adı etiketleri
   * (#635/#638) SESSİZCE ölüyordu ve bir daha geri gelmiyordu.
   *
   * Kural: adımlar YALNIZ açıkça verildiğinde yazılır. Verilmeyen çağrı,
   * AYNI rota için önbellektekini korur; rota DEĞİŞTİYSE temizler — eski
   * adımları yeni geometriye iliştirmek yanlış sokak adı basardı ("dayanağı
   * yoksa çizilmez" disiplini: yanlış etiket, etiketsizden KÖTÜDÜR).
   *
   * Uygulama (çizim) tarafına yine `steps ?? []` gider: mini harita kapsam
   * dışıdır (#635 (f)) ve önbellekteki adımlarla ETİKET ÇİZMEZ. */
  const _prev  = M.cachedRoute;
  const _pc    = _prev?.coords;
  const _sameRoute = !!_pc && _pc.length === coordinates.length && _pc.length > 0
    && _pc[0][0] === coordinates[0][0]
    && _pc[0][1] === coordinates[0][1]
    && _pc[_pc.length - 1][0] === coordinates[coordinates.length - 1][0]
    && _pc[_pc.length - 1][1] === coordinates[coordinates.length - 1][1];
  if (steps !== undefined) {
    _stepsByMap.set(map, steps as RouteStep[]);
  } else if (!_sameRoute) {
    /* Yeni rota + adım bilgisi YOK → bu haritanın eski adımları GEÇERSİZ.
       Eski adları yeni geometriye iliştirmek yanlış sokak adı basardı. */
    _stepsByMap.delete(map);
  }
  const _cachedSteps: RouteStep[] = _stepsByMap.get(map) ?? [];

  M.cachedRoute          = { coords: coordinates, alts: alternatives, altIdx: altRealIndices, altDurs: altDurations, mainDur: mainDuration, steps: _cachedSteps };
  M.pendingRouteGeometry = { coords: coordinates, alts: alternatives, altIdx: altRealIndices, altDurs: altDurations, mainDur: mainDuration, steps: _cachedSteps };

  // Visibility / Deadlock Watchdog
  if (map.isStyleLoaded() && !map.getLayer(SEL_LAYER)) {
    if (M.isStyleChanging) M.isStyleChanging = false;
  }

  if (M.isStyleChanging) return;

  _applyRouteGeometry(map, coordinates, alternatives, altRealIndices, 0, altDurations, mainDuration, steps ?? []);
}

export function _applyRouteGeometry(
  map:             MapLibreMap,
  coordinates:     [number, number][],
  alternatives:    [number, number][][],
  altRealIndices?: number[],
  retryCount       = 0,
  altDurations?:   number[],
  mainDuration?:   number,
  steps:           readonly RouteStep[] = [],
): void {
  if (!map) return;

  if (!map.isStyleLoaded()) {
    if (retryCount < 40) {
      setTimeout(
        () => _applyRouteGeometry(map, coordinates, alternatives, altRealIndices, retryCount + 1, altDurations, mainDuration, steps),
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

    // Kök 1 — rota bandı üstü sokak adı etiketleri (ALT_BADGE ile aynı glyphs kapısı).
    _applyRouteStepLabels(map, coords as [number, number][], steps, _glyphsOk);

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
      /* #633 — KAYNAĞIN YETENEĞİ HESAPLANMAZ, HATIRLANIR. Boya yazan yol
         eskiden `_isPerfLowSurface()`i YENİDEN okuyordu; o sınıf çalışma
         anında değişebildiği için (#599) kurulum anıyla ayrışıyor ve gradient
         `lineMetrics:false` bir kaynağa yazılmaya çalışılıyordu → yazım ölü
         kalıyor, çekirdek KURULUM RENGİNDE donuyordu. */
      _routeSrcLineMetrics = !_isLowEnd;

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
      /* #619 — düz renk de karardan gelir (gece parlak, gündüz Google mavisi).
         #633 — ve KOŞULSUZ yazılır: gradient bir sebeple uygulanmazsa geriye
         kararın düz karşılığı kalsın, kurulum rengi donmasın. */
      _coreFillPaint['line-color'] = _rc.coreStops[0];
      if (!_isLowEnd) {
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

        // Park hâlinde dekoratif animasyon başlatılmaz; ilk gerçek hareket örneği
        // `_updateFlowSpeed` üzerinden döngüyü açar.
        if (M.lastFlowSpeedKmh >= 1.5) _startLightTrail();
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
    /* ARCH-06/F1: rota geometrisinin TAM yeniden kurulum sayacı. F3'ün hedefi
       "ilerleme güncellemesinde bu sayacın ARTMAMASI"dır; taban burada ölçülür. */
    bumpPerf('map.routeGeometryRebuild');
    bumpPerf('map.setDataCall');
    /* #625 — GEOMETRİ YANKISI (salt-gözlem). Rota geometrisinin haritadaki TEK
       yazıcısı burasıdır; yankı bounded örnektir (≤64 nokta) ve yalnız
       "rota ekranda mı" ölçümünde kullanılır. Ham rota kopyalanmaz, ekrana
       koordinat gitmez. try/catch — gözlem yolu ürün yolunu düşüremez. */
    try { rememberRouteGeometry(coords as [number, number][], Date.now()); } catch { /* gözlem */ }

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
                      ROUTE_CASE, SEL_LAYER, ROUTE_FLOW, ROUTE_STEP_LABELS_LAYER,
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
      setTimeout(() => _applyRouteGeometry(map, coordinates, alternatives, altRealIndices, 1, altDurations, mainDuration, steps), 500);
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
    /* #625 — kırpma da bir GEOMETRİ YAZIMIDIR; yankı güncellenmezse görünürlük
       ölçümü kat edilmiş (artık çizilmeyen) rotayı ölçerdi. */
    try { rememberRouteGeometry(remaining, Date.now()); } catch { /* gözlem */ }
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
    if (map.getLayer(ROUTE_STEP_LABELS_LAYER)) map.removeLayer(ROUTE_STEP_LABELS_LAYER);
    if (map.getSource(ROUTE_STEP_LABELS_SRC))  map.removeSource(ROUTE_STEP_LABELS_SRC);
  } catch { /* ignore — style may already be reset */ }
  /* #625 — rota kaldırıldı: yankı da temizlenir, yoksa görünürlük ölçümü ARTIK
     OLMAYAN bir rotayı "ekranda değil" diye raporlar (hayalet kök adayı). */
  try { rememberRouteGeometry(null, Date.now()); } catch { /* gözlem */ }
  /* #633 — kaynak gitti: yeteneği de unut. Kalırsa bir sonraki kurulum farklı
     bir yüzeyde yapılsa bile eski yetenek varsayılır ve gradient yine ölü yazılır. */
  _routeSrcLineMetrics = false;
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
      /* KÖK 4 (2026-08-18): sabit `0.4` geri dönüş değeri stilin KENDİ
         varsayılanından (gece 0.78 / gündüz 0.95 — `bldg3dOpacity`) DAHA
         DÜŞÜKTÜ. 80 km/h üstüne bir kez çıkıp geri düşen her sürüşte binalar
         kalıcı olarak stilin öngördüğünden soluk kalıyordu — mandal tek
         yönlüydü (yalnız gizleniyor, DOĞRU değere geri dönmüyordu). Geri
         dönüş artık o anki gün/gece paletinden okunur — tek kaynak, palet
         değişirse burası otomatik izler. */
      const restoredOpacity = (getMapNight() ? NIGHT_PALETTE : DAY_PALETTE).bldg3dOpacity;
      map.setPaintProperty('building-3d', 'fill-extrusion-opacity', hideHighSpeed ? 0 : restoredOpacity);
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


/* ══════════════════════════════════════════════════════════════════════════
   P0-NAV-03 · GÖRSEL SÖZLEŞMELERİN UYGULANMASI
   ──────────────────────────────────────────────────────────────────────────
   Kararlar SAF modellerde (`mapDeclutterModel` · `routeEmphasisModel`) alınır;
   burada YALNIZ MapLibre'a yazılır. Bu bölüme yeni eşik/sayı EKLENMEZ.
   ══════════════════════════════════════════════════════════════════════════ */

let _lastDeclutterKey: string | null = null;
let _lastDeclutter: DeclutterDecision | null = null;
/* ── KENDİNİ ONARAN UYGULAMA (cihazda İKİ TUR ölçüldü) ────────────────────
 * 1. tur: uygulayıcı `isStyleLoaded()` false iken sessizce dönüyordu ve
 *    "stil gelince tekrar denensin" diyordu — TEKRAR DENEYECEK KİMSE YOKTU.
 *    Gerçek cihazda gece mini haritada binalar görünmeye devam etti.
 * 2. tur: tek seferlik `once('idle')` de YETMEDİ. Stil bir kullanıcı akışında
 *    BİRDEN ÇOK kez yeniden yükleniyor (tema geçişi · raster↔vektör · ayarlar
 *    dönüşü); ilk yeniden deneme ateşlendikten SONRAKİ yükleme katmanları
 *    yeniden yaratıyor ve profil yine kayboluyordu — cihazda binalar geri geldi.
 *
 * Çözüm: İSTENEN profil hatırlanır ve harita başına TEK bir kalıcı `styledata`
 * gözlemcisi kurulur. Gözlemci ucuz bir SONDA ile gerçekten sapma olup
 * olmadığını ölçer (kör yeniden yazma yok) ve yalnız saptığında yeniden yazar.
 * Böylece kaç kez stil yüklenirse yüklensin sözleşme geri gelir. */

/** İstenen profil — stil yeniden yüklendiğinde buradan geri yazılır. */
let _desired: { surface: MapSurface; night: boolean; navActive: boolean; tier: number } | null = null;
/** Gözlemci kurulmuş haritalar — aynı haritaya iki kez abone olunmaz. */
const _watchedMaps = new WeakSet<object>();

/** Sapmayı ölçmek için kullanılan sonda katmanı (gürültü tablosunun ilk üyesi). */
const DECLUTTER_PROBE_LAYER = 'building';
const DECLUTTER_PROBE_PROP  = 'fill-opacity';

function _declutterDrifted(map: MapLibreMap, decision: DeclutterDecision): boolean {
  const want = decision.noiseEntries.find(
    ([id, prop]) => id === DECLUTTER_PROBE_LAYER && prop === DECLUTTER_PROBE_PROP,
  );
  if (!want) return true;                       // sonda yoksa ölçemeyiz → yeniden yaz
  try {
    if (!map.getLayer(DECLUTTER_PROBE_LAYER)) return false;  // katman yok → yazacak şey de yok
    const cur = map.getPaintProperty(DECLUTTER_PROBE_LAYER, DECLUTTER_PROBE_PROP);
    return typeof cur !== 'number' || Math.abs(cur - (want[2] as number)) > 1e-6;
  } catch { return true; }
}

function _ensureDeclutterWatcher(map: MapLibreMap): void {
  if (_watchedMaps.has(map as unknown as object)) return;
  try {
    map.on('styledata', () => {
      const d = _desired;
      if (d === null) return;
      if (!map.isStyleLoaded()) return;         // henüz erken — sonraki olayda bakılır
      const decision = resolveDeclutter(d, NAV_SUPPRESS_TIERS[Math.min(d.tier, NAV_SUPPRESS_TIERS.length - 1)] ?? NAV_SUPPRESS_TIERS[0]);
      if (!_declutterDrifted(map, decision)) return;   // sapma yok → hiç yazma
      _lastDeclutterKey = null;                 // sapmış → yeniden yaz
      try { applyMapDeclutter(map, d.surface, d.night, d.navActive, d.tier); } catch { /* fail-soft */ }
    });
    _watchedMaps.add(map as unknown as object);
  } catch { /* abone olunamadı — sözleşme yine de ilk yazımda uygulanır */ }
}

/**
 * Gürültü sözleşmesini uygula (tam ekran / mini harita).
 *
 * Idempotent: aynı profil iki kez çağrılırsa MapLibre'a hiç yazılmaz.
 * Fail-soft: olmayan katman sessizce atlanır (stil henüz kurulmamış olabilir).
 */
export function applyMapDeclutter(
  map: MapLibreMap,
  surface: MapSurface,
  night: boolean,
  navActive: boolean,
  tier: number = 0,
): DeclutterDecision | null {
  if (!map) return _lastDeclutter;
  /* İSTENEN profil her çağrıda tazelenir; kalıcı gözlemci onu geri yazar. */
  _desired = { surface, night, navActive, tier };
  _ensureDeclutterWatcher(map);
  const key = `${surface}|${night ? 'n' : 'd'}|${navActive ? 'a' : 'i'}|${tier}`;
  if (key === _lastDeclutterKey) return _lastDeclutter;

  const table = NAV_SUPPRESS_TIERS[Math.min(tier, NAV_SUPPRESS_TIERS.length - 1)]
    ?? NAV_SUPPRESS_TIERS[0];
  const decision = resolveDeclutter({ surface, night, navActive, tier }, table);

  /* ── STİL HAZIR DEĞİLSE: TEK SEFERLİK YENİDEN DENEME (cihazda ölçüldü) ────
   * İlk yazımda burada yalnız `return` vardı ve yorum "stil geldiğinde tekrar
   * denensin" diyordu — AMA TEKRAR DENEYECEK KİMSE YOKTU. Gerçek cihazda
   * ölçüldü (2026-08-23, gece mini harita): gündüz→gece geçişi stili yeniden
   * yüklerken efekt bir kez koşuyor, `isStyleLoaded()` false dönüyor ve profil
   * BİR DAHA yazılmıyordu → mini haritada binalar görünmeye devam etti.
   * Artık stilin hazır olacağı ana tek seferlik abone olunur. */
  if (!map.isStyleLoaded()) return decision;

  for (const [id, prop, value] of decision.entries) {
    try {
      if (map.getLayer(id)) map.setPaintProperty(id, prop, value);
    } catch { /* ignore — tek katman sözleşmenin tamamını düşürmez */ }
  }
  _lastDeclutterKey = key;
  _lastDeclutter = decision;
  _notePaint(map, 'declutter', key);
  return decision;
}

/** Yüzey değişiminde (mini ↔ tam) sözleşme yeniden uygulanabilsin. */
export function invalidateMapDeclutter(): void {
  _invalidateAllPaint();
  _lastDeclutterKey = null;
}

/** CAROS LAB gözlemi — hangi profil yürürlükte. */
export function getDeclutterSnapshot(): {
  readonly policyVersion: string;
  readonly owned: readonly string[];
  readonly current: DeclutterDecision | null;
} {
  return {
    policyVersion: DECLUTTER_POLICY_VERSION,
    owned: DECLUTTER_OWNED_LAYERS,
    current: _lastDeclutter,
  };
}

/* Anahtar ÖRNEK-BAŞINA (`_appliedPaintKeys`); burada yalnız son KARAR
   tutulur (çağıranlara döndürülür ve LAB okur). */
let _lastEmphasis: RouteEmphasisDecision | null = null;
let _emphasisRetryPending = false;

function _scheduleEmphasisRetry(
  map: MapLibreMap, confidence: RouteConfidence, navActive: boolean, altCount: number,
): void {
  if (_emphasisRetryPending) return;
  _emphasisRetryPending = true;
  try {
    map.once('idle', () => {
      _emphasisRetryPending = false;
      try { applyRouteEmphasis(map, confidence, navActive, altCount); } catch { /* fail-soft */ }
    });
  } catch {
    _emphasisRetryPending = false;
  }
}

/**
 * Rota vurgu sözleşmesini uygula.
 *
 * ── OTORİTE PAYLAŞIMI (bilinçli) ─────────────────────────────────────────
 * RENK `routeColorModel`indir, OPAKLIK bu modelindir. Çekirdek opaklığı
 * İKİSİNİN ÇARPIMIDIR: renk kararı bugün 1,0 verir (davranış değişmez) ama
 * ileride bir veto koyarsa vurgu onu EZMEZ. Kalınlık `routeWidthModel`de
 * kalır — buradan hiçbir genişlik yazılmaz.
 */
export function applyRouteEmphasis(
  map: MapLibreMap,
  confidence: RouteConfidence,
  navActive: boolean,
  altCount: number,
): RouteEmphasisDecision | null {
  if (!map) return _lastEmphasis;
  const lightBasemap = resolveLightBasemap();
  const key = `${confidence}|${navActive ? 'a' : 'i'}|${lightBasemap ? 'l' : 'd'}|${altCount > 0 ? 1 : 0}`;
  /* Renkle AYNI kusur sınıfı: dedup örnek-başına olmalı, yoksa mini haritaya
     uygulanan vurgu tam ekranı sessizce atlar. */
  if (_paintApplied(map, 'emphasis', key)) return _lastEmphasis;

  const d = resolveRouteEmphasis({ confidence, navActive, lightBasemap, altCount });
  if (!map.isStyleLoaded()) {
    /* Gürültü sözleşmesiyle AYNI kusur sınıfı: tekrar deneyecek kimse olmazsa
       vurgu sessizce hiç uygulanmaz (cihazda ölçüldü). */
    _scheduleEmphasisRetry(map, confidence, navActive, altCount);
    return d;
  }

  const colorCore = _routeColor?.coreOpacity ?? 1;
  safeSetPaint(map, SEL_LAYER,      'line-opacity', colorCore * d.coreOpacity);
  safeSetPaint(map, ROUTE_CASE,     'line-opacity', d.casingOpacity);
  safeSetPaint(map, ROUTE_GLOW_SEL, 'line-opacity', d.glowOpacity);
  safeSetPaint(map, ROUTE_SHADOW,   'line-opacity', d.shadowOpacity);
  safeSetPaint(map, ROUTE_FLOW,     'line-opacity', d.flowOpacity);
  safeSetPaint(map, ALT_FILL,       'line-opacity', d.altOpacity);

  /* Kesik çizgi YALNIZ düz-hat tahmininde — evrensel "bu kesin değil" işareti. */
  try {
    if (map.getLayer(SEL_LAYER)) {
      map.setPaintProperty(SEL_LAYER, 'line-dasharray',
        d.coreDashArray === null ? null : [...d.coreDashArray]);
    }
  } catch { /* ignore */ }

  _lastEmphasis = d;
  _notePaint(map, 'emphasis', key);
  return d;
}

/** Rota yeniden kurulunca vurgu tekrar yazılsın. */
export function invalidateRouteEmphasis(): void {
  _invalidateAllPaint();
}

/** CAROS LAB gözlemi. */
export function getRouteEmphasisSnapshot(): {
  readonly policyVersion: string;
  readonly current: RouteEmphasisDecision | null;
} {
  return { policyVersion: ROUTE_EMPHASIS_POLICY_VERSION, current: _lastEmphasis };
}

export { routeConfidenceFrom };
