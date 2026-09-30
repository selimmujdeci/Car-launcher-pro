/**
 * externalRouteState — rota şu an HARİCİ bir uygulamada mı (Yandex/Waze/Google)?
 *
 * Sahibin isteği: "mini harita sabit kalacak; rota bitene kadar Yandex haritası
 * mini haritanın yerine geçecek". Yandex'in ekranını gömmek Android'de mümkün
 * değil ve telefonda ölçüldü (2026-09-30): Yandex Navi ile Waze PiP (küçük
 * yüzen pencere) desteği İLAN ETMİYOR. Bu yüzden rota harici uygulamadayken
 * BİZİM navigasyonumuz ÇALIŞMAZ (iki farklı rota göstermez); mini harita sabit
 * kalır ve üstünde "Rota Yandex'te · <hedef> · Yandex'e dön" kartı durur.
 *
 * YAPRAK MODÜL (yalnız zustand): rota/konum gerçeği TUTMAZ — yalnız "rotayı
 * hangi uygulamaya verdik" bilgisidir. Varış/zaman aşımı temizliği
 * `externalRouteWatcher`dadır.
 */
import { create } from 'zustand';

export type ExternalNavProvider = 'yandex' | 'waze' | 'google_maps';

export interface ExternalRoute {
  provider:    ExternalNavProvider;
  /** Açılan uygulamanın paketi ("Yandex'e dön" için); bilinmiyorsa null. */
  packageName: string | null;
  destName:    string;
  lat:         number;
  lng:         number;
  startedAtMs: number;
}

interface ExternalRouteStore {
  route: ExternalRoute | null;
}

export const useExternalRouteStore = create<ExternalRouteStore>(() => ({ route: null }));

export function setExternalRoute(route: ExternalRoute): void {
  useExternalRouteStore.setState({ route });
}

export function clearExternalRoute(): void {
  if (useExternalRouteStore.getState().route !== null) useExternalRouteStore.setState({ route: null });
}

export function getExternalRoute(): ExternalRoute | null {
  return useExternalRouteStore.getState().route;
}

/** React: kart için. */
export function useExternalRoute(): ExternalRoute | null {
  return useExternalRouteStore((s) => s.route);
}
