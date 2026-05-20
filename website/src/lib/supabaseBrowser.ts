import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url     = process.env.NEXT_PUBLIC_SUPABASE_URL     ?? '';
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';

export const isSupabaseConfigured = Boolean(url && anonKey);

let browserClient: SupabaseClient | null = null;

/** Cookie helpers — session middleware'in okuyabilmesi için cookie'ye yazar */
const cookieStorage = {
  getItem(key: string): string | null {
    if (typeof document === 'undefined') return null;
    const match = document.cookie.split('; ').find((c) => c.startsWith(key + '='));
    return match ? decodeURIComponent(match.slice(key.length + 1)) : null;
  },
  setItem(key: string, value: string): void {
    if (typeof document === 'undefined') return;
    document.cookie = `${key}=${encodeURIComponent(value)};path=/;max-age=604800;SameSite=Lax;Secure`;
  },
  removeItem(key: string): void {
    if (typeof document === 'undefined') return;
    document.cookie = `${key}=;path=/;max-age=0;SameSite=Lax`;
  },
};

export function getSupabaseBrowserClient(): SupabaseClient | null {
  if (!isSupabaseConfigured) return null;
  if (typeof window === 'undefined') return null;

  if (!browserClient) {
    browserClient = createClient(url, anonKey, {
      auth: {
        storage:          cookieStorage,   // session cookie'e yazar → middleware okur
        persistSession:   true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    });
  }

  return browserClient;
}
