/**
 * AI Gateway — MODEL KATALOĞU.
 *
 * Model adı KOD İÇİNE SABİTLENMEZ. Bu dosya insan-okunur takma adları
 * (`claudeSonnet`, `gpt4oMini`, …) sağlayıcı slug'larına eşler; model
 * değiştirmek `DEFAULT_AI_MODEL` satırını değiştirmekten ibarettir:
 *
 *     export const DEFAULT_AI_MODEL: AiModelId = AI_MODELS.deepseekChat;
 *
 * Model istek başına da geçilebilir (`generateResponse({ model })`) — katalog
 * yalnızca KOLAYLIKTIR, ZORLAYICI DEĞİLDİR: `AiModelId` serbest string olduğu
 * için katalogda olmayan bir slug da geçerlidir (yeni model çıkınca kod
 * değişikliği beklemeden kullanılabilir).
 *
 * ⚠️ SLUG DOĞRULAMA: Buradaki slug'lar OpenRouter `vendor/model` biçimindedir.
 * Sağlayıcılar model slug'larını zamanla emekliye ayırır — geçersiz slug
 * `invalid_request` (400) olarak DÖNER (sessiz yanlış model YOK). Güncel liste:
 * https://openrouter.ai/models
 */

import type { AiModelId } from './types';

/**
 * Çok-sağlayıcılı katalog. Anahtarlar KARARLI takma adlardır (kod bunlara
 * bakar), değerler değişebilir (slug güncellenirse tek yerde düzeltilir).
 */
export const AI_MODELS = {
  /* Anthropic */
  claudeSonnet:  'anthropic/claude-3.5-sonnet',
  claudeHaiku:   'anthropic/claude-3.5-haiku',
  /* OpenAI */
  gpt4o:         'openai/gpt-4o',
  gpt4oMini:     'openai/gpt-4o-mini',
  /* Google */
  geminiFlash:   'google/gemini-2.0-flash-001',
  /* DeepSeek */
  deepseekChat:  'deepseek/deepseek-chat',
  /* Alibaba */
  qwen72b:       'qwen/qwen-2.5-72b-instruct',
  /* Meta */
  llama70b:      'meta-llama/llama-3.3-70b-instruct',
  /* Mistral */
  mistralLarge:  'mistralai/mistral-large',
} as const satisfies Record<string, AiModelId>;

/** Katalogdaki takma adlar (tip düzeyinde). */
export type AiModelAlias = keyof typeof AI_MODELS;

/**
 * GEMINI DOĞRUDAN API model kimlikleri (OpenRouter slug'ı DEĞİL — Google
 * `generativelanguage` uç noktasının kendi adlandırması).
 *
 * ⚠️ `gemini-flash-latest` bu kod tabanında SAHA DOĞRULAMASIYLA seçilmiştir
 * (2026-07-03): yeni `AQ.` biçimli anahtarların ücretsiz katmanı SABİT ADLI
 * modellerde (ör. `gemini-2.0-flash`) anında 429 veriyor, `flash-latest` 200
 * dönüyor. `aiVoiceService`, `companionChatProvider` ve `semanticAiService`
 * aynı modeli kullanır — tek kaynak burasıdır.
 */
export const GEMINI_MODELS = {
  flashLatest: 'gemini-flash-latest',
} as const satisfies Record<string, AiModelId>;

/** Gemini sağlayıcısının varsayılan metin modeli. */
export const DEFAULT_GEMINI_MODEL: AiModelId = GEMINI_MODELS.flashLatest;

/**
 * VARSAYILAN MODEL — model değiştirmek için DEĞİŞTİRİLECEK TEK SATIR.
 * Araç-içi kullanım gereği: düşük gecikme + düşük maliyet önceliklidir.
 */
export const DEFAULT_AI_MODEL: AiModelId = AI_MODELS.claudeHaiku;

/** Takma addan slug'a çözüm (bilinmeyen ad → `undefined`, uydurma YOK). */
export function resolveModelAlias(alias: string): AiModelId | undefined {
  return (AI_MODELS as Record<string, AiModelId>)[alias];
}
