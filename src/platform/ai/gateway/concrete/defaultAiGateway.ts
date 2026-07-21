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
import { createOpenRouterProvider } from '../providers/openRouterProvider';
import { createOpenRouterKeySource } from './openRouterKeySource';
import { isAiNetHealthy, recordAiNetFailure, recordAiNetSuccess } from '../../../aiHealth';
import type { AiGateway, AiHealthPort, AiNetworkStatus } from '../types';

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

let _gateway: AiGateway | null = null;

/** Uygulamanın varsayılan gateway'i (tembel kurulum, tek örnek). */
export function getDefaultAiGateway(): AiGateway {
  if (_gateway) return _gateway;
  _gateway = createAiGateway({
    providers: [
      createOpenRouterProvider({
        keySource: createOpenRouterKeySource(),
        title:     'CarOS Pro',
      }),
    ],
    network: browserNetworkStatus,
    health:  aiHealthPort,
  });
  return _gateway;
}

/** @internal — testler arası izolasyon (üretim yolunda çağrılmaz). */
export function _resetDefaultAiGatewayForTest(): void {
  _gateway = null;
}
