import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL      = process.env.NEXT_PUBLIC_SUPABASE_URL      ?? '';
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';
const SERVICE_ROLE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY     ?? '';

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: vehicleId } = await params;

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return NextResponse.json({ error: 'Supabase yapılandırılmamış.' }, { status: 503 });
  }

  const auth  = req.headers.get('Authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) {
    return NextResponse.json({ error: 'Kimlik doğrulama gerekli.' }, { status: 401 });
  }

  // Service role varsa admin client, yoksa kullanıcı token'ı ile devam
  const key    = SERVICE_ROLE_KEY || SUPABASE_ANON_KEY;
  const client = createClient(SUPABASE_URL, key, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: SERVICE_ROLE_KEY ? {} : { Authorization: `Bearer ${token}` } },
  });

  // Kullanıcıyı doğrula
  const { data: { user } } = SERVICE_ROLE_KEY
    ? await client.auth.getUser(token)
    : await client.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Geçersiz oturum.' }, { status: 401 });
  }

  // vehicles tablosundan direkt sil
  const { error } = await client
    .from('vehicles')
    .delete()
    .eq('id', vehicleId);

  if (error) {
    console.error('DELETE /api/vehicles/[id]:', error.message);
    return NextResponse.json({ error: `Araç kaldırılamadı: ${error.message}` }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
