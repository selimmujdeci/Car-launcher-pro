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

import { registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import { ingestPhoneHubNativeEvent, _resetPhoneHubIngressForTest } from './phoneHubNativeIngress';

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

/** F2 — native köprünün TS'e taşıdığı opak uygulama mesajı olayı. */
export interface PhoneHubApplicationMessageEvent {
  /** Native ESTABLISHED oturumun imza-doğrulanmış parmak izi — telefonun İDDİASI DEĞİL. */
  fingerprint: string;
  /** Native oturum nesli (LinkSession.generation). */
  sessionEpoch: number;
  /** Opak UTF-8 metin — bu katman içeriğini yorumlamaz (TS ingress'in işi). */
  payload: string;
}

/**
 * F4.1 — native lifecycle otoritesinin KANONİK geçiş olayı.
 *
 * Yeni bir yaşam döngüsü otoritesi DEĞİLDİR: `LinkSession` durum makinesinin
 * (tek sahip: `PhoneHubLinkController`) dışa yansımasıdır. Kripto materyali,
 * eşleşme kodu, ham anahtar, hata kodu, exception mesajı veya stack trace
 * TAŞIMAZ — `reason` sınırlı bir kategori kümesidir.
 */
export type PhoneHubLinkStateName =
  | 'DISCONNECTED' | 'CONNECTING' | 'AUTHENTICATING'
  | 'ESTABLISHED' | 'DEGRADED' | 'FAILED';

export type PhoneHubLinkStateReason =
  | 'USER_DISCONNECT' | 'REMOTE_DISCONNECT' | 'TRANSPORT_LOST' | 'AUTH_FAILED'
  | 'PROTOCOL_ERROR' | 'SESSION_REPLACED' | 'LIFECYCLE_STOP' | 'UNKNOWN';

/** Native'den gelen HAM yük — doğrulanmadan kullanılmaz. */
export interface PhoneHubLinkStateEventRaw {
  protocolVersion?: unknown;
  state?: unknown;
  sessionEpoch?: unknown;
  deviceFingerprint?: unknown;
  reason?: unknown;
}

/** Doğrulanmış, dondurulmuş kanonik olay. */
export interface PhoneHubLinkStateEvent {
  readonly protocolVersion: 1;
  readonly state: PhoneHubLinkStateName;
  readonly sessionEpoch: number | null;
  readonly deviceFingerprint: string | null;
  readonly reason: PhoneHubLinkStateReason;
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
  /**
   * F2 — ingress'in karar verdiği ACK/REJECTED yanıtını (veya ileride başka
   * bir uygulama mesajını) mevcut şifreli PhoneHub oturumundan gönderir. Bu
   * çağrı yetki KARARI VERMEZ, yalnız zaten üretilmiş baytı taşır.
   */
  sendApplicationMessage(options: { payload: string }): Promise<{ sent: boolean }>;
  /** F2 — native ESTABLISHED oturumdan gelen uygulama mesajları (event-driven, polling YOK). */
  addListener(
    eventName: 'applicationMessage',
    listener: (event: PhoneHubApplicationMessageEvent) => void,
  ): Promise<PluginListenerHandle>;
  /** F4.1 — kanonik yaşam döngüsü geçişi (event-driven, polling YOK). */
  addListener(
    eventName: 'linkState',
    listener: (event: PhoneHubLinkStateEventRaw) => void,
  ): Promise<PluginListenerHandle>;
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
      _ingest(_cache);
      return _cache;
    }
    const raw = await PhoneHubLink.getSnapshot();
    _cache = raw && typeof raw === 'object' && !raw.error
      ? { ...raw, present: true }
      : ABSENT;
    _cachedAt = Date.now();
    _ingest(_cache);
    return _cache;
  } catch {
    _cache = ABSENT;
    _cachedAt = Date.now();
    _ingest(_cache);
    return _cache;
  }
}

/**
 * ARCH-04/F5 — native olay companion GİRİŞ ADAPTÖRÜNDEN geçer.
 *
 * Bu çağrı bir GÖZLEM'dir: companion oturum gerçeğini YAZMAZ, yalnız nesil
 * kapısını uygular ve kanıt üretir. Giriş adaptörü patlasa bile native
 * önbelleğin davranışı DEĞİŞMEZ (fail-soft).
 */
function _ingest(snapshot: PhoneHubLinkSnapshotRaw): void {
  try { ingestPhoneHubNativeEvent(snapshot); } catch { /* kanıt yolu ürünü bozamaz */ }
}

/* ══════════════════════════════════════════════════════════════════════════
 * F4.1/F4.3/F4.4 — kanonik lifecycle olayı: yutma + abonelik
 * ════════════════════════════════════════════════════════════════════════ */

const LINK_STATE_NAMES: ReadonlySet<string> = new Set([
  'DISCONNECTED', 'CONNECTING', 'AUTHENTICATING', 'ESTABLISHED', 'DEGRADED', 'FAILED',
]);
const LINK_STATE_REASONS: ReadonlySet<string> = new Set([
  'USER_DISCONNECT', 'REMOTE_DISCONNECT', 'TRANSPORT_LOST', 'AUTH_FAILED',
  'PROTOCOL_ERROR', 'SESSION_REPLACED', 'LIFECYCLE_STOP', 'UNKNOWN',
]);

/**
 * Son KABUL EDİLEN kanonik olay. Bu bir önbellek değil, native gerçeğinin
 * en taze taşımasıdır — kalıcılığı YOKTUR ve process ölümünden sonra
 * ASLA restore edilmez (modül belleği sıfırdan başlar → `null`).
 */
let _linkStateEvent: PhoneHubLinkStateEvent | null = null;

/** Abonelere EN SON dağıtılan olay — yalnız tekrar (dedupe) kilidi içindir. */
let _lastDelivered: PhoneHubLinkStateEvent | null = null;

/**
 * Görülen EN YÜKSEK nesil — YALNIZ tek-değerli PROJEKSİYONU (`_linkStateEvent`)
 * korur, abone dağıtımını DEĞİL.
 *
 * ── RACE D NEDEN BURADA ÇÖZÜLMEZ ────────────────────────────────────────────
 * Geç gelen eski nesilli bir kopuş olayının yeni oturumu öldürememesi, olayı
 * DÜŞÜRMEKLE değil, iptal zincirinin `(deviceFingerprint, sessionEpoch)`
 * ÇİFTİNE hedeflenmiş olmasıyla sağlanır: eski çift zaten yoktur, silmek
 * no-op'tur ve yeni çifte DOKUNMAZ. Bu YAPISAL bir garantidir.
 *
 * Bu sayıyı abone dağıtımına uygulamak ise ZARARLI olurdu: çoklu oturumda
 * nesiller iç içe geçer (A=11 canlıyken B=22 kurulabilir) ve A'nın MEŞRU
 * kopuşu "bayat" sanılıp düşürülürdü — otorite ayakta kalırdı. Bu yüzden
 * eşik yalnız LAB'ın gördüğü tek-değerli projeksiyonun geri sarmamasını
 * sağlar.
 */
let _highestSeenEpoch = -1;

const _linkStateSubscribers = new Set<(event: PhoneHubLinkStateEvent) => void>();

/**
 * Tek kanonik abonelik sözleşmesi (F4.4).
 *
 * · aynı fonksiyon iki kez eklenirse TEK kayıt olur (Set semantiği)
 * · dönen fonksiyon deterministik olarak söker; sökülen abone bir daha
 *   ÇAĞRILMAZ
 * · bir abonenin fırlattığı hata diğerlerini ETKİLEMEZ
 * · React'e bağlı değildir, timer KURMAZ, yeni EventEmitter bağımlılığı
 *   EKLEMEZ (deponun `nativeAuthorityBridge` deseniyle aynı)
 */
export function subscribePhoneHubLinkState(
  listener: (event: PhoneHubLinkStateEvent) => void,
): () => void {
  _linkStateSubscribers.add(listener);
  return () => { _linkStateSubscribers.delete(listener); };
}

/** Son kabul edilen kanonik olay (yoksa `null` — "şimdi" UYDURULMAZ). */
export function getPhoneHubLinkState(): PhoneHubLinkStateEvent | null {
  return _linkStateEvent;
}

/** Katı doğrulama — bilinmeyen/eksik alan UYDURULMAZ, olay DÜŞÜRÜLÜR. */
function parseLinkStateEvent(raw: PhoneHubLinkStateEventRaw): PhoneHubLinkStateEvent | null {
  if (raw === null || typeof raw !== 'object') return null;
  if (raw.protocolVersion !== 1) return null;
  if (typeof raw.state !== 'string' || !LINK_STATE_NAMES.has(raw.state)) return null;
  const reason = typeof raw.reason === 'string' && LINK_STATE_REASONS.has(raw.reason)
    ? raw.reason as PhoneHubLinkStateReason
    : 'UNKNOWN';
  const epoch = typeof raw.sessionEpoch === 'number' && Number.isFinite(raw.sessionEpoch)
    && raw.sessionEpoch >= 0
    ? raw.sessionEpoch
    : null;
  const fingerprint = typeof raw.deviceFingerprint === 'string' && raw.deviceFingerprint.length > 0
    ? raw.deviceFingerprint
    : null;
  return Object.freeze({
    protocolVersion: 1 as const,
    state: raw.state as PhoneHubLinkStateName,
    sessionEpoch: epoch,
    deviceFingerprint: fingerprint,
    reason,
  });
}

/**
 * TEK yutma noktası. Native olay da, test seam'i de BURADAN geçer.
 *
 * Döner değer olayın KABUL edilip edilmediğini söyler — bayat nesil sessizce
 * "başarılı" GÖSTERİLMEZ.
 */
export function ingestPhoneHubLinkStateEvent(raw: PhoneHubLinkStateEventRaw): boolean {
  const event = parseLinkStateEvent(raw);
  if (event === null) return false;

  /* Nesilsiz olay (epoch `null`) yalnız hiç oturum görülmemişken kabul
     edilir — kimliği belirsiz bir olay canlı bir oturumu düşüremez. */
  if (event.sessionEpoch === null && _highestSeenEpoch >= 0) return false;

  /* Dedupe: aynı (durum, nesil, parmak izi) üçlüsü tekrar gelirse abonelere
     ikinci kez GİTMEZ — native zaten dedupe ediyor, bu ikinci savunma. */
  const last = _lastDelivered;
  if (last !== null
    && last.state === event.state
    && last.sessionEpoch === event.sessionEpoch
    && last.deviceFingerprint === event.deviceFingerprint) {
    return false;
  }
  _lastDelivered = event;

  /* Tek-değerli projeksiyon GERİ SARMAZ (bkz. `_highestSeenEpoch` notu);
     abone dağıtımı ise HER kabul edilen olayda yapılır. */
  if (event.sessionEpoch !== null && event.sessionEpoch >= _highestSeenEpoch) {
    _highestSeenEpoch = event.sessionEpoch;
    _linkStateEvent = event;
  } else if (event.sessionEpoch === null) {
    _linkStateEvent = event;
  }

  _linkStateSubscribers.forEach((fn) => {
    try { fn(event); } catch { /* abone hatası köprüyü ve diğer aboneleri BOZMAZ */ }
  });
  return true;
}

let _unsubscribeLinkStateBridge: (() => void) | null = null;

/**
 * Native `linkState` olayına abone olur. İkinci çağrı önce var olan
 * aboneliği söker (çift dinleyici YOK). Dönen fonksiyon sahipliği çağırana
 * verir — bu modül kendi kendine sonsuza dek dinlemez.
 */
export function initPhoneHubLinkStateBridge(): () => void {
  _unsubscribeLinkStateBridge?.();
  _unsubscribeLinkStateBridge = null;

  let disposed = false;
  void PhoneHubLink.addListener('linkState', (raw) => {
    if (disposed) return;
    ingestPhoneHubLinkStateEvent(raw);
  }).then((handle) => {
    if (disposed) { void handle.remove(); return; }
    _unsubscribeLinkStateBridge = () => { void handle.remove(); };
  }).catch(() => {
    /* Native plugin yoksa (tarayıcı modu) sessizce hiçbir şey dinlenmez —
       FAIL-SOFT, sahte bir abonelik İDDİA EDİLMEZ. */
  });

  return () => {
    disposed = true;
    _unsubscribeLinkStateBridge?.();
    _unsubscribeLinkStateBridge = null;
  };
}

/** @internal — yalnız testler. */
export function _resetPhoneHubLinkStateForTest(): void {
  _linkStateEvent = null;
  _lastDelivered = null;
  _highestSeenEpoch = -1;
  _linkStateSubscribers.clear();
  _unsubscribeLinkStateBridge?.();
  _unsubscribeLinkStateBridge = null;
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
  _resetPhoneHubIngressForTest();
}
