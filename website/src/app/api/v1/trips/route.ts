/**
 * GET /api/v1/trips — dış müşteri REST API'si (V-16/7).
 *
 * SALT-OKUNUR. KAPSAM: `read:trips`.
 *
 * SAYFALAMA: `limit` üst sınırı SUNUCUDA kırpılır (varsayılan 100, tavan 500).
 * İstemcinin verdiği sayıya körlemesine güvenmek, tek istekle tüm tabloyu
 * çektirir ve hız sınırını anlamsız kılardı.
 *
 * PROVENANCE ALANLARI DA DÖNER (`distance_source` · `fuel_source` ·
 * `cost_source`): müşteri, hangi değerin ÖLÇÜLDÜĞÜNÜ hangisinin TAHMİN
 * olduğunu bilmeden karar veremez. Bunları gizlemek sahte kesinlik satmaktır.
 */
import { createClient } from '@supabase/supabase-js';
import { authorizeApiRequest, apiError, apiOk } from '@/lib/api/publicApiAuth';

export const dynamic = 'force-dynamic';

const MAX_LIMIT = 500;
const DEFAULT_LIMIT = 100;

export async function GET(req: Request): Promise<Response> {
  const auth = await authorizeApiRequest(req, 'read:trips');
  if (!auth.ok) return apiError(auth);

  const u = new URL(req.url);
  const rawLimit = Number(u.searchParams.get('limit'));
  const limit = Number.isFinite(rawLimit) && rawLimit > 0
    ? Math.min(Math.floor(rawLimit), MAX_LIMIT)
    : DEFAULT_LIMIT;
  const vehicleId = u.searchParams.get('vehicle_id');

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL as string;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY as string;
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

  /* Araçlar ÖNCE şirkete göre daraltılır; `vehicle_id` istemciden gelse bile
     başka bir şirketin aracına genisleyemez. */
  let q = admin
    .from('vehicle_trips')
    .select('id, vehicle_id, started_at, ended_at, distance_km, distance_source, '
          + 'fuel_used_l, fuel_source, estimated_cost, cost_source, '
          + 'driver_attribution_status')
    .in('vehicle_id',
        (await admin.from('vehicles').select('id').eq('company_id', auth.companyId))
          .data?.map((v) => (v as { id: string }).id) ?? [])
    .order('started_at', { ascending: false })
    .limit(limit);

  if (vehicleId) q = q.eq('vehicle_id', vehicleId);

  const { data, error } = await q;
  if (error) {
    return apiError({ ok: false, status: 503, code: 'SERVICE_UNAVAILABLE',
      message: 'API su anda hizmet veremiyor.' });
  }

  return apiOk({ data: data ?? [], limit }, auth);
}
