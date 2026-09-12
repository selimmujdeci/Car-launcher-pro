import { getSupabaseBrowserClient, isSupabaseConfigured } from './supabaseBrowser';

export { isSupabaseConfigured };
export const supabaseBrowser = isSupabaseConfigured ? getSupabaseBrowserClient() : null;

/**
 * PWA OTURUMU — TEK GİRİŞ NOKTASI.
 *
 * ── ÜRÜN KARARI (kullanıcı, 2026-09-12) ────────────────────────────────────
 * *"PWA hiç giriş istememeli."* Araç eşleştirme ve komut gönderme, kullanıcıyı
 * bir giriş ekranına DÜŞÜRMEDEN çalışmalıdır.
 *
 * ── NEDEN "OTURUM YOK" ÇÖZÜMÜ DEĞİL ────────────────────────────────────────
 * Oturumu tamamen kaldırmak mümkün DEĞİLDİR: araç verisinin görünürlüğü RLS'te
 * `auth.uid()`e bağlıdır (`vehicles.owner_id = auth.uid()`), eşleştirme RPC'si
 * `pair_vehicle_to_user(p_code, p_user_id)` kullanıcı kimliği İSTER ve
 * `/api/vehicle/link` Bearer yoksa 401 döner. Oturumsuz bir yol açmak, kodu
 * bilen herkese aracı açardı — bu, daha önce 410 ile KAPATILAN güvenlik
 * açığının (ham `api_key` döndüren `/api/pwa/pair`) aynısı olurdu.
 *
 * ── ÇÖZÜM: GÖRÜNMEZ ANONİM OTURUM ──────────────────────────────────────────
 * Supabase anonim oturumu kullanıcıya HİÇBİR ŞEY sormaz ama gerçek bir
 * `auth.uid()` üretir. Böylece giriş ekranı KALKAR, güvenlik modeli (RLS,
 * sahiplik, bireysel araç limiti) OLDUĞU GİBİ kalır ve ham anahtar hiçbir
 * yerde dönmez. Kullanıcı ileride gerçek hesaba geçmek isterse Supabase
 * kimlik bağlama (`linkIdentity`) ile aynı uid yükseltilebilir.
 *
 * Sunucu tarafı gereksinim: projede "Anonymous sign-ins" AÇIK olmalıdır
 * (`supabase/config.toml` → `auth.enable_anonymous_sign_ins`).
 *
 * FAIL-SOFT: anonim oturum alınamazsa `null` döner — çağıran dürüstçe hata
 * gösterir, SAHTE bir başarı ÜRETİLMEZ.
 */
export async function ensurePwaSession(): Promise<string | null> {
  if (!supabaseBrowser) return null;

  try {
    const existing = (await supabaseBrowser.auth.getSession()).data.session;
    if (existing?.access_token) return existing.access_token;
  } catch { /* oturum okunamadı — anonim denenecek */ }

  try {
    const { data, error } = await supabaseBrowser.auth.signInAnonymously();
    if (error) return null;
    return data.session?.access_token ?? null;
  } catch {
    return null;
  }
}
