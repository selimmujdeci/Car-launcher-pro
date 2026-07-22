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
function withVehicleContext(system: string, task: MaviTaskType, nowMs: number): string {
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
  };

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
function withMemory(system: string, task: MaviTaskType): string {
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

  const gateway = params.gateway ?? getDefaultAiGateway();

  /* ARAÇLAR (Faz 2): yalnız gerçekten destekleyen bir sağlayıcı varsa ve
     router izin veriyorsa bildirilir. İkisinden biri yoksa istek BİREBİR
     eskisi gibi (tool alanı hiç eklenmez). */
  const tooling = resolveToolSpecs(providers);

  const baseRequest: AiGenerateRequest = {
    messages: buildChatMessages(withMemory(withVehicleContext(params.system, task, clock.nowMs()), task), params.user, params.history),
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

  if (finalResult.ok) {
    const text = finalResult.result.text.trim();
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
  return {
    outcome: {
      ok: false,
      netFailure,
      errorKind: finalResult.failureType === 'aborted' ? 'aborted' : 'unknown',
    },
    telemetry: finalResult.telemetry,
    ...(_lastContextTelemetry ? { context: _lastContextTelemetry } : {}),
  };
}
