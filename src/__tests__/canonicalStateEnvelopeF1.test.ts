import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  canReconcile, createCanonicalStateEnvelope, createStateProjection, hydrateState,
  isLiveTruth, isMeasuredZero, isUnavailable, isUnknown,
} from '../platform/state/canonicalStateEnvelope';

const base = { provenance: ['owner'], scope: { type: 'VEHICLE_SESSION' as const, id: 'v1' }, nowMs: 1_000, observedAt: 950, freshnessWindowMs: 100 };
const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('ARCH-02/F1 canonical state envelope', () => {
  it('permits CURRENT OBSERVED only with owner live evidence', () => {
    expect(createCanonicalStateEnvelope({ ...base, value: 42, classification: 'OBSERVED', liveEvidence: true }).freshness).toBe('CURRENT');
    expect(createCanonicalStateEnvelope({ ...base, value: 42, classification: 'OBSERVED' }).freshness).toBe('UNKNOWN');
  });
  it('never promotes cached, replayed, imported, or hydrated state to live truth', () => {
    for (const classification of ['CACHED', 'REPLAYED', 'IMPORTED'] as const) {
      const envelope = createCanonicalStateEnvelope({ ...base, value: 42, classification });
      expect(envelope.freshness).toBe('STALE');
      expect(isLiveTruth(envelope)).toBe(false);
    }
    expect(hydrateState({ ...base, value: 0 }).classification).toBe('CACHED');
    expect(hydrateState({ ...base, value: 0 }).freshness).not.toBe('CURRENT');
  });
  it('keeps declared facts separate from observed vehicle facts and distinguishes unknown from zero', () => {
    const declared = createCanonicalStateEnvelope({ ...base, value: 0, classification: 'DECLARED' });
    const unknown = createCanonicalStateEnvelope({ ...base, value: null, classification: 'UNKNOWN', observedAt: null });
    expect(isLiveTruth(declared)).toBe(false);
    expect(isMeasuredZero(declared.value)).toBe(true);
    expect(isMeasuredZero(unknown.value)).toBe(false);
    expect(isUnknown(unknown)).toBe(true);
  });
  it('rejects epoch and scope mismatch as stale while preserving unavailable separately', () => {
    expect(createCanonicalStateEnvelope({ ...base, value: 1, classification: 'DERIVED', epoch: 3, expectedEpoch: 4 }).freshness).toBe('STALE');
    expect(createCanonicalStateEnvelope({ ...base, value: 1, classification: 'DERIVED', expectedScope: { type: 'MEDIA_SESSION', id: 'm1' } }).freshness).toBe('STALE');
    const unavailable = createCanonicalStateEnvelope({ ...base, value: null, classification: 'DERIVED', evidenceState: 'UNAVAILABLE' });
    expect(isUnavailable(unavailable)).toBe(true);
    expect(isUnknown(unavailable)).toBe(false);
  });
  it('requires defined desired and observed inputs before reconciliation and exposes read-only projections', () => {
    const desired = createCanonicalStateEnvelope({ ...base, value: 'request', classification: 'DECLARED' });
    const observed = createCanonicalStateEnvelope({ ...base, value: 'native', classification: 'OBSERVED', liveEvidence: true, sourceRef: 'native-media' });
    expect(canReconcile({ desired, observed, reconciled: null })).toBe(true);
    expect(canReconcile({ desired, observed: null, reconciled: null })).toBe(false);
    const projection = createStateProjection(observed);
    expect(projection.kind).toBe('STATE_PROJECTION');
    expect(Object.isFrozen(projection)).toBe(true);
  });
  it('is deterministic and has no clock, randomness, mutation, or store dependency', () => {
    const a = createCanonicalStateEnvelope({ ...base, value: 7, classification: 'OBSERVED', liveEvidence: true });
    const b = createCanonicalStateEnvelope({ ...base, value: 7, classification: 'OBSERVED', liveEvidence: true });
    expect(a).toEqual(b);
    const src = read('src/platform/state/canonicalStateEnvelope.ts');
    expect(src).not.toContain('Date.now');
    expect(src).not.toContain('Math.random');
    expect(src).not.toContain('zustand');
  });
  it('keeps existing domain owners singular and forbids legacy writable registration patterns', () => {
    const gps = read('src/platform/gpsService.ts');
    const vdl = read('src/platform/vehicleDataLayer/UnifiedVehicleStore.ts');
    const navigation = read('src/platform/navigationService.ts');
    const mediaRuntime = read('src/platform/media/authority/mediaAuthorityRuntime.ts');
    const boot = read('src/platform/system/SystemBoot.ts');
    const companion = read('src/platform/companion/companionSessionManager.ts');
    const mavi = read('src/platform/maviCore/maviLifecycle.ts');
    expect(gps).toContain('useUnifiedVehicleStore.getState().updateGPSState');
    expect(vdl).toContain('updateVehicleState(patch)');
    expect(navigation).toContain('const useNavigationStore = create<NavigationStore>');
    expect(mediaRuntime).toContain('_unsubscribe = native.subscribe');
    expect(boot).toContain("this._regNamed('NavigationSessionRuntime', startNavigationSessionRuntime());");
    expect(boot).toContain("this._regNamed('media-authority', stopMediaAuthority)");
    expect(companion).toContain('expectedGeneration !== this._session.generation');
    expect(mavi).toContain("'stale_generation'");
  });
});
