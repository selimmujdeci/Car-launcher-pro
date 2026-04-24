/**
 * sensitiveKeyStore — AES-256-GCM encrypted localStorage for API keys.
 *
 * Security model:
 *   - Keys encrypted with AES-256-GCM before any write to localStorage
 *   - Encryption key derived via PBKDF2-SHA-256 (100k iterations) from a
 *     static app secret — prevents trivial plaintext extraction from
 *     device backups and adb shell localStorage dumps
 *   - NOT a substitute for Android Keystore; native hardening via
 *     CarLauncherPlugin.setSecurePreference() is the next iteration
 *
 * Migration:
 *   On first call, if a plaintext key exists in the legacy Zustand store
 *   it is automatically migrated to the encrypted store and removed.
 *
 * Usage:
 *   const key = await sensitiveKeyStore.get('geminiApiKey');
 *   await sensitiveKeyStore.set('geminiApiKey', 'AIzaSy...');
 */

const STORE_KEY        = 'car-launcher-sensitive-v1';
const APP_SECRET       = 'CLPro-2026-automotive-iv2';
const PBKDF2_SALT      = 'car-launcher-pbkdf2-salt-v1';
const PBKDF2_ITERS     = 100_000;
/** Legacy Zustand persist key — used for one-time migration only. */
const LEGACY_STORE_KEY = 'car-launcher-storage';

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
  | 'maint_inspection_date'
  | 'maint_oil_change_km'
  | 'maint_insurance_date'
  | 'nav_history';

/* ── Crypto ──────────────────────────────────────────────── */

let _cryptoKeyPromise: Promise<CryptoKey> | null = null;

function _deriveCryptoKey(): Promise<CryptoKey> {
  if (_cryptoKeyPromise) return _cryptoKeyPromise;
  _cryptoKeyPromise = (async () => {
    if (typeof crypto === 'undefined' || !crypto.subtle) {
      throw new Error('Web Crypto API not available');
    }
    const enc = new TextEncoder();
    const raw = await crypto.subtle.importKey(
      'raw', enc.encode(APP_SECRET), { name: 'PBKDF2' }, false, ['deriveKey'],
    );
    return crypto.subtle.deriveKey(
      {
        name:       'PBKDF2',
        salt:       enc.encode(PBKDF2_SALT),
        iterations: PBKDF2_ITERS,
        hash:       'SHA-256',
      },
      raw,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    );
  })();
  return _cryptoKeyPromise;
}

async function _encrypt(plaintext: string): Promise<string> {
  const key     = await _deriveCryptoKey();
  const iv      = crypto.getRandomValues(new Uint8Array(12));
  const enc     = new TextEncoder();
  const cipher  = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(plaintext));
  // Pack: 12-byte IV || ciphertext → base64
  const out = new Uint8Array(12 + cipher.byteLength);
  out.set(iv, 0);
  out.set(new Uint8Array(cipher), 12);
  return btoa(String.fromCharCode(...out));
}

async function _decrypt(encoded: string): Promise<string> {
  const key    = await _deriveCryptoKey();
  const bytes  = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0));
  const plain  = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: bytes.slice(0, 12) }, key, bytes.slice(12),
  );
  return new TextDecoder().decode(plain);
}

/* ── Raw store (encrypted blobs in localStorage) ─────────── */

function _loadRaw(): Record<string, string> {
  try {
    const v = localStorage.getItem(STORE_KEY);
    return v ? (JSON.parse(v) as Record<string, string>) : {};
  } catch { return {}; }
}

function _saveRaw(store: Record<string, string>): void {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch { /* quota */ }
}

/* ── One-time migration from legacy plaintext Zustand store ── */

let _migrated = false;

async function _migrateLegacy(): Promise<void> {
  if (_migrated) return;
  _migrated = true;
  try {
    const raw = localStorage.getItem(LEGACY_STORE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as { state?: { settings?: {
      geminiApiKey?: string;
      claudeHaikuApiKey?: string;
    } } };
    const s = parsed?.state?.settings ?? {};
    const store = _loadRaw();
    let needsSave = false;

    type LegacyKey = 'geminiApiKey' | 'claudeHaikuApiKey';
    for (const key of (['geminiApiKey', 'claudeHaikuApiKey'] as LegacyKey[])) {
      const plaintext = s[key];
      if (plaintext && !store[key]) {
        store[key] = await _encrypt(plaintext);
        needsSave = true;
        // Scrub plaintext from legacy store
        if (parsed.state?.settings) {
          parsed.state.settings[key] = '';
        }
      }
    }

    if (needsSave) {
      _saveRaw(store);
      try { localStorage.setItem(LEGACY_STORE_KEY, JSON.stringify(parsed)); } catch { /* ignore */ }
    }
  } catch { /* migration failure is non-fatal */ }
}

/* ── Public API ──────────────────────────────────────────── */

export const sensitiveKeyStore = {
  async get(key: SensitiveKey): Promise<string> {
    await _migrateLegacy();
    const store = _loadRaw();
    const val = store[key];
    if (!val) return '';
    try { return await _decrypt(val); } catch { return ''; }
  },

  async set(key: SensitiveKey, value: string): Promise<void> {
    await _migrateLegacy();
    const store = _loadRaw();
    if (!value) {
      delete store[key];
    } else {
      store[key] = await _encrypt(value);
    }
    _saveRaw(store);
  },

  async has(key: SensitiveKey): Promise<boolean> {
    const v = await this.get(key);
    return v.length > 0;
  },

  remove(key: SensitiveKey): void {
    const store = _loadRaw();
    delete store[key];
    _saveRaw(store);
  },
};

/* ── React hook ──────────────────────────────────────────── */

import { useState, useEffect, useCallback } from 'react';

/**
 * React hook for reading and writing a single sensitive key.
 *
 * Returns [value, setter] where setter returns a Promise.
 * The hook initialises asynchronously — value starts as '' until decrypted.
 */
export function useSensitiveKey(key: SensitiveKey): [string, (v: string) => Promise<void>] {
  const [value, setValue] = useState('');

  useEffect(() => {
    let alive = true;
    sensitiveKeyStore.get(key)
      .then((v) => { if (alive) setValue(v); })
      .catch(() => {});
    return () => { alive = false; };
  }, [key]);

  const set = useCallback(async (v: string) => {
    await sensitiveKeyStore.set(key, v);
    setValue(v);
  }, [key]);

  return [value, set];
}
