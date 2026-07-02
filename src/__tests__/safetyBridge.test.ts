/**
 * safetyBridge birim testleri — FAZ 2.5
 *
 * createSafetyStateFromVehicleStore + computeSafetyOutput üzerinden
 * CAN/OBD → Safety zincirinin uçtan uca doğrulanması.
 *
 * React harness GEREKMEDEİ: mapper ve orchestrator saf/React-bağımsız.
 * UnifiedVehicleStore gerçek Zustand instance'ı sürülmez —
 * plain obje (UnifiedVehicleState şeklinde) cast'i ile çalışılır.
 * Mapper yalnızca veri alanlarını okur, action çağırmaz.
 *
 * DETERMINİZM: Date.now() / Math.random() kullanılmaz.
 * Tüm zaman kararları sabit referans değerleri üzerinden yapılır.
 */

import { describe, it, expect } from 'vitest';
import {
  createSafetyStateFromVehicleStore,
  computeSafetyOutput,
} from '../platform/safety/safetyStateMapper';
import { SafetyAlertQueue } from '../platform/safety/SafetyAlertQueue';
import type { UnifiedVehicleState } from '../platform/vehicleDataLayer/UnifiedVehicleStore';

// ── Test yardımcıları ─────────────────────────────────────────────────────────

/**
 * Minimal UnifiedVehicleState stub.
 * Yalnızca mapper'ın okuduğu alanlar doldurulur; action'lar boş stub.
 * as unknown as UnifiedVehicleState cast: action alanları test kapsamı dışı.
 */
function makeVehicleState(
  overrides: Partial<
    Pick<
      UnifiedVehicleState,
      | 'speed'
      | 'reverse'
      | 'fuel'
      | 'canDoorOpen'
      | 'canParkingBrake'
      | 'canCoolantTemp'
      | 'canBatteryVolt'
      | 'canSeatbelt'
      | 'canHeadlights'
      | '_vehicleSpeedTs'
    >
  >,
): UnifiedVehicleState {
  return {
    // Sayısal başlangıç
    speed:          null,
    rpm:            undefined,
    fuel:           null,
    odometer:       0,
    // Boolean başlangıç (CAN sıfırlanmış durumu — resetCanData() sonrası)
    reverse:        false,
    canDoorOpen:    false,
    canHeadlights:  false,
    canHighBeam:    false,
    canTurnLeft:    false,
    canTurnRight:   false,
    canHazard:      false,
    canTpmsKpa:     null,
    canRpm:         null,
    canCoolantTemp: null,
    canOilTemp:     null,
    canThrottle:    null,
    canBatteryVolt: null,
    canGearPos:     null,
    canAmbientTemp: null,
    canAbs:              false,
    canTractionControl:  false,
    canStabilityControl: false,
    canParkingBrake:     false,
    canSeatbelt:         false,
    canWipers:           false,
    canAirCondition:     false,
    canCruiseControl:    false,
    heading:        null,
    location:       null,
    gpsTracking:    false,
    gpsError:       null,
    gpsUnavailable: false,
    gpsSource:      null,
    // Timestamp: 0 → stale olarak yorumlanabilir (güvenli başlangıç)
    _vehicleSpeedTs: 0,
    // Stub actions (mapper hiçbirini çağırmaz)
    updateVehicleState: () => {},
    updateGPSState:     () => {},
    updateCanExtras:    () => {},
    resetCanData:       () => {},
    ...overrides,
  } as unknown as UnifiedVehicleState;
}

// Sabit referans zamanı (ms) — performance.now() yerine sabit
const T0 = 10_000_000;

// ── createSafetyStateFromVehicleStore birim testleri ─────────────────────────

describe('createSafetyStateFromVehicleStore — mapper birim testleri', () => {

  describe('doğrudan eşlemeler', () => {
    it('speed null → state.speed null, updatedAt.speed YOK', () => {
      const v = makeVehicleState({ speed: null, _vehicleSpeedTs: T0 });
      const { state, updatedAt } = createSafetyStateFromVehicleStore(v);
      expect(state.speed).toBeNull();
      expect(updatedAt.speed).toBeUndefined();
    });

    it('speed number → state.speed kopyalanır, updatedAt.speed = _vehicleSpeedTs', () => {
      const v = makeVehicleState({ speed: 60, _vehicleSpeedTs: T0 - 500 });
      const { state, updatedAt } = createSafetyStateFromVehicleStore(v);
      expect(state.speed).toBe(60);
      expect(updatedAt.speed).toBe(T0 - 500);
    });

    it('reverse doğrudan map edilir', () => {
      const v = makeVehicleState({ reverse: true });
      const { state } = createSafetyStateFromVehicleStore(v);
      expect(state.reverse).toBe(true);
    });

    it('canDoorOpen → doorOpen', () => {
      const v = makeVehicleState({ canDoorOpen: true });
      const { state } = createSafetyStateFromVehicleStore(v);
      expect(state.doorOpen).toBe(true);
    });

    it('canParkingBrake → parkingBrake', () => {
      const v = makeVehicleState({ canParkingBrake: true });
      const { state } = createSafetyStateFromVehicleStore(v);
      expect(state.parkingBrake).toBe(true);
    });

    it('canCoolantTemp → coolantTemp (number)', () => {
      const v = makeVehicleState({ canCoolantTemp: 95 });
      const { state } = createSafetyStateFromVehicleStore(v);
      expect(state.coolantTemp).toBe(95);
    });

    it('fuel doğrudan map edilir', () => {
      const v = makeVehicleState({ fuel: 5 });
      const { state } = createSafetyStateFromVehicleStore(v);
      expect(state.fuel).toBe(5);
    });

    it('canBatteryVolt → batteryVolt', () => {
      const v = makeVehicleState({ canBatteryVolt: 11.5 });
      const { state } = createSafetyStateFromVehicleStore(v);
      expect(state.batteryVolt).toBe(11.5);
    });
  });

  describe('store\'da olmayan alanlar daima undefined', () => {
    it('hoodOpen daima undefined', () => {
      const v = makeVehicleState({});
      const { state } = createSafetyStateFromVehicleStore(v);
      expect(state.hoodOpen).toBeUndefined();
    });

    it('trunkOpen daima undefined', () => {
      const v = makeVehicleState({});
      const { state } = createSafetyStateFromVehicleStore(v);
      expect(state.trunkOpen).toBeUndefined();
    });

    it('oilWarning daima undefined', () => {
      const v = makeVehicleState({});
      const { state } = createSafetyStateFromVehicleStore(v);
      expect(state.oilWarning).toBeUndefined();
    });
  });

  describe('isDark gating', () => {
    it('opts.isDark=true → state.isDark=true', () => {
      const v = makeVehicleState({});
      const { state } = createSafetyStateFromVehicleStore(v, { isDark: true });
      expect(state.isDark).toBe(true);
    });

    it('opts.isDark=false → state.isDark=false', () => {
      const v = makeVehicleState({});
      const { state } = createSafetyStateFromVehicleStore(v, { isDark: false });
      expect(state.isDark).toBe(false);
    });

    it('opts verilmemiş → state.isDark=undefined', () => {
      const v = makeVehicleState({});
      const { state } = createSafetyStateFromVehicleStore(v);
      expect(state.isDark).toBeUndefined();
    });
  });

  describe('seatbelt yanlış-alarm gating', () => {
    it('signalsAvailable verilmemiş → seatbelt undefined (canSeatbelt=false olsa da)', () => {
      // Store default: canSeatbelt=false. Sinyal mevcudiyeti bildirilmediği için
      // kural engine'e undefined geçer → tetiklenmez.
      const v = makeVehicleState({ canSeatbelt: false });
      const { state } = createSafetyStateFromVehicleStore(v);
      expect(state.seatbelt).toBeUndefined();
    });

    it('signalsAvailable.seatbelt=false → seatbelt undefined', () => {
      const v = makeVehicleState({ canSeatbelt: false });
      const { state } = createSafetyStateFromVehicleStore(v, {
        signalsAvailable: { seatbelt: false },
      });
      expect(state.seatbelt).toBeUndefined();
    });

    it('signalsAvailable.seatbelt=true → canSeatbelt değeri geçirilir', () => {
      const v = makeVehicleState({ canSeatbelt: false });
      const { state } = createSafetyStateFromVehicleStore(v, {
        signalsAvailable: { seatbelt: true },
      });
      expect(state.seatbelt).toBe(false); // false → kural tetiklenebilir
    });
  });

  describe('headlights yanlış-alarm gating', () => {
    it('signalsAvailable verilmemiş → headlightsOn undefined', () => {
      const v = makeVehicleState({ canHeadlights: false });
      const { state } = createSafetyStateFromVehicleStore(v);
      expect(state.headlightsOn).toBeUndefined();
    });

    it('signalsAvailable.headlights=true → canHeadlights değeri geçirilir', () => {
      const v = makeVehicleState({ canHeadlights: false });
      const { state } = createSafetyStateFromVehicleStore(v, {
        signalsAvailable: { headlights: true },
      });
      expect(state.headlightsOn).toBe(false);
    });
  });
});

// ── computeSafetyOutput entegrasyon testleri ──────────────────────────────────

describe('computeSafetyOutput — uçtan uca zincir testleri', () => {

  describe('door open + speed > 5 (debounce 800ms)', () => {
    it('debounce dolmadan (t=0) alert görünmez', () => {
      const queue = new SafetyAlertQueue();
      const v = makeVehicleState({
        canDoorOpen: true,
        speed: 10,
        _vehicleSpeedTs: T0 - 100, // taze (100ms önce)
      });
      const out = computeSafetyOutput(queue, v, T0);
      expect(out.primaryBannerAlert).toBeNull();
      const found = out.visibleAlerts.find((a) => a.ruleId === 'door.open.moving');
      expect(found).toBeUndefined();
    });

    it('debounce dolunca (t=800) door.open.moving görünür ve primaryBannerAlert olur', () => {
      const queue = new SafetyAlertQueue();
      const v = makeVehicleState({
        canDoorOpen: true,
        speed: 10,
        _vehicleSpeedTs: T0 - 100, // taze
      });
      // İlk çağrı: debounce başlatır
      computeSafetyOutput(queue, v, T0);
      // 800ms sonrası: debounce tamamlandı
      const out = computeSafetyOutput(queue, v, T0 + 800);
      expect(out.primaryBannerAlert?.ruleId).toBe('door.open.moving');
      const found = out.visibleAlerts.find((a) => a.ruleId === 'door.open.moving');
      expect(found).toBeDefined();
    });
  });

  describe('parking_brake + speed > 7 (debounce 1000ms)', () => {
    it('debounce dolunca (t=1000) parking_brake.moving görünür', () => {
      const queue = new SafetyAlertQueue();
      const v = makeVehicleState({
        canParkingBrake: true,
        speed: 10,
        _vehicleSpeedTs: T0 - 100,
      });
      computeSafetyOutput(queue, v, T0);
      const out = computeSafetyOutput(queue, v, T0 + 1000);
      expect(out.primaryBannerAlert?.ruleId).toBe('parking_brake.moving');
    });
  });

  describe('stale signal — engine speed stale kontrolü', () => {
    it('updatedAt.speed çok eski → door.open.moving TETİKLENMEZ', () => {
      // _vehicleSpeedTs = T0-3000: speed 3 saniye önce güncellendi
      // now = T0: engine STALE_GENERAL=2000ms → 3000>2000 → speed stale → kural sönük
      const queue = new SafetyAlertQueue();
      const v = makeVehicleState({
        canDoorOpen: true,
        speed: 10,
        _vehicleSpeedTs: T0 - 3000, // stale (2000ms sınırı aşıldı)
      });
      // Birden fazla tick ile debounce geçilse bile stale olduğundan kural üretilmez
      computeSafetyOutput(queue, v, T0);
      const out = computeSafetyOutput(queue, v, T0 + 1000);
      const found = out.visibleAlerts.find((a) => a.ruleId === 'door.open.moving');
      expect(found).toBeUndefined();
    });

    it('taze speed (_vehicleSpeedTs yakın) → door.open.moving tetiklenebilir', () => {
      // Pozitif kanıt: _vehicleSpeedTs taze olunca tetiklenir (mapper doğru geçirir)
      const queue = new SafetyAlertQueue();
      const v = makeVehicleState({
        canDoorOpen: true,
        speed: 10,
        _vehicleSpeedTs: T0 - 100, // taze
      });
      computeSafetyOutput(queue, v, T0);
      const out = computeSafetyOutput(queue, v, T0 + 800);
      const found = out.visibleAlerts.find((a) => a.ruleId === 'door.open.moving');
      expect(found).toBeDefined();
    });
  });

  describe('missing signal — seatbelt undefined gating', () => {
    it('signalsAvailable verilmemiş → seatbelt.unfastened.moving TETİKLENMEZ (speed=20, canSeatbelt=false)', () => {
      const queue = new SafetyAlertQueue();
      // signalsAvailable yok → seatbelt undefined → engine tetiklemez
      const v = makeVehicleState({
        canSeatbelt: false,
        speed: 20,
        _vehicleSpeedTs: T0 - 100,
      });
      computeSafetyOutput(queue, v, T0);
      const out = computeSafetyOutput(queue, v, T0 + 2000); // debounce=2000ms
      const found = out.visibleAlerts.find((a) => a.ruleId === 'seatbelt.unfastened.moving');
      expect(found).toBeUndefined();
    });

    it('signalsAvailable.seatbelt=true → kural tetiklenebilir (debounce 2000ms sonrası)', () => {
      const queue = new SafetyAlertQueue();
      // Her iki çağrıda da aynı opts kullanılır — ilk çağrıda opts yoksa
      // engine undefined görür, track oluşmaz, debounce başlamaz.
      // DİKKAT: _vehicleSpeedTs her tick için now-100 olmalı; aksi halde
      // debounce süresi (2000ms) sonunda speed stale sayılır (STALE_GENERAL=2000ms).
      const opts = { signalsAvailable: { seatbelt: true as const } };
      const v0 = makeVehicleState({ canSeatbelt: false, speed: 20, _vehicleSpeedTs: T0 - 100 });
      const v2 = makeVehicleState({ canSeatbelt: false, speed: 20, _vehicleSpeedTs: T0 + 2000 - 100 });
      computeSafetyOutput(queue, v0, T0, opts);         // debounce başlar
      const out = computeSafetyOutput(queue, v2, T0 + 2000, opts); // debounce tamamlandı, speed taze
      const found = out.visibleAlerts.find((a) => a.ruleId === 'seatbelt.unfastened.moving');
      expect(found).toBeDefined();
    });

    it('hood/trunk/oilWarning undefined → ilgili kurallar hiçbir zaman tetiklenmez', () => {
      const queue = new SafetyAlertQueue();
      // Store'da bu alanlar yok; mapper daima undefined geçirir
      const v = makeVehicleState({ speed: 30, _vehicleSpeedTs: T0 - 100 });
      computeSafetyOutput(queue, v, T0);
      const out = computeSafetyOutput(queue, v, T0 + 1500);
      const hoodFound = out.visibleAlerts.find((a) => a.ruleId === 'hood_or_trunk.open.moving');
      const oilFound  = out.visibleAlerts.find((a) => a.ruleId === 'battery_or_oil.warning');
      expect(hoodFound).toBeUndefined();
      // oilWarning undefined → oilFault false → battFault da false (volt null) → kural yok
      expect(oilFound).toBeUndefined();
    });
  });

  describe('condition clear — koşul kalktığında alert silinir', () => {
    it('door true → debounce sonrası görünür; door false → alert silinir; tekrar true → debounce baştan', () => {
      const queue = new SafetyAlertQueue();
      const vOpen = makeVehicleState({
        canDoorOpen: true,
        speed: 10,
        _vehicleSpeedTs: T0 - 100,
      });
      // Kapı açık, debounce tamamlandı
      computeSafetyOutput(queue, vOpen, T0);
      const outOpen = computeSafetyOutput(queue, vOpen, T0 + 800);
      expect(outOpen.visibleAlerts.find((a) => a.ruleId === 'door.open.moving')).toBeDefined();

      // Kapı kapandı — alert silinmeli
      const vClosed = makeVehicleState({
        canDoorOpen: false,
        speed: 10,
        _vehicleSpeedTs: T0 + 900 - 100,
      });
      const outClosed = computeSafetyOutput(queue, vClosed, T0 + 900);
      expect(outClosed.visibleAlerts.find((a) => a.ruleId === 'door.open.moving')).toBeUndefined();
      expect(outClosed.primaryBannerAlert).toBeNull();

      // Kapı tekrar açıldı — debounce baştan başlamalı (0ms'de görünmez)
      const vReOpen = makeVehicleState({
        canDoorOpen: true,
        speed: 10,
        _vehicleSpeedTs: T0 + 950 - 100,
      });
      const outReOpen = computeSafetyOutput(queue, vReOpen, T0 + 950);
      expect(outReOpen.visibleAlerts.find((a) => a.ruleId === 'door.open.moving')).toBeUndefined();
    });
  });

  describe('queue state korunuyor — ardışık çağrılar', () => {
    it('aynı queue örneğiyle ardışık çağrılar debounce sayacını korur', () => {
      const queue = new SafetyAlertQueue();
      const v = makeVehicleState({
        canDoorOpen: true,
        speed: 10,
        _vehicleSpeedTs: T0 - 100,
      });

      // İlk çağrı: debounce başlatır, henüz görünmez
      const out0 = computeSafetyOutput(queue, v, T0);
      expect(out0.visibleAlerts.find((a) => a.ruleId === 'door.open.moving')).toBeUndefined();

      // 800ms sonra: debounce tamamlandı, görünür
      const out800 = computeSafetyOutput(queue, v, T0 + 800);
      expect(out800.visibleAlerts.find((a) => a.ruleId === 'door.open.moving')).toBeDefined();
      // İlk ses üretildi
      expect(out800.voiceAnnouncementAlert?.ruleId).toBe('door.open.moving');
    });

    it('reset() sonrası debounce sayacı sıfırlanır', () => {
      const queue = new SafetyAlertQueue();
      const v = makeVehicleState({
        canDoorOpen: true,
        speed: 10,
        _vehicleSpeedTs: T0 - 100,
      });

      // Debounce tamamla
      computeSafetyOutput(queue, v, T0);
      const outBefore = computeSafetyOutput(queue, v, T0 + 800);
      expect(outBefore.visibleAlerts.find((a) => a.ruleId === 'door.open.moving')).toBeDefined();

      // Reset
      queue.reset();

      // Reset sonrası aynı tick'te debounce yeniden başlar, görünmez
      const outAfterReset = computeSafetyOutput(queue, v, T0 + 801);
      expect(outAfterReset.visibleAlerts.find((a) => a.ruleId === 'door.open.moving')).toBeUndefined();
    });

    it('ses repeat sayacı ardışık çağrılarda artar', () => {
      // NOT: _vehicleSpeedTs her tick için now'a yakın olmalı.
      // Stale eşiği = 2000ms. Her çağrıda ts = now - 100 şeklinde güncelliyoruz.
      // makeVehicleState immutable değil; her tick için yeni obje kullanıyoruz.
      const queue = new SafetyAlertQueue();

      function makeV(now: number) {
        return makeVehicleState({
          canDoorOpen: true,
          speed: 10,
          _vehicleSpeedTs: now - 100, // her zaman taze
        });
      }

      // 1. ses: debounce başlat → tamamla
      computeSafetyOutput(queue, makeV(T0), T0);
      const out1 = computeSafetyOutput(queue, makeV(T0 + 800), T0 + 800); // ses 1
      expect(out1.voiceAnnouncementAlert?.ruleId).toBe('door.open.moving');

      // Cooldown içi: ses yok
      const outCooldown = computeSafetyOutput(queue, makeV(T0 + 1500), T0 + 1500);
      expect(outCooldown.voiceAnnouncementAlert).toBeNull();

      // 20sn geçince (800+20000): 2. ses
      const t2 = T0 + 800 + 20_000;
      const out2 = computeSafetyOutput(queue, makeV(t2), t2);
      expect(out2.voiceAnnouncementAlert?.ruleId).toBe('door.open.moving');

      // 3. ses (maxRepeats=3)
      const t3 = T0 + 800 + 40_000;
      const out3 = computeSafetyOutput(queue, makeV(t3), t3);
      expect(out3.voiceAnnouncementAlert?.ruleId).toBe('door.open.moving');

      // maxRepeats=3 aşıldı: 4. ses yok
      const t4 = T0 + 800 + 60_000;
      const out4 = computeSafetyOutput(queue, makeV(t4), t4);
      expect(out4.voiceAnnouncementAlert).toBeNull();
      // Ama görsel hâlâ mevcut (ses bitti, banner kalmaya devam eder)
      expect(out4.visibleAlerts.find((a) => a.ruleId === 'door.open.moving')).toBeDefined();
    });
  });
});
