import type { Role } from '../types'

// ── Permission tanımı ─────────────────────────────────────────────────────────

/** Super-admin'in görebileceği tüm yetkiler ve hangi rolle başlar */
export interface Permission {
  key:         string
  label:       string
  minRole:     Role
}

// ── Super Admin Claim Sabitleri ───────────────────────────────────────────────

/**
 * Supabase JWT içindeki role claim.
 *
 * Güvenlik:
 *   user_metadata kullanıcı tarafından değiştirilebilir — role claim'i
 *   YALNIZCA app_metadata'dan okunmalıdır.
 *
 * Kurulum (service_role ile):
 *   supabase.auth.admin.updateUserById(userId, {
 *     app_metadata: { role: 'super_admin' }
 *   })
 */
export const SUPER_ADMIN_CLAIM_KEY   = 'role'    as const
export const SUPER_ADMIN_CLAIM_VALUE = 'super_admin' as const

// ── Super Admin Yetenek Kümesi ────────────────────────────────────────────────

/**
 * Super Admin modüllerine karşılık gelen yetenek tanımları.
 * SuperAdminShell navigasyon modülleriyle birebir örtüşür.
 * Audit trail ve politika sözleşmelerinde referans olarak kullanılır.
 */
export const SUPER_ADMIN_CAPABILITIES = [
  // Health Center
  'health:read',
  'health:write',
  'health:incident_manage',
  // Fleet
  'fleet:read',
  'fleet:write',
  'fleet:audit',
  // Feature Flags
  'flags:read',
  'flags:write',
  'flags:rollout_control',
  // Policies
  'policies:read',
  'policies:write',
  'policies:approve',
  // Rollout
  'rollout:read',
  'rollout:write',
  'rollout:approve',
  'rollout:revert',
  // Audit
  'audit:read',
  'audit:export',
  // Sistem acil yetkiler
  'system:emergency_stop',
] as const

export type SuperAdminCapability = typeof SUPER_ADMIN_CAPABILITIES[number]

// ── Permission Listesi ────────────────────────────────────────────────────────

export const PERMISSIONS: Permission[] = [
  { key: 'dashboard',       label: 'Gösterge Paneli',    minRole: 'viewer'      },
  { key: 'users_view',      label: 'Kullanıcı Görme',    minRole: 'operator'    },
  { key: 'users_manage',    label: 'Kullanıcı Yönet',    minRole: 'admin'       },
  { key: 'vehicles_view',   label: 'Araç Görme',         minRole: 'viewer'      },
  { key: 'vehicles_manage', label: 'Araç Yönet',         minRole: 'operator'    },
  { key: 'settings',        label: 'Ayarlar',            minRole: 'admin'       },
  { key: 'roles_manage',    label: 'Rol Yönetimi',       minRole: 'super_admin' },
  { key: 'health_center',   label: 'Sistem Sağlığı',     minRole: 'super_admin' },
  { key: 'fleet_ops',       label: 'Filo Operasyonları', minRole: 'super_admin' },
  { key: 'feature_flags',   label: 'Özellik Bayrakları', minRole: 'super_admin' },
  { key: 'policy_manage',   label: 'Politika Yönet',     minRole: 'super_admin' },
  { key: 'rollout_manage',  label: 'Dağıtım Yönet',      minRole: 'super_admin' },
  { key: 'audit_logs',      label: 'Denetim Logları',    minRole: 'super_admin' },
]
