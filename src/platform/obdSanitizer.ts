import type { NativeOBDData } from './nativePlugin';
import type { OBDData } from './obdTypes';
import { logError } from './crashLogger';

// ── Sensor sanity bounds (ISO 15031-5 §6.3 + SAE J1979) ──────
// Physically impossible readings → ELM327 glitch / adapter failure.
const _BOUNDS = {
  speed:       [0,   300] as const,  // km/h
  rpm:         [0, 8_000] as const,  // RPM — covers all ICE/hybrid
  engineTemp:  [-40, 130] as const,  // °C — NTC sensor range
  fuelLevel:   [0,   100] as const,  // %
} as const;

// RPM jump guard: ELM327 polls every 3s; >5000 RPM change in one cycle
// is impossible in any production engine (max realistic blip: ~2000 RPM/s).
export const RPM_JUMP_LIMIT = 5_000; // RPM/sample

export interface SanitizeResult {
  /** Validated fields ready to merge into state; null = discard entire packet */
  patch: Partial<OBDData> | null;
  /** Updated RPM for jump-guard tracking; caller stores this in _prevRpm */
  nextRpm: number | null;
}

/**
 * Sanitize a raw native OBD packet against ISO 15031-5 physical bounds.
 *
 * Pure — no module-level state mutation.  Caller is responsible for
 * persisting nextRpm between calls to maintain the jump-guard invariant.
 *
 * @param data    Raw native OBD packet (may be partial)
 * @param prevRpm Last accepted RPM value, or null on first packet / after reset
 * @returns       { patch, nextRpm } — patch is null if no valid field found
 */
export function sanitizeNativeOBDPacket(
  data: Partial<NativeOBDData>,
  prevRpm: number | null,
): SanitizeResult {
  // Safety Gate: non-finite veya fiziksel sınırı aşan hız → tüm paketi reddet
  if (data.speed !== undefined && (!Number.isFinite(data.speed) || data.speed > 300)) {
    console.warn('[SafetyGate] Rejected Speed:', data.speed);
    return { patch: null, nextRpm: prevRpm };
  }

  const patch: Partial<OBDData> = {};
  let accepted = false;
  let nextRpm  = prevRpm;

  if (data.speed !== undefined && data.speed >= 0) {
    const [lo, hi] = _BOUNDS.speed;
    if (data.speed <= hi && data.speed >= lo) {
      patch.speed = data.speed;
      accepted = true;
    } else {
      logError('OBD:Sanitize', new Error(`speed=${data.speed} km/h out of bounds [${lo},${hi}]`));
    }
  }

  if (data.rpm !== undefined && data.rpm >= 0) {
    const [lo, hi] = _BOUNDS.rpm;
    const jump = prevRpm !== null ? Math.abs(data.rpm - prevRpm) : 0;
    if (data.rpm >= lo && data.rpm <= hi && jump < RPM_JUMP_LIMIT) {
      patch.rpm = data.rpm;
      nextRpm   = data.rpm;
      accepted  = true;
    } else {
      logError('OBD:Sanitize', new Error(`rpm=${data.rpm} invalid (prev=${prevRpm ?? 'none'}, jump=${jump})`));
    }
  }

  if (data.engineTemp !== undefined && data.engineTemp >= 0) {
    const [lo, hi] = _BOUNDS.engineTemp;
    if (data.engineTemp >= lo && data.engineTemp <= hi) {
      patch.engineTemp = data.engineTemp;
      accepted = true;
    }
  }

  if (data.fuelLevel !== undefined && data.fuelLevel >= 0) {
    const [lo, hi] = _BOUNDS.fuelLevel;
    if (data.fuelLevel >= lo && data.fuelLevel <= hi) {
      patch.fuelLevel = data.fuelLevel;
      accepted = true;
    }
  }

  if (data.headlights !== undefined) {
    patch.headlights = data.headlights;
    accepted = true;
  }

  return { patch: accepted ? patch : null, nextRpm };
}
