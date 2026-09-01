import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { hydrateState, isLiveTruth } from '../platform/state/canonicalStateEnvelope';
import { getVDLHydrationDiagnostics } from '../platform/vehicleDataLayer/UnifiedVehicleStore';

const source = readFileSync(resolve(process.cwd(), 'src/platform/vehicleDataLayer/UnifiedVehicleStore.ts'), 'utf8');

describe('ARCH-02/F3-A · VDL hydration truth boundary', () => {
  it('persists only the persistence-native odometer; live telemetry and GPS state are excluded', () => {
    const persist = source.slice(source.indexOf('name:       VDL_PERSISTENCE_KEY'));
    expect(persist).toContain('partialize: (s) => ({ odometer: s.odometer })');
    for (const field of ['speed:', 'rpm:', 'fuel:', 'location:', 'heading:', 'gpsTracking:', 'gpsLocationEnvelope:']) {
      expect(persist).not.toContain(field);
    }
  });
  it('treats a hydrated sensor-shaped value as cached non-live evidence, never current observation', () => {
    const cached = hydrateState({ value: 90, provenance: ['safeStorage'], scope: { type: 'PROCESS', id: null }, epoch: null, expectedEpoch: 1, sessionId: null, generation: null, observedAt: null, nowMs: 1 });
    expect(cached.classification).toBe('CACHED');
    expect(cached.freshness).not.toBe('CURRENT');
    expect(isLiveTruth(cached)).toBe(false);
  });
  it('keeps rehydration limited to the odometer flush baseline, without telemetry promotion', () => {
    expect(source).toContain('_lastOdometerFlushKm = state.odometer');
    expect(source).not.toContain('state.speed');
    expect(source).not.toContain('state.location');
  });
  it('projects the real one-field policy as immutable, non-live hydration evidence', () => {
    const d = getVDLHydrationDiagnostics();
    expect(d.storeKey).toBe('car-launcher-vehicle-state');
    expect(d.persistedFields).toEqual(['odometer']);
    expect(d.persistedFieldCount).toBe(1);
    expect(d.classification).toBe('CACHED');
    expect(d.freshness).not.toBe('CURRENT');
    expect(d.liveRevalidated).toBe(false);
    expect(d.liveTelemetryPersisted).toBe(false);
    expect(d.gpsTruthPersisted).toBe(false);
    expect(Object.isFrozen(d)).toBe(true);
  });
  it('renders the VDL hydration card without control actions', () => {
    const lab = readFileSync(resolve(process.cwd(), 'src/components/devtools/screens/LocationEngineScreen.tsx'), 'utf8');
    expect(lab).toContain('VDL Persistence / Hydration');
    expect(lab).toContain('getVDLHydrationDiagnostics');
    expect(lab).toContain('Live Telemetry Persisted?');
    expect(lab).not.toContain('forceHydration');
    expect(lab).not.toContain('clearPersistence');
  });
});
