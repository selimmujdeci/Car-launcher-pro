/**
 * Gemini Provider — `AiProvider` sözleşmesinin İKİNCİ gerçek uygulaması.
 *
 * Google `generativelanguage` API'sinin doğrudan (BYOK) kullanımı. Bu dosya
 * YALNIZCA TAŞIMA katmanıdır: politika (tekrar/fallback/kapılar) gateway'e,
 * sağlayıcı seçimi orchestrator'a aittir.
 *
 * ── SINIRLAR ────────────────────────────────────────────────────────────────
 *  - `generate` ASLA THROW ETMEZ → her hata tipli `AiError`.
 *  - API ANAHTARI yalnızca `x-goog-api-key` BAŞLIĞINA yazılır. URL query'ye
 *    (`?key=...`) ASLA konmaz — bu kod tabanında STT tarafında görülen desen
 *    burada TEKRARLANMAZ. Anahtar loglanmaz, hata mesajına/sonuca girmez;
 *    sağlayıcıdan gelen hata metni anahtar-benzeri desenlere karşı REDAKTE edilir.
 *  - Gemini'ye ÖZGÜ tipler bu dosyanın DIŞINA taşmaz (gateway tipleri döner).
 *
 * ── STREAMING (DÜRÜST BEYAN) ────────────────────────────────────────────────
 * Bu ilk sürüm NON-STREAMING'dir. `stream:true` istense bile tek seferlik
 * `generateContent` çağrılır, `onToken` ÇAĞRILMAZ ve sonuçta `streamed:false`
 * bildirilir. Yetenek tanımında da `supportsStreaming:false` yazar — SAHTE
 * DESTEK İLAN EDİLMEZ. Sonuç: token akmadığı için yürütücü hata durumunda
 * diğer sağlayıcıya güvenle geçebilir (çift cevap riski YOK).
 *
 * ── MODEL ───────────────────────────────────────────────────────────────────
 * Model kimliği katalogdan gelir (`DEFAULT_GEMINI_MODEL`); istek `model` ile
 * ezebilir. Sabit ad gömülmez.
 */

import type {
  AiError,
  AiErrorKind,
  AiGenerateResult,
  AiApiKeySource,
  AiKeyVerification,
  AiKeyVerifyOptions,
  AiMessage,
  AiProvider,
  AiProviderCallOptions,
  AiProviderRequest,
  AiUsage,
} from '../types';
import { DEFAULT_GEMINI_MODEL } from '../models';

export const GEMINI_PROVIDER_ID = 'gemini';

const DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
const MAX_ERROR_BODY_CHARS = 200;
const DEFAULT_VERIFY_TIMEOUT_MS = 8_000;

export interface GeminiProviderDependencies {
  /** BYOK anahtar kaynağı (boş string → anahtar yok → ağa ÇIKILMAZ). */
  readonly keySource:  AiApiKeySource;
  readonly fetchImpl?: typeof fetch;
  readonly baseUrl?:   string;
}

/* ── Yardımcılar ───────────────────────────────────────────────────────────── */

function isObject<T>(v: T): v is T & Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function mkError(kind: AiErrorKind, message: string, retryable: boolean, status?: number, retryAfterMs?: number): AiError {
  return {
    kind, message, retryable,
    provider: GEMINI_PROVIDER_ID,
    ...(status !== undefined ? { status } : {}),
    ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
  };
}

/** Anahtar-benzeri dizileri maskeler (sağlayıcı hata metni yankılarsa son savunma). */
function redact(text: string): string {
  return text.replace(/\b(AIza[A-Za-z0-9_-]{10,}|AQ\.[A-Za-z0-9_.-]{10,}|(sk|gsk|key)[-_][A-Za-z0-9._-]{6,})/gi, '***');
}

function classifyStatus(status: number): { kind: AiErrorKind; retryable: boolean; message: string } {
  if (status === 401 || status === 403) return { kind: 'auth', retryable: false, message: 'AI anahtarı geçersiz veya yetkisiz.' };
  if (status === 429)                   return { kind: 'rate_limited', retryable: true, message: 'AI kota/hız sınırına takıldı.' };
  if (status === 408)                   return { kind: 'timeout', retryable: true, message: 'AI yanıtı zaman aşımına uğradı.' };
  if (status >= 500)                    return { kind: 'server', retryable: true, message: 'AI sağlayıcısı geçici olarak yanıt veremiyor.' };
  if (status >= 400)                    return { kind: 'invalid_request', retryable: false, message: 'AI isteği sağlayıcı tarafından reddedildi.' };
  return { kind: 'unknown', retryable: false, message: 'AI sağlayıcısından beklenmeyen yanıt.' };
}

/** Timeout + dış iptali TEK sinyalde birleştirir (AbortSignal.any'siz, eski WebView güvenli). */
function makeSignal(timeoutMs: number, external?: AbortSignal): { signal?: AbortSignal; dispose: () => void } {
  try {
    const ctrl  = new AbortController();
    const timer = setTimeout(() => { ctrl.abort(); }, timeoutMs);
    const onExternalAbort = (): void => { ctrl.abort(); };
    external?.addEventListener('abort', onExternalAbort);
    return {
      signal: ctrl.signal,
      dispose: () => {
        clearTimeout(timer);
        external?.removeEventListener('abort', onExternalAbort);
      },
    };
  } catch {
    return { signal: undefined, dispose: () => {} };
  }
}

function classifyThrown(err: unknown, external?: AbortSignal): AiError {
  const name = isObject(err) && typeof err['name'] === 'string' ? err['name'] as string : '';
  if (name === 'AbortError') {
    return external?.aborted
      ? mkError('aborted', 'İstek iptal edildi.', false)
      : mkError('timeout', 'AI yanıtı zaman aşımına uğradı.', true);
  }
  return mkError('network', 'AI sağlayıcısına ulaşılamadı.', true);
}

/* ── İstek/yanıt dönüşümü (Gemini'ye özgü şekil BURADA kalır) ─────────────── */

/**
 * Gateway mesajlarını Gemini sözleşmesine çevirir:
 *  - `system` mesajları `system_instruction`da BİRLEŞTİRİLİR
 *  - `assistant` rolü Gemini'de `model` adını alır
 */
function toGeminiPayload(request: AiProviderRequest): Record<string, unknown> {
  const systemParts: string[] = [];
  const contents: Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }> = [];

  for (const message of request.messages as readonly AiMessage[]) {
    if (message.role === 'system') { systemParts.push(message.content); continue; }
    contents.push({
      role:  message.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: message.content }],
    });
  }

  const generationConfig: Record<string, unknown> = {
    // SAHA 2026-07-03: flash-latest DÜŞÜNEN modeldir; bütçesiz istekte düşünme
    // token'ları çıktı bütçesini yiyip MAX_TOKENS ile METİNSİZ yanıt döndürüyor.
    // Araç içi gecikme > derinlik → düşünme kapalı (mevcut yollarla AYNI).
    thinkingConfig: { thinkingBudget: 0 },
  };
  if (request.temperature !== undefined) generationConfig['temperature']     = request.temperature;
  if (request.maxTokens   !== undefined) generationConfig['maxOutputTokens'] = request.maxTokens;

  return {
    ...(systemParts.length > 0
      ? { system_instruction: { parts: [{ text: systemParts.join('\n\n') }] } }
      : {}),
    contents,
    generationConfig,
  };
}

function readUsage(v: unknown): AiUsage | undefined {
  if (!isObject(v)) return undefined;
  const usage: { promptTokens?: number; completionTokens?: number; totalTokens?: number } = {};
  if (typeof v['promptTokenCount']     === 'number') usage.promptTokens     = v['promptTokenCount']     as number;
  if (typeof v['candidatesTokenCount'] === 'number') usage.completionTokens = v['candidatesTokenCount'] as number;
  if (typeof v['totalTokenCount']      === 'number') usage.totalTokens      = v['totalTokenCount']      as number;
  return Object.keys(usage).length > 0 ? usage : undefined;
}

/**
 * 429 gövdesinden GÜVENİLİR bekleme penceresini okur
 * (`google.rpc.RetryInfo` → `retryDelay: "7s"`). Okunamazsa `undefined` —
 * TAHMİN ÜRETİLMEZ. (companionChatProvider'daki mevcut desenle aynı.)
 */
function readRetryAfterMs(body: string): number | undefined {
  try {
    const data = JSON.parse(body) as { error?: { details?: Array<{ retryDelay?: string }> } };
    const detail = data.error?.details?.find((d) => typeof d?.retryDelay === 'string');
    const match = detail?.retryDelay?.match(/^(\d+(?:\.\d+)?)s$/);
    if (match) return Math.round(parseFloat(match[1] as string) * 1000);
  } catch { /* gövde JSON değil → pencere bilgisi yok */ }
  return undefined;
}

/** Gemini yanıt gövdesinden metni çıkarır (parça listesi birleştirilir). */
function extractText(payload: Record<string, unknown>): { text: string; finishReason?: string } {
  const candidates = payload['candidates'];
  if (!Array.isArray(candidates) || candidates.length === 0) return { text: '' };
  const candidate = candidates[0] as unknown;
  if (!isObject(candidate)) return { text: '' };

  const finish = typeof candidate['finishReason'] === 'string' ? candidate['finishReason'] as string : undefined;
  const content = candidate['content'];
  if (!isObject(content)) return { text: '', ...(finish ? { finishReason: finish } : {}) };

  const parts = content['parts'];
  if (!Array.isArray(parts)) return { text: '', ...(finish ? { finishReason: finish } : {}) };

  let text = '';
  for (const part of parts) {
    if (isObject(part) && typeof part['text'] === 'string') text += part['text'];
  }
  return { text, ...(finish ? { finishReason: finish } : {}) };
}

/* ── Provider ──────────────────────────────────────────────────────────────── */

export function createGeminiProvider(deps: GeminiProviderDependencies): AiProvider {
  if (!isObject(deps) || !isObject(deps.keySource) || typeof deps.keySource.getApiKey !== 'function') {
    throw new RangeError('createGeminiProvider: keySource.getApiKey zorunludur.');
  }
  const baseUrl   = (deps.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
  const fetchImpl = deps.fetchImpl ?? (typeof fetch === 'function' ? fetch.bind(globalThis) : undefined);
  if (typeof fetchImpl !== 'function') {
    throw new RangeError('createGeminiProvider: fetch bulunamadı (fetchImpl enjekte edin).');
  }

  /** Anahtarı fail-soft okur; boş string = anahtar yok. */
  async function readKey(): Promise<string> {
    try { return ((await deps.keySource.getApiKey()) ?? '').trim(); } catch { return ''; }
  }

  return {
    id: GEMINI_PROVIDER_ID,
    // Google `generativelanguage` KENDİ model adlandırmasını kullanır; OpenRouter
    // slug'ı buraya gelirse `400 unexpected model name format` olur (SAHA 2026-07-24).
    defaultModel: DEFAULT_GEMINI_MODEL,

    /** SIFIR-TOKEN doğrulama: `GET /models` — üretim yapmaz, kota yakmaz. */
    async verifyKey(options?: AiKeyVerifyOptions): Promise<AiKeyVerification> {
      const apiKey = await readKey();
      if (!apiKey) return { ok: false, error: mkError('no_api_key', 'Gemini API anahtarı tanımlı değil.', false) };

      const { signal, dispose } = makeSignal(options?.timeoutMs ?? DEFAULT_VERIFY_TIMEOUT_MS, options?.signal);
      try {
        const response = await fetchImpl(`${baseUrl}/models`, {
          method:  'GET',
          headers: { 'x-goog-api-key': apiKey },        // anahtarın TEK yeri
          ...(signal ? { signal } : {}),
        });
        if (!response || typeof response.ok !== 'boolean') {
          return { ok: false, error: mkError('malformed_response', 'AI sağlayıcısından yanıt alınamadı.', false) };
        }
        if (response.ok) return { ok: true };
        const cls = classifyStatus(response.status);
        return { ok: false, error: mkError(cls.kind, cls.message, cls.retryable, response.status) };
      } catch (err) {
        return { ok: false, error: classifyThrown(err, options?.signal) };
      } finally {
        dispose();
      }
    },

    async generate(request: AiProviderRequest, options?: AiProviderCallOptions): Promise<AiGenerateResult> {
      /* ── Anahtar (BYOK) — yoksa AĞA ÇIKILMAZ ── */
      const apiKey = await readKey();
      if (!apiKey) {
        return { ok: false, error: mkError('no_api_key', 'Gemini API anahtarı tanımlı değil.', false) };
      }

      const model = request.model || DEFAULT_GEMINI_MODEL;
      const { signal, dispose } = makeSignal(request.timeoutMs, options?.signal);

      try {
        // NON-STREAMING: `stream:true` istense bile tek seferlik çağrı yapılır ve
        // `onToken` ÇAĞRILMAZ (bkz. dosya başlığı — sahte streaming yok).
        const response = await fetchImpl(`${baseUrl}/models/${encodeURIComponent(model)}:generateContent`, {
          method: 'POST',
          headers: {
            'Content-Type':   'application/json',
            'x-goog-api-key': apiKey,                  // anahtarın TEK yeri (URL'de YOK)
          },
          body: JSON.stringify(toGeminiPayload(request)),
          ...(signal ? { signal } : {}),
        });

        if (!response || typeof response.ok !== 'boolean') {
          return { ok: false, error: mkError('malformed_response', 'AI sağlayıcısından yanıt alınamadı.', false) };
        }

        if (!response.ok) {
          const cls = classifyStatus(response.status);
          let raw = '';
          try { raw = await response.text(); } catch { /* gövde okunamadı */ }
          const detail = redact(raw).slice(0, MAX_ERROR_BODY_CHARS);
          const retryAfterMs = response.status === 429 ? readRetryAfterMs(raw) : undefined;
          return {
            ok: false,
            error: mkError(cls.kind, detail ? `${cls.message} (${detail})` : cls.message, cls.retryable, response.status, retryAfterMs),
          };
        }

        let payload: unknown;
        try { payload = await response.json(); } catch {
          return { ok: false, error: mkError('malformed_response', 'AI yanıtı çözümlenemedi.', false) };
        }
        if (!isObject(payload)) {
          return { ok: false, error: mkError('malformed_response', 'AI yanıtı beklenen biçimde değil.', false) };
        }

        const { text, finishReason } = extractText(payload);
        if (!text) {
          // Boş metin BAŞARI sayılmaz (uydurma yok) — ör. MAX_TOKENS/SAFETY.
          return { ok: false, error: mkError('malformed_response', 'AI yanıtı boş döndü.', false) };
        }

        const usage = readUsage(payload['usageMetadata']);
        return {
          ok:       true,
          text,
          model,
          provider: GEMINI_PROVIDER_ID,
          streamed: false,                             // DÜRÜST: akıtılmadı
          ...(finishReason ? { finishReason } : {}),
          ...(usage ? { usage } : {}),
        };
      } catch (err) {
        return { ok: false, error: classifyThrown(err, options?.signal) };
      } finally {
        dispose();                                     // timer + listener (zero-leak)
      }
    },
  };
}
