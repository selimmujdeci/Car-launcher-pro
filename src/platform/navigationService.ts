import { create } from 'zustand';
import type { Address } from './addressBookService';
import { sensitiveKeyStore } from './sensitiveKeyStore';
import {
  setRerouteContext,
  clearRerouteContext,
  registerReroutingCallback,
  getRouteState,
  pointToSegmentDist,
  projectOnSegment,
} from './routingService';
import { useUnifiedVehicleStore } from './vehicleDataLayer/UnifiedVehicleStore';

/* ── Navigasyon Durum Makinesi ───────────────────────────────── */

export const NavStatus = {
  IDLE:      'IDLE',
  PREVIEW:   'PREVIEW',   // Hedef seçildi, PreviewCard gösteriliyor
  ROUTING:   'ROUTING',   // Rota hesaplanıyor (loading)
  ACTIVE:    'ACTIVE',    // Navigasyon aktif, TurnPanel gösteriliyor
  REROUTING: 'REROUTING', // Sapma tespit edildi, yeni rota hesaplanıyor
  ARRIVED:   'ARRIVED',   // Hedefe varıldı (5 s sonra IDLE'a geçer)
  ERROR:     'ERROR',     // Kurtarılamaz hata
} as const;

export type NavStatus = typeof NavStatus[keyof typeof NavStatus];

// IDLE ve ERROR dışındaki tüm durumlar "aktif navigasyon" sayılır
const NAVIGATING_STATUSES = new Set<string>([
  NavStatus.PREVIEW, NavStatus.ROUTING, NavStatus.ACTIVE,
  NavStatus.REROUTING, NavStatus.ARRIVED,
]);

export interface NavigationState {
  status: NavStatus;
  isNavigating: boolean;         // derived: NAVIGATING_STATUSES ∋ status
  isRerouting: boolean;          // derived: status === REROUTING
  destination: Address | null;
  distanceMeters?: number;
  etaSeconds?: number;
  headingToDestination?: number;
  isOfflineResult: boolean;
  errorMessage?: string;
}

interface NavigationStore extends NavigationState {
  _setStatus: (s: NavStatus, extra?: Partial<NavigationState>) => void;
  setDestination: (destination: Address | null, isOffline?: boolean) => void;
  updateDistance: (distance: number) => void;
  updateEta: (seconds: number) => void;
  updateHeading: (heading: number) => void;
  setRerouting: (val: boolean) => void;
  clearNavigation: () => void;
  setOfflineResult: (val: boolean) => void;
}

const useNavigationStore = create<NavigationStore>((set) => ({
  status: NavStatus.IDLE,
  isNavigating: false,
  isRerouting: false,
  destination: null,
  distanceMeters: undefined,
  etaSeconds: undefined,
  headingToDestination: undefined,
  isOfflineResult: false,
  errorMessage: undefined,

  _setStatus: (status, extra = {}) => set({
    status,
    isNavigating: NAVIGATING_STATUSES.has(status),
    isRerouting:  status === NavStatus.REROUTING,
    ...extra,
  }),

  setDestination: (destination, isOffline = false) => set({
    status: NavStatus.PREVIEW,
    isNavigating: true,
    isRerouting: false,
    destination,
    isOfflineResult: isOffline,
    errorMessage: undefined,
  }),

  updateDistance: (distance) => set({ distanceMeters: distance }),
  updateEta:      (seconds)  => set({ etaSeconds: seconds }),
  updateHeading:  (heading)  => set({ headingToDestination: heading }),

  // Rerouting callback: only ACTIVE→REROUTING and REROUTING→ACTIVE.
  // Prevents a stale reroute callback from overwriting ARRIVED/IDLE/PREVIEW.
  setRerouting: (val) => set((state) => ({
    isRerouting: val,
    status: val
      ? (state.status === NavStatus.ACTIVE    ? NavStatus.REROUTING : state.status)
      : (state.status === NavStatus.REROUTING ? NavStatus.ACTIVE    : state.status),
  })),

  setOfflineResult: (val) => set({ isOfflineResult: val }),

  clearNavigation: () => set({
    status: NavStatus.IDLE,
    isNavigating: false,
    isRerouting: false,
    destination: null,
    distanceMeters: undefined,
    etaSeconds: undefined,
    isOfflineResult: false,
    errorMessage: undefined,
  }),
}));

// Distance hierarchy: ARRIVAL < STEP_ADVANCE < REROUTE (see routingService for the others)
export const ARRIVAL_THRESHOLD_M = 20;

// 5 s ARRIVED → IDLE timer
let _arrivedTimer: ReturnType<typeof setTimeout> | null = null;

/** Hedefe varış — ARRIVED durumuna geç ve 5 s sonra IDLE'a dön. */
function transitionToArrived(): void {
  const { status } = useNavigationStore.getState();
  if (status !== NavStatus.ACTIVE && status !== NavStatus.REROUTING) return;

  clearRerouteContext(); // artık sapma tespiti yapma
  useNavigationStore.getState()._setStatus(NavStatus.ARRIVED);

  if (_arrivedTimer) clearTimeout(_arrivedTimer);
  _arrivedTimer = setTimeout(() => {
    _arrivedTimer = null;
    stopNavigation();
  }, 5_000);
}

/**
 * Hedef seçildi — PREVIEW durumuna gir.
 */
export function startNavigation(destination: Address, isOffline = false): void {
  useNavigationStore.getState().setDestination(destination, isOffline);
  setRerouteContext(destination.latitude, destination.longitude);
  registerReroutingCallback((val) => useNavigationStore.getState().setRerouting(val));
}

/**
 * "Başlat" butonuna basıldı — ACTIVE durumuna geç.
 * FullMapView'daki handleNavStart tarafından çağrılır.
 */
export function activateNavigation(): void {
  const { status } = useNavigationStore.getState();
  if (status === NavStatus.PREVIEW || status === NavStatus.ROUTING) {
    useNavigationStore.getState()._setStatus(NavStatus.ACTIVE);
    _startDeadReckoning(); // Zero-Leak: stopped in stopNavigation()
  }
}

/**
 * Dış callerlar (FullMapView) için ham durum değiştirici.
 * Kullanım: ROUTING başlatmak için fetchRoute'tan önce çağrılır.
 */
export function setNavStatus(status: NavStatus): void {
  useNavigationStore.getState()._setStatus(status);
}

/**
 * Navigasyonu durdur ve IDLE'a dön.
 */
export function stopNavigation(): void {
  if (_arrivedTimer) { clearTimeout(_arrivedTimer); _arrivedTimer = null; }
  useNavigationStore.getState().clearNavigation();
  clearRerouteContext();
  // Zero-Leak: DR timer durdur
  _stopDeadReckoning();
  // Reset per-session tracking state so next navigation starts clean
  _speedHistory.length = 0;
  _stopStartMs         = null;
  _lastEtaUpdateMs     = 0;
  _lastRouteDistanceM  = Infinity;
  _lastGeoHash         = '';
  _lastClosestSegIdx   = -1;
  _drLat               = null;
  _drLon               = null;
  _lastGpsMs           = 0;
  _lastHeadingDeg      = 0;
}

/**
 * Get current navigation state (snapshot — non-reactive)
 */
export function getNavigationState(): NavigationState {
  const s = useNavigationStore.getState();
  return {
    status:             s.status,
    isNavigating:       s.isNavigating,
    isRerouting:        s.isRerouting,
    destination:        s.destination,
    distanceMeters:     s.distanceMeters,
    etaSeconds:         s.etaSeconds,
    headingToDestination: s.headingToDestination,
    isOfflineResult:    s.isOfflineResult,
    errorMessage:       s.errorMessage,
  };
}

// ETA hysteresis — prevents UI flickering from second-to-second speed jitter
let _lastEtaUpdateMs    = 0;
const ETA_HYSTERESIS_MS = 5_000;

// 30-second rolling speed window (sampled at ETA_HYSTERESIS_MS cadence)
interface _SpeedSample { speedKmh: number; ts: number; }
const _speedHistory: _SpeedSample[] = [];
const SPEED_HISTORY_MS    = 30_000;  // rolling window width
const STOP_THRESHOLD_KMH  = 3;       // km/h below which vehicle is "stopped"
const TRAFFIC_DELAY_RATIO = 0.35;    // 35% of stopped seconds added as traffic buffer

// Traffic stop tracking — updated at GPS frequency for accurate stop duration
let _stopStartMs: number | null = null;

// Monotonic remaining-distance: distance may only decrease along a single route geometry.
// Resets automatically when geometry changes (new route / reroute).
let _lastRouteDistanceM  = Infinity;
let _lastGeoHash         = '';
// Windowed-search position tracker: last known closest segment index.
// -1 = uninitialized → triggers full O(N) scan on next call (once per route).
// Subsequent calls use O(W) window search (W ≈ 52 segments ≈ ≤1.5 km ahead).
let _lastClosestSegIdx   = -1;

// ── Dead Reckoning ──────────────────────────────────────────────────────────
// Tünel veya sinyal kaybı sırasında aracın son GPS konumundan OBD hızı + yön
// ile ilerletilmiş tahmini konumunu tutar.  GPS gelince anında gerçek konumla
// güncellenir.  Mesafe güncellemesi yapılır, varış kesinlikle tetiklenmez.
const DR_GPS_STALE_MS = 2_000; // GPS bu kadar susarsa DR devreye girer (ms)
const DR_INTERVAL_MS  = 500;   // DR güncelleme aralığı — GPS polling'in yarısı
const ARRIVAL_SPEED_GUARD_KMH = 10; // varış için maksimum hız eşiği

let _drLat:      number | null = null; // son bilinen / DR ile ilerletilen konum
let _drLon:      number | null = null;
let _lastGpsMs:  number        = 0;   // son GPS güncellemesinin monotonic timestamp'i
let _lastHeadingDeg: number    = 0;   // son bilinen araç yönü (derece, kuzey = 0)
let _drTimerId:  ReturnType<typeof setInterval> | null = null;

/**
 * Update navigation progress (distance, ETA, heading).
 * routeGeometry — OSRM/Valhalla [lon, lat] çifti dizisi; sağlandığında
 *   rota üzerindeki kalan mesafe hesabı için kullanılır (hazır arayüz).
 */
export function updateNavigationProgress(
  currentLat: number,
  currentLon: number,
  currentHeading: number,
  routeGeometry?: [number, number][]
): void {
  const state = useNavigationStore.getState();
  if (!state.destination) return;

  // Progress tracking only meaningful while driving — PREVIEW/ROUTING have no live route yet
  if (state.status !== NavStatus.ACTIVE && state.status !== NavStatus.REROUTING) return;

  // ── Dead Reckoning anchor — GPS geldiğinde hemen güncelle ───────────────────
  _lastGpsMs = Date.now();
  _drLat     = currentLat;
  _drLon     = currentLon;
  if (Number.isFinite(currentHeading)) _lastHeadingDeg = currentHeading;

  // Rota geometrisi varsa üzerindeki mesafeyi kullan; yoksa Haversine fallback
  const { cumulativeDistances } = getRouteState();
  const distance = routeGeometry && routeGeometry.length >= 2
    ? calculateRouteDistance(currentLat, currentLon, routeGeometry, cumulativeDistances)
    : calculateDistance(currentLat, currentLon, state.destination.latitude, state.destination.longitude);

  // ── Varış tespiti (zırhlanmış) ─────────────────────────────────────────────
  // Sadece mesafe yetmez — GPS gürültüsü veya yakın geçiş yanlış varış verir.
  // Koşul: mesafe < 20m AND (hız < 10 km/h OR son rota adımına ulaşıldı)
  if (distance < ARRIVAL_THRESHOLD_M) {
    const { speed: _rawArrSpd }  = useUnifiedVehicleStore.getState();
    const speedAtArrival         = (_rawArrSpd ?? 0) * 3.6;
    const { steps, currentStepIndex } = getRouteState();
    const atFinalStep = steps.length > 0 && currentStepIndex >= steps.length - 1;

    if (speedAtArrival < ARRIVAL_SPEED_GUARD_KMH || atFinalStep) {
      transitionToArrived();
      return;
    }
    // Hız yüksek ve son adımda değil — GPS gürültüsü olabilir; devam et
  }

  // Heading
  const rawHeading = calculateHeading(
    currentLat, currentLon,
    state.destination.latitude, state.destination.longitude
  );
  const heading = Number.isFinite(rawHeading) ? rawHeading : 0;

  useNavigationStore.getState().updateDistance(distance);
  useNavigationStore.getState().updateHeading(heading);

  // ── ETA ────────────────────────────────────────────────────────────────
  const now = Date.now();

  // Stop tracking at GPS frequency for accurate standstill duration
  const { speed: _rawSpd } = useUnifiedVehicleStore.getState();
  const currentSpeedKmh    = (_rawSpd ?? 0) * 3.6;
  if (currentSpeedKmh < STOP_THRESHOLD_KMH) {
    if (_stopStartMs === null) _stopStartMs = now;
  } else {
    _stopStartMs = null;
  }

  // ETA update gate — 5 s hysteresis prevents UI flickering
  if (now - _lastEtaUpdateMs >= ETA_HYSTERESIS_MS) {
    _lastEtaUpdateMs = now;

    // Populate 30-second rolling speed window (evict stale samples)
    _speedHistory.push({ speedKmh: currentSpeedKmh, ts: now });
    const cutoff = now - SPEED_HISTORY_MS;
    while (_speedHistory.length > 0 && _speedHistory[0].ts < cutoff) _speedHistory.shift();

    // Linearly weighted average: newest sample weight=1.0, oldest weight=0.1
    const rollingAvgKmh = _weightedAvgSpeed(now);

    // Road-type hint: expected speed from current OSRM step (distance ÷ duration)
    // Uses RouteStep.duration added in Packet 2 — available when OSRM responded.
    const { steps, currentStepIndex } = getRouteState();
    const step           = steps[currentStepIndex];
    const roadSpeedKmh   = (step?.duration ?? 0) > 0
      ? (step.distance / step.duration) * 3.6
      : undefined;

    // Blend: actual rolling speed (60%) + OSRM road-design speed (40%)
    const blendedKmh = roadSpeedKmh !== undefined
      ? 0.60 * rollingAvgKmh + 0.40 * roadSpeedKmh
      : rollingAvgKmh;

    // Hard floor 5 km/h — prevents division near-zero; realistic for any moving vehicle
    const effectiveKmh = Math.max(blendedKmh, 5);

    // Traffic delay buffer: accumulate delay while stopped instead of freezing ETA
    const stopDurationS  = _stopStartMs !== null ? (now - _stopStartMs) / 1000 : 0;
    const trafficBufferS = Math.round(stopDurationS * TRAFFIC_DELAY_RATIO);
    const movementEtaS   = Math.round((distance / 1000 / effectiveKmh) * 3600);

    useNavigationStore.getState().updateEta(movementEtaS + trafficBufferS);
  }
}

/**
 * Rota geometrisi üzerinde mevcut konumdan hedefe kalan mesafeyi hesaplar.
 *
 * Karmaşıklık:
 *   İlk çağrı (yeni geometri): O(N) tam tarama → _lastClosestSegIdx sıfırlanır.
 *   Sonraki çağrılar:          O(W) windowed search, W ≈ 52 segment sabit.
 *   Kümülatif lookup:          O(1) — cumulativeDistances[closestSegIdx+1] direkt okunur.
 *   500 km rotada (~10k nokta) CPU maliyeti: ~52 Haversine + 1 dizi okuması / tick.
 *
 * Segment projection: GPS pozisyonu P, en yakın AB segmentine yansıtılır.
 * Kalan mesafe = |P'B| + cumulativeDistances[B_idx].
 *
 * Monotonic clamp: aynı geometride mesafe asla artmaz (GPS jitter koruması).
 */
function calculateRouteDistance(
  lat:     number,
  lon:     number,
  geometry: [number, number][],
  cumDist: Float64Array | null,
): number {
  // Geometry change → reset all per-route state
  const geoHash = `${geometry.length}:${geometry[0][0].toFixed(4)},${geometry[0][1].toFixed(4)}` +
                  `:${geometry[geometry.length - 1][0].toFixed(4)},${geometry[geometry.length - 1][1].toFixed(4)}`;
  if (geoHash !== _lastGeoHash) {
    _lastGeoHash        = geoHash;
    _lastRouteDistanceM = Infinity;
    _lastClosestSegIdx  = -1;   // force full O(N) scan on first tick of new geometry
  }

  // ── Step 1: find closest segment ─────────────────────────────────────
  // First call after geometry change: full O(N) scan to locate initial position.
  // All subsequent calls: O(52) window (2-back for GPS noise + 50-forward lookahead).
  let closestSegIdx = _lastClosestSegIdx < 0 ? 0 : _lastClosestSegIdx;
  let minSegDist    = Infinity;

  if (_lastClosestSegIdx < 0) {
    for (let i = 0; i < geometry.length - 1; i++) {
      const d = pointToSegmentDist(lat, lon,
        geometry[i][1], geometry[i][0], geometry[i + 1][1], geometry[i + 1][0]);
      if (d < minSegDist) { minSegDist = d; closestSegIdx = i; }
    }
  } else {
    const wStart = Math.max(0,                  _lastClosestSegIdx - 2);
    const wEnd   = Math.min(geometry.length - 2, _lastClosestSegIdx + 50);
    closestSegIdx = wStart;
    for (let i = wStart; i <= wEnd; i++) {
      const d = pointToSegmentDist(lat, lon,
        geometry[i][1], geometry[i][0], geometry[i + 1][1], geometry[i + 1][0]);
      if (d < minSegDist) { minSegDist = d; closestSegIdx = i; }
    }
  }
  _lastClosestSegIdx = closestSegIdx;

  // ── Step 2: project P onto closest segment → P' ───────────────────────
  const [aLon, aLat] = geometry[closestSegIdx];
  const [bLon, bLat] = geometry[closestSegIdx + 1];
  const t    = projectOnSegment(lat, lon, aLat, aLon, bLat, bLon);
  const pLat = aLat + t * (bLat - aLat);
  const pLon = aLon + t * (bLon - aLon);

  // ── Step 3: remaining = |P'→B| + suffix-sum from B ─────────────────
  // O(1) with precomputed cumDist; O(N) fallback when unavailable (should not occur).
  const partialM  = calculateDistance(pLat, pLon, bLat, bLon);
  const suffixIdx = closestSegIdx + 1;
  const remaining = (cumDist && cumDist.length === geometry.length)
    ? partialM + cumDist[suffixIdx]
    : partialM + _sumRemainingSegments(geometry, suffixIdx);

  // Monotonic clamp: reject upward jitter on the same geometry
  const clamped       = Math.min(remaining, _lastRouteDistanceM);
  _lastRouteDistanceM = clamped;
  return clamped;
}

/** O(N) fallback — executes only when cumulativeDistances is absent (defensive path). */
function _sumRemainingSegments(geometry: [number, number][], fromIdx: number): number {
  let sum = 0;
  for (let i = fromIdx; i < geometry.length - 1; i++) {
    sum += calculateDistance(
      geometry[i][1],     geometry[i][0],
      geometry[i + 1][1], geometry[i + 1][0],
    );
  }
  return sum;
}

/**
 * Dead Reckoning tick — DR_INTERVAL_MS'de bir çalışır.
 * GPS _lastGpsMs'den DR_GPS_STALE_MS+ kadar sessizse OBD hızı + yön ile
 * _drLat/_drLon ilerletilir ve kalan mesafe store'a yazılır.
 * Varış ASLA DR'den tetiklenmez — GPS onayı zorunlu (tünel çıkışı senaryosu).
 */
function _tickDeadReckoning(): void {
  const navState = useNavigationStore.getState();
  if (navState.status !== NavStatus.ACTIVE && navState.status !== NavStatus.REROUTING) return;
  if (!navState.destination) return;

  const lat = _drLat;
  const lon = _drLon;
  if (lat === null || lon === null) return;

  if (Date.now() - _lastGpsMs < DR_GPS_STALE_MS) return; // GPS taze — DR gerekli değil

  const { speed: rawSpd } = useUnifiedVehicleStore.getState();
  const speedMs = rawSpd ?? 0;
  if (speedMs <= 0) return; // araç duruyorsa konum değişmez

  // ── Heading: gpsService DR pusula verisiyle store'u günceller; tünelde de çalışır ─
  // GPS koptuğunda _lastHeadingDeg donardı; UnifiedVehicleStore.heading gpsService'in
  // pusula-karıştırmasını (blending) yansıtır ve tünel içi dönüşlerde güncellenir.
  const liveHeading = useUnifiedVehicleStore.getState().heading;
  if (liveHeading !== null && Number.isFinite(liveHeading)) _lastHeadingDeg = liveHeading;

  // Flat-earth dead reckoning (< 2 km aralık için doğru; baş-birim: kuzey=0 saat yönü)
  const headRad = (_lastHeadingDeg * Math.PI) / 180;
  const distM   = speedMs * (DR_INTERVAL_MS / 1000);
  const newLat  = lat + (distM * Math.cos(headRad)) / 111_320;
  const newLon  = lon + (distM * Math.sin(headRad)) / (111_320 * Math.cos(lat * Math.PI / 180));

  _drLat = newLat;
  _drLon = newLon;

  const { geometry, cumulativeDistances } = getRouteState();
  const distance = geometry && geometry.length >= 2
    ? calculateRouteDistance(newLat, newLon, geometry, cumulativeDistances)
    : calculateDistance(newLat, newLon, navState.destination.latitude, navState.destination.longitude);

  // Varışı DR üzerinden tetikleme — GPS onayı zorunlu (tünel çıkışında geri sıçrama önlenir)
  if (distance >= ARRIVAL_THRESHOLD_M) {
    useNavigationStore.getState().updateDistance(distance);
  }
}

function _startDeadReckoning(): void {
  if (_drTimerId !== null) return;
  _drTimerId = setInterval(_tickDeadReckoning, DR_INTERVAL_MS);
}

function _stopDeadReckoning(): void {
  if (_drTimerId !== null) {
    clearInterval(_drTimerId);
    _drTimerId = null;
  }
}

/** Linearly weighted average of the 30-second speed history.
 *  Newest sample → weight 1.0; oldest → weight 0.1.  */
function _weightedAvgSpeed(nowMs: number): number {
  if (_speedHistory.length === 0) return 0;
  let weightedSum = 0;
  let weightTotal = 0;
  for (const sample of _speedHistory) {
    const age    = nowMs - sample.ts;
    const weight = 1.0 - 0.9 * (age / SPEED_HISTORY_MS); // linear ramp
    weightedSum += sample.speedKmh * weight;
    weightTotal += weight;
  }
  return weightTotal > 0 ? weightedSum / weightTotal : 0;
}

/**
 * Calculate distance between two points (Haversine formula)
 */
function calculateDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371000; // Earth radius in meters
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Calculate heading from point A to point B
 */
function calculateHeading(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const lat1Rad = (lat1 * Math.PI) / 180;
  const lat2Rad = (lat2 * Math.PI) / 180;

  const y = Math.sin(dLon) * Math.cos(lat2Rad);
  const x =
    Math.cos(lat1Rad) * Math.sin(lat2Rad) -
    Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(dLon);

  let heading = (Math.atan2(y, x) * 180) / Math.PI;
  heading = (heading + 360) % 360;
  return heading;
}

/**
 * Format distance for display — Tesla style with space separator
 */
export function formatDistance(meters: number): string {
  if (meters < 1000) {
    return `${Math.round(meters)} m`;
  }
  return `${(meters / 1000).toFixed(1)} km`;
}

/**
 * Format ETA for display — Turkish: "20 dk" / "4 sa 38 dk"
 */
export function formatEta(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '—';
  const hours   = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) return `${hours} sa ${minutes} dk`;
  return `${minutes} dk`;
}

/**
 * Searches local navigation history for a match.
 */
async function searchOffline(query: string): Promise<Address | null> {
  try {
    const raw = await sensitiveKeyStore.get('nav_history');
    if (!raw) return null;
    const history = JSON.parse(raw) as Address[];
    const normalizedQuery = query.toLowerCase().trim();

    // Priority 1: Simple substring match
    const match = history.find(addr => 
      addr.name.toLowerCase().includes(normalizedQuery)
    );
    if (match) return match;

    // Priority 2: character overlap score ≥ 80%
    const scored = history
      .map((addr) => {
        const name    = addr.name.toLowerCase();
        const shorter = normalizedQuery.length <= name.length ? normalizedQuery : name;
        const longer  = normalizedQuery.length >  name.length ? normalizedQuery : name;
        let matches = 0;
        for (const ch of shorter) {
          if (longer.includes(ch)) matches++;
        }
        return { addr, score: shorter.length ? matches / shorter.length : 0 };
      })
      .filter((x) => x.score >= 0.8)
      .sort((a, b) => b.score - a.score);

    return scored[0]?.addr ?? null;
  } catch {
    return null;
  }
}

/**
 * Adds a successful navigation destination to local history (max 50, circular).
 */
async function addToHistory(address: Address): Promise<void> {
  try {
    const raw = await sensitiveKeyStore.get('nav_history');
    let history: Address[] = [];
    if (raw) {
      history = JSON.parse(raw) as Address[];
    }

    // Remove if already exists (to move to front/avoid duplicates)
    history = history.filter(a => 
      a.latitude !== address.latitude || a.longitude !== address.longitude
    );

    // Add to front
    history.unshift(address);

    // Limit to 50
    if (history.length > 50) {
      history = history.slice(0, 50);
    }

    await sensitiveKeyStore.set('nav_history', JSON.stringify(history));
  } catch {
    // write failure is non-fatal
  }
}

/**
 * Metin adresini Nominatim ile geocode edip navigasyonu başlatır.
 * Sesli komut entegrasyonu için kullanılır.
 * Başarısız olursa false döner (ağ yok / adres bulunamadı).
 */
export async function navigateToAddress(text: string): Promise<boolean> {
  // 1. Network Check
  if (!navigator.onLine) {
    const offlineMatch = await searchOffline(text);
    if (offlineMatch) {
      startNavigation(offlineMatch, true);
      // Move to front of history
      await addToHistory(offlineMatch);
      return true;
    }
    return false;
  }

  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 6_000);
  
  try {
    const q   = encodeURIComponent(text);
    const url = `https://nominatim.openstreetmap.org/search?q=${q}&format=json&limit=1`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'CarLauncherPro/1.0' },
      signal: ctrl.signal,
    });
    const data = await res.json() as Array<{ display_name: string; lat: string; lon: string }>;
    
    if (!data.length) {
      // Nominatim found nothing, try offline fallback
      const offlineMatch = await searchOffline(text);
      if (offlineMatch) {
        startNavigation(offlineMatch, true);
        await addToHistory(offlineMatch);
        return true;
      }
      return false;
    }

    const r = data[0];
    const destination: Address = {
      id:        `geo-${Date.now()}`,
      name:      r.display_name.split(',')[0].trim(),
      latitude:  parseFloat(r.lat),
      longitude: parseFloat(r.lon),
      type:      'history',
    };

    startNavigation(destination, false);
    // 2. Persistence on success (Write Throttling)
    await addToHistory(destination);
    return true;
  } catch {
    // AbortError (timeout) veya ağ hatası → yerel geçmişe fallback
    const offlineMatch = await searchOffline(text);
    if (offlineMatch) {
      startNavigation(offlineMatch, true);
      await addToHistory(offlineMatch);
      return true;
    }
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Use hook for navigation state
 */
export function useNavigation() {
  const status             = useNavigationStore((s) => s.status);
  const isNavigating       = useNavigationStore((s) => s.isNavigating);
  const isRerouting        = useNavigationStore((s) => s.isRerouting);
  const destination        = useNavigationStore((s) => s.destination);
  const distanceMeters     = useNavigationStore((s) => s.distanceMeters);
  const etaSeconds         = useNavigationStore((s) => s.etaSeconds);
  const headingToDestination = useNavigationStore((s) => s.headingToDestination);
  const isOfflineResult    = useNavigationStore((s) => s.isOfflineResult);
  const errorMessage       = useNavigationStore((s) => s.errorMessage);

  return {
    status,
    isNavigating,
    isRerouting,
    destination,
    distanceMeters,
    etaSeconds,
    headingToDestination,
    isOfflineResult,
    errorMessage,
  };
}
