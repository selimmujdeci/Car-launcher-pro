/**
 * Expert trust kalıcılığı — HMAC-SHA256 mühür + safeStorage.
 * Android: HMAC anahtarı yalnızca Android Keystore'da (CarLauncherPlugin).
 * Web: WebCrypto + safeStorage seed.
 * Zustand persist senkron API ile uyumsuz olduğundan ayrı katman.
 */

import { Capacitor } from '@capacitor/core';
import { CarLauncher } from '../nativePlugin';
import { safeGetRaw, safeSetRawImmediate } from '../../utils/safeStorage';

export const EXPERT_TRUST_STORAGE_KEY = 'car-expert-trust-store';
/** Yalnızca web (non-native) yolunda kullanılır — native'de Keystore anahtarı geçerlidir */
export const EXPERT_TRUST_SEED_KEY    = 'car-expert-trust-hmac-seed';

const ENVELOPE_VERSION = 1;
const SEED_HEX_LEN     = 64; // 32 byte

export interface ExpertTrustPersistedBody {
  schemaVersion:         number;
  vin:                   string;
  ecuSupplier:           string;
  rollbackNumerator:     number;
  rollbackDenominator:  number;
}

interface SealedEnvelope {
  v:         number;
  body:      ExpertTrustPersistedBody;
  sigHex:    string;
  issuedAt:  number;
}

function sortKeysDeep(x: unknown): unknown {
  if (x === null || typeof x !== 'object') return x;
  if (Array.isArray(x)) return x.map(sortKeysDeep);
  const o = x as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(o).sort()) {
    out[k] = sortKeysDeep(o[k]);
  }
  return out;
}

export function canonicalStringify(obj: unknown): string {
  return JSON.stringify(sortKeysDeep(obj));
}

function bytesToHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(hex: string): Uint8Array | null {
  if (hex.length !== SEED_HEX_LEN || !/^[0-9a-f]+$/i.test(hex)) return null;
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    out[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return out;
}

function randomSeedHex(): string {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return bytesToHex(b.buffer);
}

async function getOrCreateSeedHex(): Promise<string> {
  let seed = safeGetRaw(EXPERT_TRUST_SEED_KEY);
  if (!seed || seed.length !== SEED_HEX_LEN) {
    seed = randomSeedHex();
    await safeSetRawImmediate(EXPERT_TRUST_SEED_KEY, seed);
  }
  return seed;
}

async function importHmacKey(seedHex: string): Promise<CryptoKey> {
  const raw = hexToBytes(seedHex);
  if (!raw) throw new Error('[expertTrustSeal] Geçersiz seed');
  return crypto.subtle.importKey(
    'raw',
    raw.buffer as ArrayBuffer,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

async function hmacSignUtf8(key: CryptoKey, utf8: string): Promise<ArrayBuffer> {
  const enc = new TextEncoder();
  return crypto.subtle.sign('HMAC', key, enc.encode(utf8));
}

function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

function isNativeKeystoreHmacAvailable(): boolean {
  return Capacitor.isNativePlatform()
    && typeof (CarLauncher as { expertTrustHmacSign?: unknown }).expertTrustHmacSign === 'function'
    && typeof (CarLauncher as { expertTrustHmacVerify?: unknown }).expertTrustHmacVerify === 'function';
}

async function nativeSignCanonical(canonical: string): Promise<string> {
  const sign = CarLauncher.expertTrustHmacSign;
  if (!sign) throw new Error('[expertTrustSeal] expertTrustHmacSign yok');
  const r = await sign.call(CarLauncher, { canonical });
  return r.sigHex;
}

async function nativeVerifyCanonical(canonical: string, sigHex: string): Promise<boolean> {
  const verify = CarLauncher.expertTrustHmacVerify;
  if (!verify) return false;
  const r = await verify.call(CarLauncher, { canonical, sigHex });
  return r.valid === true;
}

export async function flushSignedState(body: ExpertTrustPersistedBody): Promise<void> {
  const canon = canonicalStringify(body);
  let sigHex: string;
  if (isNativeKeystoreHmacAvailable()) {
    sigHex = await nativeSignCanonical(canon);
  } else {
    const seedHex = await getOrCreateSeedHex();
    const key     = await importHmacKey(seedHex);
    const sig     = await hmacSignUtf8(key, canon);
    sigHex = bytesToHex(sig);
  }
  const env: SealedEnvelope = {
    v:        ENVELOPE_VERSION,
    body,
    sigHex,
    issuedAt: Date.now(),
  };
  await safeSetRawImmediate(EXPERT_TRUST_STORAGE_KEY, JSON.stringify(env));
}

export async function loadSignedState(): Promise<ExpertTrustPersistedBody | null> {
  const raw = safeGetRaw(EXPERT_TRUST_STORAGE_KEY);
  if (!raw) return null;

  let parsed: SealedEnvelope;
  try {
    parsed = JSON.parse(raw) as SealedEnvelope;
  } catch {
    return null;
  }

  if (
    parsed.v !== ENVELOPE_VERSION ||
    !parsed.body ||
    typeof parsed.sigHex !== 'string' ||
    typeof parsed.body.schemaVersion !== 'number'
  ) {
    return null;
  }

  const canon = canonicalStringify(parsed.body);

  if (isNativeKeystoreHmacAvailable()) {
    const ok = await nativeVerifyCanonical(canon, parsed.sigHex);
    if (!ok) return null;
    return parsed.body;
  }

  const seedHex = safeGetRaw(EXPERT_TRUST_SEED_KEY);
  if (!seedHex || seedHex.length !== SEED_HEX_LEN) return null;

  let key: CryptoKey;
  try {
    key = await importHmacKey(seedHex);
  } catch {
    return null;
  }

  let expected: ArrayBuffer;
  try {
    expected = await hmacSignUtf8(key, canon);
  } catch {
    return null;
  }
  const expectedHex = bytesToHex(expected);

  if (!timingSafeEqualHex(expectedHex, parsed.sigHex)) return null;

  return parsed.body;
}
