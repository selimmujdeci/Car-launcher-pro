/**
 * /api/vehicle/unlink — GERÇEK SUNUCU TARAFLI ARAÇ AYIRMA (F0.4).
 *
 * ── NEDEN VAR ────────────────────────────────────────────────────────────
 * PWA'daki "Araç bağlantısını kes" yalnız yerel durumu siliyordu; sunucuda
 * `vehicles.owner_id` ve `vehicle_pairings` satırı kalıyordu. Bu hem düğmeyi
 * yalancı yapıyor hem de bireysel 3 araç kotasını kalıcı olarak dolduruyordu.
 *
 * ── GÜVEN MODELİ (`/api/vehicle/link` ile BİREBİR aynı) ──────────────────
 * Kullanıcı kimliği İSTEK GÖVDESİNDEN ALINMAZ. Bearer JWT `supabaseAdmin`
 * ile DOĞRULANIR ve çözülen `uid` RPC'ye parametre olarak geçer. RPC istemci
 * rollerine kapalıdır (yalnız `service_role`), bu yüzden kimse başkasının
 * id'sini geçiremez. Sahiplik/eşleşme kapısı RPC'nin İÇİNDEDİR.
 */

import { NextRequest, NextResponse } from 'next/server';
import { isSupabaseConfigured } from '@/lib/supabase';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import {
  isDemoFallbackAllowed, MISCONFIGURED_BODY, MISCONFIGURED_STATUS,
} from '@/lib/demoModeGuard';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function getUserId(req: NextRequest): Promise<string | null> {
  const auth  = req.headers.get('Authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return null;

  const { data } = await supabaseAdmin.auth.getUser(token);
  return data.user?.id ?? null;
}

export async function POST(req: NextRequest) {
  try {
    const { vehicleId } = (await req.json()) as { vehicleId?: string };

    if (!vehicleId || !UUID_RE.test(vehicleId)) {
      return NextResponse.json({ error: 'Geçerli bir araç kimliği gerekli.' }, { status: 400 });
    }

    /* F0.6 · Üretimde yapılandırma eksikse sunucu-otoriteli ayırma YAPILAMAZ.
       Sessizce "başarılı" DÖNÜLMEZ: istemci yerel kaydı silmemelidir. */
    if (!isSupabaseConfigured) {
      if (!isDemoFallbackAllowed()) {
        console.error('vehicle/unlink: Supabase yapılandırması eksik — üretimde sahte başarı DÖNÜLMEZ');
        return NextResponse.json(MISCONFIGURED_BODY, { status: MISCONFIGURED_STATUS });
      }
      /* Dev/demo: sunucuda kalıcı durum yok; ayırma anlamsız ama akış
         bozulmasın diye başarı döner (yalnız NODE_ENV !== 'production'). */
      return NextResponse.json({ vehicleId, ownerCleared: false, demo: true });
    }

    const userId = await getUserId(req);
    if (!userId) {
      return NextResponse.json({ error: 'Kimlik doğrulama gerekli.' }, { status: 401 });
    }

    const { data, error } = await supabaseAdmin.rpc('unpair_vehicle_from_user', {
      p_vehicle_id: vehicleId,
      p_user_id:    userId,
    });

    if (error) {
      const reason = error.message ?? '';
      /* Fail-closed eşleme: hiçbir dal "kısmi başarı" döndürmez.
         `vehicle_not_paired` ve `vehicle_not_found` AYNI cevabı verir —
         başkasının aracının VARLIĞI sızdırılmaz. */
      if (reason.includes('vehicle_not_paired') || reason.includes('vehicle_not_found')) {
        return NextResponse.json({
          error: 'Bu araç hesabınıza bağlı değil.',
          code:  'vehicle_not_paired',
        }, { status: 404 });
      }
      if (reason.includes('unauthenticated')) {
        return NextResponse.json({ error: 'Kimlik doğrulama gerekli.' }, { status: 401 });
      }
      if (reason.includes('invalid_request')) {
        return NextResponse.json({ error: 'Geçerli bir araç kimliği gerekli.' }, { status: 400 });
      }
      console.error('vehicle/unlink rpc:', reason);
      return NextResponse.json({ error: 'Araç bağlantısı kesilemedi.' }, { status: 500 });
    }

    const row = (data ?? null) as {
      vehicle_id?: string;
      owner_cleared?: boolean;
      pairing_removed?: boolean;
      was_company_vehicle?: boolean;
    } | null;

    if (!row?.vehicle_id) {
      return NextResponse.json({ error: 'Araç bağlantısı kesilemedi.' }, { status: 500 });
    }

    return NextResponse.json({
      vehicleId:         row.vehicle_id,
      ownerCleared:      row.owner_cleared === true,
      pairingRemoved:    row.pairing_removed === true,
      wasCompanyVehicle: row.was_company_vehicle === true,
    });
  } catch (err) {
    console.error('vehicle/unlink:', err);
    return NextResponse.json({ error: 'Araç bağlantısı kesilemedi.' }, { status: 500 });
  }
}
