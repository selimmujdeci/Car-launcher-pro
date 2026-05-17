/**
 * useCommunityStore — Collective Road Memory (CRM) yerel kuyruk durumu
 *
 * Gizlilik garantisi: Bu store'da kesin koordinat (lat/lng) ASLA tutulmaz.
 * Her olay encodeGeohash() ile Level 6'ya dönüştürüldükten sonra eklenir.
 */

import { create } from 'zustand';

/* ── Olay tipleri ────────────────────────────────────────────────────────── */

export type CommunityEventType =
  | 'ROAD_WORK'
  | 'ACCIDENT'
  | 'POTHOLE'
  | 'HARD_BRAKE'
  | 'FOG_ZONE'
  | 'GENERAL_ALERT';

/* ── Olay veri modeli ────────────────────────────────────────────────────── */

export interface CommunityEvent {
  /** Yerel UUID — zaman damgası + rastgele suffix */
  id: string;
  type: CommunityEventType;
  /** Level 6 Geohash — ~1.2km hassasiyet. Kesin koordinat içermez. */
  geohash: string;
  /** Yerel sensör güven skoru: 0.0 – 1.0 */
  confidence: number;
  /** Unix timestamp (ms) */
  timestamp: number;
  /**
   * Olay tipine özgü ek veri.
   * Örn: POTHOLE → { verticalG: number }
   * CRITICAL: lat/lng bu alana ASLA yazılmaz.
   */
  metadata: Record<string, unknown>;
}

/* ── Store arayüzü ───────────────────────────────────────────────────────── */

interface CommunityState {
  /** Yüklenmeyi bekleyen olaylar */
  pendingEvents: CommunityEvent[];
  /** Son başarılı sunucu senkronizasyon zamanı (ms) */
  lastSyncTs: number;
  /** Senkronizasyon devam ediyor mu */
  isSyncing: boolean;

  /** Kuyruğa yeni olay ekler */
  pushEvent: (event: CommunityEvent) => void;
  /** Verilen ID'leri kuyruktan kaldırır */
  removeEvents: (ids: string[]) => void;
  /** Senkronizasyon bayrağını günceller */
  setSyncing: (syncing: boolean) => void;
  /** Başarılı senkronizasyon zamanını kaydeder */
  markSynced: () => void;
}

/* ── Zustand store ───────────────────────────────────────────────────────── */

export const useCommunityStore = create<CommunityState>()((set) => ({
  pendingEvents: [],
  lastSyncTs:    0,
  isSyncing:     false,

  pushEvent: (event) =>
    set((s) => ({ pendingEvents: [...s.pendingEvents, event] })),

  removeEvents: (ids) => {
    const idSet = new Set(ids);
    set((s) => ({
      pendingEvents: s.pendingEvents.filter((e) => !idSet.has(e.id)),
    }));
  },

  setSyncing: (syncing) => set({ isSyncing: syncing }),

  markSynced: () => set({ lastSyncTs: Date.now(), isSyncing: false }),
}));
