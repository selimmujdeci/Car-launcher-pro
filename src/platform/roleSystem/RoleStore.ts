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
// Ana uygulama client'ından bağımsız — session yönetimi admin akışına özel.

let _adminClient: ReturnType<typeof createClient> | null = null;

function getAdminClient() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return null;
  if (!_adminClient) {
    _adminClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true },
      global: { headers: { 'X-Client-Info': 'capacitor-android-admin' } },
    });
  }
  return _adminClient;
}

// ── Store ─────────────────────────────────────────────────────────────────────

interface RoleStore {
  role:              Role;
  syncStatus:        'idle' | 'syncing' | 'verified' | 'denied';
  setRole:           (role: Role) => void;
  can:               (permission: Permission) => boolean;
  /**
   * Supabase JWT payload'ından super_admin claim'ini doğrular.
   * Güvenlik katmanları (sırayla):
   *   1. app_metadata.role === 'super_admin' (service_role ile yazılır, kullanıcı değiştiremez)
   *   2. E-posta SUPER_ADMIN_EMAIL_ALLOWLIST'te olmalı
   * Her iki koşul sağlanırsa rol 'super_admin' olarak mühürlenir.
   */
  syncWithSupabase:  () => Promise<void>;
  resetRole:         () => void;
}

export const useRoleStore = create<RoleStore>()(
  persist(
    (set, get) => ({
      role:       'driver',
      syncStatus: 'idle',

      setRole: (role) => set({ role }),

      can: (permission) =>
        (ROLE_PERMISSIONS[get().role] as readonly string[]).includes(permission),

      syncWithSupabase: async () => {
        const client = getAdminClient();
        if (!client) {
          set({ syncStatus: 'denied' });
          return;
        }

        set({ syncStatus: 'syncing' });

        try {
          const { data, error } = await client.auth.getUser();
          if (error || !data?.user) {
            set({ syncStatus: 'denied', role: 'driver' });
            return;
          }

          const user      = data.user;
          const appMeta   = (user.app_metadata ?? {}) as Record<string, unknown>;
          const claimedRole = appMeta['role'] as string | undefined;
          const email       = user.email ?? '';

          const hasRoleClaim    = claimedRole === SUPER_ADMIN_ROLE_CLAIM;
          const isEmailAllowed  = SUPER_ADMIN_EMAIL_ALLOWLIST.includes(email);

          if (hasRoleClaim && isEmailAllowed) {
            set({ role: 'super_admin', syncStatus: 'verified' });
          } else {
            // Claim yoksa mevcut rolü düşürme — sadece super_admin yetkisini ver/alma
            if (get().role === 'super_admin') set({ role: 'driver' });
            set({ syncStatus: 'denied' });
          }
        } catch {
          set({ syncStatus: 'denied' });
        }
      },

      resetRole: () => set({ role: 'driver', syncStatus: 'idle' }),
    }),
    { name: 'car-launcher-role' },
  ),
);
