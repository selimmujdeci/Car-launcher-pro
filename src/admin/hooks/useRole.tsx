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
import { useAuth } from './useAuth'

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
  const [memberships, setMemberships] = useState<MembershipRecord[]>([])
  const [active,      setActive]      = useState<MembershipRecord | null>(null)
  const [loading,     setLoading]     = useState(true)

  useEffect(() => {
    if (!user) {
      setMemberships([])
      setActive(null)
      setLoading(false)
      return
    }

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
    if (!active) return false
    return hasRole(active.role, minRole)
  }

  const company = active
    ? { id: active.company_id, name: active.company_name }
    : null

  return (
    <Ctx.Provider value={{ memberships, company, role: active?.role ?? null, loading, can, switchCompany }}>
      {children}
    </Ctx.Provider>
  )
}

export function useRole(): RoleCtx {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useRole must be inside RoleProvider')
  return ctx
}
