/**
 * maviModelOrchestrator — Mavi'nin model seçim çekirdeği (Faz 1: KARAR KATMANI).
 *
 * Bir istek için HANGİ sağlayıcı + HANGİ modelin kullanılacağına, hangi sırayla
 * fallback yapılacağına ve NEDEN seçildiğine karar verir. İSTEK GÖNDERMEZ:
 * ağ, prompt, gateway çağrısı, akış, araç verisi BURADA YOKTUR.
 *
 * ── SAĞLAYICI BAĞIMSIZLIĞI (yapısal kural) ─────────────────────────────────
 * Bu dosyada `openrouter`/`gemini`/`groq`/`anthropic` gibi HİÇBİR sağlayıcı adı
 * geçmez (testle kilitli). Karar YALNIZ `AiProviderCapability` alanlarından
 * üretilir; `id` sadece kimlik/telemetri ve deterministik sıralama içindir.
 *
 * ── SAFLIK ─────────────────────────────────────────────────────────────────
 * `decideModel` SAFTIR: aynı girdi → aynı çıktı. `Date.now`/`Math.random`/global
 * durum KULLANMAZ (zaman `context.nowMs` ile DI gelir). Girdi MUTASYONA
 * UĞRATILMAZ; çıktı yeni nesnelerdir.
 *
 * ── SONSUZ DÖNGÜ İMKÂNSIZ ──────────────────────────────────────────────────
 * Fallback zinciri SONLU ve TEKRARSIZ bir dizidir (aday başına en fazla bir
 * kez, üstten `MAX_FALLBACK_CHAIN` ile sınırlı). Karar katmanı yeniden deneme
 * ÇALIŞTIRMAZ — yalnız sırayı üretir; yürütücü sırayı baştan sona bir kez gezer.
 */

import type {
  AiProviderCapability,
  CapabilityTier,
  DecisionCandidate,
  DecisionReason,
  DecisionTelemetry,
  MaviModelDecision,
  MaviTaskType,
  OrchestratorRequest,
  ProviderHealthSnapshot,
  TaskStrategy,
} from './orchestratorTypes';
import { resolveStrategy } from './taskStrategies';

/** Zincirde en fazla kaç aday taşınır (sonsuz deneme kapısı). */
export const MAX_FALLBACK_CHAIN = 3;

/**
 * Kullanıcı tercihi PUAN BONUSU DEĞİL, ELEME SONRASI KESİN ÖNCELİKtir.
 *
 * Gerekçe: tercih yalnız "biraz avantaj" olsaydı ayar öngörülemez olurdu
 * (kullanıcı sağlayıcıyı seçer ama başka biri gelir). Bu yüzden tercih edilen
 * sağlayıcı TÜM eleme kapılarını geçtiyse zincirin BAŞINA alınır; kapılardan
 * (anahtar/çevrimdışı/ücret/yetenek/engel) biri onu elediyse tercih UYGULANMAZ
 * — tercih güvenlik/uygunluk kapılarını ASLA bypass etmez.
 */

/* ── Yardımcılar ───────────────────────────────────────────────────────────── */

/** `high` iyi olan alanlar için: high→1, medium→0.5, low→0. Tanımsız → 0.5 (nötr). */
function tierScoreHighIsGood(tier: CapabilityTier | undefined): number {
  if (tier === 'high')   return 1;
  if (tier === 'medium') return 0.5;
  if (tier === 'low')    return 0;
  return 0.5;
}

/** `low` iyi olan alanlar (gecikme, maliyet) için ters çevirir. */
function tierScoreLowIsGood(tier: CapabilityTier | undefined): number {
  return 1 - tierScoreHighIsGood(tier);
}

function boolScore(v: boolean | undefined): number {
  return v === true ? 1 : 0;
}

/** Sağlayıcı bu anda engelli mi (kota/devre kesici). */
function isBlocked(health: ProviderHealthSnapshot | undefined, nowMs: number): boolean {
  return !!health && health.blockedUntilMs > nowMs;
}

/** Görevin ZORUNLU yeteneklerini sağlıyor mu. */
function meetsRequirements(provider: AiProviderCapability, strategy: TaskStrategy): boolean {
  for (const key of strategy.required) {
    if (provider[key] !== true) return false;
  }
  return true;
}

/** Görev için kullanılacak model — eşleme yoksa varsayılan. */
function modelFor(provider: AiProviderCapability, task: MaviTaskType): string {
  return provider.modelsByTask?.[task] ?? provider.defaultModel;
}

/**
 * Aday puanı (0..1). Ağırlıklar toplamına BÖLÜNEREK normalize edilir → farklı
 * stratejiler karşılaştırılabilir kalır ve ağırlık toplamı 1 olmak zorunda değildir.
 */
function scoreProvider(provider: AiProviderCapability, strategy: TaskStrategy): number {
  const parts: Array<[number, number]> = [
    [strategy.weightLatency,     tierScoreLowIsGood(provider.latencyTier)],
    [strategy.weightCost,        tierScoreLowIsGood(provider.costTier)],
    [strategy.weightReliability, tierScoreHighIsGood(provider.reliabilityTier)],
    [strategy.weightReasoning,   boolScore(provider.supportsReasoning)],
    [strategy.weightLongContext, boolScore(provider.supportsLongContext)],
  ];
  let total = 0;
  let weightSum = 0;
  for (const [weight, value] of parts) {
    if (!Number.isFinite(weight) || weight <= 0) continue;
    total     += weight * value;
    weightSum += weight;
  }
  return weightSum > 0 ? total / weightSum : 0;
}

/** Sağlıksızlık cezası: art arda hata puanı düşürür (engelli olmasa bile). */
function healthPenalty(health: ProviderHealthSnapshot | undefined): number {
  if (!health || health.consecutiveFailures <= 0) return 0;
  return Math.min(0.3, health.consecutiveFailures * 0.1);   // tavanlı
}

/* ── Karar ─────────────────────────────────────────────────────────────────── */

/**
 * Saf karar fonksiyonu. ASLA throw etmez: geçersiz/eksik girdide fail-closed
 * bir "seçim yok" kararı döner (uydurma sağlayıcı üretilmez).
 */
export function decideModel(request: OrchestratorRequest): MaviModelDecision {
  const task     = request?.task;
  const context  = request?.context;
  const strategy = resolveStrategy(task, request?.policy);
  const rejected: { providerId: string; reason: DecisionReason }[] = [];

  const empty = (reason: DecisionReason): MaviModelDecision => ({
    ok: false, task, providerId: '', model: '', reason, fallbackChain: [], rejected,
  });

  if (!context || !Array.isArray(request?.providers) || request.providers.length === 0) {
    return empty('no_providers');
  }

  const availableIds = new Set(context.availableProviderIds ?? []);
  const nowMs        = Number.isFinite(context.nowMs) ? context.nowMs : 0;

  /* ── Eleme (fail-closed): her kapı ayrı bir gerekçe üretir ── */
  const eligible: AiProviderCapability[] = [];
  for (const provider of request.providers) {
    if (!provider || typeof provider.id !== 'string' || !provider.id || !provider.defaultModel) continue;

    if (!availableIds.has(provider.id)) {
      rejected.push({ providerId: provider.id, reason: 'no_credentials' });
      continue;
    }
    if (context.online === false && provider.supportsOffline !== true) {
      rejected.push({ providerId: provider.id, reason: 'offline_no_offline_provider' });
      continue;
    }
    if (context.paidAccess === false && provider.freeTier !== true) {
      rejected.push({ providerId: provider.id, reason: 'paid_access_required' });
      continue;
    }
    if (!meetsRequirements(provider, strategy)) {
      rejected.push({ providerId: provider.id, reason: 'capability_mismatch' });
      continue;
    }
    if (isBlocked(context.health?.[provider.id], nowMs)) {
      rejected.push({ providerId: provider.id, reason: 'all_blocked' });
      continue;
    }
    eligible.push(provider);
  }

  if (eligible.length === 0) {
    // En açıklayıcı gerekçeyi seç (hepsi elendiyse neden elendiğini söyle).
    if (rejected.length === 0)                                              return empty('no_providers');
    if (rejected.every((r) => r.reason === 'no_credentials'))               return empty('no_credentials');
    if (rejected.some((r) => r.reason === 'all_blocked'))                   return empty('all_blocked');
    if (rejected.some((r) => r.reason === 'offline_no_offline_provider'))   return empty('offline_no_offline_provider');
    if (rejected.some((r) => r.reason === 'paid_access_required'))          return empty('paid_access_required');
    return empty('capability_mismatch');
  }

  /* ── Puanlama + DETERMİNİSTİK sıralama ── */
  const scored = eligible.map((provider) => {
    const base    = scoreProvider(provider, strategy);
    const penalty = healthPenalty(context.health?.[provider.id]);
    const score   = Math.max(0, Math.min(1, base - penalty));
    return { provider, score, preferred: context.preferredProviderId === provider.id };
  });

  // Tercih ÖNCE (kapıları geçtiyse) → puan DESC → eşitlikte id ASC.
  // id karşılaştırması sıralamayı KARARLI kılar: girdi sırası sonucu değiştirmez.
  scored.sort((a, b) =>
    (Number(b.preferred) - Number(a.preferred)) ||
    (b.score - a.score) ||
    a.provider.id.localeCompare(b.provider.id));

  const chain: DecisionCandidate[] = scored.slice(0, MAX_FALLBACK_CHAIN).map(({ provider, score }) => ({
    providerId: provider.id,
    model:      modelFor(provider, task),
    score,
  }));

  const winner = scored[0] as { provider: AiProviderCapability; score: number; preferred: boolean };

  /* Kullanıcı modeli YALNIZ seçilen sağlayıcıya aitse uygulanır (yanlış
     sağlayıcıya yabancı model gönderilmez). */
  const preferredModelApplies =
    !!context.preferredModel &&
    context.preferredProviderId === winner.provider.id;
  const model = preferredModelApplies
    ? (context.preferredModel as string)
    : modelFor(winner.provider, task);

  // Gerekçe önceliği: en AÇIKLAYICI olan kazanır (birden fazlası doğru olabilir).
  const reason: DecisionReason =
    winner.preferred            ? 'preferred_by_user'
    : context.online === false  ? 'offline_capable'     // çevrimdışı kısıt belirleyici
    : eligible.length === 1     ? 'only_candidate'
    : 'best_score';

  const head: DecisionCandidate = { providerId: winner.provider.id, model, score: winner.score };

  return {
    ok:            true,
    task,
    providerId:    winner.provider.id,
    model,
    reason,
    fallbackChain: [head, ...chain.slice(1)],
    rejected,
  };
}

/* ── Telemetri ─────────────────────────────────────────────────────────────── */

/**
 * Karardan GÜVENLİ metadata üretir. Prompt/mesaj/kullanıcı metni/araç verisi
 * TAŞIMAZ — yalnız görev tipi, seçilen sağlayıcı/model ve ölçüm alanları.
 *
 * `decisionMs` çağıran tarafından (DI saatle) ölçülür; burada zaman OKUNMAZ.
 */
export function buildDecisionTelemetry(
  decision: MaviModelDecision,
  decisionMs: number,
  attemptIndex = 0,
): DecisionTelemetry {
  return {
    taskType:       decision.task,
    providerId:     decision.providerId,
    model:          decision.model,
    usedFallback:   attemptIndex > 0,
    decisionMs:     Number.isFinite(decisionMs) && decisionMs >= 0 ? decisionMs : 0,
    candidateCount: decision.fallbackChain.length,
    ok:             decision.ok,
  };
}

/* ── Kolaylık sarmalayıcı (DI saat ile süre ölçümü) ───────────────────────── */

export interface MaviModelOrchestrator {
  decide(request: OrchestratorRequest): { decision: MaviModelDecision; telemetry: DecisionTelemetry };
}

/**
 * Karar + telemetri üreten ince sarmalayıcı. Saat DI'dır (`Date.now` gömülü
 * değildir); verilmezse süre 0 raporlanır — UYDURMA ÖLÇÜM YAPILMAZ.
 */
export function createMaviModelOrchestrator(deps?: { readonly clock?: { nowMs(): number } }): MaviModelOrchestrator {
  const clock = deps?.clock;
  return {
    decide(request: OrchestratorRequest) {
      const started  = clock ? clock.nowMs() : 0;
      const decision = decideModel(request);
      const ended    = clock ? clock.nowMs() : 0;
      return { decision, telemetry: buildDecisionTelemetry(decision, ended - started) };
    },
  };
}
