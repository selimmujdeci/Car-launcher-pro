/**
 * pushAuth — push-notify yetkilendirme karar mantığı (runtime-agnostic, test edilebilir).
 *
 * Supabase/Deno bağımlılığı YOK: tüm I/O dependency injection ile gelir, böylece
 * saf birim testi yazılabilir. index.ts bu fonksiyonu gerçek Supabase çağrılarıyla besler.
 *
 * Prod şema gerçeği (website/supabase/migrations/001_init.sql):
 *   - `vehicle_users` tablosu YOK.
 *   - araç↔kullanıcı ilişkisi `vehicles` RLS policy'sinde:
 *       company_id = auth_company_id()  OR  owner_id = auth.uid()
 *   Bu yüzden erişim kontrolü, kullanıcı JWT'siyle (RLS-aware) `vehicles` SELECT'ine
 *   delege edilir — owner ve şirket-üyesi senaryolarını DB'nin kendi mantığı çözer.
 */

export type PushAuthDecision =
  | { ok: true;  mode: 'service_role' | 'user' }
  | { ok: false; status: 401 | 403 | 404; reason: string };

export interface PushAuthDeps {
  /** Backend/cron tam-yetki anahtarı (tam eşleşme = bypass). */
  serviceRoleKey: string;
  /** JWT'yi doğrular; geçerliyse userId, değilse null. */
  verifyJwt: (token: string) => Promise<string | null>;
  /** Araç DB'de fiziksel olarak var mı (service_role ile varlık kontrolü). */
  vehicleExists: (vehicleId: string) => Promise<boolean>;
  /** Kullanıcının araca RLS erişimi var mı (owner_id veya company — kullanıcı JWT'siyle). */
  userCanAccessVehicle: (token: string, vehicleId: string) => Promise<boolean>;
}

/**
 * Karar sırası:
 *   boş token            → 401
 *   service_role         → ok (bypass)
 *   geçersiz JWT         → 401
 *   araç yok             → 404
 *   erişim yok           → 403
 *   owner/şirket üyesi   → ok
 */
export async function authorizePushRequest(
  token: string,
  vehicleId: string,
  deps: PushAuthDeps,
): Promise<PushAuthDecision> {
  if (!token) return { ok: false, status: 401, reason: 'missing token' };
  if (token === deps.serviceRoleKey) return { ok: true, mode: 'service_role' };

  const userId = await deps.verifyJwt(token);
  if (!userId) return { ok: false, status: 401, reason: 'invalid jwt' };

  if (!(await deps.vehicleExists(vehicleId)))
    return { ok: false, status: 404, reason: 'vehicle not found' };

  if (!(await deps.userCanAccessVehicle(token, vehicleId)))
    return { ok: false, status: 403, reason: 'no vehicle access' };

  return { ok: true, mode: 'user' };
}
