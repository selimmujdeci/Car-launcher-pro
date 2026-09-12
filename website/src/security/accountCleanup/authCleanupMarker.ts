export const AUTH_CLEANUP_MARKER_COOKIE = 'caros-account-cleanup';
const MARKER_VALUE = 'v1';

export function setAuthCleanupMarker(): boolean {
  if (typeof document === 'undefined') return false;
  try {
    document.cookie =
      `${AUTH_CLEANUP_MARKER_COOKIE}=${MARKER_VALUE}; Path=/; ` +
      'SameSite=Strict; Max-Age=86400';
    return hasAuthCleanupMarker();
  } catch {
    return false;
  }
}

export function clearAuthCleanupMarker(): boolean {
  if (typeof document === 'undefined') return true;
  try {
    document.cookie =
      `${AUTH_CLEANUP_MARKER_COOKIE}=; Path=/; SameSite=Strict; Max-Age=0`;
    return !hasAuthCleanupMarker();
  } catch {
    return false;
  }
}

export function hasAuthCleanupMarker(cookieHeader?: string): boolean {
  const source = cookieHeader ??
    (typeof document === 'undefined' ? '' : document.cookie);
  return source.split(';').some((part) =>
    part.trim().startsWith(`${AUTH_CLEANUP_MARKER_COOKIE}=`));
}
