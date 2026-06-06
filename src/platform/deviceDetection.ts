/**
 * Device Performance Detection
 *
 * Auto-detect device capabilities and suggest appropriate performance mode.
 * Does NOT force changes, only provides recommendations.
 */

import type { PerformanceMode } from './performanceMode';
import { getCapabilities, getDeviceTier } from './deviceCapabilities';

export interface DeviceCapabilities {
  cores: number;           // CPU core count
  memory: number;          // RAM in MB (estimated)
  isLowEnd: boolean;       // Mobile device indicator
  supportsWebGL: boolean;
  supportsBackdropFilter: boolean;
}

/**
 * Detect available device capabilities.
 * Safe — no errors on unsupported APIs, returns sensible defaults.
 */
export function detectDeviceCapabilities(): DeviceCapabilities {
  // TEK kaynak: deviceCapabilities. Eskiden burada ayrı/farklı eşikli probe vardı.
  const c = getCapabilities();
  return {
    cores:                  c.cores,
    memory:                 c.memoryMb,
    isLowEnd:               c.lowEndScreen || getDeviceTier() === 'low',
    supportsWebGL:          c.supportsWebGL,
    supportsBackdropFilter: c.supportsBackdropFilter,
  };
}

/**
 * Suggest a performance mode based on device capabilities.
 * Decision tree:
 *  - Low-end devices or <2 cores or <512MB → lite
 *  - Medium devices (2-4 cores, 512-2GB) → balanced
 *  - High-end devices (>4 cores, >2GB) → premium
 *
 * Also considers GPU support:
 *  - No WebGL or Backdrop Filter → demote to lite
 */
export function suggestPerformanceMode(_cap: DeviceCapabilities): PerformanceMode {
  // TEK kaynak: kanonik DeviceTier (eşik tanımı deviceCapabilities'te).
  // _cap parametresi geriye-uyumluluk için tutuldu (getSuggestionInfo metni için).
  const t = getDeviceTier();
  return t === 'low' ? 'lite' : t === 'high' ? 'premium' : 'balanced';
}

/**
 * Get suggestion info for UI display.
 */
export interface ModeSuggestion {
  suggested: PerformanceMode;
  reason: string;
  icon: string;
}

export function getSuggestionInfo(suggested: PerformanceMode, cap: DeviceCapabilities): ModeSuggestion {
  const reasons: Record<PerformanceMode, string> = {
    lite: `Cihazınız kaynaklar açısından sınırlı. Lite mod en akıcı deneyim sağlar (${cap.cores} çekirdek, ${Math.round(cap.memory / 1024)}MB RAM).`,
    balanced: `Cihazınız Balanced moda ideal. Optimal denge ve performans (${cap.cores} çekirdek, ${Math.round(cap.memory / 1024)}MB RAM).`,
    premium: `Cihazınız yüksek performanslı. Premium mod tüm görsel özellikleri kullanabilir (${cap.cores} çekirdek, ${Math.round(cap.memory / 1024)}MB RAM).`,
  };

  const icons: Record<PerformanceMode, string> = {
    lite: '⚡',
    balanced: '⚙️',
    premium: '🚀',
  };

  return {
    suggested,
    reason: reasons[suggested],
    icon: icons[suggested],
  };
}
