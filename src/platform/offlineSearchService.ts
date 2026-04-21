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
