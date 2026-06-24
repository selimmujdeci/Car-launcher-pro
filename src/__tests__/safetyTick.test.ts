/**
 * safetyTick birim testleri — FAZ 2.6
 *
 * KAPSAM:
 *   1. safetyOutputsEqual — ts hariç derin karşılaştırma
 *   2. computeSafetyTick — debounce + ses tekrar (girdi değişmeden now ilerleyince)
 *   3. createSafetyTicker — interval yaşam döngüsü, cleanup, idempotency
 *
 * YAKLAŞIM: React harness YOK. Saf fonksiyon + vi.useFakeTimers().
 * @testing-library/react KULLANILMAZ (yüklü değil).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  safetyOutputsEqual,
  computeSafetyTick,
} from '../platform/safety/safetyStateMapper';
import { createSafetyTicker } from '../platform/safety/safetyTicker';
import { SafetyAlertQueue } from '../platform/safety/SafetyAlertQueue';
import type { SafetyQueueOutput } from '../platform/safety/types';
import type { UnifiedVehicleState } from '../platform/vehicleDataLayer/UnifiedVehicleStore';

// ── Test yardımcıları ─────────────────────────────────────────────────────────

const T0 = 10_000_000;

/** Minimal UnifiedVehicleState stub — yalnızca mapper'ın okuduğu alanlar. */
function makeV(overrides: Partial<{
  speed: number | null;
  canDoorOpen: boolean;
  canParkingBrake: boolean;
  canCoolantTemp: number | null;
  canBatteryVolt: number | null;
  canSeatbelt: boolean;
  canHeadlights: boolean;
  reverse: boolean;
  fuel: number | null;
  _vehicleSpeedTs: number;
}>): UnifiedVehicleState {
  return {
    speed:               null,
    rpm:                 undefined,
    fuel:                null,
    odometer:            0,
    reverse:             false,
    canDoorOpen:         false,
    canHeadlights:       false,
    canHighBeam:         false,
    canTurnLeft:         false,
    canTurnRight:        false,
    canHazard:           false,
    canTpmsKpa:          null,
    canRpm:              null,
    canCoolantTemp:      null,
    canOilTemp:          null,
    canThrottle:         null,
    canBatteryVolt:      null,
    canGearPos:          null,
    canAmbientTemp:      null,
    canAbs:              false,
    canTractionControl:  false,
    canStabilityControl: false,
    canParkingBrake:     false,
    canSeatbelt:         false,
    canWipers:           false,
    canAirCondition:     false,
    canCruiseControl:    false,
    heading:             null,
    location:            null,
    gpsTracking:         false,
    gpsError:            null,
    gpsUnavailable:      false,
    gpsSource:           null,
    _vehicleSpeedTs:     0,
    updateVehicleState:  () => {},
    updateGPSState:      () => {},
    updateCanExtras:     () => {},
    resetCanData:        () => {},
    ...overrides,
  } as unknown as UnifiedVehicleState;
}

/** Boş SafetyQueueOutput sabiti (karşılaştırma testleri için). */
function emptyOutput(): SafetyQueueOutput {
  return {
    visibleAlerts: [],
    primaryBannerAlert: null,
    voiceAnnouncementAlert: null,
    muted: [],
    suppressed: [],
  };
}

// ── 1. safetyOutputsEqual testleri ───────────────────────────────────────────

describe('safetyOutputsEqual', () => {

  it('iki boş çıktı eşittir', () => {
    expect(safetyOutputsEqual(emptyOutput(), emptyOutput())).toBe(true);
  });

  it('voiceAnnouncementAlert null → ruleId olan: false', () => {
    const a = emptyOutput();
    const b = emptyOutput();
    b.voiceAnnouncementAlert = {
      ruleId: 'door.open.moving',
      level: 'critical',
      message: 'Kapı açık',
      icon: 'door',
      screen: 'banner',
      priority: 95,
      ts: T0,
    };
    expect(safetyOutputsEqual(a, b)).toBe(false);
  });

  it('yalnızca ts farklıysa (ruleId aynı) → true (ts kıyasa katılmaz)', () => {
    // İki çıktıda aynı ruleId ama farklı ts — eşit sayılmalı.
    const alert1 = {
      ruleId: 'door.open.moving',
      level: 'critical' as const,
      message: 'Kapı açık',
      icon: 'door',
      screen: 'banner' as const,
      priority: 95,
      ts: T0,
    };
    const alert2 = { ...alert1, ts: T0 + 500 };

    const a: SafetyQueueOutput = {
      visibleAlerts: [alert1],
      primaryBannerAlert: alert1,
      voiceAnnouncementAlert: null,
      muted: [],
      suppressed: [],
    };
    const b: SafetyQueueOutput = {
      visibleAlerts: [alert2],
      primaryBannerAlert: alert2,
      voiceAnnouncementAlert: null,
      muted: [],
      suppressed: [],
    };
    expect(safetyOutputsEqual(a, b)).toBe(true);
  });

  it('suppressed farklı → false', () => {
    const a = emptyOutput();
    const b = emptyOutput();
    b.suppressed = ['engine.overheat'];
    expect(safetyOutputsEqual(a, b)).toBe(false);
  });

  it('muted farklı → false', () => {
    const a = emptyOutput();
    const b = emptyOutput();
    b.muted = ['door.open.moving'];
    expect(safetyOutputsEqual(a, b)).toBe(false);
  });

  it('visibleAlerts farklı ruleId → false', () => {
    const baseAlert = {
      ruleId: 'door.open.moving',
      level: 'critical' as const,
      message: 'Kapı açık',
      icon: 'door',
      screen: 'banner' as const,
      priority: 95,
      ts: T0,
    };
    const otherAlert = { ...baseAlert, ruleId: 'engine.overheat' };

    const a: SafetyQueueOutput = { ...emptyOutput(), visibleAlerts: [baseAlert] };
    const b: SafetyQueueOutput = { ...emptyOutput(), visibleAlerts: [otherAlert] };
    expect(safetyOutputsEqual(a, b)).toBe(false);
  });

  it('aynı ruleId içerikle visibleAlerts → true', () => {
    const alert = {
      ruleId: 'engine.overheat',
      level: 'critical' as const,
      message: 'Aşırı ısınma',
      icon: 'temp',
      screen: 'banner' as const,
      priority: 100,
      ts: T0,
    };
    const a: SafetyQueueOutput = { ...emptyOutput(), visibleAlerts: [alert] };
    const b: SafetyQueueOutput = { ...emptyOutput(), visibleAlerts: [{ ...alert, ts: T0 + 1 }] };
    expect(safetyOutputsEqual(a, b)).toBe(true);
  });

  it('visibleAlerts length farklı → false', () => {
    const alert = {
      ruleId: 'engine.overheat',
      level: 'critical' as const,
      message: 'Aşırı ısınma',
      icon: 'temp',
      screen: 'banner' as const,
      priority: 100,
      ts: T0,
    };
    const a: SafetyQueueOutput = { ...emptyOutput(), visibleAlerts: [alert] };
    const b = emptyOutput();
    expect(safetyOutputsEqual(a, b)).toBe(false);
  });

});

// ── 2. computeSafetyTick — repeat announcement (store değişmeden) ─────────────

describe('computeSafetyTick — ses tekrarı (store sabit, now ilerler)', () => {

  /**
   * Sabit araç durumu: kapı açık, hız=10, _vehicleSpeedTs taze.
   * Girdi HİÇ DEĞİŞMEZ — yalnızca now artar.
   * Engine bu koşulda 'door.open.moving' üretir.
   * Queue: debounceMs=800, repeatSec=20, maxRepeats=3.
   */
  function makeDoorOpenV(nowRef: number): UnifiedVehicleState {
    return makeV({
      canDoorOpen: true,
      speed: 10,
      _vehicleSpeedTs: nowRef - 100, // her zaman taze (100ms önce)
    });
  }

  it('t=0: debounce dolmadı → visibleAlerts boş, voice null', () => {
    const queue = new SafetyAlertQueue();
    const v = makeDoorOpenV(T0);
    const { output, hasActiveAlerts } = computeSafetyTick(queue, v, T0);
    expect(output.visibleAlerts).toHaveLength(0);
    expect(output.voiceAnnouncementAlert).toBeNull();
    // Engine 'door.open.moving' üretiyor → hasActiveAlerts true (debounce bekliyor)
    expect(hasActiveAlerts).toBe(true);
  });

  it('t=800: debounce onaylandı → door.open.moving visible + voice (announceCount 1)', () => {
    const queue = new SafetyAlertQueue();
    // İlk tick: debounce başlat
    computeSafetyTick(queue, makeDoorOpenV(T0), T0);
    // 800ms: onay
    const { output } = computeSafetyTick(queue, makeDoorOpenV(T0 + 800), T0 + 800);
    expect(output.visibleAlerts.find((a) => a.ruleId === 'door.open.moving')).toBeDefined();
    expect(output.voiceAnnouncementAlert?.ruleId).toBe('door.open.moving');
  });

  it('t=801 .. t=20799: cooldown içinde → voice null', () => {
    const queue = new SafetyAlertQueue();
    computeSafetyTick(queue, makeDoorOpenV(T0), T0);
    computeSafetyTick(queue, makeDoorOpenV(T0 + 800), T0 + 800); // 1. ses
    // Cooldown içi (repeatSec=20 → 20000ms)
    const mid = T0 + 800 + 10_000;
    const { output } = computeSafetyTick(queue, makeDoorOpenV(mid), mid);
    expect(output.voiceAnnouncementAlert).toBeNull();
    // Ama görsel hâlâ mevcut
    expect(output.visibleAlerts.find((a) => a.ruleId === 'door.open.moving')).toBeDefined();
  });

  it('t≈800+20000: cooldown doldu → 2. ses üretilir', () => {
    const queue = new SafetyAlertQueue();
    computeSafetyTick(queue, makeDoorOpenV(T0), T0);
    computeSafetyTick(queue, makeDoorOpenV(T0 + 800), T0 + 800); // 1. ses
    const t2 = T0 + 800 + 20_000;
    const { output } = computeSafetyTick(queue, makeDoorOpenV(t2), t2);
    expect(output.voiceAnnouncementAlert?.ruleId).toBe('door.open.moving');
  });

});

// ── 3. computeSafetyTick — debounce (store değişmeden, now ilerler) ───────────

describe('computeSafetyTick — debounce (store sabit, now ilerler)', () => {

  it('t=0: visibleAlerts boş (debounce=800ms başlamadı)', () => {
    const queue = new SafetyAlertQueue();
    const v = makeV({ canDoorOpen: true, speed: 10, _vehicleSpeedTs: T0 - 100 });
    const { output } = computeSafetyTick(queue, v, T0);
    expect(output.visibleAlerts).toHaveLength(0);
  });

  it('t=900: debounce geçti → door.open.moving visible', () => {
    const queue = new SafetyAlertQueue();
    // İlk tick: debounce başlat
    computeSafetyTick(queue, makeV({ canDoorOpen: true, speed: 10, _vehicleSpeedTs: T0 - 100 }), T0);
    // 900ms: 800ms debounce geçti, _vehicleSpeedTs hâlâ taze
    const t900 = T0 + 900;
    const v2 = makeV({ canDoorOpen: true, speed: 10, _vehicleSpeedTs: t900 - 100 });
    const { output } = computeSafetyTick(queue, v2, t900);
    expect(output.visibleAlerts.find((a) => a.ruleId === 'door.open.moving')).toBeDefined();
  });

});

// ── 4. createSafetyTicker — interval yaşam döngüsü ───────────────────────────

describe('createSafetyTicker — interval yaşam döngüsü', () => {

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('sync(true) → timer başlar (getTimerCount===1)', () => {
    const tick = vi.fn(() => true);
    const ticker = createSafetyTicker(500, tick);
    ticker.sync(true);
    expect(vi.getTimerCount()).toBe(1);
    ticker.dispose();
  });

  it('dispose() → timer silinir (getTimerCount===0)', () => {
    const tick = vi.fn(() => true);
    const ticker = createSafetyTicker(500, tick);
    ticker.sync(true);
    expect(vi.getTimerCount()).toBe(1);
    ticker.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('sync(true) + advanceTimersByTime(1500) → tick 3 kez çağrıldı', () => {
    const tick = vi.fn(() => true); // true → interval devam eder
    const ticker = createSafetyTicker(500, tick);
    ticker.sync(true);
    vi.advanceTimersByTime(1500);
    expect(tick).toHaveBeenCalledTimes(3);
    ticker.dispose();
  });

});

// ── 5. ticker: aktif alert yok → tick yok ────────────────────────────────────

describe('createSafetyTicker — aktif alert yokken timer kurulmaz', () => {

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('yeni ticker, sync(false) → getTimerCount===0', () => {
    const tick = vi.fn(() => false);
    const ticker = createSafetyTicker(500, tick);
    ticker.sync(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('tick false döndürünce interval kendini durdurur', () => {
    const tick = vi.fn(() => false); // ilk tetiklemede false → dur
    const ticker = createSafetyTicker(500, tick);
    ticker.sync(true); // başlat
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(500); // ilk tetikleme → tick false → dur
    expect(vi.getTimerCount()).toBe(0);
    expect(tick).toHaveBeenCalledTimes(1);
  });

});

// ── 6. ticker idempotency ─────────────────────────────────────────────────────

describe('createSafetyTicker — idempotency', () => {

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('sync(true) iki kez → tek timer (getTimerCount===1)', () => {
    const tick = vi.fn(() => true);
    const ticker = createSafetyTicker(500, tick);
    ticker.sync(true);
    ticker.sync(true);
    expect(vi.getTimerCount()).toBe(1);
    ticker.dispose();
  });

  it('dispose() iki kez → hata yok', () => {
    const tick = vi.fn(() => true);
    const ticker = createSafetyTicker(500, tick);
    ticker.sync(true);
    expect(() => {
      ticker.dispose();
      ticker.dispose();
    }).not.toThrow();
    expect(vi.getTimerCount()).toBe(0);
  });

});
