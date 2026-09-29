/**
 * useVehicleStatusBadge / useGearLabel / useSpeedLimitSign — ana ekran temalarının
 * "Araç Durumu", vites ve hız limiti rozetleri için TEK salt-okur projeksiyon.
 *
 * Eskiden Tesla/Expedition/Horizon kartları sabit "Normal", "D AUTO", "4WD" basıyordu:
 * OBD'siz, araç kapalıyken bile "Normal" görünüyordu (sahte sağlık). Artık:
 *   durum → `useLivingThemeState().veh` (OBD bağlı+taze değilse `obd-offline`)
 *   vites → `UnifiedVehicleStore.canGearPos` → `gearLabel` (kokpitle AYNI hüküm)
 *   limit → `useEffectiveSpeedLimit` (kokpit/mini harita ile AYNI hüküm; sabit "90" UYDURMAYDI)
 * Bilinmeyen vites/limit `null` döner; tüketici rozeti hiç çizmez.
 */
import { useLivingThemeState } from './useLivingThemeState';
import type { VehicleStatus } from '../platform/livingThemeState';
import { useUnifiedVehicleStore } from '../platform/vehicleDataLayer/UnifiedVehicleStore';
import { gearLabel } from '../components/cockpit/cockpitDataModel';
import { useEffectiveSpeedLimit } from '../platform/navigation/useEffectiveSpeedLimit';
import {
  isEffectiveLimitDisplayable, isEffectiveLimitDefinitive,
} from '../platform/navigation/core/vehicleAwareSpeedLimitAuthority';

export type VehicleStatusTone = 'ok' | 'warn' | 'critical' | 'unknown';

export interface VehicleStatusBadge {
  status: VehicleStatus;
  /** Tam etiket (dar olmayan kartlar). */
  label: string;
  /** Kısa etiket (büyük puntolu dar başlıklar). */
  short: string;
  tone: VehicleStatusTone;
}

export const VEHICLE_STATUS_BADGES: Record<VehicleStatus, Omit<VehicleStatusBadge, 'status'>> = {
  normal:        { label: 'Normal',             short: 'Normal',      tone: 'ok' },
  'fuel-low':    { label: 'Yakıt Düşük',        short: 'Yakıt Düşük', tone: 'warn' },
  'temp-high':   { label: 'Motor Isısı Yüksek', short: 'Motor Sıcak', tone: 'critical' },
  'obd-offline': { label: 'OBD Bağlı Değil',    short: 'Veri Yok',    tone: 'unknown' },
};

/** Ton → renk. `ok` ve `unknown` temanın kendi mürekkebini kullanır. */
export function vehicleStatusColor(tone: VehicleStatusTone, ink: string, inkMuted: string): string {
  switch (tone) {
    case 'warn':     return '#f59e0b';
    case 'critical': return '#ef4444';
    case 'unknown':  return inkMuted;
    default:         return ink;
  }
}

export function useVehicleStatusBadge(): VehicleStatusBadge {
  const { veh } = useLivingThemeState();
  return { status: veh, ...(VEHICLE_STATUS_BADGES[veh] ?? VEHICLE_STATUS_BADGES['obd-offline']) };
}

/** Vites rozeti: R / N/P / D — kanıt yoksa `null`. */
export function useGearLabel(): string | null {
  return gearLabel(useUnifiedVehicleStore((s) => s.canGearPos));
}

export interface SpeedLimitSign {
  kmh: number;
  /** false → yalnız yol/muhafazakâr hüküm; levha kesik çerçeveyle çizilir. */
  definitive: boolean;
}

/** Hız limiti levhası — gösterilebilir hüküm yoksa `null` (levha çizilmez). */
export function useSpeedLimitSign(): SpeedLimitSign | null {
  const limit = useEffectiveSpeedLimit();
  if (!isEffectiveLimitDisplayable(limit) || limit.effectiveLimitKmh === null) return null;
  return { kmh: Math.round(limit.effectiveLimitKmh), definitive: isEffectiveLimitDefinitive(limit) };
}
