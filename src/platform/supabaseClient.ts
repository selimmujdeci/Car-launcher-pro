/**
 * supabaseClient — Singleton Supabase istemcisi.
 *
 * Tüm platform servisleri bu modülden import eder; her biri kendi
 * createClient() çağrısı yapmaz.
 * VITE_SUPABASE_URL tanımlı değilse null döner (demo/offline mod).
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const SUPABASE_URL      = import.meta.env.VITE_SUPABASE_URL      as string | undefined;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

let _instance: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient | null {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return null;
  if (!_instance) {
    _instance = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: {
        headers: {
          // Capacitor runs on https://localhost — tell Supabase to allow it
          'X-Client-Info': 'capacitor-android',
        },
      },
    });
  }
  return _instance;
}

export { SUPABASE_URL, SUPABASE_ANON_KEY };

// ── Realtime subscription helper ──────────────────────────────────────────────

type PostgresEvent = 'INSERT' | 'UPDATE' | 'DELETE';

/**
 * Subscribe to Postgres row-level changes on a single table.
 *
 * Returns a cleanup function that removes the channel. Call it inside
 * every service's stop/dispose path to guarantee zero-leak behaviour.
 *
 * Usage:
 *   const stop = subscribeToTable<MyRow>(
 *     'my_table',
 *     ['INSERT', 'UPDATE'],
 *     (event, row) => { ... },
 *   );
 *   // later:
 *   stop();
 *
 * When Supabase is not configured (VITE_SUPABASE_URL absent), the function
 * returns a no-op cleanup immediately so callers never need to null-check.
 */
export function subscribeToTable<T extends Record<string, unknown>>(
  table:    string,
  events:   ReadonlyArray<PostgresEvent>,
  handler:  (event: PostgresEvent, row: T) => void,
): () => void {
  const supabase = getSupabaseClient();
  if (!supabase) return () => undefined;

  // Unique channel name prevents collisions when called multiple times
  const channelName = `${table}_cdc_${Date.now()}`;
  let ch = supabase.channel(channelName);

  for (const event of events) {
    ch = ch.on(
      'postgres_changes',
      { event, schema: 'public', table },
      (payload) => handler(event, payload.new as T),
    );
  }

  ch.subscribe();

  return () => { supabase.removeChannel(ch); };
}

// ── Semantic NLP — Edge Function ─────────────────────────────────────────────

/**
 * `process_intent` Supabase Edge Function'ını çağırır.
 *
 * Edge Function, sunucu tarafında AI çağrısı yaparak semantik niyet döndürür.
 * Bant genişliği tasarrufu + API key'i client'ta saklamama seçeneği sunar.
 *
 * Edge Function henüz deploy edilmemişse null döner (sessiz fallback).
 *
 * Beklenen Edge Function yanıt formatı: SemanticResult (semanticAiService.ts)
 */
export async function callProcessIntent(
  text:    string,
  context: Record<string, unknown> = {},
): Promise<Record<string, unknown> | null> {
  const supabase = getSupabaseClient();
  if (!supabase || !navigator.onLine) return null;

  try {
    const { data, error } = await supabase.functions.invoke('process_intent', {
      body: { text, context },
    });
    if (error || !data) return null;
    return data as Record<string, unknown>;
  } catch {
    return null;
  }
}

// ── Sentry Storage helpers ────────────────────────────────────────────────────

/**
 * Bir video Blob'unu `sentry_clips` bucket'ına yükler.
 *
 * Altyapı notu: Supabase Dashboard'da `sentry_clips` adında bir Storage bucket
 * oluşturulmuş ve ilgili RLS policy'lerin (authenticated INSERT) kurulmuş olması gerekir.
 *
 * @returns Public URL (başarılı) | null (başarısız ya da Supabase yapılandırılmamış)
 */
export async function uploadSentryClip(
  blob: Blob,
  path: string,
): Promise<string | null> {
  const supabase = getSupabaseClient();
  if (!supabase) return null;

  const { data, error } = await supabase.storage
    .from('sentry_clips')
    .upload(path, blob, { contentType: 'video/webm', upsert: false });

  if (error || !data) return null;

  const { data: urlData } = supabase.storage
    .from('sentry_clips')
    .getPublicUrl(data.path);

  return urlData?.publicUrl ?? null;
}

/**
 * `vehicle_events` tablosuna tek bir kayıt atar.
 *
 * Altyapı notu: Tablo şeması:
 *   id UUID PRIMARY KEY DEFAULT gen_random_uuid()
 *   vehicle_id TEXT
 *   type TEXT NOT NULL         -- 'sentry_alert', 'geofence_exit', vb.
 *   metadata JSONB
 *   created_at TIMESTAMPTZ DEFAULT now()
 *
 * Başarısız olursa sessizce yutulur (fire-and-forget).
 */
export async function insertVehicleEvent(
  vehicleId: string | null,
  type: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  const supabase = getSupabaseClient();
  if (!supabase) return;

  await supabase.from('vehicle_events').insert({
    vehicle_id:  vehicleId,
    type,
    metadata,
    created_at:  new Date().toISOString(),
  });
}
