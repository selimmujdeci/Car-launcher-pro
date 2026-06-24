/**
 * safetyIsDark testleri — FAZ 4C
 *
 * deriveIsDark (dayNightMode → boolean) birim testi + headlights.off.dark
 * kuralının gece/gündüz davranışı (mapper + engine uçtan uca).
 *
 * @testing-library/react YOK — saf fonksiyonlar.
 */

import { describe, it, expect } from 'vitest';
import { deriveIsDark } from '../platform/safety/isDark';
import { createSafetyStateFromVehicleStore } from '../platform/safety/safetyStateMapper';
import { evaluateSafetyRules } from '../platform/safety/SafetyRuleEngine';
import type { SafetyMapOptions } from '../platform/safety/safetyStateMapper';
import type { UnifiedVehicleState } from '../platform/vehicleDataLayer/UnifiedVehicleStore';

const NOW = 10_000;

function stubVehicle(over: Partial<UnifiedVehicleState>): UnifiedVehicleState {
  return {
    speed:           null,
    reverse:         false,
    fuel:            null,
    canDoorOpen:     false,
    canParkingBrake: false,
    canSeatbelt:     false,
    canHeadlights:   false,
    canCoolantTemp:  null,
    canBatteryVolt:  null,
    _vehicleSpeedTs: NOW,
    ...over,
  } as unknown as UnifiedVehicleState;
}

function hasAlert(v: UnifiedVehicleState, ruleId: string, opts?: SafetyMapOptions): boolean {
  const { state, updatedAt } = createSafetyStateFromVehicleStore(v, opts);
  return evaluateSafetyRules(state, NOW, updatedAt).some((a) => a.ruleId === ruleId);
}

// ── deriveIsDark birim ────────────────────────────────────────────────────────

describe('deriveIsDark', () => {
  it("'night' → true (karanlık)", () => {
    expect(deriveIsDark('night')).toBe(true);
  });
  it("'day' → false (aydınlık)", () => {
    expect(deriveIsDark('day')).toBe(false);
  });
});

// ── headlights.off.dark gece/gündüz davranışı ─────────────────────────────────

describe('headlights.off.dark — dayNightMode tabanlı isDark', () => {
  // headlights available + gece + farlar kapalı + hız>20 → alert VAR
  it("gece (dayNightMode='night') + farlar kapalı + hız>20 → alert VAR", () => {
    const v = stubVehicle({ canHeadlights: false, speed: 30 });
    const opts: SafetyMapOptions = {
      isDark: deriveIsDark('night'),
      signalsAvailable: { headlights: true },
    };
    expect(hasAlert(v, 'headlights.off.dark', opts)).toBe(true);
  });

  // gündüz → alert YOK
  it("gündüz (dayNightMode='day') + farlar kapalı + hız>20 → alert YOK", () => {
    const v = stubVehicle({ canHeadlights: false, speed: 30 });
    const opts: SafetyMapOptions = {
      isDark: deriveIsDark('day'),
      signalsAvailable: { headlights: true },
    };
    expect(hasAlert(v, 'headlights.off.dark', opts)).toBe(false);
  });
});
