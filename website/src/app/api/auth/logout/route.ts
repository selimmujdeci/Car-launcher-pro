import { NextResponse } from 'next/server';
import { isSupabaseConfigured } from '@/lib/supabase';

export async function POST(request: Request) {
  const origin = new URL(request.url).origin;

  if (!isSupabaseConfigured) {
    const res = NextResponse.redirect(`${origin}/login`);
    res.cookies.delete('mock_auth');
    return res;
  }

  const { createSupabaseServerClient } = await import('@/lib/supabaseServer');
  const supabase = createSupabaseServerClient();
  await supabase.auth.signOut();

  return NextResponse.redirect(`${origin}/login`);
}
