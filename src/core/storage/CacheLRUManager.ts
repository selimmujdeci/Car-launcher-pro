/**
 * CacheLRUManager — MapLibre tile interceptor + LRU önbellek yöneticisi.
 *
 * Protokol: caros-tile://<host>/<path>  →  https://<host>/<path>
 *   - İlk istek: ağdan indir, Cache Storage'a kaydet.
 *   - Sonraki istek: yerel blob dön (ağ isteği yok).
 *
 * Limit: 500 MB — aşılırsa koridor-korumasız tile'lar LRU sırasına göre silinir.
 * Koridor koruması: sürüş devam ederken CorridorSyncEngine tarafından işaretlenen
 *   tile'lar eviction'dan muaf tutulur.
 *
 * İstatistikler: getCacheStats() → DevInspector "Cache Hit Rate" metriği.
 */

import maplibregl from 'maplibre-gl';
import { useDebugStore } from '../../platform/debug/debugStore';
import { DEVELOPER_FEATURES_ENABLED } from '../../platform/debug/developerFeatures';

/* ── Sabitler ─────────────────────────────────────────────────────────────── */

const CACHE_NAME    = 'caros-tiles-v1';
const DB_NAME       = 'caros-tile-manifest-v1';
const DB_STORE      = 'tiles';
const MAX_BYTES     = 500 * 1_024 * 1_024;  // 500 MB
const EVICT_TARGET  = MAX_BYTES * 0.85;     // %85'e inin (15% headroom)
const FLUSH_MS      = 30_000;               // manifest IndexedDB flush aralığı
const STATS_MS      = 5_000;               // debug store güncelleme aralığı
const PROTOCOL      = 'caros-tile';

// Karar TEK OTORİTEDEN gelir (yeniden hesaplanmaz) — bkz. platform/debug/developerFeatures.ts.
const _DEBUG_ACTIVE = DEVELOPER_FEATURES_ENABLED;

/* ── Manifest entry ───────────────────────────────────────────────────────── */

export interface TileManifestEntry {
  key:               string;   // 'z/x/y' tile kimliği
  url:               string;   // orijinal https:// URL
  size:              number;   // byte cinsinden boyut
  lastAccess:        number;   // ms timestamp — LRU sıralaması
  corridorProtected: boolean;  // sürüş bitene kadar silinemez
  insertedAt:        number;   // ilk eklenme zamanı
}

/* ── CacheLRUManager ─────────────────────────────────────────────────────── */

class CacheLRUManager {
  private _manifest    = new Map<string, TileManifestEntry>();
  private _totalBytes  = 0;
  private _hits        = 0;
  private _misses      = 0;
  private _db:         IDBDatabase | null = null;
  private _dirty       = false;
  private _flushTimer: ReturnType<typeof setTimeout> | null = null;
  private _statsTimer: ReturnType<typeof setInterval> | null = null;
  private _registered  = false;

  /* ── Başlatma ───────────────────────────────────────────────────── */

  /** mapService.initializeMap() öncesinde çağrılır — idempotent. */
  init(): void {
    if (this._registered) return;
    this._registered = true;

    // IndexedDB'yi arka planda yükle — protokol kaydı bunu beklemez
    void this._openDB().then(() => this._loadManifest()).catch(() => {});

    // caros-tile:// protokolünü kaydet
    try { maplibregl.removeProtocol(PROTOCOL); } catch { /* henüz kayıtlı değil */ }
    maplibregl.addProtocol(
      PROTOCOL,
      async (params: maplibregl.RequestParameters, abortController: AbortController) => {
        const url = params.url.replace(`${PROTOCOL}://`, 'https://');
        return this._handleTileRequest(url, abortController.signal);
      },
    );

    // Debug modda 5s'de bir stats güncelle
    if (_DEBUG_ACTIVE && this._statsTimer === null) {
      this._statsTimer = setInterval(() => {
        useDebugStore.getState().updateCacheStats(this.getCacheStats());
      }, STATS_MS);
    }
  }

  /**
   * Tüm zamanlayıcıları durdur ve protokol kaydını kaldır (Zero-Leak §1).
   * Prod'da nadiren çağrılır (singleton ömür-boyu) ama HMR / test re-init'te
   * orphan timer + çift protokol kaydını önler — idempotent.
   */
  dispose(): void {
    if (this._statsTimer !== null) { clearInterval(this._statsTimer); this._statsTimer = null; }
    if (this._flushTimer !== null) { clearTimeout(this._flushTimer); this._flushTimer = null; }
    try { maplibregl.removeProtocol(PROTOCOL); } catch { /* zaten kayıtlı değil */ }
    this._registered = false;
  }

  /** Navigasyon bitti — tüm koridor korumalarını kaldır. */
  clearCorridorProtection(): void {
    for (const entry of this._manifest.values()) {
      if (entry.corridorProtected) {
        entry.corridorProtected = false;
        this._dirty = true;
      }
    }
    this._scheduleFlush();
  }

  /**
   * CorridorSyncEngine tarafından çağrılır.
   * Sürüş boyunca bu tile'lar LRU eviction'dan muaf tutulur.
   */
  markCorridorProtected(tileKeys: string[]): void {
    for (const key of tileKeys) {
      const entry = this._manifest.get(key);
      if (entry && !entry.corridorProtected) {
        entry.corridorProtected = true;
        this._dirty = true;
      }
    }
    if (this._dirty) this._scheduleFlush();
  }

  /** DevInspector için anlık istatistikler. */
  getCacheStats(): { hits: number; misses: number; hitRate: number; totalBytes: number; tileCount: number } {
    const total   = this._hits + this._misses;
    const hitRate = total > 0 ? Math.round((this._hits / total) * 100) : 0;
    return {
      hits:       this._hits,
      misses:     this._misses,
      hitRate,
      totalBytes: this._totalBytes,
      tileCount:  this._manifest.size,
    };
  }

  /* ── Protocol handler ───────────────────────────────────────────── */

  private async _handleTileRequest(
    url:    string,
    signal: AbortSignal,
  ): Promise<{ data: ArrayBuffer }> {
    // Cache Storage'da var mı?
    //
    // #613 — SIFIR BAYTLIK İSABET, İSABET DEĞİLDİR (CİHAZDA ÖLÇÜLDÜ, 2026-08-17).
    // `new ArrayBuffer(0)` truthy'dir: eski `if (cached)` kapısı 0 baytlık bir
    // gövdeyi GEÇERLİ karo sayıyordu. MapLibre boş vektör karosunu sorunsuz
    // ayrıştırır → tile state `loaded`, **sıfır özellik**, HATA YOK → mini harita
    // sessizce bomboş kalır ve #609'un hata mandalı hiç tetiklenmez. Üstelik
    // 0 baytlık girdi `_totalBytes`i büyütmediği için LRU baskısıyla ASLA
    // düşmez → zehir KALICI olur. Cihazda ölçülen tam tablo: aynı z14 karosu
    // önbellekte `200 / 0 bayt`, canlı ağda `200 / 34 095 bayt`.
    const cached = await this._getFromCache(url);
    if (cached && cached.byteLength > 0) {
      this._hits++;
      this._touchLastAccess(url);
      return { data: cached };
    }
    if (cached) {
      // Zehirli girdi: ISABETSİZ say ve TEMİZLE (tembel onarım — `cache.keys()`
      // bu boyutta "Operation too large" attığı için toplu tarama YAPILAMAZ,
      // her karo ilk dokunuşunda kendi kendini onarır).
      void this._purgePoisoned(url);
    }

    // Cache miss → ağdan indir
    this._misses++;
    const res = await fetch(url, {
      signal,
      headers: { 'User-Agent': 'CarosPro/1.0 TileCache' },
    });
    if (!res.ok) throw new Error(`Tile HTTP ${res.status}`);
    const buffer = await res.arrayBuffer();
    // #613 — Boş gövde SESSİZCE DÖNDÜRÜLMEZ. Fırlatmak, MapLibre'nin tile'ı
    // `errored` işaretlemesini ve ürünün mevcut kurtarma yolunun (hata sayacı →
    // raster) çalışmasını sağlar. Eski davranış boş buffer'ı hem döndürüyor hem
    // ÖNBELLEĞE YAZIYORDU — zehrin kaynağı buydu.
    if (buffer.byteLength === 0) throw new Error('Tile empty (0 bayt)');
    /**
     * #613 — ZEHRİN KAYNAĞI: TRANSFER EDİLEN BUFFER (cihazda ölçüldü, 2026-08-17).
     *
     * MapLibre döndürdüğümüz `ArrayBuffer`ı vektör karosunu ayrıştırmak üzere
     * worker'a **transfer** eder; transfer edilen buffer bu iş parçacığında
     * DETACH olur ve `byteLength` 0'a düşer. `_putToCache` fire-and-forget
     * olduğu için `await caches.open(...)` noktasında sıra bırakır — o arada
     * detach gerçekleşir ve Cache Storage'a **boş gövde** yazılır.
     *
     * Sonuç (sahada ölçülen tam tablo): karo İLK açılışta çizilir, ama diskteki
     * kopyası 0 bayttır → sonraki her açılış boş karo servis eder → mini harita
     * kalıcı olarak bomboş. Girdi 0 bayt olduğu için LRU baskısı da onu düşürmez.
     * Bu kusur, düzeltmenin ilk turunda önbelleği TEMİZLEYİP hemen yeniden
     * zehirlediği için cihazda tekrar yakalandı (yeni içerik türüyle 0 bayt).
     *
     * ÇÖZÜM: önbelleğe KENDİ kopyamızı yaz. `slice(0)` detach'tan bağımsız yeni
     * bir buffer üretir; maliyeti karo başına tek memcpy (~34 KB) — ölçülebilir
     * bir yük değil. Kopya SENKRON alınır (await'ten önce), yoksa yarış sürer.
     */
    const cacheCopy = buffer.slice(0);
    void this._putToCache(url, cacheCopy);   // fire-and-forget
    return { data: buffer };
  }

  /** #613 — 0 baytlık (zehirli) önbellek girdisini sil; manifest kaydını da düşür. */
  private async _purgePoisoned(url: string): Promise<void> {
    try {
      if (typeof caches === 'undefined') return;
      const cache = await caches.open(CACHE_NAME);
      await cache.delete(url);
      const key   = _urlToKey(url);
      const entry = this._manifest.get(key);
      if (entry) {
        this._totalBytes -= entry.size;
        this._manifest.delete(key);
        this._dirty = true;
        this._scheduleFlush();
      }
    } catch { /* Cache Storage erişilemez — bir sonraki dokunuşta yine denenir */ }
  }

  /* ── Cache Storage ──────────────────────────────────────────────── */

  private async _getFromCache(url: string): Promise<ArrayBuffer | null> {
    try {
      if (typeof caches === 'undefined') return null;
      const cache = await caches.open(CACHE_NAME);
      const resp  = await cache.match(url);
      if (!resp) return null;
      return resp.arrayBuffer();
    } catch {
      return null;
    }
  }

  private async _putToCache(url: string, data: ArrayBuffer): Promise<void> {
    // #613 — Boş gövde ÖNBELLEĞE YAZILMAZ (savunma derinliği: çağıran zaten
    // fırlatıyor, ama bu satır zehrin bir daha ASLA diske inmemesini garanti eder).
    if (data.byteLength === 0) return;
    try {
      if (typeof caches === 'undefined') return;
      const cache = await caches.open(CACHE_NAME);
      // Vektör karosu PNG DEĞİLDİR — tür URL uzantısından türetilir.
      const contentType = url.includes('.pbf')
        ? 'application/vnd.mapbox-vector-tile'
        : 'image/png';
      await cache.put(
        url,
        new Response(data, { headers: { 'Content-Type': contentType } }),
      );

      const key   = _urlToKey(url);
      const now   = Date.now();
      const prev  = this._manifest.get(key);
      if (prev) {
        prev.lastAccess = now;
      } else {
        this._manifest.set(key, {
          key, url,
          size:               data.byteLength,
          lastAccess:         now,
          corridorProtected:  false,
          insertedAt:         now,
        });
        this._totalBytes += data.byteLength;
      }
      this._dirty = true;

      if (this._totalBytes > MAX_BYTES) void this._evictLRU();
      this._scheduleFlush();
    } catch { /* quota veya Cache Storage API yok */ }
  }

  /* ── Toplu ısıtma (V-07) ────────────────────────────────────────────────
   *
   * NEDEN BURADA: "Çevrimdışı harita indir" düğmesi ürünün ÇİZDİĞİ karoyu
   * indirmiyordu — `offlineTileDownloader` OSM'den RASTER `.png` çekip Service
   * Worker'a güveniyordu; ürün ise VEKTÖR `.pbf` çiziyor ve onları YALNIZ bu
   * sınıf tutuyor. İki ayrı depo, biri hiç okunmuyordu.
   *
   * İKİNCİ ÖNBELLEK KURULMAZ: ısıtma, canlı karo isteğiyle AYNI `_putToCache`
   * yolundan geçer. Böylece manifest, LRU baskısı, kota davranışı ve 0-bayt
   * koruması (#613) tek yerde kalır — ısıtılan karo, oyuncunun istediği karonun
   * ta kendisidir.
   */

  /**
   * Bir URL listesini önbelleğe ısıtır.
   *
   * @param urls    GERÇEK `https://` karo adresleri (çağıran şablonu çözer).
   * @param signal  İptal — kullanıcı vazgeçerse yarıda bırakılır.
   * @param onTick  İlerleme bildirimi (her karo sonrası).
   * @param concurrency Eşzamanlı istek sınırı; head unit ve sağlayıcı nezaketi.
   *
   * ASLA throw ETMEZ: tek tek karo hataları sayılır, tur devam eder. Bir bölge
   * paketinin %98'i inmişse bu bir başarıdır; tamamını çöpe atmak yanlış olur.
   */
  async warmUrls(
    urls: readonly string[],
    opts: {
      signal?: AbortSignal;
      onTick?: (done: number, total: number, failed: number) => void;
      concurrency?: number;
    } = {},
  ): Promise<{ done: number; failed: number; skipped: number; bytes: number }> {
    const total = urls.length;
    const limit = Math.max(1, Math.min(opts.concurrency ?? 4, 8));
    let done = 0, failed = 0, skipped = 0, bytes = 0, cursor = 0;

    const worker = async (): Promise<void> => {
      for (;;) {
        if (opts.signal?.aborted) return;
        const i = cursor++;
        if (i >= total) return;
        const url = urls[i];

        try {
          /* ZATEN VARSA AĞA ÇIKMA. 0 baytlık zehirli girdi (#613) İSABET
             SAYILMAZ — yeniden indirilir, yoksa bozuk paket kalıcı olur. */
          const cached = await this._getFromCache(url);
          if (cached && cached.byteLength > 0) {
            skipped++;
            this._touchLastAccess(url);
          } else {
            const res = await fetch(url, {
              ...(opts.signal ? { signal: opts.signal } : {}),
              headers: { 'User-Agent': 'CarosPro/1.0 TileWarm' },
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const buf = await res.arrayBuffer();
            if (buf.byteLength === 0) throw new Error('0 bayt');
            await this._putToCache(url, buf);
            bytes += buf.byteLength;
          }
        } catch {
          /* İptal bir HATA DEĞİLDİR — sayaca yazılmaz. */
          if (!opts.signal?.aborted) failed++;
        }

        done++;
        try { opts.onTick?.(done, total, failed); } catch { /* fail-soft */ }
      }
    };

    await Promise.all(Array.from({ length: Math.min(limit, total) }, worker));
    return { done, failed, skipped, bytes };
  }

  /** Bir karo GERÇEKTEN önbellekte ve sağlam mı (0 bayt İSABET SAYILMAZ). */
  async hasTile(url: string): Promise<boolean> {
    const c = await this._getFromCache(url);
    return c !== null && c.byteLength > 0;
  }

  /** Isıtılan bölgeyi sürüş boyunca eviction'dan koru (mevcut koridor kanalı). */
  protectUrls(urls: readonly string[]): void {
    this.markCorridorProtected(urls.map((u) => _urlToKey(u)));
  }

  /** LRU tavanı — çağıran paket boyutunu buna göre değerlendirir. */
  getCapacityBytes(): number { return MAX_BYTES; }

  /**
   * Önbelleği TAMAMEN boşaltır (kullanıcı "çevrimdışı veriyi sil" derse).
   *
   * KORİDOR KORUMASINI DA KALDIRIR: kullanıcı silmek istediğinde "sürüş
   * sürüyor" gerekçesiyle bir kısmını saklamak, istenen sonucu vermez ve
   * kullanıcı yeri boşalmadı sanır. Sayaçlar da sıfırlanır — silinmiş bir
   * önbelleğin isabet oranı taşınmaz.
   *
   * ASLA throw ETMEZ; silinebilen kadarını siler ve gerçek sonucu döner.
   */
  async clearAll(): Promise<{ deleted: number; freedBytes: number }> {
    const before = this._manifest.size;
    const bytes = this._totalBytes;
    try {
      if (typeof caches !== 'undefined') await caches.delete(CACHE_NAME);
    } catch { /* fail-soft */ }

    this._manifest.clear();
    this._totalBytes = 0;
    this._hits = 0;
    this._misses = 0;
    this._dirty = true;
    this._scheduleFlush();

    return { deleted: before, freedBytes: bytes };
  }

  private _touchLastAccess(url: string): void {
    const entry = this._manifest.get(_urlToKey(url));
    if (entry) { entry.lastAccess = Date.now(); this._dirty = true; }
  }

  /* ── LRU Eviction ───────────────────────────────────────────────── */

  private async _evictLRU(): Promise<void> {
    if (typeof caches === 'undefined') return;
    try {
      const cache = await caches.open(CACHE_NAME);

      // Koridor-korumasız tile'ları lastAccess ASC sırala
      const evictable = [...this._manifest.values()]
        .filter(e => !e.corridorProtected)
        .sort((a, b) => a.lastAccess - b.lastAccess);

      for (const entry of evictable) {
        if (this._totalBytes <= EVICT_TARGET) break;
        await cache.delete(entry.url);
        this._totalBytes -= entry.size;
        this._manifest.delete(entry.key);
        this._dirty = true;
      }
    } catch { /* sessiz */ }
  }

  /* ── IndexedDB — manifest kalıcılığı ───────────────────────────── */

  private _openDB(): Promise<void> {
    return new Promise((resolve) => {
      if (typeof indexedDB === 'undefined') { resolve(); return; }
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore(DB_STORE, { keyPath: 'key' });
      };
      req.onsuccess = () => { this._db = req.result; resolve(); };
      req.onerror   = () => resolve(); // DB açılamazsa devam et
    });
  }

  private _loadManifest(): Promise<void> {
    if (!this._db) return Promise.resolve();
    return new Promise((resolve) => {
      const tx    = this._db!.transaction(DB_STORE, 'readonly');
      const store = tx.objectStore(DB_STORE);
      const req   = store.getAll();
      req.onsuccess = () => {
        const entries = (req.result ?? []) as TileManifestEntry[];
        this._manifest.clear();
        this._totalBytes = 0;
        for (const e of entries) {
          this._manifest.set(e.key, e);
          this._totalBytes += e.size;
        }
        resolve();
      };
      req.onerror = () => resolve();
    });
  }

  private _scheduleFlush(): void {
    if (this._flushTimer !== null) return;
    this._flushTimer = setTimeout(() => {
      this._flushTimer = null;
      if (this._dirty) void this._flushManifest();
    }, FLUSH_MS);
  }

  private _flushManifest(): Promise<void> {
    if (!this._db || !this._dirty) return Promise.resolve();
    this._dirty = false;
    return new Promise((resolve) => {
      const tx    = this._db!.transaction(DB_STORE, 'readwrite');
      const store = tx.objectStore(DB_STORE);
      for (const entry of this._manifest.values()) store.put(entry);
      tx.oncomplete = () => resolve();
      tx.onerror    = () => resolve();
    });
  }
}

/* ── URL → tile key ───────────────────────────────────────────────────────── */

function _urlToKey(url: string): string {
  const m = url.match(/\/(\d+)\/(\d+)\/(\d+)\.png/);
  return m ? `${m[1]}/${m[2]}/${m[3]}` : url;
}

/* ── Singleton ────────────────────────────────────────────────────────────── */

export const cacheLRUManager = new CacheLRUManager();
