import { create } from 'zustand';

/* ── Safety State Machine ────────────────────────────────────────────────── */

export type SafetyState =
  | 'CALM'          // Araç durağan veya düşük hız — tehlike yok
  | 'ATTENTIVE'     // Normal sürüş — fren mesafesi izleniyor
  | 'CAUTION'       // Fren mesafesi kritik bölgeye giriyor
  | 'INTERVENTION'; // Acil müdahale gerekebilir

/* ── Store Interface ─────────────────────────────────────────────────────── */

interface SafetyMetrics {
  safetyState:          SafetyState;
  brakingDistanceM:     number; // Kuru asfalt, μ=0.7 → fren yolu (metre)
  reactionDistanceM:    number; // 1.5s reaksiyon gecikmesi (metre)
  recommendedSpeedKmh:  number; // Dinamik hız önerisi (S2'de kavşak tabanlı)
  isBrakingCritical:    boolean; // Fren mesafesi kritik eşiği aştı mı
}

interface SafetyStore extends SafetyMetrics {
  setSafetyMetrics(m: SafetyMetrics): void;
}

/* ── Zustand Store ───────────────────────────────────────────────────────── */

export const useSafetyStore = create<SafetyStore>((set) => ({
  safetyState:         'CALM',
  brakingDistanceM:    0,
  reactionDistanceM:   0,
  recommendedSpeedKmh: 0,
  isBrakingCritical:   false,

  setSafetyMetrics(m) {
    set(m);
  },
}));
