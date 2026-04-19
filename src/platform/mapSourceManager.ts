import { create } from 'zustand';
import maplibregl from 'maplibre-gl';
import type { StyleSpecification, LayerSpecification } from 'maplibre-gl';
import { getTileCacheStats } from './serviceWorkerManager';
import { Capacitor } from '@capacitor/core';

export type MapMode = 'road' | 'hybrid' | 'satellite';

/**
 * Tile render strategy — orthogonal to MapMode.
 *
 *   'raster' — GPU-decoded PNG tiles (OSM). Fast, stable, ideal for AR + navigation.
 *              Head unit Mali-400 handles raster textures natively at 30+ fps.
 *
 *   'vector' — PBF decoded geometry (OMT schema). Crisp at any zoom/rotation, smaller
 *              file size. CPU-heavier decode — acceptable when idle but risky mid-nav.
 *
 * Auto-switch rules (see notifyNavigationRender):
 *   isNavigating || arActive → 'raster' instantly
 *   idle 2500ms              → 'vector'  (debounced — avoids toggling on short pauses)
 *
 * Only applies to road mode. Satellite/hybrid are always raster.
 */
export type TileRenderMode = 'raster' | 'vector';

export interface MapSource {
  id: string;
  name: string;
  type: 'offline' | 'online';
  description: string;
  isAvailable: boolean;
  cacheSize?: string;
  tileCount?: number;
  lastUpdated?: number;
}

interface MapSourceState {
  sources: Map<string, MapSource>;
  activeSourceId: string | null;
  /** Which source is actually serving tiles right now */
  servingFrom: 'local' | 'online' | 'cached' | null;
  isOnline: boolean;
  isLoading: boolean;
  error: string | null;
  initialized: boolean;
  mapMode: MapMode;
  /** Active tile render strategy (auto-managed by notifyNavigationRender) */
  tileRender: TileRenderMode;
}

const useMapSourceStore = create<MapSourceState>(() => ({
  sources: new Map(),
  activeSourceId: null,
  servingFrom: null,
  isOnline: typeof navigator !== 'undefined' ? navigator.onLine : true,
  isLoading: false,
  error: null,
  initialized: false,
  mapMode: 'road',
  tileRender: 'vector',  // start in vector (idle); navigation will push to raster
}));

// ── Network detection ───────────────────────────────────────
let networkListenersAttached = false;
let _onlineHandler:  (() => void) | null = null;
let _offlineHandler: (() => void) | null = null;

/**
 * When connectivity drops and we force-downgrade from satellite/hybrid → road,
 * we store the user's original choice here so we can restore it when online returns.
 * Cleared when the user explicitly picks a new mode via setMapMode().
 */
let _forcedDowngradeFrom: MapMode | null = null;

function attachNetworkListeners(): void {
  if (networkListenersAttached || typeof window === 'undefined') return;
  networkListenersAttached = true;

  _onlineHandler = () => {
    useMapSourceStore.setState({ isOnline: true });
    // Restore the user's pre-offline mode preference (satellite or hybrid)
    if (_forcedDowngradeFrom && _forcedDowngradeFrom !== 'road') {
      useMapSourceStore.setState({ mapMode: _forcedDowngradeFrom });
      _forcedDowngradeFrom = null;
    }
  };

  _offlineHandler = () => {
    const { mapMode } = useMapSourceStore.getState();
    // Satellite/hybrid require network — fall back to road when offline
    if (mapMode === 'satellite' || mapMode === 'hybrid') {
      _forcedDowngradeFrom = mapMode; // remember user preference for restore
      useMapSourceStore.setState({ mapMode: 'road' });
    }
    useMapSourceStore.setState({ isOnline: false });
  };

  window.addEventListener('online',  _onlineHandler);
  window.addEventListener('offline', _offlineHandler);
  // App kapanırken otomatik temizle
  window.addEventListener('beforeunload', detachNetworkListeners, { once: true });
}

/**
 * Remove online/offline listeners. Call when the map module is torn down
 * (e.g. test teardown, future hot-reload scenarios).
 */
export function detachNetworkListeners(): void {
  if (!networkListenersAttached || typeof window === 'undefined') return;
  if (_onlineHandler)  window.removeEventListener('online',  _onlineHandler);
  if (_offlineHandler) window.removeEventListener('offline', _offlineHandler);
  _onlineHandler  = null;
  _offlineHandler = null;
  networkListenersAttached = false;
}

// ── Local tile probing ──────────────────────────────────────

/** localStorage key — "did we ever see local tiles on this device?" */
const OFFLINE_PREF_KEY = 'car_map_offline_available';

function readOfflinePref(): boolean {
  try {
    return localStorage.getItem(OFFLINE_PREF_KEY) === 'true';
  } catch {
    return false;
  }
}

function writeOfflinePref(value: boolean): void {
  try {
    if (value) localStorage.setItem(OFFLINE_PREF_KEY, 'true');
    else        localStorage.removeItem(OFFLINE_PREF_KEY);
  } catch {
    // localStorage unavailable — ignore
  }
}

/**
 * AbortSignal.timeout() polyfill — Chrome 103+ natively, older Android WebViews need fallback.
 */
function signalWithTimeout(ms: number): AbortSignal {
  if (typeof AbortSignal.timeout === 'function') return AbortSignal.timeout(ms);
  const ctrl = new AbortController();
  setTimeout(() => ctrl.abort(), ms);
  return ctrl.signal;
}

/** Converts lng/lat to TMS tile x/y at a given zoom level (Web Mercator). */
function lngLatToTile(lng: number, lat: number, zoom: number): { x: number; y: number } {
  const n = Math.pow(2, zoom);
  const x = Math.floor(((lng + 180) / 360) * n);
  const latRad = (lat * Math.PI) / 180;
  const y = Math.floor(
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n,
  );
  return {
    x: Math.max(0, Math.min(n - 1, x)),
    y: Math.max(0, Math.min(n - 1, y)),
  };
}

interface TileMetadata {
  minzoom?: number;
  maxzoom?: number;
  /** TileJSON 2.x bounds: [west, south, east, north] in WGS-84 */
  bounds?: [number, number, number, number];
  /** TileJSON 2.x center: [lng, lat, zoom] */
  center?: [number, number, number];
}

/**
 * Tries to read TileJSON metadata from /maps/.
 * Supports metadata.json (MBTiles export) and tiles.json (TileJSON 2.x).
 * Returns null if neither file is present or parseable.
 */
async function readLocalTileMetadata(): Promise<TileMetadata | null> {
  for (const path of ['/maps/metadata.json', '/maps/tiles.json']) {
    try {
      const resp = await fetch(path, { signal: signalWithTimeout(2000) });
      if (resp.ok) return (await resp.json()) as TileMetadata;
    } catch {
      // not found or parse error — try next
    }
  }
  return null;
}

/**
 * Build a small list of probe tile coordinates from TileJSON metadata.
 * Uses bounds center + corners, or center point, or falls back to tile 0/0/0.
 */
function buildMetadataProbes(meta: TileMetadata): Array<{ z: number; x: number; y: number }> {
  const probes: Array<{ z: number; x: number; y: number }> = [];
  const minZ = meta.minzoom ?? 4;
  const maxZ = meta.maxzoom ?? 14;

  if (meta.bounds) {
    const [west, south, east, north] = meta.bounds;
    const cLng = (west + east) / 2;
    const cLat = (south + north) / 2;
    for (const z of [minZ, Math.min(minZ + 2, maxZ), Math.min(8, maxZ)]) {
      probes.push({ z, ...lngLatToTile(cLng, cLat, z) });
    }
    // Also try SW and NE corners at minZoom
    probes.push({ z: minZ, ...lngLatToTile(west, south, minZ) });
    probes.push({ z: minZ, ...lngLatToTile(east, north, minZ) });
    return probes;
  }

  if (meta.center) {
    const [lng, lat] = meta.center;
    probes.push({ z: minZ, ...lngLatToTile(lng, lat, minZ) });
    if (minZ + 2 <= maxZ) probes.push({ z: minZ + 2, ...lngLatToTile(lng, lat, minZ + 2) });
    return probes;
  }

  // Metadata exists but no location hints — try 0/0/0 at minZoom
  probes.push({ z: minZ, x: 0, y: 0 });
  return probes;
}

/**
 * Probe /maps/ for local tile data.  Country-agnostic.
 *
 * Format desteği: .png (raster) ve .pbf (vector) — her ikisi de denenir.
 *
 * Order:
 *   1. metadata.json / tiles.json → compute exact tiles from bounds/center
 *   2. Exhaustive z=0..2 scan (21 tiles max, covers whole world)
 *   3. Sampled z=4 grid (16 samples, covers regional tile sets)
 *
 * Returns true on first HTTP 200.
 */
const TILE_EXTENSIONS = ['.png', '.pbf'];

async function probeOneTile(z: number, x: number, y: number, timeoutMs: number): Promise<boolean> {
  // Her iki format için paralel probe — hangisi önce 200 dönerse kazanır
  const probes = TILE_EXTENSIONS.map(async (ext) => {
    const r = await fetch(`/maps/${z}/${x}/${y}${ext}`, {
      method: 'HEAD',
      signal: signalWithTimeout(timeoutMs),
    });
    if (!r.ok) throw new Error('not found');
    return true;
  });
  try {
    return await Promise.any(probes);
  } catch {
    return false;
  }
}

/**
 * Yerel tile varlığını tespit eder.
 *
 * Optimizasyon: sekansiyel fetch yerine tüm probe'lar paralel çalışır.
 * Promise.any() ile ilk başarılı sonuç anında döner — kalan fetch'ler iptal edilmez
 * ama sonuçları yoksayılır (yerel istekler için düşük maliyet).
 *
 * Ortalama süre (yerel SSD / APK asset):
 *   Önce: ~300ms (21 tile × ~14ms/tile seri)
 *   Sonra: ~15ms  (paralel, ilk hit anında döner)
 */
async function probeLocalTiles(): Promise<boolean> {
  // ── Strateji 1: Metadata rehberli (hedefli, en hızlı) ─────
  const meta = await readLocalTileMetadata();
  if (meta) {
    const probes = buildMetadataProbes(meta);
    const results = await Promise.allSettled(
      probes.map(({ z, x, y }) => probeOneTile(z, x, y, 2000)),
    );
    return results.some((r) => r.status === 'fulfilled' && r.value);
  }

  // ── Strateji 2: z=0..2 tam tarama — paralel (21 tile) ─────
  const tilesZ02: Array<{ z: number; x: number; y: number }> = [];
  for (let z = 0; z <= 2; z++) {
    const n = Math.pow(2, z);
    for (let x = 0; x < n; x++) {
      for (let y = 0; y < n; y++) tilesZ02.push({ z, x, y });
    }
  }
  try {
    await Promise.any(
      tilesZ02.map(({ z, x, y }) =>
        probeOneTile(z, x, y, 1500).then((ok) => {
          if (!ok) throw new Error('miss');
          return true;
        }),
      ),
    );
    return true;
  } catch { /* tüm z=0-2 probe başarısız */ }

  // ── Strateji 3: z=4 örneklenmiş grid — paralel (16 tile) ──
  try {
    const tilesZ4 = Array.from({ length: 4 }, (_, xi) =>
      Array.from({ length: 4 }, (__, yi) => ({ z: 4, x: xi * 4, y: yi * 4 })),
    ).flat();
    await Promise.any(
      tilesZ4.map(({ z, x, y }) =>
        probeOneTile(z, x, y, 1000).then((ok) => {
          if (!ok) throw new Error('miss');
          return true;
        }),
      ),
    );
    return true;
  } catch {
    return false;
  }
}

// ── Capacitor Filesystem tile reader ────────────────────────
// Native modda: harici SD kart veya /data/data/... içinden tile okur.
// Böylece tile'lar APK içine paketlenmez — APK boyutu ~%80 azalır.
//
// Harici tile yolu önceliği:
//   1. ExternalStorage/Android/data/com.carlauncher.pro/maps/  (SD kart)
//   2. Data/maps/                                               (iç depo)
//   3. /maps/ (APK public/ asset — fallback)
//
// Tile dosya ismi: {z}/{x}/{y}.png (aynı yapı)

const NATIVE_MAPS_SUBDIRS = [
  'Android/data/com.carlauncher.pro/maps', // ExternalStorage
  'maps',                                  // Data directory
];

async function readTileFromFilesystem(
  z: string, x: string, y: string,
  ext = '.png',
): Promise<ArrayBuffer | null> {
  if (!Capacitor.isNativePlatform()) return null;

  // Lazy import — Filesystem yalnızca native modda yüklenir.
  const { Filesystem, Directory } = await import('@capacitor/filesystem');
  const tilePath = `${z}/${x}/${y}${ext}`;

  // ExternalStorage dene (SD kart)
  for (const subdir of NATIVE_MAPS_SUBDIRS) {
    try {
      const result = await Filesystem.readFile({
        path:      `${subdir}/${tilePath}`,
        directory: Directory.ExternalStorage,
      });
      // Capacitor base64 döner — ArrayBuffer'a çevir
      if (typeof result.data === 'string') {
        const bin = atob(result.data);
        const buf = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
        return buf.buffer;
      }
      if (result.data instanceof Blob) return result.data.arrayBuffer();
    } catch {
      // Bu dizinde yok — sonraki dene
    }
  }

  // Data directory dene (iç depo)
  try {
    const result = await Filesystem.readFile({
      path:      `maps/${tilePath}`,
      directory: Directory.Data,
    });
    if (typeof result.data === 'string') {
      const bin = atob(result.data);
      const buf = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
      return buf.buffer;
    }
    if (result.data instanceof Blob) return result.data.arrayBuffer();
  } catch {
    // iç depoda da yok
  }

  return null;
}

/**
 * Harici tile varlığını kontrol eder — probeLocalTiles() ile aynı amaç,
 * sadece Capacitor Filesystem üzerinden.
 */
async function probeFilesystemTiles(): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return false;
  // z=0 tile — try both formats; either one proves the tile store exists
  for (const ext of ['.png', '.pbf']) {
    const buf = await readTileFromFilesystem('0', '0', '0', ext);
    if (buf !== null) return true;
  }
  return false;
}

// ── Glyph cache protocol ────────────────────────────────────
//
// Sorun: MapLibre vector stili offline modda glyph sunucusuna (CDN) ulaşamaz
//        → sembol katmanları (yol/şehir etiketleri) tamamen kaybolur.
//
// Çözüm: 'glyph-cache://' protokolü şu öncelik zinciriyle çalışır:
//   1. Cache Storage (Service Worker veya önceki online oturum önbelleği)
//   2. CDN (navigator.onLine ise — başarılı sonuçları cache'e yazar)
//   3. Boş ArrayBuffer (bu aralıkta glyph yok — harita etiket olmadan render)
//
// buildVectorStyle() bu protokolü glyph URL'si olarak kullanır;
// artık 'includeLabels = isOnline' koşuluna gerek yoktur.

const GLYPH_CACHE_NAME     = 'car-launcher-glyphs-v1';
let   glyphProtocolRegistered = false;

function registerGlyphCacheProtocol(): void {
  if (glyphProtocolRegistered) return;
  glyphProtocolRegistered = true;

  maplibregl.addProtocol('glyph-cache', async (params: { url: string }) => {
    // glyph-cache://demotiles.maplibre.org/font/{fontstack}/{range}.pbf
    // → https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf
    const remotePath = params.url.replace('glyph-cache://', 'https://');
    const EMPTY = new ArrayBuffer(0);

    // ── 1. Cache Storage (en hızlı — ağ isteği yok) ─────────
    try {
      const cache = await caches.open(GLYPH_CACHE_NAME);
      const hit   = await cache.match(remotePath);
      if (hit) return { data: await hit.arrayBuffer() };
    } catch { /* caches API erişilemez (private mode vs.) */ }

    // ── 2. CDN (online ise — başarılı glyph'i önbelleğe al) ──
    const { isOnline } = useMapSourceStore.getState();
    if (isOnline) {
      try {
        const resp = await fetch(remotePath, { signal: signalWithTimeout(4000) });
        if (resp.ok) {
          try {
            const cache = await caches.open(GLYPH_CACHE_NAME);
            await cache.put(remotePath, resp.clone());
          } catch { /* cache yazma başarısız — veriyi yine de döndür */ }
          return { data: await resp.arrayBuffer() };
        }
      } catch { /* network error */ }
    }

    // ── 3. Boş glyph — bu aralık render edilmeden devam eder ──
    return { data: EMPTY };
  });
}

// ── Smart tile protocol ─────────────────────────────────────
// Registered once via maplibre addProtocol.
//
// Öncelik zinciri (her tile için):
//   1. Capacitor Filesystem (SD kart / iç depo) — native modda
//   2. /maps/{z}/{x}/{y}.png               — APK asset (web/native)
//   3. tile.openstreetmap.org              — online fallback

let protocolRegistered = false;
/** Track recent tile hits for UI status */
let localHits = 0;
let onlineHits = 0;
let lastStatusUpdate = 0;

const OSM_SUBDOMAINS = ['a', 'b', 'c'];

function updateServingStatus() {
  const now = Date.now();
  if (now - lastStatusUpdate < 500) return; // debounce
  lastStatusUpdate = now;

  if (localHits > 0 && onlineHits === 0) {
    useMapSourceStore.setState({ servingFrom: 'local' });
  } else if (localHits > 0 && onlineHits > 0) {
    // Mixed: primarily local with some online fallback
    useMapSourceStore.setState({ servingFrom: 'local' });
  } else if (onlineHits > 0) {
    useMapSourceStore.setState({ servingFrom: 'online' });
  }
}

function registerSmartTileProtocol() {
  if (protocolRegistered) return;
  protocolRegistered = true;

  maplibregl.addProtocol('smart-tile', async (params: { url: string }, abortController: AbortController) => {
    // URL format: smart-tile://{z}/{x}/{y}
    const path = params.url.replace('smart-tile://', '');
    const [z, x, y] = path.split('/');
    const { isOnline, sources } = useMapSourceStore.getState();
    const hasLocal = sources.get('local')?.isAvailable === true;

    const EMPTY_PNG = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00,
      0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01,
      0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f,
      0x15, 0xc4, 0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41,
      0x54, 0x78, 0x9c, 0x62, 0x00, 0x00, 0x00, 0x02, 0x00, 0x01,
      0xe5, 0x27, 0xde, 0xfc, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45,
      0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
    ]).buffer;

    if (!hasLocal && !isOnline) return { data: EMPTY_PNG };

    if (hasLocal) {
      // Extension priority: .pbf first in vector mode, .png first in raster mode.
      const { tileRender } = useMapSourceStore.getState();
      const localExts = tileRender === 'vector' ? ['.pbf', '.png'] : ['.png', '.pbf'];

      // ── Strateji 1: Capacitor Filesystem (harici depo) ──────
      for (const ext of localExts) {
        try {
          const fsBuf = await readTileFromFilesystem(z, x, y, ext);
          if (fsBuf) {
            localHits++;
            updateServingStatus();
            return { data: fsBuf };
          }
        } catch { /* try next ext */ }
      }

      // ── Strateji 2: APK asset /maps/ ────────────────────────
      const localSignal = AbortSignal.any
        ? AbortSignal.any([abortController.signal, signalWithTimeout(500)])
        : abortController.signal;
      for (const ext of localExts) {
        try {
          const r = await fetch(`/maps/${path}${ext}`, { signal: localSignal });
          if (r.ok) {
            localHits++;
            updateServingStatus();
            return { data: await r.arrayBuffer() };
          }
        } catch { /* try next ext */ }
      }
    }

    // ── Strateji 3: Online fallback (raster OSM only) ────────
    // Vector online is handled via the full style URL, not per-tile fallback.
    if (isOnline) {
      try {
        const sub = OSM_SUBDOMAINS[Math.floor(Math.random() * 3)];
        const onlineResp = await fetch(
          `https://${sub}.tile.openstreetmap.org/${path}.png`,
          { signal: abortController.signal },
        );
        if (onlineResp.ok) {
          onlineHits++;
          updateServingStatus();
          const data = await onlineResp.arrayBuffer();
          return { data };
        }
      } catch {
        // online fetch also failed
      }
    }

    return { data: EMPTY_PNG };
  });
}

/**
 * Initialize map sources — detects local tiles, IndexedDB cache, and online
 */
export async function initializeMapSources(): Promise<void> {
  attachNetworkListeners();
  registerSmartTileProtocol();
  registerGlyphCacheProtocol();

  try {
    useMapSourceStore.setState({ isLoading: true });

    const sources = new Map<string, MapSource>();

    // Always register online source as ultimate fallback
    sources.set('online', {
      id: 'online',
      name: 'OpenStreetMap',
      type: 'online',
      description: 'Online harita (OSM)',
      isAvailable: true,
    });

    // 1) Probe for local tile dataset at /maps/{z}/{x}/{y}.png
    //    Öncelik: Capacitor Filesystem (SD kart / iç depo) → APK asset → online.
    //    Optimistic offline-first: if we've ever seen local tiles on this device,
    //    register the source immediately (no probe wait) so the map starts offline.
    //    A background probe then verifies and updates the preference.

    // Native modda Filesystem kontrolü — APK'dan önce
    if (Capacitor.isNativePlatform()) {
      const fsAvailable = await probeFilesystemTiles();
      if (fsAvailable) {
        writeOfflinePref(true);
        sources.set('local', {
          id: 'local',
          name: 'Harici Harita (SD / Depo)',
          type: 'offline',
          description: 'SD kart veya dahili depodan okunan offline harita',
          isAvailable: true,
        });
      }
    }

    const hadLocalBefore = readOfflinePref();
    if (hadLocalBefore && !sources.has('local')) {
      sources.set('local', {
        id: 'local',
        name: 'Yerel Harita',
        type: 'offline',
        description: 'Cihazda yüklü offline harita verileri',
        isAvailable: true,
      });
    }

    // Background probe — verifies actual tile presence and updates localStorage
    probeLocalTiles().then((hasLocal) => {
      writeOfflinePref(hasLocal);
      const { sources: currentSources, activeSourceId } = useMapSourceStore.getState();
      const updated = new Map(currentSources);
      if (hasLocal) {
        updated.set('local', {
          id: 'local',
          name: 'Yerel Harita',
          type: 'offline',
          description: 'Cihazda yüklü offline harita verileri',
          isAvailable: true,
        });
        // If we were forced online (no cached pref), switch to local now
        if (activeSourceId === 'online' && !updated.has('local')) {
          useMapSourceStore.setState({ sources: updated, activeSourceId: 'local', servingFrom: 'local' });
        } else {
          useMapSourceStore.setState({ sources: updated });
        }
      } else if (!hasLocal && !hadLocalBefore) {
        // Never had local tiles — nothing to change
      } else {
        // Had local before but tiles are gone now (e.g. storage cleared)
        updated.delete('local');
        const newActive = updated.has('cached') ? 'cached' : 'online';
        useMapSourceStore.setState({
          sources: updated,
          activeSourceId: activeSourceId === 'local' ? newActive : activeSourceId,
          servingFrom: (activeSourceId === 'local' ? newActive : activeSourceId) as 'cached' | 'online',
        });
      }
    }).catch(() => { /* probe failed — keep existing state */ });

    // 2) Check IndexedDB / service worker cache
    try {
      const stats = await getTileCacheStats();
      if (stats.totalTiles > 0) {
        sources.set('cached', {
          id: 'cached',
          name: 'Önbellek',
          type: 'offline',
          description: 'Daha önce indirilen harita karoları',
          isAvailable: true,
          cacheSize: stats.cacheSize,
          tileCount: stats.totalTiles,
          lastUpdated: Date.now(),
        });
      }
    } catch {
      // cache check failed, skip
    }

    // Determine priority: local > cached > online
    // (local is already added optimistically above if localStorage says it exists)
    let activeId: string;
    if (sources.has('local')) {
      activeId = 'local';
    } else if (sources.has('cached')) {
      activeId = 'cached';
    } else {
      activeId = 'online';
    }

    // Reset tile hit counters
    localHits = 0;
    onlineHits = 0;

    useMapSourceStore.setState({
      sources,
      activeSourceId: activeId,
      servingFrom: activeId as 'local' | 'cached' | 'online',
      initialized: true,
      isLoading: false,
      error: null,
    });
  } catch (err) {
    // Even on total failure, ensure online source is always available
    const fallbackSources = new Map<string, MapSource>();
    fallbackSources.set('online', {
      id: 'online',
      name: 'OpenStreetMap',
      type: 'online',
      description: 'Online harita',
      isAvailable: true,
    });
    useMapSourceStore.setState({
      sources: fallbackSources,
      activeSourceId: 'online',
      servingFrom: 'online',
      isLoading: false,
      error: null,
      initialized: true,
    });
  }
}

/**
 * Get all available map sources
 */
export function getMapSources(): MapSource[] {
  const { sources } = useMapSourceStore.getState();
  return Array.from(sources.values());
}

/**
 * Get map source by ID
 */
export function getMapSource(id: string): MapSource | null {
  const { sources } = useMapSourceStore.getState();
  return sources.get(id) || null;
}

/**
 * Set active map source
 */
export function setActiveMapSource(sourceId: string): boolean {
  const { sources } = useMapSourceStore.getState();
  if (!sources.has(sourceId)) {
    return false;
  }

  useMapSourceStore.setState({ activeSourceId: sourceId });
  return true;
}

/**
 * Get active map source
 */
export function getActiveMapSource(): MapSource | null {
  const { sources, activeSourceId } = useMapSourceStore.getState();
  if (!activeSourceId) return null;
  return sources.get(activeSourceId) || null;
}

/**
 * Get active source ID
 */
export function getActiveMapSourceId(): string | null {
  return useMapSourceStore.getState().activeSourceId;
}

/**
 * Check if offline maps available (local tiles or IndexedDB cache)
 */
export function hasOfflineMapData(): boolean {
  const { sources } = useMapSourceStore.getState();
  const hasLocal = sources.get('local')?.isAvailable === true;
  const hasCached = sources.get('cached')?.isAvailable === true;
  return hasLocal || hasCached;
}

/**
 * Get map source status for UI — reflects actual serving state
 */
export function getMapSourceStatus(): {
  status: 'offline' | 'online';
  message: string;
  source: MapSource | null;
} {
  const { servingFrom, isOnline, sources } = useMapSourceStore.getState();
  const active = getActiveMapSource();

  if (!active) {
    return {
      status: isOnline ? 'online' : 'offline',
      message: isOnline ? 'Online harita' : 'Bağlantı yok',
      source: null,
    };
  }

  // Use servingFrom for real-time accuracy
  if (servingFrom === 'local') {
    return {
      status: 'offline',
      message: isOnline
        ? 'Yerel Harita (öncelikli)'
        : 'Yerel Harita — İnternet yok',
      source: sources.get('local') || active,
    };
  }

  if (servingFrom === 'cached') {
    const cached = sources.get('cached');
    return {
      status: 'offline',
      message: `Önbellek Harita (${cached?.cacheSize || '?'})`,
      source: cached || active,
    };
  }

  return {
    status: 'online',
    message: 'Online Harita (OSM)',
    source: sources.get('online') || active,
  };
}

/**
 * Refresh source availability (re-probe local + check cache)
 */
export async function refreshMapSources(): Promise<void> {
  try {
    useMapSourceStore.setState({ isLoading: true });
    const { sources } = useMapSourceStore.getState();

    // Re-probe local tiles
    try {
      const hasLocal = await probeLocalTiles();
      if (hasLocal) {
        sources.set('local', {
          id: 'local',
          name: 'Yerel Harita',
          type: 'offline',
          description: 'Cihazda yüklü offline harita verileri',
          isAvailable: true,
        });
      } else {
        sources.delete('local');
      }
    } catch {
      sources.delete('local');
    }

    // Re-check IndexedDB cache
    try {
      const stats = await getTileCacheStats();
      if (stats.totalTiles > 0) {
        sources.set('cached', {
          id: 'cached',
          name: 'Önbellek',
          type: 'offline',
          description: 'Daha önce indirilen harita karoları',
          isAvailable: true,
          cacheSize: stats.cacheSize,
          tileCount: stats.totalTiles,
          lastUpdated: Date.now(),
        });
      } else {
        sources.delete('cached');
      }
    } catch {
      sources.delete('cached');
    }

    // Reset hit counters for fresh detection
    localHits = 0;
    onlineHits = 0;

    useMapSourceStore.setState({
      sources,
      isLoading: false,
      error: null,
    });

    // Re-evaluate priority if current active source was removed
    const { activeSourceId } = useMapSourceStore.getState();
    if (!activeSourceId || !sources.has(activeSourceId)) {
      if (sources.has('local')) setActiveMapSource('local');
      else if (sources.has('cached')) setActiveMapSource('cached');
      else setActiveMapSource('online');
    }
  } catch (err) {
    useMapSourceStore.setState({ isLoading: false });
  }
}

/**
 * Get the tile URL(s) for the currently active source.
 *
 * When local tiles are detected, uses the `smart-tile://` custom protocol
 * which tries local first then falls back to online per-tile.
 *
 * When no local tiles: 'cached' and 'online' use standard OSM URLs.
 */
export function getActiveTileUrls(): string[] {
  const { activeSourceId, sources } = useMapSourceStore.getState();
  const hasLocal = sources.get('local')?.isAvailable === true;

  // Smart protocol: local-first with online fallback per tile
  if (hasLocal || activeSourceId === 'local') {
    return ['smart-tile://{z}/{x}/{y}'];
  }

  // Pure online (cached relies on service worker intercepting OSM URLs)
  return [
    'https://a.tile.openstreetmap.org/{z}/{x}/{y}.png',
    'https://b.tile.openstreetmap.org/{z}/{x}/{y}.png',
    'https://c.tile.openstreetmap.org/{z}/{x}/{y}.png',
  ];
}

// ── Private style builders ───────────────────────────────────

/**
 * Vector tile style — automotive dark theme, OMT schema.
 *
 * Tile source priority:
 *   1. smart-tile://{z}/{x}/{y}  (local .pbf via Filesystem / APK asset)
 *   2. VITE_VECTOR_TILE_URL env  (custom server / MapTiler / etc.)
 *
 * Glyphs:
 *   Online: MapLibre demo CDN (Noto Sans, always accessible)
 *   Offline: no symbol layers — NavigationHUD already shows turn text
 *
 * If no vector source is available, falls back to buildRoadStyle().
 */
function buildVectorStyle(): StyleSpecification {
  const { sources } = useMapSourceStore.getState();
  const hasLocalPbf = sources.get('local')?.isAvailable === true;
  const customUrl   = (import.meta.env['VITE_VECTOR_TILE_URL'] ?? '') as string;

  // Determine tile URL — must serve .pbf
  let vectorTiles: string[];
  if (hasLocalPbf) {
    vectorTiles = ['smart-tile://{z}/{x}/{y}'];
  } else if (customUrl) {
    vectorTiles = [customUrl];
  } else {
    // No vector source available — fall back silently to raster
    return buildRoadStyle();
  }

  // Glyph-cache protokolü offline'da da etiket render eder (cache'den veya boş döner).
  // 'includeLabels = isOnline' koşulu artık gerekmez — her zaman aktif.
  const includeLabels = true;
  const glyphsUrl = 'glyph-cache://demotiles.maplibre.org/font/{fontstack}/{range}.pbf';

  const style: StyleSpecification = {
    version: 8,
    name: 'Vector (Automotive Dark)',
    ...(includeLabels ? { glyphs: glyphsUrl } : {}),
    sources: {
      omv: {
        type: 'vector',
        tiles: vectorTiles,
        minzoom: 0,
        maxzoom: 14,
        attribution: '© OpenMapTiles © OpenStreetMap contributors',
      },
    },
    layers: [
      // ── Base ──────────────────────────────────────────────
      { id: 'background',
        type: 'background',
        paint: { 'background-color': '#0d1117' } },

      // ── Water ─────────────────────────────────────────────
      { id: 'water-fill',
        type: 'fill',
        source: 'omv',
        'source-layer': 'water',
        paint: { 'fill-color': '#0c1e2f' } },
      { id: 'waterway',
        type: 'line',
        source: 'omv',
        'source-layer': 'waterway',
        paint: { 'line-color': '#0c1e2f', 'line-width': 1.5 } },

      // ── Landuse ───────────────────────────────────────────
      { id: 'landuse-park',
        type: 'fill',
        source: 'omv',
        'source-layer': 'landuse',
        filter: ['in', ['get', 'class'], ['literal', ['park', 'grass', 'meadow', 'pitch', 'playground', 'golf']]],
        paint: { 'fill-color': '#0d1f12' } },
      { id: 'landuse-residential',
        type: 'fill',
        source: 'omv',
        'source-layer': 'landuse',
        filter: ['in', ['get', 'class'], ['literal', ['residential', 'suburb', 'neighbourhood']]],
        paint: { 'fill-color': '#10131a' } },

      // ── Buildings ─────────────────────────────────────────
      { id: 'building',
        type: 'fill',
        source: 'omv',
        'source-layer': 'building',
        minzoom: 13,
        paint: { 'fill-color': '#15202e', 'fill-outline-color': '#1c2d40' } },

      // ── Roads: casings (outlines) ─────────────────────────
      { id: 'road-motorway-casing',
        type: 'line',
        source: 'omv',
        'source-layer': 'transportation',
        filter: ['in', ['get', 'class'], ['literal', ['motorway', 'trunk']]],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': '#b06800',
          'line-width': ['interpolate', ['linear'], ['zoom'], 8, 4, 14, 12],
        } },
      { id: 'road-primary-casing',
        type: 'line',
        source: 'omv',
        'source-layer': 'transportation',
        filter: ['in', ['get', 'class'], ['literal', ['primary', 'secondary']]],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': '#1a2535',
          'line-width': ['interpolate', ['linear'], ['zoom'], 8, 2.5, 14, 9],
        } },
      { id: 'road-minor-casing',
        type: 'line',
        source: 'omv',
        'source-layer': 'transportation',
        filter: ['in', ['get', 'class'], ['literal', ['tertiary', 'minor', 'service']]],
        minzoom: 12,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': '#111827',
          'line-width': ['interpolate', ['linear'], ['zoom'], 12, 2, 14, 6],
        } },

      // ── Roads: fills ──────────────────────────────────────
      { id: 'road-motorway',
        type: 'line',
        source: 'omv',
        'source-layer': 'transportation',
        filter: ['in', ['get', 'class'], ['literal', ['motorway', 'trunk']]],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': '#f59e0b',
          'line-width': ['interpolate', ['linear'], ['zoom'], 8, 2.5, 14, 9],
        } },
      { id: 'road-primary',
        type: 'line',
        source: 'omv',
        'source-layer': 'transportation',
        filter: ['==', ['get', 'class'], 'primary'],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': '#e2e8f0',
          'line-width': ['interpolate', ['linear'], ['zoom'], 8, 1.5, 14, 6],
        } },
      { id: 'road-secondary',
        type: 'line',
        source: 'omv',
        'source-layer': 'transportation',
        filter: ['in', ['get', 'class'], ['literal', ['secondary', 'tertiary']]],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': '#94a3b8',
          'line-width': ['interpolate', ['linear'], ['zoom'], 10, 1, 14, 4],
        } },
      { id: 'road-minor',
        type: 'line',
        source: 'omv',
        'source-layer': 'transportation',
        filter: ['in', ['get', 'class'], ['literal', ['minor', 'service', 'track']]],
        minzoom: 12,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': '#3d4f63',
          'line-width': ['interpolate', ['linear'], ['zoom'], 12, 0.5, 14, 2.5],
        } },

      // ── Labels (online only) ──────────────────────────────
      ...(includeLabels ? ([
        { id: 'road-label',
          type: 'symbol',
          source: 'omv',
          'source-layer': 'transportation_name',
          minzoom: 12,
          layout: {
            'text-field': ['coalesce', ['get', 'name:tr'], ['get', 'name']],
            'text-font': ['Noto Sans Regular'],
            'text-size': ['interpolate', ['linear'], ['zoom'], 12, 10, 14, 13],
            'symbol-placement': 'line',
            'text-max-angle': 30,
            'text-padding': 2,
          },
          paint: {
            'text-color': '#94a3b8',
            'text-halo-color': '#0d1117',
            'text-halo-width': 1.5,
          } },
        { id: 'place-town',
          type: 'symbol',
          source: 'omv',
          'source-layer': 'place',
          filter: ['in', 'class', 'town', 'village', 'hamlet'],
          layout: {
            'text-field': ['coalesce', ['get', 'name:tr'], ['get', 'name']],
            'text-font': ['Noto Sans Regular'],
            'text-size': 12,
            'text-anchor': 'center',
          },
          paint: {
            'text-color': '#cbd5e1',
            'text-halo-color': '#0d1117',
            'text-halo-width': 2,
          } },
        { id: 'place-city',
          type: 'symbol',
          source: 'omv',
          'source-layer': 'place',
          filter: ['==', 'class', 'city'],
          layout: {
            'text-field': ['coalesce', ['get', 'name:tr'], ['get', 'name']],
            'text-font': ['Noto Sans Bold'],
            'text-size': ['interpolate', ['linear'], ['zoom'], 6, 13, 12, 18],
            'text-anchor': 'center',
          },
          paint: {
            'text-color': '#f1f5f9',
            'text-halo-color': '#0d1117',
            'text-halo-width': 2.5,
          } },
      ] as LayerSpecification[]) : []),
    ],
  };

  return style;
}

function buildRoadStyle(): StyleSpecification {
  const tiles = getActiveTileUrls();
  const { activeSourceId, sources } = useMapSourceStore.getState();
  const hasLocal = sources.get('local')?.isAvailable === true;
  const usingSmart = hasLocal || activeSourceId === 'local';

  return {
    version: 8,
    name: usingSmart ? 'Smart Offline/Online Map' : 'OSM Map',
    sources: {
      'map-tiles': {
        type: 'raster',
        tiles,
        tileSize: 256,
        attribution: '© OpenStreetMap contributors',
        minzoom: 0,
        maxzoom: 19,
      },
    },
    layers: [
      { 
        id: 'background', 
        type: 'background', 
        paint: { 'background-color': '#020408' } 
      },
      { 
        id: 'tiles-layer', 
        type: 'raster', 
        source: 'map-tiles', 
        paint: { 
          'raster-opacity': 0.92,
          'raster-contrast': 0.55,
          'raster-brightness-min': 0,
          'raster-brightness-max': 0.9,
          'raster-saturation': -0.85,
          'raster-hue-rotate': 20
        } 
      },
    ],
  };
}

function buildSatelliteStyle(): StyleSpecification {
  return {
    version: 8,
    name: 'Uydu',
    sources: {
      'satellite-tiles': {
        type: 'raster',
        tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
        tileSize: 256,
        attribution: '© Esri',
        maxzoom: 19,
      },
    },
    layers: [
      { id: 'background', type: 'background', paint: { 'background-color': '#0d1628' } },
      { id: 'satellite-layer', type: 'raster', source: 'satellite-tiles', paint: { 'raster-opacity': 1 } },
    ],
  };
}

function buildHybridStyle(): StyleSpecification {
  return {
    version: 8,
    name: 'Hibrit',
    sources: {
      'satellite-tiles': {
        type: 'raster',
        tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
        tileSize: 256,
        attribution: '© Esri',
        maxzoom: 19,
      },
      'road-overlay': {
        type: 'raster',
        tiles: [
          'https://a.tile.openstreetmap.org/{z}/{x}/{y}.png',
          'https://b.tile.openstreetmap.org/{z}/{x}/{y}.png',
          'https://c.tile.openstreetmap.org/{z}/{x}/{y}.png',
        ],
        tileSize: 256,
        attribution: '© OpenStreetMap contributors',
        maxzoom: 19,
      },
    },
    layers: [
      { id: 'background', type: 'background', paint: { 'background-color': '#0d1628' } },
      { id: 'satellite-layer', type: 'raster', source: 'satellite-tiles', paint: { 'raster-opacity': 1 } },
      {
        id: 'road-overlay-layer',
        type: 'raster',
        source: 'road-overlay',
        paint: {
          // Opacity 0.38 — uydu görüntüsünü açık tutar, yol etiketleri hâlâ okunur
          'raster-opacity': 0.38,
          // Tam renk silme: OSM'nin yeşil parkları / mavi suyu kalkar,
          // sadece siyah/gri yol çizgileri ve beyaz yazılar kalır
          'raster-saturation': -1,
          // Kontrast maksimum: açık zemin → tam beyaz, yollar → tam siyah
          // Sürüş güvenliği: gece modunda bile şerit/kavşak ayrımı net
          'raster-contrast': 0.75,
          // Beyaz OSM zemini → orta gri (0.55) → uydu renkleriyle harmoniyi artırır
          'raster-brightness-max': 0.55,
          'raster-brightness-min': 0,
        },
      },
    ],
  };
}

/**
 * Get map style based on active source, map mode, and tile render mode.
 *
 * Road mode applies the tile render strategy:
 *   tileRender='raster' → raster OSM (navigation / AR)
 *   tileRender='vector' → OMT vector (browse / idle)
 *
 * Satellite/hybrid are always raster regardless of tileRender.
 */
export function getMapStyle(): StyleSpecification {
  const { mapMode, tileRender } = useMapSourceStore.getState();
  if (mapMode === 'satellite') return buildSatelliteStyle();
  if (mapMode === 'hybrid')    return buildHybridStyle();
  if (tileRender === 'vector') return buildVectorStyle();
  return buildRoadStyle();
}

/**
 * Subscribe to source changes
 */
export function subscribeToMapSources(
  callback: (state: MapSourceState) => void
): () => void {
  return useMapSourceStore.subscribe((state) => callback(state));
}

/**
 * Use hook for map sources
 */
export function useMapSources() {
  return useMapSourceStore();
}

/**
 * Use hook for active source
 */
export function useActiveMapSource() {
  const { activeSourceId, sources } = useMapSourceStore();
  return activeSourceId ? sources.get(activeSourceId) || null : null;
}

/**
 * Use hook for network + serving status
 */
export function useMapNetworkStatus() {
  const isOnline = useMapSourceStore((s) => s.isOnline);
  const servingFrom = useMapSourceStore((s) => s.servingFrom);
  return { isOnline, servingFrom };
}

/**
 * Set map display mode. Satellite/hybrid are silently forced to road when offline.
 * Stores the user's intention so the mode is restored when connectivity returns.
 */
export function setMapMode(mode: MapMode): void {
  const { isOnline } = useMapSourceStore.getState();

  if ((mode === 'satellite' || mode === 'hybrid') && !isOnline) {
    // User wants satellite/hybrid but we're offline — downgrade gracefully
    // and remember so we restore automatically when online.
    _forcedDowngradeFrom = mode;
    useMapSourceStore.setState({ mapMode: 'road' });
  } else {
    // Explicit user choice — clear any pending restore to avoid overriding it.
    _forcedDowngradeFrom = null;
    useMapSourceStore.setState({ mapMode: mode });
  }
}

/**
 * Called when satellite tile loading fails (e.g. Esri rate-limited or blocked).
 * Gracefully falls back to road mode so the map stays usable.
 */
export function handleSatelliteTileError(): void {
  const { mapMode } = useMapSourceStore.getState();
  if (mapMode === 'satellite' || mapMode === 'hybrid') {
    useMapSourceStore.setState({ mapMode: 'road' });
    // Log once so the user knows why it switched
    import('./errorBus').then(({ showToast }) =>
      showToast({ type: 'warning', title: 'Uydu görüntüsü yüklenemedi', message: 'Yol görünümüne geçildi', duration: 4000 })
    ).catch(() => undefined);
  }
}

/**
 * Get current map mode
 */
export function getMapMode(): MapMode {
  return useMapSourceStore.getState().mapMode;
}

/**
 * Reactive hook for map mode
 */
export function useMapMode(): MapMode {
  return useMapSourceStore((s) => s.mapMode);
}

// ── Hybrid render auto-switch ────────────────────────────────

/**
 * Debounce timer for idle→vector transition.
 * Raster→instant; vector→debounced so brief nav pauses don't cause a
 * round-trip (vector decode stall right as the user resumes navigating).
 */
let _toVectorTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Call this whenever navigation or AR active state changes.
 * Manages the raster ↔ vector switch automatically:
 *
 *   active (nav || ar) → 'raster' immediately
 *   idle 2500ms        → 'vector' (debounced)
 *
 * Does nothing when mapMode !== 'road' (satellite/hybrid are always raster).
 */
export function notifyNavigationRender(isNavigating: boolean, arActive: boolean): void {
  const { mapMode } = useMapSourceStore.getState();
  if (mapMode !== 'road') return;

  if (isNavigating || arActive) {
    // Cancel any pending idle→vector switch
    if (_toVectorTimer !== null) {
      clearTimeout(_toVectorTimer);
      _toVectorTimer = null;
    }
    useMapSourceStore.setState({ tileRender: 'raster' });
  } else {
    // Debounce: wait 2500ms of confirmed idle before switching to vector
    if (_toVectorTimer !== null) return; // already scheduled
    _toVectorTimer = setTimeout(() => {
      _toVectorTimer = null;
      useMapSourceStore.setState({ tileRender: 'vector' });
    }, 2500);
  }
}

/**
 * Reactive hook — subscribe in FullMapView to trigger style switches.
 * Returns the current tile render mode.
 */
export function useTileRenderMode(): TileRenderMode {
  return useMapSourceStore((s) => s.tileRender);
}

// ── HMR cleanup (Vite dev mode) ─────────────────────────────
// When this module is replaced during hot-reload, tear down listeners and
// unregister the custom protocol so the new module can re-register cleanly.
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    detachNetworkListeners();
    if (_toVectorTimer !== null) { clearTimeout(_toVectorTimer); _toVectorTimer = null; }
    if (protocolRegistered) {
      try { maplibregl.removeProtocol('smart-tile'); } catch { /* ignore */ }
      protocolRegistered = false;
    }
    if (glyphProtocolRegistered) {
      try { maplibregl.removeProtocol('glyph-cache'); } catch { /* ignore */ }
      glyphProtocolRegistered = false;
    }
  });
}
