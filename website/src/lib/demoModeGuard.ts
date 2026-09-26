/**
 * demoModeGuard.ts — DEMO YOLUNUN TEK KAPISI (F0.6).
 *
 * ── ÖLÇÜLEN SORUN (2026-09-17) ───────────────────────────────────────────
 * `/api/vehicle/link` rotası `isSupabaseConfigured` false olduğunda demo
 * moduna düşüyordu ve o dalda:
 *   · `getUserId()` Bearer token ARAMADAN sabit `'mock-user'` döndürüyor,
 *   · HERHANGİ bir 6 haneli kod bir demo aracı hesaba bağlıyordu.
 * Yani ortam değişkeni eksik/yanlış bir DAĞITIMDA kimlik doğrulaması
 * SESSİZCE ortadan kalkıyordu. Yapılandırma hatası, güvenlik kapısını
 * açan bir yola dönüşmemelidir (CLAUDE.md §8, §12).
 *
 * ── KURAL ────────────────────────────────────────────────────────────────
 * Demo yolu YALNIZ kanıtlanabilir bir geliştirme/test koşulunda açıktır:
 * `NODE_ENV !== 'production'`. Next.js bu değeri `next build`/`next start`
 * ve Vercel dağıtımlarında ZORLA `production` yapar; yani üretimde bu kapı
 * hiçbir ortam değişkeni kombinasyonuyla açılamaz.
 *
 * Geliştirme ergonomisi DEĞİŞMEZ: `next dev` altında davranış eskisiyle
 * birebir aynıdır.
 */

/** Üretim çalışması mı? (tek yorum noktası) */
export function isProductionRuntime(): boolean {
  return process.env.NODE_ENV === 'production';
}

/**
 * Supabase yapılandırılmamışken demo/mock yoluna düşülebilir mi?
 *
 * ⚠️ Bu fonksiyon `true` dönmedikçe hiçbir rota sahte kullanıcı üretmemeli,
 * sahte araç bağlamamalı veya kimlik doğrulamasını atlamamalıdır.
 */
export function isDemoFallbackAllowed(): boolean {
  return !isProductionRuntime();
}

/** Üretimde yapılandırma eksikse döndürülecek TEK tip gövde. */
export const MISCONFIGURED_BODY = Object.freeze({
  error:
    'Servis şu anda kullanılamıyor. Lütfen daha sonra tekrar deneyin.',
  code: 'SERVICE_MISCONFIGURED',
});

/** Üretimde yapılandırma eksikse kullanılacak HTTP durumu. */
export const MISCONFIGURED_STATUS = 503;
