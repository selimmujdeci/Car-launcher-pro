/**
 * tripApplyComposition — MAVI 4.0 · TRIP AI · MAVI4-TRIP-5B · HEDEF 4 (Composition Root).
 *
 * LegRouter adapter + RouteStoreAdapter + navigasyon-güvenlik adapter + TripApplyEngine'i
 * TEK YERDE birleştirir. İki katman:
 *
 *   1) createTripApplyComposition(deps) — SAF composition. Gerçek servisleri import ETMEZ;
 *      tüm portlar DI ile verilir (maviWiring deseni). Tam test edilebilir.
 *   2) createTripApplyRuntime(opts)     — GERÇEK bağlama. Üç production adapter'ı kurar ve
 *      saf composition'a geçirir. Uygulamanın kullanacağı composition root.
 *
 * KISITLAR (MAVI4-TRIP-5B):
 *   • Yeni global singleton YOK — factory her çağrıda taze örnek verir.
 *   • Yeni EventBus / state manager YOK.
 *   • UI/Voice action KAYDI YOK — yalnız motorları kurar; tetikleme ayrı bir PR'ın işi.
 *   • Proaktif öneri / otomatik rota değişimi YOK.
 */

import {
  createTripApplyEngine,
  type TripApplyEngine,
} from '../tripApplyEngine';
import {
  computeTripPreview,
  type LegRouter,
  type PreviewInput,
  type TripPreview,
} from '../tripPreviewEngine';
import type { RouteStoreAdapter } from '../tripApplyEngine';
import { createLegRouterAdapter } from './legRouterAdapter';
import { createRouteStoreAdapter } from './routeStoreAdapter';
import { createNavSafetyAdapter } from './navSafetyAdapter';

/* ── Saf composition ─────────────────────────────────────────────────────── */

export interface TripApplyCompositionDeps {
  /** Yan etkisiz bacak-router (HEDEF 1). Yalnız preview hesabı için kullanılır. */
  legRouter: LegRouter;
  /** Store okuma/yazma adapter (HEDEF 2). Apply/resume/rollback yalnız buradan yazar. */
  store: RouteStoreAdapter;
  /** Navigasyon-güvenlik kapısı (HEDEF 3), fail-closed. Verilmezse fail-closed reddedici. */
  safetyCheck?: () => { allowed: boolean; reason?: string };
  now?: () => number;
  maxPreviewAgeMs?: number;
}

export interface TripApplyComposition {
  /** Onay+snapshot+rollback'li apply motoru (TRIP-5). */
  readonly applyEngine: TripApplyEngine;
  /**
   * "POI'yi rotaya eklersem ne olur?" — enjekte LegRouter ile GERÇEK preview hesaplar (TRIP-4).
   * Store'a DOKUNMAZ; yalnız hesap döndürür.
   */
  computePreview(input: PreviewInput): Promise<TripPreview>;
}

/**
 * SAF composition — gerçek servis import etmez. safetyCheck verilmezse, güvenlik durumu
 * bilinemediği için fail-closed reddedici kullanılır (apply asla sessizce açılmaz).
 */
export function createTripApplyComposition(deps: TripApplyCompositionDeps): TripApplyComposition {
  const safetyCheck = deps.safetyCheck
    ?? (() => ({ allowed: false, reason: 'safety_check_unwired' })); // fail-closed varsayılan

  const applyEngine = createTripApplyEngine({
    store:           deps.store,
    now:             deps.now,
    maxPreviewAgeMs: deps.maxPreviewAgeMs,
    safetyCheck,
  });

  return {
    applyEngine,
    computePreview(input: PreviewInput): Promise<TripPreview> {
      return computeTripPreview(input, deps.legRouter);
    },
  };
}

/* ── Gerçek bağlama (production composition root) ─────────────────────────── */

export interface TripApplyRuntimeOpts {
  now?: () => number;
  maxPreviewAgeMs?: number;
}

/**
 * GERÇEK composition root — üç production adapter'ı kurar ve saf composition'a bağlar.
 * Bu tek yerde: RoutingService yan etkisiz bacak-fetch, RoutingService store köprüsü ve
 * useCognitiveStore güvenlik kapısı birleşir. Global singleton KURMAZ — çağıran örneği
 * kendi yaşam döngüsünde tutar (henüz UI/Voice'e bağlanmaz).
 */
export function createTripApplyRuntime(opts: TripApplyRuntimeOpts = {}): TripApplyComposition {
  // Adapter'lar YALNIZ bu gerçek bağlamada devreye girer; saf createTripApplyComposition
  // DI ile onlardan bağımsız test edilebilir kalır.
  return createTripApplyComposition({
    legRouter:       createLegRouterAdapter(),
    store:           createRouteStoreAdapter({ now: opts.now }),
    safetyCheck:     createNavSafetyAdapter(),
    now:             opts.now,
    maxPreviewAgeMs: opts.maxPreviewAgeMs,
  });
}
