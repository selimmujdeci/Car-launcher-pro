// ══════════════════════════════════════════════════════════════════════════
// CarOS Pro — MapInteractionManager
//
// Sorumluluk: kamera etkileşimleri (flyTo/easeTo/jumpTo), sürüş görünümü
// kamera pipeline'ı, kamera kısıtlamaları (bounds/pitch), harita olay
// dinleyicileri (route click/hover) ve sürüş modu store bayrağı.
//
// Bağımlılık: _mapState + MapLayerManager (flow/intersection). Davranış
// değişikliği YOK; mapService.ts'ten birebir taşındı.
// ══════════════════════════════════════════════════════════════════════════
import maplibregl, { Map as MapLibreMap } from 'maplibre-gl';
import type { LngLatLike } from 'maplibre-gl';
import {
  CAMERA_CFG,
  resetCameraSmooth,
  computeCameraTarget,
  dampCameraToward,
  computeAnticipatedBearing,
} from '../cameraEngine';
import { useHazardStore } from '../../store/useHazardStore';
import {
  M,
  useMapStore,
  ALT_TOUCH_PAD,
  ROUTE_SHADOW,
  ROUTE_GLOW_SEL,
  ROUTE_CASE,
  SEL_LAYER,
} from './_mapState';
import { _updateFlowSpeed, _applyIntersectionSuppression } from './MapLayerManager';

export function setMapCenter(map: MapLibreMap, center: LngLatLike, zoom?: number, animated = true) {
  if (!map) return;

  if (animated) {
    map.flyTo({
      center,
      zoom: zoom ?? map.getZoom(),
      duration: 1000,
    });
  } else {
    map.setCenter(center);
    if (zoom !== undefined) map.setZoom(zoom);
  }
}

export function setMapHeading(map: MapLibreMap, heading: number) {
  if (!map || !isFinite(heading)) return;
  map.setBearing(heading);
}

/**
 * Alternatif rota seçim callback'ini kaydet.
 * FullMapView mount'unda bir kez çağrılır; dönen fonksiyon kaydı iptal eder.
 */
export function registerAltRouteSelectCallback(cb: (realIdx: number) => void): () => void {
  M.onAltRouteSelect = cb;
  return () => { if (M.onAltRouteSelect === cb) M.onAltRouteSelect = null; };
}

/** Zombi listener'ları temizle. */
export function _cleanupRouteInteractions(): void {
  M.routeInteractionCleanup?.();
  M.routeInteractionCleanup = null;
}

/**
 * Alternatif rota katmanına dokunmatik dostu tıklama + hover etkileşimleri kur.
 * style.load sonrası her çağrıda önceki listener'lar temizlenerek yeniden kurulur.
 * 24px bbox padding: sürüş anında ince gri hatta dokunmayı tolere eder.
 */
export function _setupRouteInteractions(map: MapLibreMap): void {
  _cleanupRouteInteractions();

  const onMapClick = (e: maplibregl.MapMouseEvent) => {
    if (!map.getLayer('car-route-alt-fill')) return;
    const pt = e.point;
    const features = map.queryRenderedFeatures(
      [
        [pt.x - ALT_TOUCH_PAD, pt.y - ALT_TOUCH_PAD],
        [pt.x + ALT_TOUCH_PAD, pt.y + ALT_TOUCH_PAD],
      ],
      { layers: ['car-route-alt-fill'] },
    );
    const feat = features[0];
    if (!feat?.properties) return;
    const realIdx = feat.properties.altRealIdx;
    if (realIdx !== undefined && M.onAltRouteSelect) {
      M.onAltRouteSelect(Number(realIdx));
    }
  };

  const onEnter = () => { map.getCanvas().style.cursor = 'pointer'; };
  const onLeave = () => { map.getCanvas().style.cursor = ''; };

  map.on('click', onMapClick);
  map.on('mouseenter', 'car-route-alt-fill', onEnter);
  map.on('mouseleave', 'car-route-alt-fill', onLeave);

  M.routeInteractionCleanup = () => {
    try { map.off('click', onMapClick); } catch { /* ignore */ }
    try { map.off('mouseenter', 'car-route-alt-fill', onEnter); } catch { /* ignore */ }
    try { map.off('mouseleave', 'car-route-alt-fill', onLeave); } catch { /* ignore */ }
    try { map.getCanvas().style.cursor = ''; } catch { /* ignore */ }
  };
}

// ── Driving mode ─────────────────────────────────────────────
// Kamera hesaplamaları cameraEngine.ts'e taşındı (Faz 3.1).

/**
 * Navigation (driving) view — Faz 3.1 cinematic camera.
 *
 * @param turnApproachM  Bir sonraki manevra noktasına mesafe (metre)
 * @param obdSpeedKmh    GPS hız sıfırsa OBD fallback
 * @param nextTurnBearing Manevra sonrası yön — turn anticipation için (opsiyonel)
 */
/** Driving-view şu an aktif mi — exitDrivingView'i İDEMPOTENT yapar.
 *  Yoksa MiniMapWidget her heading (pusula) değişiminde exitDrivingView çağırıp
 *  her seferinde 800ms easeTo başlatıyor → kamera animasyonları bitmeden yenileniyor
 *  → map.isMoving() kalıcı true → MapLibre idle'da 90fps render (cihaz profili 2026-06-17). */
let _drivingViewActive = false;

export function setDrivingView(
  map: MapLibreMap,
  lat: number,
  lng: number,
  heading: number,
  speedKmh: number,
  containerHeight: number,
  turnApproachM?: number,
  obdSpeedKmh?: number,
  nextTurnBearing?: number,
) {
  if (!map || !map.isStyleLoaded()) return;
  _drivingViewActive = true;

  // ── Dead Reckoning speed fusion ──────────────────────────────────────────
  const effectiveSpeed = speedKmh > 0 ? speedKmh : (obdSpeedKmh ?? 0);

  // ── Movement jitter filter — düşük hızda GPS mikro titremeleri ───────────
  if (effectiveSpeed < CAMERA_CFG.JITTER_SPEED_KMH) {
    const dLat  = (lat - M.lastJumpLat) * 111_320;
    const dLng  = (lng - M.lastJumpLng) * 111_320 * Math.cos((lat * Math.PI) / 180);
    if (Math.sqrt(dLat * dLat + dLng * dLng) < CAMERA_CFG.JITTER_THRESHOLD_M) return;
  }
  M.lastJumpLat = lat;
  M.lastJumpLng = lng;

  // ── Camera target → smooth (Faz 3.1/3.3/3.4) ───────────────────────────
  const target = computeCameraTarget(effectiveSpeed, turnApproachM);

  // Turn anticipation + inertia + momentum model (Faz 3.4)
  const anticipatedBearing = computeAnticipatedBearing(heading, turnApproachM, nextTurnBearing);
  const smooth             = dampCameraToward(target, anticipatedBearing, effectiveSpeed);

  // Route energy: hız + acceleration delta ile senkron pulse (Faz 3.4)
  _updateFlowSpeed(effectiveSpeed, smooth.deltaSpeed);

  // ── Camera Lockdown (Phase H4) ────────────────────────────────────────────
  const { globalRiskScore: _hzRisk, hazardStatus: _hzStatus } = useHazardStore.getState();
  const _isLockdown = _hzStatus === 'ATTENTION';

  const _lookAhead = _isLockdown ? smooth.lookAheadM * 0.5 : smooth.lookAheadM;
  const _pitch     = _isLockdown ? Math.min(smooth.pitch, 45) : smooth.pitch;

  let _zoom = smooth.zoom;
  if (_hzRisk > 0.4 && M.lastHazardZoom > 0) {
    // Risk arttıkça izin verilen max zoom değişimi küçülür: 0.4→0.06, 1.0→0.02
    const maxDelta = Math.max(0.02, 0.10 * (1 - _hzRisk));
    _zoom = M.lastHazardZoom + Math.max(-maxDelta, Math.min(maxDelta, _zoom - M.lastHazardZoom));
  }
  M.lastHazardZoom = _zoom;

  // Look-ahead centre — kilitli değerler ile hesaplanır
  const _lookDeg   = _lookAhead / 111_320;
  const _cosLat    = Math.max(0.001, Math.cos((lat * Math.PI) / 180));
  const _bearRad   = (smooth.bearing * Math.PI) / 180;
  const centerLat  = lat + _lookDeg * Math.cos(_bearRad);
  const centerLng  = lng + _lookDeg * Math.sin(_bearRad) / _cosLat;

  const topPad = Math.round(containerHeight * target.topPadFrac);

  // jumpTo: tek frame — rAF loop 150ms throttle zaten smooth hissettiriyor.
  map.jumpTo({
    center:  [centerLng, centerLat],
    bearing: smooth.bearing,
    zoom:    _zoom,
    pitch:   _pitch,
    padding: { top: topPad, bottom: 0, left: 0, right: 0 },
  });

  // Smooth pitch tek kaynak — elevation + perspective aynı değeri kullanır ✓
  const pitch = smooth.pitch;

  // ── Elevation pass — dynamic shadow offset & blur (pitch + speed + zoom) ────
  const _currentZoom = map.getZoom();
  const _pitchChanged = Math.abs(pitch - M.lastShadowPitch) >= 3;
  const _zoomChanged  = Math.abs(_currentZoom - M.lastShadowZoom) >= 0.5;
  if ((_pitchChanged || _zoomChanged) && map.getLayer(ROUTE_SHADOW)) {
    M.lastShadowPitch = pitch;
    M.lastShadowZoom  = _currentZoom;
    M.lastBlurReduced = effectiveSpeed > 20;

    const shadowOffset  = Math.round(2 + (pitch / 72) * 10);
    const pitchBlur     = 5 + (pitch / 72) * 6;
    const speedScale    = effectiveSpeed > 20 ? 0.45 : 1.0;
    const zoomSharpness = 1 - Math.max(0, Math.min(1, (_currentZoom - 12) / 6)) * 0.65;
    const shadowBlur    = Math.max(1.5, Math.round(pitchBlur * speedScale * zoomSharpness));
    const glowBlur      = Math.max(2.5, Math.round((8 + (pitch / 72) * 4) * speedScale * zoomSharpness));
    try {
      map.setPaintProperty(ROUTE_SHADOW,   'line-offset', shadowOffset);
      map.setPaintProperty(ROUTE_SHADOW,   'line-blur',   shadowBlur);
      map.setPaintProperty(ROUTE_GLOW_SEL, 'line-blur',   glowBlur);
    } catch { /* style reloading */ }
  }

  // ── Perspective correction ─────────────────────────────────────────────────
  const perspScale = 1 + (pitch / 72) * 0.4;
  if (Math.abs(perspScale - M.lastPerspectiveScale) >= 0.06 && map.getLayer(SEL_LAYER)) {
    M.lastPerspectiveScale = perspScale;
    const cW = Math.round(8  * perspScale);  const cW18 = Math.round(32 * perspScale);
    const kW = Math.round(14 * perspScale);  const kW18 = Math.round(38 * perspScale);
    try {
      map.setPaintProperty(SEL_LAYER,  'line-width', ['interpolate', ['linear'], ['zoom'], 12, cW, 18, cW18]);
      map.setPaintProperty(ROUTE_CASE, 'line-width', ['interpolate', ['linear'], ['zoom'], 12, kW, 18, kW18]);
    } catch { /* style reloading */ }
  }

  // ── Maneuver emphasis — tier-based route styling ───────────────────────────
  const _mTier = !turnApproachM || turnApproachM >= 200 ? 0
    : turnApproachM >= 50 ? 1
    : 2;
  if (_mTier !== M.lastManeuverTier && map.getLayer(SEL_LAYER)) {
    M.lastManeuverTier = _mTier;
    try {
      if (_mTier === 0) {
        map.setPaintProperty(SEL_LAYER,      'line-opacity', 1.0);
        map.setPaintProperty(ROUTE_CASE,     'line-color',   '#ffffff');
        map.setPaintProperty(ROUTE_GLOW_SEL, 'line-color',   '#4285f4');
      } else if (_mTier === 1) {
        // Yaklaşıyor (200–50m): casing amber → sürücü dikkatini çeker
        map.setPaintProperty(ROUTE_CASE,     'line-color',   '#f59e0b');
      } else {
        // Kritik (<50m): amber glow + casing — kontrast road suppression'dan gelir artık
        map.setPaintProperty(ROUTE_CASE,     'line-color',   '#f59e0b');
        map.setPaintProperty(ROUTE_GLOW_SEL, 'line-color',   '#f59e0b');
        map.setPaintProperty(SEL_LAYER,      'line-opacity', 1.0); // Faz 3.2: tam opacity — lane clarity
      }
    } catch { /* style reloading */ }
  }

  // ── Intersection road suppression + tunnel glow (Faz 3.2) ──────────────────
  if (M.focusModeActive && _mTier !== M.lastIntersectionTier) {
    M.lastIntersectionTier = _mTier;
    _applyIntersectionSuppression(map, _mTier);
    const _glowOp = [0.20, 0.27, 0.36][_mTier] ?? 0.20;
    if (map.getLayer(ROUTE_GLOW_SEL)) {
      try { map.setPaintProperty(ROUTE_GLOW_SEL, 'line-opacity', _glowOp); } catch { /* ignore */ }
    }
  }

  // ── External Risk Alert (Phase H3) ────────────────────────────────────────
  const _hazardRisk = useHazardStore.getState().globalRiskScore;
  const _isHighRisk = _hazardRisk > 0.5;
  if (_isHighRisk !== M.lastExternalRiskAlert && map.getLayer(ROUTE_CASE)) {
    M.lastExternalRiskAlert = _isHighRisk;
    try {
      if (_isHighRisk) {
        map.setPaintProperty(ROUTE_CASE,     'line-color', '#f59e0b');
        map.setPaintProperty(ROUTE_GLOW_SEL, 'line-color', '#f59e0b');
      } else if (_mTier === 0) {
        // Sadece tier 0'da (kavşak yokken) orijinal renklere dön
        map.setPaintProperty(ROUTE_CASE,     'line-color', '#ffffff');
        map.setPaintProperty(ROUTE_GLOW_SEL, 'line-color', '#4285f4');
      }
    } catch { /* style reloading */ }
  }
}

/**
 * Navigation entry animation — called ONCE when the user taps "Başlat".
 *
 * @param bearing  Initial bearing in degrees (first route step direction or GPS heading)
 */
export function enterNavigationView(
  map: MapLibreMap,
  lat: number,
  lng: number,
  bearing: number,
  containerHeight: number,
) {
  if (!map || !map.isStyleLoaded()) return;

  const TARGET_ZOOM    = 18.0; // Yakın yol detayı
  const TARGET_PITCH   = 38;   // 40°+ üzerinde siyah köşe riski artar
  const DURATION_MS    = 1000; // Yumuşak giriş animasyonu

  // Smooth camera state'i giriş noktasıyla eşitle — ilk tick'te jump olmasın
  resetCameraSmooth({ zoom: TARGET_ZOOM, pitch: TARGET_PITCH, lookAheadM: 30, bearing });

  const lookAheadDeg = 30 / 111_320;
  const headRad      = (bearing * Math.PI) / 180;
  const cosLat       = Math.max(0.001, Math.cos((lat * Math.PI) / 180));
  const centerLat    = lat + lookAheadDeg * Math.cos(headRad);
  const centerLng    = lng + lookAheadDeg * Math.sin(headRad) / cosLat;

  const topPad = Math.round(containerHeight * 0.48);

  map.easeTo({
    center:  [centerLng, centerLat],
    bearing,
    zoom:    TARGET_ZOOM,
    pitch:   TARGET_PITCH,
    padding: { top: topPad, bottom: 0, left: 0, right: 0 },
    duration: DURATION_MS,
    essential: true,
  });
}

/**
 * Reset bearing, zoom, pitch and padding after leaving driving mode.
 */
export function exitDrivingView(map: MapLibreMap) {
  if (!map) return;
  // İDEMPOTENT: zaten driving-view dışındaysak HİÇBİR ŞEY yapma. Aksi halde her
  // heading değişiminde easeTo başlar → isMoving kalıcı true → sürekli render.
  if (!_drivingViewActive) return;
  _drivingViewActive = false;
  M.lastPerspectiveScale  = 1.0;
  M.lastManeuverTier      = 0;
  M.lastShadowPitch       = -1.0;
  M.lastShadowZoom        = -1.0;
  M.lastMoodScore         = -1.0;
  M.lastExternalRiskAlert = false;
  M.lastHazardZoom        = 0;
  // Camera smooth state'i sıfırla — sonraki navigasyonda jump olmasın
  resetCameraSmooth({ zoom: 15.5, pitch: 0, lookAheadM: 0, bearing: 0 });
  // Route layer state restore
  if (map.isStyleLoaded()) {
    try {
      if (map.getLayer(SEL_LAYER))      map.setPaintProperty(SEL_LAYER,      'line-opacity', 1.0);
      if (map.getLayer(ROUTE_CASE))     map.setPaintProperty(ROUTE_CASE,     'line-color',   '#ffffff');
      if (map.getLayer(ROUTE_GLOW_SEL)) map.setPaintProperty(ROUTE_GLOW_SEL, 'line-color',   '#4285f4');
    } catch { /* ignore */ }
  }
  map.easeTo({
    bearing: 0,
    zoom: 15.5,
    pitch: 0,
    padding: { top: 0, bottom: 0, left: 0, right: 0 },
    duration: 800,
  });
}

export function setDrivingMode(enabled: boolean) {
  useMapStore.setState({ drivingMode: enabled });
}

export function useDrivingMode() {
  return useMapStore((s) => s.drivingMode);
}
