/**
 * pwaAuth — ARABAM CEBİMDE OTURUM KAPISI (F1).
 *
 * ── ÜRÜN KARARI ──────────────────────────────────────────────────────────
 * Normal kullanım Google ile girişle başlar. Sonraki açılışlarda kullanıcıya
 * TEKRAR giriş sorulmaz: kanonik Supabase oturumu (cookie, `@supabase/ssr`)
 * restore/refresh edilir. Tekrar kimlik doğrulama yalnız açık çıkış, gerçekten
 * geçersiz oturum veya güvenlik gereği istenir.
 *
 * ── İKİNCİ OTORİTE YOK (§6) ──────────────────────────────────────────────
 * Burada token saklanmaz, ikinci auth store/persistence kurulmaz. Oturumun
 * sahibi Supabase'in kendi mekanizmasıdır; bu modül yalnız onu OKUR ve
 * yazımları kanonik auth-mutation authority'sine (`canonicalAuthMutations`)
 * devreder. Çıkış ise kanonik hesap temizliği (`requestCanonicalLogout`)
 * üzerinden gider — ikinci cleanup authority kurulmaz.
 *
 * ── ANONİM → GOOGLE: SAHİPLİĞİ KAYBETME (§8 fail-closed) ─────────────────
 * Cihazda hâlâ eski bir ANONİM oturum varsa, Google'a `signInWithOAuth` ile
 * girmek YENİ bir `auth.uid()` üretir ve o anonim uid'ye bağlı araçlar
 * (`vehicles.owner_id`, `vehicle_pairings`, yakıt/servis kayıtları) YETİM
 * kalır. Bu yüzden anonim oturum varken TEK izinli yol `linkIdentity`dir:
 * istek mevcut oturumun JWT'siyle `/user/identities/authorize` uçuna gider
 * (auth-js 2.110 kaynağıyla doğrulandı) ve kimliği MEVCUT uid'ye ekler.
 *
 * Bağlama başarısız olursa (ör. `manual_linking_disabled`,
 * `identity_already_exists`) SESSİZCE yeni hesap AÇILMAZ: dürüst hata
 * döndürülür, anonim oturum ve verisi YERİNDE kalır. Körlemesine
 * client-side ownership UPDATE'i YAPILMAZ.
 */

import type { Session, SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseBrowserClient } from '@/lib/supabaseBrowser';
import {
  canonicalLinkIdentity,
  canonicalSignInWithOAuth,
} from '@/security/accountCleanup/canonicalAuthMutations';

/** PWA açılış durumu — login ekranını "bir kare" gösterip kaybetmeyi önler. */
export type PwaAuthPhase =
  | 'BOOTING'
  | 'SIGNED_OUT'
  | 'AUTHENTICATED'
  | 'AUTH_ERROR';

export type PwaAuthState = Readonly<{
  phase: PwaAuthPhase;
  userId: string | null;
  /** Oturum eski anonim kimlikse `true` — Google'a BAĞLAMA yolu gerekir. */
  isAnonymous: boolean;
}>;

export const BOOTING_AUTH_STATE: PwaAuthState = Object.freeze({
  phase: 'BOOTING' as const,
  userId: null,
  isAnonymous: false,
});

/** Google girişinin hangi yoldan yapılacağı — SAF karar. */
export type GoogleEntryMode = 'LINK_IDENTITY' | 'FRESH_SIGN_IN';

export type GoogleSignInResult =
  | { ok: true; mode: GoogleEntryMode }
  | { ok: false; code: GoogleSignInFailureCode };

export type GoogleSignInFailureCode =
  | 'SUPABASE_UNAVAILABLE'
  | 'MANUAL_LINKING_DISABLED'
  | 'IDENTITY_ALREADY_LINKED'
  | 'LINK_FAILED'
  | 'SIGN_IN_FAILED';

/** OAuth dönüşünün KANONİK hedefi — filo paneline/boş köke düşülmez. */
export const PWA_HOME_PATH = '/kumanda';
export const PWA_OAUTH_CALLBACK_PATH = '/auth/callback';

/**
 * Oturumu ürün durumuna çevirir — SAF.
 *
 * Anonim oturum `AUTHENTICATED` sayılmaz: F1'de anonim kimlik normal giriş
 * yolu DEĞİLDİR, kullanıcı Google'a bağlanmalıdır. Ama `userId` korunur;
 * giriş ekranı bu sayede "mevcut araçların taşınacak" bilgisini verebilir ve
 * bağlama yolu (`LINK_IDENTITY`) seçilebilir.
 */
export function classifyPwaSession(session: Session | null): PwaAuthState {
  const user = session?.user ?? null;
  if (!user) {
    return Object.freeze({ phase: 'SIGNED_OUT' as const, userId: null, isAnonymous: false });
  }
  const isAnonymous = user.is_anonymous === true;
  return Object.freeze({
    phase: isAnonymous ? ('SIGNED_OUT' as const) : ('AUTHENTICATED' as const),
    userId: user.id,
    isAnonymous,
  });
}

/**
 * Kanonik oturum gözlemcisinin çıktısını açılış fazına çevirir — SAF.
 *
 * SIRA PAZARLIKSIZ: oturum daha bilinmiyorken (`loading`) giriş ekranı
 * GÖSTERİLMEZ. Eskiden bu tür kapılar önce "giriş yok" varsayıp bir kare
 * login gösteriyor, session gelince kayboluyordu; kullanıcı her açılışta
 * giriş ekranı "flaşı" görüyordu.
 */
export function resolvePwaAuthPhase(input: {
  loading: boolean;
  authError: boolean;
  userId: string | null;
  isAnonymous: boolean;
}): PwaAuthPhase {
  if (input.loading) return 'BOOTING';
  if (input.authError) return 'AUTH_ERROR';
  /* Anonim kimlik F1'de "giriş yapılmış" DEĞİLDİR — Google'a bağlanmalıdır. */
  if (!input.userId || input.isAnonymous) return 'SIGNED_OUT';
  return 'AUTHENTICATED';
}

/**
 * Google'a hangi yoldan girileceği — SAF.
 *
 * Anonim oturum varsa sahiplik korunmalıdır → `LINK_IDENTITY`. Aksi hâlde
 * temiz giriş. Bu ayrım ÜRÜNÜN veri kaybetmeme garantisidir.
 */
export function chooseGoogleEntryMode(session: Session | null): GoogleEntryMode {
  return session?.user?.is_anonymous === true ? 'LINK_IDENTITY' : 'FRESH_SIGN_IN';
}

/** OAuth dönüş adresi — her zaman Arabam Cebimde yüzeyine döner. */
export function buildPwaOAuthRedirectUrl(origin: string): string {
  return `${origin}${PWA_OAUTH_CALLBACK_PATH}?next=${encodeURIComponent(PWA_HOME_PATH)}`;
}

/** Dönüş hedefi Arabam Cebimde yüzeyi mi? (filo paneli yolundan ayırır) */
export function isPwaNextTarget(next: string): boolean {
  return next === PWA_HOME_PATH || next.startsWith(`${PWA_HOME_PATH}/`) ||
    next.startsWith(`${PWA_HOME_PATH}?`);
}

/**
 * OAuth dönüşü BAŞARISIZSA nereye gidilir — SAF.
 *
 * Arabam Cebimde kullanıcısı filo panelinin `/login` sayfasına DÜŞÜRÜLMEZ:
 * orada ne markası ne de Google düğmesi vardır, kullanıcı ürünü kaybeder.
 * Kendi giriş ekranına döner ve hatayı orada görür.
 */
export function resolveAuthFailureRedirect(next: string, reason: string): string {
  return isPwaNextTarget(next)
    ? `${PWA_HOME_PATH}?auth_error=${encodeURIComponent(reason)}`
    : `/login?error=${encodeURIComponent(reason)}`;
}

/** Supabase hata kodunu kullanıcıya gösterilecek TEK tip gerekçeye indirger. */
export function classifyLinkFailure(code: string | undefined): GoogleSignInFailureCode {
  if (code === 'manual_linking_disabled') return 'MANUAL_LINKING_DISABLED';
  if (code === 'identity_already_exists' || code === 'user_already_exists') {
    return 'IDENTITY_ALREADY_LINKED';
  }
  return 'LINK_FAILED';
}

/** Kullanıcıya gösterilecek Türkçe cümle — ham OAuth hatası EKRANA BASILMAZ. */
export function describeGoogleSignInFailure(code: GoogleSignInFailureCode): string {
  switch (code) {
    case 'SUPABASE_UNAVAILABLE':
      return 'Servise şu anda ulaşılamıyor. Lütfen daha sonra tekrar deneyin.';
    case 'MANUAL_LINKING_DISABLED':
      return 'Google hesabı bağlama şu anda kapalı. Bu cihazdaki araçlarınız yerinde duruyor; lütfen daha sonra tekrar deneyin.';
    case 'IDENTITY_ALREADY_LINKED':
      return 'Bu Google hesabı başka bir kullanıcıya bağlı. Bu cihazdaki araçlarınız korunuyor — farklı bir Google hesabı deneyin.';
    case 'LINK_FAILED':
      return 'Google hesabı bağlanamadı. Bu cihazdaki araçlarınız korunuyor, tekrar deneyebilirsiniz.';
    case 'SIGN_IN_FAILED':
    default:
      return 'Google ile giriş tamamlanamadı. Lütfen tekrar deneyin.';
  }
}

/** Mevcut kanonik oturumu okur; hiçbir oturum AÇMAZ. */
export async function readPwaAuthState(
  client: SupabaseClient | null = getSupabaseBrowserClient(),
): Promise<PwaAuthState> {
  if (!client) {
    return Object.freeze({ phase: 'AUTH_ERROR' as const, userId: null, isAnonymous: false });
  }
  try {
    const { data, error } = await client.auth.getSession();
    if (error) {
      return Object.freeze({ phase: 'AUTH_ERROR' as const, userId: null, isAnonymous: false });
    }
    return classifyPwaSession(data.session);
  } catch {
    return Object.freeze({ phase: 'AUTH_ERROR' as const, userId: null, isAnonymous: false });
  }
}

/**
 * Google girişini başlatır (tarayıcı Google'a yönlendirilir).
 *
 * Anonim oturumda ASLA `signInWithOAuth` çağrılmaz — bkz. dosya başlığı.
 */
export async function startGoogleSignIn(
  origin: string,
  client: SupabaseClient | null = getSupabaseBrowserClient(),
): Promise<GoogleSignInResult> {
  if (!client) return { ok: false, code: 'SUPABASE_UNAVAILABLE' };

  let session: Session | null = null;
  try {
    session = (await client.auth.getSession()).data.session ?? null;
  } catch {
    /* Oturum okunamadıysa kimlik bağlama kararı verilemez. Anonim veriyi
       riske atmamak için temiz girişe DÜŞÜLMEZ. */
    return { ok: false, code: 'SIGN_IN_FAILED' };
  }

  const mode = chooseGoogleEntryMode(session);
  const redirectTo = buildPwaOAuthRedirectUrl(origin);

  if (mode === 'LINK_IDENTITY') {
    const { error } = await canonicalLinkIdentity(client, {
      provider: 'google',
      options: { redirectTo },
    });
    if (error) {
      return { ok: false, code: classifyLinkFailure(error.code) };
    }
    return { ok: true, mode };
  }

  const { error } = await canonicalSignInWithOAuth(client, {
    provider: 'google',
    options: { redirectTo },
  });
  if (error) return { ok: false, code: 'SIGN_IN_FAILED' };
  return { ok: true, mode };
}
