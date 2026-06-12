import maplibregl from 'maplibre-gl';
import { GLYPH_CACHE_NAME } from './mapSourceTypes';
import {
  useMapSourceStore,
  notifyTileSuccess,
} from './mapSourceStore';
import {
  readTileFromFilesystem,
  signalWithTimeout,
} from './mapTileProbe';

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

let glyphProtocolRegistered = false;

export function registerGlyphCacheProtocol(): void {
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

function updateServingStatus(): void {
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

/** initializeMapSources ve refreshMapSources başlangıcında sayaçları sıfırla. */
export function resetProtocolHits(): void {
  localHits = 0;
  onlineHits = 0;
}

export function registerSmartTileProtocol(): void {
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
      // signalWithTimeout çok eski WebView'da undefined dönebilir — o durumda
      // (AbortSignal.any de yoktur zaten) yalnız abort sinyali kullanılır.
      const _timeoutSig = signalWithTimeout(500);
      const localSignal = (typeof AbortSignal.any === 'function' && _timeoutSig)
        ? AbortSignal.any([abortController.signal, _timeoutSig])
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
          // Tile başarıyla alındı — ping askıya alma penceresini yenile
          notifyTileSuccess();
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

/** HMR ve test teardown için protokolleri kaldır ve kayıt bayraklarını sıfırla. */
export function unregisterProtocols(): void {
  if (protocolRegistered) {
    try { maplibregl.removeProtocol('smart-tile'); } catch { /* ignore */ }
    protocolRegistered = false;
  }
  if (glyphProtocolRegistered) {
    try { maplibregl.removeProtocol('glyph-cache'); } catch { /* ignore */ }
    glyphProtocolRegistered = false;
  }
}
