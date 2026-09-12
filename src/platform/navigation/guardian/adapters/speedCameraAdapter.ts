/**
 * speedCameraAdapter — GUARDIAN-AI-G11 (Adapter Contracts, Phase 1).
 *
 * Raw platform (hız denetim noktası bildirimi) verisini `SpeedCameraRiskInput`e
 * dönüştürür. GERÇEK IO YOK — raw DI ile gelir (harita/kamera-algılama burada
 * DEĞİL). FAIL-SOFT: zorunlu okuma (id/distanceMeters/confidence) veya `policy`
 * eksik/bozuk → `undefined`; geçersiz `cameraType` → alan DROP (kural event
 * üretmez). Girdi MUTASYONA UĞRATILMAZ; Date.now/random/global YOK.
 */
import type { SpeedCameraRiskInput, SpeedCameraRiskPolicyInput, SpeedCameraType } from '../rules';

const CAMERA_TYPES: ReadonlySet<string> = new Set([
  'fixed_speed', 'average_speed', 'mobile_speed', 'traffic_light', 'combined',
  // 'unspecified': varlık gözlendi, tür belirtilmemiş — 'unknown'dan AYRI (kural dosyası).
  'unspecified', 'unknown',
]);

function isObject<T>(v: T): v is T & Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}
function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0;
}

export interface RawSpeedCameraData {
  id?:              string;
  cameraType?:      SpeedCameraType;
  distanceMeters?:  number;
  confidence?:      number;
  source?:          string;
  policy?:          SpeedCameraRiskPolicyInput;
}

export function adaptSpeedCameraInput(raw: RawSpeedCameraData | undefined): SpeedCameraRiskInput | undefined {
  if (!isObject(raw)) return undefined;

  if (!isNonEmptyString(raw.id)) return undefined;
  if (!isFiniteNumber(raw.distanceMeters) || raw.distanceMeters < 0) return undefined;
  if (!isFiniteNumber(raw.confidence)) return undefined;
  if (!isObject(raw.policy)) return undefined;

  return {
    camera: {
      id:             raw.id,
      cameraType:     (typeof raw.cameraType === 'string' && CAMERA_TYPES.has(raw.cameraType)) ? raw.cameraType : undefined,
      distanceMeters: raw.distanceMeters,
      confidence:     raw.confidence,
      source:         isNonEmptyString(raw.source) ? raw.source : undefined,
    },
    policy: raw.policy,
  };
}
