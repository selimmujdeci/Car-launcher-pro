/**
 * Safe Storage — Merkezi Persistence Altyapısı
 *
 * CLAUDE.md §3 gereği:
 *  - Write Throttling: tüm yazımlar 4s debounce buffer üzerinden geçer
 *  - LRU Eviction:    kota dolunca önce crash log, sonra trip log silinir
 *  - Quota Handling:  QuotaExceededError sessizce yakalanır, uygulama devam eder
 *  - Atomic Flush:    beforeunload / pagehide → buffer anında diske alınır
 *
 * İki ayrı API:
 *   safeStorage          → Zustand StateStorage uyumlu (persist middleware)
 *   safeSetRaw / safeGetRaw → platform servisleri için düz string R/W
 *
 * Hiçbir servis doğrudan localStorage çağırmamalıdır — bu modül geçit noktasıdır.
 */

import type { StateStorage } from 'zustand/middleware';

/* ── LRU eviction sırası ─────────────────────────────────────── */

/**
 * Kota dolunca önce silinen anahtarlar (prefix veya tam eşleşme).
 * Sıra: en değersiz → en değerli.
 */
const LRU_EVICT_PREFIXES: string[] = [
  'cl_crash_log',           // geçici debug verisi — crashLogger
  'car-launcher-trip-log',  // yeniden üretilebilir trip geçmişi
  'car_map_offline',        // offline map tercih bayrağı
  'car-cache-',             // genel uygulama önbelleği
  'car-glyph-',             // harita font verileri
];

/** Bu anahtarlar hiçbir zaman LRU tarafından silinmez. */
const LRU_PROTECTED = new Set<string>([
  'car-launcher-storage',   // ana Zustand store
  'car-vehicle-store',      // araç profilleri
  'car-maintenance-store',  // bakım/TPMS
  'car-gps-last-known',     // son GPS konumu
  'cl_usageMap',
  'cl_usagePruneTs',
]);

/* ── CacheStorage temizleyici (best-effort) ──────────────────── */

function _evictCacheStorage(): void {
  if (typeof caches === 'undefined') return;
  caches.open('car-launcher-glyphs-v1').then((cache) =>
    cache.keys().then((keys) => {
      const cut = Math.ceil(keys.length * 0.2);
      return Promise.all(keys.slice(0, cut).map((r) => cache.delete(r)));
    }),
  ).catch(() => {});
  caches.delete('car-launcher-tiles-v1').catch(() => {});
}

/* ── LRU eviction ────────────────────────────────────────────── */

/**
 * Kota dolunca LRU sırasına göre en eski grubu siler.
 * @returns Silinen anahtar sayısı (0 = hiçbir şey silinemedi)
 */
export function safeLruEvict(): number {
  let evicted = 0;
  for (const prefix of LRU_EVICT_PREFIXES) {
    const toRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && !LRU_PROTECTED.has(k) && (k.startsWith(prefix) || k === prefix)) {
        toRemove.push(k);
      }
    }
    toRemove.forEach((k) => {
      try { localStorage.removeItem(k); evicted++; } catch { /* ignore */ }
    });
    if (evicted > 0) break; // tek grup silmek genellikle yeterli
  }
  if (evicted === 0) _evictCacheStorage();
  return evicted;
}

/* ── Disk yazma — quota-aware ────────────────────────────────── */

function _commitToStorage(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch (e) {
    if (e instanceof DOMException && (
      e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED'
    )) {
      safeLruEvict();
      try { localStorage.setItem(key, value); } catch { /* give up */ }
    }
  }
}

/* ── Write buffer ────────────────────────────────────────────── */

/**
 * CLAUDE.md §3: Yüksek frekanslı veri için yazım throttle 4–5 s bandında.
 * GPS (500ms), OBD (300ms), slider gibi rapid-fire kaynaklar
 * tek bir disk yazmasına indirgenir.
 */
const WRITE_DEBOUNCE_MS = 4_000;

interface BufferedWrite {
  value: string;
  timer: ReturnType<typeof setTimeout>;
}

const _writeBuffer = new Map<string, BufferedWrite>();

/** Tüm bekleyen yazımları hemen diske al — app kapatma senaryosu. */
export function safeFlushAll(): void {
  _writeBuffer.forEach(({ value, timer }, key) => {
    clearTimeout(timer);
    _commitToStorage(key, value);
  });
  _writeBuffer.clear();
}

/** Tek anahtarın bekleyen yazımını hemen diske al. */
export function safeFlushKey(key: string): void {
  const bw = _writeBuffer.get(key);
  if (!bw) return;
  clearTimeout(bw.timer);
  _writeBuffer.delete(key);
  _commitToStorage(key, bw.value);
}

/* ── Uygulama kapanma hook'ları ──────────────────────────────── */

if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', safeFlushAll);
  window.addEventListener('pagehide',     safeFlushAll); // iOS Safari
}

/* ── Raw string API (platform servisleri için) ───────────────── */

/**
 * Düz string değer yazar — 4s debounce buffer üzerinden.
 * gpsService, tripLogService gibi modüller bu API'yi kullanır.
 *
 * @param debounceMs Opsiyonel override — varsayılan WRITE_DEBOUNCE_MS
 */
export function safeSetRaw(key: string, value: string, debounceMs = WRITE_DEBOUNCE_MS): void {
  const existing = _writeBuffer.get(key);
  if (existing) {
    if (existing.value === value) return; // değişmedi — timer'ı sıfırlama
    clearTimeout(existing.timer);
  }
  const timer = setTimeout(() => {
    _writeBuffer.delete(key);
    _commitToStorage(key, value);
  }, debounceMs);
  _writeBuffer.set(key, { value, timer });
}

/**
 * Düz string değer okur.
 * Buffer'da bekleyen yazım varsa (disk'e gitmeden) onu döner — tutarlılık garantisi.
 */
export function safeGetRaw(key: string): string | null {
  const buffered = _writeBuffer.get(key);
  if (buffered) return buffered.value;
  try { return localStorage.getItem(key); } catch { return null; }
}

/**
 * Anahtarı siler — buffer'daki bekleyen yazımı iptal eder, localStorage'dan da kaldırır.
 */
export function safeRemoveRaw(key: string): void {
  const existing = _writeBuffer.get(key);
  if (existing) { clearTimeout(existing.timer); _writeBuffer.delete(key); }
  try { localStorage.removeItem(key); } catch { /* ignore */ }
}

/**
 * Buffer'ı bypass ederek doğrudan yazar — crash logger gibi
 * anlık kalıcılık gerektiren durumlar için.
 * Quota hatasında LRU devreye girer.
 */
export function safeSetRawImmediate(key: string, value: string): void {
  // Eğer buffer'da bekleyen yazım varsa iptal et (override)
  const existing = _writeBuffer.get(key);
  if (existing) { clearTimeout(existing.timer); _writeBuffer.delete(key); }
  _commitToStorage(key, value);
}

/* ── Zustand StateStorage uyumlu adapter ─────────────────────── */

/**
 * Zustand persist middleware için StateStorage uyumlu nesne.
 * createJSONStorage(() => safeStorage) ile sararak kullanın — Zustand 5
 * raw string API bekler; JSON.parse/stringify createJSONStorage tarafından
 * yapılır, bu nesne yalnızca ham string R/W sağlar.
 *
 * getItem: buffer'dan okur (debounce penceresinde güncel veri garantisi)
 * setItem: 4s buffer üzerinden yazar
 * removeItem: buffer iptal + anında sil
 */
export const safeStorage: StateStorage = {
  getItem(name: string): string | null {
    return safeGetRaw(name);
  },

  setItem(name: string, value: string): void {
    safeSetRaw(name, value);
  },

  removeItem(name: string): void {
    safeRemoveRaw(name);
  },
};

/* ── HMR cleanup ─────────────────────────────────────────────── */

if (import.meta.hot) {
  import.meta.hot.dispose(() => safeFlushAll());
}
