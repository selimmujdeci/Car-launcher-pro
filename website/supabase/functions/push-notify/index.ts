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

  let body: PushBody;
  try {
    body = await req.json() as PushBody;
  } catch {
    return new Response('Bad Request', { status: 400 });
  }

  const { event, vehicleId, payload = {} } = body;
  if (!vehicleId) return new Response('vehicleId required', { status: 400 });

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  // ── Auth (E1 fix) ────────────────────────────────────────────────────────────
  // ÖNCE: `auth.startsWith('Bearer ')` herhangi bir sahte "Bearer X" string'ini kabul
  // ediyordu (JWT doğrulaması YOK) → yetkisiz push-to-wake (DoS/batarya + C8/C2 saldırı yüzeyi).
  // ŞİMDİ: ya service_role tam-eşleşmesi (backend/cron) ya da GERÇEKTEN doğrulanmış JWT'ye
  // sahip + bu araca bağlı kullanıcı. service_role olmayan çağıran yalnız KENDİ aracını uyandırır.
  const token = (req.headers.get('Authorization') ?? '').replace('Bearer ', '').trim();
  if (!token) return new Response('Unauthorized', { status: 401 });

  if (token !== SERVICE_ROLE_KEY) {
    const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !user) return new Response('Unauthorized', { status: 401 });

    const { data: link } = await supabase
      .from('vehicle_users')
      .select('user_id')
      .eq('vehicle_id', vehicleId)
      .eq('user_id', user.id)
      .maybeSingle();
    if (!link) return new Response('Forbidden', { status: 403 });
  }

  if (!FCM_SERVER_KEY || !FCM_PROJECT_ID) {
    console.warn('[push-notify] FCM_SERVER_KEY veya FCM_PROJECT_ID eksik — push atlandı');
    return new Response(JSON.stringify({ ok: true, skipped: true }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  }

  // Araç FCM token'larını al

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
