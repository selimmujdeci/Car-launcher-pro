import { createBrowserClient } from '@supabase/ssr'

const supabaseUrl  = import.meta.env.VITE_SUPABASE_URL  as string
const supabaseAnon = import.meta.env.VITE_SUPABASE_ANON_KEY as string

if (!supabaseUrl || !supabaseAnon) {
  throw new Error('VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY must be set')
}

// @supabase/ssr createBrowserClient → session'ı COOKIE'ye (chunked base64) yazar;
// website (carospro.com, aynı Supabase projesi) BİREBİR aynı formatı kullanır.
// Böylece admin SPA carospro.com/admin proxy'sinden açıldığında website'in oturum
// cookie'sini (same-origin) okur → AYNI hesap, ikinci login YOK. Standalone
// (car-launcher-pro.vercel.app) login de aynı cookie'yi kendi origin'ine yazar →
// orada da çalışır. ESKİ createClient localStorage'a yazıyordu → website cookie
// oturumunu göremiyor, proxy'de boş sayfa/login veriyordu.
export const supabase = createBrowserClient(supabaseUrl, supabaseAnon)
