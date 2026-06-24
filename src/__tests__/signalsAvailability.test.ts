/**
 * signalsAvailability birim + uçtan uca testleri — FAZ 4B
 *
 * - computeSignalsAvailable saf türetim testleri.
 * - mapper + engine uçtan uca: signalsAvailable seatbelt/headlights kurallarını
 *   doğru şekilde aktif/sönük yapıyor mu.
 *
 * @testing-library/react YOK — React gerektirmez (saf fonksiyonlar).
 */

import { describe, it, expect } from 'vitest';
import { computeSignalsAvailable } from '../platform/safety/signalsAvailability';
import { createSafetyStateFromVehicleStore } from '../platform/safety/safetyStateMapper';
import { evaluateSafetyRules } from '../platform/safety/SafetyRuleEngine';
import type { SafetyMapOptions } from '../platform/safety/safetyStateMapper';
import type { UnifiedVehicleState } from '../platform/vehicleDataLayer/UnifiedVehicleStore';

// ── Sabit zaman (speed taze sayılsın) ─────────────────────────────────────────
const NOW = 10_000;

// ── Stub UnifiedVehicleState — mapper yalnız veri alanlarını okur ─────────────
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

/** mapper → engine zinciri; ruleId aktif mi? */
function hasAlert(
  v: UnifiedVehicleState,
  ruleId: string,
  opts?: SafetyMapOptions,
): boolean {
  const { state, updatedAt } = createSafetyStateFromVehicleStore(v, opts);
  const alerts = evaluateSafetyRules(state, NOW, updatedAt);
  return alerts.some((a) => a.ruleId === ruleId);
}

// ── A: computeSignalsAvailable saf türetim ────────────────────────────────────

describe('computeSignalsAvailable', () => {
  it('safeMode=true → tüm sinyaller unavailable (güvenli)', () => {
    const r = computeSignalsAvailable(true, new Set(['seatbelt', 'headlights']));
    expect(r).toEqual({ seatbelt: false, headlights: false });
  });

  it('safeMode=false + profil seatbelt destekliyor → seatbelt available', () => {
    const r = computeSignalsAvailable(false, new Set(['seatbelt']));
    expect(r).toEqual({ seatbelt: true, headlights: false });
  });

  it('safeMode=false + profil hiçbirini desteklemiyor → hepsi unavailable', () => {
    const r = computeSignalsAvailable(false, new Set());
    expect(r).toEqual({ seatbelt: false, headlights: false });
  });

  it('safeMode=false + profil headlights destekliyor → headlights available', () => {
    const r = computeSignalsAvailable(false, new Set(['headlights']));
    expect(r.headlights).toBe(true);
    expect(r.seatbelt).toBe(false);
  });
});

// ── B: seatbelt unavailable → alert yok ───────────────────────────────────────

describe('seatbelt availability → engine', () => {
  it('unavailable + kemer takılı değil + hız>10 → seatbelt alert YOK', () => {
    const v = stubVehicle({ canSeatbelt: false, speed: 20 });
    const opts: SafetyMapOptions = { signalsAvailable: { seatbelt: false, headlights: false } };
    expect(hasAlert(v, 'seatbelt.unfastened.moving', opts)).toBe(false);
  });

  // ── C: seatbelt available + unfastened + hız>10 → alert var ──
  it('available + kemer takılı değil + hız>10 → seatbelt alert VAR', () => {
    const v = stubVehicle({ canSeatbelt: false, speed: 20 });
    const opts: SafetyMapOptions = { signalsAvailable: { seatbelt: true } };
    expect(hasAlert(v, 'seatbelt.unfastened.moving', opts)).toBe(true);
  });
});

// ── D/E: headlights availability → engine ─────────────────────────────────────

describe('headlights availability → engine', () => {
  it('unavailable + karanlık + farlar kapalı → headlights alert YOK', () => {
    const v = stubVehicle({ canHeadlights: false, speed: 30 });
    const opts: SafetyMapOptions = { isDark: true, signalsAvailable: { headlights: false } };
    expect(hasAlert(v, 'headlights.off.dark', opts)).toBe(false);
  });

  it('available + karanlık + farlar kapalı + hız>20 → headlights alert VAR', () => {
    const v = stubVehicle({ canHeadlights: false, speed: 30 });
    const opts: SafetyMapOptions = { isDark: true, signalsAvailable: { headlights: true } };
    expect(hasAlert(v, 'headlights.off.dark', opts)).toBe(true);
  });
});

// ── F: safeMode (handshake yok/güvenilmez) → unavailable → alert yok ──────────

describe('safeMode → unavailable (reset-safe; zaman-bazlı staleness değil)', () => {
  it('safeMode=true profil seatbelt içerse bile → seatbelt alert YOK', () => {
    const sa = computeSignalsAvailable(true, new Set(['seatbelt']));
    expect(sa.seatbelt).toBe(false);
    const v = stubVehicle({ canSeatbelt: false, speed: 20 });
    expect(hasAlert(v, 'seatbelt.unfastened.moving', { signalsAvailable: sa })).toBe(false);
  });
});

// ── G: default güvenli davranış (opts yok) ────────────────────────────────────

describe('default güvenli davranış', () => {
  it('signalsAvailable verilmezse seatbelt/headlights sönük → alert yok', () => {
    const v = stubVehicle({ canSeatbelt: false, canHeadlights: false, speed: 30 });
    // opts yok → mapper seatbelt/headlights undefined bırakır
    expect(hasAlert(v, 'seatbelt.unfastened.moving')).toBe(false);
    expect(hasAlert(v, 'headlights.off.dark', { isDark: true })).toBe(false);
  });
});
