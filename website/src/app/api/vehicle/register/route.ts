import { NextRequest, NextResponse } from 'next/server';
import { isSupabaseConfigured } from '@/lib/supabase';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { generateApiKey, hashApiKey } from '@/lib/crypto';

// Mock store for demo mode (lives only for server process lifetime)
const mockVehicles = new Map<string, { id: string; name: string; apiKeyHash: string }>();

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { deviceId, name } = body as { deviceId?: string; name?: string };

    if (!deviceId || !name) {
      return NextResponse.json({ error: 'deviceId ve name zorunludur.' }, { status: 400 });
    }

    const rawApiKey  = generateApiKey();
    const apiKeyHash = hashApiKey(rawApiKey);

    if (!isSupabaseConfigured) {
      // ── Demo mode ──────────────────────────────────────────────
      if (Array.from(mockVehicles.values()).some((v) => v.name === deviceId)) {
        return NextResponse.json({ error: 'Cihaz zaten kayıtlı.' }, { status: 409 });
      }
      const vehicleId = `mock-${Date.now()}`;
      mockVehicles.set(deviceId, { id: vehicleId, name, apiKeyHash });
      return NextResponse.json({ vehicleId, apiKey: rawApiKey });
    }

    // ── Supabase mode ───────────────────────────────────────────
    // Check existing
    const { data: existing } = await supabaseAdmin
      .from('vehicles')
      .select('id')
      .eq('device_id', deviceId)
      .maybeSingle();

    if (existing) {
      return NextResponse.json({ error: 'Cihaz zaten kayıtlı.' }, { status: 409 });
    }

    const { data, error } = await supabaseAdmin
      .from('vehicles')
      .insert({ name, device_id: deviceId, api_key_hash: apiKeyHash })
      .select('id')
      .single();

    if (error || !data) {
      console.error('vehicle/register:', error);
      return NextResponse.json({ error: 'Kayıt başarısız.' }, { status: 500 });
    }

    // rawApiKey returned ONCE — device must store securely
    return NextResponse.json({ vehicleId: data.id, apiKey: rawApiKey });
  } catch (err) {
    console.error('vehicle/register:', err);
    return NextResponse.json({ error: 'Sunucu hatası.' }, { status: 500 });
  }
}
