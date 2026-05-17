import { create } from 'zustand';

/* ── Kognitif modlar (öncelik sırasıyla düşükten yükseğe) ─────────────── */

export type CognitiveMode =
  | 'IMMERSIVE'   // Tam konsantrasyon — tüm özellikler aktif
  | 'AWARE'       // Farkındalık — hafif uyarı seviyesi
  | 'FOCUSED'     // Odaklanma — animasyonlar / widget'lar susturuldu
  | 'CRITICAL'    // Kritik — medya + tüm opsiyonel sistemler kapalı
  | 'LIMP_HOME';  // Limping — yalnızca zorunlu navigasyon aktif

export const MODE_RANK: Record<CognitiveMode, number> = {
  IMMERSIVE:  0,
  AWARE:      1,
  FOCUSED:    2,
  CRITICAL:   3,
  LIMP_HOME:  4,
};

/* Moda göre hangi sistemler suppress edilir */
const SUPPRESSED: Record<CognitiveMode, readonly string[]> = {
  IMMERSIVE: [],
  AWARE:     [],
  FOCUSED:   ['animations', 'widgets'],
  CRITICAL:  ['media', 'animations', 'widgets'],
  // OBD ('obd') ve navigation ('navigation') HARİÇ her şey kapatılır
  LIMP_HOME: [
    'media', 'animations', 'widgets', 'maps', 'smartEngine',
    'radar', 'fuelAdvisor', 'maintenanceBrain', 'communityPush',
    'theater', 'smartCard',
  ],
};

/* ── Store arayüzü ───────────────────────────────────────────────────────── */

interface CognitiveState {
  currentMode:  CognitiveMode;
  isSuppressed: boolean;        // true ≥ FOCUSED
  lastUpdateTs: number;

  setMode:             (mode: CognitiveMode) => void;
  getSuppressedSystems:() => readonly string[];
}

/* ── Zustand store ───────────────────────────────────────────────────────── */

export const useCognitiveStore = create<CognitiveState>((set, get) => ({
  currentMode:  'IMMERSIVE',
  isSuppressed: false,
  lastUpdateTs: 0,

  setMode(mode) {
    set({
      currentMode:  mode,
      // LIMP_HOME her zaman suppressed; diğer modlar FOCUSED+ eşiğine göre
      isSuppressed: mode === 'LIMP_HOME' || MODE_RANK[mode] >= MODE_RANK['FOCUSED'],
      lastUpdateTs: Date.now(),
    });
  },

  getSuppressedSystems() {
    return SUPPRESSED[get().currentMode];
  },
}));
