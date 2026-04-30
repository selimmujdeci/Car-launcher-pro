/**
 * commandCrypto.ts — Uçtan Uca Şifreleme (E2E) + Legacy PBKDF2 Katmanı.
 *
 * ┌─────────────────────────────────────────────────────────────────┐
 * │  Zero-Trust Mimarisi                                            │
 * │                                                                 │
 * │  Telefon                      Araç (bu modül)                   │
 * │  ──────────────────────       ──────────────────────────────    │
 * │  generateEphemeralKey()       loadOrCreateDeviceKey() (P-256)   │
 * │  ECDH(car_pub, eph_priv)      ECDH(eph_pub, car_priv)           │
 * │  HKDF → AES-256-GCM           HKDF → AES-256-GCM               │
 * │  encrypt({...payload,         decrypt → ts/nonce doğrula         │
 * │           _ts, _nonce})       → temiz payload                   │
 * └─────────────────────────────────────────────────────────────────┘
 *
 * Zero-Plaintext: Supabase'e asla "lock"/"unlock" gibi düz metin gitmez.
 * Performance:    ECDH türetimi Mali-400'de ağır → _privKeyCache ile bir kez
 *                 türetilir, sonraki çağrılar RAM'den <1 μs.
 */

import { safeGetRaw, safeSetRawImmediate } from '../utils/safeStorage';

// ── Sabitler ─────────────────────────────────────────────────────────────────

const DEVICE_PRIV_KEY     = 'car-e2e-private-key';
const DEVICE_PUB_KEY      = 'car-e2e-public-key';
const HKDF_INFO_STR       = 'caros-cmd-v1';
const TIMESTAMP_WINDOW_MS = 30_000;   // 30 s Replay Attack penceresi
const NONCE_WINDOW_MS     = 60_000;   // Nonce TTL (kullanılan nonce'lar bu süre tutulur)

// Legacy PBKDF2
const PBKDF2_SALT  = 'caros-cmd-crypto-v1';
const PBKDF2_ITERS = 100_000;

// ── Tip tanımları ─────────────────────────────────────────────────────────────

/** Legacy PBKDF2/AES-GCM şifreli payload (geriye dönük uyumluluk) */
export interface EncryptedPayload {
  iv:   string;   // base64 12B nonce
  data: string;   // base64 ciphertext
}

/**
 * ECDH P-256 + AES-GCM E2E şifreli payload.
 * Şifreli `data` içinde { ...appPayload, _ts, _nonce } gömülüdür.
 * Dış `ts` yalnızca hızlı erken reddetme içindir (ECDH hesabı yapılmadan).
 */
export interface E2EEncryptedPayload {
  type:    'ecdh_v1';
  eph_pub: string;   // base64 SPKI ephemeral ECDH public key (P-256)
  iv:      string;   // base64 12B AES-GCM nonce
  data:    string;   // base64 AES-GCM ciphertext
  ts:      number;   // Unix ms — hızlı erken red (non-authoritative)
}

// ── Base64 yardımcıları ───────────────────────────────────────────────────────

function _b64enc(buf: Uint8Array): string {
  return btoa(String.fromCharCode(...buf));
}

function _b64dec(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}

// ── Tip koruyucular ───────────────────────────────────────────────────────────

export function isE2EPayload(payload: unknown): payload is E2EEncryptedPayload {
  if (typeof payload !== 'object' || payload === null) return false;
  const p = payload as Record<string, unknown>;
  return (
    p.type    === 'ecdh_v1'     &&
    typeof p.eph_pub === 'string' &&
    typeof p.iv      === 'string' &&
    typeof p.data    === 'string' &&
    typeof p.ts      === 'number'
  );
}

export function isEncryptedPayload(payload: Record<string, unknown>): boolean {
  return (
    typeof payload.iv   === 'string' &&
    typeof payload.data === 'string' &&
    Object.keys(payload).length === 2
  );
}

// ── Nonce deduplication ───────────────────────────────────────────────────────

const _usedNonces = new Map<string, number>(); // nonce → expiry ms

function _checkAndMarkNonce(nonce: string): boolean {
  const now = Date.now();
  _usedNonces.forEach((exp, n) => { if (exp < now) _usedNonces.delete(n); }); // GC
  if (_usedNonces.has(nonce)) return false; // replay
  _usedNonces.set(nonce, now + NONCE_WINDOW_MS);
  return true;
}

// ── ECDH → AES-GCM anahtar türetme ───────────────────────────────────────────

/**
 * ECDH shared bits → HKDF → AES-GCM 256-bit key.
 * Her çağrı ~2–5ms (Mali-400); caller cache'lemeli.
 */
async function _ecdhDeriveAes(privateKey: CryptoKey, publicKey: CryptoKey): Promise<CryptoKey> {
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
      salt: new Uint8Array(32),                              // deterministik sıfır salt
      info: new TextEncoder().encode(HKDF_INFO_STR),
    },
    hkdf,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

// ── Cihaz anahtarı yönetimi ───────────────────────────────────────────────────

let _privKeyCache: CryptoKey | null = null;
let _pubKeyB64Cache: string   | null = null;
let _initPromise: Promise<{ privKey: CryptoKey; pubKeyB64: string }> | null = null;

/**
 * Kalıcı ECDH P-256 anahtar çiftini yükler veya (ilk çalıştırmada) oluşturur.
 *
 * Private key safeStorage'da JWK olarak immediate-write ile saklanır.
 * Public key base64 SPKI olarak döner — çağıran Supabase'e yazar.
 *
 * Performance: ilk çağrı ~10–20ms; sonraki çağrılar <1 μs (RAM cache).
 */
export async function loadOrCreateDeviceKey(): Promise<{ pubKeyB64: string }> {
  if (_privKeyCache && _pubKeyB64Cache) return { pubKeyB64: _pubKeyB64Cache };

  if (_initPromise) {
    const r = await _initPromise;
    return { pubKeyB64: r.pubKeyB64 };
  }

  _initPromise = _doLoadOrCreate();
  const result  = await _initPromise;
  _initPromise  = null;
  return { pubKeyB64: result.pubKeyB64 };
}

async function _doLoadOrCreate(): Promise<{ privKey: CryptoKey; pubKeyB64: string }> {
  // 1. Mevcut anahtar çiftini yüklemeyi dene
  const storedPriv = safeGetRaw(DEVICE_PRIV_KEY);
  const storedPub  = safeGetRaw(DEVICE_PUB_KEY);

  if (storedPriv && storedPub) {
    try {
      const privKey = await crypto.subtle.importKey(
        'jwk',
        JSON.parse(storedPriv) as JsonWebKey,
        { name: 'ECDH', namedCurve: 'P-256' },
        false,
        ['deriveBits'],
      );
      _privKeyCache   = privKey;
      _pubKeyB64Cache = storedPub;
      return { privKey, pubKeyB64: storedPub };
    } catch {
      // JWK bozulmuş — yeni çift oluştur
    }
  }

  // 2. Yeni ECDH P-256 anahtar çifti oluştur
  const pair = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,          // extractable: JWK olarak saklanacak
    ['deriveBits'],
  );

  // 3. Private key → JWK → safeStorage (kritik, immediate write)
  const privJwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
  await safeSetRawImmediate(DEVICE_PRIV_KEY, JSON.stringify(privJwk));

  // 4. Public key → SPKI base64 → safeStorage
  const spki      = await crypto.subtle.exportKey('spki', pair.publicKey);
  const pubKeyB64 = _b64enc(new Uint8Array(spki));
  await safeSetRawImmediate(DEVICE_PUB_KEY, pubKeyB64);

  _privKeyCache   = pair.privateKey;
  _pubKeyB64Cache = pubKeyB64;
  return { privKey: pair.privateKey, pubKeyB64 };
}

/** RAM'deki private key'i döner. loadOrCreateDeviceKey() tamamlandıktan sonra geçerli. */
export function getCarPrivateKey(): CryptoKey | null {
  return _privKeyCache;
}

// ── E2E Şifreleme — Telefon Tarafı Referans İmplementasyonu ─────────────────

/**
 * Komut gönderilmeden önce telefon uygulaması bu fonksiyonu çağırır.
 * carPublicKeyB64: Supabase vehicles tablosundan alınan araç public key (SPKI, base64).
 *
 * Her mesajda yeni ephemeral key → Perfect Forward Secrecy (PFS).
 * ts ve _nonce şifreli veri içine gömülür → Replay Attack koruması.
 */
export async function encryptE2EPayload(
  payload:         Record<string, unknown>,
  carPublicKeyB64: string,
): Promise<E2EEncryptedPayload> {
  // 1. Araç public key'ini SPKI'dan içe aktar
  const carPub = await crypto.subtle.importKey(
    'spki',
    _b64dec(carPublicKeyB64),
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  );

  // 2. Geçici (ephemeral) ECDH anahtar çifti — her mesajda yeni (PFS)
  const eph = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveBits'],
  );

  // 3. ECDH shared secret → AES-256-GCM key
  const aesKey = await _ecdhDeriveAes(eph.privateKey, carPub);

  // 4. Ephemeral public key → SPKI base64
  const ephSpki  = await crypto.subtle.exportKey('spki', eph.publicKey);
  const ephPubB64 = _b64enc(new Uint8Array(ephSpki));

  // 5. Anti-Replay metadata: _ts (otoriter zaman) + _nonce (benzersizlik)
  const ts    = Date.now();
  const nonce = _b64enc(crypto.getRandomValues(new Uint8Array(16)));
  const iv    = crypto.getRandomValues(new Uint8Array(12));

  // Payload içine _ts ve _nonce gömülür → ECDH şifresiyle korunur
  const inner  = new TextEncoder().encode(JSON.stringify({ ...payload, _ts: ts, _nonce: nonce }));
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aesKey, inner);

  return {
    type:    'ecdh_v1',
    eph_pub: ephPubB64,
    iv:      _b64enc(iv),
    data:    _b64enc(new Uint8Array(cipher)),
    ts,      // hızlı erken red için dışarıda plaintext; ECDH öncesi kontrol edilir
  };
}

// ── E2E Deşifreleme — Araç Tarafı ────────────────────────────────────────────

/**
 * Şifreli komutu araç private key'i ile çözer.
 *
 * Başarı: temiz uygulama payload nesnesini döner.
 * Hata:   açıklayıcı mesajla Error fırlatır — çağıran ASLA komutu icra etmemeli.
 *
 * @throws 'Stale Command: Xs old'     — 30 s pencere dışı (erken red, ECDH yapılmadan)
 * @throws 'Stale Command (inner)'     — şifreli _ts tamper edilmiş
 * @throws 'Replay Attack'             — nonce daha önce kullanılmış
 * @throws 'Decryption Error: ...'     — yanlış anahtar, bozuk veri veya geçersiz format
 */
export async function decryptE2EPayload(
  encrypted:  E2EEncryptedPayload,
  carPrivKey: CryptoKey,
): Promise<Record<string, unknown>> {
  // 1. Erken timestamp kontrolü — ECDH hesabından önce (Mali-400 tasarrufu)
  const outerAge = Date.now() - encrypted.ts;
  if (outerAge < 0 || outerAge > TIMESTAMP_WINDOW_MS) {
    throw new Error(`Stale Command: ${Math.round(outerAge / 1000)}s old`);
  }

  // 2. Ephemeral public key'i içe aktar
  let ephPub: CryptoKey;
  try {
    ephPub = await crypto.subtle.importKey(
      'spki',
      _b64dec(encrypted.eph_pub),
      { name: 'ECDH', namedCurve: 'P-256' },
      false,
      [],
    );
  } catch {
    throw new Error('Decryption Error: invalid ephemeral public key');
  }

  // 3. ECDH shared secret → AES key (RAM cache yok — her mesajda farklı ephemeral key)
  let aesKey: CryptoKey;
  try {
    aesKey = await _ecdhDeriveAes(carPrivKey, ephPub);
  } catch {
    throw new Error('Decryption Error: ECDH derivation failed');
  }

  // 4. AES-GCM deşifreleme
  let plain: ArrayBuffer;
  try {
    plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: _b64dec(encrypted.iv) },
      aesKey,
      _b64dec(encrypted.data),
    );
  } catch {
    throw new Error('Decryption Error: invalid ciphertext or wrong key');
  }

  // 5. JSON parse
  let inner: Record<string, unknown>;
  try {
    inner = JSON.parse(new TextDecoder().decode(plain)) as Record<string, unknown>;
  } catch {
    throw new Error('Decryption Error: invalid JSON after decrypt');
  }

  // 6. Otoriter timestamp kontrolü (_ts şifreli içindeydi, manipüle edilemez)
  const innerTs = inner._ts;
  if (typeof innerTs !== 'number') throw new Error('Decryption Error: missing _ts');
  const innerAge = Date.now() - innerTs;
  if (innerAge < 0 || innerAge > TIMESTAMP_WINDOW_MS) {
    throw new Error(`Stale Command (inner): ${Math.round(innerAge / 1000)}s old`);
  }

  // 7. Nonce deduplication — Replay Attack koruması
  const nonce = inner._nonce;
  if (typeof nonce !== 'string' || !_checkAndMarkNonce(nonce)) {
    throw new Error('Replay Attack: nonce already used or missing');
  }

  // 8. Crypto metadata'yı temizle; sadece uygulama payload'unu döndür
  const { _ts: _t, _nonce: _n, ...appPayload } = inner;
  void _t; void _n;
  return appPayload;
}

// ── Legacy PBKDF2 (Geriye Dönük Uyumluluk) ───────────────────────────────────

const _pbkdf2Cache = new Map<string, Promise<CryptoKey>>();

function _derivePbkdf2Key(apiKey: string): Promise<CryptoKey> {
  const hit = _pbkdf2Cache.get(apiKey);
  if (hit) return hit;
  const p = (async () => {
    const enc = new TextEncoder();
    const raw = await crypto.subtle.importKey('raw', enc.encode(apiKey), { name: 'PBKDF2' }, false, ['deriveKey']);
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: enc.encode(PBKDF2_SALT), iterations: PBKDF2_ITERS, hash: 'SHA-256' },
      raw,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    );
  })();
  _pbkdf2Cache.set(apiKey, p);
  return p;
}

export async function encryptPayload(
  payload: Record<string, unknown>,
  apiKey:  string,
): Promise<EncryptedPayload> {
  const key    = await _derivePbkdf2Key(apiKey);
  const iv     = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(JSON.stringify(payload)),
  );
  return { iv: _b64enc(iv), data: _b64enc(new Uint8Array(cipher)) };
}

export async function decryptPayload(
  encrypted: EncryptedPayload,
  apiKey:    string,
): Promise<Record<string, unknown>> {
  const key   = await _derivePbkdf2Key(apiKey);
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: _b64dec(encrypted.iv) },
    key,
    _b64dec(encrypted.data),
  );
  return JSON.parse(new TextDecoder().decode(plain)) as Record<string, unknown>;
}
