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
    const upperCode = code.toUpperCase();
    let vehicleId: string | null = null;

    const { data: tempCode, error: tempErr } = await supabaseAdmin
      .from('vehicle_linking_codes')
      .select('vehicle_id')
      .eq('code', upperCode)
      .gt('expires_at', new Date().toISOString())
      .maybeSingle();

    console.log('[link] code=%s userId=%s tempCode=%s tempErr=%s',
      upperCode, userId, JSON.stringify(tempCode), tempErr?.message);

    if (tempCode) {
      vehicleId = tempCode.vehicle_id as string;
      await supabaseAdmin.from('vehicle_linking_codes').delete().eq('vehicle_id', vehicleId);
    } else {
      const { data: byPermanent, error: permErr } = await supabaseAdmin
        .from('vehicles')
        .select('id')
        .eq('pairing_code', upperCode)
        .is('owner_id', null)
        .maybeSingle();

      console.log('[link] byPermanent=%s permErr=%s', JSON.stringify(byPermanent), permErr?.message);
      if (byPermanent) vehicleId = (byPermanent as { id: string }).id;
    }

    if (!vehicleId) {
      const msg = tempErr
        ? `DB hatası: ${tempErr.message}`
        : `Kod bulunamadı (${upperCode}) - geçersiz veya süresi dolmuş`;
      return NextResponse.json({ error: msg }, { status: 400 });
    }

    // 3. Claim ownership
    await supabaseAdmin
      .from('vehicles')
      .update({ owner_id: userId })
      .eq('id', vehicleId);

    // 4. Upsert vehicle_pairings
    const { error: pairErr } = await supabaseAdmin
      .from('vehicle_pairings')
      .upsert({ user_id: userId, vehicle_id: vehicleId, role: 'owner' },
               { onConflict: 'user_id,vehicle_id' });

    if (pairErr) {
      console.error('vehicle/link upsert:', pairErr);
      return NextResponse.json({ error: 'Bağlama kaydedilemedi.' }, { status: 500 });
    }

    // 5. Return vehicle info
    const { data: vehicle } = await supabaseAdmin
      .from('vehicles')
      .select('id, name, device_name, created_at')
      .eq('id', vehicleId)
      .maybeSingle();

    return NextResponse.json({
      vehicle: {
        id:         vehicleId,
        name:       (vehicle as { name?: string } | null)?.name ?? 'Araç',
        device_id:  (vehicle as { device_name?: string } | null)?.device_name,
        created_at: (vehicle as { created_at?: string } | null)?.created_at ?? new Date().toISOString(),
      },
    });
  } catch (err) {
    console.error('vehicle/link:', err);
    return NextResponse.json({ error: 'Sunucu hatası.' }, { status: 500 });
  }
}
