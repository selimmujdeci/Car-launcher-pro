/**
 * routeStoreAdapter — MAVI 4.0 · TRIP AI · MAVI4-TRIP-5B · HEDEF 2.
 *
 * TripApplyEngine'in `RouteStoreAdapter` sözleşmesini mevcut RoutingService store'una bağlar.
 * Store YALNIZ bu adapter üzerinden okunur/yazılır (Preview Engine store'a asla dokunmaz).
 *
 * DÖNÜŞÜM (ActiveRoute ↔ RouteState):
 *   • Okuma:  getRouteState() → {geometry, totalDistanceMeters, totalDurationSeconds}.
 *     etaEpochMs store'da tutulmaz → süreden türetilir (now + durationS·1000). steps/serverUsed/
 *     hasToll opak `meta` alanında TAŞINIR (bu katman yorumlamaz) — resume/rollback'te birebir
 *     geri yazılır.
 *   • Yazma:  writeActiveRoute() → cumulativeDistances geometriden yeniden türetilir; adım yoksa
 *     hedef sentinel'i enjekte edilir; alternatifler temizlenir. TTS/navStyle TETİKLENMEZ.
 *
 * Store shape UYDURULMAZ — RoutingService'in gerçek export'larından (getRouteState/writeActiveRoute)
 * türetilir; orijinal rotanın geometry/distance/duration/steps alanları birebir round-trip eder.
 */

import { getRouteState, writeActiveRoute, type RouteStep } from '../../routingService';
import type { ActiveRoute, RouteStoreAdapter } from '../tripApplyEngine';

export interface RouteStoreAdapterDeps {
  /** Test/enjekte edilebilir saat — etaEpochMs türetimi için. Varsayılan Date.now. */
  now?: () => number;
}

/**
 * Production RouteStoreAdapter üretir. TripApplyEngine'e enjekte edilir; store yalnız buradan
 * mutasyona uğrar (apply/resume/rollback).
 */
export function createRouteStoreAdapter(deps: RouteStoreAdapterDeps = {}): RouteStoreAdapter {
  const now = deps.now ?? (() => Date.now());

  return {
    getActiveRoute(): ActiveRoute | null {
      const s = getRouteState();
      if (!s.geometry || s.geometry.length < 2) return null;
      return {
        // Kopya — apply katmanının snapshot/dondurma işlemi canlı store dizisine dokunmasın.
        geometry:   s.geometry.map(p => [p[0], p[1]] as [number, number]),
        distanceM:  s.totalDistanceMeters,
        durationS:  s.totalDurationSeconds,
        etaEpochMs: now() + s.totalDurationSeconds * 1000,
        // Opak taşıma: apply katmanı içeriğini yorumlamaz, resume/rollback'te geri yazar.
        meta: {
          steps:      s.steps,
          serverUsed: s.serverUsed,
          hasToll:    s.hasToll,
        },
      };
    },

    setActiveRoute(route: ActiveRoute): void {
      const meta = (route.meta ?? {}) as {
        steps?:      RouteStep[];
        serverUsed?: string | null;
        hasToll?:    boolean;
      };
      writeActiveRoute({
        geometry:   route.geometry,
        distanceM:  route.distanceM,
        durationS:  route.durationS,
        steps:      Array.isArray(meta.steps) ? meta.steps : undefined,
        serverUsed: meta.serverUsed,
        hasToll:    typeof meta.hasToll === 'boolean' ? meta.hasToll : undefined,
      });
    },
  };
}
