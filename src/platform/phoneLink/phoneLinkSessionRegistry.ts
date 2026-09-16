/**
 * phoneLinkSessionRegistry.ts — PHONE LINK F4.8/F4.9 · çalışma zamanı oturum indeksi.
 *
 * ── YENİ KİMLİK/OTURUM OTORİTESİ DEĞİL ──────────────────────────────────────
 * Burada hiçbir oturum ÜRETİLMEZ, hiçbir kimlik DOĞRULANMAZ ve hiçbir nesil
 * ATANMAZ. Tek kaynak native `PhoneHubLinkController`dır; bu modül onun
 * gerçeğinin SALT-OKUNUR bir indeksidir. Kayıtlara giren TEK yol F4.1'in
 * kanonik lifecycle olayıdır — çift besleme YOKTUR, bu yüzden "hangi taşıma
 * kazandı" diye bir soru da yoktur.
 *
 * ── NEDEN VAR: TEK-CİHAZ VARSAYIMINI KALDIRMAK (F4.8) ───────────────────────
 * F1–F3'te canlılık "şu anki TEK anlık görüntü" ile karşılaştırılıyordu; bu,
 * `currentGuest`/`currentSession` tarzı örtük bir tek-cihaz varsayımıdır. Bu
 * indeks canlılığı `deviceFingerprint + sessionEpoch` ÇİFTİNE bağlar, böylece
 * "A koptu, B ayakta" ifade edilebilir hâle gelir.
 *
 * ── NATIVE BUGÜN TEK OTURUMLUDUR (ölçüldü, uydurulmadı) ─────────────────────
 * `PhoneHubLinkController` oturumu tek bir `AtomicReference<LinkSession>`de
 * tutar ve `RfcommServerTransport` ikinci istemciyi nazikçe kapatır. Yani
 * BUGÜN bu indekste en fazla 1 canlı kayıt olur. Bu bir eksiklik değil, ölçülen
 * gerçektir; model N oturuma hazırdır ama "N telefon destekliyoruz" İDDİASI
 * YOKTUR.
 *
 * ── OLAY MODU BİR KEZ AÇILIR, GERİ DÖNMEZ (fail-closed) ─────────────────────
 * İlk kanonik lifecycle olayı geldiği an indeks TEK canlılık otoritesi olur.
 * Bundan sonra BOŞ indeks "canlı oturum yok" demektir — bayat bir pull
 * anlık görüntüsü yetkiyi DİRİLTEMEZ. Olay hiç gelmediyse (tarayıcı modu,
 * F1–F3 testleri) eski pull davranışı aynen korunur.
 */

import type { PhoneAttachmentState } from './phoneLinkAttachment';
import type { PhoneLinkRole } from './phoneLinkRole';

/** Oturumun taşınabilir anahtarı — `fingerprint` + `epoch` ÇİFTİ. */
export type PhoneLinkSessionKey = string & { readonly __brand: 'PhoneLinkSessionKey' };

export interface PhoneLinkRuntimeSession {
  readonly deviceFingerprint: string;
  readonly sessionEpoch: number;
  readonly attachmentState: PhoneAttachmentState;
  readonly role: PhoneLinkRole;
}

/**
 * Bellek güvenliği tavanı — **ürün limiti DEĞİLDİR**. Hiçbir yerde "şu kadar
 * telefon destekleniyor" iddiası yoktur; bu yalnız sınırsız büyüyen bir
 * Map'in bellek sızıntısı olmasını engeller. Native bugün zaten tek oturumlu.
 */
const MAX_TRACKED_SESSIONS = 8;

const _sessions = new Map<PhoneLinkSessionKey, PhoneLinkRuntimeSession>();

/** İlk kanonik olay geldi mi — bkz. dosya üstü "olay modu" notu. */
let _eventModeEngaged = false;

/**
 * Anahtar üretimi. Parmak izi opaktır ve `:` içermez; yine de ayırıcı
 * çakışmasına karşı uzunluk öneki kullanılır — iki farklı çiftin AYNI
 * anahtarı üretmesi yapısal olarak imkânsızdır.
 */
export function sessionKey(deviceFingerprint: string, sessionEpoch: number): PhoneLinkSessionKey {
  return `${deviceFingerprint.length}:${deviceFingerprint}:${sessionEpoch}` as PhoneLinkSessionKey;
}

export function isPhoneLinkEventModeEngaged(): boolean {
  return _eventModeEngaged;
}

/** Bir sonraki olay bu indeksi tek otorite yapar (F4.3 ingestion çağırır). */
export function engagePhoneLinkEventMode(): void {
  _eventModeEngaged = true;
}

function trimToBound(): void {
  while (_sessions.size > MAX_TRACKED_SESSIONS) {
    const oldest = _sessions.keys().next();
    if (oldest.done) return;
    _sessions.delete(oldest.value);
  }
}

/** Kaydı ekler/günceller. Aynı çift için ikinci kayıt ÇOĞALMAZ. */
export function upsertRuntimeSession(session: PhoneLinkRuntimeSession): void {
  _sessions.set(sessionKey(session.deviceFingerprint, session.sessionEpoch), session);
  trimToBound();
}

/**
 * Tek bir oturumu düşürür. Deterministik: yalnız eşleşen kayıt etkilenir.
 *
 * `deviceFingerprint === null` ise eşleşme YALNIZ nesle göre yapılır — nesil
 * her bağlantı için benzersizdir (`generationSource.incrementAndGet()`), bu
 * yüzden bu daraltma değil, aynı oturumun DİĞER adıdır. Kopuş olayı bazen
 * parmak izi taşıyamaz (oturum çoktan söküldü); o durumda nesil tek
 * güvenilir kimliktir.
 */
export function removeRuntimeSession(
  deviceFingerprint: string | null, sessionEpoch: number,
): number {
  if (deviceFingerprint !== null) {
    return _sessions.delete(sessionKey(deviceFingerprint, sessionEpoch)) ? 1 : 0;
  }
  let removed = 0;
  for (const [key, s] of Array.from(_sessions)) {
    if (s.sessionEpoch === sessionEpoch) { _sessions.delete(key); removed += 1; }
  }
  return removed;
}

/**
 * Bu ÇİFT şu anda canlı ve yetki verebilir durumda mı.
 *
 * FAIL CLOSED: yalnız `ACTIVE` sayılır (`LINKED`/`DEGRADED` yetki VERMEZ —
 * `phoneLinkAttachment`in kendi eşiğiyle aynı).
 */
export function isSessionLive(deviceFingerprint: string | null, sessionEpoch: number | null): boolean {
  if (deviceFingerprint === null || sessionEpoch === null) return false;
  const s = _sessions.get(sessionKey(deviceFingerprint, sessionEpoch));
  return s !== undefined && s.attachmentState === 'ACTIVE';
}

/**
 * Canlılık kapısı — TEK yer. Çağıran canlı anlık görüntüyü KENDİSİ verir,
 * böylece bu fonksiyon anlık görüntü otoritesine göre SAF kalır.
 *
 * · OLAY MODU açıksa canlılık YALNIZ indekse sorulur; boş indeks "canlı
 *   oturum yok" demektir ve bayat bir pull yetkiyi DİRİLTEMEZ (fail-closed).
 * · Olay hiç gelmediyse F1–F3'ün tek-oturum karşılaştırması AYNEN korunur —
 *   eski davranış bit bazında değişmez.
 */
export function isSessionLiveGivenSnapshot(
  deviceFingerprint: string | null,
  sessionEpoch: number | null,
  snapshot: {
    readonly state: PhoneAttachmentState;
    readonly sessionEpoch: number | null;
    readonly deviceFingerprint: string | null;
  },
): boolean {
  if (_eventModeEngaged) return isSessionLive(deviceFingerprint, sessionEpoch);
  return snapshot.state === 'ACTIVE'
    && deviceFingerprint !== null && sessionEpoch !== null
    && snapshot.sessionEpoch === sessionEpoch
    && snapshot.deviceFingerprint === deviceFingerprint;
}

/** Salt-okunur liste (LAB). Sır TAŞIMAZ — çağıran parmak izini maskelemelidir. */
export function listRuntimeSessions(): readonly PhoneLinkRuntimeSession[] {
  return Object.freeze(Array.from(_sessions.values()));
}

export function activeRuntimeSessionCount(): number {
  let n = 0;
  for (const s of _sessions.values()) if (s.attachmentState === 'ACTIVE') n += 1;
  return n;
}

/**
 * GERÇEKTEN global olaylar için (process/alt sistem kapanışı, açık güvenlik
 * sıfırlaması). Tek bir telefonun kopmasında ÇAĞRILMAZ — o `removeRuntimeSession`
 * ile tek kaydı düşürür (F4.10).
 */
export function clearRuntimeSessions(): void {
  _sessions.clear();
}

/** @internal — yalnız testler. */
export function _resetPhoneLinkSessionRegistryForTest(): void {
  _sessions.clear();
  _eventModeEngaged = false;
}
