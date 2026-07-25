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
 * ⚠️ MODEL KOTASI MODEL-BAZLIDIR — bu yüzden TEK model asla yeterli değildir.
 * SAHA 2026-07-24 (kullanıcının GERÇEK anahtarıyla cihazda ölçüldü):
 *   gemini-flash-latest      → 429 (kota dolu — eski varsayılan, ARTIK ÇALIŞMIYOR)
 *   gemini-2.0-flash         → 429
 *   gemini-2.5-flash         → 200 OK   ~880ms
 *   gemini-3.6-flash         → 200 OK  ~1330ms (en yeni)
 *   gemini-flash-lite-latest → 200 OK   ~710ms (en hızlı)
 *   gemini-3.5-flash         → 503 (geçici yoğunluk)
 *   gemini-2.5-flash-lite    → 404 (emekli)
 * AYNI ANAHTARLA bir model 429 verirken diğeri 200 döndüğü için, tek modele
 * bağlı kalmak asistanı sebepsiz susturur (2026-07-03'te seçilen
 * `gemini-flash-latest` bugün kotası dolu olan model). Çözüm: SIRALI ZİNCİR.
 */
export const GEMINI_MODELS = {
  flash25:      'gemini-2.5-flash',
  flash36:      'gemini-3.6-flash',
  flashLite31:  'gemini-3.1-flash-lite',
  flashLite:    'gemini-flash-lite-latest',
  flashLatest:  'gemini-flash-latest',
} as const satisfies Record<string, AiModelId>;

/**
 * Gemini model TERCİH SIRASI — kota (429) / emekli model (404) / geçici
 * yoğunluk (503) durumunda sıradaki DENENİR. Sıra: denge → en yeni → en hızlı.
 * `flashLatest` en sonda bilinçli tutulur: bugün kotası dolu ama kota
 * yenilendiğinde yeniden kullanılabilir olur (kalıcı olarak silmeye gerek yok).
 */
export const GEMINI_MODEL_CHAIN: readonly AiModelId[] = [
  GEMINI_MODELS.flash25,
  GEMINI_MODELS.flash36,
  GEMINI_MODELS.flashLite31,  // saha: thinkingConfig İLE de 200 (kota ayrı havuz)
  GEMINI_MODELS.flashLite,    // saha: yalnız thinkingConfig'SİZ 200 (aşağıdaki nota bak)
  GEMINI_MODELS.flashLatest,
];

/**
 * ⚠️ `thinkingConfig` UYUMU (SAHA 2026-07-24, cihazda ölçüldü): bazı "lite"
 * modeller `generationConfig.thinkingConfig` alanını REDDEDER →
 * `400 Request contains an invalid argument`. AYNI model bu alan olmadan 200
 * döner (`gemini-flash-lite-latest`, `gemini-3.5-flash-lite`), buna karşılık
 * `gemini-3.1-flash-lite` alanı KABUL eder. Model adından çıkarım YAPILAMAZ —
 * bu yüzden çağıran taraf 400'de alanı düşürüp BİR KEZ yeniden dener
 * (companionChatProvider). Liste tutmak yerine kendi kendini onaran davranış.
 */

/** Gemini sağlayıcısının varsayılan metin modeli (zincirin ilki). */
export const DEFAULT_GEMINI_MODEL: AiModelId = GEMINI_MODEL_CHAIN[0] as AiModelId;

/**
 * Gemini sohbet uç noktası — model adı TEK KAYNAKTAN gelir.
 * Model adının URL'e gömülü olması (4 ayrı dosyada) modelin emekliye
 * ayrılmasını sessiz bir arızaya çeviriyordu; artık tek yerden üretilir.
 */
export function geminiChatEndpoint(model: AiModelId = DEFAULT_GEMINI_MODEL): string {
  return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
}

/**
 * VARSAYILAN MODEL — model değiştirmek için DEĞİŞTİRİLECEK TEK SATIR.
 * Araç-içi kullanım gereği: düşük gecikme + düşük maliyet önceliklidir.
 */
export const DEFAULT_AI_MODEL: AiModelId = AI_MODELS.claudeHaiku;

/** Takma addan slug'a çözüm (bilinmeyen ad → `undefined`, uydurma YOK). */
export function resolveModelAlias(alias: string): AiModelId | undefined {
  return (AI_MODELS as Record<string, AiModelId>)[alias];
}
