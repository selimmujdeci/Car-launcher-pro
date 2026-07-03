/**
 * keyBeamCrypto.ts — "QR Key Beam" şifreleme katmanı (köprü sayfa / telefon tarafı).
 *
 * Araç tarafındaki karşılığı: src/platform/keyBeamCrypto.ts (aynı repo, farklı
 * çalışma zamanı — kod burada KOPYALANIR, import edilemez çünkü website/ ayrı
 * bir Next.js paketi). Kriptografi sözleşmesi BİREBİR aynı olmalı:
 *
 *   - Anahtar: 32 bayt, URL fragment'ından base64url ile okunur (araç üretir).
 *   - iv: 12 rastgele bayt, bu modül üretir, standart base64 ile kodlanır.
 *   - ciphertext: AES-256-GCM(UTF-8 plaintext, iv, key), standart base64.
 *
 * Anahtar URL fragment'ından (#k=...) okunur — tarayıcı bunu ASLA sunucuya
 * göndermez (fragment navigation/network request'e dahil olmaz). Bu modül
 * yalnızca ciphertext + iv'yi Supabase'e yazar; plaintext API key hiçbir
 * zaman ağa çıkmaz.
 */

// ── Base64 / Base64url yardımcıları ───────────────────────────────────────────

function b64enc(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function b64urlToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// ── Anahtar / şifreleme ────────────────────────────────────────────────────────

/** URL fragment'ından (#k=...) gelen base64url anahtarı WebCrypto AES-GCM anahtarına dönüştürür. */
export async function importBeamKey(keyB64url: string): Promise<CryptoKey> {
  const raw = b64urlToBytes(keyB64url);
  return crypto.subtle.importKey('raw', raw.buffer as ArrayBuffer, { name: 'AES-GCM' }, false, ['encrypt']);
}

export interface BeamCiphertext {
  ciphertext: string; // base64
  iv:         string; // base64
}

/** API key metnini araçtan gelen anahtarla şifreler. Plaintext hiçbir yere yazılmaz/loglanmaz. */
export async function encryptBeamPayload(plaintext: string, key: CryptoKey): Promise<BeamCiphertext> {
  const iv     = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(plaintext),
  );
  return { ciphertext: b64enc(new Uint8Array(cipher)), iv: b64enc(iv) };
}

/**
 * QR beam ile aktarılabilen API anahtar formatları — CarOS Pro (SettingsPage/
 * AIVoicePanel) ile AYNI: Gemini · Groq · Haiku · Tavily.
 * (Eskiden yalnız Gemini kabul ediliyordu → Tavily/Groq/Haiku QR ile getirilemiyordu.)
 */
export const API_KEY_BEAM_REGEX = /^(AIza[A-Za-z0-9_-]{35,}|AQ\.[A-Za-z0-9_.-]{20,}|gsk_[A-Za-z0-9]{20,}|sk-ant-[A-Za-z0-9_-]{20,}|tvly-[A-Za-z0-9_-]{10,})$/;
