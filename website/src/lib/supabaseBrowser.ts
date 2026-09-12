import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';

const url     = process.env.NEXT_PUBLIC_SUPABASE_URL     ?? '';
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';

export const isSupabaseConfigured = Boolean(url && anonKey);
export const SUPABASE_AUTH_COOKIE_PREFIX = url
  ? `sb-${new URL(url).hostname.split('.')[0]}-auth-token`
  : null;
const MAX_AUTH_COOKIE_CHUNKS = 16;

export type SupabaseAuthCookieOwnershipSnapshot = Readonly<{
  chunks: readonly Readonly<{ name: string; valueHash: string }>[];
}>;

export type SupabaseAuthCookieCleanupResult =
  | { ok: true; deletedCount: number }
  | {
      ok: false;
      code: 'OWNERSHIP_MISMATCH' | 'PARTIAL_CLEANUP' | 'LOCK_UNAVAILABLE';
      deletedCount: number;
    };

export type SupabaseAuthLock = <T>(
  name: string,
  acquireTimeout: number,
  operation: () => Promise<T>,
) => Promise<T>;

let browserClient: SupabaseClient | null = null;
const AUTH_LOCK_TIMEOUT_MS = 10_000;

/**
 * Tarayıcı Supabase client'ı.
 *
 * @supabase/ssr'in createBrowserClient'ı session'ı cookie'ye, server
 * (createServerClient) ve middleware ile BİREBİR aynı formatta (chunked,
 * base64) yazar. Böylece e-posta/şifre ile giriş yapıldığında middleware
 * session'ı okuyabilir ve /dashboard'a yönlendirme döngüye girmez.
 *
 * NOT: Daha önce supabase-js + özel cookieStorage kullanılıyordu; o JSON
 * formatını @supabase/ssr çözemediği için middleware getUser() null dönüyor
 * ve giriş başarılı olmasına rağmen tekrar /login'e atıyordu.
 */
export function getSupabaseBrowserClient(): SupabaseClient | null {
  if (!isSupabaseConfigured) return null;
  if (typeof window === 'undefined') return null;

  if (!browserClient) {
    browserClient = createBrowserClient(url, anonKey, {
      auth: { lock: canonicalSupabaseAuthLock },
    });
  }

  return browserClient;
}

export function createFreshSupabaseBrowserClient(): SupabaseClient | null {
  if (!isSupabaseConfigured || typeof window === 'undefined') return null;
  return createBrowserClient(url, anonKey, {
    isSingleton: false,
    auth: { lock: canonicalSupabaseAuthLock },
  });
}

export function hasSupabaseAuthCookieChunks(): boolean {
  if (!SUPABASE_AUTH_COOKIE_PREFIX || typeof document === 'undefined') {
    return false;
  }
  const prefix = SUPABASE_AUTH_COOKIE_PREFIX;
  return document.cookie.split(';').some((part) => {
    const name = part.trim().split('=', 1)[0];
    return name === prefix || name.startsWith(`${prefix}.`);
  });
}

export async function captureSupabaseAuthCookieOwnership():
Promise<SupabaseAuthCookieOwnershipSnapshot | null> {
  return captureSupabaseAuthCookieOwnershipForPrefix(
    SUPABASE_AUTH_COOKIE_PREFIX,
  );
}

export async function captureSupabaseAuthCookieOwnershipForPrefix(
  prefix: string | null,
): Promise<SupabaseAuthCookieOwnershipSnapshot | null> {
  if (!prefix || typeof document === 'undefined') {
    return null;
  }
  const matching = readSupabaseAuthCookieChunks(prefix);
  if (matching === null) return null;
  const chunks = await Promise.all(matching.map(async ({ name, value }) =>
    Object.freeze({ name, valueHash: await hashCookieValue(value) })));
  return Object.freeze({ chunks: Object.freeze(chunks) });
}

export async function clearSupabaseAuthCookiesIfOwned(
  expected: SupabaseAuthCookieOwnershipSnapshot,
  prefix = SUPABASE_AUTH_COOKIE_PREFIX,
  lock: SupabaseAuthLock = canonicalSupabaseAuthLock,
  expireCookie: (name: string) => void = expireExactCookie,
): Promise<SupabaseAuthCookieCleanupResult> {
  if (!prefix || typeof document === 'undefined') {
    return { ok: false, code: 'LOCK_UNAVAILABLE', deletedCount: 0 };
  }
  try {
    return await lock(`lock:${prefix}`, AUTH_LOCK_TIMEOUT_MS, async () => {
      let remaining = expected;
      let deletedCount = 0;
      for (const chunk of expected.chunks) {
        const current =
          await captureSupabaseAuthCookieOwnershipForPrefix(prefix);
        if (!current || !sameCookieOwnership(current, remaining)) {
          return {
            ok: false,
            code: deletedCount > 0 ? 'PARTIAL_CLEANUP' : 'OWNERSHIP_MISMATCH',
            deletedCount,
          };
        }
        try {
          expireCookie(chunk.name);
        } catch {
          return {
            ok: false,
            code: deletedCount > 0 ? 'PARTIAL_CLEANUP' : 'OWNERSHIP_MISMATCH',
            deletedCount,
          };
        }
        const afterDelete =
          await captureSupabaseAuthCookieOwnershipForPrefix(prefix);
        const nextChunks = remaining.chunks.filter(
          (candidate) => candidate.name !== chunk.name,
        );
        const next = Object.freeze({ chunks: Object.freeze(nextChunks) });
        if (!afterDelete || !sameCookieOwnership(afterDelete, next)) {
          return {
            ok: false,
            code: 'PARTIAL_CLEANUP',
            deletedCount: deletedCount + 1,
          };
        }
        deletedCount += 1;
        remaining = next;
      }
      return { ok: true, deletedCount };
    });
  } catch {
    return { ok: false, code: 'LOCK_UNAVAILABLE', deletedCount: 0 };
  }
}

export async function canonicalSupabaseAuthLock<T>(
  name: string,
  acquireTimeout: number,
  operation: () => Promise<T>,
): Promise<T> {
  if (typeof navigator === 'undefined' || !navigator.locks) {
    throw new Error('SUPABASE_AUTH_STORAGE_LOCK_UNAVAILABLE');
  }
  const controller = new AbortController();
  const timeout = acquireTimeout > 0
    ? setTimeout(() => controller.abort(), acquireTimeout)
    : null;
  try {
    return await navigator.locks.request(
      name,
      acquireTimeout === 0
        ? { mode: 'exclusive', ifAvailable: true }
        : { mode: 'exclusive', signal: controller.signal },
      async (heldLock) => {
        if (!heldLock) throw new Error('SUPABASE_AUTH_STORAGE_LOCK_UNAVAILABLE');
        return operation();
      },
    );
  } finally {
    if (timeout !== null) clearTimeout(timeout);
  }
}

function expireExactCookie(name: string): void {
  document.cookie = `${name}=; Path=/; SameSite=Lax; Max-Age=0`;
}

function readSupabaseAuthCookieChunks(prefix: string):
Array<{ name: string; value: string }> | null {
  const chunks = document.cookie.split(';').flatMap((part) => {
    const trimmed = part.trim();
    const separator = trimmed.indexOf('=');
    const name = separator >= 0 ? trimmed.slice(0, separator) : trimmed;
    if (name !== prefix && !name.startsWith(`${prefix}.`)) return [];
    return [{ name, value: separator >= 0 ? trimmed.slice(separator + 1) : '' }];
  });
  if (chunks.length > MAX_AUTH_COOKIE_CHUNKS) return null;
  return chunks.sort((left, right) => left.name.localeCompare(right.name));
}

function sameCookieOwnership(
  current: SupabaseAuthCookieOwnershipSnapshot,
  expected: SupabaseAuthCookieOwnershipSnapshot,
): boolean {
  return current.chunks.length === expected.chunks.length &&
    current.chunks.every((chunk, index) =>
      chunk.name === expected.chunks[index]?.name &&
      chunk.valueHash === expected.chunks[index]?.valueHash);
}

async function hashCookieValue(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}
