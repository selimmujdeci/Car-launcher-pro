/**
 * phoneHubNativeIngress.ts — ARCH-04/F5 · NATIVE PHONE OLAYI → COMPANION OTORİTESİ GİRİŞİ.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── ÇÖZDÜĞÜ SORUN ────────────────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * `PhoneHubLink` native anlık görüntüsü ham bir TAŞIMA gözlemidir. İçinde
 * `trulyEstablished`, `grantedCapabilities`, `state: CONNECTED` gibi alanlar
 * vardır ve bunlar **doğrudan okunursa** native, companion gerçeğinin ikinci
 * otoritesi hâline gelir. Bu dosya araya girer:
 *
 *   native olay → BU GİRİŞ ADAPTÖRÜ → companion otoritesi → projeksiyon
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── BU DOSYA NE YAPMAZ ───────────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * (1) **COMPANION GERÇEĞİNİ YAZMAZ.** `CompanionSessionManager` durumunu
 *     değiştirmez, `transition()` çağırmaz, oturum kurmaz/kapatmaz. Yalnız
 *     bir ÖNERİ (`CompanionIngressProposal`) ve KANIT üretir; hükmü canonical
 *     otorite verir.
 * (2) **NESİL ÜRETMEZ.** Nesil native oturumdan gelir; burada yalnız
 *     MONOTONLUK kapısı uygulanır (geri giden nesil = STALE).
 * (3) **KOMUT GÖNDERMEZ.** Sunucu başlatmaz, eşleştirme onaylamaz, Bluetooth
 *     açmaz, izin istemez.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── ALTI AYRI KAVRAM (BİRLEŞTİRİLMESİ YASAK) ─────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 *   device present · transport connected · authenticated · session established
 *   · capability granted · control allowed
 *
 * `CONNECTED` bir kimlik doğrulaması DEĞİLDİR. `present` bir yetenek izni
 * DEĞİLDİR. Native bunların hepsini aynı anda iddia etse bile merdiven
 * yalnız ALTTAN yukarı tırmanır: bir alt basamağın kanıtı yoksa üst basamak
 * VERİLMEZ.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── GİZLİLİK ─────────────────────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * `peerFingerprint` · eşleştirme kodu · `uuid` · `peerAppVersion` · anahtar ·
 * ham kimlik bilgisi bu modüle GİRMEZ ve kanıta YAZILMAZ. Yalnız sınıf,
 * sayı ve nesil taşınır.
 */

/* ══════════════════════════════════════════════════════════════════════════
 * 1) Merdiven
 * ════════════════════════════════════════════════════════════════════════ */

export type PhoneLinkStage =
  | 'ABSENT'
  | 'DEVICE_PRESENT'
  | 'TRANSPORT_CONNECTED'
  | 'AUTHENTICATED'
  | 'SESSION_ESTABLISHED'
  | 'CAPABILITY_GRANTED'
  | 'CONTROL_ALLOWED';

export const PHONE_LINK_STAGES: readonly PhoneLinkStage[] = Object.freeze([
  'ABSENT', 'DEVICE_PRESENT', 'TRANSPORT_CONNECTED', 'AUTHENTICATED',
  'SESSION_ESTABLISHED', 'CAPABILITY_GRANTED', 'CONTROL_ALLOWED',
]);

export function phoneLinkStageRank(stage: PhoneLinkStage): number {
  return PHONE_LINK_STAGES.indexOf(stage);
}

export type PhoneIngressVerdict =
  | 'ACCEPTED'
  | 'REJECTED_STALE'
  | 'REJECTED_MALFORMED'
  | 'REJECTED_UNAVAILABLE';

/* ══════════════════════════════════════════════════════════════════════════
 * 2) Giriş olayı — native ham şeklinden ARINDIRILMIŞ
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * Giriş adaptörünün kabul ettiği TEK şekil. Native ham anlık görüntüsü
 * `normalizePhoneHubNativeEvent()` ile buna indirgenir; hassas alanlar
 * bu tipte HİÇ YOKTUR (yapısal gizlilik).
 */
export interface PhoneNativeIngressEvent {
  /** Native köprü gerçekten okundu mu (JS tarafı bayrağı). */
  readonly present: boolean;
  /** Native oturum nesli; okunamadıysa `null` — 0 UYDURULMAZ. */
  readonly generation: number | null;
  /** Sunucu durumu sınıfı (ham string kapalı sözlüğe indirgenmez, yalnız taşınır). */
  readonly serverState: string | null;
  readonly serverRunning: boolean | null;
  readonly hasActiveSocket: boolean | null;
  readonly preconditionsReady: boolean | null;
  readonly connectPermission: boolean | null;
  readonly handshakeStage: string | null;
  readonly awaitingUserConfirm: boolean | null;
  readonly trustSkipped: boolean | null;
  readonly encryptionActive: boolean | null;
  readonly trulyEstablished: boolean | null;
  readonly disposed: boolean | null;
  /** Yalnız ADET — yetenek adları companion otoritesinin sözlüğüdür. */
  readonly grantedCapabilityCount: number;
  readonly lastErrorCode: string | null;
}

const ABSENT_EVENT: PhoneNativeIngressEvent = Object.freeze({
  present: false, generation: null, serverState: null, serverRunning: null,
  hasActiveSocket: null, preconditionsReady: null, connectPermission: null,
  handshakeStage: null, awaitingUserConfirm: null, trustSkipped: null,
  encryptionActive: null, trulyEstablished: null, disposed: null,
  grantedCapabilityCount: 0, lastErrorCode: null,
});

function _bool(v: unknown): boolean | null { return typeof v === 'boolean' ? v : null; }
function _str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 && v.length <= 64 ? v : null;
}
function _num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/**
 * Ham native anlık görüntüsünü giriş olayına indirger.
 *
 * ⚠️ GİZLİLİK KAPISI: yalnız aşağıda AÇIKÇA sayılan alanlar geçer. `uuid`,
 * `peerFingerprint`, `peerAppVersion`, `pairing.code` ve `trust.*` alanları
 * bilerek OKUNMAZ — kopyalanmayan alan sızamaz.
 */
export function normalizePhoneHubNativeEvent(raw: unknown): PhoneNativeIngressEvent {
  if (!raw || typeof raw !== 'object') return ABSENT_EVENT;
  const r = raw as Record<string, unknown>;
  if (r.present !== true) return ABSENT_EVENT;
  const server = (r.server && typeof r.server === 'object' ? r.server : {}) as Record<string, unknown>;
  const pre = (r.preconditions && typeof r.preconditions === 'object' ? r.preconditions : {}) as Record<string, unknown>;
  const session = (r.session && typeof r.session === 'object' ? r.session : {}) as Record<string, unknown>;
  const caps = Array.isArray(session.grantedCapabilities) ? session.grantedCapabilities : [];
  return Object.freeze({
    present: true,
    generation: _num(session.generation),
    serverState: _str(server.state),
    serverRunning: _bool(server.running),
    hasActiveSocket: _bool(server.hasActiveSocket),
    preconditionsReady: _bool(pre.ready),
    connectPermission: _bool(pre.connectPermission),
    handshakeStage: _str(session.handshakeStage),
    awaitingUserConfirm: _bool(session.awaitingUserConfirm),
    trustSkipped: _bool(session.trustSkipped),
    encryptionActive: _bool(session.encryptionActive),
    trulyEstablished: _bool(session.trulyEstablished),
    disposed: _bool(session.disposed),
    grantedCapabilityCount: caps.length,
    lastErrorCode: _str(session.lastErrorCode) ?? _str(r.lastErrorCode),
  });
}

/* ══════════════════════════════════════════════════════════════════════════
 * 3) Merdiven sınıflandırması (SAF)
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * Native olayın KANITLADIĞI en üst basamak.
 *
 * Her basamak yalnız KENDİ kanıtıyla açılır ve bir alt basamak kapalıysa
 * ÜST BASAMAK AÇILAMAZ. Native `trulyEstablished: true` dese bile ön koşullar
 * kanıtlanmamışsa merdiven `TRANSPORT_CONNECTED`te durur.
 */
export function classifyPhoneLinkStage(e: PhoneNativeIngressEvent): PhoneLinkStage {
  if (!e.present) return 'ABSENT';
  /* Oturum bırakılmışsa üst basamakların hiçbiri geçerli değildir. */
  if (e.disposed === true) return e.serverRunning === true ? 'DEVICE_PRESENT' : 'ABSENT';

  /* (1) DEVICE_PRESENT — native köprü okundu ve sunucu ayakta. */
  if (e.serverRunning !== true) return 'ABSENT';

  /* (2) TRANSPORT_CONNECTED — açık soket VEYA canlı bir oturum nesli var. */
  const transportConnected = e.hasActiveSocket === true || (e.generation !== null && e.generation > 0);
  if (!transportConnected) return 'DEVICE_PRESENT';

  /* (3) AUTHENTICATED — "CONNECTED" BU DEĞİLDİR. Şifreleme aktif ve kullanıcı
     onayı beklenmiyor ve güven ATLANMAMIŞ olmalı. */
  const authenticated = e.encryptionActive === true
    && e.awaitingUserConfirm !== true
    && e.trustSkipped !== true;
  if (!authenticated) return 'TRANSPORT_CONNECTED';

  /* (4) SESSION_ESTABLISHED — native'in açık kurulum kanıtı + ön koşullar. */
  const established = e.trulyEstablished === true && e.preconditionsReady === true;
  if (!established) return 'AUTHENTICATED';

  /* (5) CAPABILITY_GRANTED — en az bir yetenek gerçekten anlaşılmış olmalı. */
  if (e.grantedCapabilityCount <= 0) return 'SESSION_ESTABLISHED';

  /* (6) CONTROL_ALLOWED — bağlantı izni ölçülmüş ve verilmiş olmalı. */
  if (e.connectPermission !== true) return 'CAPABILITY_GRANTED';
  return 'CONTROL_ALLOWED';
}

/* ══════════════════════════════════════════════════════════════════════════
 * 4) Öneri + kanıt
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * Companion otoritesine sunulan ÖNERİ. Otorite bunu kabul edebilir veya
 * reddedebilir; bu tip bir EMİR DEĞİLDİR ve companion durumunu değiştirmez.
 */
export interface CompanionIngressProposal {
  readonly stage: PhoneLinkStage;
  readonly generation: number | null;
  /** Otoritenin uygulama mesajına izin vermesi ÖNERİLİR mi (hüküm değil). */
  readonly proposesApplicationTraffic: boolean;
  readonly capabilityCount: number;
  readonly reason: string;
}

export interface PhoneIngressResult {
  readonly verdict: PhoneIngressVerdict;
  readonly stage: PhoneLinkStage;
  readonly generation: number | null;
  readonly acceptedGeneration: number | null;
  readonly proposal: CompanionIngressProposal | null;
  readonly reason: string;
}

export interface PhoneIngressEvidenceEntry {
  readonly seq: number;
  readonly verdict: PhoneIngressVerdict;
  readonly stage: PhoneLinkStage;
  readonly generation: number | null;
  readonly capabilityCount: number;
  readonly lastErrorCode: string | null;
  readonly reason: string;
}

export interface PhoneIngressEvidence {
  readonly acceptedGeneration: number | null;
  readonly stage: PhoneLinkStage;
  readonly acceptedCount: number;
  readonly staleRejectedCount: number;
  readonly malformedRejectedCount: number;
  readonly unavailableCount: number;
  /** Companion gerçeğine yapılan doğrudan yazma sayısı — YAPISAL OLARAK 0. */
  readonly directCompanionTruthWrites: 0;
  readonly recent: readonly PhoneIngressEvidenceEntry[];
  readonly provenance: readonly string[];
}

const EVIDENCE_CAPACITY = 24;

let _acceptedGeneration: number | null = null;
let _stage: PhoneLinkStage = 'ABSENT';
let _accepted = 0;
let _stale = 0;
let _malformed = 0;
let _unavailable = 0;
let _seq = 0;
let _recent: PhoneIngressEvidenceEntry[] = [];

const PROVENANCE: readonly string[] = Object.freeze([
  'phoneHubLink native snapshot refresh → phoneHubNativeIngress',
  'companion authority: companionSessionManager (bu modül YAZMAZ)',
]);

function _push(entry: PhoneIngressEvidenceEntry): void {
  _recent.push(entry);
  if (_recent.length > EVIDENCE_CAPACITY) _recent.shift();
}

/**
 * Native olayı companion girişinden geçirir.
 *
 * KURALLAR:
 *  · Nesil GERİ giderse → `REJECTED_STALE`, mevcut basamak DEĞİŞMEZ (0 mutasyon).
 *  · `present:false` → `REJECTED_UNAVAILABLE`, basamak `ABSENT`'e DÜŞER
 *    (köprü kayboldu; eski "bağlı" hükmü taze görünemez).
 *  · Şekil bozuksa → `REJECTED_MALFORMED`, mevcut basamak DEĞİŞMEZ.
 */
export function ingestPhoneHubNativeEvent(raw: unknown): PhoneIngressResult {
  _seq += 1;
  if (raw !== null && typeof raw === 'object' && (raw as Record<string, unknown>).present === true
      && typeof (raw as Record<string, unknown>).session === 'string') {
    /* Native sözleşmesi bozulmuş: `session` nesne olmalı. */
    _malformed += 1;
    const entry: PhoneIngressEvidenceEntry = Object.freeze({
      seq: _seq, verdict: 'REJECTED_MALFORMED', stage: _stage, generation: null,
      capabilityCount: 0, lastErrorCode: null,
      reason: 'native şekli sözleşmeye uymuyor — mevcut basamak KORUNDU',
    });
    _push(entry);
    return Object.freeze({
      verdict: 'REJECTED_MALFORMED', stage: _stage, generation: null,
      acceptedGeneration: _acceptedGeneration, proposal: null, reason: entry.reason,
    });
  }

  const event = normalizePhoneHubNativeEvent(raw);

  if (!event.present) {
    _unavailable += 1;
    _stage = 'ABSENT';
    const reason = 'native köprü okunamadı — KAYNAK YOK (eski hüküm taze sayılmaz)';
    _push(Object.freeze({
      seq: _seq, verdict: 'REJECTED_UNAVAILABLE', stage: 'ABSENT', generation: null,
      capabilityCount: 0, lastErrorCode: null, reason,
    }));
    return Object.freeze({
      verdict: 'REJECTED_UNAVAILABLE', stage: 'ABSENT', generation: null,
      acceptedGeneration: _acceptedGeneration, proposal: null, reason,
    });
  }

  /* NESİL KAPISI — geciken/eski nesil yeni oturumu KİRLETEMEZ. */
  if (event.generation !== null && _acceptedGeneration !== null
      && event.generation < _acceptedGeneration) {
    _stale += 1;
    const reason = `eski nesil ${event.generation} < ${_acceptedGeneration} — REDDEDİLDİ, mutasyon YOK`;
    _push(Object.freeze({
      seq: _seq, verdict: 'REJECTED_STALE', stage: _stage, generation: event.generation,
      capabilityCount: event.grantedCapabilityCount, lastErrorCode: event.lastErrorCode, reason,
    }));
    return Object.freeze({
      verdict: 'REJECTED_STALE', stage: _stage, generation: event.generation,
      acceptedGeneration: _acceptedGeneration, proposal: null, reason,
    });
  }

  const stage = classifyPhoneLinkStage(event);
  _accepted += 1;
  _stage = stage;
  if (event.generation !== null) _acceptedGeneration = event.generation;

  const proposal: CompanionIngressProposal = Object.freeze({
    stage,
    generation: event.generation,
    /* Uygulama trafiği ÖNERİSİ yalnız en üst basamakta verilir; hüküm
       companion otoritesinin `canSendApplicationMessage()` kapısıdır. */
    proposesApplicationTraffic: stage === 'CONTROL_ALLOWED',
    capabilityCount: event.grantedCapabilityCount,
    reason: _stageReason(stage, event),
  });

  _push(Object.freeze({
    seq: _seq, verdict: 'ACCEPTED', stage, generation: event.generation,
    capabilityCount: event.grantedCapabilityCount, lastErrorCode: event.lastErrorCode,
    reason: proposal.reason,
  }));

  return Object.freeze({
    verdict: 'ACCEPTED', stage, generation: event.generation,
    acceptedGeneration: _acceptedGeneration, proposal, reason: proposal.reason,
  });
}

function _stageReason(stage: PhoneLinkStage, e: PhoneNativeIngressEvent): string {
  switch (stage) {
    case 'ABSENT': return 'sunucu ayakta değil veya oturum bırakılmış';
    case 'DEVICE_PRESENT': return 'sunucu ayakta — TAŞIMA BAĞLI DEĞİL';
    case 'TRANSPORT_CONNECTED':
      return e.trulyEstablished === true
        ? 'native KURULDU diyor ama şifreleme/onay kanıtı yok — DOĞRULANMADI'
        : 'taşıma bağlı — KİMLİK DOĞRULANMADI (CONNECTED ≠ AUTHENTICATED)';
    case 'AUTHENTICATED':
      return e.preconditionsReady === true
        ? 'doğrulandı ama native oturum kurulumu kanıtlanmadı'
        : 'doğrulandı ama ön koşullar hazır değil — OTURUM KURULMADI';
    case 'SESSION_ESTABLISHED': return 'oturum kuruldu — YETENEK VERİLMEDİ (0 anlaşma)';
    case 'CAPABILITY_GRANTED': return 'yetenek verildi — bağlantı izni ölçülmedi/yok, KONTROL AÇILMADI';
    case 'CONTROL_ALLOWED': return 'tüm basamaklar kanıtlandı — kontrol ÖNERİLİR (hüküm companion otoritesinin)';
  }
}

/** Salt-okunur kanıt getter. Yan etkisi YOKTUR. */
export function getPhoneHubIngressEvidence(): PhoneIngressEvidence {
  return Object.freeze({
    acceptedGeneration: _acceptedGeneration,
    stage: _stage,
    acceptedCount: _accepted,
    staleRejectedCount: _stale,
    malformedRejectedCount: _malformed,
    unavailableCount: _unavailable,
    directCompanionTruthWrites: 0,
    recent: Object.freeze([..._recent]),
    provenance: PROVENANCE,
  });
}

/** @internal — testler arası izolasyon. */
export function _resetPhoneHubIngressForTest(): void {
  _acceptedGeneration = null;
  _stage = 'ABSENT';
  _accepted = 0;
  _stale = 0;
  _malformed = 0;
  _unavailable = 0;
  _seq = 0;
  _recent = [];
}
