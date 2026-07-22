/**
 * Gemini anahtar kaynağı — BYOK bağlaması (concrete binding).
 *
 * `openRouterKeySource` ile AYNI desen: saf katman (provider) bu dosyayı
 * import etmez; native bağımlılık (`sensitiveKeyStore` → Capacitor) burada
 * izole kalır.
 *
 * ── ANAHTAR ÖNCELİĞİ ────────────────────────────────────────────────────────
 *   1) sensitiveKeyStore('geminiApiKey')  ← BYOK, ÜRETİM YOLU (Android Keystore)
 *   2) `VITE_GEMINI_API_KEY`               ← YALNIZ GELİŞTİRME
 *
 * Bu öncelik MEVCUT `aiVoiceService.resolveApiKey` davranışıyla aynıdır:
 * gateway yolu ile eski voice yolu AYNI anahtarı görür (kullanıcı iki kez
 * anahtar girmez).
 *
 * ⚠️ `VITE_*` değerleri build sırasında bundle'a GÖMÜLÜR — satış build'inde
 * tanımsız kalmalıdır (bkz. `.env.example` uyarısı).
 *
 * Anahtar loglanmaz; okuma hatası → boş string (fail-closed: provider ağa
 * çıkmaz, `no_api_key` döner).
 */

import { sensitiveKeyStore } from '../../../sensitiveKeyStore';
import { getEnvGeminiKey } from '../../../aiVoiceService';
import type { AiApiKeySource } from '../types';

export function createGeminiKeySource(): AiApiKeySource {
  return {
    async getApiKey(): Promise<string> {
      try {
        const stored = (await sensitiveKeyStore.get('geminiApiKey')).trim();
        if (stored) return stored;
      } catch { /* depo okunamadı → env fallback */ }
      return getEnvGeminiKey().trim();
    },
  };
}
