/**
 * Routing Service — çoklu OSRM sunuculu rota hesaplama ve adım takibi.
 *
 * Sunucu önceliği:
 *   1. VITE_ROUTING_SERVER env değişkeni (kendi sunucunuz)
 *   2. routing.openstreetmap.de  (OSM Almanya — global, kararlı)
 *   3. osrm.route.at             (Avusturya OSM — yedek)
 *
 * Offline: fetchRoute hata döner → error set edilir, geometry=null.
 *          FullMapView bu durumda straight-line navigasyona devam eder.
 *
 * OSRM koordinatları [lon, lat] sırasındadır (GeoJSON standardı).
 */
import { create } from 'zustand';

/* ── Tipler ──────────────────────────────────────────────────── */

export interface RouteStep {
  instruction:      string;           // Türkçe yönlendirme
  streetName:       string;
  distance:         number;           // Bu adım için metre
  maneuverType:     string;           // OSRM: "turn" | "arrive" | "depart" | ...
  maneuverModifier: string;           // OSRM: "left" | "right" | "straight" | ...
  coordinate:       [number, number]; // [lon, lat] adım başlangıcı
}

interface RouteState {
  loading:                  boolean;
  error:                    string | null;
  geometry:                 [number, number][] | null;   // Tam rota [lon,lat][]
  steps:                    RouteStep[];
  totalDistanceMeters:      number;
  totalDurationSeconds:     number;
  currentStepIndex:         number;
  distanceToNextTurnMeters: number;
  serverUsed:               string | null;  // hangi sunucu kullanıldı
}

const INITIAL: RouteState = {
  loading: false, error: null, geometry: null, steps: [],
  totalDistanceMeters: 0, totalDurationSeconds: 0,
  currentStepIndex: 0, distanceToNextTurnMeters: 0,
  serverUsed: null,
};

const useRouteStore = create<RouteState>(() => INITIAL);

/* ── Sunucu listesi ──────────────────────────────────────────── */

/**
 * Kullanılacak OSRM sunucuları — öncelik sırasıyla.
 * VITE_ROUTING_SERVER set edilmişse o ilk sırada gelir.
 * Kendi OSRM/Valhalla/GraphHopper sunucunuzu env'dan geçirebilirsiniz.
 */
function getRoutingServers(): string[] {
  const custom = import.meta.env['VITE_ROUTING_SERVER'] as string | undefined;
  const defaults = [
    'https://routing.openstreetmap.de/routed-car/route/v1/driving',
    'https://osrm.route.at/route/v1/driving',
  ];
  return custom ? [custom, ...defaults] : defaults;
}

/* ── Haversine ───────────────────────────────────────────────── */

function hav(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6_371_000;
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * (Math.PI / 180)) *
    Math.cos(lat2 * (Math.PI / 180)) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/* ── OSRM maneuver → Türkçe ──────────────────────────────────── */

function toTR(type: string, mod: string, name: string): string {
  const s = name ? ` (${name})` : '';
  if (type === 'depart')                            return `Yola çıkın${s}`;
  if (type === 'arrive')                            return 'Hedefinize ulaştınız';
  if (type === 'roundabout' || type === 'rotary')   return 'Dönel kavşakta devam edin';
  if (type === 'end of road')                       return 'Yol sonunda dönün';
  if (mod  === 'uturn')                             return 'U dönüşü yapın';
  if (mod  === 'sharp right')                       return `Sert sağa dönün${s}`;
  if (mod  === 'right')                             return `Sağa dönün${s}`;
  if (mod  === 'slight right')                      return `Hafif sağa dönün${s}`;
  if (mod  === 'straight')                          return `Düz devam edin${s}`;
  if (mod  === 'slight left')                       return `Hafif sola dönün${s}`;
  if (mod  === 'left')                              return `Sola dönün${s}`;
  if (mod  === 'sharp left')                        return `Sert sola dönün${s}`;
  return `Devam edin${s}`;
}

/* ── Dahili OSRM adım tipi ───────────────────────────────────── */

interface OsrmStep {
  distance: number;
  name: string;
  maneuver: { type: string; modifier?: string };
  geometry: { coordinates: [number, number][] };
}

/* ── Tek sunucudan rota isteği ───────────────────────────────── */

async function _tryServer(
  baseUrl: string,
  fromLon: number, fromLat: number,
  toLon: number,   toLat: number,
): Promise<{ steps: RouteStep[]; geometry: [number, number][]; distance: number; duration: number }> {
  const url =
    `${baseUrl}/${fromLon},${fromLat};${toLon},${toLat}` +
    `?steps=true&geometries=geojson&overview=full`;

  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10_000);

  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'CarLauncherPro/1.0' },
    });
    clearTimeout(timer);

    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = await res.json() as {
      code: string;
      routes?: Array<{
        distance: number;
        duration: number;
        geometry: { coordinates: [number, number][] };
        legs: Array<{ steps: OsrmStep[] }>;
      }>;
    };

    if (data.code !== 'Ok' || !data.routes?.length)
      throw new Error('Rota bulunamadı');

    const route = data.routes[0];
    const steps: RouteStep[] = route.legs[0].steps.map(st => ({
      instruction:      toTR(st.maneuver.type, st.maneuver.modifier ?? 'straight', st.name ?? ''),
      streetName:       st.name ?? '',
      distance:         st.distance,
      maneuverType:     st.maneuver.type,
      maneuverModifier: st.maneuver.modifier ?? 'straight',
      coordinate:       st.geometry.coordinates[0] as [number, number],
    }));

    return {
      steps,
      geometry: route.geometry.coordinates as [number, number][],
      distance: route.distance,
      duration: route.duration,
    };
  } catch (e) {
    clearTimeout(timer);
    throw e;
  }
}

/* ── Public API ──────────────────────────────────────────────── */

/**
 * Rota çek — sunucular sırayla denenir, ilk başarılı sonuç kullanılır.
 * Tüm sunucular başarısız olursa error state set edilir; geometry null kalır.
 * Çağıran taraf straight-line fallback'e geçebilir.
 */
export async function fetchRoute(
  fromLat: number,
  fromLon: number,
  toLat:   number,
  toLon:   number,
): Promise<void> {
  useRouteStore.setState({ ...INITIAL, loading: true });

  const servers  = getRoutingServers();
  let   lastErr  = 'Rota hesaplanamadı';

  for (const server of servers) {
    try {
      const result = await _tryServer(server, fromLon, fromLat, toLon, toLat);

      useRouteStore.setState({
        loading: false,
        error:   null,
        geometry:             result.geometry,
        steps:                result.steps,
        totalDistanceMeters:  result.distance,
        totalDurationSeconds: result.duration,
        currentStepIndex:     0,
        distanceToNextTurnMeters: 0,
        serverUsed:           server,
      });
      return; // başarılı — döngüden çık
    } catch (e) {
      lastErr = e instanceof Error ? e.message : 'Rota hesaplanamadı';
      // Sonraki sunucuyu dene
    }
  }

  // Tüm sunucular başarısız
  useRouteStore.setState({
    ...INITIAL,
    error: `Rota alınamadı: ${lastErr}. İnternet bağlantınızı kontrol edin.`,
  });
}

/**
 * GPS güncellenince çağrılır — hangi adımdayız, sonraki dönüşe ne kadar?
 * 30m'den yaklaşılınca otomatik adım ilerler.
 */
export function updateRouteProgress(lat: number, lon: number): void {
  const { steps, currentStepIndex } = useRouteStore.getState();
  if (!steps.length) return;

  const nextIdx = Math.min(currentStepIndex + 1, steps.length - 1);
  const [nLon, nLat] = steps[nextIdx].coordinate;
  const dist = hav(lat, lon, nLat, nLon);

  if (dist < 30 && nextIdx > currentStepIndex) {
    useRouteStore.setState({ currentStepIndex: nextIdx, distanceToNextTurnMeters: 0 });
    return;
  }
  useRouteStore.setState({ distanceToNextTurnMeters: dist });
}

/** Rota state'ini başlangıca döndür. */
export function clearRoute(): void {
  useRouteStore.setState(INITIAL);
}

/** React hook — NavigationHUD ve FullMapView için. */
export function useRouteState(): RouteState {
  return useRouteStore(s => s);
}
