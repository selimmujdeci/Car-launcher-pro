/**
 * superAdminClaim — JWT app_metadata.role tabanlı super_admin tespiti.
 *
 * Admin SPA'daki SuperAdminGuard/resolveCan zincirinin website tarafı
 * aynası: aynı claim kaynağı (access_token payload → app_metadata.role,
 * user_metadata yalnız geçiş-dönemi fallback'i). Saf fonksiyonlar —
 * Supabase/React importu yok, kök vitest paketinden test edilebilir.
 */

export const SUPER_ADMIN_CLAIM_KEY   = 'role';
export const SUPER_ADMIN_CLAIM_VALUE = 'super_admin';

/** JWT payload bölümünü decode eder; ağ çağrısı ve imza doğrulaması yok. */
export function decodeJwtPayload(token: string): Record<string, unknown> {
  try {
    const segment = token.split('.')[1];
    if (!segment) return {};
    const base64 = segment.replace(/-/g, '+').replace(/_/g, '/');
    const json = typeof window !== 'undefined'
      ? atob(base64)
      : Buffer.from(base64, 'base64').toString();
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** app_metadata öncelikli rol çıkarımı — user_metadata yalnız fallback. */
function extractRole(payload: Record<string, unknown>): string | undefined {
  const appMeta  = payload.app_metadata  as Record<string, unknown> | undefined;
  const userMeta = payload.user_metadata as Record<string, unknown> | undefined;
  const fromApp  = appMeta?.[SUPER_ADMIN_CLAIM_KEY]  as string | undefined;
  const fromUser = userMeta?.[SUPER_ADMIN_CLAIM_KEY] as string | undefined;
  return fromApp ?? fromUser;
}

/** Saf kural: payload super_admin claim'i taşıyor mu? */
export function isSuperAdminJwtPayload(payload: Record<string, unknown>): boolean {
  return extractRole(payload) === SUPER_ADMIN_CLAIM_VALUE;
}

/** access_token → super_admin mi? (Sidebar getSession sonucuyla çağırır.) */
export function isSuperAdminToken(accessToken: string | null | undefined): boolean {
  if (!accessToken) return false;
  return isSuperAdminJwtPayload(decodeJwtPayload(accessToken));
}
