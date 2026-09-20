/**
 * pinService — HEAD-UNIT LOCAL PIN otoritesi (Wave 12B).
 *
 * ══════════════════════════════════════════════════════════════════════════
 * NE KORUR
 * Local PIN aracı kullanmayı engellemez. TEK görevi: aktif valet/geofence
 * korumasının araç başındaki YETKİSİZ kişi tarafından kapatılmasını,
 * ayarlarının değiştirilmesini veya sınırının etkisizleştirilmesini
 * engellemektir. Kapı `geofenceService` içindedir (servis katmanı, UI değil).
 *
 * UZAK KOMUT PIN'İ AYRI DOMAINDİR (`verify_and_send_critical_command`,
 * migration 083/084) — burayla KARIŞTIRILMAZ, buradan etkilenmez.
 *
 * ── TEHDİT MODELİ (dürüst) ────────────────────────────────────────────────
 * Korunan: ARAÇ BAŞINDAKİ İNSAN. Korunmayan: ele geçirilmiş WebView — o
 * zaten native köprüyü doğrudan çağırabilir. Bu sınır FİZİKSEL erişime
 * karşıdır ve öyle beyan edilir.
 *
 * ── OTORİTE ───────────────────────────────────────────────────────────────
 * Cihazda: native (Android Keystore + EncryptedSharedPreferences). Doğrulayıcı
 * ve deneme sayacı ORADA yaşar; JS'e geri DÖNMEZ. Ham PIN kalıcı olarak
 * saklanmaz, loglanmaz.
 *
 * Neden `setPinHash(hash)` DEĞİL: eski sözleşmede hash'i JS üretip native'e
 * yolluyordu. Bu güven sınırını yanlış yere koyar (JS istediği doğrulayıcıyı
 * yazabilir) ve 4 haneli PIN için düz SHA-256 çevrimdışı kırılır. Yeni
 * sözleşmede JS yalnız KULLANICI GİRDİSİNİ taşır; türetme/karşılaştırma
 * native'dedir.
 *
 * ── FAIL-CLOSED ───────────────────────────────────────────────────────────
 * Cihazda native çağrısı patlarsa web yedeğine DÜŞÜLMEZ → DENY. "Native
 * çalışmadı" ile "PIN doğru" ayrı şeylerdir. UNKNOWN != UNLOCKED.
 *
 * ── GELİŞTİRME YEDEĞİ ─────────────────────────────────────────────────────
 * Native olmayan ortamda (tarayıcı/dev) yerel bir doğrulayıcı kullanılır:
 * rastgele salt + PBKDF2-SHA256 (Web Crypto; kendi kriptomuz YOK). Bu yol
 * GELİŞTİRME İÇİNDİR, güvenlik sınırı SAYILMAZ — cihazda native otoritedir.
 * Sayaç/kilit `localStorage`'da tutulur ki reload kilitlemeyi SIFIRLAMASIN.
 * ══════════════════════════════════════════════════════════════════════════
 */

import { isNative } from './bridge';
import { CarLauncher } from './nativePlugin';
import { logError } from './crashLogger';

/* ── Politika ────────────────────────────────────────────── */

const MAX_ATTEMPTS = 5;
const LOCKOUT_SEC  = 30;
const PIN_RE       = /^\d{4,6}$/;

/** PBKDF2 tur sayısı — düz SHA-256 yerine (düşük entropili PIN). */
const KDF_ITERATIONS = 120_000;

/* ── Sonuç sözleşmesi (deterministik; string ayrıştırma YOK) ─ */

export type PinStatus =
  | 'OK'          // işlem başarılı / doğrulandı
  | 'WRONG'       // PIN yanlış
  | 'NOT_SET'     // doğrulayıcı kurulu değil
  | 'ALREADY_SET' // ilk kurulum istendi ama PIN zaten var
  | 'LOCKED'      // kaba kuvvet kilidi açık
  | 'INVALID'     // biçim hatası (4–6 rakam değil)
  | 'UNAVAILABLE';// native otorite yok/patladı → FAIL-CLOSED

export interface PinResult {
  status:       PinStatus;
  /** Kilitliyken kalan saniye (yalnız LOCKED). */
  remainingSec: number;
}

const R = (status: PinStatus, remainingSec = 0): PinResult => ({ status, remainingSec });

export interface LockoutState {
  locked:         boolean;
  remainingSec:   number;
  failedAttempts: number;
}

/* ── Geliştirme yedeği: kalıcı yerel doğrulayıcı ──────────── */

const DEV_KEY = '__caros_local_pin_dev_v1__';

interface DevRecord {
  salt:     string;   // base64
  verifier: string;   // base64 (PBKDF2 çıktısı)
  attempts: number;
  until:    number;   // lockout bitiş (epoch ms)
}

function devLoad(): DevRecord | null {
  try {
    const raw = localStorage.getItem(DEV_KEY);
    return raw ? (JSON.parse(raw) as DevRecord) : null;
  } catch { return null; }
}

function devSave(rec: DevRecord | null): void {
  try {
    if (rec === null) localStorage.removeItem(DEV_KEY);
    else localStorage.setItem(DEV_KEY, JSON.stringify(rec));
  } catch { /* private mode — dev yolunda tolere edilir */ }
}

const b64 = (b: Uint8Array): string => btoa(String.fromCharCode(...b));
const unb64 = (s: string): Uint8Array =>
  Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/** PBKDF2-SHA256 — kendi türetme algoritmamız YOK, Web Crypto kullanılır. */
async function derive(pin: string, salt: Uint8Array): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: salt as unknown as BufferSource, iterations: KDF_ITERATIONS, hash: 'SHA-256' },
    key, 256,
  );
  return b64(new Uint8Array(bits));
}

/** Sabit zamanlı karşılaştırma — erken çıkış YOK. */
function timingSafeEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function devLockRemaining(rec: DevRecord): number {
  const now = Date.now();
  if (rec.attempts >= MAX_ATTEMPTS && now < rec.until) {
    return Math.ceil((rec.until - now) / 1000);
  }
  return 0;
}

async function devVerify(pin: string): Promise<PinResult> {
  const rec = devLoad();
  if (!rec) return R('NOT_SET');
  const rem = devLockRemaining(rec);
  if (rem > 0) return R('LOCKED', rem);

  /* Kilit süresi dolduysa sayaç sıfırlanır (kilit kalıcı ceza değildir). */
  if (rec.attempts >= MAX_ATTEMPTS) { rec.attempts = 0; rec.until = 0; }

  const candidate = await derive(pin, unb64(rec.salt));
  if (timingSafeEq(candidate, rec.verifier)) {
    rec.attempts = 0; rec.until = 0; devSave(rec);
    return R('OK');
  }
  rec.attempts += 1;
  if (rec.attempts >= MAX_ATTEMPTS) rec.until = Date.now() + LOCKOUT_SEC * 1000;
  devSave(rec);
  return rec.attempts >= MAX_ATTEMPTS
    ? R('LOCKED', Math.ceil(LOCKOUT_SEC))
    : R('WRONG');
}

async function devSet(pin: string): Promise<PinResult> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  devSave({ salt: b64(salt), verifier: await derive(pin, salt), attempts: 0, until: 0 });
  return R('OK');
}

/* ── Native köprü (cihaz otoritesi) ───────────────────────── */

type NativePinApi = {
  localPinStatus(): Promise<{ configured: boolean; locked: boolean; remainingSec: number; failedAttempts: number }>;
  setLocalPin(o: { pin: string }): Promise<{ status: string }>;
  verifyLocalPin(o: { pin: string }): Promise<{ status: string; remainingSec?: number }>;
  changeLocalPin(o: { current: string; next: string }): Promise<{ status: string }>;
  clearLocalPin(o: { current: string }): Promise<{ status: string }>;
};

const native = (): NativePinApi => CarLauncher as unknown as NativePinApi;

/** Native yanıtını sözleşmeye çevirir; tanınmayan değer FAIL-CLOSED. */
function toStatus(raw: string | undefined): PinStatus {
  switch (raw) {
    case 'OK': case 'WRONG': case 'NOT_SET':
    case 'ALREADY_SET': case 'LOCKED': case 'INVALID':
      return raw;
    default:
      return 'UNAVAILABLE';
  }
}

/* ── Public API ──────────────────────────────────────────── */

/**
 * Doğrulayıcı kurulu mu + kilit durumu.
 * Native patlarsa `UNAVAILABLE` semantiği: `configured` BİLİNMEZ sayılır ve
 * çağıran kapı DENY eder (UNKNOWN != UNLOCKED).
 */
export async function getPinStatus(): Promise<{ configured: boolean; known: boolean } & LockoutState> {
  if (isNative) {
    try {
      const s = await native().localPinStatus();
      return {
        configured: !!s.configured, known: true,
        locked: !!s.locked, remainingSec: s.remainingSec ?? 0,
        failedAttempts: s.failedAttempts ?? 0,
      };
    } catch (e) {
      logError('PIN:StatusUnavailable', e);
      return { configured: false, known: false, locked: false, remainingSec: 0, failedAttempts: 0 };
    }
  }
  const rec = devLoad();
  const rem = rec ? devLockRemaining(rec) : 0;
  return {
    configured: !!rec, known: true,
    locked: rem > 0, remainingSec: rem, failedAttempts: rec?.attempts ?? 0,
  };
}

/**
 * Senkron kilit görünümü (UI için).
 *
 * Geliştirme yolunda KALICI kayıttan OKUNUR — modül yeniden yüklenmesi
 * (reload/HMR) kilitlemeyi SIFIRLAMAZ. Wave 12'de ölçülen kusur buydu:
 * sayaç modül değişkenindeydi ve bir reload sınırsız deneme açıyordu.
 * Cihazda otorite native'dir; burada son bilinen durum yansıtılır.
 */
let _lastLockout: LockoutState = { locked: false, remainingSec: 0, failedAttempts: 0 };

export function getLockoutState(): LockoutState {
  if (!isNative) {
    const rec = devLoad();
    if (!rec) return { locked: false, remainingSec: 0, failedAttempts: 0 };
    const rem = devLockRemaining(rec);
    return { locked: rem > 0, remainingSec: rem, failedAttempts: rec.attempts };
  }
  return _lastLockout;
}

function cacheLockout(s: LockoutState): void { _lastLockout = s; }

/** Doğrulayıcı kurulu mu (senkron, son bilinen). */
let _lastConfigured = false;
export function isPinSet(): boolean { return _lastConfigured; }

/** UI/servis açılışında bir kez çağrılır — senkron görünümleri tazeler. */
export async function refreshPinState(): Promise<void> {
  const s = await getPinStatus();
  _lastConfigured = s.configured;
  cacheLockout({ locked: s.locked, remainingSec: s.remainingSec, failedAttempts: s.failedAttempts });
}

/**
 * İLK kurulum. PIN zaten varsa `ALREADY_SET` döner — değiştirmek için
 * `changePin` (mevcut PIN kanıtı ister) kullanılır.
 */
export async function setupPin(pin: string): Promise<PinResult> {
  if (!PIN_RE.test(pin)) return R('INVALID');

  if (isNative) {
    try {
      const res = toStatus((await native().setLocalPin({ pin })).status);
      if (res === 'OK') _lastConfigured = true;
      return R(res);
    } catch (e) {
      logError('PIN:NativeSetFailed', e);
      return R('UNAVAILABLE');          // FAIL-CLOSED: web yedeğine DÜŞMEZ
    }
  }

  if (devLoad()) return R('ALREADY_SET');
  const out = await devSet(pin);
  _lastConfigured = out.status === 'OK';
  return out;
}

/** PIN doğrula. Kilitliyken doğru PIN de geçmez (`LOCKED`). */
export async function verifyPinDetailed(attempt: string): Promise<PinResult> {
  if (!PIN_RE.test(attempt)) return R('INVALID');

  if (isNative) {
    try {
      const raw = await native().verifyLocalPin({ pin: attempt });
      const st  = toStatus(raw.status);
      const rem = raw.remainingSec ?? 0;
      cacheLockout({ locked: st === 'LOCKED', remainingSec: rem, failedAttempts: st === 'OK' ? 0 : MAX_ATTEMPTS });
      return R(st, rem);
    } catch (e) {
      logError('PIN:NativeVerifyFailed', e);
      return R('UNAVAILABLE');          // FAIL-CLOSED
    }
  }

  const out = await devVerify(attempt);
  const rec = devLoad();
  cacheLockout({
    locked: out.status === 'LOCKED',
    remainingSec: out.remainingSec,
    failedAttempts: rec?.attempts ?? 0,
  });
  return out;
}

/** Geriye dönük sade yüzey: yalnız "doğru mu". Kilit/eksik → false. */
export async function verifyPin(attempt: string): Promise<boolean> {
  return (await verifyPinDetailed(attempt)).status === 'OK';
}

/** PIN değiştirme — MEVCUT PIN kanıtı ZORUNLU. */
export async function changePin(current: string, next: string): Promise<boolean> {
  if (!PIN_RE.test(next)) return false;

  if (isNative) {
    try {
      return toStatus((await native().changeLocalPin({ current, next })).status) === 'OK';
    } catch (e) {
      logError('PIN:NativeChangeFailed', e);
      return false;                     // FAIL-CLOSED
    }
  }

  if ((await devVerify(current)).status !== 'OK') return false;
  await devSet(next);
  return true;
}

/**
 * PIN kaldırma — MEVCUT PIN kanıtı ZORUNLU.
 * Kanıtsız kaldırma, kilidi bilmeyenin korumayı kapatmasıdır (Wave 12 bypass'i).
 */
export async function clearPin(current: string): Promise<boolean> {
  if (isNative) {
    try {
      const ok = toStatus((await native().clearLocalPin({ current })).status) === 'OK';
      if (ok) _lastConfigured = false;
      return ok;
    } catch (e) {
      logError('PIN:NativeClearFailed', e);
      return false;                     // FAIL-CLOSED
    }
  }

  if ((await devVerify(current)).status !== 'OK') return false;
  devSave(null);
  _lastConfigured = false;
  cacheLockout({ locked: false, remainingSec: 0, failedAttempts: 0 });
  return true;
}
