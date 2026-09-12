/**
 * OpenRouter anahtar kaynağı — BYOK bağlaması (concrete binding).
 *
 * Saf katmandan (gateway/provider) AYRI tutulur: bu dosya `sensitiveKeyStore`
 * (Capacitor/native) import eder; saf katman etmez. Böylece gateway/provider
 * testleri ve tüketicileri native bağımlılık ÇEKMEZ.
 *
 * ── ANAHTAR ÖNCELİĞİ ────────────────────────────────────────────────────────
 *   1) sensitiveKeyStore('openRouterApiKey')  ← BYOK, ÜRETİM YOLU
 *      (native: Android Keystore + EncryptedSharedPreferences; web: AES-256-GCM)
 *   2) `VITE_OPENROUTER_API_KEY`               ← YALNIZ GELİŞTİRME
 *
 * ⚠️ GÜVENLİK — ENV'İN GERÇEĞİ: `import.meta.env.*` değerleri BUILD SIRASINDA
 * bundle'a GÖMÜLÜR; APK'ya konan bir env anahtarı kaynak koda yazmakla aynı
 * risktir (APK açılıp okunabilir) ve `CLAUDE.md` "merkezi/gömülü API anahtarı
 * konmaz — BYOK" kuralını ihlal eder. Bu yüzden env yalnız GELİŞTİRME
 * kolaylığıdır; satış/üretim build'inde `.env` içinde OpenRouter anahtarı
 * BULUNMAMALIDIR. Her müşteri kendi anahtarını ayarlardan girer.
 *
 * Anahtar hiçbir yerde loglanmaz/serileştirilmez; okuma hatası → boş string
 * (fail-closed: gateway ağa çıkmaz, `no_api_key` döner).
 */

import { sensitiveKeyStore } from '../../../sensitiveKeyStore';
import type { AiApiKeySource } from '../types';

/** Yalnız geliştirme için env fallback (üretimde tanımsız olmalıdır). */
export function getEnvOpenRouterKey(): string {
  return ((import.meta.env['VITE_OPENROUTER_API_KEY'] as string | undefined) ?? '').trim();
}

/**
 * Üretim anahtar kaynağı: önce güvenli depo (BYOK), sonra env (dev).
 * Depo hatası fail-soft yutulur → '' (anahtar yok).
 */
export function createOpenRouterKeySource(): AiApiKeySource {
  return {
    async getApiKey(): Promise<string> {
      try {
        const stored = (await sensitiveKeyStore.get('openRouterApiKey')).trim();
        if (stored) return stored;
      } catch { /* depo okunamadı → env fallback */ }
      return getEnvOpenRouterKey();
    },
  };
}
