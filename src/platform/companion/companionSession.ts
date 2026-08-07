/**
 * companionSession.ts — `PhoneHubSession` modeli ve saf oturum işlemleri (P1-PREP).
 *
 * SAF: I/O yok · timer yok · `Date.now()` yok (zaman DAİMA parametre) · modül durumu YOK.
 *
 * ── GENERATION (NESİL) NEDEN VAR ────────────────────────────────────────────
 * Yeniden bağlanmalarda ESKİ taşımadan geciken bir mesaj gelebilir. Nesil sayacı
 * olmadan bu mesaj yeni oturuma AİT sanılır ve "hayalet veri" üretir (aynı hata
 * OBD tarafında gerçekten yaşandı: bayat protokol → sahte km). Her yeni bağlantı
 * denemesi nesli ARTIRIR; nesli eski olan her şey REDDEDİLİR.
 *
 * ── GİZLİLİK ────────────────────────────────────────────────────────────────
 * Oturumda cihaz ADI · MAC · telefon numarası · kişi · token TAŞIYAN ALAN YOKTUR.
 * Karşı taraf kimliği yalnız geri çevrilemez `peerKeyHash` ile taşınır.
 */

import {
  COMPANION_SCHEMA_VERSION,
  clampText, normalizePeerRole, normalizeTransportType,
  type CapabilityToken, type CompanionPeerRole, type CompanionTransportType,
} from './companionDomain';
import { normalizeState, type ConnectionState } from './connectionStateMachine';

/* ══════════════════════════════════════════════════════════════════════════
 * Zaman aşımı kuralları (tek yer)
 * ════════════════════════════════════════════════════════════════════════ */

/** El sıkışma (OPEN→CONNECTED) bu süreyi aşarsa HANDSHAKE_TIMEOUT. */
export const HANDSHAKE_TIMEOUT_MS = 10_000;
/** Karşı taraftan bu aralıkta kalp atışı BEKLENİR. */
export const HEARTBEAT_INTERVAL_MS = 5_000;
/** Bu süre atışsız geçerse önce DEGRADED (uyarı eşiği). */
export const HEARTBEAT_DEGRADE_MS = 12_000;
/** Bu süre atışsız geçerse bağlantı KAYIP sayılır. */
export const HEARTBEAT_LOSS_MS = 20_000;
/** Kalıcı oturum bu yaştan sonra yeniden kullanılmaz. */
export const SESSION_RESUME_WINDOW_MS = 10 * 60_000;

/* ══════════════════════════════════════════════════════════════════════════
 * Model
 * ════════════════════════════════════════════════════════════════════════ */

export interface PhoneHubSession {
  readonly schemaVersion: number;
  readonly sessionId: string;
  readonly createdAt: number;
  /** Gerçekten CONNECTED olunan an. Hiç bağlanılmadıysa null (0 DEĞİL). */
  readonly connectedAt: number | null;
  /** Son gözlem (heartbeat/mesaj). Hiç yoksa null. */
  readonly lastSeen: number | null;
  /** Anlaşılan protokol sürümü. Anlaşma OLMADIYSA null — varsayılan UYDURULMAZ. */
  readonly protocolVersion: number | null;
  /** Anlaşılan yetenekler (bilinen + bilinmeyen jetonlar birlikte, sıralı). */
  readonly capabilities: readonly CapabilityToken[];
  readonly transportType: CompanionTransportType;
  readonly deviceRole: CompanionPeerRole;
  readonly status: ConnectionState;
  /** Monotonik nesil — her yeni bağlantı denemesinde ARTAR. */
  readonly generation: number;
  /** Karşı tarafın geri çevrilemez kimliği. Bilinmiyorsa null. */
  readonly peerKeyHash: string | null;
}

/* ══════════════════════════════════════════════════════════════════════════
 * Kurucular (saf)
 * ════════════════════════════════════════════════════════════════════════ */

export interface CreateSessionInput {
  readonly sessionId: string;
  readonly nowMs: number;
  readonly transportType?: CompanionTransportType;
  readonly generation?: number;
  readonly peerKeyHash?: string | null;
}

/**
 * Yeni oturum. Template object literal — TÜM anahtarlar aynı sırada yazılır
 * (V8 hidden-class kararlılığı, CLAUDE.md §V8).
 *
 * Başlangıçta hiçbir şey VARSAYILMAZ: protokol null, yetenek boş, taşıma UNKNOWN,
 * rol UNKNOWN, durum IDLE.
 */
export function createPhoneHubSession(input: CreateSessionInput): PhoneHubSession {
  return {
    schemaVersion: COMPANION_SCHEMA_VERSION,
    sessionId: clampText(input.sessionId),
    createdAt: input.nowMs,
    connectedAt: null,
    lastSeen: null,
    protocolVersion: null,
    capabilities: [],
    transportType: normalizeTransportType(input.transportType),
    deviceRole: 'UNKNOWN',
    status: 'IDLE',
    generation: typeof input.generation === 'number' && Number.isFinite(input.generation)
      ? Math.max(1, Math.trunc(input.generation))
      : 1,
    peerKeyHash: typeof input.peerKeyHash === 'string' && input.peerKeyHash.length > 0
      ? clampText(input.peerKeyHash, 16)
      : null,
  };
}

/* ══════════════════════════════════════════════════════════════════════════
 * Saf dönüşümler — hepsi YENİ nesne döner (mutasyon YOK)
 * ════════════════════════════════════════════════════════════════════════ */

export function withStatus(
  s: PhoneHubSession, status: ConnectionState, nowMs: number,
): PhoneHubSession {
  const next = normalizeState(status);
  /* CONNECTED'a İLK geçişte `connectedAt` yazılır; sonraki CONNECTED'larda
     (DEGRADED→CONNECTED toparlanması) KORUNUR — ilk bağlantı anı bir kez ölçülür. */
  const connectedAt = next === 'CONNECTED' ? (s.connectedAt ?? nowMs) : s.connectedAt;
  return { ...s, status: next, connectedAt };
}

export function withHeartbeat(s: PhoneHubSession, nowMs: number): PhoneHubSession {
  /* Saat geriye giderse `lastSeen` GERİLETİLMEZ (monotonik gözlem). */
  const lastSeen = s.lastSeen === null ? nowMs : Math.max(s.lastSeen, nowMs);
  return { ...s, lastSeen };
}

export function withNegotiated(
  s: PhoneHubSession,
  protocolVersion: number,
  capabilities: readonly CapabilityToken[],
  deviceRole: CompanionPeerRole,
): PhoneHubSession {
  const pv = Number.isFinite(protocolVersion) && protocolVersion > 0
    ? Math.trunc(protocolVersion) : null;
  return {
    ...s,
    protocolVersion: pv,
    capabilities: Object.freeze([...capabilities].sort()),
    deviceRole: normalizePeerRole(deviceRole),
  };
}

export function withTransport(s: PhoneHubSession, t: CompanionTransportType): PhoneHubSession {
  return { ...s, transportType: normalizeTransportType(t) };
}

/** Yeniden bağlanma: nesli ARTIRIR ve anlaşma sonuçlarını SIFIRLAR. */
export function withNextGeneration(s: PhoneHubSession): PhoneHubSession {
  return {
    ...s,
    generation: s.generation + 1,
    /* Yeni nesilde eski anlaşma GEÇERSİZDİR — yetenek/protokol yeniden anlaşılır.
       Eski yetenekleri taşımak, karşı taraf onları kaybetmişse SAHTE yetenek olur. */
    protocolVersion: null,
    capabilities: [],
  };
}

/* ══════════════════════════════════════════════════════════════════════════
 * Zaman aşımı değerlendirmesi (saf)
 * ════════════════════════════════════════════════════════════════════════ */

export type HeartbeatVerdict = 'OK' | 'DEGRADED' | 'LOST' | 'UNKNOWN';

/**
 * Kalp atışı hükmü.
 *
 * DÜRÜSTLÜK: `lastSeen` yoksa hüküm UNKNOWN'dır — "kayıp" DENMEZ (hiç atış
 * beklenmemiş olabilir). Negatif yaş (saat sıçraması) da UNKNOWN'dır; sahte
 * "kayıp" üretip gereksiz yeniden bağlanma tetiklemek yasaktır.
 */
export function assessHeartbeat(s: PhoneHubSession, nowMs: number): HeartbeatVerdict {
  if (!s || s.lastSeen === null || !Number.isFinite(nowMs)) return 'UNKNOWN';
  const age = nowMs - s.lastSeen;
  if (age < 0) return 'UNKNOWN';
  if (age >= HEARTBEAT_LOSS_MS) return 'LOST';
  if (age >= HEARTBEAT_DEGRADE_MS) return 'DEGRADED';
  return 'OK';
}

/** El sıkışma zaman aşımı — yalnız el sıkışma sürerken anlamlıdır. */
export function isHandshakeTimedOut(s: PhoneHubSession, nowMs: number): boolean {
  if (!s) return false;
  const handshaking = s.status === 'CONNECTING' || s.status === 'NEGOTIATING';
  if (!handshaking || !Number.isFinite(nowMs)) return false;
  const started = s.lastSeen ?? s.createdAt;
  return nowMs - started > HANDSHAKE_TIMEOUT_MS;
}

/** Kalıcı oturum yeniden kullanılabilir mi (resume penceresi). */
export function isResumable(s: PhoneHubSession | null, nowMs: number): boolean {
  if (!s) return false;
  const ref = s.lastSeen ?? s.connectedAt ?? s.createdAt;
  if (!Number.isFinite(ref) || ref <= 0) return false;
  const age = nowMs - ref;
  return age >= 0 && age <= SESSION_RESUME_WINDOW_MS;
}

/** Bağlantı süresi (ms). Hiç bağlanılmadıysa null — 0 GÖSTERİLMEZ. */
export function connectDurationMs(s: PhoneHubSession): number | null {
  if (!s || s.connectedAt === null) return null;
  const d = s.connectedAt - s.createdAt;
  return d >= 0 ? d : null;
}

/* ══════════════════════════════════════════════════════════════════════════
 * Göç (fail-soft — ASLA throw etmez)
 * ════════════════════════════════════════════════════════════════════════ */

function _num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.trunc(v) : fallback;
}

function _nullableTs(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.trunc(v) : null;
}

/**
 * Kalıcı gövdeden oturumu geri yükler. Tanınamayan gövde → null (çağıran yeni
 * oturum açar). Bilinmeyen alanlar güvenli varsayılana düşer, protokol/yetenek
 * ASLA uydurulmaz.
 */
export function migratePhoneHubSession(v: unknown): PhoneHubSession | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  if (typeof o.sessionId !== 'string' || o.sessionId.length === 0) return null;

  const caps: CapabilityToken[] = [];
  if (Array.isArray(o.capabilities)) {
    for (const c of o.capabilities) {
      if (typeof c === 'string' && c.length > 0 && caps.length < 64) caps.push(clampText(c, 48));
    }
  }

  return {
    // Göç tamamlandı → şema sürümü DAİMA güncel yazılır.
    schemaVersion: COMPANION_SCHEMA_VERSION,
    sessionId: clampText(o.sessionId),
    createdAt: _num(o.createdAt, 0),
    connectedAt: _nullableTs(o.connectedAt),
    lastSeen: _nullableTs(o.lastSeen),
    protocolVersion: _nullableTs(o.protocolVersion),
    capabilities: Object.freeze(caps.sort()),
    transportType: normalizeTransportType(o.transportType),
    deviceRole: normalizePeerRole(o.deviceRole),
    status: normalizeState(o.status),
    generation: Math.max(1, _num(o.generation, 1)),
    peerKeyHash: typeof o.peerKeyHash === 'string' && o.peerKeyHash.length > 0
      ? clampText(o.peerKeyHash, 16) : null,
  };
}

/**
 * Kalıcı kayıttan dönen oturumun durumu "BAĞLI" olamaz.
 *
 * KRİTİK DÜRÜSTLÜK: uygulama yeniden başladığında hiçbir taşıma açık değildir.
 * Diskteki `CONNECTED` durumunu olduğu gibi geri yüklemek, sahada "bağlıyım
 * sanıyordum" hatasının ta kendisidir. Bu yüzden yüklenen oturum DISCONNECTED'a
 * indirilir ve nesli ARTIRILIR (eski taşımadan gelen her şey bayat sayılsın).
 */
export function demoteRestoredSession(s: PhoneHubSession): PhoneHubSession {
  const needsDemotion = s.status !== 'IDLE' && s.status !== 'DISCONNECTED' && s.status !== 'FAILED';
  if (!needsDemotion) return s;
  return {
    ...s,
    status: 'DISCONNECTED',
    generation: s.generation + 1,
    protocolVersion: null,
    capabilities: [],
  };
}
