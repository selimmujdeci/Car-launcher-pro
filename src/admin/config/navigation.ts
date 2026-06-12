import type { Role } from '../types'

export interface NavItem {
  path:     string
  label:    string
  icon:     string   // lucide icon name
  minRole:  Role
}

export interface NavGroup {
  group: string
  items: NavItem[]
}

export const NAV: NavGroup[] = [
  {
    group: 'Genel',
    items: [
      { path: '/',          label: 'Gösterge Paneli', icon: 'LayoutDashboard', minRole: 'viewer' },
    ],
  },
  {
    group: 'Yönetim',
    items: [
      { path: '/users',     label: 'Kullanıcılar', icon: 'Users',           minRole: 'operator' },
      { path: '/vehicles',  label: 'Araçlar',      icon: 'Truck',           minRole: 'viewer' },
    ],
  },
  {
    group: 'Sistem',
    items: [
      { path: '/settings',    label: 'Ayarlar',      icon: 'Settings',    minRole: 'admin'       },
      { path: '/superadmin',  label: 'Süper Admin',  icon: 'ShieldCheck', minRole: 'super_admin' },
      // Command Center (/sa kabuğu): Health/Fleet/Flags/Rollout/Incidents (voice_diag
      // dahil) buranın altında — eskiden normal menüden HİÇ link yoktu, yalnız elle
      // URL ile erişilebiliyordu ("Incident Center menüde yok" bulgusu).
      { path: '/sa/health',   label: 'Komuta Merkezi', icon: 'Activity',  minRole: 'super_admin' },
    ],
  },
]
