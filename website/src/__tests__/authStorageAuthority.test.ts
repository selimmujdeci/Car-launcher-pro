import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

class DeterministicWebLocks {
  private readonly tails = new Map<string, Promise<void>>();

  async request<T>(
    name: string,
    options: LockOptions,
    callback: LockGrantedCallback<T>,
  ): Promise<T> {
    if (options.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const previous = this.tails.get(name) ?? Promise.resolve();
    let release: () => void = () => undefined;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.tails.set(name, previous.then(() => current));
    await previous;
    if (options.signal?.aborted) {
      release();
      throw new DOMException('Aborted', 'AbortError');
    }
    try {
      return await callback({ name, mode: 'exclusive' });
    } finally {
      release();
      if (this.tails.get(name) === current) this.tails.delete(name);
    }
  }

  query(): Promise<LockManagerSnapshot> {
    return Promise.resolve({ held: [], pending: [] });
  }
}

function sessionResponse(userId: string) {
  return {
    access_token: `access-${userId}`,
    token_type: 'bearer',
    expires_in: 3600,
    refresh_token: `refresh-${userId}`,
    user: {
      id: userId,
      aud: 'authenticated',
      role: 'authenticated',
      email: `${userId}@example.test`,
      app_metadata: {},
      user_metadata: {},
      identities: [],
      created_at: '2026-01-01T00:00:00.000Z',
    },
  };
}

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__') return [];
      return sourceFiles(path);
    }
    return /\.(ts|tsx)$/.test(entry.name) ? [path] : [];
  }));
  return nested.flat();
}

async function loadProductionAuthority() {
  vi.resetModules();
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://authority-test.supabase.co');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'test-anon-key');
  const browser = await import('@/lib/supabaseBrowser');
  const mutations = await import(
    '@/security/accountCleanup/canonicalAuthMutations'
  );
  const lock = await import(
    '@/security/accountCleanup/authSessionMutationLock'
  );
  return { browser, mutations, lock };
}

describe('canonical auth storage authority', () => {
  beforeEach(() => {
    document.cookie.split(';').forEach((part) => {
      const name = part.trim().split('=', 1)[0];
      if (name) document.cookie = `${name}=; Path=/; Max-Age=0`;
    });
    Object.defineProperty(navigator, 'locks', {
      configurable: true,
      value: new DeterministicWebLocks(),
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('serializes real password session save behind cleanup authority',
    async () => {
      const { browser, mutations, lock } = await loadProductionAuthority();
      const client = browser.getSupabaseBrowserClient();
      if (!client) throw new Error('production browser client unavailable');
      vi.stubGlobal('fetch', vi.fn(async () => new Response(
        JSON.stringify(sessionResponse('account-b')),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )));

      let releaseCleanup: () => void = () => undefined;
      let cleanupEntered: () => void = () => undefined;
      const entered = new Promise<void>((resolve) => {
        cleanupEntered = resolve;
      });
      const cleanup = lock.withAuthSessionMutationLock(
        () => new Promise<void>((resolve) => {
          releaseCleanup = resolve;
          cleanupEntered();
        }),
      );
      await entered;

      const signIn = mutations.canonicalSignInWithPassword(client, {
        email: 'account-b@example.test',
        password: 'correct-password',
      });
      await Promise.resolve();
      expect(document.cookie).not.toContain('access-account-b');

      releaseCleanup();
      await cleanup;
      const result = await signIn;
      expect(result.error).toBeNull();
      expect(result.data.session?.user.id).toBe('account-b');
      expect(document.cookie).toContain('sb-authority-test-auth-token');
    });

  it('serializes a real signup session save behind cleanup authority',
    async () => {
      const { browser, mutations, lock } = await loadProductionAuthority();
      const client = browser.createFreshSupabaseBrowserClient();
      if (!client) throw new Error('fresh browser client unavailable');
      vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
        ...sessionResponse('signup-b'),
        session: sessionResponse('signup-b'),
      }), { status: 200, headers: { 'content-type': 'application/json' } })));

      let release: () => void = () => undefined;
      const cleanup = lock.withAuthSessionMutationLock(
        () => new Promise<void>((resolve) => { release = resolve; }),
      );
      const signup = mutations.canonicalSignUp(client, {
        email: 'signup-b@example.test',
        password: 'correct-password',
      });
      await Promise.resolve();
      expect(document.cookie).not.toContain('access-signup-b');
      release();
      await cleanup;
      const result = await signup;
      expect(result.error).toBeNull();
    });

  it('makes cleanup observe a real password-write mismatch without deleting B',
    async () => {
      const { browser, mutations, lock } = await loadProductionAuthority();
      const client = browser.getSupabaseBrowserClient();
      if (!client) throw new Error('production browser client unavailable');
      const prefix = browser.SUPABASE_AUTH_COOKIE_PREFIX;
      if (!prefix) throw new Error('auth cookie prefix unavailable');
      document.cookie = `${prefix}=account-a-artifact; Path=/`;
      const accountA = await browser.captureSupabaseAuthCookieOwnership();
      if (!accountA) throw new Error('Account A snapshot unavailable');
      vi.stubGlobal('fetch', vi.fn(async () => new Response(
        JSON.stringify(sessionResponse('account-b')),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )));

      const signIn = mutations.canonicalSignInWithPassword(client, {
        email: 'account-b@example.test', password: 'correct-password',
      });
      const cleanup = lock.withAuthSessionMutationLock(
        () => browser.clearSupabaseAuthCookiesIfOwned(accountA),
      );
      await expect(signIn).resolves.toMatchObject({ error: null });
      await expect(cleanup).resolves.toMatchObject({
        ok: false,
        code: 'OWNERSHIP_MISMATCH',
        deletedCount: 0,
      });
      expect(document.cookie).toContain(`${prefix}=`);
      expect(document.cookie).not.toContain('account-a-artifact');
    });

  it('serializes real session saves from singleton and fresh clients',
    async () => {
      const { browser, mutations } = await loadProductionAuthority();
      const singleton = browser.getSupabaseBrowserClient();
      const fresh = browser.createFreshSupabaseBrowserClient();
      if (!singleton || !fresh) throw new Error('browser clients unavailable');
      let firstRelease: () => void = () => undefined;
      let fetchCount = 0;
      vi.stubGlobal('fetch', vi.fn(async () => {
        fetchCount += 1;
        if (fetchCount === 1) {
          await new Promise<void>((resolve) => { firstRelease = resolve; });
        }
        return new Response(JSON.stringify(sessionResponse(`account-${fetchCount}`)), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }));

      const first = mutations.canonicalSignInWithPassword(singleton, {
        email: 'first@example.test', password: 'correct-password',
      });
      await Promise.resolve();
      const second = mutations.canonicalSignInWithPassword(fresh, {
        email: 'second@example.test', password: 'correct-password',
      });
      await Promise.resolve();
      expect(fetchCount).toBe(1);
      firstRelease();
      await first;
      await second;
      expect(fetchCount).toBe(2);
    });

  it('keeps nested SDK locking live and releases after an exception',
    async () => {
      const { browser, mutations } = await loadProductionAuthority();
      const client = browser.createFreshSupabaseBrowserClient();
      if (!client) throw new Error('fresh browser client unavailable');
      // updateUser auth-js içinde `_acquireLock()` kullanan bir writer'dır.
      // Dış application lock ile iç SDK lock farklı namespace'lerde olduğundan
      // session yok hatası deadlock olmadan dönmeli ve dış lock bırakılmalıdır.
      const nested = await mutations.canonicalUpdateUser(client, {
        data: { probe: true },
      });
      expect(nested.error).not.toBeNull();
      vi.stubGlobal('fetch', vi.fn(async () => new Response(
        JSON.stringify(sessionResponse('account-c')),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )));
      const second = await mutations.canonicalSignInWithPassword(client, {
        email: 'account-c@example.test', password: 'correct-password',
      });
      expect(second.error).toBeNull();
      expect(second.data.session?.user.id).toBe('account-c');
    });

  it('forbids production auth writers outside the canonical module',
    async () => {
      const root = join(process.cwd(), 'src');
      const files = await sourceFiles(root);
      const allowlist = new Set([
        join(root, 'security/accountCleanup/canonicalAuthMutations.ts'),
        // Server-side PKCE exchange is separately guarded by the cleanup
        // marker before it can create a Set-Cookie response.
        join(root, 'app/auth/callback/route.ts'),
      ]);
      const forbidden =
        /\.auth\.(signInWithPassword|signUp|signInAnonymously|signInWithOAuth|setSession|refreshSession|updateUser|verifyOtp|signOut)\(/;
      for (const file of files) {
        if (allowlist.has(file)) continue;
        expect(await readFile(file, 'utf8'), file).not.toMatch(forbidden);
      }
    });
});
