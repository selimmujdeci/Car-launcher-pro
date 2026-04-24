import { NextRequest, NextResponse } from 'next/server';
import { isSupabaseConfigured } from '@/lib/supabase';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { mockVehicles } from '@/lib/mockData';

async function getUserId(req: NextRequest): Promise<string | null> {
  if (!isSupabaseConfigured) return 'mock-user';

  const auth  = req.headers.get('Authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return null;

  const { data } = await supabaseAdmin.auth.getUser(token);
  return data.user?.id ?? null;
}

export async function GET(req: NextRequest) {
  const userId = await getUserId(req);
  if (!userId) {
    return NextResponse.json({ error: 'Kimlik doğrulama gerekli.' }, { status: 401 });
  }

  if (!isSupabaseConfigured) {
    // Demo mode: return mock vehicles
    return NextResponse.json({ vehicles: mockVehicles });
  }

  // Get user's linked vehicles
  const { data, error } = await supabaseAdmin
    .from('vehicle_users')
    .select(`
      role,
      vehicle:vehicles (
        id, name, device_id, created_at
      )
    `)
    .eq('user_id', userId);

  if (error) {
    console.error('GET /api/vehicles:', error);
    return NextResponse.json({ error: 'Araçlar getirilemedi.' }, { status: 500 });
  }

  const vehicles = (data ?? []).map((row: any) => ({
    ...row.vehicle,
    role: row.role,
  }));

  return NextResponse.json({ vehicles });
}
