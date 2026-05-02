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
import { isNative } from './bridge';
import { useUnifiedVehicleStore } from './vehicleDataLayer/UnifiedVehicleStore';
import { tryLocalDaemon, computeOfflineRoute, straightLineRoute } from './offlineRoutingService';

/* ── Tipler ──────────────────────────────────────────────────── */

export interface RouteStep {
  instruction:      string;           // Türkçe yönlendirme
  streetName:       string;
  distance:         number;           // Bu adım için metre
  duration:         number;           // Bu adım için saniye (OSRM'den); road-speed tahmininde kullanılır
  maneuverType:     string;           // OSRM: "turn" | "arrive" | "depart" | ...
  maneuverModifier: string;           // OSRM: "left" | "right" | "straight" | ...
  coordinate:       [number, number]; // [lon, lat] adım başlangıcı
}

interface RouteState {
  loading:                  boolean;
  error:                    string | null;
  geometry:                 [number, number][] | null;   // Tam rota [lon,lat][]
  alternatives:             [number, number][][];         // Alternatif rotalar
  steps:                    RouteStep[];
  totalDistanceMeters:      number;
  totalDurationSeconds:     number;
  currentStepIndex:         number;
  distanceToNextTurnMeters: number;
  serverUsed:               string | null;  // hangi sunucu kullanıldı
  /**
   * Suffix-sum mesafe dizisi: cumulativeDistances[i] = geometry[i]'den rotanın
   * sonuna kadar kalan toplam mesafe (metre).  cumulativeDistances[n-1] === 0.
   * fetchRoute sırasında bir kez O(N) hesaplanır; her GPS tick'inde O(1) okunur.
   */
  cumulativeDistances:      Float64Array | null;
  /**
   * Yakın manevra bildirimi (Maneuver Stack).
   * Bir sonraki adımın hemen ardındaki adım MANEUVER_STACK_THRESHOLD_M içindeyse set edilir.
   * Sürücüye "Sağa dön, ardından hemen sola dön" gibi birleşik talimat vermek için kullanılır.
   * null = yığın manevrası yok.
   */
  pendingManeuver:          RouteStep | null;
}

const INITIAL: RouteState = {
  loading: false, error: null, geometry: null, alternatives: [], steps: [],
  totalDistanceMeters: 0, totalDurationSeconds: 0,
  currentStepIndex: 0, distanceToNextTurnMeters: 0,
  serverUsed: null,
  cumulativeDistances: null,
  pendingManeuver: null,
};

const useRouteStore = create<RouteState>(() => INITIAL);

/* ── Deviation detection — module-level state ────────────────── */

// Distance hierarchy (must stay consistent with navigationService):
//   ARRIVAL_THRESHOLD_M (20) < STEP_ADVANCE_THRESHOLD_M (30) < MANEUVER_STACK_THRESHOLD_M (50) < REROUTE_THRESHOLD_M (100)
export const REROUTE_THRESHOLD_M        = 100; // metre — route-line deviation triggers reroute
export const STEP_ADVANCE_THRESHOLD_M   = 30;  // metre — advance to next turn instruction
export const MANEUVER_STACK_THRESHOLD_M = 50;  // metre — back-to-back turns shown together

const REROUTE_THROTTLE_MS = 10_000; // 10 s — API spam koruması
const DEVIATION_WINDOW    = 20;     // kontrol edilecek segment penceresi

let _rerouteCtx:      { toLat: number; toLon: number } | null = null;
let _lastRerouteMs  = 0;
let _deviationCounter = 0;
let _reroutingCb:   ((isRerouting: boolean) => void) | null = null;

/** Navigasyon başladığında hedefe ait bağlamı kaydet. */
export function setRerouteContext(toLat: number, toLon: number): void {
  _rerouteCtx   = { toLat, toLon };
  _lastRerouteMs = 0; // yeni navigasyonda throttle sıfırla
  _deviationCounter = 0;
}

/** Navigasyon durduğunda bağlamı temizle. */
export function clearRerouteContext(): void {
  _rerouteCtx   = null;
  _lastRerouteMs = 0;
  _deviationCounter = 0;
}

/** isRerouting değişikliklerini dinleyen callback'i kaydet (navigationService tarafından çağrılır). */
export function registerReroutingCallback(cb: (val: boolean) => void): void {
  _reroutingCb = cb;
}

/* ── Sunucu listesi ──────────────────────────────────────────── */

/**
 * Kullanılacak OSRM sunucuları — öncelik sırasıyla.
 *
 * Offline katman mimarisi:
 *   Katman 0: localhost:5000 — native OSRM daemon (CarLauncherPlugin.startOsrmDaemon)
 *   Katman 1: VITE_ROUTING_SERVER env (özel sunucu)
 *   Katman 2: routing.openstreetmap.de, osrm.route.at (uzak OSRM)
 *   Katman 3: WebWorker A* — /maps/routing-graph.bin (tam offline)
 *   Katman 4: straight-line (son çare — gerçek navigasyon yok)
 */
function getRoutingServers(): string[] {
  const custom = import.meta.env['VITE_ROUTING_SERVER'] as string | undefined;
  const defaults = [
    'https://routing.openstreetmap.de/routed-car/route/v1/driving',
    'https://osrm.route.at/route/v1/driving',
  ];
  return custom ? [custom, ...defaults] : defaults;
}

/* ── Haversine + Point-to-segment ───────────────────────────── */

export function hav(lat1: number, lon1: number, lat2: number, lon2: number): number {
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

/**
 * Dot-product "geçildi mi?" testi — planar derece yaklaşımı, ≤2 km mesafede doğru.
 *
 * Mantık: maneuver noktası M, önceki adım P, araç konumu V.
 *   dir  = M − P  (rotanın M'ye doğru yönü)
 *   toV  = V − M  (M'den araca vektör)
 *   dot(dir, toV) > 0  →  araç M'nin ilerisinde → manevra noktası geçildi ✓
 *
 * Sıfır uzunluklu yön (P === M): yön belirlenemez → true döner, karar mesafeye bırakılır.
 */
function _hasPassedManeuver(
  vehLat: number, vehLon: number,
  prevLat: number, prevLon: number,
  manLat:  number, manLon:  number,
): boolean {
  const dirLon = manLon - prevLon;
  const dirLat = manLat - prevLat;
  if (dirLon === 0 && dirLat === 0) return true; // sıfır segment — mesafeye güven
  return (dirLon * (vehLon - manLon) + dirLat * (vehLat - manLat)) > 0;
}

/**
 * Suffix-sum dizisi: cum[i] = geometry[i]'den rotanın sonuna kalan mesafe (m).
 * cum[n-1] === 0.  fetchRoute sırasında bir kez hesaplanır (O(N)), GPS tick'inde O(1) okunur.
 */
function buildCumulativeDistances(geometry: [number, number][]): Float64Array {
  const n   = geometry.length;
  const cum = new Float64Array(n); // cum[n-1] = 0 (default)
  for (let i = n - 2; i >= 0; i--) {
    cum[i] = cum[i + 1] + hav(
      geometry[i][1],     geometry[i][0],
      geometry[i + 1][1], geometry[i + 1][0],
    );
  }
  return cum;
}

/**
 * Scalar projection t ∈ [0,1] of point P onto segment AB.
 * Identical planar-degree approximation used by pointToSegmentDist.
 * Used by navigationService.calculateRouteDistance for sub-segment interpolation.
 */
export function projectOnSegment(
  pLat: number, pLon: number,
  aLat: number, aLon: number,
  bLat: number, bLon: number,
): number {
  const dx    = bLon - aLon;
  const dy    = bLat - aLat;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return 0;
  return Math.max(0, Math.min(1,
    ((pLon - aLon) * dx + (pLat - aLat) * dy) / lenSq,
  ));
}

/**
 * Bir P noktasından AB segmentine dik (en kısa) mesafeyi döner.
 * Projeksiyon [0,1] aralığına kısıtlanır — segment uçlarına clamp edilir.
 */
export function pointToSegmentDist(
  pLat: number, pLon: number,
  aLat: number, aLon: number,
  bLat: number, bLon: number,
): number {
  const t = projectOnSegment(pLat, pLon, aLat, aLon, bLat, bLon);
  return hav(pLat, pLon, aLat + t * (bLat - aLat), aLon + t * (bLon - aLon));
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
  duration: number;
  name: string;
  maneuver: { type: string; modifier?: string };
  geometry: { coordinates: [number, number][] };
}

/* ── Tek sunucudan rota isteği ───────────────────────────────── */

async function _tryServer(
  baseUrl: string,
  fromLon: number, fromLat: number,
  toLon: number,   toLat: number,
): Promise<{ steps: RouteStep[]; geometry: [number, number][]; alternatives: [number, number][][]; distance: number; duration: number }> {
  const url =
    `${baseUrl}/${fromLon},${fromLat};${toLon},${toLat}` +
    `?steps=true&geometries=geojson&overview=full&alternatives=true`;

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
      duration:         st.duration,
      maneuverType:     st.maneuver.type,
      maneuverModifier: st.maneuver.modifier ?? 'straight',
      coordinate:       st.geometry.coordinates[0] as [number, number],
    }));

    const alternatives = (data.routes ?? [])
      .slice(1)
      .map(r => r.geometry.coordinates as [number, number][]);

    return {
      steps,
      geometry:     normalizeCoords(route.geometry.coordinates as [number, number][], fromLon, fromLat),
      alternatives: alternatives.map(alt => normalizeCoords(alt, fromLon, fromLat)),
      distance:     route.distance,
      duration:     route.duration,
    };
  } catch (e) {
    clearTimeout(timer);
    throw e;
  }
}

/* ── Koordinat doğrulama ─────────────────────────────────────── */

/**
 * Universal coordinate order validator — OSRM always returns [lon, lat] (GeoJSON standard).
 * Localization-agnostic: works for Berlin, Tokyo, Istanbul, Buenos Aires, etc.
 *
 * Detection rules applied in priority order:
 *
 *   Rule 1 — Magnitude > 90 (unambiguous):
 *     Latitude is bounded ±90; if |value| > 90 it must be longitude.
 *     → coords[0]: definitely lon → [lon,lat] already correct, return as-is.
 *     → coords[1]: definitely lon → [lat,lon] detected, swap.
 *
 *   Rule 2 — Origin-hint proximity (most reliable, localization-agnostic):
 *     We know the exact origin we sent to OSRM (fromLon, fromLat).
 *     Compare the first geometry point against the origin in both orderings
 *     and pick the closer match. Works globally — no geographic assumptions.
 *
 *   Rule 3 — Ambiguous, no hint available:
 *     Both values are within ±90 and no hint was given.
 *     Trust the OSRM standard ([lon, lat]) and return as-is.
 *
 * Why the Turkey-specific range check was removed:
 *   It was broken for eastern Turkey (lon≈41° is inside Lat-range [36,42]),
 *   and fails globally for any city in the lon 36–42 band (Tbilisi, Yerevan, etc.).
 */
export function normalizeCoords(
  coords:  [number, number][],
  hintLon?: number,  // expected first-point longitude — pass OSRM origin fromLon
  hintLat?: number,  // expected first-point latitude  — pass OSRM origin fromLat
): [number, number][] {
  if (coords.length < 2) {
    console.warn(`[Route] normalizeCoords: rejected — length ${coords.length} (min 2)`);
    return [];
  }

  const [a, b] = coords[0];

  // Rule 1: magnitude > 90 is an unambiguous longitude marker
  if (Math.abs(a) > 90) {
    console.log(`[Route] first coord: [${a.toFixed(5)}, ${b.toFixed(5)}] (lon, lat)`);
    return coords;
  }
  if (Math.abs(b) > 90) {
    console.warn(`[Route] [lat,lon] detected (|b|=${Math.abs(b).toFixed(2)} > 90) — swapping`);
    return coords.map(([x, y]) => [y, x]);
  }

  // Rule 2: origin-hint proximity — compare against known OSRM input coords
  if (hintLon !== undefined && hintLat !== undefined) {
    const asIsDist    = (a - hintLon) ** 2 + (b - hintLat) ** 2;
    const swappedDist = (b - hintLon) ** 2 + (a - hintLat) ** 2;
    if (swappedDist < asIsDist) {
      console.warn(`[Route] [lat,lon] detected via origin-hint — swapping`);
      return coords.map(([x, y]) => [y, x]);
    }
    console.log(`[Route] first coord: [${a.toFixed(5)}, ${b.toFixed(5)}] (lon, lat)`);
    return coords;
  }

  // Rule 3: ambiguous, no hint — trust OSRM [lon, lat] standard
  console.log(`[Route] first coord: [${a.toFixed(5)}, ${b.toFixed(5)}] (lon, lat) — hint absent`);
  return coords;
}

/* ── fetchRoute ↔ switchMapStyle mutex ───────────────────────────────────────
 *
 * MapLibre harita stili değiştiğinde (Gündüz/Gece) tüm custom source ve layer'lar
 * silinir. fetchRoute aynı anda çalışıyorsa store yazısı style.load'dan ÖNCE
 * tamamlanabilir; map bileşeni tekrar render edildiğinde layer'lar kaybolmuş olur.
 *
 * Kullanım:
 *   Map bileşeni: notifyStyleChange(true)  → map.setStyle() çağrısından önce
 *                 notifyStyleChange(false) → style.load olayında
 *   fetchRoute  : _waitForStyleReady()     → her son store yazısından önce otomatik
 */
let _styleChangePending = false;
const _styleReadyCallbacks: Array<() => void> = [];

/**
 * Harita stil değişimini bildir.
 * Map bileşeni tarafından çağrılır — true=başladı, false=tamamlandı (style.load).
 */
export function notifyStyleChange(active: boolean): void {
  _styleChangePending = active;
  if (!active) {
    const cbs = _styleReadyCallbacks.splice(0);
    cbs.forEach(cb => cb());
  }
}

/** Stil değişimi aktifse tamamlanmasını bekle; aksi hâlde anında resolve eder. */
function _waitForStyleReady(): Promise<void> {
  if (!_styleChangePending) return Promise.resolve();
  return new Promise<void>(resolve => _styleReadyCallbacks.push(resolve));
}

/* ── Public API ──────────────────────────────────────────────── */

/**
 * Rota çek — 4 katmanlı offline-first mimari.
 *
 *   Katman 0: localhost:5000 (native OSRM daemon — sadece native modda denenir)
 *   Katman 1-2: Uzak OSRM sunucuları (online)
 *   Katman 3: WebWorker A* — /maps/routing-graph.bin
 *   Katman 4: Straight-line (her zaman başarılı — son çare)
 *
 * serverUsed alanı hangi katmanın kullanıldığını gösterir:
 *   'localhost:5000' | 'routing.openstreetmap.de' | 'offline-worker' | 'straight-line'
 */
export async function fetchRoute(
  fromLat: number,
  fromLon: number,
  toLat:   number,
  toLon:   number,
): Promise<void> {
  // ...INITIAL spreads cumulativeDistances: null → önceki Float64Array GC'ye serbest bırakılır.
  useRouteStore.setState({ ...INITIAL, loading: true });

  // ── Katman 0: Native OSRM daemon ────────────────────────────
  if (isNative) {
    const daemonResult = await tryLocalDaemon(fromLon, fromLat, toLon, toLat);
    if (daemonResult) {
      await _waitForStyleReady(); // stil yenileniyorsa layer hazır olana kadar bekle
      useRouteStore.setState({
        loading: false,
        error:   null,
        geometry:             daemonResult.geometry,
        cumulativeDistances:  buildCumulativeDistances(daemonResult.geometry),
        steps:                [],   // daemon step parse — sonraki versiyon
        totalDistanceMeters:  daemonResult.distanceM,
        totalDurationSeconds: daemonResult.durationS,
        currentStepIndex:     0,
        distanceToNextTurnMeters: 0,
        serverUsed:           'localhost:5000',
      });
      return;
    }
  }

  // ── Katman 1-2: Uzak OSRM sunucuları ────────────────────────
  const servers = getRoutingServers();
  for (const server of servers) {
    try {
      const result = await _tryServer(server, fromLon, fromLat, toLon, toLat);
      await _waitForStyleReady(); // stil yenileniyorsa layer hazır olana kadar bekle
      useRouteStore.setState({
        loading: false,
        error:   null,
        geometry:             result.geometry,
        cumulativeDistances:  buildCumulativeDistances(result.geometry),
        alternatives:         result.alternatives,
        steps:                result.steps,
        totalDistanceMeters:  result.distance,
        totalDurationSeconds: result.duration,
        currentStepIndex:     0,
        distanceToNextTurnMeters: 0,
        serverUsed:           server,
      });
      return;
    } catch {
      // Sonraki katmana geç
    }
  }

  // ── Katman 3: WebWorker A* (offline graph) ───────────────────
  const offlineResult = await computeOfflineRoute(fromLat, fromLon, toLat, toLon);
  if (offlineResult) {
    await _waitForStyleReady(); // stil yenileniyorsa layer hazır olana kadar bekle
    useRouteStore.setState({
      loading: false,
      error:   null,
      geometry:             offlineResult.geometry,
      cumulativeDistances:  buildCumulativeDistances(offlineResult.geometry),
      steps:                [],   // A* step üretimi — sonraki versiyon
      totalDistanceMeters:  offlineResult.distanceM,
      totalDurationSeconds: offlineResult.durationS,
      currentStepIndex:     0,
      distanceToNextTurnMeters: 0,
      serverUsed:           offlineResult.source,
    });
    return;
  }

  // ── Katman 4: Straight-line (son çare) ───────────────────────
  const sl = straightLineRoute(fromLat, fromLon, toLat, toLon);
  await _waitForStyleReady(); // stil yenileniyorsa layer hazır olana kadar bekle
  useRouteStore.setState({
    loading: false,
    error:   'Offline harita verisi yok — düz hat navigasyon aktif.',
    geometry:             sl.geometry,
    cumulativeDistances:  buildCumulativeDistances(sl.geometry),
    steps:                [],
    totalDistanceMeters:  sl.distanceM,
    totalDurationSeconds: sl.durationS,
    currentStepIndex:     0,
    distanceToNextTurnMeters: 0,
    serverUsed:           'straight-line',
  });
}

/**
 * GPS güncellenince çağrılır — hangi adımdayız, sonraki dönüşe ne kadar?
 * 30m'den yaklaşılınca otomatik adım ilerler.
 * 100m+ sapma + 10s throttle → otomatik yeniden rotalama.
 */
export function updateRouteProgress(lat: number, lon: number): void {
  const { steps, currentStepIndex, geometry } = useRouteStore.getState();
  if (!steps.length) return;

  // ── Adım ilerleme ─────────────────────────────────────────────────────────
  // Her GPS tick'inde birden fazla yakın manevradan geçilebilir (hızlı araç, 1 Hz GPS).
  // Döngü: hem mesafe < STEP_ADVANCE_THRESHOLD_M hem de dot-product "geçildi" iken ilerle.
  let newStepIdx = currentStepIndex;
  while (newStepIdx + 1 < steps.length) {
    const checkIdx       = newStepIdx + 1;
    const [cLon, cLat]   = steps[checkIdx].coordinate;
    const distToCheck    = hav(lat, lon, cLat, cLon);

    if (distToCheck >= STEP_ADVANCE_THRESHOLD_M) break; // henüz yaklaşılmadı

    const [prevLon, prevLat] = steps[newStepIdx].coordinate;
    if (!_hasPassedManeuver(lat, lon, prevLat, prevLon, cLat, cLon)) break; // geçilmedi

    newStepIdx = checkIdx; // manevra onaylandı — bir adım ilerle
  }

  // ── Maneuver Stack: yakın ardışık manevralar ──────────────────────────────
  // Bir sonraki dönüşün hemen arkasındaki dönüş MANEUVER_STACK_THRESHOLD_M içindeyse,
  // pendingManeuver set edilir → UI her iki talimatı aynı anda gösterebilir.
  const nextTurnIdx  = newStepIdx + 1;
  const stackTurnIdx = newStepIdx + 2;
  let pendingManeuver: RouteStep | null = null;
  if (nextTurnIdx < steps.length && stackTurnIdx < steps.length) {
    const [aLon, aLat] = steps[nextTurnIdx].coordinate;
    const [bLon, bLat] = steps[stackTurnIdx].coordinate;
    if (hav(aLat, aLon, bLat, bLon) < MANEUVER_STACK_THRESHOLD_M) {
      pendingManeuver = steps[stackTurnIdx];
    }
  }

  // Bir sonraki manevra noktasına mesafe
  const distToNextTurn = nextTurnIdx < steps.length
    ? hav(lat, lon, steps[nextTurnIdx].coordinate[1], steps[nextTurnIdx].coordinate[0])
    : 0;

  if (newStepIdx !== currentStepIndex) {
    useRouteStore.setState({
      currentStepIndex:         newStepIdx,
      distanceToNextTurnMeters: distToNextTurn,
      pendingManeuver,
    });
  } else {
    useRouteStore.setState({
      distanceToNextTurnMeters: distToNextTurn,
      pendingManeuver,
    });
  }

  // ── Sapma tespiti & Histerezis ────────────────────────────────
  if (!geometry || geometry.length < 2 || !_rerouteCtx) return;

  // Reroute-loop guard: straight-line fallback rotada gerçek yol ağı yok.
  // Sapma tespiti anlamsız — her GPS noktası teorik olarak "off-route" görünür.
  // Bu sonsuz döngüyü kırar: straight-line → sapma → reroute → yine straight-line → …
  if (useRouteStore.getState().serverUsed === 'straight-line') return;

  const now = Date.now();
  if (now - _lastRerouteMs < REROUTE_THROTTLE_MS) return;

  // ── Navigasyon Histerezisi ───────────────────────────────────
  const { speed, location } = useUnifiedVehicleStore.getState();
  const speedKmh = (speed ?? 0) * 3.6;
  const accuracy = location?.accuracy ?? 999;

  if (speedKmh < 5) return;   // Dururken jitter önleme (Sensor Resiliency)
  if (accuracy > 50) return;  // Zayıf sinyal koruması (Sensor Resiliency)

  // Performans: geometry'yi seyrek örnekle, merkezi bul
  const sampleStep = Math.max(1, Math.floor(geometry.length / 50));
  let closestIdx = 0;
  let minPtDist  = Infinity;
  for (let i = 0; i < geometry.length; i += sampleStep) {
    const d = hav(lat, lon, geometry[i][1], geometry[i][0]);
    if (d < minPtDist) { minPtDist = d; closestIdx = i; }
  }

  // Merkez çevresindeki DEVIATION_WINDOW segmentini hassas kontrol et
  const wStart = Math.max(0, closestIdx - DEVIATION_WINDOW);
  const wEnd   = Math.min(geometry.length - 2, closestIdx + DEVIATION_WINDOW);
  let minSegDist = Infinity;
  for (let i = wStart; i <= wEnd; i++) {
    const d = pointToSegmentDist(
      lat, lon,
      geometry[i][1], geometry[i][0],
      geometry[i + 1][1], geometry[i + 1][0],
    );
    if (d < minSegDist) minSegDist = d;
  }

  if (minSegDist > REROUTE_THRESHOLD_M) {
    _deviationCounter++;
    // Sapma en az 3 ardışık GPS tick'i boyunca sürerse reroute yap
    if (_deviationCounter >= 3) {
      _deviationCounter = 0;
      _lastRerouteMs = now; // throttle'ı hemen set et
      void _triggerReroute(lat, lon, _rerouteCtx.toLat, _rerouteCtx.toLon);
    }
  } else {
    _deviationCounter = 0;
  }
}

/** Yeniden rotalama — isRerouting callback'leriyle sarılmış fetchRoute. */
async function _triggerReroute(
  fromLat: number, fromLon: number,
  toLat:   number, toLon:   number,
): Promise<void> {
  _reroutingCb?.(true);
  try {
    await fetchRoute(fromLat, fromLon, toLat, toLon);
  } finally {
    _reroutingCb?.(false);
  }
}

/** Rota state'ini başlangıca döndür.
 *  INITIAL.cumulativeDistances === null → Float64Array GC'ye serbest bırakılır (Zero-Leak). */
export function clearRoute(): void {
  useRouteStore.setState(INITIAL);
  _deviationCounter = 0;
}

/** Snapshot (non-hook) — test ve non-React context için. */
export function getRouteState(): RouteState {
  return useRouteStore.getState();
}

/** React hook — NavigationHUD ve FullMapView için. */
export function useRouteState(): RouteState {
  return useRouteStore(s => s);
}
