/**
 * phoneLinkNavigationAdapter.ts — PHONE LINK F8.1 · Navigation Destination Push Adapter.
 *
 * İNCE ADAPTÖR — `phoneLinkMusicRemoteAdapter.ts` ile AYNI desen. Yeni bir
 * rota/navigasyon motoru YAZMAZ. İKİ AŞAMALI akış (F8.1 güvenlik düzeltmesi):
 *
 *   Trusted-device grant → Capability validation (NAVIGATION_CONTROL) →
 *   BU ADAPTÖR → `phoneLinkNavProposal` (ÖNERİ, henüz navigasyon DEĞİL)
 *                                              ↓
 *                              araç içi kullanıcı onayı (React UI)
 *                                              ↓
 *   BU ADAPTÖR (yeniden doğrulama) → `destinationHandoff` (TEK kanonik kapı)
 *
 * ── PAZARLIKSIZ SINIR ────────────────────────────────────────────────────────
 * Bu dosya rota motoruna (`routingService`), navigasyon oturumuna
 * (`navigationService`/`navigationSessionRuntime`) veya harita store'una
 * DOĞRUDAN DOKUNMAZ. Tek çıkışı `acceptHandoffDestination`dır — aynı kapıdan
 * "Arabam Cebimde" (`REMOTE_COMMAND`) ve paylaşılan konum (`GEO_INTENT`) da
 * geçer. Phone Link hedefi/rotayı SAHİPLENMEZ; yalnız TESLİM eder.
 *
 * ── "TRUSTED" TEK BAŞINA YETMEZ (F8.1) ───────────────────────────────────────
 * `NAV_DESTINATION_PUSH` grant'ı yalnız `dispatchNavDestinationPush()`in bir
 * ÖNERİ OLUŞTURMASINA izin verir. Navigasyonu DEĞİŞTİRME yetkisi yalnız
 * `approveNavProposal()`dendir — o da araç içi kullanıcı eyleminden (React
 * onay kartı) ÇAĞRILIR, telefon mesajından DEĞİL. Bu ayrım testle kilitlidir.
 *
 * ── İNTERNETTEN BAĞIMSIZ (§17) ───────────────────────────────────────────────
 * Bu zincirde `ConnectivityAuthority`/`allowsConnectivity` YOKTUR.
 */

import {
  authorizeNavDestinationPush, canExecuteNavDestinationPush,
  isNavDestinationDispatchStillLive, type PhoneLinkSessionRef,
} from './phoneLinkCapabilityGrant';
import { getPhoneAttachmentSnapshot } from './phoneLinkAttachment';
import {
  createNavProposal, consumeNavProposal, peekNavProposal,
  pendingNavProposalCount, type PendingNavProposal,
} from './phoneLinkNavProposal';
import {
  acceptHandoffDestination, recordHandoffOutcome, type HandoffReason,
} from '../navigation/destinationHandoff';

export type PhoneLinkNavDenialCode =
  | 'NOT_ATTACHED' | 'NO_GRANT' | 'STALE'
  /** Öneri hiç yok/süresi geçmiş/zaten karara bağlanmış. */
  | 'EXPIRED'
  /** `destinationHandoff` hedefi reddetti (Null Island vb.). */
  | 'INVALID_DESTINATION'
  /** `destinationHandoff` aynı hedefi kısa pencerede zaten kabul etti. */
  | 'DUPLICATE'
  /** Kanonik handoff çağrısı istisna verdi — oturum/diğer capability ETKİLENMEZ. */
  | 'NAVIGATION_UNAVAILABLE';

export interface PhoneLinkDestinationPush {
  readonly latitude: number;
  readonly longitude: number;
  readonly label: string | null;
  readonly address: string | null;
}

/** Push sonucu artık "kabul edildi" DEĞİL — "öneri oluştu, onay BEKLİYOR" der. */
export type PhoneLinkNavPushResult =
  | { readonly ok: true; readonly proposalId: string }
  | { readonly ok: false; readonly denialCode: PhoneLinkNavDenialCode };

/** Onay/red/expire sonucu — yalnız `destinationHandoff`un GERÇEK hükmünü taşır. */
export type PhoneLinkNavResolveResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly denialCode: PhoneLinkNavDenialCode };

/* ══════════════════════════════════════════════════════════════════════════
 * Bounded, event-driven telemetri (§13) — koordinat/adres/etiket TAŞIMAZ
 * ════════════════════════════════════════════════════════════════════════ */

export interface PhoneLinkNavPushTelemetry {
  readonly receivedCount: number;
  readonly authorizedCount: number;
  readonly rejectedCount: number;
  readonly pendingCount: number;
  readonly handoffAcceptedCount: number;
  readonly handoffFailedCount: number;
  readonly userApprovedCount: number;
  readonly userRejectedCount: number;
  readonly expiredCount: number;
  readonly lastDenialCode: PhoneLinkNavDenialCode | null;
  readonly lastHandoffReason: HandoffReason | null;
  readonly lastAtMs: number | null;
}

const _telemetry = {
  receivedCount: 0,
  authorizedCount: 0,
  rejectedCount: 0,
  handoffAcceptedCount: 0,
  handoffFailedCount: 0,
  userApprovedCount: 0,
  userRejectedCount: 0,
  expiredCount: 0,
  lastDenialCode: null as PhoneLinkNavDenialCode | null,
  lastHandoffReason: null as HandoffReason | null,
  lastAtMs: null as number | null,
};

/** LAB salt-okunur anlık görüntü — koordinat/adres/etiket/parmak izi TAŞIMAZ. */
export function getPhoneLinkNavPushTelemetry(): PhoneLinkNavPushTelemetry {
  return Object.freeze({ ..._telemetry, pendingCount: pendingNavProposalCount() });
}

/** @internal — yalnız testler. */
export function _resetPhoneLinkNavPushTelemetryForTest(): void {
  _telemetry.receivedCount = 0;
  _telemetry.authorizedCount = 0;
  _telemetry.rejectedCount = 0;
  _telemetry.handoffAcceptedCount = 0;
  _telemetry.handoffFailedCount = 0;
  _telemetry.userApprovedCount = 0;
  _telemetry.userRejectedCount = 0;
  _telemetry.expiredCount = 0;
  _telemetry.lastDenialCode = null;
  _telemetry.lastHandoffReason = null;
  _telemetry.lastAtMs = null;
}

/* ══════════════════════════════════════════════════════════════════════════
 * AŞAMA 1 — Push: yalnız ÖNERİ oluşturur, navigasyonu DEĞİŞTİRMEZ
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * Telefondan gelen koordinat hedefini işler. (1) kanonik `authorize()`,
 * (2) TOCTOU `canExecute()` yeniden kontrolü, (3) yan-etkiden hemen önceki
 * son canlılık okuması, (4) yalnız BAŞARILIYSA `phoneLinkNavProposal`da bir
 * ÖNERİ OLUŞTURULUR. `destinationHandoff` BURADA ÇAĞRILMAZ (§2/§3 — TRUSTED
 * tek başına navigasyonu değiştiremez). Hiçbir adım throw ETMEZ.
 */
export async function dispatchNavDestinationPush(
  destination: PhoneLinkDestinationPush,
  /** Zarfın `id`si — AYNI ZAMANDA proposalId olur (ikinci kimlik ÜRETİLMEZ). */
  requestId: string,
  session: PhoneLinkSessionRef | null = null,
): Promise<PhoneLinkNavPushResult> {
  _telemetry.receivedCount += 1;
  _telemetry.lastAtMs = Date.now();
  const operationId = `phone-link-nav-push:${requestId}`;

  try {
    const evidence = authorizeNavDestinationPush(operationId, Date.now(), session);
    if (evidence.decision !== 'ALLOW') {
      const denialCode: PhoneLinkNavDenialCode =
        evidence.decision === 'CAPABILITY_NOT_GRANTED' ? 'NO_GRANT'
          : evidence.decision === 'STALE' ? 'STALE'
            : 'NOT_ATTACHED';
      return _reject(denialCode);
    }
    if (!canExecuteNavDestinationPush(evidence, Date.now(), session)) {
      return _reject('STALE');
    }
    if (!isNavDestinationDispatchStillLive(Date.now(), session)) {
      return _reject('STALE');
    }
    /* `session` çoğu zaman `null`dur (ingress hiç geçirmez — kanıt CANLI
       attachment'tır, bkz. `getActiveGrantFor`'daki AYNI düşme deseni).
       Öneriyi doğru oturuma bağlamak için AYNI çözümleme burada TEKRARLANIR
       (ikinci bir kimlik kaynağı DEĞİL — CANLI anlık görüntünün kendisi). */
    const snap = getPhoneAttachmentSnapshot();
    const fp = session?.deviceFingerprint ?? snap.deviceFingerprint;
    const epoch = session?.sessionEpoch ?? snap.sessionEpoch;
    if (fp == null || epoch == null) {
      return _reject('STALE');
    }

    _telemetry.authorizedCount += 1;

    /* `requestId` (envelope `id`) AYNI ZAMANDA proposalId'dir — ikinci bir
       kimlik üretilmez, telefonun korelasyonu doğal biçimde çalışır. */
    const proposal = createNavProposal({
      requestId,
      latitude: destination.latitude,
      longitude: destination.longitude,
      label: destination.label ?? destination.address,
      deviceFingerprint: fp,
      sessionEpoch: epoch,
    });
    return { ok: true, proposalId: proposal.proposalId };
  } catch {
    return _reject('NAVIGATION_UNAVAILABLE');
  }
}

/* ══════════════════════════════════════════════════════════════════════════
 * AŞAMA 2 — Karar: yalnız ARAÇ İÇİ kullanıcı eyleminden çağrılır
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * Sürücü kartta "Git"e bastı. Onay anında HER ŞEY YENİDEN doğrulanır (§11):
 * öneri hâlâ var mı/süresi geçmedi mi (`consumeNavProposal` içinde canlılık
 * dahil), grant HÂLÂ geçerli mi, session HÂLÂ aynı nesilde mi. Herhangi biri
 * başarısızsa handoff YAPILMAZ. Yalnız başarılıysa kanonik
 * `acceptHandoffDestination` çağrılır — bundan sonra sahiplik Navigation
 * domain'ine geçer (Phone Link disconnect/revoke olsa bile GERİ ALINMAZ).
 */
export async function approveNavProposal(proposalId: string): Promise<PhoneLinkNavResolveResult> {
  const now = Date.now();
  const preview = peekNavProposal(proposalId, now);
  if (preview === null) { _telemetry.expiredCount += 1; return _rejectResolve('EXPIRED'); }

  const session: PhoneLinkSessionRef = {
    deviceFingerprint: preview.deviceFingerprint, sessionEpoch: preview.sessionEpoch,
  };

  try {
    /* Onay anında TAM yeniden yetkilendirme — telefon mesajından geleni
       AYNEN tekrarlar (§11). Grant bu arada revoke edildiyse/session
       koptuysa/yeni nesle geçtiyse burada YAKALANIR. */
    const evidence = authorizeNavDestinationPush(`nav-approve:${proposalId}`, now, session);
    if (evidence.decision !== 'ALLOW') {
      consumeNavProposal(proposalId, now); // bayat/yetkisiz öneri artık ANLAMSIZ — temizlenir
      const denialCode: PhoneLinkNavDenialCode =
        evidence.decision === 'CAPABILITY_NOT_GRANTED' ? 'NO_GRANT'
          : evidence.decision === 'STALE' ? 'STALE'
            : 'NOT_ATTACHED';
      return _rejectResolve(denialCode);
    }
    if (!canExecuteNavDestinationPush(evidence, now, session)
      || !isNavDestinationDispatchStillLive(now, session)) {
      consumeNavProposal(proposalId, now);
      return _rejectResolve('STALE');
    }

    /* Yeniden doğrulama GEÇTİ — öneriyi şimdi TÜKET (tek kullanımlık). */
    const proposal = consumeNavProposal(proposalId, now);
    if (proposal === null) { _telemetry.expiredCount += 1; return _rejectResolve('EXPIRED'); }

    const outcome = acceptHandoffDestination({
      lat: proposal.latitude, lng: proposal.longitude, label: proposal.label, channel: 'PHONE_LINK',
    });
    recordHandoffOutcome(outcome, 'PHONE_LINK');

    if (!outcome.ok) {
      _telemetry.handoffFailedCount += 1;
      _telemetry.lastHandoffReason = outcome.reason;
      return _rejectResolve(outcome.reason === 'debounced' ? 'DUPLICATE' : 'INVALID_DESTINATION');
    }

    _telemetry.handoffAcceptedCount += 1;
    _telemetry.userApprovedCount += 1;
    _telemetry.lastHandoffReason = null;
    return { ok: true };
  } catch {
    consumeNavProposal(proposalId, now);
    return _rejectResolve('NAVIGATION_UNAVAILABLE');
  }
}

/** Sürücü kartta "Reddet"e bastı — YENİDEN DOĞRULAMA GEREKMEZ, red her zaman güvenlidir. */
export function rejectNavProposal(proposalId: string): { readonly existed: boolean } {
  const removed = consumeNavProposal(proposalId);
  if (removed !== null) _telemetry.userRejectedCount += 1;
  return { existed: removed !== null };
}

/** UI'daki görünür geri sayım doldu — kart kendini kapattı (§5, timer YOK: bkz. Overlay). */
export function expireNavProposal(proposalId: string): { readonly existed: boolean } {
  const removed = consumeNavProposal(proposalId);
  if (removed !== null) _telemetry.expiredCount += 1;
  return { existed: removed !== null };
}

/** @internal — yalnız testler: onaylanmadan önce önerinin var olduğunu doğrulamak için. */
export function _peekProposalForTest(proposalId: string): PendingNavProposal | null {
  return peekNavProposal(proposalId);
}

function _reject(denialCode: PhoneLinkNavDenialCode): { ok: false; denialCode: PhoneLinkNavDenialCode } {
  _telemetry.rejectedCount += 1;
  _telemetry.lastDenialCode = denialCode;
  return { ok: false, denialCode };
}

function _rejectResolve(denialCode: PhoneLinkNavDenialCode): PhoneLinkNavResolveResult {
  _telemetry.lastDenialCode = denialCode;
  return { ok: false, denialCode };
}
