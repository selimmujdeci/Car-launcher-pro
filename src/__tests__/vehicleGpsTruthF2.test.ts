import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createCanonicalStateEnvelope, hydrateState, isLiveTruth, isMeasuredZero } from '../platform/state/canonicalStateEnvelope';
import { isCurrentGPSObservation } from '../platform/gpsService';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');
const input = (value: { latitude: number; longitude: number; heading?: number; accuracy: number }) => ({
  value, classification: 'OBSERVED' as const, provenance: ['native', 'gpsService.handlePosition'],
  scope: { type: 'PROCESS' as const, id: null }, epoch: 4, expectedEpoch: 4,
  sessionId: '4', generation: 4, observedAt: 1_000, nowMs: 1_020,
  freshnessWindowMs: 5_000, liveEvidence: true, sourceRef: 'gps-provider:native', evidenceRef: 'gps:4:1000',
});

describe('ARCH-02/F2 vehicle GPS truth closure', () => {
  it('preserves an atomic fresh live sample, provenance, observedAt, generation, and measured zero axes', () => {
    const envelope = createCanonicalStateEnvelope(input({ latitude: 0, longitude: 0, heading: 0, accuracy: 4 }));
    expect(envelope.classification).toBe('OBSERVED');
    expect(envelope.freshness).toBe('CURRENT');
    expect(envelope.provenance).toContain('gpsService.handlePosition');
    expect(envelope.observedAt).toBe(1_000);
    expect(envelope.generation).toBe(4);
    expect(envelope.value).toEqual({ latitude: 0, longitude: 0, heading: 0, accuracy: 4 });
    expect(isMeasuredZero(envelope.value.latitude)).toBe(true);
    expect(isMeasuredZero(envelope.value.longitude)).toBe(true);
    expect(isMeasuredZero(envelope.value.heading)).toBe(true);
  });
  it('does not promote missing heading or persisted last-known state into current observed truth', () => {
    const missingHeading = createCanonicalStateEnvelope(input({ latitude: 1, longitude: 2, accuracy: 5 }));
    expect(missingHeading.value.heading).toBeUndefined();
    expect(isMeasuredZero(missingHeading.value.heading)).toBe(false);
    const cached = hydrateState({ ...input({ latitude: 1, longitude: 2, accuracy: 5 }), value: { latitude: 1, longitude: 2 }, observedAt: null });
    expect(cached.classification).toBe('CACHED');
    expect(cached.freshness).not.toBe('CURRENT');
    expect(isLiveTruth(cached)).toBe(false);
  });
  it('uses process scope without fabricating a vehicle identity', () => {
    const envelope = createCanonicalStateEnvelope(input({ latitude: 1, longitude: 2, accuracy: 5 }));
    expect(envelope.scope).toEqual({ type: 'PROCESS', id: null });
  });
  it('keeps source evidence private and VDL as the only consumer projection', () => {
    const gps = read('src/platform/gpsService.ts');
    const vdl = read('src/platform/vehicleDataLayer/UnifiedVehicleStore.ts');
    const nav = read('src/platform/navigationService.ts');
    expect(gps).toContain('const useGPSStore = create<GPSState>');
    expect(gps).not.toContain('export { useGPSStore');
    expect(gps).toContain('useUnifiedVehicleStore.getState().updateGPSState');
    expect(gps).toContain('return useUnifiedVehicleStore((s) => s.location)');
    expect(gps).toContain('return useUnifiedVehicleStore.getState().gpsLocationEnvelope');
    expect(vdl).toContain('gpsLocationEnvelope: CanonicalStateEnvelope<GPSLocation | null> | null');
    expect(nav).toContain('useUnifiedVehicleStore.getState().location');
  });
  it('has explicit generation and same-generation timestamp rejection before live ingress', () => {
    const gps = read('src/platform/gpsService.ts');
    expect(gps).toContain('const generation = ++_gpsGeneration');
    expect(gps).toContain('_gpsGeneration++');
    expect(gps).toContain('isCurrentGPSObservation(expectedGeneration, _gpsGeneration, timestamp, _lastAcceptedTimestamp)');
    expect(gps).toContain('_lastAcceptedTimestamp = -Infinity');
  });
  it('rejects stale callbacks and same-session duplicate/out-of-order samples without carrying a timestamp floor into a new generation', () => {
    expect(isCurrentGPSObservation(3, 4, 10, -Infinity)).toBe(false);
    expect(isCurrentGPSObservation(4, 4, 10, 11)).toBe(false);
    expect(isCurrentGPSObservation(4, 4, 11, 11)).toBe(false);
    expect(isCurrentGPSObservation(4, 4, 12, 11)).toBe(true);
    // A newly started session deliberately resets its floor to -Infinity.
    expect(isCurrentGPSObservation(5, 5, 2, -Infinity)).toBe(true);
  });
  it('keeps tracking separate from a live fix, vehicle movement, and navigation readiness', () => {
    const trackingWithoutFix = { isTracking: true, location: null };
    expect(trackingWithoutFix.location).toBeNull();
    const gps = read('src/platform/gpsService.ts');
    expect(gps).toContain('useGPSStore.setState({ isTracking: false, location: null, error: null })');
    expect(gps).not.toContain('navigationReady: true');
    expect(gps).not.toContain('verifiedVehicleSpeed:');
  });
  it('does not expose GPS source state as an externally writable consumer store', () => {
    const gps = read('src/platform/gpsService.ts');
    expect(gps).not.toMatch(/export\s+(?:const|let|\{[^}]*\})\s+useGPSStore/);
    expect(gps).not.toContain('export const setGPSLocation');
    expect(gps).not.toContain('export function setGPSLocation');
  });
  it('keeps legacy VDL fields derived in the same source-to-VDL transaction as the envelope', () => {
    const gps = read('src/platform/gpsService.ts');
    const vdl = read('src/platform/vehicleDataLayer/UnifiedVehicleStore.ts');
    const subscription = gps.slice(gps.indexOf('useGPSStore.subscribe'), gps.indexOf('let watchId'));
    expect(subscription).toContain('location:    eff.location');
    expect(subscription).toContain('heading:     eff.heading');
    expect(subscription).toContain('source:      eff.source');
    expect(subscription).toContain('locationEnvelope: _lastLocationEnvelope');
    expect(vdl).toContain("if ('locationEnvelope' in gpsPatch");
    expect(vdl).toContain("if ('location' in gpsPatch");
    expect(vdl).toContain("if ('heading' in gpsPatch");
  });
  it('renders a privacy-safe, read-only LAB truth card without GPS control actions', () => {
    const lab = read('src/components/devtools/screens/LocationEngineScreen.tsx');
    expect(lab).toContain('Vehicle Location Truth');
    expect(lab).toContain('gpsService → VDL → consumers');
    expect(lab).toContain('Canonical Owner');
    expect(lab).toContain('Stale Generation Rejects');
    expect(lab).toContain('Out-of-order Rejects');
    expect(lab).not.toContain('startGPSTracking(');
    expect(lab).not.toContain('stopGPSTracking(');
    expect(lab).not.toContain('setGPSLocation(');
    expect(lab).not.toContain('latitude}');
    expect(lab).not.toContain('longitude}');
  });
  it('does not make GPS speed a verified VDL speed writer or use a second freshness engine', () => {
    const vdl = read('src/platform/vehicleDataLayer/UnifiedVehicleStore.ts');
    const gps = read('src/platform/gpsService.ts');
    expect(vdl).toContain('GPS hızı KAYBOLMADI: `location.speed`');
    expect(vdl).not.toContain('u.speed = gpsPatch');
    expect(gps).toContain('createCanonicalStateEnvelope');
    expect(gps).not.toContain('createRuntimeEvidenceEnvelope');
  });
  it('rejects an incomplete provider sample rather than inventing a zero coordinate or synthetic accuracy', () => {
    const gps = read('src/platform/gpsService.ts');
    expect(gps).toContain('!Number.isFinite(coords.accuracy)');
    expect(gps).not.toContain('accuracy:  Number.isFinite(coords.accuracy) ? coords.accuracy : 999');
    expect(gps).toContain('accuracy:  coords.accuracy');
  });
  it('requires native background observation time and generation, then routes it through the same canonical gate', () => {
    const gps = read('src/platform/gpsService.ts');
    const background = gps.slice(gps.indexOf('export function feedBackgroundLocation'), gps.indexOf('/* ── Dead Reckoning'));
    expect(background).toContain('observationTimestamp: number');
    expect(background).toContain('gpsGeneration: number');
    expect(background).toContain('data.observationTimestamp');
    expect(background).toContain('data.gpsGeneration');
    expect(background).not.toContain('Date.now()');
    expect(background).toContain('data.gpsGeneration,');
  });
  it('preserves Android Location observation time and the JS-bound generation across the native plugin contract', () => {
    const service = read('android/app/src/main/java/com/cockpitos/pro/CarLauncherForegroundService.java');
    const plugin = read('android/app/src/main/java/com/cockpitos/pro/CarLauncherPlugin.java');
    expect(service).toContain('loc.getTime(), sGpsGeneration');
    expect(service).toContain('setGpsGeneration(long generation)');
    expect(plugin).toContain('d.put("observationTimestamp", observationTimestampMs)');
    expect(plugin).toContain('d.put("gpsGeneration", callbackGeneration)');
    expect(plugin).toContain('setBackgroundGpsGeneration');
  });
});
