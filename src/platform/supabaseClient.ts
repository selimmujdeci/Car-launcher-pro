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
    });
  }
  return _instance;
}

export { SUPABASE_URL, SUPABASE_ANON_KEY };
