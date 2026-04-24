import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const PROTECTED_PREFIXES = ['/dashboard', '/admin'];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isProtected = PROTECTED_PREFIXES.some((p) => pathname.startsWith(p));
  if (!isProtected) return NextResponse.next();

  const url  = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anon) {
    // Mock mode: cookie check
    if (request.cookies.get('mock_auth')?.value !== 'true') {
      const dest = new URL('/login', request.url);
      dest.searchParams.set('redirect', pathname);
      return NextResponse.redirect(dest);
    }
    return NextResponse.next();
  }

  // Supabase SSR — dynamic import keeps @supabase/ssr out of edge bundle
  const { createServerClient } = await import('@supabase/ssr');
  const response = NextResponse.next({ request: { headers: request.headers } });

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
