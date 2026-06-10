import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react'
import type { Role } from '../types'
import { hasRole } from '../types'
import {
  fetchUserMemberships,
  resolveActiveMembership,
  getStoredCompanyId,
  storeCompanyId,
  type MembershipRecord,
} from '../services/membership.service'
import { hasSuperAdminClaim } from '../components/auth/SuperAdminGuard'
import { useAuth } from './useAuth'

/**
 * Saf yetki kuralı (test edilebilir):
 * JWT super_admin claim'i → her şeye yetkili (SuperAdminGuard ile AYNI kaynak;
 * membership kaydı olmayan süper admin sidebar'da Command Center'ı görebilsin).
 * Aksi halde aktif membership rolü üzerinden hasRole sıralaması.
 */
export function resolveCan(jwtSuperAdmin: boolean, activeRole: Role | null, minRole: Role): boolean {
  if (jwtSuperAdmin) return true
  if (!activeRole) return false
  return hasRole(activeRole, minRole)
}

interface RoleCtx {
  memberships:   MembershipRecord[]
  company:       { id: string; name: string } | null
  role:          Role | null
  loading:       boolean
  can:           (minRole: Role) => boolean
  switchCompany: (id: string) => void
}

const Ctx = createContext<RoleCtx | null>(null)

export function RoleProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const [memberships,   setMemberships]   = useState<MembershipRecord[]>([])
  const [active,        setActive]        = useState<MembershipRecord | null>(null)
  const [loading,       setLoading]       = useState(true)
  const [jwtSuperAdmin, setJwtSuperAdmin] = useState(false)

  useEffect(() => {
    if (!user) {
      setMemberships([])
      setActive(null)
      setJwtSuperAdmin(false)
      setLoading(false)
      return
    }

    // JWT claim — memberships sorgusundan bağımsız (ağ çağrısı yok, token parse)
    void hasSuperAdminClaim()
      .then(setJwtSuperAdmin)
      .catch(() => setJwtSuperAdmin(false))

    setLoading(true)
    fetchUserMemberships(user.id)
      .then((list) => {
        setMemberships(list)
        const resolved = resolveActiveMembership(list, getStoredCompanyId())
        setActive(resolved)
        if (resolved) storeCompanyId(resolved.company_id)
      })
      .catch(() => {
        setMemberships([])
        setActive(null)
      })
      .finally(() => setLoading(false))
  }, [user?.id])

  const switchCompany = useCallback((id: string) => {
    const target = memberships.find((m) => m.company_id === id) ?? null
    setActive(target)
    if (target) storeCompanyId(target.company_id)
  }, [memberships])

  function can(minRole: Role): boolean {
    return resolveCan(jwtSuperAdmin, active?.role ?? null, minRole)
  }

  const company = active
    ? { id: active.company_id, name: active.company_name }
    : null

  // Görünen rol: membership rolü; yoksa JWT claim'i (Settings vb. rol etiketi için)
  const role: Role | null = active?.role ?? (jwtSuperAdmin ? 'super_admin' : null)

  return (
    <Ctx.Provider value={{ memberships, company, role, loading, can, switchCompany }}>
      {children}
    </Ctx.Provider>
  )
}

export function useRole(): RoleCtx {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useRole must be inside RoleProvider')
  return ctx
}
