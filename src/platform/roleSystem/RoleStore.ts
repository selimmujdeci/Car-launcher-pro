import { create }       from 'zustand';
import { persist }      from 'zustand/middleware';
import { createClient } from '@supabase/supabase-js';
import type { Role, Permission } from './types';
import {
  ROLE_PERMISSIONS,
  SUPER_ADMIN_ROLE_CLAIM,
  SUPER_ADMIN_EMAIL_ALLOWLIST,
} from './types';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../supabaseClient';
import { refreshGatewayAccess } from '../ai/gateway/aiGatewayAccessRuntime';

/* ══════════════════════════════════════════════════════════════════════════
 * YEREL KURTARMA DENEMESİ (MRI N-4) — DEEP-LINK CALLBACK BAĞLAMA
 *
 * ÖLÇÜLEN KUSUR: `carospro://auth/*` şeması manifest'te `autoVerify="false"` +
 * BROWSABLE'dır; yani bu intent'i HERHANGİ bir uygulama ya da sürücünün
 * ziyaret ettiği HERHANGİ bir web sayfası tetikleyebilir. `handleRecoveryUrl`
 * ise gelen callback'i BU CİHAZIN başlattığı bir kurtarmaya bağlamadan
 * doğrudan `setSession`/`verifyOtp`'a taşıyordu → saldırganın ürettiği bir
 * callback head-unit'in yönetici oturumunu saldırganın hesabına SABİTLEYEBİLİRDİ
 * (session fixation / forced login), hatta DOĞRULANMIŞ bir oturumu ezebiliyordu.
 *
 * KURULAN GÜVEN ZİNCİRİ:
 *   LOCAL LOGIN INTENT (resetPassword)
 *   → LOCALLY BOUND ATTEMPT (aşağıdaki kayıt)
 *   → EXPECTED CALLBACK (katı şema/host/path doğrulaması)
 *   → ONE-SHOT CONSUMPTION
 *   → CANONICAL SESSION AUTHORITY (Supabase)
 * Davetsiz / bayat / tekrar oynatılan callback: FAIL CLOSED.
 *
 * NEDEN KALICI: kurtarma bağlantısı e-postadan açıldığında Android uygulamayı
 * SOĞUK BAŞLATABİLİR. Deneme yalnız bellekte tutulsaydı meşru akış kırılırdı.
 * Kayıt SIR TAŞIMAZ — yalnız "bu cihaz kurtarma başlattı" damgası ve son
 * kullanma zamanıdır; token/verifier/e-posta SAKLANMAZ, LOGLANMAZ.
 *
 * KAPSAM: yalnız yönetici (super_admin) kurtarma akışı. Uzak kritik komut
 * PIN'i (migration 083) ve yerel valet PIN'i (Wave 12B) AYRI domainlerdir.
 * ══════════════════════════════════════════════════════════════════════════ */

const RECOVERY_ATTEMPT_KEY    = 'caros_admin_recovery_attempt_v1';
/** Kurtarma bağlantısının makul kullanım penceresi. */
const RECOVERY_ATTEMPT_TTL_MS = 30 * 60_000;

/** Beklenen callback kökeni — tam eşleşme (string `includes` ile KARAR VERİLMEZ). */
const RECOVERY_SCHEME = 'carospro:';
const RECOVERY_HOST   = 'auth';
const RECOVERY_PATH   = '/recovery';

/**
 * WAVE 17 · Callback'i cihaza bağlayan tek kullanımlık nonce.
 *
 * `redirectTo` içine konur, Supabase yönlendirmesiyle geri döner ve saklanan
 * özetle karşılaştırılır. Saldırgan bu değeri BİLEMEZ.
 */
const RECOVERY_NONCE_PARAM = 'state';
/** 16 bayt = 128 bit entropi. */
const RECOVERY_NONCE_BYTES = 16;

/**
 * Deneme kaydı.
 *
 * `nonceHash` (W-17): callback'in BU denemeye ait olduğunun kanıtı.
 * `idHash`    (W-16): oturum kurulduktan sonra kimlik doğrulaması.
 *
 * Ham nonce KALICI OLARAK SAKLANMAZ — yalnız özeti tutulur. E-posta düz metin
 * saklanmaz. Hiçbiri HİÇBİR YERDE LOGLANMAZ.
 */
interface RecoveryAttempt {
  id:        string;
  createdAt: number;
  idHash:    string;
  nonceHash: string;
}

/**
 * WAVE 17 · GÜVENLİK KRİTİK KRİPTO YETENEĞİ — FİİLEN SINANIR.
 *
 * Yalnız `typeof` bakmak YETMEZ: Supabase SDK'sının kendi yedekleri sessizce
 * güvensizdir ve tam olarak bu koşullarda devreye girer —
 *   · `generatePKCEVerifier()`  → `crypto` yoksa **Math.random** ile verifier
 *   · `generatePKCEChallenge()` → `crypto.subtle` yoksa challenge = verifier
 *     ve yöntem **plain** olur; yani sır ağda AÇIK gider.
 * Bu yüzden yetenek yoksa kurtarma başlatılmaz ve callback doğrulanmaz.
 * "Biraz daha az güvenli ama devam et" YOKTUR (fail-closed).
 */
async function recoveryCryptoAvailable(): Promise<boolean> {
  const c = globalThis.crypto;
  if (!c || typeof c.getRandomValues !== 'function') return false;
  if (!c.subtle || typeof c.subtle.digest !== 'function') return false;
  if (typeof TextEncoder === 'undefined') return false;
  try {
    c.getRandomValues(new Uint8Array(1));
    await c.subtle.digest('SHA-256', new Uint8Array(1));
    return true;
  } catch { return false; }
}

/** Kriptografik rastgele nonce. `Math.random` KULLANILMAZ. */
function generateRecoveryNonce(): string {
  const bytes = new Uint8Array(RECOVERY_NONCE_BYTES);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** SHA-256 → hex. Hesaplanamazsa `null` (çağıran fail-closed davranır). */
async function sha256Hex(value: string): Promise<string | null> {
  try {
    const buf = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
    return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
  } catch { return null; }
}

/** Kimlik özeti (normalize edilmiş e-posta). */
async function hashIdentity(email: string): Promise<string | null> {
  return sha256Hex(email.trim().toLowerCase());
}

/**
 * Uzunluk-sabit karşılaştırma. Değerler zaten özet olduğu için sızıntı riski
 * düşüktür; yine de erken çıkış yapmayız. Ayrı bir kripto katmanı yazılmaz.
 */
function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function readRecoveryAttempt(): RecoveryAttempt | null {
  try {
    const raw = localStorage.getItem(RECOVERY_ATTEMPT_KEY);
    if (!raw) return null;
    const a = JSON.parse(raw) as RecoveryAttempt;
    if (typeof a?.createdAt !== 'number') return null;
    if (Date.now() - a.createdAt > RECOVERY_ATTEMPT_TTL_MS) return null;  // süresi doldu
    return a;
  } catch { return null; }
}

/**
 * Kurtarma BU CİHAZDAN, BU HESAP için, BU NONCE ile başlatıldı.
 *
 * Kayıt kurulamazsa `false` döner — çağıran kurtarmayı başlatmaz. Sessizce
 * "kayıtsız devam" YOKTUR, çünkü o durumda callback kapısı zaten her şeyi
 * reddederdi ve kullanıcı sebebini bilemezdi.
 */
async function beginRecoveryAttempt(email: string, nonce: string): Promise<boolean> {
  const [idHash, nonceHash] = await Promise.all([hashIdentity(email), sha256Hex(nonce)]);
  if (!idHash || !nonceHash) return false;            // FAIL-CLOSED
  try {
    const id = (globalThis.crypto?.randomUUID?.() ?? generateRecoveryNonce());
    localStorage.setItem(
      RECOVERY_ATTEMPT_KEY,
      JSON.stringify({ id, createdAt: Date.now(), idHash, nonceHash } satisfies RecoveryAttempt),
    );
    return true;
  } catch { return false; }                            // depo yok → FAIL-CLOSED
}

function clearRecoveryAttempt(): void {
  try { localStorage.removeItem(RECOVERY_ATTEMPT_KEY); } catch { /* noop */ }
}

/**
 * TEK KULLANIMLIK tüketim: aktif ve süresi geçmemiş bir deneme varsa onu
 * SİLER ve KAYDI döner (kimlik bağı için `idHash` gerekir). Oturum değiştiren
 * çağrıdan ÖNCE yapılır ki uçuş hâlindeki bir tekrar oynatma da ikinci kez
 * geçemesin.
 */
function consumeRecoveryAttempt(): RecoveryAttempt | null {
  const a = readRecoveryAttempt();
  clearRecoveryAttempt();          // süresi dolmuş kayıt da temizlenir
  return a;
}

/**
 * WAVE 16 · KİMLİK BAĞI — callback sonucu kurulan oturum, denemeyi başlatan
 * hesaba mı ait?
 *
 * W-17: artık kapının TEK bağı değildir — nonce zaten callback'i bu denemeye,
 * PKCE ise kodu bu cihaza bağlar. Bu kontrol onların ÜSTÜNE gelen derinlik
 * savunmasıdır ve tek kusuru geç olmasıdır: kimlik ancak oturum kurulduktan
 * sonra okunabilir, uyuşmazsa oturum DERHAL kapatılır.
 *
 * W-17: özet hesaplanamazsa artık Wave 15 seviyesine DÜŞMEZ — REDDEDER.
 */
async function verifyRecoveryIdentity(
  client: { auth: { getUser: () => Promise<{ data: { user: { email?: string | null } | null } | null; error: unknown }> } },
  expectedHash: string,
): Promise<boolean> {
  if (!expectedHash) return false;             // bağ kurulamamış kayıt → FAIL-CLOSED
  try {
    const { data, error } = await client.auth.getUser();
    const email = data?.user?.email ?? '';
    if (error || !email) return false;         // kimlik okunamadı → FAIL-CLOSED
    const actual = await hashIdentity(email);
    return actual !== null && constantTimeEquals(actual, expectedHash);
  } catch { return false; }
}

/** Beklenen köken mi? Tam şema/host/path eşleşmesi; aksi hâlde `null`. */
function parseRecoveryCallback(url: string): URL | null {
  try {
    const u = new URL(url);
    if (u.protocol !== RECOVERY_SCHEME) return null;
    if (u.host     !== RECOVERY_HOST)   return null;
    if (u.pathname !== RECOVERY_PATH)   return null;
    return u;
  } catch { return null; }
}

// ── Admin Supabase Client (ayrı instance, persistSession: true) ───────────────

let _adminClient: ReturnType<typeof createClient> | null = null;

/** Admin Supabase client'ını döner. Sadece super_admin flow'u için kullanılır. */
export function getAdminClient() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return null;
  if (!_adminClient) {
    _adminClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        persistSession:    true,
        autoRefreshToken:  true,
        /**
         * WAVE 16 · İKİNCİ OTURUM OTORİTESİ KAPATILDI (eskiden `true`).
         *
         * `true` iken GoTrueClient, constructor içinde `window.location.href`i
         * ayrıştırıp `#access_token=...` görürse oturumu CLIENT YARATILIRKEN
         * kurar ve `persistSession` nedeniyle localStorage'a yazar. Bu yol
         * `handleRecoveryUrl` kapısından GEÇMEZ: Wave 15'in köken doğrulaması,
         * yerel deneme bağı ve tek-kullanım tüketimi devre dışı kalır.
         *
         * Bu üründe otomatik yakalamanın MEŞRU BİR KULLANIMI YOKTUR:
         * `resetPasswordForEmail` yalnız `carospro://auth/recovery` adresine
         * döner, o da `appUrlOpen` ile gelir ve `window.location`u değiştirmez.
         * Yani bayrak yalnız saldırı yüzeyi üretiyordu.
         *
         * Kurtarmanın tek kanonik sahibi: `handleRecoveryUrl`.
         * Kilit: `src/__tests__/urlSessionAuthorityW16.test.ts`
         */
        detectSessionInUrl: false,
        /**
         * WAVE 17 · PKCE — kurtarma kodunu BU CİHAZA kriptografik olarak bağlar.
         *
         * `implicit` (SDK varsayılanı) akışta kurtarma bağlantısı doğrudan
         * oturum malzemesi taşır: onu ELE GEÇİREN HERKES kullanabilir.
         * `pkce` akışta `resetPasswordForEmail`, cihazda bir `code_verifier`
         * saklar ve sunucuya yalnız S256 özetini gönderir; callback ise yalnız
         * kısa ömürlü bir `code` taşır. `exchangeCodeForSession` kodu o
         * verifier ile takas eder → başka bir cihazın ürettiği kod SUNUCUDA
         * reddedilir. Verifier hem başarı hem hata yolunda silinir, yani
         * tek-kullanım SDK seviyesinde de zorlanır.
         *
         * NOT: `detectSessionInUrl` KAPALI kalır (W-16). Kod takası yalnız
         * `handleRecoveryUrl` tarafından, açıkça yapılır.
         */
        flowType: 'pkce',
      },
      global: { headers: { 'X-Client-Info': 'capacitor-android-admin' } },
    });

    /**
     * WAVE 16 · `adminAuthState`'in İKİNCİ YAZARI KALDIRILDI.
     *
     * Burada bir `onAuthStateChange` dinleyicisi vardı ve `PASSWORD_RECOVERY`
     * olayında `adminAuthState: 'recovery'` yazıyordu. İki kusuru vardı:
     *
     * 1) VARLIK NEDENİ ORTADAN KALKTI. Olayın kapıdan bağımsız tetiklendiği
     *    tek yer `_initialize()` içindeki URL algılamasıydı
     *    (GoTrueClient.js:410) — yukarıda kapatıldı. Kalan tetikleyiciler
     *    (`verifyOtp` / `exchangeCodeForSession`) zaten `handleRecoveryUrl`
     *    tarafından sürülür ve durumu o fonksiyon kendisi yazar.
     *
     * 2) GECİKMELİ YAZAR, KAPIYI EZİYORDU. `setTimeout(..., 0)` nedeniyle
     *    kapının KİMLİK REDDİNDEN SONRA çalışıp reddedilen `'recovery'`
     *    durumunu geri koyabiliyordu.
     *
     * §6 TEK OTORİTE: kurtarma durumunun tek yazarı `handleRecoveryUrl`'dir.
     * Kilit: `deepLinkAuthSessionFixationN4.test.ts` · W-16/RISK C
     */
  }
  return _adminClient;
}

// ── Tipler ────────────────────────────────────────────────────────────────────

/** Admin giriş akışı durum makinesi */
export type AdminAuthState =
  | 'idle'         // başlangıç
  | 'signing_in'   // giriş denemesi devam ediyor
  | 'logged_out'   // çıkış yapıldı veya oturum yok
  | 'logged_in'    // oturum açık, yetki bekleniyor
  | 'recovery'     // şifre sıfırlama deep link ile gelindi
  | 'updating_pw'; // yeni şifre kaydediliyor

interface RoleStore {
  role:           Role;
  syncStatus:     'idle' | 'syncing' | 'verified' | 'denied';
  adminAuthState: AdminAuthState;
  authError:      string | null;

  setRole:           (role: Role) => void;
  can:               (permission: Permission) => boolean;
  syncWithSupabase:  () => Promise<void>;
  resetRole:         () => void;

  /** Supabase ile giriş yap → yetki doğrula. Yetkisiz hesap: signOut + hata. */
  signInAdmin: (email: string, password: string) => Promise<void>;
  /** Şifre sıfırlama e-postası gönder. redirectTo: carospro://auth/recovery. true = başarılı */
  resetPassword: (email: string) => Promise<boolean>;
  /** Deep link'ten gelen access_token ile oturumu kur ve recovery moduna geç. */
  handleRecoveryUrl: (url: string) => Promise<void>;
  /** Yeni şifreyi kaydet (recovery akışı). */
  updatePassword: (newPassword: string) => Promise<void>;
  /** Admin oturumunu kapat. */
  signOutAdmin: () => Promise<void>;
  /** Auth hatasını temizle. */
  clearAuthError: () => void;
}

// ── Store ─────────────────────────────────────────────────────────────────────

export const useRoleStore = create<RoleStore>()(
  persist(
    (set, get) => ({
      role:           'driver',
      syncStatus:     'idle',
      adminAuthState: 'idle',
      authError:      null,

      setRole: (role) => set({ role }),

      can: (permission) =>
        (ROLE_PERMISSIONS[get().role] as readonly string[]).includes(permission),

      clearAuthError: () => set({ authError: null }),

      // ── Supabase JWT doğrulama ──────────────────────────────────────────────
      syncWithSupabase: async () => {
        const client = getAdminClient();
        if (!client) { set({ syncStatus: 'denied' }); return; }

        set({ syncStatus: 'syncing' });
        try {
          const { data, error } = await client.auth.getUser();
          if (error || !data?.user) {
            set({ syncStatus: 'denied', role: 'driver' });
            return;
          }

          const user        = data.user;
          const appMeta     = (user.app_metadata ?? {}) as Record<string, unknown>;
          const claimedRole = appMeta['role'] as string | undefined;
          const email       = user.email ?? '';

          /* E-24 · AI GATEWAY KAPSAM İZNİ — OTURUM KURULDUĞUNDA OKUNUR.
             `get_ai_gateway_access()` `auth.uid()` ister ve oturumsuz BOŞ döner
             (fail-closed); bu yüzden boot'ta çağırmak anlamsızdı. Denetimde
             `refreshGatewayAccess` ürün yolunda HİÇ çağrılmıyordu → kapı kalıcı
             kapalıydı ve tek açılış yolu yerel geliştirici kaldıracıydı.
             ROL BEKLENMEZ: izin şirket/araç kapsamlıdır, süper-admin olmak şart
             değildir — RPC kendi kapısını (profiles.company_id) zaten uygular.
             FAIL-SOFT: okuma düşerse oturum akışı ETKİLENMEZ (izin verilmez). */
          void refreshGatewayAccess(
            async (fn) => {
              const r = await client.rpc(fn);
              return { data: r.data as unknown, error: r.error as unknown };
            },
            Date.now(),
          ).catch(() => { /* fail-closed: okunamadı = izin YOK */ });

          const hasRoleClaim   = claimedRole === SUPER_ADMIN_ROLE_CLAIM;
          const isEmailAllowed = SUPER_ADMIN_EMAIL_ALLOWLIST.includes(email);

          if (hasRoleClaim && isEmailAllowed) {
            set({ role: 'super_admin', syncStatus: 'verified', adminAuthState: 'logged_in' });
          } else {
            if (get().role === 'super_admin') set({ role: 'driver' });
            set({ syncStatus: 'denied' });
          }
        } catch {
          set({ syncStatus: 'denied' });
        }
      },

      // ── Admin Giriş ────────────────────────────────────────────────────────
      signInAdmin: async (email: string, password: string) => {
        const client = getAdminClient();
        if (!client) {
          set({ authError: 'AUTH_CLIENT_MISSING: Supabase yapılandırılmamış' });
          return;
        }

        set({ adminAuthState: 'signing_in', authError: null });

        try {
          const { error } = await client.auth.signInWithPassword({ email, password });

          if (error) {
            set({
              adminAuthState: 'logged_out',
              authError: `AUTH_REJECTED: ${error.message}`,
            });
            return;
          }

          // Yetki doğrula — syncWithSupabase hem claim hem allowlist kontrol eder
          await get().syncWithSupabase();

          // sync sonrası yetki yoksa çıkış yap
          if (get().syncStatus === 'denied') {
            await client.auth.signOut();
            set({
              role:           'driver',
              adminAuthState: 'logged_out',
              authError:      'ACCESS_DENIED: Bu hesap super_admin yetkisine sahip değil',
            });
          }
        } catch (e) {
          set({
            adminAuthState: 'logged_out',
            authError:      `SIGN_IN_ERROR: ${e instanceof Error ? e.message : 'Bilinmeyen hata'}`,
          });
        }
      },

      // ── Şifre Sıfırlama E-postası ──────────────────────────────────────────
      resetPassword: async (email: string) => {
        const client = getAdminClient();
        if (!client) {
          set({ authError: 'AUTH_CLIENT_MISSING: Supabase yapılandırılmamış' });
          return false;
        }

        set({ authError: null });

        /* W-17 · KRİPTO ÖN KOŞULU. Yetenek yoksa SDK sessizce Math.random
           verifier + `plain` challenge'a düşer; o hâlde kurtarma başlatmak
           GÜVENLİK AÇIĞI ÜRETİR. Fail-closed. */
        if (!(await recoveryCryptoAvailable())) {
          set({ authError: 'RECOVERY_CRYPTO_UNAVAILABLE: bu cihazda güvenli kurtarma başlatılamıyor' });
          return false;
        }

        /* W-17 · Callback'i bu denemeye bağlayan tek kullanımlık nonce. */
        const nonce = generateRecoveryNonce();

        // carospro:// scheme → native app deep link handler'ı yakalar (App.tsx)
        // Supabase Redirect URL allowlist'i bu biçimi kabul etmelidir:
        //   carospro://auth/recovery?state=<128-bit hex>
        const { error } = await client.auth.resetPasswordForEmail(email, {
          redirectTo: `carospro://auth/recovery?${RECOVERY_NONCE_PARAM}=${nonce}`,
        });

        if (error) {
          // Supabase'in "Error sending recovery email" hatası genellikle
          // SMTP konfigürasyonu veya izin listesi sorunundan kaynaklanır.
          const msg = error.message.toLowerCase();
          if (msg.includes('sending') || msg.includes('email')) {
            set({ authError: 'E-posta gönderilemedi. Supabase SMTP ayarlarını ve proje URL yapılandırmasını kontrol edin.' });
          } else {
            set({ authError: `Şifre sıfırlama başarısız: ${error.message}` });
          }
          return false;
        }

        /* N-4: kurtarma BU CİHAZDAN başlatıldı → callback beklentisi açılır.
           W-16: damga HANGİ HESAP için açıldığını taşır (kimlik bağı).
           W-17: damga ayrıca HANGİ NONCE beklendiğini taşır. */
        if (!(await beginRecoveryAttempt(email, nonce))) {
          set({ authError: 'RECOVERY_ATTEMPT_UNSTORABLE: kurtarma beklentisi kaydedilemedi' });
          return false;
        }
        return true;
      },

      // ── Deep Link Recovery Yönetimi ────────────────────────────────────────
      // Yeni format: carospro://auth/recovery?token_hash=xxx&type=recovery
      // Eski format: carospro://auth/recovery#access_token=...&refresh_token=...&type=recovery
      handleRecoveryUrl: async (url: string) => {
        const client = getAdminClient();
        if (!client) return;

        try {
          /* 1) KÖKEN: yalnız tam `carospro://auth/recovery`. Şema/host/path
                URL ayrıştırıcısıyla TAM eşleştirilir — `includes('auth')` gibi
                gevşek bir kontrol saldırganın kökenini kabul ederdi. */
          const u = parseRecoveryCallback(url);
          if (!u) return;                       // FAIL-CLOSED: beklenmeyen köken

          /* 2) YÜK (W-17): yalnız PKCE biçimi kabul edilir —
                `?state=<nonce>&code=<auth_code>`.
                Nonce'suz eski biçimler (`#access_token=...`, çıplak
                `token_hash`) callback'i cihaza BAĞLAMAZ; ele geçiren herkes
                kullanabilir. Geliştirme aşamasındayız, uyumluluk için
                güvensiz yol AÇIK BIRAKILMAZ. */
          const nonce   = u.searchParams.get(RECOVERY_NONCE_PARAM);
          const authCode = u.searchParams.get('code');
          if (!nonce || !authCode) return;      // FAIL-CLOSED: bağlanmamış yük

          /* 3) KRİPTO: nonce doğrulanamıyorsa kabul de edilemez. */
          if (!(await recoveryCryptoAvailable())) {
            set({ authError: 'RECOVERY_CRYPTO_UNAVAILABLE: callback doğrulanamıyor' });
            return;
          }

          /* 4) BEKLENTİ: aktif ve süresi geçmemiş bir deneme var mı?
                Burada HENÜZ TÜKETMİYORUZ — yanlış nonce ile gelen bir
                saldırgan, kurbanın meşru denemesini yok edip kolay bir DoS
                yaratabilmemeli (bkz. adım 6). */
          const attempt = readRecoveryAttempt();
          if (!attempt) {
            set({ authError: 'RECOVERY_UNSOLICITED: bu cihazda açık bir şifre sıfırlama isteği yok' });
            return;
          }

          /* 5) NONCE BAĞI: callback TAM OLARAK bu denemeye mi ait?
                Eşleşmezse Supabase sınırına HİÇ DOKUNULMAZ. */
          const nonceHash = await sha256Hex(nonce);
          if (!nonceHash || !constantTimeEquals(nonceHash, attempt.nonceHash)) {
            set({ authError: 'RECOVERY_NONCE_MISMATCH: bu bağlantı bu cihazın başlattığı kurtarmaya ait değil' });
            return;                             // deneme KORUNUR → DoS yok
          }

          /* 6) TEK KULLANIM: nonce doğrulandıktan SONRA, kod takasından ÖNCE
                tüket. `consumeRecoveryAttempt` içinde `await` yoktur, yani
                olay döngüsü açısından atomiktir: eşzamanlı iki doğru callback
                yarışırsa yalnız biri kaydı alır, diğeri `null` görür. */
          if (!consumeRecoveryAttempt()) {
            set({ authError: 'RECOVERY_REPLAYED: bu kurtarma bağlantısı zaten kullanıldı' });
            return;
          }

          /* 7) KOD TAKASI: SDK, saklanan `code_verifier` ile takas eder.
                Başka bir cihazın ürettiği kod SUNUCUDA reddedilir. */
          const { error } = await client.auth.exchangeCodeForSession(authCode);
          if (error) {
            set({ authError: `SESSION_ERROR: ${error.message}` });
            return;
          }

          /* 8) KİMLİK BAĞI (W-16): kurulan oturum, denemeyi başlatan hesaba
                ait değilse DERHAL kapatılır — derinlik savunması. */
          if (!(await verifyRecoveryIdentity(client, attempt.idHash))) {
            await client.auth.signOut().catch(() => undefined);
            set({ authError: 'RECOVERY_IDENTITY_MISMATCH: bu bağlantı bu cihazın başlattığı hesaba ait değil' });
            return;
          }

          set({ adminAuthState: 'recovery', authError: null });
        } catch {
          /* Deep link ayrıştırma hatası — oturum DEĞİŞMEZ (fail-closed).
             URL veya parametreler LOGLANMAZ: token/hash taşıyabilirler. */
        }
      },

      // ── Yeni Şifre Kaydet ──────────────────────────────────────────────────
      updatePassword: async (newPassword: string) => {
        const client = getAdminClient();
        if (!client) {
          set({ authError: 'AUTH_CLIENT_MISSING: Supabase yapılandırılmamış' });
          return;
        }

        set({ adminAuthState: 'updating_pw', authError: null });

        const { error } = await client.auth.updateUser({ password: newPassword });

        if (error) {
          set({
            adminAuthState: 'recovery',
            authError:      `UPDATE_ERROR: ${error.message}`,
          });
        } else {
          // Şifre güncellendi → yetki doğrula
          await get().syncWithSupabase();
          if (get().syncStatus !== 'verified') {
            await client.auth.signOut();
            set({ adminAuthState: 'logged_out', role: 'driver' });
          }
        }
      },

      // ── Çıkış ──────────────────────────────────────────────────────────────
      signOutAdmin: async () => {
        const client = getAdminClient();
        if (client) await client.auth.signOut();
        /* N-4: çıkış açık kurtarma beklentisini de İPTAL eder — aksi hâlde
           çıkıştan sonra gelen bayat bir callback oturumu diriltebilirdi. */
        clearRecoveryAttempt();
        set({
          role:           'driver',
          syncStatus:     'idle',
          adminAuthState: 'logged_out',
          authError:      null,
        });
      },

      resetRole: () => {
        clearRecoveryAttempt();   // N-4: rol sıfırlama da beklentiyi kapatır
        set({ role: 'driver', syncStatus: 'idle', adminAuthState: 'idle', authError: null });
      },
    }),
    { name: 'car-launcher-role' },
  ),
);
