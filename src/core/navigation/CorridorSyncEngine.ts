/**
 * CorridorSyncEngine — Rota koridoru boyunca proaktif veri önbellekleme motoru.
 *
 * Sorun: Rota üzerindeki tünel veya sinyal kesiklerinde POI verilerinin
 *   (benzinlik vb.) kaybolması.
 *
 * Çözüm: Araç rotaya çıktığında, güzergahın 5 km çevresindeki POI bölgelerini
 *   ve harita tile'larını arka planda (Priority:1) indirir.
 *
 * Hız uyarlaması:
 *   hız < HIGH_SPEED_KMH (80 km/h) → tam rota + 5 km tampon
 *   hız ≥ HIGH_SPEED_KMH            → yalnızca önündeki CRITICAL_CORRIDOR_M (20 km)
 *
 * Kısıtlamalar:
 *   - POI:  isOnline iken her zaman (küçük veri ~20 KB/bölge)
 *   - Tile: yalnızca WiFi bağlantısında (PNG dosyaları büyük)
 *   - Ana thread bloke edilmez; tüm I/O async
 *   - Her iş tekrar kuyruğa girmez (id-bazlı dedup)
 */

import { downloadRegion }  from '../../platform/offlineDataService';
import { cacheLRUManager } from '../storage/CacheLRUManager';
import { isFeatureEnabled, recordFault } from '../../platform/safety/SafetyBrain';

/* ── Sabitler ────────────────────────────────────────────────────────────── */

const HIGH_SPEED_KMH        = 80;       // bu hızın üstünde Critical Corridor aktif
const CRITICAL_CORRIDOR_M   = 20_000;   // kritik koridor uzunluğu (m)
const TILE_ZOOM_MIN         = 10;       // indirilen tile zoom aralığı
const TILE_ZOOM_MAX         = 13;
const POI_GRID_DEG          = 0.18;     // offlineDataService ile uyumlu grid (~20 km)
const CORRIDOR_BUFFER_DEG   = 0.045;    // ~5 km enlem/boylam tile tamponu
const JOB_DELAY_MS          = 200;      // arka plan işler arası bekleme (sunucu koruması)
const GEOMETRY_HASH_SAMPLE  = 3;        // hash için örneklenen nokta sayısı

function _recordCorridorAbortIfNeeded(e: unknown): void {
  if (e instanceof DOMException && e.name === 'AbortError') {
    recordFault('CORRIDOR_PREFETCH_TIMEOUT');
  }
}

/* ── Tile koordinat hesabı ───────────────────────────────────────────────── */

export interface TileCoord { z: number; x: number; y: number }

function _tileXY(lat: number, lon: number, z: number): { x: number; y: number } {
  const n  = 1 << z;
  const x  = Math.floor(((lon + 180) / 360) * n);
  const lr = (lat * Math.PI) / 180;
  const y  = Math.floor(((1 - Math.log(Math.tan(lr) + 1 / Math.cos(lr)) / Math.PI) / 2) * n);
  return { x, y };
}

/* ── Haversine (metre) ───────────────────────────────────────────────────── */

function _havM(la1: number, lo1: number, la2: number, lo2: number): number {
  const R   = 6_371_000;
  const dLa = (la2 - la1) * (Math.PI / 180);
  const dLo = (lo2 - lo1) * (Math.PI / 180);
  const a   = Math.sin(dLa / 2) ** 2 +
              Math.cos(la1 * Math.PI / 180) * Math.cos(la2 * Math.PI / 180) *
              Math.sin(dLo / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/* ── Ağ durum kontrolleri ────────────────────────────────────────────────── */

function _isOnline(): boolean {
  if (typeof navigator === 'undefined') return false;
  return navigator.onLine;
}

/** Hücresel bağlantıda mı? Evet → tile indirme yok (veri limiti koruması). */
function _isCellular(): boolean {
  const conn = (navigator as { connection?: { type?: string } }).connection;
  if (!conn || !conn.type) return false; // API yok → bilinmiyor, optimist
  return conn.type === 'cellular';
}

/* ── BackgroundFetchQueue ────────────────────────────────────────────────── */

interface _FetchJob {
  id:      string;
  priority: number;          // küçük sayı = yüksek öncelik
  execute: (signal: AbortSignal) => Promise<void>;
}

class BackgroundFetchQueue {
  private _jobs:    _FetchJob[] = [];
  private _running  = false;
  private _ctrl:   AbortController | null = null;

  enqueue(job: _FetchJob): void {
    if (this._jobs.some(j => j.id === job.id)) return; // dedup
    this._jobs.push(job);
    this._jobs.sort((a, b) => a.priority - b.priority);
    this._pump();
  }

  private _pump(): void {
    if (this._running || !this._jobs.length) return;
    this._running = true;
    void this._drain();
  }

  private async _drain(): Promise<void> {
    while (this._jobs.length) {
      if (!_isOnline()) break;         // ağ gitti → dur
      const job = this._jobs.shift()!;
      try {
        this._ctrl = new AbortController();
        await job.execute(this._ctrl.signal);
      } catch {
        /* sessiz hata — bağlantı kopar, timeout vs. */
      } finally {
        this._ctrl = null;
      }
      // Bant genişliği koruması: işler arası düşük öncelikli bekleme
      await new Promise<void>(r => setTimeout(r, JOB_DELAY_MS));
    }
    this._running = false;
  }

  clear(): void {
    this._ctrl?.abort();
    this._ctrl  = null;
    this._jobs  = [];
    this._running = false;
  }

  get pending(): number  { return this._jobs.length; }
  get running(): boolean { return this._running; }
}

/* ── Koridor hesaplama (public — testlerde doğrudan çağrılır) ────────────── */

/**
 * Rota geometrisi boyunca maksimum `maxDistM` metreye kadar olan noktaları döner.
 * Geometry formatı: [[lon, lat], ...] (OSRM / offline-worker ile uyumlu)
 */
export function sliceCorridorByDistance(
  geometry: [number, number][],
  maxDistM: number,
): [number, number][] {
  if (!geometry.length) return [];
  let dist = 0;
  const out: [number, number][] = [geometry[0]];
  for (let i = 1; i < geometry.length; i++) {
    const [lon0, lat0] = geometry[i - 1];
    const [lon1, lat1] = geometry[i];
    dist += _havM(lat0, lon0, lat1, lon1);
    out.push(geometry[i]);
    if (dist >= maxDistM) break;
  }
  return out;
}

/**
 * Rota noktaları + `bufferDeg` tampon için tile koordinatlarını hesaplar.
 * Her [lon,lat] noktasının ±bufferDeg dikdörtgen alanındaki tüm tile'ları üretir.
 */
export function computeCorridorTiles(
  geometry:  [number, number][],
  bufferDeg: number = CORRIDOR_BUFFER_DEG,
  zoomMin:   number = TILE_ZOOM_MIN,
  zoomMax:   number = TILE_ZOOM_MAX,
): TileCoord[] {
  const seen = new Set<string>();
  const out:  TileCoord[] = [];

  for (const [lon, lat] of geometry) {
    for (let z = zoomMin; z <= zoomMax; z++) {
      // Dikdörtgen bbox köşelerini tile koordinatlarına çevir
      const { x: x0, y: y0 } = _tileXY(lat + bufferDeg, lon - bufferDeg, z);
      const { x: x1, y: y1 } = _tileXY(lat - bufferDeg, lon + bufferDeg, z);
      const xMin = Math.min(x0, x1), xMax = Math.max(x0, x1);
      const yMin = Math.min(y0, y1), yMax = Math.max(y0, y1);
      for (let x = xMin; x <= xMax; x++) {
        for (let y = yMin; y <= yMax; y++) {
          const key = `${z}/${x}/${y}`;
          if (!seen.has(key)) { seen.add(key); out.push({ z, x, y }); }
        }
      }
    }
  }
  return out;
}

/**
 * Rota boyunca offlineDataService'in POI_GRID_DEG (0.18°) gridine snap edilmiş
 * benzersiz bölge koordinatlarını döner.
 */
export function computeCorridorPOIRegions(
  geometry: [number, number][],
): Array<{ lat: number; lon: number }> {
  const seen = new Set<string>();
  const out: Array<{ lat: number; lon: number }> = [];

  for (const [lon, lat] of geometry) {
    const gLat = Math.round(lat / POI_GRID_DEG) * POI_GRID_DEG;
    const gLon = Math.round(lon / POI_GRID_DEG) * POI_GRID_DEG;
    const key  = `${gLat.toFixed(3)}:${gLon.toFixed(3)}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push({ lat: gLat, lon: gLon });
    }
  }
  return out;
}

/* ── CorridorSyncEngine ──────────────────────────────────────────────────── */

function _geoHash(g: [number, number][]): string {
  if (!g.length) return '';
  const step = Math.max(1, Math.floor((g.length - 1) / (GEOMETRY_HASH_SAMPLE - 1)));
  return [0, step, g.length - 1]
    .map(i => `${(g[Math.min(i, g.length - 1)][0]).toFixed(3)},${(g[Math.min(i, g.length - 1)][1]).toFixed(3)}`)
    .join('|');
}

export class CorridorSyncEngine {
  private _queue        = new BackgroundFetchQueue();
  private _active       = false;
  private _lastGeoHash  = '';
  private _initialDone  = false;

  /** Navigasyon ACTIVE geçişinde çağrılır. */
  activate(): void {
    this._active      = true;
    this._initialDone = false;
    this._lastGeoHash = '';
  }

  /**
   * Her GPS güncellemesinde çağrılır; geometry değiştiyse indirme planını yeniler.
   * Geometry formatı: [[lon, lat], ...] (OSRM/offline-worker ile uyumlu)
   */
  onGeometryUpdate(geometry: [number, number][], speedKmh: number): void {
    if (!this._active || !geometry.length) return;

    const hash = _geoHash(geometry);
    const isNewRoute = hash !== this._lastGeoHash;
    this._lastGeoHash = hash;

    // İlk geometry veya yeniden rotalama → indirme planını tetikle
    if (isNewRoute || !this._initialDone) {
      this._scheduleSync(geometry, speedKmh);
      this._initialDone = true;
    }
  }

  /** Araç hızı değiştiğinde Critical Corridor sınırını günceller. */
  updateSpeed(speedKmh: number): void {
    // Kuyruk aktif çalışıyorsa hız güncellemesi bir sonraki geometry güncellemeyle gelecek
    // Şimdilik no-op (navigationService onGeometryUpdate'i zaten her tick çağırıyor)
    void speedKmh;
  }

  /** Navigasyon durdu — kuyruk temizle, state sıfırla, koruma kaldır. */
  stop(): void {
    this._active      = false;
    this._lastGeoHash = '';
    this._initialDone = false;
    this._queue.clear();
    cacheLRUManager.clearCorridorProtection();
  }

  get pendingJobs(): number  { return this._queue.pending; }
  get isActive():   boolean  { return this._active; }

  private _scheduleSync(geometry: [number, number][], speedKmh: number): void {
    if (!isFeatureEnabled('corridorPrefetch')) return;
    if (!_isOnline()) return;

    // Hız uyarlaması
    const highSpeed   = speedKmh >= HIGH_SPEED_KMH;
    const maxDistM    = highSpeed ? CRITICAL_CORRIDOR_M : Infinity;
    const corridor    = sliceCorridorByDistance(geometry, maxDistM);
    const first5km    = sliceCorridorByDistance(geometry, 5_000);

    /* ── 1. POI bölgeleri (Priority: 1 — veri küçük, her bağlantıda indir) ── */
    const poiRegions = computeCorridorPOIRegions(corridor);
    for (const { lat, lon } of poiRegions) {
      const id = `poi:${lat.toFixed(3)}:${lon.toFixed(3)}`;
      this._queue.enqueue({
        id,
        priority: 1,
        execute:  async (signal) => {
          if (!_isOnline()) return;
          try { await downloadRegion(lat, lon, signal); } catch (e) { _recordCorridorAbortIfNeeded(e); }
        },
      });
    }

    /* ── 2. Tile'lar (Priority: 2 — yalnızca WiFi; hücresel veri koruması) ── */
    // Yüksek hızda: düşük zoom (10-12), yalnızca ilk 5km
    // Normal hızda: tam zoom (10-13), tüm koridor
    const tileMaxZoom = highSpeed ? 12 : TILE_ZOOM_MAX;
    const tilePts     = highSpeed ? first5km : corridor;
    const tiles       = computeCorridorTiles(tilePts, CORRIDOR_BUFFER_DEG, TILE_ZOOM_MIN, tileMaxZoom);

    // CacheLRUManager'da koridor tile'larını koru (eviction yasağı)
    cacheLRUManager.markCorridorProtected(tiles.map(t => `${t.z}/${t.x}/${t.y}`));

    for (const { z, x, y } of tiles) {
      this._queue.enqueue({
        id:       `tile:${z}/${x}/${y}`,
        priority: 2,
        execute:  async (signal) => {
          if (!_isOnline() || _isCellular()) return; // hücresel → atla
          const hosts = ['a', 'b', 'c'] as const;
          const host  = hosts[Math.floor(Math.random() * 3)];
          try {
            await fetch(`https://${host}.tile.openstreetmap.org/${z}/${x}/${y}.png`, {
              signal,
              headers: { Accept: 'image/png', 'User-Agent': 'CarosPro/1.0' },
              cache:   'force-cache',
            });
          } catch (e) { _recordCorridorAbortIfNeeded(e); }
        },
      });
    }
  }
}

/** Singleton — navigationService tarafından kullanılır. */
export const corridorSync = new CorridorSyncEngine();
