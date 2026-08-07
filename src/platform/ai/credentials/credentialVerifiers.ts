/**
 * credentialVerifiers — sağlayıcı başına EN DÜŞÜK MALİYETLİ doğrulama.
 *
 * Ortak kurallar (hepsi `httpProbe` tarafından zorlanır):
 *  - Anahtar YALNIZ header'da gider — URL query parametresine ASLA yazılmaz
 *    (Gemini'nin `?key=` biçimi BİLİNÇLİ olarak kullanılmaz; `x-goog-api-key`
 *    header'ı tercih edilir).
 *  - Streaming YOK · gövde ya hiç yok ya da mümkün olan en küçüğü.
 *  - Timeout DESTEKLİ (AbortController + setTimeout — eski WebView güvenli;
 *    `AbortSignal.timeout` Chrome 103+ olduğu için kullanılmaz).
 *  - ASLA throw etmez; her sonuç tipli `ApiCredentialStatus`.
 *  - Yanıt GÖVDESİ OKUNMAZ (gereksiz trafik + gövdedeki olası sırların bellekte
 *    dolaşması yok) — yalnız HTTP durumu sınıflandırılır.
 */

import type { AiErrorKind } from '../gateway/types';
import type { ApiCredentialStatus, CredentialVerifyOptions } from './credentialTypes';

const DEFAULT_TIMEOUT_MS = 8_000;

/**
 * AI Gateway hata sınıfı → kullanıcı durumu. Gateway üzerinden doğrulanan
 * sağlayıcılar (OpenRouter) bu eşlemeyi kullanır; HTTP tabanlı doğrulayıcılar
 * `statusFromHttp` kullanır. İki yol da AYNI `ApiCredentialStatus` birliğine çıkar.
 */
export function statusFromGatewayErrorKind(kind: AiErrorKind): ApiCredentialStatus {
  switch (kind) {
    case 'no_api_key':   return 'not_configured';
    case 'auth':         return 'invalid_key';
    case 'rate_limited': return 'rate_limited';
    case 'network':
    case 'timeout':
    case 'offline':      return 'offline';
    case 'server':
    case 'circuit_open': return 'service_unavailable';
    default:             return 'unknown_error';
  }
}

/** HTTP durumu → kullanıcı durumu (tüm sağlayıcılar için ORTAK yorum). */
export function statusFromHttp(status: number): ApiCredentialStatus {
  if (status >= 200 && status < 300) return 'connected';
  if (status === 401 || status === 403) return 'invalid_key';
  if (status === 402 || status === 429) return 'rate_limited';   // kota/bakiye/hız
  if (status >= 500) return 'service_unavailable';
  if (status >= 400) return 'unknown_error';                      // beklenmeyen 4xx
  return 'unknown_error';
}

/** Timeout'lu sinyal — eski WebView'da da çalışır, timer'ı temizler (zero-leak). */
function makeSignal(timeoutMs: number): { signal?: AbortSignal; dispose: () => void } {
  try {
    const ctrl  = new AbortController();
    const timer = setTimeout(() => { ctrl.abort(); }, timeoutMs);
    return { signal: ctrl.signal, dispose: () => { clearTimeout(timer); } };
  } catch {
    return { signal: undefined, dispose: () => {} };
  }
}

interface ProbeSpec {
  readonly url:      string;
  readonly method:   'GET' | 'POST';
  readonly headers:  Record<string, string>;
  readonly body?:    string;
}

/**
 * Tek noktadan HTTP doğrulama. Anahtarın header dışına sızmadığını YAPISAL
 * olarak garanti eder: `url` çağıran tarafından sabit verilir, anahtar yalnız
 * `headers` içine konur.
 */
async function httpProbe(spec: ProbeSpec, options?: CredentialVerifyOptions): Promise<ApiCredentialStatus> {
  const fetchImpl = options?.fetchImpl ?? (typeof fetch === 'function' ? fetch.bind(globalThis) : undefined);
  if (typeof fetchImpl !== 'function') return 'unknown_error';

  const { signal, dispose } = makeSignal(options?.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const response = await fetchImpl(spec.url, {
      method:  spec.method,
      headers: spec.headers,
      ...(spec.body !== undefined ? { body: spec.body } : {}),
      ...(signal ? { signal } : {}),
    });
    if (!response || typeof response.status !== 'number') return 'unknown_error';
    return statusFromHttp(response.status);        // gövde OKUNMAZ
  } catch {
    // Abort (timeout) / DNS / kopma — hepsi kullanıcı için "bağlantı kurulamadı".
    return 'offline';
  } finally {
    dispose();
  }
}

/* ── Sağlayıcı doğrulayıcıları ─────────────────────────────────────────────── */

/**
 * Gemini — `GET /v1beta/models`: model LİSTESİ döner, üretim yapmaz → SIFIR token.
 * Anahtar `x-goog-api-key` header'ında (mevcut kodun POST çağrılarıyla aynı
 * yöntem); `?key=` query biçimi KULLANILMAZ.
 */
export function verifyGeminiKey(apiKey: string, options?: CredentialVerifyOptions): Promise<ApiCredentialStatus> {
  return httpProbe({
    url:     'https://generativelanguage.googleapis.com/v1beta/models',
    method:  'GET',
    headers: { 'x-goog-api-key': apiKey },
  }, options);
}

/**
 * Groq — `GET /openai/v1/models`: OpenAI-uyumlu model listesi → SIFIR token.
 * (NOT: bu "Groq" LPU çıkarım servisidir; xAI'nin "Grok" modeli DEĞİLDİR.)
 */
export function verifyGroqKey(apiKey: string, options?: CredentialVerifyOptions): Promise<ApiCredentialStatus> {
  return httpProbe({
    url:     'https://api.groq.com/openai/v1/models',
    method:  'GET',
    headers: { 'Authorization': `Bearer ${apiKey}` },
  }, options);
}

/**
 * Claude Haiku (Anthropic) — `GET /v1/models`: model listesi, üretim yok → SIFIR
 * token. `anthropic-version` zorunlu; tarayıcı/WebView'dan doğrudan çağrı için
 * `anthropic-dangerous-direct-browser-access` gerekir (mevcut POST çağrılarıyla
 * aynı yöntem). Anahtar `x-api-key` header'ında.
 */
export function verifyHaikuKey(apiKey: string, options?: CredentialVerifyOptions): Promise<ApiCredentialStatus> {
  return httpProbe({
    url:     'https://api.anthropic.com/v1/models',
    method:  'GET',
    headers: {
      'x-api-key':                                  apiKey,
      'anthropic-version':                          '2023-06-01',
      'anthropic-dangerous-direct-browser-access':  'true',
    },
  }, options);
}

/**
 * Tavily — ücretsiz metadata/anahtar uç noktası YOKTUR. En düşük maliyetli
 * doğrulama mümkün olan EN KÜÇÜK aramadır: tek karakterlik sorgu, `max_results:1`,
 * `basic` derinlik, ek alan yok. ⚠️ Bu çağrı hesabın 1 ARAMA KREDİSİNİ harcar
 * (descriptor'da `verifyCostsQuota: true` ile işaretlidir) — yalnız kullanıcı
 * "Test Et" dediğinde çalışır, otomatik tetiklenmez.
 */
export function verifyTavilyKey(apiKey: string, options?: CredentialVerifyOptions): Promise<ApiCredentialStatus> {
  return httpProbe({
    url:     'https://api.tavily.com/search',
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body:    JSON.stringify({ query: 'a', max_results: 1, search_depth: 'basic' }),
  }, options);
}

/**
 * OpenRouter — doğrulama AI Gateway'in kendi yoluna DEVREDİLİR (kod
 * tekrarlanmaz): sağlayıcının `verifyKey` yeteneği `GET /key` metadata uç
 * noktasını kullanır → SIFIR token, gövdesiz.
 *
 * ⚠️ Gateway KAYITLI anahtarı doğrular; bu yüzden bu doğrulayıcı yalnız
 * kaydedilmiş anahtar için anlamlıdır (manager zaten kaydettikten sonra çağırır).
 */
export async function verifyOpenRouterKey(_apiKey: string, options?: CredentialVerifyOptions): Promise<ApiCredentialStatus> {
  try {
    const { verifyDefaultAiConnection } = await import('../gateway/concrete/defaultAiGateway');
    const result = await verifyDefaultAiConnection(options?.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    if (result.ok) return 'connected';
    return result.error ? statusFromGatewayErrorKind(result.error.kind) : 'unknown_error';
  } catch {
    return 'unknown_error';
  }
}

/* ── Adres/geocoding sağlayıcıları (BYOK) ──────────────────────────────────
 * Bu üçü YAPAY ZEKÂ anahtarı DEĞİLDİR; adres çözümleme sağlayıcılarıdır
 * (bkz. geocodingProviders.ts). Aynı deftere alınmalarının sebebi kayıt,
 * maskeleme, Keystore kurtarma ve ayarlar panelinin ZATEN sağlayıcı-bağımsız
 * olmasıdır — sıfır kopya kod.
 *
 * Doğrulama en ucuz gerçek sorguyla yapılır (metadata uç noktaları yok):
 * tek, sabit ve minik bir adres araması. Bu bir istek harcar → tanımda
 * `verifyCostsQuota: true` işaretlidir, kullanıcı bunu görür.
 *
 * ⚠️ HTTP durumu tek başına yetmez: Google anahtar geçersizken bile 200 döner
 * ve gövdede `REQUEST_DENIED` yazar. Bu yüzden Google'da gövde OKUNUR.
 */
export async function verifyGeocodeGoogleKey(apiKey: string, options?: CredentialVerifyOptions): Promise<ApiCredentialStatus> {
  const fetchImpl = options?.fetchImpl ?? (typeof fetch === 'function' ? fetch.bind(globalThis) : undefined);
  if (typeof fetchImpl !== 'function') return 'unknown_error';
  const { signal, dispose } = makeSignal(options?.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=Ankara&key=${encodeURIComponent(apiKey)}`;
    const res = await fetchImpl(url, { ...(signal ? { signal } : {}) });
    if (!res || typeof res.status !== 'number') return 'unknown_error';
    if (res.status !== 200) return statusFromHttp(res.status);
    const body = (await res.json()) as { status?: string };
    if (body.status === 'OK' || body.status === 'ZERO_RESULTS') return 'connected';
    if (body.status === 'REQUEST_DENIED' || body.status === 'INVALID_REQUEST') return 'invalid_key';
    if (body.status === 'OVER_QUERY_LIMIT') return 'rate_limited';
    return 'unknown_error';
  } catch {
    return 'offline';
  } finally {
    dispose();
  }
}

export function verifyGeocodeHereKey(apiKey: string, options?: CredentialVerifyOptions): Promise<ApiCredentialStatus> {
  return httpProbe({
    url:     `https://geocode.search.hereapi.com/v1/geocode?q=Ankara&apiKey=${encodeURIComponent(apiKey)}`,
    method:  'GET',
    headers: { 'Accept': 'application/json' },
  }, options);
}

export function verifyGeocodeYandexKey(apiKey: string, options?: CredentialVerifyOptions): Promise<ApiCredentialStatus> {
  return httpProbe({
    url:     `https://geocode-maps.yandex.ru/1.x/?apikey=${encodeURIComponent(apiKey)}&geocode=Ankara&format=json&results=1`,
    method:  'GET',
    headers: { 'Accept': 'application/json' },
  }, options);
}
