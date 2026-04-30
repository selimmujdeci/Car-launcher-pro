import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { isSupabaseConfigured } from '@/lib/supabase';

// Demo mode — in-memory (process lifetime)
const DEMO_VEHICLES: Record<string, { name: string; plate: string; apiKey: string }> = {
  DEMO01: { name: 'Demo Araç',  plate: '34 DEMO 01', apiKey: 'demo-api-key-001' },
  DEMO02: { name: 'Demo Araç 2', plate: '06 DEMO 02', apiKey: 'demo-api-key-002' },
};

export async function POST(req: NextRequest) {
  try {
    const { code } = (await req.json()) as { code?: string };
    const normalized = (code ?? '').trim().toUpperCase();

    if (!normalized || normalized.length < 4) {
      return NextResponse.json({ error: 'Geçerli bir eşleştirme kodu girin.' }, { status: 400 });
    }

    // ── Demo mode ─────────────────────────────────────────────────────────────
    if (!isSupabaseConfigured) {
      const demo = DEMO_VEHICLES[normalized];
      if (!demo) {
        return NextResponse.json({ error: 'Kod geçersiz veya süresi dolmuş.' }, { status: 400 });
      }
      return NextResponse.json({
        success: true,
        vehicleId: `demo-${normalized.toLowerCase()}`,
        apiKey:    demo.apiKey,
        name:      demo.name,
        plate:     demo.plate,
      });
    }

    // ── Supabase mode — no user auth required ─────────────────────────────────
    // supabaseAdmin bypasses RLS — pairing code itself is the authorization
    const { data, error } = await supabaseAdmin.rpc('pair_vehicle', {
      p_pairing_code: normalized,
    });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    const res = data as {
      success:     boolean;
      vehicle_id?: string;
      api_key?:    string;
      message?:    string;
    };

    if (!res.success || !res.vehicle_id || !res.api_key) {
      return NextResponse.json(
        { error: res.message ?? 'Eşleştirme başarısız.' },
        { status: 400 },
      );
    }

    // Fetch human-readable vehicle metadata
    const { data: vehicle } = await supabaseAdmin
      .from('vehicles')
      .select('name, plate')
      .eq('id', res.vehicle_id)
      .maybeSingle();

    return NextResponse.json({
      success:   true,
      vehicleId: res.vehicle_id,
      apiKey:    res.api_key,
      name:      (vehicle as { name?: string; plate?: string } | null)?.name  ?? 'Araç',
      plate:     (vehicle as { name?: string; plate?: string } | null)?.plate ?? '—',
    });
  } catch (err) {
    console.error('api/pwa/pair:', err);
    return NextResponse.json({ error: 'Sunucu hatası.' }, { status: 500 });
  }
}
