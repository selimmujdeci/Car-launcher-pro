/**
 * useLayoutStore — Tema Stüdyo'dan gelen ekran DÜZENİ niyetini tutar (araç tarafı).
 *
 * PWA "Araca Gönder" → commandListener 'layout_change' → applyIntent(raw).
 * ÇOK-TEMA: niyet HAM saklanır (normalize edilmez). Her tema (ProLayout/
 * ExpeditionLayout/…) OKUMA anında kendi manifest'iyle `normalizeIntent(raw, MANIFEST)`
 * çağırır → temalar birbirinin kartını ezmez, zero-trust okuma tarafında uygulanır.
 * Varsayılan = pro defaultIntent() → hiç özelleştirme yoksa her tema kendi
 * varsayılanını üretir (geri-uyum; ekran bugünküyle aynı kalır).
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { defaultIntent, type LayoutIntent } from '../platform/theme/layoutSolver';

/** Ham niyet — obje ise olduğu gibi tutulur, değilse pro varsayılanı (fail-soft). */
function asRawIntent(raw: unknown): LayoutIntent {
  return (raw && typeof raw === 'object' ? raw : defaultIntent()) as LayoutIntent;
}

interface LayoutStore {
  /** HAM niyet — tüketici tema normalize eder (manifest'ine göre). */
  intent: LayoutIntent;
  /** Ham niyeti sakla (Tema Stüdyo'dan). Normalize OKUMA tarafında yapılır. */
  applyIntent: (raw: unknown) => void;
  /** Fabrika ayarına dön (mevcut ekran). */
  reset: () => void;
}

export const useLayoutStore = create<LayoutStore>()(
  persist(
    (set) => ({
      intent: defaultIntent(),
      applyIntent: (raw) => set({ intent: asRawIntent(raw) }),
      reset: () => set({ intent: defaultIntent() }),
    }),
    {
      name: 'caros-layout-intent-v1',
      // Depolanan ham veri yüklemede olduğu gibi alınır (bozuksa pro varsayılanı).
      merge: (persisted, current) => {
        const p = persisted as Partial<LayoutStore> | undefined;
        return { ...current, intent: asRawIntent(p?.intent) };
      },
    },
  ),
);
