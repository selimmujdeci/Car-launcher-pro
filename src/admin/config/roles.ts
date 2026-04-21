import type { Role } from '../types'

/** Super-admin'in görebileceği tüm yetkiler ve hangi rolle başlar */
export interface Permission {
  key:         string
  label:       string
  minRole:     Role
}

export const PERMISSIONS: Permission[] = [
  { key: 'dashboard',      label: 'Dashboard',       minRole: 'viewer' },
  { key: 'users_view',     label: 'Kullanıcı Görme', minRole: 'operator' },
  { key: 'users_manage',   label: 'Kullanıcı Yönet', minRole: 'admin' },
  { key: 'vehicles_view',  label: 'Araç Görme',      minRole: 'viewer' },
  { key: 'vehicles_manage',label: 'Araç Yönet',      minRole: 'operator' },
  { key: 'settings',       label: 'Ayarlar',         minRole: 'admin' },
  { key: 'roles_manage',   label: 'Rol Yönetimi',    minRole: 'super_admin' },
]
