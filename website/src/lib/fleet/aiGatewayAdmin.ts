/**
 * aiGatewayAdmin.ts — AI GATEWAY İZİN YÖNETİMİ (Fleet panosu okuma/yazma ucu).
 *
 * ── NE YAPAR ───────────────────────────────────────────────────────────
 * `get_ai_gateway_access` okur, `set_ai_gateway_access` yazar. Yetki kararı
 * TAMAMEN SUNUCUDADIR (owner/admin); burada ikinci bir kapı KURULMAZ —
 * istemci kapısı yalnız butonu gizler, güvenlik SUNUCUNUN işidir.
 *
 * ── NE YAPMAZ ──────────────────────────────────────────────────────────
 * Karar üretmez · AI çağırmaz · bayrağı yerel olarak ezmez. Global ana
 * şalteri (`feature_flags`) BURADAN DEĞİŞTİREMEZ — o operatör kararıdır.
 */

import { getSupabaseBrowserClient } from '@/lib/supabaseBrowser';

export interface AiGatewayAccessRow {
  readonly kill_switch_on?: boolean | null;
  readonly company_granted?: boolean | null;
  readonly vehicle_grant_count?: number | null;
  readonly effective?: boolean | null;
  readonly granted_at?: string | null;
  readonly reason?: string | null;
}

export interface AiGatewayAccessReading {
  /** `null` = OKUNAMADI (izin yok DEĞİL). */
  readonly row: AiGatewayAccessRow | null;
  readonly readable: boolean;
}

/** Şirketin AI Gateway erişim durumunu okur. */
export async function readAiGatewayAccess(): Promise<AiGatewayAccessReading> {
  const supabase = getSupabaseBrowserClient();
  if (supabase === null) return { row: null, readable: false };
  try {
    const { data, error } = await supabase.rpc('get_ai_gateway_access');
    if (error) return { row: null, readable: false };
    const rows = Array.isArray(data) ? data : [];
    return { row: (rows[0] as AiGatewayAccessRow | undefined) ?? null, readable: true };
  } catch {
    return { row: null, readable: false };
  }
}

/** Sunucunun döndürebileceği bounded sonuç kodları. */
export type AiGatewaySetResult =
  | 'GRANTED' | 'REVOKED'
  | 'DENIED_ROLE' | 'DENIED_NO_SESSION' | 'DENIED_NO_COMPANY' | 'DENIED_VEHICLE_SCOPE'
  | 'UNREADABLE';

/**
 * İzni açar/kapatır.
 *
 * `vehicleId` verilirse YALNIZ o araç (kademeli açılış); verilmezse şirket geneli.
 * Sunucu reddederse neden bounded KOD olarak döner — ham SQL hatası KULLANICIYA
 * GÖSTERİLMEZ.
 */
export async function setAiGatewayAccess(
  enabled: boolean,
  vehicleId: string | null,
  reason: string,
): Promise<AiGatewaySetResult> {
  const supabase = getSupabaseBrowserClient();
  if (supabase === null) return 'UNREADABLE';
  try {
    const { data, error } = await supabase.rpc('set_ai_gateway_access', {
      p_enabled: enabled,
      p_vehicle_id: vehicleId,
      p_reason: reason.slice(0, 200),
    });
    if (error) return 'UNREADABLE';
    const v = typeof data === 'string' ? data : String(data ?? '');
    /* Sunucudan gelen dize bounded kümeye indirgenir: tanınmayan hiçbir değer
       yukarı taşınmaz (ham SQL metni kullanıcıya SIZMAZ — fail-closed). */
    const KNOWN: readonly string[] = [
      'GRANTED', 'REVOKED', 'DENIED_ROLE', 'DENIED_NO_SESSION',
      'DENIED_NO_COMPANY', 'DENIED_VEHICLE_SCOPE',
    ];
    return KNOWN.includes(v) ? (v as AiGatewaySetResult) : 'UNREADABLE';
  } catch {
    return 'UNREADABLE';
  }
}

/** Bounded kod → kullanıcı metni (teknik hata metni SIZMAZ). */
export function aiGatewayResultLabel(r: AiGatewaySetResult): string {
  switch (r) {
    case 'GRANTED':              return 'AI erişimi açıldı.';
    case 'REVOKED':              return 'AI erişimi kapatıldı.';
    case 'DENIED_ROLE':          return 'Bu işlem için yönetici yetkisi gerekiyor.';
    case 'DENIED_NO_SESSION':    return 'Oturum bulunamadı.';
    case 'DENIED_NO_COMPANY':    return 'Hesabınız bir şirkete bağlı değil.';
    case 'DENIED_VEHICLE_SCOPE': return 'Seçilen araç bu şirkete ait değil.';
    case 'UNREADABLE':           return 'İşlem tamamlanamadı — bağlantı veya yetki sorunu.';
  }
}
