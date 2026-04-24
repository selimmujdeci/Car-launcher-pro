export const DEBUG_ENABLED =
  import.meta.env.DEV || import.meta.env.VITE_ENABLE_DEBUG_PANEL === 'true';

export { useDebugStore } from './debugStore';
export type {
  SignalSource,
  CanRawEntry,
  ReverseLogEntry,
  ErrorEntry,
  PerfStats,
  FallbackStatus,
  LiveSignal,
  CanExtras,
} from './debugStore';

import { useDebugStore, _incCan, _incObd, _incGps } from './debugStore';
import type { SignalSource, CanExtras } from './debugStore';

// ── CAN raw frame push ──────────────────────────────────────────────────────
export function dbgPushCanRaw(signals: Record<string, unknown>): void {
  if (!DEBUG_ENABLED) return;
  const now = Date.now();
  _incCan(now);
  const payload = Object.entries(signals)
    .filter(([, v]) => v != null)
    .map(([k, v]) => `${k}=${String(v)}`)
    .join('  ');
  useDebugStore.getState().pushCanRaw({ ts: now, frameId: 'CAN', payload });
}

// ── OBD / GPS event counters ────────────────────────────────────────────────
export function dbgIncObd(): void {
  if (!DEBUG_ENABLED) return;
  _incObd(Date.now());
}

export function dbgIncGps(): void {
  if (!DEBUG_ENABLED) return;
  _incGps(Date.now());
}

// ── Reverse decision log ────────────────────────────────────────────────────
export function dbgPushReverse(
  source: 'CAN' | 'OBD',
  value: boolean,
  speed: number,
  guardResult: 'accepted' | 'rejected',
  reason: string,
): void {
  if (!DEBUG_ENABLED) return;
  useDebugStore.getState().pushReverseLog({
    ts: Date.now(),
    source,
    value,
    speed,
    guardResult,
    reason,
  });
}

// ── Live signal update (speed, fuel, reverse, heading) ─────────────────────
export function dbgUpdateSignal(
  signal: string,
  value: string,
  source: SignalSource,
): void {
  if (!DEBUG_ENABLED) return;
  useDebugStore.getState().updateLiveSignal(signal, value, source);
}

// ── CAN-only extras (doorOpen, headlightsOn, tpms) ─────────────────────────
export function dbgUpdateCanExtras(extras: CanExtras): void {
  if (!DEBUG_ENABLED) return;
  useDebugStore.getState().updateCanExtras(extras);
}

// ── Fallback / source health ────────────────────────────────────────────────
export function dbgUpdateFallback(
  canAlive: boolean,
  obdAlive: boolean,
  gpsAlive: boolean,
  canLastSeen: number,
  obdLastSeen: number,
  gpsLastSeen: number,
): void {
  if (!DEBUG_ENABLED) return;
  const obdFallbackActive = !canAlive && obdAlive;
  const gpsFallbackActive = !canAlive && !obdAlive && gpsAlive;
  const allDead = !canAlive && !obdAlive && !gpsAlive;

  useDebugStore.getState().updateFallback({
    canAlive,
    obdFallbackActive,
    gpsFallbackActive,
    allDead,
    canLastSeen,
    obdLastSeen,
    gpsLastSeen,
  });

  if (allDead) {
    useDebugStore.getState().pushError({
      ts: Date.now(),
      level: 'warn',
      source: 'Resolver',
      message: 'All data sources stale — last known values retained',
    });
  }
}

// ── Performance / listener count ────────────────────────────────────────────
export function dbgUpdateListenerCount(n: number): void {
  if (!DEBUG_ENABLED) return;
  useDebugStore.getState().updatePerf({ listenerCount: n });
}

export function dbgIncrementDropped(source: 'CAN' | 'OBD' | 'GPS'): void {
  if (!DEBUG_ENABLED) return;
  const key =
    source === 'CAN' ? 'canDropped' : source === 'OBD' ? 'obdDropped' : 'gpsDropped';
  const cur = useDebugStore.getState().perf[key];
  useDebugStore.getState().updatePerf({ [key]: cur + 1 });
}

// ── Generic error log ───────────────────────────────────────────────────────
export function dbgPushError(
  level: 'error' | 'warn' | 'info',
  source: string,
  message: string,
): void {
  if (!DEBUG_ENABLED) return;
  useDebugStore.getState().pushError({ ts: Date.now(), level, source, message });
}
