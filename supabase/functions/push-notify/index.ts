/**
 * push-notify — Supabase Edge Function
 *
 * POST /functions/v1/push-notify
 * Body: { event, vehicleId, payload }
 *
 * npm:web-push handles:
 *   - VAPID JWT signing (ES256)
 *   - AES-128-GCM payload encryption (RFC 8291)
 *   - Correct Authorization header
 *
 * Env vars required:
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (injected by Supabase automatically)
 *   VAPID_PUBLIC_KEY   — base64url, from: npx web-push generate-vapid-keys
 *   VAPID_PRIVATE_KEY  — base64url, from: npx web-push generate-vapid-keys
 *   VAPID_EMAIL        — e.g. mailto:admin@cockpitos.com
 *   APP_URL            — e.g. https://arabamcebimde.app (for notification click URL)
 */

import { serve }        from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import webpush          from 'npm:web-push@3.6.7';

/* ── Types ───────────────────────────────────────────────────── */

type PushEvent =
  | 'command_completed'
  | 'command_failed'
  | 'alarm_triggered'
  | 'geofence_breach'
  | 'vehicle_offline';

interface RequestBody {
  event:     PushEvent;
  vehicleId: string;
  payload:   Record<string, unknown>;
}

interface PushPayload {
  title:    string;
  body:     string;
  icon:     string;
  badge:    string;
  tag:      string;
  url:      string;
  urgent:   boolean;
}

/* ── Notification content factory ───────────────────────────── */

function buildPayload(event: PushEvent, data: Record<string, unknown>): PushPayload {
  const plate   = String(data.plate ?? data.vehicle_name ?? 'Araç');
  const appUrl  = Deno.env.get('APP_URL') ?? '';

  switch (event) {
    case 'command_completed':
      return {
        title:  `✅ ${String(data.command_label ?? 'Komut')} tamamlandı`,
        body:   `${plate} — ${String(data.duration_ms ?? '')}ms'de onaylandı`,
        icon:   `${appUrl}/icons/icon-192.svg`,
        badge:  `${appUrl}/icons/badge-72.svg`,
        tag:    `cmd-ok-${String(data.command_id ?? Date.now())}`,
        url:    `${appUrl}/kumanda`,
        urgent: false,
      };
    case 'command_failed':
      return {
        title:  `❌ Komut başarısız`,
        body:   `${plate} — ${String(data.error_reason ?? 'Araç yanıt vermedi')}`,
        icon:   `${appUrl}/icons/icon-192.svg`,
        badge:  `${appUrl}/icons/badge-72.svg`,
        tag:    `cmd-fail-${String(data.command_id ?? Date.now())}`,
        url:    `${appUrl}/kumanda`,
        urgent: false,
      };
    case 'alarm_triggered':
      return {
        title:  `🚨 Alarm devreye girdi!`,
        body:   `${plate} alarmı çalıyor`,
        icon:   `${appUrl}/icons/icon-192.svg`,
        badge:  `${appUrl}/icons/badge-72.svg`,
        tag:    `alarm-${String(data.vehicleId ?? '')}`,
        url:    `${appUrl}/dashboard`,
        urgent: true,
      };
    case 'geofence_breach':
      return {
        title:  `📍 Bölge ihlali`,
        body:   `${plate} — ${String(data.zone_name ?? 'tanımlı bölge')} sınırı aşıldı`,
        icon:   `${appUrl}/icons/icon-192.svg`,
        badge:  `${appUrl}/icons/badge-72.svg`,
        tag:    `geo-${String(data.vehicleId ?? '')}`,
        url:    `${appUrl}/dashboard`,
        urgent: false,
      };
    case 'vehicle_offline':
      return {
        title:  `📡 Araç bağlantısı kesildi`,
        body:   `${plate} çevrimdışı`,
        icon:   `${appUrl}/icons/icon-192.svg`,
        badge:  `${appUrl}/icons/badge-72.svg`,
        tag:    `offline-${String(data.vehicleId ?? '')}`,
        url:    `${appUrl}/dashboard`,
        urgent: false,
      };
  }
}

/* ── Main handler ────────────────────────────────────────────── */

serve(async (req: Request): Promise<Response> => {
  const corsHeaders = {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': '*',
  };

  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    // ── 1. Parse & validate body ──────────────────────────────
    const body = (await req.json()) as RequestBody;
    const { event, vehicleId, payload = {} } = body;

    if (!event || !vehicleId) {
      return new Response(
        JSON.stringify({ error: 'event ve vehicleId zorunlu' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // ── 2. VAPID config ───────────────────────────────────────
    const vapidPublic  = Deno.env.get('VAPID_PUBLIC_KEY');
    const vapidPrivate = Deno.env.get('VAPID_PRIVATE_KEY');
    const vapidEmail   = Deno.env.get('VAPID_EMAIL') ?? 'mailto:admin@cockpitos.com';

    if (!vapidPublic || !vapidPrivate) {
      console.error('[push-notify] VAPID keys missing');
      return new Response(
        JSON.stringify({ error: 'VAPID yapılandırması eksik' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    webpush.setVapidDetails(vapidEmail, vapidPublic, vapidPrivate);

    // ── 3. Supabase: bağlı kullanıcıları bul ─────────────────
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const { data: vehicleUsers, error: vuErr } = await supabase
      .from('vehicle_users')
      .select('user_id')
      .eq('vehicle_id', vehicleId);

    if (vuErr) {
      console.error('[push-notify] vehicle_users sorgusu hatası:', vuErr.message);
    }

    if (!vehicleUsers?.length) {
      return new Response(
        JSON.stringify({ sent: 0, reason: 'no linked users' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const userIds = vehicleUsers.map((u: { user_id: string }) => u.user_id);

    // ── 4. Push subscriptions'ları çek ───────────────────────
    const { data: subs, error: subErr } = await supabase
      .from('push_subscriptions')
      .select('id, endpoint, subscription')
      .in('user_id', userIds);

    if (subErr) {
      console.error('[push-notify] push_subscriptions sorgusu hatası:', subErr.message);
    }

    if (!subs?.length) {
      return new Response(
        JSON.stringify({ sent: 0, reason: 'no subscriptions' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // ── 5. Push gönder ────────────────────────────────────────
    const pushPayload = buildPayload(event, { ...payload, vehicleId });
    const message     = JSON.stringify(pushPayload);

    let   sent    = 0;
    const expired: string[] = [];

    await Promise.allSettled(
      subs.map(async (row: { id: string; endpoint: string; subscription: webpush.PushSubscription }) => {
        try {
          const sub: webpush.PushSubscription = typeof row.subscription === 'string'
            ? JSON.parse(row.subscription)
            : row.subscription;

          const result = await webpush.sendNotification(sub, message, {
            TTL: 86_400, // 24 saat
            urgency: pushPayload.urgent ? 'high' : 'normal',
          });

          if (result.statusCode >= 200 && result.statusCode < 300) {
            sent++;
          } else if (result.statusCode === 410 || result.statusCode === 404) {
            // Subscription expired
            expired.push(row.id);
          } else {
            console.warn('[push-notify] Unexpected status:', result.statusCode, row.endpoint);
          }
        } catch (err: unknown) {
          const statusCode = (err as { statusCode?: number }).statusCode;
          if (statusCode === 410 || statusCode === 404) {
            expired.push(row.id);
          } else {
            console.error('[push-notify] sendNotification hatası:', err);
          }
        }
      }),
    );

    // ── 6. Süresi dolmuş subscription'ları temizle ───────────
    if (expired.length > 0) {
      await supabase
        .from('push_subscriptions')
        .delete()
        .in('id', expired);
      console.log(`[push-notify] ${expired.length} süresi dolmuş subscription temizlendi`);
    }

    console.log(`[push-notify] ${event} → ${sent}/${subs.length} gönderildi`);

    return new Response(
      JSON.stringify({ sent, total: subs.length, expired: expired.length }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    console.error('[push-notify] Beklenmeyen hata:', err);
    return new Response(
      JSON.stringify({ error: String(err) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
