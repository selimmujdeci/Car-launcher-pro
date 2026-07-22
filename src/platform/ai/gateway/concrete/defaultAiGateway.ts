/**
 * Varsayılan AI Gateway bileşimi (composition root).
 *
 * Tüketicinin (Mavi vb.) göreceği TEK kurulum noktası. Burada gerçek
 * bağımlılıklar bağlanır; saf katman (gateway/provider) bunların HİÇBİRİNİ
 * bilmez:
 *   - OpenRouter sağlayıcısı  ← BYOK anahtar kaynağı
 *   - Çevrimdışı kapısı       ← `navigator.onLine`
 *   - Devre kesici            ← mevcut `aiHealth` (Gemini/Haiku hattıyla ORTAK;
 *                                yavaş/arızalı ağda AI yollarını birlikte kapatır)
 *
 * ── TEMBEL (LAZY) SINGLETON ────────────────────────────────────────────────
 * `getDefaultAiGateway()` ilk çağrıda kurar, sonra aynı örneği döndürür.
 * Modül import edildiğinde HİÇBİR yan etki oluşmaz (ağ/timer/listener YOK) —
 * anahtar okuma da istek anında yapılır.
 *
 * ── FALLBACK'E HAZIR ───────────────────────────────────────────────────────
 * `providers` dizisi bugün TEK elemanlıdır. İkinci sağlayıcı (Gemini Direct,
 * OpenAI Direct, Anthropic, xAI, Ollama…) eklendiğinde YALNIZCA bu dizi
 * büyür; gateway, provider ve Mavi kodu DEĞİŞMEZ.
 */

import { createAiGateway } from '../aiGateway';
import { DEFAULT_AI_MODEL } from '../models';
import { createOpenRouterProvider } from '../providers/openRouterProvider';
import { createOpenRouterKeySource } from './openRouterKeySource';
import { isAiNetHealthy, recordAiNetFailure, recordAiNetSuccess } from '../../../aiHealth';
import type { AiGateway, AiHealthPort, AiKeyVerification, AiNetworkStatus, AiProvider } from '../types';

/** Mevcut devre kesiciyi gateway portuna uyarlar (yeni state YOK). */
const aiHealthPort: AiHealthPort = {
  isHealthy:     () => isAiNetHealthy(),
  recordSuccess: () => { recordAiNetSuccess(); },
  recordFailure: () => { recordAiNetFailure(); },
};

/** Tarayıcı/WebView ağ durumu (yoksa "çevrimiçi" varsayılır — kapı yanlış kapanmasın). */
const browserNetworkStatus: AiNetworkStatus = {
  isOnline: () => (typeof navigator === 'undefined' ? true : navigator.onLine !== false),
};

let _gateway:   AiGateway | null = null;
let _providers: readonly AiProvider[] = [];

/** Uygulamanın varsayılan gateway'i (tembel kurulum, tek örnek). */
export function getDefaultAiGateway(): AiGateway {
  if (_gateway) return _gateway;
  _providers = [
    createOpenRouterProvider({
      keySource: createOpenRouterKeySource(),
      title:     'CarOS Pro',
    }),
  ];
  _gateway = createAiGateway({
    providers: _providers,
    network:   browserNetworkStatus,
    health:    aiHealthPort,
  });
  return _gateway;
}

/**
 * Kayıtlı sağlayıcıların kimlik + varsayılan model listesi (capability adapter
 * için). Gateway'i kurar (tembel) ama İSTEK GÖNDERMEZ.
 */
export function getDefaultProviderRegistryEntries(): readonly { id: string; defaultModel: string }[] {
  getDefaultAiGateway();                       // tembel kurulum
  return _providers.map((p) => ({ id: p.id, defaultModel: DEFAULT_AI_MODEL }));
}

/**
 * Kayıtlı anahtarın GERÇEKTEN çalıştığını doğrular (ayarlar ekranı için).
 *
 * Sağlayıcı-bağımsız: zincirin İLK sağlayıcısına sorar. Sağlayıcı düşük
 * maliyetli `verifyKey` sunuyorsa (OpenRouter `GET /key` — SIFIR token) o
 * kullanılır; sunmuyorsa MİNİMUM bütçeli bir sohbet isteğine düşülür
 * (`maxTokens:1`, streaming KAPALI, geçmiş/araç verisi/kişisel veri YOK).
 *
 * Devre kesiciyi BESLEMEZ: bu bir kullanıcı-tetikli teşhis çağrısıdır, asistan
 * trafiği değildir — başarısız test Mavi'yi 90sn offline'a kilitlememelidir.
 */
export async function verifyDefaultAiConnection(timeoutMs?: number): Promise<AiKeyVerification> {
  const gateway  = getDefaultAiGateway();
  const provider = _providers[0];

  if (provider?.verifyKey) {
    return provider.verifyKey(timeoutMs !== undefined ? { timeoutMs } : undefined);
  }

  // Yedek yol: en küçük olası üretim isteği (kullanıcı verisi TAŞIMAZ).
  const result = await gateway.generateResponse({
    messages:  [{ role: 'user', content: 'ping' }],
    maxTokens: 1,
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
  });
  // `maxTokens:1` yanıtı boş/kesik dönebilir; ÖNEMLİ OLAN anahtarın kabul
  // edilmesidir — yalnız kimlik/kota/ağ hataları başarısızlık sayılır.
  if (result.ok) return { ok: true };
  return result.error.kind === 'malformed_response'
    ? { ok: true }
    : { ok: false, error: result.error };
}

/** @internal — testler arası izolasyon (üretim yolunda çağrılmaz). */
export function _resetDefaultAiGatewayForTest(): void {
  _gateway   = null;
  _providers = [];
}
