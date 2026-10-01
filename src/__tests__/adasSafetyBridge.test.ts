/**
 * adasSafetyBridge.test.ts — ADAS → Safety Assistant köprüsü kilitleri.
 *
 *   · FCW (çarpışma) motor hararetinin de ÖNÜNDE (P0 preemption)
 *   · 600 ms'den eski ADAS sinyali uyarı ÜRETMEZ; damgasız sinyal de (fail-closed)
 *   · kamera donarsa (yeni kare yok) görünür uyarı düşer
 *   · şerit uyarısı olay başına TEK kez seslendirilir
 *   · geri viteste ADAS uyarısı yok
 *   · eski kamera oturumunun (epoch) sonucu yayımlanamaz
 *   · opts.adas verilmezse mevcut davranış aynen korunur
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { computeSafetyTick } from '../platform/safety/safetyStateMapper';
import { SafetyAlertQueue } from '../platform/safety/SafetyAlertQueue';
import { evaluateSafetyRules } from '../platform/safety/SafetyRuleEngine';
import type { UnifiedVehicleState } from '../platform/vehicleDataLayer/UnifiedVehicleStore';
import type { AdasSignals } from '../platform/adas/adasTypes';
import {
  useAdasStore, beginAdasEpoch, publishAdasEvaluation, emptyAdasSignals, adasSignalValuesChanged,
} from '../platform/adas/adasStore';

const T0 = 5_000_000;

function makeV(o: Partial<UnifiedVehicleState> = {}): UnifiedVehicleState {
  return {
    speed: 60, rpm: undefined, fuel: null, odometer: 0, reverse: false,
    canDoorOpen: false, canHeadlights: false, canHighBeam: false, canTurnLeft: false, canTurnRight: false,
    canHazard: false, canTpmsKpa: null, canRpm: null, canCoolantTemp: null, canOilTemp: null,
    canThrottle: null, canBatteryVolt: null, canGearPos: null, canAmbientTemp: null, canAbs: false,
    canTractionControl: false, canStabilityControl: false, canParkingBrake: false, canSeatbelt: false,
    canWipers: false, canAirCondition: false, canCruiseControl: false, obdSignals: {}, obdSessionEpoch: -1,
    heading: null, location: null, gpsTracking: false, gpsError: null, gpsUnavailable: false, gpsSource: null,
    _vehicleSpeedTs: T0,
    ...o,
  } as unknown as UnifiedVehicleState;
}

function adas(p: Partial<{ fcw: boolean; hw: boolean; ldw: 'left' | 'right' | null; lead: boolean }>, ts: number): AdasSignals {
  return {
    forwardCollision: { value: p.fcw ?? false, ts, epoch: 1 },
    headway: { value: p.hw ?? false, ts, epoch: 1 },
    laneDeparture: { value: p.ldw ?? null, ts, epoch: 1 },
    leadDeparture: { value: p.lead ?? false, ts, epoch: 1 },
  };
}

const ids = (xs: { ruleId: string }[]): string[] => xs.map((a) => a.ruleId);

describe('ADAS → Safety köprüsü', () => {
  it('FCW motor hararetinin ÖNÜNDE: bant ve ses çarpışmanın', () => {
    const q = new SafetyAlertQueue();
    const { output } = computeSafetyTick(q, makeV({ canCoolantTemp: 121 }), T0, {
      wallClockMs: Date.now(), adas: adas({ fcw: true }, T0 - 50),
    });
    expect(ids(output.visibleAlerts)).toEqual(['adas.forward_collision', 'engine.overheat']);
    expect(output.primaryBannerAlert?.ruleId).toBe('adas.forward_collision');
    expect(output.voiceAnnouncementAlert?.ruleId).toBe('adas.forward_collision');
    expect(output.primaryBannerAlert?.level).toBe('critical');
  });

  it('600 ms\'den eski sinyal uyarı üretmez; sınırdaki taze sayılır', () => {
    const fresh = evaluateSafetyRules({ speed: 60, adasForwardCollision: true }, T0, { adasForwardCollision: T0 - 600 });
    const stale = evaluateSafetyRules({ speed: 60, adasForwardCollision: true }, T0, { adasForwardCollision: T0 - 601 });
    expect(ids(fresh)).toContain('adas.forward_collision');
    expect(ids(stale)).not.toContain('adas.forward_collision');
  });

  it('damgasız / hiç üretilmemiş sinyal uyarı üretmez (fail-closed)', () => {
    expect(evaluateSafetyRules({ adasForwardCollision: true, adasHeadway: true }, T0)).toEqual([]);
    const never = emptyAdasSignals();
    never.forwardCollision.value = true; // değer var, damga −∞
    const { output } = computeSafetyTick(new SafetyAlertQueue(), makeV(), T0, { adas: never });
    expect(output.visibleAlerts).toEqual([]);
  });

  it('kamera donarsa görünür uyarı ~600 ms içinde düşer', () => {
    const q = new SafetyAlertQueue();
    const last = adas({ fcw: true }, T0);
    expect(ids(computeSafetyTick(q, makeV(), T0 + 100, { adas: last }).output.visibleAlerts)).toContain('adas.forward_collision');
    // yeni kare gelmiyor — ticker 500 ms sonra yeniden hesaplar
    expect(computeSafetyTick(q, makeV(), T0 + 600, { adas: last }).output.visibleAlerts.length).toBe(1);
    expect(computeSafetyTick(q, makeV(), T0 + 700, { adas: last }).output.visibleAlerts).toEqual([]);
  });

  it('şerit uyarısı olay başına TEK kez seslendirilir, yön doğru', () => {
    const q = new SafetyAlertQueue();
    const voices: string[] = [];
    for (let t = 0; t <= 3000; t += 100) {
      const { output } = computeSafetyTick(q, makeV({ speed: 90 }), T0 + t, { adas: adas({ ldw: 'left' }, T0 + t) });
      if (output.voiceAnnouncementAlert) voices.push(output.voiceAnnouncementAlert.ruleId);
      expect(output.primaryBannerAlert?.icon).toBe('laneLeft');
    }
    expect(voices).toEqual(['adas.lane_departure.left']);
  });

  it('geri viteste ADAS uyarısı yok', () => {
    const alerts = evaluateSafetyRules(
      { reverse: true, adasForwardCollision: true, adasLaneDeparture: 'right', adasHeadway: true, adasLeadDeparture: true },
      T0,
      { adasForwardCollision: T0, adasLaneDeparture: T0, adasHeadway: T0, adasLeadDeparture: T0 },
    );
    expect(ids(alerts).filter((i) => i.startsWith('adas.'))).toEqual([]);
  });

  it('opts.adas verilmezse ADAS kuralları sönük, eski davranış aynen', () => {
    const q = new SafetyAlertQueue();
    const { output } = computeSafetyTick(q, makeV({ canCoolantTemp: 121 }), T0, { wallClockMs: Date.now() });
    expect(ids(output.visibleAlerts)).toEqual(['engine.overheat']);
  });
});

describe('adasStore epoch ve seçici', () => {
  beforeEach(() => {
    useAdasStore.setState({ epoch: 0, signals: emptyAdasSignals(), lead: null, lane: null, lastFrameTs: null });
  });

  const evalFor = (epoch: number, ts: number) => ({
    epoch, ts, forwardCollision: true, headway: false, laneDeparture: null, leadDeparture: false,
    lead: null, lane: null, calibrationProgress: 0,
  });

  it('eski oturumun geç gelen sonucu reddedilir', () => {
    const e1 = beginAdasEpoch(null);
    const e2 = beginAdasEpoch(null);
    expect(e2).toBe(e1 + 1);
    expect(publishAdasEvaluation(evalFor(e1, 100))).toBe(false);
    expect(useAdasStore.getState().signals.forwardCollision.value).toBe(false);
    expect(publishAdasEvaluation(evalFor(e2, 200))).toBe(true);
    expect(useAdasStore.getState().signals.forwardCollision).toEqual({ value: true, ts: 200, epoch: e2 });
  });

  it('seçici yalnız DEĞER değişimini görür (damga tazelenmesi hesap tetiklemez)', () => {
    const a = adas({ fcw: true }, 100);
    const b = adas({ fcw: true }, 200);
    const c = adas({ fcw: false }, 200);
    expect(adasSignalValuesChanged(a, b)).toBe(false);
    expect(adasSignalValuesChanged(b, c)).toBe(true);
  });
});
