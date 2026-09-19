/**
 * googleAuth — Google service-account → OAuth2 access token (FCM HTTP v1 için).
 *
 * ── NEDEN VAR (PROD-1A ÖLÇÜMÜ) ───────────────────────────────────────────
 * `index.ts` FCM **HTTP v1** ucuna (`/v1/projects/{id}/messages:send`) gidip
 * `Authorization: Bearer ${FCM_SERVER_KEY}` gönderiyordu. HTTP v1 legacy
 * server key KABUL ETMEZ; kısa ömürlü bir **OAuth2 access token** ister.
 * Yani taşıma katmanı hiçbir secret kombinasyonuyla çalışamazdı.
 *
 * ── TASARIM ──────────────────────────────────────────────────────────────
 * `pushAuth.ts` ile aynı desen: I/O **dependency injection** ile gelir, böylece
 * gerçek credential ve ağ olmadan birim testi yazılabilir. Büyük Firebase
 * Admin / Google SDK bağımlılığı EKLENMEZ — yalnız standart Web Crypto
 * (RS256) + `fetch`. Özel kripto primitifi YAZILMAZ.
 *
 * ── GİZLİLİK ─────────────────────────────────────────────────────────────
 * private_key, service-account JSON, JWT assertion ve access_token bu
 * modülden DIŞARI YALNIZ imzalı/kullanılacak değer olarak çıkar; hiçbiri
 * loglanmaz, hata sebebine konmaz. Hata sebepleri KATEGORİDİR.
 */

/** FCM HTTP v1 için gereken tek kapsam (en dar). */
export const FCM_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';

/** Google'ın kanonik token ucu — service account `token_uri` vermezse bu kullanılır. */
export const DEFAULT_TOKEN_URI = 'https://oauth2.googleapis.com/token';

/** Assertion ömrü — Google azami 1 saate izin verir. */
export const ASSERTION_LIFETIME_SEC = 3600;

/**
 * Cache güvenlik payı: access token'ı sona ermesine bu kadar kala BIRAK.
 * Saat sapması ve uçuş süresi buraya sığar; süresi dolmuş token KULLANILMAZ.
 */
export const TOKEN_EXPIRY_SKEW_MS = 60_000;

export interface ServiceAccount {
  projectId:     string;
  clientEmail:   string;
  privateKeyPem: string;
  tokenUri:      string;
}

export type ServiceAccountError =
  | 'MISSING_SECRET'
  | 'INVALID_JSON'
  | 'MISSING_PROJECT_ID'
  | 'MISSING_CLIENT_EMAIL'
  | 'MISSING_PRIVATE_KEY'
  | 'INVALID_TOKEN_URI';

export type ServiceAccountResult =
  | { ok: true;  account: ServiceAccount }
  | { ok: false; reason: ServiceAccountError };

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/**
 * Service-account JSON'ını KATI biçimde ayrıştırır (fail-closed).
 *
 * `private_key` normalizasyonu: secret bir ortam değişkeninde taşındığında
 * satır sonları çoğu zaman `\n` ESCAPE'i olarak saklanır. Gerçek satır sonuna
 * çevrilmezse PEM ayrıştırılamaz. Bu YALNIZ biçim düzeltmesidir; anahtarın
 * içeriğine dokunulmaz ve geçersiz bir anahtar "geçerli" hâle GETİRİLMEZ.
 *
 * `token_uri` doğrulaması bilinçlidir: assertion, imzalı bir kimlik kanıtıdır.
 * Kurcalanmış bir secret onu saldırgan bir uca yönlendirebilseydi, kanıt
 * sızdırılırdı. Bu yüzden yalnız `https` + `*.googleapis.com` kabul edilir.
 */
export function parseServiceAccount(raw: string | null | undefined): ServiceAccountResult {
  if (!raw || !raw.trim()) return { ok: false, reason: 'MISSING_SECRET' };

  let json: Record<string, unknown>;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ok: false, reason: 'INVALID_JSON' };
    }
    json = parsed as Record<string, unknown>;
  } catch {
    /* Ayrıştırma hatasının METNİ anahtar parçası içerebilir — ASLA taşınmaz. */
    return { ok: false, reason: 'INVALID_JSON' };
  }

  const projectId   = str(json.project_id);
  const clientEmail = str(json.client_email);
  const rawKey      = typeof json.private_key === 'string' ? json.private_key : '';
  const tokenUri    = str(json.token_uri) || DEFAULT_TOKEN_URI;

  if (!projectId)   return { ok: false, reason: 'MISSING_PROJECT_ID' };
  if (!clientEmail) return { ok: false, reason: 'MISSING_CLIENT_EMAIL' };

  const privateKeyPem = rawKey.includes('\\n') ? rawKey.replace(/\\n/g, '\n') : rawKey;
  if (!privateKeyPem.includes('-----BEGIN PRIVATE KEY-----')) {
    return { ok: false, reason: 'MISSING_PRIVATE_KEY' };
  }

  let parsedUri: URL;
  try {
    parsedUri = new URL(tokenUri);
  } catch {
    return { ok: false, reason: 'INVALID_TOKEN_URI' };
  }
  if (parsedUri.protocol !== 'https:' ||
      !(parsedUri.hostname === 'googleapis.com' || parsedUri.hostname.endsWith('.googleapis.com'))) {
    return { ok: false, reason: 'INVALID_TOKEN_URI' };
  }

  return { ok: true, account: { projectId, clientEmail, privateKeyPem, tokenUri } };
}

/* ── JWT assertion ───────────────────────────────────────────────────────── */

export interface AssertionClaims {
  iss:   string;
  scope: string;
  aud:   string;
  iat:   number;
  exp:   number;
}

/**
 * Google service-account assertion claim'leri — SAF (saate kör bağımlı değil).
 *
 * `iat` için küçük bir geri kaydırma yapılır: sunucu saati istemciden birkaç
 * saniye geride olduğunda Google `iat` "gelecekte" diye assertion'ı reddeder.
 * `exp` her hâlükârda `iat`ten sonradır ve azami ömrü aşmaz.
 */
export function buildAssertionClaims(
  account:  Pick<ServiceAccount, 'clientEmail' | 'tokenUri'>,
  nowMs:    number,
  lifetimeSec = ASSERTION_LIFETIME_SEC,
): AssertionClaims {
  const nowSec = Math.floor(nowMs / 1000);
  const iat    = nowSec - 10;                                   // saat sapması payı
  const life   = Math.min(Math.max(Math.floor(lifetimeSec), 1), ASSERTION_LIFETIME_SEC);
  return {
    iss:   account.clientEmail,
    scope: FCM_SCOPE,
    aud:   account.tokenUri,
    iat,
    exp:   iat + life,
  };
}

function base64Url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const encodeJson = (v: unknown): string =>
  base64Url(new TextEncoder().encode(JSON.stringify(v)));

/** PKCS#8 PEM → DER. Biçim tanınmazsa `null` (uydurma YOK). */
function pemToDer(pem: string): Uint8Array | null {
  const m = pem.match(/-----BEGIN PRIVATE KEY-----([\s\S]+?)-----END PRIVATE KEY-----/);
  if (!m) return null;
  try {
    const bin = atob(m[1]!.replace(/\s+/g, ''));
    const der = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) der[i] = bin.charCodeAt(i);
    return der;
  } catch {
    return null;
  }
}

/**
 * RS256 imzalı JWT üretir — imzalama STANDART Web Crypto ile yapılır.
 *
 * Başarısızlıkta `null`: istisna metni anahtar parçası taşıyabilir ve bu
 * modülün sözleşmesi "sebep KATEGORİDİR"dir.
 */
export async function signAssertion(
  claims:        AssertionClaims,
  privateKeyPem: string,
  subtle:        SubtleCrypto = crypto.subtle,
): Promise<string | null> {
  const der = pemToDer(privateKeyPem);
  if (!der) return null;

  try {
    const key = await subtle.importKey(
      'pkcs8',
      der as unknown as ArrayBuffer,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    const head = encodeJson({ alg: 'RS256', typ: 'JWT' });
    const body = encodeJson(claims);
    const data = new TextEncoder().encode(`${head}.${body}`);
    const sig  = await subtle.sign('RSASSA-PKCS1-v1_5', key, data as unknown as ArrayBuffer);
    return `${head}.${body}.${base64Url(new Uint8Array(sig))}`;
  } catch {
    return null;
  }
}

/* ── OAuth token exchange ────────────────────────────────────────────────── */

export const JWT_BEARER_GRANT = 'urn:ietf:params:oauth:grant-type:jwt-bearer';

export type AccessTokenFailure =
  | 'ASSERTION_FAILED'
  | 'OAUTH_NETWORK_ERROR'
  | 'OAUTH_HTTP_ERROR'
  | 'OAUTH_BAD_RESPONSE'
  | 'OAUTH_NO_ACCESS_TOKEN';

export type AccessTokenResult =
  | { ok: true;  accessToken: string; expiresAtMs: number }
  | { ok: false; reason: AccessTokenFailure; status?: number };

export interface OAuthDeps {
  now:   () => number;
  fetch: typeof fetch;
  /** Testlerde imzalama sınırını sahtelemek için; üretimde `signAssertion`. */
  sign?: (claims: AssertionClaims, pem: string) => Promise<string | null>;
}

/**
 * Service account → kısa ömürlü access token.
 *
 * ── "HTTP 200" ≠ "TOKEN ALINDI" ──────────────────────────────────────────
 * Yanıt 200 olsa bile `access_token` yoksa BAŞARI DEĞİLDİR. `token_type`
 * bildirilmişse `Bearer` olmalıdır. `expires_in` okunamazsa token bu çağrı
 * için kullanılır ama ÖMRÜ BİLİNMEDİĞİ için önbelleğe alınmaz
 * (`expiresAtMs = now`) — bilinmeyen süreyi "1 saat" diye UYDURMAYIZ.
 */
export async function fetchAccessToken(
  account: ServiceAccount,
  deps:    OAuthDeps,
): Promise<AccessTokenResult> {
  const now       = deps.now();
  const claims    = buildAssertionClaims(account, now);
  const signer    = deps.sign ?? ((c, pem) => signAssertion(c, pem));
  const assertion = await signer(claims, account.privateKeyPem);
  if (!assertion) return { ok: false, reason: 'ASSERTION_FAILED' };

  let res: Response;
  try {
    res = await deps.fetch(account.tokenUri, {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body:    new URLSearchParams({ grant_type: JWT_BEARER_GRANT, assertion }).toString(),
    });
  } catch {
    /* Ağ hatası nesnesi assertion'ı içerebilir (URL/gövde alıntısı) — TAŞINMAZ. */
    return { ok: false, reason: 'OAUTH_NETWORK_ERROR' };
  }

  if (!res.ok) return { ok: false, reason: 'OAUTH_HTTP_ERROR', status: res.status };

  let json: Record<string, unknown>;
  try {
    json = await res.json() as Record<string, unknown>;
  } catch {
    return { ok: false, reason: 'OAUTH_BAD_RESPONSE', status: res.status };
  }

  const accessToken = typeof json.access_token === 'string' ? json.access_token : '';
  if (!accessToken) return { ok: false, reason: 'OAUTH_NO_ACCESS_TOKEN', status: res.status };

  const tokenType = typeof json.token_type === 'string' ? json.token_type.toLowerCase() : '';
  if (tokenType && tokenType !== 'bearer') {
    return { ok: false, reason: 'OAUTH_BAD_RESPONSE', status: res.status };
  }

  const expiresIn = typeof json.expires_in === 'number' && Number.isFinite(json.expires_in)
    ? Math.max(0, Math.floor(json.expires_in))
    : 0;

  return { ok: true, accessToken, expiresAtMs: now + expiresIn * 1000 };
}

/* ── Isolate-ömürlü önbellek ─────────────────────────────────────────────── */

export interface AccessTokenProvider {
  get: () => Promise<AccessTokenResult>;
  /** @internal — testlerde izolasyon. */
  _reset: () => void;
}

/**
 * Tek bir access token'ı isolate ömrü boyunca paylaşır.
 *
 * ── DOĞRULUK ÖNBELLEĞE BAĞLI DEĞİLDİR ────────────────────────────────────
 * `index.ts` token'ı gönderim döngüsünden ÖNCE BİR KEZ alır; yani "bir
 * invocation'da tek OAuth" güvencesi çağrı yapısından gelir, önbellekten
 * değil. Önbellek yalnız ardışık invocation'larda gereksiz tur atmayı keser
 * ve `TOKEN_EXPIRY_SKEW_MS` payıyla SÜRESİ DOLMUŞ token'ı asla vermez.
 * Kalıcı/global bir otorite DEĞİLDİR: isolate ölünce kaybolur.
 */
export function createAccessTokenProvider(
  account: ServiceAccount,
  deps:    OAuthDeps,
): AccessTokenProvider {
  let cached: { accessToken: string; expiresAtMs: number } | null = null;
  let inFlight: Promise<AccessTokenResult> | null = null;

  const get = async (): Promise<AccessTokenResult> => {
    const now = deps.now();
    if (cached && cached.expiresAtMs - TOKEN_EXPIRY_SKEW_MS > now) {
      return { ok: true, accessToken: cached.accessToken, expiresAtMs: cached.expiresAtMs };
    }
    if (inFlight) return inFlight;

    inFlight = fetchAccessToken(account, deps).then((r) => {
      cached   = r.ok ? { accessToken: r.accessToken, expiresAtMs: r.expiresAtMs } : null;
      inFlight = null;
      return r;
    });
    return inFlight;
  };

  return { get, _reset: () => { cached = null; inFlight = null; } };
}
