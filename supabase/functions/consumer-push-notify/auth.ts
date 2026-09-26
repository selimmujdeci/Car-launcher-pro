/**
 * auth.ts — push-notify yetkilendirme kararı (saf, Deno-bağımsız)
 *
 * Ayrı dosya: index.ts Deno runtime (serve/createClient/web-push) import eder;
 * bu saf string mantığı vitest (Node) ile birim test edilebilsin diye izole edildi.
 *
 * Kural (E1 fix): push-notify yalnız server/internal (service_role) çağrısı kabul eder.
 *   - Authorization header yok / "Bearer " ile başlamıyor → 401
 *   - Token != SERVICE_ROLE_KEY → 401
 *   - serviceRoleKey env tanımsız → 401 (fail-closed)
 *   - Aksi → yetkili
 */
export function authorizePushRequest(
  authHeader: string | null | undefined,
  serviceRoleKey: string | undefined | null,
): boolean {
  if (!serviceRoleKey) return false; // env yoksa fail-closed
  if (!authHeader || !authHeader.startsWith('Bearer ')) return false;
  const token = authHeader.slice(7).trim();
  return token.length > 0 && token === serviceRoleKey;
}

/* ── MRI F-08 · BİR SLUG = BİR SEMANTİK ─────────────────────────────────────
 * Bu fonksiyon YALNIZ insana görünür bildirim olaylarını kabul eder. Araç
 * uyandırma olayları (`new_command`, `command_pending`) buraya gelirse çağıran
 * yanlış otoriteye konuşuyordur: 400 ile geri çevrilir; hiçbir tarayıcı
 * aboneliğine "uyan" mesajı GİTMEZ. Karar burada, saf ve Node'da test edilir.
 */
export const CONSUMER_EVENTS = [
  'health_alert', 'command_completed', 'command_failed', 'alarm_triggered',
  'geofence_breach', 'vehicle_offline', 'speed_alert',
] as const;
export type ConsumerEvent = typeof CONSUMER_EVENTS[number];
/** Araç wake olayları — bu fonksiyonun REDDETTİĞİ küme (bilgi amaçlı, tek yerde). */
export const VEHICLE_WAKE_EVENTS = ['new_command', 'command_pending'] as const;
export function isConsumerEvent(event: unknown): event is ConsumerEvent {
  return typeof event === 'string' && (CONSUMER_EVENTS as readonly string[]).includes(event);
}
