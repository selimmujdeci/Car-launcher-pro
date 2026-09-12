/**
 * maviOrchestratedChat — Mavi'nin orkestre edilmiş sohbet yolu (composition root).
 *
 * Saf katmanları (orchestrator · executor · classifier · capability adapter)
 * GERÇEK bağımlılıklara bağlayan TEK yer:
 *   - gateway            ← `concrete/defaultAiGateway`
 *   - anahtar durumu     ← `apiCredentialManager` (toplu, güvenli metadata)
 *   - sağlayıcı sağlığı  ← `providerHealthStore`
 *   - global kesici      ← mevcut `aiHealth` (sağlayıcı-bazlı sağlık bunu EZMEZ)
 *
 * `askGatewayChat` ile AYNI dış sözleşmeyi (`GatewayChatOutcome`) döndürür →
 * çağıran (companion) için ikisi yer değiştirebilir.
 *
 * Prompt/cevap/araç verisi LOGLANMAZ.
 */

import { getDefaultAiGateway, getDefaultProviderRegistryEntries } from '../../gateway/concrete/defaultAiGateway';
import { buildChatMessages, type GatewayChatOutcome, type GatewayChatParams } from '../../gateway/gatewayChatBridge';
import { getAllCredentialInfo } from '../../credentials/apiCredentialManager';
import { isAiNetHealthy } from '../../../aiHealth';
import { adaptProviderCapabilities, availableProviderIdsOf } from '../capabilityAdapter';
import { classifyTask } from '../taskClassifier';
import { executeOrchestratedRequest, type ExecutionTelemetry } from '../orchestratedExecutor';
import {
  getProviderHealthMap,
  recordProviderFailure,
  recordProviderRateLimit,
  recordProviderSuccess,
} from '../providerHealthStore';
import type { MaviTaskType } from '../orchestratorTypes';
import { getMaviContextConsent, isMaviContextEnabled } from '../../gateway/aiGatewayFlag';
import { collectMaviContext } from '../../context/contextCollector';
import { serializeMaviContext, type SerializedContext } from '../../context/contextSerializer';
import { createMaviContextSources } from '../../context/concrete/maviContextSources';
import type { ContextTelemetry } from '../../context/contextTypes';
import { getMaviMemoryConsent, isMaviMemoryEnabled } from '../../gateway/aiGatewayFlag';
import { buildMemoryBlock } from '../../memory/memoryEngine';
import { createMaviMemorySources } from '../../memory/concrete/maviMemorySources';
import type { MemoryBlock, MemoryTelemetry } from '../../memory/memoryTypes';
import { getMaviToolRouter } from '../../tools/concrete/maviToolRouter';
import { toOpenAiTools } from '../../tools/providerToolSchema';
import { runToolLoop } from '../../tools/toolLoop';
import type { ToolDefinition } from '../../tools/toolTypes';
import type { AiGenerateRequest, AiToolSpec } from '../../gateway/types';
import { planWithRouter } from '../../planner/concrete/maviPlannerRuntime';
import { executePlan, type PlanExecutionOutcome } from '../../planner/planExecutor';
import { derivePlannerHints } from '../../planner/plannerIntent';
import { buildMechanicBlock } from '../../mechanic/concrete/maviMechanic';
import type { MaviPlan } from '../../planner/plannerTypes';
import { isMaviOperatorChatEnabled } from '../../gateway/aiGatewayFlag';
import { resolveOperatorIntent } from '../../operator/intent/operatorIntentResolver';
import { presentOperatorOutcome } from '../../operator/intent/operatorPresenter';
import { runMaviOperator } from '../../operator/concrete/maviOperator';
import type { OperatorReport } from '../../operator/operatorTypes';
import { isValidationActive, recordMaviRun } from '../../../validation/validationRecorder';
import { bumpPerf } from '../../../perf/perfCounters';

/** Monotonik saat — clock-jump güvenli (CLAUDE.md §4). */
const clock = { nowMs: (): number => (typeof performance !== 'undefined' ? performance.now() : 0) };

/** Sağlayıcı sağlık deposunu executor portuna uyarlar. */
const healthPort = {
  recordSuccess:   (id: string) => { recordProviderSuccess(id); },
  recordFailure:   (id: string, kind: Parameters<typeof recordProviderFailure>[1], nowMs: number) => {
    recordProviderFailure(id, kind, nowMs);
  },
  recordRateLimit: (id: string, retryAfterMs: number, nowMs: number) => {
    recordProviderRateLimit(id, retryAfterMs, nowMs);
  },
};

/** Global AI kesicisi — sağlayıcı-bazlı sağlık bunun ÜSTÜNE ÇIKAMAZ. */
const globalCircuit = { isHealthy: (): boolean => isAiNetHealthy() };

export interface OrchestratedChatParams extends GatewayChatParams {
  /** Sınıflandırma için ham kullanıcı metni (LOGLANMAZ, yalnız sınıfa çevrilir). */
  readonly classifyText?: string;
  /** Görev tipi açıkça biliniyorsa sınıflandırıcı ATLANIR. */
  readonly task?:         MaviTaskType;
  /** Araç (OBD) bağlı mı — karara taşınır. */
  readonly vehicleConnected?: boolean;
  /**
   * MAVI-F13 · TEK İZDÜŞÜM SÖZLEŞMESİ.
   *
   * `true` → çağıranın verdiği `system` prompt'u KANONİK araç bağlamını
   * (`buildInterpretedVehicleContext`) ve KANONİK hafıza izdüşümünü
   * (`assistant/maviMemory.projectMaviMemory`, F10) ZATEN taşıyor. Bu katman
   * o iki bloğu İKİNCİ KEZ EKLEMEZ.
   *
   * Neden: denetim (2026-08-29) ölçtü ki `companionChatProvider` prompt'a
   * kanonik bağlam+hafıza koyuyor, ardından bu katman `withVehicleContext` +
   * `withMemory` ile AYNI kanonik kaynaktan İKİNCİ bir blok ekliyordu →
   * aynı olgu prompt'ta iki kez, iki farklı biçimde. Bu bir "zenginleştirme"
   * değil, ikinci bir gerçeklik yüzeyidir.
   *
   * Varsayılan `false` (geriye uyum: DI/test çağıranları etkilenmez).
   */
  readonly systemCarriesCanonicalProjection?: boolean;
}

export interface OrchestratedChatResult {
  readonly outcome:   GatewayChatOutcome;
  readonly telemetry: ExecutionTelemetry;
  /** Bağlam enjeksiyonunun GÜVENLİ metadata'sı (değer/kod TAŞIMAZ). */
  readonly context?:  ContextTelemetry;
}

/** Son bağlam telemetrisi (yalnız güvenli sayaçlar) — test/teşhis içindir. */
let _lastContextTelemetry: ContextTelemetry | undefined;

/** @internal */
export function _getLastContextTelemetry(): ContextTelemetry | undefined {
  return _lastContextTelemetry;
}

/**
 * Araç bağlamını İKİ KAPIDAN geçirerek system prompt'a EKLER.
 *
 * Kapılar (ikisi de gerekli, fail-closed):
 *   1) özellik şalteri açık   2) kullanıcı izni `vehicle_context`
 * Herhangi biri yoksa system prompt AYNEN döner — araç verisi gönderilmez.
 *
 * Bağlam AYRI ve AÇIK ETİKETLİ bir blok olarak system seviyesinde taşınır:
 * kullanıcı mesajı DEĞİŞTİRİLMEZ, bağlam kullanıcı yazmış gibi gösterilmez.
 * Toplama/serileştirme hatası isteği DÜŞÜRMEZ — bağlamsız devam edilir.
 */
function withVehicleContext(
  system: string, task: MaviTaskType, nowMs: number, canonicalUpstream = false,
): string {
  const enabled = safeBool(() => isMaviContextEnabled());
  const consent = safeConsent();
  const record = (outcome: ContextTelemetry['contextOutcome'], s?: SerializedContext, durationMs = 0): void => {
    _lastContextTelemetry = {
      taskType:             task,
      contextEnabled:       enabled,
      consentGranted:       consent === 'vehicle_context',
      contextFieldCount:    s?.fieldCount ?? 0,
      staleFieldCount:      s?.staleFieldCount ?? 0,
      droppedFieldCount:    s?.droppedFieldCount ?? 0,
      collectionDurationMs: durationMs,
      contextSourceCount:   s?.sourceCount ?? 0,
      contextOutcome:       outcome,
    };

    /* ── ARCH-06/F7 · Mavi bağlam İŞ YÜKÜ ölçümü ────────────────────────
       ⚠️ YALNIZ SAYAÇ. Bütçe (`maxChars` 700 · `maxFields` · öncelik sırası)
       DEĞİŞTİRİLMEDİ, hiçbir alan eklenip çıkarılmadı — konuşma doğruluğu
       bu turda pazarlık konusu DEĞİLDİR.

       Sayılan şeyler `serializeMaviContext`in ZATEN hesapladığı değerlerdir;
       burada yalnız oturum boyunca BİRİKTİRİLİR (`_lastContextTelemetry`
       tek bir anı tutar, eğilimi göstermez).

       GİZLİLİK: alan ADI, alan DEĞERİ, kullanıcı metni ve araç kimliği
       sayaca GİRMEZ — yalnız ADET. */
    try {
      bumpPerf('mavi.contextBuildAttempt');
      if (outcome === 'injected') bumpPerf('mavi.contextInjected');
      else                        bumpPerf('mavi.contextSkipped');
      if (s !== undefined) {
        bumpPerf('mavi.contextFieldsKept', s.fieldCount);
        bumpPerf('mavi.contextFieldsDropped', s.droppedFieldCount);
        bumpPerf('mavi.contextFieldsStale', s.staleFieldCount);
      }
    } catch { /* fail-soft: ölçüm sohbeti ASLA düşürmez */ }
  };

  /* MAVI-F13: kanonik izdüşüm YUKARIDA zaten var → ikinci blok EKLENMEZ.
   * Kapı şalter/izinden ÖNCE gelir: kaynak tekliği bir tercih değil sözleşmedir. */
  if (canonicalUpstream)               { record('canonical_upstream'); return system; }
  if (!enabled)                        { record('disabled');   return system; }
  if (consent !== 'vehicle_context')   { record('no_consent'); return system; }

  const started = clock.nowMs();
  try {
    const context = collectMaviContext({ taskType: task, nowMs, sources: createMaviContextSources() });
    const serialized = serializeMaviContext(context, nowMs);
    const durationMs = Math.max(0, clock.nowMs() - started);

    if (!serialized.text) { record('empty', serialized, durationMs); return system; }
    record('injected', serialized, durationMs);
    return `${system}\n\n${serialized.text}`;
  } catch {
    // Bağlam hatası AI çağrısını ENGELLEMEZ; yanlış veri göndermektense
    // bağlamsız devam edilir.
    record('unavailable', undefined, Math.max(0, clock.nowMs() - started));
    return system;
  }
}

/** Son hafıza telemetrisi (yalnız güvenli sayaçlar). */
let _lastMemoryTelemetry: MemoryTelemetry | undefined;

/** @internal */
export function _getLastMemoryTelemetry(): MemoryTelemetry | undefined {
  return _lastMemoryTelemetry;
}

/**
 * Hafızayı İKİ KAPIDAN geçirerek system prompt'a EKLER.
 *
 * Araç bağlamından AYRI izin gerektirir: `mavi.aiMemory.consent === 'memory'`.
 * Kapılardan biri yoksa system prompt AYNEN döner. Hafıza AYRI ve ETİKETLİ blok
 * olarak system seviyesinde taşınır; kullanıcı mesajı DEĞİŞTİRİLMEZ. Okuma
 * hatası isteği DÜŞÜRMEZ.
 */
function withMemory(system: string, task: MaviTaskType, canonicalUpstream = false): string {
  const enabled = safeBool(() => isMaviMemoryEnabled());
  const consent = (() => { try { return getMaviMemoryConsent(); } catch { return 'off'; } })();

  const record = (outcome: MemoryTelemetry['outcome'], b?: MemoryBlock): void => {
    _lastMemoryTelemetry = {
      taskType:       task,
      memoryEnabled:  enabled,
      consentGranted: consent === 'memory',
      recordCount:    b?.recordCount ?? 0,
      longTermCount:  b?.longTermCount ?? 0,
      shortTermCount: b?.shortTermCount ?? 0,
      rejectedCount:  b?.rejectedCount ?? 0,
      droppedCount:   b?.droppedCount ?? 0,
      outcome,
    };
  };

  /* MAVI-F13 · DUPLICATE MEMORY PROJECTION YASAĞI. Kanonik F10 izdüşümü
   * prompt'ta ZATEN varsa ikinci hafıza bloğu EKLENMEZ. */
  if (canonicalUpstream)    { record('canonical_upstream'); return system; }
  if (!enabled)             { record('disabled');   return system; }
  if (consent !== 'memory') { record('no_consent'); return system; }

  try {
    const block = buildMemoryBlock({ taskType: task, sources: createMaviMemorySources() });
    if (!block.text) { record('empty', block); return system; }
    record('injected', block);
    return `${system}\n\n${block.text}`;
  } catch {
    record('unavailable');
    return system;                       // hafıza hatası AI çağrısını engellemez
  }
}

/**
 * Araç tanımlarını hazırlar. Router izin/şalter kapalıysa `listTools()` BOŞ
 * döner → hiç araç bildirilmez (fail-closed). Sağlayıcı `supportsTools`
 * bildirmiyorsa da araç GÖNDERİLMEZ — sahte yetenek kullanılmaz.
 */
function resolveToolSpecs(providers: readonly { id: string; supportsTools?: boolean; available?: boolean }[]): {
  specs: readonly AiToolSpec[];
  router: ReturnType<typeof getMaviToolRouter> | null;
} {
  try {
    // Araçlar YALNIZ gerçekten destekleyen (ve kullanılabilir) bir sağlayıcı
    // varsa bildirilir; desteklemeyen sağlayıcı alanı sessizce yok sayar.
    const anySupports = providers.some((p) => p.supportsTools === true && p.available !== false);
    if (!anySupports) return { specs: [], router: null };
    const router = getMaviToolRouter();
    const tools = router.listTools();
    if (tools.length === 0) return { specs: [], router: null };
    return { specs: toOpenAiToolSpecs(tools), router };
  } catch {
    return { specs: [], router: null };
  }
}

/** Ortak tool sözleşmesi → gateway'in sağlayıcı-nötr `AiToolSpec` şekli. */
function toOpenAiToolSpecs(tools: readonly ToolDefinition[]): readonly AiToolSpec[] {
  return (toOpenAiTools(tools) as Array<{ function: { name: string; description: string; parameters: Record<string, unknown> } }>)
    .map((t) => ({
      name:        t.function.name,
      description: t.function.description,
      parameters:  t.function.parameters,
    }));
}

/**
 * Planı üretir, YÜRÜTÜLEBİLİR (ready + salt-okunur) adımları çalıştırır ve
 * sonuçları ETİKETLİ blok olarak döndürür. Plan ve sonuçlar İSTEK-SCOPE'tur —
 * modül seviyesinde saklanmaz. Hata durumunda BOŞ blok (akış etkilenmez).
 */
async function runPlanForRequest(
  task: MaviTaskType,
  userText: string | undefined,
  signal?: AbortSignal,
): Promise<{ block: string; plan: MaviPlan; execution: PlanExecutionOutcome }> {
  const emptyExec: PlanExecutionOutcome = { block: '', executed: 0, skipped: 0, failed: 0, telemetry: [] };
  try {
    const hints = derivePlannerHints(userText);
    const { plan, router } = planWithRouter(task, hints);
    if (!router || plan.steps.length === 0) return { block: '', plan, execution: emptyExec };
    const execution = await executePlan({ plan, router, ...(signal ? { signal } : {}) });
    return { block: execution.block, plan, execution };
  } catch {
    return { block: '', plan: { taskType: task, steps: [], status: 'empty', truncated: false }, execution: emptyExec };
  }
}

/** Son turda AI Usta bloğu GERÇEKTEN eklendi mi (yalnız güvenli bayrak). */
let _lastDiagnosisUsed = false;

/**
 * AI Usta teşhisini system prompt'a ekler (boşsa AYNEN döner).
 * Karar DETERMİNİSTİK katmandan gelir; LLM yalnız YORUMLAR.
 */
function withDiagnosis(system: string): string {
  _lastDiagnosisUsed = false;
  try {
    const block = buildMechanicBlock().block;
    _lastDiagnosisUsed = !!block;
    return block ? `${system}\n\n${block}` : system;
  } catch {
    return system;                       // teşhis hatası isteği DÜŞÜRMEZ
  }
}

/** Plan sonuç bloğunu system prompt'a ekler (boşsa AYNEN döner). */
function withPlanResults(system: string, block: string): string {
  return block ? `${system}\n\n${block}` : system;
}

/**
 * Operatör turunun sonucu: system prompt bloğu + YALNIZ güvenli metadata
 * (sabit jetonlar/bayraklar). Kullanıcı metni veya rapor içeriği TAŞIMAZ.
 */
interface OperatorRunSummary {
  readonly block:         string;
  readonly intentKind:    string;
  readonly operatorTask:  string;
  readonly knowledgeUsed: boolean;
  readonly mechanicUsed:  boolean;
}

/** Operatör çalışmadığında dönen sabit özet (şalter kapalı / hata). */
const EMPTY_OPERATOR_RUN: OperatorRunSummary = {
  block: '', intentKind: 'disabled', operatorTask: 'none',
  knowledgeUsed: false, mechanicUsed: false,
};

/**
 * OPERATÖR (Faz 2): kullanıcı mesajını DETERMİNİSTİK niyet motoruyla çözer ve
 * uygun MEVCUT operatör görevini güvenle çalıştırıp sonucu ETİKETLİ blok olarak
 * döndürür. Kapı: `isMaviOperatorChatEnabled()` (Operatör→gateway'e zincirli,
 * varsayılan KAPALI). Kapalıysa BOŞ blok → system prompt AYNEN kalır.
 *
 * Güvenlik: niyet allowlist görev kataloğuna eşlenir; belirsiz→netleştirme,
 * araç-dışı→boş, yazma→onay notu (çalıştırma YOK). Operatör alt kapıları
 * (planner/tools/mechanic/knowledge + salt-okunur yürütme) BYPASS EDİLMEZ.
 * timeout/signal zinciri operatöre AYNEN geçirilir. ASLA throw etmez.
 */
async function runOperatorForRequest(
  userText: string | undefined,
  signal?: AbortSignal,
  timeoutMs?: number,
): Promise<OperatorRunSummary> {
  try {
    if (!safeBool(() => isMaviOperatorChatEnabled())) return EMPTY_OPERATOR_RUN;

    const intent = resolveOperatorIntent(userText);

    // Görev çözülmediyse (chat/clarify/needs_approval) operatör ÇALIŞTIRILMAZ.
    let report: OperatorReport | undefined;
    if (intent.kind === 'operator_task' && intent.taskId) {
      report = await runMaviOperator(intent.taskId, {
        ...(signal    ? { signal }    : {}),
        ...(timeoutMs !== undefined ? { timeoutMs } : {}),
        ...(intent.code ? { code: intent.code } : {}),
      });
    }

    return {
      block:         presentOperatorOutcome(intent, report),
      intentKind:    intent.kind,
      operatorTask:  intent.taskId ?? 'none',
      knowledgeUsed: (report?.sections ?? []).some((s) => s.kind === 'knowledge' && s.status === 'executed'),
      mechanicUsed:  (report?.sections ?? []).some((s) => s.kind === 'mechanic'  && s.status === 'executed'),
    };
  } catch {
    return EMPTY_OPERATOR_RUN;           // operatör hatası isteği DÜŞÜRMEZ
  }
}

/** Operatör bloğunu system prompt'a ekler (boşsa AYNEN döner). */
function withOperator(system: string, block: string): string {
  return block ? `${system}\n\n${block}` : system;
}

function safeBool(read: () => boolean): boolean {
  try { return read() === true; } catch { return false; }
}

function safeConsent(): string {
  try { return getMaviContextConsent(); } catch { return 'off'; }
}

/**
 * Orkestre edilmiş sohbet: sınıflandır → karar al → zinciri çalıştır.
 * ASLA throw etmez; her sonuç `GatewayChatOutcome` sözleşmesindedir.
 */
export async function askOrchestratedChat(params: OrchestratedChatParams): Promise<OrchestratedChatResult> {
  const startedMs = clock.nowMs();
  const task = params.task ?? classifyTask(params.classifyText ?? params.user);

  /* Yetenekler: gateway'de KAYITLI sağlayıcılar + anahtarı olanlar. */
  const credentials = await getAllCredentialInfo().catch(() => []);
  const configuredIds = credentials.filter((c) => c.configured).map((c) => c.id as string);
  const providers = adaptProviderCapabilities({
    providers:               getDefaultProviderRegistryEntries(),
    credentialConfiguredIds: configuredIds,
  });

  const nowMs = clock.nowMs();
  const availableIds = availableProviderIdsOf(providers);

  /* PLAN (Faz 2): yalnız ready + SALT-OKUNUR adımlar çalıştırılır; sonuç
     ETİKETLİ blok olarak system seviyesine eklenir. Navigasyon/yazma bu fazda
     ÇALIŞTIRILMAZ. Plan ve sonuçlar İSTEK-SCOPE'tur. */
  const planRun = await runPlanForRequest(task, params.classifyText ?? params.user, params.signal);

  /* OPERATÖR (Faz 2): kendi şalteri açıksa (varsayılan KAPALI) kullanıcı mesajı
     deterministik niyet motoruyla çözülür ve uygun operatör görevi güvenle
     çalıştırılıp ETİKETLİ blok döndürülür. İSTEK-SCOPE; şalter kapalıysa boş. */
  const operatorRun = await runOperatorForRequest(
    params.classifyText ?? params.user, params.signal, params.timeoutMs,
  );

  const gateway = params.gateway ?? getDefaultAiGateway();

  /* MAVI-F13: prompt kanonik bağlam+hafıza taşıyorsa bu katmanın ikinci
   * enjeksiyonu KAPALIDIR (tek izdüşüm sözleşmesi). */
  const _canonicalUpstream = params.systemCarriesCanonicalProjection === true;

  /* ARAÇLAR (Faz 2): yalnız gerçekten destekleyen bir sağlayıcı varsa ve
     router izin veriyorsa bildirilir. İkisinden biri yoksa istek BİREBİR
     eskisi gibi (tool alanı hiç eklenmez). */
  const tooling = resolveToolSpecs(providers);

  const baseRequest: AiGenerateRequest = {
    messages: buildChatMessages(
      withOperator(
        withDiagnosis(withPlanResults(
          withMemory(
            withVehicleContext(params.system, task, clock.nowMs(), _canonicalUpstream),
            task, _canonicalUpstream,
          ),
          planRun.block,
        )),
        operatorRun.block,
      ),
      params.user, params.history,
    ),
    ...(params.timeoutMs   !== undefined ? { timeoutMs:   params.timeoutMs }   : {}),
    ...(params.maxTokens   !== undefined ? { maxTokens:   params.maxTokens }   : {}),
    ...(params.temperature !== undefined ? { temperature: params.temperature } : {}),
    ...(tooling.specs.length > 0 ? { tools: tooling.specs } : {}),
  };

  const options = {
    ...(params.onToken ? { onToken: params.onToken } : {}),
    ...(params.signal  ? { signal:  params.signal }  : {}),
  };

  const result = await executeOrchestratedRequest({
    gateway,
    task,
    providers,
    context: {
      online:               typeof navigator === 'undefined' ? true : navigator.onLine !== false,
      availableProviderIds: availableIds,
      health:               getProviderHealthMap(availableIds, nowMs),
      nowMs,
      ...(params.vehicleConnected !== undefined ? { vehicleConnected: params.vehicleConnected } : {}),
    },
    request: baseRequest,
    options,
    health:        healthPort,
    globalCircuit,
    clock,
  });

  /* Model ARAÇ çağırdıysa: router'dan geçir, sonucu ETİKETLİ system bloğu
     olarak ekle ve SEÇİLEN sağlayıcıya sabitlenmiş şekilde yeniden sor.
     Zincir/fallback İLK turda zaten uygulandı. */
  /** Modelin bu turda istediği araç çağrısı sayısı (yalnız sayı — argüman YOK). */
  const toolCallCount = result.ok ? (result.result.toolCalls?.length ?? 0) : 0;

  let finalResult = result;
  if (result.ok && tooling.router && (result.result.toolCalls?.length ?? 0) > 0) {
    try {
      const loop = await runToolLoop(baseRequest, {
        generate: (req) => gateway.generateResponse(
          { ...req, providerId: result.providerId, model: result.model },
          options,
        ),
        router:        tooling.router,
        toolSpecs:     tooling.specs,
        initialResult: result.result,
        ...(params.signal ? { signal: params.signal } : {}),
      });
      if (loop.result.ok) finalResult = { ...result, result: loop.result };
    } catch { /* araç turu hatası isteği DÜŞÜRMEZ — ilk sonuçla devam */ }
  }

  /* SAHA DOĞRULAMA (varsayılan KAPALI): oturum çalışmıyorsa TEK boolean
     kontrolüyle atlanır — üretim yolunda ek yük YOK. Yazılan her alan sabit
     jeton/sayıdır; prompt, cevap veya araç verisi TAŞINMAZ. */
  const emitValidation = (ok: boolean, errorKind: string | null): void => {
    if (!isValidationActive()) return;
    recordMaviRun({
      intentKind:         operatorRun.intentKind,
      operatorTask:       operatorRun.operatorTask,
      plannerUsed:        planRun.plan.steps.length > 0,
      toolCalls:          toolCallCount,
      mechanicUsed:       _lastDiagnosisUsed || operatorRun.mechanicUsed,
      knowledgeUsed:      operatorRun.knowledgeUsed,
      memoryUsed:         _lastMemoryTelemetry?.outcome === 'injected',
      vehicleContextUsed: _lastContextTelemetry?.contextOutcome === 'injected',
      durationMs:         Math.max(0, clock.nowMs() - startedMs),
      ok,
      errorKind,
    });
  };

  if (finalResult.ok) {
    const text = finalResult.result.text.trim();
    emitValidation(!!text, text ? null : 'malformed_response');
    return {
      outcome: text
        ? { ok: true, text }
        : { ok: false, netFailure: false, errorKind: 'malformed_response' },
      telemetry: finalResult.telemetry,
      ...(_lastContextTelemetry ? { context: _lastContextTelemetry } : {}),
    };
  }

  /* Yürütme hatası → köprünün devre-kesici semantiğine çevrilir:
     YALNIZ gerçek ağ ölümü (network/timeout) global kesiciye sayılır. */
  const netFailure = finalResult.failureType === 'network' || finalResult.failureType === 'timeout';
  const errorKind  = finalResult.failureType === 'aborted' ? 'aborted' : 'unknown';
  emitValidation(false, errorKind);
  return {
    outcome: { ok: false, netFailure, errorKind },
    telemetry: finalResult.telemetry,
    ...(_lastContextTelemetry ? { context: _lastContextTelemetry } : {}),
  };
}
