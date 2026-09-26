/**
 * phoneLinkGuestSession.ts — PHONE LINK F1 · QR portal için geçici Guest Session.
 *
 * ── İKİNCİ BİR KİMLİK SİSTEMİ DEĞİL ──────────────────────────────────────────
 * Bu oturum Phone Link session'ından TÜRETİLİR (`deviceFingerprint` +
 * `sessionEpoch`e bağlanır); kendi başına bir kimlik doğrulaması İCAT ETMEZ.
 * `phoneLinkCapabilityGrant.ts`deki grant ile AYNI canlı-doğrulama desenini
 * kullanır: hiçbir alan timer'la iptal EDİLMEZ, her okuma canlı attachment'a
 * karşı YENİDEN doğrulanır.
 *
 * ── GİZLİLİK ─────────────────────────────────────────────────────────────────
 * `token` KRİPTOGRAFİK OLARAK GÜÇLÜ, TEK KULLANIMLIK bootstrap kimlik bilgisidir
 * — LOG'A YAZILMAZ. `sessionId` ayrı, taşınabilir (loglanabilir) bir referanstır
 * ve token'dan asla türetilerek geri hesaplanamaz (bağımsız rastgele üretilir).
 *
 * ── F3.3 · İKİ AŞAMALI KİMLİK BİLGİSİ (bootstrap → exchange → portal) ────────
 * QR'ın taşıdığı `token` TEK KULLANIMLIK BOOTSTRAP'tır: portal ona karşılık
 * BİR KEZ `exchangeGuestBootstrapToken()` ile kısa ömürlü bir PORTAL TOKEN'ı
 * alır. Böylece QR ekran görüntüsü başka telefonda açılsa bile, ilk tarayan
 * bootstrap'ı TÜKETTİĞİ için ikinci deneme REDDEDİLİR.
 *
 * İKİ AYRI OTORİTE DEĞİLDİR: her iki token da AYNI `PhoneLinkGuestSession`
 * kaydına işaret eder; canlılık (`sessionEpoch` + `deviceFingerprint` + `ACTIVE`)
 * TEK yerde, `validateGuestSessionToken()` içinde doğrulanır.
 *
 * ── ÖMÜR ─────────────────────────────────────────────────────────────────────
 * Yalnız bellekte tutulur; process restart sonrası restore EDİLMEZ. Kısa
 * ömürlüdür (varsayılan 15 dk). Link koptuğunda / sessionEpoch ilerlediğinde
 * bir sonraki doğrulama otomatik reddeder — ayrı bir "disconnect dinleyicisi"
 * KURULMAZ.
 */

import { getPhoneAttachmentSnapshot } from './phoneLinkAttachment';
import { isSessionLiveGivenSnapshot } from './phoneLinkSessionRegistry';

export interface PhoneLinkGuestSession {
  /** Taşınabilir/loglanabilir referans — SIR DEĞİLDİR. */
  readonly sessionId: string;
  /** Tek kullanımlık bootstrap kimlik bilgisi — ASLA loglanmaz/UI'da gösterilmez. */
  readonly token: string;
  readonly sessionEpoch: number;
  readonly deviceFingerprint: string;
  readonly issuedAt: number;
  readonly expiresAt: number;
}

/** Kısa ömür — QR portal oturumu için (spec: "kısa ömürlüdür"). */
const GUEST_SESSION_TTL_MS = 15 * 60_000;

/** bootstrap token → session. Yalnız bellekte; kalıcılık YOK. */
const _sessions = new Map<string, PhoneLinkGuestSession>();

/**
 * Tüketilmiş bootstrap token'ları (F3.3 tek-kullanımlık kuralı).
 *
 * ⚠️ Tüketilmiş bootstrap oturumu SONLANDIRMAZ — yalnız o token'ın İKİNCİ
 * kez değiştirilmesini engeller. Oturum, portal token'ıyla yaşamaya devam
 * eder; aksi hâlde portal açılır açılmaz kendi altındaki oturumu kapatırdı.
 */
const _consumedBootstraps = new Set<string>();

/** portal token → bootstrap token (aynı kaydın ikinci anahtarı — KOMUT yetkisi). */
const _portalTokens = new Map<string, string>();

/**
 * akış anahtarı → bootstrap token (aynı kaydın ÜÇÜNCÜ anahtarı — SALT OKUNUR).
 *
 * `EventSource` özel başlık GÖNDEREMEZ, bu yüzden SSE kimlik bilgisi URL'de
 * taşınmak ZORUNDADIR. Komut yetkisi olan portal token'ını URL'e koymak yerine
 * AYRI, YALNIZ-OKUMA yetkili bir anahtar üretilir: sızsa bile komut VEREMEZ ve
 * oturumla birlikte ölür.
 */
const _streamTokens = new Map<string, string>();

function randomB64Url(byteLength: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
  let bin = '';
  for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Bir oturumun TÜM anahtarlarını düşürür — yetim portal token bırakılmaz. */
function forgetSession(bootstrapToken: string): void {
  _sessions.delete(bootstrapToken);
  _consumedBootstraps.delete(bootstrapToken);
  for (const [portalToken, owner] of _portalTokens) {
    if (owner === bootstrapToken) _portalTokens.delete(portalToken);
  }
  for (const [streamToken, owner] of _streamTokens) {
    if (owner === bootstrapToken) _streamTokens.delete(streamToken);
  }
}

function pruneExpired(now: number): void {
  for (const [token, s] of _sessions) {
    if (now >= s.expiresAt) forgetSession(token);
  }
}

/**
 * Yeni guest session açar. FAIL CLOSED: attachment `ACTIVE` değilse `null`.
 *
 * Aynı Phone Link oturumu (aynı `sessionEpoch`+`deviceFingerprint`) için
 * önceki token'lar İPTAL edilir — "yeni bağlantıda eski token yeniden
 * kullanılamaz" kuralı BURADA da (epoch değişmese bile, QR yeniden
 * üretildiğinde) garanti edilir.
 */
export function createGuestSession(now: number = Date.now()): PhoneLinkGuestSession | null {
  const snap = getPhoneAttachmentSnapshot();
  if (snap.state !== 'ACTIVE' || snap.sessionEpoch === null || !snap.deviceFingerprint) {
    return null;
  }
  pruneExpired(now);
  for (const [token, s] of Array.from(_sessions)) {
    if (s.sessionEpoch === snap.sessionEpoch && s.deviceFingerprint === snap.deviceFingerprint) {
      forgetSession(token);
    }
  }

  const session: PhoneLinkGuestSession = Object.freeze({
    sessionId: `pls-${randomB64Url(9)}`,
    token: randomB64Url(32),
    sessionEpoch: snap.sessionEpoch,
    deviceFingerprint: snap.deviceFingerprint,
    issuedAt: now,
    expiresAt: now + GUEST_SESSION_TTL_MS,
  });
  _sessions.set(session.token, session);
  return session;
}

/**
 * Token hâlâ geçerli mi. FAIL CLOSED + CANLI doğrulama: süresi dolduysa VEYA
 * Phone Link artık `ACTIVE` değilse VEYA farklı bir oturuma/cihaza aitse
 * `false` — kayıt aynı anda temizlenir (yetim token bırakılmaz).
 */
export function validateGuestSessionToken(token: string, now: number = Date.now()): boolean {
  const session = _sessions.get(token);
  if (!session) return false;
  if (now >= session.expiresAt) {
    forgetSession(token);
    return false;
  }
  /* F4.8 — canlılık artık "şu anki TEK oturum" ile değil, BU oturumun
     (fingerprint + epoch) kendi canlılığıyla ölçülür. Tek-cihaz varsayımı
     kaldırıldı; olay gelmemişse F1 davranışı aynen korunur. */
  const stillLive = isSessionLiveGivenSnapshot(
    session.deviceFingerprint, session.sessionEpoch, getPhoneAttachmentSnapshot());
  if (!stillLive) {
    forgetSession(token);
    return false;
  }
  return true;
}

/** Token → session (yalnız geçerliyse). UI/portal `sessionId`i BUNDAN okur. */
export function getGuestSession(token: string, now: number = Date.now()): PhoneLinkGuestSession | null {
  return validateGuestSessionToken(token, now) ? (_sessions.get(token) ?? null) : null;
}

export function revokeGuestSession(token: string): void {
  forgetSession(token);
}

/**
 * YALNIZ bu oturuma (fingerprint + epoch) ait guest session'ları düşürür.
 *
 * F4.10: bir telefonun kopması DİĞER telefonun oturumunu ETKİLEMEZ. Tek bir
 * cihaz koptuğunda `revokeAllGuestSessions()` ÇAĞRILMAZ — o yalnız gerçekten
 * global olaylar içindir.
 */
export function revokeGuestSessionsFor(
  deviceFingerprint: string | null, sessionEpoch: number,
): number {
  let removed = 0;
  for (const [token, s] of Array.from(_sessions)) {
    const matches = s.sessionEpoch === sessionEpoch
      && (deviceFingerprint === null || s.deviceFingerprint === deviceFingerprint);
    if (matches) {
      forgetSession(token);
      removed += 1;
    }
  }
  return removed;
}

/**
 * GERÇEKTEN global iptal — process/alt sistem kapanışı veya açık güvenlik
 * sıfırlaması. Tek cihazın kopmasında KULLANILMAZ (bkz. `revokeGuestSessionsFor`).
 */
export function revokeAllGuestSessions(): void {
  _sessions.clear();
  _consumedBootstraps.clear();
  _portalTokens.clear();
  _streamTokens.clear();
}

/* ══════════════════════════════════════════════════════════════════════════
 * F3.3 — bootstrap → portal token değişimi
 * ════════════════════════════════════════════════════════════════════════ */

export interface PhoneLinkPortalCredential {
  /** Loglanabilir referans. */
  readonly sessionId: string;
  /** Kısa ömürlü portal kimlik bilgisi (KOMUT yetkisi) — ASLA loglanmaz. */
  readonly portalToken: string;
  /** Salt-okunur SSE akış anahtarı — komut VEREMEZ. */
  readonly streamToken: string;
  /** Bu kimlik bilgisinin BAĞLI olduğu oturum — çapraz cihaz kullanımını keser. */
  readonly deviceFingerprint: string;
  readonly sessionEpoch: number;
  readonly expiresAt: number;
}

export type PhoneLinkBootstrapRejection =
  | 'UNKNOWN_TOKEN'      // hiç var olmadı / iptal edildi / süresi doldu / oturum koptu
  | 'ALREADY_CONSUMED';  // tek-kullanımlık kural ihlali (QR ekran görüntüsü yeniden kullanıldı)

export type PhoneLinkBootstrapExchange =
  | { readonly ok: true; readonly credential: PhoneLinkPortalCredential }
  | { readonly ok: false; readonly reason: PhoneLinkBootstrapRejection };

/**
 * Tek kullanımlık bootstrap'ı kısa ömürlü portal token'ıyla DEĞİŞTİRİR.
 *
 * FAIL CLOSED: token bilinmiyorsa, süresi dolduysa, oturum artık `ACTIVE`
 * değilse veya `sessionEpoch`/`deviceFingerprint` değiştiyse
 * `validateGuestSessionToken()` zaten `false` döner — burada ikinci bir
 * canlılık kuralı YAZILMAZ.
 */
export function exchangeGuestBootstrapToken(
  bootstrapToken: string, now: number = Date.now(),
): PhoneLinkBootstrapExchange {
  if (!validateGuestSessionToken(bootstrapToken, now)) {
    return { ok: false, reason: 'UNKNOWN_TOKEN' };
  }
  if (_consumedBootstraps.has(bootstrapToken)) {
    return { ok: false, reason: 'ALREADY_CONSUMED' };
  }
  const session = _sessions.get(bootstrapToken);
  if (!session) return { ok: false, reason: 'UNKNOWN_TOKEN' };

  _consumedBootstraps.add(bootstrapToken);
  const portalToken = randomB64Url(32);
  const streamToken = randomB64Url(24);
  _portalTokens.set(portalToken, bootstrapToken);
  _streamTokens.set(streamToken, bootstrapToken);
  return {
    ok: true,
    credential: Object.freeze({
      sessionId: session.sessionId,
      portalToken,
      streamToken,
      deviceFingerprint: session.deviceFingerprint,
      sessionEpoch: session.sessionEpoch,
      expiresAt: session.expiresAt,
    }),
  };
}

/**
 * Portal token → oturum (yalnız CANLI ise). Her HTTP isteğinde çağrılır;
 * canlılık `validateGuestSessionToken()` ile AYNI kapıdan geçer — link
 * koptuğu an bir sonraki istek reddedilir, ayrı bir revoke-timer'ı YOKTUR.
 */
export function validatePortalToken(
  portalToken: string, now: number = Date.now(),
): PhoneLinkGuestSession | null {
  const bootstrapToken = _portalTokens.get(portalToken);
  if (bootstrapToken === undefined) return null;
  if (!validateGuestSessionToken(bootstrapToken, now)) {
    /* `validateGuestSessionToken` zaten `forgetSession()` çağırdı — portal
     * token haritası da temizlendi. */
    _portalTokens.delete(portalToken);
    return null;
  }
  return _sessions.get(bootstrapToken) ?? null;
}

/**
 * Akış anahtarı → oturum (yalnız CANLI ise). SALT OKUNUR yetkidir: çağıran
 * bununla ASLA komut yürütmez (`phoneLinkPortalHttp.ts` bunu yapısal olarak
 * ayırır — akış anahtarı yalnız `/events` yolunda kabul edilir).
 */
export function validateStreamToken(
  streamToken: string, now: number = Date.now(),
): PhoneLinkGuestSession | null {
  const bootstrapToken = _streamTokens.get(streamToken);
  if (bootstrapToken === undefined) return null;
  if (!validateGuestSessionToken(bootstrapToken, now)) {
    _streamTokens.delete(streamToken);
    return null;
  }
  return _sessions.get(bootstrapToken) ?? null;
}

/** Portal lifecycle kararı için: geçerli EN AZ bir guest session var mı. */
export function hasActiveGuestSession(now: number = Date.now()): boolean {
  pruneExpired(now);
  for (const token of Array.from(_sessions.keys())) {
    if (validateGuestSessionToken(token, now)) return true;
  }
  return false;
}

/** LAB salt-okunur — KAÇ geçerli guest session var. Token/parmak izi TAŞIMAZ. */
export function activeGuestSessionCount(now: number = Date.now()): number {
  pruneExpired(now);
  let n = 0;
  for (const token of Array.from(_sessions.keys())) {
    if (validateGuestSessionToken(token, now)) n += 1;
  }
  return n;
}

/** @internal — yalnız testler. */
export function _resetPhoneLinkGuestSessionsForTest(): void {
  _sessions.clear();
  _consumedBootstraps.clear();
  _portalTokens.clear();
  _streamTokens.clear();
}
