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
  clearAltRoutes,
  clearRoute,
  fetchRoute,
} from './routingService';
import { useUnifiedVehicleStore } from './vehicleDataLayer/UnifiedVehicleStore';
import { speakNavigation } from './ttsService';
import { computeEta, type EtaVerdict } from './navigation/core/etaModel';
import {
  detectEtaJump, appendJump, summarizeJumps,
  type EtaSample, type EtaJumpRecord, type EtaJumpSummary,
} from './navigation/core/etaJumpLedger';
import { corridorSync } from '../core/navigation/CorridorSyncEngine';
import { setNavigationGpsPower } from './navigation/navGpsPowerBridge';
/* Saf matematik yardımcısı — `cameraEngine` sıfır-import bir yaprak modüldür,
   döngü riski yok. Yön formülünü ikinci kez yazmamak için oradan alınır. */
import { bearingBetween } from './cameraEngine';
import { roadBearingAheadDeg } from './navigation/core/geo';
import { safeSetRawImmediate, safeGetRaw, safeRemoveRaw } from '../utils/safeStorage';
import {
  judgeDestinationChange, recordDestinationChange,
  type DestinationSource,
} from './navigation/core/destinationOwnershipModel';
// Phase H1 re-export kaldırıldı (H5 circular import fix).
// startHazardEngine / stopHazardEngine doğrudan hazardService.ts'ten import edilebilir.

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

/**
 * REHBERLİĞİN GERÇEKTEN SÜRDÜĞÜ durumlar (kütük #416/#418).
 * Manevra takibi · eşleme · sesli yönlendirme · reroute YALNIZ burada çalışır.
 * Önizleme (PREVIEW/ROUTING) bir oturumdur ama rehberlik değildir.
 */
const GUIDANCE_STATUSES = new Set<string>([
  NavStatus.ACTIVE, NavStatus.REROUTING,
]);

export interface NavigationState {
  status: NavStatus;
  /**
   * OTURUM açık mı (PREVIEW/ROUTING/ACTIVE/REROUTING/ARRIVED).
   *
   * ⚠️ Kütük #416/#418: bu bayrak "REHBERLİK ÇALIŞIYOR" DEMEK DEĞİLDİR.
   * Sahada `status = PREVIEW` iken `isNavigating = true` görüldü; aynı anda
   * eşleme motoru ölüydü (`match.state = null`), reroute yoktu, ses yoktu ve
   * panelde hâlâ "NAVİGASYONU BAŞLAT" düğmesi duruyordu. Sürücü "navigasyon
   * açık" sanıyordu. Rehberlik iddiası taşıyan yüzeyler `isGuidanceActive`
   * kullanmalıdır.
   */
  isNavigating: boolean;         // derived: NAVIGATING_STATUSES ∋ status
  /**
   * REHBERLİK gerçekten sürüyor mu — yalnız ACTIVE ve REROUTING.
   * Manevra takibi, eşleme, sesli yönlendirme ve reroute bu durumlarda çalışır.
   */
  isGuidanceActive: boolean;
  isRerouting: boolean;          // derived: status === REROUTING
  destination: Address | null;
  distanceMeters?: number;
  /**
   * `distanceMeters` NASIL hesaplandı (kütük #404).
   *
   * SAHADA ÖLÇÜLDÜ: örneklerin **%38'inde** kalan mesafe rota boyu değil
   * KUŞ UÇUŞU idi (`STRAIGHT_LINE`) — ama ekranda tıpkı gerçek kalan mesafe
   * gibi, aynı yazı tipiyle, aynı kesinlikle gösteriliyordu. Aynı yolculukta
   * kalan mesafe 69 kez ARTTI (kuş uçuşu, yol dönerken artar; sürücü için
   * "hedefe yaklaşırken mesafe büyüyor" anlamına gelir).
   * Kuş uçuşu bir tahmindir; ürün onu ölçüm gibi sunamaz.
   */
  distanceSource?: 'ALONG_ROUTE' | 'STRAIGHT_LINE';
  etaSeconds?: number;
  headingToDestination?: number;
  isOfflineResult: boolean;
  errorMessage?: string;
}

interface NavigationStore extends NavigationState {
  _setStatus: (s: NavStatus, extra?: Partial<NavigationState>) => void;
  setDestination: (destination: Address | null, isOffline?: boolean) => void;
  updateDistance: (distance: number, source: 'ALONG_ROUTE' | 'STRAIGHT_LINE') => void;
  updateEta: (seconds: number) => void;
  updateHeading: (heading: number) => void;
  setRerouting: (val: boolean) => void;
  clearNavigation: () => void;
  setOfflineResult: (val: boolean) => void;
}

const useNavigationStore = create<NavigationStore>((set) => ({
  status: NavStatus.IDLE,
  isNavigating: false,
  isGuidanceActive: false,
  isRerouting: false,
  destination: null,
  distanceMeters: undefined,
  distanceSource: undefined,
  etaSeconds: undefined,
  headingToDestination: undefined,
  isOfflineResult: false,
  errorMessage: undefined,

  _setStatus: (status, extra = {}) => set({
    status,
    isNavigating: NAVIGATING_STATUSES.has(status),
    isGuidanceActive: GUIDANCE_STATUSES.has(status),
    isRerouting:  status === NavStatus.REROUTING,
    ...extra,
  }),

  setDestination: (destination, isOffline = false) => set({
    status: NavStatus.PREVIEW,
    isNavigating: true,
    isGuidanceActive: false,   // #416: önizleme rehberlik DEĞİLDİR
    isRerouting: false,
    destination,
    isOfflineResult: isOffline,
    errorMessage: undefined,
  }),

  updateDistance: (distance, source) => set({ distanceMeters: distance, distanceSource: source }),
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
    isGuidanceActive: false,
    isRerouting: false,
    destination: null,
    distanceMeters: undefined,
    distanceSource: undefined,
    etaSeconds: undefined,
    isOfflineResult: false,
    errorMessage: undefined,
  }),
}));

// Distance hierarchy: ARRIVAL < STEP_ADVANCE < REROUTE (see routingService for the others)
export const ARRIVAL_THRESHOLD_M = 20;

// 5 s ARRIVED → IDLE timer
let _arrivedTimer: ReturnType<typeof setTimeout> | null = null;
let _unregisterReroutingCb: (() => void) | null = null;
// H1: restoreNavigationAsync'in GPS-fix bekleme aboneliğini temizler (Zero-Leak).
// Fix hiç gelmezse 60s timeout veya stopNavigation() bu fonksiyonu çağırır.
let _restoreGpsCleanup: (() => void) | null = null;

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

/* ── OTURUM SAHİPLİĞİ (NAVIGATION_MINI_MAP_SESSION_CONTINUITY_P0) ────────────
 *
 * KÖK NEDEN: rota isteği dedup'ı `FullMapView` içinde bir `useRef` idi
 * (`lastFetchedRef`). Ref bileşenle birlikte ÖLÜR → tam ekran kapatılıp
 * yeniden açıldığında dedup sıfırlanıyor, effect AKTİF oturumun hedefi için
 * yeniden `fetchRoute` çağırıyor ve `setNavStatus(ROUTING)` ile durumu
 * ACTIVE→ROUTING'e düşürüyordu: kullanıcı yalnız görünüm değiştirmişken
 * oturum sıfırdan kuruluyordu (yeni istek · sıfırlanan ilerleme · sıfırlanan ETA).
 *
 * Sahiplik görünümden alınıp oturum otoritesine (bu modül) taşındı. Görünüm
 * mount/unmount döngüsü artık istek sayısını ETKİLEMEZ.
 *
 * Bu blok rota HESAPLAMA davranışını değiştirmez — yalnız "bu istek daha önce
 * yapıldı mı" sorusunun sahibini değiştirir. */

/** Her YENİ hedef (startNavigation) ile artan oturum numarası. */
let _sessionId = 0;
/** Bu oturumda rota isteği sahiplenilen hedef: `${sessionId}:${destinationId}`. */
let _routeClaim: string | null = null;

/** Aktif navigasyon oturumunun kimliği. Görünüm geçişleri bunu DEĞİŞTİRMEZ. */
export function getNavSessionId(): number {
  return _sessionId;
}

/** Sahiplenilmiş rota isteği anahtarı (test/gözlem için). */
export function getRouteRequestClaim(): string | null {
  return _routeClaim;
}

/**
 * Bu oturumda bu hedef için rota isteği HENÜZ yapılmadıysa sahiplen → `true`.
 * Zaten yapıldıysa `false` döner ve çağıran YENİ İSTEK ATMAZ.
 */
export function claimRouteRequest(destinationId: string): boolean {
  const key = `${_sessionId}:${destinationId}`;
  if (_routeClaim === key) return false;
  _routeClaim = key;
  return true;
}

/** İstek başarısız oldu → aynı hedef için yeniden denemeye izin ver (H2 retry yolu). */
export function releaseRouteRequest(): void {
  _routeClaim = null;
}

/**
 * Navigasyon oturumunu SONLANDIRAN tek giriş noktası.
 *
 * Görünüm kapatmak (tam ekrandan mini haritaya dönmek) bu yolu ÇAĞIRMAZ —
 * yalnız kullanıcının açık "Navigasyonu sonlandır" eylemi çağırır. Oturum
 * durumu (navigationService) ile rota durumu (routingService) birlikte kapanır;
 * eskiden bu ikili her çağrı yerinde elle tekrarlanıyordu (iki kopya).
 */
export function endNavigation(): void {
  stopNavigation();
  clearRoute();
}

/**
 * Hedef seçildi — PREVIEW durumuna gir.
 *
 * `source` (kütük #429): hedefi KİMİN belirlediği. Sahada, aktif yolculuk
 * sürerken hedef kendiliğinden başlangıç şehrine döndü ve sürücü otoyolda
 * "U dönüşü yapın" talimatı aldı; değişimi kimin yaptığını gösteren HİÇBİR
 * kayıt yoktu. Artık her çağıran kendini bildirir, her değişim deftere yazılır
 * ve aktif oturum sırasında SAHİPSİZ değişim UYGULANMAZ.
 *
 * Varsayılan bilinçli olarak `'SYSTEM'`: kimliğini bildirmeyen bir çağrı
 * "kullanıcı istedi" sayılmaz — kanıt yükü çağırandadır.
 */
export function startNavigation(
  destination: Address,
  isOffline = false,
  source: DestinationSource = 'SYSTEM',
): void {
  const st = useNavigationStore.getState();
  const cur = st.destination;
  const verdict = judgeDestinationChange({
    current: cur ? { id: cur.id, name: cur.name, latitude: cur.latitude, longitude: cur.longitude } : null,
    sessionActive: st.isNavigating || cur != null,
    next: {
      id: destination.id, name: destination.name,
      latitude: destination.latitude, longitude: destination.longitude,
    },
    source,
    tsMs: Date.now(),
  });
  recordDestinationChange(verdict.change);

  if (verdict.decision === 'BLOCK') {
    // Sürücüyü sessizce başka yere sürmektense hiçbir şey yapmamak doğrudur.
    console.warn(
      `[Nav] Hedef değişimi ENGELLENDİ (${verdict.reason}): ` +
      `"${verdict.change.fromName}" → "${verdict.change.toName}" · kaynak=${source}`,
    );
    return;
  }

  // Yeni hedef → yeni oturum; önceki oturumun istek sahipliği düşer.
  _sessionId += 1;
  _routeClaim = null;
  useNavigationStore.getState().setDestination(destination, isOffline);
  setRerouteContext(destination.latitude, destination.longitude);
  _unregisterReroutingCb?.();  // önceki navigasyondan kalan callback'i temizle
  _unregisterReroutingCb = registerReroutingCallback(
    (val) => useNavigationStore.getState().setRerouting(val),
  );
  // Crash recovery: varış noktasını anında mühürle (debounce bypass)
  _sealNavState(destination, 0, false);
}

/* ── ROTA SAHİPLİĞİ GÖRÜNÜMDEN AYRILDI (saha 2026-08-04) ────────────────────
 * ÖLÇÜLEN ARIZA (cihaz `4L45OFZDX84X55GE`, Ankara-Tarsus Otoyolu, 90 km/h):
 * uygulama yeniden başladıktan sonra navigasyon `ACTIVE` göründü, ekranda
 * "207 km · 2 sa 33 dk · Hedefe doğru ilerleyin" yazdı — ama ROTA HİÇ YOKTU:
 *   geometryPts=0 · steps=1 (sentinel) · totalM=0 · serverUsed=null ·
 *   match=UNKNOWN(NO_GEOMETRY) · offRoute=UNKNOWN(GPS_UNKNOWN) ·
 *   routeRequest.committed=0  → yani rota İSTEĞİ HİÇ ATILMAMIŞTI.
 * Gösterilen mesafe rota değil KUŞ UÇUŞU idi: tam ekran açılıp rota gelince
 * 199,8 km → 220,1 km oldu (20 km fark) ve aynı ekranda iki çelişkili sayı vardı.
 *
 * KÖK: ürün kodunda `fetchRoute(...)` YALNIZ `FullMapView.tsx` içinden
 * çağrılıyordu → rota hesaplamanın sahibi GÖRÜNÜMDÜ. Görünüm hiç açılmazsa
 * (crash/restart sonrası geri yükleme, doğrudan sesli komut, ana ekranda kalma)
 * navigasyon rotasız "çalışıyor" görünüyordu — sürücüye yalan.
 *
 * DÜZELTME: rota ihtiyacı ACTIVE'e geçişte SERVİSTE kapatılır. İKİNCİ OTORİTE
 * KURULMAZ — çift istek kapısı hâlâ tek: `claimRouteRequest(destination.id)`.
 * FullMapView aynı kapıdan geçtiği için davranışı değişmez (rota zaten varsa
 * burası no-op'tur) ve durum ACTIVE→ROUTING'e DÜŞÜRÜLMEZ (sürüşte HUD bozulmaz).
 */
function _ensureRouteForSession(): void {
  try {
    const { destination, status } = useNavigationStore.getState();
    if (!destination) return;
    if (status !== NavStatus.ACTIVE && status !== NavStatus.REROUTING) return;

    // Rota GERÇEKTEN var mı? Sentinel adım "rota var" demek DEĞİLDİR —
    // ölçütümüz geometridir (sahada steps=1 iken geometryPts=0 idi).
    const rs = getRouteState();
    if (rs.geometry && rs.geometry.length > 1) return;

    const loc = useUnifiedVehicleStore.getState().location;
    if (!loc || !Number.isFinite(loc.latitude) || !Number.isFinite(loc.longitude)) return;

    // Tek sahiplik kapısı — FullMapView ile yarışmaz, ikinci istek atılmaz.
    if (!claimRouteRequest(destination.id)) return;

    console.info('[NavRoute] ACTIVE oturumda rota yok → servis rotayı istiyor',
      JSON.stringify({ dest: destination.name, geom: rs.geometry?.length ?? 0 }));
    void fetchRoute(loc.latitude, loc.longitude, destination.latitude, destination.longitude);
  } catch { /* fail-soft: rota isteği ürünü ASLA düşürmez */ }
}

/**
 * "NAVİGASYONU BAŞLAT" butonuna basıldı — ACTIVE durumuna geç.
 * FullMapView'daki handleNavStart tarafından çağrılır.
 */
export function activateNavigation(): void {
  const { status } = useNavigationStore.getState();
  if (status === NavStatus.PREVIEW || status === NavStatus.ROUTING) {
    useNavigationStore.getState()._setStatus(NavStatus.ACTIVE);
    /* Konum tazeliği (saha 2026-08-08): native park kısması navigasyondan
       habersizdi — uzun duruşta 1 Hz GPS kapanıp kalkışta ilk ~60 m kör
       kalıyordu. Bayrak TAM BURADA gönderilir: GPS geri çağrısına bağlanamaz,
       çünkü kısma zaten geri çağrıyı susturur (kilitlenme). */
    setNavigationGpsPower(true);
    _navStartLat            = null;
    _navStartLon            = null;
    _navStartDistToDest     = Infinity;
    _navigationStarted      = true;
    _arrivalLowSpeedStartMs = null;
    _arrivalDistanceBelow   = 0;
    _proximityAlertFired    = false;
    // Alternatif rotalar ACTIVE modda gereksiz — CPU tasarrufu için temizle
    clearAltRoutes();
    // ROTA SAHİPLİĞİ (saha 2026-08-04): rota yoksa BURADA istenir — görünüm beklenmez.
    _ensureRouteForSession();
    // Koridor önbellekleme: tünel/sinyal kesintisi öncesi veri hazırla
    corridorSync.activate();
    // HUD güvencesi: offline/daemon modda steps boş gelebilir — sentinel enjekte et
    const { destination } = useNavigationStore.getState();
    if (destination) {
      // Crash recovery: ACTIVE geçişini ve mevcut step'i mühürle
      _sealNavState(destination, _lastPersistedStepIdx < 0 ? 0 : _lastPersistedStepIdx, true);
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
  setNavigationGpsPower(false);   // oturum bitti → normal pil politikası geri döner
  safeRemoveRaw(NAV_PERSIST_KEY); // Crash recovery mührünü temizle — kullanıcı iptal etti
  _routeClaim = null;             // oturum kapandı — sonraki hedef temiz sahiplenir
  _lastPersistedStepIdx = -1;
  if (_arrivedTimer) { clearTimeout(_arrivedTimer); _arrivedTimer = null; }
  _unregisterReroutingCb?.(); _unregisterReroutingCb = null;
  _restoreGpsCleanup?.(); // H1: bekleyen GPS-fix aboneliğini temizle
  useNavigationStore.getState().clearNavigation();
  clearRerouteContext();
  // Per-session izleme state'ini sıfırla — sonraki navigasyon temiz başlar
  _speedHistory.length    = 0;
  _stopStartMs            = null;
  _prevAppliedEtaFactor   = null;   // #551 — yeni oturum çarpanı serbest yakalar
  _lastEtaUpdateMs        = -ETA_HYSTERESIS_MS;
  _lastStoredEtaS         = 0;
  _lastRouteDistanceM     = Infinity;
  _lastGeoHash            = '';
  _lastClosestSegIdx      = -1;
  _navStartLat            = null;
  _navStartLon            = null;
  _navStartDistToDest     = Infinity;
  _navigationStarted      = false;
  _arrivalLowSpeedStartMs = null;
  _arrivalDistanceBelow   = 0;
  _proximityAlertFired    = false;
  _lastSnappedLat         = null;
  _lastSnappedLon         = null;
  _lastSnappedSegBearing  = null;
  _lastOffRouteM          = Infinity;
  corridorSync.stop();
}

/**
 * Get current navigation state (snapshot — non-reactive)
 */
export function getNavigationState(): NavigationState {
  const s = useNavigationStore.getState();
  return {
    status:             s.status,
    isNavigating:       s.isNavigating,
    isGuidanceActive:   s.isGuidanceActive,
    isRerouting:        s.isRerouting,
    destination:        s.destination,
    distanceMeters:     s.distanceMeters,
    distanceSource:     s.distanceSource,
    etaSeconds:         s.etaSeconds,
    headingToDestination: s.headingToDestination,
    isOfflineResult:    s.isOfflineResult,
    errorMessage:       s.errorMessage,
  };
}

/**
 * Crash Recovery — Phase S3 Zero-Touch Navigation Restore.
 *
 * Uygulama crash/LBO ile kapanırken mühürlenen navigasyon state'ini geri yükler.
 * GPS fix beklenmeksizin PREVIEW modunda rota çizilir; fix gelince ACTIVE'e geçer.
 * Tüm süreç sessizdir — TTS çalışmaz, kullanıcıyı korkutmaz.
 *
 * @returns true — başarılı geri yükleme, false — mühürlü veri yok veya süresi geçmiş
 */
export async function restoreNavigationAsync(): Promise<boolean> {
  try {
    const raw = safeGetRaw(NAV_PERSIST_KEY);
    if (!raw) return false;

    const persist = JSON.parse(raw) as NavPersistState;

    // ── Bütünlük Denetimi (Integrity Check) ──────────────────────────────────
    // Koordinat geçerliliği: NaN / Infinity / null island (0,0) reddedilir
    const lat = persist.destination?.latitude;
    const lng = persist.destination?.longitude;
    const coordsOk = Number.isFinite(lat) && Number.isFinite(lng) &&
                     !(lat === 0 && lng === 0);

    // Step geçerliliği: negatif veya sonsuz index kabul edilmez
    const stepOk = Number.isFinite(persist.stepIndex) && persist.stepIndex >= 0;

    // Tazelik filtresi
    const fresh = (Date.now() - persist.ts) <= NAV_PERSIST_MAX_AGE_MS;

    if (!persist.destination || !coordsOk || !stepOk || !fresh) {
      safeRemoveRaw(NAV_PERSIST_KEY);
      if (import.meta.env.DEV) {
        console.info('[NavRestore] Yolculuk güncelleniyor — bütünlük denetimi başarısız, sessiz iptal');
      }
      return false;
    }

    // PREVIEW modunda rota hazırla — TTS yok (sessiz crash recovery)
    // Kütük #429: aynı yolculuğun devamı — kullanıcı eylemi DEĞİL ama meşru.
    startNavigation(persist.destination, false, 'SESSION_RESTORE');
    // startNavigation step=0 yazar; geri yüklenen asıl step+wasActive'i üzerine mühürle
    _sealNavState(persist.destination, persist.stepIndex, persist.wasActive);

    console.info(
      `[NavRestore] "${persist.destination.name}" geri yüklendi` +
      ` (step=${persist.stepIndex}, wasActive=${persist.wasActive})`,
    );

    if (persist.wasActive) {
      // GPS fix zaten varsa → anında ACTIVE'e al
      const { location } = useUnifiedVehicleStore.getState();
      const hasGpsFix = location &&
        Number.isFinite(location.latitude) &&
        (Date.now() - location.timestamp) < 30_000;

      if (hasGpsFix) {
        activateNavigation();
        console.info('[NavRestore] GPS fix mevcut — navigasyon ACTIVE moduna alındı');
      } else {
        // GPS fix bekleniyor — gelince ACTIVE'e al (Zero-Touch).
        // H1: temizlik referansı + 60s timeout — fix hiç gelmezse abonelik sonsuza dek yaşamaz.
        _restoreGpsCleanup?.(); // önceki bekleyen aboneliği temizle (çift restore koruması)
        const unsub = useUnifiedVehicleStore.subscribe((s) => {
          const loc = s.location;
          if (!loc || !Number.isFinite(loc.latitude)) return;
          if ((Date.now() - loc.timestamp) >= 30_000) return;
          _restoreGpsCleanup?.();
          if (useNavigationStore.getState().status === NavStatus.PREVIEW) {
            activateNavigation();
            console.info('[NavRestore] GPS fix geldi — navigasyon ACTIVE moduna alındı');
          }
        });
        const _gpsWaitTimer = setTimeout(() => _restoreGpsCleanup?.(), 60_000);
        _restoreGpsCleanup = () => {
          unsub();
          clearTimeout(_gpsWaitTimer);
          _restoreGpsCleanup = null;
        };
      }
    }

    return true;
  } catch {
    safeRemoveRaw(NAV_PERSIST_KEY);
    return false;
  }
}

// ETA hysteresis — prevents UI flickering from second-to-second speed jitter
let _lastEtaUpdateMs    = 0;
let _lastStoredEtaS     = 0;
const ETA_HYSTERESIS_MS = 5_000;

/* #551 — bir önceki UYGULANAN ETA düzeltme çarpanı (zaman oranı sınırı için).
 * Durum BURADA yaşar; `computeEta` saf kalır (saat/durum okumaz).
 * `null` = geçmiş yok → sınır uygulanmaz, çarpan hedefi serbestçe yakalar. */
let _prevAppliedEtaFactor: number | null = null;

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
/** Aracın oturduğu rota segmentinin yönü (A→B, derece). Kamera bunu okur —
 *  bkz. `getSnappedRoadBearing()`. Snap ile AYNI hesaptan doğar, ikinci
 *  otorite değildir. */
let _lastSnappedSegBearing: number | null = null;

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
let _navStartLat:           number | null = null;
let _navStartLon:           number | null = null;
// M3: navigasyon başındaki hedefe-mesafe — kısa yolculukta (<50m) varış eşiğini orantılı yapar.
let _navStartDistToDest:    number       = Infinity;
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

// ── Crash Recovery State (Phase S3) ─────────────────────────────────────────
const NAV_PERSIST_KEY        = 'nav_crash_state';
const NAV_PERSIST_MAX_AGE_MS = 4 * 60 * 60 * 1_000; // 4 saat — daha eski kayıt geçersiz

interface NavPersistState {
  destination: Address;
  stepIndex:   number;
  wasActive:   boolean;
  ts:          number;
}

let _lastPersistedStepIdx = -1;

/** Navigasyon state'ini anlık diske mühürle — crash sonrası sıfır veri kaybı. */
function _sealNavState(destination: Address, stepIndex: number, wasActive = false): void {
  const payload: NavPersistState = { destination, stepIndex, wasActive, ts: Date.now() };
  void safeSetRawImmediate(NAV_PERSIST_KEY, JSON.stringify(payload));
}


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
    return;
  }

  // Konum useUnifiedVehicleStore'dan FullMapView üzerinden gelir (fused position).
  // Yerel DR projeksiyonu kaldırıldı — kaynak her zaman merkezden beslenir.

  // Rota geometrisi varsa üzerindeki mesafeyi kullan; yoksa Haversine fallback
  const { cumulativeDistances } = getRouteState();

  // Step geçişini mühürle — sadece step değişiminde yaz, yüksek frekanslı mesafe güncellemelerinde değil
  const { currentStepIndex: _currentStep } = getRouteState();
  if (state.destination && _currentStep !== _lastPersistedStepIdx) {
    _lastPersistedStepIdx = _currentStep;
    _sealNavState(state.destination, _currentStep, true);
  }

  // Kütük #404: mesafenin KAYNAĞI da taşınır — kuş uçuşu değer, rota boyu
  // ölçümmüş gibi sunulamaz (sahada örneklerin %38'i kuş uçuşuydu).
  const hasRouteGeom = !!routeGeometry && routeGeometry.length >= 2;
  const distance = hasRouteGeom
    ? calculateRouteDistance(currentLat, currentLon, routeGeometry as [number, number][], cumulativeDistances)
    : calculateDistance(currentLat, currentLon, state.destination.latitude, state.destination.longitude);
  const distanceSource: 'ALONG_ROUTE' | 'STRAIGHT_LINE' = hasRouteGeom ? 'ALONG_ROUTE' : 'STRAIGHT_LINE';

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
    // M3: başlangıçtaki hedefe-mesafe — kısa yolculukta varış hareket eşiğini ölçekler.
    _navStartDistToDest = calculateDistance(
      currentLat, currentLon, state.destination.latitude, state.destination.longitude,
    );
  }

  // ── Sürekli düşük hız takibi ──────────────────────────────────────────────
  /* ⚠️ BİRİM HATASI DÜZELTİLDİ (2026-08-03, NAV-CORE-P0).
   * `UnifiedVehicleStore.speed` **ZATEN km/h**'tir (store tanımı satır 80:
   * "km/h, fused"; GPS'in m/s değeri store'a yazılmadan ÖNCE çevriliyor).
   * Burada 3.6 ile ÇARPILIYORDU → hız 3.6 KAT şişiyordu. Somut sonuç:
   *   • `ARRIVAL_SPEED_GUARD_KMH = 10` gerçekte **2.8 km/h**'ye düşüyordu.
   *     Hedefe 6 km/h ile yanaşan araç 21.6 km/h okunuyor, düşük-hız sayacı
   *     her tick SIFIRLANIYOR ve 5 sn koşulu HİÇ sağlanmıyordu → **varış
   *     tetiklenmiyordu.**
   * Aynı hata `routingService.updateRouteProgress` içinde de vardı ve orada
   * düzeltilmişti; navigationService'teki üç kopya GÖZDEN KAÇMIŞTI. */
  const { speed: _rawArrSpd } = useUnifiedVehicleStore.getState();
  const speedAtArrival = _rawArrSpd ?? 0;   // km/h
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

    if (_navigationStarted) {
      // Hard-trigger: 5m + HARD_HYSTERESIS ardışık okuma (GPS jitter, yavaş kapanma)
      // Tek GPS spike'ı (1 tick) tetikleme yapmaz — tünel çıkışı koruması.
      const hardTrigger = distance < 5 && _arrivalDistanceBelow >= ARRIVAL_HARD_HYSTERESIS;
      // Soft-trigger: 20m + HYSTERESIS_COUNT ardışık okuma + 5s düşük hız
      const softTrigger = distance < ARRIVAL_THRESHOLD_M
        && _arrivalDistanceBelow >= ARRIVAL_HYSTERESIS_COUNT
        && lowSpeedMs >= ARRIVAL_CONSECUTIVE_LOW_SPEED_MS;
      // M3: Kısa yolculukta (hedef <50m) 50m hareket koşulu asla sağlanmaz → varış takılır.
      // Eşiği başlangıç mesafesinin yarısına ölçekle (min 5m); normal yolculukta 50m kalır.
      const minMove = Math.min(ARRIVAL_MIN_MOVE_M, Math.max(_navStartDistToDest * 0.5, 5));
      const allowed = hasValidDest
        && hasValidGeometry
        && movedFromStart >= minMove
        && (hardTrigger || softTrigger);

      if (allowed) {
        transitionToArrived();
        return;
      }
    }
  }

  // Koridor önbellekleme — rota geometrisi alındıkça motoru güncelle
  if (routeGeometry && routeGeometry.length >= 2) {
    const { speed: _cspd } = useUnifiedVehicleStore.getState();
    // Birim: store km/h — 3.6 çarpanı KALDIRILDI (koridor önbelleği 3.6 kat
    // fazla ileriyi çekiyor, gereksiz veri indiriyordu).
    corridorSync.onGeometryUpdate(routeGeometry, _cspd ?? 0);
  }

  // Heading
  const rawHeading = calculateHeading(
    currentLat, currentLon,
    state.destination.latitude, state.destination.longitude
  );
  const heading = Number.isFinite(rawHeading) ? rawHeading : 0;

  useNavigationStore.getState().updateDistance(distance, distanceSource);
  useNavigationStore.getState().updateHeading(heading);

  // ── ETA ────────────────────────────────────────────────────────────────
  const now = performance.now();

  // Stop tracking at GPS frequency for accurate standstill duration
  /* ⚠️ BİRİM: store km/h — 3.6 çarpanı KALDIRILDI. Eski hâlinde:
   *   • `STOP_THRESHOLD_KMH = 3` gerçekte 0.83 km/h'ye düşüyordu → araç
   *     trafikte gerçekten dururken bile "duruyor" sayılmıyor, trafik
   *     tamponu (`TRAFFIC_DELAY_RATIO`) HİÇ birikmiyordu.
   *   • `_speedHistory` 3.6 kat şişik doluyordu → `rollingAvgKmh` şişik →
   *     ETA sistematik olarak KISA (iyimser) çıkıyordu. */
  const { speed: _rawSpd } = useUnifiedVehicleStore.getState();
  const currentSpeedKmh    = _rawSpd ?? 0;   // km/h
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
    /* #551 — zaman oranı sınırının `dt`si. `_lastEtaUpdateMs` hemen altında
       EZİLDİĞİ için fark ÖNCE alınır. */
    const _sinceLastEtaMs = now - _lastEtaUpdateMs;
    _lastEtaUpdateMs = now;

    // Populate 30-second rolling speed window (evict stale samples)
    _speedHistory.push({ speedKmh: currentSpeedKmh, ts: now });
    const cutoff = now - SPEED_HISTORY_MS;
    while (_speedHistory.length > 0 && _speedHistory[0].ts < cutoff) _speedHistory.shift();

    // Linearly weighted average: newest sample weight=1.0, oldest weight=0.1
    const rollingAvgKmh = _weightedAvgSpeed(now);

    // Road-type hint: expected speed from current OSRM step (distance ÷ duration).
    // YALNIZ YEDEK hesapta kullanılır — rota süre modeli varken devre dışıdır.
    const rs = getRouteState();
    const step           = rs.steps[rs.currentStepIndex];
    const roadSpeedKmh   = (step?.duration ?? 0) > 0
      ? (step.distance / step.duration) * 3.6
      : undefined;

    // Traffic delay buffer: accumulate delay while stopped instead of freezing ETA
    const stopDurationS  = _stopStartMs !== null ? (now - _stopStartMs) / 1000 : 0;
    const trafficBufferS = Math.round(stopDurationS * TRAFFIC_DELAY_RATIO);

    /* ── ETA TEK OTORİTESİ (NAVIGATION_DELIVERY_CORE_P0) ────────────────────
     * Eskiden burada `kalanMesafe / anlıkHız` doğrudan hesaplanıyordu; artık
     * gövde rotanın KENDİ süre modelidir ve anlık hız yalnız sınırlı bir
     * düzeltme çarpanı üretir. Karar saf modeldedir → test edilebilir. */
    _lastEtaVerdict = computeEta({
      navActive: true,
      remainingRouteDurationS: rs.remainingRouteDurationSeconds,
      durationIntegrity:       rs.durationIntegrityState,
      durationSource:          rs.routeDurationSource,
      routeRevision:           rs.routeRevision,
      durationRevision:        rs.durationRevision,
      /* Kütük #403/#404: ETA girdisine YALNIZ rota boyu ölçülmüş mesafe verilir.
       * Kuş uçuşu mesafe (rota geometrisi yokken) gerçek yolun kısaltılmış hâlidir;
       * ETA'ya verilirse süre sistematik olarak İYİMSER çıkar ve geometri gelip
       * gidince ETA sıçrar — sahada 43 kez >60 s, en büyüğü 1 sa 49 dk. */
      remainingDistanceM:
        distanceSource === 'ALONG_ROUTE' && Number.isFinite(distance) && distance > 0
          ? distance : null,
      rollingAvgKmh,
      roadSpeedKmh,
      stopBufferS: trafficBufferS,
      /* #551 — hız rampasının üstüne zaman oranı sınırı. */
      previousCorrectionFactor: _prevAppliedEtaFactor,
      sinceLastEtaMs:           _sinceLastEtaMs,
    });

    /* Sınır YALNIZ `ROUTE_MODEL` sürekliliği içindir. Yedek/STALE/UNKNOWN'a
       düşülüp geri dönüldüğünde çarpan geçmişi ANLAMSIZDIR — sıfırlanır ki
       yeni durum eski çarpandan yavaşça yürümek zorunda kalmasın. */
    _prevAppliedEtaFactor = _lastEtaVerdict.state === 'ROUTE_MODEL'
      ? _lastEtaVerdict.correctionFactor
      : null;

    /* ── G3 (#530) · ETA SIÇRAMA DEFTERİ ────────────────────────────────────
     * Sahada 43 kez >60 s sıçrama ölçüldü ama SEBEBİ kayıtlı değildi. Defter
     * sıçrama anında hangi anahtarın değiştiğini yazar (mesafe kaynağı · hız
     * kapısı · reroute · ETA durumu). KARAR ÜRETMEZ, yalnız gözlem — bir
     * sonraki saha koşumunda "etaModel mi mesafe mi" TAHMİNLE değil KAYITLA
     * cevaplanır. */
    {
      const _sample: EtaSample = {
        atMs: now,
        etaSeconds: _lastEtaVerdict.etaSeconds,
        baseDurationS: _lastEtaVerdict.baseSeconds,
        factor: _lastEtaVerdict.correctionFactor,
        remainingDistanceM:
          distanceSource === 'ALONG_ROUTE' && Number.isFinite(distance) && distance > 0
            ? distance : null,
        rollingAvgKmh,
        routeRevision: rs.routeRevision,
        etaState: _lastEtaVerdict.state,
      };
      if (_prevEtaSample !== null) {
        const jump = detectEtaJump(_prevEtaSample, _sample);
        if (jump) _etaJumps = appendJump(_etaJumps, jump);
      }
      _prevEtaSample = _sample;
    }

    const newEtaS = _lastEtaVerdict.etaSeconds;
    // Sayı üretilemediyse ESKİ ETA KORUNMAZ da, uydurulmaz da: store'a
    // dokunulmaz (mevcut değer bir sonraki geçerli hesaba kadar kalır) ve
    // durum LAB'da `etaState` ile açıkça görünür.
    if (newEtaS !== null && Math.abs(newEtaS - _lastStoredEtaS) > 5) {
      _lastStoredEtaS = newEtaS;
      useNavigationStore.getState().updateEta(newEtaS);
    }
  }
}

/* ── ETA gözlem yüzeyi (CAROS LAB · salt-okunur) ──────────────────────────── */

let _lastEtaVerdict: EtaVerdict = {
  etaSeconds: null, state: 'UNKNOWN', source: 'NONE',
  correctionFactor: 1, baseSeconds: null, reason: 'henüz hesaplanmadı',
};

/** G3 (#530) — ETA sıçrama defteri (bounded; PII YOK: yalnız süre ve anahtar). */
let _etaJumps: EtaJumpRecord[] = [];
let _prevEtaSample: EtaSample | null = null;

/** Son ETA hükmü — sayı DEĞİL, GEREKÇE taşır. Yan etkisi yoktur. */
export function getEtaVerdict(): EtaVerdict { return _lastEtaVerdict; }

/** @internal — testler arası izolasyon. */
export function _resetEtaVerdictForTest(): void {
  _lastEtaVerdict = {
    etaSeconds: null, state: 'UNKNOWN', source: 'NONE',
    correctionFactor: 1, baseSeconds: null, reason: 'henüz hesaplanmadı',
  };
  _lastEtaUpdateMs = 0;
  _lastStoredEtaS = 0;
  _speedHistory.length = 0;
  _stopStartMs = null;
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
/**
 * Test kancası — snap hesabını doğrudan sürer ve türeyen yol yönünü döndürür.
 * Kamera yön otoritesinin METİN kilidiyle değil DAVRANIŞLA doğrulanması için
 * gerekli (ürün yolu store'a bağlı olduğundan birim testte sürülemiyor).
 * Yalnız testlerden çağrılır; ürün akışında çağıranı YOKTUR.
 */
export function _snapForTest(
  lat: number, lon: number, geometry: [number, number][],
): { offRouteM: number; roadBearing: number | null } {
  _lastGeoHash = '';          // her çağrıda taze O(N) tarama — testler bağımsız kalsın
  _lastRouteDistanceM = Infinity;
  calculateRouteDistance(lat, lon, geometry, null);
  return { offRouteM: _lastOffRouteM, roadBearing: _lastSnappedSegBearing };
}

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
  /* Yol yönü — kamera otoritesi (saha 2026-08-08, Siverek: ölçülen GPS yön
     gürültüsü p90 15,9°/s, araç DURURKEN bile 18°/s). Segment yönü geometriden
     gelir: titremez. Ekstra tarama YOK — A/B uçları zaten yukarıda bulundu.

     ⚠️ 2026-08-13 (aynı yol, Siverek — yeniden ölçüldü): TEK segmentin yönü
     yetmedi. GPS gürültüsü kesilmişti ama gürültü YER DEĞİŞTİRMİŞTİ: rota
     geometrisinin kendi düğümleri kavşaklarda sıklaşıyor (segmentlerin %23'ü
     <5 m) ve araç ilerledikçe en-yakın-segment indeksi bu kısa parçalar
     arasında atlıyor. Ölçülen en büyük TEK darbe: şehir içi **91,5°**,
     şehir dışı **118,7°**. Yön artık rota boyunca 40 m İLERİYE bakılarak
     alınır → aynı ölçümde max darbe **~25°**e iner, düz yolda medyan fark
     ~0,1° (gecikme EKLEMEZ). Ayrıntı ve pencere seçimi: `core/geo.ts`.

     Hesap AYNI snap çıktısından doğar (`closestSegIdx` + `t`): yeni bir
     en-yakın-segment ARAMASI YOKTUR, yalnız bulunmuş noktadan İLERİ yürünür.
     Pencere hesaplanamazsa (rota sonu / dejenere geometri) davranış eskisine,
     yani tek segment yönüne DÜŞER — sessiz `null` bırakılmaz. */
  _lastSnappedSegBearing =
    roadBearingAheadDeg(geometry, closestSegIdx, t, CAMERA_ROAD_BEARING_LOOKAHEAD_M)
    ?? bearingBetween(aLat, aLon, bLat, bLon);

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
 *  Reroute eşiği (REROUTE_THRESHOLD_M=55m) ile kasıtlı ayrıldı:
 *  20m içinde kullanıcı "yoldan çıktım" görmez; 55m'de reroute tetiklenir. */
const SNAP_VISUAL_THRESHOLD_M = 20;

/**
 * Kamera yön penceresi (m) — yön, oturtulmuş noktadan rota boyunca bu kadar
 * İLERİDEKİ noktaya bakılarak alınır. Ölçülerek seçildi (Siverek, iki rota):
 * tek segment → max darbe 91,5°/118,7° · 40 m → ~25° · 75 m → ~14°/20°.
 * 75 m daha stabil ama dönüşü kamerada çok erken başlatır ve `cameraEngine`
 * içindeki dönüş-öngörü katmanının (`ANTICIPATION_MAX_DEG`) yanında İKİNCİ bir
 * öngörü otoritesi kurardı — bu yüzden 40 m'de durduruldu. Tam gerekçe ve
 * ölçüm tablosu: `navigation/core/geo.ts → roadBearingAheadDeg`.
 */
const CAMERA_ROAD_BEARING_LOOKAHEAD_M = 40;

export function getSnappedMarkerPosition(): { lat: number; lon: number } | null {
  const status = useNavigationStore.getState().status;
  if (status !== NavStatus.ACTIVE && status !== NavStatus.REROUTING) return null;
  if (_lastSnappedLat === null || _lastSnappedLon === null) return null;
  if (_lastOffRouteM > SNAP_VISUAL_THRESHOLD_M) return null;
  return { lat: _lastSnappedLat, lon: _lastSnappedLon };
}

/**
 * Aracın üzerinde bulunduğu ROTA SEGMENTİNİN yönü (derece, 0–360) — kameranın
 * yön kaynağı. Rota dışındaysak / oturtma güvenilmezse `null`.
 *
 * NEDEN VAR (saha 2026-08-08, Siverek — ölçüldü): kamera ham GPS heading'ini
 * takip ediyordu. Ölçülen gürültü: |Δyön|/s p90 **15,9°**, p99 38,6°, ve araç
 * DURURKEN bile p90 12,3° / max 18,0°; ardışık örneklerin %5'i işaret
 * değiştiriyordu (gerçek dönüş değil, salınım). Kullanıcının tarifi: *"bir
 * dönüyor bir öyle dönüyor, geriye doğru gidecekmiş hissi veriyor."*
 * Yol geometrisi ise titremez — Google/OEM navigasyonların kamerayı sabit
 * tutma yöntemi de budur.
 *
 * İKİNCİ OTORİTE DEĞİLDİR: değer, `getSnappedMarkerPosition()` ile AYNI snap
 * hesabından (`aLat/aLon → bLat/bLon`) doğar ve AYNI güven kapısını kullanır
 * (ACTIVE/REROUTING + `SNAP_VISUAL_THRESHOLD_M`). İşaretçiyi oraya çizecek
 * kadar güvenmiyorsak kamerayı da oraya döndürmeyiz.
 */
export function getSnappedRoadBearing(): number | null {
  const status = useNavigationStore.getState().status;
  if (status !== NavStatus.ACTIVE && status !== NavStatus.REROUTING) return null;
  if (_lastSnappedSegBearing === null) return null;
  if (_lastOffRouteM > SNAP_VISUAL_THRESHOLD_M) return null;
  return _lastSnappedSegBearing;
}

/* ── KIRPMA EŞİĞİ = GÖRSEL OTURTMA EŞİĞİ (saha 2026-08-03) ───────────────────
 * Eskiden kırpma toleransı 80 m, işaretçiyi rotaya oturtma toleransı 20 m idi.
 * 56 m sapmada (cihazda ölçüldü) ürün AYNI ANDA iki çelişik şey söylüyordu:
 *   • işaretçi: "rotada DEĞİLİM" → araç gerçek GPS konumunda çizilir
 *   • kırpma:   "rotadayım"      → çizgi 56 m ötedeki snapped noktadan kesilir
 * Sonuç: rota aracın ÖNÜNDE kesiliyor, arada boşluk kalıyor — kullanıcının
 * "dengesiz duruyor" dediği görüntü.
 *
 * Tek doğruluk: aracı oraya çizecek kadar güvenmiyorsak, rotayı da oradan
 * kesmeyiz. Eşik ötesinde kırpma yapılmaz → çizgi tam çizilir ve aracın
 * yakınından geçmeye devam eder. */

/**
 * Kat edilen rota kırpma için ilerleme noktası: en yakın segment index'i +
 * rota üzerine yansıtılmış (snapped) konum. FullMapView GPS tick'i bunu
 * okuyup rota çizgisini snapped noktadan İLERİYE doğru yeniden çizer —
 * geride kalan kısım haritadan silinir.
 *
 * null: navigasyon aktif değil / henüz hesap yok / araç rotadan çok uzak.
 */
export function getRouteProgressPoint(): { segIdx: number; lat: number; lon: number } | null {
  const status = useNavigationStore.getState().status;
  if (status !== NavStatus.ACTIVE && status !== NavStatus.REROUTING) return null;
  if (_lastClosestSegIdx < 0 || _lastSnappedLat === null || _lastSnappedLon === null) return null;
  if (_lastOffRouteM > SNAP_VISUAL_THRESHOLD_M) return null;
  return { segIdx: _lastClosestSegIdx, lat: _lastSnappedLat, lon: _lastSnappedLon };
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
      startNavigation(offlineMatch, true, 'USER_SEARCH');
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
        startNavigation(offlineMatch, true, 'USER_SEARCH');
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

    startNavigation(destination, false, 'USER_SEARCH');
    // 2. Persistence on success (Write Throttling)
    await addToHistory(destination);
    return true;
  } catch {
    // AbortError (timeout) veya ağ hatası → yerel geçmişe fallback
    const offlineMatch = await searchOffline(text);
    if (offlineMatch) {
      startNavigation(offlineMatch, true, 'USER_SEARCH');
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
  const isGuidanceActive   = useNavigationStore((s) => s.isGuidanceActive);
  const isRerouting        = useNavigationStore((s) => s.isRerouting);
  const destination        = useNavigationStore((s) => s.destination);
  const distanceMeters     = useNavigationStore((s) => s.distanceMeters);
  const distanceSource     = useNavigationStore((s) => s.distanceSource);
  const etaSeconds         = useNavigationStore((s) => s.etaSeconds);
  const headingToDestination = useNavigationStore((s) => s.headingToDestination);
  const isOfflineResult    = useNavigationStore((s) => s.isOfflineResult);
  const errorMessage       = useNavigationStore((s) => s.errorMessage);

  return {
    status,
    isNavigating,
    isGuidanceActive,
    isRerouting,
    destination,
    distanceMeters,
    distanceSource,
    etaSeconds,
    headingToDestination,
    isOfflineResult,
    errorMessage,
  };
}

/**
 * G3 (#530) — ETA sıçrama defteri okuma ucu (salt-okunur, senkron).
 * LAB ve saha köprüsü buradan okur; koordinat/PII taşımaz.
 */
export function getEtaJumpLedger(): {
  readonly records: readonly EtaJumpRecord[];
  readonly summary: EtaJumpSummary;
} {
  return { records: _etaJumps.slice(), summary: summarizeJumps(_etaJumps) };
}
