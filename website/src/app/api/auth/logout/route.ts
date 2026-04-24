import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabaseServer';

export async function POST(request: Request) {
  const origin = new URL(request.url).origin;
  const supabase = createSupabaseServerClient();
  await supabase.auth.signOut();

  return NextResponse.redirect(`${origin}/login`);
}
