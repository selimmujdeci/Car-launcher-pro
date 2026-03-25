/**
 * Device Performance Detection
 *
 * Auto-detect device capabilities and suggest appropriate performance mode.
 * Does NOT force changes, only provides recommendations.
 */

import type { PerformanceMode } from './performanceMode';

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
  // CPU cores — most reliable indicator
  const cores = navigator.hardwareConcurrency ?? 2;

  // RAM estimation (deviceMemory is deprecated but still available in some browsers)
  const navMemory = (navigator as any).deviceMemory ?? 4; // GB
  const memory = Math.max(512, navMemory * 1024); // Convert to MB, min 512

  // Mobile detection (heuristic)
  const isLowEnd = window.innerWidth < 768 || /mobile|android|iphone|ipad|phone/i.test(
    navigator.userAgent.toLowerCase(),
  );

  // WebGL support
  const canvas = document.createElement('canvas');
  const supportsWebGL = !!canvas.getContext('webgl') || !!canvas.getContext('webgl2');

  // CSS Backdrop filter support
  const div = document.createElement('div');
  div.style.backdropFilter = 'blur(1px)';
  const supportsBackdropFilter = div.style.backdropFilter !== '';

  return {
    cores,
    memory,
    isLowEnd,
    supportsWebGL,
    supportsBackdropFilter,
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
export function suggestPerformanceMode(cap: DeviceCapabilities): PerformanceMode {
  // GPU check: if no graphics support, always recommend lite
  if (!cap.supportsWebGL || !cap.supportsBackdropFilter) {
    return 'lite';
  }

  // Low-end device or very limited resources
  if (cap.isLowEnd || cap.cores < 2 || cap.memory < 512) {
    return 'lite';
  }

  // High-end device
  if (cap.cores > 4 && cap.memory > 2048) {
    return 'premium';
  }

  // Default: balanced for most devices
  return 'balanced';
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
