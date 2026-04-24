import { createServerClient } from '@supabase/ssr';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const PROTECTED_PREFIXES = ['/dashboard', '/admin'];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isProtected = PROTECTED_PREFIXES.some((p) => pathname.startsWith(p));
  if (!isProtected) return NextResponse.next();

  // Clone response so we can forward refreshed auth cookies downstream
  const response = NextResponse.next({ request: { headers: request.headers } });

  const url  = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // ── Demo / mock mode (no Supabase env vars) ───────────────────────────────
  if (!url || !anon) {
    if (request.cookies.get('mock_auth')?.value !== 'true') {
      const dest = new URL('/login', request.url);
      dest.searchParams.set('redirect', pathname);
      return NextResponse.redirect(dest);
    }
    return response;
  }

  // ── Supabase SSR — HttpOnly cookie session ────────────────────────────────
  const supabase = createServerClient(url, anon, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (toSet) => {
        toSet.forEach(({ name, value, options }) => {
          request.cookies.set(name, value);
          response.cookies.set(name, value, options);
        });
      },
    },
  });

  // getUser() validates the JWT server-side — never trust getSession() alone
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    const dest = new URL('/login', request.url);
    dest.searchParams.set('redirect', pathname);
    return NextResponse.redirect(dest);
  }

  return response;
}

export const config = {
  matcher: ['/dashboard/:path*', '/admin/:path*'],
};
