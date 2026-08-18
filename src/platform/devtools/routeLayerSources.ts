/**
 * routeLayerSources.ts — rota katman gözleminin TEK okuma noktası (#623).
 *
 * ── PAZARLIKSIZ SINIRLAR ────────────────────────────────────────────────────
 *  · YALNIZ senkron okuma. Harita OLUŞTURULMAZ, stil YÜKLETİLMEZ, rota
 *    ÇİZDİRİLMEZ, hiçbir paint YAZILMAZ.
 *  · Her okuma try/catch içinde; kaynak patlarsa `null` → ekran UNAVAILABLE.
 *  · Yeni store/singleton KURULMAZ.
 */

import { getMapInstance } from '../map/MapCore';
import {
  captureRouteLayerProbe, getLastRouteLayerProbe, type RouteLayerProbe,
} from '../map/routeLayerProbe';
import { resolveRouteColor, type RouteColorDecision } from '../map/core/routeColorModel';
import { resolveLightBasemap } from '../map/MapLayerManager';

function _safe<T>(fn: () => T): T | null {
  try {
    const v = fn();
    return v === undefined ? null : v;
  } catch {
    return null;
  }
}

export interface RouteLayerRawSnapshot {
  readonly probe: RouteLayerProbe | null;
  readonly decision: RouteColorDecision | null;
  /** Fotoğraf canlı haritadan mı geldi, yoksa saklanan son fotoğraf mı. */
  readonly live: boolean;
}

/**
 * Tek seferlik okuma.
 *
 * Öncelik CANLI haritadır: LAB açıkken harita hâlâ monte ise gerçek "şu anki"
 * paint okunur. Harita yoksa (tam ekran kapandı → örnek yok) rota BOYANDIĞI
 * ANDA saklanan fotoğraf gösterilir; model onu yaşına göre STALE işaretler.
 */
export function readRouteLayerSnapshot(): RouteLayerRawSnapshot {
  const map = _safe(() => getMapInstance());

  let probe: RouteLayerProbe | null = null;
  let live = false;
  if (map) {
    /* #625 — ELLE okumada görünürlük de ölçülür (`withVisibility`): "boya doğru
       ama rota ekranda YOK" kökü yalnız burada görülebilir. Sıcak yolda saklanan
       fotoğraf bu ölçümü TAŞIMAZ (pahalı) → orada alan `null` kalır. */
    probe = _safe(() => captureRouteLayerProbe(map, 'manual', true));
    /* Harita var ama rota katmanları yoksa canlı fotoğraf "boş" olur; böyle bir
       durumda saklanan fotoğraf DAHA BİLGİLENDİRİCİDİR (rota en son nasıl
       boyanmıştı). Canlıyı yalnız gerçekten katman gördüysek üstün tutarız. */
    if (probe && probe.layers.some((l) => l.present)) {
      live = true;
    } else {
      probe = null;
    }
  }
  if (!probe) probe = _safe(() => getLastRouteLayerProbe());

  /* Beklenen karar — haritaya YAZILMAZ, yalnız karşılaştırma için hesaplanır.
     `maneuverTier: 0` ve `hazardHigh: false` BİLEREK sabittir: ekranın amacı
     "temel gece/gündüz kararı ne olmalıydı" sorusudur; manevra/tehlike anlık
     durumdur ve fotoğrafın anını taşımaz. Bu sınır ekranda yazılıdır. */
  const light = _safe(() => resolveLightBasemap());
  const decision = light === null ? null : _safe(() => resolveRouteColor({
    maneuverTier: 0, hazardHigh: false, lightBasemap: light,
  }));

  return { probe, decision, live };
}
