/**
 * phoneHubLink.ts — PHONE-HUB P1-A native bağlantı köprüsü (SALT-OKUNUR ÖNBELLEK).
 *
 * Desen `phoneHubHardwareProbe.ts` ile BİREBİR aynıdır — yeni desen icat EDİLMEZ:
 *   · `refreshPhoneHubLink()` → ASYNC native pull, modül önbelleğini doldurur.
 *   · `getPhoneHubLink()`     → SENKRON, YAN ETKİSİZ; yalnız önbelleği okur.
 *
 * ── BU MODÜL NE YAPMAZ ──────────────────────────────────────────────────────
 * Kendiliğinden sunucu BAŞLATMAZ · timer/abonelik KURMAZ · Bluetooth açmaz ·
 * tarama/eşleştirme yapmaz · OBD'ye dokunmaz. Sunucuyu başlatmak/durdurmak
 * YALNIZ kullanıcının açık eylemiyle olur ve o eylemler ayrı fonksiyonlardır.
 *
 * ── FAIL-SOFT ───────────────────────────────────────────────────────────────
 * Native plugin yoksa (eski APK, tarayıcı modu) veya çağrı patlarsa önbellek
 * `present:false` kalır → tüketici "KAYNAK YOK" görür. SAHTE varsayılan
 * ("bağlı", "sağlıklı", 0 sayaç) ASLA üretilmez.
 *
 * ── GİZLİLİK ────────────────────────────────────────────────────────────────
 * Native sözleşmesi zaten MAC · cihaz adı · doğrulama kodu · anahtar · ham yük
 * TAŞIMAZ. Doğrulama kodu YALNIZ `getPairingCode()` ile ve YALNIZ kullanıcı
 * ekranı için okunur; anlık görüntüye ve LAB'a GİRMEZ.
 */

import { registerPlugin } from '@capacitor/core';

/* ══════════════════════════════════════════════════════════════════════════
 * Native sözleşme
 * ════════════════════════════════════════════════════════════════════════ */

export interface PhoneHubLinkServerRaw {
  state?: string;
  running?: boolean;
  disposed?: boolean;
  listenStartedAtMs?: number;
  acceptedCount?: number;
  rejectedSecondClient?: number;
  hasActiveSocket?: boolean;
  lastErrorCode?: string | null;
}

export interface PhoneHubLinkPreconditionsRaw {
  ready?: boolean;
  blockerCode?: string | null;
  connectPermission?: boolean;
}

export interface PhoneHubLinkIdentityRaw {
  hasIdentity?: boolean;
  hardwareBacked?: boolean;
}

export interface PhoneHubLinkTrustRaw {
  hasTrustedPeer?: boolean;
  peerFingerprint?: string | null;
  lastConnectedAtMs?: number;
  protocolVersion?: number;
  connectCount?: number;
}

export interface PhoneHubLinkSessionRaw {
  generation?: number;
  state?: string;
  serverSide?: boolean;
  handshakeStage?: string;
  awaitingUserConfirm?: boolean;
  trustSkipped?: boolean;
  disposed?: boolean;
  startedAtMs?: number;
  establishedAtMs?: number;
  negotiationDurationMs?: number;
  lastInboundAgeMs?: number;
  protocolVersion?: number;
  peerFingerprint?: string | null;
  peerAppVersion?: string | null;
  grantedCapabilities?: string[];
  heartbeatsSent?: number;
  heartbeatsReceived?: number;
  framesSent?: number;
  framesReceived?: number;
  bytesSent?: number;
  bytesReceived?: number;
  appMessagesReceived?: number;
  writeQueueDepth?: number;
  writeQueueCapacity?: number;
  writeQueueRejections?: number;
  checksumFailures?: number;
  malformedFrames?: number;
  oversizeRejections?: number;
  resyncEvents?: number;
  unknownTypeDropped?: number;
  decryptFailures?: number;
  replayRejections?: number;
  encryptionActive?: boolean;
  readerAlive?: boolean;
  writerAlive?: boolean;
  lastErrorCode?: string | null;
  disconnectReasonCode?: string | null;
  trulyEstablished?: boolean;
}

export interface PhoneHubLinkDiagnosticEventRaw {
  t?: number;
  side?: string;
  category?: string;
  stage?: string;
  code?: string | null;
  severity?: string;
  generation?: number;
  details?: string;
}

export interface PhoneHubLinkDiagnosticsRaw {
  size?: number;
  capacity?: number;
  dropped?: number;
  redacted?: number;
  events?: PhoneHubLinkDiagnosticEventRaw[];
}

export interface PhoneHubLinkSnapshotRaw {
  /** JS tarafı bayrağı: native gerçekten okundu mu. */
  present: boolean;
  schemaVersion?: number;
  uuid?: string;
  uuidDistinctFromObdSpp?: boolean;
  server?: PhoneHubLinkServerRaw;
  preconditions?: PhoneHubLinkPreconditionsRaw;
  identity?: PhoneHubLinkIdentityRaw;
  trust?: PhoneHubLinkTrustRaw;
  session?: PhoneHubLinkSessionRaw | null;
  pairing?: { awaitingConfirmation?: boolean; expiresAtMs?: number };
  connectStartedAtMs?: number;
  lastSessionState?: string;
  lastErrorCode?: string | null;
  lastErrorAtMs?: number;
  diagnostics?: PhoneHubLinkDiagnosticsRaw;
  error?: string;
}

export interface PhoneHubLinkPlugin {
  startServer(): Promise<{ started: boolean; errorCode?: string; userMessage?: string }>;
  stopServer(): Promise<{ stopped: boolean }>;
  disconnectSession(): Promise<{ disconnected: boolean }>;
  getPairingCode(): Promise<{ awaiting: boolean; code?: string }>;
  confirmPairing(options: { accepted: boolean }): Promise<{ applied: boolean; accepted: boolean }>;
  forgetTrustedPhone(): Promise<{ forgotten: boolean }>;
  getSnapshot(): Promise<PhoneHubLinkSnapshotRaw>;
  resetCounters(): Promise<{ reset: boolean }>;
}

export const PhoneHubLink = registerPlugin<PhoneHubLinkPlugin>('PhoneHubLink');

/* ══════════════════════════════════════════════════════════════════════════
 * Önbellek
 * ════════════════════════════════════════════════════════════════════════ */

const ABSENT: PhoneHubLinkSnapshotRaw = { present: false };

let _cache: PhoneHubLinkSnapshotRaw = ABSENT;
let _cachedAt = 0;

/** Senkron, yan etkisiz okuma. Native'e GİTMEZ. */
export function getPhoneHubLink(): PhoneHubLinkSnapshotRaw {
  return _cache;
}

/** Önbelleğin JS damgası (ms). 0 = hiç tazelenmedi — "şimdi" UYDURULMAZ. */
export function getPhoneHubLinkCachedAt(): number {
  return _cachedAt;
}

/**
 * Native anlık görüntüyü çeker. Hata durumunda önbellek `present:false`
 * yapılır — eski kanıt YANLIŞLIKLA taze görünmesin.
 */
export async function refreshPhoneHubLink(): Promise<PhoneHubLinkSnapshotRaw> {
  try {
    const fn = PhoneHubLink?.getSnapshot;
    if (typeof fn !== 'function') {
      _cache = ABSENT;
      _cachedAt = Date.now();
      return _cache;
    }
    const raw = await PhoneHubLink.getSnapshot();
    _cache = raw && typeof raw === 'object' && !raw.error
      ? { ...raw, present: true }
      : ABSENT;
    _cachedAt = Date.now();
    return _cache;
  } catch {
    _cache = ABSENT;
    _cachedAt = Date.now();
    return _cache;
  }
}

/* ══════════════════════════════════════════════════════════════════════════
 * Kullanıcı eylemleri — HEPSİ AÇIK İSTEK ÜZERİNE
 * ════════════════════════════════════════════════════════════════════════ */

export interface PhoneHubLinkActionResult {
  readonly ok: boolean;
  readonly errorCode: string | null;
  readonly userMessage: string | null;
}

const ACTION_UNAVAILABLE: PhoneHubLinkActionResult = Object.freeze({
  ok: false,
  errorCode: 'TRANSPORT_NOT_IMPLEMENTED',
  userMessage: 'Bu derlemede Phone Hub bağlantısı yok',
});

async function _invoke(
  fn: (() => Promise<unknown>) | undefined,
  isOk: (value: unknown) => boolean,
): Promise<PhoneHubLinkActionResult> {
  if (typeof fn !== 'function') return ACTION_UNAVAILABLE;
  try {
    const result = await fn();
    const record = (result ?? {}) as Record<string, unknown>;
    return Object.freeze({
      ok: isOk(result),
      errorCode: typeof record.errorCode === 'string' ? record.errorCode : null,
      userMessage: typeof record.userMessage === 'string' ? record.userMessage : null,
    });
  } catch {
    return Object.freeze({
      ok: false,
      errorCode: 'UNKNOWN_ERROR',
      userMessage: null,
    });
  }
}

/** Sunucuyu başlatır. İzin gerekirse native tarafta kullanıcıya sorulur. */
export function startPhoneHubServer(): Promise<PhoneHubLinkActionResult> {
  return _invoke(
    PhoneHubLink?.startServer?.bind(PhoneHubLink),
    (v) => (v as { started?: boolean } | null)?.started === true,
  );
}

/** Sunucuyu durdurur — worker · soket · oturum · anahtar hepsi bırakılır. */
export function stopPhoneHubServer(): Promise<PhoneHubLinkActionResult> {
  return _invoke(
    PhoneHubLink?.stopServer?.bind(PhoneHubLink),
    (v) => (v as { stopped?: boolean } | null)?.stopped === true,
  );
}

/** Yalnız aktif oturumu keser; sunucu dinlemeye devam eder. */
export function disconnectPhoneHubSession(): Promise<PhoneHubLinkActionResult> {
  return _invoke(
    PhoneHubLink?.disconnectSession?.bind(PhoneHubLink),
    (v) => (v as { disconnected?: boolean } | null)?.disconnected === true,
  );
}

export function forgetTrustedPhone(): Promise<PhoneHubLinkActionResult> {
  return _invoke(
    PhoneHubLink?.forgetTrustedPhone?.bind(PhoneHubLink),
    (v) => (v as { forgotten?: boolean } | null)?.forgotten === true,
  );
}

/** Sayaçları sıfırlar — AKTİF BAĞLANTIYI KESMEZ. */
export function resetPhoneHubCounters(): Promise<PhoneHubLinkActionResult> {
  return _invoke(
    PhoneHubLink?.resetCounters?.bind(PhoneHubLink),
    (v) => (v as { reset?: boolean } | null)?.reset === true,
  );
}

export function confirmPhoneHubPairing(accepted: boolean): Promise<PhoneHubLinkActionResult> {
  const fn = PhoneHubLink?.confirmPairing;
  if (typeof fn !== 'function') return Promise.resolve(ACTION_UNAVAILABLE);
  return _invoke(
    () => PhoneHubLink.confirmPairing({ accepted }),
    (v) => (v as { applied?: boolean } | null)?.applied === true,
  );
}

/**
 * Onay bekleyen doğrulama kodu.
 *
 * ÖNBELLEĞE ALINMAZ ve anlık görüntüye KONMAZ: kod kısa ömürlüdür ve yalnız
 * kullanıcı ekranında, o an gösterilmek üzere okunur. Önbelleğe alınsaydı
 * süresi dolmuş bir kod ekranda kalabilir veya bir döküme sızabilirdi.
 */
export async function getPhoneHubPairingCode(): Promise<string | null> {
  try {
    const fn = PhoneHubLink?.getPairingCode;
    if (typeof fn !== 'function') return null;
    const result = await PhoneHubLink.getPairingCode();
    if (!result || result.awaiting !== true) return null;
    return typeof result.code === 'string' && result.code.length > 0 ? result.code : null;
  } catch {
    return null;
  }
}

/** @internal — testler arası izolasyon. */
export function _resetPhoneHubLinkForTest(): void {
  _cache = ABSENT;
  _cachedAt = 0;
}
