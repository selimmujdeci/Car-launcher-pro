/**
 * /api/pwa/pair — FAIL-CLOSED KAPATILDI (Fleet Vehicle Connectivity P0).
 *
 * ── NEDEN KAPATILDI (kod kanıtı) ──────────────────────────────────────
 * Bu rota `supabaseAdmin.rpc('pair_vehicle', { p_pairing_code })` çağırıyordu.
 * Ölçüm (2026-07-30):
 *   · `pair_vehicle(text)` fonksiyonu bu depodaki HİÇBİR migration'da
 *     TANIMLI DEĞİL — `20260729000035_fleet_membership_foundation.sql:613`
 *     yalnız savunma amaçlı `REVOKE`/`GRANT` yapıyor.
 *   · `vehicles.pairing_code` kolonunu da hiçbir migration OLUŞTURMUYOR.
 *   · Rota, oturum AÇMADAN çalışıyor ("kod yetkinin kendisidir") ve başarı
 *     durumunda araca ait **raw `api_key`'i tarayıcıya döndürüyordu**.
 *
 * Yani bu yol (a) çalışmıyor, (b) çalışsaydı İKİNCİ ve daha zayıf bir
 * eşleştirme otoritesi olurdu, (c) cihaz sırrını istemciye sızdırıyordu.
 *
 * ── KARAR ─────────────────────────────────────────────────────────────
 * Eksik RPC ÜRETİLMEDİ (ikinci otorite yaratmamak için). Rota fail-closed
 * kapatıldı: tek tip, teknik detay sızdırmayan `PAIRING_FLOW_UNAVAILABLE`.
 * KANONİK YOL: head unit `register_vehicle` → 6 haneli kısa ömürlü kod →
 * Fleet panosu → `POST /api/vehicle/link` → `pair_vehicle_to_user`.
 *
 * Sessiz fallback YOK · api_key DÖNMEZ · SQL/hata metni SIZMAZ.
 */

import { NextResponse } from 'next/server';

const GONE_BODY = {
  error:
    'Bu eşleştirme yöntemi kullanımdan kaldırıldı. Aracı bağlamak için ' +
    'Filo panosundaki "Araç Ekle" ekranından, araç ekranında görünen ' +
    '6 haneli kodu girin.',
  code: 'PAIRING_FLOW_UNAVAILABLE',
  canonicalFlow: 'FLEET_DASHBOARD_6_DIGIT_CODE',
} as const;

/** 410 Gone — kalıcı olarak kaldırıldı (503 "geçici" izlenimi vermesin). */
export async function POST(): Promise<NextResponse> {
  return NextResponse.json(GONE_BODY, { status: 410 });
}

export async function GET(): Promise<NextResponse> {
  return NextResponse.json(GONE_BODY, { status: 410 });
}
