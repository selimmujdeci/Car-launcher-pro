import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';

const url     = process.env.NEXT_PUBLIC_SUPABASE_URL     ?? '';
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';

export const isSupabaseConfigured = Boolean(url && anonKey);

let browserClient: SupabaseClient | null = null;

/**
 * Tarayıcı Supabase client'ı.
 *
 * @supabase/ssr'in createBrowserClient'ı session'ı cookie'ye, server
 * (createServerClient) ve middleware ile BİREBİR aynı formatta (chunked,
 * base64) yazar. Böylece e-posta/şifre ile giriş yapıldığında middleware
 * session'ı okuyabilir ve /dashboard'a yönlendirme döngüye girmez.
 *
 * NOT: Daha önce supabase-js + özel cookieStorage kullanılıyordu; o JSON
 * formatını @supabase/ssr çözemediği için middleware getUser() null dönüyor
 * ve giriş başarılı olmasına rağmen tekrar /login'e atıyordu.
 */
export function getSupabaseBrowserClient(): SupabaseClient | null {
  if (!isSupabaseConfigured) return null;
  if (typeof window === 'undefined') return null;

  if (!browserClient) {
    browserClient = createBrowserClient(url, anonKey);
  }

  return browserClient;
}
