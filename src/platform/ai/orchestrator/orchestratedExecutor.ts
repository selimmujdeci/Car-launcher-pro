/**
 * orchestratedExecutor — orchestrator zincirini GERÇEKTEN çalıştıran katman.
 *
 * ── SORUMLULUK SINIRI (kesin) ───────────────────────────────────────────────
 *   Orchestrator : KARAR üretir (sıra/aday/model) — yürütmez, retry yapmaz.
 *   Executor     : ZİNCİRİ ÇALIŞTIRIR — karar algoritması ÜRETMEZ, aday
 *                  eklemez/çıkarmaz, sırayı değiştirmez.
 * Zincir `decideModel`ten geldiği gibi baştan sona BİR KEZ gezilir.
 *
 * ── SAĞLAYICI BAĞIMSIZLIĞI ──────────────────────────────────────────────────
 * Bu dosyada hiçbir sağlayıcı markası GEÇMEZ (yapısal testle kilitli). Adaylar
 * gateway'e `providerId` + `model` olarak iletilir.
 *
 * ── SONSUZ DÖNGÜ İMKÂNSIZ ──────────────────────────────────────────────────
 * Zincir sonlu; her `providerId::model` ikilisi EN FAZLA BİR KEZ denenir
 * (`tried` kümesi); executor kendi içinde tekrar döngüsü kurmaz.
 *
 * ── AKIŞ (STREAMING) GÜVENLİĞİ ─────────────────────────────────────────────
 * Kullanıcıya ANLAMLI ÇIKTI (en az bir token) teslim edildikten sonra BAŞKA
 * SAĞLAYICIYA GEÇİLMEZ — iki modelin cevabı birbirine karışmasın. Bu durumda
 * tipli `stream_interrupted` sonucu döner.
 *
 * ── GİZLİLİK ────────────────────────────────────────────────────────────────
 * Prompt/cevap/araç verisi/konuşma geçmişi LOGLANMAZ ve telemetriye GİRMEZ.
 */

import type {
  AiGateway,
  AiGenerateOptions,
  AiGenerateRequest,
  AiGenerateResult,
  AiErrorKind,
} from '../gateway/types';
import { decideModel } from './maviModelOrchestrator';
import type {
  AiProviderCapability,
  MaviModelDecision,
  MaviTaskType,
  OrchestratorContext,
  OrchestratorPolicy,
} from './orchestratorTypes';

/* ── Hata taksonomisi (gateway sınıflarından TÜRETİLİR, yeniden icat edilmez) ── */

export type ExecutionFailureType =
  | 'auth'
  | 'rate_limit'
  | 'timeout'
  | 'network'
  | 'provider_unavailable'
  | 'server_error'
  | 'invalid_response'
  | 'invalid_request'
  | 'aborted'
  | 'unknown';

/** Gateway hata sınıfı → yürütme hata türü. Tek eşleme noktası. */
export function failureTypeFromErrorKind(kind: AiErrorKind): ExecutionFailureType {
  switch (kind) {
    case 'auth':               return 'auth';
    case 'no_api_key':         return 'auth';
    case 'rate_limited':       return 'rate_limit';
    case 'timeout':            return 'timeout';
    case 'network':            return 'network';
    case 'offline':            return 'network';
    case 'no_provider':        return 'provider_unavailable';
    case 'circuit_open':       return 'provider_unavailable';
    case 'server':             return 'server_error';
    case 'malformed_response': return 'invalid_response';
    case 'invalid_request':    return 'invalid_request';
    case 'aborted':            return 'aborted';
    default:                   return 'unknown';
  }
}

/**
 * Bu hata SAĞLAYICI DEĞİŞTİRİLEREK çözülebilir mi?
 * `false` olanlarda fallback denemek boşuna gecikme + boşuna kota harcar.
 */
function isWorthFallback(type: ExecutionFailureType): boolean {
  switch (type) {
    case 'aborted':          return false;   // kullanıcı iptali → zincir DURUR
    case 'invalid_request':  return false;   // istek hatalı → başka sağlayıcı çözmez
    case 'invalid_response': return false;   // sözleşme ihlali → sağlayıcı değişimi çözmez
    default:                 return true;
  }
}

/** Sağlık deposuna yazılacak hata sınıfı (store sözleşmesiyle uyumlu). */
function healthKindOf(type: ExecutionFailureType): 'rate_limited' | 'auth' | 'network' | 'server' | 'timeout' | 'unknown' {
  switch (type) {
    case 'rate_limit':           return 'rate_limited';
    case 'auth':                 return 'auth';
    case 'timeout':              return 'timeout';
    case 'network':              return 'network';
    case 'server_error':         return 'server';
    case 'provider_unavailable': return 'server';
    default:                     return 'unknown';
  }
}

/* ── Bağımlılıklar (hepsi DI — executor somut modül import ETMEZ) ─────────── */

export interface ExecutorHealthPort {
  recordSuccess(providerId: string): void;
  recordFailure(providerId: string, kind: ReturnType<typeof healthKindOf>, nowMs: number): void;
  recordRateLimit(providerId: string, retryAfterMs: number, nowMs: number): void;
}

/** Global AI devre kesicisi — sağlayıcı-bazlı sağlık bunu EZMEZ. */
export interface GlobalCircuitPort {
  isHealthy(): boolean;
}

export interface AttemptRecord {
  readonly providerId:   string;
  readonly model:        string;
  readonly ok:           boolean;
  readonly failureType?: ExecutionFailureType;
  readonly latencyMs:    number;
}

/** YALNIZ güvenli metadata — prompt/cevap/anahtar/araç verisi TAŞIMAZ. */
export interface ExecutionTelemetry {
  readonly taskType:          MaviTaskType;
  readonly candidateCount:    number;
  readonly selectedProviderId: string;
  readonly selectedModelId:   string;
  readonly attemptCount:      number;
  readonly fallbackUsed:      boolean;
  readonly finalOutcome:      'success' | 'failed' | 'no_candidates' | 'circuit_open' | 'stream_interrupted';
  readonly totalDecisionMs:   number;
  readonly totalExecutionMs:  number;
  readonly failureTypes:      readonly ExecutionFailureType[];
}

export interface OrchestratedSuccess {
  readonly ok:         true;
  readonly result:     AiGenerateResult & { ok: true };
  readonly providerId: string;
  readonly model:      string;
  readonly decision:   MaviModelDecision;
  readonly attempts:   readonly AttemptRecord[];
  readonly telemetry:  ExecutionTelemetry;
}

export interface OrchestratedFailure {
  readonly ok:          false;
  readonly failureType: ExecutionFailureType | 'no_candidates' | 'circuit_open' | 'stream_interrupted';
  /** Kullanıcıya gösterilebilir kısa açıklama — ham hata gövdesi İÇERMEZ. */
  readonly message:     string;
  readonly decision:    MaviModelDecision;
  readonly attempts:    readonly AttemptRecord[];
  readonly telemetry:   ExecutionTelemetry;
}

export type OrchestratedOutcome = OrchestratedSuccess | OrchestratedFailure;

export interface ExecuteOrchestratedInput {
  readonly gateway:    AiGateway;
  readonly task:       MaviTaskType;
  readonly context:    OrchestratorContext;
  readonly providers:  readonly AiProviderCapability[];
  readonly policy?:    OrchestratorPolicy;
  /** Gateway'e gönderilecek istek (mesajlar çağıran tarafından kurulur). */
  readonly request:    AiGenerateRequest;
  readonly options?:   AiGenerateOptions;
  readonly health?:    ExecutorHealthPort;
  readonly globalCircuit?: GlobalCircuitPort;
  /** DI saat — `Date.now` gömülü DEĞİL. Verilmezse süreler 0 raporlanır. */
  readonly clock?:     { nowMs(): number };
}

/* ── Yürütme ───────────────────────────────────────────────────────────────── */

/**
 * Karar zincirini sırayla çalıştırır ve İLK başarılı sonucu döndürür.
 * ASLA throw etmez; her sonuç tiplidir (fail-soft).
 */
export async function executeOrchestratedRequest(input: ExecuteOrchestratedInput): Promise<OrchestratedOutcome> {
  const clock = input.clock;
  const now   = (): number => (clock ? clock.nowMs() : 0);

  const startedAt = now();
  const decision  = decideModel({
    task:      input.task,
    context:   input.context,
    providers: input.providers,
    ...(input.policy ? { policy: input.policy } : {}),
  });
  const decisionMs = Math.max(0, now() - startedAt);

  const attempts:     AttemptRecord[] = [];
  const failureTypes: ExecutionFailureType[] = [];

  const finish = (
    outcome: ExecutionTelemetry['finalOutcome'],
    providerId = '',
    model = '',
    executionMs = 0,
  ): ExecutionTelemetry => ({
    taskType:           input.task,
    candidateCount:     decision.fallbackChain.length,
    selectedProviderId: providerId,
    selectedModelId:    model,
    attemptCount:       attempts.length,
    fallbackUsed:       attempts.length > 1,
    finalOutcome:       outcome,
    totalDecisionMs:    decisionMs,
    totalExecutionMs:   executionMs,
    failureTypes:       [...failureTypes],
  });

  /* ── Aday yoksa AĞA ÇIKILMAZ ── */
  if (!decision.ok || decision.fallbackChain.length === 0) {
    return {
      ok: false,
      failureType: 'no_candidates',
      message: 'Şu an kullanılabilir bir yapay zekâ bağlantısı yok.',
      decision, attempts,
      telemetry: finish('no_candidates'),
    };
  }

  /* ── Global devre kesici: sağlayıcı-bazlı sağlık bunu EZEMEZ ── */
  if (input.globalCircuit && input.globalCircuit.isHealthy() === false) {
    return {
      ok: false,
      failureType: 'circuit_open',
      message: 'Yapay zekâ bağlantısı geçici olarak devre dışı.',
      decision, attempts,
      telemetry: finish('circuit_open'),
    };
  }

  const execStart        = now();
  const tried            = new Set<string>();   // `providerId::model` — asla iki kez
  const authBlocked      = new Set<string>();   // auth alan sağlayıcı bu istekte atlanır
  let   tokensDelivered  = 0;                   // akış güvenliği sayacı
  let   lastFailure: ExecutionFailureType = 'unknown';

  /* Kullanıcıya teslim edilen token'ları sayan sarmalayıcı (dinleyici hatası izole). */
  const userOnToken = input.options?.onToken;
  const onToken = userOnToken
    ? (token: string): void => {
        tokensDelivered++;
        try { userOnToken(token); } catch { /* UI hatası akışı düşürmez */ }
      }
    : undefined;

  for (const candidate of decision.fallbackChain) {
    const key = `${candidate.providerId}::${candidate.model}`;
    if (tried.has(key)) continue;                       // aynı ikili İKİ KEZ denenmez
    if (authBlocked.has(candidate.providerId)) continue; // auth alan sağlayıcı atlanır
    tried.add(key);

    if (input.options?.signal?.aborted) {
      return {
        ok: false, failureType: 'aborted',
        message: 'İstek iptal edildi.',
        decision, attempts,
        telemetry: finish('failed', '', '', Math.max(0, now() - execStart)),
      };
    }

    const attemptStart = now();
    const result = await input.gateway.generateResponse(
      { ...input.request, providerId: candidate.providerId, model: candidate.model },
      { ...(onToken ? { onToken } : {}), ...(input.options?.signal ? { signal: input.options.signal } : {}) },
    );
    const latencyMs = Math.max(0, now() - attemptStart);

    if (result.ok) {
      attempts.push({ providerId: candidate.providerId, model: candidate.model, ok: true, latencyMs });
      input.health?.recordSuccess(candidate.providerId);
      return {
        ok: true, result,
        providerId: candidate.providerId,
        model:      candidate.model,
        decision, attempts,
        telemetry: finish('success', candidate.providerId, candidate.model, Math.max(0, now() - execStart)),
      };
    }

    /* ── Başarısız aday: sınıflandır → sağlığa yaz → devam kararı ── */
    const failureType = failureTypeFromErrorKind(result.error.kind);
    lastFailure = failureType;
    failureTypes.push(failureType);
    attempts.push({ providerId: candidate.providerId, model: candidate.model, ok: false, failureType, latencyMs });

    if (failureType === 'rate_limit') {
      // Pencere bilgisi varsa AÇIKÇA yazılır; yoksa store kendi varsayılanını kurar.
      input.health?.recordRateLimit(candidate.providerId, 0, now());
    } else if (failureType !== 'aborted' && failureType !== 'invalid_request') {
      // Kullanıcı iptali ve istemci hatası SAĞLAYICI sağlığı değildir → yazılmaz.
      input.health?.recordFailure(candidate.providerId, healthKindOf(failureType), now());
    }

    if (failureType === 'auth') authBlocked.add(candidate.providerId);

    /* AKIŞ GÜVENLİĞİ: kullanıcı zaten metin gördüyse/duyduysa başka sağlayıcıya
       GEÇİLMEZ — iki cevap birbirine karışmasın. */
    if (tokensDelivered > 0) {
      return {
        ok: false, failureType: 'stream_interrupted',
        message: 'Yanıt yarıda kesildi.',
        decision, attempts,
        telemetry: finish('stream_interrupted', candidate.providerId, candidate.model, Math.max(0, now() - execStart)),
      };
    }

    if (!isWorthFallback(failureType)) {
      return {
        ok: false, failureType,
        message: failureType === 'aborted' ? 'İstek iptal edildi.' : 'Bu istek şu an karşılanamadı.',
        decision, attempts,
        telemetry: finish('failed', '', '', Math.max(0, now() - execStart)),
      };
    }
    // Fallback'e değer → zincirdeki SIRADAKİ aday (yeni aday ÜRETİLMEZ).
  }

  return {
    ok: false, failureType: lastFailure,
    message: 'Yapay zekâ şu an yanıt veremiyor.',
    decision, attempts,
    telemetry: finish('failed', '', '', Math.max(0, now() - execStart)),
  };
}
