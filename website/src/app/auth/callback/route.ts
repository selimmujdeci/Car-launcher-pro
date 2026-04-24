import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseMiddlewareClient } from '@/lib/supabaseServer';

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const next = searchParams.get('next') ?? '/dashboard';

  if (code) {
    const { supabase, response } = createSupabaseMiddlewareClient(request);
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      const redirectRes = NextResponse.redirect(new URL(next, origin));
      // Cookie'leri aktar
      response.cookies.getAll().forEach(({ name, value }) => {
        redirectRes.cookies.set(name, value);
      });
      return redirectRes;
    }
  }

  return NextResponse.redirect(new URL('/login?error=auth', origin));
}
