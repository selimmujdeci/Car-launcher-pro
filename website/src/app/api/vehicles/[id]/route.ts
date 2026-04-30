import { NextRequest, NextResponse } from 'next/server';
import { isSupabaseConfigured } from '@/lib/supabase';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

async function getUserId(req: NextRequest): Promise<string | null> {
  if (!isSupabaseConfigured) return 'demo-user';

  const auth  = req.headers.get('Authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return null;

  const { data } = await supabaseAdmin.auth.getUser(token);
  return data.user?.id ?? null;
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: vehicleId } = await params;

  const userId = await getUserId(req);
  if (!userId) {
    return NextResponse.json({ error: 'Kimlik doğrulama gerekli.' }, { status: 401 });
  }

  if (!isSupabaseConfigured) {
    return NextResponse.json({ ok: true });
  }

  const { error } = await supabaseAdmin
    .from('vehicle_users')
    .delete()
    .eq('vehicle_id', vehicleId)
    .eq('user_id', userId);

  if (error) {
    console.error('DELETE /api/vehicles/[id]:', error);
    return NextResponse.json({ error: 'Araç kaldırılamadı.' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
