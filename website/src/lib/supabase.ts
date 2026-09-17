import { getSupabaseBrowserClient, isSupabaseConfigured } from './supabaseBrowser';

export { isSupabaseConfigured };
export const supabaseBrowser = isSupabaseConfigured ? getSupabaseBrowserClient() : null;

/**
 * PWA OTURUMU — TEK OKUMA NOKTASI.
 *
 * ── ÜRÜN KARARI (kullanıcı, F1 · 2026-09-17) ───────────────────────────────
 * Arabam Cebimde artık anonim-first DEĞİLDİR: normal kullanım **Google ile
 * giriş** üzerinden başlar. Gerekçe, F0'da ölçülen kalıcı veri riskidir —
 * anonim `auth.uid()` YALNIZ bu cihazın tarayıcı deposunda yaşar; kullanıcı
 * telefonu değiştirdiğinde veya depo temizlendiğinde araç sahipliği
 * (`vehicles.owner_id`) KURTARILAMAZ hâle geliyordu.
 *
 * ── BU FONKSİYONUN YENİ SÖZLEŞMESİ ─────────────────────────────────────────
 * Artık oturum AÇMAZ; yalnızca VAR OLAN kanonik oturumun erişim jetonunu
 * okur. Oturum yoksa `null` döner ve çağıran dürüstçe "giriş gerekli" der.
 * Görünmez anonim oturum AÇMA yolu KALDIRILMIŞTIR: bir yan yolun sessizce
 * kimlik üretmesi, giriş kapısını anlamsız kılar ve kullanıcıyı yine
 * kurtarılamaz bir uid'ye bağlardı (§6 tek otorite, §8 fail-closed).
 *
 * Oturum oluşturma TEK yerdedir: `lib/pwaAuth.ts` (Google giriş / kimlik
 * bağlama), kanonik auth mutation authority üzerinden.
 */
export async function ensurePwaSession(): Promise<string | null> {
  if (!supabaseBrowser) return null;

  try {
    const existing = (await supabaseBrowser.auth.getSession()).data.session;
    return existing?.access_token ?? null;
  } catch {
    return null;
  }
}
