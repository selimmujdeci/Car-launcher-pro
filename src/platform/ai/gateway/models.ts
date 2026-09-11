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
  /* Anthropic
   * ⚠️ SAHA 2026-07-24 (cihazda gerçek anahtarla ölçüldü): `anthropic/claude-3.5-haiku`
   * OpenRouter'da EMEKLİ → `404 No endpoints found` (varsayılan model olduğu için
   * gateway hattı tamamen ölüydü). Güncel slug 4.5 ailesidir. */
  claudeSonnet:  'anthropic/claude-sonnet-4.5',
  claudeHaiku:   'anthropic/claude-haiku-4.5',
  /* OpenAI */
  gpt4o:         'openai/gpt-4o',
  gpt4oMini:     'openai/gpt-4o-mini',
  /* Google — SAHA 2026-07-24: `google/gemini-2.0-flash-001` de OpenRouter'da 404. */
  geminiFlash:   'google/gemini-2.5-flash',
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
  flashLite35:  'gemini-3.5-flash-lite',
  flash36:      'gemini-3.6-flash',
  flashLite31:  'gemini-3.1-flash-lite',
  flashLite:    'gemini-flash-lite-latest',
  flashLatest:  'gemini-flash-latest',
} as const satisfies Record<string, AiModelId>;

/* ── SAHA 2026-09-11 · ZİNCİRİN BAŞI ÖLÜYDÜ (gerçek cihaz, kullanıcının anahtarı)
 * ŞİKAYET: "ben konuştuktan sonra çok geç cevap veriyor" — ölçülen tur
 * 18,1 sn (`listen_start` → ilk duyulabilir ses); bunun 10,1 sn'si BEYİNDİ ve
 * o sürenin ~4,1 sn'si ÖLÜ SAĞLAYICI DENEMELERİNDE harcanıyordu.
 *
 * Her model tek tek denendi (aynı anahtar, aynı cihaz, aynı dakika):
 *   gemini-2.5-flash          → 404 "no longer available to new users"  ⛔ KALICI
 *   gemini-3.6-flash          → 400 (thinkingConfig) / 429 (kota)
 *   gemini-3.1-flash-lite     → 200 · 2,04 sn
 *   gemini-flash-lite-latest  → 200 · 0,62 sn  (yalnız thinkingConfig'SİZ)
 *   gemini-flash-latest       → 200 · 0,97 sn  (thinkingConfig İLE; alansız 503)
 *   gemini-3.5-flash-lite     → 200 · 0,56 sn  (yalnız thinkingConfig'SİZ)  ⚡
 *   gemini-3.5-flash          → 200 · 6,3-12,6 sn  🐢 (sesli asistan için çok yavaş)
 *
 * `gemini-2.5-flash` ZİNCİRDEN ÇIKARILDI: 2026-07-24'te 880 ms ile zincirin
 * BAŞIYDI, bugün Google tarafından emekliye ayrıldı ve hata mesajı KALICI
 * ("no longer available to new users") — 429/503 gibi geri dönmez, dolayısıyla
 * "kota yenilenir" gerekçesiyle listede tutmanın karşılığı yok. Her oturumun
 * ilk turunda 2 istek (0,62 sn) boşa gidiyordu.
 *
 * SIRA ARTIK ÖLÇÜLEN GECİKMEYE GÖRE: araç içi sesli asistanda cevap süresi bir
 * UX kısıtıdır ve zincir zaten bir KALİTE sıralaması değil, "ilk çalışan
 * kullanılır" listesidir — bugün fiilen hizmet veren model zaten `flashLite31`
 * (bir "lite" model) idi; `flashLite35` onun daha yeni ve 4 kat hızlı eşi.
 * `flash36` kotası bugün dolu ama 429 GEÇİCİDİR → listede, sonda kalır. */
export const GEMINI_MODEL_CHAIN: readonly AiModelId[] = [
  GEMINI_MODELS.flashLite35,  // saha: 0,56 sn — yalnız thinkingConfig'SİZ 200
  GEMINI_MODELS.flashLite,    // saha: 0,62 sn — yalnız thinkingConfig'SİZ 200
  GEMINI_MODELS.flashLatest,  // saha: 0,97 sn — thinkingConfig İLE 200
  GEMINI_MODELS.flashLite31,  // saha: 2,04 sn — thinkingConfig'li de çalışır
  GEMINI_MODELS.flash36,      // saha: bugün 429 (kota) — yenilenirse geri gelir
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

/* ══════════════════════════════════════════════════════════════════════════
 * `thinkingConfig` DESTEĞİ — ÖLÇÜLEN YETENEK, TEK SAHİP
 *
 * Bazı modeller `generationConfig.thinkingConfig` alanını REDDEDER
 * (`400 INVALID_ARGUMENT`); aynı model alansız 200 döner. Model adından çıkarım
 * YAPILAMAZ (ölçüm: `3.1-flash-lite` KABUL eder, `3.5-flash-lite` ETMEZ).
 *
 * SAHA 2026-09-11 (cihaz, ağ izi): alan SEKİZ ayrı çağrı yerinden KOŞULSUZ
 * gönderiliyordu ve öğrenilen ret yalnız beyin yolunda tutuluyordu → tek turda
 * AYNI model üç kez 400 aldı (ölçülen 0,51 + 0,60 + 0,41 sn ≈ 1,5 sn boşa).
 * Yetenek bilgisi artık BURADA (zincirin sahibi, yaprak modül) durur; her çağrı
 * yeri gövdeyi kurarken BURAYA sorar. İkinci bir kopya tutulmaz.
 *
 * Küme bounded: en fazla zincir uzunluğu kadar model adı. Oturum ömürlü —
 * yeniden başlatmada yeniden öğrenilir (kalıcı depoya YAZILMAZ: model yetenekleri
 * sağlayıcı tarafında değişebilir, bayat bilgi sahte kısıt üretir).
 * ════════════════════════════════════════════════════════════════════════ */
const _thinkingRejected = new Set<string>();

/** Bu model `thinkingConfig`i reddetti mi (ÖLÇÜLDÜ — varsayım değil). */
export function isGeminiThinkingRejected(model: string): boolean {
  return _thinkingRejected.has(model);
}

/** Ölçülen reddi kaydet — o model bir daha bu alanla denenmez. */
export function noteGeminiThinkingRejected(model: string): void {
  if (model) _thinkingRejected.add(model);
}

/**
 * `generationConfig`e serpilecek `thinkingConfig` parçası — model kabul
 * ediyorsa alan, etmiyorsa BOŞ nesne. TEK KAPI: çağrı yerleri kendi koşullarını
 * yazmaz (yazdıkları anda bilgi yeniden ayrışır).
 */
export function geminiThinkingConfig(
  model: string, thinkingBudget = 0,
): { thinkingConfig?: { thinkingBudget: number } } {
  return isGeminiThinkingRejected(model) ? {} : { thinkingConfig: { thinkingBudget } };
}

/** @internal — testler arası izolasyon. */
export function _resetGeminiThinkingForTest(): void { _thinkingRejected.clear(); }

/**
 * `400` gördüyse bunun PARAMETRE reddi olup olmadığına karar verir ve öyleyse
 * kaydeder. **Girdiyi tüketmez** (`clone`), throw ETMEZ.
 *
 * ⚠️ 400 İKİ AYRI ŞEY olabilir: (a) `API_KEY_INVALID` — anahtar gerçekten
 * geçersiz; bunu "alan desteklenmiyor" sanmak yanlış öğrenme olur ve
 * `thinkingBudget:0` kalkınca DÜŞÜNEN modeller metinsiz `MAX_TOKENS` döner
 * (SAHA 2026-07-03). (b) `INVALID_ARGUMENT` — alan desteklenmiyor.
 * Gövde okunamıyorsa muhafazakâr davranılır: KAYIT YOK.
 */
export async function noteGeminiThinkingRejectedIf400(
  model: string, resp: Response,
): Promise<boolean> {
  if (resp.status !== 400 || isGeminiThinkingRejected(model)) return false;
  let body = '';
  try { body = await resp.clone().text(); } catch { body = ''; }
  if (!body || /API_KEY_INVALID/i.test(body)) return false;
  noteGeminiThinkingRejected(model);
  return true;
}
