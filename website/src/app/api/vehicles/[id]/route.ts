import { NextRequest, NextResponse } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { validateIdentityPatch } from '@/lib/vehicleDisplay';

const SUPABASE_URL      = process.env.NEXT_PUBLIC_SUPABASE_URL      ?? '';
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';
const SERVICE_ROLE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY     ?? '';

function bearer(req: NextRequest): string | null {
  const auth = req.headers.get('Authorization') ?? '';
  return auth.startsWith('Bearer ') ? auth.slice(7) : null;
}

/** Kullanıcının KENDİ token'ıyla konuşan istemci — RLS aynen uygulanır. */
function userClient(token: string): SupabaseClient {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

/** Yazma istemcisi — service_role varsa o, yoksa kullanıcı token'ı. */
function writeClient(token: string): SupabaseClient {
  if (!SERVICE_ROLE_KEY) return userClient(token);
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/**
 * KAPSAM KAPISI (fail-closed).
 *
 * Yazma/silme service_role ile yapıldığında RLS DEVRE DIŞI kalır; kapsamı bu
 * yüzden ayrıca doğrulamak ZORUNLUDUR. Kapsam, kullanıcının KENDİ token'ıyla
 * yaptığı `SELECT`ten gelir: `vehicles` SELECT policy'si sahip · şirket ·
 * eşleştirilmiş cihaz üçlüsünü zaten kodlar. Satır görünmüyorsa erişim YOKTUR.
 */
async function assertVehicleInScope(
  token: string,
  vehicleId: string,
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const client = userClient(token);

  const { data: userData, error: userError } = await client.auth.getUser();
  if (userError || !userData?.user) {
    return { ok: false, status: 401, error: 'Geçersiz oturum.' };
  }

  const { data, error } = await client
    .from('vehicles')
    .select('id')
    .eq('id', vehicleId)
    .maybeSingle();

  if (error) {
    return { ok: false, status: 500, error: `Araç erişimi doğrulanamadı: ${error.message}` };
  }
  if (!data) {
    return { ok: false, status: 403, error: 'Bu araç üzerinde yetkiniz yok.' };
  }
  return { ok: true };
}

/**
 * ARAÇ KİMLİĞİ (plaka · isim · sürücü) — #661.
 *
 * Bu rota açılana kadar araca isim vermenin HİÇBİR yolu yoktu: panel plaka
 * alanında araç UUID'sini gösteriyordu ve kimlik alanlarına yazan tek bir
 * çağrı yeri bile bulunmuyordu.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: vehicleId } = await params;

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return NextResponse.json({ error: 'Supabase yapılandırılmamış.' }, { status: 503 });
  }

  const token = bearer(req);
  if (!token) {
    return NextResponse.json({ error: 'Kimlik doğrulama gerekli.' }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as
    | { plate?: string | null; name?: string | null; driver?: string | null }
    | null;
  if (!body) {
    return NextResponse.json({ error: 'Geçersiz istek gövdesi.' }, { status: 400 });
  }

  const validation = validateIdentityPatch(body);
  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  const scope = await assertVehicleInScope(token, vehicleId);
  if (!scope.ok) {
    return NextResponse.json({ error: scope.error }, { status: scope.status });
  }

  /* Gövdede GÖNDERİLMEYEN alan DEĞİŞTİRİLMEZ (kısmi güncelleme). */
  const patch: Record<string, string | null> = {};
  if ('plate'  in body) patch.plate       = validation.patch.plate;
  if ('name'   in body) patch.name        = validation.patch.name;
  if ('driver' in body) patch.driver_name = validation.patch.driver_name;

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'Güncellenecek alan yok.' }, { status: 400 });
  }

  const { data, error } = await writeClient(token)
    .from('vehicles')
    .update(patch)
    .eq('id', vehicleId)
    .select('id, plate, name, driver_name');

  if (error) {
    console.error('PATCH /api/vehicles/[id]:', error.message);
    return NextResponse.json({ error: `Kimlik kaydedilemedi: ${error.message}` }, { status: 500 });
  }

  /* PostgREST 200 ≠ SATIR ETKİLENDİ. Sıfır satır dönerse yazma GERÇEKLEŞMEDİ
     (RLS engeli); bunu "kaydedildi" diye sunmak sessiz veri kaybıdır. */
  if (!data || data.length === 0) {
    return NextResponse.json(
      { error: 'Kayıt yazılamadı: bu araç üzerinde güncelleme yetkiniz yok.' },
      { status: 403 },
    );
  }

  return NextResponse.json({ ok: true, vehicle: data[0] });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: vehicleId } = await params;

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return NextResponse.json({ error: 'Supabase yapılandırılmamış.' }, { status: 503 });
  }

  const token = bearer(req);
  if (!token) {
    return NextResponse.json({ error: 'Kimlik doğrulama gerekli.' }, { status: 401 });
  }

  /* Silme de service_role ile yapılabildiği için kapsam kapısı ZORUNLU:
     kapı olmadan oturumlu HERHANGİ bir kullanıcı, kimliğini bildiği bir
     aracı silebiliyordu (RLS service_role'da devre dışıdır). */
  const scope = await assertVehicleInScope(token, vehicleId);
  if (!scope.ok) {
    return NextResponse.json({ error: scope.error }, { status: scope.status });
  }

  const { error } = await writeClient(token)
    .from('vehicles')
    .delete()
    .eq('id', vehicleId);

  if (error) {
    console.error('DELETE /api/vehicles/[id]:', error.message);
    return NextResponse.json({ error: `Araç kaldırılamadı: ${error.message}` }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
