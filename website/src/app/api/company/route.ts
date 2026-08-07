/**
 * /api/company — filo (şirket) yaşam döngüsü.
 *
 *   POST   → şirket kur (kurucu admin olur)
 *   GET    → şirket bilgisi + çağıranın rolü/yetkileri
 *   PATCH  → şirket adını güncelle (yalnız admin)
 *   DELETE → şirketi sil (yalnız admin; araçlar SİLİNMEZ, filodan ayrılır)
 *
 * Kimlik yalnız oturumdan alınır; istemciden actor user_id KABUL EDİLMEZ.
 */

import { NextResponse } from 'next/server';
import {
  resolveActor,
  assertCapability,
  assertCompany,
  fleetError,
  callRpc,
  readJson,
} from '@/lib/fleet/apiAuth';
import { capabilitiesOf } from '@/lib/fleet/roles';

export async function POST(request: Request) {
  const actor = await resolveActor();
  if (!actor) return fleetError('unauthenticated');

  const body = await readJson(request);
  if (!body) return fleetError('invalid_request');

  const name = typeof body.name === 'string' ? body.name : '';
  if (!name.trim()) return fleetError('invalid_company_name');

  const { data, error } = await callRpc<{ company_id: string; name: string; role: string }>(
    actor, 'create_company', { p_name: name },
  );
  if (error) return fleetError(error);
  if (!data?.company_id) return fleetError('server_error');

  return NextResponse.json({ company: data }, { status: 201 });
}

export async function GET() {
  const actor = await resolveActor();
  if (!actor) return fleetError('unauthenticated');

  // Şirketi olmayan kullanıcı hata DEĞİL — bireysel durum bilgisi döner.
  if (!actor.companyId) {
    return NextResponse.json({
      company:     null,
      role:        actor.role,
      permissions: capabilitiesOf(actor.role),
    });
  }

  const denied = assertCapability(actor, 'company.read');
  if (denied) return denied;

  const { data, error } = await actor.supabase
    .from('companies')
    .select('id, name, created_at')
    .eq('id', actor.companyId)
    .maybeSingle();

  if (error) return fleetError('server_error');
  if (!data) return fleetError('company_deleted');

  return NextResponse.json({
    company:     data,
    role:        actor.role,
    permissions: capabilitiesOf(actor.role),
  });
}

export async function PATCH(request: Request) {
  const actor = await resolveActor();
  if (!actor) return fleetError('unauthenticated');

  const noCompany = assertCompany(actor);
  if (noCompany) return noCompany;

  const denied = assertCapability(actor, 'company.update');
  if (denied) return denied;

  const body = await readJson(request);
  if (!body) return fleetError('invalid_request');

  const name = typeof body.name === 'string' ? body.name : '';
  if (!name.trim()) return fleetError('invalid_company_name');

  const { data, error } = await callRpc<{ company_id: string; name: string }>(
    actor, 'update_company', { p_name: name },
  );
  if (error) return fleetError(error);

  return NextResponse.json({ company: data });
}

export async function DELETE() {
  const actor = await resolveActor();
  if (!actor) return fleetError('unauthenticated');

  const noCompany = assertCompany(actor);
  if (noCompany) return noCompany;

  const denied = assertCapability(actor, 'company.delete');
  if (denied) return denied;

  const { data, error } = await callRpc<{
    company_id: string; detached_vehicles: number; released_members: number;
  }>(actor, 'delete_company');
  if (error) return fleetError(error);

  return NextResponse.json({ deleted: data });
}
