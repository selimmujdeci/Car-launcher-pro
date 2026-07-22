/**
 * AI Gateway — TÜM AI İSTEKLERİNİN TEK GİRİŞ NOKTASI.
 *
 * Mavi (ve ileride diğer tüketiciler) YALNIZ `generateResponse()` çağırır.
 * Gateway; sağlayıcı seçimi, model çözümü, timeout, yeniden deneme, fallback
 * sırası ve fail-closed kapıları yönetir. HİÇBİR sağlayıcıya ait kavram
 * (OpenRouter, HTTP, SSE, API anahtarı) bu dosyada YOKTUR.
 *
 * ── SORUMLULUK SINIRI (SRP) ────────────────────────────────────────────────
 *   Gateway   : politika (kapılar · sıra · tekrar · fallback · telemetri)
 *   Provider  : taşıma (HTTP · biçim · kimlik doğrulama · akış ayrıştırma)
 * Yeni sağlayıcı eklemek = yeni bir `AiProvider` dosyası + `providers` dizisine
 * eklemek. Bu dosya DEĞİŞMEZ (OCP).
 *
 * ── FAIL-CLOSED KAPILAR (ağa ÇIKMADAN reddeder) ────────────────────────────
 *   1) geçersiz istek (boş mesaj/rol/parametre)  → `invalid_request`
 *   2) hiç sağlayıcı yok                          → `no_provider`
 *   3) çevrimdışı                                 → `offline`
 *   4) devre kesici açık                          → `circuit_open`
 *   5) çağıran zaten iptal etmiş                  → `aborted`
 * Bu kapılar İSTEK GÖNDERMEDEN döner — boşuna timeout beklenmez.
 *
 * ── KRİTİK: ÇİFT TOKEN YASAĞI ──────────────────────────────────────────────
 * Streaming'de kullanıcıya EN AZ BİR token teslim edildikten sonra istek
 * YENİDEN DENENMEZ ve BAŞKA SAĞLAYICIYA DEVREDİLMEZ — aksi halde Mavi aynı
 * cümlenin başını iki kez söylerdi. Token aktığı anda tekrar/fallback KAPANIR.
 *
 * ── DETERMİNİSTİK ──────────────────────────────────────────────────────────
 * Bekleme süresi sabit üstel geri çekilmedir (jitter/`Math.random` YOK);
 * `sleep` DI'dır. `Date.now`/global zaman KULLANILMAZ.
 */

import type {
  AiError,
  AiErrorKind,
  AiAttemptLog,
  AiGateway,
  AiGenerateOptions,
  AiGenerateRequest,
  AiGenerateResult,
  AiHealthPort,
  AiModelId,
  AiNetworkStatus,
  AiProvider,
  AiProviderRequest,
  AiSleep,
} from './types';
import { DEFAULT_AI_MODEL } from './models';

/* ── Varsayılanlar ─────────────────────────────────────────────────────────── */

const DEFAULT_TIMEOUT_MS   = 20_000;
const DEFAULT_MAX_ATTEMPTS = 2;      // 1 ilk deneme + 1 tekrar
const DEFAULT_BASE_DELAY_MS = 400;   // 400ms → 800ms → 1600ms (üstel, jitter yok)
const MAX_ATTEMPTS_CEILING  = 5;     // savunmacı tavan (yanlış config kaçağı)

/** Ağ kaynaklı sayılan (devre kesiciyi besleyen) hata sınıfları. */
const NET_FAILURE_KINDS: readonly AiErrorKind[] = ['network', 'timeout', 'server', 'rate_limited'];

/* ── Bağımlılıklar ─────────────────────────────────────────────────────────── */

export interface AiGatewayRetryPolicy {
  /** Aynı sağlayıcıda azami deneme sayısı (>=1). Varsayılan 2. */
  readonly maxAttempts?:  number;
  /** İlk bekleme (ms); sonrakiler 2 katı. Varsayılan 400. */
  readonly baseDelayMs?:  number;
}

export interface AiGatewayDependencies {
  /**
   * Sağlayıcılar — DİZİ SIRASI FALLBACK SIRASIDIR. Bugün tek eleman
   * (OpenRouter) verilir; ikinci sağlayıcı eklendiğinde davranış otomatik
   * olarak "sırayla dene" olur (gateway kodu değişmeden).
   */
  readonly providers:          readonly AiProvider[];
  /** Model verilmeyen isteklerde kullanılacak model. Varsayılan `DEFAULT_AI_MODEL`. */
  readonly defaultModel?:      AiModelId;
  readonly defaultTimeoutMs?:  number;
  readonly retry?:             AiGatewayRetryPolicy;
  /** Verilmezse çevrimdışı kapısı UYGULANMAZ (kapı yokluğu ≠ çevrimdışı varsayımı). */
  readonly network?:           AiNetworkStatus;
  /** Verilmezse devre kesici kapısı UYGULANMAZ. */
  readonly health?:            AiHealthPort;
  readonly sleep?:             AiSleep;
}

/* ── Yardımcılar ───────────────────────────────────────────────────────────── */

function isObject<T>(v: T): v is T & Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function fail(kind: AiErrorKind, message: string, retryable = false): AiError {
  return { kind, message, retryable };
}

const VALID_ROLES = new Set(['system', 'user', 'assistant']);

/** İstek sözleşmesi doğrulaması — ihlalde ağa ÇIKILMAZ. */
function validateRequest(request: AiGenerateRequest): AiError | undefined {
  if (!isObject(request))            return fail('invalid_request', 'AI isteği geçersiz.');
  if (!Array.isArray(request.messages) || request.messages.length === 0) {
    return fail('invalid_request', 'AI isteği en az bir mesaj içermelidir.');
  }
  for (const m of request.messages) {
    if (!isObject(m) || !VALID_ROLES.has(m.role as string)) {
      return fail('invalid_request', 'Geçersiz mesaj rolü.');
    }
    if (typeof m.content !== 'string' || m.content.length === 0) {
      return fail('invalid_request', 'Mesaj içeriği boş olamaz.');
    }
  }
  const { temperature, maxTokens, timeoutMs, model } = request;
  if (temperature !== undefined && (!Number.isFinite(temperature) || temperature < 0 || temperature > 2)) {
    return fail('invalid_request', 'temperature 0 ile 2 arasında olmalıdır.');
  }
  if (maxTokens !== undefined && (!Number.isInteger(maxTokens) || maxTokens <= 0)) {
    return fail('invalid_request', 'maxTokens pozitif tam sayı olmalıdır.');
  }
  if (timeoutMs !== undefined && (!Number.isFinite(timeoutMs) || timeoutMs <= 0)) {
    return fail('invalid_request', 'timeoutMs pozitif olmalıdır.');
  }
  if (model !== undefined && (typeof model !== 'string' || model.trim().length === 0)) {
    return fail('invalid_request', 'model boş olamaz.');
  }
  return undefined;
}

const defaultSleep: AiSleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

/* ── Factory ───────────────────────────────────────────────────────────────── */

/**
 * Gateway üretir. Wiring hatası (bağımlılık sözleşmesi ihlali) → `throw`
 * (programlama hatası, sessizce yutulmaz). Çalışma zamanı hataları ise ASLA
 * throw etmez → tipli `ok:false` sonucu döner.
 */
export function createAiGateway(deps: AiGatewayDependencies): AiGateway {
  if (!isObject(deps) || !Array.isArray(deps.providers)) {
    throw new RangeError('createAiGateway: providers dizisi zorunludur.');
  }
  for (const p of deps.providers) {
    if (!isObject(p) || typeof p.id !== 'string' || !p.id || typeof p.generate !== 'function') {
      throw new RangeError('createAiGateway: geçersiz AiProvider (id + generate zorunlu).');
    }
  }
  const {
    providers,
    defaultModel     = DEFAULT_AI_MODEL,
    defaultTimeoutMs = DEFAULT_TIMEOUT_MS,
    network,
    health,
    sleep = defaultSleep,
  } = deps;

  if (typeof defaultModel !== 'string' || !defaultModel.trim()) {
    throw new RangeError('createAiGateway: defaultModel boş olamaz.');
  }
  if (!Number.isFinite(defaultTimeoutMs) || defaultTimeoutMs <= 0) {
    throw new RangeError('createAiGateway: defaultTimeoutMs pozitif olmalıdır.');
  }

  const rawAttempts   = deps.retry?.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const rawBaseDelay  = deps.retry?.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  if (!Number.isInteger(rawAttempts) || rawAttempts < 1) {
    throw new RangeError('createAiGateway: retry.maxAttempts >= 1 tam sayı olmalıdır.');
  }
  if (!Number.isFinite(rawBaseDelay) || rawBaseDelay < 0) {
    throw new RangeError('createAiGateway: retry.baseDelayMs negatif olamaz.');
  }
  const maxAttempts = Math.min(rawAttempts, MAX_ATTEMPTS_CEILING);

  return {
    async generateResponse(
      request:  AiGenerateRequest,
      options?: AiGenerateOptions,
    ): Promise<AiGenerateResult> {
      /* ── Kapı 1: sözleşme ── */
      const invalid = validateRequest(request);
      if (invalid) return { ok: false, error: invalid };

      /* ── Kapı 2: sağlayıcı ──
         `providerId` verilmişse zincir O TEK sağlayıcıya daraltılır: dışarıda
         (orchestrator) zincir yönetiliyordur, gateway kendi fallback'ini
         uygulamamalıdır. Verilmezse davranış BİREBİR eskisi. */
      const activeProviders = request.providerId
        ? providers.filter((p) => p.id === request.providerId)
        : providers;

      if (activeProviders.length === 0) {
        return {
          ok: false,
          error: fail('no_provider', request.providerId
            ? 'İstenen AI sağlayıcısı kayıtlı değil.'
            : 'Yapılandırılmış AI sağlayıcısı yok.'),
        };
      }

      /* ── Kapı 3: çevrimdışı (port verilmişse) ── */
      if (network && !safeBool(() => network.isOnline(), true)) {
        return { ok: false, error: fail('offline', 'İnternet bağlantısı yok.') };
      }

      /* ── Kapı 4: devre kesici (port verilmişse) ── */
      if (health && !safeBool(() => health.isHealthy(), true)) {
        return { ok: false, error: fail('circuit_open', 'AI bağlantısı geçici olarak devre dışı.') };
      }

      /* ── Kapı 5: çağıran zaten iptal etmiş ── */
      if (options?.signal?.aborted) {
        return { ok: false, error: fail('aborted', 'İstek iptal edildi.') };
      }

      /* Token sayacı — ÇİFT TOKEN YASAĞI'nın dayanağı. */
      let emittedTokens = 0;
      const userOnToken = options?.onToken;
      const onToken = userOnToken
        ? (token: string): void => {
            emittedTokens++;
            try { userOnToken(token); } catch { /* dinleyici hatası akışı düşürmez */ }
          }
        : undefined;

      const providerRequest: AiProviderRequest = {
        messages:  request.messages,
        model:     request.model ?? defaultModel,
        timeoutMs: request.timeoutMs ?? defaultTimeoutMs,
        stream:    onToken !== undefined,
        ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
        ...(request.maxTokens   !== undefined ? { maxTokens:   request.maxTokens   } : {}),
        ...(request.tools && request.tools.length > 0 ? { tools: request.tools } : {}),
      };

      const attempts: AiAttemptLog[] = [];
      let lastError: AiError = fail('unknown', 'AI yanıtı alınamadı.');

      /* ── Sağlayıcı zinciri (fallback) ── */
      for (const provider of activeProviders) {
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
          if (options?.signal?.aborted) {
            return { ok: false, error: fail('aborted', 'İstek iptal edildi.'), attempts };
          }

          const result = await callProvider(provider, providerRequest, onToken, options?.signal);

          if (result.ok) {
            health?.recordSuccess();
            return result;
          }

          lastError = result.error;
          attempts.push({
            provider:  provider.id,
            model:     providerRequest.model,
            attempt,
            errorKind: result.error.kind,
            ...(result.error.status !== undefined ? { status: result.error.status } : {}),
          });

          if (NET_FAILURE_KINDS.includes(result.error.kind)) health?.recordFailure();

          /* ÇİFT TOKEN YASAĞI: kullanıcı zaten metin duyduysa/gördüyse dur. */
          if (emittedTokens > 0) {
            return { ok: false, error: lastError, attempts };
          }
          /* İptal → zincirin tamamı durur. */
          if (result.error.kind === 'aborted') {
            return { ok: false, error: lastError, attempts };
          }
          /* Tekrar anlamsızsa bu sağlayıcıyı bırak, sıradakine geç. */
          if (!result.error.retryable) break;
          /* Son deneme değilse bekle (üstel, deterministik). */
          if (attempt < maxAttempts) {
            await sleep(rawBaseDelay * Math.pow(2, attempt - 1));
          }
        }
      }

      return { ok: false, error: lastError, attempts };
    },
  };
}

/* ── Sağlayıcı çağrısı (savunmacı sarmalayıcı) ─────────────────────────────── */

/**
 * Sağlayıcı sözleşmesi "throw etme" der; yine de KÖTÜ DAVRANAN bir sağlayıcı
 * gateway'i devirmemelidir (fail-closed). Throw / şekilsiz dönüş → tipli hata.
 */
async function callProvider(
  provider: AiProvider,
  request:  AiProviderRequest,
  onToken:  ((token: string) => void) | undefined,
  signal:   AbortSignal | undefined,
): Promise<AiGenerateResult> {
  try {
    const result = await provider.generate(request, {
      ...(onToken ? { onToken } : {}),
      ...(signal  ? { signal  } : {}),
    });
    if (!isObject(result) || typeof result.ok !== 'boolean') {
      return { ok: false, error: { ...fail('malformed_response', 'AI sağlayıcısı geçersiz sonuç döndürdü.'), provider: provider.id } };
    }
    return result;
  } catch {
    return { ok: false, error: { ...fail('unknown', 'AI sağlayıcısı beklenmedik biçimde başarısız oldu.', true), provider: provider.id } };
  }
}

/** Port çağrısını fail-soft okur (port throw ederse varsayılana düşer). */
function safeBool(read: () => boolean, fallback: boolean): boolean {
  try {
    const v = read();
    return typeof v === 'boolean' ? v : fallback;
  } catch {
    return fallback;
  }
}
