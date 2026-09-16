/**
 * phoneLinkAttachment.ts — PHONE LINK F1 · Attachment Snapshot (salt-okunur projeksiyon).
 *
 * ── TEK OTORİTE ÜZERİNE İNCE PROJEKSİYON ────────────────────────────────────
 * Bu dosya YENİ bir link/session otoritesi KURMAZ. Gerçek, canlı Phone Link
 * durumu native RFCOMM köprüsündedir (`phoneHubLink.ts` → `getPhoneHubLink()`)
 * ve zaten güvenli biçimde projekte edilmiştir (`phoneHubUserModel.ts` →
 * `deriveUserState`). Bu modül yalnız o projeksiyonu ÜÇ duruma indirger.
 *
 * ⚠️ `src/platform/companion/*` (CompanionSessionManager) BİLEREK KULLANILMADI:
 * o modülün kendi barrel dosyası "bu derlemede uygulanmış tek adapter MOCK'tur"
 * der — gerçek telefona BAĞLI DEĞİLDİR (F0 kanıtı).
 *
 * ── "ACTIVE" ≠ DRIVER ────────────────────────────────────────────────────────
 * `ACTIVE`, native oturumun KRİPTOGRAFİK olarak kurulduğunu, taze olduğunu ve
 * (varsa) güvenli olduğunu söyler — bu telefonun SÜRÜCÜNÜN telefonu olduğu
 * ANLAMINA GELMEZ. Rol (`PhoneLinkRole`) ayrı bir eksendir; bu isim/anlam
 * testlerle kilitlenir (bkz. `phoneLinkAttachment.test.ts`).
 *
 * ── NEDEN POLLING/SUBSCRIPTION YOK ───────────────────────────────────────────
 * Native `PhoneHubLinkPlugin` hiçbir `notifyListeners` olayı YAYINLAMIYOR
 * (F0 ölçümü) — yalnız `getSnapshot()` çekilebilir. Bu yüzden bu modül SAF ve
 * SENKRONDUR: `getPhoneHubLink()`in önbelleğini okur, kendi timer'ını KURMAZ.
 * Tazelik, çağıranın (ör. bir komut göndermeden hemen önce) `refreshPhoneHubLink()`
 * çağırmasıyla sağlanır — var olan LAB ekranı deseniyle BİREBİR aynı
 * ("açılışta tek atışlık pull + elle yenile").
 */

import {
  getPhoneHubLink,
  type PhoneHubLinkSnapshotRaw,
} from '../phoneHub/phoneHubLink';
import {
  deriveUserState, deriveTrustLevel, type PhoneHubTrustLevel,
} from '../phoneHub/phoneHubUserModel';
import { derivePhoneLinkRole, type PhoneLinkRole, type PhoneLinkRoleReason } from './phoneLinkRole';

/** ⚠️ `ACTIVE` = kriptografik session established, DRIVER DEĞİL. */
export type PhoneAttachmentState = 'DETACHED' | 'LINKED' | 'ACTIVE';

/**
 * Rol AYRI BİR OTORİTEDEN gelir (`phoneLinkRole.ts`, F3.0). Burada TÜRETİLMEZ,
 * yalnız yeniden dışa verilir — `PRIMARY` kapısının tek sahibi orasıdır.
 *
 * ⚠️ F3.0 DÜZELTMESİ: rol ARTIK `deriveTrustLevel()` (CİHAZ güveni) hükmünden
 * türetilmez. TRUSTED DEVICE ≠ PRIMARY DRIVER. Gerekçe için `phoneLinkRole.ts`.
 */
export type { PhoneLinkRole, PhoneLinkRoleReason };

export interface PhoneAttachmentSnapshot {
  readonly state: PhoneAttachmentState;
  readonly role: PhoneLinkRole;
  /** Rolün gerekçesi — sessiz düşüş YOK. Sır TAŞIMAZ (bkz. `phoneLinkRole.ts`). */
  readonly roleReason: PhoneLinkRoleReason;
  /**
   * CİHAZ güven basamağı — kanonik `deriveTrustLevel()` hükmünün aynen
   * taşınması (ikinci hesaplama YOK).
   *
   * ⚠️ F3.0 İHLALİNE GERİ DÖNÜŞ DEĞİLDİR: bu alan ROL üretmez ve `role`
   * alanını ETKİLEMEZ. TRUSTED DEVICE ≠ PRIMARY DRIVER kuralı yerinde
   * durur (`phoneLinkRole.ts` tek rol otoritesidir). Burada taşınan şey
   * "bu CİHAZ kayıtlı güvenilen cihaz mı" sorusunun yanıtıdır — CİHAZ
   * kapsamlı yetenekler (F5 `INTERNET_SHARE`) için meşru kanıttır, KİŞİ
   * kapsamlı kararlar için DEĞİL.
   */
  readonly deviceTrust: PhoneHubTrustLevel;
  /**
   * Native oturum nesli — grantlar için `sessionEpoch`. Oturum yoksa `null`.
   * Tek kaynağı native'dir; burada ÜRETİLMEZ.
   */
  readonly sessionEpoch: number | null;
  /**
   * Opak eşleşen-cihaz parmak izi (native zaten ham MAC/isim TAŞIMAZ).
   * YALNIZ grant/oturum bağlama karşılaştırması için kullanılır — LOG'A,
   * UI'a veya herhangi bir kanıt/telemetri tamponuna ASLA yazılmaz.
   */
  readonly deviceFingerprint: string | null;
}

/**
 * Native oturumun kanıtladığı en üst 3-basamaklı durum.
 *
 * `deriveUserState` ZATEN doğru merdiveni uyguluyor (CONNECTED yalnız
 * `trulyEstablished === true` iken, WEAK ise DEGRADED oturum için) — burada
 * yalnız 7 durumun 3'e KATLANMASI vardır, yeni bir karar ÜRETİLMEZ.
 */
function toAttachmentState(raw: PhoneHubLinkSnapshotRaw): PhoneAttachmentState {
  const userState = deriveUserState(raw);
  if (userState === 'CONNECTED') return 'ACTIVE';
  if (
    userState === 'AWAITING_CODE_CONFIRMATION'
    || userState === 'RECONNECTING'
    || userState === 'WEAK'
  ) return 'LINKED';
  return 'DETACHED'; // NOT_CONNECTED | WAITING_FOR_PHONE | ERROR
}

/**
 * Fail-closed rol — kararı `phoneLinkRole.derivePhoneLinkRole()` verir.
 *
 * Bu dosya rolü ARTIK HESAPLAMAZ: cihaz güveninden (`deriveTrustLevel`) kişi
 * kimliği türetmek F3.0'da kapatılan ihlaldir. Burada yalnız girdi taşınır.
 */
function toRole(
  state: PhoneAttachmentState, deviceFingerprint: string | null, nowMs: number,
) {
  return derivePhoneLinkRole({ attachmentState: state, deviceFingerprint, nowMs });
}

const DETACHED_SNAPSHOT: PhoneAttachmentSnapshot = Object.freeze({
  state: 'DETACHED',
  role: 'GUEST',
  roleReason: 'link_not_active',
  deviceTrust: 'UNKNOWN',
  sessionEpoch: null,
  deviceFingerprint: null,
});

/**
 * Kanonik okuma. Yan etkisizdir — native'e GİTMEZ (`getPhoneHubLink()` zaten
 * senkron önbellek). Tazelemek isteyen çağıran önce `refreshPhoneHubLink()`
 * çağırmalıdır (bu modülün işi DEĞİLDİR — ikinci bir tazelik otoritesi
 * kurulmaz).
 */
export function getPhoneAttachmentSnapshot(nowMs: number = Date.now()): PhoneAttachmentSnapshot {
  const raw = getPhoneHubLink();
  if (!raw?.present) return DETACHED_SNAPSHOT;

  const state = toAttachmentState(raw);
  if (state === 'DETACHED') return DETACHED_SNAPSHOT;

  const session = raw.session ?? null;
  const deviceFingerprint = typeof session?.peerFingerprint === 'string' && session.peerFingerprint.length > 0
    ? session.peerFingerprint
    : null;
  const roleEvidence = toRole(state, deviceFingerprint, nowMs);
  return Object.freeze({
    state,
    role: roleEvidence.role,
    roleReason: roleEvidence.reason,
    deviceTrust: deriveTrustLevel(raw),
    sessionEpoch: typeof session?.generation === 'number' ? session.generation : null,
    deviceFingerprint,
  });
}

/** Testler için saf yardımcı — gerçek `getPhoneHubLink()` önbelleğine DOKUNMAZ. */
export function classifyPhoneAttachment(
  raw: PhoneHubLinkSnapshotRaw, nowMs: number = Date.now(),
): PhoneAttachmentSnapshot {
  if (!raw?.present) return DETACHED_SNAPSHOT;
  const state = toAttachmentState(raw);
  if (state === 'DETACHED') return DETACHED_SNAPSHOT;
  const session = raw.session ?? null;
  const deviceFingerprint = typeof session?.peerFingerprint === 'string' && session.peerFingerprint.length > 0
    ? session.peerFingerprint
    : null;
  const roleEvidence = toRole(state, deviceFingerprint, nowMs);
  return Object.freeze({
    state,
    role: roleEvidence.role,
    roleReason: roleEvidence.reason,
    deviceTrust: deriveTrustLevel(raw),
    sessionEpoch: typeof session?.generation === 'number' ? session.generation : null,
    deviceFingerprint,
  });
}
