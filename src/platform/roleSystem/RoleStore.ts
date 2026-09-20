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

interface RecoveryAttempt { id: string; createdAt: number }

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

/** Kurtarma BU CİHAZDAN başlatıldı — callback beklentisi açılır. */
function beginRecoveryAttempt(): void {
  try {
    const id = (globalThis.crypto?.randomUUID?.() ?? String(Date.now()));
    localStorage.setItem(RECOVERY_ATTEMPT_KEY, JSON.stringify({ id, createdAt: Date.now() }));
  } catch { /* depo yoksa: aşağıdaki kapı fail-closed davranır */ }
}

function clearRecoveryAttempt(): void {
  try { localStorage.removeItem(RECOVERY_ATTEMPT_KEY); } catch { /* noop */ }
}

/**
 * TEK KULLANIMLIK tüketim: aktif ve süresi geçmemiş bir deneme varsa onu
 * SİLER ve `true` döner. Oturum değiştiren çağrıdan ÖNCE yapılır ki uçuş
 * hâlindeki bir tekrar oynatma da ikinci kez geçemesin.
 */
function consumeRecoveryAttempt(): boolean {
  const a = readRecoveryAttempt();
  clearRecoveryAttempt();          // süresi dolmuş kayıt da temizlenir
  return a !== null;
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
        detectSessionInUrl: true, // URL hash'teki access_token'ı otomatik yakala
      },
      global: { headers: { 'X-Client-Info': 'capacitor-android-admin' } },
    });

    // Web browser'da reset linki açıldığında PASSWORD_RECOVERY event'i yakala
    // Store henüz oluşturulmamış olabilir → setTimeout ile defer et
    _adminClient.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') {
        setTimeout(() => {
          useRoleStore.setState({ adminAuthState: 'recovery', authError: null });
        }, 0);
      }
    });
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

        // carospro:// scheme → native app deep link handler'ı yakalar (App.tsx)
        // Supabase Redirect URL allowlist'ine eklenmeli: carospro://auth/recovery
        const { error } = await client.auth.resetPasswordForEmail(email, {
          redirectTo: 'carospro://auth/recovery',
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
           Yalnız bu damga varken gelen callback oturum değiştirebilir. */
        beginRecoveryAttempt();
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

          /* 2) YÜK: hangi biçim geldi? Önce doğrula, SONRA denemeyi tüket —
                böylece geçersiz bir yük meşru denemeyi harcamaz. */
          const tokenHash = u.searchParams.get('token_hash');
          const queryType = u.searchParams.get('type');
          const isOtp     = !!tokenHash && queryType === 'recovery';

          const hashParams   = new URLSearchParams(u.hash.startsWith('#') ? u.hash.slice(1) : u.hash);
          const accessToken  = hashParams.get('access_token');
          const refreshToken = hashParams.get('refresh_token');
          const isLegacy     = hashParams.get('type') === 'recovery' && !!accessToken && !!refreshToken;

          if (!isOtp && !isLegacy) return;      // FAIL-CLOSED: eksik/bozuk yük

          /* 3) BAĞLAMA + TEK KULLANIM: bu callback, BU CİHAZIN başlattığı
                kurtarmaya ait mi? Deneme oturum değiştiren çağrıdan ÖNCE
                tüketilir → davetsiz, bayat ve tekrar oynatılan callback geçemez. */
          if (!consumeRecoveryAttempt()) {
            set({ authError: 'RECOVERY_UNSOLICITED: bu cihazda açık bir şifre sıfırlama isteği yok' });
            return;
          }

          if (isOtp) {
            const { error } = await client.auth.verifyOtp({
              token_hash: tokenHash!,
              type: 'recovery',
            });
            if (!error) {
              set({ adminAuthState: 'recovery', authError: null });
            } else {
              set({ authError: `SESSION_ERROR: ${error.message}` });
            }
            return;
          }

          const { error } = await client.auth.setSession({
            access_token:  accessToken!,
            refresh_token: refreshToken!,
          });
          if (!error) {
            set({ adminAuthState: 'recovery', authError: null });
          } else {
            set({ authError: `SESSION_ERROR: ${error.message}` });
          }
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
