/**
 * carosLabNavigation.ts — CAROS LAB iç navigasyonunun SAF reducer'ı.
 *
 * NEDEN SAF: navigasyon kararları (hangi kart açılır, DISABLED kart ne yapar, geri
 * nereye döner) React mount'u olmadan test edilebilmeli — jsdom'da createRoot
 * çalışmıyor (bkz. safetyContext.test.tsx notu). Shell yalnız bu reducer'ı sürer.
 *
 * YENİ ROUTER DEĞİLDİR: uygulama navigasyonu hâlâ drawerBus'tır; bu yalnız TEK
 * çekmecenin içindeki görünüm durumudur.
 */

import {
  getCarosLabTool, resolveToolActivation,
  type CarosLabCategory, type CarosLabToolId,
} from './carosLabCatalog';

export interface CarosLabNavState {
  readonly category: CarosLabCategory;
  /** null → katalog (hub) görünümü. */
  readonly activeId: CarosLabToolId | null;
}

export type CarosLabNavAction =
  | { readonly type: 'category'; readonly category: CarosLabCategory }
  | { readonly type: 'open';     readonly id: string }
  | { readonly type: 'back' };

export const CAROS_LAB_INITIAL_NAV: CarosLabNavState = Object.freeze({
  category: 'vehicle' as CarosLabCategory,
  activeId: null,
});

/**
 * Durum geçişi. Değişiklik yoksa AYNI referans döner (gereksiz re-render yok).
 *  - 'open'  : yalnız AVAILABLE/PLACEHOLDER araçlar açılır; DISABLED → NO-OP.
 *  - 'back'  : katalog görünümüne döner (kategori korunur).
 */
export function carosLabNavReduce(
  state: CarosLabNavState,
  action: CarosLabNavAction,
): CarosLabNavState {
  if (!state || !action) return state;

  switch (action.type) {
    case 'category': {
      if (state.category === action.category) return state;
      // Kategori değişince açık araç kapanır → kart ızgarasına dönülür.
      return { category: action.category, activeId: null };
    }
    case 'open': {
      const next = resolveToolActivation(getCarosLabTool(action.id));
      if (next === null) return state;          // DISABLED / bilinmeyen id → hiçbir işlem
      if (state.activeId === next) return state;
      return { category: state.category, activeId: next };
    }
    case 'back': {
      if (state.activeId === null) return state;
      return { category: state.category, activeId: null };
    }
    default:
      return state;
  }
}
