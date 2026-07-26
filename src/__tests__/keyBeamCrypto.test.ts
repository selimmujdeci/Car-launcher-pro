// @vitest-environment node
// WebCrypto (crypto.subtle) testleri Node realm'de koşar — jsdom'un SubtleCrypto
// wrapper'ı cross-realm ArrayBuffer'ı reddediyor (CI'da "Failed to execute
// 'importKey'... not instance of ArrayBuffer"). Node realm tutarlı. DOM kullanılmıyor.
/**
 * keyBeamCrypto.test.ts — QR Key Beam şifreleme katmanı testleri.
 *
 * Kapsam:
 *  - generateBeamCode: format (uzunluk, karışabilir karakter yok)
 *  - generateBeamKey + decryptBeamPayload: round-trip (website tarafı burada
 *    fragment'taki base64url anahtarı yeniden import ederek simüle edilir —
 *    website/src/lib/keyBeamCrypto.ts ile AYNI sözleşme)
 *  - API_KEY_BEAM_REGEX: SettingsPage ile aynı formatları kabul/red eder (Gemini/Groq/Haiku/Tavily)
 *  - Hata yolları: yanlış anahtar, bozuk ciphertext/iv
 */

import { describe, it, expect } from 'vitest';
import {
  generateBeamCode,
  generateBeamKey,
  decryptBeamPayload,
  API_KEY_BEAM_REGEX,
  KEY_BEAM_CODE_LENGTH,
  KEY_BEAM_TTL_MS,
} from '../platform/keyBeamCrypto';

/* ── Website tarafı simülasyonu (importBeamKey + encryptBeamPayload) ──────────
 * website/src/lib/keyBeamCrypto.ts ayrı bir Next.js paketinde yaşadığı için
 * buradan import edilemez; sözleşmesi (base64url anahtar → AES-256-GCM,
 * rastgele 12B iv, base64 ciphertext) burada yeniden üretilir. */

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

/* ═══════════════════════════════════════════════════════════════
   1. KOD ÜRETİMİ
═══════════════════════════════════════════════════════════════ */

describe('generateBeamCode', () => {
  it(`${KEY_BEAM_CODE_LENGTH} karakter uzunluğunda kod üretir`, () => {
    const code = generateBeamCode();
    expect(code.length).toBe(KEY_BEAM_CODE_LENGTH);
  });

  it('karışabilir karakter içermez (0/O, 1/I/L)', () => {
    const code = generateBeamCode();
    expect(code).not.toMatch(/[01ILO]/);
  });

  it('yalnızca büyük harf + rakam içerir', () => {
    const code = generateBeamCode();
    expect(code).toMatch(/^[A-Z0-9]+$/);
  });

  it('ardışık çağrılar farklı kod üretir (pratik olasılık)', () => {
    const codes = new Set(Array.from({ length: 20 }, () => generateBeamCode()));
    expect(codes.size).toBeGreaterThan(1);
  });
});

/* ═══════════════════════════════════════════════════════════════
   2. ANAHTAR ÜRETİMİ + ROUND-TRIP
═══════════════════════════════════════════════════════════════ */

describe('generateBeamKey + decryptBeamPayload — round-trip', () => {
  it('website tarafında şifrelenen veri araç tarafında doğru çözülür', async () => {
    const { cryptoKey, keyB64url } = await generateBeamKey();
    const { ciphertext, iv } = await websiteEncrypt('AIzaSyABCDEFGHIJKLMNOPQRSTUVWXYZ01234567', keyB64url);

    const decrypted = await decryptBeamPayload(ciphertext, iv, cryptoKey);
    expect(decrypted).toBe('AIzaSyABCDEFGHIJKLMNOPQRSTUVWXYZ01234567');
  });

  it('keyB64url her çağrıda farklıdır (tek kullanımlık)', async () => {
    const a = await generateBeamKey();
    const b = await generateBeamKey();
    expect(a.keyB64url).not.toBe(b.keyB64url);
  });

  it('keyB64url URL-safe (+ / = içermez)', async () => {
    const { keyB64url } = await generateBeamKey();
    expect(keyB64url).not.toMatch(/[+/=]/);
  });

  it('cryptoKey yalnızca decrypt için kullanılabilir (encrypt fırlatır)', async () => {
    const { cryptoKey } = await generateBeamKey();
    await expect(
      crypto.subtle.encrypt({ name: 'AES-GCM', iv: new Uint8Array(12) }, cryptoKey, new Uint8Array(4)),
    ).rejects.toThrow();
  });
});

/* ═══════════════════════════════════════════════════════════════
   3. HATA YOLLARI
═══════════════════════════════════════════════════════════════ */

describe('decryptBeamPayload — hata yolları', () => {
  it('yanlış anahtar → hata fırlatır', async () => {
    const key1 = await generateBeamKey();
    const key2 = await generateBeamKey();
    const { ciphertext, iv } = await websiteEncrypt('AIzaTestKeyXXXXXXXXXXXXXXXXXXXXXXXXX', key1.keyB64url);

    await expect(decryptBeamPayload(ciphertext, iv, key2.cryptoKey)).rejects.toThrow('KeyBeam');
  });

  it('bozuk ciphertext → hata fırlatır', async () => {
    const { cryptoKey, keyB64url } = await generateBeamKey();
    const { iv } = await websiteEncrypt('AIzaTestKeyXXXXXXXXXXXXXXXXXXXXXXXXX', keyB64url);

    await expect(decryptBeamPayload(btoa('TAMPERED'), iv, cryptoKey)).rejects.toThrow('KeyBeam');
  });

  it('bozuk iv → hata fırlatır', async () => {
    const { cryptoKey, keyB64url } = await generateBeamKey();
    const { ciphertext } = await websiteEncrypt('AIzaTestKeyXXXXXXXXXXXXXXXXXXXXXXXXX', keyB64url);

    await expect(decryptBeamPayload(ciphertext, btoa('BADIV12345678'), cryptoKey)).rejects.toThrow('KeyBeam');
  });
});

/* ═══════════════════════════════════════════════════════════════
   4. FORMAT DOĞRULAMA — SettingsPage ile AYNI regex
═══════════════════════════════════════════════════════════════ */

describe('API_KEY_BEAM_REGEX', () => {
  it('geçerli eski Gemini format (AIza...) kabul edilir', () => {
    expect(API_KEY_BEAM_REGEX.test('AIzaSyABCDEFGHIJKLMNOPQRSTUVWXYZ01234567')).toBe(true);
  });

  it('geçerli yeni Gemini format (AQ....) kabul edilir', () => {
    expect(API_KEY_BEAM_REGEX.test('AQ.Ab8xxxxxxxxxxxxxxxxxxxxxxxxxxxx')).toBe(true);
  });

  // QR beam artık yalnız Gemini değil; Groq/Haiku/Tavily de aktarılabilir
  // (SettingsPage clipboard-algılama formatlarıyla birebir aynı).
  it('geçerli Tavily format (tvly-...) kabul edilir', () => {
    expect(API_KEY_BEAM_REGEX.test('tvly-dev-ABCDEFGHIJKLMNOPqrstuvwx')).toBe(true);
  });

  it('geçerli Groq format (gsk_...) kabul edilir', () => {
    expect(API_KEY_BEAM_REGEX.test('gsk_ABCDEFGHIJKLMNOPQRSTUVWX')).toBe(true);
  });

  it('geçerli Haiku format (sk-ant-...) kabul edilir', () => {
    expect(API_KEY_BEAM_REGEX.test('sk-ant-ABCDEFGHIJKLMNOPQRSTUV')).toBe(true);
  });

  it('geçerli OpenRouter format (sk-or-v1-...) kabul edilir', () => {
    expect(API_KEY_BEAM_REGEX.test('sk-or-v1-ABCDEFGHIJKLMNOPqrstuvwx0123456789')).toBe(true);
  });

  it('rastgele metin reddedilir', () => {
    expect(API_KEY_BEAM_REGEX.test('merhaba dünya')).toBe(false);
  });

  it('kısa/eksik AIza reddedilir', () => {
    expect(API_KEY_BEAM_REGEX.test('AIzaShort')).toBe(false);
  });

  it('kısa/eksik tvly reddedilir', () => {
    expect(API_KEY_BEAM_REGEX.test('tvly-')).toBe(false);
  });

  it('kısa/eksik OpenRouter reddedilir (önek doğru ama gövde yok)', () => {
    expect(API_KEY_BEAM_REGEX.test('sk-or-v1-')).toBe(false);
    expect(API_KEY_BEAM_REGEX.test('sk-or-v1-KISA')).toBe(false);
  });

  it('yanlış OpenRouter öneki reddedilir (sk-or- ama v1 yok)', () => {
    expect(API_KEY_BEAM_REGEX.test('sk-or-ABCDEFGHIJKLMNOPqrstuvwx')).toBe(false);
  });

  it('boş string reddedilir', () => {
    expect(API_KEY_BEAM_REGEX.test('')).toBe(false);
  });
});

/* ═══════════════════════════════════════════════════════════════
   5. KİLİT — kayıt defteri ile beam regex'i AYNI kümeyi kabul eder

   SAHA KUSURU (2026-07-26): OpenRouter panelde `clipboardPattern` ile TANINIYOR
   ama `keyBeamKind` taşımadığı için QR düğmesi hiç görünmüyordu; düğme eklense
   bile `API_KEY_BEAM_REGEX` `sk-or-v1-...`i REDDEDECEĞİ için akış telefonda
   "format tanınmadı" ile sessizce ölürdü. İki liste ayrı dosyada yaşadığı için
   biri güncellenip diğeri unutulabiliyor.

   DEĞİŞMEZ: `keyBeamKind` taşıyan HER tanımın örnek anahtarı beam regex'inden
   GEÇMELİDİR. Yeni sağlayıcı eklerken bu test, unutulan tarafı kırmızıya çevirir.
═══════════════════════════════════════════════════════════════ */

describe('KİLİT — credentialRegistry ↔ API_KEY_BEAM_REGEX tutarlılığı', () => {
  /** Her beam'lenebilir sağlayıcı için GERÇEKÇİ örnek anahtar (uydurma değil, biçim doğru). */
  const ORNEK: Record<string, string> = {
    gemini:     'AIzaSyABCDEFGHIJKLMNOPQRSTUVWXYZ01234567',
    openrouter: 'sk-or-v1-ABCDEFGHIJKLMNOPqrstuvwx0123456789',
    tavily:     'tvly-dev-ABCDEFGHIJKLMNOPqrstuvwx',
    groq:       'gsk_ABCDEFGHIJKLMNOPQRSTUVWX',
    haiku:      'sk-ant-ABCDEFGHIJKLMNOPQRSTUV',
  };

  it('keyBeamKind taşıyan her tanımın anahtarı beam regex kümesinden GEÇER', async () => {
    const { API_CREDENTIALS } = await import('../platform/ai/credentials/credentialRegistry');
    const beamable = API_CREDENTIALS.filter((c) => c.keyBeamKind);
    expect(beamable.length, 'hiç beam edilebilir sağlayıcı yok — kilit boşa çalışıyor')
      .toBeGreaterThanOrEqual(5);

    const eksik: string[] = [];
    for (const c of beamable) {
      const ornek = ORNEK[c.keyBeamKind!];
      if (!ornek) { eksik.push(`${c.id}: bu teste örnek anahtar eklenmemiş`); continue; }
      // (a) panelin clipboard deseni örneği tanımalı — örnek gerçekçi mi?
      if (c.clipboardPattern && !c.clipboardPattern.test(ornek)) {
        eksik.push(`${c.id}: örnek anahtar clipboardPattern ile uyuşmuyor`);
      }
      // (b) ASIL kilit: beam regex'i de tanımalı
      if (!API_KEY_BEAM_REGEX.test(ornek)) {
        eksik.push(`${c.id}: API_KEY_BEAM_REGEX bu formatı REDDEDİYOR → QR akışı ölü`);
      }
    }
    expect(eksik, `beam regex ile kayıt defteri ayrışmış: ${eksik.join(' | ')}`).toEqual([]);
  });

  it('OpenRouter QR ile aktarılabilir (regresyon: keyBeamKind eksikti)', async () => {
    const { getCredentialDescriptor } = await import('../platform/ai/credentials/credentialRegistry');
    const or = getCredentialDescriptor('openrouter');
    expect(or, 'openrouter tanımı bulunamadı').toBeDefined();
    expect(or!.keyBeamKind, 'OpenRouter QR düğmesi yine kayboldu (keyBeamKind yok)').toBe('openrouter');
  });
});

/* ═══════════════════════════════════════════════════════════════
   5. TTL sabiti
═══════════════════════════════════════════════════════════════ */

describe('KEY_BEAM_TTL_MS', () => {
  it('5 dakika (300_000 ms)', () => {
    expect(KEY_BEAM_TTL_MS).toBe(5 * 60_000);
  });
});
