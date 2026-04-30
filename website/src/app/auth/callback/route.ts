import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseMiddlewareClient } from '@/lib/supabaseServer';

function redirectWithCookies(response: NextResponse, destination: string, origin: string): NextResponse {
  const dest = NextResponse.redirect(new URL(destination, origin));
  // Set-Cookie header'larını tam olarak kopyala (httpOnly, secure, sameSite korunur)
  response.headers.forEach((value, key) => {
    if (key.toLowerCase() === 'set-cookie') {
      dest.headers.append('set-cookie', value);
    }
  });
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

  return NextResponse.redirect(new URL('/login?error=auth', origin));
}
