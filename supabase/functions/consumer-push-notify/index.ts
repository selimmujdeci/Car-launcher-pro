/**
 * consumer-push-notify — TÜKETİCİ (Arabam Cebimde) Web Push göndericisi.
 *
 * ── İNSANA BİLDİRİM ≠ ARACI UYANDIRMA ────────────────────────────────────
 * Bu fonksiyon İNSANA görünür bildirim gönderir (Web Push / VAPID) ve hedefi
 * DAİMA tüketici yüzeyidir (`/kumanda`).
 *
 * Aracı uyandıran (Push-to-Wake) fonksiyon AYRIDIR:
 *   `website/supabase/functions/push-notify` — FCM data-only,
 *   `vehicle_push_tokens` okur, görünür bildirim GÖNDERMEZ.
 *
 * ÖLÇÜLEN KUSUR (F5.1, 2026-09-18): İKİSİ de `push-notify` slug'ını
 * paylaşıyordu. Bir slug'a yalnız BİRİ deploy edilebildiği için production'da
 * FCM sürümü canlıydı ve tüketici Web Push yolu TAMAMEN ÖLÜYDÜ
 * (ölçüm: `GET /functions/v1/push-notify` → 405, yalnız FCM sürümünün method
 * kapısından çıkan yanıt). Slug'lar AYRILDI; artık deploy sırasında biri
 * diğerini EZEMEZ.
 *
 * Eski ad: `push-notify` (kök). Yeni ad: `consumer-push-notify`.
 *
 * ── Supabase Edge Function
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
import { authorizePushRequest } from './auth.ts';

/* ── Types ───────────────────────────────────────────────────── */

type PushEvent =
  | 'command_completed'
  | 'command_failed'
  | 'alarm_triggered'
  | 'geofence_breach'
  | 'vehicle_offline'
  | 'speed_alert';

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
        /* TÜKETİCİ fonksiyonu filo yüzeyine YÖNLENDİREMEZ: kullanıcı kendi
           ürününden çıkıp hiç kullanmadığı panele atılırdı (F5 saha kusuru).
           `sw.js` allowlist'i zaten reddeder; kaynakta da doğru olsun. */
        url:    `${appUrl}/kumanda`,
        urgent: true,
      };
    case 'geofence_breach':
      return {
        title:  `📍 Bölge ihlali`,
        body:   `${plate} — ${String(data.zone_name ?? 'tanımlı bölge')} sınırı aşıldı`,
        icon:   `${appUrl}/icons/icon-192.svg`,
        badge:  `${appUrl}/icons/badge-72.svg`,
        tag:    `geo-${String(data.vehicleId ?? '')}`,
        /* TÜKETİCİ fonksiyonu filo yüzeyine YÖNLENDİREMEZ: kullanıcı kendi
           ürününden çıkıp hiç kullanmadığı panele atılırdı (F5 saha kusuru).
           `sw.js` allowlist'i zaten reddeder; kaynakta da doğru olsun. */
        url:    `${appUrl}/kumanda`,
        urgent: false,
      };
    case 'speed_alert':
      /* Kullanıcının KENDİ belirlediği eşik aşıldı (yol hız limiti DEĞİL —
         o ayrı bir sistemdir ve burada iddia edilmez). Ölçülen hız ve eşik
         aracın bildirdiği değerlerdir; eksikse sayı UYDURULMAZ. */
      return {
        title:  `⚠️ Hız uyarısı`,
        body:   data.speed_kmh != null && data.threshold_kmh != null
          ? `${plate} — ${String(data.speed_kmh)} km/h (eşik ${String(data.threshold_kmh)} km/h)`
          : `${plate} — belirlediğiniz hız eşiği aşıldı`,
        icon:   `${appUrl}/icons/icon-192.svg`,
        badge:  `${appUrl}/icons/badge-72.svg`,
        // Tek etiket: aynı araç için üst üste bildirim yığılmaz, sonuncusu kalır.
        tag:    `speed-${String(data.vehicleId ?? '')}`,
        url:    `${appUrl}/kumanda`,
        urgent: true,
      };
    case 'vehicle_offline':
      return {
        title:  `📡 Araç bağlantısı kesildi`,
        body:   `${plate} çevrimdışı`,
        icon:   `${appUrl}/icons/icon-192.svg`,
        badge:  `${appUrl}/icons/badge-72.svg`,
        tag:    `offline-${String(data.vehicleId ?? '')}`,
        /* TÜKETİCİ fonksiyonu filo yüzeyine YÖNLENDİREMEZ: kullanıcı kendi
           ürününden çıkıp hiç kullanmadığı panele atılırdı (F5 saha kusuru).
           `sw.js` allowlist'i zaten reddeder; kaynakta da doğru olsun. */
        url:    `${appUrl}/kumanda`,
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

  // ── E1 fix: Fonksiyon-içi Authorization doğrulaması ───────────
  // push-notify yalnızca server/internal (service_role) tarafından çağrılabilir.
  // Auth header yok VEYA token != SERVICE_ROLE_KEY → 401. Gateway verify_jwt'ye
  // bağımlı kalmaz (config.toml bağımsız defense-in-depth). NOT: araç-tarafı
  // (commandListener.triggerPushNotify) service_role taşıyamaz → bildirim
  // tetikleme server-side'a taşınmalı (kalan iş; kritik komut akışını etkilemez).
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!authorizePushRequest(req.headers.get('Authorization'), serviceRoleKey)) {
    return new Response(
      JSON.stringify({ error: 'Unauthorized' }),
      { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
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
      console.error('[consumer-push-notify] VAPID keys missing');
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

    /* ── ALICILAR KANONİK İLİŞKİDEN ÇÖZÜLÜR ───────────────────────────────
     * ÖNCEDEN `vehicle_users` okunuyordu. O tablo canlıda MEVCUT ama araç↔
     * kullanıcı KANONİK otoritesi DEĞİL: production RLS'i `is_paired()`
     * üzerinden `vehicle_pairings`e, sahipliği de `vehicles.owner_id`e bakar
     * (`is_vehicle_owner()`). Tüketici eşleştirmesi (`pair_vehicle_by_code`)
     * `vehicle_pairings`e yazar → `vehicle_users` ile çözülen alıcı kümesi
     * gerçek kullanıcıları KAÇIRIRDI.
     *
     * ŞİRKET/FİLO ÜYELERİ BİLİNÇLİ OLARAK DIŞARIDA: burası tüketici ürünüdür.
     * Filo bildirimi ayrı bir üründür ve bu fonksiyondan gönderilmez (§12). */
    const recipientIds = new Set<string>();

    const { data: pairings, error: pairErr } = await supabase
      .from('vehicle_pairings')
      .select('user_id')
      .eq('vehicle_id', vehicleId);
    if (pairErr) {
      console.error('[consumer-push-notify] vehicle_pairings sorgusu hatası:', pairErr.message);
    }
    for (const row of pairings ?? []) {
      if (row?.user_id) recipientIds.add(row.user_id as string);
    }

    const { data: vehicleRow, error: vehErr } = await supabase
      .from('vehicles')
      .select('owner_id')
      .eq('id', vehicleId)
      .maybeSingle();
    if (vehErr) {
      console.error('[consumer-push-notify] vehicles sorgusu hatası:', vehErr.message);
    }
    if (vehicleRow?.owner_id) recipientIds.add(vehicleRow.owner_id as string);

    if (recipientIds.size === 0) {
      return new Response(
        JSON.stringify({ sent: 0, reason: 'no linked users' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const userIds = [...recipientIds];

    // ── 4. Push subscriptions'ları çek ───────────────────────
    const { data: subs, error: subErr } = await supabase
      .from('push_subscriptions')
      .select('id, endpoint, subscription')
      .in('user_id', userIds);

    if (subErr) {
      console.error('[consumer-push-notify] push_subscriptions sorgusu hatası:', subErr.message);
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
            console.warn('[consumer-push-notify] Unexpected status:', result.statusCode, row.endpoint);
          }
        } catch (err: unknown) {
          const statusCode = (err as { statusCode?: number }).statusCode;
          if (statusCode === 410 || statusCode === 404) {
            expired.push(row.id);
          } else {
            console.error('[consumer-push-notify] sendNotification hatası:', err);
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
      console.log(`[consumer-push-notify] ${expired.length} süresi dolmuş subscription temizlendi`);
    }

    console.log(`[consumer-push-notify] ${event} → ${sent}/${subs.length} gönderildi`);

    return new Response(
      JSON.stringify({ sent, total: subs.length, expired: expired.length }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    console.error('[consumer-push-notify] Beklenmeyen hata:', err);
    return new Response(
      JSON.stringify({ error: String(err) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
