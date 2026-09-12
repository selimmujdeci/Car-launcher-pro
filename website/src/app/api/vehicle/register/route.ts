/**
 * /api/vehicle/register — KULLANIMDAN KALDIRILDI (Fleet Vehicle Connectivity P0).
 *
 * KOD KANITI: head unit bu rotayı HİÇ çağırmaz — `vehicleIdentityService`
 * doğrudan `register_vehicle` RPC'sini kullanır (anon key ile,
 * `src/platform/vehicleIdentityService.ts:119`). Grep sonucu: rotayı yalnız bir
 * test dosyası kaynak olarak import ediyor.
 *
 * Ayrıca bu rota `vehicles.api_key_hash` kolon şemasıyla çalışıyordu (canlı
 * şemada `api_key`; migration 024 `coalesce(api_key_hash, api_key)` ile
 * yamalamıştı) ve yanıtta **raw `apiKey` döndürüyordu**.
 *
 * İkinci bir kayıt otoritesi bırakmak yerine fail-closed kapatıldı.
 * Kanonik yol: head unit `register_vehicle` → 6 haneli kod → `/api/vehicle/link`.
 */

import { NextResponse } from 'next/server';
import {
  DEPRECATED_PAIRING_ROUTES,
  deprecatedRouteBody,
} from '@/lib/deprecatedPairingRoutes';

const ROUTE = DEPRECATED_PAIRING_ROUTES.find((r) => r.path === '/api/vehicle/register')!;

export async function POST(): Promise<NextResponse> {
  return NextResponse.json(deprecatedRouteBody(ROUTE), { status: ROUTE.status });
}
