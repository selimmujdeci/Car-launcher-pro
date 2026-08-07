import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: {
      getUser: mocks.getUser,
      admin: { signOut: mocks.signOut },
    },
  }),
}));

import { POST } from '@/app/api/auth/revoke-session/route';

describe('target-bound server session revoke primitive', () => {
  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://project.supabase.co');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon-key');
    mocks.getUser.mockReset();
    mocks.signOut.mockReset();
  });

  it('revokes exactly the bearer target without mutating browser cookies',
    async () => {
      mocks.getUser.mockResolvedValue({
        data: { user: { id: 'account-a' } },
        error: null,
      });
      mocks.signOut.mockResolvedValue({ error: null });
      const response = await POST(new Request(
        'https://caros.test/api/auth/revoke-session',
        {
          method: 'POST',
          headers: { Authorization: 'Bearer immutable-token-a' },
        },
      ));
      expect(response.status).toBe(200);
      expect(mocks.getUser).toHaveBeenCalledWith('immutable-token-a');
      expect(mocks.signOut)
        .toHaveBeenCalledWith('immutable-token-a', 'local');
      expect(response.headers.get('set-cookie')).toBeNull();
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(await response.text()).not.toContain('immutable-token-a');
    });

  it('fails closed without a valid immutable target', async () => {
    const response = await POST(new Request(
      'https://caros.test/api/auth/revoke-session',
      { method: 'POST' },
    ));
    expect(response.status).toBe(401);
    expect(mocks.signOut).not.toHaveBeenCalled();
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('rejects an oversized authorization header without provider access',
    async () => {
      const response = await POST(new Request(
        'https://caros.test/api/auth/revoke-session',
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${'x'.repeat(8_193)}` },
        },
      ));
      expect(response.status).toBe(401);
      expect(mocks.getUser).not.toHaveBeenCalled();
      expect(mocks.signOut).not.toHaveBeenCalled();
      expect(response.headers.get('cache-control')).toBe('no-store');
    });
});
