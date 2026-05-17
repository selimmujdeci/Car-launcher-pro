import { create } from 'zustand';

/* ── Hazard type definitions ─────────────────────────────────────────────── */

export type HazardType =
  | 'CONSTRUCTION'
  | 'ACCIDENT'
  | 'WEATHER'
  | 'SPEED_CAM'
  | 'ROAD_DAMAGE'
  | 'TUNNEL';

export type HazardSource = 'HERE' | 'TOMTOM' | 'USER_REPORT' | 'SYSTEM';

export interface Hazard {
  id:                string;
  type:              HazardType;
  lat:               number;
  lng:               number;
  severity:          number;       // 0.0 – 1.0
  source:            HazardSource;
  timestamp:         number;       // creation time (ms)
  initialConfidence: number;       // 0.0 – 1.0
  decayRate:         number;       // azalma oranı / saat (varsayılan 0.1)
  influenceRadius:   number;       // etki yarıçapı (metre)
  isCommunity?:      boolean;      // topluluk kaynaklı → görsel pulse efekti
}

/* ── Hazard durum makinesi ───────────────────────────────────────────────── */

export const HazardStatus = {
  IDLE:       'IDLE',       // tehlike yok
  AWARENESS:  'AWARENESS',  // uzakta, farkında ol
  PREPARE:    'PREPARE',    // yaklaşıyor, hazırlan
  ATTENTION:  'ATTENTION',  // kritik bölgede
  STABILIZE:  'STABILIZE',  // bölge geçildi, stabil
  RECOVER:    'RECOVER',    // normalleşiyor
} as const;

export type HazardStatus = typeof HazardStatus[keyof typeof HazardStatus];

/* ── Store interface ─────────────────────────────────────────────────────── */

interface HazardStore {
  // State
  activeHazards:         Hazard[];
  hazardStatus:          HazardStatus;
  globalRiskScore:       number;              // 0.0 – 1.0
  driverAttentionBudget: number;              // varsayılan 1.0
  // Phase H2 — rota uygunluğu ve nihai yoğunluk
  routeRelevance:        Record<string, number>; // hazard.id → 0.0–1.0
  hazardIntensity:       Record<string, number>; // hazard.id → FinalIntensity 0.0–1.0

  // Actions
  upsertHazard(h: Hazard): void;
  removeHazard(id: string): void;
  updateGlobalRisk(score: number): void;
  setHazardStatus(status: HazardStatus): void;
  setRouteRelevance(map: Record<string, number>): void;
  setHazardIntensity(map: Record<string, number>): void;
  setDriverAttentionBudget(budget: number): void;
}

/* ── Zustand store ───────────────────────────────────────────────────────── */

export const useHazardStore = create<HazardStore>((set) => ({
  activeHazards:         [],
  hazardStatus:          HazardStatus.IDLE,
  globalRiskScore:       0,
  driverAttentionBudget: 1.0,
  routeRelevance:        {},
  hazardIntensity:       {},

  upsertHazard(h) {
    set((state) => {
      const idx = state.activeHazards.findIndex((x) => x.id === h.id);
      if (idx === -1) {
        return { activeHazards: [...state.activeHazards, h] };
      }
      const updated = [...state.activeHazards];
      updated[idx] = h;
      return { activeHazards: updated };
    });
  },

  removeHazard(id) {
    set((state) => {
      // routeRelevance ve hazardIntensity kayıtlarını da temizle
      const rel = { ...state.routeRelevance };
      const int = { ...state.hazardIntensity };
      delete rel[id];
      delete int[id];
      return {
        activeHazards:   state.activeHazards.filter((x) => x.id !== id),
        routeRelevance:  rel,
        hazardIntensity: int,
      };
    });
  },

  updateGlobalRisk(score) {
    set({ globalRiskScore: Math.max(0, Math.min(1, score)) });
  },

  setHazardStatus(status) {
    set({ hazardStatus: status });
  },

  setRouteRelevance(map) {
    set({ routeRelevance: map });
  },

  setHazardIntensity(map) {
    set({ hazardIntensity: map });
  },

  setDriverAttentionBudget(budget) {
    set({ driverAttentionBudget: Math.max(0.1, Math.min(1.0, budget)) });
  },
}));
