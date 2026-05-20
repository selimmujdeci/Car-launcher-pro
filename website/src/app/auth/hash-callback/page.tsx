'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { getSupabaseBrowserClient } from '@/lib/supabaseBrowser';

export default function HashCallbackPage() {
  const router = useRouter();

  useEffect(() => {
    const hash   = window.location.hash.slice(1);
    const params = new URLSearchParams(hash);

    const accessToken  = params.get('access_token');
    const refreshToken = params.get('refresh_token');
    const type         = params.get('type');

    if (type === 'recovery' && accessToken && refreshToken) {
      const supabase = getSupabaseBrowserClient();
      if (!supabase) { router.replace('/login?error=auth'); return; }

      supabase.auth
        .setSession({ access_token: accessToken, refresh_token: refreshToken })
        .then(({ error }) => {
          if (error) {
            router.replace('/login?error=expired');
          } else {
            router.replace('/reset-password');
          }
        });
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
