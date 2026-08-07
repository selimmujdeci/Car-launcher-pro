'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { getSupabaseBrowserClient } from '@/lib/supabaseBrowser';
import {
  beginAuthSessionOperation,
  canApplyAuthSessionOperation,
  finishAuthSessionOperation,
} from '@/security/accountCleanup/authSessionGenerationGuard';
import {
  canonicalExchangeCodeForSession,
  canonicalSetSession,
} from
  '@/security/accountCleanup/canonicalAuthMutations';

export default function HashCallbackPage() {
  const router = useRouter();

  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get('code');
    const requestedNext =
      new URLSearchParams(window.location.search).get('next') ?? '/dashboard';
    const next = requestedNext.startsWith('/') &&
      !requestedNext.startsWith('//')
      ? requestedNext
      : '/dashboard';
    if (code) {
      const supabase = getSupabaseBrowserClient();
      if (!supabase) { router.replace('/login?error=auth'); return; }
      const operation = beginAuthSessionOperation();
      if (!operation) {
        router.replace('/login?error=security_cleanup');
        return;
      }
      canonicalExchangeCodeForSession(supabase, code)
        .then(({ error }) => {
          if (!canApplyAuthSessionOperation(operation)) return;
          router.replace(error ? '/login?error=expired' : next);
        })
        .finally(() => finishAuthSessionOperation(operation));
      return;
    }

    const hash   = window.location.hash.slice(1);
    const params = new URLSearchParams(hash);

    const accessToken  = params.get('access_token');
    const refreshToken = params.get('refresh_token');
    const type         = params.get('type');

    if (type === 'recovery' && accessToken && refreshToken) {
      const supabase = getSupabaseBrowserClient();
      if (!supabase) { router.replace('/login?error=auth'); return; }
      const operation = beginAuthSessionOperation();
      if (!operation) {
        router.replace('/login?error=security_cleanup');
        return;
      }

      canonicalSetSession(supabase, {
        access_token: accessToken,
        refresh_token: refreshToken,
      })
        .then(({ error }) => {
          if (!canApplyAuthSessionOperation(operation)) return;
          if (error) {
            router.replace('/login?error=expired');
          } else {
            router.replace('/reset-password');
          }
        })
        .finally(() => finishAuthSessionOperation(operation));
    } else {
      router.replace('/login?error=auth');
    }
  }, [router]);

  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: '#0a0a0f' }}>
      <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 14 }}>Yönlendiriliyor…</p>
    </div>
  );
}
