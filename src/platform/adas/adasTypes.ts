/**
 * adasTypes.ts — Sürüş Asistanı (ADAS) tip sözlüğü. Runtime değer üretmez.
 *
 * ── KOORDİNAT SÖZLEŞMESİ ────────────────────────────────────────────────────
 * ADAS katmanındaki TÜM görüntü koordinatları NORMALİZE'dir: x ∈ [0,1] (soldan
 * sağa), y ∈ [0,1] (yukarıdan aşağı). Kaynak (şerit worker'ı 320×180, dedektör
 * 480×270, USB kamera 1280×720…) ne olursa olsun karar mantığı aynı sayılarla
 * çalışır. Piksel ↔ metre dönüşümü yalnız `adasGeometry`'de, en-boy oranı
 * (`aspect` = genişlik/yükseklik) açıkça verilerek yapılır.
 *
 * ── YETKİ SINIRI ────────────────────────────────────────────────────────────
 * ADAS YALNIZ UYARIR. Direksiyon, fren, gaz veya herhangi bir araç aktüatörüne
 * yol YOKTUR (Mavi spesifikasyonu K3 / madde 10). Bu tipler bir komut taşımaz.
 */

/** Normalize nokta. */
export interface NormPoint { readonly x: number; readonly y: number }

/** Normalize doğru parçası (şerit çizgisi). */
export interface NormLine {
  readonly x1: number; readonly y1: number;
  readonly x2: number; readonly y2: number;
  /** 0–1, tespit güveni. */
  readonly confidence: number;
}

/** Bir karedeki şerit gözlemi (normalize). */
export interface LaneObservation {
  readonly left: NormLine | null;
  readonly right: NormLine | null;
}

/** Normalize kutu (sol-üst + boyut). */
export interface NormBox { readonly x: number; readonly y: number; readonly w: number; readonly h: number }

export type DetectionClass = 'car' | 'truck' | 'bus' | 'motorcycle';

/** Dedektörün bulduğu nesne (normalize). */
export interface VehicleDetection {
  readonly box: NormBox;
  readonly score: number;
  readonly cls: DetectionClass;
}

/** Sinyal lambası durumu — `unknown`: araç bu sinyali vermiyor/profil çözmüyor. */
export type TurnSignal = 'left' | 'right' | 'none' | 'unknown';

/** Hassasiyet — uyarının ne kadar erken geleceği. */
export type AdasSensitivity = 'early' | 'normal' | 'late';

/**
 * Kamera kalibrasyonu (normalize). `null` alanlar henüz ÖĞRENİLMEDİ demektir;
 * ADAS öğrenilmemiş değeri varsayımla doldurmaz.
 */
export interface AdasCalibration {
  /** Ufuk çizgisi (kaybolma noktası) y'si. */
  readonly horizonY: number;
  /** Kaybolma noktasının x'i — aracın merkez hattı ufukta buraya yakınsar. */
  readonly vanishX: number;
  /** Aracın merkez hattının referans satırdaki x'i (montaj kayması dahil). */
  readonly centerX: number;
  /** Referans satırda (y = LANE_REF_Y) tipik şerit genişliği (normalize). */
  readonly laneWidthAtRef: number;
  /** Öğrenmede kullanılan örnek sayısı. */
  readonly samples: number;
  /** Öğrenmenin tamamlandığı an (duvar saati, ms). */
  readonly learnedAtMs: number;
  /** Hangi kameraya ait (deviceId ya da 'auto'). Kamera değişirse geçersiz. */
  readonly cameraKey: string;
  /** auto: sürüşte şeritlerden öğrenildi · manual: kullanıcı park hâlinde hizaladı. */
  readonly source: 'auto' | 'manual';
}

/** Kullanıcı ayarları (settings.adas). */
export interface AdasSettings {
  /** Ana anahtar — varsayılan KAPALI. */
  readonly enabled: boolean;
  /** Sınırlamalar metni kabul edildi mi (ilk açılışta). */
  readonly consentAtMs: number | null;
  readonly ldw: boolean;
  readonly fcw: boolean;
  readonly headway: boolean;
  readonly leadDeparture: boolean;
  readonly sensitivity: AdasSensitivity;
  /** Yol kamerası; `null` = otomatik (USB kamera varsa o, yoksa arka kamera). */
  readonly cameraDeviceId: string | null;
  /** Kameranın yoldan yüksekliği (m) — mesafe tahmini için. */
  readonly cameraHeightM: number;
  /** Yatay görüş açısı (°). */
  readonly hfovDeg: number;
  /** Öğrenilmiş kalibrasyon; yoksa `null`. */
  readonly calibration: AdasCalibration | null;
}

export const DEFAULT_ADAS_SETTINGS: AdasSettings = {
  enabled: false,
  consentAtMs: null,
  ldw: true,
  fcw: true,
  headway: true,
  leadDeparture: true,
  sensitivity: 'normal',
  cameraDeviceId: null,
  cameraHeightM: 1.3,
  hfovDeg: 70,
  calibration: null,
};

/** Özellik başına durum. */
export type AdasFeature = 'ldw' | 'fcw' | 'headway' | 'leadDeparture';

/**
 * READY       — şu an uyarı verebilir.
 * STANDBY     — çalışıyor ama koşul yok (ör. hız eşiğin altında) — normal.
 * CALIBRATING — kamera öğreniliyor; uyarı YOK.
 * UNAVAILABLE — bir engel var (kamera yok, görüş düşük, işlemci yavaş…).
 * OFF         — kullanıcı kapattı.
 */
export type AdasFeatureState = 'READY' | 'STANDBY' | 'CALIBRATING' | 'UNAVAILABLE' | 'OFF';

export type AdasReason =
  | 'DISABLED'
  | 'NO_CONSENT'
  | 'NO_CAMERA'
  | 'CAMERA_DENIED'
  | 'CAMERA_ERROR'
  | 'CAMERA_STALLED'
  | 'CALIBRATING'
  | 'LOW_VISIBILITY'
  | 'SPEED_UNKNOWN'
  | 'BELOW_SPEED'
  | 'SYSTEM_PROTECTION'
  | 'DETECTOR_LOADING'
  | 'DETECTOR_UNAVAILABLE'
  | 'DETECTOR_TOO_SLOW'
  | 'REVERSE';

export interface AdasFeatureStatus {
  readonly feature: AdasFeature;
  readonly state: AdasFeatureState;
  readonly reason: AdasReason | null;
}

/** Güvenlik asistanına giden uyarı sinyali (tek otorite: adasRuntime). */
export interface AdasWarningSignal {
  readonly lane: 'left' | 'right' | null;
  readonly forward: 'collision' | 'headway' | null;
  readonly leadDeparted: boolean;
  /** Sinyalin üretildiği an (performance.now) — bayatlık kapısı için. */
  readonly atPerfMs: number;
}

export const NO_ADAS_WARNING: AdasWarningSignal = {
  lane: null, forward: null, leadDeparted: false, atPerfMs: 0,
};
