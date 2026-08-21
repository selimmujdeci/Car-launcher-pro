/**
 * E2E KOMUT ŞİFRELEME — GÖNDEREN UÇ (#672).
 *
 * ── NEDEN VAR ─────────────────────────────────────────────────────────────
 * Araç tarafı `lock · unlock · horn · alarm_on · alarm_off · lights_on ·
 * clear_dtc` komutları için uçtan uca şifreleme ŞART koşuyor ve yalnız
 * `ecdh_v1` zarfını kabul ediyor (`src/platform/commandListener.ts:109,309`).
 * Ama bu zarfı üreten uç **ürün yolunda hiç yazılmamıştı**: `encryptE2EPayload`
 * araç paketinde duruyordu, telefon/panel tarafında sıfır çağıranı vardı ve
 * `website/` içinde `ecdh` geçen tek satır yoktu. Sonuç: her fiziksel komut
 * araçta `Decryption Error` ile reddediliyordu — retry yok, kalıcı.
 * Protokolün araç yarısı canlı, telefon yarısı yoktu.
 *
 * ── SÖZLEŞME (araç tarafıyla BİREBİR aynı olmak ZORUNDA) ──────────────────
 * Kaynak: `src/platform/commandCrypto.ts` (`_ecdhDeriveAes`, `encryptE2EPayload`)
 *   1. Araç public key: SPKI base64, ECDH P-256 (`vehicles.e2e_public_key`)
 *   2. Her mesajda YENİ ephemeral P-256 çifti  → Perfect Forward Secrecy
 *   3. `deriveBits(ECDH, 256)` → HKDF-SHA256, salt = 32 sıfır bayt,
 *      info = "caros-cmd-v1" → AES-GCM 256
 *   4. İç gövdeye `_ts` (Unix ms) ve `_nonce` (16 rastgele bayt, base64)
 *      gömülür → replay koruması; ikisi de ŞİFRENİN İÇİNDE
 *   5. Zarf: `{ type:'ecdh_v1', eph_pub, iv, data, ts }` — dıştaki `ts`
 *      yalnız erken red içindir, otoriter DEĞİLDİR
 *
 * Bu dosya araç kopyasının AYNADIR. İkisi ayrışırsa komutlar sessizce
 * reddedilmeye döner — bu yüzden `e2eCryptoParity.test.ts` iki dosyanın
 * kritik sabitlerini karşılaştırır (#660'ın dersi: iki kopya sessizce ayrışır).
 */

import { getSupabaseBrowserClient } from '@/lib/supabaseBrowser';

/** Araç tarafındaki `HKDF_INFO_STR` ile BİREBİR aynı olmalı. */
export const HKDF_INFO_STR = 'caros-cmd-v1';

/** Araç tarafındaki `E2EEncryptedPayload` ile birebir aynı şekil. */
export interface E2EEncryptedPayload {
  type: 'ecdh_v1';
  eph_pub: string;
  iv: string;
  data: string;
  ts: number;
}

/** Araç tarafının E2E şart koştuğu komutlar (`commandListener.ts:109-117`). */
export const E2E_REQUIRED_COMMANDS: readonly string[] = [
  'lock', 'unlock', 'horn', 'alarm_on', 'alarm_off', 'lights_on', 'clear_dtc',
];

export function requiresE2E(commandType: string): boolean {
  return E2E_REQUIRED_COMMANDS.includes(commandType);
}

/* ── Base64 (araç kopyasıyla aynı) ─────────────────────────────────────── */

function b64enc(buf: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < buf.length; i += 1) bin += String.fromCharCode(buf[i]);
  return btoa(bin);
}

function b64dec(b64: string): Uint8Array {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) arr[i] = bin.charCodeAt(i);
  return arr;
}

/* ── Anahtar türetme — araç tarafının `_ecdhDeriveAes` AYNASI ──────────── */

async function deriveAesKey(privateKey: CryptoKey, publicKey: CryptoKey): Promise<CryptoKey> {
  const bits = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: publicKey },
    privateKey,
    256,
  );
  const hkdf = await crypto.subtle.importKey('raw', bits, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new Uint8Array(32),                    // deterministik sıfır salt
      info: new TextEncoder().encode(HKDF_INFO_STR),
    },
    hkdf,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/* ── Şifreleme ─────────────────────────────────────────────────────────── */

/**
 * Komut gövdesini araç public key'iyle şifreler.
 * Şifreleme yapılamazsa ATAR — sessizce düz metin göndermek, komutun araçta
 * reddedilmesine ve kullanıcının nedenini asla öğrenememesine yol açar.
 */
export async function encryptE2EPayload(
  payload: Record<string, unknown>,
  carPublicKeyB64: string,
): Promise<E2EEncryptedPayload> {
  if (typeof crypto === 'undefined' || !crypto.subtle) {
    throw new Error('E2E şifreleme kullanılamıyor: güvenli bağlam (HTTPS) gerekli.');
  }

  const carPub = await crypto.subtle.importKey(
    'spki',
    b64dec(carPublicKeyB64) as unknown as ArrayBuffer,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  );

  const eph = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveBits'],
  );

  const aesKey = await deriveAesKey(eph.privateKey, carPub);

  const ephSpki = await crypto.subtle.exportKey('spki', eph.publicKey);
  const ephPubB64 = b64enc(new Uint8Array(ephSpki));

  const ts = Date.now();
  const nonce = b64enc(crypto.getRandomValues(new Uint8Array(16)));
  const iv = crypto.getRandomValues(new Uint8Array(12));

  /* `_ts` ve `_nonce` ŞİFRENİN İÇİNE gömülür — dışarıdaki `ts` değiştirilse
     bile araç içerideki değeri doğrular (replay koruması). */
  const inner = new TextEncoder().encode(JSON.stringify({ ...payload, _ts: ts, _nonce: nonce }));
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aesKey, inner);

  return {
    type: 'ecdh_v1',
    eph_pub: ephPubB64,
    iv: b64enc(iv),
    data: b64enc(new Uint8Array(cipher)),
    ts,
  };
}

/* ── Araç public key okuma ─────────────────────────────────────────────── */

export type CarKeyResult =
  | { ok: true; publicKey: string }
  | { ok: false; reason: 'NO_CLIENT' | 'UNREADABLE' | 'NOT_PUBLISHED' };

/**
 * Aracın yayınladığı E2E public key'ini okur.
 *
 * `NOT_PUBLISHED` = araç bu anahtarı henüz yayınlamadı (head unit eski sürüm
 * ya da hiç bağlanmamış). Bu, "şifreleme yapamıyoruz" demektir ve komut
 * GÖNDERİLMEZ — düz metin göndermek araçta sessiz redde dönerdi.
 */
export async function fetchCarPublicKey(vehicleId: string): Promise<CarKeyResult> {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) return { ok: false, reason: 'NO_CLIENT' };
  try {
    const { data, error } = await supabase
      .from('vehicles')
      .select('e2e_public_key')
      .eq('id', vehicleId)
      .maybeSingle();
    if (error) return { ok: false, reason: 'UNREADABLE' };
    const key = (data as { e2e_public_key?: string | null } | null)?.e2e_public_key;
    if (typeof key !== 'string' || key.length === 0) return { ok: false, reason: 'NOT_PUBLISHED' };
    return { ok: true, publicKey: key };
  } catch {
    return { ok: false, reason: 'UNREADABLE' };
  }
}

/** Kullanıcıya gösterilecek gerekçe — sessiz başarısızlık YOK. */
export function carKeyErrorMessage(reason: Exclude<CarKeyResult, { ok: true }>['reason']): string {
  switch (reason) {
    case 'NOT_PUBLISHED':
      return 'Araç güvenlik anahtarını henüz yayınlamadı. Araç bir kez çevrimiçi olduğunda bu komut çalışacak.';
    case 'UNREADABLE':
      return 'Araç güvenlik anahtarı okunamadı. Bağlantınızı kontrol edip tekrar deneyin.';
    case 'NO_CLIENT':
      return 'Oturum bulunamadı. Yeniden giriş yapın.';
  }
}
