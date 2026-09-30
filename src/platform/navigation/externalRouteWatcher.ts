/**
 * externalRouteWatcher — harici rota bitti mi? (yüzen pencere kapansın)
 *
 * Harici uygulamanın rotasını/iptalini OKUYAMAYIZ (paylaşmıyorlar). Ölçebildiğimiz
 * tek bitiş işareti KENDİ GPS'imizdir: araç hedefe EXTERNAL_ROUTE_ARRIVAL_M
 * içine girince rota "vardı" sayılır. Bayat kalmasın diye azami ömür de vardır.
 * Kullanıcı iptali: penceredeki × veya bizde yeni navigasyon başlangıcı.
 *
 * Rota/konum gerçeği ÜRETMEZ; konumu `UnifiedVehicleStore`dan salt okur.
 */
import { useUnifiedVehicleStore } from '../vehicleDataLayer/UnifiedVehicleStore';
import {
  clearExternalRoute, getExternalRoute, EXTERNAL_ROUTE_MAX_AGE_MS, type ExternalRoute,
} from './externalRouteState';

export { EXTERNAL_ROUTE_MAX_AGE_MS };
export const EXTERNAL_ROUTE_ARRIVAL_M = 200;

function _distM(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6_371_000;
  const toRad = Math.PI / 180;
  const dLat = (bLat - aLat) * toRad;
  const dLng = (bLng - aLng) * toRad;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * toRad) * Math.cos(bLat * toRad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** SAF: rota bitti mi? Konum bilinmiyorsa "vardı" DENMEZ. */
export function judgeExternalRouteEnd(
  route: ExternalRoute,
  loc: { latitude: number; longitude: number } | null | undefined,
  nowMs: number,
): 'arrived' | 'expired' | null {
  if (nowMs - route.startedAtMs > EXTERNAL_ROUTE_MAX_AGE_MS) return 'expired';
  if (!loc || !Number.isFinite(loc.latitude) || !Number.isFinite(loc.longitude)) return null;
  return _distM(loc.latitude, loc.longitude, route.lat, route.lng) <= EXTERNAL_ROUTE_ARRIVAL_M ? 'arrived' : null;
}

let _unsub: (() => void) | null = null;

export function stopExternalRouteWatch(): void {
  _unsub?.();
  _unsub = null;
}

/** Harici rota varken (yeni kurulunca VE uygulama yeniden açılınca) çağrılır; bitince kendini kapatır. */
export function startExternalRouteWatch(now: () => number = Date.now): void {
  stopExternalRouteWatch();
  let lastLoc: unknown = undefined;
  _unsub = useUnifiedVehicleStore.subscribe((s) => {
    const route = getExternalRoute();
    if (!route) { stopExternalRouteWatch(); return; }
    if (s.location === lastLoc) return;            // yalnız konum değişince hesapla
    lastLoc = s.location;
    if (judgeExternalRouteEnd(route, s.location, now())) {
      clearExternalRoute();
      stopExternalRouteWatch();
    }
  });
}
