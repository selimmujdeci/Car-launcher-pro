/**
 * canScenarios.test.ts — T2: CAN frame simülatörü senaryo testleri.
 *
 * canSimulator senaryolarını GERÇEK decode yolundan (parseCanLine → decodeFrame →
 * rawCanToAdapterData / applyProfileGate) geçirip UnifiedVehicleStore'a uygular ve
 * store state'inin doğru tepki verdiğini doğrular.
 *
 * Store yazma yolu üretimle birebir (index.ts):
 *   - reverse  → updateVehicleState({ reverse })   (güvenlik kritik; üretimde worker→SAB→store)
 *   - diğerleri→ updateCanExtras({ ... })           (CAN extras doğrudan store'a)
 *
 * Native CAN hot-path / worker fusion'a DOKUNULMAZ — yalnız decode ve store
 * sınırı doğrulanır. cameraService mock'lanır (reverse → openRearCamera tetikler).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/* ── cameraService mock: reverse store yazımı kamera açmaya çalışmasın ── */
vi.mock('../platform/cameraService', () => ({
  openRearCamera:  vi.fn().mockResolvedValue(undefined),
  closeRearCamera: vi.fn().mockResolvedValue(undefined),
}));

/* ── Imports (mock'lardan sonra) ── */
import { useUnifiedVehicleStore } from '../platform/vehicleDataLayer/UnifiedVehicleStore';
import type { CanAdapterData } from '../platform/vehicleDataLayer/types';
import { CAN_SCENARIOS, TEST_CAN_PROFILE, playCanScenario } from './sim/canSimulator';

/**
 * Decode edilmiş CanAdapterData'yı üretimdeki gibi store'a uygular.
 * index.ts: reverse worker yolundan updateVehicleState'e, kalanı updateCanExtras'a.
 */
function applyToStore(d: CanAdapterData): void {
  const s = useUnifiedVehicleStore.getState();
  if (d.reverse !== undefined) {
    s.updateVehicleState({ reverse: d.reverse });
  }
  s.updateCanExtras({
    doorOpen:      d.doorOpen,
    headlightsOn:  d.headlightsOn,
    parkingBrake:  d.parkingBrake,
    seatbelt:      d.seatbelt,
    gearPos:       d.gearPos ?? null,
  });
}

/** Senaryoyu çalıştır + store'a uygula. */
function run(scenario: typeof CAN_SCENARIOS[keyof typeof CAN_SCENARIOS]): void {
  playCanScenario(scenario, TEST_CAN_PROFILE, applyToStore);
}

/** Store'u bilinen temiz bir başlangıca çek. */
function resetStore(): void {
  const s = useUnifiedVehicleStore.getState();
  s.updateVehicleState({ reverse: false });
  s.resetCanData();
}

describe('T2 — CAN frame simülatörü senaryoları', () => {
  beforeEach(() => { resetStore(); });
  afterEach(() => { resetStore(); vi.clearAllMocks(); });

  // 1 — reverse=true
  it('REVERSE_ON: store.reverse true olur', () => {
    run(CAN_SCENARIOS.REVERSE_ON);
    expect(useUnifiedVehicleStore.getState().reverse).toBe(true);
  });

  // 2 — reverse=false
  it('REVERSE_OFF: store.reverse false olur', () => {
    run(CAN_SCENARIOS.REVERSE_ON);   // önce true yap
    expect(useUnifiedVehicleStore.getState().reverse).toBe(true);
    run(CAN_SCENARIOS.REVERSE_OFF);  // sonra false
    expect(useUnifiedVehicleStore.getState().reverse).toBe(false);
  });

  // 3 — doorOpen=true
  it('DOOR_OPEN: store.canDoorOpen true olur', () => {
    run(CAN_SCENARIOS.DOOR_OPEN);
    expect(useUnifiedVehicleStore.getState().canDoorOpen).toBe(true);
  });

  it('DOOR_CLOSED: store.canDoorOpen false olur', () => {
    run(CAN_SCENARIOS.DOOR_OPEN);
    expect(useUnifiedVehicleStore.getState().canDoorOpen).toBe(true);
    run(CAN_SCENARIOS.DOOR_CLOSED);
    expect(useUnifiedVehicleStore.getState().canDoorOpen).toBe(false);
  });

  // 4 — gear=P/R/N/D
  it('GEAR_PARK: canGearPos 0 (N/P)', () => {
    run(CAN_SCENARIOS.GEAR_PARK);
    expect(useUnifiedVehicleStore.getState().canGearPos).toBe(0);
  });

  it('GEAR_REVERSE: canGearPos -1', () => {
    run(CAN_SCENARIOS.GEAR_REVERSE);
    expect(useUnifiedVehicleStore.getState().canGearPos).toBe(-1);
  });

  it('GEAR_NEUTRAL: canGearPos 0', () => {
    run(CAN_SCENARIOS.GEAR_NEUTRAL);
    expect(useUnifiedVehicleStore.getState().canGearPos).toBe(0);
  });

  it('GEAR_DRIVE: canGearPos 1 (ileri)', () => {
    run(CAN_SCENARIOS.GEAR_DRIVE);
    expect(useUnifiedVehicleStore.getState().canGearPos).toBe(1);
  });

  // 5 — headlights on/off
  it('HEADLIGHTS_ON: canHeadlights true olur', () => {
    run(CAN_SCENARIOS.HEADLIGHTS_ON);
    expect(useUnifiedVehicleStore.getState().canHeadlights).toBe(true);
  });

  it('HEADLIGHTS_OFF: canHeadlights false olur', () => {
    run(CAN_SCENARIOS.HEADLIGHTS_ON);
    expect(useUnifiedVehicleStore.getState().canHeadlights).toBe(true);
    run(CAN_SCENARIOS.HEADLIGHTS_OFF);
    expect(useUnifiedVehicleStore.getState().canHeadlights).toBe(false);
  });

  // 6 — parkingBrake on/off
  it('PARKING_BRAKE_ON: canParkingBrake true olur', () => {
    run(CAN_SCENARIOS.PARKING_BRAKE_ON);
    expect(useUnifiedVehicleStore.getState().canParkingBrake).toBe(true);
  });

  it('PARKING_BRAKE_OFF: canParkingBrake false olur', () => {
    run(CAN_SCENARIOS.PARKING_BRAKE_ON);
    expect(useUnifiedVehicleStore.getState().canParkingBrake).toBe(true);
    run(CAN_SCENARIOS.PARKING_BRAKE_OFF);
    expect(useUnifiedVehicleStore.getState().canParkingBrake).toBe(false);
  });

  // Düşük riskli ek sinyal — emniyet kemeri
  it('SEATBELT_ON/OFF: canSeatbelt doğru güncellenir', () => {
    run(CAN_SCENARIOS.SEATBELT_ON);
    expect(useUnifiedVehicleStore.getState().canSeatbelt).toBe(true);
    run(CAN_SCENARIOS.SEATBELT_OFF);
    expect(useUnifiedVehicleStore.getState().canSeatbelt).toBe(false);
  });

  // 7 — bilinmeyen CAN ID → hiçbir state bozulmaz
  it('UNKNOWN_ID: profilde olmayan ID hiçbir state bozmaz', () => {
    // Bilinen iyi bir durum kur
    run(CAN_SCENARIOS.DOOR_OPEN);
    run(CAN_SCENARIOS.HEADLIGHTS_ON);
    run(CAN_SCENARIOS.GEAR_DRIVE);
    const before = useUnifiedVehicleStore.getState();
    const snap = {
      reverse:        before.reverse,
      canDoorOpen:    before.canDoorOpen,
      canHeadlights:  before.canHeadlights,
      canGearPos:     before.canGearPos,
      canParkingBrake:before.canParkingBrake,
    };

    run(CAN_SCENARIOS.UNKNOWN_ID);

    const after = useUnifiedVehicleStore.getState();
    expect(after.reverse).toBe(snap.reverse);
    expect(after.canDoorOpen).toBe(snap.canDoorOpen);
    expect(after.canHeadlights).toBe(snap.canHeadlights);
    expect(after.canGearPos).toBe(snap.canGearPos);
    expect(after.canParkingBrake).toBe(snap.canParkingBrake);
  });

  // 8 — imkânsız/decode edilemeyen frame → fail-soft
  it('MALFORMED: bozuk frame fırlatmaz ve state bozmaz (fail-soft)', () => {
    run(CAN_SCENARIOS.DOOR_OPEN);
    const before = useUnifiedVehicleStore.getState().canDoorOpen;

    expect(() => run(CAN_SCENARIOS.MALFORMED)).not.toThrow();

    expect(useUnifiedVehicleStore.getState().canDoorOpen).toBe(before);
  });

  // Decode katmanı doğruluğu — ham satır → CanAdapterData
  it('decode: ham reverse frame doğru CanAdapterData üretir', () => {
    const out: CanAdapterData[] = [];
    playCanScenario(CAN_SCENARIOS.REVERSE_ON, TEST_CAN_PROFILE, (d) => out.push(d));
    expect(out.length).toBe(1);
    expect(out[0].reverse).toBe(true);
  });

  it('decode: bilinmeyen ID boş/etkisiz CanAdapterData üretir', () => {
    const out: CanAdapterData[] = [];
    playCanScenario(CAN_SCENARIOS.UNKNOWN_ID, TEST_CAN_PROFILE, (d) => out.push(d));
    expect(out[0].reverse).toBeUndefined();
    expect(out[0].doorOpen).toBeUndefined();
    expect(out[0].gearPos).toBeUndefined();
  });
});
