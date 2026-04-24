import { NavLink, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard, Users, Truck, Settings, LogOut, Car, ShieldCheck,
  type LucideIcon,
} from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { useRole } from '../../hooks/useRole'
import { NAV } from '../../config/navigation'

const ICON_MAP: Record<string, LucideIcon> = {
  LayoutDashboard,
  Users,
  Truck,
  Settings,
  ShieldCheck,
}

export function Sidebar() {
  const { user, signOut } = useAuth()
  const { can, company }  = useRole()
  const navigate = useNavigate()

  async function handleSignOut() {
    await signOut()
    navigate('/login', { replace: true })
  }

  return (
    <aside
      className="flex flex-col shrink-0 h-screen overflow-y-auto"
      style={{ width: 'var(--adm-sidebar)', background: 'var(--adm-surface)', borderRight: '1px solid var(--adm-border)' }}
    >
      {/* Logo */}
      <div className="flex items-center gap-2 px-4 py-5" style={{ borderBottom: '1px solid var(--adm-border)' }}>
        <Car size={20} style={{ color: 'var(--adm-accent)' }} />
        <span className="font-semibold text-sm tracking-wide" style={{ color: 'var(--adm-text)' }}>
          Caros
        </span>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-2 py-4 space-y-5">
        {NAV.map((group) => {
          const visible = group.items.filter((item) => can(item.minRole))
          if (visible.length === 0) return null
          return (
            <div key={group.group}>
              <p className="px-2 mb-1 text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--adm-muted)' }}>
                {group.group}
              </p>
              {visible.map((item) => {
                const Icon = ICON_MAP[item.icon]
                return (
                  <NavLink
                    key={item.path}
                    to={item.path}
                    end={item.path === '/'}
                    className={({ isActive }) =>
                      [
                        'flex items-center gap-2.5 px-2 py-2 rounded-md text-sm transition-colors w-full',
                        isActive
                          ? 'font-medium'
                          : 'hover:opacity-80',
                      ].join(' ')
                    }
                    style={({ isActive }) => ({
                      background: isActive ? 'rgba(59,130,246,0.15)' : 'transparent',
                      color: isActive ? 'var(--adm-accent2)' : 'var(--adm-text)',
                    })}
                  >
                    {Icon && <Icon size={16} />}
                    {item.label}
                  </NavLink>
                )
              })}
            </div>
          )
        })}
      </nav>

      {/* User footer */}
      <div className="px-3 py-4 space-y-3" style={{ borderTop: '1px solid var(--adm-border)' }}>
        {user && (
          <div className="px-1">
            <p className="text-sm font-medium truncate" style={{ color: 'var(--adm-text)' }}>{user.full_name}</p>
            <p className="text-xs truncate" style={{ color: 'var(--adm-muted)' }}>
              {company?.name ?? user.email}
            </p>
          </div>
        )}
        <button
          onClick={handleSignOut}
          className="flex items-center gap-2 px-2 py-1.5 rounded-md text-sm w-full transition-colors hover:opacity-80"
          style={{ color: 'var(--adm-muted)' }}
        >
          <LogOut size={14} />
          Çıkış
        </button>
      </div>
    </aside>
  )
}
