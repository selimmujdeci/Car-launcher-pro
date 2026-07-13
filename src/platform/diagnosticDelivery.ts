/**
 * diagnosticDelivery.ts — Teslimat Gerçeği (Delivery Truth) çekirdeği.
 *
 * PROBLEM: "kuyruğa kabul edildi" ile "sunucuya gerçekten teslim edildi" AYNI
 * şey değildi. `triggerSupportSnapshot` → `pushVehicleEvent` → `connectivityService
 * .enqueue` yalnız IndexedDB'ye YAZAR ve döner; gerçek `fetch` daha sonra drain
 * döngüsünde olur. Eski akış enqueue çözülünce UI'ya `'sent'` ("Gönderildi") diyordu
 * — yalancı başarı. Dahası `_sendEntry` sunucu yanıt gövdesini (UUID) hiç okumuyordu
 * ve RPC'nin rate-limit `RETURN NULL` yanıtını (HTTP 200) başarı sanıp kuyruktan
 * SESSİZCE siliyordu (sessiz kayıp).
 *
 * Bu modül SAF (yan-etkisiz) teslimat durum makinesidir:
 *   • Sunucu sözleşmesini kodlar (aşağıdaki "Sunucu sözleşmesi").
 *   • HTTP sonucunu → tek doğru duruma sınıflar (classifyHttpOutcome).
 *   • Sınırlı (bounded LRU) bir teslimat defterinde durum geçişlerini izler;
 *     geçişler MONOTONİK: 'delivered'/'truncated'/'rejected'/'failed' terminaldir,
 *     geriye düşmez (bir kez teslim → hep teslim).
 *   • Idempotency: aynı reportId ikinci kez başlatılamaz (duplicate gönderim yok).
 *   • Bounded retry + TTL: sonsuz retry yok (attempts tavanı / yaş tavanı → 'failed').
 *
 * ── Sunucu sözleşmesi (public.push_vehicle_event, RETURNS uuid) ──────────────
 *   Başarı           → INSERT + `RETURNING id` → HTTP 200, gövde = "<uuid>"
 *   Rate limit        → 30/60sn log aşıldı → `RETURN NULL` → HTTP 200, gövde = null
 *   Geçersiz api_key  → `RAISE EXCEPTION invalid_api_key` → HTTP 4xx (retry faydasız)
 *   64 KB aşımı       → sunucu kırpılmış stub SAKLAR ama YİNE geçerli uuid döner;
 *                       istemci payload byte'ını bildiği için truncation'ı KENDİ ölçer
 *   5xx / ağ hatası   → geçici → kuyrukta kal, backoff ile tekrar dene
 *
 * Bu modül `connectivityService` (kuyruk sınıflandırma), `vehicleIdentityService`
 * (reportId threading) ve `remoteLogService` (UI'ya gerçek durum) tarafından tüketilir.
 * Hiç import etmez (saf) → bağımlılık döngüsü yok, tam birim-test edilebilir.
 */

/* ── Durum modeli ───────────────────────────────────────────────────────── */

/**
 * Teslimat durumu — "kabul" ile "teslim" kesin ayrımı.
 *   queued          : kuyruğa kabul edildi, henüz gönderim denenmedi
 *   sending         : fetch uçuşta
 *   delivered       : sunucu UUID döndürdü — KESİN teslim (tek gerçek başarı)
 *   retry_scheduled : 5xx / ağ hatası — kuyrukta, backoff'ta yeniden denenecek
 *   rate_limited    : RPC NULL (30/60sn aşıldı) — kuyrukta, SESSİZCE SİLİNMEZ
 *   truncated       : teslim edildi AMA gövde 64 KB'de kırpıldı — kullanıcı uyarılır
 *   rejected        : 4xx (geçersiz api_key / bad payload) — retry faydasız, GÖRÜNÜR
 *   failed          : retry tavanı / TTL doldu — kalıcı başarısız
 */
export type DeliveryState =
  | 'queued'
  | 'sending'
  | 'delivered'
  | 'retry_scheduled'
  | 'rate_limited'
  | 'truncated'
  | 'rejected'
  | 'failed';

/** Terminal durumlar — bir kez girilince geçiş kabul edilmez (monotonik). */
const TERMINAL: ReadonlySet<DeliveryState> = new Set<DeliveryState>([
  'delivered', 'truncated', 'rejected', 'failed',
]);

export function isTerminal(state: DeliveryState): boolean {
  return TERMINAL.has(state);
}

/** Teslimat başarılı sayılır mı — YALNIZ 'delivered' (truncated dahil DEĞİL: veri kaybı). */
export function isDelivered(state: DeliveryState): boolean {
  return state === 'delivered';
}

/* ── Sunucu sözleşmesi sabitleri ────────────────────────────────────────── */

/** push_vehicle_event c_max_bytes — bunu aşan payload sunucuda kırpılır. */
export const SERVER_MAX_BYTES = 65_536;

/** Bounded retry tavanı — bu kadar denemeden sonra 'failed' (sonsuz retry yok). */
export const MAX_DELIVERY_ATTEMPTS = 8;

/** TTL — ilk kuyruğa girişten bu süre sonra teslim olmadıysa 'failed' (24 saat). */
export const DELIVERY_TTL_MS = 24 * 60 * 60 * 1_000;

/** Defter tavanı — sınırsız büyüme yok (zero-leak, en eski kayıt düşer). */
export const LEDGER_MAX = 64;

/* ── UUID çıkarma ───────────────────────────────────────────────────────── */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Sunucu yanıt gövdesinden event UUID'sini çıkarır (teslim kanıtı).
 *
 * PostgREST `RETURNS uuid` skaler dönüşü gövdeyi JSON string olarak verir:
 *   "3f2504e0-4f89-41d3-9a0c-0305e82c3301"
 * Savunmacı: kimi kurulum diziye/objeye sarabilir → onları da çözer.
 * Rate-limit `RETURN NULL` → gövde `null` → UUID YOK (null döner).
 */
export function extractServerReportId(bodyText: string | undefined | null): string | null {
  if (bodyText == null) return null;
  const trimmed = bodyText.trim();
  if (trimmed === '' || trimmed === 'null') return null;

  // Ham UUID (tırnaksız) — bazı gateway'ler böyle döndürebilir
  if (UUID_RE.test(trimmed)) return trimmed;

  let parsed: unknown;
  try { parsed = JSON.parse(trimmed); }
  catch { return null; }

  return _uuidFromValue(parsed);
}

function _uuidFromValue(v: unknown): string | null {
  if (typeof v === 'string') return UUID_RE.test(v.trim()) ? v.trim() : null;
  if (Array.isArray(v)) {
    for (const el of v) { const u = _uuidFromValue(el); if (u) return u; }
    return null;
  }
  if (v && typeof v === 'object') {
    const rec = v as Record<string, unknown>;
    // yaygın alan adları: push_vehicle_event / id / uuid / event_id
    for (const k of ['push_vehicle_event', 'id', 'uuid', 'event_id']) {
      const u = _uuidFromValue(rec[k]);
      if (u) return u;
    }
  }
  return null;
}

/* ── Sınıflandırıcı (SAF) ───────────────────────────────────────────────── */

export interface HttpOutcome {
  /** fetch throw etti (timeout / offline / DNS) — status yok. */
  networkError?: boolean;
  /** HTTP durum kodu (networkError yoksa). */
  status?: number;
  /** Yanıt gövdesi ham metni (UUID/null çıkarımı için). */
  bodyText?: string | null;
  /** İstemcinin GÖNDERDİĞİ payload octet uzunluğu (truncation ölçümü). */
  sentBytes: number;
}

export interface DeliveryClassification {
  state: DeliveryState;
  /** Teslim kanıtı UUID'si (delivered/truncated'da dolu, aksi null). */
  serverReportId: string | null;
  /** Kuyrukta tutulmalı mı — false ise kuyruktan silinir. */
  keepInQueue: boolean;
  /** Kullanıcıya gösterilmeli mi (rejected/rate_limited/truncated görünür). */
  userVisible: boolean;
}

/**
 * HTTP sonucunu → tek doğru teslimat durumuna sınıflar (SAF, yan-etkisiz).
 *
 * Karar tablosu (sunucu sözleşmesi):
 *   ağ hatası        → retry_scheduled  · kuyrukta kal · sessiz
 *   2xx + UUID + ≤64KB → delivered      · sil          · sessiz (başarı)
 *   2xx + UUID + >64KB → truncated      · sil          · GÖRÜNÜR (veri kaybı uyarısı)
 *   2xx + null/boş     → rate_limited   · kuyrukta kal · GÖRÜNÜR  (RPC NULL ≠ başarı)
 *   2xx + UUID yok     → failed         · sil          · GÖRÜNÜR  (kanıtsız başarı reddi)
 *   429               → rate_limited    · kuyrukta kal · GÖRÜNÜR
 *   4xx (diğer)        → rejected        · sil          · GÖRÜNÜR
 *   5xx               → retry_scheduled  · kuyrukta kal · sessiz
 */
export function classifyHttpOutcome(outcome: HttpOutcome): DeliveryClassification {
  if (outcome.networkError) {
    return { state: 'retry_scheduled', serverReportId: null, keepInQueue: true, userVisible: false };
  }

  const status = outcome.status ?? 0;

  if (status >= 200 && status < 300) {
    const uuid = extractServerReportId(outcome.bodyText);
    if (uuid) {
      // >64KB → sunucu kırptı (yine uuid döndü ama gövde eksik) → teslim AMA lossy
      if (outcome.sentBytes > SERVER_MAX_BYTES) {
        return { state: 'truncated', serverReportId: uuid, keepInQueue: false, userVisible: true };
      }
      return { state: 'delivered', serverReportId: uuid, keepInQueue: false, userVisible: false };
    }
    // 2xx ama UUID yok:
    const body = (outcome.bodyText ?? '').trim();
    if (body === '' || body === 'null') {
      // RPC NULL — rate limit. SESSİZCE SİLİNMEZ (kuyrukta kalır, window açılınca yeniden).
      return { state: 'rate_limited', serverReportId: null, keepInQueue: true, userVisible: true };
    }
    // 2xx + tanımsız gövde → teslim KANITI YOK → başarı SAYMA (yalancı 'sent' önlemi).
    return { state: 'failed', serverReportId: null, keepInQueue: false, userVisible: true };
  }

  if (status === 429) {
    return { state: 'rate_limited', serverReportId: null, keepInQueue: true, userVisible: true };
  }

  if (status >= 400 && status < 500) {
    // 4xx (invalid_api_key vb.) — retry faydasız, kullanıcıya görünür.
    return { state: 'rejected', serverReportId: null, keepInQueue: false, userVisible: true };
  }

  // 5xx (ve tanınmayan) — geçici, kuyrukta kal.
  return { state: 'retry_scheduled', serverReportId: null, keepInQueue: true, userVisible: false };
}

/**
 * JENERİK HTTP sonucu sınıflandırması — push_vehicle_event teslimat-kanıtı
 * sözleşmesi OLMAYAN kuyruk tüketicileri için (cmd_status, location, ham telemetri).
 *
 * Bu yolda 2xx = başarı (gövde okunmaz): UUID/null/64KB semantiği YALNIZ
 * push_vehicle_event'e özgüdür ve boş-gövde 2xx dönen jenerik uçlara DAYATILMAZ
 * (aksi halde başarı yanlışlıkla rate_limited sanılır). Eski `_sendEntry` davranışı
 * birebir: 2xx sil · 4xx sil · 5xx/ağ kuyrukta kal.
 */
export function classifyGenericOutcome(outcome: HttpOutcome): DeliveryClassification {
  if (outcome.networkError) {
    return { state: 'retry_scheduled', serverReportId: null, keepInQueue: true, userVisible: false };
  }
  const status = outcome.status ?? 0;
  if (status >= 200 && status < 300) {
    return { state: 'delivered', serverReportId: null, keepInQueue: false, userVisible: false };
  }
  if (status >= 400 && status < 500) {
    return { state: 'rejected', serverReportId: null, keepInQueue: false, userVisible: false };
  }
  return { state: 'retry_scheduled', serverReportId: null, keepInQueue: true, userVisible: false };
}

/* ── Teslimat defteri (bounded LRU) ─────────────────────────────────────── */

export interface DeliveryRecord {
  reportId:       string;         // istemci korelasyon/idempotency anahtarı
  type:           string;         // event tipi ('support_snapshot' vb.)
  state:          DeliveryState;
  serverReportId: string | null;  // sunucu UUID'si (teslim kanıtı)
  attempts:       number;         // gönderim denemesi sayısı
  firstSeenAt:    number;         // Date.now() — ilk kuyruğa giriş (TTL için)
  updatedAt:      number;         // Date.now() — son durum değişimi
}

/** Ekleme sırasını koruyan Map → LRU tahliyesi için (en eski = ilk anahtar). */
const _ledger = new Map<string, DeliveryRecord>();

/** Dışa sızıntı yok: her okuma dondurulmuş kopya döndürür (immutable sözleşme). */
function _freeze(r: DeliveryRecord): DeliveryRecord {
  return Object.freeze({ ...r });
}

/**
 * Yeni teslimat kaydı başlatır (idempotent).
 * Dönüş:
 *   { record, isDuplicate: false } → yeni kayıt oluşturuldu ('queued')
 *   { record, isDuplicate: true  } → aynı reportId zaten var (yeni gönderim YOK)
 *
 * "duplicate gönderilmesin": aynı reportId ikinci kez başlatılırsa MEVCUT kayıt
 * döner ve çağıran enqueue ETMEZ (aynı rapor tek kayıt).
 */
export function beginDelivery(reportId: string, type: string, now: number): {
  record: DeliveryRecord;
  isDuplicate: boolean;
} {
  const existing = _ledger.get(reportId);
  if (existing) return { record: _freeze(existing), isDuplicate: true };

  // Bounded: tavana ulaşınca en eski kaydı düşür (zero-leak)
  if (_ledger.size >= LEDGER_MAX) {
    const oldest = _ledger.keys().next().value;
    if (oldest !== undefined) _ledger.delete(oldest);
  }

  const rec: DeliveryRecord = {
    reportId, type,
    state: 'queued',
    serverReportId: null,
    attempts: 0,
    firstSeenAt: now,
    updatedAt: now,
  };
  _ledger.set(reportId, rec);
  return { record: _freeze(rec), isDuplicate: false };
}

/** Gönderim uçuşa çıktı — 'sending' (yalnız terminal olmayan kayıtta). */
export function markSending(reportId: string, now: number): void {
  const rec = _ledger.get(reportId);
  if (!rec || isTerminal(rec.state)) return;
  rec.state = 'sending';
  rec.updatedAt = now;
}

/**
 * Bir gönderim denemesinin sonucunu deftere uygular (MONOTONİK).
 *
 *  - Terminal kayıt DEĞİŞMEZ (bir kez delivered/rejected → hep öyle).
 *  - retry_scheduled/rate_limited denemesinde attempts++ ; tavan/TTL aşılırsa
 *    'failed'a düşürülür (sonsuz retry yok).
 *  - delivered/truncated/rejected doğrudan terminaldir.
 *
 * Dönüş: güncellenmiş (dondurulmuş) kayıt — kayıt yoksa null.
 */
export function applyOutcome(
  reportId: string,
  cls: DeliveryClassification,
  now: number,
): DeliveryRecord | null {
  const rec = _ledger.get(reportId);
  if (!rec) return null;
  if (isTerminal(rec.state)) return _freeze(rec); // monotonik: terminal sabittir

  rec.attempts += 1;
  rec.updatedAt = now;
  if (cls.serverReportId) rec.serverReportId = cls.serverReportId;

  if (isTerminal(cls.state)) {
    rec.state = cls.state; // delivered / truncated / rejected / failed
    return _freeze(rec);
  }

  // Geçici durum (retry_scheduled / rate_limited): bounded retry + TTL kapısı
  const expired = (now - rec.firstSeenAt) >= DELIVERY_TTL_MS;
  const exhausted = rec.attempts >= MAX_DELIVERY_ATTEMPTS;
  rec.state = (expired || exhausted) ? 'failed' : cls.state;
  return _freeze(rec);
}

/**
 * Kuyruk drain'i için karar: bu deneme sonrası öğe kuyrukta tutulmalı mı?
 * classification.keepInQueue'yu bounded-retry/TTL ile birleştirir — tavan/TTL
 * aşıldıysa (kalıcı 'failed') artık kuyrukta TUTULMAZ (sonsuz retry engeli).
 */
export function shouldKeepInQueue(
  cls: DeliveryClassification,
  attemptsAfter: number,
  firstSeenAt: number,
  now: number,
): boolean {
  if (!cls.keepInQueue) return false;
  if (attemptsAfter >= MAX_DELIVERY_ATTEMPTS) return false;
  if ((now - firstSeenAt) >= DELIVERY_TTL_MS)  return false;
  return true;
}

/** Kaydı okur (dondurulmuş kopya) — yoksa null. */
export function getDelivery(reportId: string): DeliveryRecord | null {
  const rec = _ledger.get(reportId);
  return rec ? _freeze(rec) : null;
}

/** Kullanıcıya gösterilecek kısa özet metni (UI truth — yalancı 'Gönderildi' yok). */
export function deliveryLabel(state: DeliveryState): string {
  switch (state) {
    case 'queued':          return 'Kuyrukta';
    case 'sending':         return 'Gönderiliyor…';
    case 'delivered':       return 'Gönderildi';
    case 'retry_scheduled': return 'Bağlantı bekleniyor — yeniden denenecek';
    case 'rate_limited':    return 'Sunucu sınırı — kuyrukta, birazdan yeniden';
    case 'truncated':       return 'Gönderildi (rapor çok büyük — kısaltıldı)';
    case 'rejected':        return 'Reddedildi — cihaz eşlemesini kontrol edin';
    case 'failed':          return 'Gönderilemedi — daha sonra tekrar deneyin';
  }
}

/* ── Idempotency anahtarı ───────────────────────────────────────────────── */

/**
 * Deterministik reportId üretir (idempotency). Aynı (type, seed) → aynı anahtar
 * → defter tek kayıt tutar → duplicate gönderim engellenir. FNV-1a 32-bit hash
 * (kriptografik değil; yalnız korelasyon/dedup için yeterli, allocation-hafif).
 */
export function deriveReportId(type: string, seed: string): string {
  let h = 0x811c9dc5;
  const s = `${type}:${seed}`;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `${type}-${(h >>> 0).toString(16).padStart(8, '0')}`;
}

/* ── Test yardımcısı ────────────────────────────────────────────────────── */

/** Vitest: defter durumunu sıfırlar (modül-seviyesi state izolasyonu). */
export function _resetDeliveryLedgerForTest(): void {
  _ledger.clear();
}
