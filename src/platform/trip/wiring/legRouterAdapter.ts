/**
 * legRouterAdapter — MAVI 4.0 · TRIP AI · MAVI4-TRIP-5B · HEDEF 1.
 *
 * TRIP-4 Preview Engine'in enjekte `LegRouter` sözleşmesini mevcut RoutingService'in
 * YAN ETKİSİZ bacak-fetch'ine (`fetchRouteLeg`) bağlar.
 *
 * SÖZLEŞME (pazarlıksız):
 *   • Yeni routing algoritması YOK — mevcut _tryServer / offline katman yeniden kullanılır.
 *   • Store YAZMAZ · konuşma başlatMAZ · EventBus yayınlaMAZ · nav-style değiştirMEZ.
 *   • Ağ/sağlayıcı hatasında fail-soft `null` — sağlayıcı detayı yüzeye SIZMAZ.
 *   • Yalnız rota sonucu döndürür (geometry + distanceM + durationS).
 */

import { fetchRouteLeg } from '../../routingService';
import type { LegRouter, LegRouteResult } from '../tripPreviewEngine';

/**
 * Production LegRouter üretir. Dönen fonksiyon TRIP-4 `computeTripPreview`'e enjekte edilir.
 * fetchRouteLeg zaten fail-soft `null` döner; ekstra savunma için try/catch ile sarılır.
 */
export function createLegRouterAdapter(): LegRouter {
  return async (
    fromLat: number, fromLon: number,
    toLat:   number, toLon:   number,
  ): Promise<LegRouteResult | null> => {
    try {
      const leg = await fetchRouteLeg(fromLat, fromLon, toLat, toLon);
      if (!leg || !Array.isArray(leg.geometry) || leg.geometry.length < 2) return null;
      // Yalın kopya — dış katmana RoutingService iç referansı sızmasın.
      return {
        geometry:  leg.geometry,
        distanceM: leg.distanceM,
        durationS: leg.durationS,
      };
    } catch {
      return null; // fail-soft: sağlayıcı detayı yutulur
    }
  };
}
