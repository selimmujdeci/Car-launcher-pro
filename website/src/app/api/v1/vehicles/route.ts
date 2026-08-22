/**
 * GET /api/v1/vehicles — dış müşteri REST API'si (V-16/7).
 *
 * SALT-OKUNUR. Yazma kapsamı BİLİNÇLİ OLARAK YOKTUR: dış bir anahtarla araca
 * komut yazmak bu turun kapsamının çok ötesinde bir güvenlik yüzeyidir.
 *
 * KAPSAM: `read:vehicles`. Kimlik ve hız sınırı TEK KAPIDAN geçer
 * (`authorizeApiRequest`) — her uç kendi doğrulamasını yazsaydı, biri
 * unutulduğunda kimlik doğrulamasız bir uç yayına girerdi.
 *
 * ALAN SEÇİMİ DAR TUTULDU: `api_key_hash` gibi sırlar ve iç alanlar DIŞARI
 * ÇIKMAZ. Dışa açılan her alan bilinçli bir karardır.
 */
import { createClient } from '@supabase/supabase-js';
import { authorizeApiRequest, apiError, apiOk } from '@/lib/api/publicApiAuth';

export const dynamic = 'force-dynamic';

export async function GET(req: Request): Promise<Response> {
  const auth = await authorizeApiRequest(req, 'read:vehicles');
  if (!auth.ok) return apiError(auth);

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL as string;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY as string;
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

  const { data, error } = await admin
    .from('vehicles')
    .select('id, name, plate, created_at')
    .eq('company_id', auth.companyId)
    .order('created_at', { ascending: false })
    .limit(500);

  if (error) {
    return apiError({ ok: false, status: 503, code: 'SERVICE_UNAVAILABLE',
      message: 'API su anda hizmet veremiyor.' });
  }

  return apiOk({ data: data ?? [] }, auth);
}
