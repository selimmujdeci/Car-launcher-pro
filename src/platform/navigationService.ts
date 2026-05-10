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
  injectSentinelStepIfEmpty,
} from './routingService';
import { useUnifiedVehicleStore } from './vehicleDataLayer/UnifiedVehicleStore';
import { speakNavigation } from './ttsService';

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
  // Çift güvenlik: activateNavigation() çağrılmadan ARRIVED asla tetiklenemez.
  if (!_navigationStarted) return;

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
 * "NAVİGASYONU BAŞLAT" butonuna basıldı — ACTIVE durumuna geç.
 * FullMapView'daki handleNavStart tarafından çağrılır.
 */
export function activateNavigation(): void {
  const { status } = useNavigationStore.getState();
  if (status === NavStatus.PREVIEW || status === NavStatus.ROUTING) {
    useNavigationStore.getState()._setStatus(NavStatus.ACTIVE);
    _navActivatedAtMs       = performance.now();
    _navStartLat            = null;
    _navStartLon            = null;
    _navigationStarted      = true;
    _arrivalLowSpeedStartMs = null;
    _arrivalDistanceBelow   = 0;
    _proximityAlertFired    = false;
    console.log('[NAV_STARTED]', { ts: _navActivatedAtMs, status });
    // HUD güvencesi: offline/daemon modda steps boş gelebilir — sentinel enjekte et
    const { destination } = useNavigationStore.getState();
    if (destination) {
      injectSentinelStepIfEmpty(destination.latitude, destination.longitude);
    }
    // Konum merkezi kaynaktan gelir (useUnifiedVehicleStore) — yerel DR yok
  }
}

/**
 * Dış callerlar (FullMapView) için ham durum değiştirici.
 * Kullanım: ROUTING başlatmak için fetchRoute'tan önce çağrılır.
 * errorMessage: ERROR durumuna geçerken gösterilecek mesaj.
 */
export function setNavStatus(status: NavStatus, errorMessage?: string): void {
  useNavigationStore.getState()._setStatus(status, errorMessage ? { errorMessage } : undefined);
}

/**
 * Navigasyonu durdur ve IDLE'a dön.
 */
export function stopNavigation(): void {
  if (_arrivedTimer) { clearTimeout(_arrivedTimer); _arrivedTimer = null; }
  useNavigationStore.getState().clearNavigation();
  clearRerouteContext();
  // Per-session izleme state'ini sıfırla — sonraki navigasyon temiz başlar
  _speedHistory.length    = 0;
  _stopStartMs            = null;
  _lastEtaUpdateMs        = -ETA_HYSTERESIS_MS;
  _lastStoredEtaS         = 0;
  _lastRouteDistanceM     = Infinity;
  _lastGeoHash            = '';
  _lastClosestSegIdx      = -1;
  _navActivatedAtMs       = 0;
  _navStartLat            = null;
  _navStartLon            = null;
  _navigationStarted      = false;
  _arrivalLowSpeedStartMs = null;
  _arrivalDistanceBelow   = 0;
  _proximityAlertFired    = false;
  _lastSnappedLat         = null;
  _lastSnappedLon         = null;
  _lastOffRouteM          = Infinity;
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
let _lastStoredEtaS     = 0;
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
// CLAMP_SLACK_M: maximum upward correction allowed per GPS tick.
// Prevents freeze after Dead Reckoning while still rejecting large GPS spikes.
const CLAMP_SLACK_M      = 50; // metres
let _lastRouteDistanceM  = Infinity;
let _lastGeoHash         = '';
// Windowed-search position tracker: last known closest segment index.
// -1 = uninitialized → triggers full O(N) scan on next call (once per route).
// Subsequent calls use O(W) window search (W ≈ 52 segments ≈ ≤1.5 km ahead).
let _lastClosestSegIdx   = -1;

// ── Visual Snapping state ────────────────────────────────────────────────────
// calculateRouteDistance günceller; getSnappedMarkerPosition() dışa açar.
// FullMapView RAF döngüsü bu verilerle marker'ı rota üzerinde gösterir.
let _lastSnappedLat: number | null = null;
let _lastSnappedLon: number | null = null;
let _lastOffRouteM: number         = Infinity; // en yakın segment mesafesi (m)

const ARRIVAL_SPEED_GUARD_KMH          = 10;    // varış için maksimum hız eşiği
const ARRIVAL_MIN_MOVE_M               = 50;    // navigasyon başından bu yana minimum hareket (m)
const ARRIVAL_CONSECUTIVE_LOW_SPEED_MS = 5_000; // düşük hız için zorunlu sürekli süre (ms)

// ── Varış Histerezisi — GPS spike koruması ───────────────────────────────────
// Tünel çıkışında GPS sıçraması tek tick'te eşik altına düşebilir.
// Sahte varış (false-positive) engellemek için ardışık okuma sayısı zorunlu.
const ARRIVAL_HYSTERESIS_COUNT  = 3; // soft trigger: kaç ardışık GPS tick < eşik
const ARRIVAL_HARD_HYSTERESIS   = 2; // hard trigger (5m): minimum ardışık sayısı

// 500m yakınlık sesli uyarısı — hedefe yaklaşıldığında tek seferlik TTS
const PROXIMITY_ALERT_M         = 500;

// ETA trafik histerezisi — araç durduğunda güncelleme hızlandırılır
const ETA_TRAFFIC_HYSTERESIS_MS = 2_000;

// Aktivasyon state — activateNavigation() set eder, stopNavigation() temizler
let _navActivatedAtMs:      number        = 0;
let _navStartLat:           number | null = null;
let _navStartLon:           number | null = null;
// navigationStarted: ACTIVE geçişi activateNavigation() üzerinden mi yapıldı?
// false iken ARRIVED asla tetiklenmez.
let _navigationStarted:     boolean       = false;
// Sürekli düşük hız takibi: hız < ARRIVAL_SPEED_GUARD_KMH olan ilk anın timestamp'i.
let _arrivalLowSpeedStartMs: number | null = null;
// Varış histerezisi: ARRIVAL_THRESHOLD_M altında ardışık GPS tick sayısı.
// GPS sıçraması (1 tick) sayacı sıfırlar → sahte varış tetiklenmez.
let _arrivalDistanceBelow  = 0;
// 500m yakınlık uyarısı: her navigasyon session'ında bir kez tetiklenir.
let _proximityAlertFired   = false;


/**
 * Update navigation progress (distance, ETA, heading).
 * routeGeometry — OSRM/Valhalla [lon, lat] çifti dizisi; sağlandığında
 *   rota üzerindeki kalan mesafe hesabı için kullanılır (hazır arayüz).
 */
export function updateNavigationProgress(
  currentLat: number,
  currentLon: number,
  _currentHeading: number,  // API uyumluluğu için korundu; yön hedefe olan bearing'den hesaplanır
  routeGeometry?: [number, number][]
): void {
  const state = useNavigationStore.getState();
  if (!state.destination) return;

  // Progress tracking only meaningful while driving — PREVIEW/ROUTING have no live route yet
  if (state.status !== NavStatus.ACTIVE && state.status !== NavStatus.REROUTING) {
    if (state.destination) {
      console.log('[ARRIVAL_CHECK_SKIPPED]', { reason: 'not_active', status: state.status });
    }
    return;
  }

  // Konum useUnifiedVehicleStore'dan FullMapView üzerinden gelir (fused position).
  // Yerel DR projeksiyonu kaldırıldı — kaynak her zaman merkezden beslenir.

  // Rota geometrisi varsa üzerindeki mesafeyi kullan; yoksa Haversine fallback
  const { cumulativeDistances } = getRouteState();
  const distance = routeGeometry && routeGeometry.length >= 2
    ? calculateRouteDistance(currentLat, currentLon, routeGeometry, cumulativeDistances)
    : calculateDistance(currentLat, currentLon, state.destination.latitude, state.destination.longitude);

  // ── 500m Yakınlık Uyarısı (TTS) ─────────────────────────────────────────
  // Hedefe ilk kez 500m altına girildiğinde tek seferlik sesli uyarı.
  // _proximityAlertFired: session başında sıfırlanır — tekrar tetiklenmez.
  if (!_proximityAlertFired && distance > 0 && distance < PROXIMITY_ALERT_M) {
    _proximityAlertFired = true;
    speakNavigation('Hedefiniz 500 metrede, hazır olun.');
  }

  // ── Başlangıç konumu — ilk GPS tick'inde yakala (session artığı önlenir) ──
  if (_navStartLat === null) {
    _navStartLat = currentLat;
    _navStartLon = currentLon;
  }

  // ── Sürekli düşük hız takibi ──────────────────────────────────────────────
  const { speed: _rawArrSpd } = useUnifiedVehicleStore.getState();
  const speedAtArrival = (_rawArrSpd ?? 0) * 3.6;
  if (speedAtArrival >= ARRIVAL_SPEED_GUARD_KMH) {
    _arrivalLowSpeedStartMs = null; // hız yüksek → süreç sıfırla
  } else if (_arrivalLowSpeedStartMs === null) {
    _arrivalLowSpeedStartMs = performance.now(); // ilk düşük hız anı
  }

  // ── Varış Histerezisi: GPS spike koruması ────────────────────────────────
  // Tünel çıkışında GPS sıçraması tek tick'te eşik altına düşebilir.
  // Sayaç her "eşik altı" tick'te artar, eşik üstüne çıkınca sıfırlanır.
  if (distance < ARRIVAL_THRESHOLD_M) {
    _arrivalDistanceBelow++;
  } else {
    _arrivalDistanceBelow = 0; // eşik üstüne çıktı — sayacı sıfırla (GPS spike resetlendi)
  }

  // ── Varış tespiti — katı AND koşulları ────────────────────────────────────
  //   1. status === ACTIVE veya REROUTING (yukarıda sağlandı)
  //   2. _navigationStarted === true (activateNavigation() çağrıldı)
  //   3. Hedef koordinatları geçerli
  //   4. Rota geometrisi >= 2 nokta (Haversine fallback'te varış yok)
  //   5. Başlangıçtan >= 50m hareket
  //   6. Hedefe mesafe < eşik VE ardışık sayı yeterli (histerezis)
  //   7. Hız < 10 km/h en az 5 saniyedir
  {
    const movedFromStart   = (_navStartLat !== null && _navStartLon !== null)
      ? calculateDistance(currentLat, currentLon, _navStartLat, _navStartLon)
      : 0;
    const lowSpeedMs       = _arrivalLowSpeedStartMs !== null ? performance.now() - _arrivalLowSpeedStartMs : 0;
    const hasValidGeometry = !!routeGeometry && routeGeometry.length >= 2;
    const hasValidDest     = !!(state.destination
      && Number.isFinite(state.destination.latitude)
      && Number.isFinite(state.destination.longitude));

    if (!_navigationStarted) {
      console.log('[ARRIVAL_CHECK_SKIPPED]', { reason: 'not_started', status: state.status });
    } else {
      // Hard-trigger: 5m + HARD_HYSTERESIS ardışık okuma (GPS jitter, yavaş kapanma)
      // Tek GPS spike'ı (1 tick) tetikleme yapmaz — tünel çıkışı koruması.
      const hardTrigger = distance < 5 && _arrivalDistanceBelow >= ARRIVAL_HARD_HYSTERESIS;
      // Soft-trigger: 20m + HYSTERESIS_COUNT ardışık okuma + 5s düşük hız
      const softTrigger = distance < ARRIVAL_THRESHOLD_M
        && _arrivalDistanceBelow >= ARRIVAL_HYSTERESIS_COUNT
        && lowSpeedMs >= ARRIVAL_CONSECUTIVE_LOW_SPEED_MS;
      const allowed = hasValidDest
        && hasValidGeometry
        && movedFromStart >= ARRIVAL_MIN_MOVE_M
        && (hardTrigger || softTrigger);

      console.log('[ARRIVAL_CHECK_ACTIVE]', {
        status:            state.status,
        hasValidDest,
        hasValidGeometry,
        distanceM:         Math.round(distance),
        speedKmh:          Math.round(speedAtArrival * 10) / 10,
        movedFromStartM:   Math.round(movedFromStart),
        lowSpeedMs:        Math.round(lowSpeedMs),
        belowCount:        _arrivalDistanceBelow,
        hardTrigger,
        softTrigger,
        allowed,
      });

      if (allowed) {
        console.log('[ARRIVAL_TRIGGERED]', {
          dest:       state.destination?.name,
          movedM:     Math.round(movedFromStart),
          distM:      Math.round(distance),
          lowSpeedMs: Math.round(lowSpeedMs),
          belowCount: _arrivalDistanceBelow,
        });
        transitionToArrived();
        return;
      }
    }
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
  const now = performance.now();

  // Stop tracking at GPS frequency for accurate standstill duration
  const { speed: _rawSpd } = useUnifiedVehicleStore.getState();
  const currentSpeedKmh    = (_rawSpd ?? 0) * 3.6;
  if (currentSpeedKmh < STOP_THRESHOLD_KMH) {
    if (_stopStartMs === null) _stopStartMs = now;
  } else {
    _stopStartMs = null;
  }

  // ETA güncelleme kapısı — dinamik histerezis.
  // Normal sürüş: 5s (saniye bazlı hız jitter'ından UI'ı korur).
  // Trafik durağı: 2s (trafik buffer birikimi hızlı yansıtılır, ETA güncel kalır).
  const _etaHysteresisMs = _stopStartMs !== null ? ETA_TRAFFIC_HYSTERESIS_MS : ETA_HYSTERESIS_MS;
  if (now - _lastEtaUpdateMs >= _etaHysteresisMs) {
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
    const newEtaS        = movementEtaS + trafficBufferS;

    // Value-based hysteresis: only update if change > 5s
    if (Math.abs(newEtaS - _lastStoredEtaS) > 5) {
      _lastStoredEtaS = newEtaS;
      useNavigationStore.getState().updateEta(newEtaS);
    }
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
    // Clamp delay önleme: stale mesafeyi hemen temizle, yeni hesap aynı tick'te store'u günceller
    useNavigationStore.setState({ distanceMeters: undefined });
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
    const wStart = Math.max(0,                  _lastClosestSegIdx - 20);
    const wEnd   = Math.min(geometry.length - 2, _lastClosestSegIdx + 50);
    closestSegIdx = wStart;
    for (let i = wStart; i <= wEnd; i++) {
      const d = pointToSegmentDist(lat, lon,
        geometry[i][1], geometry[i][0], geometry[i + 1][1], geometry[i + 1][0]);
      if (d < minSegDist) { minSegDist = d; closestSegIdx = i; }
    }
    // Pencere sonucu zayıfsa (araç pencere dışına çıktı) — tam tarama yap
    if (minSegDist > 100) {
      _lastClosestSegIdx = -1;
      minSegDist = Infinity;
      closestSegIdx = 0;
      for (let i = 0; i < geometry.length - 1; i++) {
        const d = pointToSegmentDist(lat, lon,
          geometry[i][1], geometry[i][0], geometry[i + 1][1], geometry[i + 1][0]);
        if (d < minSegDist) { minSegDist = d; closestSegIdx = i; }
      }
    }
  }
  _lastClosestSegIdx = closestSegIdx;

  // ── Step 2: project P onto closest segment → P' ───────────────────────
  const [aLon, aLat] = geometry[closestSegIdx];
  const [bLon, bLat] = geometry[closestSegIdx + 1];
  const t    = projectOnSegment(lat, lon, aLat, aLon, bLat, bLon);
  const pLat = aLat + t * (bLat - aLat);
  const pLon = aLon + t * (bLon - aLon);

  // Visual Snapping: snapped koordinatı ve rota sapma mesafesini kaydet.
  // getSnappedMarkerPosition() bu değerleri dışa açar; FullMapView RAF'ı tüketir.
  _lastSnappedLat = pLat;
  _lastSnappedLon = pLon;
  _lastOffRouteM  = minSegDist;

  // ── Step 3: remaining = |P'→B| + suffix-sum from B ─────────────────
  // O(1) with precomputed cumDist; O(N) fallback when unavailable (should not occur).
  const partialM  = calculateDistance(pLat, pLon, bLat, bLon);
  const suffixIdx = closestSegIdx + 1;
  const remaining = (cumDist && cumDist.length === geometry.length)
    ? partialM + cumDist[suffixIdx]
    : partialM + _sumRemainingSegments(geometry, suffixIdx);

  // Soft clamp: allow up to CLAMP_SLACK_M upward correction per tick (DR recovery),
  // while still rejecting large GPS spikes (> 50 m sudden jump).
  const clamped       = Math.min(remaining, _lastRouteDistanceM + CLAMP_SLACK_M);
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
 * Navigasyon ACTIVE/REROUTING iken rota üzerindeki snapped marker konumunu döner.
 *
 * FullMapView RAF döngüsü bu pozisyonu `updateUserMarker` çağrısında kullanır:
 *   - Araç rota üzerindeyse (offRoute ≤ REROUTE_THRESHOLD_M): snapped lat/lon
 *   - Araç rotadan saptıysa veya rota geometrisi yoksa: null (ham GPS'e geri dön)
 *   - Navigasyon ACTIVE değilse: null
 *
 * Kural: Kullanıcı navigasyon çizgisi üzerinde milimetrik sürüş deneyimi görmeli.
 */
/** Görsel stabilite eşiği — bu mesafeye kadar ikon rotaya yapışık kalır.
 *  Reroute eşiği (REROUTE_THRESHOLD_M=35m) ile kasıtlı ayrıldı:
 *  20m içinde kullanıcı "yoldan çıktım" görmez; 35m'de reroute tetiklenir. */
const SNAP_VISUAL_THRESHOLD_M = 20;

export function getSnappedMarkerPosition(): { lat: number; lon: number } | null {
  const status = useNavigationStore.getState().status;
  if (status !== NavStatus.ACTIVE && status !== NavStatus.REROUTING) return null;
  if (_lastSnappedLat === null || _lastSnappedLon === null) return null;
  if (_lastOffRouteM > SNAP_VISUAL_THRESHOLD_M) return null;
  return { lat: _lastSnappedLat, lon: _lastSnappedLon };
}

/**
 * Format distance for display — Tesla style with space separator
 */
export function formatDistance(meters: number): string {
  if (Math.round(meters) < 1000) {
    return `${Math.round(meters)} m`;
  }
  return `${(meters / 1000).toFixed(1)} km`;
}

/**
 * Format ETA for display — Turkish: "20 dk" / "4 sa 38 dk"
 */
export function formatEta(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '—';
  const totalMinutes = Math.ceil(seconds / 60);
  if (totalMinutes === 0) return '0 dk';
  
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  
  if (hours > 0) {
    return minutes > 0 ? `${hours} sa ${minutes} dk` : `${hours} sa`;
  }
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
