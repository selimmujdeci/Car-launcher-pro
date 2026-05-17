/**
 * SuperAdminShell — Enterprise Super Admin Kabuk Düzeni
 *
 * Özellikler:
 *   • Daraltılabilir sidebar  (genişletilmiş: 220px | daraltılmış: 56px)
 *   • Modüller: Health · Fleet · Flags · Policies · Rollout · Audit
 *   • Privacy-First header: kişisel veri değil sistem sağlık göstergesi
 *   • Audit-Ready: her modül geçişi auditAction() çağrısına hazır yapıda
 *   • "Control Center" hissi — yoğun (dense) ama temiz dark theme
 *
 * Kullanım (App.tsx route tanımında):
 *   <Route element={<SuperAdminGuard><SuperAdminShell /></SuperAdminGuard>}>
 *     <Route path="health"    element={<HealthCenter />} />
 *     <Route path="fleet"     element={<FleetCenter />} />
 *     <Route path="flags"     element={<FlagsCenter />} />
 *     <Route path="policies"  element={<PoliciesCenter />} />
 *     <Route path="rollout"   element={<RolloutCenter />} />
 *     <Route path="audit"     element={<AuditCenter />} />
 *   </Route>
 */

import { useState, useEffect }                    from 'react'
import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom'
import {
  Activity,
  Truck,
  Flag,
  ShieldCheck,
  Rocket,
  ClipboardList,
  ChevronLeft,
  ChevronRight,
  LogOut,
  AlertTriangle,
  type LucideIcon,
} from 'lucide-react'
import { useAuth }        from '../hooks/useAuth'
import { auditAction }    from '../types/superadmin'

// ── Sidebar genişlikleri ───────────────────────────────────────────────────────

const W_EXPANDED  = 220
const W_COLLAPSED =  56
const LS_KEY      = 'sa-shell-collapsed'

// ── Modül tanımları ───────────────────────────────────────────────────────────

interface NavModule {
  path:        string
  label:       string
  icon:        LucideIcon
  description: string
  badge?:      string
}

const MODULES: NavModule[] = [
  {
    path:        'health',
    label:       'Health',
    icon:        Activity,
    description: 'Servis sağlık durumu & incident izleme',
  },
  {
    path:        'fleet',
    label:       'Fleet',
    icon:        Truck,
    description: 'Filo genelinde anonim operasyonel görünüm',
  },
  {
    path:        'flags',
    label:       'Flags',
    icon:        Flag,
    description: 'Feature flag yönetimi & kademeli açılım',
  },
  {
    path:        'policies',
    label:       'Policies',
    icon:        ShieldCheck,
    description: 'Sistem politikaları & kural tanımları',
  },
  {
    path:        'rollout',
    label:       'Rollout',
    icon:        Rocket,
    description: 'Sürüm dağıtım planları & onay akışı',
  },
  {
    path:        'audit',
    label:       'Audit',
    icon:        ClipboardList,
    description: 'Denetim kaydı & aksiyon geçmişi',
  },
]

// ── SuperAdminShell ───────────────────────────────────────────────────────────

export function SuperAdminShell() {
  const { user, signOut } = useAuth()
  const navigate          = useNavigate()
  const location          = useLocation()

  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try { return localStorage.getItem(LS_KEY) === '1' } catch { return false }
  })

  const sidebarW = collapsed ? W_COLLAPSED : W_EXPANDED

  // Collapse durumunu localStorage'a yaz
  useEffect(() => {
    try { localStorage.setItem(LS_KEY, collapsed ? '1' : '0') } catch { /* ignore */ }
  }, [collapsed])

  // Modül geçişini logla (audit-ready)
  useEffect(() => {
    if (!user) return
    const module = location.pathname.split('/').pop() ?? 'unknown'
    void auditAction({
      actor_id:    user.id,
      action:      'superadmin.navigate',
      target_type: 'system',
      target_id:   module,
      before:      null,
      after:       { module },
      metadata:    {},
      severity:    'info',
    })
  }, [location.pathname, user])

  async function handleSignOut() {
    await signOut()
    navigate('/login', { replace: true })
  }

  // Aktif modül etiketi (header için)
  const activeModule = MODULES.find(
    (m) => location.pathname.includes(`/${m.path}`)
  )

  return (
    <div
      className="flex h-screen overflow-hidden"
      style={{ background: 'var(--sa-bg, #06090f)', fontFamily: 'system-ui, sans-serif' }}
    >
      {/* ── Sidebar ─────────────────────────────────────────────────────── */}
      <aside
        className="flex flex-col shrink-0 h-screen overflow-hidden transition-all duration-200"
        style={{
          width:       sidebarW,
          background:  '#080c14',
          borderRight: '1px solid rgba(255,255,255,0.06)',
        }}
      >
        {/* Logo & başlık */}
        <div
          className="flex items-center h-14 px-3.5 shrink-0"
          style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}
        >
          {/* İkon — her zaman görünür */}
          <div
            className="flex items-center justify-center rounded-lg shrink-0"
            style={{
              width:      32,
              height:     32,
              background: 'rgba(59,130,246,0.15)',
              border:     '1px solid rgba(59,130,246,0.25)',
            }}
          >
            <AlertTriangle size={15} style={{ color: '#60a5fa' }} />
          </div>

          {/* Başlık — sadece genişletilmişte */}
          {!collapsed && (
            <div className="ml-2.5 min-w-0">
              <p className="text-xs font-bold tracking-wider" style={{ color: '#e2e8f0' }}>
                SUPER ADMIN
              </p>
              <p className="text-[10px]" style={{ color: '#475569' }}>
                Control Center
              </p>
            </div>
          )}
        </div>

        {/* Navigasyon */}
        <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-0.5">
          {!collapsed && (
            <p
              className="px-2 mb-2 text-[10px] font-semibold uppercase tracking-widest"
              style={{ color: '#334155' }}
            >
              Modüller
            </p>
          )}
          {MODULES.map((mod) => (
            <SidebarItem
              key={mod.path}
              mod={mod}
              collapsed={collapsed}
            />
          ))}
        </nav>

        {/* Footer: Kullanıcı + Collapse butonu */}
        <div
          className="shrink-0 pb-3 px-2"
          style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}
        >
          {/* Kullanıcı satırı — genişletilmişte */}
          {!collapsed && user && (
            <div
              className="flex items-center gap-2 px-2 py-2.5 mb-1 rounded-lg"
              style={{ background: 'rgba(255,255,255,0.03)' }}
            >
              <div
                className="flex items-center justify-center rounded-full text-[10px] font-bold shrink-0"
                style={{
                  width:      28,
                  height:     28,
                  background: 'rgba(59,130,246,0.2)',
                  color:      '#60a5fa',
                }}
              >
                {user.full_name.slice(0, 2).toUpperCase()}
              </div>
              <div className="min-w-0">
                <p className="text-xs font-medium truncate" style={{ color: '#e2e8f0' }}>
                  {user.full_name}
                </p>
                <p className="text-[10px] truncate" style={{ color: '#475569' }}>
                  super_admin
                </p>
              </div>
              <button
                onClick={handleSignOut}
                className="ml-auto p-1 rounded transition-colors"
                style={{ color: '#475569' }}
                title="Çıkış"
                onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.color = '#94a3b8')}
                onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.color = '#475569')}
              >
                <LogOut size={13} />
              </button>
            </div>
          )}

          {/* Çıkış — daraltılmışta sadece ikon */}
          {collapsed && (
            <button
              onClick={handleSignOut}
              className="flex items-center justify-center w-full h-9 rounded-lg mb-1 transition-colors"
              style={{ color: '#475569' }}
              title="Çıkış"
              onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.color = '#94a3b8')}
              onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.color = '#475569')}
            >
              <LogOut size={15} />
            </button>
          )}

          {/* Collapse toggle */}
          <button
            onClick={() => setCollapsed((c) => !c)}
            className="flex items-center justify-center w-full h-7 rounded-lg transition-colors text-xs gap-1.5"
            style={{ color: '#334155', background: 'transparent' }}
            onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.04)')}
            onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.background = 'transparent')}
          >
            {collapsed
              ? <ChevronRight size={13} />
              : <><ChevronLeft size={13} /><span style={{ fontSize: 10 }}>Daralt</span></>
            }
          </button>
        </div>
      </aside>

      {/* ── Ana İçerik Alanı ─────────────────────────────────────────────── */}
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">

        {/* Header */}
        <header
          className="flex items-center h-14 px-6 gap-4 shrink-0"
          style={{
            background:  '#080c14',
            borderBottom: '1px solid rgba(255,255,255,0.06)',
          }}
        >
          {/* Aktif modül */}
          <div className="flex items-center gap-2.5 min-w-0">
            {activeModule && (
              <>
                <activeModule.icon size={16} style={{ color: '#60a5fa', flexShrink: 0 }} />
                <div className="min-w-0">
                  <p className="text-sm font-semibold leading-tight" style={{ color: '#e2e8f0' }}>
                    {activeModule.label}
                  </p>
                  <p className="text-[11px] truncate" style={{ color: '#475569' }}>
                    {activeModule.description}
                  </p>
                </div>
              </>
            )}
          </div>

          {/* Sağ taraf: sistem durumu göstergesi */}
          <div className="ml-auto flex items-center gap-3">
            <SystemStatusPill />
          </div>
        </header>

        {/* Sayfa içeriği */}
        <main className="flex-1 overflow-y-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}

// ── Sidebar Öğesi ─────────────────────────────────────────────────────────────

function SidebarItem({ mod, collapsed }: { mod: NavModule; collapsed: boolean }) {
  const Icon = mod.icon

  return (
    <NavLink
      to={mod.path}
      className="block"
      title={collapsed ? mod.label : undefined}
    >
      {({ isActive }) => (
        <div
          className="flex items-center gap-2.5 rounded-lg transition-colors cursor-pointer"
          style={{
            padding:    collapsed ? '0.5rem' : '0.45rem 0.625rem',
            justifyContent: collapsed ? 'center' : undefined,
            background: isActive
              ? 'rgba(59,130,246,0.12)'
              : 'transparent',
            border: isActive
              ? '1px solid rgba(59,130,246,0.2)'
              : '1px solid transparent',
          }}
          onMouseEnter={(e) => {
            if (isActive) return
            const el = e.currentTarget as HTMLDivElement
            el.style.background = 'rgba(255,255,255,0.04)'
          }}
          onMouseLeave={(e) => {
            if (isActive) return
            const el = e.currentTarget as HTMLDivElement
            el.style.background = 'transparent'
          }}
        >
          <Icon
            size={15}
            style={{ color: isActive ? '#60a5fa' : '#64748b', flexShrink: 0 }}
          />
          {!collapsed && (
            <span
              className="text-[13px] font-medium truncate"
              style={{ color: isActive ? '#93c5fd' : '#94a3b8' }}
            >
              {mod.label}
            </span>
          )}
          {!collapsed && mod.badge && (
            <span
              className="ml-auto text-[10px] font-bold px-1.5 rounded-full"
              style={{ background: 'rgba(239,68,68,0.2)', color: '#f87171' }}
            >
              {mod.badge}
            </span>
          )}
        </div>
      )}
    </NavLink>
  )
}

// ── Sistem Durum Pill'i ───────────────────────────────────────────────────────

/**
 * Header'da gösterilen anlık sistem durum göstergesi.
 * Gerçek veri geldikçe buradaki "Sistem Normal" statik değeri değiştirilir.
 * Privacy-First: kişisel veri değil, servis sağlık özeti.
 */
function SystemStatusPill() {
  return (
    <div
      className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium"
      style={{
        background: 'rgba(34,197,94,0.08)',
        border:     '1px solid rgba(34,197,94,0.2)',
        color:      '#4ade80',
      }}
    >
      <span
        className="block rounded-full animate-pulse"
        style={{ width: 6, height: 6, background: '#22c55e' }}
      />
      Sistem Normal
    </div>
  )
}

// ── EmptyModule: yalnızca geliştirme aşamasındaki modüller için ───────────────

export function EmptyModule({ label, description }: { label: string; description?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-24 gap-4">
      <div
        className="flex items-center justify-center rounded-xl"
        style={{ width: 56, height: 56, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}
      >
        <ActivityPlaceholder />
      </div>
      <div className="text-center">
        <p className="text-sm font-medium" style={{ color: '#94a3b8' }}>{label}</p>
        {description && (
          <p className="text-xs mt-1" style={{ color: '#475569' }}>{description}</p>
        )}
      </div>
    </div>
  )
}

function ActivityPlaceholder() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#475569" strokeWidth="1.5">
      <circle cx="12" cy="12" r="9" />
      <polyline points="12 7 12 12 15 15" />
    </svg>
  )
}
