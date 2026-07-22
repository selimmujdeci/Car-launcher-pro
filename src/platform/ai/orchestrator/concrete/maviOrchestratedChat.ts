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

  const result = await executeOrchestratedRequest({
    gateway:   params.gateway ?? getDefaultAiGateway(),
    task,
    providers,
    context: {
      online:               typeof navigator === 'undefined' ? true : navigator.onLine !== false,
      availableProviderIds: availableIds,
      health:               getProviderHealthMap(availableIds, nowMs),
      nowMs,
      ...(params.vehicleConnected !== undefined ? { vehicleConnected: params.vehicleConnected } : {}),
    },
    request: {
      messages: buildChatMessages(params.system, params.user, params.history),
      ...(params.timeoutMs   !== undefined ? { timeoutMs:   params.timeoutMs }   : {}),
      ...(params.maxTokens   !== undefined ? { maxTokens:   params.maxTokens }   : {}),
      ...(params.temperature !== undefined ? { temperature: params.temperature } : {}),
    },
    options: {
      ...(params.onToken ? { onToken: params.onToken } : {}),
      ...(params.signal  ? { signal:  params.signal }  : {}),
    },
    health:        healthPort,
    globalCircuit,
    clock,
  });

  if (result.ok) {
    const text = result.result.text.trim();
    return {
      outcome: text
        ? { ok: true, text }
        : { ok: false, netFailure: false, errorKind: 'malformed_response' },
      telemetry: result.telemetry,
    };
  }

  /* Yürütme hatası → köprünün devre-kesici semantiğine çevrilir:
     YALNIZ gerçek ağ ölümü (network/timeout) global kesiciye sayılır. */
  const netFailure = result.failureType === 'network' || result.failureType === 'timeout';
  return {
    outcome: {
      ok: false,
      netFailure,
      errorKind: result.failureType === 'aborted' ? 'aborted' : 'unknown',
    },
    telemetry: result.telemetry,
  };
}
