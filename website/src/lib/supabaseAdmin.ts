import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// SERVICE ROLE client — NEVER import in client components or expose to browser.
// Lazy-init: only created when env vars are present (avoids build-time crash).

let _instance: SupabaseClient | null = null;

function getAdmin(): SupabaseClient {
  if (_instance) return _instance;
  const url  = process.env.NEXT_PUBLIC_SUPABASE_URL  ?? '';
  const key  = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  if (!url || !key) {
    throw new Error('Supabase admin env vars not set (NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)');
  }
  _instance = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return _instance;
}

// Proxy object — property access triggers lazy init only at call time, not import time.
export const supabaseAdmin = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    return Reflect.get(getAdmin(), prop);
  },
});
