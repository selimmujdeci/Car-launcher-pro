/**
 * externalNavHandoff — "Hey Mavi, Yandex'ten Mersin'e rota kur".
 *
 * ÖLÇÜLEN KUSUR (2026-09-30, yerel ayrıştırıcı): uygulama adı geçen rota
 * cümleleri hedefi KAYBEDİYORDU — "Yandex'ten Mersin'e rota kur" ve "Google
 * Maps ile Ankara'ya rota kur" → yalnız `open_maps`; "Waze ile Mersin'e git"
 * → hedef "waze ile mersine". Hiçbir yol sağlayıcıyı taşımıyordu.
 *
 * Bu modül iki SAF parça + bir yan etkili başlatıcı içerir:
 *  · `extractExternalNavProvider` — cümleden sağlayıcıyı ve onu anlatan
 *    ifadeyi ("Yandex'ten", "Waze ile", "Google Haritalar'dan") ayırır; kalan
 *    metin mevcut adres ayrıştırıcısına gider (ikinci ayrıştırıcı YAZILMADI).
 *  · `buildExternalRouteUris` — koordinatla rota başlatan aday URI'ler.
 *  · `launchExternalRoute` — adayları sırayla dener (yüklü olmayan uygulama
 *    native'de `LAUNCH_FAILED` ile reddedilir → sıradaki denenir).
 *
 * ⚠️ URI BİÇİMLERİ bu ortamdan sağlayıcı belgesiyle DOĞRULANAMADI (ağ kapalı);
 * gerçek kanıt cihazda açılıp rotanın kurulmasıdır. Açılamazsa `false` döner
 * ve çağıran bunu sürücüye dürüstçe söyler (sahte "açtım" yok).
 */
import { CarLauncher } from '../nativePlugin';
import { isNative } from '../bridge';
import type { ExternalNavProvider } from './externalRouteState';

export type { ExternalNavProvider } from './externalRouteState';

/** Sesli cevaplarda kullanılan ad. */
export const EXTERNAL_NAV_LABEL: Readonly<Record<ExternalNavProvider, string>> = {
  yandex:      'Yandex',
  waze:        'Waze',
  google_maps: 'Google Haritalar',
};

/* Ek: kesme işaretli/işaretsiz çekim ("Yandex'ten", "Yandexle", "Waze'i"). */
const SUFFIX  = String.raw`(?:['’‘\x60]?(?:ndan|nden|dan|den|tan|ten|yla|yle|la|le|ya|ye|yı|yi|ı|i|u|ü|a|e))?`;
/* Uygulama türü sözcüğü: "Yandex Navigasyon'dan", "Google Maps ile". */
const APPNOUN = String.raw`(?:\s+(?:navigasyonu|navigasyon|navi|haritaları|haritalar|haritası|harita|maps|map)${SUFFIX})?`;
/* Bağlaç: "… ile", "… üzerinden", "… kullanarak". */
const CONNECT = String.raw`(?:\s+(?:ile|üzerinden|uzerinden|kullanarak))?`;

const PROVIDER_PATTERNS: ReadonlyArray<readonly [ExternalNavProvider, RegExp]> = [
  ['yandex',      new RegExp(String.raw`(?:^|\s)yandex${SUFFIX}${APPNOUN}${CONNECT}(?=\s|$)`, 'iu')],
  ['waze',        new RegExp(String.raw`(?:^|\s)waze${SUFFIX}${CONNECT}(?=\s|$)`, 'iu')],
  ['google_maps', new RegExp(String.raw`(?:^|\s)google${SUFFIX}${APPNOUN}${CONNECT}(?=\s|$)`, 'iu')],
];

export interface ExternalNavExtraction {
  provider: ExternalNavProvider;
  /** Sağlayıcı ifadesi çıkarılmış cümle — mevcut adres ayrıştırıcısına verilir. */
  rest:     string;
}

/** Cümlede harici navigasyon sağlayıcısı geçiyorsa onu ve kalan metni döner. */
export function extractExternalNavProvider(raw: string): ExternalNavExtraction | null {
  const text = raw.trim();
  if (!text) return null;
  for (const [provider, re] of PROVIDER_PATTERNS) {
    const m = re.exec(text);
    if (!m) continue;
    const rest = `${text.slice(0, m.index)} ${text.slice(m.index + m[0].length)}`
      .replace(/\s+/g, ' ')
      .trim();
    if (!rest) return null;
    return { provider, rest };
  }
  return null;
}

function _coord(n: number): string {
  return n.toFixed(6);
}

/**
 * Koordinata rota başlatan aday URI'ler (deneme sırasıyla).
 * Yandex: önce Yandex Navigasyon, yoksa Yandex Haritalar.
 */
export function buildExternalRouteUris(provider: ExternalNavProvider, lat: number, lng: number): string[] {
  const la = _coord(lat);
  const lo = _coord(lng);
  switch (provider) {
    case 'yandex':
      return [
        `yandexnavi://build_route_on_map?lat_to=${la}&lon_to=${lo}`,
        `yandexmaps://maps.yandex.ru/?rtext=~${la},${lo}&rtt=auto`,
      ];
    case 'waze':
      return [`waze://?ll=${la},${lo}&navigate=yes`];
    case 'google_maps':
      return [`google.navigation:q=${la},${lo}`];
  }
}

export type UriLauncher = (uri: string) => Promise<void>;

/** Varsayılan başlatıcı: native'de ACTION_VIEW; tarayıcıda harici uygulama YOK. */
const _nativeViewLauncher: UriLauncher = (uri) => {
  if (!isNative) return Promise.reject(new Error('NOT_NATIVE'));
  return CarLauncher.launchApp({ action: 'android.intent.action.VIEW', data: uri });
};

/** URI şeması → açılan uygulamanın paketi ("uygulamaya dön" düğmesi için). */
const PACKAGE_BY_SCHEME: ReadonlyArray<readonly [string, string]> = [
  ['yandexnavi://', 'ru.yandex.yandexnavi'],
  ['yandexmaps://', 'ru.yandex.yandexmaps'],
  ['waze://', 'com.waze'],
  ['google.navigation:', 'com.google.android.apps.maps'],
];

export function packageForRouteUri(uri: string): string | null {
  for (const [prefix, pkg] of PACKAGE_BY_SCHEME) if (uri.startsWith(prefix)) return pkg;
  return null;
}

export interface ExternalLaunchResult { uri: string; packageName: string | null }

/**
 * Adayları sırayla dener; açılanın URI'si ve paketiyle döner. Hiçbiri
 * açılamazsa `null` (uygulama yüklü değil / geçersiz koordinat) — asla throw etmez.
 */
export async function launchExternalRoute(
  provider: ExternalNavProvider,
  lat: number,
  lng: number,
  launch: UriLauncher = _nativeViewLauncher,
): Promise<ExternalLaunchResult | null> {
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return null;
  }
  for (const uri of buildExternalRouteUris(provider, lat, lng)) {
    try {
      await launch(uri);
      return { uri, packageName: packageForRouteUri(uri) };
    } catch { /* bu aday açılamadı → sıradaki */ }
  }
  return null;
}

/** Harici navigasyon uygulamasını öne getirir (rota zaten orada; yeniden kurulmaz). */
export async function bringExternalAppToFront(packageName: string | null): Promise<boolean> {
  if (!packageName || !isNative) return false;
  try { await CarLauncher.launchApp({ packageName }); return true; } catch { return false; }
}
