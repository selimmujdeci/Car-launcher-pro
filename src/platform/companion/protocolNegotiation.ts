/**
 * protocolNegotiation.ts — Protokol sürümü + yetenek anlaşması (P1-PREP · SAF).
 *
 * SAF: I/O yok · timer yok · `Date.now()` yok · modül durumu YOK.
 *
 * ── İKİ AYRI EKSEN ──────────────────────────────────────────────────────────
 * (1) PROTOKOL SÜRÜMÜ: wire biçimi/anlamı. Aralık kesişimi yoksa bağlantı
 *     REDDEDİLİR — "en yakınını dene" YOKTUR (yanlış yorumlanmış bayt, sessiz
 *     hatanın en kötü türüdür).
 * (2) YETENEK: hangi işlevler kullanılabilir. Kesişim boş olabilir; bu bir HATA
 *     DEĞİLDİR — bağlantı kurulur ama hiçbir yetenek kullanılamaz.
 *
 * Bu ayrım bilinçlidir: sürüm uyuşmazlığı FAIL, yetenek yokluğu DEĞİL.
 */

import {
  COMPANION_MIN_PROTOCOL_VERSION, COMPANION_PROTOCOL_VERSION,
  isKnownCapability, isValidCapabilityToken,
  type CapabilityToken, type CompanionCapability, type CompanionErrorCode,
} from './companionDomain';

/* ══════════════════════════════════════════════════════════════════════════
 * Protokol sürümü
 * ════════════════════════════════════════════════════════════════════════ */

export interface ProtocolRange {
  readonly min: number;
  readonly max: number;
}

export const LOCAL_PROTOCOL_RANGE: ProtocolRange = Object.freeze({
  min: COMPANION_MIN_PROTOCOL_VERSION,
  max: COMPANION_PROTOCOL_VERSION,
});

export interface ProtocolNegotiationResult {
  readonly ok: boolean;
  /** Anlaşılan sürüm; anlaşma yoksa null (varsayılan UYDURULMAZ). */
  readonly agreed: number | null;
  readonly local: ProtocolRange;
  /** Karşı tarafın beyanı — okunamazsa null. */
  readonly remote: ProtocolRange | null;
  readonly error: CompanionErrorCode | null;
}

function _range(v: unknown): ProtocolRange | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const min = o.min;
  const max = o.max;
  if (typeof min !== 'number' || typeof max !== 'number') return null;
  if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
  const lo = Math.trunc(min);
  const hi = Math.trunc(max);
  if (lo <= 0 || hi <= 0 || hi < lo) return null;
  return { min: lo, max: hi };
}

/**
 * Sürüm anlaşması: iki aralığın kesişiminde EN YÜKSEK ortak sürüm seçilir.
 * Kesişim boşsa `PROTOCOL_VERSION_MISMATCH` — geri düşme (downgrade) YAPILMAZ.
 *
 * ASLA throw etmez; okunamayan karşı beyan da uyuşmazlık sayılır (fail-closed).
 */
export function negotiateProtocol(
  remote: unknown,
  local: ProtocolRange = LOCAL_PROTOCOL_RANGE,
): ProtocolNegotiationResult {
  const localRange = _range(local) ?? LOCAL_PROTOCOL_RANGE;
  const remoteRange = _range(remote);

  if (remoteRange === null) {
    return {
      ok: false, agreed: null, local: localRange, remote: null,
      error: 'PROTOCOL_VERSION_MISMATCH',
    };
  }

  const lo = Math.max(localRange.min, remoteRange.min);
  const hi = Math.min(localRange.max, remoteRange.max);
  if (hi < lo) {
    return {
      ok: false, agreed: null, local: localRange, remote: remoteRange,
      error: 'PROTOCOL_VERSION_MISMATCH',
    };
  }
  return { ok: true, agreed: hi, local: localRange, remote: remoteRange, error: null };
}

/* ══════════════════════════════════════════════════════════════════════════
 * Yetenek anlaşması
 * ════════════════════════════════════════════════════════════════════════ */

export interface FeatureNegotiationResult {
  /** İki tarafın da desteklediği yetenekler → KULLANILABİLİR. */
  readonly granted: readonly CapabilityToken[];
  /** Karşı taraf istedi, biz desteklemiyoruz. */
  readonly remoteOnly: readonly CapabilityToken[];
  /** Biz destekliyoruz, karşı taraf beyan etmedi. */
  readonly localOnly: readonly CapabilityToken[];
  /** Tanınmayan jetonlar — TAŞINIR, kabul EDİLMEZ (ileri uyumluluk). */
  readonly unknownRemote: readonly CapabilityToken[];
  /** Biçimsel olarak geçersiz jeton sayısı. */
  readonly rejectedCount: number;
}

/**
 * Yetenek kesişimi. Bilinmeyen jeton `granted`'a ASLA girmez: anlamını
 * bilmediğimiz bir yeteneği kabul etmek fail-open olur.
 *
 * Boş kesişim HATA DEĞİLDİR — bugün yerel destek listesi bilinçli olarak boş
 * olduğu için `granted` normalde boş çıkar.
 */
export function negotiateFeatures(
  remoteTokens: unknown,
  locallySupported: readonly CompanionCapability[],
): FeatureNegotiationResult {
  const local = new Set<string>(locallySupported ?? []);
  const seen = new Set<string>();
  const granted: CapabilityToken[] = [];
  const remoteOnly: CapabilityToken[] = [];
  const unknownRemote: CapabilityToken[] = [];
  let rejectedCount = 0;

  const list: unknown[] = Array.isArray(remoteTokens) ? remoteTokens : [];
  for (const raw of list) {
    if (!isValidCapabilityToken(raw)) { rejectedCount++; continue; }
    if (seen.has(raw)) continue;
    seen.add(raw);

    if (!isKnownCapability(raw)) { unknownRemote.push(raw); continue; }
    if (local.has(raw)) granted.push(raw);
    else remoteOnly.push(raw);
  }

  const localOnly: CapabilityToken[] = [];
  for (const cap of local) if (!seen.has(cap)) localOnly.push(cap);

  return {
    granted: Object.freeze(granted.sort()),
    remoteOnly: Object.freeze(remoteOnly.sort()),
    localOnly: Object.freeze(localOnly.sort()),
    unknownRemote: Object.freeze(unknownRemote.sort()),
    rejectedCount,
  };
}

/* ══════════════════════════════════════════════════════════════════════════
 * El sıkışma yükleri (wire sözleşmesi — YALNIZ TİP + KURUCU)
 * ════════════════════════════════════════════════════════════════════════ */

export const HELLO_PAYLOAD_TYPE = 'companion.hello';
export const HELLO_ACCEPT_PAYLOAD_TYPE = 'companion.hello.accept';

/**
 * El sıkışma yükü. PII TAŞIMAZ: cihaz adı/model/MAC/numara alanı YOKTUR —
 * yalnız protokol aralığı, yetenek jetonları, rol ve geri çevrilemez anahtar.
 */
export interface CompanionHelloPayload {
  readonly protocol: ProtocolRange;
  readonly capabilities: readonly CapabilityToken[];
  readonly role: string;
  /** Geri çevrilemez eşleştirme anahtarı (ham kimlik DEĞİL). */
  readonly peerKeyHash: string | null;
}

export function buildHelloPayload(
  capabilities: readonly CapabilityToken[],
  role: string,
  peerKeyHash: string | null,
  local: ProtocolRange = LOCAL_PROTOCOL_RANGE,
): CompanionHelloPayload {
  return {
    protocol: { min: local.min, max: local.max },
    capabilities: Object.freeze([...capabilities].filter(isValidCapabilityToken).sort()),
    role: typeof role === 'string' ? role.slice(0, 32) : 'UNKNOWN',
    peerKeyHash: typeof peerKeyHash === 'string' && peerKeyHash.length > 0
      ? peerKeyHash.slice(0, 16) : null,
  };
}

export interface ParsedHello {
  readonly ok: boolean;
  readonly protocol: ProtocolRange | null;
  readonly capabilities: readonly CapabilityToken[];
  readonly role: string;
  readonly peerKeyHash: string | null;
  readonly error: CompanionErrorCode | null;
}

/** Gelen el sıkışma yükünü çözer. ASLA throw etmez; bozuksa fail-closed. */
export function parseHelloPayload(v: unknown): ParsedHello {
  if (!v || typeof v !== 'object' || Array.isArray(v)) {
    return {
      ok: false, protocol: null, capabilities: [], role: 'UNKNOWN',
      peerKeyHash: null, error: 'ENVELOPE_MALFORMED',
    };
  }
  const o = v as Record<string, unknown>;
  const protocol = _range(o.protocol);
  const caps: CapabilityToken[] = [];
  if (Array.isArray(o.capabilities)) {
    for (const c of o.capabilities) {
      if (isValidCapabilityToken(c) && caps.length < 64) caps.push(c);
    }
  }
  return {
    ok: protocol !== null,
    protocol,
    capabilities: Object.freeze(caps.sort()),
    role: typeof o.role === 'string' ? o.role.slice(0, 32) : 'UNKNOWN',
    peerKeyHash: typeof o.peerKeyHash === 'string' && o.peerKeyHash.length > 0
      ? o.peerKeyHash.slice(0, 16) : null,
    error: protocol === null ? 'PROTOCOL_VERSION_MISMATCH' : null,
  };
}
