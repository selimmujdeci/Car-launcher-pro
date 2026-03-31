/**
 * PIN Service — güvenli PIN yönetimi.
 *
 * Güvenlik katmanları:
 *   1. SHA-256 hash  — plaintext PIN hiçbir zaman saklanmaz
 *   2. Brute-force   — 5 başarısız denemede 30 saniyelik kilit
 *   3. Native bridge — Android Keystore + EncryptedSharedPreferences
 *                      (CarLauncherPlugin.java'da implemente edildiğinde aktif)
 *
 * Java tarafı için gerekli metodlar nativePlugin.ts'e eklendi:
 *   setPinHash(hash)  → EncryptedSharedPreferences.putString()
 *   verifyPin(attempt) → hash(attempt) === storedHash
 *   clearPin()        → EncryptedSharedPreferences.remove()
 *
 * Web / demo fallback:
 *   Hash, sessionStorage'da saklanır. Sayfa yenilenince sıfırlanır.
 *   Plaintext PIN hiçbir zaman saklanmaz / loglanmaz.
 */

import { isNative } from './bridge';
import { CarLauncher } from './nativePlugin';
import { logError } from './crashLogger';

/* ── SHA-256 (Web Crypto API) ────────────────────────────── */

async function sha256Hex(text: string): Promise<string> {
  const enc    = new TextEncoder();
  const buffer = await crypto.subtle.digest('SHA-256', enc.encode(text));
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/* ── Brute-force koruması ────────────────────────────────── */

const MAX_ATTEMPTS   = 5;
const LOCKOUT_SEC    = 30;

let _failedAttempts  = 0;
let _lockoutUntil    = 0;   // Date.now() timestamp

export interface LockoutState {
  locked:          boolean;
  remainingSec:    number;
  failedAttempts:  number;
}

export function getLockoutState(): LockoutState {
  const now      = Date.now();
  const locked   = _failedAttempts >= MAX_ATTEMPTS && now < _lockoutUntil;
  const remaining = locked ? Math.ceil((_lockoutUntil - now) / 1000) : 0;
  // Kilit süresi geçtiyse sayacı sıfırla
  if (_failedAttempts >= MAX_ATTEMPTS && now >= _lockoutUntil) {
    _failedAttempts = 0;
  }
  return { locked, remainingSec: remaining, failedAttempts: _failedAttempts };
}

/* ── Depolama ────────────────────────────────────────────── */

const SESSION_KEY = '__clp_pin_h__';

function _storeHash(hash: string): void {
  try { sessionStorage.setItem(SESSION_KEY, hash); } catch { /* private/incognito */ }
}

function _loadHash(): string | null {
  try { return sessionStorage.getItem(SESSION_KEY); } catch { return null; }
}

function _clearHash(): void {
  try { sessionStorage.removeItem(SESSION_KEY); } catch { /* noop */ }
}

/* ── Public API ──────────────────────────────────────────── */

/** PIN'in ayarlanmış olup olmadığını kontrol et (sync). */
export function isPinSet(): boolean {
  return !!_loadHash();
}

/**
 * Yeni PIN ayarla.
 * PIN hash'lenerek saklanır; plaintext saklanmaz.
 */
export async function setupPin(pin: string): Promise<void> {
  if (!/^\d{4}$/.test(pin)) throw new Error('PIN 4 rakamdan oluşmalı');

  const hash = await sha256Hex(pin);

  if (isNative) {
    try {
      await CarLauncher.setPinHash({ hash });
      return;
    } catch (e) {
      // Java implementasyonu henüz yok — web fallback'e düş
      logError('PIN:NativeSetFailed', e);
    }
  }

  _storeHash(hash);
}

/**
 * PIN doğrula.
 * Kaba kuvvet koruması: 5 başarısız denemede 30 saniyelik kilit.
 * Doğruysa `true`, yanlış veya kilitliyse `false` döner.
 */
export async function verifyPin(attempt: string): Promise<boolean> {
  const lockout = getLockoutState();
  if (lockout.locked) return false;

  if (!/^\d{4}$/.test(attempt)) {
    _failedAttempts++;
    return false;
  }

  let match = false;

  if (isNative) {
    try {
      const result = await CarLauncher.verifyPin({ attempt });
      match = result.match;
    } catch (e) {
      logError('PIN:NativeVerifyFailed', e);
      // Fallback → web hash
      match = await _verifyWebHash(attempt);
    }
  } else {
    match = await _verifyWebHash(attempt);
  }

  if (match) {
    _failedAttempts = 0;
    return true;
  }

  _failedAttempts++;
  if (_failedAttempts >= MAX_ATTEMPTS) {
    _lockoutUntil = Date.now() + LOCKOUT_SEC * 1000;
  }
  return false;
}

async function _verifyWebHash(attempt: string): Promise<boolean> {
  const stored = _loadHash();
  if (!stored) return false;
  const hash = await sha256Hex(attempt);
  return hash === stored;
}

/**
 * PIN kilidi kaldır (PIN lock'ı devre dışı bırak).
 * Native'de EncryptedSharedPreferences'tan siler.
 */
export async function clearPin(): Promise<void> {
  if (isNative) {
    try {
      await CarLauncher.clearPin();
    } catch (e) {
      logError('PIN:NativeClearFailed', e);
    }
  }
  _clearHash();
  _failedAttempts = 0;
  _lockoutUntil   = 0;
}
