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
import type { RouteStep }    from './routingService';

/* ── Tipler ──────────────────────────────────────────────────── */

export interface OfflineRouteResult {
  geometry:  [number, number][];  // [lon, lat][] — OSRM ile aynı format
  distanceM: number;
  durationS: number;              // tahmini (30 km/h ortalama)
  steps:     RouteStep[];
  source:    'offline-worker' | 'offline-daemon' | 'straight-line';
}

/* ── OSRM maneuver → Türkçe (daemon için yerel kopya) ─────────── */

function _toTR(type: string, mod: string, name: string): string {
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
const LOCAL_DAEMON_TIMEOUT_MS = 3_000; // native daemon genellikle <100ms yanıt verir

export async function tryLocalDaemon(
  fromLon: number, fromLat: number,
  toLon:   number, toLat:   number,
): Promise<OfflineRouteResult | null> {
  if (!Capacitor.isNativePlatform()) return null;
  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), LOCAL_DAEMON_TIMEOUT_MS);
  try {
    const url = `${LOCAL_DAEMON_URL}/${fromLon},${fromLat};${toLon},${toLat}?steps=true&geometries=geojson&overview=full`;
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) return null;

    interface _DaemonOsrmStep {
      distance: number;
      duration: number;
      name: string;
      maneuver: { type: string; modifier?: string };
      geometry: { coordinates: [number, number][] };
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
    const steps: RouteStep[] = (r.legs?.[0]?.steps ?? []).map(st => ({
      instruction:      _toTR(st.maneuver.type, st.maneuver.modifier ?? 'straight', st.name ?? ''),
      streetName:       st.name ?? '',
      distance:         st.distance,
      duration:         st.duration,
      maneuverType:     st.maneuver.type,
      maneuverModifier: st.maneuver.modifier ?? 'straight',
      coordinate:       st.geometry.coordinates[0] as [number, number],
    }));

    return {
      geometry:  r.geometry.coordinates as [number, number][],
      distanceM: r.distance,
      durationS: r.duration,
      steps,
      source:    'offline-daemon',
    };
  } catch {
    clearTimeout(timer);
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

function _getOrCreateNavWorker(): Worker | null {
  if (_navWorker) return _navWorker;
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
      };

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
        req.resolve({
          geometry:  msg.geometry  ?? [],
          distanceM: msg.distanceM ?? 0,
          durationS: msg.durationS ?? 0,
          steps:     msg.steps     ?? [],
          source:    'offline-worker',
        });
      } else {
        req.resolve(null); // ROUTE_ERROR → null (fallback zinciri devam eder)
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

/* ── Straight-line fallback (son çare) ───────────────────────── */

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
    durationS: distanceM / (40 / 3.6), // 40 km/h kestirme tahmini
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
