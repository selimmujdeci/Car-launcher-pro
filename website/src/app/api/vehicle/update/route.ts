/**
 * /api/vehicle/update — FAIL-CLOSED KAPATILDI (P0-001A).
 *
 * ── NEDEN (kod kanıtı, 2026-08-22) ────────────────────────────────────────
 * 1. Doğrulama `eq('api_key_hash', sha256(raw))` + `verifyApiKey` ile
 *    yapılıyordu; kolon düz metin UUID tutar (üretim: 834/834) → eşleşme
 *    İMKÂNSIZ, uç HER ZAMAN 401 dönüyordu.
 * 2. Kod tabanında GERÇEK çağıranı YOK: `realtimeEngine.ts:174` yalnızca
 *    yorumda anar; araç tarafı telemetriyi `push_vehicle_event` RPC'siyle
 *    gönderir (`vehicleIdentityService.pushVehicleEvent`).
 * 3. Kalıcılaştırma zaten bu rotada değildi — burası yalnız realtime
 *    broadcast köprüsüydü ve o köprü hiç kurulamıyordu.
 *
 * ── #667 "SAHTE 0 YASAĞI" NEREYE GİTTİ ────────────────────────────────────
 * Bu dosya `orMissing`/`Number.NaN` ile eksik alanı sıfıra çevirmeyi
 * engelliyordu. Kural KALDIRILMADI — zaten ASIL koruma alıcı taraftadır:
 * `store/vehicleStore.ts` her alanı `Number.isFinite` ile eler ve önceki
 * gerçek ölçümü korur. Rota kapandığı için burada işlenecek veri kalmadı;
 * `consoleShell.test.ts` içindeki kilit, dersin YAŞADIĞI yere taşındı.
 *
 * KANONİK YOL: araç → `push_vehicle_event` RPC (api_key ile, SECURITY DEFINER)
 * → `vehicle_events` + `vehicle_locations` + `vehicle_telemetry`.
 */

import { NextResponse } from 'next/server';
import {
  DEPRECATED_API_KEY_ROUTES,
  deprecatedApiKeyRouteBody,
} from '@/lib/deprecatedApiKeyRoutes';

const ROUTE = DEPRECATED_API_KEY_ROUTES.find((r) => r.path === '/api/vehicle/update')!;

export async function POST(): Promise<NextResponse> {
  return NextResponse.json(deprecatedApiKeyRouteBody(ROUTE), { status: ROUTE.status });
}
