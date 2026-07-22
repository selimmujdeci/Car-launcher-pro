/**
 * credentialRegistry — desteklenen API kimlik bilgilerinin TEK kayıt defteri.
 *
 * ➕ YENİ SAĞLAYICI EKLEME (Anthropic · OpenAI · DeepSeek · Qwen · Mistral ·
 *    Perplexity · Fireworks · Together AI · Ollama · xAI Grok …):
 *      1) `credentialTypes.ts` → `ApiCredentialId` birliğine kimliği ekle
 *      2) `sensitiveKeyStore.ts` → `SensitiveKey` birliğine depo adını ekle ve
 *         `RECOVERY_KEYS` dizisine koy (kurtarma otomatik kapsar)
 *      3) `credentialVerifiers.ts` → en düşük maliyetli doğrulayıcıyı yaz
 *      4) AŞAĞIYA bir tanım ekle
 *    Yönetici, ayarlar akışı, maskeleme, silme ve kurtarma katmanı DEĞİŞMEZ.
 *
 * Bu dosya IO YAPMAZ — yalnız tanım verisi + doğrulayıcı referansları.
 */

import type { ApiCredentialDescriptor, ApiCredentialId } from './credentialTypes';
import { verifyGeminiKey, verifyGroqKey, verifyOpenRouterKey, verifyTavilyKey } from './credentialVerifiers';

/**
 * Kayıt defteri. Sıra = ayarlarda gösterim sırası.
 *
 * ⚠️ `storeKey` değerleri MEVCUT anahtar adlarıdır — değiştirilmemelidir:
 * kullanıcıların cihazında kayıtlı anahtarlar bu adlarla durur (geriye uyum).
 */
export const API_CREDENTIALS: readonly ApiCredentialDescriptor[] = [
  {
    id:               'openrouter',
    storeKey:         'openRouterApiKey',
    label:            'OpenRouter',
    docsUrl:          'https://openrouter.ai/keys',
    minLength:        16,
    verifyCostsQuota: false,          // GET /key → 0 token
    verify:           verifyOpenRouterKey,
  },
  {
    id:               'gemini',
    storeKey:         'geminiApiKey',
    label:            'Gemini',
    docsUrl:          'https://aistudio.google.com/apikey',
    minLength:        16,
    verifyCostsQuota: false,          // GET /v1beta/models → 0 token
    verify:           verifyGeminiKey,
  },
  {
    id:               'groq',
    storeKey:         'groqApiKey',
    label:            'Groq',
    docsUrl:          'https://console.groq.com/keys',
    minLength:        16,
    verifyCostsQuota: false,          // GET /openai/v1/models → 0 token
    verify:           verifyGroqKey,
  },
  {
    id:               'tavily',
    storeKey:         'tavilyApiKey',
    label:            'Tavily',
    docsUrl:          'https://app.tavily.com/home',
    minLength:        16,
    verifyCostsQuota: true,           // ücretsiz metadata uç noktası YOK → 1 arama kredisi
    verify:           verifyTavilyKey,
  },
];

/** Kimliğe göre tanım (bilinmeyen kimlik → `undefined`, uydurma YOK). */
export function getCredentialDescriptor(id: ApiCredentialId): ApiCredentialDescriptor | undefined {
  return API_CREDENTIALS.find((c) => c.id === id);
}

/** Kayıtlı tüm kimlikler (UI listesi için). */
export function listCredentialIds(): readonly ApiCredentialId[] {
  return API_CREDENTIALS.map((c) => c.id);
}
