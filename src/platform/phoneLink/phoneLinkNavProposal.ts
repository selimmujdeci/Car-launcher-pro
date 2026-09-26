/**
 * phoneLinkNavProposal.ts — PHONE LINK F8.1 · Pending Destination Proposal.
 *
 * ── NEDEN BU DOSYA VAR (F8 → F8.1 güvenlik düzeltmesi) ──────────────────────
 * F8'de `NAV_DESTINATION_PUSH` grant'ı TEK BAŞINA rotayı değiştirmeye
 * yetiyordu (`dispatchNavDestinationPush` doğrudan `acceptHandoffDestination`
 * çağırıyordu). F8.1 denetimi bunu YETERSİZ buldu:
 *
 *     TRUSTED cihaz  ≠  navigasyonu değiştirme yetkisi
 *
 * `deviceTrust==='TRUSTED'` yalnız "bu cihaz native `PhoneHubTrustStore`'da
 * kayıtlı" der — SÜRÜCÜNÜN KENDİSİ olduğunu KANITLAMAZ (telefon ödünç
 * verilebilir, yolcuda olabilir; bkz. `phoneLinkRole.ts`). Bu yüzden TRUSTED
 * grant artık yalnız bir ÖNERİ oluşturabilir; navigasyonu DEĞİŞTİRME yetkisi
 * aracın İÇİNDEKİ kullanıcı onayından gelir.
 *
 * ── TEK OTORİTE, İKİNCİ STORE DEĞİL ──────────────────────────────────────────
 * Bu modül ne bir navigasyon otoritesi ne de ikinci bir capability sistemidir.
 * Yalnız "hangi hedef, hangi oturumdan, ne zamana kadar onay BEKLİYOR" sorusunu
 * tutar. Onaylanan hedefi KABUL ETMEK yine `destinationHandoff`un işidir
 * (`phoneLinkNavigationAdapter.ts` çağırır, burası ÇAĞIRMAZ).
 *
 * ── BOUNDED, TIMER YOK ────────────────────────────────────────────────────────
 * `phoneLinkCapabilityGrant.ts`teki AYNI desen: TTL kaydedilir ama bir arka
 * plan timer'ı SÜPÜRMEZ — her okuma/yazmada tembel (lazy) `pruneStale()`
 * çalışır. Harita bounded (`MAX_PENDING_PROPOSALS`). UI'daki görünür geri
 * sayım React'in KENDİ bileşen ömrüne bağlı `setTimeout`idir (yeni bir arka
 * plan servisi/scheduler DEĞİL — bkz. `PhoneLinkNavProposalOverlay.tsx`).
 *
 * ── TEK AKTİF ÖNERİ / OTURUM ─────────────────────────────────────────────────
 * Aynı oturumdan ikinci bir push gelirse (aynı `requestId` — yeniden
 * teslimat/retry) VAR OLAN öneri AYNEN döner (ikinci öneri OLUŞTURULMAZ,
 * §5). Farklı bir `requestId` ile YENİ bir push gelirse, o oturumun ÖNCEKİ
 * onaylanmamış önerisinin YERİNE geçer (kullanıcı yanlışlıkla ilk hedefi
 * gönderdiyse ikincisi ekranda kalan olsun — tek kart, tek karar).
 */

import { create } from 'zustand';
import { isSessionLiveGivenSnapshot } from './phoneLinkSessionRegistry';
import { getPhoneAttachmentSnapshot } from './phoneLinkAttachment';

/** Bellek güvenliği tavanı — native bugün tek oturumlu (bkz. sessionRegistry notu). */
const MAX_PENDING_PROPOSALS = 8;

/** Sürücünün kartı görüp tepki vermesi için makul, sınırlı pencere. */
export const NAV_PROPOSAL_TTL_MS = 2 * 60_000;

export interface PendingNavProposal {
  readonly proposalId: string;
  readonly deviceFingerprint: string;
  readonly sessionEpoch: number;
  readonly latitude: number;
  readonly longitude: number;
  /** Uydurma ad YOK — yoksa UI koordinat metnini gösterir. */
  readonly label: string | null;
  readonly createdAtMs: number;
  readonly expiresAtMs: number;
}

/** UI/LAB'a geçen alan alt kümesi — `deviceFingerprint` TAŞIMAZ (§13/§16). */
export interface UiNavProposal {
  readonly proposalId: string;
  readonly latitude: number;
  readonly longitude: number;
  readonly label: string | null;
  readonly createdAtMs: number;
  readonly expiresAtMs: number;
}

function toUiProposal(p: PendingNavProposal): UiNavProposal {
  return {
    proposalId: p.proposalId, latitude: p.latitude, longitude: p.longitude,
    label: p.label, createdAtMs: p.createdAtMs, expiresAtMs: p.expiresAtMs,
  };
}

/** Oturum anahtarı — `deviceFingerprint` + `sessionEpoch` ÇİFTİ (session registry ile aynı ilke). */
function sessionMapKey(fp: string, epoch: number): string {
  return `${fp.length}:${fp}:${epoch}`;
}

const _proposals = new Map<string, PendingNavProposal>();

/* ── UI projeksiyonu (salt-okunur, §6: UI truth üretmez) ─────────────────────
 * Yalnız EN SON değiştirilen öneriyi taşır — ürün kararı: aynı anda birden
 * fazla kartın üst üste binmesi istenmiyor (native de zaten tek oturumlu). */
interface NavProposalUiState {
  readonly proposal: UiNavProposal | null;
}
export const useNavProposalUiStore = create<NavProposalUiState>(() => ({ proposal: null }));

function publishUi(p: PendingNavProposal | null): void {
  useNavProposalUiStore.setState({ proposal: p ? toUiProposal(p) : null });
}

/** Süresi geçmiş VEYA oturumu artık canlı olmayan kayıtları düşürür (tembel, timer YOK). */
function pruneStale(now: number): void {
  if (_proposals.size === 0) return;
  const snap = getPhoneAttachmentSnapshot();
  for (const [key, p] of Array.from(_proposals)) {
    const stillLive = now < p.expiresAtMs
      && isSessionLiveGivenSnapshot(p.deviceFingerprint, p.sessionEpoch, snap);
    if (!stillLive) {
      _proposals.delete(key);
      if (useNavProposalUiStore.getState().proposal?.proposalId === p.proposalId) publishUi(null);
    }
  }
}

/**
 * Yeni bir öneri oluşturur/idempotent döner. Yetkilendirme BU FONKSİYONUN
 * İŞİ DEĞİLDİR — çağıran (`phoneLinkNavigationAdapter`) zaten `authorize()`/
 * `canExecute()`/canlılık kapılarını geçmiş olmalıdır. Burası yalnız KAYDEDER.
 */
export function createNavProposal(
  input: {
    readonly requestId: string;
    readonly latitude: number;
    readonly longitude: number;
    readonly label: string | null;
    readonly deviceFingerprint: string;
    readonly sessionEpoch: number;
  },
  now: number = Date.now(),
): PendingNavProposal {
  pruneStale(now);
  const key = sessionMapKey(input.deviceFingerprint, input.sessionEpoch);
  const existing = _proposals.get(key);
  if (existing && existing.proposalId === input.requestId) return existing; // aynı istek → aynı öneri

  const proposal: PendingNavProposal = Object.freeze({
    proposalId: input.requestId,
    deviceFingerprint: input.deviceFingerprint,
    sessionEpoch: input.sessionEpoch,
    latitude: input.latitude,
    longitude: input.longitude,
    label: input.label,
    createdAtMs: now,
    expiresAtMs: now + NAV_PROPOSAL_TTL_MS,
  });
  _proposals.set(key, proposal); // AYNI oturumun ÖNCEKİ onaylanmamış önerisinin yerine geçer

  /* Bounded — sınırsız büyüme YOK (native bugün tek oturumlu; bu yalnız savunma). */
  while (_proposals.size > MAX_PENDING_PROPOSALS) {
    const oldest = _proposals.keys().next();
    if (oldest.done) break;
    _proposals.delete(oldest.value);
  }

  publishUi(proposal);
  return proposal;
}

/**
 * Kararsız (henüz onay/red edilmemiş) öneriyi HARİTADAN ÇIKARIR ve döner.
 * `null` → öneri yok/süresi geçmiş/oturumu artık canlı değil (§9/§21: onay
 * anında yeniden doğrulama BURADAN BAŞLAR — canlılık kontrolü `pruneStale`de).
 */
export function consumeNavProposal(
  proposalId: string, now: number = Date.now(),
): PendingNavProposal | null {
  pruneStale(now);
  for (const [key, p] of Array.from(_proposals)) {
    if (p.proposalId === proposalId) {
      _proposals.delete(key);
      if (useNavProposalUiStore.getState().proposal?.proposalId === proposalId) publishUi(null);
      return p;
    }
  }
  return null;
}

/** Salt-okunur bakış — kaldırMAZ. Onay/red öncesi ön-kontrol için. */
export function peekNavProposal(
  proposalId: string, now: number = Date.now(),
): PendingNavProposal | null {
  pruneStale(now);
  for (const p of _proposals.values()) if (p.proposalId === proposalId) return p;
  return null;
}

/** LAB — bounded sayaç, koordinat/fingerprint TAŞIMAZ. */
export function pendingNavProposalCount(now: number = Date.now()): number {
  pruneStale(now);
  return _proposals.size;
}

/** @internal — yalnız testler. */
export function _resetNavProposalsForTest(): void {
  _proposals.clear();
  publishUi(null);
}
