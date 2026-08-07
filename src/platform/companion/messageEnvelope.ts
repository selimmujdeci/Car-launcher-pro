/**
 * messageEnvelope.ts — Companion mesaj zarfı (P1-PREP · SAF).
 *
 * SAF: I/O yok · timer yok · `Date.now()` yok (zaman DAİMA parametre) · modül durumu YOK.
 *
 * ── "SECURE" NE DEMEK, NE DEMEK DEĞİL (DÜRÜST BEYAN) ────────────────────────
 * Zarfta `encryption` ALANI vardır ama bu derlemede ŞİFRELEME UYGULANMAMIŞTIR.
 * Tek kabul edilen değer `NONE`'dır; `AES_GCM` yalnız İLERİ SÜRÜM sözleşmesi
 * olarak tanımlıdır ve gelirse `ENCRYPTION_UNSUPPORTED` ile REDDEDİLİR.
 * Aynısı `compression` için geçerlidir (`NONE` dışı → reddedilir).
 *
 * Sağlama toplamı (`checksum`) FNV-1a'dır: BÜTÜNLÜK sezme aracıdır, kriptografik
 * imza DEĞİLDİR ve kötücül değişikliğe karşı koruma SAĞLAMAZ. Bu sınır saklanmaz —
 * gerçek güvenlik P1-A'nın taşıma seçimiyle birlikte tasarlanacaktır.
 *
 * ── GİZLİLİK ────────────────────────────────────────────────────────────────
 * Zarfın KENDİSİ PII taşımaz (yalnız kimlik/tür/sürüm/damga). Yük (`payload`)
 * uygulama sözleşmesidir; bu katman yükü YORUMLAMAZ, LOGLAMAZ ve DIŞA AKTARMAZ —
 * yalnız boyutunu sınırlar ve sağlamasını hesaplar.
 */

import {
  COMPANION_ENVELOPE_SCHEMA_VERSION, MAX_PAYLOAD_CHARS,
  clampText, fnv1aHex, stableStringify,
  type CompanionErrorCode,
} from './companionDomain';

/* ══════════════════════════════════════════════════════════════════════════
 * Model
 * ════════════════════════════════════════════════════════════════════════ */

export type EnvelopeKind = 'REQUEST' | 'RESPONSE' | 'EVENT' | 'ACK';

export const ENVELOPE_KINDS: readonly EnvelopeKind[] = Object.freeze([
  'REQUEST', 'RESPONSE', 'EVENT', 'ACK',
]);

/** Uygulanan tek değer `NONE`. Diğerleri ileri sürüm sözleşmesidir. */
export type EnvelopeCompression = 'NONE' | 'GZIP';
/** Uygulanan tek değer `NONE`. `AES_GCM` UYGULANMAMIŞTIR. */
export type EnvelopeEncryption = 'NONE' | 'AES_GCM';

export const SUPPORTED_COMPRESSION: readonly EnvelopeCompression[] = Object.freeze(['NONE']);
export const SUPPORTED_ENCRYPTION: readonly EnvelopeEncryption[] = Object.freeze(['NONE']);

export interface CompanionEnvelope<T = unknown> {
  readonly schemaVersion: number;
  readonly messageId: string;
  readonly timestamp: number;
  /** İstek/yanıt eşleştirme. EVENT için null olabilir. */
  readonly correlationId: string | null;
  readonly kind: EnvelopeKind;
  /** Uygulama yük türü (ör. 'media.state'). Bu katman ANLAMINI bilmez. */
  readonly payloadType: string;
  readonly payloadVersion: number;
  readonly payload: T;
  readonly checksum: string;
  readonly compression: EnvelopeCompression;
  readonly encryption: EnvelopeEncryption;
  /** Karşı taraftan ACK bekleniyor mu. */
  readonly ack: boolean;
}

export interface EnvelopeValidation {
  readonly ok: boolean;
  readonly errors: readonly CompanionErrorCode[];
}

/* ══════════════════════════════════════════════════════════════════════════
 * Sağlama toplamı
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * Sağlama toplamı ALANI HARİÇ tüm zarf üzerinden hesaplanır (kendini içerecek
 * bir toplam hesaplanamaz). Kararlı JSON kullanılır → anahtar sırası toplamı
 * DEĞİŞTİRMEZ.
 */
export function computeEnvelopeChecksum(
  env: Omit<CompanionEnvelope, 'checksum'> & { readonly checksum?: string },
): string {
  const canonical = stableStringify({
    schemaVersion: env.schemaVersion,
    messageId: env.messageId,
    timestamp: env.timestamp,
    correlationId: env.correlationId,
    kind: env.kind,
    payloadType: env.payloadType,
    payloadVersion: env.payloadVersion,
    payload: env.payload,
    compression: env.compression,
    encryption: env.encryption,
    ack: env.ack,
  });
  return fnv1aHex(canonical);
}

/* ══════════════════════════════════════════════════════════════════════════
 * Kurucu
 * ════════════════════════════════════════════════════════════════════════ */

export interface BuildEnvelopeInput<T = unknown> {
  readonly messageId: string;
  readonly nowMs: number;
  readonly kind: EnvelopeKind;
  readonly payloadType: string;
  readonly payloadVersion?: number;
  readonly payload?: T;
  readonly correlationId?: string | null;
  readonly ack?: boolean;
  readonly compression?: EnvelopeCompression;
  readonly encryption?: EnvelopeEncryption;
}

/**
 * Zarf kurar ve sağlamasını hesaplar. Template object literal — TÜM anahtarlar
 * aynı sırada (V8 hidden-class kararlılığı).
 *
 * ASLA throw etmez. Yük tavanı aşılırsa yük DÜŞÜRÜLMEZ ve gizlenmez: zarf yine
 * kurulur ama doğrulama `PAYLOAD_TOO_LARGE` ile REDDEDER (sessiz kırpma yapıp
 * "gönderdim" demek yanlış olurdu).
 */
export function buildEnvelope<T = unknown>(input: BuildEnvelopeInput<T>): CompanionEnvelope<T> {
  const base = {
    schemaVersion: COMPANION_ENVELOPE_SCHEMA_VERSION,
    messageId: clampText(input.messageId, 64),
    timestamp: Number.isFinite(input.nowMs) ? Math.trunc(input.nowMs) : 0,
    correlationId: typeof input.correlationId === 'string' && input.correlationId.length > 0
      ? clampText(input.correlationId, 64) : null,
    kind: ENVELOPE_KINDS.includes(input.kind) ? input.kind : 'EVENT' as EnvelopeKind,
    payloadType: clampText(input.payloadType, 64),
    payloadVersion: Number.isFinite(input.payloadVersion) && (input.payloadVersion as number) > 0
      ? Math.trunc(input.payloadVersion as number) : 1,
    payload: (input.payload === undefined ? null : input.payload) as T,
    compression: (input.compression ?? 'NONE') as EnvelopeCompression,
    encryption: (input.encryption ?? 'NONE') as EnvelopeEncryption,
    ack: input.ack === true,
  };
  return { ...base, checksum: computeEnvelopeChecksum(base) };
}

/** İstek zarfı — ACK/yanıt bekler. */
export function buildRequest<T = unknown>(
  messageId: string, nowMs: number, payloadType: string, payload?: T, payloadVersion = 1,
): CompanionEnvelope<T> {
  return buildEnvelope({
    messageId, nowMs, kind: 'REQUEST', payloadType, payloadVersion, payload,
    correlationId: messageId, ack: true,
  });
}

/**
 * Yanıt zarfı — `correlationId` İSTEĞİN correlationId'sini taşır.
 * Bu bağ olmadan geciken yanıtlar yanlış isteğe eşlenir.
 */
export function buildResponse<T = unknown>(
  messageId: string, nowMs: number, request: CompanionEnvelope, payloadType: string,
  payload?: T, payloadVersion = 1,
): CompanionEnvelope<T> {
  return buildEnvelope({
    messageId, nowMs, kind: 'RESPONSE', payloadType, payloadVersion, payload,
    correlationId: request ? (request.correlationId ?? request.messageId) : null,
    ack: false,
  });
}

/** ACK zarfı — yük TAŞIMAZ (yalnız teslim onayı). */
export function buildAck(
  messageId: string, nowMs: number, request: CompanionEnvelope,
): CompanionEnvelope<null> {
  return buildEnvelope<null>({
    messageId, nowMs, kind: 'ACK', payloadType: 'companion.ack', payloadVersion: 1,
    payload: null,
    correlationId: request ? (request.correlationId ?? request.messageId) : null,
    ack: false,
  });
}

/* ══════════════════════════════════════════════════════════════════════════
 * Doğrulama — FAIL-CLOSED, ASLA throw etmez
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * Gelen zarfı doğrular. TÜM hatalar toplanır (ilk hatada durmaz) — sahada
 * "hem şema eski hem sağlama bozuk" gibi birleşik arızalar tek bakışta görünsün.
 */
export function validateEnvelope(v: unknown): EnvelopeValidation {
  const errors: CompanionErrorCode[] = [];
  const push = (c: CompanionErrorCode): void => { if (!errors.includes(c)) errors.push(c); };

  if (!v || typeof v !== 'object' || Array.isArray(v)) {
    return { ok: false, errors: ['ENVELOPE_MALFORMED'] };
  }
  const e = v as Partial<CompanionEnvelope> & Record<string, unknown>;

  if (typeof e.messageId !== 'string' || e.messageId.length === 0) push('ENVELOPE_MALFORMED');
  if (typeof e.timestamp !== 'number' || !Number.isFinite(e.timestamp)) push('ENVELOPE_MALFORMED');
  if (typeof e.payloadType !== 'string' || e.payloadType.length === 0) push('ENVELOPE_MALFORMED');
  if (typeof e.payloadVersion !== 'number' || !Number.isFinite(e.payloadVersion)
    || e.payloadVersion <= 0) push('ENVELOPE_MALFORMED');
  if (typeof e.kind !== 'string' || !ENVELOPE_KINDS.includes(e.kind as EnvelopeKind)) {
    push('ENVELOPE_MALFORMED');
  }
  if (typeof e.ack !== 'boolean') push('ENVELOPE_MALFORMED');
  if (e.correlationId !== null && typeof e.correlationId !== 'string') push('ENVELOPE_MALFORMED');

  if (typeof e.schemaVersion !== 'number' || !Number.isFinite(e.schemaVersion)) {
    push('ENVELOPE_MALFORMED');
  } else if (e.schemaVersion !== COMPANION_ENVELOPE_SCHEMA_VERSION) {
    /* İleri/geri şema: sessizce kabul edilmez. Alan anlamı kaymış olabilir. */
    push('ENVELOPE_SCHEMA_UNSUPPORTED');
  }

  if (!SUPPORTED_COMPRESSION.includes(e.compression as EnvelopeCompression)) {
    push('COMPRESSION_UNSUPPORTED');
  }
  if (!SUPPORTED_ENCRYPTION.includes(e.encryption as EnvelopeEncryption)) {
    /* `AES_GCM` geçerli bir ENUM ama UYGULANMADI → kabul edilmez. */
    push('ENCRYPTION_UNSUPPORTED');
  }

  // Yük tavanı — kararlı JSON uzunluğu üzerinden (bounded, throw etmez).
  let payloadChars = 0;
  try { payloadChars = stableStringify(e.payload).length; } catch { payloadChars = 0; }
  if (payloadChars > MAX_PAYLOAD_CHARS) push('PAYLOAD_TOO_LARGE');

  // ACK zarfı yük TAŞIMAMALI (sözleşme).
  if (e.kind === 'ACK' && e.payload !== null && e.payload !== undefined) {
    push('ENVELOPE_MALFORMED');
  }

  // Sağlama toplamı EN SONDA: yapı bozuksa toplam hesaplamak anlamsızdır.
  if (typeof e.checksum !== 'string' || e.checksum.length === 0) {
    push('ENVELOPE_MALFORMED');
  } else if (!errors.includes('ENVELOPE_MALFORMED')) {
    const expected = computeEnvelopeChecksum(e as CompanionEnvelope);
    if (expected !== e.checksum) push('CHECKSUM_MISMATCH');
  }

  return { ok: errors.length === 0, errors: Object.freeze(errors) };
}

/** Sağlama toplamı tek başına doğru mu (tanılama için ayrı kapı). */
export function verifyChecksum(v: unknown): boolean {
  if (!v || typeof v !== 'object') return false;
  const e = v as CompanionEnvelope;
  if (typeof e.checksum !== 'string' || e.checksum.length === 0) return false;
  try {
    return computeEnvelopeChecksum(e) === e.checksum;
  } catch {
    return false;
  }
}

/** Yanıt bu isteğe mi ait — geciken yanıtın yanlış isteğe eşlenmesini engeller. */
export function matchesRequest(request: CompanionEnvelope, response: CompanionEnvelope): boolean {
  if (!request || !response) return false;
  const key = request.correlationId ?? request.messageId;
  const other = response.correlationId;
  return typeof key === 'string' && key.length > 0 && key === other;
}
