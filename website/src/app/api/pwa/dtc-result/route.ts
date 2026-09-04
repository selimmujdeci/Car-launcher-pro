/**
 * /api/pwa/dtc-result — FAIL-CLOSED KAPATILDI (P0-001A).
 *
 * ── NEDEN (kod kanıtı, 2026-08-22) ────────────────────────────────────────
 * `verifyApiKey(rawKey, vehicle.api_key_hash)` = `sha256(raw) === kolon`;
 * kolon düz metin UUID tutar (üretim: 834/834) → eşleşme İMKÂNSIZ, uç HER
 * ZAMAN 401 dönüyordu. Üstelik çağıran `DiagnosticsPanel.fetchDiagResult`
 * anahtarı bulamadığı için isteği `Authorization` BAŞLIĞI OLMADAN atıyor →
 * pratikte 400. Yani bu uç hiç çalışmadı.
 *
 * ── AÇIK BORÇ (bilerek bu turda kapatılmadı) ──────────────────────────────
 * Teşhis sonucunu okumanın ÇALIŞAN yolu vardır: oturumlu kullanıcı
 * `vehicle_commands` satırını RLS ile (`commands: okuyabilir` →
 * `is_vehicle_owner OR is_paired`) doğrudan okuyabilir. `DiagnosticsPanel`i
 * o yola taşımak P0-001A kapsamı DIŞINDADIR ve ayrı bir turdur. O tur
 * gelene kadar panel açık gerekçeli 410 alır — sessiz 401'den daha dürüsttür.
 *
 * TİPLER KORUNDU: `DtcCode` ve `DtcResult` bu modülden import edilir
 * (`components/pwa/DiagnosticsPanel.tsx`). Sözleşme kaldırılırsa derleme
 * kırılır ve kapatma, ilgisiz bir yerde hataya dönüşürdü.
 */

import { NextResponse } from 'next/server';
import {
  DEPRECATED_API_KEY_ROUTES,
  deprecatedApiKeyRouteBody,
} from '@/lib/deprecatedApiKeyRoutes';

export interface DtcCode {
  code:     string;
  severity: 'critical' | 'warning' | 'info';
  system:   string;
  desc:     string;
  /** Hangi OBD modundan geldi (araç tarafı doldurur; eski kayıtlarda yok). */
  status?:  'stored' | 'pending' | 'permanent';
}

export interface DtcResult {
  dtcs:      DtcCode[];
  voltage?:  number;
  readAt:    string;
  status:    'completed' | 'pending' | 'failed';
  /**
   * true → araçta en az bir tarama modu okunamadı. BOŞ LİSTE "arıza yok"
   * ANLAMINA GELMEZ; UI bunu "temiz" diye sunamaz (fail-closed).
   */
  partial?:  boolean;
  /** false → araç Mode 0A'yı hiç desteklemiyor ("kalıcı kod yok" ile aynı şey değil). */
  permanentSupported?: boolean;
  /** Komut başarısızsa aracın bildirdiği GERÇEK gerekçe (uydurulmaz). */
  errorReason?: string;
  /** true → gerçek araç okuması DEĞİL, demo verisi. UI bunu görünür işaretler. */
  demo?:     boolean;
}

const ROUTE = DEPRECATED_API_KEY_ROUTES.find((r) => r.path === '/api/pwa/dtc-result')!;

export async function GET(): Promise<NextResponse> {
  return NextResponse.json(deprecatedApiKeyRouteBody(ROUTE), { status: ROUTE.status });
}

export async function POST(): Promise<NextResponse> {
  return NextResponse.json(deprecatedApiKeyRouteBody(ROUTE), { status: ROUTE.status });
}
