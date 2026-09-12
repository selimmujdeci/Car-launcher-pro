import { NextRequest, NextResponse } from 'next/server';
import { AUTH_CLEANUP_MARKER_COOKIE } from '@/security/accountCleanup/authCleanupMarker';

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  if (request.cookies.has(AUTH_CLEANUP_MARKER_COOKIE)) {
    return NextResponse.redirect(new URL('/login?security=cleanup', origin));
  }

  const code      = searchParams.get('code');
  const tokenHash = searchParams.get('token_hash');
  const type      = searchParams.get('type') as 'recovery' | 'signup' | 'email' | null;
  const requestedNext = searchParams.get('next') ?? '/dashboard';
  const next = requestedNext.startsWith('/') && !requestedNext.startsWith('//')
    ? requestedNext
    : '/dashboard';

  // token_hash (recovery / magic-link) → client-side'a ilet, server cookie gerektirmez
  if (tokenHash && type) {
    const target = type === 'recovery'
      ? `/reset-password?token_hash=${tokenHash}&type=${type}`
      : `${next}?token_hash=${tokenHash}&type=${type}`;
    return NextResponse.redirect(new URL(target, origin));
  }

  // PKCE değişimi browser canonical auth-mutation authority içinde yapılır.
  // Server burada Set-Cookie üretmez; böylece cleanup Web Lock/ownership
  // sözleşmesini atlayan paralel bir session writer oluşmaz.
  if (code) {
    const target = new URL('/auth/hash-callback', origin);
    target.searchParams.set('code', code);
    target.searchParams.set(
      'next',
      type === 'recovery' ? '/reset-password' : next,
    );
    return NextResponse.redirect(target);
  }

  // Hash fragment (#access_token=...) server-side okunamaz — client'a bırak
  return new NextResponse(
    `<!doctype html><html><head><meta charset="utf-8"></head><body><script>
      var h = window.location.hash;
      if (h && h.includes('access_token')) {
        window.location.replace('/auth/hash-callback' + h);
      } else {
        window.location.replace('/login?error=auth');
      }
    </script></body></html>`,
    { headers: { 'content-type': 'text/html; charset=utf-8' } }
  );
}
