'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Her sayfada çalışır.
 * URL hash'inde veya query'de recovery token varsa yakalar → /auth/hash-callback'e atar.
 * Supabase hangi URL'e yönlendirirse yönlendirsin (root, /login, /auth/callback) token kaybolmaz.
 */
export function AuthRecoveryHandler() {
  const router = useRouter();

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const hash   = window.location.hash.slice(1);
    const search = window.location.search.slice(1);

    // Hash'te recovery token var mı?
    if (hash) {
      const p = new URLSearchParams(hash);
      if (p.get('type') === 'recovery' && p.get('access_token')) {
        router.replace('/auth/hash-callback' + window.location.hash);
        return;
      }
    }

    // Query'de token_hash var mı? (route.ts henüz işlemediyse)
    if (search) {
      const p = new URLSearchParams(search);
      if (p.get('type') === 'recovery' && p.get('token_hash')) {
        router.replace('/auth/callback' + window.location.search);
        return;
      }
    }
  }, [router]);

  return null;
}
