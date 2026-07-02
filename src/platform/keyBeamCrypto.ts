/**
 * keyBeamCrypto.ts — "QR Key Beam" şifreleme katmanı (araç tarafı).
 *
 * Akış (bkz. keyBeamService.ts + KeyBeamPanel.tsx):
 *   1. Araç rastgele bir eşleşme kodu + tek kullanımlık AES-256-GCM anahtarı üretir.
 *      Anahtar SADECE RAM'de tutulur — hiçbir zaman diske/Supabase'e yazılmaz.
 *   2. QR: köprü sayfa URL'si + kod (query, sunucuya gider) + anahtar (# fragment,
 *      TARAYICI DIŞINA HİÇ GİTMEZ — fragment sunucuya asla iletilmez).
 *   3. Telefondaki köprü sayfası anahtarı fragment'tan okuyup API key'i AES-GCM ile
 *      şifreler, yalnızca ciphertext'i Supabase'e yazar (zero-plaintext).
 *   4. Araç consume_key_beam RPC'sini poll eder, ciphertext'i RAM'deki anahtarla
 *      çözer, formatı doğrular.
 *
 * Zero-Trust: Supabase hiçbir zaman düz metin API anahtarı görmez.
 */

// ── Sabitler ─────────────────────────────────────────────────────────────────

/** Karışabilecek karakterler (0/O, 1/I/L) hariç tutulur — kullanıcı elle girerse okunaklı. */
const CODE_CHARSET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const KEY_BEAM_CODE_LENGTH = 8;

/** QR/Supabase satırının geçerlilik süresi. */
export const KEY_BEAM_TTL_MS = 5 * 60_000;

/** Gemini API key formatı — SettingsPage'deki (AIVoicePanel) regex ile AYNI. */
export const GEMINI_KEY_BEAM_REGEX = /^(AIza[A-Za-z0-9_-]{35,}|AQ\.[A-Za-z0-9_.-]{20,})$/;

// ── Base64 / Base64url yardımcıları ───────────────────────────────────────────

function _b64dec(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}

function _b64urlEnc(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// ── Kod üretimi ────────────────────────────────────────────────────────────────

/** Rastgele 8 haneli eşleşme kodu (Crockford benzeri, karışabilir karakter yok). */
export function generateBeamCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(KEY_BEAM_CODE_LENGTH));
  let out = '';
  for (let i = 0; i < bytes.length; i++) out += CODE_CHARSET[bytes[i] % CODE_CHARSET.length];
  return out;
}

// ── Anahtar üretimi ─────────────────────────────────────────────────────────────

export interface BeamKeyMaterial {
  /** WebCrypto AES-GCM anahtarı — decrypt için, RAM'de tutulur. */
  cryptoKey: CryptoKey;
  /** QR URL fragment'ına gömülecek base64url-encoded ham anahtar. */
  keyB64url: string;
}

/**
 * Tek kullanımlık AES-256-GCM anahtarı üretir. Ham baytlar base64url ile
 * kodlanır (URL fragment'ı için güvenli) — Supabase'e ASLA gönderilmez.
 */
export async function generateBeamKey(): Promise<BeamKeyMaterial> {
  const raw = crypto.getRandomValues(new Uint8Array(32));
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    raw.buffer as ArrayBuffer,
    { name: 'AES-GCM' },
    false,
    ['decrypt'],
  );
  return { cryptoKey, keyB64url: _b64urlEnc(raw) };
}

// ── Deşifreleme (araç tarafı) ────────────────────────────────────────────────────

/**
 * Telefonun köprü sayfasından gelen şifreli API key'i çözer.
 * @throws Error — bozuk veri, yanlış anahtar veya geçersiz ciphertext.
 */
export async function decryptBeamPayload(
  ciphertext: string,
  iv:         string,
  cryptoKey:  CryptoKey,
): Promise<string> {
  try {
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: _b64dec(iv) },
      cryptoKey,
      _b64dec(ciphertext),
    );
    return new TextDecoder().decode(plain);
  } catch {
    throw new Error('KeyBeam: decryption failed (invalid key or corrupted data)');
  }
}
