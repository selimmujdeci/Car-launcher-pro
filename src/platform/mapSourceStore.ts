import { create } from 'zustand';
import type { MapMode, MapSourceState } from './mapSourceTypes';

export const useMapSourceStore = create<MapSourceState>(() => ({
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

let _pingTimer: ReturnType<typeof setInterval> | null = null;
/**
 * Son başarılı tile fetch zamanı (Date.now()).
 * Tile akışı varsa redundant HEAD isteği gönderilmez — veri tasarrufu.
 */
let _lastSuccessfulFetch = 0;

export function getForcedDowngradeFrom(): MapMode | null {
  return _forcedDowngradeFrom;
}

export function setForcedDowngradeFrom(mode: MapMode | null): void {
  _forcedDowngradeFrom = mode;
}

/** Smart-tile protokolü başarılı online tile fetch'ini bildirir — ping askıya alma penceresini yeniler. */
export function notifyTileSuccess(): void {
  _lastSuccessfulFetch = Date.now();
}

/**
 * Gerçek internet bağlantısı testi — navigator.onLine Android WebView'da
 * güvenilmez (hotspot sonradan bağlanırsa false kalır).
 * OSM tile sunucusuna küçük bir HEAD isteği atar; 5s timeout.
 */
async function _pingOnline(): Promise<boolean> {
  try {
    const ctrl = new AbortController();
    // 5 s timeout — 2G/EDGE bağlantılarında 3 s zaman aşımı çok agresifti;
    // yavaş ağda sahte "offline" tetiklemesini önler.
    const t = setTimeout(() => ctrl.abort(), 5_000);
    const r = await fetch('https://a.tile.openstreetmap.org/0/0/0.png', {
      method: 'HEAD',
      signal: ctrl.signal,
      cache:  'no-store',
    });
    clearTimeout(t);
    return r.ok;
  } catch {
    return false;
  }
}

function _setOnline(online: boolean): void {
  const { mapMode } = useMapSourceStore.getState();
  if (online) {
    useMapSourceStore.setState({ isOnline: true });
    if (_forcedDowngradeFrom && _forcedDowngradeFrom !== 'road') {
      useMapSourceStore.setState({ mapMode: _forcedDowngradeFrom });
      _forcedDowngradeFrom = null;
    }
  } else {
    if (mapMode === 'satellite' || mapMode === 'hybrid') {
      _forcedDowngradeFrom = mapMode;
      useMapSourceStore.setState({ mapMode: 'road' });
    }
    useMapSourceStore.setState({ isOnline: false });
  }
}

export function attachNetworkListeners(): void {
  if (networkListenersAttached || typeof window === 'undefined') return;
  networkListenersAttached = true;

  _onlineHandler  = () => _setOnline(true);
  _offlineHandler = () => _setOnline(false);

  window.addEventListener('online',  _onlineHandler);
  window.addEventListener('offline', _offlineHandler);
  window.addEventListener('beforeunload', detachNetworkListeners, { once: true });

  // ── Ping tabanlı bağlantı kontrol (Android WebView güvencesi) ──
  // navigator.onLine hotspot bağlantılarında false kalabilir.
  // Periyot 30 s — tile akışı varsa ping zaten atlanır (bant genişliği korunur).
  const checkAndUpdate = () => {
    const { isOnline } = useMapSourceStore.getState();
    const timeSinceSuccess = Date.now() - _lastSuccessfulFetch;

    // Tile akıyorsa bağlantı sağlıklıdır: gereksiz HEAD isteğini atla.
    // İstisna: isOnline=false ise offline kurtarma için hemen ping at.
    if (isOnline && timeSinceSuccess < 120_000) return;

    void _pingOnline().then((online) => {
      const current = useMapSourceStore.getState().isOnline;
      if (online !== current) _setOnline(online);
    });
  };
  // İlk kontrol: 1 saniye gecikmeyle (uygulama açılır açılmaz değil)
  setTimeout(checkAndUpdate, 1_000);
  _pingTimer = setInterval(checkAndUpdate, 30_000);
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
  if (_pingTimer !== null) { clearInterval(_pingTimer); _pingTimer = null; }
}
