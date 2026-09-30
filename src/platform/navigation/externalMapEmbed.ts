/**
 * externalMapEmbed — yüzen pencerede sağlayıcının KENDİ web haritasının adresi.
 *
 * Sahibin kararı (2026-09-30): rota Yandex/Google'dayken uygulamamızın üstünde
 * sürüklenebilir küçük bir pencere çıksın ve içinde O SAĞLAYICININ haritası
 * olsun. Android başka uygulamanın ekranını gömmeye izin vermez; Yandex Navi ve
 * Waze PiP desteği ilan etmiyor (telefonda ölçüldü). Kalan yol sağlayıcının
 * web haritasını iframe ile göstermektir.
 *
 * ⚠️ DOĞRULANMADI: bu adres biçimleri bu ortamdan açılamadı (yandex.com ağ
 * erişimine kapalı). Gerçek kanıt cihazda pencerenin haritayı çizmesidir.
 * ⚠️ LİSANS: sağlayıcı kullanım koşulları (özellikle araç içi/gerçek zamanlı
 * navigasyon kısıtları) DOĞRULANMADI → ticari sürüm için uygun SAYILMAZ
 * (CLAUDE.md §12, fail-closed). Aile içi saha testi kapsamındadır.
 *
 * SAF: I/O yok. Konum bilinmiyorsa rota yerine yalnız hedef gösterilir
 * (başlangıç noktası uydurulmaz).
 */
import type { ExternalNavProvider } from './externalRouteState';

export interface LatLng { lat: number; lng: number }

function _ok(p: LatLng | null | undefined): p is LatLng {
  return !!p && Number.isFinite(p.lat) && Number.isFinite(p.lng) && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180;
}

const f = (n: number): string => n.toFixed(6);

/** Pencere adresi; hedef geçersizse null (boş/yanlış harita GÖSTERİLMEZ). */
export function buildExternalMapEmbedUrl(
  provider: ExternalNavProvider,
  dest: LatLng,
  origin: LatLng | null,
): string | null {
  if (!_ok(dest)) return null;
  const hasOrigin = _ok(origin);
  switch (provider) {
    case 'yandex':
      // rtext: "başlangıç~hedef" (enlem,boylam); pt: "boylam,enlem"
      return hasOrigin
        ? `https://yandex.com.tr/map-widget/v1/?rtext=${f(origin.lat)},${f(origin.lng)}~${f(dest.lat)},${f(dest.lng)}&rtt=auto`
        : `https://yandex.com.tr/map-widget/v1/?pt=${f(dest.lng)},${f(dest.lat)}&z=13`;
    case 'google_maps':
      return hasOrigin
        ? `https://maps.google.com/maps?saddr=${f(origin.lat)},${f(origin.lng)}&daddr=${f(dest.lat)},${f(dest.lng)}&output=embed`
        : `https://maps.google.com/maps?q=${f(dest.lat)},${f(dest.lng)}&z=13&output=embed`;
    case 'waze':
      // Waze gömülü canlı haritası rota çizmez; hedefi işaretler.
      return `https://embed.waze.com/iframe?zoom=13&lat=${f(dest.lat)}&lon=${f(dest.lng)}&pin=1`;
  }
}
