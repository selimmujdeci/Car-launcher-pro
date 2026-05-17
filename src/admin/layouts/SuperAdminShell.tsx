/**
 * SuperAdminShell — Enterprise Command Center Kabuk Düzeni
 *
 * Tasarım dili: Mercedes Engineering Console / Tesla Internal Dashboard
 * Operasyonel Netlik: blur yok, glow yok, gradient yok.
 * Animasyonlar sadece durum geçişlerinde (150ms).
 *
 * Layout:
 *   FleetHealthRibbon (36px) — sabit üst telemetri şeridi
 *   Header             (48px) — aktif modül + sistem pill
 *   Sidebar            (220px ↔ 56px) — daraltılabilir
 *   Main               (12-kolon grid) — Outlet
 */

import { useState, useEffect }                    from 'react'
import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom'
import {
  Activity, Truck, Flag, ShieldCheck, Rocket,
  ClipboardList, ChevronLeft, ChevronRight,
  LogOut, AlertTriangle, Stethoscope, type LucideIcon,
} from 'lucide-react'
import { useAuth }              from '../hooks/useAuth'
import { auditAction }          from '../types/superadmin'
import { FleetHealthRibbon }    from '../components/superadmin/FleetHealthRibbon'
import '../styles/admin-enterprise.css'

// ── Sabitler ──────────────────────────────────────────────────────────────────

const W_EXPANDED  = 216
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
  { path: 'health',   label: 'Health',   icon: Activity,     description: 'Servis sağlık & incident izleme' },
  { path: 'fleet',    label: 'Fleet',    icon: Truck,         description: 'Filo anonim operasyonel görünüm' },
  { path: 'flags',    label: 'Flags',    icon: Flag,          description: 'Feature flag yönetimi' },
  { path: 'policies', label: 'Policies', icon: ShieldCheck,   description: 'Runtime politika merkezi' },
  { path: 'rollout',     label: 'Rollout',  icon: Rocket,        description: 'Sürüm dağıtım planları' },
  { path: 'audit',      label: 'Audit',    icon: ClipboardList, description: 'Denetim kaydı & aksiyon geçmişi' },
  { path: 'diagnostics',label: 'Diag',     icon: Stethoscope,   description: 'Canlı uzak teşhis & debug' },
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

  useEffect(() => {
    try { localStorage.setItem(LS_KEY, collapsed ? '1' : '0') } catch { /* noop */ }
  }, [collapsed])

  useEffect(() => {
    if (!user) return
    const module = location.pathname.split('/').pop() ?? 'unknown'
    void auditAction({
      actor_id: user.id, action: 'superadmin.navigate',
      target_type: 'system', target_id: module,
      before: null, after: { module }, metadata: {}, severity: 'info',
    })
  }, [location.pathname, user])

  async function handleSignOut() {
    await signOut()
    navigate('/login', { replace: true })
  }

  const activeModule = MODULES.find((m) => location.pathname.includes(`/${m.path}`))

  return (
    <div
      className="flex flex-col h-screen overflow-hidden"
      style={{ background: 'var(--sa-bg)', fontFamily: 'var(--sa-font-ui)' }}
    >
      {/* ── Fleet Health Ribbon (36px) ─────────────────────────────── */}
      <FleetHealthRibbon />

      {/* ── Body (sidebar + content) ───────────────────────────────── */}
      <div className="flex flex-1 min-h-0 overflow-hidden">

        {/* ── Sidebar ───────────────────────────────────────────────── */}
        <aside
          className="flex flex-col h-full overflow-hidden"
          style={{
            width:       sidebarW,
            minWidth:    sidebarW,
            background:  '#0d0d0d',
            borderRight: '1px solid var(--sa-border)',
            transition:  `width ${150}ms ease, min-width ${150}ms ease`,
          }}
        >
          {/* Logo */}
          <div
            className="flex items-center h-12 px-3 shrink-0"
            style={{ borderBottom: '1px solid var(--sa-border)' }}
          >
            <div
              className="flex items-center justify-center rounded shrink-0"
              style={{
                width:      30, height: 30,
                background: 'rgba(59,130,246,0.1)',
                border:     '1px solid rgba(59,130,246,0.2)',
              }}
            >
              <AlertTriangle size={14} style={{ color: '#3b82f6' }} />
            </div>
            {!collapsed && (
              <div className="ml-2.5 min-w-0">
                <p
                  className="sa-mono"
                  style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', color: '#94a3b8' }}
                >
                  SUPER ADMIN
                </p>
                <p style={{ fontSize: 9, color: 'var(--sa-dim)', letterSpacing: '0.08em' }}>
                  COMMAND CENTER
                </p>
              </div>
            )}
          </div>

          {/* Nav */}
          <nav className="flex-1 overflow-y-auto py-2 px-1.5 space-y-0.5 sa-scroll">
            {!collapsed && (
              <p className="sa-label px-2 mb-2" style={{ paddingTop: 4 }}>MODULES</p>
            )}
            {MODULES.map((mod) => (
              <SidebarItem key={mod.path} mod={mod} collapsed={collapsed} />
            ))}
          </nav>

          {/* Footer */}
          <div
            className="shrink-0 py-2 px-1.5"
            style={{ borderTop: '1px solid var(--sa-border-2)' }}
          >
            {!collapsed && user && (
              <div
                className="flex items-center gap-2 px-2 py-2 mb-1 rounded"
                style={{ background: 'rgba(255,255,255,0.03)' }}
              >
                <div
                  className="flex items-center justify-center rounded-full shrink-0 sa-mono"
                  style={{
                    width: 26, height: 26,
                    background: 'rgba(59,130,246,0.15)',
                    color:      '#60a5fa',
                    fontSize:    10,
                    fontWeight:  700,
                  }}
                >
                  {user.full_name.slice(0, 2).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <p style={{ fontSize: 11, fontWeight: 600, color: '#94a3b8', letterSpacing: '0.02em' }} className="truncate">
                    {user.full_name}
                  </p>
                  <p className="sa-label truncate" style={{ fontSize: 8 }}>SUPER_ADMIN</p>
                </div>
                <button
                  onClick={handleSignOut}
                  className="ml-auto p-1 rounded"
                  style={{ color: 'var(--sa-dim)', transition: 'color var(--sa-t)' }}
                  title="Çıkış"
                  onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = '#94a3b8' }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--sa-dim)' }}
                >
                  <LogOut size={12} />
                </button>
              </div>
            )}
            {collapsed && (
              <button
                onClick={handleSignOut}
                className="flex items-center justify-center w-full h-8 rounded mb-1"
                style={{ color: 'var(--sa-dim)', transition: 'color var(--sa-t)' }}
                title="Çıkış"
                onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = '#94a3b8' }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--sa-dim)' }}
              >
                <LogOut size={14} />
              </button>
            )}
            <button
              onClick={() => setCollapsed((c) => !c)}
              className="flex items-center justify-center w-full h-6 rounded"
              style={{
                color:      'var(--sa-dim)',
                background: 'transparent',
                fontSize:    10,
                gap:         6,
                transition: `background ${150}ms ease`,
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.04)' }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent' }}
            >
              {collapsed
                ? <ChevronRight size={12} />
                : <><ChevronLeft size={12} /><span style={{ fontFamily: 'var(--sa-font-mono)', letterSpacing: '0.08em' }}>COLLAPSE</span></>
              }
            </button>
          </div>
        </aside>

        {/* ── Ana İçerik ─────────────────────────────────────────────── */}
        <div className="flex flex-col flex-1 min-w-0 overflow-hidden">

          {/* Header (48px) */}
          <header
            className="flex items-center h-12 px-5 gap-4 shrink-0"
            style={{
              background:   '#0d0d0d',
              borderBottom: '1px solid var(--sa-border)',
            }}
          >
            <div className="flex items-center gap-2.5 min-w-0">
              {activeModule && (
                <>
                  <activeModule.icon size={14} style={{ color: '#475569', flexShrink: 0 }} />
                  <div className="min-w-0">
                    <p
                      className="sa-mono"
                      style={{ fontSize: 12, fontWeight: 600, color: '#94a3b8', letterSpacing: '0.06em' }}
                    >
                      {activeModule.label.toUpperCase()}
                    </p>
                    <p style={{ fontSize: 10, color: 'var(--sa-dim)', letterSpacing: '0.02em' }} className="truncate">
                      {activeModule.description}
                    </p>
                  </div>
                </>
              )}
            </div>
            <div className="ml-auto flex items-center gap-3">
              <SystemPill />
            </div>
          </header>

          {/* Sayfa */}
          <main
            className="flex-1 overflow-y-auto sa-scroll"
            style={{ padding: '20px 24px' }}
          >
            <Outlet />
          </main>
        </div>
      </div>
    </div>
  )
}

// ── Sidebar Item ──────────────────────────────────────────────────────────────

function SidebarItem({ mod, collapsed }: { mod: NavModule; collapsed: boolean }) {
  const Icon = mod.icon
  return (
    <NavLink to={mod.path} className="block" title={collapsed ? mod.label : undefined}>
      {({ isActive }) => (
        <div
          className="flex items-center rounded"
          style={{
            padding:        collapsed ? '7px' : '6px 10px',
            justifyContent: collapsed ? 'center' : undefined,
            gap:             collapsed ? undefined : 8,
            background:     isActive ? 'rgba(59,130,246,0.08)' : 'transparent',
            borderLeft:     isActive ? '2px solid #3b82f6' : '2px solid transparent',
            transition:     `background ${150}ms ease`,
          }}
          onMouseEnter={(e) => {
            if (isActive) return
            const el = e.currentTarget as HTMLDivElement
            el.style.background = 'rgba(255,255,255,0.03)'
          }}
          onMouseLeave={(e) => {
            if (isActive) return
            const el = e.currentTarget as HTMLDivElement
            el.style.background = 'transparent'
          }}
        >
          <Icon
            size={14}
            style={{ color: isActive ? '#60a5fa' : '#475569', flexShrink: 0 }}
          />
          {!collapsed && (
            <span
              className="sa-mono truncate"
              style={{
                fontSize:      11,
                fontWeight:    isActive ? 600 : 400,
                color:         isActive ? '#93c5fd' : '#64748b',
                letterSpacing: '0.04em',
              }}
            >
              {mod.label.toUpperCase()}
            </span>
          )}
          {!collapsed && mod.badge && (
            <span
              className="ml-auto sa-mono"
              style={{
                fontSize:    9,
                fontWeight:  700,
                padding:    '1px 5px',
                borderRadius: 3,
                background: 'rgba(239,68,68,0.15)',
                color:      '#f87171',
              }}
            >
              {mod.badge}
            </span>
          )}
        </div>
      )}
    </NavLink>
  )
}

// ── System Pill ───────────────────────────────────────────────────────────────

function SystemPill() {
  return (
    <div
      className="flex items-center gap-1.5 px-3 py-1 rounded sa-mono"
      style={{
        background: 'rgba(74,222,128,0.06)',
        border:     '1px solid rgba(74,222,128,0.15)',
        color:      '#4ade80',
        fontSize:    10,
        letterSpacing: '0.08em',
      }}
    >
      <span className="sa-dot" style={{ background: '#22c55e', width: 5, height: 5 }} />
      SYS_NOMINAL
    </div>
  )
}

// ── EmptyModule — geliştirme aşamasındaki modüller ────────────────────────────

export function EmptyModule({ label, description }: { label: string; description?: string }) {
  return (
    <div className="sa-empty">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span
          className="sa-dot"
          style={{ background: '#334155', width: 5, height: 5 }}
        />
        <span style={{ color: '#475569' }}>MODULE_OFFLINE</span>
      </div>
      <p style={{ color: 'var(--sa-dim)', marginTop: 4 }}>{label.toUpperCase()}</p>
      {description && (
        <p style={{ color: '#1e293b', fontSize: 10 }}>{description}</p>
      )}
      <p style={{ color: '#1e293b', marginTop: 8 }}>
        SYSTEM_IDLE: Awaiting Implementation...
      </p>
    </div>
  )
}
