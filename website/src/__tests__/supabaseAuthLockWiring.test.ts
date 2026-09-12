// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://project-ref.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key';
  return {
    createBrowserClient: vi.fn((..._args: unknown[]) => ({ auth: {} })),
  };
});

vi.mock('@supabase/ssr', () => ({
  createBrowserClient: mocks.createBrowserClient,
}));

import {
  canonicalSupabaseAuthLock,
  createFreshSupabaseBrowserClient,
  getSupabaseBrowserClient,
} from '@/lib/supabaseBrowser';

describe('production Supabase auth lock wiring', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('injects the same canonical lock into singleton and fresh clients', () => {
    getSupabaseBrowserClient();
    createFreshSupabaseBrowserClient();
    expect(mocks.createBrowserClient).toHaveBeenCalledTimes(2);
    for (const call of mocks.createBrowserClient.mock.calls) {
      expect(call[2]).toMatchObject({
        auth: { lock: canonicalSupabaseAuthLock },
      });
    }
  });

  it('serializes auth mutation and cleanup in the same lock namespace',
    async () => {
      let tail = Promise.resolve();
      Object.defineProperty(navigator, 'locks', {
        configurable: true,
        value: {
          request: vi.fn(async (
            name: string,
            _options: LockOptions,
            operation: (lock: { name: string }) => Promise<unknown>,
          ) => {
            const previous = tail;
            let release: () => void = () => undefined;
            tail = new Promise<void>((resolve) => { release = resolve; });
            await previous;
            try {
              return await operation({ name });
            } finally {
              release();
            }
          }),
        },
      });
      let releaseCleanup: () => void = () => undefined;
      const cleanup = canonicalSupabaseAuthLock(
        'lock:sb-project-ref-auth-token',
        1_000,
        () => new Promise<string>((resolve) => {
          releaseCleanup = () => resolve('cleanup');
        }),
      );
      let authEntered = false;
      const auth = canonicalSupabaseAuthLock(
        'lock:sb-project-ref-auth-token',
        1_000,
        async () => {
          authEntered = true;
          return 'auth';
        },
      );
      await Promise.resolve();
      expect(authEntered).toBe(false);
      releaseCleanup();
      await expect(cleanup).resolves.toBe('cleanup');
      await expect(auth).resolves.toBe('auth');
    });

  it('makes cleanup wait for auth mutation and re-enter after release',
    async () => {
      let tail = Promise.resolve();
      Object.defineProperty(navigator, 'locks', {
        configurable: true,
        value: {
          request: vi.fn(async (
            name: string,
            _options: LockOptions,
            operation: (lock: { name: string }) => Promise<unknown>,
          ) => {
            const previous = tail;
            let release: () => void = () => undefined;
            tail = new Promise<void>((resolve) => { release = resolve; });
            await previous;
            try {
              return await operation({ name });
            } finally {
              release();
            }
          }),
        },
      });
      let releaseAuth: () => void = () => undefined;
      const auth = canonicalSupabaseAuthLock(
        'lock:sb-project-ref-auth-token',
        1_000,
        () => new Promise<string>((resolve) => {
          releaseAuth = () => resolve('auth');
        }),
      );
      let cleanupEntered = false;
      const cleanup = canonicalSupabaseAuthLock(
        'lock:sb-project-ref-auth-token',
        1_000,
        async () => {
          cleanupEntered = true;
          return 'cleanup';
        },
      );
      await Promise.resolve();
      expect(cleanupEntered).toBe(false);
      releaseAuth();
      await expect(auth).resolves.toBe('auth');
      await expect(cleanup).resolves.toBe('cleanup');
    });

  it('fails closed when the Web Locks API is unavailable', async () => {
    Object.defineProperty(navigator, 'locks', {
      configurable: true,
      value: undefined,
    });
    await expect(canonicalSupabaseAuthLock(
      'lock:sb-project-ref-auth-token',
      1_000,
      async () => 'unsafe',
    )).rejects.toThrow('SUPABASE_AUTH_STORAGE_LOCK_UNAVAILABLE');
  });
});
