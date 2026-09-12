/**
 * obdHealthGates.test — P0-OBD-07 · SAĞLIK KAPILARININ kilitleri.
 *
 * Görev şartı: hot PID stall · genişletilmiş PID hâlâ canlı · tamamen kopmuş hat ·
 * reconnect · eski session · CAN mevcut/OBD kopuk senaryoları.
 *
 * ── BU TURUN SINIRI (kilitlenen en önemli şey) ────────────────────────────
 * Hat sağlığı YALNIZ tazelik otoritesi OLMAYAN yerlerde kapı olarak kullanılır.
 * Kanonik sinyaller (P0-OBD-02) kendi pencerelerinden geçer ve hat hükmü onları
 * EZMEZ — aksi hâlde çekirdek sustuğunda hâlâ akan genişletilmiş ölçümler
 * gereksiz yere susturulurdu.
 */

import { describe, it, expect, beforeEach } from 'vitest';

import {
  classifyFieldHealth, classifyLinkHealth, stallThresholdMs, isDecisionGrade,
  engineRunningFrom, ENGINE_RUNNING_RPM,
  type FieldHealth,
} from '../platform/obd/obdHealthModel';
import { evaluateEarlyWarnings } from '../platform/obd/earlyWarningEngine';
import {
  obdHealthMonitor, HEALTH_FIELDS, type HealthField, type FieldTimingSnapshot,
} from '../platform/obd/ObdHealthMonitor';
import {
  resolveLiveCanonicalSignal, readLiveObdSignal,
} from '../platform/vehicleDataLayer/canonicalVehicleSignal';
import type {
  ObdSignalEntry, UnifiedVehicleState,
} from '../platform/vehicleDataLayer/UnifiedVehicleStore';
import { useUnifiedVehicleStore } from '../platform/vehicleDataLayer/UnifiedVehicleStore';
import { createSafetyStateFromVehicleStore } from '../platform/safety/safetyStateMapper';

const T = 1_000_000;
const IV = 1_000;
const WALL = 1_700_000_000_000;

function timing(over: Partial<FieldTimingSnapshot> = {}): FieldTimingSnapshot {
  return {
    lastAcceptedAtMs: T, lastChangedAtMs: T, lastRejectedAtMs: null,
    lastNotOfferedAtMs: null, observedIntervalMs: IV,
    acceptedCount: 10, rejectedCount: 0, notOfferedCount: 0, ...over,
  };
}

/**
 * `timing` AÇIKÇA verilir. Varsayılana düşmek, "zamanlama yok" senaryosunu
 * sessizce "taze zamanlama"ya çevirir ve reconnect kilidini SAHTE geçirirdi —
 * bu tuzağa bir kez düşüldü, bu yüzden parametre zorunlu.
 */
function fieldAt(
  f: HealthField, nowMs: number, t: FieldTimingSnapshot | undefined, connected = true,
): FieldHealth {
  return classifyFieldHealth({
    field: f, timing: t, nowMs, expectedIntervalMs: IV, transportConnected: connected,
  });
}

function entry(value: number, over: Partial<ObdSignalEntry> = {}): ObdSignalEntry {
  return { value, atMs: WALL, epoch: 1, staleMs: 60_000, unavailableMs: 180_000, ...over };
}

function vstate(over: Partial<UnifiedVehicleState> = {}): UnifiedVehicleState {
  return { ...useUnifiedVehicleStore.getState(), ...over } as UnifiedVehicleState;
}

/* ── 1. SICAK PID STALL karar kapısını KAPATIR ────────────────────────────── */

describe('P0-OBD-07 · hot PID stall karar üretmez', () => {
  it('devir DURDUYSA karar kalitesinde DEĞİLDİR', () => {
    const stall = stallThresholdMs('rpm', IV);
    const f = fieldAt('rpm', T + stall + 1, timing());
    expect(f.state).toBe('STALLED');
    expect(isDecisionGrade(f.state)).toBe(false);
  });

  it('devir AKIYORSA karar kalitesindedir (kapı gereksiz kapanmaz)', () => {
    const f = fieldAt('rpm', T + 100, timing({ lastAcceptedAtMs: T + 50 }));
    expect(f.state).toBe('HEALTHY');
    expect(isDecisionGrade(f.state)).toBe(true);
  });

  it('DONMUŞ devir (ölçüm akıyor, değer sabit) karar kalitesini DÜŞÜRMEZ', () => {
    /* Park hâlinde devir 0 sabittir — bu bir arıza DEĞİLDİR ve motor durumu
       kararı üretilebilir olmalıdır. */
    const now = T + 100;
    const f = fieldAt('rpm', now, timing({
      lastAcceptedAtMs: now - 50, lastChangedAtMs: now - 600_000,
    }));
    expect(f.frozen).toBe(true);
    expect(isDecisionGrade(f.state)).toBe(true);
  });
});

/* ── 2. GENİŞLETİLMİŞ PID hâlâ canlıysa SUSTURULMAZ ───────────────────────── */

describe('P0-OBD-07 · çekirdek kötüyken genişletilmiş ölçüm susturulmaz', () => {
  beforeEach(() => {
    useUnifiedVehicleStore.getState().resetObdSignals();
    useUnifiedVehicleStore.setState({
      canCoolantTemp: null, canBatteryVolt: null, canAmbientTemp: null,
      canOilTemp: null, canThrottle: null,
    });
  });

  it('çekirdek hat STALLED iken TAZE kanonik ölçüm HÂLÂ geçerlidir', () => {
    /* Kanonik sinyalin otoritesi P0-OBD-02'dir ve hat hükmü onu EZMEZ.
       Ezseydi, ECU çekirdek PID'lere susarken hâlâ akan yakıt trimi çöpe
       atılırdı — bu turun bilinçle KAÇINDIĞI hata. */
    const link = classifyLinkHealth({
      transportConnected: true, dataFresh: true,
      fields: [fieldAt('rpm', T + stallThresholdMs('rpm', IV) + 1, timing())],
    });
    expect(link.state).toBe('STALLED');

    const st = vstate({
      obdSessionEpoch: 1,
      obdSignals: Object.freeze({ longFuelTrimB1: entry(14) }),
    });
    expect(readLiveObdSignal(st, 'longFuelTrimB1', WALL + 1_000)).toBe(14);
  });

  it('kanonik ölçüm KENDİ penceresini aşarsa yine de düşer (tek otorite)', () => {
    const st = vstate({
      obdSessionEpoch: 1,
      obdSignals: Object.freeze({ longFuelTrimB1: entry(14) }),
    });
    expect(readLiveObdSignal(st, 'longFuelTrimB1', WALL + 200_000)).toBeNull();
  });
});

/* ── 3. TAMAMEN KOPUK HAT ─────────────────────────────────────────────────── */

describe('P0-OBD-07 · kopuk hat', () => {
  it('taşıma yoksa her alan DISCONNECTED ve karar üretilemez', () => {
    for (const f of HEALTH_FIELDS) {
      const h = fieldAt(f, T + 100, timing(), false);
      expect(h.state).toBe('DISCONNECTED');
      expect(isDecisionGrade(h.state)).toBe(false);
    }
  });

  it('kopuk hatta yaş İDDİASI üretilmez', () => {
    expect(fieldAt('speed', T + 60_000, timing(), false).ageMs).toBeNull();
  });

  it('hat hükmü DISCONNECTED ve sayaçlar sıfır', () => {
    const link = classifyLinkHealth({ transportConnected: false, dataFresh: true, fields: [] });
    expect(link.state).toBe('DISCONNECTED');
    expect(isDecisionGrade(link.state)).toBe(false);
  });
});

/* ── 4. RECONNECT: yeni ölçüm gelmeden karar AÇILMAZ ──────────────────────── */

describe('P0-OBD-07 · reconnect sonrası kararlar kapalı kalır', () => {
  beforeEach(() => obdHealthMonitor.reset());

  it('reconnect anında tüm alanlar karar üretemez', () => {
    obdHealthMonitor.noteFieldSample('rpm', 'accepted', 2_000, T);
    obdHealthMonitor.noteFieldSample('speed', 'accepted', 50, T);
    expect(isDecisionGrade(fieldAt('rpm', T, obdHealthMonitor.snapshot(T).fieldTiming.rpm).state))
      .toBe(true);

    obdHealthMonitor.noteReconnect(T + 100);
    const snap = obdHealthMonitor.snapshot(T + 200);
    for (const f of ['rpm', 'speed'] as HealthField[]) {
      const h = fieldAt(f, T + 200, snap.fieldTiming[f]);
      expect(h.state, `${f} reconnect sonrası taze görünüyor`).toBe('STALLED');
      expect(isDecisionGrade(h.state)).toBe(false);
    }
  });

  it('GERÇEK yeni ölçüm gelince karar YENİDEN açılır', () => {
    obdHealthMonitor.noteFieldSample('rpm', 'accepted', 2_000, T);
    obdHealthMonitor.noteReconnect(T + 100);
    obdHealthMonitor.noteFieldSample('rpm', 'accepted', 800, T + 200);   // yeni oturumun İLK ölçümü
    const snap = obdHealthMonitor.snapshot(T + 250);
    expect(isDecisionGrade(fieldAt('rpm', T + 250, snap.fieldTiming.rpm).state)).toBe(true);
  });

  it('reconnect sonrası SADECE bir alan ölçülürse diğerleri kapalı KALIR', () => {
    obdHealthMonitor.noteReconnect(T);
    obdHealthMonitor.noteFieldSample('rpm', 'accepted', 900, T + 50);
    const snap = obdHealthMonitor.snapshot(T + 60);
    expect(isDecisionGrade(fieldAt('rpm', T + 60, snap.fieldTiming.rpm).state)).toBe(true);
    expect(isDecisionGrade(fieldAt('speed', T + 60, snap.fieldTiming.speed).state))
      .toBe(false);
  });
});

/* ── 5. ESKİ SESSION verisi ───────────────────────────────────────────────── */

describe('P0-OBD-07 · eski oturum verisi karar üretmez', () => {
  beforeEach(() => {
    useUnifiedVehicleStore.getState().resetObdSignals();
    useUnifiedVehicleStore.setState({ canCoolantTemp: null });
  });

  it('kanonik kayıt ÖNCEKİ oturuma aitse Guardian onu GÖRMEZ', () => {
    const v = vstate({
      canCoolantTemp: null, obdSessionEpoch: 2,
      obdSignals: Object.freeze({ coolantTemp: entry(118, { epoch: 1 }) }),
    });
    expect(resolveLiveCanonicalSignal(v, 'coolantTemp', WALL).value).toBeNull();
    expect(createSafetyStateFromVehicleStore(v, { wallClockMs: WALL }).state.coolantTemp)
      .toBeNull();
  });

  it('sağlık monitörü de eski oturumun damgasını taşımaz', () => {
    obdHealthMonitor.reset();
    obdHealthMonitor.noteFieldSample('speed', 'accepted', 50, T);
    obdHealthMonitor.noteConnected(T + 10);            // YENİ oturum
    expect(obdHealthMonitor.snapshot(T + 20).fieldTiming.speed?.lastAcceptedAtMs ?? null)
      .toBeNull();
  });
});

/* ── 6. CAN VAR / OBD KOPUK — Guardian'ın OBD dışı kaynakları kapanmaz ───── */

describe('P0-OBD-07 · CAN mevcut, OBD kopuk', () => {
  beforeEach(() => {
    useUnifiedVehicleStore.getState().resetObdSignals();
    useUnifiedVehicleStore.setState({
      canCoolantTemp: null, canBatteryVolt: null, canDoorOpen: false,
      canParkingBrake: false, canSeatbelt: false, reverse: false, speed: null,
    });
  });

  it('OBD kopukken CAN motor ısısı HÂLÂ Guardian\'a ulaşır', () => {
    const v = vstate({ canCoolantTemp: 118, obdSignals: Object.freeze({}) });
    const { state } = createSafetyStateFromVehicleStore(v, { wallClockMs: WALL });
    expect(state.coolantTemp).toBe(118);
  });

  it('OBD kopukken CAN gövde sinyalleri (kapı/el freni/geri) KAPANMAZ', () => {
    /* Guardian'ın OBD DIŞI güvenlik kaynakları hat sağlığından ETKİLENMEZ —
       aksi hâlde OBD adaptörü çekilince geri vites kamerası ve açık kapı
       uyarısı da susardı. */
    const v = vstate({
      reverse: true, canDoorOpen: true, canParkingBrake: true,
      obdSignals: Object.freeze({}),
    });
    const { state } = createSafetyStateFromVehicleStore(v, { wallClockMs: WALL });
    expect(state.reverse).toBe(true);
    expect(state.doorOpen).toBe(true);
    expect(state.parkingBrake).toBe(true);
  });

  it('OBD sağlığı DISCONNECTED iken bile CAN akü voltajı karar üretir', () => {
    const v = vstate({ canBatteryVolt: 11.4, obdSignals: Object.freeze({}) });
    expect(createSafetyStateFromVehicleStore(v, { wallClockMs: WALL }).state.batteryVolt)
      .toBe(11.4);
  });

  it('hem CAN hem OBD yoksa null KALIR — sahte değer ÜRETİLMEZ', () => {
    const v = vstate({ canCoolantTemp: null, obdSignals: Object.freeze({}) });
    expect(createSafetyStateFromVehicleStore(v, { wallClockMs: WALL }).state.coolantTemp)
      .toBeNull();
  });
});

/* ── 7. MOTOR DURUMU KAPISI (saf — mock YOK, deterministik) ───────────────── */

describe('P0-OBD-07 · motor durumu kapısı', () => {
  it('devir SAĞLIKLI ve yüksekse motor ÇALIŞIYOR', () => {
    expect(engineRunningFrom('HEALTHY', 2_000)).toBe(true);
    expect(engineRunningFrom('DEGRADED', 2_000)).toBe(true);   // zayıf ama karar kalitesinde
  });

  it('devir SAĞLIKLI ve düşükse motor DURUYOR', () => {
    expect(engineRunningFrom('HEALTHY', 0)).toBe(false);
    expect(engineRunningFrom('HEALTHY', ENGINE_RUNNING_RPM)).toBe(false);
  });

  it('devir DURDUYSA cevap BİLİNMİYOR — "çalışıyor" DA "duruyor" DA denmez', () => {
    /* Donmuş 2000 devir "motor çalışıyor" sanılırsa, ölü bir hattın son
       değeriyle şarj/termostat/trim kuralları çalıştırılır. */
    expect(engineRunningFrom('STALLED', 2_000)).toBeNull();
    expect(engineRunningFrom('STALLED', 0)).toBeNull();
  });

  it('hat KOPUKSA da cevap BİLİNMİYOR', () => {
    expect(engineRunningFrom('DISCONNECTED', 2_000)).toBeNull();
  });

  it('sağlık OKUNAMAZSA kapı uygulanmaz (fail-soft, eski davranış)', () => {
    expect(engineRunningFrom(null, 2_000)).toBe(true);
    expect(engineRunningFrom(null, 0)).toBe(false);
  });

  it('geçersiz devir değeri her hâlde BİLİNMİYOR üretir', () => {
    expect(engineRunningFrom('HEALTHY', undefined)).toBeNull();
    expect(engineRunningFrom('HEALTHY', Number.NaN)).toBeNull();
    expect(engineRunningFrom('HEALTHY', -1)).toBeNull();
  });

  it('BİLİNMİYOR bağlamı motor-bağımlı kuralı SUSTURUR (uçtan uca)', () => {
    /* Kapının ürün etkisi: `evaluateEarlyWarnings` motor durumu bilinmiyorken
       fail-closed davranır ve hüküm ÜRETMEZ. */
    const win = { available: true, samples: Array.from({ length: 20 },
      (_, i) => ({ t: T + i * 15_000, value: 12.2 })) };
    const out = evaluateEarlyWarnings({
      windows: new Map([['moduleVoltage', win]]),
      engineRunning: engineRunningFrom('STALLED', 2_000),
    });
    const r = out.find((x) => x.id === 'charging_system_weak')!;
    expect(r.verdict).toBe('INSUFFICIENT_DATA');
    expect(r.reason).toContain('bilinmiyor');
  });

  it('SAĞLIKLI bağlamda aynı veri hüküm ÜRETİR (kapı gereksiz kapanmıyor)', () => {
    const win = { available: true, samples: Array.from({ length: 20 },
      (_, i) => ({ t: T + i * 15_000, value: 12.2 })) };
    const out = evaluateEarlyWarnings({
      windows: new Map([['moduleVoltage', win]]),
      engineRunning: engineRunningFrom('HEALTHY', 2_000),
    });
    const r = out.find((x) => x.id === 'charging_system_weak')!;
    expect(['WATCH', 'ATTENTION']).toContain(r.verdict);
  });
});
