/**
 * Traffic API Adapters — Anlık Hız Veri Sağlayıcıları
 *
 * TomTom ve HERE Traffic Flow API'lerinden segment bazlı anlık hız çeker.
 * trafficEngine._buildSegments() bu modülü senkron olarak okur;
 * arka planda debounced fetch ile cache yenilenir.
 *
 * Veri akışı (pull + background-push karma model):
 *   trafficEngine._buildSegments()
 *     → getLiveSpeedsCached(segmentIds)          ← senkron, cache okuma
 *     → stale segmentler → _queueForRefresh()    ← arka plan kuyruğu
 *   [5s sonra debounce ateşlenir]
 *     → _fetchBatch(batchedIds)                  ← API çağrısı, max 50/batch
 *     → _liveCache.set(...)                      ← 30s TTL güncelleme
 *   [sonraki _recalculate'de]
 *     → getLiveSpeedsCached() güncel hızı döner
 *
 * Kritik kurallar:
 *   - API başarısız → THROW YOK, empty Map dön, sistem çalışmaya devam eder
 *   - Live hız learning engine'e YAZILMAZ (kirletme yok)
 *   - Aynı segment 30s içinde tekrar API'ye gitmez
 *   - Provider None iken sistem historical/learned ile sessizce çalışır
 *
 * DEV modu: provider, latency, hit/miss console.debug'a loglanır.
 */

import type { TrafficLevel } from './trafficTypes';

/* ── Provider ve config tipleri ──────────────────────────────── */

export const TrafficProvider = {
  TomTom: 'tomtom',
  HERE:   'here',
  None:   'none',
} as const;

export type TrafficProvider = typeof TrafficProvider[keyof typeof TrafficProvider];

export interface AdapterConfig {
  provider:   TrafficProvider;
  /** API anahtarı — None provider'da zorunlu değil */
  apiKey?:    string;
  /** Fetch timeout (ms) — varsayılan 5 000 */
  timeoutMs?: number;
}

/* ── Dahili cache tipi ───────────────────────────────────────── */

interface LiveCacheEntry {
  speedKmh:  number;
  level:     TrafficLevel;
  fetchedMs: number;
}

/* ── API response tipleri ────────────────────────────────────── */

interface TomTomFlowResponse {
  flowSegmentData?: {
    currentSpeed:  number;
    freeFlowSpeed: number;
    confidence:    number;
  };
}

interface HEREFlowResult {
  currentFlow?: { speed: number; freeFlow: number };
}

interface HEREFlowResponse {
  results?: HEREFlowResult[];
}

/* ── Sabitler ────────────────────────────────────────────────── */

const LIVE_TTL_MS    = 30_000;   // 30s — aynı segment tekrar API'ye gitmez
const DEBOUNCE_MS    =  5_000;   // 5s  — batch biriktirme süresi
const BATCH_SIZE     =     50;   // max segment / istek
const DEFAULT_TIMEOUT = 5_000;   // ms

/* ── Hız → TrafficLevel ──────────────────────────────────────── */

/**
 * API'den gelen ham hıza göre trafik seviyesi türetir.
 * Eşikler trafficTypes.refSpeedKmh() ile uyumlu.
 */
export function levelFromLiveSpeed(speedKmh: number): TrafficLevel {
  if (speedKmh >= 70) return 'free';
  if (speedKmh >= 30) return 'moderate';
  if (speedKmh >= 10) return 'heavy';
  return 'standstill';
}

/* ── Segment ID parser ───────────────────────────────────────── */

/**
 * makeSegmentId() formatı: "lat1,lng1_lat2,lng2"
 * Segment orta noktasını API çağrısı için çıkarır.
 */
function _parseSegmentMidpoint(
  id: string,
): { midLat: number; midLng: number } | null {
  const parts = id.split('_');
  if (parts.length !== 2) return null;

  const [a, b] = parts as [string, string];
  const [sLat, sLng] = a.split(',').map(Number);
  const [eLat, eLng] = b.split(',').map(Number);

  if (
    !Number.isFinite(sLat) || !Number.isFinite(sLng) ||
    !Number.isFinite(eLat) || !Number.isFinite(eLng)
  ) return null;

  return { midLat: (sLat + eLat) / 2, midLng: (sLng + eLng) / 2 };
}

/* ── Module state ────────────────────────────────────────────── */

let _config: AdapterConfig = { provider: TrafficProvider.None };
let _running                = false;

/** Segment başına 30s TTL live cache */
const _liveCache = new Map<string, LiveCacheEntry>();

/** Arka plan refresh kuyruğu — debounce öncesi birikim */
const _pendingIds = new Set<string>();

/** Debounce timer handle */
let _debounceTimer: ReturnType<typeof setTimeout> | null = null;

/* ── DEV stats ───────────────────────────────────────────────── */

const _stats = {
  hits:          0,
  misses:        0,
  fetchErrors:   0,
  totalFetches:  0,
  totalLatencyMs: 0,
};

/* ── Public config API ───────────────────────────────────────── */

/**
 * Adapter'ı yapılandır.
 * startTrafficEngine()'den önce veya sonra çağrılabilir.
 * Provider değiştiğinde cache temizlenir.
 */
export function configureTrafficAdapter(config: AdapterConfig): void {
  if (_config.provider !== config.provider) {
    _liveCache.clear();
  }
  _config = { timeoutMs: DEFAULT_TIMEOUT, ...config };

  if (import.meta.env.DEV) {
    console.debug(`[TrafficAdapter] configured: provider=${config.provider}`);
  }
}

/* ── Cache okuma (senkron) ───────────────────────────────────── */

/**
 * Segment ID listesi için cache'den anlık hızları döner.
 * Cache'de olmayan veya süresi dolmuş segmentler arka plan refresh
 * kuyruğuna eklenir — bu çağrı asla beklemez.
 *
 * @returns Map<segmentId, speedKmh> — yalnızca taze (< 30s) girişler
 */
export function getLiveSpeedsCached(segmentIds: string[]): Map<string, number> {
  const result  = new Map<string, number>();
  const nowMs   = Date.now();
  const staleIds: string[] = [];

  for (const id of segmentIds) {
    const entry = _liveCache.get(id);
    if (entry && nowMs - entry.fetchedMs < LIVE_TTL_MS) {
      result.set(id, entry.speedKmh);
      if (import.meta.env.DEV) _stats.hits++;
    } else {
      staleIds.push(id);
      if (import.meta.env.DEV) _stats.misses++;
    }
  }

  if (staleIds.length > 0 && _config.provider !== TrafficProvider.None) {
    _queueForRefresh(staleIds);
  }

  return result;
}

/**
 * Tek segment için cache kontrolü — NavigationHUD spot check için.
 */
export function getLiveEntry(segmentId: string): LiveCacheEntry | null {
  const entry = _liveCache.get(segmentId);
  if (!entry) return null;
  if (Date.now() - entry.fetchedMs >= LIVE_TTL_MS) return null;
  return entry;
}

/* ── Refresh kuyruğu + debounce ──────────────────────────────── */

function _queueForRefresh(ids: string[]): void {
  if (!_running) return;

  let added = false;
  for (const id of ids) {
    if (!_pendingIds.has(id)) {
      _pendingIds.add(id);
      added = true;
    }
  }
  if (!added) return;

  // Debounce: timer varsa sıfırla, yeniden başlat
  if (_debounceTimer !== null) clearTimeout(_debounceTimer);
  _debounceTimer = setTimeout(_fireBatch, DEBOUNCE_MS);
}

async function _fireBatch(): Promise<void> {
  _debounceTimer = null;
  if (!_running || _pendingIds.size === 0) return;

  // Kuyruğu al ve temizle
  const ids = [..._pendingIds].slice(0, BATCH_SIZE);
  ids.forEach((id) => _pendingIds.delete(id));

  await _fetchBatch(ids);

  // Kuyrukta hâlâ segment varsa tekrar debounce
  if (_pendingIds.size > 0) {
    _debounceTimer = setTimeout(_fireBatch, DEBOUNCE_MS);
  }
}

/* ── Batch fetch dispatcher ──────────────────────────────────── */

async function _fetchBatch(ids: string[]): Promise<void> {
  if (ids.length === 0) return;

  const t0 = Date.now();

  let results: Map<string, number>;

  switch (_config.provider) {
    case TrafficProvider.TomTom:
      results = await _fetchTomTom(ids);
      break;
    case TrafficProvider.HERE:
      results = await _fetchHERE(ids);
      break;
    default:
      return; // None provider — fetch yok
  }

  const latency = Date.now() - t0;

  if (import.meta.env.DEV) {
    _stats.totalFetches++;
    _stats.totalLatencyMs += latency;
    console.debug(
      `[TrafficAdapter] fetch done provider=${_config.provider} ` +
      `segments=${ids.length} hits=${results.size} latency=${latency}ms`,
    );
  }

  // Cache'e yaz
  const nowMs = Date.now();
  for (const [id, speedKmh] of results) {
    _liveCache.set(id, {
      speedKmh,
      level:     levelFromLiveSpeed(speedKmh),
      fetchedMs: nowMs,
    });
  }
}

/* ── TomTom Flow Segment Data adapter ───────────────────────── */

/**
 * TomTom Traffic Flow Segment Data API v4
 * Endpoint: GET /traffic/services/4/flowSegmentData/absolute/10/json
 *   ?point={lat},{lng}&key={apiKey}
 *
 * Paralel istek — her segment için ayrı çağrı (TomTom point-based API).
 * Promise.allSettled ile bireysel hata izolasyonu sağlanır.
 */
async function _fetchTomTom(ids: string[]): Promise<Map<string, number>> {
  if (!_config.apiKey) return new Map();

  const controller = new AbortController();
  const timeoutId  = setTimeout(
    () => controller.abort(),
    _config.timeoutMs ?? DEFAULT_TIMEOUT,
  );

  const results = new Map<string, number>();

  try {
    const tasks = ids.map(async (id) => {
      const mid = _parseSegmentMidpoint(id);
      if (!mid) return;

      const url =
        `https://api.tomtom.com/traffic/services/4/flowSegmentData` +
        `/absolute/10/json` +
        `?point=${mid.midLat},${mid.midLng}` +
        `&key=${_config.apiKey}`;

      try {
        const res = await fetch(url, { signal: controller.signal });
        if (!res.ok) return;

        const data = (await res.json()) as TomTomFlowResponse;
        const speed = data.flowSegmentData?.currentSpeed;

        if (typeof speed === 'number' && speed > 0 && speed <= 300) {
          results.set(id, speed);
        }
      } catch {
        if (import.meta.env.DEV) _stats.fetchErrors++;
        // Bireysel hata — sessizce devam
      }
    });

    await Promise.allSettled(tasks);
  } finally {
    clearTimeout(timeoutId);
  }

  return results;
}

/* ── HERE Traffic Flow v7 adapter ────────────────────────────── */

/**
 * HERE Traffic Flow API v7
 * Endpoint: GET /v7/flow
 *   ?locationReferencing=shape&in=circle:{lat},{lng};r=150&apiKey={key}
 *
 * Her segment için 150m radius ile point-based sorgu.
 * İlk result'ın speed değeri kullanılır.
 */
async function _fetchHERE(ids: string[]): Promise<Map<string, number>> {
  if (!_config.apiKey) return new Map();

  const controller = new AbortController();
  const timeoutId  = setTimeout(
    () => controller.abort(),
    _config.timeoutMs ?? DEFAULT_TIMEOUT,
  );

  const results = new Map<string, number>();

  try {
    const tasks = ids.map(async (id) => {
      const mid = _parseSegmentMidpoint(id);
      if (!mid) return;

      const url =
        `https://data.traffic.hereapi.com/v7/flow` +
        `?locationReferencing=shape` +
        `&in=circle:${mid.midLat},${mid.midLng};r=150` +
        `&apiKey=${_config.apiKey}`;

      try {
        const res = await fetch(url, { signal: controller.signal });
        if (!res.ok) return;

        const data = (await res.json()) as HEREFlowResponse;
        const speed = data.results?.[0]?.currentFlow?.speed;

        if (typeof speed === 'number' && speed > 0 && speed <= 300) {
          results.set(id, speed);
        }
      } catch {
        if (import.meta.env.DEV) _stats.fetchErrors++;
      }
    });

    await Promise.allSettled(tasks);
  } finally {
    clearTimeout(timeoutId);
  }

  return results;
}

/* ── Lifecycle ───────────────────────────────────────────────── */

/**
 * Adapter başlat — idempotent.
 * Env'den otomatik config okur (VITE_TOMTOM_API_KEY veya VITE_HERE_API_KEY).
 * configureTrafficAdapter() daha önce çağrıldıysa config korunur.
 */
export function startApiAdapter(): void {
  if (_running) return;
  _running = true;

  // Env otomatik config — explicit configureTrafficAdapter() bunun üzerine yazar
  if (_config.provider === TrafficProvider.None) {
    const tomtomKey = import.meta.env.VITE_TOMTOM_API_KEY as string | undefined;
    const hereKey   = import.meta.env.VITE_HERE_API_KEY   as string | undefined;

    if (tomtomKey) {
      _config = { provider: TrafficProvider.TomTom, apiKey: tomtomKey };
    } else if (hereKey) {
      _config = { provider: TrafficProvider.HERE, apiKey: hereKey };
    }
    // Hâlâ None → API anahtarı yok, offline fallback
  }

  if (import.meta.env.DEV) {
    console.debug(
      `[TrafficAdapter] started provider=${_config.provider} ` +
      `keyPresent=${Boolean(_config.apiKey)}`,
    );
  }
}

/**
 * Adapter durdur — pending fetch'ler iptal edilir, cache korunur.
 */
export function stopApiAdapter(): void {
  _running = false;

  if (_debounceTimer !== null) {
    clearTimeout(_debounceTimer);
    _debounceTimer = null;
  }
  _pendingIds.clear();
}

/**
 * Cache tamamen temizle — provider değişimi veya logout senaryosu için.
 */
export function clearLiveCache(): void {
  _liveCache.clear();
}

/* ── DEV diagnostics ─────────────────────────────────────────── */

export function getAdapterStats(): {
  provider:       string;
  cacheHits:      number;
  cacheMisses:    number;
  fetchErrors:    number;
  totalFetches:   number;
  avgLatencyMs:   number;
  pendingCount:   number;
  cachedSegments: number;
} {
  return {
    provider:       _config.provider,
    cacheHits:      _stats.hits,
    cacheMisses:    _stats.misses,
    fetchErrors:    _stats.fetchErrors,
    totalFetches:   _stats.totalFetches,
    avgLatencyMs:   _stats.totalFetches > 0
      ? Math.round(_stats.totalLatencyMs / _stats.totalFetches)
      : 0,
    pendingCount:   _pendingIds.size,
    cachedSegments: _liveCache.size,
  };
}

/* ── HMR cleanup ─────────────────────────────────────────────── */

if (import.meta.hot) {
  import.meta.hot.dispose(() => stopApiAdapter());
}
