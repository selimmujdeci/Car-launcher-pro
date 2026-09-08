/**
 * Offline Routing Service — WebWorker tabanlı A* yönlendirme motoru.
 *
 * Mimari (3 katman, öncelik sırasıyla):
 *   1. localhost:5000    — Android native OSRM daemon (CarLauncherPlugin.startOsrmDaemon)
 *   2. Uzak OSRM        — routing.openstreetmap.de (mevcut routingService)
 *   3. Bu servis        — WebWorker A* (ağ olmadan son çare)
 *
 * Offline routing için gereken veri:
 *   /maps/routing-graph.bin — Sıkıştırılmış yol ağı (aşağıdaki GraphExporter ile üretilir)
 *
 * Neden WebWorker:
 *   A* 50k düğümlü Türkiye şehir grafiği için ~80-300ms.
 *   Head unit Main Thread'ini bloke eder → Worker zorunlu.
 *
 * Routing graph formatı (routing-graph.bin):
 *   [4 byte: nodeCount]
 *   [nodeCount × 16 byte: lat(f32), lon(f32), -, -]
 *   [4 byte: edgeCount]
 *   [edgeCount × 12 byte: from(u32), to(u32), costM(u32)]
 *
 * Graph üretimi (Node.js script, ayrı tool):
 *   osmium extract -b bbox turkey.osm.pbf | osm-graph-exporter > routing-graph.bin
 */

import { Capacitor }        from '@capacitor/core';
import { logError }          from './crashLogger';
import { runtimeManager }    from '../core/runtime/AdaptiveRuntimeManager';
import { systemBoot }        from './system/SystemBoot';
import { supportsModuleWorker } from './deviceCapabilities';
import {
  recordOfflineGraphOutcome, shouldAttemptOfflineRoute,
} from './navigation/offlineRoutingStatus';
/* NAV v3 · F2.0 — navigasyon tazeliği MONOTONİK saatten (duvar saati değil). */
import { readMonotonicNow } from './navigation/time/navClock';
import {
  shouldProbeLocalDaemon, recordLocalDaemonProbe,
  getProviderReadinessSnapshot, LOCAL_PROBE_TIMEOUT_MS,
} from './navigation/core/routeProviderReadiness';
import type { RouteStep }    from './routingService';
import {
  acquireRegionalRoutingGraph, acquireRegionWindow, releaseRegionWindow,
  releaseRoutingGraph, REGIONAL_GRAPH_MAX_RESIDENT,
} from './navigation/map/graph/graphResidencyRuntime';
import {
  planCrossRegionSearchEnvelope, selectRegionalRouteCorridor, validateTurkeyGraphManifest,
} from './navigation/map/graph/turkeyGraphManifest';

/* ── Tipler ──────────────────────────────────────────────────── */

export interface OfflineRouteResult {
  geometry:  [number, number][];  // [lon, lat][] — OSRM ile aynı format
  distanceM: number;
  durationS: number;              // tahmini ETA (sabit ortalama hız — yol-tipi verisi yok, #14)
  steps:     RouteStep[];
  source:    'offline-worker' | 'offline-daemon' | 'straight-line';
}

/* ── OSRM maneuver → Türkçe (daemon için yerel kopya) ─────────── */

const _EXIT_ORDINAL: Readonly<Record<number, string>> = {
  1: 'birinci', 2: 'ikinci', 3: 'üçüncü', 4: 'dördüncü',
  5: 'beşinci', 6: 'altıncı', 7: 'yedinci', 8: 'sekizinci',
};

function _toTR(type: string, mod: string, name: string, exit?: number | null): string {
  const s = name ? ` (${name})` : '';
  if (type === 'depart')                            return `Yola çıkın${s}`;
  if (type === 'arrive')                            return 'Hedefinize ulaştınız';
  if (type === 'roundabout' || type === 'rotary') {
    // Çıkış numarası KANITLIYSA söylenir; yoksa UYDURULMAZ.
    const ord = exit != null && Number.isFinite(exit) ? _EXIT_ORDINAL[exit] : undefined;
    return ord ? `Dönel kavşakta ${ord} çıkıştan ayrılın${s}` : 'Dönel kavşakta devam edin';
  }
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

/* ── Local daemon (native OSRM) ──────────────────────────────── */

/**
 * CarLauncherPlugin.startOsrmDaemon() çağrısından sonra
 * http://localhost:5000 adresinde OSRM HTTP API açılır.
 *
 * Native tarafta yapılacaklar:
 *   - Android Service olarak çalıştır (foreground service)
 *   - /data/data/com.cockpitos.pro/files/osrm/ dizininden .osrm binary oku
 *   - NanoHTTPD ile 5000 portunda OSRM HTTP API sun
 *
 * Bu fonksiyon, daemon ayakta ise rota döner; değilse null döner.
 */
const LOCAL_DAEMON_URL        = 'http://localhost:5000/route/v1/driving';
/**
 * ── ÖLÜ KATMAN KAPATILDI (denetim §4.2, cihazda ölçüldü) ────────────────────
 * Eski değer 3 000 ms idi ve bu istek **her rotada** atılıyordu. Android'de
 * böyle bir daemon YOK; yani en kritik anda — sapma sonrası reroute'ta —
 * saf bekleme süresiydi. Artık iki koruma var:
 *   1. Yoklama oturumda BİR KEZ yapılır (`shouldProbeLocalDaemon`).
 *      Sonuç olumsuzsa bir daha DENENMEZ (daemon oturum içinde belirmez).
 *   2. O tek yoklama da `LOCAL_PROBE_TIMEOUT_MS` (700 ms) ile SINIRLIDIR.
 * Bu bir gizleme değildir: durum CAROS LAB · Navigation Core'da adıyla görünür.
 */
export async function tryLocalDaemon(
  fromLon: number, fromLat: number,
  toLon:   number, toLat:   number,
): Promise<OfflineRouteResult | null> {
  if (!Capacitor.isNativePlatform()) return null;

  // Hazırlığı bilinmiyorsa TEK sınırlı yoklama; bilinip yoksa hiç deneme.
  const readiness = getProviderReadinessSnapshot().localState;
  if (readiness === 'LOCAL_OSRM_UNAVAILABLE') return null;
  const probing = readiness === 'UNKNOWN' && shouldProbeLocalDaemon();
  if (readiness === 'UNKNOWN' && !probing) return null;

  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), LOCAL_PROBE_TIMEOUT_MS);
  try {
    const url = `${LOCAL_DAEMON_URL}/${fromLon},${fromLat};${toLon},${toLat}?steps=true&geometries=geojson&overview=full`;
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(timer);
    // Sunucu KONUŞTU → daemon gerçekten var. HTTP kodu ne olursa olsun
    // hazırlık ölçülmüş sayılır (ölçüm "cevap verdi mi", "bu rotayı buldu mu" değil).
    if (probing) recordLocalDaemonProbe(true, Date.now());
    if (!res.ok) return null;

    interface _DaemonOsrmStep {
      distance: number;
      duration: number;
      name: string;
      maneuver: { type: string; modifier?: string; exit?: number };
      geometry: { coordinates: [number, number][] };
      intersections?: Array<{ lanes?: Array<{ valid?: boolean; active?: boolean; indications?: string[] }> }>;
    }
    const data = await res.json() as {
      code: string;
      routes?: Array<{
        distance: number;
        duration: number;
        geometry: { coordinates: [number, number][] };
        legs: Array<{ steps: _DaemonOsrmStep[] }>;
      }>;
    };
    if (data.code !== 'Ok' || !data.routes?.length) return null;

    const r = data.routes[0];
    const steps: RouteStep[] = (r.legs?.[0]?.steps ?? []).map(st => {
      const exit = typeof st.maneuver.exit === 'number' ? st.maneuver.exit : null;
      // GERÇEK şerit verisi — yoksa null. Manevra tipinden ok TÜRETİLMEZ.
      let lanes: RouteStep['lanes'] = null;
      const ix = st.intersections;
      if (Array.isArray(ix)) {
        for (let i = ix.length - 1; i >= 0; i--) {
          const l = ix[i]?.lanes;
          if (Array.isArray(l) && l.length > 0) {
            lanes = l.map(x => ({
              valid: x.valid === true,
              active: x.active === true,
              indications: Array.isArray(x.indications) ? x.indications.slice() : [],
            }));
            break;
          }
        }
      }
      return {
        instruction:      _toTR(st.maneuver.type, st.maneuver.modifier ?? 'straight', st.name ?? '', exit),
        streetName:       st.name ?? '',
        distance:         st.distance,
        duration:         st.duration,
        maneuverType:     st.maneuver.type,
        maneuverModifier: st.maneuver.modifier ?? 'straight',
        coordinate:       st.geometry.coordinates[0] as [number, number],
        roundaboutExit:   exit,
        lanes,
        geometryPointCount: st.geometry.coordinates.length,
      };
    });

    return {
      geometry:  r.geometry.coordinates as [number, number][],
      distanceM: r.distance,
      durationS: r.duration,
      steps,
      source:    'offline-daemon',
    };
  } catch {
    clearTimeout(timer);
    // Bağlantı reddi / timeout → daemon YOK. Bir daha denenmez.
    if (probing) recordLocalDaemonProbe(false, Date.now());
    return null;
  }
}


/* ── Haversine (graph-internal) ──────────────────────────────── */

function havM(lat1: number, lon1: number, lat2: number, lon2: number): number {
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


/* ── NavigationCompute Worker (A* off-main-thread) ───────────────────────── */

let _navWorker:   Worker | null = null;
let _reqCounter   = 0;

/** Bekleyen istek listesi: requestId → {resolve, reject, timer} */
const _pending = new Map<string, {
  resolve: (r: OfflineRouteResult | null) => void;
  reject:  (e: Error) => void;
  timer:   ReturnType<typeof setTimeout>;
}>();

const NAV_WORKER_TIMEOUT_MS = 8_000;

/* ── POI Arama worker dispatch ───────────────────────────────────────────── */

export interface POIWorkerResult {
  id:       string;
  name:     string;
  address:  string;
  lat:      number;
  lon:      number;
  score:    number;
  category: string;
}

const _searchPending = new Map<string, {
  resolve: (r: { count: number; results?: POIWorkerResult[]; dbError?: boolean }) => void;
  timer:   ReturnType<typeof setTimeout>;
}>();
let _searchReqCounter  = 0;
const SEARCH_TIMEOUT_MS = 3_000;
/** Aktif uzun-rota oturumları — pencere talebini karşılayan tek yer. */
const _crossRegionPending = new Map<string, {
  onNeedWindow: (windowIndex: number) => Promise<void>;
}>();

const _graphInstallPending = new Map<string, {
  resolve: (installed: boolean) => void;
  timer: ReturnType<typeof setTimeout>;
}>();

function _getOrCreateNavWorker(): Worker | null {
  if (_navWorker) return _navWorker;
  // NavigationCompute sql.js (WASM + dinamik import) kullanır → classic IIFE'ye
  // çevrilemez, modül worker şart (Chrome 80+). Eski head unit WebView'ında
  // (Duster 64-79 / 8227L 52-74) worker YÜKLENMEZ → null dön, çağıran
  // computeOfflineRoute straightLineRoute fallback'ine düşer. (§HEAD_UNIT_MATRIX)
  if (!supportsModuleWorker()) {
    /* KALICI durum: WebView yetenek kazanmaz. Kaydedilir ki her rota
       isteğinde yeniden denenmesin ve LAB nedeni gösterebilsin. */
    recordOfflineGraphOutcome('WORKER_UNSUPPORTED', Date.now(), readMonotonicNow());
    return null;
  }
  try {
    const w = new Worker(
      new URL('./navigation/NavigationCompute.worker.ts', import.meta.url),
      { type: 'module', name: 'NavigationCompute' },
    );

    w.onmessage = (e: MessageEvent) => {
      const msg = e.data as {
        type: string;
        requestId?: string;
        geometry?: [number, number][];
        distanceM?: number;
        durationS?: number;
        steps?: RouteStep[];
        reason?: string;
        count?: number;
        results?: POIWorkerResult[];
        windowIndex?: number;
        requestedRegionIds?: string[];
        fromRegionIds?: string[];
        crossRegion?: Record<string, number> | null;
      };

      /* Uzun rota: worker "sıradaki pencere lazım" der; sakinlik kararı ve
         bütçe BURADA (residency authority) kalır — worker kendi indirmez. */
      if (msg.type === 'CROSS_REGION_NEED_WINDOW' && msg.requestId) {
        const session = _crossRegionPending.get(msg.requestId);
        if (session) void session.onNeedWindow(Number(msg.windowIndex ?? 0));
        return;
      }

      if ((msg.type === 'GRAPH_INSTALLED' || msg.type === 'GRAPH_INSTALL_ERROR') && msg.requestId) {
        const install = _graphInstallPending.get(msg.requestId);
        if (install) {
          clearTimeout(install.timer);
          _graphInstallPending.delete(msg.requestId);
          install.resolve(msg.type === 'GRAPH_INSTALLED');
        }
        return;
      }

      // POI arama yanıtı
      if ((msg.type === 'SEARCH_RESULT' || msg.type === 'SEARCH_ERROR') && msg.requestId) {
        const sreq = _searchPending.get(msg.requestId);
        if (sreq) {
          clearTimeout(sreq.timer);
          _searchPending.delete(msg.requestId);
          sreq.resolve({
            count:   msg.type === 'SEARCH_RESULT' ? (msg.count ?? 0) : 0,
            results: msg.results,
            dbError: msg.type === 'SEARCH_ERROR',
          });
        }
        return;
      }

      // Rota hesaplama yanıtı
      const req = msg.requestId ? _pending.get(msg.requestId) : undefined;
      if (!req) return;
      clearTimeout(req.timer);
      _pending.delete(msg.requestId!);

      if (msg.type === 'ROUTE_RESULT') {
        recordOfflineGraphOutcome('AVAILABLE', Date.now(), readMonotonicNow());
        req.resolve({
          geometry:  msg.geometry  ?? [],
          distanceM: msg.distanceM ?? 0,
          durationS: msg.durationS ?? 0,
          steps:     msg.steps     ?? [],
          source:    'offline-worker',
        });
      } else {
        /* ROUTE_ERROR nedeni SINIFLANDIRILIR: "graph yok" KALICI bir
           yetenek eksikliğidir, "rota bulunamadı" ise geçici bir sorgu
           sonucudur. İkisini aynı kefeye koymak, olmayan bir yeteneği her
           istekte yeniden denemek demekti (sessiz israf + görünmez arıza). */
        const reason = String(msg.reason ?? '');
        if (/graph/i.test(reason)) {
          recordOfflineGraphOutcome('GRAPH_MISSING', Date.now(), readMonotonicNow());
        }
        req.resolve(null); // fallback zinciri devam eder (düz hat — DÜRÜSTÇE etiketli)
      }
    };

    w.onerror = (err) => {
      logError('NavigationCompute:onerror', new Error(err.message ?? 'crash'));
      runtimeManager.reportFailure('NavigationCompute');
      for (const [id, req] of _pending.entries()) {
        clearTimeout(req.timer);
        req.resolve(null);
        _pending.delete(id);
      }
      for (const [id, install] of _graphInstallPending.entries()) {
        clearTimeout(install.timer);
        install.resolve(false);
        _graphInstallPending.delete(id);
      }
      _navWorker = null;
      runtimeManager.registerWorker('NavigationCompute', null, 'OPTIONAL'); // referansı temizle
      void systemBoot.restartService('NavigationCompute').catch(() => {});
    };

    w.onmessageerror = () => {
      logError('NavigationCompute:messageerror', new Error('Deserialize failed'));
    };

    _navWorker = w;
    runtimeManager.registerWorker('NavigationCompute', w, 'OPTIONAL');
    return w;
  } catch (e) {
    logError('NavigationCompute:create', e);
    return null;
  }
}

/**
 * Offline A* rota hesaplama — NavigationCompute Worker üzerinden.
 *
 * Ana thread bloklama sıfır; A* (~100–300ms) ve binary parse (~50ms)
 * tamamen worker thread'de çalışır.
 * Worker crash'ta Stability Guard devreye girer, null döner.
 */
export async function computeOfflineRoute(
  fromLat: number,
  fromLon: number,
  toLat:   number,
  toLon:   number,
): Promise<OfflineRouteResult | null> {
  /* KISA DEVRE: grafik kalıcı olarak yoksa/bozuksa worker'ı ayağa kaldırmak
     saf israftır (WASM + sql.js yükü) ve arızayı GÖRÜNMEZ kılar. Yetenek
     yoksa dürüstçe `null` döner; çağıran zaten düz-hat katmanına düşer ve
     kullanıcıya "düz hat navigasyon" DER — "çevrimdışı rota" DEMEZ. */
  if (!shouldAttemptOfflineRoute()) return null;

  const w = _getOrCreateNavWorker();
  if (!w) return null;

  const requestId = `r${++_reqCounter}`;

  return new Promise<OfflineRouteResult | null>((resolve, reject) => {
    const timer = setTimeout(() => {
      _pending.delete(requestId);
      logError('NavigationCompute:timeout', new Error(`Request ${requestId} timed out`));
      resolve(null);
    }, NAV_WORKER_TIMEOUT_MS);

    _pending.set(requestId, { resolve, reject, timer });
    w.postMessage({ type: 'COMPUTE_ROUTE', requestId, fromLat, fromLon, toLat, toLon });
  });
}

/**
 * Shadow regional RTG3 yolu: manifest/residency görünümünü mevcut tek
 * NavigationCompute worker'ına kurar ve aynı `computeOfflineRoute` authority'sini çalıştırır.
 */
export async function computeRegionalOfflineRoute(
  manifestValue: unknown,
  fromLat: number, fromLon: number,
  toLat: number, toLon: number,
  baseUrl = '/maps/rtg3/',
): Promise<OfflineRouteResult | null> {
  const manifest = validateTurkeyGraphManifest(manifestValue);
  if (!manifest) return null;
  const corridor = selectRegionalRouteCorridor(manifest, [fromLat,fromLon], [toLat,toLon]);
  if (!corridor) return null;
  const view = await acquireRegionalRoutingGraph(manifest, corridor.requiredRegionIds, baseUrl);
  if (!view) { releaseRoutingGraph(); return null; }
  const worker = _getOrCreateNavWorker();
  if (!worker) { releaseRoutingGraph(); return null; }
  const requestId = `g${++_reqCounter}`;
  const installed = await new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => { _graphInstallPending.delete(requestId); resolve(false); }, NAV_WORKER_TIMEOUT_MS);
    _graphInstallPending.set(requestId, { resolve, timer });
    worker.postMessage({ type:'INSTALL_REGIONAL_GRAPH', requestId, graphView:view });
  });
  if (!installed) { releaseRoutingGraph(); return null; }
  try {
    return await computeOfflineRoute(fromLat,fromLon,toLat,toLon);
  } finally {
    worker.postMessage({ type:'CLEAR_REGIONAL_GRAPH' });
    releaseRoutingGraph();
  }
}

/**
 * Ülke ölçeğinde SINIRLI SAKİNLİKLE uzun rota (RTG4).
 *
 * ── NE DEĞİŞTİ ────────────────────────────────────────────────────────────
 * `computeRegionalOfflineRoute` koridoru tek seferde belleğe alır ve bu yüzden
 * yalnız `REGIONAL_GRAPH_MAX_RESIDENT` bölgeye kadar çalışır. Mersin→İstanbul
 * gibi 22 bölgelik bir koridor 77 MB'tır: 64 MiB tavanına SIĞMAZ. Çözüm tavanı
 * büyütmek değil, pencereyi kaydırmaktır.
 *
 * ── SORUMLULUK SINIRI ─────────────────────────────────────────────────────
 * Bu fonksiyon rota HESAPLAMAZ; yalnız hangi bölgenin ne zaman yerleşik
 * olacağına karar verir. Rota gerçeği tek kanonik kenar-durumlu A*'ta kalır.
 * Portal v2 koridoru yalnız pencere sırasını belirleyen budama kanıtıdır ve
 * hiçbir koşulda araç rotası olarak yayınlanmaz.
 */
export async function computeCrossRegionOfflineRoute(
  manifestValue: unknown,
  fromLat: number, fromLon: number,
  toLat: number, toLon: number,
  baseUrl = '/maps/rtg3/',
  options: { maxClosedStates?: number } = {},
): Promise<OfflineRouteResult | null> {
  const manifest = validateTurkeyGraphManifest(manifestValue);
  if (!manifest) return null;
  const envelope = planCrossRegionSearchEnvelope(
    manifest, [fromLat, fromLon], [toLat, toLon], REGIONAL_GRAPH_MAX_RESIDENT);
  if (!envelope) return null;
  const worker = _getOrCreateNavWorker();
  if (!worker) return null;

  const requestId = `x${++_reqCounter}`;
  let settled = false;

  return new Promise<OfflineRouteResult | null>((resolve) => {
    const finish = (value: OfflineRouteResult | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      _pending.delete(requestId);
      _crossRegionPending.delete(requestId);
      worker.postMessage({ type: 'CROSS_REGION_ABORT', requestId });
      releaseRegionWindow();
      resolve(value);
    };

    /* Zaman aşımı TÜM oturumu kapsar: her pencere için ayrı sayaç, sessizce
       dakikalarca süren bir arama demekti. */
    const timer = setTimeout(() => {
      logError('NavigationCompute:crossRegionTimeout', new Error(`Request ${requestId} timed out`));
      finish(null);
    }, NAV_WORKER_TIMEOUT_MS * Math.max(1, envelope.windows.length));

    _pending.set(requestId, {
      resolve: (value) => finish(value),
      reject: () => finish(null),
      timer,
    });

    _crossRegionPending.set(requestId, {
      onNeedWindow: async (windowIndex: number) => {
        if (settled) return;
        if (windowIndex < 0 || windowIndex >= envelope.windows.length) {
          /* Koridor bitti ama hedef bulunamadı → rota UYDURULMAZ. */
          finish(null);
          return;
        }
        const regionIds = envelope.windows[windowIndex];
        const residency = await acquireRegionWindow(manifest, regionIds, baseUrl);
        if (settled) return;
        if (!residency) { finish(null); return; }
        const isFinal = windowIndex === envelope.windows.length - 1;
        /* Sınır kanıtı DAR tutulur: yalnız bu pencerenin ÖNCÜ bölgesinden
           koridorun bir sonraki bölgesine geçiren, seçilmiş bileşen çiftine
           ait portal düğümleri. Pencerenin her yönündeki tüm çıkışları sınır
           saymak, aramayı ilk birkaç kilometrede ilerletip süpürmeyi salınıma
           sokuyordu (ölçüldü: koridor tamamlanamadı). */
        worker.postMessage({
          type: 'CROSS_REGION_WINDOW', requestId, windowIndex,
          graphView: residency.view, identity: residency.identity,
          exitPortals: isFinal ? [] : envelope.transitions[windowIndex].portalNodeIds.map(
            (nodeId) => ({ nodeId, regionIds: [envelope.transitions[windowIndex].toRegionId] })),
          /* Koridor alt sınırı: aramayı UZAK hedefe değil SIRADAKİ zorunlu
             sınıra yöneltir (kabul edilebilir → rota gerçeği değişmez). */
          boundaryBox: isFinal ? null : envelope.transitions[windowIndex].boundaryBox,
          remainingLowerBoundM: isFinal ? 0 : envelope.transitions[windowIndex].remainingLowerBoundM,
          isFinal,
        });
      },
    });

    worker.postMessage({
      type: 'CROSS_REGION_BEGIN', requestId,
      fromLat, fromLon, toLat, toLon,
      windowCount: envelope.windows.length,
      maxClosedStates: options.maxClosedStates,
    });
  });
}

/* ── Straight-line fallback (son çare) ───────────────────────── */

// Kuş uçuşu (straight-line) ETA: gerçek yol mesafesi bilinmediğinden mesafe düşük
// tahmin edilir; worker'ın gerçek-rota ortalamasından (30 km/h) bilinçli olarak daha
// yüksek bir ortalama bu eksikliği telafi eder. Yol-tipi verisi yok (#14).
const STRAIGHT_LINE_AVG_SPEED_MS = 40 / 3.6; // 40 km/h kestirme

export function straightLineRoute(
  fromLat: number,
  fromLon: number,
  toLat:   number,
  toLon:   number,
): OfflineRouteResult {
  const distanceM = havM(fromLat, fromLon, toLat, toLon);
  return {
    geometry:  [[fromLon, fromLat], [toLon, toLat]],
    distanceM,
    durationS: distanceM / STRAIGHT_LINE_AVG_SPEED_MS,
    steps:     [],
    source:    'straight-line',
  };
}


/**
 * SystemBoot.restartService('NavigationCompute') tarafından çağrılır.
 * Worker crash sonrası yeni worker önceden ısıtılır; sonraki rota isteği beklemez.
 */
export function restartNavWorker(): void {
  if (_navWorker) return; // zaten çalışıyorsa no-op
  _getOrCreateNavWorker(); // _navWorker null ise yeni oluşturur ve runtimeManager'a kaydeder
}

/**
 * POI FTS5 aramasını NavigationCompute Worker'a gönderir.
 * Sonuçlar SharedArrayBuffer varsa zero-copy, yoksa JSON fallback ile gelir.
 * offlineSearchService.searchPOI() bu fonksiyonu kullanır.
 */
/**
 * Worker thread'deki SQLite (poi.db) bağlantısını kapatır.
 * RAM CRITICAL baskısında offlineSearchService tarafından çağrılır.
 */
export function closeWorkerDatabase(): void {
  _navWorker?.postMessage({ type: 'CLOSE_DB' });
}

export async function dispatchPOISearch(
  query:      string,
  lat:        number | undefined,
  lon:        number | undefined,
  maxResults: number,
  sab:        SharedArrayBuffer | null,
): Promise<{ count: number; results?: POIWorkerResult[]; dbError?: boolean }> {
  const w = _getOrCreateNavWorker();
  if (!w) return { count: 0, dbError: true };

  const requestId = `s${++_searchReqCounter}`;

  return new Promise<{ count: number; results?: POIWorkerResult[]; dbError?: boolean }>((resolve) => {
    const timer = setTimeout(() => {
      _searchPending.delete(requestId);
      resolve({ count: 0 });
    }, SEARCH_TIMEOUT_MS);

    _searchPending.set(requestId, { resolve, timer });
    w.postMessage({ type: 'SEARCH_POI', requestId, query, lat, lon, maxResults, sab });
  });
}
