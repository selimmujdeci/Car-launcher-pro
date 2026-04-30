/**
 * commandCrypto.ts — AES-256-GCM komut payload şifreleme/deşifreleme.
 * Format: { iv: "<base64-12B>", data: "<base64-ciphertext>" }
 */

const PBKDF2_SALT  = 'caros-cmd-crypto-v1';
const PBKDF2_ITERS = 100_000;

export interface EncryptedPayload {
  iv:   string;
  data: string;
}

const _keyCache = new Map<string, Promise<CryptoKey>>();

function _deriveKey(apiKey: string): Promise<CryptoKey> {
  const cached = _keyCache.get(apiKey);
  if (cached) return cached;
  const promise = (async () => {
    const enc = new TextEncoder();
    const raw = await crypto.subtle.importKey(
      'raw', enc.encode(apiKey), { name: 'PBKDF2' }, false, ['deriveKey'],
    );
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: enc.encode(PBKDF2_SALT), iterations: PBKDF2_ITERS, hash: 'SHA-256' },
      raw,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    );
  })();
  _keyCache.set(apiKey, promise);
  return promise;
}

export async function encryptPayload(
  payload: Record<string, unknown>,
  apiKey:  string,
): Promise<EncryptedPayload> {
  const key    = await _deriveKey(apiKey);
  const iv     = crypto.getRandomValues(new Uint8Array(12));
  const plain  = new TextEncoder().encode(JSON.stringify(payload));
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plain);
  const toBase64 = (buf: Uint8Array) => btoa(Array.from(buf, (b) => String.fromCharCode(b)).join(''));
  return {
    iv:   toBase64(iv),
    data: toBase64(new Uint8Array(cipher)),
  };
}

export function isEncryptedPayload(payload: Record<string, unknown>): boolean {
  return typeof payload.iv === 'string' && typeof payload.data === 'string' && Object.keys(payload).length === 2;
}
