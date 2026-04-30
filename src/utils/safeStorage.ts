/**
 * Safe Storage — Merkezi Persistence Altyapısı
 * (Forensic Integrity + Crash-Safe Persistence — R-2 Patch v2)
 *
 * CLAUDE.md §3 + H-6 Async I/O direktifi:
 *  - Priority-Driven       : Kritik anahtarlar → sıfır debounce, doğrudan disk
 *  - Write Throttling      : Normal anahtarlar → 4s debounce (eMMC ömrü)
 *  - Double-Locking        : Kritik anahtarlar native'de localStorage (sync) + Filesystem (async)
 *  - Atomic Write (native) : .json.tmp → stat → rename → verify-read
 *  - Self-Healing          : verify-read hatası → localStorage backup → yeniden yaz
 *  - Forensic Eviction Shield: crash-log-* hiçbir zaman otomatik silinmez
 *  - Atomic Flush          : beforeunload / pagehide → tüm bekleyenler başlatılır
 *
 * Yazım önceliği (Priority Tiers):
 *   KRİTİK (LRU_PROTECTED + LRU_PROTECTED_PREFIXES — araç ayarları, kaza logları):
 *     safeSetRaw          → debounce YOK, _commitToStorage direkt
 *     safeSetRawImmediate → async, await _commitToStorage (native katmana iletim garantisi)
 *     _commitToStorage    → localStorage sync backup önce, Filesystem async sonra
 *   NORMAL (cache, glyph, trip log):
 *     safeSetRaw          → 4s debounce → idle → _commitToStorage
 *
 * Self-Healing akışı (verify-read hatası):
 *   verify(file) ≠ value → localStorage backup oku
 *     backup === value → Filesystem yeniden yaz (verify döngüsü olmadan)
 *     backup ≠ value  → throw (veri tutarsız, üst katman karar verir)
 *
 * Platform davranışı:
 *   Native: Filesystem API + localStorage backup (kritik)
 *   Web:    localStorage
 *
 * Başlangıç (native mod):
 *   main.tsx'de createRoot'tan ÖNCE await initSafeStorageAsync() çağrılmalı.
 */

import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { Capacitor } from '@capacitor/core';
import type { StateStorage } from 'zustand/middleware';

/* ── Platform ────────────────────────────────────────────────── */

const NATIVE = Capacitor.isNativePlatform();
const FS_DIR = Directory.Data;
const FS_SUB = 'ss'; // safe-storage alt dizini (DATA içinde)

/* ── Filesystem yol yardımcıları ─────────────────────────────── */

const _fp  = (key: string) => `${FS_SUB}/${key}.json`;
const _fpt = (key: string) => `${FS_SUB}/${key}.json.tmp`;

/* ── Bellek içi FS cache (native mod) ───────────────────────── */

const _fsCache    = new Map<string, string>();
let   _fsCacheReady = false;

/* ── LRU eviction sırası ─────────────────────────────────────── */

/**
 * Kota dolunca önce silinen anahtarlar (prefix veya tam eşleşme).
 * Sıra: en değersiz → en değerli.
 */
const LRU_EVICT_PREFIXES: string[] = [
  'car-launcher-trip-log',  // yeniden üretilebilir trip geçmişi
  'car_map_offline',        // offline map tercih bayrağı
  'car-cache-',             // genel uygulama önbelleği
  'car-glyph-',             // harita font verileri
];

/**
 * Bu anahtarlar:
 *  1. LRU tarafından hiçbir zaman silinmez (veri kaybı engeli)
 *  2. KRİTİK yazım katmanı — safeSetRaw'da sıfır debounce, doğrudan disk
 *
 * Yeni kritik anahtar eklendiğinde buraya da ekle.
 */
const LRU_PROTECTED = new Set<string>([
  'car-launcher-storage',   // ana Zustand store
  'car-vehicle-store',      // araç profilleri
  'car-maintenance-store',  // bakım/TPMS
  'car-gps-last-known',     // son GPS konumu
  'car-e2e-private-key',    // ECDH P-256 private key (JWK) — asla silinmez
  'car-e2e-public-key',     // ECDH P-256 public key (SPKI base64) — asla silinmez
  'cl_usageMap',
  'cl_usagePruneTs',
  'cl_crash_log',           // kaza log meta anahtarı
]);

/**
 * Prefix bazlı koruma — bu prefix ile başlayan hiçbir anahtar silinmez.
 * crash-log-[timestamp] anahtarları adli kayıt olduğu için asla silinmez.
 */
const LRU_PROTECTED_PREFIXES: string[] = [
  'crash-log-',
];

/** Anahtar kritik mi? Tam eşleşme veya prefix bazlı. */
function _isCritical(key: string): boolean {
  return LRU_PROTECTED.has(key) || LRU_PROTECTED_PREFIXES.some((p) => key.startsWith(p));
}

/**
 * Immediate Write — debounce bypass. Voltaj kesintisinde bu anahtarlar kaybolmaz.
 * _SAFETY_DEBOUNCE_KEYS içinde olsa bile safeSetRaw anında _commitToStorage çağırır.
 * Kural: konum verisi gibi tek yazımda geri dönülemez, düşük frekanslı veriler buraya girer.
 *
 * car-maintenance-store buradan ÇIKARILDI: Worker tarafında 500 m eşikli throttling
 * sayesinde bu anahtar artık yüksek frekanslı yazma üretmez → _SAFETY_DEBOUNCE_KEYS
 * (1 s debounce) yeterli güvenceyi sağlar ve eMMC yazma döngüleri korunur.
 */
const IMMEDIATE_WRITE_KEYS = new Set<string>([
  'car-gps-last-known',     // son konum — güç kesintisinde kaybolmamalı
]);

/**
 * Safety Debounce — kritik ama yüksek frekanslı anahtarlar (eMMC ömrü R-2).
 * Bu anahtarlar hâlâ LRU_PROTECTED (silinmez), ancak sıfır debounce yerine
 * 1s debounce alır. Slider/ayar burst'larını max 1Hz disk yazmasına indirgir.
 */
const _SAFETY_DEBOUNCE_KEYS = new Set<string>([
  'car-launcher-storage',   // ana Zustand store — ses/parlaklık slider burst
  'car-vehicle-store',      // araç profili değişimleri
  'car-maintenance-store',  // bakım güncelleme
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
 * Native modda _fsCache + Filesystem dosyalarını temizler.
 * @returns Silinen anahtar sayısı (0 = hiçbir şey silinemedi)
 */
export function safeLruEvict(): number {
  let evicted = 0;

  for (const prefix of LRU_EVICT_PREFIXES) {
    if (NATIVE) {
      _fsCache.forEach((_, key) => {
        if (!_isCritical(key) && (key.startsWith(prefix) || key === prefix)) {
          _fsCache.delete(key);
          void Filesystem.deleteFile({ path: _fp(key), directory: FS_DIR }).catch(() => {});
          evicted++;
        }
      });
    } else {
      const toRemove: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && !_isCritical(k) && (k.startsWith(prefix) || k === prefix)) {
          toRemove.push(k);
        }
      }
      toRemove.forEach((k) => {
        try { localStorage.removeItem(k); evicted++; } catch { /* ignore */ }
      });
    }

    if (evicted > 0) break; // tek grup silmek genellikle yeterli
  }

  if (evicted === 0) _evictCacheStorage();
  return evicted;
}

/* ── Atomik Filesystem yazma ─────────────────────────────────── */

/**
 * Voltaj düşmelerine ve ani kapanmalara karşı koruma sağlayan atomik yazma.
 *
 * Algoritma:
 *   1. ${key}.json.tmp dosyasına yaz  (başarısız → asıl dosya bozulmaz)
 *   2. stat ile boyut > 0 doğrulaması (başarısız → tmp silinmemiş, asıl bozulmaz)
 *   3. ${key}.json'u sil              (idempotent — yoksa sessizce geçer)
 *   4. .tmp → .json rename            (Android ext4/f2fs'de atomik syscall)
 *   5. Verify-read: dosyadan geri oku, yazılanla karşılaştır
 *      Capacitor Filesystem'da açık fsync yoktur; readFile başarısı en az
 *      "disk okunabilir + tutarlı" garantisi verir (OS-level telafi).
 *   6. _fsCache'i güncelle (verify başarısına bağlı)
 */
async function _fsWriteAtomic(key: string, value: string): Promise<void> {
  const finalPath = _fp(key);
  const tmpPath   = _fpt(key);

  // 1. Geçici dosyaya yaz (recursive: true → ss/ dizinini otomatik oluşturur)
  await Filesystem.writeFile({
    path:      tmpPath,
    data:      value,
    directory: FS_DIR,
    encoding:  Encoding.UTF8,
    recursive: true,
  });

  // 2. Doğrula: stat ile boyut > 0 kontrolü
  const stat = await Filesystem.stat({ path: tmpPath, directory: FS_DIR });
  if (stat.size === 0) {
    throw new Error(`[safeStorage] Atomik yazma doğrulaması başarısız: "${key}"`);
  }

  // 3. Asıl dosyayı sil (yoksa hata sessizce yutulur)
  await Filesystem.deleteFile({ path: finalPath, directory: FS_DIR }).catch(() => {});

  // 4. .tmp → asıl (atomic rename)
  await Filesystem.rename({
    from:        tmpPath,
    to:          finalPath,
    directory:   FS_DIR,
    toDirectory: FS_DIR,
  });

  // 5. Verify-read: rename sonrası dosyayı diskten oku — fsync telafisi
  const verifyResult = await Filesystem.readFile({
    path:      finalPath,
    directory: FS_DIR,
    encoding:  Encoding.UTF8,
  });
  const readBack = typeof verifyResult.data === 'string' ? verifyResult.data : '';
  if (readBack !== value) {
    // Self-Healing: localStorage backup'tan kurtarma dene
    let backup: string | null = null;
    try { backup = localStorage.getItem(key); } catch { /* ignore */ }

    if (backup === value) {
      // Backup tutarlı — Filesystem'i verify döngüsü olmadan yeniden yaz
      await Filesystem.writeFile({
        path:      finalPath,
        data:      value,
        directory: FS_DIR,
        encoding:  Encoding.UTF8,
        recursive: true,
      });
      // Başarıyla yazıldı; devam et (6. adım cache'i günceller)
    } else {
      // Filesystem ve localStorage birbiriyle çelişiyor — Data Integrity Violation.
      // Veriyi corrupt etmek yerine ERROR_BUS üzerinden sinyal gönder; fırlatmaya devam.
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('caros:integrity-violation', {
          detail: { key, reason: 'fs-backup-mismatch' },
        }));
      }
      throw new Error(`[safeStorage] Data Integrity Violation: fs ≠ backup for "${key}"`);
    }
  }

  // 6. Bellek içi cache: yalnızca verify (veya self-heal) başarısından sonra güncelle
  _fsCache.set(key, value);
}

/* ── Filesystem okuma + bozulma kurtarma ─────────────────────── */

/**
 * Dosyayı okur; bozuksa veya yoksa .tmp kurtarma dosyasını dener.
 * İkisi de yoksa null döner → çağıran DEFAULT_SETTINGS'e geri döner.
 */
async function _fsRead(key: string): Promise<string | null> {
  // Asıl dosyayı oku
  try {
    const result = await Filesystem.readFile({
      path:      _fp(key),
      directory: FS_DIR,
      encoding:  Encoding.UTF8,
    });
    const data = typeof result.data === 'string' ? result.data : null;
    if (data && data.length > 0) return data;
    throw new Error('empty');
  } catch {
    // Bozulma kurtarma: .tmp dosyasını dene
    try {
      const result = await Filesystem.readFile({
        path:      _fpt(key),
        directory: FS_DIR,
        encoding:  Encoding.UTF8,
      });
      const data = typeof result.data === 'string' ? result.data : null;
      if (!data || data.length === 0) return null;
      // .tmp geçerli veri içeriyor — asıl dosya olarak promote et (fire-and-forget)
      void _fsWriteAtomic(key, data);
      return data;
    } catch {
      return null; // DEFAULT_SETTINGS geri dönüşü çağıranda yapılır
    }
  }
}

/* ── Başlangıç ön yükleme ────────────────────────────────────── */

/**
 * Native modda Filesystem'daki tüm anahtarları _fsCache'e yükler.
 * main.tsx'de createRoot'tan ÖNCE await ile çağrılmalı; aksi halde
 * Zustand store'ları _fsCache boşken başlar ve varsayılan değerleri kullanır.
 */
export async function initSafeStorageAsync(): Promise<void> {
  if (!NATIVE || _fsCacheReady) return;
  _fsCacheReady = true;

  try {
    const { files } = await Filesystem.readdir({ path: FS_SUB, directory: FS_DIR });

    await Promise.all(
      files
        .filter((f) => f.type === 'file' && f.name.endsWith('.json') && !f.name.includes('.tmp'))
        .map(async (f) => {
          const key = f.name.slice(0, -5); // '.json' suffix'ini kaldır
          const val = await _fsRead(key);
          if (val !== null) _fsCache.set(key, val);
        }),
    );
  } catch {
    // ss/ dizini henüz oluşmamış (ilk çalışma) — normal durum
  }
}

/* ── Disk yazma (quota-aware) ────────────────────────────────── */

// Yalnızca _scheduleIdleWrite ve safeFlushAll/safeFlushKey/safeSetRawImmediate çağırır.
async function _commitToStorage(key: string, value: string): Promise<void> {
  // Mali-400 Compliance: 100KB+ payload JSON.stringify'ı main thread'de bloke edebilir.
  // Uyarı yalnızca dev modda; prod'da sıfır overhead.
  if (import.meta.env.DEV && value.length > 102_400) {
    console.warn(
      `[safeStorage] Büyük yazım: "${key}" ${(value.length / 1024).toFixed(1)}KB — ` +
      'JSON parçalama veya lazy persist önerilir (CLAUDE.md §3 Mali-400 Compliance)',
    );
  }
  if (NATIVE) {
    // Double-lock: kritik anahtarlar için önce localStorage senkron backup
    // Filesystem async başlamadan önce veri en az bir katmanda güvende
    if (_isCritical(key)) {
      try { localStorage.setItem(key, value); } catch { /* quota — devam et */ }
    }
    try {
      await _fsWriteAtomic(key, value);
    } catch {
      // Disk dolu — LRU boşalt ve bir kez daha dene
      safeLruEvict();
      try {
        await _fsWriteAtomic(key, value);
      } catch { /* vazgeç — asıl dosya dokunulmadan kaldı, localStorage backup var */ }
    }
  } else {
    try {
      localStorage.setItem(key, value);
    } catch (e) {
      if (e instanceof DOMException && (
        e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED'
      )) {
        safeLruEvict();
        try { localStorage.setItem(key, value); } catch { /* vazgeç */ }
      }
    }
  }
}

/* ── requestIdleCallback polyfill ───────────────────────────── */

const RIC_TIMEOUT_MS = 2_000; // browser idle değilse bile en geç bu kadar sonra yaz

function _requestIdle(cb: () => void): number {
  if (typeof requestIdleCallback !== 'undefined') {
    return requestIdleCallback(cb, { timeout: RIC_TIMEOUT_MS });
  }
  return setTimeout(cb, 0) as unknown as number;
}

function _cancelIdle(handle: number): void {
  if (typeof cancelIdleCallback !== 'undefined') {
    cancelIdleCallback(handle);
  } else {
    clearTimeout(handle as unknown as ReturnType<typeof setTimeout>);
  }
}

/* ── Write buffer (Stage 1: debounce) ───────────────────────── */

/**
 * CLAUDE.md §3: 4s debounce — GPS/OBD gibi rapid-fire kaynaklar
 * tek bir disk yazmasına indirgenir.
 */
const WRITE_DEBOUNCE_MS = 4_000;

/** Safety Debounce: slider/ayar burst → max 1Hz disk write (eMMC koruma) */
const SAFETY_DEBOUNCE_MS = 1_000;

interface BufferedWrite {
  value: string;
  timer: ReturnType<typeof setTimeout>;
}

const _writeBuffer = new Map<string, BufferedWrite>();

/* ── Idle kuyruk (Stage 2: async I/O — H-6) ─────────────────── */

const _idlePending = new Map<string, string>();
const _idleHandles = new Map<string, number>();

function _scheduleIdleWrite(key: string, value: string): void {
  const prev = _idleHandles.get(key);
  if (prev != null) _cancelIdle(prev);

  _idlePending.set(key, value);

  const handle = _requestIdle(() => {
    _idleHandles.delete(key);
    _idlePending.delete(key);
    void _commitToStorage(key, value);
  });
  _idleHandles.set(key, handle);
}

/* ── Atomic Flush (H-6 §2 — senkron başlatmalı) ─────────────── */

/**
 * Tüm bekleyen yazımları (debounce + idle kuyruk) anında başlatır.
 *
 * İmza senkron kalır (beforeunload uyumluluğu için).
 * Native modda async yazımlar fire-and-forget olarak tetiklenir:
 *   - Android process shutdown ~500ms grace period tanır → yazım tamamlanır
 *   - Yarım kalan .tmp varsa → sonraki açılışta _fsRead kurtarma devreye girer
 * Web modda localStorage.setItem promise executor'ında senkron çalışır.
 */
export function safeFlushAll(): void {
  _writeBuffer.forEach(({ value, timer }, key) => {
    clearTimeout(timer);
    const idleHandle = _idleHandles.get(key);
    if (idleHandle != null) {
      _cancelIdle(idleHandle);
      _idleHandles.delete(key);
      _idlePending.delete(key);
    }
    void _commitToStorage(key, value);
  });
  _writeBuffer.clear();

  _idleHandles.forEach((handle, key) => {
    _cancelIdle(handle);
    const value = _idlePending.get(key);
    if (value !== undefined) void _commitToStorage(key, value);
  });
  _idleHandles.clear();
  _idlePending.clear();
}

/** Tek anahtarın bekleyen yazımını (debounce + idle) anında başlatır. */
export function safeFlushKey(key: string): void {
  const bw = _writeBuffer.get(key);
  if (bw) {
    clearTimeout(bw.timer);
    _writeBuffer.delete(key);
    const h = _idleHandles.get(key);
    if (h != null) { _cancelIdle(h); _idleHandles.delete(key); _idlePending.delete(key); }
    void _commitToStorage(key, bw.value);
    return;
  }
  const handle = _idleHandles.get(key);
  if (handle != null) {
    _cancelIdle(handle);
    _idleHandles.delete(key);
    const value = _idlePending.get(key);
    if (value !== undefined) {
      _idlePending.delete(key);
      void _commitToStorage(key, value);
    }
  }
}

/* ── Uygulama kapanma hook'ları ──────────────────────────────── */

if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', safeFlushAll);
  window.addEventListener('pagehide',     safeFlushAll); // iOS Safari
}

/* ── Raw string API (platform servisleri için) ───────────────── */

/**
 * Düz string değer yazar.
 *
 * KRİTİK (LRU_PROTECTED): debounce YOK — doğrudan _commitToStorage.
 *   Araç ayarları ve kaza logları RAM'de 1ms bile bekletilmez.
 *   Varsa önceki buffer/idle iptal edilir; native'de _fsCache anında güncellenir.
 *
 * NORMAL: 4s debounce → requestIdleCallback → _commitToStorage (eMMC ömrü)
 *
 * @param debounceMs Normal yol için opsiyonel override — varsayılan WRITE_DEBOUNCE_MS
 */
export function safeSetRaw(key: string, value: string, debounceMs = WRITE_DEBOUNCE_MS): void {
  // ── Kritik yazım yolu ────────────────────────────────────────
  if (_isCritical(key)) {
    // ── Immediate Write: debounce yok — doğrudan _commitToStorage ──
    if (IMMEDIATE_WRITE_KEYS.has(key)) {
      const bw = _writeBuffer.get(key);
      if (bw) { clearTimeout(bw.timer); _writeBuffer.delete(key); }
      const h = _idleHandles.get(key);
      if (h != null) { _cancelIdle(h); _idleHandles.delete(key); _idlePending.delete(key); }
      if (NATIVE) _fsCache.set(key, value);
      void _commitToStorage(key, value);
      return;
    }

    // ── Safety Debounce alt-katmanı: slider burst → max 1Hz disk write (eMMC R-2) ─
    if (_SAFETY_DEBOUNCE_KEYS.has(key)) {
      // Cache'i anında güncelle — okuma tutarlılığı korunur, disk bekleyebilir
      if (NATIVE) _fsCache.set(key, value);
      const existing = _writeBuffer.get(key);
      if (existing) {
        if (existing.value === value) return; // değişmedi — timer sıfırlama
        clearTimeout(existing.timer);
      }
      const timer = setTimeout(() => {
        _writeBuffer.delete(key);
        _scheduleIdleWrite(key, value); // Stage 2: idle → main thread bloke olmaz
      }, SAFETY_DEBOUNCE_MS);
      _writeBuffer.set(key, { value, timer });
      return;
    }

    // ── Sıfır debounce: crash-log-* ve car-gps-last-known ────────
    const bw = _writeBuffer.get(key);
    if (bw) { clearTimeout(bw.timer); _writeBuffer.delete(key); }
    const h = _idleHandles.get(key);
    if (h != null) { _cancelIdle(h); _idleHandles.delete(key); _idlePending.delete(key); }
    if (NATIVE) _fsCache.set(key, value);
    void _commitToStorage(key, value);
    return;
  }

  // ── Normal yazım yolu (4s debounce) ──────────────────────────
  const existing = _writeBuffer.get(key);
  if (existing) {
    if (existing.value === value) return; // değişmedi — timer sıfırlama
    clearTimeout(existing.timer);
  }

  const timer = setTimeout(() => {
    _writeBuffer.delete(key);
    _scheduleIdleWrite(key, value);
  }, debounceMs);

  _writeBuffer.set(key, { value, timer });
}

/**
 * Düz string değer okur.
 * Okuma hattı: writeBuffer → idlePending → _fsCache (native) → localStorage (web + migration)
 *
 * Bozulma kurtarma: initSafeStorageAsync sırasında _fsRead .tmp kurtarmasını yapar
 * ve geçerli veriyi _fsCache'e yazar. Buradaki okuma her zaman tutarlı veri döner.
 */
export function safeGetRaw(key: string): string | null {
  // Stage 1: debounce buffer (en güncel)
  const buffered = _writeBuffer.get(key);
  if (buffered) return buffered.value;

  // Stage 2: idle kuyruk (debounce geçmiş, disk'e gitmemiş)
  const idle = _idlePending.get(key);
  if (idle !== undefined) return idle;

  if (NATIVE) {
    // Stage 3: Filesystem cache (initSafeStorageAsync ile yüklendi)
    const cached = _fsCache.get(key);
    if (cached !== undefined) return cached;
    // Stage 4: Seamless migration — localStorage'da eski veri varsa kaybolmaz
    try { return localStorage.getItem(key); } catch { return null; }
  }

  // Web modu: localStorage
  try { return localStorage.getItem(key); } catch { return null; }
}

/**
 * Anahtarı siler — her iki kuyruk iptal edilir, disk'ten de kaldırılır.
 */
export function safeRemoveRaw(key: string): void {
  const bw = _writeBuffer.get(key);
  if (bw) { clearTimeout(bw.timer); _writeBuffer.delete(key); }
  const h = _idleHandles.get(key);
  if (h != null) { _cancelIdle(h); _idleHandles.delete(key); }
  _idlePending.delete(key);

  if (NATIVE) {
    _fsCache.delete(key);
    void Filesystem.deleteFile({ path: _fp(key), directory: FS_DIR }).catch(() => {});
  } else {
    try { localStorage.removeItem(key); } catch { /* ignore */ }
  }
}

/**
 * Buffer'ı bypass ederek anında yazar — kaza anı ve anlık kalıcılık için.
 * Dönen Promise await edilebilir (opsiyonel); mevcut void çağrılar değişmeden çalışır.
 *
 * Native — üç katmanlı güvenlik:
 *   1. _fsCache senkron güncellenir  → okuma her zaman tutarlı
 *   2. localStorage senkron yazılır  → Filesystem başarısız olsa bile veri kaybolmaz
 *   3. Filesystem atomik yazımı başlatılır → verify-read dahil kalıcı güvence
 *
 * Web:
 *   1. localStorage senkron yazılır (quota hatasında LRU devreye girer)
 *   2. Promise zaten tamamlanmış döner (compat)
 */
export async function safeSetRawImmediate(key: string, value: string): Promise<void> {
  const bw = _writeBuffer.get(key);
  if (bw) { clearTimeout(bw.timer); _writeBuffer.delete(key); }
  const h = _idleHandles.get(key);
  if (h != null) { _cancelIdle(h); _idleHandles.delete(key); }
  _idlePending.delete(key);

  if (NATIVE) {
    // Katman 1: anlık cache
    _fsCache.set(key, value);
    // Katman 2: localStorage senkron backup (_commitToStorage kritik kontrolü yapar;
    //   burada da yazıyoruz — _commitToStorage'dan önce crash olursa bile güvende)
    try { localStorage.setItem(key, value); } catch { /* quota — LRU sonra temizler */ }
    // Katman 3: Filesystem atomik yazım (await → native katmana iletim garantisi)
    await _commitToStorage(key, value);
    return;
  }

  // Web modu: senkron localStorage
  try {
    localStorage.setItem(key, value);
  } catch (e) {
    if (e instanceof DOMException && (
      e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED'
    )) {
      safeLruEvict();
      try { localStorage.setItem(key, value); } catch { /* vazgeç */ }
    }
  }
}

/* ── Key listing (platform-aware) ───────────────────────────── */

/**
 * Verilen prefix ile başlayan tüm depolama anahtarlarını döner.
 * Tüm yazım hattı katmanları (buffer, idle, fsCache, localStorage) taranır.
 * Crash log listeleme ve benzer adli sorgular için kullanılır.
 */
export function listKeysWithPrefix(prefix: string): string[] {
  const seen = new Set<string>();

  // Stage 1 + 2: henüz diske gitmemiş yazımlar da dahil
  _writeBuffer.forEach((_, k) => { if (k.startsWith(prefix)) seen.add(k); });
  _idlePending.forEach((_, k) => { if (k.startsWith(prefix)) seen.add(k); });

  if (NATIVE) {
    _fsCache.forEach((_, k) => { if (k.startsWith(prefix)) seen.add(k); });
  } else {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(prefix)) seen.add(k);
    }
  }

  return [...seen].sort();
}

/* ── Zustand StateStorage uyumlu adapter ─────────────────────── */

/**
 * Zustand persist middleware için StateStorage uyumlu nesne.
 * createJSONStorage(() => safeStorage) ile sararak kullanın.
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
