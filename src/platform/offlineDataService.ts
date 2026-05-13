/**
 * Offline POI Service — Bölgesel LRU Cache
 *
 * Mimari:
 * - Bounding-box tile'lar (~20 km yarıçap, ~0.18° grid)
 * - LRU eviction: maks 25 bölge / 50.000 kayıt
 * - Overpass API: rate-limited, sadece internet varken
 * - Offline'da mevcut cache'den cevap verir
 * - Kategoriler: neighbourhood | fuel | hospital | service | parking
 *
 * Yasak:
 * - Tüm Türkiye toplu indirme
 * - Arka plan sürekli polling
 * - Limitsiz IndexedDB büyütme
 */

const DB_NAME       = 'caros-offline-places-v2';
const PLACES_STORE  = 'places';
const REGIONS_STORE = 'regions';
const META_KEY      = 'caros-offline-meta-v2';

const MAX_REGIONS    = 25;
const MAX_PLACES     = 50_000;
const REGION_TTL_MS  = 14 * 24 * 60 * 60 * 1000; // 14 gün
const RADIUS_DEG     = 0.18;                        // ~20 km
const RATE_LIMIT_MS  = 3_000;                       // Overpass min aralık

/* ── Tipler ──────────────────────────────────────────────── */

export type PoiCategory = 'neighbourhood' | 'fuel' | 'hospital' | 'service' | 'parking';

export interface OfflinePlace {
  id:        string;
  name:      string;
  nameNorm:  string;
  category:  PoiCategory;
  lat:       number;
  lon:       number;
  regionKey: string;
}

export interface CachedRegion {
  key:            string;
  centerLat:      number;
  centerLon:      number;
  downloadedAt:   number;
  lastAccessedAt: number;
  placeCount:     number;
}

export interface OfflineCacheMeta {
  totalPlaces:  number;
  totalRegions: number;
  regions:      CachedRegion[];
}

/* ── Türkçe normalize ────────────────────────────────────── */

const _TR: Record<string, string> = {
  'İ':'i','ı':'i','Ş':'s','ş':'s','Ğ':'g','ğ':'g',
  'Ü':'u','ü':'u','Ö':'o','ö':'o','Ç':'c','ç':'c',
};

export function normalizeTR(s: string): string {
  return s.toLowerCase()
    .replace(/[İışŞğĞüÜöÖçÇ]/g, c => _TR[c] ?? c)
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/* ── Grid snap (bölge anahtarı) ──────────────────────────── */

function _regionKey(lat: number, lon: number): string {
  const gLat = Math.round(lat / RADIUS_DEG) * RADIUS_DEG;
  const gLon = Math.round(lon / RADIUS_DEG) * RADIUS_DEG;
  return `${gLat.toFixed(3)}:${gLon.toFixed(3)}`;
}

function _snapCoord(v: number): number {
  return Math.round(v / RADIUS_DEG) * RADIUS_DEG;
}

/* ── IndexedDB ───────────────────────────────────────────── */

let _db: IDBDatabase | null = null;

async function _openDB(): Promise<IDBDatabase | null> {
  if (_db) return _db;
  if (typeof indexedDB === 'undefined') return null;
  return new Promise(resolve => {
    try {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = e => {
        const db = (e.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(PLACES_STORE)) {
          const ps = db.createObjectStore(PLACES_STORE, { keyPath: 'id' });
          ps.createIndex('nameNorm',  'nameNorm',  { unique: false });
          ps.createIndex('category',  'category',  { unique: false });
          ps.createIndex('regionKey', 'regionKey', { unique: false });
        }
        if (!db.objectStoreNames.contains(REGIONS_STORE)) {
          db.createObjectStore(REGIONS_STORE, { keyPath: 'key' });
        }
      };
      req.onsuccess = e => {
        _db = (e.target as IDBOpenDBRequest).result;
        _db.onclose = () => { _db = null; };
        resolve(_db);
      };
      req.onerror = () => resolve(null);
    } catch { resolve(null); }
  });
}

/* ── Bölge CRUD ──────────────────────────────────────────── */

async function _getAllRegions(db: IDBDatabase): Promise<CachedRegion[]> {
  return new Promise(resolve => {
    const req = db.transaction(REGIONS_STORE, 'readonly')
      .objectStore(REGIONS_STORE).getAll();
    req.onsuccess = () => resolve((req.result ?? []) as CachedRegion[]);
    req.onerror   = () => resolve([]);
  });
}

async function _getRegion(db: IDBDatabase, key: string): Promise<CachedRegion | null> {
  return new Promise(resolve => {
    const req = db.transaction(REGIONS_STORE, 'readonly')
      .objectStore(REGIONS_STORE).get(key);
    req.onsuccess = () => resolve((req.result as CachedRegion) ?? null);
    req.onerror   = () => resolve(null);
  });
}

async function _saveRegion(db: IDBDatabase, r: CachedRegion): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(REGIONS_STORE, 'readwrite');
    tx.objectStore(REGIONS_STORE).put(r);
    tx.oncomplete = () => resolve();
    tx.onerror    = () => reject(tx.error);
  });
}

async function _deleteRegion(db: IDBDatabase, key: string): Promise<void> {
  // Bölgeye ait place'leri sil
  await new Promise<void>((resolve, reject) => {
    const tx    = db.transaction(PLACES_STORE, 'readwrite');
    const index = tx.objectStore(PLACES_STORE).index('regionKey');
    const req   = index.openCursor(IDBKeyRange.only(key));
    req.onsuccess = e => {
      const cur = (e.target as IDBRequest<IDBCursorWithValue | null>).result;
      if (cur) { cur.delete(); cur.continue(); }
    };
    tx.oncomplete = () => resolve();
    tx.onerror    = () => reject(tx.error);
  });
  // Bölge meta kaydını sil
  await new Promise<void>(resolve => {
    const tx = db.transaction(REGIONS_STORE, 'readwrite');
    tx.objectStore(REGIONS_STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror    = () => resolve();
  });
}

/* ── LRU eviction ────────────────────────────────────────── */

async function _evictIfNeeded(db: IDBDatabase): Promise<void> {
  const regions = await _getAllRegions(db);
  const totalPlaces: number = await new Promise(resolve => {
    const req = db.transaction(PLACES_STORE, 'readonly')
      .objectStore(PLACES_STORE).count();
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => resolve(0);
  });

  // En eski erişileni önce sil (LRU)
  regions.sort((a, b) => a.lastAccessedAt - b.lastAccessedAt);

  let nRegions = regions.length;
  let nPlaces  = totalPlaces;

  for (const region of regions) {
    if (nRegions < MAX_REGIONS && nPlaces < MAX_PLACES) break;
    await _deleteRegion(db, region.key);
    nRegions--;
    nPlaces -= region.placeCount;
  }
}

/* ── Overpass sorgusu ────────────────────────────────────── */

type _OverpassEl = {
  type: string; id: number;
  lat?: number; lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
};

let _lastOverpassMs = 0;

async function _fetchOverpass(
  centerLat: number,
  centerLon: number,
  signal?: AbortSignal,
): Promise<OfflinePlace[]> {
  // Rate limit: Overpass'a min 3 sn arayla
  const gap = _lastOverpassMs + RATE_LIMIT_MS - Date.now();
  if (gap > 0) await new Promise(r => setTimeout(r, gap));
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  _lastOverpassMs = Date.now();

  const minLat = (centerLat - RADIUS_DEG).toFixed(6);
  const minLon = (centerLon - RADIUS_DEG).toFixed(6);
  const maxLat = (centerLat + RADIUS_DEG).toFixed(6);
  const maxLon = (centerLon + RADIUS_DEG).toFixed(6);
  const bbox   = `${minLat},${minLon},${maxLat},${maxLon}`;

  const q = [
    '[out:json][timeout:30];(',
    `node["place"~"^(suburb|neighbourhood|quarter|village|hamlet|town|city)$"](${bbox});`,
    `node["amenity"~"^(fuel|hospital|pharmacy|parking|car_wash|car_repair)$"](${bbox});`,
    `way["amenity"~"^(fuel|hospital|pharmacy|parking)$"](${bbox});`,
    ');out center body;',
  ].join('');

  const res = await fetch(
    `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(q)}`,
    { signal, headers: { 'User-Agent': 'CarosPro/1.0' } },
  );
  if (!res.ok) throw new Error(`Overpass HTTP ${res.status}`);

  const data  = await res.json() as { elements: _OverpassEl[] };
  const rKey  = _regionKey(centerLat, centerLon);
  const places: OfflinePlace[] = [];

  for (const el of data.elements) {
    const lat = el.lat ?? el.center?.lat;
    const lon = el.lon ?? el.center?.lon;
    if (lat == null || lon == null) continue;
    const name = el.tags?.name ?? el.tags?.brand ?? el.tags?.operator;
    if (!name) continue;

    const amenity = el.tags?.amenity ?? '';
    const place   = el.tags?.place   ?? '';
    let category: PoiCategory;

    if (amenity === 'fuel')                                       category = 'fuel';
    else if (amenity === 'hospital' || amenity === 'pharmacy')    category = 'hospital';
    else if (amenity === 'parking')                               category = 'parking';
    else if (amenity === 'car_wash' || amenity === 'car_repair')  category = 'service';
    else if (place)                                               category = 'neighbourhood';
    else continue;

    places.push({ id: `${el.type}/${el.id}`, name, nameNorm: normalizeTR(name), category, lat, lon, regionKey: rKey });
  }
  return places;
}

/* ── Place kaydetme ──────────────────────────────────────── */

async function _storePlaces(db: IDBDatabase, places: OfflinePlace[]): Promise<void> {
  if (!places.length) return;
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(PLACES_STORE, 'readwrite');
    const store = tx.objectStore(PLACES_STORE);
    for (const p of places) store.put(p);
    tx.oncomplete = () => resolve();
    tx.onerror    = () => reject(tx.error);
  });
}

/* ── Meta ────────────────────────────────────────────────── */

export function getOfflineMeta(): OfflineCacheMeta | null {
  try {
    const raw = localStorage.getItem(META_KEY);
    return raw ? (JSON.parse(raw) as OfflineCacheMeta) : null;
  } catch { return null; }
}

async function _refreshMeta(db: IDBDatabase): Promise<void> {
  const regions     = await _getAllRegions(db);
  const totalPlaces = regions.reduce((s, r) => s + r.placeCount, 0);
  try {
    localStorage.setItem(META_KEY, JSON.stringify({
      totalPlaces, totalRegions: regions.length, regions,
    } satisfies OfflineCacheMeta));
  } catch {}
}

/* ── PUBLIC: Bölge indir ─────────────────────────────────── */

/**
 * Verilen koordinat etrafında ~20 km'lik POI verisini indir.
 * Taze veri (<14 gün) varsa Overpass'a gitmez, sadece lastAccess günceller.
 */
export async function downloadRegion(
  lat:     number,
  lon:     number,
  signal?: AbortSignal,
): Promise<{ fetched: boolean; placeCount: number }> {
  const db = await _openDB();
  if (!db) throw new Error('IndexedDB açılamadı');

  const gLat    = _snapCoord(lat);
  const gLon    = _snapCoord(lon);
  const key     = `${gLat.toFixed(3)}:${gLon.toFixed(3)}`;
  const existing = await _getRegion(db, key);

  // Taze bölge: sadece erişim zamanını güncelle
  if (existing && Date.now() - existing.downloadedAt < REGION_TTL_MS) {
    await _saveRegion(db, { ...existing, lastAccessedAt: Date.now() });
    await _refreshMeta(db);
    return { fetched: false, placeCount: existing.placeCount };
  }

  // Eski bölge kayıtlarını temizle (LRU + limit)
  await _evictIfNeeded(db);

  // Overpass'tan ver çek
  const places = await _fetchOverpass(gLat, gLon, signal);

  // Eski bölge verisi varsa sil (yenileme)
  if (existing) await _deleteRegion(db, key);

  await _storePlaces(db, places);

  const region: CachedRegion = {
    key,
    centerLat:      gLat,
    centerLon:      gLon,
    downloadedAt:   Date.now(),
    lastAccessedAt: Date.now(),
    placeCount:     places.length,
  };
  await _saveRegion(db, region);
  await _refreshMeta(db);

  return { fetched: true, placeCount: places.length };
}

/* ── PUBLIC: Arama ───────────────────────────────────────── */

export async function searchOfflinePlaces(
  query:      string,
  maxResults: number        = 5,
  category?:  PoiCategory,
): Promise<OfflinePlace[]> {
  const db = await _openDB();
  if (!db) return [];
  const q = normalizeTR(query);
  if (!q) return [];

  return new Promise(resolve => {
    const results: OfflinePlace[] = [];
    const seen = new Set<string>();

    const tx    = db.transaction(PLACES_STORE, 'readonly');
    const index = tx.objectStore(PLACES_STORE).index('nameNorm');

    // Pass 1: prefix eşleşme
    const prefixReq = index.openCursor(IDBKeyRange.bound(q, q + '￿'));
    prefixReq.onsuccess = e => {
      const cur = (e.target as IDBRequest<IDBCursorWithValue | null>).result;
      if (cur && results.length < maxResults * 2) {
        const p = cur.value as OfflinePlace;
        if (!category || p.category === category) { seen.add(p.id); results.push(p); }
        cur.continue();
        return;
      }
      if (results.length >= maxResults) { resolve(results.slice(0, maxResults)); return; }

      // Pass 2: substring tarama
      const word   = q.split(' ').filter(w => w.length >= 2)[0] ?? q;
      const allReq = index.openCursor();
      allReq.onsuccess = e2 => {
        const c2 = (e2.target as IDBRequest<IDBCursorWithValue | null>).result;
        if (!c2 || results.length >= maxResults) { resolve(results.slice(0, maxResults)); return; }
        const p = c2.value as OfflinePlace;
        if (!seen.has(p.id) && p.nameNorm.includes(word) && (!category || p.category === category)) {
          seen.add(p.id); results.push(p);
        }
        c2.continue();
      };
      allReq.onerror = () => resolve(results.slice(0, maxResults));
    };
    prefixReq.onerror = () => resolve([]);
  });
}

/* ── PUBLIC: Temizle ─────────────────────────────────────── */

export async function clearOfflineData(): Promise<void> {
  const db = await _openDB();
  if (!db) return;
  await new Promise<void>(resolve => {
    const tx = db.transaction([PLACES_STORE, REGIONS_STORE], 'readwrite');
    tx.objectStore(PLACES_STORE).clear();
    tx.objectStore(REGIONS_STORE).clear();
    tx.oncomplete = () => { localStorage.removeItem(META_KEY); resolve(); };
    tx.onerror    = () => resolve();
  });
}

/* ── Otomatik bölge tetikleyici ──────────────────────────── */

let _lastAutoLat = 0;
let _lastAutoLon = 0;
let _lastAutoMs  = 0;
let _autoCtrl:   AbortController | null = null;

const AUTO_TRIGGER_KM  = 5;
const AUTO_COOLDOWN_MS = 120_000; // 2 dk minimum aralık

function _haversineKm(la1: number, lo1: number, la2: number, lo2: number): number {
  const R   = 6371;
  const dLa = (la2 - la1) * Math.PI / 180;
  const dLo = (lo2 - lo1) * Math.PI / 180;
  const a   = Math.sin(dLa / 2) ** 2 +
              Math.cos(la1 * Math.PI / 180) * Math.cos(la2 * Math.PI / 180) * Math.sin(dLo / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * GPS servisinden her konum güncellemesinde çağır.
 * İnternet varsa, >5 km hareket etmişse ve cooldown geçmişse
 * yeni bölgeyi sessizce indirir.
 */
export function triggerAutoDownload(lat: number, lon: number): void {
  if (!navigator.onLine) return;
  const now = Date.now();
  if (now - _lastAutoMs < AUTO_COOLDOWN_MS) return;
  if (_haversineKm(lat, lon, _lastAutoLat, _lastAutoLon) < AUTO_TRIGGER_KM && _lastAutoMs > 0) return;

  _lastAutoLat = lat;
  _lastAutoLon = lon;
  _lastAutoMs  = now;

  if (_autoCtrl) _autoCtrl.abort();
  _autoCtrl = new AbortController();
  const ctrl = _autoCtrl;

  downloadRegion(lat, lon, ctrl.signal).catch(() => { /* sessiz hata */ });
}
