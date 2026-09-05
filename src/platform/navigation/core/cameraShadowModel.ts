/**
 * cameraShadowModel.ts — legacy kamera ile CAM politikasının KARŞILAŞTIRMASI (SAF).
 *
 * SAF: I/O YOK · timer YOK · `Date.now` YOK · Map API YOK · React YOK · global durum YOK.
 *
 * ── NEDEN VAR ───────────────────────────────────────────────────────────────
 * `NAVIGATION_MOTION_CAMERA_P0` turunda versiyonlu `cameraPolicyModel`
 * (`CAM-2026.08.05`) kuruldu ama **kamerayı sürmüyor**: fiilî zoom/pitch hâlâ
 * sahada tek tek ölçülerek ayarlanmış `cameraEngine` eğrilerinden geliyor.
 * O eğrileri ölçüm olmadan devralmak doğrudan regresyondu.
 *
 * Bu dosya devralmanın ÖN KOŞULUNU kurar: iki sonucu **aynı navigasyon
 * oturumunda yan yana** ölçmek. Ürün davranışı DEĞİŞMEZ — politika yalnız
 * GÖLGEDE çalışır ve farkı rapor eder.
 *
 * ── PAZARLIKSIZ ─────────────────────────────────────────────────────────────
 *  · Bu model hiçbir kamera değeri UYGULAMAZ; yalnız iki sayıyı karşılaştırır.
 *  · Koordinat KABUL ETMEZ — girdi yalnız skaler kamera çıktılarıdır.
 *  · Eksik veri UYDURULMAZ: karşılaştırılamayan alan `null` kalır.
 */

import type {
  CameraPolicyDecision, SpeedBand, ManeuverBand, CameraState,
} from './cameraPolicyModel';
import { routineFixMayDriveCamera } from './cameraPolicyModel';

/** Legacy `setDrivingView`in GERÇEKTEN uyguladığı kamera çıktısı. */
export interface LegacyCameraOutcome {
  /** Kamera bu karede UYGULANDI mı (erken dönüldüyse `false`). */
  readonly applied: boolean;
  readonly zoom: number | null;
  readonly pitch: number | null;
  readonly bearing: number | null;
  /**
   * Aracın ekrandaki dikey konumu (üstten oran, 0..1).
   *
   * ⚠️ TÜRETİLMEDİ, **ÖLÇÜLDÜ**: `setDrivingView` çerçeve denetimi için zaten
   * `map.project([lng, lat]).y` hesaplıyor. O ölçüm yeniden kullanılır → gölge
   * katmanı için EK Map API çağrısı YAPILMAZ.
   */
  readonly anchorY: number | null;
  /** Durakta yön/zoom dondurma dalı çalıştı mı. */
  readonly standstillFix: boolean;
  /** Uygulanan ileri bakış (m) — 0 = durakta dondurulmuş. */
  readonly lookAheadM: number | null;
}

/** Gölge değerlendirmesinin bağlamı — koordinat İÇERMEZ. */
export interface CameraShadowContext {
  readonly speedKmh: number;
  /** Sonraki manevraya YOL-BOYU mesafe (m); `null` = bilinmiyor. */
  readonly maneuverAlongM: number | null;
  readonly maneuverDistanceSource: 'ALONG_ROUTE' | 'STRAIGHT_LINE' | 'UNKNOWN';
  /** İşaret hareket durumundan türeyen konum tazeliği (ms). */
  readonly positionAgeMs: number | null;
  /** [0..1] — hareket güveni; heading güveni için vekil. */
  readonly headingConfidence: number | null;
  /** Yön bilgisi gerçek bir ölçümden mi geliyor. */
  readonly headingKnown: boolean;
}

export type ShadowDivergence = 'IDENTICAL' | 'MINOR' | 'MODERATE' | 'MAJOR' | 'UNCOMPARABLE';

export const SHADOW_DIVERGENCE_LABEL: Readonly<Record<ShadowDivergence, string>> = {
  IDENTICAL:    'AYNI',
  MINOR:        'KÜÇÜK FARK',
  MODERATE:     'ORTA FARK',
  MAJOR:        'BÜYÜK FARK',
  UNCOMPARABLE: 'KARŞILAŞTIRILAMADI',
} as const;

/* ── Fark eşikleri ──────────────────────────────────────────────────────────
 * Uydurma değil, mevcut ürün eşiklerinden türetildi:
 *  · `cameraEngine` zoom damping'i kare başına ~0.18 alfa ile çalışır ve
 *    hazard kilidi 0.02–0.10 zoom deltasına izin verir → 0.25 zoom "küçük".
 *  · Pitch eğrisi 20°→47° arası; 5° bir bandın içinde kalan salınımdır.
 *  · `STANDSTILL_BEARING_TOLERANCE_DEG = 15` zaten ürün toleransıdır. */
export const SHADOW_ZOOM_MINOR = 0.25;
export const SHADOW_ZOOM_MAJOR = 1.0;
export const SHADOW_PITCH_MINOR = 5;
export const SHADOW_PITCH_MAJOR = 15;
export const SHADOW_ANCHOR_MINOR = 0.05;
export const SHADOW_ANCHOR_MAJOR = 0.15;
export const SHADOW_BEARING_MAJOR = 15;

export interface CameraShadowComparison {
  readonly divergence: ShadowDivergence;
  /** `policy − legacy`; `null` = karşılaştırılamadı. */
  readonly zoomDelta: number | null;
  readonly pitchDelta: number | null;
  readonly bearingDelta: number | null;
  readonly anchorYDelta: number | null;
  readonly legacyApplied: boolean;
  readonly policyAllowed: boolean;
  readonly cameraState: CameraState;
  readonly speedBand: SpeedBand;
  readonly maneuverBand: ManeuverBand;
  readonly speedKmh: number;
  readonly maneuverAlongM: number | null;
  readonly positionAgeMs: number | null;
  readonly headingConfidence: number | null;
  readonly headingKnown: boolean;
  /** Politika kamerayı sürmediyse NEDEN. `null` = bastırma yok. */
  readonly suppressionReason: string | null;
  readonly reason: string;
}

/** İki bearing arasındaki en kısa açısal fark (−180..180]. */
export function bearingDelta(a: number, b: number): number {
  return ((((b - a + 180) % 360) + 360) % 360) - 180;
}

function _delta(a: number | null, b: number | null): number | null {
  if (a === null || b === null || !Number.isFinite(a) || !Number.isFinite(b)) return null;
  return b - a;
}

/**
 * Politikanın `anchorY` önerisi — legacy'nin ÖLÇÜLEN `anchorY`si ile
 * karşılaştırılabilir tek büyüklüktür. Politika zoom/pitch ÖNERMEZ (bu turda
 * eğri devralınmadı), bu yüzden o iki delta `null` kalır ve bu DÜRÜSTÇE
 * raporlanır — uydurma bir "politika zoom'u" üretmek karşılaştırmayı çürütürdü.
 */
export function compareCameraOutcome(
  legacy: LegacyCameraOutcome,
  policy: CameraPolicyDecision,
  ctx: CameraShadowContext,
): CameraShadowComparison {
  const anchorYDelta = _delta(legacy.anchorY, policy.anchorY);
  /* KARŞILAŞTIRILABİLİR izdüşüm — `canDriveCamera()` ile AYNI soruyu sorar
     (`cameraPolicyModel` §SORUMLULUK SINIRI). Ham `cameraDriveAllowed` ile
     kıyaslamak `RECENTERING` penceresinde SAHTE ayrışma üretiyordu: orada
     kamerayı ortalama işlemi sürer, rutin fix değil — legacy HAKLI olarak
     erken döner, politika da HAKLI olarak "sistem sürüyor" der. */
  const policyRoutineAllowed = routineFixMayDriveCamera(policy);
  const suppressionReason = policyRoutineAllowed ? null : policy.updateReason;

  const base = {
    /* Politika bu turda zoom/pitch/bearing ÖNERMİYOR (eğriler devralınmadı) →
       o deltalar `null`. Sahte sıfır raporlamak "fark yok" yanılgısı üretirdi. */
    zoomDelta: null,
    pitchDelta: null,
    bearingDelta: null,
    anchorYDelta,
    legacyApplied: legacy.applied,
    policyAllowed: policyRoutineAllowed,
    cameraState: policy.state,
    speedBand: policy.speedBand,
    maneuverBand: policy.maneuverBand,
    speedKmh: ctx.speedKmh,
    maneuverAlongM: ctx.maneuverAlongM,
    positionAgeMs: ctx.positionAgeMs,
    headingConfidence: ctx.headingConfidence,
    headingKnown: ctx.headingKnown,
    suppressionReason,
  } as const;

  /* ── Karar uyumu ────────────────────────────────────────────────────────
   * En anlamlı karşılaştırma bu turda SAYI değil KARARdır: legacy kamerayı
   * sürdü mü, politika sürmesine izin verir miydi? Ayrışma burada ürünün
   * gerçekten farklı davranacağı yeri işaret eder. */
  if (legacy.applied !== policyRoutineAllowed) {
    return {
      ...base,
      divergence: 'MAJOR',
      reason: legacy.applied
        ? 'legacy kamerayı SÜRDÜ, politika BASTIRIRDI'
        : 'legacy erken döndü, politika SÜRMEYE izin verirdi',
    };
  }

  if (anchorYDelta === null) {
    return { ...base, divergence: 'UNCOMPARABLE', reason: 'legacy çapası ölçülemedi' };
  }

  const a = Math.abs(anchorYDelta);
  if (a === 0) return { ...base, divergence: 'IDENTICAL', reason: 'çapa birebir aynı' };
  if (a < SHADOW_ANCHOR_MINOR) {
    return { ...base, divergence: 'MINOR', reason: `çapa farkı ${a.toFixed(3)} — bant içi` };
  }
  if (a < SHADOW_ANCHOR_MAJOR) {
    return { ...base, divergence: 'MODERATE', reason: `çapa farkı ${a.toFixed(3)}` };
  }
  return { ...base, divergence: 'MAJOR', reason: `çapa farkı ${a.toFixed(3)} — ekranın %15'inden fazla` };
}

/**
 * İki ardışık karşılaştırma FİİLEN aynı mı — "eşdeğer güncelleme" sayacı için.
 *
 * Aynı karar + aynı bantlar + kayda değer olmayan çapa farkı = kameranın
 * yeniden sürülmesi GEREKMEYEN bir güncelleme. Bu sayaç, eğri devralındığında
 * ne kadar iş tasarrufu olacağının kanıtıdır.
 */
export function isEquivalentUpdate(
  prev: CameraShadowComparison | null,
  next: CameraShadowComparison,
): boolean {
  if (!prev) return false;
  if (prev.cameraState !== next.cameraState) return false;
  if (prev.speedBand !== next.speedBand) return false;
  if (prev.maneuverBand !== next.maneuverBand) return false;
  if (prev.legacyApplied !== next.legacyApplied) return false;
  const pa = prev.anchorYDelta, na = next.anchorYDelta;
  if (pa === null || na === null) return pa === na;
  return Math.abs(pa - na) < 0.005;
}
