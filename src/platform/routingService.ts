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
import { DEFAULT_FUEL_L_PER_100KM } from './vehicleAssumptions';
import {
  parseRouteDurations, remainingRouteDurationS,
  type RouteDurationSource, type RouteDurationIntegrity,
} from './navigation/core/routeDurationModel';
import { useUnifiedVehicleStore } from './vehicleDataLayer/UnifiedVehicleStore';
import { tryLocalDaemon, computeOfflineRoute, straightLineRoute } from './offlineRoutingService';
import { speakNavigation } from './ttsService';
import {
  hav, projectOnSegment, pointToSegmentDist, buildCumulativeDistances,
} from './navigation/core/geo';
import {
  matchToRoute, CORRIDOR_BASE_M, CORRIDOR_ACC_CAP_M,
  type MapMatchFix, type MapMatchSample,
} from './navigation/core/mapMatchModel';
import {
  initialOffRoute, stepOffRoute, markRerouting, markRouteCommitted,
  ACTIONABLE_ACCURACY_M,
  type OffRouteMachine,
} from './navigation/core/offRouteModel';
import {
  buildManeuverAnchors, alongRouteDistanceToManeuver, hasPassedManeuverAlongRoute,
  type ManeuverAnchor,
} from './navigation/core/maneuverIndexModel';
import {
  validateRoute, pickBestRoute,
  type RouteCandidate, type RouteValidationResult,
} from './navigation/core/routeValidationModel';
import {
  beginRouteRequest, isCurrentRequest, recordResponse, recordCommit,
  recordStaleRejected, recordInvalidRejected, recordFailure,
  recordSuppressedDuplicate, markOffRouteDetected, resetRouteRequestLedger,
  recordRerouteBlocked,
} from './navigation/core/routeRequestLedger';
import {
  recordRouteSource, recordRemoteFailure,
} from './navigation/core/routeProviderReadiness';

/* Geometri primitifleri artık `navigation/core/geo` içinde YAŞAR (saf katman
 * onları import edebilsin diye). Mevcut tüketiciler — hazardService,
 * fuelAdvisorService, tripCorridorEngine, tripPreviewEngine, navigationService —
 * bugüne kadar routingService'ten aldı; sözleşme KORUNUR, yeniden ihraç edilir. */
export { hav, projectOnSegment, pointToSegmentDist };

/* ── Tipler ──────────────────────────────────────────────────── */

/** OSRM `intersections[].lanes` girdisi — GERÇEK şerit, türetilmiş DEĞİL. */
export interface RouteLane {
  /** Bu şerit manevra için kullanılabilir mi. */
  valid:       boolean;
  /** OSRM bu şeridi önerdi mi. */
  active:      boolean;
  /** 'left' | 'straight' | 'slight right' … (OSRM sözlüğü). */
  indications: string[];
}

export interface RouteStep {
  instruction:      string;           // Türkçe yönlendirme
  streetName:       string;
  distance:         number;           // Bu adım için metre
  duration:         number;           // Bu adım için saniye (OSRM'den); road-speed tahmininde kullanılır
  maneuverType:     string;           // OSRM: "turn" | "arrive" | "depart" | ...
  maneuverModifier: string;           // OSRM: "left" | "right" | "straight" | ...
  coordinate:       [number, number]; // [lon, lat] adım başlangıcı
  /** Dönel kavşak çıkış numarası (OSRM `maneuver.exit`). null = sağlayıcı bildirmedi. */
  roundaboutExit:   number | null;
  /** GERÇEK şerit verisi. null = OSRM bu kavşak için şerit BİLDİRMEDİ → UI şerit paneli GÖSTERMEZ. */
  lanes:            RouteLane[] | null;
  /** Adımın kendi geometrisindeki nokta sayısı — manevra çapalarını KESİN bağlamak için. */
  geometryPointCount: number;
}

/** Bir sonraki manevraya mesafe hangi yöntemle bulundu — dürüstlük etiketi. */
export type ManeuverDistanceSource =
  /** Rota geometrisi üzerinde yol-boyu (DOĞRU yöntem). */
  | 'ALONG_ROUTE'
  /** Yol-boyu çözülemedi; kuş uçuşu kullanıldı (virajda KISA çıkar). */
  | 'STRAIGHT_LINE'
  /** Mesafe bilinmiyor — kesin komut üretilmemeli. */
  | 'UNKNOWN';

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
  /**
   * Manevra noktalarının geometri çapaları — yol-boyu mesafenin O(1) kaynağı.
   * Rota kurulunca bir kez hesaplanır. Boş dizi = çözülmedi (kuş uçuşuna düşülür).
   */
  maneuverAnchors:          readonly ManeuverAnchor[];
  /** `distanceToNextTurnMeters` hangi yöntemle bulundu. */
  distanceToNextTurnSource: ManeuverDistanceSource;
  /** Aktif rotanın doğrulama hükmü — REJECTED rota hiç uygulanmaz, bu alan tanı içindir. */
  validation:               RouteValidationResult | null;

  /* ── ROTA SÜRE MODELİ (NAVIGATION_DELIVERY_CORE_P0) ──────────────────────
   * `annotations=duration` istek URL'inde ZATEN vardı ama yanıt hiç
   * ayrıştırılmıyordu. Artık ayrıştırılır ve ETA'nın GÖVDESİ olur
   * (bkz. `navigation/core/etaModel.ts`). */

  /** Segment başına süre (sn). Uzunluk = nokta sayısı − 1. `null` = doğrulanmadı. */
  segmentDurations:         Float64Array | null;
  /**
   * Suffix-sum süre dizisi: cumulativeDurations[i] = geometry[i]'den rotanın
   * sonuna kadar kalan süre (sn). Son eleman 0. `cumulativeDistances` ile
   * BİREBİR aynı desen — ikisi aynı geometriye aittir.
   */
  cumulativeDurations:      Float64Array | null;
  /** Süre verisinin kaynağı — düz hat OSRM gibi sunulamaz. */
  routeDurationSource:      RouteDurationSource;
  /** Süre dizisinin doğrulama sonucu — `VALID` değilse kesin ETA üretilmez. */
  durationIntegrityState:   RouteDurationIntegrity;
  /**
   * Aktif rotanın revizyon numarası. HER commit ve HER alternatif seçiminde
   * artar. Süre dizisinin ait olduğu revizyonu ETA modeli bununla karşılaştırır
   * → **bayat rota süresi kullanılamaz** (atomik devralma).
   */
  routeRevision:            number;
  /** Süre dizisinin ait olduğu revizyon (normalde `routeRevision` ile aynı). */
  durationRevision:         number;
  /**
   * Rota üzerinde hedefe kalan SÜRE (sn) — her ilerleme tick'inde MUTLAK olarak
   * yeniden okunur (birikimli DEĞİL → geçilen segmentler tekrar eklenmez).
   * `null` = süre modeli kullanılamıyor.
   */
  remainingRouteDurationSeconds: number | null;
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
  maneuverAnchors: [],
  distanceToNextTurnSource: 'UNKNOWN',
  validation: null,
  segmentDurations: null,
  cumulativeDurations: null,
  routeDurationSource: 'NONE',
  durationIntegrityState: 'MISSING',
  /* `routeRevision` INITIAL'da 0'dır ama `_commitRoute`/`selectAltRoute` her
     zaman MEVCUT değerin üstüne ekler — `fetchRoute` başındaki
     `setState({...INITIAL})` revizyonu geri saymasın diye (bkz. `_nextRevision`). */
  routeRevision: 0,
  durationRevision: -1,
  remainingRouteDurationSeconds: null,
};

/** Monotonik rota revizyonu — store sıfırlansa bile GERİ SAYMAZ. */
let _routeRevisionSeq = 0;
function _nextRevision(): number { return ++_routeRevisionSeq; }

/**
 * OSRM rotasının TÜM bacaklarındaki `annotation.duration` dizilerini birleştirir.
 *
 * ⚠️ BACAK SINIRI: her bacağın annotation dizisi o bacağın nokta sayısı − 1
 * uzunluğundadır. Bacaklar art arda eklendiğinde toplam uzunluk, birleşik
 * geometrinin nokta sayısı − 1'e eşit olur ANCAK yalnız bacak birleşim
 * noktaları tekrarlanmıyorsa. Bu yüzden burada uzunluk DOĞRULANMAZ; doğrulama
 * `parseRouteDurations` içinde geometriye karşı yapılır ve uyuşmazsa dizi
 * TÜMDEN reddedilir (fail-closed). Bugün rota tek bacaklıdır (tek hedef).
 */
function _legAnnotationDurations(
  r: { legs: Array<{ annotation?: { duration?: number[] } }> },
): number[] | null {
  try {
    const legs = r.legs ?? [];
    const out: number[] = [];
    for (const leg of legs) {
      const d = leg?.annotation?.duration;
      if (!Array.isArray(d)) return null;   // tek bacak bile eksikse dizi kullanılmaz
      out.push(...d);
    }
    return out.length > 0 ? out : null;
  } catch { return null; }
}

/** Adım listesinden manevra çapalarını kurar — tek çağrı noktası. */
function _anchorsFor(
  geometry: [number, number][] | null,
  cum: Float64Array | null,
  steps: readonly RouteStep[],
): readonly ManeuverAnchor[] {
  return buildManeuverAnchors(geometry, cum, steps.map(s => ({
    coordinate: s.coordinate,
    geometryPointCount: s.geometryPointCount,
  })));
}

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

let _rerouteCtx:       { toLat: number; toLon: number } | null = null;
let _lastRerouteMs   = 0;
let _reroutingCb:    ((isRerouting: boolean) => void) | null = null;
let _isFetchingRoute = false;
// Navigasyon başlangıcı — ilk 3s GPS kararsız, reroute engellenir
let _navContextStartMs = 0;

/* ── Navigasyon çekirdeği: eşleştirme + sapma makinesi ──────────────────────
 * Bu iki değişken ROTA KARARLARININ tek girdisidir. Ham GPS artık DOĞRUDAN
 * karar vermez; önce `matchToRoute` ile rota üzerine oturtulur, sonra
 * `stepOffRoute` çoklu kanıtla sapmaya hükmeder. Ham konum kaybolmaz:
 * `_lastFix.rawLat/rawLon` alanında tanı için durur. */
let _lastFix: MapMatchFix | null = null;
let _offRoute: OffRouteMachine = initialOffRoute();
/** Son tick'te kullanılan koridor yarı genişliği (m) — LAB gösterir. */
let _lastCorridorM = CORRIDOR_BASE_M + CORRIDOR_ACC_CAP_M;

/** Navigasyon çekirdeğinin salt-okunur anlık görüntüsü (CAROS LAB tüketir). */
export function getNavigationCoreSnapshot(): {
  fix: MapMatchFix | null;
  offRoute: OffRouteMachine;
  corridorM: number;
  lastRerouteAtMs: number;
  fetchInFlight: boolean;
} {
  return {
    fix: _lastFix,
    offRoute: _offRoute,
    corridorM: _lastCorridorM,
    lastRerouteAtMs: _lastRerouteMs,
    fetchInFlight: _isFetchingRoute,
  };
}

/** Koridor yarı genişliği — map-match ve sapma makinesi AYNI değeri paylaşır. */
function _corridorFor(accuracyM: number | null): number {
  return CORRIDOR_BASE_M + Math.min(accuracyM ?? CORRIDOR_ACC_CAP_M, CORRIDOR_ACC_CAP_M);
}

/** Navigasyon başladığında hedefe ait bağlamı kaydet. */
export function setRerouteContext(toLat: number, toLon: number): void {
  _rerouteCtx        = { toLat, toLon };
  _lastRerouteMs     = 0;
  _navContextStartMs = performance.now(); // startup guard başlat
  _lastFix           = null;
  _offRoute          = initialOffRoute();
  resetRouteRequestLedger();
}

/** Navigasyon durduğunda bağlamı temizle. */
export function clearRerouteContext(): void {
  _rerouteCtx        = null;
  _lastRerouteMs     = 0;
  _navContextStartMs = 0;
  _lastFix           = null;
  _offRoute          = initialOffRoute();
  resetRouteRequestLedger();
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

/* ── OSRM maneuver → Türkçe ──────────────────────────────────── */

/**
 * Dönel kavşak çıkış numarasının Türkçe sıralaması.
 * KANIT YOKSA (exit ayrıştırılamadıysa) sayı UYDURULMAZ — genel ifade kullanılır.
 */
const _EXIT_ORDINAL: Readonly<Record<number, string>> = {
  1: 'birinci', 2: 'ikinci', 3: 'üçüncü', 4: 'dördüncü',
  5: 'beşinci', 6: 'altıncı', 7: 'yedinci', 8: 'sekizinci',
};

function toTR(type: string, mod: string, name: string, exit?: number | null): string {
  const s = name ? ` (${name})` : '';
  if (type === 'depart')                            return `Yola çıkın${s}`;
  if (type === 'arrive')                            return 'Hedefinize ulaştınız';
  if (type === 'roundabout' || type === 'rotary' || type === 'roundabout turn') {
    /* DÖNEL KAVŞAK ÇIKIŞI (denetim §8 madde 2): `maneuver.exit` bugüne kadar
     * HİÇ ayrıştırılmıyordu ve sürücüye yalnız "Dönel kavşakta devam edin"
     * deniyordu. Artık sayı VARSA söylenir, YOKSA uydurulmaz. */
    const ord = exit != null && Number.isFinite(exit) ? _EXIT_ORDINAL[exit] : undefined;
    return ord
      ? `Dönel kavşakta ${ord} çıkıştan ayrılın${s}`
      : 'Dönel kavşakta devam edin';
  }
  if (type === 'exit roundabout' || type === 'exit rotary') return `Dönel kavşaktan çıkın${s}`;
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

/** OSRM `intersections[].lanes` — GERÇEK şerit verisi (türetilmiş DEĞİL). */
interface OsrmLane {
  valid?: boolean;
  active?: boolean;
  indications?: string[];
}

interface OsrmStep {
  distance: number;
  duration: number;
  name: string;
  ref?: string;
  maneuver: { type: string; modifier?: string; exit?: number };
  geometry: { coordinates: [number, number][] };
  intersections?: Array<{ classes?: string[]; lanes?: OsrmLane[] }>;
}

/**
 * Adımın manevra kavşağındaki GERÇEK şerit verisini çıkarır.
 *
 * DÜRÜSTLÜK (denetim §8 madde 1 — ürünün kendi "kanıtsız bilgi üretme" yasağı):
 * OSRM şerit verisini `intersections[].lanes` içinde döner ve ÇOĞU kavşakta
 * BU ALAN YOKTUR. Alan yoksa `null` döneriz; UI şerit panelini GÖSTERMEZ.
 * Manevra tipinden ok türetmek — bugüne kadar yapılan — sürücüye gerçek şerit
 * bilgisi olduğu izlenimi verir; bu, hiç göstermemekten KÖTÜDÜR.
 */
function extractLanes(st: OsrmStep): RouteLane[] | null {
  const ix = st.intersections;
  if (!Array.isArray(ix) || ix.length === 0) return null;
  // Manevranın gerçekleştiği kavşak, adımın SON kavşağıdır.
  for (let i = ix.length - 1; i >= 0; i--) {
    const lanes = ix[i]?.lanes;
    if (Array.isArray(lanes) && lanes.length > 0) {
      return lanes.map(l => ({
        valid: l.valid === true,
        active: l.active === true,
        indications: Array.isArray(l.indications) ? l.indications.slice() : [],
      }));
    }
  }
  return null;
}

/** OSRM adımını dahili `RouteStep`e çevirir — tek dönüşüm noktası. */
function _toRouteStep(st: OsrmStep): RouteStep {
  const exit = typeof st.maneuver.exit === 'number' ? st.maneuver.exit : null;
  return {
    instruction:      toTR(st.maneuver.type, st.maneuver.modifier ?? 'straight', st.name ?? '', exit),
    streetName:       st.name ?? '',
    distance:         st.distance,
    duration:         st.duration,
    maneuverType:     st.maneuver.type,
    maneuverModifier: st.maneuver.modifier ?? 'straight',
    coordinate:       st.geometry.coordinates[0] as [number, number],
    roundaboutExit:   exit,
    lanes:            extractLanes(st),
    geometryPointCount: st.geometry.coordinates.length,
  };
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

/**
 * OSRM `bearings` toleransı (derece, ±). Google/Waze mertebesinde: dar tutmak
 * GPS heading gürültüsünde rotayı hiç kurdurmaz, geniş tutmak ters şeridi
 * elemez. ±75° aracın ÖNÜNDEKİ yarım düzlemi kapsar, arkasını eler.
 */
export const OSRM_BEARING_TOLERANCE_DEG = 75;

/** Altında GPS yönünün GÜVENİLMEZ sayıldığı hız (km/h) — bkz. `_currentHeadingDeg`. */
export const HEADING_TRUST_MIN_KMH = 5;

/**
 * Aracın yönünden OSRM `bearings` parametresi üretir (saf).
 *
 * ── NEDEN GEREKLİ (saha 2026-08-03, kullanıcı: "rotayı çizdiği yer saçma …
 *    ters yolda … kısayol dönüşü yapın diyor") ─────────────────────────────
 * `bearings` GÖNDERİLMEZSE OSRM başlangıç noktasını EN YAKIN yol kenarına
 * yapıştırır ve aracın hangi yöne baktığını BİLMEZ. Bölünmüş bulvarda
 * (Atatürk Bulvarı — ekran görüntüsünde iki ayrı sarı şerit ve ters yönlü
 * oklar) bu, aracı KARŞI ŞERİDE yapıştırır. Sonuç üç semptomun tek kökü:
 *   • rota gerçek yolun YANINDAN paralel geçiyor görünür (yanlış şerit),
 *   • ilk manevra olarak SAHTE bir U dönüşü üretilir,
 *   • "kısa yol dururken" uzun/absürt bir başlangıç seçilir.
 * Her üretim navigasyon uygulaması bu yüzden mevcut heading'i gönderir.
 *
 * DÜRÜSTLÜK: yön BİLİNMİYORSA parametre HİÇ gönderilmez (uydurma yön, yanlış
 * şeride yapışmaktan daha kötüdür — rotayı tamamen kurduramayabilir).
 * Hedef ucu her zaman serbest bırakılır (varışta yön dayatılmaz).
 */
export function buildOsrmBearings(headingDeg?: number | null): string | null {
  if (headingDeg == null || !Number.isFinite(headingDeg)) return null;
  const b = ((Math.round(headingDeg) % 360) + 360) % 360;
  return `${b},${OSRM_BEARING_TOLERANCE_DEG};`;
}

/**
 * Rota isteği için aracın O ANKİ yönü (derece) — TEK okuma noktası.
 * Kaynak `UnifiedVehicleStore.heading` (harmanlanmış GPS+pusula); routingService
 * bu store'u zaten kullanıyor, yeni bağımlılık/otorite EKLENMEZ.
 * Okuma başarısızsa `null` → `bearings` gönderilmez (uydurma yön yok).
 */
function _currentHeadingDeg(): number | null {
  try {
    const st = useUnifiedVehicleStore.getState();
    /* ⚠️ DURAKTA YÖN GÜRÜLTÜDÜR — bearings GÖNDERİLMEZ.
     * GPS "course over ground" ancak araç GERÇEKTEN hareket ederken anlamlıdır.
     * Aynı cihazda park hâlinde heading'in ardışık fix'lerde 92° → 97.6° →
     * 101.2° → 103.6° → 106.1° kaydığı ÖLÇÜLDÜ. Duran araçta rota kurulurken
     * böyle bir değeri ±75° toleransla OSRM'e dayatmak, aracı YANLIŞ yöne
     * kilitleyebilir — yani `bearings` göndermemekten DAHA KÖTÜ olur.
     * Eşik kameranınkiyle aynı (`CAMERA_CFG.JITTER_SPEED_KMH` mertebesi):
     * altında yön BİLİNMİYOR sayılır ve parametre hiç eklenmez. */
    const kmh = st.speed ?? 0;          // store km/h (bkz. birim notu)
    if (!(kmh >= HEADING_TRUST_MIN_KMH)) return null;
    const h = st.heading;
    return Number.isFinite(h ?? NaN) ? (h as number) : null;
  } catch { return null; }
}

async function _tryServer(
  baseUrl: string,
  fromLon: number, fromLat: number,
  toLon: number,   toLat: number,
  headingDeg?: number | null,
): Promise<{ steps: RouteStep[]; altSteps: RouteStep[][]; geometry: [number, number][]; alternatives: [number, number][][]; altDistances: number[]; altDurations: number[]; altHasToll: boolean[]; distance: number; duration: number; hasToll: boolean;
  /** Ana + alternatif rotaların OSRM segment süreleri (sn). `null` = sağlayıcı göndermedi. */
  annotationDurations: (number[] | null)[] }> {
  // Coordinate validation
  if (!Number.isFinite(fromLat) || Math.abs(fromLat) > 90)  throw new Error(`INVALID_COORDS: origin lat=${fromLat}`);
  if (!Number.isFinite(fromLon) || Math.abs(fromLon) > 180) throw new Error(`INVALID_COORDS: origin lon=${fromLon}`);
  if (!Number.isFinite(toLat)   || Math.abs(toLat)   > 90)  throw new Error(`INVALID_COORDS: dest lat=${toLat}`);
  if (!Number.isFinite(toLon)   || Math.abs(toLon)   > 180) throw new Error(`INVALID_COORDS: dest lon=${toLon}`);

  // OSRM expects [longitude, latitude] — GeoJSON order
  const originCoords = [fromLon, fromLat] as const;  // [lon, lat]
  const destCoords   = [toLon,   toLat  ] as const;  // [lon, lat]
  const coordStr = `${originCoords[0]},${originCoords[1]};${destCoords[0]},${destCoords[1]}`;
  const _bearings = buildOsrmBearings(headingDeg);
  const url      = `${baseUrl}/${coordStr}?steps=true&geometries=geojson&overview=full&alternatives=3&annotations=duration,distance&continue_straight=default`
    + (_bearings ? `&bearings=${encodeURIComponent(_bearings)}` : '');
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
        /* `annotation.duration` — istek URL'inde ZATEN isteniyordu
           (`annotations=duration,distance`) ama bu tura kadar HİÇ okunmuyordu. */
        legs: Array<{ steps: OsrmStep[]; annotation?: { duration?: number[] } }>;
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

    const steps: RouteStep[] = route.legs[0].steps.map(_toRouteStep);

    const altRouteData = (data.routes ?? []).slice(1);
    const alternatives = altRouteData.map(r =>
      normalizeCoords(r.geometry.coordinates as [number, number][], fromLon, fromLat, toLon, toLat),
    );
    const altSteps: RouteStep[][] = altRouteData.map(r =>
      (r.legs[0].steps as OsrmStep[]).map(_toRouteStep),
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
      annotationDurations: [route, ...altRouteData].map(_legAnnotationDurations),
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

/* ── Navigation Style Callbacks ────────────────────────────────────────────
 * Rota hazır/temizlendiğinde dış sistemlere (mapService focus mode) haber ver.
 * Direct import döngüsünü önlemek için callback pattern kullanılır.
 */
type NavStyleCb = (active: boolean) => void;
const _navStyleCbs: NavStyleCb[] = [];

/**
 * Rota state değişimlerine abone ol — mapService veya FullMapView tarafından
 * kaydedilir. Rota geometrisi hazır → true, clearRoute → false olarak tetiklenir.
 * @returns unsubscribe fonksiyonu
 */
export function registerNavigationStyleCallback(cb: NavStyleCb): () => void {
  _navStyleCbs.push(cb);
  return () => { const i = _navStyleCbs.indexOf(cb); if (i >= 0) _navStyleCbs.splice(i, 1); };
}

function _fireNavStyle(active: boolean): void {
  for (const cb of _navStyleCbs) { try { cb(active); } catch { /* ignore */ } }
}

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
  /** Bu adayın OSRM segment süreleri — alternatif seçilince süre modeli KAYBOLMAZ. */
  annotationDurations: number[] | null;
}
let _allRoutes: _StoredRoute[] = [];

/* `_storeAllRoutes` KALDIRILDI: rota adaylarının sıralaması artık doğrulama
 * kapısının (`pickBestRoute`) sonucudur; sağlayıcı sırası körlemesine
 * korunmaz. `_allRoutes` doğrudan `fetchRoute` içinde, seçilen rota başa
 * alınarak kurulur. */

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
  const _pickedCum   = buildCumulativeDistances(picked.geometry);
  // Rota değişti → eşleştirme geçmişi ARTIK GEÇERSİZ. Eski segment indeksiyle
  // yeni geometride pencere araması yapmak yanlış eşleşme üretir.
  _lastFix  = null;
  _offRoute = markRouteCommitted();
  /* Alternatif seçimi de bir ROTA DEĞİŞİMİDİR: revizyon artar ve o adayın
     KENDİ süre dizisi devralınır — eski rotanın süresi taşınmaz. */
  const _altRev    = _nextRevision();
  const _altParsed = parseRouteDurations(picked.annotationDurations, picked.geometry.length);
  useRouteStore.setState({
    geometry:             picked.geometry,
    cumulativeDistances:  _pickedCum,
    segmentDurations:       _altParsed.segmentDurations,
    cumulativeDurations:    _altParsed.cumulativeDurations,
    routeDurationSource:    _altParsed.integrity === 'VALID' ? _altParsed.source : 'ROUTE_TOTAL',
    durationIntegrityState: _altParsed.integrity,
    routeRevision:          _altRev,
    durationRevision:       _altRev,
    remainingRouteDurationSeconds: null,
    maneuverAnchors:      _anchorsFor(picked.geometry, _pickedCum, picked.steps),
    distanceToNextTurnSource: 'UNKNOWN',
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
 * Bir rotayı store'a UYGULA — tek commit noktası.
 *
 * Buradan geçmeyen hiçbir rota aktif olamaz. Üç görevi vardır:
 *   1. İsteğin hâlâ GÜNCEL olduğunu doğrular (bayat yanıt rotayı EZEMEZ).
 *   2. Manevra çapalarını kurar (yol-boyu mesafenin O(1) kaynağı).
 *   3. Eşleştirme/sapma makinesini sıfırlar (eski rotanın segment indeksi
 *      yeni geometride ANLAMSIZDIR).
 *
 * @returns Uygulandıysa `true`; bayat olduğu için reddedildiyse `false`.
 */
function _commitRoute(
  reqId: number,
  patch: Partial<RouteState>,
  geometry: [number, number][],
  steps: readonly RouteStep[],
  providerLabel: string,
  sourceKind: Parameters<typeof recordRouteSource>[0],
  validation: RouteValidationResult | null,
  /** Sağlayıcının segment süreleri (sn) — yoksa `null` (düz hat / daemon / A*). */
  annotationDurations: number[] | null = null,
  /** Süre dizisi yokken kaynağı dürüstçe etiketler. */
  fallbackDurationSource: RouteDurationSource = 'ROUTE_TOTAL',
): boolean {
  if (!isCurrentRequest(reqId)) {
    recordStaleRejected(reqId);
    console.warn(`[ROUTE] stale response rejected (req=${reqId}) — güncel istek başka`);
    return false;
  }
  const cum = buildCumulativeDistances(geometry);
  _lastFix  = null;
  _offRoute = markRouteCommitted();

  /* ── SÜRE MODELİ ATOMİK DEVRALINIR ──────────────────────────────────────
     Revizyon, geometri, mesafe dizisi ve süre dizisi TEK `setState` içinde
     birlikte yazılır. Böylece hiçbir okuyucu yeni geometriyle eski süreyi
     (veya tersini) bir arada göremez — reroute anında ETA "bayat" değil,
     doğrudan yeni rotanın süresidir. */
  const rev = _nextRevision();
  const parsed = parseRouteDurations(annotationDurations, geometry.length);

  useRouteStore.setState({
    ...patch,
    geometry,
    cumulativeDistances:      cum,
    maneuverAnchors:          _anchorsFor(geometry, cum, steps),
    distanceToNextTurnMeters: 0,
    distanceToNextTurnSource: 'UNKNOWN',
    currentStepIndex:         0,
    validation,
    segmentDurations:         parsed.segmentDurations,
    cumulativeDurations:      parsed.cumulativeDurations,
    routeDurationSource:      parsed.integrity === 'VALID' ? parsed.source : fallbackDurationSource,
    durationIntegrityState:   parsed.integrity,
    routeRevision:            rev,
    durationRevision:         rev,
    remainingRouteDurationSeconds: null,
  });
  recordRouteSource(sourceKind, providerLabel);
  recordCommit(reqId, performance.now(), providerLabel);
  return true;
}

/** OSRM sonucundan doğrulama adayı üretir. */
function _toCandidate(
  geometry: [number, number][], distanceM: number, durationS: number, steps: readonly RouteStep[],
): RouteCandidate {
  return { geometry, distanceM, durationS, steps };
}

/**
 * Rota çek — katmanlı mimari + istek yaşam döngüsü + doğrulama kapısı.
 *
 *   Katman 0: yerel OSRM daemon — YALNIZ hazır olduğu ÖLÇÜLDÜYSE denenir
 *   Katman 1-2: Uzak OSRM sunucuları (online)
 *   Katman 3: WebWorker A* — /maps/routing-graph.bin (artefakt yoksa kısa devre)
 *   Katman 4: Düz hat — GERÇEK ROTA DEĞİLDİR, öyle etiketlenir
 *
 * `kind` gecikme ölçümü içindir: 'REROUTE' olduğunda sapma→talimat zinciri ölçülür.
 */
export async function fetchRoute(
  fromLat: number,
  fromLon: number,
  toLat:   number,
  toLon:   number,
  kind: 'INITIAL' | 'REROUTE' | 'MANUAL' = 'INITIAL',
): Promise<void> {
  const reqId = beginRouteRequest(kind, performance.now());
  const headingDeg = _currentHeadingDeg();

  // Preserve currentStepIndex during loading so UI keeps the active turn instruction.
  // It will be overwritten to 0 once the new route geometry arrives.
  const { currentStepIndex: _prevStepIdx } = useRouteStore.getState();
  // ...INITIAL spreads cumulativeDistances: null → önceki Float64Array GC'ye serbest bırakılır.
  useRouteStore.setState({ ...INITIAL, loading: true, currentStepIndex: _prevStepIdx });

  const _validateOne = (c: RouteCandidate): RouteValidationResult => validateRoute({
    candidate: c,
    originLat: fromLat, originLon: fromLon,
    destLat: toLat,     destLon: toLon,
    vehicleHeadingDeg: headingDeg,
    isStaleRequest: !isCurrentRequest(reqId),
  });

  // ── Katman 0: Yerel OSRM daemon ─────────────────────────────
  // ÖLÜ KATMAN KAPATILDI (denetim §4.2): daemon hazırlığı oturumda BİR KEZ,
  // sınırlı süreyle yoklanır. Yoksa bir daha DENENMEZ — her rotada 3 sn'ye
  // kadar boşuna bekleme, sapma anında doğrudan reroute gecikmesiydi.
  if (isNative) {
    const daemonResult = await tryLocalDaemon(fromLon, fromLat, toLon, toLat);
    if (daemonResult && daemonResult.geometry && daemonResult.geometry.length >= 2) {
      recordResponse(reqId, performance.now(), 'localhost:5000');
      const cand = _toCandidate(daemonResult.geometry, daemonResult.distanceM,
        daemonResult.durationS, daemonResult.steps);
      const v = _validateOne(cand);
      if (v.verdict === 'REJECTED') {
        recordInvalidRejected(reqId);
        console.warn('[ROUTE] Layer 0 rotası doğrulama kapısından geçemedi — sonraki katman', v.checks.filter(c => c.status === 'FAIL'));
      } else {
        await _waitForStyleReady();
        const ok = _commitRoute(reqId, {
          loading: false, error: null,
          steps: daemonResult.steps,
          totalDistanceMeters:  daemonResult.distanceM,
          totalDurationSeconds: daemonResult.durationS,
          serverUsed: 'localhost:5000',
        }, daemonResult.geometry, daemonResult.steps, 'localhost:5000', 'LOCAL_DAEMON', v);
        if (ok) { _fireNavStyle(true); return; }
        return; // bayat — yeni istek zaten yolda
      }
    } else if (daemonResult) {
      console.error('[ROUTE] Layer 0: daemon returned NO_GEOMETRY — falling through', { pts: daemonResult.geometry?.length ?? 0 });
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
        const result = await _tryServer(server, fromLon, fromLat, toLon, toLat, headingDeg);
        recordResponse(reqId, performance.now(), server);

        // ── ROTA DOĞRULUK KAPISI ────────────────────────────────────────────
        // Sağlayıcının İLK rotası artık koşulsuz kabul EDİLMEZ. Alternatifler
        // zaten isteniyordu (`alternatives=3`) ama yalnız UI'a sunuluyordu;
        // artık hepsi doğrulanır ve EN AZ KUSURLU olan aktif rota olur.
        const cands: { candidate: RouteCandidate; validation: RouteValidationResult }[] = [];
        const mainCand = _toCandidate(result.geometry, result.distance, result.duration, result.steps);
        cands.push({ candidate: mainCand, validation: _validateOne(mainCand) });
        for (let i = 0; i < result.alternatives.length; i++) {
          const c = _toCandidate(
            result.alternatives[i], result.altDistances[i] ?? 0,
            result.altDurations[i] ?? 0, result.altSteps[i] ?? [],
          );
          cands.push({ candidate: c, validation: _validateOne(c) });
        }
        const picked = pickBestRoute(cands);
        if (!picked) {
          recordInvalidRejected(reqId);
          console.warn(`[ROUTE] ${server}: TÜM adaylar doğrulama kapısından düştü — sonraki sunucu`,
            cands.map(c => c.validation.checks.filter(k => k.status === 'FAIL').map(k => k.id)));
          continue;
        }
        if (picked.index !== 0) {
          console.warn(`[ROUTE] doğrulama kapısı sağlayıcının ilk rotasını REDDETTİ → alternatif #${picked.index} seçildi`);
        }

        await _waitForStyleReady(); // stil yenileniyorsa layer hazır olana kadar bekle

        // Seçilen rota ana; kalanlar alternatif (harita üzerinde seçilebilir kalır).
        const others = cands.filter((_, i) => i !== picked.index).map(c => c.candidate);
        const hasTollAll = [result.hasToll, ...result.altHasToll];
        const pickedToll = hasTollAll[picked.index] ?? false;
        const otherToll  = hasTollAll.filter((_, i) => i !== picked.index);

        // Aday indeksleri: seçilen başa alınır, kalanlar sırasını korur.
        const otherIdx = cands.map((_, i) => i).filter(i => i !== picked.index);
        _allRoutes = [
          { geometry: picked.candidate.geometry as [number, number][], distanceM: picked.candidate.distanceM,
            durationS: picked.candidate.durationS, steps: picked.candidate.steps as RouteStep[], hasToll: pickedToll,
            annotationDurations: result.annotationDurations[picked.index] ?? null },
          ...others.map((c, i) => ({
            geometry: c.geometry as [number, number][], distanceM: c.distanceM,
            durationS: c.durationS, steps: c.steps as RouteStep[], hasToll: otherToll[i] ?? false,
            annotationDurations: result.annotationDurations[otherIdx[i]] ?? null,
          })),
        ];

        const ok = _commitRoute(reqId, {
          loading: false, error: null,
          alternatives:     others.map(c => c.geometry as [number, number][]),
          altDistances:     others.map(c => c.distanceM),
          altDurations:     others.map(c => c.durationS),
          altHasToll:       otherToll,
          altRealIndices:   others.map((_, i) => i + 1),
          selectedAltIndex: 0,
          hasToll:          pickedToll,
          steps:            picked.candidate.steps as RouteStep[],
          totalDistanceMeters:  picked.candidate.distanceM,
          totalDurationSeconds: picked.candidate.durationS,
          serverUsed:       server,
        }, picked.candidate.geometry as [number, number][], picked.candidate.steps as RouteStep[],
           server, 'REMOTE_OSRM', picked.validation,
           /* Süre dizisi SEÇİLEN adaya aittir — sağlayıcının ilki reddedilip
              alternatif seçilmiş olabilir; indeks karıştırılırsa başka rotanın
              süresi uygulanırdı. */
           result.annotationDurations[picked.index] ?? null);

        if (ok) _fireNavStyle(true);
        return;
      } catch (e) {
        const _errMsg = e instanceof Error ? e.message : String(e);
        recordRemoteFailure();
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
      recordResponse(reqId, performance.now(), offlineResult.source);
      await _waitForStyleReady();
      const offlineSteps = offlineResult.steps.length > 0
        ? offlineResult.steps
        : [_makeSentinelStep(toLon, toLat, offlineResult.distanceM, offlineResult.durationS)];
      const v = _validateOne(_toCandidate(offlineResult.geometry, offlineResult.distanceM,
        offlineResult.durationS, offlineSteps));
      if (v.verdict === 'REJECTED') {
        recordInvalidRejected(reqId);
        console.warn('[ROUTE] Layer 3 rotası doğrulama kapısından geçemedi — düz hata düşülüyor');
      } else {
        const ok = _commitRoute(reqId, {
          loading: false, error: null,
          steps: offlineSteps,
          totalDistanceMeters:  offlineResult.distanceM,
          totalDurationSeconds: offlineResult.durationS,
          serverUsed: offlineResult.source,
        }, offlineResult.geometry, offlineSteps, offlineResult.source, 'OFFLINE_GRAPH', v);
        if (ok) _fireNavStyle(true);
        return;
      }
    }
  }

  // ── Katman 4: Düz hat — NAVİGASYON ROTASI DEĞİLDİR ───────────
  // NAV-2: DÜRÜST TEŞHİS — bu katmana iki AYRI sebeple düşülür: (1) navigator.onLine=false
  // (gerçekten internet yok), (2) internet AÇIK ama tüm rota sunucuları hata/timeout verdi
  // (sunucu tarafı). Eskiden ikisinde de "internet yok" deniyordu → yanlış teşhis. Artık ayrık.
  //
  // Doğrulama kapısı burada UYGULANMAZ: düz hat bir rota adayı değil, açıkça
  // etiketlenmiş bir SON ÇAREdir (`STRAIGHT_LINE_GUIDANCE`). Ona rota muamelesi
  // yapmak — doğrulayıp "GEÇERLİ" demek — tam olarak kaçındığımız yalandır.
  if (!isCurrentRequest(reqId)) { recordStaleRejected(reqId); return; }
  const _offline = typeof navigator !== 'undefined' && !navigator.onLine;
  console.warn(`[ROUTE] All OSRM layers failed — straight-line fallback (offline=${_offline})`);
  speakNavigation(_offline
    ? 'İnternet bağlantısı yok. Düz hat navigasyon aktif.'
    : 'Rota sunucusu şu an yanıt vermiyor. Düz hat navigasyon aktif.');
  const sl = straightLineRoute(fromLat, fromLon, toLat, toLon);
  await _waitForStyleReady(); // stil yenileniyorsa layer hazır olana kadar bekle
  if (!isCurrentRequest(reqId)) { recordStaleRejected(reqId); return; }
  /* `recordFailure` isteği PENDING'den çıkarır — bu yüzden SON güncellik
   * kontrolünden SONRA çağrılır. Aksi hâlde kendi kapımıza takılır ve düz-hat
   * yönlendirmesi hiç yazılmazdı (rota tamamen kaybolurdu). */
  recordFailure(reqId);
  const slSteps = [_makeSentinelStep(toLon, toLat, sl.distanceM, sl.durationS)];
  const slCum   = buildCumulativeDistances(sl.geometry);
  const _slRev  = _nextRevision();
  _lastFix  = null;
  _offRoute = markRouteCommitted();
  useRouteStore.setState({
    loading: false,
    error:   _offline
      ? 'İnternet yok — düz hat navigasyon aktif.'
      : 'Rota sunucusu yanıt vermiyor — düz hat navigasyon aktif.',
    geometry:             sl.geometry,
    cumulativeDistances:  slCum,
    maneuverAnchors:      _anchorsFor(sl.geometry, slCum, slSteps),
    steps:                slSteps,
    totalDistanceMeters:  sl.distanceM,
    totalDurationSeconds: sl.durationS,
    currentStepIndex:     0,
    distanceToNextTurnMeters: 0,
    distanceToNextTurnSource: 'UNKNOWN',
    validation:           null,
    serverUsed:           'straight-line',
    /* DÜZ HAT OSRM ETA'SI GİBİ SUNULMAZ. Süre dizisi yoktur ve kaynak açıkça
       `STRAIGHT_LINE_ESTIMATE`tir → `etaModel` bunu ASLA `ROUTE_MODEL` durumuna
       çeviremez; ETA `DEGRADED_FALLBACK` olarak işaretlenir. */
    segmentDurations:       null,
    cumulativeDurations:    null,
    routeDurationSource:    'STRAIGHT_LINE_ESTIMATE',
    durationIntegrityState: 'MISSING',
    routeRevision:          _slRev,
    durationRevision:       _slRev,
    remainingRouteDurationSeconds: null,
  });
  recordRouteSource('STRAIGHT_LINE_GUIDANCE', 'straight-line');
  _fireNavStyle(true); // düz hat fallback → focus mode aktif
}

/**
 * Aynı sapma için TEKRAR istek bastırma penceresi (request storm koruması).
 *
 * ── NEDEN KISALDI (5/10/15 sn → 2.5/4/6 sn) ─────────────────────────────────
 * Eski pencere, sapma DOĞRULAMASININ yerine geçen bir gecikmeydi: kanıt
 * toplamadan önce `return` ediliyordu, yani sayaç bile ilerlemiyordu ve
 * kullanıcının "yeniden rota çok geç" şikâyetinin en büyük tek kalemiydi.
 * Artık gerçek gecikme koruması SAPMA MAKİNESİNDEDİR (uyarlanabilir kanıt
 * penceresi); bu pencere yalnız AYNI sapma için üst üste istek atılmasını
 * engeller. İkisi birbirinin yerine geçmez.
 */
function _getRerouteThrottleMs(speedKmh: number): number {
  if (speedKmh > 80) return 2_500;
  if (speedKmh < 20) return 6_000;
  return 4_000;
}

/**
 * GPS güncellenince çağrılır — hangi adımdayız, sonraki dönüşe ne kadar?
 * 30m'den yaklaşılınca otomatik adım ilerler.
 * Sapma + hız-bağımlı throttle → otomatik yeniden rotalama.
 *
 * opts.allowReroute=false: adım ilerleme + mesafe güncellenir ama sapma tespiti
 * ATLANIR. Dead-reckoning (tünel) konumları için — DR projeksiyonu virajda
 * rotadan doğal olarak sapar; sahte reroute internet yokken gerçek rotayı
 * düz-çizgi fallback'iyle değiştirirdi (geri dönüşü yok).
 */
export function updateRouteProgress(
  lat: number,
  lon: number,
  opts?: { allowReroute?: boolean },
): void {
  const st = useRouteStore.getState();
  const { steps, currentStepIndex, geometry, cumulativeDistances, maneuverAnchors } = st;
  if (!steps.length) return;

  const now = performance.now();
  const { speed, location, heading } = useUnifiedVehicleStore.getState();
  /* ⚠️ BİRİM: `UnifiedVehicleStore.speed` ZATEN km/h'tir (store tanımı satır 80:
     "km/h, fused"). 3.6 ile ÇARPILMAZ — bu hata 2026-08-03'te bulundu ve tüm
     navigasyon zincirinde temizlendi (bkz. navigationService aynı düzeltme). */
  /* Kütük #408: hız BİLİNMİYORSA 0 UYDURULMAZ. Sahte 0, eşleme motoruna
   * "araç duruyor" diye okunuyor ve eldeki gerçek yön bilgisini çöpe atıyordu
   * (#405). Bilinmeyen bilinmeyen olarak taşınır; her tüketici kendi kararını
   * kanıta göre verir. Yalnız aritmetik gereken yerde 0'a düşülür. */
  const speedKmhOrNull = (speed != null && Number.isFinite(speed)) ? speed : null;
  const speedKmh = speedKmhOrNull ?? 0;
  const accuracyM = (location && Number.isFinite(location.accuracy)) ? location.accuracy : null;
  _lastCorridorM = _corridorFor(accuracyM);

  // ── 1) MAP MATCHING — ham GPS DOĞRUDAN karar vermez ───────────────────────
  const sample: MapMatchSample = {
    lat, lon,
    accuracyM,
    headingDeg: Number.isFinite(heading ?? NaN) ? (heading as number) : null,
    speedKmh: speedKmhOrNull,   // #408: bilinmiyorsa null — sahte 0 DEĞİL
    tsMs: now,
  };
  const prevFix = _lastFix;
  const fix = matchToRoute(sample, geometry, cumulativeDistances, prevFix, now);
  _lastFix = fix;

  const vehicleAlong = fix.alongRemainingM;
  const progressM = (prevFix?.alongRemainingM != null && vehicleAlong != null)
    ? prevFix.alongRemainingM - vehicleAlong
    : null;

  // ── 2) ADIM İLERLEME — yol-boyu, kuş uçuşu DEĞİL ──────────────────────────
  // Manevra çapaları çözülmüşse ilerleme rota üzerindeki mesafeye göre kararlaşır;
  // çözülemediyse (düz hat / sentinel / eski daemon yanıtı) eski kuş uçuşu
  // davranışına DÜŞÜLÜR — sessizce bozulmaz, yalnız daha az kesindir.
  let newStepIdx = currentStepIndex;
  const anchorsUsable = maneuverAnchors.length === steps.length && vehicleAlong != null
    && fix.state !== 'OFF_NETWORK' && fix.state !== 'STALE' && fix.state !== 'UNKNOWN';

  if (anchorsUsable) {
    while (newStepIdx + 1 < steps.length) {
      const a = maneuverAnchors[newStepIdx + 1];
      if (!hasPassedManeuverAlongRoute(vehicleAlong, a)) break;
      newStepIdx = newStepIdx + 1;
    }
  } else {
    while (newStepIdx + 1 < steps.length) {
      const checkIdx     = newStepIdx + 1;
      const [cLon, cLat] = steps[checkIdx].coordinate;
      if (hav(lat, lon, cLat, cLon) >= STEP_ADVANCE_THRESHOLD_M) break;
      const [prevLon, prevLat] = steps[newStepIdx].coordinate;
      const dirLon = cLon - prevLon, dirLat = cLat - prevLat;
      const passed = (dirLon === 0 && dirLat === 0)
        || (dirLon * (lon - cLon) + dirLat * (lat - cLat)) > 0;
      if (!passed) break;
      newStepIdx = checkIdx;
    }
  }
  // Monotonic Guard: eşleşme geriye kaysa bile adım GERİ GİTMEZ — aksi hâlde
  // aynı manevra tekrar tekrar seslendirilir (kullanıcı şikâyeti).
  newStepIdx = Math.max(newStepIdx, currentStepIndex);

  // ── 3) Maneuver Stack: yakın ardışık manevralar ───────────────────────────
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

  // ── 4) SONRAKİ MANEVRAYA MESAFE — yol-boyu ────────────────────────────────
  // Denetim §7.1 / kullanıcı: "daha 50 metre var, sağa dön diyor." Kuş uçuşu
  // mesafe virajlı yaklaşımda gerçek yol mesafesinden KISA çıkıyordu.
  let distToNextTurn = 0;
  let distSource: ManeuverDistanceSource = 'UNKNOWN';
  if (nextTurnIdx < steps.length) {
    const along = anchorsUsable
      ? alongRouteDistanceToManeuver(vehicleAlong, maneuverAnchors[nextTurnIdx])
      : null;
    if (along != null) {
      distToNextTurn = along;
      distSource = 'ALONG_ROUTE';
    } else if (fix.state === 'STALE' || fix.state === 'UNKNOWN') {
      // Konum bilinmiyor → mesafe UYDURULMAZ; son bilinen değer korunur.
      distToNextTurn = st.distanceToNextTurnMeters;
      distSource = 'UNKNOWN';
    } else {
      distToNextTurn = hav(lat, lon, steps[nextTurnIdx].coordinate[1], steps[nextTurnIdx].coordinate[0]);
      distSource = 'STRAIGHT_LINE';
    }
  }

  /* ── 4b) ROTA ÜZERİNDE KALAN SÜRE — MUTLAK okuma ──────────────────────────
   * Birikimli DEĞİLDİR: her tick'te aracın bulunduğu segmentten sona kalan süre
   * yeniden okunur → **geçilen segmentlerin süresi bir daha eklenmez**.
   * Eşleşme güvenilir değilse (`OFF_NETWORK`/`STALE`/`UNKNOWN`) süre üretilmez;
   * ETA modeli o zaman yedeğe düşer ve bunu dürüstçe ilan eder. */
  const _matchOk = fix.state === 'MATCHED' || fix.state === 'MATCH_UNCERTAIN';
  const remainingDurS = _matchOk
    ? remainingRouteDurationS({
      cumulativeDurations: st.cumulativeDurations,
      segmentDurations:    st.segmentDurations,
      cumulativeDistances,
      segIdx:              fix.segIdx,
      alongRemainingM:     vehicleAlong,
    })
    : null;

  useRouteStore.setState({
    currentStepIndex:         newStepIdx,
    distanceToNextTurnMeters: distToNextTurn,
    distanceToNextTurnSource: distSource,
    pendingManeuver,
    remainingRouteDurationSeconds: remainingDurS,
  });

  // ── 5) SAPMA DEĞERLENDİRMESİ ──────────────────────────────────────────────
  // Kütük #402: bu erken çıkışlar da artık ADLANDIRILIR — "sapma vardı ama
  // hiçbir şey olmadı" durumu üründe sessiz kalamaz.
  if (opts?.allowReroute === false) {                    // DR/tünel konumu
    if (_offRoute.state === 'CONFIRMED_OFF_ROUTE') recordRerouteBlocked('DR_POSITION', now);
    return;
  }
  if (!geometry || geometry.length < 2 || !_rerouteCtx) {
    if (_offRoute.state === 'CONFIRMED_OFF_ROUTE') recordRerouteBlocked('NO_CONTEXT', now);
    return;
  }

  // Reroute-loop guard: düz hat "rotasında" gerçek yol ağı yoktur; her nokta
  // teorik olarak sapmış görünür → sonsuz döngü. Sapma değerlendirilmez.
  if (st.serverUsed === 'straight-line') {
    if (_offRoute.state === 'CONFIRMED_OFF_ROUTE') recordRerouteBlocked('STRAIGHT_LINE', now);
    return;
  }

  // Startup guard: navigasyon başından itibaren ilk 3 s GPS stabilize değildir.
  if (_navContextStartMs > 0 && now - _navContextStartMs < 3_000) return;

  _offRoute = stepOffRoute(_offRoute, {
    matchState:      fix.state,
    lateralM:        fix.lateralM,
    headingDeltaDeg: fix.headingDeltaDeg,
    progressM,
    accuracyM,
    speedKmh,
    tsMs:            now,
  }, _lastCorridorM);

  if (_offRoute.state !== 'CONFIRMED_OFF_ROUTE') return;

  // ── 6) DOĞRULANMIŞ SAPMA → REROUTE ────────────────────────────────────────
  // Zayıf sinyalde rota kurmak, yanlış yere rota kurmaktır (fail-closed).
  //
  // KÜTÜK #402: bu kapı DOĞRU ama SESSİZDİ. Sahada sapma %17,5 oranında
  // doğrulandı, reroute %0 çıktı ve arada ne olduğunu söyleyen kayıt yoktu.
  // Kapı artık nedeniyle DEFTERE yazılıyor (LAB'da görünür, kütükte ölçülebilir).
  // Ayrıca `offRouteModel` aynı eşiği paylaştığı için bu dalın normal koşuda
  // tetiklenmemesi beklenir — tetikleniyorsa iki katman ayrışmış demektir.
  if (accuracyM == null || accuracyM > ACTIONABLE_ACCURACY_M) {
    recordRerouteBlocked('WEAK_ACCURACY', now);
    return;
  }

  // Aynı sapma için tekrar istek bastırma (request storm koruması).
  if (now - _lastRerouteMs < _getRerouteThrottleMs(speedKmh)) {
    recordSuppressedDuplicate();
    recordRerouteBlocked('THROTTLED', now);
    return;
  }

  /* ── REROUTE BAŞLANGIÇ NOKTASI (kullanıcı şikâyeti #2'nin kökü) ────────────
   * Eskiden HAM GPS gönderiliyordu. Sapma anında ham nokta çoğu kez paralel
   * yolun/servis yolunun üstüne düşer; OSRM oraya yapışır ve "saçma rota"
   * üretir. Artık:
   *   • Araç hâlâ rotadaysa (MATCHED) → rota üzerine OTURTULMUŞ konum,
   *   • Gerçekten rotadan çıkmışsa (OFF_NETWORK) → ham konum, ÇÜNKÜ eski
   *     rotaya oturtmak aracı BULUNMADIĞI yere koymak olurdu.
   * Her iki durumda da konum ARTIK ÇOKLU KANIT'la doğrulanmıştır (tek gürültü
   * örneği buraya kadar gelemez) ve istek aracın YÖNÜYLE birlikte gider. */
  const originLat = (fix.state === 'MATCHED' && fix.snappedLat != null) ? fix.snappedLat : lat;
  const originLon = (fix.state === 'MATCHED' && fix.snappedLon != null) ? fix.snappedLon : lon;

  _lastRerouteMs = now;
  markOffRouteDetected(_offRoute.confirmedAtMs ?? now);
  _offRoute = markRerouting(_offRoute);
  void _triggerReroute(originLat, originLon, _rerouteCtx.toLat, _rerouteCtx.toLon);
}

/**
 * Yeniden rotalama — isRerouting callback'leriyle sarılmış fetchRoute.
 *
 * Uçuşta bir istek varsa YENİSİ yine de başlatılır: `beginRouteRequest`
 * eskisini SUPERSEDED işaretler ve eski yanıt uygulanamaz. Eskiden burada
 * sessizce `return` ediliyordu — throttle penceresi ZATEN yazılmış olduğu için
 * sapma bir tam pencere daha görmezden geliniyordu (gecikmenin ikinci kalemi).
 */
async function _triggerReroute(
  fromLat: number, fromLon: number,
  toLat:   number, toLon:   number,
): Promise<void> {
  _isFetchingRoute = true;
  _reroutingCb?.(true);
  try {
    await fetchRoute(fromLat, fromLon, toLat, toLon, 'REROUTE');
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
    roundaboutExit:   null,
    lanes:            null,   // sentinel adımda GERÇEK şerit verisi YOKTUR
    geometryPointCount: 0,
  };
}

/**
 * Steps dizisi boşsa (offline/daemon modlar) hedef koordinatlarından sentinel adım enjekte eder.
 * activateNavigation() tarafından çağrılır — HUD'un undefined currentStep ile gizlenmesini önler.
 */
export function injectSentinelStepIfEmpty(toLat: number, toLon: number): void {
  const state = useRouteStore.getState();
  if (state.steps.length > 0) return;
  const steps = [_makeSentinelStep(toLon, toLat, state.totalDistanceMeters, state.totalDurationSeconds)];
  useRouteStore.setState({
    steps,
    maneuverAnchors: _anchorsFor(state.geometry, state.cumulativeDistances, steps),
  });
}

/** Rota state'ini başlangıca döndür.
 *  INITIAL.cumulativeDistances === null → Float64Array GC'ye serbest bırakılır (Zero-Leak). */
export function clearRoute(): void {
  useRouteStore.setState(INITIAL);
  _allRoutes = [];
  _lastFix   = null;
  _offRoute  = initialOffRoute();
  _fireNavStyle(false); // navigasyon tamamlandı — focus mode kapat
}

/** Snapshot (non-hook) — test ve non-React context için. */
export function getRouteState(): RouteState {
  return useRouteStore.getState();
}

/* ── TRIP wiring köprüsü (MAVI4-TRIP-5B) ─────────────────────────────────────
 * TRIP preview/apply motorlarını mevcut routing altyapısına bağlamak için İKİ dar,
 * YAN ETKİSİZ export. Yeni routing algoritması YOK — mevcut _tryServer / offline
 * katman / store şekli yeniden kullanılır. Bu iki fonksiyon dışında routingService
 * davranışı DEĞİŞMEZ.
 */

/** Yan etkisiz tek-bacak rota sonucu — OSRM/offline ile aynı [lon,lat] format. */
export interface RouteLegResult {
  geometry:  [number, number][];
  distanceM: number;
  durationS: number;
}

/**
 * Yan etkisiz TEK bacak rota getir — store/TTS/navStyle/EventBus'a DOKUNMAZ.
 *
 * Mevcut katmanlar yeniden kullanılır (yeni algoritma YOK): native daemon (native) →
 * uzak OSRM (_tryServer) → offline A* worker (computeOfflineRoute). Hepsi düşerse
 * `null` (fail-soft). Straight-line fallback BİLİNÇLİ olarak YOK: o bir navigasyon
 * son-çaresidir, güvenilir preview kaynağı değil. Sağlayıcı/hata detayı yüzeye SIZMAZ.
 *
 * fetchRoute'un aksine hiçbir Zustand yazısı / _fireNavStyle / speakNavigation yapmaz;
 * bu yüzden TRIP-4 preview'in enjekte LegRouter'ı için güvenlidir.
 */
export async function fetchRouteLeg(
  fromLat: number, fromLon: number,
  toLat:   number, toLon:   number,
): Promise<RouteLegResult | null> {
  // Coğrafi geçerlilik — geçersiz koordinatta ağa hiç çıkma.
  if (!Number.isFinite(fromLat) || Math.abs(fromLat) > 90)  return null;
  if (!Number.isFinite(fromLon) || Math.abs(fromLon) > 180) return null;
  if (!Number.isFinite(toLat)   || Math.abs(toLat)   > 90)  return null;
  if (!Number.isFinite(toLon)   || Math.abs(toLon)   > 180) return null;

  // Katman 0: Native OSRM daemon (yalnız native; yan etkisiz).
  if (isNative) {
    try {
      const d = await tryLocalDaemon(fromLon, fromLat, toLon, toLat);
      if (d && Array.isArray(d.geometry) && d.geometry.length >= 2) {
        return { geometry: d.geometry, distanceM: d.distanceM, durationS: d.durationS };
      }
    } catch { /* fail-soft: sonraki katman */ }
  }

  // Katman 1-2: Uzak OSRM — yalnız çevrimiçiyse; her sunucu fail-soft, store yazMAZ.
  if (typeof navigator === 'undefined' || navigator.onLine) {
    for (const server of getRoutingServers()) {
      try {
        const r = await _tryServer(server, fromLon, fromLat, toLon, toLat, _currentHeadingDeg());
        if (r.geometry && r.geometry.length >= 2) {
          return { geometry: r.geometry, distanceM: r.distance, durationS: r.duration };
        }
      } catch { /* fail-soft: sonraki sunucu / offline katman */ }
    }
  }

  // Katman 3: Offline A* worker — store yazMAZ, ana thread bloklamaz.
  try {
    const off = await computeOfflineRoute(fromLat, fromLon, toLat, toLon);
    if (off && Array.isArray(off.geometry) && off.geometry.length >= 2) {
      return { geometry: off.geometry, distanceM: off.distanceM, durationS: off.durationS };
    }
  } catch { /* fail-soft */ }

  return null;
}

/** writeActiveRoute girdisi — RouteStoreAdapter tarafından kurulur. */
export interface ActiveRouteWrite {
  geometry:    [number, number][];
  distanceM:   number;
  durationS:   number;
  /** Orijinal adımlar (resume/rollback için taşınır); yoksa hedef sentinel adımı üretilir. */
  steps?:      RouteStep[];
  serverUsed?: string | null;
  hasToll?:    boolean;
}

/**
 * Aktif rotayı DOĞRUDAN store'a yazar — TRIP apply/resume/rollback köprüsü (MAVI4-TRIP-5B).
 *
 * YALNIZ RouteStoreAdapter üzerinden, kullanıcı AÇIK onayıyla çağrılır. cumulativeDistances
 * geometriden yeniden türetilir; adım verilmezse hedef sentinel adımı enjekte edilir (offline
 * davranışıyla aynı). Alternatif rotalar temizlenir ve `_allRoutes` tek aktif rotaya
 * senkronlanır → apply sonrası selectAltRoute bayat bir rotaya dönemez.
 *
 * fetchRoute'tan FARKI: TTS/navStyle/EventBus TETİKLEMEZ. Navigasyon-stil (focus mode)
 * kararı bu apply köprüsünün işi değildir — o karar mevcut hattında (fetchRoute/clearRoute)
 * kalır; bu köprü yalnız store şeklini yazar.
 */
export function writeActiveRoute(input: ActiveRouteWrite): void {
  if (!input || !Array.isArray(input.geometry) || input.geometry.length < 2) return;
  const geometry = input.geometry;
  const last = geometry[geometry.length - 1];
  const steps = (input.steps && input.steps.length > 0)
    ? input.steps
    : [_makeSentinelStep(last[0], last[1], input.distanceM, input.durationS)];
  const hasToll = input.hasToll ?? false;
  const _cum = buildCumulativeDistances(geometry);
  // Rota değişti → eşleştirme geçmişi geçersiz (bkz. _commitRoute gerekçesi).
  _lastFix  = null;
  _offRoute = markRouteCommitted();

  useRouteStore.setState({
    loading:              false,
    error:                null,
    geometry,
    cumulativeDistances:  _cum,
    maneuverAnchors:      _anchorsFor(geometry, _cum, steps),
    distanceToNextTurnSource: 'UNKNOWN',
    validation:           null,
    alternatives:         [],
    altDistances:         [],
    altDurations:         [],
    altHasToll:           [],
    altRealIndices:       [],
    selectedAltIndex:     0,
    hasToll,
    steps,
    totalDistanceMeters:  input.distanceM,
    totalDurationSeconds: input.durationS,
    currentStepIndex:     0,
    distanceToNextTurnMeters: 0,
    pendingManeuver:      null,
    serverUsed:           input.serverUsed ?? 'trip-apply',
  });

  // Alternatif seçim durumunu senkronla — apply sonrası tek geçerli rota.
  // Trip-apply yolunda sağlayıcı süre dizisi YOKTUR → süre modeli kurulmaz.
  _allRoutes = [{ geometry, distanceM: input.distanceM, durationS: input.durationS, steps, hasToll,
    annotationDurations: null }];
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
 * Tahmini yakıt tüketimi (Litre) — ÖLÇÜM DEĞİL, TAHMİN.
 *
 * E-05: burada 7.5, `tripLogService`'te 8.5 yazıyordu → aynı mesafe için rota
 * HUD'ı ile yolculuk özeti FARKLI litre gösteriyordu. Varsayım artık tek
 * otoriteden (`vehicleAssumptions`) gelir; beyan edilmiş değer 8.5'tir.
 */
export function computeFuelEstimate(distanceM: number): number {
  return Math.round((distanceM / 1_000 / 100) * DEFAULT_FUEL_L_PER_100KM * 10) / 10;
}
