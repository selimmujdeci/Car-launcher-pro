/**
 * motionSafetyPolicy.test.ts — MRI F-03: TEK hareket-güvenliği kararı.
 *
 * Kilitlenen sözleşme:
 *   · `requires_stopped` eylem YALNIZ doğrulanmış `stopped` ile geçer.
 *   · `unknown`/`undefined`/bayat → BLOCK (`motion_unverified`), MOVING sayılmaz,
 *     STOPPED da sayılmaz; hız `null` → 0 sayılmaz.
 *   · Mavi (`evaluateVehicleAction`) ve uzak komut (`commandListener`) aynı
 *     fonksiyonu tüketir → aynı girdi aynı karar.
 */
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';

import {
  judgeMotionSafety, motionVerdictUserMessage, MOTION_STOPPED_MAX_KMH,
} from '../platform/action/motionSafetyPolicy';

describe('judgeMotionSafety — saf karar', () => {
  it('16) politika `any` → hareket kapısı yok (korna/far/kilit gereksiz bozulmaz)', () => {
    expect(judgeMotionSafety('any', { motionState: 'moving', speedKmh: 90 }).allow).toBe(true);
    expect(judgeMotionSafety('any', null).reason).toBe('not_gated');
  });

  it('11) doğrulanmış duruyor → ALLOW', () => {
    const v = judgeMotionSafety('requires_stopped', { motionState: 'stopped', speedKmh: 0, isDriving: false });
    expect(v.allow).toBe(true);
    expect(v.reason).toBe('verified_stopped');
  });

  it('10) taze hız eşik üstü → BLOCK (vehicle_moving) — motionState "stopped" dese bile çelişki kanıttır', () => {
    const v = judgeMotionSafety('requires_stopped', { motionState: 'stopped', speedKmh: MOTION_STOPPED_MAX_KMH + 1 });
    expect(v.allow).toBe(false);
    expect(v.reason).toBe('vehicle_moving');
    expect(v.movingProof).toBe(true);
  });

  it('12) hız null → STOPPED sayılmaz → BLOCK (motion_unverified)', () => {
    const v = judgeMotionSafety('requires_stopped', { motionState: undefined, speedKmh: null });
    expect(v.allow).toBe(false);
    expect(v.reason).toBe('motion_unverified');
    expect(v.movingProof).toBe(false);
  });

  it('13) bayat/bilinmeyen (`unknown`) → STOPPED sayılmaz → BLOCK', () => {
    expect(judgeMotionSafety('requires_stopped', { motionState: 'unknown', speedKmh: 0 }).reason).toBe('motion_unverified');
    expect(judgeMotionSafety('requires_stopped', null).reason).toBe('motion_unverified');
  });

  it('isDriving tek başına hareket kanıtıdır (durma kanıtı değildir)', () => {
    expect(judgeMotionSafety('requires_stopped', { motionState: 'stopped', isDriving: true }).reason).toBe('vehicle_moving');
    expect(judgeMotionSafety('requires_stopped', { motionState: 'unknown', isDriving: false }).reason).toBe('motion_unverified');
  });

  it('kullanıcı mesajı her gerekçe için tanımlı ve tek yerde', () => {
    for (const r of ['not_gated', 'verified_stopped', 'vehicle_moving', 'motion_unverified'] as const) {
      expect(motionVerdictUserMessage(r).length).toBeGreaterThan(5);
    }
  });
});

/* ── 14/15) Mavi ↔ uzak komut PARİTESİ ───────────────────────────────────── */

vi.mock('../platform/assistant/maviVehicleSnapshotSource', () => ({
  captureMaviVehicleSnapshot: vi.fn(() => ({
    obdSpeedFreshKmh: null, obdConnected: false, obdLastSeenMs: 0, obdFreshWindowMs: 0,
    gpsSpeedMps: null, gpsAccuracyM: null, gpsFixAtMs: null, reverseSignal: false, ignition: 'unknown',
  })),
}));

describe('Mavi ↔ uzak komut aynı hareket kararını verir', () => {
  beforeAll(async () => { await import('../platform/commandListener'); }, 180_000);   // ısınma (bkz. commandListenerValidityMotion)
  beforeEach(() => { vi.resetModules(); });

  async function bothVerdicts(snapshot: Record<string, unknown>) {
    const snap = await import('../platform/assistant/maviVehicleSnapshotSource');
    (snap.captureMaviVehicleSnapshot as unknown as { mockReturnValue: (v: unknown) => void })
      .mockReturnValue(snapshot);
    const { resolveMaviVehicleContext } = await import('../platform/assistant/maviVehicleContext');
    const { judgeMotionSafety } = await import('../platform/action/motionSafetyPolicy');
    const { VEHICLE_ACTIONS } = await import('../platform/action/maviActionAuthority');
    const { remoteCommandMotionPolicy } = await import('../platform/commandListener');

    const ctx = resolveMaviVehicleContext(snap.captureMaviVehicleSnapshot(), Date.now());
    const maviPolicy   = VEHICLE_ACTIONS.HARDWARE_UNLOCK!.motionPolicy;
    const remotePolicy = remoteCommandMotionPolicy('unlock');
    const mavi   = judgeMotionSafety(maviPolicy,   { motionState: ctx.motionState, speedKmh: ctx.speedKmh, isDriving: ctx.isDriving });
    const remote = judgeMotionSafety(remotePolicy, { motionState: ctx.motionState, speedKmh: ctx.speedKmh, isDriving: ctx.isDriving });
    return { maviPolicy, remotePolicy, mavi, remote, ctx };
  }

  it('14) unlock için iki kanal AYNI politikayı (requires_stopped) okur', async () => {
    const r = await bothVerdicts({
      obdSpeedFreshKmh: null, obdConnected: false, obdLastSeenMs: 0, obdFreshWindowMs: 0,
      gpsSpeedMps: null, gpsAccuracyM: null, gpsFixAtMs: null, reverseSignal: false, ignition: 'unknown',
    });
    expect(r.maviPolicy).toBe('requires_stopped');
    expect(r.remotePolicy).toBe('requires_stopped');
  });

  it('15) UNKNOWN (kanıt yok): iki kanal da BLOCK/motion_unverified', async () => {
    const r = await bothVerdicts({
      obdSpeedFreshKmh: null, obdConnected: false, obdLastSeenMs: 0, obdFreshWindowMs: 0,
      gpsSpeedMps: null, gpsAccuracyM: null, gpsFixAtMs: null, reverseSignal: false, ignition: 'unknown',
    });
    expect(r.ctx.motionState).toBe('unknown');
    expect(r.mavi).toEqual(r.remote);
    expect(r.remote.allow).toBe(false);
    expect(r.remote.reason).toBe('motion_unverified');
  });

  it('OBD taze 0 km/h: iki kanal da ALLOW/verified_stopped', async () => {
    const now = Date.now();
    const r = await bothVerdicts({
      obdSpeedFreshKmh: 0, obdConnected: true, obdLastSeenMs: now, obdFreshWindowMs: 10_000,
      gpsSpeedMps: null, gpsAccuracyM: null, gpsFixAtMs: null, reverseSignal: false, ignition: 'on',
    });
    expect(r.ctx.motionState).toBe('stopped');
    expect(r.mavi).toEqual(r.remote);
    expect(r.remote.allow).toBe(true);
  });

  it('GPS 0 km/h (OBD yok): GPS durma kanıtı ÜRETMEZ → iki kanal da BLOCK', async () => {
    const now = Date.now();
    const r = await bothVerdicts({
      obdSpeedFreshKmh: null, obdConnected: false, obdLastSeenMs: 0, obdFreshWindowMs: 0,
      gpsSpeedMps: 0, gpsAccuracyM: 5, gpsFixAtMs: now, reverseSignal: false, ignition: 'unknown',
    });
    expect(r.ctx.motionState).toBe('unknown');
    expect(r.mavi).toEqual(r.remote);
    expect(r.remote.allow).toBe(false);
  });

  it('lock/horn/lights: politika `any` — uzak yol gereksiz yere bozulmaz (Mavi tablosuyla aynı)', async () => {
    const { remoteCommandMotionPolicy } = await import('../platform/commandListener');
    const { VEHICLE_ACTIONS } = await import('../platform/action/maviActionAuthority');
    expect(remoteCommandMotionPolicy('lock')).toBe(VEHICLE_ACTIONS.HARDWARE_LOCK!.motionPolicy);
    expect(remoteCommandMotionPolicy('horn')).toBe('any');
    expect(remoteCommandMotionPolicy('lights_on')).toBe('any');
    expect(remoteCommandMotionPolicy('read_dtc')).toBe('any');
    expect(remoteCommandMotionPolicy('set_speed_alert')).toBe('any');
  });
});
