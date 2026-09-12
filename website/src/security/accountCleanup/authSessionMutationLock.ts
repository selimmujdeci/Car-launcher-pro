import { SUPABASE_AUTH_COOKIE_PREFIX } from '@/lib/supabaseBrowser';

const AUTH_SESSION_LOCK_TIMEOUT_MS = 10_000;
let testFallbackTail: Promise<void> = Promise.resolve();

export const AUTH_SESSION_MUTATION_LOCK_NAME =
  `caros:security:auth-session-mutation:${SUPABASE_AUTH_COOKIE_PREFIX ?? 'unconfigured'}`;

export async function withAuthSessionMutationLock<T>(
  operation: () => Promise<T>,
): Promise<T> {
  if (typeof navigator === 'undefined' || !navigator.locks) {
    if (process.env.NODE_ENV === 'test') {
      const previous = testFallbackTail;
      let release: () => void = () => undefined;
      testFallbackTail = new Promise<void>((resolve) => {
        release = resolve;
      });
      await previous;
      try {
        return await operation();
      } finally {
        release();
      }
    }
    throw new Error('AUTH_SESSION_MUTATION_LOCK_UNAVAILABLE');
  }

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    AUTH_SESSION_LOCK_TIMEOUT_MS,
  );
  try {
    return await navigator.locks.request(
      AUTH_SESSION_MUTATION_LOCK_NAME,
      { mode: 'exclusive', signal: controller.signal },
      async () => {
        clearTimeout(timeout);
        return operation();
      },
    );
  } finally {
    clearTimeout(timeout);
  }
}

/** Backward-compatible test hook; the canonical authority has no local queue. */
export function resetAuthSessionMutationLockForTests(): void {
  testFallbackTail = Promise.resolve();
}
