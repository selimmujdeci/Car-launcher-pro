import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const MAX_AUTHORIZATION_HEADER_LENGTH = 8_192;
const NO_STORE_HEADERS = { 'Cache-Control': 'no-store' };

export async function POST(request: Request) {
  const authorization = request.headers.get('authorization') ?? '';
  if (authorization.length > MAX_AUTHORIZATION_HEADER_LENGTH) {
    return NextResponse.json(
      { ok: false, code: 'TARGET_SESSION_REQUIRED' },
      { status: 401, headers: NO_STORE_HEADERS },
    );
  }
  const accessToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length).trim()
    : '';
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!accessToken || !url || !anonKey) {
    return NextResponse.json(
      { ok: false, code: 'TARGET_SESSION_REQUIRED' },
      { status: 401, headers: NO_STORE_HEADERS },
    );
  }

  const client = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userError } =
    await client.auth.getUser(accessToken);
  if (userError || !userData.user) {
    return NextResponse.json(
      { ok: false, code: 'TARGET_SESSION_INVALID' },
      { status: 401, headers: NO_STORE_HEADERS },
    );
  }

  const { error } = await client.auth.admin.signOut(accessToken, 'local');
  if (error) {
    return NextResponse.json(
      { ok: false, code: 'TARGET_SESSION_REVOKE_FAILED' },
      { status: 502, headers: NO_STORE_HEADERS },
    );
  }
  return NextResponse.json({ ok: true }, { headers: NO_STORE_HEADERS });
}
