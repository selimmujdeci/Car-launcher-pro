/**
 * /api/pwa/command — FAIL-CLOSED KAPATILDI (P0-001A).
 *
 * ── NEDEN (kod kanıtı, 2026-08-22) ────────────────────────────────────────
 * 1. `verifyApiKey(rawKey, vehicle.api_key_hash)` = `sha256(raw) === kolon`.
 *    Kolon bir hash TUTMAZ — `register_vehicle` `gen_random_uuid()::text`
 *    üretip AYNEN yazar (üretim: 834/834 UUID biçimli). Eşleşme İMKÂNSIZ →
 *    rota HER ZAMAN 401 döndürüyordu.
 * 2. Çağıran taraf anahtarı zaten saklamıyor: kanonik eşleştirme (#631)
 *    `api_key` döndürmez, `getStoredApiKey` boş dizeyi `null`a çevirir →
 *    `commandService.sendCommand` bu yola girmeden "API anahtarı bulunamadı"
 *    döner.
 * 3. GÜVENLİK: rota `critical_auth_verified: !!pinHash` yazıyordu — yani
 *    kritik komut PIN kapısı, istemcinin gövdeye koyduğu HERHANGİ bir
 *    string ile açılabiliyordu. Bu satır tek başına PIN korumasını
 *    anlamsız kılıyordu.
 *
 * Onarmak, düz metin anahtarı bearer secret olarak meşrulaştırmak olurdu.
 * Doğru sıra: önce anahtar gerçekten hash'lensin (P0-001H), sonra bu uç tek
 * doğrulama otoritesine bağlansın (P0-001I).
 *
 * KANONİK YOL: Supabase JWT oturumu → `vehicle_commands` (RLS: sahiplik/eşleşme)
 * → araç `fetch_pending_vehicle_commands` ile ÇEKER.
 */

import { NextResponse } from 'next/server';
import {
  DEPRECATED_API_KEY_ROUTES,
  deprecatedApiKeyRouteBody,
} from '@/lib/deprecatedApiKeyRoutes';

const ROUTE = DEPRECATED_API_KEY_ROUTES.find((r) => r.path === '/api/pwa/command')!;

export async function POST(): Promise<NextResponse> {
  return NextResponse.json(deprecatedApiKeyRouteBody(ROUTE), { status: ROUTE.status });
}
