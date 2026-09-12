/**
 * /api/company/vehicles/assign — aracı filoya ata (vehicle.assign — yalnız admin).
 *
 * SAHİPSİZ araç ATANAMAZ: sunucu tarafı `assign_vehicle_to_company` aracın
 * sahibinin çağıran ya da aynı şirketin üyesi olmasını şart koşar.
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

  const denied = assertCapability(actor, 'vehicle.assign');
  if (denied) return denied;

  const body = await readJson(request);
  if (!body) return fleetError('invalid_request');

  const vehicleId = typeof body.vehicleId === 'string' ? body.vehicleId : '';
  if (!vehicleId) return fleetError('invalid_request');

  const { data, error } = await callRpc<{ vehicle_id: string; company_id: string }>(
    actor, 'assign_vehicle_to_company', { p_vehicle_id: vehicleId },
  );
  if (error) return fleetError(error);

  return NextResponse.json({ vehicle: data });
}
