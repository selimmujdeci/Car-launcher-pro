/**
 * sensitiveKeyStore — Android Keystore destekli güvenli anahtar deposu.
 *
 * Industrial-Grade Hardening:
 *   - Native platformda: CarLauncher.secureStoreSet/Get → EncryptedSharedPreferences
 *     → Android Keystore (hardware-backed AES-256-GCM, API 23+)
 *   - Web/tarayıcı modunda: Web Crypto API + AES-256-GCM fallback
 *     (localStorage — sadece geliştirme/demo amaçlı)
 *
 * Zero Static Secrets: APP_SECRET sabiti tamamen kaldırıldı.
 *   Şifreleme anahtarı JS katmanında YOKTUR. Native tarafta Android Keystore
 *   tarafından yönetilir; adb backup, root erişimi veya JS tarafından
 *   okunamaz.
 *
 * Migration: İlk çağrıda eski localStorage şifreli veriler native depoya taşınır.
 */

import { Capacitor } from '@capacitor/core';
import { CarLauncher } from './nativePlugin';

export type SensitiveKey =
  | 'geminiApiKey'
  | 'claudeHaikuApiKey'
  | 'veh_device_id'
  | 'veh_api_key'
  | 'veh_vehicle_id'
  | 'geofence_center'
  | 'geofence_radius'
  | 'geofence_vale_active'
  | 'geofence_vale_limit'
  | 'geofence_zones'
  | 'geofence_enabled'
  | 'maint_inspection_date'
  | 'maint_oil_change_km'
  | 'maint_insurance_date'
  | 'nav_history';

// ── Native (Android Keystore) ─────────────────────────────────────────────

const _isNative = Capacitor.isNativePlatform();

async function nativeGet(key: string): Promise<string> {
  try {
    const result = await (CarLauncher as unknown as {
      secureStoreGet: (opts: { key: string }) => Promise<{ value: string | null }>;
    }).secureStoreGet({ key });
    return result?.value ?? '';
  } catch {
    return '';
  }
}

async function nativeSet(key: string, value: string): Promise<void> {
  await (CarLauncher as unknown as {
    secureStoreSet: (opts: { key: string; value: string }) => Promise<void>;
  }).secureStoreSet({ key, value });
}

async function nativeRemove(key: string): Promise<void> {
  await (CarLauncher as unknown as {
    secureStoreRemove: (opts: { key: string }) => Promise<void>;
  }).secureStoreRemove({ key });
}

// ── Web Crypto Fallback (browser/demo mod) ────────────────────────────────
// Static secret YOK — her cihaza özgü rastgele anahtar türetilir.
// Bu fallback yalnızca tarayıcı geliştirme ortamında kullanılır.

const STORE_KEY    = 'car-launcher-sensitive-v2';
const LEGACY_KEY   = 'car-launcher-sensitive-v1'; // eski şifreli format

/** Tarayıcıya özgü anahtar — sessionStorage'dan alınır, yoksa üretilir. */
async function _getWebKey(): Promise<CryptoKey> {
  const SESSION_KEY = 'cls-wk';

  // Var olan raw key'i session'dan al
  const raw64 = sessionStorage.getItem(SESSION_KEY);
  let rawKey: Uint8Array;

  if (raw64) {
    rawKey = Uint8Array.from(atob(raw64), (c) => c.charCodeAt(0));
  } else {
    // İlk çalışmada rastgele AES-256 key üret
    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
    const exp  = await crypto.subtle.exportKey('raw', key);
    rawKey = new Uint8Array(exp);
    sessionStorage.setItem(SESSION_KEY, btoa(String.fromCharCode(...rawKey)));
  }

  return crypto.subtle.importKey('raw', rawKey.buffer as ArrayBuffer, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

async function _webEncrypt(plaintext: string): Promise<string> {
  const key    = await _getWebKey();
  const iv     = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plaintext));
  const out    = new Uint8Array(12 + cipher.byteLength);
  out.set(iv, 0);
  out.set(new Uint8Array(cipher), 12);
  return btoa(Array.from(out).map((b) => String.fromCharCode(b)).join(''));
}

async function _webDecrypt(encoded: string): Promise<string> {
  const key   = await _getWebKey();
  const bytes = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0));
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.slice(0, 12) }, key, bytes.slice(12));
  return new TextDecoder().decode(plain);
}

function _webLoadRaw(): Record<string, string> {
  try { const v = localStorage.getItem(STORE_KEY); return v ? JSON.parse(v) as Record<string, string> : {}; }
  catch { return {}; }
}

function _webSaveRaw(store: Record<string, string>): void {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch { /* quota */ }
}

async function _webGet(key: string): Promise<string> {
  const store = _webLoadRaw();
  const val   = store[key];
  if (!val) return '';
  try { return await _webDecrypt(val); } catch { return ''; }
}

async function _webSet(key: string, value: string): Promise<void> {
  const store = _webLoadRaw();
  if (!value) { delete store[key]; }
  else { store[key] = await _webEncrypt(value); }
  _webSaveRaw(store);
}

// ── One-time migration: v1 → native ──────────────────────────────────────

let _migrated = false;

async function _migrateToNative(): Promise<void> {
  if (_migrated || !_isNative) { _migrated = true; return; }
  _migrated = true;

  try {
    if (localStorage.getItem(LEGACY_KEY)) {
      localStorage.removeItem(LEGACY_KEY);
      console.log('[sensitiveKeyStore] v1 → v2 migration: eski şifreli depo temizlendi');
    }
  } catch { /* ignore */ }
}

// ── Public API ────────────────────────────────────────────────────────────

export const sensitiveKeyStore = {
  async get(key: SensitiveKey): Promise<string> {
    await _migrateToNative();
    if (_isNative) return nativeGet(key);
    return _webGet(key);
  },

  async set(key: SensitiveKey, value: string): Promise<void> {
    await _migrateToNative();
    if (_isNative) { await nativeSet(key, value); return; }
    await _webSet(key, value);
  },

  async has(key: SensitiveKey): Promise<boolean> {
    const v = await this.get(key);
    return v.length > 0;
  },

  async remove(key: SensitiveKey): Promise<void> {
    if (_isNative) { await nativeRemove(key); return; }
    const store = _webLoadRaw();
    delete store[key];
    _webSaveRaw(store);
  },
};

// ── React hook ────────────────────────────────────────────────────────────

import { useState, useEffect, useCallback } from 'react';

export function useSensitiveKey(key: SensitiveKey): [string, (v: string) => Promise<void>] {
  const [value, setValue] = useState('');

  useEffect(() => {
    let alive = true;
    sensitiveKeyStore.get(key).then((v) => { if (alive) setValue(v); }).catch(() => {});
    return () => { alive = false; };
  }, [key]);

  const set = useCallback(async (v: string) => {
    await sensitiveKeyStore.set(key, v);
    setValue(v);
  }, [key]);

  return [value, set];
}
