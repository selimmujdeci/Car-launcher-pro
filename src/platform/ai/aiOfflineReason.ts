/**
 * aiOfflineReason — Mavi'nin Offline Mode'a GEÇİŞ SEBEBİNİN tek kayıt noktası.
 *
 * KURAL (SAHA 2026-07-22, "internet var ama Mavi offline'a düşüyor"):
 * **SESSİZCE OFFLINE'A DÜŞMEK YASAKTIR.** Devre kesici her açıldığında burada
 * tipli bir SEBEP KODU + tek satırlık yapılandırılmış kayıt üretilir. Sahada
 * "neden offline oldu?" sorusu tahminle değil KANITLA yanıtlanır.
 *
 * ── NEDEN AYRI MODÜL ───────────────────────────────────────────────────────
 * `aiHealth` devre kesicinin KARARINI verir; bu modül o kararın MUHASEBESİNİ
 * tutar. Karar mantığı burada YOKTUR (SRP) — bu modül hiçbir zaman "offline ol"
 * demez, yalnız olan biteni yazar.
 *
 * ── ÜRETİMDE DE ÇALIŞIR ────────────────────────────────────────────────────
 * `logInfo` DEBUG_ENABLED kapalıyken susar; offline geçişi ise SAHADA teşhis
 * edilmesi gereken bir olaydır → `console.warn` kullanılır (debug/index.ts:
 * "Kritik console.error / console.warn dokunulmaz"). Ek olarak son N kayıt
 * RAM'de sınırlı bir halkada tutulur → tanı raporu PII'siz taşıyabilir.
 *
 * ── SINIRLAR (otomotiv) ────────────────────────────────────────────────────
 *   - Sabit boyutlu halka (bellek sızıntısı yok — CLAUDE.md §1)
 *   - API anahtarı / kişisel veri / istem metni KAYDEDİLMEZ
 *   - Süreler monotonik saatten (`performance.now`) — clock-jump güvenli (§4)
 *   - requestId sayaç tabanlı (Math.random YOK — deterministik)
 */

/* ── Sebep kodları ─────────────────────────────────────────────────────────── */

/**
 * Offline'a geçişin TİPLİ sebebi. Yeni bir sebep eklemek = bu birliğe bir satır;
 * `UNKNOWN` yalnız sınıflandırılamayan durumlar içindir (asla varsayılan değil).
 */
export type AiOfflineReason =
  | 'NETWORK_TIMEOUT'         // istek süre aşımına uğradı (fetch throw/abort)
  | 'NETWORK_UNREACHABLE'     // DNS/TLS/bağlantı kopması — sunucuya ULAŞILAMADI
  | 'DEVICE_OFFLINE'          // cihaz gerçekten çevrimdışı (uçak modu)
  | 'PROVIDER_RATE_LIMITED'   // HTTP 429 — ağ CANLI
  | 'PROVIDER_SERVER_ERROR'   // HTTP 5xx — ağ CANLI
  | 'PROVIDER_AUTH_FAILED'    // HTTP 401/403 — anahtar sorunu, ağ CANLI
  | 'PROVIDER_HEALTH_FAILED'  // devre kesici zaten açık — istek gönderilmedi
  | 'SESSION_ABORTED'         // çağıran iptal etti (barge-in)
  | 'NO_PROVIDER'             // yapılandırılmış sağlayıcı yok (wiring)
  | 'INVALID_RESPONSE'        // sözleşme dışı yanıt
  | 'UNKNOWN';

/** Gateway hata sınıfı → offline sebep kodu. TEK eşleme noktası. */
export function offlineReasonFromErrorKind(kind: string): AiOfflineReason {
  switch (kind) {
    case 'timeout':            return 'NETWORK_TIMEOUT';
    case 'network':            return 'NETWORK_UNREACHABLE';
    case 'offline':            return 'DEVICE_OFFLINE';
    case 'rate_limited':       return 'PROVIDER_RATE_LIMITED';
    case 'server':             return 'PROVIDER_SERVER_ERROR';
    case 'auth':
    case 'no_api_key':         return 'PROVIDER_AUTH_FAILED';
    case 'circuit_open':       return 'PROVIDER_HEALTH_FAILED';
    case 'aborted':            return 'SESSION_ABORTED';
    case 'no_provider':        return 'NO_PROVIDER';
    case 'malformed_response': return 'INVALID_RESPONSE';
    default:                   return 'UNKNOWN';
  }
}

/**
 * Yakalanan bir exception'ı gateway hata sınıfına çevirir (eski, gateway'siz
 * yollar için: companion/aiVoice/semantic `catch` blokları).
 *
 * `signalWithTimeout` süre aşımında AbortError atar → `timeout`.
 * `fetch` ağ kopmasında TypeError atar → `network`.
 * Sınıflandırılamayan → `unknown` (UYDURULMAZ).
 */
export function errorKindFromException(err: unknown): string {
  const name = (err as { name?: unknown } | null)?.name;
  if (name === 'AbortError' || name === 'TimeoutError') return 'timeout';
  if (name === 'TypeError') return 'network';
  return 'unknown';
}

/* ── Kayıt şekli ───────────────────────────────────────────────────────────── */

/**
 * Offline geçişinin tek satırlık künyesi. Alanların hepsi OPSİYONEL olabilir
 * (bilinmeyen alan UYDURULMAZ — "?" basılır), ama `reason` ZORUNLUDUR.
 *
 * ⚠️ V8 Hidden Class kararlılığı (CLAUDE.md): tüm alanlar TEK şablonda ve
 * arayüzdeki sırayla kurulur; alan SİLİNMEZ (undefined bırakılır).
 */
export interface AiOfflineDetail {
  readonly provider?:      string;
  readonly model?:         string;
  readonly requestId?:     string;
  /** İsteğin başlangıcından hataya kadar geçen süre (ms, monotonik). */
  readonly latencyMs?:     number;
  /** HTTP durum kodu (sunucu yanıt verdiyse). */
  readonly httpStatus?:    number;
  /** Hata/exception türü — gateway hata sınıfı ya da DOMException adı. */
  readonly exceptionType?: string;
  /** Bu istekte yapılan yeniden deneme sayısı. */
  readonly retries?:       number;
}

export interface AiOfflineRecord {
  readonly reason:        AiOfflineReason;
  /** Duvar saati (ISO) — insan okuması için; SÜRE hesabında kullanılmaz. */
  readonly timestamp:     string;
  /** Monotonik zaman damgası (performance.now) — süre hesapları için. */
  readonly atMs:          number;
  readonly provider:      string | undefined;
  readonly model:         string | undefined;
  readonly requestId:     string | undefined;
  readonly latencyMs:     number | undefined;
  readonly httpStatus:    number | undefined;
  readonly exceptionType: string | undefined;
  readonly retries:       number | undefined;
  /** Devrenin ne kadar açık kalacağı (ms). */
  readonly blockedForMs:  number;
}

/* ── Sınırlı halka (bounded ring) ──────────────────────────────────────────── */

const MAX_RECORDS = 20;
const _records: AiOfflineRecord[] = [];

let _requestSeq = 0;

/**
 * Deterministik istek kimliği (Math.random YOK). Bir konuşma turunu gateway
 * denemeleri ve offline kaydı boyunca izlenebilir kılar.
 */
export function nextAiRequestId(): string {
  _requestSeq = (_requestSeq + 1) % 1_000_000;
  return `ai-${_requestSeq}`;
}

function _nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : 0;
}

function _fmt(v: string | number | undefined): string {
  return v === undefined || v === '' ? '?' : String(v);
}

/**
 * Offline geçişini KAYDEDER ve tek satır olarak basar.
 *
 * ASLA throw etmez: teşhis katmanı asistanı düşüremez (fail-soft).
 */
export function recordAiOfflineTransition(
  reason:       AiOfflineReason,
  blockedForMs: number,
  detail?:      AiOfflineDetail,
): AiOfflineRecord {
  const record: AiOfflineRecord = {
    reason,
    timestamp:     _safeIso(),
    atMs:          _nowMs(),
    provider:      detail?.provider,
    model:         detail?.model,
    requestId:     detail?.requestId,
    latencyMs:     detail?.latencyMs,
    httpStatus:    detail?.httpStatus,
    exceptionType: detail?.exceptionType,
    retries:       detail?.retries,
    blockedForMs,
  };

  _records.push(record);
  if (_records.length > MAX_RECORDS) _records.shift();

  try {
    // Tek satır — saha logcat'inde grep'lenebilir: `grep OFFLINE_REASON`
    // (console.warn bilinçli: debug/index.ts "kritik console.warn dokunulmaz")
    console.warn(
      `OFFLINE_REASON: ${reason} | ts=${record.timestamp}` +
      ` provider=${_fmt(record.provider)} model=${_fmt(record.model)}` +
      ` requestId=${_fmt(record.requestId)} latency=${_fmt(record.latencyMs)}ms` +
      ` http=${_fmt(record.httpStatus)} exception=${_fmt(record.exceptionType)}` +
      ` retries=${_fmt(record.retries)} blockedFor=${blockedForMs}ms`,
    );
  } catch { /* konsol yoksa kayıt yine de halkada durur */ }

  return record;
}

function _safeIso(): string {
  try { return new Date().toISOString(); } catch { return 'unknown'; }
}

/** Son offline geçişi (hiç yoksa null) — tanı raporu / "neden offline?" sorusu. */
export function getLastAiOfflineRecord(): AiOfflineRecord | null {
  return _records.length > 0 ? (_records[_records.length - 1] as AiOfflineRecord) : null;
}

/** Sınırlı offline geçmişi (en eskiden yeniye) — PII YOK. */
export function getAiOfflineHistory(): readonly AiOfflineRecord[] {
  return _records.slice();
}

/** @internal — testler arası izolasyon. */
export function _resetAiOfflineReasonForTest(): void {
  _records.length = 0;
  _requestSeq = 0;
}
