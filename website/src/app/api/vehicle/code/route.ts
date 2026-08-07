/**
 * /api/vehicle/code — KULLANIMDAN KALDIRILDI (Fleet Vehicle Connectivity P0).
 *
 * KOD KANITI: head unit bu rotayı HİÇ çağırmaz — `vehicleIdentityService`
 * doğrudan `refresh_linking_code` RPC'sini kullanır
 * (`src/platform/vehicleIdentityService.ts:161`). Rota `api_key_hash` kolon
 * şemasıyla çalışıyordu ve `vehicle_linking_codes`'a ikinci bir yazma yolu
 * açıyordu.
 *
 * Kanonik yol: head unit `refresh_linking_code` → ekranda 6 haneli kod →
 * Fleet panosu `/api/vehicle/link` → `pair_vehicle_to_user()`.
 */

import { NextResponse } from 'next/server';
import {
  DEPRECATED_PAIRING_ROUTES,
  deprecatedRouteBody,
} from '@/lib/deprecatedPairingRoutes';

const ROUTE = DEPRECATED_PAIRING_ROUTES.find((r) => r.path === '/api/vehicle/code')!;

export async function POST(): Promise<NextResponse> {
  return NextResponse.json(deprecatedRouteBody(ROUTE), { status: ROUTE.status });
}
