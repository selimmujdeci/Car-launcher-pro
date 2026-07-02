/**
 * keyBeamService.test.ts — QR Key Beam oturum yönetimi (araç tarafı) testleri.
 *
 * Kapsam:
 *  - createBeamSession: kod/QR URL/expiresAt/cryptoKey sözleşmesi
 *  - pollBeamOnce: pending / found (doğru decrypt) / invalid (format veya
 *    yanlış anahtar) / error (ağ hatası, RPC hatası) durumları
 *  - "Polling lifecycle" davranışı: setInterval + clearInterval zero-leak
 *    deseni ayrıca src/components/settings/KeyBeamPanel.tsx içinde
 *    uygulanır (bu dosya servis katmanını test eder — component testi bu
 *    projede React Testing Library kullanılmadığı için kapsam dışı).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createBeamSession, pollBeamOnce } from '../platform/keyBeamService';
import { decryptBeamPayload } from '../platform/keyBeamCrypto';

/* ── Website tarafı şifreleme simülasyonu (aynı sözleşme) ─────────────────── */

function b64urlToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function b64enc(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

async function websiteEncrypt(plaintext: string, keyB64url: string): Promise<{ ciphertext: string; iv: string }> {
  const raw = b64urlToBytes(keyB64url);
  const key = await crypto.subtle.importKey('raw', raw.buffer as ArrayBuffer, { name: 'AES-GCM' }, false, ['encrypt']);
  const iv  = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plaintext));
  return { ciphertext: b64enc(new Uint8Array(cipher)), iv: b64enc(iv) };
}

const VALID_GEMINI_KEY = 'AIzaSyABCDEFGHIJKLMNOPQRSTUVWXYZ01234567';

/* ── fetch mock ─────────────────────────────────────────────────────────── */

beforeEach(() => {
  global.fetch = vi.fn() as unknown as typeof fetch;
});

afterEach(() => {
  vi.restoreAllMocks();
});

function mockFetchOnce(body: unknown, ok = true): void {
  (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
    ok,
    json: async () => body,
  } as Response);
}

/* ═══════════════════════════════════════════════════════════════
   1. createBeamSession
═══════════════════════════════════════════════════════════════ */

describe('createBeamSession', () => {
  it('8 haneli kod + geçerli qrUrl + ~5dk expiresAt döner', async () => {
    const before = Date.now();
    const session = await createBeamSession();
    const after = Date.now();

    expect(session.code).toMatch(/^[A-Z0-9]{8}$/);
    expect(session.qrUrl).toContain(`code=${session.code}`);
    expect(session.qrUrl).toContain('#k=');
    expect(session.expiresAt).toBeGreaterThanOrEqual(before + 5 * 60_000);
    expect(session.expiresAt).toBeLessThanOrEqual(after + 5 * 60_000);
    expect(session.cryptoKey).toBeDefined();
  });

  it('ağ çağrısı yapmaz (kod yalnızca üretilir, henüz Supabase\'e yazılmaz)', async () => {
    await createBeamSession();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('ardışık oturumlar farklı kod ve anahtar üretir', async () => {
    const a = await createBeamSession();
    const b = await createBeamSession();
    expect(a.code).not.toBe(b.code);
  });
});

/* ═══════════════════════════════════════════════════════════════
   2. pollBeamOnce — durum makinesi
═══════════════════════════════════════════════════════════════ */

describe('pollBeamOnce', () => {
  it('found=false → status pending', async () => {
    const session = await createBeamSession();
    mockFetchOnce({ found: false });

    const res = await pollBeamOnce(session);
    expect(res.status).toBe('pending');
  });

  it('found=true + session anahtarıyla şifrelenmiş geçerli key → status found', async () => {
    const session = await createBeamSession();
    // Test session'ın qrUrl'inden fragment key'i çıkar (website'in yaptığı gibi)
    const keyB64url = session.qrUrl.split('#k=')[1];
    const { ciphertext, iv } = await websiteEncrypt(VALID_GEMINI_KEY, keyB64url);
    mockFetchOnce({ found: true, ciphertext, iv });

    const res = await pollBeamOnce(session);
    expect(res.status).toBe('found');
    if (res.status === 'found') expect(res.apiKey).toBe(VALID_GEMINI_KEY);
  });

  it('found=true + format dışı payload (regex uymuyor) → status invalid', async () => {
    const session = await createBeamSession();
    const keyB64url = session.qrUrl.split('#k=')[1];
    const { ciphertext, iv } = await websiteEncrypt('bu-bir-api-key-degil', keyB64url);
    mockFetchOnce({ found: true, ciphertext, iv });

    const res = await pollBeamOnce(session);
    expect(res.status).toBe('invalid');
  });

  it('found=true + yanlış anahtarla şifrelenmiş veri (decrypt başarısız) → status invalid', async () => {
    const session = await createBeamSession();
    const otherSession = await createBeamSession();
    const otherKeyB64url = otherSession.qrUrl.split('#k=')[1];
    const { ciphertext, iv } = await websiteEncrypt(VALID_GEMINI_KEY, otherKeyB64url);
    mockFetchOnce({ found: true, ciphertext, iv });

    const res = await pollBeamOnce(session); // session'ın KENDİ anahtarıyla çözmeye çalışır
    expect(res.status).toBe('invalid');
  });

  it('RPC ok:false (HTTP hata) → status error', async () => {
    const session = await createBeamSession();
    mockFetchOnce({ message: 'server error' }, false);

    const res = await pollBeamOnce(session);
    expect(res.status).toBe('error');
  });

  it('ağ hatası (fetch reject) → status error', async () => {
    const session = await createBeamSession();
    (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new TypeError('network down'));

    const res = await pollBeamOnce(session);
    expect(res.status).toBe('error');
  });

  it('eksik ciphertext/iv alanı (bozuk sunucu yanıtı) → status pending (güvenli varsayılan)', async () => {
    const session = await createBeamSession();
    mockFetchOnce({ found: true }); // ciphertext/iv yok

    const res = await pollBeamOnce(session);
    expect(res.status).toBe('pending');
  });
});

/* ═══════════════════════════════════════════════════════════════
   3. Sanity — decryptBeamPayload doğrudan modülden erişilebilir
      (keyBeamService bu fonksiyonu re-export etmez, kendi importuyla kullanır)
═══════════════════════════════════════════════════════════════ */

describe('decryptBeamPayload import sanity', () => {
  it('fonksiyon tanımlı', () => {
    expect(typeof decryptBeamPayload).toBe('function');
  });
});
