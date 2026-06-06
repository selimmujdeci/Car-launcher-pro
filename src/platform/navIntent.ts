// Android navigasyon Intent URI üretici.
//
// website/src/lib/routeEngine.ts'ten koparıldı (fork temizliği): buildNavIntent
// saf bir fonksiyondur (supabase/commandService kullanmaz), bu yüzden ana
// uygulama içine alındı. Böylece src/ artık website/ fork'una bağımlı değil.

export type NavProvider = 'google_maps' | 'yandex' | 'waze' | 'apple_maps';

export function buildNavIntent(
  lat:      number,
  lng:      number,
  label:    string,
  provider: NavProvider = 'google_maps',
): string {
  const enc = encodeURIComponent(label);
  switch (provider) {
    case 'google_maps':
      return `geo:${lat},${lng}?q=${lat},${lng}(${enc})`;
    case 'waze':
      return `waze://?ll=${lat},${lng}&navigate=yes`;
    case 'yandex':
      return `yandexmaps://maps.yandex.ru/?pt=${lng},${lat}&z=15&l=map`;
    case 'apple_maps':
      return `maps://?ll=${lat},${lng}&q=${enc}`;
  }
}
