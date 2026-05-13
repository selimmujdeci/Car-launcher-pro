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
import { speakNavigation } from './ttsService';

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
  alternatives:             [number, number][][];         // Alternatif rotalar (sadece koordinat — harita çizimi için)
  altDistances:             number[];                     // Alternatif mesafeler (metre)
  altDurations:             number[];                     // Alternatif süreler (saniye)
  altRealIndices:           number[];                     // alternatives[i] → _allRoutes[altRealIndices[i]]
  altHasToll:               boolean[];                    // alternatives[i] için heuristik ücretli geçiş
  selectedAltIndex:         number;                       // seçili _allRoutes indeksi
  hasToll:                  boolean;                      // Aktif rota motorway/trunk içeriyor mu (OSRM heuristiği)
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
  loading: false, error: null, geometry: null,
  alternatives: [], altDistances: [], altDurations: [], altRealIndices: [], altHasToll: [], selectedAltIndex: 0,
  hasToll: false,
  steps: [],
  totalDistanceMeters: 0, totalDurationSeconds: 0,
  currentStepIndex: 0, distanceToNextTurnMeters: 0,
  serverUsed: null,
  cumulativeDistances: null,
  pendingManeuver: null,
};

const useRouteStore = create<RouteState>(() => INITIAL);

/* ── Deviation detection — module-level state ────────────────── */

// Distance hierarchy (must stay consistent with navigationService):
//   ARRIVAL_THRESHOLD_M (20) < STEP_ADVANCE_THRESHOLD_M (30) < MANEUVER_STACK_THRESHOLD_M (50) < REROUTE_THRESHOLD_M (55)
//   25m güvenli bölge: STEP_ADVANCE (30m) → REROUTE (55m) — adım ilerleme ve reroute çakışmaz.
export const REROUTE_THRESHOLD_M        = 55; // metre — rota sapma reroute eşiği (STEP_ADVANCE+25m güvenli bölge)
export const STEP_ADVANCE_THRESHOLD_M   = 30;  // metre — advance to next turn instruction
export const MANEUVER_STACK_THRESHOLD_M = 50;  // metre — back-to-back turns shown together
const HEADERS_TIMEOUT_MS   = 2_000; // Fail-Fast: headers alınamazsa offline katmana geç
const BODY_TIMEOUT_MS      = 5_000; // Otomotiv standardı: maksimum 5s route indirme bekleme
const DEVIATION_WINDOW    = 20;     // kontrol edilecek segment penceresi

let _rerouteCtx:       { toLat: number; toLon: number } | null = null;
let _lastRerouteMs   = 0;
let _deviationCounter = 0;
let _reroutingCb:    ((isRerouting: boolean) => void) | null = null;
let _isFetchingRoute = false;
// Navigasyon başlangıcı — ilk 3s GPS kararsız, reroute engellenir
let _navContextStartMs = 0;

/** Navigasyon başladığında hedefe ait bağlamı kaydet. */
export function setRerouteContext(toLat: number, toLon: number): void {
  _rerouteCtx        = { toLat, toLon };
  _lastRerouteMs     = 0;
  _deviationCounter  = 0;
  _navContextStartMs = performance.now(); // startup guard başlat
}

/** Navigasyon durduğunda bağlamı temizle. */
export function clearRerouteContext(): void {
  _rerouteCtx        = null;
  _lastRerouteMs     = 0;
  _deviationCounter  = 0;
  _navContextStartMs = 0;
}

/**
 * isRerouting değişikliklerini dinleyen callback'i kaydet.
 * Dönen fonksiyon kaydı iptal eder — servis durduğunda çağrılmalı.
 */
export function registerReroutingCallback(cb: (val: boolean) => void): () => void {
  _reroutingCb = cb;
  return () => { if (_reroutingCb === cb) _reroutingCb = null; };
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
  if (!geometry || geometry.length < 2) return new Float64Array(geometry?.length ?? 0);
  const n   = geometry.length;
  const cum = new Float64Array(n);
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
  ref?: string;
  maneuver: { type: string; modifier?: string };
  geometry: { coordinates: [number, number][] };
  intersections?: Array<{ classes?: string[] }>;
}

/**
 * OSRM adımlarından ücretli yol heuristiği.
 * motorway/trunk sınıfı veya bilinen otoban ref'leri (O-1, TEM, E-5 vb.) → true.
 * OSRM ücret verisi döndürmez; bu yalnızca tahmini bir göstergedir.
 */
function detectToll(steps: OsrmStep[]): boolean {
  const tollClasses = new Set(['motorway', 'trunk']);
  const tollRef     = /\b(O-?\d+|TEM|E-?\d+|D-?\d{3})\b/i;
  for (const st of steps) {
    if (st.ref && tollRef.test(st.ref)) return true;
    if (st.intersections?.some(ix => ix.classes?.some(c => tollClasses.has(c)))) return true;
  }
  return false;
}

/* ── Tek sunucudan rota isteği ───────────────────────────────── */

async function _tryServer(
  baseUrl: string,
  fromLon: number, fromLat: number,
  toLon: number,   toLat: number,
): Promise<{ steps: RouteStep[]; altSteps: RouteStep[][]; geometry: [number, number][]; alternatives: [number, number][][]; altDistances: number[]; altDurations: number[]; altHasToll: boolean[]; distance: number; duration: number; hasToll: boolean }> {
  // Coordinate validation
  if (!Number.isFinite(fromLat) || Math.abs(fromLat) > 90)  throw new Error(`INVALID_COORDS: origin lat=${fromLat}`);
  if (!Number.isFinite(fromLon) || Math.abs(fromLon) > 180) throw new Error(`INVALID_COORDS: origin lon=${fromLon}`);
  if (!Number.isFinite(toLat)   || Math.abs(toLat)   > 90)  throw new Error(`INVALID_COORDS: dest lat=${toLat}`);
  if (!Number.isFinite(toLon)   || Math.abs(toLon)   > 180) throw new Error(`INVALID_COORDS: dest lon=${toLon}`);

  // OSRM expects [longitude, latitude] — GeoJSON order
  const originCoords = [fromLon, fromLat] as const;  // [lon, lat]
  const destCoords   = [toLon,   toLat  ] as const;  // [lon, lat]
  const coordStr = `${originCoords[0]},${originCoords[1]};${destCoords[0]},${destCoords[1]}`;
  const url      = `${baseUrl}/${coordStr}?steps=true&geometries=geojson&overview=full&alternatives=3&annotations=duration,distance&continue_straight=default`;
  const ctrl = new AbortController();

  // ── Phase 1: Headers (Fail-Fast) ─────────────────────────────────────────
  // HEADERS_TIMEOUT_MS içinde sunucu yanıt vermezse → HEADERS_TIMEOUT hatası.
  // fetchRoute bu mesajı yakalayarak kalan tüm sunucuları keser ve offline'a geçer.
  let headersTimer: ReturnType<typeof setTimeout> | null =
    setTimeout(() => ctrl.abort(), HEADERS_TIMEOUT_MS);

  let _res: Response;
  try {
    _res = await fetch(url, {
      signal:  ctrl.signal,
      headers: { 'User-Agent': 'CarLauncherPro/1.0' },
    });
    clearTimeout(headersTimer!); headersTimer = null;
  } catch (e) {
    if (headersTimer !== null) { clearTimeout(headersTimer); headersTimer = null; }
    // ctrl.signal.aborted → bizim timer'ımız tetikledi → Fail-Fast sinyali
    throw ctrl.signal.aborted ? new Error('HEADERS_TIMEOUT') : (e as Error);
  }

  if (!_res.ok) throw new Error(`HTTP ${_res.status}`);

  // ── Phase 2: Body (otomotiv standardı 5s) ────────────────────────────────
  // Sunucu ulaşılabilir kanıtlandı; body transferine daha geniş süre tanı.
  const bodyTimer = setTimeout(() => ctrl.abort(), BODY_TIMEOUT_MS);

  try {
    const data = await _res.json() as {
      code: string;
      routes?: Array<{
        distance: number;
        duration: number;
        geometry: { coordinates: [number, number][] };
        legs: Array<{ steps: OsrmStep[] }>;
      }>;
    };

    if (data.code !== 'Ok')
      throw new Error(`Rota bulunamadı (code=${data.code})`);

    if (!data.routes || data.routes.length === 0) {
      throw new Error('NO_ROUTES');
    }

    const route = data.routes[0];

    const coords = route.geometry?.coordinates;

    if (!coords || coords.length === 0) {
      throw new Error('EMPTY_GEOMETRY');
    }

    const normalized = normalizeCoords(coords as [number, number][], fromLon, fromLat, toLon, toLat);
    if (normalized.length < 2)
      throw new Error(`geometry_normalize_failed: ${normalized.length} point(s) after normalize`);

    // ── [ROUTE_VALIDATION] route origin must be near GPS (< 200 m) ──────────
    const firstLon = normalized[0][0];
    const firstLat = normalized[0][1];
    const distToOrigin = hav(fromLat, fromLon, firstLat, firstLon);
    // 2000m: Android GPS ~5-20m doğruluk için çok geniş ama browser/desktop IP-GPS
    // 500-2000m doğrulukta çalışır. Koordinat takası hatasını yakalamak için yeterli —
    // Türkiye'de lon/lat takası ~2500km fark üretir, bu 2000m'i geçer.
    if (distToOrigin > 2000) {
      throw new Error(`ROUTE_ORIGIN_TOO_FAR: first point ${distToOrigin.toFixed(0)}m from GPS (max 2000m) — normalizeCoords may have wrong order`);
    }

    const steps: RouteStep[] = route.legs[0].steps.map(st => ({
      instruction:      toTR(st.maneuver.type, st.maneuver.modifier ?? 'straight', st.name ?? ''),
      streetName:       st.name ?? '',
      distance:         st.distance,
      duration:         st.duration,
      maneuverType:     st.maneuver.type,
      maneuverModifier: st.maneuver.modifier ?? 'straight',
      coordinate:       st.geometry.coordinates[0] as [number, number],
    }));

    const altRouteData = (data.routes ?? []).slice(1);
    const alternatives = altRouteData.map(r =>
      normalizeCoords(r.geometry.coordinates as [number, number][], fromLon, fromLat, toLon, toLat),
    );
    const altSteps: RouteStep[][] = altRouteData.map(r =>
      (r.legs[0].steps as OsrmStep[]).map(st => ({
        instruction:      toTR(st.maneuver.type, st.maneuver.modifier ?? 'straight', st.name ?? ''),
        streetName:       st.name ?? '',
        distance:         st.distance,
        duration:         st.duration,
        maneuverType:     st.maneuver.type,
        maneuverModifier: st.maneuver.modifier ?? 'straight',
        coordinate:       st.geometry.coordinates[0] as [number, number],
      }))
    );

    return {
      steps,
      altSteps,
      geometry:     normalized,
      alternatives,
      altDistances: altRouteData.map(r => r.distance),
      altDurations: altRouteData.map(r => r.duration),
      altHasToll:   altRouteData.map(r => detectToll(r.legs[0].steps as OsrmStep[])),
      distance:     route.distance,
      duration:     route.duration,
      hasToll:      detectToll(route.legs[0].steps as OsrmStep[]),
    };
  } finally {
    clearTimeout(bodyTimer);
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
  coords:   [number, number][],
  hintLon?: number,  // expected first-point longitude — pass OSRM origin fromLon
  hintLat?: number,  // expected first-point latitude  — pass OSRM origin fromLat
  destLon?: number,  // destination longitude — enables end-point disambiguation
  destLat?: number,  // destination latitude
): [number, number][] {
  if (!coords || coords.length < 2) {
    throw new Error(`EMPTY_GEOMETRY: coords.length=${coords?.length ?? 0} (min 2 required)`);
  }

  const [a, b] = coords[0];

  // Rule 1: magnitude > 90 is an unambiguous longitude marker
  if (Math.abs(a) > 90) {
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
    return coords;
  }

  // Rule 3: destination-proximity hint — son nokta hedefe ne kadar yakın?
  // Türkiye (lon 26-45, lat 36-42) çakışması nedeniyle magnitude tek başına yeterli değil.
  // as-is [lon=a, lat=b] vs swapped [lat=a, lon=b] için hedef mesafeleri karşılaştır.
  // 10x fark varsa kesin karar ver; daha küçük farkta OSRM standardına güven.
  if (destLon !== undefined && destLat !== undefined) {
    const last  = coords[coords.length - 1];
    const [la, lb] = last;
    const distAsIs = hav(lb, la, destLat, destLon);   // [lon=la, lat=lb] → hedef
    const distSwap = hav(la, lb, destLat, destLon);   // [lat=la, lon=lb] → hedef
    if (distSwap < distAsIs / 10) {
      console.warn(`[Route] dest-hint: [lat,lon] (swap=${distSwap.toFixed(0)}m asIs=${distAsIs.toFixed(0)}m) — swapping`);
      return coords.map(([x, y]) => [y, x]);
    }
    if (distAsIs < distSwap / 10) {
      return coords;
    }
  }

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

/** Stil değişimi aktifse tamamlanmasını bekle; aksi hâlde anında resolve eder.
 *  8s timeout: style.load hiç gelmezse (map hata, unmount) fetchRoute sonsuz bloke olmaz. */
const _STYLE_WAIT_TIMEOUT_MS = 8_000;
async function _waitForStyleReady(): Promise<void> {
  while (_styleChangePending) {
    await new Promise<void>(resolve => {
      let done = false;
      const finish = () => { if (!done) { done = true; resolve(); } };
      const id = setTimeout(finish, _STYLE_WAIT_TIMEOUT_MS);
      _styleReadyCallbacks.push(() => { clearTimeout(id); finish(); });
    });
  }
}

/* ── Alternatif Rota Seçimi ──────────────────────────────────── */

interface _StoredRoute {
  geometry:  [number, number][];
  distanceM: number;
  durationS: number;
  steps:     RouteStep[];
  hasToll:   boolean;
}
let _allRoutes: _StoredRoute[] = [];

function _storeAllRoutes(
  mainGeom:     [number, number][],
  altGeoms:     [number, number][][],
  altDistances: number[],
  altDurations: number[],
  altHasToll:   boolean[],
  altSteps:     RouteStep[][],
  steps:        RouteStep[],
  mainDist:     number,
  mainDur:      number,
  mainHasToll:  boolean,
): void {
  _allRoutes = [
    { geometry: mainGeom, distanceM: mainDist, durationS: mainDur, steps, hasToll: mainHasToll },
    ...altGeoms.map((g, i) => ({ geometry: g, distanceM: altDistances[i] ?? 0, durationS: altDurations[i] ?? 0, steps: altSteps[i] ?? [], hasToll: altHasToll[i] ?? false })),
  ];
}

/**
 * Rota seçimi — index = _allRoutes dizisindeki indeks (0=ilk OSRM rotası).
 * Seçilen rota ana (thick) çizgi olur; geri kalanlar alternatif (muted) olarak
 * haritaya yeniden çizilir ve altRealIndices güncellenir (harita tap için).
 */
export function selectAltRoute(index: number): void {
  if (index < 0 || index >= _allRoutes.length) return;
  const picked       = _allRoutes[index];
  const otherIndices = _allRoutes.map((_, i) => i).filter(i => i !== index);
  const otherRoutes  = otherIndices.map(i => _allRoutes[i]);
  useRouteStore.setState({
    geometry:             picked.geometry,
    cumulativeDistances:  buildCumulativeDistances(picked.geometry),
    totalDistanceMeters:  picked.distanceM,
    totalDurationSeconds: picked.durationS,
    steps:                picked.steps,
    hasToll:              picked.hasToll,
    selectedAltIndex:     index,
    currentStepIndex:     0,
    distanceToNextTurnMeters: 0,
    alternatives:         otherRoutes.map(r => r.geometry),
    altDistances:         otherRoutes.map(r => r.distanceM),
    altDurations:         otherRoutes.map(r => r.durationS),
    altHasToll:           otherRoutes.map(r => r.hasToll),
    altRealIndices:       otherIndices,
  });
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
  // Preserve currentStepIndex during loading so UI keeps the active turn instruction.
  // It will be overwritten to 0 once the new route geometry arrives.
  const { currentStepIndex: _prevStepIdx } = useRouteStore.getState();
  // ...INITIAL spreads cumulativeDistances: null → önceki Float64Array GC'ye serbest bırakılır.
  useRouteStore.setState({ ...INITIAL, loading: true, currentStepIndex: _prevStepIdx });

  // ── Katman 0: Native OSRM daemon ────────────────────────────
  if (isNative) {
    const daemonResult = await tryLocalDaemon(fromLon, fromLat, toLon, toLat);
    if (daemonResult) {
      if (!daemonResult.geometry || daemonResult.geometry.length < 2) {
        console.error('[ROUTE] Layer 0: daemon returned NO_GEOMETRY — falling through', { pts: daemonResult.geometry?.length ?? 0 });
      } else {
        await _waitForStyleReady();
        useRouteStore.setState({
          loading: false,
          error:   null,
          geometry:             daemonResult.geometry,
          cumulativeDistances:  buildCumulativeDistances(daemonResult.geometry),
          steps:                daemonResult.steps,
          totalDistanceMeters:  daemonResult.distanceM,
          totalDurationSeconds: daemonResult.durationS,
          currentStepIndex:     0,
          distanceToNextTurnMeters: 0,
          serverUsed:           'localhost:5000',
        });
        return;
      }
    }
  }

  // ── Katman 1-2: Uzak OSRM (Fail-Fast) ──────────────────────────────────────
  // navigator.onLine=false → uzak sunucu denemesi yapmadan offline katmana geç.
  // İlk OSRM isteği HEADERS_TIMEOUT_MS içinde yanıt vermezse → tüm sunucular kesilir,
  // anında Katman 3'e (A* Worker) düşülür. Kullanıcı "Hesaplanıyor..." ekranında beklemez.
  if (!navigator.onLine) {
    console.warn('[ROUTE] Fail-Fast: navigator.onLine=false → offline katmana geç');
  } else {
    const servers = getRoutingServers();
    for (const server of servers) {
      try {
        const result = await _tryServer(server, fromLon, fromLat, toLon, toLat);
        await _waitForStyleReady(); // stil yenileniyorsa layer hazır olana kadar bekle
        _storeAllRoutes(result.geometry, result.alternatives, result.altDistances, result.altDurations, result.altHasToll, result.altSteps, result.steps, result.distance, result.duration, result.hasToll);
        useRouteStore.setState({
          loading: false,
          error:   null,
          geometry:             result.geometry,
          cumulativeDistances:  buildCumulativeDistances(result.geometry),
          alternatives:         result.alternatives,
          altDistances:         result.altDistances,
          altDurations:         result.altDurations,
          altHasToll:           result.altHasToll,
          altRealIndices:       result.alternatives.map((_, i) => i + 1),
          selectedAltIndex:     0,
          hasToll:              result.hasToll,
          steps:                result.steps,
          totalDistanceMeters:  result.distance,
          totalDurationSeconds: result.duration,
          currentStepIndex:     0,
          distanceToNextTurnMeters: 0,
          serverUsed:           server,
        });
        return;
      } catch (e) {
        const _errMsg = e instanceof Error ? e.message : String(e);
        if (_errMsg === 'HEADERS_TIMEOUT') {
          // Tek sunucu yavaş → diğerlerini de dene, hepsi timeout'a girerse offline'a geç
          console.warn(`[ROUTE] Fail-Fast: ${server} ${HEADERS_TIMEOUT_MS}ms içinde yanıt vermedi → sonraki sunucuya geç`);
          continue;
        }
        console.warn(`[ROUTE] server ${server} failed:`, _errMsg);
      }
    }
  }

  // ── Katman 3: WebWorker A* (offline graph) ───────────────────
  const offlineResult = await computeOfflineRoute(fromLat, fromLon, toLat, toLon);
  if (offlineResult) {
    if (!offlineResult.geometry || offlineResult.geometry.length < 2) {
      console.error('[ROUTE] Layer 3: offline A* returned NO_GEOMETRY — falling through to straight-line', { pts: offlineResult.geometry?.length ?? 0 });
    } else {
      await _waitForStyleReady();
      const offlineSteps = offlineResult.steps.length > 0
        ? offlineResult.steps
        : [_makeSentinelStep(toLon, toLat, offlineResult.distanceM, offlineResult.durationS)];
      useRouteStore.setState({
        loading: false,
        error:   null,
        geometry:             offlineResult.geometry,
        cumulativeDistances:  buildCumulativeDistances(offlineResult.geometry),
        steps:                offlineSteps,
        totalDistanceMeters:  offlineResult.distanceM,
        totalDurationSeconds: offlineResult.durationS,
        currentStepIndex:     0,
        distanceToNextTurnMeters: 0,
        serverUsed:           offlineResult.source,
      });
      return;
    }
  }

  // ── Katman 4: Straight-line (son çare) ───────────────────────
  console.warn('[ROUTE] All OSRM layers failed — straight-line fallback');
  speakNavigation('İnternet bağlantısı yok. Düz hat navigasyon aktif.');
  const sl = straightLineRoute(fromLat, fromLon, toLat, toLon);
  await _waitForStyleReady(); // stil yenileniyorsa layer hazır olana kadar bekle
  useRouteStore.setState({
    loading: false,
    error:   'Offline harita verisi yok — düz hat navigasyon aktif.',
    geometry:             sl.geometry,
    cumulativeDistances:  buildCumulativeDistances(sl.geometry),
    steps:                [_makeSentinelStep(toLon, toLat, sl.distanceM, sl.durationS)],
    totalDistanceMeters:  sl.distanceM,
    totalDurationSeconds: sl.durationS,
    currentStepIndex:     0,
    distanceToNextTurnMeters: 0,
    serverUsed:           'straight-line',
  });
}

/**
 * Hız-bağımlı reroute throttle süresi.
 *   > 80 km/h  → 5 s  (otoyol — sapma hızlı gelir, kısa pencere)
 *   20–80 km/h → 10 s (nominal şehir içi sürüş)
 *   < 20 km/h  → 15 s (düşük hız / park — GPS jitter baskılaması)
 */
function _getRerouteThrottleMs(speedKmh: number): number {
  if (speedKmh > 80) return  5_000;
  if (speedKmh < 20) return 15_000;
  return 10_000;
}

/**
 * GPS güncellenince çağrılır — hangi adımdayız, sonraki dönüşe ne kadar?
 * 30m'den yaklaşılınca otomatik adım ilerler.
 * Sapma + hız-bağımlı throttle → otomatik yeniden rotalama.
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
  // Monotonic Guard: GPS zıplaması eski adıma geri döndürmemeli.
  newStepIdx = Math.max(newStepIdx, currentStepIndex);

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

  const now = performance.now();
  // Startup guard: navigasyon başından itibaren ilk 3s GPS henüz stabilize olmamıştır.
  // Anlık sapma tespiti, rota yeni çizilmişken yanlış reroute tetikleyebilir.
  if (_navContextStartMs > 0 && now - _navContextStartMs < 3_000) return;

  // ── Hız oku — hem throttle hem histerezis için kullanılır ─────────────────
  const { speed, location } = useUnifiedVehicleStore.getState();
  const speedKmh = (speed ?? 0) * 3.6;
  const accuracy = location?.accuracy ?? 999;

  if (now - _lastRerouteMs < _getRerouteThrottleMs(speedKmh)) return;

  if (speedKmh < 3) return;   // Dururken jitter önleme (Sensor Resiliency)
  if (accuracy > 50) return;  // Zayıf sinyal koruması (Sensor Resiliency)

  // Performans: geometry'yi seyrek örnekle, merkezi bul
  const sampleStep = Math.max(1, Math.floor(geometry.length / 50));
  let closestIdx = 0;
  let minPtDist  = Infinity;
  for (let i = 0; i < geometry.length; i += sampleStep) {
    const d = hav(lat, lon, geometry[i][1], geometry[i][0]);
    if (d < minPtDist) { minPtDist = d; closestIdx = i; }
  }

  // Merkez çevresindeki DEVIATION_WINDOW segmentini hassas kontrol et.
  // sampleStep padding: coarse scan'da iki örnek arası boşluğu (sampleStep-1 nokta) kapatır.
  const wStart = Math.max(0, closestIdx - DEVIATION_WINDOW - sampleStep);
  const wEnd   = Math.min(geometry.length - 2, closestIdx + DEVIATION_WINDOW + sampleStep);
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
    // Sapma en az 2 ardışık GPS tick'i boyunca sürerse reroute yap
    if (_deviationCounter >= 2) {
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
  if (_isFetchingRoute) return;
  _isFetchingRoute = true;
  _reroutingCb?.(true);
  try {
    await fetchRoute(fromLat, fromLon, toLat, toLon);
  } finally {
    _isFetchingRoute = false;
    _reroutingCb?.(false);
  }
}

/** Offline/straight-line modda HUD'un boş kalmaması için minimum tek adım üretir. */
function _makeSentinelStep(toLon: number, toLat: number, distanceM: number, durationS: number): RouteStep {
  return {
    instruction:      'Hedefe doğru ilerleyin',
    streetName:       '',
    distance:         distanceM,
    duration:         durationS,
    maneuverType:     'arrive',
    maneuverModifier: 'straight',
    coordinate:       [toLon, toLat],
  };
}

/**
 * Steps dizisi boşsa (offline/daemon modlar) hedef koordinatlarından sentinel adım enjekte eder.
 * activateNavigation() tarafından çağrılır — HUD'un undefined currentStep ile gizlenmesini önler.
 */
export function injectSentinelStepIfEmpty(toLat: number, toLon: number): void {
  const state = useRouteStore.getState();
  if (state.steps.length > 0) return;
  useRouteStore.setState({
    steps: [_makeSentinelStep(toLon, toLat, state.totalDistanceMeters, state.totalDurationSeconds)],
  });
}

/** Rota state'ini başlangıca döndür.
 *  INITIAL.cumulativeDistances === null → Float64Array GC'ye serbest bırakılır (Zero-Leak). */
export function clearRoute(): void {
  useRouteStore.setState(INITIAL);
  _deviationCounter = 0;
  _allRoutes = [];
}

/** Snapshot (non-hook) — test ve non-React context için. */
export function getRouteState(): RouteState {
  return useRouteStore.getState();
}

/** React hook — NavigationHUD ve FullMapView için. */
export function useRouteState(): RouteState {
  return useRouteStore(s => s);
}

/** ACTIVE navigasyona geçildiğinde alternatif rotaları store'dan kaldır (CPU tasarrufu). */
export function clearAltRoutes(): void {
  useRouteStore.setState({
    alternatives:   [],
    altDistances:   [],
    altDurations:   [],
    altHasToll:     [],
    altRealIndices: [],
  });
}

/**
 * Tahmini yakıt tüketimi (Litre).
 * Heuristik: 7.5L/100km — araç profil verisi yoksa genel binek otomobil ortalaması.
 */
export function computeFuelEstimate(distanceM: number): number {
  const L_PER_100KM = 7.5;
  return Math.round((distanceM / 1_000 / 100) * L_PER_100KM * 10) / 10;
}
