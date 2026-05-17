/**
 * cameraEngine.ts — Automotive Navigation Camera System
 * Faz 3.1: Speed-aware cinematography, exponential damping, turn anticipation.
 * Faz 3.3: Motion inertia (bearing EMA), scale realism (pitch tuning), movement energy.
 *
 * Tasarım kuralları:
 *   - Saf fonksiyonlar + izole module state (singleton — tek aktif sürüş oturumu)
 *   - Mali-400 safe: tüm hesaplamalar O(1), map.jumpTo() hâlâ setDrivingView'da
 *   - Tüm magic number'lar CAMERA_CFG'de toplanmış
 *   - mapService.ts bu modülü tüketir; tersine import yok
 */

/* ─── Configuration ─────────────────────────────────────────────────────── */

/**
 * Tüm kamera sabitleri. Değer değişikliği için tek yer.
 */
export const CAMERA_CFG = {
  // ── Zoom curve (speed km/h → MapLibre zoom level) ──────────────
  ZOOM_AT_0:    18.5,  // durağan / park
  ZOOM_AT_30:   17.5,  // şehir içi yavaş
  ZOOM_AT_60:   16.7,  // şehir içi normal
  ZOOM_AT_100:  15.5,  // şehiriçi-dışı arası
  ZOOM_MIN:     14.2,  // otoyol 150+ km/h

  // ── Turn approach zoom boost ────────────────────────────────────
  ZOOM_TURN_BOOST:  1.6,   // dönüşe yaklaşınca maksimum ek zoom
  ZOOM_TURN_ZONE_M: 180,   // boost'un başladığı mesafe (metre)

  // ── Pitch curve (degrees) — Faz 3.3: scale realism ─────────────
  // Önceki 68°/60° değerleri minyatür hissi yarattı; daha gerçekçi açılar:
  PITCH_IDLE:     38,   //  0–10 km/h — park/bekleme (neredeyse overhead)
  PITCH_URBAN:    45,   // 10–50 km/h — şehir içi
  PITCH_ROAD:     57,   // 50–100 km/h — karayolu (daha dengeli perspektif)
  PITCH_HIGHWAY:  63,   // 100+ km/h — otoyol ufku (daha az distorsiyon)
  PITCH_TURN_MIN: 26,   // kavşak görünümü için minimum tilt

  // ── Look-ahead (metre) ──────────────────────────────────────────
  LOOK_SCALE: 42,       // log1p(spd * 0.5) * LOOK_SCALE
  LOOK_MAX_M: 140,      // otoyolda maksimum ileri bakış

  // ── Vehicle offset (top padding, fraction of containerHeight) ──
  TOP_PAD_BASE:  0.50,  // durağan
  TOP_PAD_MAX:   0.70,  // otoyol
  TOP_PAD_SPEED: 110,   // bu km/h'de maksimuma ulaşır

  // ── Turn anticipation ──────────────────────────────────────────
  // Dönüşe yaklaşınca kamera dönüş bölgesini hafifçe önden gösterir.
  ANTICIPATION_START_M: 220,  // anticipation'ın başladığı mesafe
  ANTICIPATION_MAX_DEG:  18,  // maksimum bearing sapması (derece)

  // ── Exponential Moving Average (per setDrivingView call ~150ms) ─
  // alpha = 1.0 → anlık, 0.0 → hiç değişmez
  DAMP_ZOOM:    0.18,  // zoom yavaş değişir (kaymazsın)
  DAMP_PITCH:   0.11,  // pitch en kritik — çok kademeli
  DAMP_LOOK:    0.24,  // look-ahead orta hızda

  // Faz 3.3: bearing inertia — tiered adaptive damping (Faz 3.4 genişletildi)
  DAMP_BEARING:         0.55,  // road tier alias (backward compat)
  DAMP_BEARING_URBAN:   0.30,  //  < 20 km/h: GPS heading güvenilmez — stable filter
  DAMP_BEARING_ROAD:    0.55,  // 20–80 km/h: dengelenmiş inertia
  DAMP_BEARING_HIGHWAY: 0.18,  //  > 80 km/h: çok stabil, yol dışı sapma yok

  // ── Movement jitter filter ──────────────────────────────────────
  JITTER_SPEED_KMH:   5,    // bu hızın altında filtrele
  JITTER_THRESHOLD_M: 0.8,  // minimum GPS hareketi (metre)

  // ── Low-speed bearing deadzone (Faz 3.4) ─────────────────────
  // Düşük hızda GPS heading güvenilmez; küçük değişimleri filtrele.
  BEARING_DEADZONE_KMH: 5,   // bu hızın altında deadzone aktif
  BEARING_DEADZONE_DEG: 8,   // bu açıdan küçük değişimler yoksayılır

  // ── Acceleration response (Faz 3.4) ──────────────────────────
  // Hızlanma: look-ahead genişler, zoom hafif geri çekilir (dünya ileri akar).
  // Frenleme: zoom hafif kapanır (dünya sıkışır), look-ahead genişlemez.
  ACC_LOOK_BOOST:  0.30,  // m extra look-ahead per km/h of positive delta
  ACC_ZOOM_PULL:   0.007, // zoom shift per km/h of delta (pos=back, neg=in)
  ACC_DELTA_DECAY: 0.25,  // EMA alpha on raw delta-speed (GPS spike sönümleme)

  // ── Cruise stabilization (Faz 3.4) ───────────────────────────
  // Sabit hızda (delta ≈ 0) kamera neredeyse kilitlenir → otoyol konforu.
  CRUISE_THRESHOLD_KMH: 3.0,  // |delta| altında cruise tick sayılır
  CRUISE_MIN_TICKS:     7,    // bu kadar ardışık tick → cruise mode aktif
  CRUISE_DAMP_ZOOM:  0.06,    // cruise'da zoom neredeyse sabit
  CRUISE_DAMP_PITCH: 0.05,    // cruise'da pitch neredeyse sabit
} as const;

/* ─── Types ──────────────────────────────────────────────────────────────── */

/** computeCameraTarget'ın döndürdüğü anlık hedef */
export interface CameraTarget {
  zoom:       number;
  pitch:      number;
  lookAheadM: number;
  topPadFrac: number;
}

/** Modül-level smooth state — dampCameraToward tarafından güncellenir */
export interface SmoothState {
  zoom:       number;
  pitch:      number;
  lookAheadM: number;
  bearing:    number;    // Faz 3.3: inertia-smoothed bearing
  deltaSpeed: number;   // Faz 3.4: smoothed delta-speed → route energy cohesion
}

/* ─── Module state ───────────────────────────────────────────────────────── */

let _sm: SmoothState = {
  zoom:       CAMERA_CFG.ZOOM_AT_0,
  pitch:      CAMERA_CFG.PITCH_IDLE,
  lookAheadM: 0,
  bearing:    0,
  deltaSpeed: 0,
};

// ── Momentum state (Faz 3.4) ─────────────────────────────────────────────────
let _smoothDeltaSpeed   = 0;    // EMA-smoothed speed change per tick
let _prevEffectiveSpeed = -1.0; // -1 = ilk tick, delta yok
let _cruiseCounter      = 0;    // ardışık cruise tick sayısı

/**
 * Kamera smooth state'ini bilinen bir başlangıç noktasına sıfırla.
 * enterNavigationView ve exitDrivingView tarafından çağrılır.
 */
export function resetCameraSmooth(seed?: Partial<SmoothState>): void {
  _sm = {
    zoom:       seed?.zoom       ?? CAMERA_CFG.ZOOM_AT_0,
    pitch:      seed?.pitch      ?? CAMERA_CFG.PITCH_IDLE,
    lookAheadM: seed?.lookAheadM ?? 0,
    bearing:    seed?.bearing    ?? 0,
    deltaSpeed: 0,
  };
  // Momentum state'i de sıfırla — navigasyon oturumları arası carryover önle
  _smoothDeltaSpeed   = 0;
  _prevEffectiveSpeed = -1.0;
  _cruiseCounter      = 0;
}

/* ─── Pure helpers ───────────────────────────────────────────────────────── */

/**
 * İki koordinat arasındaki bearing (derece, 0–360).
 * FullMapView tick içinde nextTurnBearing hesabı için kullanılır.
 */
export function bearingBetween(
  lat1: number, lng1: number,
  lat2: number, lng2: number,
): number {
  const dLng  = (lng2 - lng1) * Math.PI / 180;
  const lat1R = lat1 * Math.PI / 180;
  const lat2R = lat2 * Math.PI / 180;
  const y = Math.sin(dLng) * Math.cos(lat2R);
  const x = Math.cos(lat1R) * Math.sin(lat2R) - Math.sin(lat1R) * Math.cos(lat2R) * Math.cos(dLng);
  return ((Math.atan2(y, x) * 180 / Math.PI) + 360) % 360;
}

/** [-180, 180] aralığına normalize edilmiş açı farkı */
function _angleDiff(from: number, to: number): number {
  return ((to - from + 540) % 360) - 180;
}

/* ─── Core computations ──────────────────────────────────────────────────── */

/**
 * Sürüş girdilerine göre anlık kamera hedefi hesapla.
 * Saf fonksiyon — yan etkisi yok.
 *
 * @param effectiveSpeedKmh  GPS veya OBD hızı (km/h)
 * @param turnApproachM      Bir sonraki manevra noktasına mesafe (metre)
 */
export function computeCameraTarget(
  effectiveSpeedKmh: number,
  turnApproachM?: number,
): CameraTarget {
  const spd = effectiveSpeedKmh;
  const cfg  = CAMERA_CFG;

  // ── Zoom (piecewise linear, aynı referans noktaları korunuyor) ──
  let zoom: number;
  if      (spd <= 0)    zoom = cfg.ZOOM_AT_0;
  else if (spd <= 30)   zoom = cfg.ZOOM_AT_0   - (spd / 30)               * (cfg.ZOOM_AT_0   - cfg.ZOOM_AT_30);
  else if (spd <= 60)   zoom = cfg.ZOOM_AT_30  - ((spd - 30) / 30)        * (cfg.ZOOM_AT_30  - cfg.ZOOM_AT_60);
  else if (spd <= 100)  zoom = cfg.ZOOM_AT_60  - ((spd - 60) / 40)        * (cfg.ZOOM_AT_60  - cfg.ZOOM_AT_100);
  else                  zoom = Math.max(cfg.ZOOM_MIN, cfg.ZOOM_AT_100 - (spd - 100) * 0.013);

  // ── Turn approach zoom boost (180m zone) ────────────────────────
  if (turnApproachM !== undefined && turnApproachM > 0 && turnApproachM < cfg.ZOOM_TURN_ZONE_M) {
    const factor = Math.pow(
      Math.max(0, (cfg.ZOOM_TURN_ZONE_M - turnApproachM) / cfg.ZOOM_TURN_ZONE_M),
      1.5,
    );
    zoom = Math.min(18.5, zoom + factor * cfg.ZOOM_TURN_BOOST);
  }

  // ── Pitch (piecewise, daha doğal hız-tilt eğrisi) ───────────────
  let pitch: number;
  if      (spd <= 10)   pitch = cfg.PITCH_IDLE;
  else if (spd <= 50)   pitch = cfg.PITCH_IDLE    + ((spd - 10) / 40) * (cfg.PITCH_URBAN   - cfg.PITCH_IDLE);
  else if (spd <= 100)  pitch = cfg.PITCH_URBAN   + ((spd - 50) / 50) * (cfg.PITCH_ROAD    - cfg.PITCH_URBAN);
  else                  pitch = cfg.PITCH_ROAD    + Math.min(1, (spd - 100) / 40) * (cfg.PITCH_HIGHWAY - cfg.PITCH_ROAD);

  // ── Kavşak yaklaşımı: pitch azalt + ek zoom (150m zone) ─────────
  if (turnApproachM !== undefined && turnApproachM > 0 && turnApproachM < 150) {
    const closeFactor = Math.max(0, (150 - turnApproachM) / 150);
    pitch = Math.max(cfg.PITCH_TURN_MIN, pitch * (1 - closeFactor * 0.58));
    // 50m içinde ek zoom (kavşak detayı)
    if (closeFactor > 0.33) {
      zoom = Math.min(18.5, zoom + closeFactor * 1.4);
    }
  }

  // ── Look-ahead (logaritmik, yüksek hızda daha fazla ileri bakış) ─
  const lookAheadM = Math.min(cfg.LOOK_MAX_M, Math.log1p(spd * 0.5) * cfg.LOOK_SCALE);

  // ── Top padding (araç ekranın altına doğru kayar) ─────────────────
  const topPadFrac = Math.min(
    cfg.TOP_PAD_MAX,
    cfg.TOP_PAD_BASE + (spd / cfg.TOP_PAD_SPEED) * (cfg.TOP_PAD_MAX - cfg.TOP_PAD_BASE),
  );

  return { zoom, pitch, lookAheadM, topPadFrac };
}

/**
 * Manevra bölgesine yaklaşınca bearing'i turn-anticipated hedefe doğru blend et.
 * computeLookAheadCenter'dan ayrılmış saf fonksiyon.
 * Faz 3.3: dampCameraToward'a geçirilir; bearing smooth state bu değere doğru akar.
 */
export function computeAnticipatedBearing(
  headingDeg: number,
  turnApproachM?: number,
  turnBearingDeg?: number,
): number {
  const cfg = CAMERA_CFG;
  if (
    turnBearingDeg === undefined ||
    turnApproachM  === undefined ||
    turnApproachM >= cfg.ANTICIPATION_START_M ||
    turnApproachM <= 0
  ) {
    return headingDeg;
  }
  const blend    = Math.pow(Math.max(0, 1 - turnApproachM / cfg.ANTICIPATION_START_M), 1.4);
  const bearDiff = _angleDiff(headingDeg, turnBearingDeg);
  const maxAngle = Math.min(cfg.ANTICIPATION_MAX_DEG, Math.abs(bearDiff) * 0.50);
  return headingDeg + Math.sign(bearDiff) * maxAngle * blend;
}

/**
 * Kamerayı hedefe doğru üstel olarak yavaştır.
 * Faz 3.4 ekleri: momentum, adaptive damping, cruise stabilization.
 *
 * @param target            computeCameraTarget çıktısı
 * @param bearingTarget     Turn-anticipated bearing (opsiyonel)
 * @param effectiveSpeedKmh GPS/OBD hız (momentum hesabı için)
 * @returns Güncel smooth state
 */
export function dampCameraToward(
  target: CameraTarget,
  bearingTarget?: number,
  effectiveSpeedKmh?: number,
): SmoothState {
  const cfg = CAMERA_CFG;
  const spd = effectiveSpeedKmh ?? 0;

  // ── Delta-speed computation ──────────────────────────────────────────────
  // Ham delta GPS spikelarını yansıtabilir; EMA ile sönümlüyoruz.
  let rawDelta = 0;
  if (_prevEffectiveSpeed >= 0 && effectiveSpeedKmh !== undefined) {
    rawDelta = spd - _prevEffectiveSpeed;
  }
  if (effectiveSpeedKmh !== undefined) _prevEffectiveSpeed = spd;
  _smoothDeltaSpeed += (rawDelta - _smoothDeltaSpeed) * cfg.ACC_DELTA_DECAY;

  // ── Cruise detection ─────────────────────────────────────────────────────
  // Sabit hızda kamera kilitlenir; ani transition yok.
  if (Math.abs(_smoothDeltaSpeed) < cfg.CRUISE_THRESHOLD_KMH) {
    _cruiseCounter = Math.min(_cruiseCounter + 1, cfg.CRUISE_MIN_TICKS + 2);
  } else {
    _cruiseCounter = 0;
  }
  const inCruise = _cruiseCounter >= cfg.CRUISE_MIN_TICKS;

  // ── Adaptive damp alphas ─────────────────────────────────────────────────
  const dampZoom  = inCruise ? cfg.CRUISE_DAMP_ZOOM  : cfg.DAMP_ZOOM;
  const dampPitch = inCruise ? cfg.CRUISE_DAMP_PITCH : cfg.DAMP_PITCH;

  // ── Momentum-adjusted targets ────────────────────────────────────────────
  // Acceleration (+delta): zoom geri çekilir (dünya genişler), look-ahead uzar.
  // Deceleration (-delta): zoom kapanır (dünya sıkışır), look-ahead genişlemez.
  const zoomAdjust = -_smoothDeltaSpeed * cfg.ACC_ZOOM_PULL;
  const lookBoost  = Math.max(0, _smoothDeltaSpeed) * cfg.ACC_LOOK_BOOST;

  const adjZoom = Math.max(cfg.ZOOM_MIN, Math.min(18.5, target.zoom + zoomAdjust));
  const adjLook = Math.min(cfg.LOOK_MAX_M, Math.max(0, target.lookAheadM + lookBoost));

  // ── EMA smooth: zoom / pitch / look-ahead ───────────────────────────────
  _sm.zoom       += (adjZoom      - _sm.zoom)       * dampZoom;
  _sm.pitch      += (target.pitch - _sm.pitch)      * dampPitch;
  _sm.lookAheadM += (adjLook      - _sm.lookAheadM) * cfg.DAMP_LOOK;
  _sm.deltaSpeed  = _smoothDeltaSpeed;

  // ── Bearing EMA — adaptive alpha + low-speed deadzone ───────────────────
  if (bearingTarget !== undefined) {
    const diff = _angleDiff(_sm.bearing, bearingTarget);

    // Deadzone: düşük hızda GPS heading güvenilmez — mikro-titremeleri filtrele
    const inDeadzone =
      spd < cfg.BEARING_DEADZONE_KMH && Math.abs(diff) < cfg.BEARING_DEADZONE_DEG;

    if (!inDeadzone) {
      // Tiered alpha: otoyolda çok stabil, şehirde responsive
      const bearAlpha =
        spd < 20 ? cfg.DAMP_BEARING_URBAN :
        spd < 80 ? cfg.DAMP_BEARING_ROAD  :
                   cfg.DAMP_BEARING_HIGHWAY;

      _sm.bearing = ((_sm.bearing + diff * bearAlpha) + 360) % 360;
    }
  }

  return {
    zoom:       _sm.zoom,
    pitch:      _sm.pitch,
    lookAheadM: _sm.lookAheadM,
    bearing:    _sm.bearing,
    deltaSpeed: _sm.deltaSpeed,
  };
}

/**
 * Harita merkezi ve efektif bearing'i hesapla.
 *
 * Look-ahead: araç pozisyonundan ileriye (heading yönünde) kaydırılmış nokta.
 * Turn anticipation: kamera, dönüş bölgesine yaklaşınca yönünü hafifçe döndürür.
 *
 * @param lat/lng          Araç konumu (gerçek veya snap'lenmiş)
 * @param headingDeg       Mevcut yön (interpolate edilmiş GPS/IMU)
 * @param lookAheadM       Smooth look-ahead mesafesi (metre)
 * @param turnApproachM    Manevra noktasına kalan mesafe (metre, opsiyonel)
 * @param turnBearingDeg   Manevra sonrası yön (derece, opsiyonel — anticipation için)
 */
export function computeLookAheadCenter(
  lat: number,
  lng: number,
  headingDeg: number,
  lookAheadM: number,
  turnApproachM?: number,
  turnBearingDeg?: number,
): { centerLat: number; centerLng: number; effectiveBearing: number } {
  const cfg    = CAMERA_CFG;
  const cosLat = Math.max(0.001, Math.cos((lat * Math.PI) / 180));

  // ── Turn anticipation — kamera dönüş tarafına hafifçe döner ─────
  // Manevra yaklaşınca kamera, dönüşü "öngörür": bearing hedef yöne doğru kısmen döner.
  let effectiveBearing = headingDeg;
  if (
    turnBearingDeg !== undefined &&
    turnApproachM  !== undefined &&
    turnApproachM  > 0           &&
    turnApproachM  < cfg.ANTICIPATION_START_M
  ) {
    // Blend factor: 0.0 at ANTICIPATION_START_M, 1.0 at 0m (eased-in)
    const blend    = Math.pow(
      Math.max(0, 1 - turnApproachM / cfg.ANTICIPATION_START_M),
      1.4,
    );
    const bearDiff = _angleDiff(headingDeg, turnBearingDeg);
    // Maksimum sapma: ANTICIPATION_MAX_DEG ile ve bearDiff'in yarısı ile sınırla
    const maxAngle = Math.min(cfg.ANTICIPATION_MAX_DEG, Math.abs(bearDiff) * 0.50);
    effectiveBearing = headingDeg + Math.sign(bearDiff) * maxAngle * blend;
  }

  // ── Look-ahead centre ─────────────────────────────────────────────
  const lookDeg   = lookAheadM / 111_320;
  const headRad   = (effectiveBearing * Math.PI) / 180;
  const centerLat = lat + lookDeg * Math.cos(headRad);
  const centerLng = lng + lookDeg * Math.sin(headRad) / cosLat;

  return { centerLat, centerLng, effectiveBearing };
}
