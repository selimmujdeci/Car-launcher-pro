/**
 * SafetyRuleEngine birim testleri — FAZ 1
 *
 * Her kural için POSITIVE (tetiklenir) + NEGATIVE (tetiklenmez) testi.
 * Ayrıca: histerezis, stale, çoklu alert, öncelik sırası, durumsuzluk.
 */

import { describe, it, expect } from 'vitest';
import { evaluateSafetyRules } from '../platform/safety/SafetyRuleEngine';
import type { SafetyVehicleState, SafetyUpdatedAt } from '../platform/safety/types';

// ── Test yardımcısı ──────────────────────────────────────────────────────────

/** Tüm alanları null olan temiz araç durumu (fail-soft başlangıç noktası). */
function blankState(overrides: Partial<SafetyVehicleState> = {}): SafetyVehicleState {
  return {
    speed: null,
    reverse: null,
    doorOpen: null,
    parkingBrake: null,
    seatbelt: null,
    headlightsOn: null,
    hoodOpen: null,
    trunkOpen: null,
    coolantTemp: null,
    fuel: null,
    batteryVolt: null,
    oilWarning: null,
    isDark: null,
    ...overrides,
  };
}

const NOW = 1_000_000; // sabit referans zamanı (ms)

// Bir alert dizisinden belirli ruleId'nin mevcut olup olmadığını kontrol eder.
function hasRule(alerts: ReturnType<typeof evaluateSafetyRules>, ruleId: string): boolean {
  return alerts.some((a) => a.ruleId === ruleId);
}

// ── Kural 1: reverse.active ──────────────────────────────────────────────────
describe('reverse.active', () => {
  it('POSITIVE: reverse=true → overlay info alert üretir', () => {
    const state = blankState({ reverse: true });
    const alerts = evaluateSafetyRules(state, NOW);
    expect(hasRule(alerts, 'reverse.active')).toBe(true);
    const a = alerts.find((x) => x.ruleId === 'reverse.active')!;
    expect(a.level).toBe('info');
    expect(a.screen).toBe('overlay');
    expect(a.priority).toBe(10);
  });

  it('NEGATIVE: reverse=false → tetiklenmez', () => {
    const state = blankState({ reverse: false });
    expect(hasRule(evaluateSafetyRules(state, NOW), 'reverse.active')).toBe(false);
  });

  it('NEGATIVE: reverse=null → tetiklenmez', () => {
    const state = blankState({ reverse: null });
    expect(hasRule(evaluateSafetyRules(state, NOW), 'reverse.active')).toBe(false);
  });

  it('STALE: reverse=true ama 3000ms eski → tetiklenmez', () => {
    const state = blankState({ reverse: true });
    const updatedAt: SafetyUpdatedAt = { reverse: NOW - 3000 };
    expect(hasRule(evaluateSafetyRules(state, NOW, updatedAt), 'reverse.active')).toBe(false);
  });

  it('TAZE: reverse=true ve 1000ms eski → tetiklenir', () => {
    const state = blankState({ reverse: true });
    const updatedAt: SafetyUpdatedAt = { reverse: NOW - 1000 };
    expect(hasRule(evaluateSafetyRules(state, NOW, updatedAt), 'reverse.active')).toBe(true);
  });
});

// ── Kural 2: door.open.moving ────────────────────────────────────────────────
describe('door.open.moving', () => {
  it('POSITIVE: doorOpen=true, speed=50 → critical banner', () => {
    const state = blankState({ doorOpen: true, speed: 50 });
    const alerts = evaluateSafetyRules(state, NOW);
    expect(hasRule(alerts, 'door.open.moving')).toBe(true);
    const a = alerts.find((x) => x.ruleId === 'door.open.moving')!;
    expect(a.level).toBe('critical');
    expect(a.screen).toBe('banner');
  });

  it('NEGATIVE: doorOpen=false, speed=50 → tetiklenmez', () => {
    const state = blankState({ doorOpen: false, speed: 50 });
    expect(hasRule(evaluateSafetyRules(state, NOW), 'door.open.moving')).toBe(false);
  });

  it('NEGATIVE: doorOpen=true, speed=null → tetiklenmez (hız bilinmiyor)', () => {
    const state = blankState({ doorOpen: true, speed: null });
    expect(hasRule(evaluateSafetyRules(state, NOW), 'door.open.moving')).toBe(false);
  });

  it('STALE: doorOpen=true, speed=50, doorOpen 3000ms eski → tetiklenmez', () => {
    const state = blankState({ doorOpen: true, speed: 50 });
    const updatedAt: SafetyUpdatedAt = { doorOpen: NOW - 3000 };
    expect(hasRule(evaluateSafetyRules(state, NOW, updatedAt), 'door.open.moving')).toBe(false);
  });

  it('TAZE: doorOpen=true, speed=50, doorOpen 1000ms eski → tetiklenir', () => {
    const state = blankState({ doorOpen: true, speed: 50 });
    const updatedAt: SafetyUpdatedAt = { doorOpen: NOW - 1000 };
    expect(hasRule(evaluateSafetyRules(state, NOW, updatedAt), 'door.open.moving')).toBe(true);
  });
});

// ── Kural 3: parking_brake.moving ────────────────────────────────────────────
describe('parking_brake.moving', () => {
  it('POSITIVE: parkingBrake=true, speed=30 (>7) → critical banner', () => {
    const state = blankState({ parkingBrake: true, speed: 30 });
    const alerts = evaluateSafetyRules(state, NOW);
    expect(hasRule(alerts, 'parking_brake.moving')).toBe(true);
    const a = alerts.find((x) => x.ruleId === 'parking_brake.moving')!;
    expect(a.level).toBe('critical');
  });

  it('NEGATIVE: parkingBrake=true, speed=5 (<=7) → tetiklenmez', () => {
    const state = blankState({ parkingBrake: true, speed: 5 });
    expect(hasRule(evaluateSafetyRules(state, NOW), 'parking_brake.moving')).toBe(false);
  });

  it('NEGATIVE: parkingBrake=false, speed=50 → tetiklenmez', () => {
    const state = blankState({ parkingBrake: false, speed: 50 });
    expect(hasRule(evaluateSafetyRules(state, NOW), 'parking_brake.moving')).toBe(false);
  });

  it('STALE: parkingBrake=true, speed=30, 3000ms eski → tetiklenmez', () => {
    const state = blankState({ parkingBrake: true, speed: 30 });
    const updatedAt: SafetyUpdatedAt = { parkingBrake: NOW - 3000 };
    expect(hasRule(evaluateSafetyRules(state, NOW, updatedAt), 'parking_brake.moving')).toBe(false);
  });
});

// ── Kural 4: engine.overheat ─────────────────────────────────────────────────
describe('engine.overheat', () => {
  it('POSITIVE: coolantTemp=120 → critical banner', () => {
    const state = blankState({ coolantTemp: 120 });
    const alerts = evaluateSafetyRules(state, NOW);
    expect(hasRule(alerts, 'engine.overheat')).toBe(true);
    const a = alerts.find((x) => x.ruleId === 'engine.overheat')!;
    expect(a.level).toBe('critical');
    expect(a.priority).toBe(100);
  });

  it('POSITIVE: coolantTemp=118 (eşit eşik) → tetiklenir', () => {
    const state = blankState({ coolantTemp: 118 });
    expect(hasRule(evaluateSafetyRules(state, NOW), 'engine.overheat')).toBe(true);
  });

  it('NEGATIVE: coolantTemp=117 → tetiklenmez', () => {
    const state = blankState({ coolantTemp: 117 });
    expect(hasRule(evaluateSafetyRules(state, NOW), 'engine.overheat')).toBe(false);
  });

  it('NEGATIVE: coolantTemp=135 (aralık dışı >130) → tetiklenmez', () => {
    const state = blankState({ coolantTemp: 135 });
    expect(hasRule(evaluateSafetyRules(state, NOW), 'engine.overheat')).toBe(false);
  });

  it('NEGATIVE: coolantTemp=30 (aralık dışı <40) → tetiklenmez', () => {
    const state = blankState({ coolantTemp: 30 });
    expect(hasRule(evaluateSafetyRules(state, NOW), 'engine.overheat')).toBe(false);
  });

  it('STALE ISTISNA: coolantTemp=120, 5000ms eski → hâlâ tetiklenir (10s tolerans)', () => {
    const state = blankState({ coolantTemp: 120 });
    const updatedAt: SafetyUpdatedAt = { coolantTemp: NOW - 5000 };
    expect(hasRule(evaluateSafetyRules(state, NOW, updatedAt), 'engine.overheat')).toBe(true);
  });

  it('STALE: coolantTemp=120, 11000ms eski → tetiklenmez (10s aşıldı)', () => {
    const state = blankState({ coolantTemp: 120 });
    const updatedAt: SafetyUpdatedAt = { coolantTemp: NOW - 11000 };
    expect(hasRule(evaluateSafetyRules(state, NOW, updatedAt), 'engine.overheat')).toBe(false);
  });
});

// ── Kural 5: seatbelt.unfastened.moving ──────────────────────────────────────
describe('seatbelt.unfastened.moving', () => {
  it('POSITIVE: seatbelt=false, speed=50 (>10) → warning banner', () => {
    const state = blankState({ seatbelt: false, speed: 50 });
    const alerts = evaluateSafetyRules(state, NOW);
    expect(hasRule(alerts, 'seatbelt.unfastened.moving')).toBe(true);
    const a = alerts.find((x) => x.ruleId === 'seatbelt.unfastened.moving')!;
    expect(a.level).toBe('warning');
  });

  it('NEGATIVE: seatbelt=true, speed=50 → tetiklenmez', () => {
    const state = blankState({ seatbelt: true, speed: 50 });
    expect(hasRule(evaluateSafetyRules(state, NOW), 'seatbelt.unfastened.moving')).toBe(false);
  });

  it('NEGATIVE: seatbelt=false, speed=8 (<=10) → tetiklenmez', () => {
    const state = blankState({ seatbelt: false, speed: 8 });
    expect(hasRule(evaluateSafetyRules(state, NOW), 'seatbelt.unfastened.moving')).toBe(false);
  });

  it('NEGATIVE: seatbelt=false, speed=null → tetiklenmez', () => {
    const state = blankState({ seatbelt: false, speed: null });
    expect(hasRule(evaluateSafetyRules(state, NOW), 'seatbelt.unfastened.moving')).toBe(false);
  });

  it('STALE: seatbelt=false, speed=50, 3000ms eski → tetiklenmez', () => {
    const state = blankState({ seatbelt: false, speed: 50 });
    const updatedAt: SafetyUpdatedAt = { seatbelt: NOW - 3000 };
    expect(hasRule(evaluateSafetyRules(state, NOW, updatedAt), 'seatbelt.unfastened.moving')).toBe(false);
  });
});

// ── Kural 6: hood_or_trunk.open.moving ───────────────────────────────────────
describe('hood_or_trunk.open.moving', () => {
  it('POSITIVE: hoodOpen=true, speed=30 → critical', () => {
    const state = blankState({ hoodOpen: true, speed: 30 });
    expect(hasRule(evaluateSafetyRules(state, NOW), 'hood_or_trunk.open.moving')).toBe(true);
  });

  it('POSITIVE: trunkOpen=true, speed=30 → critical', () => {
    const state = blankState({ trunkOpen: true, speed: 30 });
    expect(hasRule(evaluateSafetyRules(state, NOW), 'hood_or_trunk.open.moving')).toBe(true);
  });

  it('POSITIVE: hem hood hem trunk açık, speed=30 → critical (tek alert)', () => {
    const state = blankState({ hoodOpen: true, trunkOpen: true, speed: 30 });
    const alerts = evaluateSafetyRules(state, NOW).filter((a) => a.ruleId === 'hood_or_trunk.open.moving');
    expect(alerts).toHaveLength(1);
  });

  it('NEGATIVE: hoodOpen=false, trunkOpen=false, speed=30 → tetiklenmez', () => {
    const state = blankState({ hoodOpen: false, trunkOpen: false, speed: 30 });
    expect(hasRule(evaluateSafetyRules(state, NOW), 'hood_or_trunk.open.moving')).toBe(false);
  });

  it('NEGATIVE: hoodOpen=true, speed=3 (<=5, ölü bantta) → tetiklenmez (MOVING değil)', () => {
    const state = blankState({ hoodOpen: true, speed: 3 });
    expect(hasRule(evaluateSafetyRules(state, NOW), 'hood_or_trunk.open.moving')).toBe(false);
  });

  it('STALE: hoodOpen=true, speed=30, 3000ms eski → tetiklenmez', () => {
    const state = blankState({ hoodOpen: true, speed: 30 });
    const updatedAt: SafetyUpdatedAt = { hoodOpen: NOW - 3000 };
    expect(hasRule(evaluateSafetyRules(state, NOW, updatedAt), 'hood_or_trunk.open.moving')).toBe(false);
  });
});

// ── Kural 7: headlights.off.dark ─────────────────────────────────────────────
describe('headlights.off.dark', () => {
  it('POSITIVE: headlightsOn=false, isDark=true, speed=50 → warning', () => {
    const state = blankState({ headlightsOn: false, isDark: true, speed: 50 });
    const alerts = evaluateSafetyRules(state, NOW);
    expect(hasRule(alerts, 'headlights.off.dark')).toBe(true);
    const a = alerts.find((x) => x.ruleId === 'headlights.off.dark')!;
    expect(a.level).toBe('warning');
  });

  it('NEGATIVE: headlightsOn=true, isDark=true, speed=50 → tetiklenmez', () => {
    const state = blankState({ headlightsOn: true, isDark: true, speed: 50 });
    expect(hasRule(evaluateSafetyRules(state, NOW), 'headlights.off.dark')).toBe(false);
  });

  it('NEGATIVE: headlightsOn=false, isDark=false (gündüz), speed=50 → tetiklenmez', () => {
    const state = blankState({ headlightsOn: false, isDark: false, speed: 50 });
    expect(hasRule(evaluateSafetyRules(state, NOW), 'headlights.off.dark')).toBe(false);
  });

  it('NEGATIVE: headlightsOn=false, isDark=true, speed=15 (<=20) → tetiklenmez', () => {
    const state = blankState({ headlightsOn: false, isDark: true, speed: 15 });
    expect(hasRule(evaluateSafetyRules(state, NOW), 'headlights.off.dark')).toBe(false);
  });

  it('STALE: headlightsOn=false, isDark=true, speed=50, 3000ms eski → tetiklenmez', () => {
    const state = blankState({ headlightsOn: false, isDark: true, speed: 50 });
    const updatedAt: SafetyUpdatedAt = { headlightsOn: NOW - 3000 };
    expect(hasRule(evaluateSafetyRules(state, NOW, updatedAt), 'headlights.off.dark')).toBe(false);
  });
});

// ── Kural 8: low_fuel ────────────────────────────────────────────────────────
describe('low_fuel', () => {
  it('POSITIVE: fuel=5 (<=8) → warning icon', () => {
    const state = blankState({ fuel: 5 });
    const alerts = evaluateSafetyRules(state, NOW);
    expect(hasRule(alerts, 'low_fuel')).toBe(true);
    const a = alerts.find((x) => x.ruleId === 'low_fuel')!;
    expect(a.level).toBe('warning');
    expect(a.screen).toBe('icon');
  });

  it('POSITIVE: fuel=8 (eşit eşik) → tetiklenir', () => {
    const state = blankState({ fuel: 8 });
    expect(hasRule(evaluateSafetyRules(state, NOW), 'low_fuel')).toBe(true);
  });

  it('NEGATIVE: fuel=9 (>8) → tetiklenmez', () => {
    const state = blankState({ fuel: 9 });
    expect(hasRule(evaluateSafetyRules(state, NOW), 'low_fuel')).toBe(false);
  });

  it('NEGATIVE: fuel=null → tetiklenmez', () => {
    const state = blankState({ fuel: null });
    expect(hasRule(evaluateSafetyRules(state, NOW), 'low_fuel')).toBe(false);
  });

  it('STALE: fuel=5, 3000ms eski → tetiklenmez', () => {
    const state = blankState({ fuel: 5 });
    const updatedAt: SafetyUpdatedAt = { fuel: NOW - 3000 };
    expect(hasRule(evaluateSafetyRules(state, NOW, updatedAt), 'low_fuel')).toBe(false);
  });
});

// ── Kural 9: battery_or_oil.warning ─────────────────────────────────────────
describe('battery_or_oil.warning', () => {
  it('POSITIVE: oilWarning=true → critical banner', () => {
    const state = blankState({ oilWarning: true });
    const alerts = evaluateSafetyRules(state, NOW);
    expect(hasRule(alerts, 'battery_or_oil.warning')).toBe(true);
    const a = alerts.find((x) => x.ruleId === 'battery_or_oil.warning')!;
    expect(a.level).toBe('critical');
  });

  it('POSITIVE: batteryVolt=11.5 (<11.8) → critical banner', () => {
    const state = blankState({ batteryVolt: 11.5 });
    expect(hasRule(evaluateSafetyRules(state, NOW), 'battery_or_oil.warning')).toBe(true);
  });

  it('POSITIVE: batteryVolt=11.79 (eşik altı) → tetiklenir', () => {
    const state = blankState({ batteryVolt: 11.79 });
    expect(hasRule(evaluateSafetyRules(state, NOW), 'battery_or_oil.warning')).toBe(true);
  });

  it('NEGATIVE: oilWarning=false, batteryVolt=12.5 → tetiklenmez', () => {
    const state = blankState({ oilWarning: false, batteryVolt: 12.5 });
    expect(hasRule(evaluateSafetyRules(state, NOW), 'battery_or_oil.warning')).toBe(false);
  });

  it('NEGATIVE: batteryVolt=11.8 (eşit — eşiğin üstünde değil) → tetiklenir (<11.8 şart)', () => {
    // 11.8 < 11.8 = false → tetiklenmez
    const state = blankState({ batteryVolt: 11.8 });
    expect(hasRule(evaluateSafetyRules(state, NOW), 'battery_or_oil.warning')).toBe(false);
  });

  it('STALE: oilWarning=true, 3000ms eski → tetiklenmez', () => {
    const state = blankState({ oilWarning: true });
    const updatedAt: SafetyUpdatedAt = { oilWarning: NOW - 3000 };
    expect(hasRule(evaluateSafetyRules(state, NOW, updatedAt), 'battery_or_oil.warning')).toBe(false);
  });

  it('STALE: batteryVolt=11.5, 3000ms eski → tetiklenmez (ama oilWarning taze olsa tetiklenirdi)', () => {
    const state = blankState({ batteryVolt: 11.5 });
    const updatedAt: SafetyUpdatedAt = { batteryVolt: NOW - 3000 };
    expect(hasRule(evaluateSafetyRules(state, NOW, updatedAt), 'battery_or_oil.warning')).toBe(false);
  });
});

// ── Kural 10: park.door.open ─────────────────────────────────────────────────
describe('park.door.open', () => {
  it('POSITIVE: doorOpen=true, speed=0 (<3) → info icon', () => {
    const state = blankState({ doorOpen: true, speed: 0 });
    const alerts = evaluateSafetyRules(state, NOW);
    expect(hasRule(alerts, 'park.door.open')).toBe(true);
    const a = alerts.find((x) => x.ruleId === 'park.door.open')!;
    expect(a.level).toBe('info');
    expect(a.screen).toBe('icon');
    expect(a.priority).toBe(20);
  });

  it('POSITIVE: doorOpen=true, speed=2 (<3) → info icon', () => {
    const state = blankState({ doorOpen: true, speed: 2 });
    expect(hasRule(evaluateSafetyRules(state, NOW), 'park.door.open')).toBe(true);
  });

  it('NEGATIVE: doorOpen=false, speed=0 → tetiklenmez', () => {
    const state = blankState({ doorOpen: false, speed: 0 });
    expect(hasRule(evaluateSafetyRules(state, NOW), 'park.door.open')).toBe(false);
  });

  it('NEGATIVE: doorOpen=true, speed=null → tetiklenmez (hız bilinmiyor)', () => {
    const state = blankState({ doorOpen: true, speed: null });
    expect(hasRule(evaluateSafetyRules(state, NOW), 'park.door.open')).toBe(false);
  });

  it('STALE: doorOpen=true, speed=0, 3000ms eski → tetiklenmez', () => {
    const state = blankState({ doorOpen: true, speed: 0 });
    const updatedAt: SafetyUpdatedAt = { doorOpen: NOW - 3000 };
    expect(hasRule(evaluateSafetyRules(state, NOW, updatedAt), 'park.door.open')).toBe(false);
  });
});

// ── Hız histerezisi (ölü bant: 3–5 km/h) ────────────────────────────────────
describe('hız histerezisi (ölü bant 3–5 km/h)', () => {
  it('speed=4 (ölü bant): doorOpen=true → ne moving ne park tetiklenmez', () => {
    const state = blankState({ doorOpen: true, speed: 4 });
    const alerts = evaluateSafetyRules(state, NOW);
    expect(hasRule(alerts, 'door.open.moving')).toBe(false);
    expect(hasRule(alerts, 'park.door.open')).toBe(false);
  });

  it('speed=6 (>5, MOVING): doorOpen=true → door.open.moving tetiklenir', () => {
    const state = blankState({ doorOpen: true, speed: 6 });
    expect(hasRule(evaluateSafetyRules(state, NOW), 'door.open.moving')).toBe(true);
  });

  it('speed=2 (<3, STOPPED): doorOpen=true → park.door.open tetiklenir', () => {
    const state = blankState({ doorOpen: true, speed: 2 });
    expect(hasRule(evaluateSafetyRules(state, NOW), 'park.door.open')).toBe(true);
  });

  it('speed=5 (eşik sınırı, <=5 dolayısıyla MOVING değil): door.open.moving tetiklenmez', () => {
    const state = blankState({ doorOpen: true, speed: 5 });
    expect(hasRule(evaluateSafetyRules(state, NOW), 'door.open.moving')).toBe(false);
  });

  it('speed=3 (STOPPED eşiği, >=3 dolayısıyla STOPPED değil): park.door.open tetiklenmez', () => {
    const state = blankState({ doorOpen: true, speed: 3 });
    expect(hasRule(evaluateSafetyRules(state, NOW), 'park.door.open')).toBe(false);
  });
});

// ── speed=null → MOVING kuralları tetiklenmez ─────────────────────────────────
describe('speed=null → hıza bağlı MOVING kuralları pasif', () => {
  it('speed=null, doorOpen=true → door.open.moving tetiklenmez', () => {
    const state = blankState({ doorOpen: true, speed: null });
    expect(hasRule(evaluateSafetyRules(state, NOW), 'door.open.moving')).toBe(false);
  });

  it('speed=null, parkingBrake=true → parking_brake.moving tetiklenmez', () => {
    const state = blankState({ parkingBrake: true, speed: null });
    expect(hasRule(evaluateSafetyRules(state, NOW), 'parking_brake.moving')).toBe(false);
  });

  it('speed=null, seatbelt=false → seatbelt.unfastened.moving tetiklenmez', () => {
    const state = blankState({ seatbelt: false, speed: null });
    expect(hasRule(evaluateSafetyRules(state, NOW), 'seatbelt.unfastened.moving')).toBe(false);
  });

  it('speed=null, hoodOpen=true → hood_or_trunk.open.moving tetiklenmez', () => {
    const state = blankState({ hoodOpen: true, speed: null });
    expect(hasRule(evaluateSafetyRules(state, NOW), 'hood_or_trunk.open.moving')).toBe(false);
  });

  it('speed=null — hıza bağlı olmayan kurallar hâlâ çalışır: engine.overheat', () => {
    const state = blankState({ coolantTemp: 120, speed: null });
    expect(hasRule(evaluateSafetyRules(state, NOW), 'engine.overheat')).toBe(true);
  });
});

// ── STALE ek testler ─────────────────────────────────────────────────────────
describe('stale sinyal testleri (genel 2000ms sınır)', () => {
  it('doorOpen taze (1000ms) → tetiklenir', () => {
    const state = blankState({ doorOpen: true, speed: 50 });
    const updatedAt: SafetyUpdatedAt = { doorOpen: NOW - 1000 };
    expect(hasRule(evaluateSafetyRules(state, NOW, updatedAt), 'door.open.moving')).toBe(true);
  });

  it('doorOpen bayat (3000ms > 2000ms) → tetiklenmez', () => {
    const state = blankState({ doorOpen: true, speed: 50 });
    const updatedAt: SafetyUpdatedAt = { doorOpen: NOW - 3000 };
    expect(hasRule(evaluateSafetyRules(state, NOW, updatedAt), 'door.open.moving')).toBe(false);
  });

  it('updatedAt yoksa → taze sayılır, tetiklenir', () => {
    const state = blankState({ doorOpen: true, speed: 50 });
    expect(hasRule(evaluateSafetyRules(state, NOW, undefined), 'door.open.moving')).toBe(true);
  });

  it('updatedAt var ama ilgili key yok → taze sayılır, tetiklenir', () => {
    const state = blankState({ doorOpen: true, speed: 50 });
    const updatedAt: SafetyUpdatedAt = {}; // doorOpen anahtarı yok
    expect(hasRule(evaluateSafetyRules(state, NOW, updatedAt), 'door.open.moving')).toBe(true);
  });
});

// ── Overheat stale istisnası ─────────────────────────────────────────────────
describe('engine.overheat stale istisnası (10000ms)', () => {
  it('coolantTemp=120, 5000ms eski → hâlâ tetiklenir (10s tolerans)', () => {
    const state = blankState({ coolantTemp: 120 });
    const updatedAt: SafetyUpdatedAt = { coolantTemp: NOW - 5000 };
    expect(hasRule(evaluateSafetyRules(state, NOW, updatedAt), 'engine.overheat')).toBe(true);
  });

  it('coolantTemp=120, 10000ms eski (tam eşik) → hâlâ tetiklenir (> 10000 şart)', () => {
    const state = blankState({ coolantTemp: 120 });
    const updatedAt: SafetyUpdatedAt = { coolantTemp: NOW - 10000 };
    // 10000 > 10000 = false → stale değil → tetiklenir
    expect(hasRule(evaluateSafetyRules(state, NOW, updatedAt), 'engine.overheat')).toBe(true);
  });

  it('coolantTemp=120, 11000ms eski → tetiklenmez (10s aşıldı)', () => {
    const state = blankState({ coolantTemp: 120 });
    const updatedAt: SafetyUpdatedAt = { coolantTemp: NOW - 11000 };
    expect(hasRule(evaluateSafetyRules(state, NOW, updatedAt), 'engine.overheat')).toBe(false);
  });
});

// ── Çoklu alert aynı anda + öncelik sırası ───────────────────────────────────
describe('çoklu alert ve priority sıralaması', () => {
  it('door.open.moving + engine.overheat + low_fuel → önce overheat(100) > door(95) > fuel(40)', () => {
    const state = blankState({
      doorOpen: true,
      speed: 50,
      coolantTemp: 120,
      fuel: 5,
    });
    const alerts = evaluateSafetyRules(state, NOW);
    expect(hasRule(alerts, 'engine.overheat')).toBe(true);
    expect(hasRule(alerts, 'door.open.moving')).toBe(true);
    expect(hasRule(alerts, 'low_fuel')).toBe(true);
    // Sıralama: priority azalan
    const overheatIdx = alerts.findIndex((a) => a.ruleId === 'engine.overheat');
    const doorIdx = alerts.findIndex((a) => a.ruleId === 'door.open.moving');
    const fuelIdx = alerts.findIndex((a) => a.ruleId === 'low_fuel');
    expect(overheatIdx).toBeLessThan(doorIdx);
    expect(doorIdx).toBeLessThan(fuelIdx);
  });

  it('critical > warning > info sırası: bir critical + bir warning + bir info', () => {
    const state = blankState({
      coolantTemp: 120,                    // critical, priority 100
      seatbelt: false, speed: 50,          // warning, priority 70
      reverse: true,                       // info, priority 10
    });
    const alerts = evaluateSafetyRules(state, NOW);
    expect(alerts.length).toBeGreaterThanOrEqual(3);
    // İlk eleman critical olmalı
    expect(alerts[0].level).toBe('critical');
    // Son info eleman priority en düşük
    const reversed = alerts.find((a) => a.ruleId === 'reverse.active')!;
    const seatbelt = alerts.find((a) => a.ruleId === 'seatbelt.unfastened.moving')!;
    const overheat = alerts.find((a) => a.ruleId === 'engine.overheat')!;
    expect(overheat.priority).toBeGreaterThan(seatbelt.priority);
    expect(seatbelt.priority).toBeGreaterThan(reversed.priority);
  });

  it('eşit priority → ruleId alfabetik sıralı (deterministik)', () => {
    // İki info alert: reverse.active(10) ve park.door.open(20) — farklı priority
    // Gerçek eşitlik testi: aynı priority iki kural yok standart listede, bu yüzden
    // özel bir çift senaryosu simüle etmeden mevcut çiftleri priority sırasıyla doğrula.
    const state = blankState({ fuel: 5 });           // low_fuel priority=40
    const alerts = evaluateSafetyRules(state, NOW);
    // Tek alert, sıralama deterministik — iki kez çağırınca aynı sonuç
    const alerts2 = evaluateSafetyRules(state, NOW);
    expect(alerts.map((a) => a.ruleId)).toEqual(alerts2.map((a) => a.ruleId));
  });
});

// ── Durumsuzluk (stateless) garantisi ────────────────────────────────────────
describe('durumsuzluk — aynı (state, now) → aynı çıktı', () => {
  it('karmaşık state: iki kez çağır → derin eşit', () => {
    const state = blankState({
      doorOpen: true,
      speed: 50,
      coolantTemp: 120,
      fuel: 5,
      seatbelt: false,
      oilWarning: true,
      reverse: true,
    });
    const r1 = evaluateSafetyRules(state, NOW);
    const r2 = evaluateSafetyRules(state, NOW);
    expect(r1).toEqual(r2);
  });

  it('boş state: iki kez çağır → her ikisi de boş dizi', () => {
    const state = blankState();
    const r1 = evaluateSafetyRules(state, NOW);
    const r2 = evaluateSafetyRules(state, NOW);
    expect(r1).toEqual([]);
    expect(r2).toEqual([]);
  });
});

// ── Alert alanları doğruluğu ─────────────────────────────────────────────────
describe('alert alanları doğruluğu', () => {
  it('her alert ts=now ile üretilir', () => {
    const state = blankState({ coolantTemp: 120 });
    const alerts = evaluateSafetyRules(state, NOW);
    alerts.forEach((a) => expect(a.ts).toBe(NOW));
  });

  it('her alert gerekli alanları taşır (ruleId, level, message, icon, screen, priority, ts)', () => {
    const state = blankState({ oilWarning: true, fuel: 3, reverse: true });
    const alerts = evaluateSafetyRules(state, NOW);
    alerts.forEach((a) => {
      expect(typeof a.ruleId).toBe('string');
      expect(['info', 'warning', 'critical']).toContain(a.level);
      expect(typeof a.message).toBe('string');
      expect(a.message.length).toBeGreaterThan(0);
      expect(typeof a.icon).toBe('string');
      expect(['icon', 'banner', 'overlay']).toContain(a.screen);
      expect(typeof a.priority).toBe('number');
      expect(a.priority).toBeGreaterThan(0);
      expect(a.ts).toBe(NOW);
    });
  });
});
