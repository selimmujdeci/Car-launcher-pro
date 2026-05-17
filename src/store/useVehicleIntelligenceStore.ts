import { create } from 'zustand';

/* ── Tipler ──────────────────────────────────────────────── */

export type HealthState =
  | 'HEALTHY'       // Güven > 0.85, stale yok
  | 'MONITOR'       // Güven 0.65–0.85 veya 1 stale
  | 'STRESSED'      // Termal borç veya güven 0.45–0.65
  | 'ATTENTION'     // Güven 0.25–0.45 veya 3+ stale
  | 'SERVICE_SOON'; // Güven < 0.25 (Conservative modda atlanır)

/** T3: Termal motor durumu */
export type ThermalStatus =
  | 'COLD'          // Soğutma < 60°C — soğuk motor
  | 'WARM'          // 60–80°C — ısınma aşaması
  | 'OPTIMAL'       // 80–95°C — normal çalışma
  | 'HEAT_SOAK'     // Yüksek yük/düşük hava akışı → termal borç birikimi
  | 'OVERHEAT_RISK';// ≥ 110°C — acil dikkat

export interface PlausibilityEntry {
  isValid: boolean;
  reason?: string;
}

export interface DrivingCharacter {
  aggression: number; // 0.0–1.0
  smoothness: number; // 0.0–1.0 (rolling varyans, T2)
  economy:    number; // 0.0–1.0 (coasting + eko-bant, T2)
}

/* ── T2: Bağlantı kalitesi metrikleri ──────────────────── */

export interface ConnectionMetrics {
  samplesPerSecond:   number;
  jitterMs:           number;
  connectionFidelity: number;
  jitterStability:    number;
}

/* ── T3: Termal bellek metrikleri ───────────────────────── */

export interface ThermalMetrics {
  thermalStatus:     ThermalStatus;
  thermalDebt:       number;          // 0.0–1.0, düşük hava akışı + yüksek ısı birikimi
  coolingEfficiency: number;          // 0.0–1.0, soğuma hızı kalitesi
  maxCoolantTrend:   number;          // gözlemlenen en yüksek dT/dt (°C/dak)
  coolantTrendDtDt:  number;          // anlık dT/dt (°C/dak, işaretli)
}

/* ── Store arayüzü ───────────────────────────────────────── */

interface VehicleIntelligenceState extends ConnectionMetrics, ThermalMetrics {
  telemetryTrustScore:  number;
  plausibilityReport:   Record<string, PlausibilityEntry>;
  drivingCharacter:     DrivingCharacter;
  healthState:          HealthState;
  /** T4: Güven ağırlığı uygulanmadan önceki ham mekanik sağlık durumu */
  rawHealthState:       HealthState;
  stalePIDs:            string[];
  sampleCount:          number;
  isDegraded:           boolean;
  isCharacterReliable:  boolean;
  /** T4: Telemetri kalitesi düşük (trust < 0.4 veya fidelity < 0.5) */
  isDiagnosticDegraded: boolean;

  /* Actions */
  updateTrustScore:    (score: number) => void;
  updatePlausibility:  (key: string, entry: PlausibilityEntry) => void;
  clearPlausibility:   (key: string) => void;
  updateDrivingChar:   (char: Partial<DrivingCharacter>) => void;
  /** T4: Sağlık, ham sağlık ve tanı bozulma bayrağını tek seferde güncelle */
  setDiagnosticState:  (health: HealthState, rawHealth: HealthState, isDiagDeg: boolean) => void;
  setStalePIDs:        (pids: string[]) => void;
  setConnectionMetrics:(m: ConnectionMetrics) => void;
  setDegradation:      (isDegraded: boolean, isReliable: boolean) => void;
  setThermalMetrics:   (m: ThermalMetrics) => void;
  incrementSampleCount:() => void;
  reset:               () => void;
}

const DEFAULT_CHAR: DrivingCharacter = { aggression: 0, smoothness: 1, economy: 0.5 };
const DEFAULT_CONN: ConnectionMetrics = {
  samplesPerSecond: 0, jitterMs: 0, connectionFidelity: 1, jitterStability: 1,
};
const DEFAULT_THERMAL: ThermalMetrics = {
  thermalStatus:     'COLD',
  thermalDebt:       0,
  coolingEfficiency: 0.5,
  maxCoolantTrend:   0,
  coolantTrendDtDt:  0,
};

/* ── Zustand store ───────────────────────────────────────── */

export const useVehicleIntelligenceStore = create<VehicleIntelligenceState>((set) => ({
  telemetryTrustScore:  1.0,
  plausibilityReport:   {},
  drivingCharacter:     { ...DEFAULT_CHAR },
  healthState:          'HEALTHY',
  rawHealthState:       'HEALTHY',
  stalePIDs:            [],
  sampleCount:          0,
  isDegraded:           false,
  isCharacterReliable:  true,
  isDiagnosticDegraded: false,
  ...DEFAULT_CONN,
  ...DEFAULT_THERMAL,

  updateTrustScore: (score) =>
    set({ telemetryTrustScore: Math.max(0, Math.min(1, score)) }),

  updatePlausibility: (key, entry) =>
    set((s) => ({ plausibilityReport: { ...s.plausibilityReport, [key]: entry } })),

  clearPlausibility: (key) =>
    set((s) => {
      if (!(key in s.plausibilityReport)) return s;
      const r = { ...s.plausibilityReport };
      delete r[key];
      return { plausibilityReport: r };
    }),

  updateDrivingChar: (char) =>
    set((s) => ({ drivingCharacter: { ...s.drivingCharacter, ...char } })),

  setDiagnosticState: (health, rawHealth, isDiagDeg) =>
    set({ healthState: health, rawHealthState: rawHealth, isDiagnosticDegraded: isDiagDeg }),

  setStalePIDs:     (stalePIDs) => set({ stalePIDs }),

  setConnectionMetrics: (m) => set({
    samplesPerSecond:   m.samplesPerSecond,
    jitterMs:           m.jitterMs,
    connectionFidelity: m.connectionFidelity,
    jitterStability:    m.jitterStability,
  }),

  setDegradation: (isDegraded, isCharacterReliable) =>
    set({ isDegraded, isCharacterReliable }),

  setThermalMetrics: (m) => set({
    thermalStatus:     m.thermalStatus,
    thermalDebt:       m.thermalDebt,
    coolingEfficiency: m.coolingEfficiency,
    maxCoolantTrend:   m.maxCoolantTrend,
    coolantTrendDtDt:  m.coolantTrendDtDt,
  }),

  incrementSampleCount: () => set((s) => ({ sampleCount: s.sampleCount + 1 })),

  reset: () => set({
    telemetryTrustScore:  1.0,
    plausibilityReport:   {},
    drivingCharacter:     { ...DEFAULT_CHAR },
    healthState:          'HEALTHY',
    rawHealthState:       'HEALTHY',
    stalePIDs:            [],
    isDegraded:           false,
    isCharacterReliable:  true,
    isDiagnosticDegraded: false,
    ...DEFAULT_CONN,
    ...DEFAULT_THERMAL,
  }),
}));
