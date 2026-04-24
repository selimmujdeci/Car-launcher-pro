import { create } from 'zustand';

const RING_MAX = 500;

function ringPush<T>(arr: readonly T[], item: T): T[] {
  if (arr.length >= RING_MAX) return [...arr.slice(1), item];
  return [...arr, item];
}

export type SignalSource = 'CAN' | 'OBD' | 'GPS' | 'NONE';

export interface CanRawEntry {
  ts: number;
  frameId: string;
  payload: string;
}

export interface SignalEntry {
  ts: number;
  signal: string;
  value: string;
  source: SignalSource;
}

export interface ReverseLogEntry {
  ts: number;
  source: SignalSource;
  value: boolean;
  speed: number;
  guardResult: 'accepted' | 'rejected';
  reason: string;
}

export interface ErrorEntry {
  ts: number;
  level: 'error' | 'warn' | 'info';
  source: string;
  message: string;
}

export interface PerfStats {
  canHz: number;
  obdHz: number;
  gpsHz: number;
  canLastTs: number;
  obdLastTs: number;
  gpsLastTs: number;
  canDropped: number;
  obdDropped: number;
  gpsDropped: number;
  listenerCount: number;
}

export interface FallbackStatus {
  canAlive: boolean;
  obdFallbackActive: boolean;
  gpsFallbackActive: boolean;
  allDead: boolean;
  canLastSeen: number;
  obdLastSeen: number;
  gpsLastSeen: number;
}

export interface LiveSignal {
  value: string;
  source: SignalSource;
  ts: number;
}

export interface CanExtras {
  doorOpen?: boolean;
  headlightsOn?: boolean;
  tpms?: number[];
}

interface DebugStore {
  // Ring buffers
  canRawLog: CanRawEntry[];
  reverseLog: ReverseLogEntry[];
  errorLog: ErrorEntry[];
  // Live state (updated in-place, not logged per event)
  liveSignals: Record<string, LiveSignal>;
  canExtras: CanExtras;
  perf: PerfStats;
  fallback: FallbackStatus;
  // Panel state
  collecting: boolean; // true when panel is open → canRawLog fills

  pushCanRaw: (e: CanRawEntry) => void;
  pushReverseLog: (e: ReverseLogEntry) => void;
  pushError: (e: ErrorEntry) => void;
  updateLiveSignal: (signal: string, value: string, source: SignalSource) => void;
  updateCanExtras: (extras: CanExtras) => void;
  updatePerf: (patch: Partial<PerfStats>) => void;
  updateFallback: (f: FallbackStatus) => void;
  setCollecting: (v: boolean) => void;
  clearCanRaw: () => void;
  clearReverseLog: () => void;
  clearErrorLog: () => void;
  exportSnapshot: () => object;
}

const DEFAULT_PERF: PerfStats = {
  canHz: 0, obdHz: 0, gpsHz: 0,
  canLastTs: 0, obdLastTs: 0, gpsLastTs: 0,
  canDropped: 0, obdDropped: 0, gpsDropped: 0,
  listenerCount: 0,
};

const DEFAULT_FALLBACK: FallbackStatus = {
  canAlive: false, obdFallbackActive: false, gpsFallbackActive: false,
  allDead: true, canLastSeen: 0, obdLastSeen: 0, gpsLastSeen: 0,
};

export const useDebugStore = create<DebugStore>((set, get) => ({
  canRawLog: [],
  reverseLog: [],
  errorLog: [],
  liveSignals: {},
  canExtras: {},
  perf: DEFAULT_PERF,
  fallback: DEFAULT_FALLBACK,
  collecting: false,

  pushCanRaw: (e) => {
    if (!get().collecting) return;
    set((s) => ({ canRawLog: ringPush(s.canRawLog, e) }));
  },
  pushReverseLog: (e) => set((s) => ({ reverseLog: ringPush(s.reverseLog, e) })),
  pushError: (e) => set((s) => ({ errorLog: ringPush(s.errorLog, e) })),

  updateLiveSignal: (signal, value, source) =>
    set((s) => ({
      liveSignals: { ...s.liveSignals, [signal]: { value, source, ts: Date.now() } },
    })),

  updateCanExtras: (extras) =>
    set((s) => ({ canExtras: { ...s.canExtras, ...extras } })),

  updatePerf: (patch) => set((s) => ({ perf: { ...s.perf, ...patch } })),

  updateFallback: (f) => set({ fallback: f }),

  setCollecting: (v) => set({ collecting: v }),

  clearCanRaw: () => set({ canRawLog: [] }),
  clearReverseLog: () => set({ reverseLog: [] }),
  clearErrorLog: () => set({ errorLog: [] }),

  exportSnapshot: () => {
    const s = get();
    return {
      exportedAt: new Date().toISOString(),
      canRawLog: s.canRawLog,
      reverseLog: s.reverseLog,
      errorLog: s.errorLog,
      liveSignals: s.liveSignals,
      canExtras: s.canExtras,
      perf: s.perf,
      fallback: s.fallback,
    };
  },
}));

// --- Per-source event counters (module-level, not in Zustand — avoids re-render per event) ---
const _cnt = { can: 0, obd: 0, gps: 0 };
export const _incCan = (ts: number) => {
  _cnt.can++;
  useDebugStore.getState().updatePerf({ canLastTs: ts });
};
export const _incObd = (ts: number) => {
  _cnt.obd++;
  useDebugStore.getState().updatePerf({ obdLastTs: ts });
};
export const _incGps = (ts: number) => {
  _cnt.gps++;
  useDebugStore.getState().updatePerf({ gpsLastTs: ts });
};

// 1-second Hz sampling tick — only active when flag is on
const _DEBUG_ACTIVE =
  import.meta.env.DEV || import.meta.env.VITE_ENABLE_DEBUG_PANEL === 'true';

if (_DEBUG_ACTIVE) {
  setInterval(() => {
    useDebugStore.getState().updatePerf({
      canHz: _cnt.can,
      obdHz: _cnt.obd,
      gpsHz: _cnt.gps,
    });
    _cnt.can = 0;
    _cnt.obd = 0;
    _cnt.gps = 0;
  }, 1000);
}
