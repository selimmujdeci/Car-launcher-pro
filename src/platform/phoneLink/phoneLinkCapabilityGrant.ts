/**
 * phoneLinkCapabilityGrant.ts — PHONE LINK F1 · Minimum Capability Broker.
 *
 * ── TEK KARAR MOTORU ─────────────────────────────────────────────────────────
 * Bu dosya YENİ bir yetkilendirme MANTIĞI icat ETMEZ. Nihai "izin var mı"
 * kararı her zaman kanonik `authorize()`/`canExecute()` (`security/authorization.ts`)
 * tarafından verilir — bu, `dtcService.ts` ve `runtimeRecoverySupervisor.ts`nin
 * ZATEN kullandığı AYNI karar motorudur (F0 kanıtı). Bu modül yalnız:
 *   (a) session-bound bir GRANT KAYDI tutar (`grantId`/`deviceFingerprint`/
 *       `sessionEpoch`/`capability`/`issuedAt`/`expiresAt`),
 *   (b) o kaydı `authorize()`in `grantedCapabilities` girdisine ÇEVİRİR.
 *
 * ⚠️ `enforcement.ts`deki `PHONE_LINK` principal sınıfı BİLEREK
 * kullanılmadı: o yol `companionCapabilityRegistry`nin (mock-only, F0)
 * ANLAŞTIĞI yeteneklerden türer ve tek çağırıcısı mock `companionSessionManager`
 * dır. Bu modül `authorization.ts`nin bottom-layer `authorize()`/`canExecute()`
 * primitifini DOĞRUDAN, kendi (gerçek native tabanlı) `Principal`iyle çağırır —
 * `dtcService.ts` ile aynı seviyede YENİ bir meşru çağıran, ikinci bir motor
 * DEĞİL.
 *
 * ── GRANT PERSISTENCE YOK ────────────────────────────────────────────────────
 * `_grants` yalnız modül belleğindedir. HU reboot/process restart → boş harita.
 * Kalıcılık YOK, çünkü spec bunu AÇIKÇA yasaklıyor (eski grant restore edilmez).
 *
 * ── FAIL CLOSED, TIMER YOK ───────────────────────────────────────────────────
 * Grantlar timer'la iptal EDİLMEZ. `getActiveGuestGrant()` her çağrıda CANLI
 * `PhoneAttachmentSnapshot`a karşı yeniden doğrular (Round-1 `getActiveVehicle()`
 * ile AYNI desen) — link koptuğu/oturum değiştiği an bir sonraki okuma otomatik
 * `null` döner, ayrı bir revoke-timer'ı GEREKMEZ.
 */

import {
  authorize, canExecute,
  type Principal, type SecurityDecisionEvidence,
} from '../security/authorization';
import { getPhoneAttachmentSnapshot } from './phoneLinkAttachment';
import { isSessionLiveGivenSnapshot } from './phoneLinkSessionRegistry';

/**
 * Phone Link'in verebileceği yetenekler.
 *
 * ── YETENEKLER BİRBİRİNİ ÜRETMEZ (F5.15) ────────────────────────────────────
 * Her grant TEK bir yeteneğe bağlıdır ve sorgular yeteneğe göre FİLTRELENİR:
 * `MEDIA_CONTROL` grant'ı `INTERNET_SHARE` yetkisi VERMEZ, tersi de geçerlidir.
 * Bu, testlerle kilitlenmiş pazarlıksız bir sınırdır. `NAV_DESTINATION_PUSH`
 * (F8) da aynı kurala tabidir: `MEDIA_CONTROL` grant'ı — guest misafir
 * eşleşmesi bile olsa — ASLA navigasyon yetkisi AÇMAZ.
 */
export type PhoneLinkCapability = 'MEDIA_CONTROL' | 'INTERNET_SHARE' | 'NAV_DESTINATION_PUSH' | 'ASSISTANT_BRIDGE';

/** Bir oturumun taşınabilir kimliği — ÇİFT olarak taşınır, tekil DEĞİL. */
export interface PhoneLinkSessionRef {
  readonly deviceFingerprint: string;
  readonly sessionEpoch: number;
}

export interface PhoneLinkGrant {
  readonly grantId: string;
  readonly deviceFingerprint: string;
  readonly sessionEpoch: number;
  readonly capability: PhoneLinkCapability;
  readonly issuedAt: number;
  readonly expiresAt: number;
}

/**
 * Savunma derinliği üst sınırı — asıl geçerlilik CANLI oturum eşleşmesidir
 * (fingerprint + sessionEpoch + `ACTIVE`), bu yalnız unutulmuş/sızmış bir
 * kaydın sonsuza dek yaşamamasını garanti eder.
 */
const GRANT_TTL_MS = 4 * 60 * 60_000;

const _grants = new Map<string, PhoneLinkGrant>();

function randomGrantId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let hex = '';
  for (let i = 0; i < bytes.length; i += 1) hex += bytes[i].toString(16).padStart(2, '0');
  return `plg-${hex}`;
}

/** Artık canlı oturuma karşılık gelmeyen/expired kayıtları düşürür (bounded map). */
function pruneStale(now: number): void {
  const snap = getPhoneAttachmentSnapshot();
  for (const [id, g] of Array.from(_grants)) {
    const stillLive = isSessionLiveGivenSnapshot(g.deviceFingerprint, g.sessionEpoch, snap)
      && now < g.expiresAt;
    if (!stillLive) _grants.delete(id);
  }
}

/**
 * Guest için `MEDIA_CONTROL` grant'ı verir.
 *
 * FAIL CLOSED: attachment `ACTIVE` değilse (kriptografik oturum kurulmamışsa)
 * `null` döner — grant ASLA verilmez. İkinci bir "sürücü onayı" akışı YOKTUR
 * (ürün kararı): `ACTIVE` + eşleştirilmiş telefon zaten yeterli kanıttır.
 */
export function issueGuestMediaGrant(now: number = Date.now()): PhoneLinkGrant | null {
  return issueSessionGrant('MEDIA_CONTROL', now);
}

/**
 * PHONE LINK F5 — `INTERNET_SHARE` grant'ı.
 *
 * ── NEDEN `MEDIA_CONTROL`DAN DAHA SIKI ──────────────────────────────────────
 * `MEDIA_CONTROL` için `ACTIVE` oturum yeterlidir (misafir telefonu müziği
 * kontrol edebilsin diye — F1 ürün kararı). İnternet farklıdır: telefonun
 * MOBİL VERİSİNİ ve dolayısıyla PARASINI harcar ve trafiğinin kaynağı o
 * telefon olur. Bu yüzden yalnız kayıtlı GÜVENİLEN cihaz için verilir:
 * yeni eşleşmiş/geçici bir misafir telefon, bağlandı diye internetini
 * PAYLAŞMIŞ SAYILMAZ (fail-closed, F5.1 privacy/billing kaygısı).
 *
 * ⚠️ `deviceTrust` bir CİHAZ hükmüdür; KİŞİ kimliği DEĞİLDİR ve rol
 * ÜRETMEZ (bkz. `phoneLinkAttachment.ts` notu). F3.0 kuralı yerinde durur.
 *
 * ── GRANT ≠ FİZİKSEL AĞ (F5.3) ──────────────────────────────────────────────
 * Bu grant "internet var" DEMEZ; "bu oturumun internet yolu politika olarak
 * kullanılabilir" der. Fiziksel gerçek `PhoneInternetState`dedir.
 */
export function issuePhoneInternetGrant(now: number = Date.now()): PhoneLinkGrant | null {
  const snap = getPhoneAttachmentSnapshot();
  /* Eksik/bilinmeyen güven = güven YOK (mock'lanmış anlık görüntülerde de
     `undefined` fail-closed davranır). */
  if (snap.deviceTrust !== 'TRUSTED') return null;
  return issueSessionGrant('INTERNET_SHARE', now);
}

/**
 * PHONE LINK F8 — `NAV_DESTINATION_PUSH` grant'ı.
 *
 * ── NEDEN `MEDIA_CONTROL`DAN DAHA SIKI, `INTERNET_SHARE` İLE AYNI EŞİK ──────
 * Bir navigasyon hedefi göndermek aracın rotasını DEĞİŞTİRİR — bu, bir
 * misafirin müziği duraklatmasından farklı bir risk sınıfıdır. F1'in
 * `MEDIA_CONTROL`u için yeterli olan tek şart (`ACTIVE` oturum) burada
 * YETERSİZDİR; F5'in `INTERNET_SHARE` gerekçesiyle AYNI eşik uygulanır:
 * yalnız native `PhoneHubTrustStore`ta KAYITLI GÜVENİLEN cihaz.
 *
 * ── "PRIMARY" DEĞİL, "TRUSTED DEVICE" (F8 §19 ölçümü) ───────────────────────
 * Repo denetimi: `phoneLinkRole.ts`teki `PRIMARY` rolü bugün YAPISAL OLARAK
 * ulaşılamaz (`hasCanonicalDevicePersonBinding` her zaman `false` döner —
 * kanonik cihaz↔kişi bağı henüz yok). `PRIMARY` şartı koşmak bu yeteneği
 * SÜREKLİ `UNAVAILABLE` yapardı; bu F8'in görevi değildir (yeni bir
 * person/device-binding otoritesi İCAT ETMEK yasak). Bunun yerine GERÇEKTEN
 * var olan ve ölçülebilen `deviceTrust === 'TRUSTED'` kanıtı kullanılır —
 * `INTERNET_SHARE` ile birebir aynı, zaten kanıtlanmış eşik.
 *
 * ── GRANT ≠ ROTA (F8 §11 ile aynı ayrım) ────────────────────────────────────
 * Bu grant yalnız "bu oturum bir hedef GÖNDEREBİLİR" der; hedefi KABUL ETMEK
 * ve rotayı BAŞLATMAK `destinationHandoff`un (kanonik, tek) işidir.
 */
export function issueNavDestinationGrant(now: number = Date.now()): PhoneLinkGrant | null {
  const snap = getPhoneAttachmentSnapshot();
  if (snap.deviceTrust !== 'TRUSTED') return null;
  return issueSessionGrant('NAV_DESTINATION_PUSH', now);
}

/**
 * PHONE LINK F9 — `ASSISTANT_BRIDGE` grant'ı.
 *
 * ── AYNI EŞİK, AYNI GEREKÇE ──────────────────────────────────────────────
 * `NAV_DESTINATION_PUSH`/`INTERNET_SHARE` ile AYNI: yalnız native
 * `PhoneHubTrustStore`ta kayıtlı GÜVENİLEN cihaz. Mavi'ye metin ulaştırmak
 * `MEDIA_CONTROL`dan daha hassastır (kişisel/araç bağlamlı bir sohbet
 * kanalı açar) — `ACTIVE` oturum tek başına YETERSİZDİR.
 *
 * ⚠️ Bu grant Mavi'ye KOMUT/EYLEM yürütme yetkisi VERMEZ (bkz.
 * `authorization.ts` `ASSISTANT_BRIDGE` notu) — yalnız bilgi/sohbet isteği
 * iletme yetkisidir. `PRIMARY` şartı KOŞULMADI (F8/F8.1 ile AYNI gerekçe:
 * yapısal olarak ulaşılamaz, uydurma OTORİTE değil).
 */
export function issueAssistantBridgeGrant(now: number = Date.now()): PhoneLinkGrant | null {
  const snap = getPhoneAttachmentSnapshot();
  if (snap.deviceTrust !== 'TRUSTED') return null;
  return issueSessionGrant('ASSISTANT_BRIDGE', now);
}

/** Ortak üretici — yetenek başına TEK grant, oturum bağlı. */
function issueSessionGrant(
  capability: PhoneLinkCapability, now: number,
): PhoneLinkGrant | null {
  const snap = getPhoneAttachmentSnapshot();
  if (snap.state !== 'ACTIVE' || snap.sessionEpoch === null || !snap.deviceFingerprint) {
    return null;
  }
  pruneStale(now);
  const existing = getActiveGrantFor(capability, now);
  if (existing) return existing; // aynı oturum+yetenek için ikinci grant ÇOĞALTILMAZ

  const grant: PhoneLinkGrant = Object.freeze({
    grantId: randomGrantId(),
    deviceFingerprint: snap.deviceFingerprint,
    sessionEpoch: snap.sessionEpoch,
    capability,
    issuedAt: now,
    expiresAt: now + GRANT_TTL_MS,
  });
  _grants.set(grant.grantId, grant);
  return grant;
}

/**
 * Hâlâ geçerli grant'ı döner — CANLI attachment'a karşı HER ÇAĞRIDA yeniden
 * doğrulanır (bkz. dosya üstü not). Persist edilmiş/eski bir kayıt DEĞİLDİR.
 */
export function getActiveGuestGrant(
  now: number = Date.now(), session: PhoneLinkSessionRef | null = null,
): PhoneLinkGrant | null {
  return getActiveGrantFor('MEDIA_CONTROL', now, session);
}

/**
 * Yeteneğe GÖRE filtreleyen kanonik arama. `capability` eşleşmesi
 * PAZARLIKSIZDIR — bir yeteneğin grant'ı asla başka bir yeteneği açmaz.
 */
export function getActiveGrantFor(
  capability: PhoneLinkCapability,
  now: number = Date.now(),
  session: PhoneLinkSessionRef | null = null,
): PhoneLinkGrant | null {
  const snap = getPhoneAttachmentSnapshot();
  /* Hangi oturum soruyor? Açıkça verilmediyse F1 davranışı: canlı anlık
     görüntünün oturumu. Çok-cihazda çağıran KENDİ oturumunu verir — böylece
     A'nın grant'ı B'nin isteğinde ASLA bulunamaz (F4.10). */
  const fingerprint = session?.deviceFingerprint ?? snap.deviceFingerprint;
  const epoch = session?.sessionEpoch ?? snap.sessionEpoch;
  if (!isSessionLiveGivenSnapshot(fingerprint, epoch, snap)) return null;

  for (const grant of _grants.values()) {
    if (
      grant.capability === capability
      && epoch === grant.sessionEpoch
      && fingerprint === grant.deviceFingerprint
      && now < grant.expiresAt
    ) {
      return grant;
    }
  }
  return null;
}

/**
 * YALNIZ bu oturuma ait grantları düşürür (F4.10). Bir telefonun kopması
 * diğerinin yeteneğini ELİNDEN ALMAZ.
 */
export function revokeGuestGrantsFor(
  deviceFingerprint: string | null, sessionEpoch: number,
): number {
  let removed = 0;
  for (const [id, g] of Array.from(_grants)) {
    const matches = g.sessionEpoch === sessionEpoch
      && (deviceFingerprint === null || g.deviceFingerprint === deviceFingerprint);
    if (matches) {
      _grants.delete(id);
      removed += 1;
    }
  }
  return removed;
}

/** Açık iptal — tüm grantlar (ör. kullanıcı "Bağlantıyı Kes" derse). */
export function revokeAllGuestGrants(): void {
  _grants.clear();
}

export function revokeGuestGrant(grantId: string): void {
  _grants.delete(grantId);
}

/* ══════════════════════════════════════════════════════════════════════════
 * Kanonik yetkilendirme köprüsü — TEK karar motoruna (`authorize`) çağrı.
 * ════════════════════════════════════════════════════════════════════════ */

function buildPrincipal(grant: PhoneLinkGrant | null, sessionEpoch: number | null): Principal {
  return Object.freeze({
    principalType: 'PHONE_DEVICE',
    /* Opak referans — ham fingerprint/MAC/isim TAŞINMAZ. */
    principalIdRef: grant ? `phone_link_guest:${grant.grantId}` : 'phone_link_guest:no_grant',
    deviceIdentityRef: null,
    personIdentityRef: null,
    vehicleRef: null,
    sessionRef: grant ? `phone_link_session:${grant.sessionEpoch}` : null,
    generation: sessionEpoch,
    authenticationState: grant ? 'AUTHENTICATED' : 'NOT_AUTHENTICATED',
    provenance: 'LIVE',
  });
}

/**
 * `MEDIA_CONTROL` komutu için kanonik karar. Karar TAMAMEN `authorize()`e
 * aittir — burada hiçbir ALLOW/DENY mantığı YOKTUR, yalnız girdi inşa edilir.
 */
export function authorizeGuestMediaCommand(
  operationId: string, now: number = Date.now(),
  session: PhoneLinkSessionRef | null = null,
): SecurityDecisionEvidence {
  const snap = getPhoneAttachmentSnapshot();
  const grant = getActiveGuestGrant(now, session);
  const principal = buildPrincipal(grant, grant?.sessionEpoch ?? snap.sessionEpoch);
  return authorize({
    principal,
    capability: 'MEDIA_CONTROL',
    targetRef: null,
    vehicleRef: null,
    /* Bağlılık BU oturumun canlılığıdır — "herhangi bir oturum var mı" DEĞİL. */
    attached: grant !== null
      && isSessionLiveGivenSnapshot(grant.deviceFingerprint, grant.sessionEpoch, snap),
    currentGeneration: grant?.sessionEpoch ?? snap.sessionEpoch,
    /* Sabit literal — bu fonksiyon YALNIZ `MEDIA_CONTROL` sorar
       (`getActiveGuestGrant` zaten o yeteneğe filtrelidir); `grant.capability`nin
       geniş `PhoneLinkCapability` tipini kanonik `Capability`ye daraltmaya
       GEREK YOK (§F5.15: yetenekler birbirini üretmez). */
    grantedCapabilities: grant ? ['MEDIA_CONTROL'] : [],
    /* MEDIA_CONTROL politikası `parkedOnly:false` — hareket kararı ETKİLEMEZ. */
    motion: 'UNKNOWN',
    /* MEDIA_CONTROL politikası `requiresNativePermission:false` — ETKİLEMEZ. */
    nativePermission: null,
    available: true,
    operationId,
  }, now);
}

/**
 * TOCTOU KAPISI — yürütmeden HEMEN ÖNCE çağrılır. `authorizeGuestMediaCommand`
 * ile yürütme arasında link koptuysa/oturum ilerlediyse/grant iptal edildiyse
 * kararın hâlâ AYNI dünyaya ait olduğunu doğrular; yeniden karar ÜRETMEZ.
 */
export function canExecuteGuestMediaCommand(
  evidence: SecurityDecisionEvidence, now: number = Date.now(),
  session: PhoneLinkSessionRef | null = null,
): boolean {
  const snap = getPhoneAttachmentSnapshot();
  const grant = getActiveGuestGrant(now, session);
  const principalNow = buildPrincipal(grant, grant?.sessionEpoch ?? snap.sessionEpoch);
  if (!canExecute(evidence, {
    principal: principalNow,
    vehicleRef: null,
    currentGeneration: grant?.sessionEpoch ?? snap.sessionEpoch,
  })) return false;
  // Kanonik kontrolün kapsamadığı iptal tetikleyicisi: grant BİZZAT geri alındı.
  return grant !== null;
}

/**
 * PHONE LINK F5 — `INTERNET_SHARE` için kanonik karar.
 *
 * `authorizeGuestMediaCommand` ile AYNI motoru (`authorize()`) kullanır; tek
 * fark istenen yetenektir. Burada hiçbir ALLOW/DENY mantığı YOKTUR.
 *
 * `MEDIA_CONTROL` grant'ı bu çağrıda `grantedCapabilities`e GİRMEZ — arama
 * yeteneğe göre filtrelidir, bu yüzden yeteneklerin birbirini açması YAPISAL
 * OLARAK imkânsızdır.
 */
export function authorizePhoneInternetShare(
  operationId: string, now: number = Date.now(),
  session: PhoneLinkSessionRef | null = null,
): SecurityDecisionEvidence {
  const snap = getPhoneAttachmentSnapshot();
  const grant = getActiveGrantFor('INTERNET_SHARE', now, session);
  const principal = buildPrincipal(grant, grant?.sessionEpoch ?? snap.sessionEpoch);
  return authorize({
    principal,
    capability: 'INTERNET_SHARE',
    targetRef: null,
    vehicleRef: null,
    attached: grant !== null
      && isSessionLiveGivenSnapshot(grant.deviceFingerprint, grant.sessionEpoch, snap),
    currentGeneration: grant?.sessionEpoch ?? snap.sessionEpoch,
    /* Sabit literal — bu fonksiyon YALNIZ `INTERNET_SHARE` sorar. */
    grantedCapabilities: grant ? ['INTERNET_SHARE'] : [],
    /* INTERNET_SHARE politikası `parkedOnly:false` — hareket ETKİLEMEZ. */
    motion: 'UNKNOWN',
    /* `requiresNativePermission:false` — fiziksel ağ bir DURUM, yetki değil. */
    nativePermission: null,
    available: true,
    operationId,
  }, now);
}

/**
 * PHONE LINK F8 — `NAV_DESTINATION_PUSH` için kanonik karar.
 *
 * `authorizeGuestMediaCommand`/`authorizePhoneInternetShare` ile AYNI motoru
 * (`authorize()`) kullanır. Kanonik `Capability` enum'unda "NAV_DESTINATION_PUSH"
 * DİYE BİR GİRİŞ YOKTUR (repo denetimi) — icat ETMEK yerine, deponun ZATEN
 * sahip olduğu `NAVIGATION_CONTROL` yeteneği çağrılır (`authorization.ts`).
 * Phone Link katmanındaki ayrık isim (`NAV_DESTINATION_PUSH`) yalnız BU
 * modülün grant defterinde ("telefon TAM OLARAK ne için yetkilendirildi")
 * anlamlıdır; nihai ALLOW/DENY kararı her zamanki gibi TEK motorundur.
 */
export function authorizeNavDestinationPush(
  operationId: string, now: number = Date.now(),
  session: PhoneLinkSessionRef | null = null,
): SecurityDecisionEvidence {
  const snap = getPhoneAttachmentSnapshot();
  const grant = getActiveGrantFor('NAV_DESTINATION_PUSH', now, session);
  const principal = buildPrincipal(grant, grant?.sessionEpoch ?? snap.sessionEpoch);
  return authorize({
    principal,
    capability: 'NAVIGATION_CONTROL',
    targetRef: null,
    vehicleRef: null,
    attached: grant !== null
      && isSessionLiveGivenSnapshot(grant.deviceFingerprint, grant.sessionEpoch, snap),
    currentGeneration: grant?.sessionEpoch ?? snap.sessionEpoch,
    grantedCapabilities: grant ? ['NAVIGATION_CONTROL'] : [],
    /* `NAVIGATION_CONTROL` politikası `parkedOnly:false` — hareket kararı
       ETKİLEMEZ; Phone Link kendi sürüş-durumu otoritesini KURMAZ (§13). */
    motion: 'UNKNOWN',
    /* `requiresNativePermission:false` — koordinat teslimi bir OS izni değil. */
    nativePermission: null,
    available: true,
    operationId,
  }, now);
}

/** TOCTOU KAPISI — `canExecuteGuestMediaCommand` ile AYNI desen. */
export function canExecuteNavDestinationPush(
  evidence: SecurityDecisionEvidence, now: number = Date.now(),
  session: PhoneLinkSessionRef | null = null,
): boolean {
  const snap = getPhoneAttachmentSnapshot();
  const grant = getActiveGrantFor('NAV_DESTINATION_PUSH', now, session);
  const principalNow = buildPrincipal(grant, grant?.sessionEpoch ?? snap.sessionEpoch);
  if (!canExecute(evidence, {
    principal: principalNow,
    vehicleRef: null,
    currentGeneration: grant?.sessionEpoch ?? snap.sessionEpoch,
  })) return false;
  return grant !== null;
}

/** Yan etkiden HEMEN ÖNCEki son canlılık okuması — `isGuestMediaDispatchStillLive` ile AYNI desen. */
export function isNavDestinationDispatchStillLive(
  now: number = Date.now(), session: PhoneLinkSessionRef | null = null,
): boolean {
  const snap = getPhoneAttachmentSnapshot();
  const grant = getActiveGrantFor('NAV_DESTINATION_PUSH', now, session);
  return grant !== null
    && isSessionLiveGivenSnapshot(grant.deviceFingerprint, grant.sessionEpoch, snap);
}

/**
 * PHONE LINK F9 — `ASSISTANT_BRIDGE` için kanonik karar.
 *
 * `authorizeNavDestinationPush`/`authorizeGuestMediaCommand` ile AYNI motoru
 * kullanır. Kanonik `Capability` enum'unda `ASSISTANT_BRIDGE` BU turda
 * eklendi (`authorization.ts`) — NAVIGATION_CONTROL'ün aksine önceden var
 * olan bir girişe binmedi, genuine minimal genişletmedir (§4).
 */
export function authorizeAssistantBridge(
  operationId: string, now: number = Date.now(),
  session: PhoneLinkSessionRef | null = null,
): SecurityDecisionEvidence {
  const snap = getPhoneAttachmentSnapshot();
  const grant = getActiveGrantFor('ASSISTANT_BRIDGE', now, session);
  const principal = buildPrincipal(grant, grant?.sessionEpoch ?? snap.sessionEpoch);
  return authorize({
    principal,
    capability: 'ASSISTANT_BRIDGE',
    targetRef: null,
    vehicleRef: null,
    attached: grant !== null
      && isSessionLiveGivenSnapshot(grant.deviceFingerprint, grant.sessionEpoch, snap),
    currentGeneration: grant?.sessionEpoch ?? snap.sessionEpoch,
    grantedCapabilities: grant ? ['ASSISTANT_BRIDGE'] : [],
    /* `parkedOnly:false` — bilgi/sohbet isteği hareket kararını ETKİLEMEZ. */
    motion: 'UNKNOWN',
    nativePermission: null,
    available: true,
    operationId,
  }, now);
}

/** TOCTOU KAPISI — `canExecuteNavDestinationPush` ile AYNI desen. */
export function canExecuteAssistantBridge(
  evidence: SecurityDecisionEvidence, now: number = Date.now(),
  session: PhoneLinkSessionRef | null = null,
): boolean {
  const snap = getPhoneAttachmentSnapshot();
  const grant = getActiveGrantFor('ASSISTANT_BRIDGE', now, session);
  const principalNow = buildPrincipal(grant, grant?.sessionEpoch ?? snap.sessionEpoch);
  if (!canExecute(evidence, {
    principal: principalNow,
    vehicleRef: null,
    currentGeneration: grant?.sessionEpoch ?? snap.sessionEpoch,
  })) return false;
  return grant !== null;
}

/** Yan etkiden HEMEN ÖNCEki son canlılık okuması — sonuç GÖNDERİLMEDEN ÖNCE de tekrar çağrılır (§13). */
export function isAssistantBridgeDispatchStillLive(
  now: number = Date.now(), session: PhoneLinkSessionRef | null = null,
): boolean {
  const snap = getPhoneAttachmentSnapshot();
  const grant = getActiveGrantFor('ASSISTANT_BRIDGE', now, session);
  return grant !== null
    && isSessionLiveGivenSnapshot(grant.deviceFingerprint, grant.sessionEpoch, snap);
}

/**
 * F4.7 Race B — YAN ETKİ SINIRI kapısı.
 *
 * ── ÖLÇÜM (uydurma değil) ───────────────────────────────────────────────────
 * `authorize()` → `canExecute()` → gateway çağrısı dizisi JavaScript'te TEK
 * senkron blokta çalışır; ilk `await` gateway'in İÇİNDEDİR. Bu yüzden bugün
 * araya bir kopuş olayı GİREMEZ — TOCTOU boşluğu yapısal olarak sıfırdır.
 *
 * Bu kapı yine de eklendi çünkü o garanti çağrı sırasının bir YAN ÜRÜNÜDÜR,
 * sözleşmesi değil: araya bir `await` ekleyen gelecekteki bir değişiklik
 * boşluğu sessizce açardı. Kapı, yan etkiden HEMEN ÖNCEki son okumadır —
 * kilit/transaction sistemi DEĞİLDİR, tek bir senkron doğrulamadır.
 */
export function isGuestMediaDispatchStillLive(
  now: number = Date.now(), session: PhoneLinkSessionRef | null = null,
): boolean {
  const snap = getPhoneAttachmentSnapshot();
  const grant = getActiveGuestGrant(now, session);
  return grant !== null
    && isSessionLiveGivenSnapshot(grant.deviceFingerprint, grant.sessionEpoch, snap);
}

/** LAB salt-okunur — KAÇ grant kayıtlı. grantId/parmak izi TAŞIMAZ. */
export function recordedGrantCount(): number {
  return _grants.size;
}

/** @internal — yalnız testler. */
export function _resetPhoneLinkGrantsForTest(): void {
  _grants.clear();
}
