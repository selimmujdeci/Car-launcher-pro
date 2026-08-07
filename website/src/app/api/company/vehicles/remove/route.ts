/**
 * /api/company/vehicles/remove — aracı filodan çıkar (vehicle.remove — yalnız admin).
 *
 * Araç SİLİNMEZ ve `owner_id` KORUNUR — bu bir sahiplik devri değildir.
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

export async function POST(request: Request) {
  const actor = await resolveActor();
  if (!actor) return fleetError('unauthenticated');

  const noCompany = assertCompany(actor);
  if (noCompany) return noCompany;

  const denied = assertCapability(actor, 'vehicle.remove');
  if (denied) return denied;

  const body = await readJson(request);
  if (!body) return fleetError('invalid_request');

  const vehicleId = typeof body.vehicleId === 'string' ? body.vehicleId : '';
  if (!vehicleId) return fleetError('invalid_request');

  const { data, error } = await callRpc<{ vehicle_id: string; company_id: string | null }>(
    actor, 'remove_vehicle_from_company', { p_vehicle_id: vehicleId },
  );
  if (error) return fleetError(error);

  return NextResponse.json({ vehicle: data });
}
