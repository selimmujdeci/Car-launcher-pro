/**
 * appNavigationService.ts — MAVİ 4.0 · DRIVE-1 · UYGULAMA NAVİGASYONU (üretim composition).
 *
 * AMAÇ: `maviCore/navActions` nav eylem katmanını GERÇEK navigator'a bağlayan composition root.
 * TEK paylaşılan giriş: hem TOUCH hem VOICE `dispatchAppNavigation(actionId, source)` çağırır →
 * AYNI Action Registry + AYNI Execution Engine + AYNI navigator (screenRegistry/drawerBus).
 *
 * YENİDEN KULLANIM (yeni router/navigator/dispatcher/state manager/event bus YOK):
 *  - Ekran çözümü + açma: MEVCUT `screenRegistry.getScreenById(id).open()` (drawerBus/settingsFocusBus).
 *  - Ana ekrana dönüş: MEVCUT `drawerBus.openDrawer('none')` (screenRegistry `close` ile aynı davranış).
 *  - Güvenlik: MEVCUT `createAiSafetyGate` (motorun evaluateActionSafety kapısı).
 *
 * İDEMPOTENT + LAZY: örnek ilk çağrıda kurulur; import yan etkisiz. Davranış DEĞİŞMEZ — bu servis
 * yalnız MEVCUT ekran açma yolunu tek registry-tabanlı yüzeyde toplar (çağrı-yeri adaptasyonu ayrı PR).
 */

import { createAiSafetyGate } from './aiCore/safetyGate';
import { getScreenById, screenIds } from './screenRegistry';
import { openDrawer } from './drawerBus';
import {
  createAppNavigationActions,
  type AppNavigationActions, type NavPort, type NavDispatchOptions, type NavDispatchOutcome,
} from './maviCore/navActions';

/** MEVCUT navigator'ı nav port'una bağlar (yeni davranış yok — birebir mevcut açma yolu). */
const realNavPort: NavPort = {
  openScreenById: (screenId: string): boolean => {
    const entry = getScreenById(screenId);
    if (!entry) return false;      // fail-closed: bilinmeyen ekran → açma YOK (mevcut ekran bozulmaz)
    entry.open();                  // MEVCUT açma davranışı (drawerBus/settingsFocusBus)
    return true;
  },
  closeToHome: (): void => { openDrawer('none'); }, // MEVCUT "ana ekran/kapat" davranışı
};

let _instance: AppNavigationActions | null = null;

/** Paylaşılan nav eylem katmanı (lazy singleton) — touch ve voice AYNI örneği kullanır. */
export function getAppNavigationActions(): AppNavigationActions {
  if (_instance) return _instance;
  _instance = createAppNavigationActions({
    gate: createAiSafetyGate(),
    port: realNavPort,
    screenIds: screenIds(),
  });
  return _instance;
}

/**
 * TEK paylaşılan navigasyon dispatch'i — TOUCH ve VOICE ortak yolu.
 * `source` yalnız ownership/tanı içindir (karar/yol AYRIŞMAZ).
 */
export function dispatchAppNavigation(
  actionId: string, source: string, opts?: NavDispatchOptions,
): Promise<NavDispatchOutcome> {
  return getAppNavigationActions().dispatch(actionId, source, opts);
}

/** Kayıtlı nav eylem kimlikleri (UI/tanı — hangi ekranlar sesle/tıklamayla açılabilir). */
export function appNavigationActionIds(): readonly string[] {
  return getAppNavigationActions().ids();
}

/** @internal — testler arası izolasyon (singleton'ı sıfırlar). */
export function _resetAppNavigationServiceForTest(): void {
  _instance = null;
}
