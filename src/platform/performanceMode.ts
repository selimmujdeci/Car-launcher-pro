/**
 * Performance Mode Architecture
 *
 * Three-tier system controlling update frequency and visual effects:
 *  - lite:     Heavy throttling, no animations, minimal recommendations (very low-end devices)
 *  - balanced: Smart throttling, soft animations, contextual recommendations (most users)
 *  - premium:  Full features, smooth animations, rich recommendations (high-end devices)
 *
 * Each mode controls:
 *  - OBD polling frequency
 *  - Theme transition timing
 *  - Recommendation generation triggers
 *  - UI update batching
 *  - GPU effect intensity
 */

export type PerformanceMode = 'lite' | 'balanced' | 'premium';

export interface PerfConfig {
  // OBD polling interval (ms) — how often OBD Service fetches data
  obdPollInterval: number;

  // OBD listener debounce (ms) — minimum time between listener notifications
  obdListenerDebounce: number;

  // Recommendation generation cooldown (ms) — min time between recommendation attempts
  recCooldownMs: number;

  // Dynamic UI transition (ms) — time to switch driving modes
  uiTransitionMs: number;

  // Theme transition (ms) — fade in/out when changing themes
  themeTransitionMs: number;

  // Should GPU effects (glow, blur, float) be enabled?
  enableGPUEffects: boolean;

  // Snapshot rebuild debounce (ms) — batch rapid state changes
  snapshotBounceMs: number;

  // Enable AI recommendation generation at all?
  enableRecommendations: boolean;

  // Storage sync debounce (ms) — batch localStorage writes
  storageSyncDebounceMs: number;
}

const CONFIG: Record<PerformanceMode, PerfConfig> = {
  lite: {
    obdPollInterval: 30_000,       // every 30s
    obdListenerDebounce: 10_000,   // at most every 10s
    recCooldownMs: 5 * 60_000,     // 5 min
    uiTransitionMs: 50,            // very light
    themeTransitionMs: 100,        // very light theme fade
    enableGPUEffects: false,
    snapshotBounceMs: 2000,        // 2s batch window
    enableRecommendations: false,
    storageSyncDebounceMs: 5000,
  },

  balanced: {
    obdPollInterval: 10_000,       // every 10s
    obdListenerDebounce: 5_000,    // at most every 5s
    recCooldownMs: 3 * 60_000,     // 3 min
    uiTransitionMs: 250,           // quick fade
    themeTransitionMs: 300,        // smooth theme fade
    enableGPUEffects: true,
    snapshotBounceMs: 1000,        // 1s batch window
    enableRecommendations: true,
    storageSyncDebounceMs: 3000,
  },

  premium: {
    obdPollInterval: 3_000,        // every 3s
    obdListenerDebounce: 1_000,    // at most every 1s
    recCooldownMs: 60_000,         // 1 min
    uiTransitionMs: 500,           // smooth
    themeTransitionMs: 500,        // rich theme fade
    enableGPUEffects: true,
    snapshotBounceMs: 500,         // 500ms batch window
    enableRecommendations: true,
    storageSyncDebounceMs: 1000,
  },
};

/* ── Runtime mode state ────────────────────────────────── */

const PERF_MODE_KEY = 'cl_performanceMode';

function loadPerformanceMode(): PerformanceMode {
  try {
    // Otomatik mod aktifse donanım tespitine bırak, kayıtlı değeri kullanma
    if (localStorage.getItem('cl_performanceMode_auto') === '1') {
      const cores = navigator.hardwareConcurrency ?? 2;
      const memGb = (navigator as { deviceMemory?: number }).deviceMemory ?? 2;
      const memMb = Math.max(512, memGb * 1024);
      // Aftermarket head unit tuzağı: yüksek RAM ama zayıf CPU.
      // Hem core hem RAM yüksek olmalı; RAM tek başına yeterli değil.
      if (cores > 6 && memMb > 3072) return 'premium';
      if (cores < 2 || memMb < 1024) return 'lite';
      return 'balanced';
    }
    const saved = localStorage.getItem(PERF_MODE_KEY);
    if (saved && (saved === 'lite' || saved === 'balanced' || saved === 'premium')) {
      return saved;
    }
  } catch { /* ignore */ }
  return 'balanced';
}

let _currentMode: PerformanceMode = loadPerformanceMode();
const _modeListeners = new Set<(mode: PerformanceMode) => void>();

export function getPerformanceMode(): PerformanceMode {
  return _currentMode;
}

export function getConfig(): PerfConfig {
  return CONFIG[_currentMode];
}

export function setPerformanceMode(mode: PerformanceMode): void {
  if (_currentMode === mode) return;
  _currentMode = mode;
  try { localStorage.setItem(PERF_MODE_KEY, mode); } catch { /* quota full */ }
  _modeListeners.forEach((fn) => fn(mode));
}

export function onPerformanceModeChange(fn: (mode: PerformanceMode) => void): () => void {
  _modeListeners.add(fn);
  return () => _modeListeners.delete(fn);
}

/**
 * Auto-set performance mode from native device profile.
 * Only applies if the user has NOT manually overridden the mode
 * (i.e. localStorage has no saved value).
 *
 * Mapping:
 *   deviceClass 'low'  → lite
 *   deviceClass 'mid'  → balanced
 *   deviceClass 'high' → premium
 */
export function initFromDeviceProfile(deviceClass: 'low' | 'mid' | 'high'): void {
  // Respect explicit user override
  try {
    if (localStorage.getItem(PERF_MODE_KEY) !== null) return;
  } catch { /* ignore */ }

  const modeMap: Record<'low' | 'mid' | 'high', PerformanceMode> = {
    low:  'lite',
    mid:  'balanced',
    high: 'premium',
  };
  setPerformanceMode(modeMap[deviceClass]);
}

/* ── Otomatik Mod ──────────────────────────────────────── */

const AUTO_KEY = 'cl_performanceMode_auto';

export function isAutoModeEnabled(): boolean {
  try { return localStorage.getItem(AUTO_KEY) === '1'; } catch { return false; }
}

/**
 * Donanım tespitine göre otomatik mod aktifleştir.
 * Manuel override'ı siler — initFromDeviceProfile artık çalışır.
 */
export function enableAutoMode(): PerformanceMode {
  try {
    localStorage.removeItem(PERF_MODE_KEY);
    localStorage.setItem(AUTO_KEY, '1');
  } catch { /* ignore */ }

  // Tarayıcı tarafında donanım tespiti yap
  const cores  = navigator.hardwareConcurrency ?? 2;
  const memGb  = (navigator as { deviceMemory?: number }).deviceMemory ?? 2;
  const memMb  = Math.max(512, memGb * 1024);

  let mode: PerformanceMode = 'balanced';
  if (cores > 4 && memMb > 2048) {
    mode = 'premium';
  } else if (cores < 2 || memMb < 1024) {
    mode = 'lite';
  }

  setPerformanceMode(mode);
  return mode;
}

/** Kullanıcı manuel mod seçtiğinde oto modu iptal et. */
export function disableAutoMode(): void {
  try { localStorage.removeItem(AUTO_KEY); } catch { /* ignore */ }
}
