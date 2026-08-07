/**
 * credentialRegistry — desteklenen API kimlik bilgilerinin TEK kayıt defteri.
 *
 * Ayarlar paneli TAMAMEN bu defterden sürülür: sıra, etiket, rol açıklaması,
 * "gelişmiş" gizlemesi, pano otomatik algılama, QR aktarımı, `.env` rozeti ve
 * doğrulama — hepsi tanımdan gelir. Panelde sağlayıcıya özel `if` YOKTUR.
 *
 * ➕ YENİ SAĞLAYICI EKLEME (Anthropic · OpenAI · DeepSeek · Qwen · Mistral ·
 *    Perplexity · Fireworks · Together AI · Ollama · xAI Grok …):
 *      1) `credentialTypes.ts` → `ApiCredentialId` birliğine kimliği ekle
 *      2) `sensitiveKeyStore.ts` → `SensitiveKey` birliğine depo adını ekle ve
 *         `RECOVERY_KEYS` dizisine koy (kurtarma otomatik kapsar)
 *      3) `credentialVerifiers.ts` → en düşük maliyetli doğrulayıcıyı yaz
 *      4) AŞAĞIYA bir tanım ekle
 *    Yönetici, ayarlar paneli, maskeleme, silme ve kurtarma DEĞİŞMEZ.
 *
 * Bu dosya IO YAPMAZ — yalnız tanım verisi + doğrulayıcı referansları.
 */

import type { ApiCredentialDescriptor, ApiCredentialId } from './credentialTypes';
import {
  verifyGeminiKey,
  verifyGroqKey,
  verifyHaikuKey,
  verifyOpenRouterKey,
  verifyTavilyKey,
  verifyGeocodeGoogleKey,
  verifyGeocodeHereKey,
  verifyGeocodeYandexKey,
} from './credentialVerifiers';
import { getEnvGeminiKey, getEnvGroqKey, getEnvHaikuKey } from '../../aiVoiceService';

/**
 * Kayıt defteri. Sıra = ayarlarda gösterim sırası.
 *
 * ⚠️ `storeKey` değerleri MEVCUT anahtar adlarıdır — değiştirilmemelidir:
 * kullanıcıların cihazında kayıtlı anahtarlar bu adlarla durur (geriye uyum).
 */
export const API_CREDENTIALS: readonly ApiCredentialDescriptor[] = [
  {
    id:               'gemini',
    storeKey:         'geminiApiKey',
    label:            'Gemini',
    roleHint:         'Asistanın beyni: seni anlar, konuşur, komutları uygular.',
    docsUrl:          'https://aistudio.google.com/apikey',
    minLength:        16,
    verifyCostsQuota: false,          // GET /v1beta/models → 0 token
    verify:           verifyGeminiKey,
    placeholder:      'AIza... / AQ...',
    // MEVCUT panelin deseniyle BİREBİR (eski `AIza...` + 2026 `AQ.Ab8...`) —
    // otomatik algılama davranışı değişmesin.
    clipboardPattern: /^(AIza[A-Za-z0-9_-]{35,}|AQ\.[A-Za-z0-9_.-]{20,})$/,
    keyBeamKind:      'gemini',
    getEnvKey:        getEnvGeminiKey,
  },
  {
    id:               'openrouter',
    storeKey:         'openRouterApiKey',
    label:            'OpenRouter',
    roleHint:         'Tek anahtarla çok model: Mavi\'nin yeni yapay zekâ bağlantısı.',
    docsUrl:          'https://openrouter.ai/keys',
    minLength:        16,
    verifyCostsQuota: false,          // GET /key → 0 token
    verify:           verifyOpenRouterKey,
    placeholder:      'sk-or-v1-...',
    clipboardPattern: /^sk-or-v1-[A-Za-z0-9]{20,}$/,
    keyBeamKind:      'openrouter',
  },
  {
    id:               'tavily',
    storeKey:         'tavilyApiKey',
    label:            'Tavily',
    roleHint:         'İnternet araması: haber, döviz, altın gibi güncel bilgi.',
    docsUrl:          'https://app.tavily.com/home',
    minLength:        16,
    verifyCostsQuota: true,           // ücretsiz metadata uç noktası YOK → 1 arama kredisi
    verify:           verifyTavilyKey,
    advanced:         true,
    placeholder:      'tvly-...',
    clipboardPattern: /^tvly-[A-Za-z0-9_-]{10,}$/,
    keyBeamKind:      'tavily',
  },
  {
    id:               'groq',
    storeKey:         'groqApiKey',
    label:            'Groq',
    roleHint:         'Yedek beyin: Gemini yoğun/kesik olduğunda asistan susmaz.',
    docsUrl:          'https://console.groq.com/keys',
    minLength:        16,
    verifyCostsQuota: false,          // GET /openai/v1/models → 0 token
    verify:           verifyGroqKey,
    advanced:         true,
    placeholder:      'gsk_...',
    clipboardPattern: /^gsk_[A-Za-z0-9]{20,}$/,
    keyBeamKind:      'groq',
    getEnvKey:        getEnvGroqKey,
  },
  {
    id:               'haiku',
    storeKey:         'claudeHaikuApiKey',
    label:            'Claude Haiku',
    roleHint:         'Yedek beyin: zincirin son halkası.',
    docsUrl:          'https://console.anthropic.com/settings/keys',
    minLength:        16,
    verifyCostsQuota: false,          // GET /v1/models → 0 token
    verify:           verifyHaikuKey,
    advanced:         true,
    placeholder:      'sk-ant-...',
    clipboardPattern: /^sk-ant-[A-Za-z0-9_-]{20,}$/,
    keyBeamKind:      'haiku',
    getEnvKey:        getEnvHaikuKey,
  },
  /* ── Adres/geocoding sağlayıcıları (BYOK) ────────────────────────────────
   * Bunlar YAPAY ZEKÂ anahtarı DEĞİLDİR. Neden buradalar: saha ölçümü
   * (2026-08-03) ücretsiz OSM zincirinin Türkiye'de numaralı sokakları
   * çözemediğini gösterdi — "Tarsus Bağlar Mah. 0455. Sokak" yolu OSM'de
   * ÇİZİLİ ama İSİMSİZ (350 m çevrede 41 adsız yol). Bu bir kod açığı değil
   * VERİ açığıdır; OEM'ler bunu lisanslı adres verisiyle kapatır.
   *
   * ⚖️ Hiçbiri "önerilen" DEĞİLDİR ve varsayılan YOKTUR: ürün kutudan
   * ücretsiz OSM ile gelir. Sağlayıcıların çoğu geocoding sonucunun kendi
   * harita altlıkları dışında gösterilmesini kısıtlar → hangi veriyi
   * lisanslayacağı ve şartlarına uyacağı ÜRETİCİNİN/müşterinin kararıdır.
   * Uygulamaya gömülü anahtar KONULMAZ (CLAUDE.md ticari kuralı). */
  {
    id:               'geocode-google',
    storeKey:         'geocodeGoogleApiKey',
    label:            'Google Geocoding (adres)',
    roleHint:         'Sokak/mahalle adreslerini çözer. Türkiye numaralı sokak kapsaması en geniş olan kaynak.',
    docsUrl:          'https://console.cloud.google.com/google/maps-apis/credentials',
    minLength:        20,
    verifyCostsQuota: true,           // metadata uç noktası yok → 1 geocoding isteği
    verify:           verifyGeocodeGoogleKey,
    advanced:         true,
    placeholder:      'AIza...',
  },
  {
    id:               'geocode-here',
    storeKey:         'geocodeHereApiKey',
    label:            'HERE Geocoding (adres)',
    roleHint:         'Sokak/mahalle adreslerini çözer. Otomotiv OEM tarafında yaygın lisans.',
    docsUrl:          'https://platform.here.com/',
    minLength:        20,
    verifyCostsQuota: true,
    verify:           verifyGeocodeHereKey,
    advanced:         true,
  },
  {
    id:               'geocode-yandex',
    storeKey:         'geocodeYandexApiKey',
    label:            'Yandex Geocoder (adres)',
    roleHint:         'Sokak/mahalle adreslerini çözer. Türkiye kapsaması güçlü.',
    docsUrl:          'https://developer.tech.yandex.ru/services/',
    minLength:        20,
    verifyCostsQuota: true,
    verify:           verifyGeocodeYandexKey,
    advanced:         true,
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

/** Panoda görülen metni tanıyan ilk tanım (yoksa `undefined`). */
export function matchCredentialByClipboard(text: string): ApiCredentialDescriptor | undefined {
  const t = (text ?? '').trim();
  if (!t) return undefined;
  return API_CREDENTIALS.find((c) => c.clipboardPattern?.test(t));
}
