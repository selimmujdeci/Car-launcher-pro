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
