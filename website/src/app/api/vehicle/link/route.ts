import { NextRequest, NextResponse } from 'next/server';
import { isSupabaseConfigured } from '@/lib/supabase';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

// Demo mode: in-memory code store (populated by /vehicle/code)
// Key: code string, Value: { vehicleId, expiresAt, used }
const demoCodes = new Map<string, { vehicleId: string; expiresAt: number; used: boolean }>();
const demoLinks = new Map<string, string[]>(); // userId → vehicleId[]

// Demo vehicles for Supabase-free testing
const DEMO_VEHICLES: Record<string, { id: string; name: string; plate: string }> = {
  'demo-v1': { id: 'demo-v1', name: 'Demo Araç 1', plate: '34 DEMO 01' },
  'demo-v2': { id: 'demo-v2', name: 'Demo Araç 2', plate: '34 DEMO 02' },
};
let demoVehicleIndex = 0;

async function getUserId(req: NextRequest): Promise<string | null> {
  if (!isSupabaseConfigured) return 'mock-user';

  const auth = req.headers.get('Authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return null;

  const { data } = await supabaseAdmin.auth.getUser(token);
  return data.user?.id ?? null;
}

export async function POST(req: NextRequest) {
  try {
    const { code } = (await req.json()) as { code?: string };

    if (!code || !/^\d{6}$/.test(code)) {
      return NextResponse.json({ error: 'Geçerli 6 haneli bir kod girin.' }, { status: 400 });
    }

    const userId = await getUserId(req);
    if (!userId) {
      return NextResponse.json({ error: 'Kimlik doğrulama gerekli.' }, { status: 401 });
    }

    // ── Demo mode ──────────────────────────────────────────────────
    if (!isSupabaseConfigured) {
      const entry = demoCodes.get(code);

      if (!entry) {
        // Demo: any valid 6-digit code links a demo vehicle
        const keys   = Object.keys(DEMO_VEHICLES);
        const vKey   = keys[demoVehicleIndex % keys.length];
        demoVehicleIndex++;
        const vehicle = DEMO_VEHICLES[vKey];
        const links   = demoLinks.get(userId) ?? [];
        demoLinks.set(userId, Array.from(new Set([...links, vehicle.id])));
        return NextResponse.json({ vehicle });
      }

      if (entry.used || Date.now() > entry.expiresAt) {
        return NextResponse.json({ error: 'Kod geçersiz veya süresi dolmuş.' }, { status: 400 });
      }
      entry.used = true;
      const vehicle = DEMO_VEHICLES[entry.vehicleId] ?? { id: entry.vehicleId, name: 'Araç', plate: '-- ----' };
      return NextResponse.json({ vehicle });
    }

    // ── Supabase mode ──────────────────────────────────────────────
    // 1. Find valid, unused, unexpired code
    const { data: linkingCode, error: codeErr } = await supabaseAdmin
      .from('linking_codes')
      .select('id, vehicle_id, expires_at, used_at')
      .eq('code', code)
      .is('used_at', null)
      .gt('expires_at', new Date().toISOString())
      .maybeSingle();

    if (codeErr || !linkingCode) {
      return NextResponse.json({ error: 'Kod geçersiz veya süresi dolmuş.' }, { status: 400 });
    }

    // 2. Mark code as used (atomic — prevent race condition)
    const { error: markErr } = await supabaseAdmin
      .from('linking_codes')
      .update({ used_at: new Date().toISOString() })
      .eq('id', linkingCode.id)
      .is('used_at', null); // double-check still null

    if (markErr) {
      return NextResponse.json({ error: 'Kod zaten kullanıldı.' }, { status: 409 });
    }

    // 3. Link user ↔ vehicle (upsert to handle re-links gracefully)
    const { error: linkErr } = await supabaseAdmin
      .from('vehicle_users')
      .upsert({ user_id: userId, vehicle_id: linkingCode.vehicle_id, role: 'owner' });

    if (linkErr) {
      console.error('vehicle/link insert:', linkErr);
      return NextResponse.json({ error: 'Bağlama başarısız.' }, { status: 500 });
    }

    // 4. Return vehicle info
    const { data: vehicle } = await supabaseAdmin
      .from('vehicles')
      .select('id, name, device_id, created_at')
      .eq('id', linkingCode.vehicle_id)
      .single();

    return NextResponse.json({ vehicle });
  } catch (err) {
    console.error('vehicle/link:', err);
    return NextResponse.json({ error: 'Sunucu hatası.' }, { status: 500 });
  }
}
