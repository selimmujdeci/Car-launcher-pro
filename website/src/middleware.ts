import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createReadOnlySupabaseMiddlewareClient } from '@/lib/supabaseServer';
import { AUTH_CLEANUP_MARKER_COOKIE } from '@/security/accountCleanup/authCleanupMarker';

const PROTECTED_PREFIXES = ['/dashboard'];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isProtected = PROTECTED_PREFIXES.some((p) => pathname.startsWith(p));
  if (!isProtected) return NextResponse.next();
  if (request.cookies.has(AUTH_CLEANUP_MARKER_COOKIE)) {
    return NextResponse.redirect(new URL('/login?security=cleanup', request.url));
  }

  const { supabase, response } =
    createReadOnlySupabaseMiddlewareClient(request);

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    const dest = new URL('/login', request.url);
    dest.searchParams.set('redirect', pathname);
    return NextResponse.redirect(dest);
  }

  return response;
}

export const config = {
  matcher: ['/dashboard/:path*'],
};
