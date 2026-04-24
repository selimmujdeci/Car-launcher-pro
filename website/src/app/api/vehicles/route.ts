import { NextRequest, NextResponse } from 'next/server';
import { isSupabaseConfigured } from '@/lib/supabase';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { mockVehicles } from '@/lib/mockData';

async function getUserId(req: NextRequest): Promise<string | null> {
  if (!isSupabaseConfigured) return 'demo-user';

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
    // Demo mode: static fixture data (no Supabase)
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

  type VehicleRow = { role: string; vehicle: { id: string; name: string; device_id: string; created_at: string } | { id: string; name: string; device_id: string; created_at: string }[] };
  const vehicles = (data as VehicleRow[] ?? []).map((row) => {
    const v = Array.isArray(row.vehicle) ? row.vehicle[0] : row.vehicle;
    return { ...v, role: row.role };
  });

  return NextResponse.json({ vehicles });
}
