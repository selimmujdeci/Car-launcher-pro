/**
 * contextGrammarWiring.ts — bağlam sağlayıcılarının AĞIR tarafı.
 *
 * ⚠️ BU DOSYA `voiceService` GRAFİĞİNE GİRMEMELİDİR. Yalnız uygulama boot yolundan
 * (App.tsx) ÇAĞRILIR. `navigationService` / `mediaService` / `obdService`
 * importlarını yalnız burası taşır; sıcak taraf sadece bağımlılıksız
 * `contextGrammarProviders` çekirdeğini tanır (bkz. o dosyadaki saha dersi).
 *
 * Kilit testi bu ayrımı kaynak taramasıyla korur: `contextGrammarSources` içinde
 * bu üç servisin adı GEÇEMEZ.
 */

import { getNavigationState } from '../navigationService';
import { getMediaState } from '../mediaService';
import { getObdSessionHealth } from '../obdService';
import { registerGrammarContextProviders } from './contextGrammarProviders';

let _wired = false;

/**
 * Idempotent. Getter'lar SENKRON ve yan etkisizdir; hata durumunda okuma katmanı
 * (`contextGrammarSources`) try/catch ile `null` (BİLİNMİYOR) üretir — burada
 * yutulmaz, çünkü bağlamın "okunamadığı" bilgisi LAB'da görünmelidir.
 */
export function wireGrammarContext(): void {
  if (_wired) return;
  _wired = true;
  registerGrammarContextProviders({
    isNavigating:          () => getNavigationState().isNavigating === true,
    isMediaPlaying:        () => getMediaState().playing === true,
    /* "OBD bağlı görünüyor" YETMEZ: oturum hazır VE veri taze olmalı. */
    isVehicleSessionReady: () => {
      const h = getObdSessionHealth();
      return h.ready === true && h.dataFresh === true;
    },
  });
}

/** @internal — testler arası izolasyon. */
export function _resetGrammarWiringForTest(): void {
  _wired = false;
}
