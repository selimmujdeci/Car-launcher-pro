import { dispatchPOISearch, closeWorkerDatabase } from './offlineRoutingService';
import type { POIWorkerResult } from './offlineRoutingService';
import { safeGetRaw } from '../utils/safeStorage';
import { registerCachePurge } from './memoryWatchdog';

/**
 * Offline Search Service — İnternet olmadan geocoding fallback.
 *
 * İki katmanlı strateji:
 *   1. Bulanık Arama (Fuzzy): IndexedDB'deki geçmiş/favoriler arasında
 *      Sørensen-Dice trigram benzerliği ile anında (<10ms) arama.
 *   2. commandExecutor / addressNavigationEngine entegrasyonu:
 *      resolveAndNavigate() önce bu servisi çağırır, 0 sonuç dönerse
 *      online geocoder'a geçer.
 *
 * Türkçe karakter normalize edilir: İ/ı→i, Ş→s, Ğ→g, Ü→u, Ö→o, Ç→c
 *
 * IndexedDB erişimi private/kısıtlı modda başarısız olabilir;
 * her operasyon sessizce hata yönetir.
 */

/* ── Types ────────────────────────────────────────────────── */

export type LocationSource =
  | 'search'      // kullanıcı arama geçmişi
  | 'favorite'    // yer favorisi
  | 'navigation'  // daha önce navigasyon başlatıldı
  | 'home'        // ev konumu
  | 'work';       // iş konumu

export interface StoredLocation {
  id:         string;
  name:       string;       // görüntülenen isim
  address?:   string;       // tam adres
  lat:        number;
  lng:        number;
  source:     LocationSource;
  queryText?: string;       // arama sorgusunun ham metni
  timestamp:  number;
  useCount:   number;
}

export interface OfflineSearchResult {
  location:  StoredLocation;
  score:     number;        // 0–1 benzerlik puanı
  matchedBy: 'exact' | 'fuzzy' | 'prefix' | 'coords';
}

/* ── IndexedDB ────────────────────────────────────────────── */

const DB_NAME    = 'car-launcher-locations-v1';
const STORE_NAME = 'locations';
const DB_VERSION = 1;

// SafeStorage anahtarı: poi.db başarıyla indirildiğinde bu key set edilir.
// Anahtar varken poi.db yüklenemezse "Offline Veri Eksik" uyarısı tetiklenir.
const POI_DB_MANIFEST_KEY = 'poi.db.manifest';

// RAM CRITICAL sinyalinde Worker'daki SQLite bağlantısını temiz kapat.
// Zero-Leak: registerCachePurge thunk döner ancak modül ömrü boyunca aktif.
registerCachePurge(() => closeWorkerDatabase());

let _db: IDBDatabase | null = null;

async function openDB(): Promise<IDBDatabase | null> {
  if (_db) return _db;
  if (typeof indexedDB === 'undefined') return null;

  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION);

      req.onupgradeneeded = (e) => {
        const db    = (e.target as IDBOpenDBRequest).result;
        if (db.objectStoreNames.contains(STORE_NAME)) return;
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('timestamp', 'timestamp', { unique: false });
        store.createIndex('source',    'source',    { unique: false });
      };

      req.onsuccess = (e) => {
        _db = (e.target as IDBOpenDBRequest).result;
        // Beklenmedik DB kapatılmasını yakala
        _db.onclose = () => { _db = null; };
        resolve(_db);
      };

      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

function idbGet(db: IDBDatabase, id: string): Promise<StoredLocation | undefined> {
  return new Promise((res) => {
    try {
      const req = db.transaction(STORE_NAME, 'readonly')
        .objectStore(STORE_NAME)
        .get(id);
      req.onsuccess = () => res(req.result as StoredLocation | undefined);
      req.onerror   = () => res(undefined);
    } catch { res(undefined); }
  });
}

function idbPut(db: IDBDatabase, loc: StoredLocation): Promise<void> {
  return new Promise((res) => {
    try {
      const req = db.transaction(STORE_NAME, 'readwrite')
        .objectStore(STORE_NAME)
        .put(loc);
      req.onsuccess = () => res();
      req.onerror   = () => res();
    } catch { res(); }
  });
}

function idbGetAll(db: IDBDatabase): Promise<StoredLocation[]> {
  return new Promise((res) => {
    try {
      const req = db.transaction(STORE_NAME, 'readonly')
        .objectStore(STORE_NAME)
        .getAll();
      req.onsuccess = () => res((req.result as StoredLocation[]) ?? []);
      req.onerror   = () => res([]);
    } catch { res([]); }
  });
}

function idbDelete(db: IDBDatabase, id: string): Promise<void> {
  return new Promise((res) => {
    try {
      const req = db.transaction(STORE_NAME, 'readwrite')
        .objectStore(STORE_NAME)
        .delete(id);
      req.onsuccess = () => res();
      req.onerror   = () => res();
    } catch { res(); }
  });
}

/* ── Türkçe normalize ─────────────────────────────────────── */

const TR_MAP: Record<string, string> = {
  'İ': 'i', 'ı': 'i', 'Ş': 's', 'ş': 's',
  'Ğ': 'g', 'ğ': 'g', 'Ü': 'u', 'ü': 'u',
  'Ö': 'o', 'ö': 'o', 'Ç': 'c', 'ç': 'c',
};

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[İışŞğĞüÜöÖçÇ]/g, (c) => TR_MAP[c] ?? c)
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/* ── Trigram fuzzy scoring ────────────────────────────────── */

function trigrams(text: string): Set<string> {
  const padded = `  ${text}  `;
  const set    = new Set<string>();
  for (let i = 0; i < padded.length - 2; i++) {
    set.add(padded.slice(i, i + 3));
  }
  return set;
}

function diceSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b)  return 1;

  const ta = trigrams(a);
  const tb = trigrams(b);
  if (ta.size === 0 || tb.size === 0) return 0;

  let intersection = 0;
  for (const t of ta) { if (tb.has(t)) intersection++; }
  return (2 * intersection) / (ta.size + tb.size);
}

function scoreLocation(query: string, loc: StoredLocation): { score: number; matchedBy: OfflineSearchResult['matchedBy'] } {
  const q     = normalize(query);
  const name  = normalize(loc.name);
  const addr  = normalize(loc.address ?? '');
  const qtext = normalize(loc.queryText ?? '');

  // Exact match
  if (name === q || addr === q || qtext === q) return { score: 1.0, matchedBy: 'exact' };

  // Prefix match — name starts with query
  if (name.startsWith(q) || addr.startsWith(q)) {
    return { score: 0.9, matchedBy: 'prefix' };
  }

  // Substring: query is contained in name
  if (name.includes(q) || addr.includes(q)) {
    return { score: 0.80, matchedBy: 'prefix' };
  }

  // Fuzzy trigram
  const nameScore  = diceSimilarity(q, name);
  const addrScore  = diceSimilarity(q, addr);
  const queryScore = diceSimilarity(q, qtext);
  const best       = Math.max(nameScore, addrScore, queryScore);

  if (best < 0.2) return { score: 0, matchedBy: 'fuzzy' };

  // Boost frequently used locations
  const usageBoost = Math.min(0.05, loc.useCount * 0.01);
  // Recency boost: locations used within 7 days score higher
  const ageDays    = (Date.now() - loc.timestamp) / 86_400_000;
  const recency    = ageDays < 7 ? 0.05 : 0;

  return { score: Math.min(1, best + usageBoost + recency), matchedBy: 'fuzzy' };
}

/* ── Public API ───────────────────────────────────────────── */

/**
 * IndexedDB'deki geçmiş ve favorilerde bulanık arama yap.
 * İnternet olmadan anında (<10ms) sonuç döndürür.
 */
export async function searchOffline(
  query:      string,
  maxResults: number = 5,
): Promise<OfflineSearchResult[]> {
  if (!query.trim()) return [];

  const db = await openDB();
  if (!db) return [];

  const all = await idbGetAll(db);
  const results: OfflineSearchResult[] = [];

  for (const loc of all) {
    const { score, matchedBy } = scoreLocation(query, loc);
    if (score >= 0.2) results.push({ location: loc, score, matchedBy });
  }

  return results
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults);
}

/**
 * Yeni bir konum kaydet (arama geçmişi / favori / navigasyon).
 * Aynı id varsa useCount arttırılır ve timestamp güncellenir.
 */
export async function saveLocation(
  entry: Omit<StoredLocation, 'id' | 'timestamp' | 'useCount'>,
): Promise<void> {
  const db = await openDB();
  if (!db) return;

  // id: name + lat + lng parmak izi
  const id = `${normalize(entry.name)}_${entry.lat.toFixed(4)}_${entry.lng.toFixed(4)}`;

  const existing = await idbGet(db, id);
  const loc: StoredLocation = {
    ...entry,
    id,
    timestamp: Date.now(),
    useCount:  (existing?.useCount ?? 0) + 1,
  };
  await idbPut(db, loc);
}

/**
 * Kullanıcı arama metni + geocode sonucunu kaydet.
 * commandExecutor/addressNavigationEngine'den çağrılır.
 */
export async function saveSearchQuery(
  queryText: string,
  result:    { name: string; lat: number; lng: number; address?: string },
): Promise<void> {
  return saveLocation({
    name:      result.name,
    address:   result.address,
    lat:       result.lat,
    lng:       result.lng,
    source:    'search',
    queryText,
  });
}

/**
 * Ev / iş konumunu offline arama veritabanına kaydet.
 * useStore değiştiğinde çağrılmalı.
 */
export async function syncHomeWork(
  home?: { lat: number; lng: number } | null,
  work?: { lat: number; lng: number } | null,
): Promise<void> {
  if (home) {
    await saveLocation({ name: 'Ev', lat: home.lat, lng: home.lng, source: 'home' });
  }
  if (work) {
    await saveLocation({ name: 'İş', lat: work.lat, lng: work.lng, source: 'work' });
  }
}

/**
 * Son kullanılan konumları döndür (en yeniden en eskiye).
 */
export async function getRecentLocations(limit: number = 10): Promise<StoredLocation[]> {
  const db = await openDB();
  if (!db) return [];

  const all = await idbGetAll(db);
  return all
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, limit);
}

/**
 * Belirtilen süreden eski search/navigation kayıtlarını sil.
 * Favoriler, ev ve iş konumları korunur.
 * Write-throttle: bunu sık çağırma — uygulama açılışında 1x yeter.
 */
export async function clearOldEntries(olderThanDays: number = 30): Promise<void> {
  const db = await openDB();
  if (!db) return;

  const cutoff = Date.now() - olderThanDays * 86_400_000;
  const all    = await idbGetAll(db);

  const toDelete = all.filter(
    (loc) =>
      loc.timestamp < cutoff &&
      loc.source !== 'favorite' &&
      loc.source !== 'home' &&
      loc.source !== 'work',
  );

  for (const loc of toDelete) {
    await idbDelete(db, loc.id);
  }
}

/**
 * Tüm veritabanını temizle (ayarlar → depolama temizleme).
 */
export async function clearAllLocations(): Promise<void> {
  const db = await openDB();
  if (!db) return;

  const all = await idbGetAll(db);
  for (const loc of all) {
    await idbDelete(db, loc.id);
  }
}

/* ── SQLite WASM FTS5 POI Arama ──────────────────────────────────────────── */

export interface POISearchResult {
  id:       string;
  name:     string;
  address:  string;
  lat:      number;
  lon:      number;
  score:    number;
  category: string;
  source:   'sqlite-fts5' | 'indexeddb';
}

// SAB layout sabitleri — NavigationCompute.worker.ts ile senkron
// İKİ DOSYADA DA DEĞİŞTİRİLMELİ
export const POI_SAB_HEADER = 8;
export const POI_SAB_STRIDE = 256;
export const POI_SAB_MAX    = 20;
const _OFF_NAME  = 0;  const _LEN_NAME  = 64;
const _OFF_ADDR  = 64; const _LEN_ADDR  = 64;
const _OFF_LAT   = 128;
const _OFF_LON   = 136;
const _OFF_SCORE = 144;
const _OFF_CAT   = 148; const _LEN_CAT  = 32;
const _OFF_ID    = 180; const _LEN_ID   = 32;

const _dec = new TextDecoder();

function _readStr(u8: Uint8Array, base: number, off: number, len: number): string {
  const slice = u8.subarray(base + off, base + off + len);
  const end   = slice.indexOf(0);
  return _dec.decode(end < 0 ? slice : slice.subarray(0, end));
}

/**
 * SharedArrayBuffer'ı POISearchResult dizisine çözer.
 * Zero-copy transfer sonrası main thread tarafında çağrılır.
 */
export function decodePOISAB(sab: SharedArrayBuffer, count: number): POISearchResult[] {
  const view   = new DataView(sab);
  const u8     = new Uint8Array(sab);
  const actual = Math.min(count, POI_SAB_MAX, Math.floor((sab.byteLength - POI_SAB_HEADER) / POI_SAB_STRIDE));
  const out: POISearchResult[] = [];

  for (let i = 0; i < actual; i++) {
    const base = POI_SAB_HEADER + i * POI_SAB_STRIDE;
    out.push({
      name:     _readStr(u8, base, _OFF_NAME,  _LEN_NAME),
      address:  _readStr(u8, base, _OFF_ADDR,  _LEN_ADDR),
      lat:      view.getFloat64(base + _OFF_LAT,  true),
      lon:      view.getFloat64(base + _OFF_LON,  true),
      score:    view.getFloat32(base + _OFF_SCORE, true),
      category: _readStr(u8, base, _OFF_CAT,   _LEN_CAT),
      id:       _readStr(u8, base, _OFF_ID,    _LEN_ID),
      source:   'sqlite-fts5',
    });
  }
  return out;
}

function _allocPOISAB(maxResults: number): SharedArrayBuffer | null {
  if (typeof SharedArrayBuffer === 'undefined') return null;
  try {
    return new SharedArrayBuffer(POI_SAB_HEADER + maxResults * POI_SAB_STRIDE);
  } catch {
    return null;
  }
}

/**
 * SQLite FTS5 tabanlı POI araması — NavigationCompute Worker üzerinden çalışır.
 * Ana thread hiçbir zaman veritabanı sorgusu yapmaz.
 *
 * - SharedArrayBuffer mevcut ise: zero-copy protokolü (SAB → decodePOISAB)
 * - Mevcut değilse: JSON fallback (POIWorkerResult[] mesajla gönderilir)
 * - poi.db yüklenemezse: boş dizi döner (graceful degrade)
 *
 * poi.db şeması (FTS5):
 *   CREATE VIRTUAL TABLE poi_fts USING fts5(
 *     id UNINDEXED, name, address,
 *     lat UNINDEXED, lon UNINDEXED, category UNINDEXED,
 *     tokenize = "unicode61 remove_diacritics 2"
 *   );
 */
export async function searchPOI(
  query:   string,
  options: { lat?: number; lon?: number; maxResults?: number } = {},
): Promise<POISearchResult[]> {
  if (!query.trim()) return [];
  const max = Math.min(options.maxResults ?? 10, POI_SAB_MAX);
  const sab = _allocPOISAB(max);

  const { count, results, dbError } = await dispatchPOISearch(
    query,
    options.lat,
    options.lon,
    max,
    sab,
  );

  // poi.db yükleme hatası + manifest mevcutsa → veri eksik uyarısı
  if (dbError && typeof window !== 'undefined') {
    const manifest = safeGetRaw(POI_DB_MANIFEST_KEY);
    if (manifest !== null) {
      window.dispatchEvent(new CustomEvent('caros:offline-data-missing', {
        detail: { source: 'poi.db', manifest },
      }));
    }
  }

  if (count === 0) return [];

  // Zero-copy path: SAB'dan oku
  if (sab) return decodePOISAB(sab, count);

  // JSON fallback: doğrudan mesajdan dönüştür
  return (results ?? []).map((r: POIWorkerResult): POISearchResult => ({
    ...r,
    source: 'sqlite-fts5',
  }));
}
