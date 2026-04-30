/**
 * retention-manager — Veri saklama politikası Edge Function.
 *
 * Supabase Cron veya dahili servis tarafından çağrılır.
 * Dışarıdan erişimi Authorization header ile kısıtlar.
 *
 * Çağrı: POST /functions/v1/retention-manager
 * Header: Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>
 */

import { createClient } from 'jsr:@supabase/supabase-js@2';

const SUPABASE_URL      = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

Deno.serve(async (req: Request) => {
  // Sadece POST kabul et
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  // Authorization kontrolü — sadece service_role veya cron token
  const authHeader = req.headers.get('Authorization') ?? '';
  const token = authHeader.replace('Bearer ', '').trim();
  if (token !== SERVICE_ROLE_KEY) {
    return new Response('Unauthorized', { status: 401 });
  }

  try {
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    const { data, error } = await supabase.rpc('cleanup_old_telemetry');
    if (error) throw error;

    const result = data as {
      deleted_locations: number;
      deleted_events:    number;
      deleted_commands:  number;
      deleted_logs:      number;
      ran_at:            string;
    };

    console.log('[retention-manager] Temizlik tamamlandı:', result);

    return new Response(JSON.stringify({ ok: true, ...result }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Bilinmeyen hata';
    console.error('[retention-manager] Hata:', message);
    return new Response(JSON.stringify({ ok: false, error: message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});
