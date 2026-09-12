/**
 * useLayoutStore — Tema Stüdyo'dan gelen ekran DÜZENİ niyetini tutar (araç tarafı).
 *
 * İKİ YOL (bilinçli, geri-uyumlu):
 *  - `intent` — PAYLAŞILAN ham niyet. Eski `layout_change` komutu buraya yazar.
 *    Davranışı DEĞİŞMEDİ: niyet ham saklanır, her tema OKUMA anında kendi
 *    manifestiyle `normalizeIntent` çağırır.
 *  - `byTheme[themeId]` — TEMA BAŞINA ham niyet. Tema Manifesti v3 buraya yazar.
 *
 * NEDEN İKİNCİSİ EKLENDİ (ölçülmüş davranış değişikliği): `pro` ve `expedition`
 * manifestleri `music` · `vehicle` · `dock` kart id'lerini PAYLAŞIR. Tek ortak
 * blobda Pro'da müziği gizlemek Expedition'da da gizliyordu — temalar birbirinin
 * yerleşimini eziyordu. Okuma sırası: `byTheme[tema] ?? intent` → o tema için hiç
 * manifest gelmemişse ESKİ davranış aynen sürer (hiçbir kurulum bozulmaz).
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { defaultIntent, type LayoutIntent } from '../platform/theme/layoutSolver';

/** Ham niyet — obje ise olduğu gibi tutulur, değilse pro varsayılanı (fail-soft). */
function asRawIntent(raw: unknown): LayoutIntent {
  return (raw && typeof raw === 'object' ? raw : defaultIntent()) as LayoutIntent;
}

function asThemeMap(raw: unknown): Record<string, LayoutIntent> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, LayoutIntent> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (v && typeof v === 'object') out[k] = v as LayoutIntent;
  }
  return out;
}

/**
 * Bölge (sütun) genişlik çarpanları — tema başına. Sözleşme tarafı
 * `themeManifest.ZoneWidths`tir; burada YALNIZ taşınır ve saklanır (bu store
 * sözleşme dosyasını import etmez → tek yönlü bağımlılık korunur).
 *
 * Boş nesne = hiç dokunulmamış → tema kendi varsayılan genişliğini kullanır.
 */
export type ZoneWidthMap = Record<string, number>;

/** Zero-trust: yalnız sonlu sayı ve 0,6–1,6 aralığı geçer (sözleşmeyle aynı). */
function asZoneWidths(raw: unknown): ZoneWidthMap {
  if (!raw || typeof raw !== 'object') return {};
  const out: ZoneWidthMap = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v !== 'number' || !Number.isFinite(v)) continue;
    out[k] = Math.max(0.6, Math.min(1.6, v));
  }
  return out;
}

function asZoneThemeMap(raw: unknown): Record<string, ZoneWidthMap> {
  if (!raw || typeof raw !== 'object') return {};
  const out: Record<string, ZoneWidthMap> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) out[k] = asZoneWidths(v);
  return out;
}

interface LayoutStore {
  /** HAM paylaşılan niyet — tüketici tema normalize eder (manifest'ine göre). */
  intent: LayoutIntent;
  /** HAM tema-başına niyet (Tema Manifesti v3). */
  byTheme: Record<string, LayoutIntent>;
  /**
   * Ham niyeti sakla. `themeId` verilirse YALNIZ o temaya yazılır; verilmezse
   * eski (paylaşılan) davranış korunur. Normalize OKUMA tarafında yapılır.
   */
  applyIntent: (raw: unknown, themeId?: string) => void;
  /** Okuma: tema-başına varsa o, yoksa paylaşılan (geri-uyum). */
  intentFor: (themeId: string) => LayoutIntent;
  /** Fabrika ayarına dön. `themeId` verilirse yalnız o temanın niyeti silinir. */
  reset: (themeId?: string) => void;

  /** Tema başına bölge genişlik çarpanları (boş = tema varsayılanı). */
  zonesByTheme: Record<string, ZoneWidthMap>;
  applyZoneWidths: (raw: unknown, themeId: string) => void;
  zoneWidthsFor: (themeId: string) => ZoneWidthMap;
}

export const useLayoutStore = create<LayoutStore>()(
  persist(
    (set, get) => ({
      intent: defaultIntent(),
      byTheme: {},
      zonesByTheme: {},

      applyIntent: (raw, themeId) => {
        if (typeof themeId === 'string' && themeId.length > 0) {
          set((s) => ({ byTheme: { ...s.byTheme, [themeId]: asRawIntent(raw) } }));
          return;
        }
        set({ intent: asRawIntent(raw) });
      },

      intentFor: (themeId) => {
        const s = get();
        return s.byTheme[themeId] ?? s.intent;
      },

      applyZoneWidths: (raw, themeId) => {
        if (typeof themeId !== 'string' || themeId.length === 0) return;
        set((st) => ({ zonesByTheme: { ...st.zonesByTheme, [themeId]: asZoneWidths(raw) } }));
      },

      zoneWidthsFor: (themeId) => get().zonesByTheme[themeId] ?? {},

      reset: (themeId) => {
        if (typeof themeId === 'string' && themeId.length > 0) {
          set((s) => {
            const next = { ...s.byTheme };
            delete next[themeId];
            const nextZones = { ...s.zonesByTheme };
            delete nextZones[themeId];
            return { byTheme: next, zonesByTheme: nextZones };
          });
          return;
        }
        set({ intent: defaultIntent(), byTheme: {}, zonesByTheme: {} });
      },
    }),
    {
      name: 'caros-layout-intent-v1',
      // Depolanan ham veri yüklemede olduğu gibi alınır (bozuksa pro varsayılanı).
      // `byTheme` eski kayıtlarda YOKTUR → boş harita (eski davranış aynen sürer).
      merge: (persisted, current) => {
        const p = persisted as Partial<LayoutStore> | undefined;
        return {
          ...current,
          intent: asRawIntent(p?.intent),
          byTheme: asThemeMap(p?.byTheme),
          /* Eski kayıtlarda YOKTUR → boş harita; mevcut ekran birebir korunur. */
          zonesByTheme: asZoneThemeMap(p?.zonesByTheme),
        };
      },
    },
  ),
);

/**
 * React okuma yardımcısı — bileşenler `byTheme[tema] ?? intent` sırasını
 * elle kurmasın (iki farklı okuma sırası = sessiz ayrışma riski).
 */
export function useLayoutIntent(themeId: string): LayoutIntent {
  return useLayoutStore((s) => s.byTheme[themeId] ?? s.intent);
}

/**
 * Bölge genişlik çarpanları — React okuma yardımcısı. Bileşenler `zonesByTheme`
 * sırasını elle kurmasın (iki farklı okuma sırası = sessiz ayrışma riski).
 */
export function useZoneWidths(themeId: string): ZoneWidthMap {
  return useLayoutStore((s) => s.zonesByTheme[themeId] ?? BOS_ZONE);
}

/** Sabit boş referans — her render'da yeni nesne dönerse abonelik sonsuz döner. */
const BOS_ZONE: ZoneWidthMap = {};
