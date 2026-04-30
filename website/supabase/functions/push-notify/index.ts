/**
 * push-notify — FCM data-only push gönderici Edge Function.
 *
 * Araç push aldığında CommandListener'ı tetikler (Push-to-Wake).
 * Görünür bildirim GÖNDERME — sadece data payload.
 *
 * Çağrı: POST /functions/v1/push-notify
 * Body: { event, vehicleId, payload? }
 */

import { createClient } from 'jsr:@supabase/supabase-js@2';

const SUPABASE_URL     = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const FCM_SERVER_KEY   = Deno.env.get('FCM_SERVER_KEY') ?? '';      // Firebase Server Key
const FCM_PROJECT_ID   = Deno.env.get('FCM_PROJECT_ID') ?? '';      // Firebase Project ID

interface PushBody {
  event:      string;
  vehicleId:  string;
  payload?:   Record<string, unknown>;
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });

  // Dahili servis auth: service_role key veya anon key ile çağrılabilir
  const auth = req.headers.get('Authorization') ?? '';
  if (!auth.includes(SERVICE_ROLE_KEY) && !auth.startsWith('Bearer ')) {
    return new Response('Unauthorized', { status: 401 });
  }

  let body: PushBody;
  try {
    body = await req.json() as PushBody;
  } catch {
    return new Response('Bad Request', { status: 400 });
  }

  const { event, vehicleId, payload = {} } = body;
  if (!vehicleId) return new Response('vehicleId required', { status: 400 });

  if (!FCM_SERVER_KEY || !FCM_PROJECT_ID) {
    console.warn('[push-notify] FCM_SERVER_KEY veya FCM_PROJECT_ID eksik — push atlandı');
    return new Response(JSON.stringify({ ok: true, skipped: true }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  }

  // Araç FCM token'larını al
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const { data: tokens, error } = await supabase
    .from('vehicle_push_tokens')
    .select('fcm_token, platform')
    .eq('vehicle_id', vehicleId);

  if (error || !tokens?.length) {
    console.log('[push-notify] Token bulunamadı veya hata:', error?.message);
    return new Response(JSON.stringify({ ok: true, sent: 0 }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  }

  // Data-only FCM push (FCM HTTP v1)
  const results = await Promise.allSettled(
    tokens.map(async ({ fcm_token }) => {
      const fcmPayload = {
        message: {
          token: fcm_token,
          // data-only: title/body YOK — arka planda sessiz çalışır
          data: {
            event,
            vehicle_id: vehicleId,
            payload:    JSON.stringify(payload),
            ts:         Date.now().toString(),
          },
          android: {
            priority: 'high',           // Doze mode'u atla
            direct_boot_ok: true,
          },
        },
      };

      const res = await fetch(
        `https://fcm.googleapis.com/v1/projects/${FCM_PROJECT_ID}/messages:send`,
        {
          method:  'POST',
          headers: {
            'Content-Type':  'application/json',
            'Authorization': `Bearer ${FCM_SERVER_KEY}`,
          },
          body: JSON.stringify(fcmPayload),
        },
      );

      if (!res.ok) {
        const err = await res.text();
        throw new Error(`FCM hata: ${err}`);
      }
      return res.json();
    }),
  );

  const sent   = results.filter((r) => r.status === 'fulfilled').length;
  const failed = results.filter((r) => r.status === 'rejected').length;

  console.log(`[push-notify] ${sent} gönderildi, ${failed} başarısız — ${event}@${vehicleId}`);

  return new Response(
    JSON.stringify({ ok: true, sent, failed }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
});
