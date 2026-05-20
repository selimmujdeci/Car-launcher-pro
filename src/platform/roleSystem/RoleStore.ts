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
        return true;
      },

      // ── Deep Link Recovery Yönetimi ────────────────────────────────────────
      // carospro://auth/recovery#access_token=...  (native)
      // https://carospro.com/#access_token=...     (web browser fallback)
      handleRecoveryUrl: async (url: string) => {
        const client = getAdminClient();
        if (!client) return;

        try {
          // Hash veya query string'den token'ları çıkar
          const hashPart = url.includes('#') ? url.split('#')[1]!
                         : url.includes('?') ? url.split('?')[1]!
                         : '';
          const params       = new URLSearchParams(hashPart);
          const accessToken  = params.get('access_token');
          const refreshToken = params.get('refresh_token');
          const type         = params.get('type');

          if (type === 'recovery' && accessToken && refreshToken) {
            const { error } = await client.auth.setSession({
              access_token:  accessToken,
              refresh_token: refreshToken,
            });
            if (!error) {
              set({ adminAuthState: 'recovery', authError: null });
            } else {
              set({ authError: `SESSION_ERROR: ${error.message}` });
            }
          }
        } catch {
          // Deep link parse hatası — sessizce yoksay
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
        set({
          role:           'driver',
          syncStatus:     'idle',
          adminAuthState: 'logged_out',
          authError:      null,
        });
      },

      resetRole: () => set({ role: 'driver', syncStatus: 'idle', adminAuthState: 'idle', authError: null }),
    }),
    { name: 'car-launcher-role' },
  ),
);
