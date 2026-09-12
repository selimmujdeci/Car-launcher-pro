/**
 * /api/company/vehicles — filo araçlarını listele (vehicle.read).
 */

import { NextResponse } from 'next/server';
import {
  resolveActor,
  assertCapability,
  assertCompany,
  fleetError,
  callRpc,
} from '@/lib/fleet/apiAuth';

interface CompanyVehicleRow {
  vehicle_id: string;
  name:       string | null;
  plate:      string | null;
  owner_id:   string | null;
  last_seen:  string | null;
  /**
   * Araç revizyonu — 039'un iyimser eşzamanlılık kapısının girdisi.
   *
   * RPC bu alanı migration **040** ile döndürmeye başladı. 040 uygulanmamış
   * bir ortamda alan gelmez; o zaman `null` kalır ve devir ekranı
   * `UNKNOWN_REVISION` ile fail-closed reddeder — **uydurulmaz**.
   */
  revision?:  number | null;
}

export async function GET() {
  const actor = await resolveActor();
  if (!actor) return fleetError('unauthenticated');

  const noCompany = assertCompany(actor);
  if (noCompany) return noCompany;

  const denied = assertCapability(actor, 'vehicle.read');
  if (denied) return denied;

  const { data, error } = await callRpc<CompanyVehicleRow[]>(actor, 'list_company_vehicles');
  if (error) return fleetError(error);

  return NextResponse.json({ vehicles: Array.isArray(data) ? data : [] });
}
