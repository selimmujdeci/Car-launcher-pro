import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseMiddlewareClient } from '@/lib/supabaseServer';

function redirectWithCookies(response: NextResponse, destination: string, origin: string): NextResponse {
  const dest = NextResponse.redirect(new URL(destination, origin));
  // getSetCookie() her cookie'yi ayrı entry olarak döndürür — forEach birleştirip bozardı
  const setCookies = response.headers.getSetCookie?.() ?? [];
  setCookies.forEach((c) => dest.headers.append('set-cookie', c));
  return dest;
}

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);

  const code      = searchParams.get('code');
  const tokenHash = searchParams.get('token_hash');
  const type      = searchParams.get('type') as 'recovery' | 'signup' | 'email' | null;
  const next      = searchParams.get('next') ?? '/dashboard';

  const { supabase, response } = createSupabaseMiddlewareClient(request);

  // PKCE flow (email confirmation, OAuth)
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return redirectWithCookies(response, next, origin);
  }

  // Token-hash flow (password reset, magic link)
  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
    if (!error) {
      const target = type === 'recovery' ? '/reset-password' : next;
      return redirectWithCookies(response, target, origin);
    }
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
