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

    /* ── Supabase mode — TEK ATOMİK RPC ──────────────────────────────
     * ESKİ AKIŞ (P1 kusuru): kod arama → `owner_id` update → `vehicle_pairings`
     * upsert AYRI AYRI sorgulardı. (a) `vehicles.company_id` HİÇ yazılmıyordu →
     * `push_vehicle_event` konum satırını atlıyor, araç ONLINE ama markersız
     * kalıyordu; (b) ortada hata olursa YARIM pairing kalabiliyordu; (c) hiçbir
     * üyelik/sahiplik kapısı yoktu (service-role tüm RLS'i bypass ediyor).
     *
     * Yeni akış tek transaction'dır: kod + TTL + tek kullanım + üyelik + sahiplik
     * kapıları + bireysel limit + `owner_id`/`company_id`/`vehicle_pairings`
     * yazımı hep birlikte olur ya da hiç olmaz.
     *
     * ⚠️ İstemciden company_id/owner_id/araç sayısı ALINMAZ — istek gövdesinde
     * yalnız `code` okunur; şirket SUNUCUDA doğrulanmış üyelikten çözülür. */
    const { data: paired, error: rpcErr } = await supabaseAdmin
      .rpc('pair_vehicle_to_user', { p_code: code, p_user_id: userId });

    if (rpcErr) {
      const reason = rpcErr.message ?? '';
      // Fail-closed eşlemesi: hiçbir dal "kısmi başarı" döndürmez.
      if (reason.includes('individual_vehicle_limit_reached')) {
        return NextResponse.json({
          error: 'Bireysel hesapla en fazla 3 araç bağlayabilirsin. Daha fazlası için filo (şirket) üyeliğine geçmen gerekiyor.',
          code:  'individual_vehicle_limit_reached',
        }, { status: 403 });
      }
      if (reason.includes('vehicle_belongs_to_another_company')) {
        return NextResponse.json({
          error: 'Bu araç başka bir filoya bağlı. Araç devri için filo yöneticinizle iletişime geçin.',
          code:  'vehicle_belongs_to_another_company',
        }, { status: 409 });
      }
      if (reason.includes('vehicle_owned_by_another_user')) {
        return NextResponse.json({
          error: 'Bu araç başka bir kullanıcıya ait. Sahiplik değişikliği için araç devri gerekir.',
          code:  'vehicle_owned_by_another_user',
        }, { status: 409 });
      }
      if (reason.includes('invalid_or_expired_code') || reason.includes('invalid_code')) {
        return NextResponse.json({
          error: 'Kod geçersiz veya süresi dolmuş.',
          code:  'invalid_or_expired_code',
        }, { status: 400 });
      }
      if (reason.includes('unauthenticated')) {
        return NextResponse.json({ error: 'Kimlik doğrulama gerekli.' }, { status: 401 });
      }
      console.error('vehicle/link rpc:', rpcErr.message);
      return NextResponse.json({ error: 'Bağlama kaydedilemedi.' }, { status: 500 });
    }

    const row = (paired ?? null) as {
      vehicle_id?: string; name?: string; device_id?: string;
      created_at?: string; company_id?: string | null; is_individual?: boolean;
    } | null;

    if (!row?.vehicle_id) {
      return NextResponse.json({ error: 'Bağlama kaydedilemedi.' }, { status: 500 });
    }

    return NextResponse.json({
      vehicle: {
        id:         row.vehicle_id,
        name:       row.name ?? 'Araç',
        device_id:  row.device_id,
        created_at: row.created_at ?? new Date().toISOString(),
        company_id: row.company_id ?? null,
      },
    });
  } catch (err) {
    console.error('vehicle/link:', err);
    return NextResponse.json({ error: 'Sunucu hatası.' }, { status: 500 });
  }
}
