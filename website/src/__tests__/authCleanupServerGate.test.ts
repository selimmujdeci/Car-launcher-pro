import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { GET as authCallback } from '@/app/auth/callback/route';
import { middleware } from '@/middleware';
import { AUTH_CLEANUP_MARKER_COOKIE } from
  '@/security/accountCleanup/authCleanupMarker';

const markerHeader = `${AUTH_CLEANUP_MARKER_COOKIE}=v1`;

describe('server-visible auth cleanup marker', () => {
  it('never performs PKCE exchange or Set-Cookie in the server callback',
    async () => {
      const request = new NextRequest(
        'https://caros.test/auth/callback?code=pkce-code&next=/dashboard',
      );
      const response = await authCallback(request);
      expect(response.status).toBe(307);
      expect(response.headers.get('location')).toBe(
        'https://caros.test/auth/hash-callback?code=pkce-code&next=%2Fdashboard',
      );
      expect(response.headers.getSetCookie()).toEqual([]);
    });

  it('blocks protected middleware auth restore during cleanup', async () => {
    const request = new NextRequest('https://caros.test/dashboard', {
      headers: { cookie: markerHeader },
    });
    const response = await middleware(request);
    expect(response.status).toBe(307);
    expect(response.headers.get('location'))
      .toBe('https://caros.test/login?security=cleanup');
  });

  it('blocks PKCE session exchange during cleanup', async () => {
    const request = new NextRequest(
      'https://caros.test/auth/callback?code=stale-code',
      { headers: { cookie: markerHeader } },
    );
    const response = await authCallback(request);
    expect(response.status).toBe(307);
    expect(response.headers.get('location'))
      .toBe('https://caros.test/login?security=cleanup');
  });

  it('blocks token-hash continuation before it can establish authority',
    async () => {
      const request = new NextRequest(
        'https://caros.test/auth/callback?token_hash=stale&type=recovery',
        { headers: { cookie: markerHeader } },
      );
      const response = await authCallback(request);
      expect(response.status).toBe(307);
      expect(response.headers.get('location'))
        .toBe('https://caros.test/login?security=cleanup');
    });
});
