/**
 * OpenRouter Provider — `AiProvider` sözleşmesinin İLK gerçek uygulaması.
 *
 * OpenRouter, OpenAI-uyumlu `/chat/completions` uç noktası sunar ve tek
 * anahtarla Claude · GPT · Gemini · DeepSeek · Qwen · Llama · Mistral gibi
 * onlarca modele erişim verir. Bu dosya YALNIZCA TAŞIMA katmanıdır: politika
 * (tekrar/fallback/kapılar) gateway'e aittir.
 *
 * ── SINIRLAR ────────────────────────────────────────────────────────────────
 *  - Mavi'yi/gateway politikasını BİLMEZ; yalnız `AiProviderRequest` alır.
 *  - `generate` ASLA THROW ETMEZ → her hata tipli `AiError` olarak döner.
 *  - API ANAHTARI yalnızca `Authorization` başlığına yazılır; loglanmaz,
 *    sonuç/hata mesajına konmaz, URL'ye/gövdeye KOYULMAZ. Sağlayıcıdan gelen
 *    hata metni de anahtar-benzeri desenlere karşı REDAKTE edilir.
 *  - `fetch` ve anahtar kaynağı DI'dır (test edilebilirlik + zero-leak).
 *
 * ── ESKİ WEBVIEW GERÇEĞİ (head unit) ────────────────────────────────────────
 * Saha cihazlarında WebView Chrome 64-78 olabilir:
 *  - `AbortSignal.timeout` YOK  → timeout `AbortController` + `setTimeout` ile
 *    kurulur (abortCompat ile aynı felsefe; timer `finally`de TEMİZLENİR).
 *  - `Response.body` (ReadableStream) OLMAYABİLİR → streaming istendiğinde
 *    gövde okunamazsa TAM METİN alınıp aynı SSE ayrıştırıcıdan geçirilir
 *    (token'lar tek seferde teslim edilir; istek DÜŞMEZ — fail-soft).
 */

import type {
  AiError,
  AiErrorKind,
  AiGenerateResult,
  AiApiKeySource,
  AiKeyVerification,
  AiKeyVerifyOptions,
  AiProvider,
  AiProviderCallOptions,
  AiProviderRequest,
  AiUsage,
} from '../types';

export const OPEN_ROUTER_PROVIDER_ID = 'openrouter';

const DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1';
/** Sağlayıcı hata gövdesinden sonuca taşınacak azami karakter (log şişmesi yok). */
const MAX_ERROR_BODY_CHARS = 200;
/** Anahtar doğrulama isteği için varsayılan kısa bütçe (ayarlar ekranı bekler). */
const DEFAULT_VERIFY_TIMEOUT_MS = 8_000;

export interface OpenRouterProviderDependencies {
  /** BYOK anahtar kaynağı (boş string → anahtar yok → ağa ÇIKILMAZ). */
  readonly keySource:  AiApiKeySource;
  /** Test/özel taşıma için `fetch` enjeksiyonu. Varsayılan: global `fetch`. */
  readonly fetchImpl?: typeof fetch;
  /** Uç nokta kökü (self-host/proxy senaryosu). Varsayılan OpenRouter. */
  readonly baseUrl?:   string;
  /** OpenRouter atıf başlıkları (opsiyonel, gizli veri değil). */
  readonly referer?:   string;
  readonly title?:     string;
}

/* ── Yardımcılar ───────────────────────────────────────────────────────────── */

function isObject<T>(v: T): v is T & Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function mkError(kind: AiErrorKind, message: string, retryable: boolean, status?: number): AiError {
  return {
    kind,
    message,
    retryable,
    provider: OPEN_ROUTER_PROVIDER_ID,
    ...(status !== undefined ? { status } : {}),
  };
}

/**
 * Anahtar-benzeri dizileri maskeler. Kendi anahtarımız gövdeye hiç yazılmaz;
 * bu, sağlayıcının hata metninde anahtar yankılaması ihtimaline karşı SON
 * savunma hattıdır.
 */
function redact(text: string): string {
  return text.replace(/\b(sk|gsk|key)[-_][A-Za-z0-9._-]{6,}/gi, '***');
}

/** HTTP durumundan tipli hata sınıfı (retry kararı burada doğar). */
function classifyStatus(status: number): { kind: AiErrorKind; retryable: boolean; message: string } {
  if (status === 401 || status === 403) {
    return { kind: 'auth', retryable: false, message: 'AI anahtarı geçersiz veya yetkisiz.' };
  }
  if (status === 429) {
    return { kind: 'rate_limited', retryable: true, message: 'AI kota/hız sınırına takıldı.' };
  }
  if (status === 402) {
    return { kind: 'auth', retryable: false, message: 'AI hesabında yeterli kredi yok.' };
  }
  if (status >= 500) {
    return { kind: 'server', retryable: true, message: 'AI sağlayıcısı geçici olarak yanıt veremiyor.' };
  }
  if (status >= 400) {
    return { kind: 'invalid_request', retryable: false, message: 'AI isteği sağlayıcı tarafından reddedildi.' };
  }
  return { kind: 'unknown', retryable: false, message: 'AI sağlayıcısından beklenmeyen yanıt.' };
}

/** Timeout + dış iptal sinyalini TEK sinyalde birleştirir (AbortSignal.any'siz). */
function makeSignal(timeoutMs: number, external?: AbortSignal): { signal?: AbortSignal; dispose: () => void } {
  try {
    const ctrl  = new AbortController();
    const timer = setTimeout(() => { ctrl.abort(); }, timeoutMs);
    const onExternalAbort = (): void => { ctrl.abort(); };
    external?.addEventListener('abort', onExternalAbort);
    return {
      signal: ctrl.signal,
      dispose: () => {
        clearTimeout(timer);                                   // zero-leak
        external?.removeEventListener('abort', onExternalAbort);
      },
    };
  } catch {
    // AbortController dahi yoksa (çok eski WebView): timeout'suz devam.
    return { signal: undefined, dispose: () => {} };
  }
}

/* ── SSE (streaming) ayrıştırma ────────────────────────────────────────────── */

interface StreamState {
  text:          string;
  done:          boolean;
  sawData:       boolean;
  finishReason?: string;
  usage?:        AiUsage;
  error?:        AiError;
}

function readUsage(v: unknown): AiUsage | undefined {
  if (!isObject(v)) return undefined;
  const usage: { promptTokens?: number; completionTokens?: number; totalTokens?: number } = {};
  if (typeof v['prompt_tokens']     === 'number') usage.promptTokens     = v['prompt_tokens']     as number;
  if (typeof v['completion_tokens'] === 'number') usage.completionTokens = v['completion_tokens'] as number;
  if (typeof v['total_tokens']      === 'number') usage.totalTokens      = v['total_tokens']      as number;
  return Object.keys(usage).length > 0 ? usage : undefined;
}

/** Sağlayıcı gövdesindeki `error` alanını tipli hataya çevirir. */
function readInlineError(payload: Record<string, unknown>): AiError | undefined {
  const err = payload['error'];
  if (!isObject(err)) return undefined;
  const status  = typeof err['code'] === 'number' ? err['code'] as number : undefined;
  const detail  = typeof err['message'] === 'string' ? redact(err['message'] as string).slice(0, MAX_ERROR_BODY_CHARS) : '';
  const cls     = status !== undefined ? classifyStatus(status) : { kind: 'server' as AiErrorKind, retryable: true, message: 'AI sağlayıcısı hata döndürdü.' };
  return mkError(cls.kind, detail ? `${cls.message} (${detail})` : cls.message, cls.retryable, status);
}

/**
 * Tek bir SSE satırını işler. Bilinmeyen/bozuk satırlar SESSİZCE ATLANIR
 * (akış düşürülmez); hiç veri gelmezse çağıran `malformed_response` üretir.
 */
function consumeSseLine(rawLine: string, state: StreamState, onToken?: (t: string) => void): void {
  const line = rawLine.replace(/\r$/, '');
  if (line.length === 0) return;
  if (line.startsWith(':')) return;                 // OpenRouter keep-alive yorumu
  if (!line.startsWith('data:')) return;

  const payloadText = line.slice(5).trim();
  if (payloadText === '[DONE]') { state.done = true; return; }

  let payload: unknown;
  try { payload = JSON.parse(payloadText); } catch { return; }   // kısmi/bozuk parça
  if (!isObject(payload)) return;

  const inlineError = readInlineError(payload);
  if (inlineError) { state.error = inlineError; state.done = true; return; }

  state.sawData = true;

  const usage = readUsage(payload['usage']);
  if (usage) state.usage = usage;

  const choices = payload['choices'];
  if (!Array.isArray(choices) || choices.length === 0) return;
  const choice = choices[0] as unknown;
  if (!isObject(choice)) return;

  const finish = choice['finish_reason'];
  if (typeof finish === 'string' && finish) state.finishReason = finish;

  const delta = choice['delta'];
  if (isObject(delta) && typeof delta['content'] === 'string') {
    const token = delta['content'] as string;
    if (token.length > 0) {
      state.text += token;
      onToken?.(token);
    }
  }
}

/** Tam SSE metnini (akışsız fallback) satır satır işler. */
function consumeSseText(text: string, state: StreamState, onToken?: (t: string) => void): void {
  for (const line of text.split('\n')) consumeSseLine(line, state, onToken);
}

/* ── Provider ──────────────────────────────────────────────────────────────── */

/**
 * OpenRouter sağlayıcısı üretir. Wiring hatası → `throw` (programlama hatası);
 * çalışma zamanı hataları ASLA throw etmez → tipli `ok:false`.
 */
export function createOpenRouterProvider(deps: OpenRouterProviderDependencies): AiProvider {
  if (!isObject(deps) || !isObject(deps.keySource) || typeof deps.keySource.getApiKey !== 'function') {
    throw new RangeError('createOpenRouterProvider: keySource.getApiKey zorunludur.');
  }
  const baseUrl   = (deps.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
  const fetchImpl = deps.fetchImpl ?? (typeof fetch === 'function' ? fetch.bind(globalThis) : undefined);
  if (typeof fetchImpl !== 'function') {
    throw new RangeError('createOpenRouterProvider: fetch bulunamadı (fetchImpl enjekte edin).');
  }

  return {
    id: OPEN_ROUTER_PROVIDER_ID,

    /**
     * SIFIR-TOKEN anahtar doğrulama: OpenRouter'ın anahtar metadata uç noktası
     * (`GET /key`) yalnız `Authorization` başlığıyla çalışır, model çalıştırmaz
     * → kota/ücret yakmaz. Hiçbir kullanıcı verisi (sohbet, araç, konum)
     * GÖNDERİLMEZ. Hata sınıflandırması `generate` ile AYNI taksonomiyi kullanır.
     */
    async verifyKey(options?: AiKeyVerifyOptions): Promise<AiKeyVerification> {
      let apiKey = '';
      try {
        apiKey = (await deps.keySource.getApiKey()) ?? '';
      } catch {
        apiKey = '';
      }
      apiKey = apiKey.trim();
      if (!apiKey) {
        return { ok: false, error: mkError('no_api_key', 'OpenRouter API anahtarı tanımlı değil.', false) };
      }

      const { signal, dispose } = makeSignal(options?.timeoutMs ?? DEFAULT_VERIFY_TIMEOUT_MS, options?.signal);
      try {
        const headers: Record<string, string> = { 'Authorization': `Bearer ${apiKey}` };
        if (deps.referer) headers['HTTP-Referer'] = deps.referer;
        if (deps.title)   headers['X-Title']      = deps.title;

        const response = await fetchImpl(`${baseUrl}/key`, {
          method: 'GET',
          headers,                                        // anahtar YALNIZ başlıkta
          ...(signal ? { signal } : {}),
        });

        if (!response || typeof response.ok !== 'boolean') {
          return { ok: false, error: mkError('malformed_response', 'AI sağlayıcısından yanıt alınamadı.', false) };
        }
        if (response.ok) return { ok: true };

        const cls = classifyStatus(response.status);
        let detail = '';
        try { detail = redact(await response.text()).slice(0, MAX_ERROR_BODY_CHARS); } catch { /* gövde okunamadı */ }
        return {
          ok: false,
          error: mkError(cls.kind, detail ? `${cls.message} (${detail})` : cls.message, cls.retryable, response.status),
        };
      } catch (err) {
        return { ok: false, error: classifyThrown(err, options?.signal) };
      } finally {
        dispose();                                        // timer + listener (zero-leak)
      }
    },

    async generate(request: AiProviderRequest, options?: AiProviderCallOptions): Promise<AiGenerateResult> {
      /* ── Anahtar (BYOK) — yoksa AĞA ÇIKILMAZ ── */
      let apiKey = '';
      try {
        apiKey = (await deps.keySource.getApiKey()) ?? '';
      } catch {
        apiKey = '';                                            // depo hatası = anahtar yok
      }
      apiKey = apiKey.trim();
      if (!apiKey) {
        return { ok: false, error: mkError('no_api_key', 'OpenRouter API anahtarı tanımlı değil.', false) };
      }

      const body: Record<string, unknown> = {
        model:    request.model,
        messages: request.messages.map((m) => ({ role: m.role, content: m.content })),
        stream:   request.stream,
      };
      if (request.temperature !== undefined) body['temperature'] = request.temperature;
      if (request.maxTokens   !== undefined) body['max_tokens']  = request.maxTokens;

      const headers: Record<string, string> = {
        'Authorization': `Bearer ${apiKey}`,                     // anahtarın TEK yeri
        'Content-Type':  'application/json',
      };
      if (deps.referer) headers['HTTP-Referer'] = deps.referer;
      if (deps.title)   headers['X-Title']      = deps.title;

      const { signal, dispose } = makeSignal(request.timeoutMs, options?.signal);

      try {
        const response = await fetchImpl(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers,
          body:   JSON.stringify(body),
          ...(signal ? { signal } : {}),
        });

        if (!response || typeof response.ok !== 'boolean') {
          return { ok: false, error: mkError('malformed_response', 'AI sağlayıcısından yanıt alınamadı.', false) };
        }

        if (!response.ok) {
          const cls    = classifyStatus(response.status);
          let detail   = '';
          try { detail = redact(await response.text()).slice(0, MAX_ERROR_BODY_CHARS); } catch { /* gövde okunamadı */ }
          return {
            ok: false,
            error: mkError(cls.kind, detail ? `${cls.message} (${detail})` : cls.message, cls.retryable, response.status),
          };
        }

        return request.stream
          ? await readStreamingResponse(response, request.model, options?.onToken)
          : await readJsonResponse(response, request.model);
      } catch (err) {
        return { ok: false, error: classifyThrown(err, options?.signal) };
      } finally {
        dispose();                                              // timer + listener (zero-leak)
      }
    },
  };
}

/** fetch/okuma sırasında fırlayan hatayı tipli hataya çevirir. */
function classifyThrown(err: unknown, external?: AbortSignal): AiError {
  const name = isObject(err) && typeof err['name'] === 'string' ? err['name'] as string : '';
  if (name === 'AbortError') {
    return external?.aborted
      ? mkError('aborted', 'İstek iptal edildi.', false)
      : mkError('timeout', 'AI yanıtı zaman aşımına uğradı.', true);
  }
  return mkError('network', 'AI sağlayıcısına ulaşılamadı.', true);
}

/* ── Yanıt okuyucular ──────────────────────────────────────────────────────── */

async function readJsonResponse(response: Response, model: string): Promise<AiGenerateResult> {
  let payload: unknown;
  try { payload = await response.json(); } catch {
    return { ok: false, error: mkError('malformed_response', 'AI yanıtı çözümlenemedi.', false) };
  }
  if (!isObject(payload)) {
    return { ok: false, error: mkError('malformed_response', 'AI yanıtı beklenen biçimde değil.', false) };
  }

  const inlineError = readInlineError(payload);
  if (inlineError) return { ok: false, error: inlineError };

  const choices = payload['choices'];
  if (!Array.isArray(choices) || choices.length === 0) {
    return { ok: false, error: mkError('malformed_response', 'AI yanıtında içerik yok.', false) };
  }
  const choice = choices[0] as unknown;
  const message = isObject(choice) ? choice['message'] : undefined;
  const content = isObject(message) ? message['content'] : undefined;
  if (typeof content !== 'string' || content.length === 0) {
    return { ok: false, error: mkError('malformed_response', 'AI yanıtı boş döndü.', false) };
  }

  const finish = isObject(choice) && typeof choice['finish_reason'] === 'string' ? choice['finish_reason'] as string : undefined;
  const usage  = readUsage(payload['usage']);
  return {
    ok:       true,
    text:     content,
    model,
    provider: OPEN_ROUTER_PROVIDER_ID,
    streamed: false,
    ...(finish ? { finishReason: finish } : {}),
    ...(usage  ? { usage } : {}),
  };
}

async function readStreamingResponse(
  response: Response,
  model:    string,
  onToken?: (token: string) => void,
): Promise<AiGenerateResult> {
  const state: StreamState = { text: '', done: false, sawData: false };
  const reader = getReader(response);

  if (reader) {
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let nl = buffer.indexOf('\n');
        while (nl !== -1) {
          consumeSseLine(buffer.slice(0, nl), state, onToken);
          buffer = buffer.slice(nl + 1);
          nl = buffer.indexOf('\n');
        }
        if (state.done) break;
      }
      if (buffer.length > 0) consumeSseLine(buffer, state, onToken);   // son satır (newline'sız)
    } catch (err) {
      // Akış ortasında koptu: token'lar zaten teslim edildiyse gateway tekrar
      // DENEMEZ (çift token yasağı) — hata yine de dürüstçe raporlanır.
      return { ok: false, error: classifyThrown(err) };
    } finally {
      try { reader.releaseLock(); } catch { /* bazı polyfill'lerde yok */ }
    }
  } else {
    // Eski WebView: gövde akıtılamıyor → tam metni al, aynı ayrıştırıcıdan geçir.
    let full = '';
    try { full = await response.text(); } catch {
      return { ok: false, error: mkError('malformed_response', 'AI akışı okunamadı.', false) };
    }
    consumeSseText(full, state, onToken);
  }

  if (state.error) return { ok: false, error: state.error };
  if (state.text.length === 0) {
    return {
      ok: false,
      error: state.sawData
        ? mkError('malformed_response', 'AI yanıtı boş döndü.', false)
        : mkError('malformed_response', 'AI akışı çözümlenemedi.', false),
    };
  }

  return {
    ok:       true,
    text:     state.text,
    model,
    provider: OPEN_ROUTER_PROVIDER_ID,
    streamed: true,
    ...(state.finishReason ? { finishReason: state.finishReason } : {}),
    ...(state.usage        ? { usage: state.usage } : {}),
  };
}

/** `Response.body.getReader` — eski WebView'da yoksa `undefined` (fail-soft). */
function getReader(response: Response): ReadableStreamDefaultReader<Uint8Array> | undefined {
  try {
    const body = response.body as ReadableStream<Uint8Array> | null | undefined;
    if (!body || typeof body.getReader !== 'function') return undefined;
    return body.getReader();
  } catch {
    return undefined;
  }
}
