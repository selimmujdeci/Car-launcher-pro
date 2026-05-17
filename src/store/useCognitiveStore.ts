import { create } from 'zustand';

/* ── Kognitif modlar (öncelik sırasıyla düşükten yükseğe) ─────────────── */

export type CognitiveMode =
  | 'IMMERSIVE'   // Tam konsantrasyon — tüm özellikler aktif
  | 'AWARE'       // Farkındalık — hafif uyarı seviyesi
  | 'FOCUSED'     // Odaklanma — animasyonlar / widget'lar susturuldu
  | 'PROTECTION'  // Koruma — CRM sync + ses ekstraları + glow efektleri kısıtlandı
  | 'CRITICAL'    // Kritik — medya + tüm opsiyonel sistemler kapalı
  | 'LIMP_HOME';  // Limping — yalnızca zorunlu navigasyon aktif

export const MODE_RANK: Record<CognitiveMode, number> = {
  IMMERSIVE:  0,
  AWARE:      1,
  FOCUSED:    2,
  PROTECTION: 3,
  CRITICAL:   4,
  LIMP_HOME:  5,
};

/* Moda göre hangi sistemler suppress edilir */
const SUPPRESSED: Record<CognitiveMode, readonly string[]> = {
  IMMERSIVE:  [],
  AWARE:      [],
  FOCUSED:    ['animations', 'widgets'],
  // PROTECTION: animasyonlar + CRM sync + ses ekstraları + glow efektleri
  PROTECTION: ['animations', 'CRMSync', 'VoiceExtras', 'FancyGlow'],
  CRITICAL:   ['media', 'animations', 'widgets'],
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

/* ── Store yardımcıları ──────────────────────────────────────────────────── */

/** FOCUSED ve üzeri modlarda UI/servis kısıtlamaları devreye girer. */
function _isSuppressedMode(mode: CognitiveMode): boolean {
  return MODE_RANK[mode] >= MODE_RANK['FOCUSED'];
}

/* ── Zustand store ───────────────────────────────────────────────────────── */

export const useCognitiveStore = create<CognitiveState>((set, get) => ({
  currentMode:  'IMMERSIVE',
  isSuppressed: false,
  lastUpdateTs: 0,

  setMode(mode) {
    set({
      currentMode:  mode,
      isSuppressed: _isSuppressedMode(mode),
      lastUpdateTs: Date.now(),
    });
  },

  getSuppressedSystems() {
    return SUPPRESSED[get().currentMode];
  },
}));
