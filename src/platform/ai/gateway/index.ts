/**
 * AI Gateway — genel yüzey (barrel).
 *
 * Buradan YALNIZ SAF katman dışa verilir (tipler · gateway · model kataloğu ·
 * OpenRouter sağlayıcısı). `concrete/` altındaki bağlamalar (BYOK anahtar
 * kaynağı, varsayılan bileşim) BİLEREK dışa verilmez: onlar
 * `sensitiveKeyStore`/Capacitor gibi native bağımlılıklar çeker ve bu maliyet
 * barrel'ı import eden herkese yayılmamalıdır. Wiring tarafı doğrudan
 * `concrete/defaultAiGateway` import eder.
 */

export type {
  AiApiKeySource,
  AiAttemptLog,
  AiError,
  AiErrorKind,
  AiGateway,
  AiGenerateFailure,
  AiGenerateOptions,
  AiGenerateRequest,
  AiGenerateResult,
  AiGenerateSuccess,
  AiHealthPort,
  AiMessage,
  AiModelId,
  AiNetworkStatus,
  AiProvider,
  AiProviderCallOptions,
  AiProviderRequest,
  AiRole,
  AiSleep,
  AiUsage,
} from './types';

export { createAiGateway } from './aiGateway';
export type { AiGatewayDependencies, AiGatewayRetryPolicy } from './aiGateway';

export { AI_MODELS, DEFAULT_AI_MODEL, resolveModelAlias } from './models';
export type { AiModelAlias } from './models';

export { createOpenRouterProvider, OPEN_ROUTER_PROVIDER_ID } from './providers/openRouterProvider';
export type { OpenRouterProviderDependencies } from './providers/openRouterProvider';
