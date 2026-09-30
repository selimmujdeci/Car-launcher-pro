/**
 * adasTypes.ts — ADAS (Sürüş Destek) sözleşme tipleri.
 *
 * KOORDİNAT SÖZLEŞMESİ: tüm görüntü koordinatları NORMALİZEDİR (0..1).
 *   u = x / genişlik (0 sol, 1 sağ) · v = y / yükseklik (0 üst, 1 alt).
 *   Kare en-boy oranı (`aspect` = genişlikPx / yükseklikPx) ayrıca taşınır;
 *   odak uzaklığı GENİŞLİĞE göre normalize edilir (kare piksel varsayımı).
 *
 * SAAT SÖZLEŞMESİ: ADAS zaman damgaları `performance.now()` (monotonik) eksenindedir —
 * Safety kural motoru ve `_vehicleSpeedTs` ile AYNI eksen. `Date.now()` KULLANILMAZ.
 *
 * Bu modül yalnız tip içerir; çalışma zamanı bağımlılığı YOKTUR (worker da import eder).
 */

// ── Kalibrasyon ──────────────────────────────────────────────────────────────

export type AdasCalibrationSource = 'default' | 'auto' | 'manual';

export interface AdasCalibration {
  /** Şema sürümü — kalıcı veri göçü için. */
  version: 1;
  /** Kamera yatay görüş açısı (derece). */
  hfovDeg: number;
  /** Kamera merceğinin yol yüzeyinden yüksekliği (m). */
  cameraHeightM: number;
  /** Ufuk çizgisinin normalize dikey konumu (0 üst · 1 alt). */
  horizonV: number;
  /** Tam ileri yönün normalize sütunu (kamera sapma/yaw açısını taşır; ideal 0.5). */
  forwardU: number;
  /** Kaput çizgisi (v): bu satırın ALTI kendi aracımızdır, algılamaya girmez. */
  hoodV: number;
  /** Kameranın araç orta çizgisine göre yatay kayması (m, + sağ). */
  lateralOffsetM: number;
  /** Kamera ile ön tampon arası boylamsal mesafe (m). */
  bumperOffsetM: number;
  /** Kalibrasyonun kaynağı. `default` metrik mesafe için GÜVENİLMEZ sayılır. */
  source: AdasCalibrationSource;
}

// ── Algılama (worker çıktısı) ────────────────────────────────────────────────

/** Ego şeritteki en yakın araç adayı (normalize bbox). */
export interface AdasVehicleDetection {
  /** Sol kenar (u). */
  u0: number;
  /** Sağ kenar (u). */
  u1: number;
  /** Aracın yola temas ettiği satır — gölge bandının alt kenarı (v). */
  vBottom: number;
  /** Tahmini üst kenar (v) — yalnız çizim içindir, mesafe hesabına girmez. */
  vTop: number;
  /** 0..1 algılama güveni. */
  confidence: number;
}

/** Worker'ın ADAS için ürettiği kare eki. */
export interface AdasFrameDetections {
  /** Ego şeritteki en yakın araç; yoksa null. */
  lead: AdasVehicleDetection | null;
  /** Yol yüzeyi aydınlığı düşük (gece/tünel) — gölge yöntemi güvenilmez. */
  lowLight: boolean;
  /** Yol yüzeyi medyan parlaklığı (0..255). Tanı için. */
  roadLuma: number;
  /** İşlenen karenin en-boy oranı (genişlik / yükseklik). */
  aspect: number;
}

/** Normalize şerit çizgisi (u, v uçları). `vTop < vBottom`. */
export interface AdasLaneLine {
  side: 'left' | 'right';
  uTop: number;
  vTop: number;
  uBottom: number;
  vBottom: number;
  confidence: number;
}

// ── Model çıktıları ──────────────────────────────────────────────────────────

export type AdasSensitivity = 'early' | 'normal' | 'late';

export type AdasTurnSignal = 'left' | 'right' | 'none' | 'unknown';

export interface AdasLeadState {
  /** Tampondan tampona tahmini mesafe (m). Kalibrasyon güvenilmezse null. */
  distanceM: number | null;
  /** Çarpışmaya kalan süre (s). Yaklaşma yoksa null. */
  ttcS: number | null;
  /** Yaklaşma hızı (m/s, + yaklaşıyor). Bilinmiyorsa null. */
  closingMps: number | null;
  /** Takip zaman aralığı (s) = mesafe / ego hız. Bilinmiyorsa null. */
  timeGapS: number | null;
  /** İz ≥ N ardışık karede teyit edildi mi. */
  confirmed: boolean;
  /** 0..1 izleme güveni. */
  confidence: number;
}

export interface AdasLaneState {
  /** Şerit merkezine göre araç ofseti (m, + sağa kaymış). Bilinmiyorsa null. */
  offsetM: number | null;
  /** Şerit genişliği (m). İki çizgi yoksa null. */
  laneWidthM: number | null;
  /** Yanal hız (m/s, + sağa). Bilinmiyorsa null. */
  lateralVelMps: number | null;
  /** Sol/sağ çizgi izleniyor mu. */
  leftTracked: boolean;
  rightTracked: boolean;
}

// ── Kanonik ADAS sinyalleri (Safety köprüsünün okuduğu tek yüzey) ─────────────

/**
 * Tek bir ADAS uyarı sinyali. `ts` son DEĞERLENDİRME anıdır (performance.now);
 * değer ancak `ts` tazeyse anlamlıdır — Safety köprüsü bayat sinyali yok sayar.
 * `epoch`, kamera oturumunu ayırır: eski oturumun sinyali yenisini etkileyemez.
 */
export interface AdasSignal<T> {
  value: T;
  ts: number;
  epoch: number;
}

export interface AdasSignals {
  forwardCollision: AdasSignal<boolean>;
  headway: AdasSignal<boolean>;
  laneDeparture: AdasSignal<'left' | 'right' | null>;
  leadDeparture: AdasSignal<boolean>;
}

// ── Çalışma durumu ───────────────────────────────────────────────────────────

export type AdasStatus =
  | 'off'           // kullanıcı kapalı
  | 'standby'       // açık ama koşul bekliyor (park, hız bilinmiyor, geri vites…)
  | 'starting'      // kamera açılıyor
  | 'calibrating'   // çalışıyor, ufuk kalibrasyonu henüz yakınsamadı
  | 'active'        // tüm özellikler çalışıyor
  | 'degraded'      // çalışıyor ama kısıtlı (düşük ışık, kare donması…)
  | 'unavailable';  // kamera yok / izin yok / seçili kamera takılı değil

export type AdasReason =
  | 'parked'
  | 'no_speed'
  | 'reverse'
  | 'safe_mode'
  | 'no_camera'
  | 'permission_denied'
  | 'camera_missing'
  | 'camera_lost'
  | 'camera_error'
  | 'frozen'
  | 'low_light'
  | 'calibration_pending';

export type AdasCameraKind = 'usb' | 'builtin_back' | 'builtin_front' | 'external' | 'unknown';

export interface AdasCameraInfo {
  deviceId: string;
  label: string;
  kind: AdasCameraKind;
}
