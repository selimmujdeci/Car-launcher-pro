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
  // 50°+ değerler MapLibre'de siyah köşe oluşturur (tile ufku aşılır).
  // Maksimum güvenli pitch ~48° — tüm değerler bunun altında tutulur.
  PITCH_IDLE:     20,   //  0–10 km/h — park/bekleme (neredeyse düz)
  PITCH_URBAN:    30,   // 10–50 km/h — şehir içi
  PITCH_ROAD:     40,   // 50–100 km/h — karayolu
  PITCH_HIGHWAY:  47,   // 100+ km/h — otoyol (tile sınırı altında)
  PITCH_TURN_MIN: 15,   // kavşak görünümü için minimum tilt

  // ── Look-ahead (metre) ──────────────────────────────────────────
  LOOK_SCALE: 42,       // log1p(spd * 0.5) * LOOK_SCALE
  LOOK_MAX_M: 140,      // otoyolda maksimum ileri bakış

  // ── Vehicle offset (top padding, fraction of containerHeight) ──
  TOP_PAD_BASE:  0.50,  // durağan
  TOP_PAD_MAX:   0.70,  // otoyol
  TOP_PAD_SPEED: 110,   // bu km/h'de maksimuma ulaşır

  /** Aracın ekranın ALT kenarına en az bu kadar px kalmalı (bkz. clampTopPadForVehicle). */
  VEHICLE_MIN_BOTTOM_PX: 72,

  // ── Turn anticipation ──────────────────────────────────────────
  // Dönüşe yaklaşınca kamera dönüş bölgesini hafifçe önden gösterir.
  ANTICIPATION_START_M: 220,  // anticipation'ın başladığı mesafe
  ANTICIPATION_MAX_DEG:  18,  // maksimum bearing sapması (derece)

  // ── Exponential Moving Average ──────────────────────────────────
  // alpha = 1.0 → anlık, 0.0 → hiç değişmez
  //
  // ⚠️ BU ALFALAR BİR TEMPOYA AİTTİR. Sahada `CALIBRATION_DT_MS` (150 ms)
  // kadansında tek tek ayarlandılar. Sabit alfa, çağrı sıklığı değişince
  // FİZİKSEL DAVRANIŞI da değiştirir — bkz. `CALIBRATION_DT_MS` yorumu.
  // Bu yüzden `dampCameraToward` alfaları `rateAdjustAlpha` ile Δt'ye
  // uyarlar; buradaki sayılar 150 ms'deki DEĞER olarak okunur.
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
  /* Durakta yeniden ORTALAMA eşiği (m). 0.8 m tipik GPS gürültüsünün (±3–6 m)
     ÇOK ALTINDA kaldığı için duran araçta kamera her fix'te yeniden ortalanıyor
     ve harita kendiliğinden kayıyordu — cihazda ölçüldü (2026-08-03): araç
     0 m hareket ederken merkez 1–5 m adımlarla sürekli kaydı.
     Gürültü bandının üstünde bir eşik: durakta harita TAMAMEN durur; gerçek
     hareket başlayınca (hız ≥ JITTER_SPEED_KMH) bu dal zaten çalışmaz. */
  STANDSTILL_RECENTER_MIN_M: 6,

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
  CRUISE_THRESHOLD_KMH: 3.0,  // |delta| altında cruise sayılır
  /** Bu kadar KESİNTİSİZ SÜRE sabit hız → cruise mode aktif (ms).
   *  Eskiden 7 TICK idi; tick süresi çağrı yerine göre 16–500 ms arasında
   *  değiştiği için aynı kural tam ekranda 1,05 sn, mini haritada 3,5 sn,
   *  ölü hesaplama yolunda 0,11 sn anlamına geliyordu. Değer SÜREYE
   *  çevrildi: 7 × 150 ms = 1050 ms → kalibrasyon temposunda DAVRANIŞ AYNI. */
  CRUISE_MIN_MS:     1050,
  CRUISE_DAMP_ZOOM:  0.06,    // cruise'da zoom neredeyse sabit
  CRUISE_DAMP_PITCH: 0.05,    // cruise'da pitch neredeyse sabit

  // ── Kadans (tick temposu) ────────────────────────────────────
  /**
   * Yukarıdaki TÜM alfa/eşik değerlerinin ölçüldüğü tick aralığı (ms).
   *
   * ── NEDEN AÇIKÇA YAZILI (ölçülen kusur) ──────────────────────────────────
   * `dampCameraToward` üstel bir ortalama uygular ve alfa **çağrı başınadır**;
   * yani aynı alfa farklı tempolarda farklı ZAMAN SABİTİ üretir:
   *     τ = −Δt / ln(1 − α)
   * `DAMP_PITCH = 0.11` için ölçüm:
   *     Δt = 150 ms → τ ≈ 1,29 s   (sahada ayarlanan his)
   *     Δt = 500 ms → τ ≈ 4,29 s   (**3,3× tembel**)
   *     Δt =  16 ms → τ ≈ 0,14 s   (**9,4× hırçın**)
   * Bu üç tempo da üründe CANLIDIR:
   *   · `FullMapView` normal takip  → 150 ms  (FullMapView.tsx `cameraThrottleMs`)
   *   · `MiniMapWidget`             → GPS fix hızı ≈ 500 ms (2 Hz tavanı)
   *   · `FullMapView` ölü hesaplama → 16 ms   (`drInterval`)
   * Sonuç: mini harita, tam ekranla "AYNI politika, AYNI argümanlar" ile
   * çağırmasına rağmen ÖLÇÜLEBİLİR biçimde farklı hissettiriyordu — fark
   * politikada değil, TEMPODAYDI ve hiçbir yerde görünmüyordu.
   *
   * Düzeltme: alfalar Δt'ye göre uyarlanır (`rateAdjustAlpha`). Bu değer
   * uyarlamanın SIFIR NOKTASIDIR: Δt = 150 ms'te alfa aynen korunur, yani
   * sahada doğrulanmış tam ekran davranışı BİREBİR değişmez.
   */
  CALIBRATION_DT_MS: 150,
  /** Δt tabanı — bundan küçük aralık ölçüm gürültüsüdür (tek kare ≈ 16 ms). */
  DT_MIN_MS: 16,
  /** Δt tavanı. Uygulama arka plana alınıp dönünce Δt saniyeler olabilir;
   *  uyarlanmış alfa 1'e gidip kamerayı SIÇRATIRDI. Tavan, uzun boşluktan
   *  sonraki ilk kareyi "biraz gecikmiş bir tick" gibi ele alır. */
  DT_MAX_MS: 600,
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
let _smoothDeltaSpeed   = 0;    // EMA-smoothed speed change per calibration interval
let _prevEffectiveSpeed = -1.0; // -1 = ilk tick, delta yok
let _cruiseMs           = 0;    // kesintisiz sabit-hız süresi (ms)

// ── Kadans gözlemi (yalnız OKUNUR — davranışı etkilemez) ─────────────────────
let _lastDtMs: number | null = null;   // son uygulanan (kırpılmış) Δt
let _tickCount = 0;                    // toplam damp çağrısı
/** Δt kalibrasyondan bu oranın dışına çıktığı tick sayısı — kadans sapma kanıtı. */
let _offCadenceTicks = 0;

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
  _cruiseMs           = 0;
  _lastDtMs           = null;
}

/**
 * Sabit-kadans alfasını GERÇEK Δt'ye uyarla.
 *
 * Üstel ortalamada kalan oran her tickte `(1 − α)` ile çarpılır. `n` tick'lik
 * sürede kalan `(1 − α)^n`'dir; `n = Δt / Δt_kalibrasyon` alınırsa:
 *
 *     α(Δt) = 1 − (1 − α_kalibrasyon)^(Δt / Δt_kalibrasyon)
 *
 * Bu, `α = 1 − e^(−Δt/τ)` ile birebir aynı ailedir ve **Δt = Δt_kalibrasyon'da
 * α'yı AYNEN döndürür** → sahada doğrulanmış tam ekran davranışı korunur.
 *
 * SAF fonksiyon: saat okumaz, durum tutmaz (test edilebilirlik şartı).
 *
 * @param alphaAtCalibration `CAMERA_CFG` içindeki 150 ms'lik alfa (0..1)
 * @param dtMs               ölçülen tick aralığı — kırpılmış olarak beklenir
 */
export function rateAdjustAlpha(alphaAtCalibration: number, dtMs: number): number {
  const a = alphaAtCalibration;
  // Uç değerlerde üs alma gereksiz ve sayısal olarak risklidir.
  if (!(a > 0)) return 0;
  if (a >= 1)   return 1;
  if (!Number.isFinite(dtMs) || dtMs <= 0) return a;   // ölçemiyorsak DOKUNMA
  const n = dtMs / CAMERA_CFG.CALIBRATION_DT_MS;
  return Math.max(0, Math.min(1, 1 - Math.pow(1 - a, n)));
}

/**
 * Ölçülen Δt'yi güvenli banda kırp.
 *
 * Ölçülemeyen Δt (ilk tick, saat sıfırlaması, negatif fark) kalibrasyon
 * değerine düşer → davranış bugünküyle AYNI kalır (fail-soft).
 */
export function clampCameraDt(dtMs: number | undefined | null): number {
  const cfg = CAMERA_CFG;
  if (dtMs === undefined || dtMs === null || !Number.isFinite(dtMs) || dtMs <= 0) {
    return cfg.CALIBRATION_DT_MS;
  }
  return Math.max(cfg.DT_MIN_MS, Math.min(cfg.DT_MAX_MS, dtMs));
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
 * Araç ekranın ALTINDAN taşarsa düzeltilmiş `topPad` döndürür; taşma yoksa `null`.
 *
 * ── NEDEN GEREKLİ (saha 2026-08-03, kullanıcı: "araba gidince görünmüyor,
 *    geride kalıyor") ────────────────────────────────────────────────────────
 * Sürüş kamerası aracın KENDİSİNİ değil, aracın `lookAheadM` metre ÖNÜNDEKİ
 * noktayı merkeze alır ve `padding.top` ile o merkezi aşağı iter. MapLibre'de
 * padding'li merkez ekranda `y = (H + topPad) / 2` noktasına düşer; araç bunun
 * `lookAheadPx` kadar ALTINDA kalır.
 *
 * KUSUR: `topPadFrac` bir ORANDIR (H ile ölçeklenir) ama `lookAheadM` METREDİR —
 * piksel karşılığı H'den BAĞIMSIZDIR. Yani ekran kısaldıkça araç aşağı taşar.
 * Ölçüm (50 km/h, zoom≈16.4, ~1.45 m/px → lookAhead ≈ 137 m ≈ 94 px):
 *   • Head unit H=600 → merkez 0.795·600 ≈ 477 px, araç ≈ 571 px → ekranda (dar).
 *   • Telefon    H=400 → merkez 0.795·400 ≈ 318 px, araç ≈ 412 px → **EKRAN DIŞI**.
 * Hız arttıkça `lookAheadM` de `topPadFrac` de büyür → semptom hızla kötüleşir;
 * kullanıcının "araba gidince kayboluyor" tarifi tam olarak budur.
 *
 * ÇÖZÜM: look-ahead'i (yani sürücünün ileri görüşünü) KISALTMAK yerine merkezi
 * yukarı çekeriz. `centerY = (H + topPad)/2` olduğundan topPad'i `2×taşma`
 * kadar azaltmak merkezi — ve onunla birlikte aracı — `taşma` kadar yukarı taşır.
 *
 * @param vehicleScreenY  `map.project([lng, lat]).y` — gerçek, pitch'e uygun ölçüm
 * @param containerHeight harita konteyner yüksekliği (px)
 * @param topPad          uygulanan üst padding (px)
 * @param minBottomPx     araç ile alt kenar arasında korunacak boşluk
 * @returns yeni topPad (0 ≤ yeni < topPad) veya taşma yoksa `null`
 */
/**
 * Araç ekranda DÜZGÜN çerçevelenmiş mi? (saf · test edilebilir)
 *
 * "Ekranda" yetmez: aracın alt kenara `minBottomPx` kadar payı da olmalı,
 * yoksa alt bilgi çubuğunun altında kalır.
 */
export function isVehicleFramed(
  screenX: number, screenY: number,
  width: number, height: number,
  minBottomPx: number = CAMERA_CFG.VEHICLE_MIN_BOTTOM_PX,
): boolean {
  if (!Number.isFinite(screenX) || !Number.isFinite(screenY)) return false;
  if (!(width > 0) || !(height > 0)) return false;
  return screenX >= 0 && screenX <= width && screenY >= 0 && screenY <= height - minBottomPx;
}

export function clampTopPadForVehicle(
  vehicleScreenY: number,
  containerHeight: number,
  topPad: number,
  minBottomPx: number = CAMERA_CFG.VEHICLE_MIN_BOTTOM_PX,
): number | null {
  // Ölçülemeyen girdide DOKUNMA — kamera sessizce bozulmaktansa olduğu gibi kalsın.
  if (!Number.isFinite(vehicleScreenY) || !Number.isFinite(containerHeight) || !Number.isFinite(topPad)) return null;
  if (containerHeight <= 0 || topPad <= 0) return null;

  const maxY = containerHeight - minBottomPx;
  if (vehicleScreenY <= maxY) return null;      // zaten ekranda — HU yolu buradan çıkar

  const overflowPx = vehicleScreenY - maxY;
  const next = Math.max(0, topPad - overflowPx * 2);
  // Düzeltme fark yaratmıyorsa ikinci bir jumpTo'ya değmez.
  return next < topPad ? next : null;
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
 * ── KADANSTAN BAĞIMSIZ (bu tur) ─────────────────────────────────────────────
 * Tüm alfalar ve cruise eşiği `dtMs` ile uyarlanır. `dtMs` verilmezse
 * kalibrasyon aralığı varsayılır → çağıranı güncellenmemiş her yol bugünkü
 * davranışı AYNEN sürdürür (geriye dönük uyumlu, fail-soft).
 *
 * @param target            computeCameraTarget çıktısı
 * @param bearingTarget     Turn-anticipated bearing (opsiyonel)
 * @param effectiveSpeedKmh GPS/OBD hız (momentum hesabı için)
 * @param dtMs              Bu çağrı ile bir öncekinin ARASINDAKİ ölçülen süre
 * @returns Güncel smooth state
 */
export function dampCameraToward(
  target: CameraTarget,
  bearingTarget?: number,
  effectiveSpeedKmh?: number,
  dtMs?: number,
): SmoothState {
  const cfg = CAMERA_CFG;
  const spd = effectiveSpeedKmh ?? 0;

  const dt = clampCameraDt(dtMs);
  _lastDtMs = dt;
  _tickCount++;
  if (dt < cfg.CALIBRATION_DT_MS * 0.5 || dt > cfg.CALIBRATION_DT_MS * 2) _offCadenceTicks++;

  // ── Delta-speed computation ──────────────────────────────────────────────
  // Ham delta GPS spikelarını yansıtabilir; EMA ile sönümlüyoruz.
  /* Δt NORMALİZASYONU: ham fark "bu tick'te ne kadar hızlandık"tır ve tick
     süresiyle ölçeklenir — 16 ms'lik bir tickte aynı ivme 150 ms'liğin ~1/9'u
     kadar fark üretir. Momentum katsayıları (`ACC_*`) 150 ms'lik farka göre
     ayarlandığından ham değer KALİBRASYON ARALIĞINA çevrilir; böylece
     hızlanma etkisi tempoya değil GERÇEK İVMEYE bağlı olur. */
  let rawDelta = 0;
  if (_prevEffectiveSpeed >= 0 && effectiveSpeedKmh !== undefined) {
    rawDelta = (spd - _prevEffectiveSpeed) * (cfg.CALIBRATION_DT_MS / dt);
  }
  if (effectiveSpeedKmh !== undefined) _prevEffectiveSpeed = spd;
  _smoothDeltaSpeed += (rawDelta - _smoothDeltaSpeed) * rateAdjustAlpha(cfg.ACC_DELTA_DECAY, dt);

  // ── Cruise detection ─────────────────────────────────────────────────────
  // Sabit hızda kamera kilitlenir; ani transition yok.
  // Ölçüt SÜREdir, tick sayısı değil — bkz. `CRUISE_MIN_MS`.
  if (Math.abs(_smoothDeltaSpeed) < cfg.CRUISE_THRESHOLD_KMH) {
    _cruiseMs = Math.min(_cruiseMs + dt, cfg.CRUISE_MIN_MS + 2 * cfg.CALIBRATION_DT_MS);
  } else {
    _cruiseMs = 0;
  }
  const inCruise = _cruiseMs >= cfg.CRUISE_MIN_MS;

  // ── Adaptive damp alphas (Δt uyarlanmış) ─────────────────────────────────
  const dampZoom  = rateAdjustAlpha(inCruise ? cfg.CRUISE_DAMP_ZOOM  : cfg.DAMP_ZOOM,  dt);
  const dampPitch = rateAdjustAlpha(inCruise ? cfg.CRUISE_DAMP_PITCH : cfg.DAMP_PITCH, dt);

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
  _sm.lookAheadM += (adjLook      - _sm.lookAheadM) * rateAdjustAlpha(cfg.DAMP_LOOK, dt);
  _sm.deltaSpeed  = _smoothDeltaSpeed;

  // ── Bearing EMA — adaptive alpha + low-speed deadzone ───────────────────
  if (bearingTarget !== undefined) {
    const diff = _angleDiff(_sm.bearing, bearingTarget);

    // Deadzone: düşük hızda GPS heading güvenilmez — mikro-titremeleri filtrele
    const inDeadzone =
      spd < cfg.BEARING_DEADZONE_KMH && Math.abs(diff) < cfg.BEARING_DEADZONE_DEG;

    if (!inDeadzone) {
      // Tiered alpha: otoyolda çok stabil, şehirde responsive
      const bearAlpha = rateAdjustAlpha(
        spd < 20 ? cfg.DAMP_BEARING_URBAN :
        spd < 80 ? cfg.DAMP_BEARING_ROAD  :
                   cfg.DAMP_BEARING_HIGHWAY,
        dt,
      );

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

/* ─── Kadans gözlemi (CAROS LAB — salt okunur) ───────────────────────────── */

export interface CameraDampingSnapshot {
  /** Alfaların ölçüldüğü referans tick aralığı (ms). */
  readonly calibrationDtMs: number;
  /** Son çağrıda kullanılan (kırpılmış) Δt — `null` = hiç çağrılmadı. */
  readonly lastDtMs: number | null;
  /** Toplam sönümleme çağrısı. */
  readonly tickCount: number;
  /** Δt'nin kalibrasyonun 0,5×–2× bandı DIŞINDA kaldığı çağrı sayısı.
   *  Sıfırdan büyükse üründe kalibre olmayan bir kamera temposu VARDIR. */
  readonly offCadenceTicks: number;
  /** Son Δt'de pitch sönümlemesinin GERÇEK zaman sabiti (sn) — `null` = ölçüm yok.
   *  Tempo ne olursa olsun bu değerin kalibrasyon τ'suna yakın kalması,
   *  uyarlamanın çalıştığının doğrudan kanıtıdır. */
  readonly effectivePitchTauSec: number | null;
  /** Kalibrasyon temposundaki pitch zaman sabiti (sn) — karşılaştırma çıpası. */
  readonly calibrationPitchTauSec: number;
  /** Kesintisiz sabit-hız süresi (ms) ve seyir kilidi durumu. */
  readonly cruiseMs: number;
  readonly inCruise: boolean;
}

/** τ = −Δt / ln(1 − α) — saniye cinsinden. */
function _tauSec(alpha: number, dtMs: number): number {
  if (!(alpha > 0) || alpha >= 1) return 0;
  return (dtMs / 1000) / -Math.log(1 - alpha);
}

/**
 * Senkron okuma — CAROS LAB için. Harita nesnesi, koordinat veya rota TAŞIMAZ.
 * Değerler GERÇEK `dampCameraToward` çağrılarından gelir; sabit/uydurma yok.
 */
export function getCameraDampingSnapshot(): CameraDampingSnapshot {
  const cfg = CAMERA_CFG;
  return {
    calibrationDtMs: cfg.CALIBRATION_DT_MS,
    lastDtMs: _lastDtMs,
    tickCount: _tickCount,
    offCadenceTicks: _offCadenceTicks,
    effectivePitchTauSec: _lastDtMs === null
      ? null
      : Number(_tauSec(rateAdjustAlpha(cfg.DAMP_PITCH, _lastDtMs), _lastDtMs).toFixed(3)),
    calibrationPitchTauSec: Number(_tauSec(cfg.DAMP_PITCH, cfg.CALIBRATION_DT_MS).toFixed(3)),
    cruiseMs: Math.round(_cruiseMs),
    inCruise: _cruiseMs >= cfg.CRUISE_MIN_MS,
  };
}

/** @internal — testler arası izolasyon (sayaçlar dahil). */
export function _resetCameraDampingCountersForTest(): void {
  _lastDtMs = null;
  _tickCount = 0;
  _offCadenceTicks = 0;
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
