import { create } from 'zustand';
import { readDTCCodes, onDTCState } from '../dtcService';
import type { DTCCode, DTCState } from '../dtcService';
import { onOBDData } from '../obdService';
import type { OBDData } from '../obdService';

export type ZoneState = 'ok' | 'warn' | 'critical' | 'open' | 'low';

export interface ZoneStatus {
  engine:       ZoneState;
  transmission: ZoneState;
  network:      ZoneState;
  brakes:       ZoneState;
  doorFL:       ZoneState;
  doorFR:       ZoneState;
  doorRL:       ZoneState;
  doorRR:       ZoneState;
  trunk:        ZoneState;
  wheelFL:      ZoneState;
  wheelFR:      ZoneState;
  wheelRL:      ZoneState;
  wheelRR:      ZoneState;
}

export type { DTCCode };

const DEFAULT_ZONES: ZoneStatus = {
  engine: 'ok', transmission: 'ok', network: 'ok', brakes: 'ok',
  doorFL: 'ok', doorFR: 'ok', doorRL: 'ok', doorRR: 'ok', trunk: 'ok',
  wheelFL: 'ok', wheelFR: 'ok', wheelRL: 'ok', wheelRR: 'ok',
};

const TPMS_LOW_KPA  = 220;
const TPMS_CRIT_KPA = 180;

function tpmsZone(kpa?: number): ZoneState {
  if (kpa == null || kpa <= 0) return 'ok';
  if (kpa < TPMS_CRIT_KPA) return 'critical';
  if (kpa < TPMS_LOW_KPA)  return 'low';
  return 'ok';
}

function worstOf(codes: DTCCode[]): ZoneState {
  if (codes.some((c) => c.severity === 'critical')) return 'critical';
  if (codes.length > 0) return 'warn';
  return 'ok';
}

function computeZones(
  dtc: DTCCode[],
  doors?: OBDData['doors'],
  tpms?: OBDData['tpms'],
  canDoorOpen?: boolean,
): ZoneStatus {
  const codeN = (c: DTCCode) => parseInt(c.code.slice(1), 10);

  const pCodes = dtc.filter((c) => c.code.startsWith('P'));
  const cCodes = dtc.filter((c) => c.code.startsWith('C'));
  const uCodes = dtc.filter((c) => c.code.startsWith('U'));

  // P0000–P0599 = powertrain (engine/fuel/emission); P0700+ = transmission
  const engineCodes = pCodes.filter((c) => codeN(c) < 700);
  const transCodes  = pCodes.filter((c) => codeN(c) >= 700);

  // Per-door fallback: if OBD has no doors data, use CAN's generic bool for FL only
  const anyCanDoor = canDoorOpen ?? false;

  return {
    engine:       worstOf(engineCodes),
    transmission: worstOf(transCodes),
    network:      worstOf(uCodes),
    brakes:       worstOf(cCodes),
    doorFL: doors ? (doors.fl    ? 'open' : 'ok') : (anyCanDoor ? 'open' : 'ok'),
    doorFR: doors ? (doors.fr    ? 'open' : 'ok') : 'ok',
    doorRL: doors ? (doors.rl    ? 'open' : 'ok') : 'ok',
    doorRR: doors ? (doors.rr    ? 'open' : 'ok') : 'ok',
    trunk:  doors ? (doors.trunk ? 'open' : 'ok') : 'ok',
    wheelFL: tpmsZone(tpms?.fl),
    wheelFR: tpmsZone(tpms?.fr),
    wheelRL: tpmsZone(tpms?.rl),
    wheelRR: tpmsZone(tpms?.rr),
  };
}

interface DiagnosticStore {
  dtcCodes:     DTCCode[];
  isReading:    boolean;
  lastReadAt:   number | null;
  readError:    string | null;
  selectedCode: string | null;
  obdConnected: boolean;
  doors:        OBDData['doors'];
  tpms:         OBDData['tpms'];
  canDoorOpen:  boolean;
  zones:        ZoneStatus;

  selectCode:  (code: string | null) => void;
  triggerRead: () => void;
  // Internal updaters
  _updateDtc:     (s: DTCState) => void;
  _updateObd:     (d: OBDData) => void;
  _updateCanDoor: (open: boolean) => void;
}

export const useDiagnosticStore = create<DiagnosticStore>((set, get) => ({
  dtcCodes: [], isReading: false, lastReadAt: null, readError: null,
  selectedCode: null, obdConnected: false,
  doors: undefined, tpms: undefined, canDoorOpen: false,
  zones: { ...DEFAULT_ZONES },

  selectCode:  (code) => set({ selectedCode: code }),
  triggerRead: () => { void readDTCCodes(); },

  _updateDtc: (s) => {
    const { doors, tpms, canDoorOpen } = get();
    set({
      dtcCodes:  s.codes,
      isReading: s.isReading,
      lastReadAt: s.lastReadAt,
      readError: s.error,
      zones: computeZones(s.codes, doors, tpms, canDoorOpen),
    });
  },

  _updateObd: (d) => {
    const { dtcCodes, canDoorOpen } = get();
    set({
      obdConnected: d.connectionState === 'connected',
      doors: d.doors,
      tpms:  d.tpms,
      zones: computeZones(dtcCodes, d.doors, d.tpms, canDoorOpen),
    });
  },

  _updateCanDoor: (open) => {
    const { dtcCodes, doors, tpms } = get();
    set({
      canDoorOpen: open,
      zones: computeZones(dtcCodes, doors, tpms, open),
    });
  },
}));

/** Start OBD + DTC subscriptions. Returns cleanup. Call from DiagnosticPanel useEffect. */
export function startDiagnostics(): () => void {
  const unsubs: Array<() => void> = [];
  unsubs.push(onDTCState((s) => useDiagnosticStore.getState()._updateDtc(s)));
  unsubs.push(onOBDData((d) => useDiagnosticStore.getState()._updateObd(d)));
  void readDTCCodes();
  return () => unsubs.forEach((fn) => fn());
}
