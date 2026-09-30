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

/** Bayat pencere kalmasın: bu süreden eski harici rota geri YÜKLENMEZ, izleyici de kapatır. */
export const EXTERNAL_ROUTE_MAX_AGE_MS = 12 * 60 * 60 * 1000;

/* Kalıcılık (telefonda ölçüldü 2026-09-30): rota yalnız bellekteydi → uygulama
   kapanıp açılınca Yandex'te rota sürerken pencere GELMİYORDU. Kayıt yalnız
   "rotayı hangi uygulamaya verdik" bilgisidir; harici uygulamanın hâlâ rota
   sürdüğünün kanıtı DEĞİLDİR (okuyamıyoruz). Bitiş yine varış/× /yeni
   navigasyon/azami ömürle olur. */
const ROUTE_KEY = 'caros-external-route';
const PROVIDERS: readonly ExternalNavProvider[] = ['yandex', 'waze', 'google_maps'];

/** SAF: kaydı doğrula; bozuk, geçersiz ya da azami ömrü aşmış kayıt → null. */
export function parseStoredExternalRoute(raw: string | null, nowMs: number): ExternalRoute | null {
  if (!raw) return null;
  try {
    const r = JSON.parse(raw) as Partial<ExternalRoute>;
    if (!r || !PROVIDERS.includes(r.provider as ExternalNavProvider)) return null;
    if (typeof r.destName !== 'string' || !Number.isFinite(r.lat) || !Number.isFinite(r.lng)) return null;
    if (Math.abs(r.lat as number) > 90 || Math.abs(r.lng as number) > 180) return null;
    if (!Number.isFinite(r.startedAtMs)) return null;
    const age = nowMs - (r.startedAtMs as number);
    if (age < 0 || age > EXTERNAL_ROUTE_MAX_AGE_MS) return null;
    return {
      provider: r.provider as ExternalNavProvider,
      packageName: typeof r.packageName === 'string' ? r.packageName : null,
      destName: r.destName, lat: r.lat as number, lng: r.lng as number,
      startedAtMs: r.startedAtMs as number,
    };
  } catch { return null; }
}

function _load(): ExternalRoute | null {
  try { return parseStoredExternalRoute(localStorage.getItem(ROUTE_KEY), Date.now()); } catch { return null; }
}

function _save(route: ExternalRoute | null): void {
  try {
    if (route) localStorage.setItem(ROUTE_KEY, JSON.stringify(route));
    else localStorage.removeItem(ROUTE_KEY);
  } catch { /* depolama yok → yalnız bu oturumda kalır */ }
}

export const useExternalRouteStore = create<ExternalRouteStore>(() => ({ route: _load() }));

export function setExternalRoute(route: ExternalRoute): void {
  useExternalRouteStore.setState({ route });
  _save(route);
}

export function clearExternalRoute(): void {
  if (useExternalRouteStore.getState().route !== null) useExternalRouteStore.setState({ route: null });
  _save(null);
}

export function getExternalRoute(): ExternalRoute | null {
  return useExternalRouteStore.getState().route;
}

/** React: kart için. */
export function useExternalRoute(): ExternalRoute | null {
  return useExternalRouteStore((s) => s.route);
}
