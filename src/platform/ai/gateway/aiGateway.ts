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

/**
 * GERÇEK ağ ölümü sayılan (devre kesiciyi besleyen) hata sınıfları.
 *
 * ⚠️ SAHA 2026-07-22 ("internet var ama Mavi offline'a düşüyor") — KÖK NEDEN:
 * bu küme eskiden `server` (5xx) ve `rate_limited` (429) DE içeriyordu. Oysa
 * sunucudan HTTP yanıtı gelmesi ağın CANLI olduğunun KANITIDIR; bunları global
 * devre kesiciye yazmak `gatewayChatBridge`'in NET_DEATH_KINDS sözleşmesiyle
 * (yalnız network/timeout) doğrudan ÇELİŞİYORDU. Üstelik kesici HER DENEMEDE
 * besleniyordu: 1 istek × 2 deneme × 2 sağlayıcı = 4 sayım → TEK BİR 429
 * kullanıcıyı anında 90sn tam offline'a kilitliyordu.
 *
 * Kural: yalnız sunucuya ULAŞILAMADIĞINDA (bağlantı kopması/süre aşımı) sayılır
 * ve İSTEK BAŞINA EN FAZLA BİR KEZ (aşağıda `netDeathCounted`).
 * Sağlayıcı-bazlı 429/5xx cezası kesicinin işi DEĞİLDİR — o `providerHealthStore`
 * ve sağlayıcı soğuma pencerelerinin sorumluluğudur.
 */
const NET_FAILURE_KINDS: readonly AiErrorKind[] = ['network', 'timeout'];

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
  /**
   * MONOTONİK saat (DI) — yalnız gecikme ÖLÇÜMÜ için (offline sebep künyesi).
   * Karar mantığında KULLANILMAZ; `Date.now`/duvar saati asla okunmaz.
   */
  readonly now?:               () => number;
}

/* ── Yardımcılar ───────────────────────────────────────────────────────────── */

function isObject<T>(v: T): v is T & Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/* ══════════════════════════════════════════════════════════════════════════
 * İNSAN MÜDAHALESİ GEREKTİREN SAĞLAYICI ARIZASI — BOUNDED HAFIZA
 *
 * SAHA 2026-09-11 (cihaz, ağ izi · 4/4 tur): zincirin İLK sağlayıcısı her turun
 * başında deneniyor ve `402 Insufficient credits` ile düşüyordu
 * (ölçülen 0,17-0,78 sn). 402 bir hız sınırı DEĞİLDİR: kullanıcı bakiye
 * yükleyene (ya da anahtar yenileyene) kadar AYNI cevabı verir — yani her turda
 * ödenen sabit bir gecikme vergisiydi. Zincirin kendi `retryable:false` kararı
 * YALNIZ o çağrı içinde geçerliydi; bir sonraki tur sıfırdan deniyordu.
 *
 * Pencere SONSUZ DEĞİL: bakiye yüklenirse sağlayıcı kendiliğinden geri döner.
 * FAIL-SOFT: hafıza TÜM sağlayıcıları elerse YOK SAYILIR — asistanı susturmak,
 * bir sağlayıcıyı boşuna denemekten daha kötüdür.
 * ════════════════════════════════════════════════════════════════════════ */

/** Kendiliğinden geçmeyen, kullanıcı eylemi gerektiren hata sınıfları. */
const HUMAN_ACTION_KINDS: readonly AiErrorKind[] = ['auth', 'insufficient_credit'];
/** Bounded pencere — 429 soğumasından uzun, kalıcı devre dışı bırakmadan kısa. */
const PROVIDER_UNUSABLE_MS = 10 * 60_000;

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

/** Varsayılan monotonik saat — yalnız gecikme ölçümü (clock-jump güvenli, §4). */
const defaultNow = (): number => (typeof performance !== 'undefined' ? performance.now() : 0);

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
    now   = defaultNow,
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

  /* Hafıza GATEWAY ÖRNEĞİNE aittir — modül seviyesinde global durum TUTULMAZ.
     Üretimde gateway tek örnektir (davranış aynı), testlerde her örnek kendi
     hafızasıyla doğar → örnekler arası sızıntı YAPISAL OLARAK imkânsızdır. */
  const _providerUnusableUntil = new Map<string, number>();

  const _noteProviderUnusable = (providerId: string, kind: AiErrorKind): void => {
    if (!providerId || !HUMAN_ACTION_KINDS.includes(kind)) return;
    _providerUnusableUntil.set(providerId, Date.now() + PROVIDER_UNUSABLE_MS);
  };

  const _isProviderUnusable = (providerId: string): boolean => {
    const until = _providerUnusableUntil.get(providerId);
    if (until === undefined) return false;
    const now = Date.now();
    /* Saat geriye giderse pencere sonsuzlaşmasın: gelecekteki uç makul sınırı
       aşıyorsa kayıt DÜŞÜRÜLÜR (bayat kısıt üretme). */
    if (until <= now || until - now > PROVIDER_UNUSABLE_MS) {
      _providerUnusableUntil.delete(providerId);
      return false;
    }
    return true;
  };

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
      const _chain = request.providerId
        ? providers.filter((p) => p.id === request.providerId)
        : providers;
      /* Kullanıcı eylemi bekleyen sağlayıcı bounded süre ATLANIR. Hepsi elenirse
         hafıza YOK SAYILIR — susmak, boşuna denemekten kötüdür (fail-soft). */
      const _usable = _chain.filter((p) => !_isProviderUnusable(p.id));
      const activeProviders = _usable.length > 0 ? _usable : _chain;

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

      /* MODEL SAĞLAYICIYA ÖZGÜDÜR (SAHA 2026-07-24): zincirde tek model adı
         kullanmak yedek sağlayıcıyı öldürüyordu (OpenRouter slug'ı Gemini'ye
         gidince `400 unexpected model name format`). Çağıran AÇIKÇA model
         verdiyse ona saygı duyulur; vermediyse HER sağlayıcı KENDİ varsayılanını
         kullanır, o da yoksa gateway geneli. */
      const buildRequest = (provider: AiProvider): AiProviderRequest => ({
        messages:  request.messages,
        model:     request.model ?? provider.defaultModel ?? defaultModel,
        timeoutMs: request.timeoutMs ?? defaultTimeoutMs,
        stream:    onToken !== undefined,
        ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
        ...(request.maxTokens   !== undefined ? { maxTokens:   request.maxTokens   } : {}),
        ...(request.tools && request.tools.length > 0 ? { tools: request.tools } : {}),
      });
      /** Kesici künyesi için son kullanılan model (zincirde değişebilir). */
      let lastModelUsed: AiModelId = request.model ?? defaultModel;

      const attempts: AiAttemptLog[] = [];
      let lastError: AiError = fail('unknown', 'AI yanıtı alınamadı.');

      /* Devre kesici muhasebesi — İSTEK BAŞINA EN FAZLA BİR KEZ beslenir.
         Eskiden her denemede sayılıyordu (2 deneme × 2 sağlayıcı = 4) → tek
         istek eşiği (2) tek başına aşıyordu (SAHA 2026-07-22). */
      const startedAtMs = now();
      let retries       = 0;
      let netDeath: AiError | undefined;

      /** Zincir bittiğinde/erken çıkışta kesiciyi TEK KEZ besler. */
      const flushHealth = (): void => {
        if (!netDeath) return;
        health?.recordFailure({
          ...(netDeath.provider !== undefined ? { provider: netDeath.provider } : {}),
          model:         lastModelUsed,
          latencyMs:     Math.round(now() - startedAtMs),
          ...(netDeath.status !== undefined ? { httpStatus: netDeath.status } : {}),
          exceptionType: netDeath.kind,
          retries,
        });
        netDeath = undefined;
      };

      /* ── Sağlayıcı zinciri (fallback) ── */
      for (const provider of activeProviders) {
        const providerRequest = buildRequest(provider);
        lastModelUsed = providerRequest.model;
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
          if (options?.signal?.aborted) {
            flushHealth();
            return { ok: false, error: fail('aborted', 'İstek iptal edildi.'), attempts };
          }

          const result = await callProvider(provider, providerRequest, onToken, options?.signal);

          if (result.ok) {
            /* Sağlıklı yanıt gelen an seri SIFIRLANIR — aynı turda daha önce
               görülen ağ hatası artık kesiciye yazılmaz (failover BAŞARILI). */
            netDeath = undefined;
            health?.recordSuccess();
            return result;
          }

          if (attempt > 1) retries++;
          lastError = result.error;
          /* Kendiliğinden geçmeyen arıza → sağlayıcı bounded süre elenir. */
          _noteProviderUnusable(provider.id, result.error.kind);
          attempts.push({
            provider:  provider.id,
            model:     providerRequest.model,
            attempt,
            errorKind: result.error.kind,
            ...(result.error.status !== undefined ? { status: result.error.status } : {}),
          });

          /* Yalnız GERÇEK ağ ölümü (sunucuya ulaşılamadı) işaretlenir; HTTP
             yanıtı gelen hatalar (429/5xx/auth) ağın CANLI olduğunun kanıtıdır. */
          if (NET_FAILURE_KINDS.includes(result.error.kind)) {
            netDeath = { ...result.error, provider: result.error.provider ?? provider.id };
          }

          /* ÇİFT TOKEN YASAĞI: kullanıcı zaten metin duyduysa/gördüyse dur. */
          if (emittedTokens > 0) {
            flushHealth();
            return { ok: false, error: lastError, attempts };
          }
          /* İptal → zincirin tamamı durur. Kullanıcı iptali AĞ HATASI DEĞİLDİR
             (barge-in kesiciyi beslemez). */
          if (result.error.kind === 'aborted') {
            netDeath = undefined;
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

      flushHealth();
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
