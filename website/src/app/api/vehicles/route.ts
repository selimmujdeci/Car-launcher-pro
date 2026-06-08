import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { isSupabaseConfigured } from '@/lib/supabase';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { mockVehicles } from '@/lib/mockData';

function getToken(req: NextRequest): string | null {
  const auth = req.headers.get('Authorization') ?? '';
  return auth.startsWith('Bearer ') ? auth.slice(7) : null;
}

export async function GET(req: NextRequest) {
  if (!isSupabaseConfigured) {
    // Demo mode: static fixture data (no Supabase)
    return NextResponse.json({ vehicles: mockVehicles });
  }

  const token = getToken(req);
  if (!token) {
    return NextResponse.json({ error: 'Kimlik doğrulama gerekli.' }, { status: 401 });
  }

  // JWT doğrula
  const { data: userData } = await supabaseAdmin.auth.getUser(token);
  if (!userData.user) {
    return NextResponse.json({ error: 'Kimlik doğrulama gerekli.' }, { status: 401 });
  }

  // Kullanıcının erişebildiği araçlar.
  // Prod şemada `vehicle_users` tablosu YOK; araç↔kullanıcı ilişkisi `vehicles`
  // tablosunun RLS policy'sinde: owner_id = auth.uid() OR company_id = auth_company_id()
  // (001_init.sql:194). Bu yüzden listeyi, kullanıcının kendi JWT'siyle (RLS-aware)
  // vehicles SELECT'ine delege ediyoruz — owner + şirket-üyesi araçlarını DB çözer.
  const userClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false } },
  );

  const { data, error } = await userClient
    .from('vehicles')
    .select('id, name, plate, created_at')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('GET /api/vehicles:', error);
    return NextResponse.json({ error: 'Araçlar getirilemedi.' }, { status: 500 });
  }

  return NextResponse.json({ vehicles: data ?? [] });
}
