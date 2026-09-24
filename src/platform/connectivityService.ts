/**
 * connectivityService.ts — Çevrimdışı dayanıklı HTTP kuyruğu.
 *
 * Özellikler:
 *   - At-Least-Once Delivery: 2xx alınana kadar kuyruktan silinmez
 *   - Priority Queue: critical (alarm/kaza) > high (komut) > normal (telemetri)
 *   - Exponential Backoff: 1s → 2s → 4s → ... → max 30s
 *   - FIFO: aynı öncelikteki öğeler sırayla işlenir
 *   - IndexedDB: kalıcı depolama (uygulama yeniden açılsa bile kuyruk korunur)
 *   - Monotonic safety: kuyrukta bekleyen veri delta hesaplamalarını bozmaz
 *
 * CLAUDE.md §3 (Performance): işlem yokken timer çalışmaz.
 * CLAUDE.md §4 (Data Integrity): enqueueAt = performance.now() — saat atlamalarına karşı.
 */

import { signalWithTimeout } from '../utils/abortCompat';
import { getConnectivitySnapshot, subscribeConnectivity } from './connectivity/connectivityAuthority';
import type { ConnectivitySnapshot } from './connectivity/connectivityEvidence';
import { allowsConnectivity } from './connectivity/connectivityGate';
import { logInfo } from './debug';
import {
  classifyHttpOutcome, classifyGenericOutcome, shouldKeepInQueue, markSending, applyOutcome,
  type HttpOutcome, type DeliveryClassification,
} from './diagnosticDelivery';

// ── Tipler ────────────────────────────────────────────────────────────────────

export type QueuePriority = 'critical' | 'high' | 'normal';

/* ── Kuyrukta SIR TUTULMAZ (2026-09-25, CodeQL clear-text-storage incelemesi) ──
   Araç API anahtarı `p_api_key` gövdeye konup kuyruk IndexedDB'ye DÜZ METİN
   yazılıyordu — güvenli depodaki (sensitiveKeyStore) anahtarın şifresiz kopyası.
   Artık gövdeye YER TUTUCU yazılır; gerçek değer yalnız GÖNDERİM anında,
   sahibi tarafından kaydedilen çözücüden alınır. Çözülemezse istek GİTMEZ ve
   kuyrukta kalır (ağ hatası gibi, sahte başarı yok). */
export const VEHICLE_API_KEY_SLOT = '__CAROS_VEHICLE_API_KEY__';
let _vehicleApiKeyResolver: (() => Promise<string | null>) | null = null;
/** Anahtarın SAHİBİ (vehicleIdentityService) çağırır — kuyruk depoya bağımlı olmaz. */
export function setQueueVehicleApiKeyResolver(fn: (() => Promise<string | null>) | null): void {
  _vehicleApiKeyResolver = fn;
}
async function _resolveBodySecrets(body: string): Promise<string | null> {
  const slot = JSON.stringify(VEHICLE_API_KEY_SLOT);
  if (!body.includes(slot)) return body;
  let key: string | null = null;
  try { key = _vehicleApiKeyResolver ? await _vehicleApiKeyResolver() : null; } catch { key = null; }
  if (!key) return null;
  return body.split(slot).join(JSON.stringify(key));
}

export interface QueueEntry {
  id:            string;
  url:           string;
  method:        string;
  headers:       Record<string, string>;
  body:          string;
  priority:      QueuePriority;
  type:          string;         // log/dedup için ('telemetry', 'cmd_status', vb.)
  enqueuedAt:    number;         // performance.now() — monotonic
  attempts:      number;
  nextRetryAt:   number;         // Date.now() — absolute, retry schedule için
  /** Date.now() — ilk kuyruğa giriş (wall-clock). TTL/bounded-retry kapısı için;
   *  performance.now() oturum başına sıfırlandığından TTL'de kullanılamaz. */
  createdAtWall?: number;
  /** Teslimat defteri korelasyon anahtarı (kullanıcı-tetikli raporlar). Yoksa
   *  bu event izlenmez (bulk telemetri/critical_error) — kuyruk davranışı aynı. */
  reportId?:     string;
}

/** UTF-8 octet uzunluğu — Postgres octet_length ile aynı (64 KB truncation ölçümü). */
function _octetLen(s: string): number {
  try { return new TextEncoder().encode(s).length; }
  catch { return s.length; } // TextEncoder yoksa (çok eski WebView) yaklaşık
}

const PRIORITY_ORDER: Record<QueuePriority, number> = {
  critical: 0,
  high:     1,
  normal:   2,
};

// ── IndexedDB ─────────────────────────────────────────────────────────────────

const DB_NAME    = 'caros-connectivity-v1';
const STORE_NAME = 'queue';
const DB_VERSION = 1;

// Modül-seviyesi bağlantı cache'i (K24 perf düzeltmesi): her IDB işlemi ayrı
// indexedDB.open() ÇAĞIRMAZ — bağlantı bir kez açılır, açma Promise'i cache'lenir.
// onclose/onversionchange'de cache düşürülür ki bir sonraki çağrı taze bağlantı
// açsın (bozuk/kapalı bağlantıyla sonsuza dek kalınmaz).
let _dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (_dbPromise) return _dbPromise;

  _dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db    = req.result;
      const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      store.createIndex('priority',    'priority');
      store.createIndex('nextRetryAt', 'nextRetryAt');
    };
    req.onsuccess = () => {
      const db = req.result;
      // Bağlantı beklenmedik şekilde kapanırsa (örn. sekme/uygulama tarafından
      // dışarıdan) veya versiyon değişimi gelirse cache'i düş — sonraki
      // dbGetAll/dbPut/dbDelete çağrısı taze bağlantı açar.
      db.onclose = () => { _dbPromise = null; };
      db.onversionchange = () => {
        db.close();
        _dbPromise = null;
      };
      resolve(db);
    };
    req.onerror = () => {
      _dbPromise = null; // açma başarısız — bir sonraki çağrı yeniden dener
      reject(req.error);
    };
  });

  return _dbPromise;
}

/**
 * Cache'lenmiş bağlantıyı kapatır ve cache'i düşürür (destroy() tarafından çağrılır).
 * Test izolasyonu için de gerekli: testler her senaryoda `globalThis.indexedDB`'yi
 * TAZE bir fake factory ile değiştirir (bkz. `installFakeIDB` test yardımcıları);
 * cache burada düşürülmezse servis bir SONRAKİ testte hâlâ ESKİ (kapatılmış/temizlenmiş)
 * fake bağlantıyı kullanmaya devam eder.
 */
function closeDB(): void {
  if (!_dbPromise) return;
  const pending = _dbPromise;
  _dbPromise = null;
  pending.then((db) => {
    try { db.close(); } catch { /* fake/test IDB'de close() olmayabilir — yoksay */ }
  }).catch(() => { /* açma zaten başarısızdı — kapatacak bir şey yok */ });
}

async function dbGetAll(): Promise<QueueEntry[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).getAll();
    req.onsuccess = () => resolve(req.result as QueueEntry[]);
    req.onerror   = () => reject(req.error);
  });
}

async function dbPut(entry: QueueEntry): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(entry);
    tx.oncomplete = () => resolve();
    tx.onerror    = () => reject(tx.error);
  });
}

async function dbDelete(id: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror    = () => reject(tx.error);
  });
}

// ── Backoff hesaplama ─────────────────────────────────────────────────────────

const MAX_BACKOFF_MS = 30_000;
/**
 * Olumsuz bir bağlantı hükmünün "kanıtlanmış" sayıldığı üst yaş (V-02).
 *
 * Bundan eski bir olumsuz hüküm artık ölçüm değil, ESKİ BİR İZLENİMDİR; kuyruk
 * onun yüzünden süresiz susturulmaz. Sürekli kanıtın normal yayın aralığının
 * çok üstünde seçildi: sağlıklı bir gözlemci bu sınıra HİÇ ulaşmaz, yalnız
 * SUSMUŞ bir gözlemci ulaşır.
 */
const STALE_VERDICT_MS = 120_000;
/** Kapı kapalıyken kuyruğun yeniden sorma aralığı — gönderim DENEMESİ değildir. */
const CLOSED_GATE_RECHECK_MS = 30_000;
const BASE_BACKOFF_MS = 1_000;

function nextRetry(attempts: number): number {
  const backoff = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * Math.pow(2, attempts));
  return Date.now() + backoff;
}

// ── UUID yardımcısı ───────────────────────────────────────────────────────────

function uid(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Kuyruğun GÖNDERİM DENEMESİ yapıp yapamayacağına dair SAF karar (V-02).
 *
 * Bu fonksiyon bağlantı HÜKMÜ ÜRETMEZ — hüküm `ConnectivityAuthority`nindir.
 * Yalnızca "bu olumsuz hüküm hâlâ KANIT mı, yoksa eski bir izlenim mi?"
 * sorusunu yanıtlar.
 *
 * · `gateAllows` true  → kapı zaten açık, tartışma yok.
 * · CAPTIVE             → yaş ne olursa olsun DUR (portal 2xx'i "teslim edildi"
 *                         sanılıp öğe silinirdi; gerçek veri kaybı yolu).
 * · Olumsuz + kanıt TAZE→ DUR (kanıtlanmış çevrimdışı; boşuna radyo yakmayız).
 * · Olumsuz + kanıt BAYAT→ BİR DENEME HAKKI. Sürekli kanıt hiç bayatlamadığı
 *                         ve `recompute()` yalnız yeni kanıtta çalıştığı için
 *                         susmuş bir gözlemci hükmü süresiz çivileyebiliyordu.
 */
export function shouldAttemptQueuedDelivery(
  gateAllows: boolean,
  snapshot: Pick<ConnectivitySnapshot, 'state' | 'captivePortal' | 'evidenceAgeMs'>,
): boolean {
  if (gateAllows) return true;
  if (snapshot.captivePortal === true || snapshot.state === 'CAPTIVE') return false;

  /* Yaş BİLİNMİYOR (`null`) ise olumsuz hükmün TAZE olduğunu İDDİA EDEMEYİZ.
     `null`u sessizce 0 saymak (eski davranış) "kanıt yok"u "kanıt taptaze"ye
     çevirirdi ve kuyruğu tam da bu turun kapattığı biçimde süresiz susturabilirdi.
     Bilinmeyende bir deneme hakkı verilir: başarısız teslim öğeyi silmez. */
  const ageMs = snapshot.evidenceAgeMs;
  return ageMs === null || ageMs >= STALE_VERDICT_MS;
}

// ── ConnectivityService ───────────────────────────────────────────────────────

class ConnectivityService {
  private _running    = false;
  private _timer: ReturnType<typeof setTimeout> | null = null;
  private _networkListener: (() => void) | null = null;

  /**
   * F7-B: bu servis ARTIK KENDİ internet gerçeğini ÜRETMEZ. Yön TEK yönlüdür:
   * `ConnectivityAuthority` → `ConnectivityPolicy` → bu kuyruk. Kuyruk boşaltma
   * arka plan senkronudur (kullanıcı beklemez) → `BACKGROUND_SYNC`.
   *
   * ── DAVRANIŞ KORUNDU ─────────────────────────────────────────────────────
   * Eski kapı `Network.getStatus().connected` idi (doğrulama garantisi YOK);
   * kanonik karşılığı `DEGRADED`dir ve `BACKGROUND_SYNC` orada da İZİNLİDİR.
   * Kanıt yokken (`UNKNOWN`) de izinlidir — eski `navigator.onLine` yedeği aynı
   * yönde davranırdı. Kuyruk at-least-once olduğundan fazladan bir "izin" veri
   * KAYBETTİRMEZ, yalnız bir deneme harcar (backoff zaten sınırlar).
   *
   * ── YENİ ve KASITLI: CAPTIVE ARTIK DURDURUR ──────────────────────────────
   * Giriş portalı rastgele URL'lere 2xx dönebilir; eski kapı bunu "teslim
   * edildi" sayıp öğeyi kuyruktan SİLERDİ. Bu gerçek bir veri kaybı yoluydu.
   */
  private get _online(): boolean {
    if (allowsConnectivity('BACKGROUND_SYNC')) return true;

    /* ── V-02: BAYAT OLUMSUZ HÜKÜM KUYRUĞU SONSUZA DEK KİLİTLEYEMEZ ───────
     * ÖLÇÜLEN KUSUR (gerçek cihaz, Xiaomi 23090RA98I, CDP ağ yakalaması,
     * 2026-09-18): araç eşleşmiş ve `fetch_pending_vehicle_commands`
     * 200 dönerken `push_vehicle_event` 38 DAKİKA boyunca HİÇ gitmedi.
     * Uygulama yeniden başlatılınca 17:53 ve 18:00'e ait `update_command_status`
     * kayıtları ve bekleyen heartbeat'ler TOPLU HÂLDE aktı ve hepsi 200 aldı.
     * Yani RPC, şema ve api_key SAĞLAMDI; tıkanan tek şey BU KUYRUKTU.
     *
     * KÖK: hüküm `ConnectivityAuthority`de ÖNBELLEKLENİR ve `recompute()`
     * YALNIZ yeni/silinen kanıtta çalışır — okumada ve zamanla ÇALIŞMAZ.
     * `isEvidenceStale` ise `continuous` kanıta HİÇ uygulanmaz
     * (`if (evidence.continuous) return false`). `ANDROID_NETWORK_CALLBACK`
     * hem sürekli hem en yüksek güvendedir (100). Dolayısıyla o gözlemci bir
     * kez OFFLINE/LOCAL_ONLY deyip SUSARSA hüküm SÜREÇ ÖMRÜ BOYUNCA çivilenir.
     * Doğrudan `fetch` yapan yollar (komut yoklaması, kimlik RPC'si) bu kapıya
     * BAKMADIĞI için çalışmaya devam eder — kullanıcı tam olarak bunu gördü:
     * "tema gidiyor ama araç offline".
     *
     * BURADA HÜKÜM DEĞİŞTİRİLMEZ (§6: otorite bu dosya değildir). Yalnız
     * KENDİ at-least-once canlılığımız korunur: olumsuz hüküm KANITI
     * bayatlamışsa artık "kanıtlanmış çevrimdışı" değildir, bu yüzden bir
     * deneme hakkı verilir. Denemenin maliyeti sınırlıdır (backoff 30 sn ile
     * kapalı) ve kuyruk at-least-once olduğu için fazladan deneme VERİ
     * KAYBETTİRMEZ — dosyanın kendi gerekçesi de bunu söylüyor.
     *
     * CAPTIVE İSTİSNADIR ve BİLİNÇLİDİR: giriş portalı rastgele URL'lere 2xx
     * dönebilir, o yanıt "teslim edildi" sanılıp öğe SİLİNİRDİ. Gerçek veri
     * kaybı yolu olduğu için captive'de yaş ne olursa olsun DURULUR. */
    return shouldAttemptQueuedDelivery(false, getConnectivitySnapshot());
  }

  async init(): Promise<void> {
    /* İKİNCİ AĞ GÖZLEMCİSİ YOK (§29): kendi `Network.addListener` kaydımız
       KALDIRILDI; kanonik otoritenin TEK gözlemi dinlenir. Geçiş kenarı
       (izinsiz → izinli) eskisiyle aynı anlamı taşır: bağlantı geri geldi. */
    let wasAllowed = this._online;
    this._networkListener = subscribeConnectivity(() => {
      const allowed = this._online;
      if (allowed && !wasAllowed) {
        logInfo('[Connectivity] Bağlantı geldi — kuyruk boşaltılıyor');
        void this._drainQueue();
      }
      wasAllowed = allowed;
    });

    // Başlangıçta bekleyen öğeleri işle
    if (this._online) void this._drainQueue();
  }

  destroy(): void {
    this._networkListener?.();
    if (this._timer) { clearTimeout(this._timer); this._timer = null; }
    closeDB(); // IDB bağlantı cache'ini düşür — yeniden init() sonrası taze bağlantı açılır
  }

  /**
   * HTTP isteğini kuyruğa ekle.
   * Çevrimdışıysa IndexedDB'ye yazar; çevrimiçiyse hemen gönderir.
   *
   * @param priority  'critical' öğeler kuyruğun önüne geçer
   * @param type      Log için etiket ('telemetry', 'cmd_status', 'location')
   */
  async enqueue(
    url:      string,
    method:   string,
    headers:  Record<string, string>,
    body:     Record<string, unknown>,
    priority: QueuePriority = 'normal',
    type = 'generic',
    reportId?: string,
  ): Promise<string> {
    const entry: QueueEntry = {
      id:            uid(),
      url,
      method,
      headers,
      body:          JSON.stringify(body),
      priority,
      type,
      enqueuedAt:    performance.now(),
      attempts:      0,
      nextRetryAt:   Date.now(),
      createdAtWall: Date.now(),
      reportId,
    };

    await dbPut(entry);

    /* Kapı kapalı olsa bile zincir BAŞLATILIR: `_drainQueue` kendi kapısını
       zaten uygular ve kapalıysa yeniden deneme tik'i kurar. Eskiden burada
       `this._online` şartı vardı → kapı kapalıyken eklenen öğe HİÇBİR ZAMAN
       zincir başlatmıyordu ve yalnız dışarıdan gelen bir geçiş olayı onu
       uyandırabiliyordu (V-02 tıkanmasının ikinci yarısı). */
    if (!this._running) {
      void this._drainQueue();
    }
    return entry.id;
  }

  // ── Kuyruk boşaltma ───────────────────────────────────────────────────────

  private async _drainQueue(): Promise<void> {
    if (this._running) return;

    if (!this._online) {
      /* Kapı kapalı → HİÇBİR ŞEY GÖNDERİLMEZ, ama zincir KOPMAZ.
         Eskiden burada koşulsuz `return` vardı; `finally` bloğuna hiç
         girilmediği için yeniden deneme timer'ı da KURULMUYORDU. Sonuç:
         kuyruk yalnız dışarıdan gelen bir "bağlantı geldi" kenarıyla
         uyanabiliyordu — o kenar hiç gelmezse süresiz susuyordu (V-02). */
      try {
        const pending = await dbGetAll();
        if (pending.length > 0) this._scheduleDrain(CLOSED_GATE_RECHECK_MS);
      } catch { /* IDB okunamadı — bir sonraki enqueue zinciri yeniden kurar */ }
      return;
    }

    this._running = true;

    try {
      const entries = await dbGetAll();

      // Önce critical, sonra high, sonra normal; aynı öncelikte enqueuedAt sırası
      entries.sort((a, b) => {
        const pd = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
        return pd !== 0 ? pd : a.enqueuedAt - b.enqueuedAt;
      });

      const now = Date.now();

      // Kalan (kuyrukta hâlâ bekleyen) öğelerin bellek-içi takibi — döngü sonunda
      // ikinci bir dbGetAll YERİNE bu liste kullanılır (K24 perf düzeltmesi).
      // Başlangıçta tüm öğeleri içerir; entries ile AYNI obje referanslarını taşır,
      // bu yüzden retry dalındaki entry.attempts/nextRetryAt mutasyonu buraya da yansır.
      // Silinen (başarılı) öğeler listeden çıkarılır. Davranış (retry zamanlaması,
      // öncelik sırası, kuyrukta kalan öğeler) BİREBİR aynıdır.
      const remaining: QueueEntry[] = [...entries];

      for (const entry of entries) {
        if (!this._online) break;
        if (entry.nextRetryAt > now) continue; // backoff süresi dolmadı

        const cls = await this._sendEntry(entry);

        // keep/delete kararı. İzlenen tanı raporları (reportId'li): bounded-retry +
        // TTL kapısı (sonsuz retry yok). Jenerik kuyruk öğeleri (telemetri/cmd):
        // eski at-least-once sözleşmesi — 5xx/ağ'da SINIRSIZ retry (soak kilidi).
        const nowW = Date.now();
        const keep = entry.reportId
          ? shouldKeepInQueue(cls, entry.attempts + 1, entry.createdAtWall ?? nowW, nowW)
          : cls.keepInQueue;

        if (!keep) {
          // delivered / truncated / rejected / failed(cap/TTL) → kuyruktan sil
          await dbDelete(entry.id);
          const idx = remaining.findIndex((e) => e.id === entry.id);
          if (idx !== -1) remaining.splice(idx, 1);
        } else {
          // retry_scheduled / rate_limited → kuyrukta kal, attempts++ ve backoff.
          // (rate_limited SESSİZCE SİLİNMEZ — window açılınca yeniden denenir.)
          entry.attempts    += 1;
          entry.nextRetryAt  = nextRetry(entry.attempts);
          await dbPut(entry);

          // Critical olmayan öğelerde bekletme varsa diğerlerine geç
          if (entry.priority !== 'critical') continue;
          // Critical bekletmede kısa bekle, tekrar dene
          break;
        }
      }

      /* Kalan varsa timer kur. `this._online` ŞARTI KALDIRILDI: kapı tur
         sırasında kapandıysa (`break`) öğeler kuyrukta KALIR ve eskiden hiçbir
         timer kurulmazdı → zincir tam orada ölürdü. Artık tik kurulur; kapı
         hâlâ kapalıysa `_drainQueue` yine gönderim YAPMAZ, sadece yeniden
         sorar. */
      if (remaining.length > 0) {
        const earliestRetry = Math.min(...remaining.map((e) => e.nextRetryAt));
        const delay = this._online
          ? Math.max(500, earliestRetry - Date.now())
          : Math.max(CLOSED_GATE_RECHECK_MS, earliestRetry - Date.now());
        this._scheduleDrain(delay);
      }
    } finally {
      this._running = false;
    }
  }

  /** Tek yeniden deneme tik'i — her zaman TEK timer tutulur. */
  private _scheduleDrain(delayMs: number): void {
    if (this._timer) clearTimeout(this._timer);
    this._timer = setTimeout(() => {
      this._timer = null;
      void this._drainQueue();
    }, delayMs);
  }

  /**
   * Tek öğeyi gönderir ve sunucu yanıtını TESLİMAT DURUMUNA sınıflar.
   *
   * Eski sürüm yalnız `res.ok` bakıyordu → RPC'nin rate-limit `RETURN NULL`
   * yanıtını (HTTP 200 + gövde `null`) BAŞARI sanıp kuyruktan sessizce siliyordu.
   * Artık yanıt GÖVDESİ okunur: UUID → teslim; null → rate_limited (kuyrukta kal);
   * 4xx → rejected; 5xx/ağ → retry. reportId varsa teslimat defteri güncellenir.
   */
  private async _sendEntry(entry: QueueEntry): Promise<DeliveryClassification> {
    const now = Date.now();
    if (entry.reportId) markSending(entry.reportId, now);

    const sentBytes = _octetLen(entry.body);
    let outcome: HttpOutcome;
    try {
      const body = await _resolveBodySecrets(entry.body);
      if (body === null) throw new Error('queue secret unavailable');   // → ağ hatası yolu: kuyrukta kal
      const res = await fetch(entry.url, {
        method:  entry.method,
        headers: entry.headers,
        body,
        signal:  signalWithTimeout(10_000),
      });
      // Gövdeyi oku (UUID/null çıkarımı). Gövde okuma hatası BAŞARILI fetch'i asla
      // ağ-hatasına çevirmemeli (aksi halde 2xx yanlışlıkla retry olur) → izole try.
      let bodyText = '';
      try { if (typeof res.text === 'function') bodyText = await res.text(); }
      catch { bodyText = ''; }
      outcome = { status: res.status, bodyText, sentBytes };
    } catch {
      // Ağ hatası (timeout, offline, DNS) — geçici
      outcome = { networkError: true, sentBytes };
    }

    // Teslimat-kanıtı sözleşmesi (UUID/null/64KB) YALNIZ izlenen tanı raporlarına
    // (reportId'li) uygulanır; jenerik kuyruk tüketicileri eski 2xx=başarı kuralında.
    const cls = entry.reportId ? classifyHttpOutcome(outcome) : classifyGenericOutcome(outcome);
    if (entry.reportId) applyOutcome(entry.reportId, cls, now);

    if (cls.state === 'rejected') {
      console.warn(`[Connectivity] rejected (4xx) — kuyruktan siliniyor: ${entry.type}`);
    } else if (cls.state === 'rate_limited') {
      console.warn(`[Connectivity] rate_limited (RPC null/429) — kuyrukta: ${entry.type}`);
    }
    return cls;
  }

  /** Kuyruktaki öğe sayısı */
  async queueSize(): Promise<number> {
    const entries = await dbGetAll();
    return entries.length;
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

export const connectivityService = new ConnectivityService();

/** Uygulama başlangıcında bir kez çağrılmalı. */
export async function initConnectivityService(): Promise<void> {
  await connectivityService.init();
}
