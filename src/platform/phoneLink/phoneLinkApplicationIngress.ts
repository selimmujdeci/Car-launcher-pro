/**
 * phoneLinkApplicationIngress.ts — PHONE LINK F2 · TEK ingress noktası (F2.3 + F2.4).
 *
 * ── ZİNCİR ────────────────────────────────────────────────────────────────
 *   native `applicationMessage` olayı (event-driven, polling YOK)
 *     → 1) native-taşınan fingerprint/epoch CANLI attachment'a karşı doğrulanır
 *     → 2) zarf ayrıştırılır/doğrulanır (`phoneLinkApplicationEnvelope`)
 *     → 3) dedupe (bounded, session-scoped, timer YOK)
 *     → 4) `dispatchGuestMusicCommand` (F1) — capability/authorization + adapter
 *     → 5) ACK/REJECTED yanıtı aynı şifreli oturumdan geri gönderilir
 *
 * ── NEDEN AYRI BİR DOĞRULAMA KATMANI (adım 1), F1'İN KENDİ KONTROLÜ YETMEZ Mİ ──
 * `authorizeGuestMediaCommand()` HER ÇAĞRIDA güncel `getPhoneAttachmentSnapshot()`a
 * bakar ama bu MESAJIN GERÇEKTEN O oturumdan geldiğini DOĞRULAMAZ — yalnız "şu an
 * bir ACTIVE oturum var mı" sorar. Native'in bu olayla birlikte taşıdığı
 * `fingerprint`/`sessionEpoch` MESAJIN KENDİSİNİN hangi oturuma ait olduğunu
 * söyler. İkisi UYUŞMUYORSA (telefon koptu/yeniden bağlandı, mesaj eski
 * oturumdan geç geldi) bu adım mesajı adaptöre ULAŞTIRMADAN reddeder — TOCTOU
 * senaryosunun (F2.2) tam olarak tarif ettiği kilit budur.
 *
 * ── UI'DAN DOĞRUDAN ÇAĞRILAMAZ ───────────────────────────────────────────────
 * Bu modülün TEK canlı girişi native `applicationMessage` olayıdır
 * (`initPhoneLinkApplicationBridge`). Test seam'i (`handleApplicationMessageForTest`)
 * yalnız testler içindir; üretim kodunda hiçbir UI/ekran bunu çağırmaz.
 */

import { PhoneHubLink, type PhoneHubApplicationMessageEvent } from '../phoneHub/phoneHubLink';
import { getPhoneAttachmentSnapshot } from './phoneLinkAttachment';
import { dispatchGuestMusicCommand, type PhoneLinkCommandResult } from './phoneLinkMusicRemoteAdapter';
import {
  dispatchNavDestinationPush, approveNavProposal, rejectNavProposal, expireNavProposal,
  type PhoneLinkNavPushResult, type PhoneLinkNavResolveResult,
} from './phoneLinkNavigationAdapter';
import {
  authorizeAssistantBridgeRequest, processAssistantBridgeRequest,
  isAssistantBridgeResultDeliverable, recordAssistantBridgeDuplicate,
  type PhoneLinkAssistantAcceptResult, type PhoneLinkAssistantTerminalResult,
} from './phoneLinkAssistantBridgeAdapter';
import {
  parseApplicationRequest, buildApplicationResponse, serializeApplicationResponse,
  type PhoneLinkAckStatus,
} from './phoneLinkApplicationEnvelope';

/* ══════════════════════════════════════════════════════════════════════════
 * Bounded, event-driven gözlemlenebilirlik (§K) — payload/token TAŞIMAZ
 * ════════════════════════════════════════════════════════════════════════ */

const MAX_RECENT_REJECTIONS = 8;

interface IngressCounters {
  rxCount: number;
  acceptedCount: number;
  rejectedCount: number;
  lastCommand: string | null;
  lastRejectionReason: string | null;
  lastMessageAtMs: number | null;
  recentRejections: string[];
}

const _counters: IngressCounters = {
  rxCount: 0, acceptedCount: 0, rejectedCount: 0,
  lastCommand: null, lastRejectionReason: null, lastMessageAtMs: null,
  recentRejections: [],
};

function recordRx(nowMs: number): void {
  _counters.rxCount += 1;
  _counters.lastMessageAtMs = nowMs;
}

function recordAccepted(command: string): void {
  _counters.acceptedCount += 1;
  _counters.lastCommand = command;
}

function recordRejected(reason: string): void {
  _counters.rejectedCount += 1;
  _counters.lastRejectionReason = reason;
  _counters.recentRejections.push(reason);
  if (_counters.recentRejections.length > MAX_RECENT_REJECTIONS) {
    _counters.recentRejections.shift();
  }
}

/** LAB'ın okuduğu salt-okunur anlık görüntü — payload/token/fingerprint TAŞIMAZ. */
export function getPhoneLinkIngressTelemetry(): Readonly<IngressCounters> {
  return Object.freeze({ ..._counters, recentRejections: [..._counters.recentRejections] });
}

/** @internal — yalnız testler. */
export function _resetPhoneLinkIngressTelemetryForTest(): void {
  _counters.rxCount = 0; _counters.acceptedCount = 0; _counters.rejectedCount = 0;
  _counters.lastCommand = null; _counters.lastRejectionReason = null;
  _counters.lastMessageAtMs = null; _counters.recentRejections = [];
}

/* ══════════════════════════════════════════════════════════════════════════
 * Dedupe (F2.7) — bounded, session-scoped, timer YOK
 * ════════════════════════════════════════════════════════════════════════ */

const MAX_SEEN_MESSAGE_IDS = 64;
/** `epoch:messageId` → görüldü. Sınırsız BÜYÜMEZ; en eski girdi düşürülür. */
const _seenMessageIds = new Set<string>();

function isDuplicate(sessionEpoch: number, messageId: string): boolean {
  const key = `${sessionEpoch}:${messageId}`;
  if (_seenMessageIds.has(key)) return true;
  _seenMessageIds.add(key);
  if (_seenMessageIds.size > MAX_SEEN_MESSAGE_IDS) {
    const oldest = _seenMessageIds.values().next();
    if (!oldest.done) _seenMessageIds.delete(oldest.value);
  }
  return false;
}

/** @internal — yalnız testler. */
export function _resetPhoneLinkDedupeForTest(): void {
  _seenMessageIds.clear();
}

/* ══════════════════════════════════════════════════════════════════════════
 * Karar → ACK eşlemesi
 * ════════════════════════════════════════════════════════════════════════ */

function resultToAck(result: PhoneLinkCommandResult): { status: PhoneLinkAckStatus; payload?: unknown } {
  if (!result.ok) {
    switch (result.denialCode) {
      case 'STALE': return { status: 'REJECTED_STALE_SESSION' };
      case 'NOT_ATTACHED':
      case 'NO_GRANT':
      default: return { status: 'REJECTED_UNAUTHORIZED' };
    }
  }
  if (result.command === 'GET_NOW_PLAYING') {
    return { status: 'ACCEPTED', payload: result.nowPlaying };
  }
  if (result.command === 'GET_QUEUE') {
    return { status: 'ACCEPTED', payload: { queue: result.queue, currentIndex: result.currentIndex } };
  }
  /* PLAY/PAUSE/NEXT/PREVIOUS: kabul edildi VE yetkilendirildi ama YÜRÜTME
   * kanonik kapıda (`mediaCommandGateway`) başarısız olabilir — bu durumda
   * telefona "ACCEPTED" değil dürüstçe "FAILED" söylenir. İç hata kodu/stack
   * trace TAŞINMAZ, yalnız üç değerli sonuç. `CommandTruth.outcome` gerçek
   * başarı alanıdır (`ok` diye bir alan YOKTUR) — `VERIFIED` ve
   * `ACCEPTED_UNVERIFIED` ikisi de "backend gerçekten yürüttü" demektir;
   * ikisi arasındaki doğrulama farkı bu ACK katmanının kapsamı DIŞINDADIR. */
  const succeeded = result.truth.outcome === 'VERIFIED'
    || result.truth.outcome === 'ACCEPTED_UNVERIFIED';
  return { status: succeeded ? 'ACCEPTED' : 'FAILED' };
}

/**
 * F8.1 — `NAV_DESTINATION_PUSH` PUSH sonucunu ACK'e çevirir.
 *
 * `PENDING_USER_APPROVAL` burada YALNIZ "istek yetkilendirildi, araçta bir
 * öneri oluştu" demektir — navigasyon HENÜZ DEĞİŞMEDİ (§2/§3). Gerçek sonuç
 * (`ACCEPTED`/`REJECTED_BY_USER`/`EXPIRED`/...) kullanıcı karar verdiğinde
 * `sendNavProposalResultMessage` ile AYRI bir mesajla telefona ulaşır.
 */
function navPushResultToAck(result: PhoneLinkNavPushResult): { status: PhoneLinkAckStatus } {
  if (result.ok) return { status: 'PENDING_USER_APPROVAL' };
  switch (result.denialCode) {
    case 'STALE': return { status: 'REJECTED_STALE_SESSION' };
    case 'INVALID_DESTINATION': return { status: 'INVALID_DESTINATION' };
    case 'DUPLICATE': return { status: 'DUPLICATE' };
    case 'NAVIGATION_UNAVAILABLE': return { status: 'NAVIGATION_UNAVAILABLE' };
    case 'EXPIRED': return { status: 'EXPIRED' };
    case 'NOT_ATTACHED':
    case 'NO_GRANT':
    default: return { status: 'REJECTED_UNAUTHORIZED' };
  }
}

/** F9 — Assistant Bridge kabul kapısının ACK'i (`RECEIVED` ya da bounded reddi). */
function assistantAcceptToAck(result: PhoneLinkAssistantAcceptResult): PhoneLinkAckStatus {
  if (result.ok) return 'RECEIVED';
  switch (result.denialCode) {
    case 'STALE': return 'REJECTED_STALE_SESSION';
    case 'NOT_ATTACHED':
    case 'NO_GRANT':
    default: return 'REJECTED_UNAUTHORIZED';
  }
}

/** F9 — Assistant Bridge TERMİNAL sonucunun ACK'i (`sendAssistantBridgeResultMessage` kullanır). */
function assistantTerminalToAck(
  result: PhoneLinkAssistantTerminalResult,
): { status: PhoneLinkAckStatus; result?: unknown } {
  if (result.ok) return { status: 'ACCEPTED', result: { text: result.response } };
  switch (result.denialCode) {
    case 'ACTION_NOT_PERMITTED': return { status: 'ACTION_NOT_PERMITTED' };
    case 'NO_ANSWER': return { status: 'NO_ANSWER' };
    case 'TIMED_OUT': return { status: 'TIMED_OUT' };
    case 'STALE': return { status: 'REJECTED_STALE_SESSION' };
    case 'NOT_ATTACHED':
    case 'NO_GRANT': return { status: 'REJECTED_UNAUTHORIZED' };
    default: return { status: 'FAILED' };
  }
}

/** F8.1 — onay/red/expire SONUCUNU ACK'e çevirir (`sendNavProposalResultMessage` kullanır). */
function navResolveResultToAck(
  decision: 'APPROVE' | 'REJECT' | 'EXPIRE', result: PhoneLinkNavResolveResult,
): PhoneLinkAckStatus {
  if (result.ok) return 'ACCEPTED';
  if (decision === 'REJECT') return 'REJECTED_BY_USER';
  if (decision === 'EXPIRE') return 'EXPIRED';
  switch (result.denialCode) {
    case 'STALE': return 'REJECTED_STALE_SESSION';
    case 'INVALID_DESTINATION': return 'INVALID_DESTINATION';
    case 'DUPLICATE': return 'DUPLICATE';
    case 'NAVIGATION_UNAVAILABLE': return 'NAVIGATION_UNAVAILABLE';
    case 'EXPIRED': return 'EXPIRED';
    case 'NOT_ATTACHED':
    case 'NO_GRANT':
    default: return 'REJECTED_UNAUTHORIZED';
  }
}

/* ══════════════════════════════════════════════════════════════════════════
 * Tek ingress fonksiyonu (F2.4) — test seam + gerçek native olay bunu çağırır
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * Native'den gelen TEK bir uygulama mesajı olayını işler ve gönderilecek yanıt
 * metnini üretir (gönderimin KENDİSİ çağırana aittir — bkz.
 * {@link initPhoneLinkApplicationBridge}). Hiçbir adım throw ETMEZ.
 */
export async function handleApplicationMessageForTest(
  event: PhoneHubApplicationMessageEvent, nowMs: number = Date.now(),
): Promise<string | null> {
  recordRx(nowMs);

  /* 1) Native-taşınan kimlik CANLI attachment'a karşı doğrulanır. Bu mesajın
   * GERÇEKTEN şu anki oturumdan geldiğini kanıtlar — bkz. dosya üstü not. */
  const snap = getPhoneAttachmentSnapshot();
  const liveMatch = snap.state === 'ACTIVE'
    && snap.sessionEpoch === event.sessionEpoch
    && snap.deviceFingerprint === event.fingerprint;
  if (!liveMatch) {
    recordRejected('STALE_OR_NOT_ACTIVE');
    /* Hangi id'ye yanıt verileceği bile BİLİNMİYOR (zarf henüz ayrıştırılmadı,
     * kimlik zaten uyuşmuyor) — bu durumda yanıt GÖNDERİLMEZ (telefon zaten
     * kendi kopan/değişen oturumunu fark eder). */
    return null;
  }

  /* 2) Zarf ayrıştırılır/doğrulanır. */
  const parsed = parseApplicationRequest(event.payload);
  if (!parsed.ok) {
    recordRejected(parsed.status);
    /* `id` fırsatçı olarak okunabildiyse (yalnız KENDİ biçimi geçerliyse)
     * telefona ANLAMLI bir ACK (REJECTED_*) dönülür — F2.6: "telefon komutun
     * sonucunu bilmeli". id'nin kendisi bozuksa/yoksa yanıt GÖNDERİLEMEZ
     * (kime yanıt olduğu bilinmez) — sessizce düşer, dürüst bir sınırdır. */
    if (parsed.id === null) return null;
    return serializeApplicationResponse(buildApplicationResponse(parsed.id, parsed.status));
  }
  const { request } = parsed;

  /* 3) Dedupe — yasal-ama-yinelenen teslimat (F2.7). Bu, F9'un "aynı requestId
   * ikinci Mavi turu oluşturmaz" şartını da KARŞILAR — ikinci bir dedupe
   * sistemi kurulmadı, AYNI bounded Set kullanılır. */
  if (isDuplicate(event.sessionEpoch, request.id)) {
    recordRejected('DUPLICATE_MESSAGE_ID');
    if (request.type === 'ASSISTANT_BRIDGE_REQUEST') recordAssistantBridgeDuplicate();
    /* Yineleneni SESSİZCE yut — ilk teslimat zaten ACK'lendi/yürütüldü;
     * ikinci bir ACK göndermek "iki kez kabul edildi" izlenimi verirdi. */
    return null;
  }

  /* 4) Kanonik yetkilendirme + adaptör — istek TİPİNE göre dallanır. */
  if (request.type === 'MUSIC_COMMAND') {
    const result = await dispatchGuestMusicCommand(request.command, `phone-link-app:${request.id}`);
    const { status, payload } = resultToAck(result);
    if (status === 'ACCEPTED') recordAccepted(request.command);
    else recordRejected(status);
    return serializeApplicationResponse(buildApplicationResponse(request.id, status, payload));
  }

  if (request.type === 'NAV_DESTINATION_PUSH') {
    /* koordinat/adres/etiket telemetriye/loga TAŞINMAZ, yalnız TİP adı
       `lastCommand`a yazılır. Bu yanıt yalnız "öneri oluştu" der — GERÇEK
       sonuç kullanıcı karar verdiğinde AYRI bir mesajla gelir. */
    const navResult = await dispatchNavDestinationPush(
      { latitude: request.latitude, longitude: request.longitude, label: request.label, address: request.address },
      request.id, // requestId === proposalId — ikinci kimlik ÜRETİLMEZ
    );
    const { status } = navPushResultToAck(navResult);
    if (status === 'PENDING_USER_APPROVAL') recordAccepted('NAV_DESTINATION_PUSH');
    else recordRejected(status);
    return serializeApplicationResponse(buildApplicationResponse(request.id, status));
  }

  /* ASSISTANT_BRIDGE_REQUEST (F9) — metin İÇERİĞİ telemetriye/loga TAŞINMAZ,
   * yalnız TİP adı yazılır. Bu yanıt yalnız "istek yetkilendirildi, Mavi
   * işliyor" der (`RECEIVED`) — GERÇEK cevap (Mavi'nin `kind:'chat'` sonucu)
   * arka planda üretilip AYRI bir mesajla gelir (§10: RECEIVED ≠ SUCCESS). */
  const session = { deviceFingerprint: event.fingerprint, sessionEpoch: event.sessionEpoch };
  const accept = authorizeAssistantBridgeRequest(request.id, session);
  const acceptStatus = assistantAcceptToAck(accept);
  if (acceptStatus === 'RECEIVED') {
    recordAccepted('ASSISTANT_BRIDGE_REQUEST');
    /* Fire-and-forget: bu senkron ACK'i BLOKLAMAZ. Sonuç hazır olduğunda
     * (saniyeler sonra bile) AYRI bir application-message ile gönderilir.
     * `session` burada MESAJIN KENDİSİNİN kanıtladığı kimliktir — gönderim
     * anında YENİDEN doğrulanır (§13, bkz. `sendAssistantBridgeResultMessage`). */
    void processAssistantBridgeRequest(request.text).then((outcome) => {
      void sendAssistantBridgeResultMessage(request.id, outcome, session);
    });
  } else {
    recordRejected(acceptStatus);
  }
  return serializeApplicationResponse(buildApplicationResponse(request.id, acceptStatus));
}

/* ══════════════════════════════════════════════════════════════════════════
 * F8.1 — Araç içi kullanıcı kararı → telefona SONUÇ mesajı
 *
 * BU FONKSİYONLAR TELEFONDAN ÇAĞRILMAZ — yalnız CarOS'un KENDİ onay UI'ı
 * (`PhoneLinkNavProposalOverlay.tsx`) çağırır. Native `applicationMessage`
 * olayına giden yön TEK: burada gönderilen, ZATEN VAR OLAN uygulama-mesajı
 * protokolüdür (`buildApplicationResponse`/`serializeApplicationResponse`
 * yeniden kullanılır) — ikinci bir protokol KURULMADI.
 * ════════════════════════════════════════════════════════════════════════ */

/** Taşıma hatası oturumu düşürmez — dürüstçe yutulur (telefon zaten almadığını fark eder). */
async function _sendResultMessage(id: string, status: PhoneLinkAckStatus, result?: unknown): Promise<void> {
  try {
    const payload = serializeApplicationResponse(buildApplicationResponse(id, status, result));
    await PhoneHubLink.sendApplicationMessage({ payload });
  } catch { /* taşıma hatası — karar ZATEN uygulandı, geri ALINMAZ */ }
}

async function sendNavProposalResultMessage(proposalId: string, status: PhoneLinkAckStatus): Promise<void> {
  await _sendResultMessage(proposalId, status);
}

/**
 * F9 — Mavi'nin ürettiği TERMİNAL sonucu telefona gönderir.
 *
 * ── SIZDIRMAZLIK (§13) ────────────────────────────────────────────────────
 * Gönderimden HEMEN ÖNCE `session` (isteğin KENDİSİNİN taşıdığı
 * fingerprint+epoch) yeniden doğrulanır. Bu arada disconnect/revoke/yeni
 * nesle geçiş olduysa sonuç BAŞKA/eski bir oturuma SIZDIRILMAZ — sessizce
 * düşürülür (telefon zaten kendi kopan oturumunu fark eder).
 */
async function sendAssistantBridgeResultMessage(
  requestId: string,
  outcome: PhoneLinkAssistantTerminalResult,
  session: { readonly deviceFingerprint: string; readonly sessionEpoch: number },
): Promise<void> {
  if (!isAssistantBridgeResultDeliverable(session.deviceFingerprint, session.sessionEpoch)) return;
  const { status, result } = assistantTerminalToAck(outcome);
  await _sendResultMessage(requestId, status, result);
}

/** Sürücü "Git"e bastı. Onay anında TAM yeniden doğrulama (`approveNavProposal` içinde). */
export async function approvePendingNavDestination(proposalId: string): Promise<PhoneLinkAckStatus> {
  const result = await approveNavProposal(proposalId);
  const status = navResolveResultToAck('APPROVE', result);
  await sendNavProposalResultMessage(proposalId, status);
  return status;
}

/** Sürücü "Reddet"e bastı — mevcut rota (varsa) DOKUNULMADAN kalır. */
export async function rejectPendingNavDestination(proposalId: string): Promise<PhoneLinkAckStatus> {
  const { existed } = rejectNavProposal(proposalId);
  const status: PhoneLinkAckStatus = existed ? 'REJECTED_BY_USER' : 'EXPIRED';
  await sendNavProposalResultMessage(proposalId, status);
  return status;
}

/** Kartın görünür geri sayımı doldu (UI'ın kendi ömür-bağlı zamanlayıcısı — bkz. Overlay). */
export async function expirePendingNavDestination(proposalId: string): Promise<PhoneLinkAckStatus> {
  expireNavProposal(proposalId);
  await sendNavProposalResultMessage(proposalId, 'EXPIRED');
  return 'EXPIRED';
}

/* ══════════════════════════════════════════════════════════════════════════
 * Native bridge kaydı — TEK gerçek giriş (event-driven, polling YOK)
 * ════════════════════════════════════════════════════════════════════════ */

let _unsubscribe: (() => void) | null = null;

/**
 * Native `applicationMessage` olayına abone olur. İkinci çağrı ÖNCE var olan
 * aboneliği söker (çift dinleyici YOK). Dönen fonksiyon aboneliği kaldırır —
 * çağıran (ör. uygulama yaşam döngüsü) sahiplenir; bu modül kendi kendine
 * sonsuza dek dinlemez.
 */
export function initPhoneLinkApplicationBridge(): () => void {
  _unsubscribe?.();
  _unsubscribe = null;

  let disposed = false;
  void PhoneHubLink.addListener('applicationMessage', (event) => {
    if (disposed) return;
    void handleApplicationMessageForTest(event).then((responseText) => {
      if (disposed || responseText === null) return;
      void PhoneHubLink.sendApplicationMessage({ payload: responseText }).catch(() => {
        /* Gönderim başarısız olabilir (oturum bu arada koptu) — bu bir
         * yetki/karar hatası DEĞİLDİR, yalnız taşıma başarısızlığıdır ve
         * dürüstçe yutulur (telefon zaten ACK'i almadığını fark eder). */
      });
    });
  }).then((handle) => {
    if (disposed) { void handle.remove(); return; }
    _unsubscribe = () => { void handle.remove(); };
  }).catch(() => {
    /* Native plugin yoksa (tarayıcı modu) sessizce hiçbir şey dinlenmez —
     * FAIL-SOFT, sahte bir abonelik İDDİA EDİLMEZ. */
  });

  return () => {
    disposed = true;
    _unsubscribe?.();
    _unsubscribe = null;
  };
}
