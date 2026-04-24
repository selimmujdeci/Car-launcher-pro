import { createClient, SupabaseClient } from '@supabase/supabase-js';

const url  = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(url && anon);

// Browser client — safe to import in client components
// Returns null when Supabase is not configured (demo/mock mode)
export const supabaseBrowser: SupabaseClient | null = isSupabaseConfigured
  ? createClient(url!, anon!)
  : null;
