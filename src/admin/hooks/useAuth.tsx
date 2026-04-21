import { createContext, useContext, useState, useEffect, type ReactNode } from 'react'
import type { AuthUser, Role } from '../types'
import { hasRole } from '../types'
import {
  getSession,
  signIn as _signIn,
  signOut as _signOut,
  subscribeToAuthChanges,
} from '../services/auth.service'
import {
  fetchUserMemberships,
  resolveActiveMembership,
  getStoredCompanyId,
} from '../services/membership.service'

interface AuthCtx {
  user:     AuthUser | null
  loading:  boolean
  signIn:   (email: string, password: string) => Promise<void>
  signOut:  () => Promise<void>
  can:      (minRole: Role) => boolean
}

const Ctx = createContext<AuthCtx | null>(null)

async function applyMembershipRole(user: AuthUser): Promise<AuthUser> {
  try {
    const memberships = await fetchUserMemberships(user.id)
    const active = resolveActiveMembership(memberships, getStoredCompanyId())
    if (active) return { ...user, role: active.role }
  } catch {
    // membership fetch failed — keep whatever role auth returned
  }
  return user
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user,    setUser]    = useState<AuthUser | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getSession()
      .then((u) => (u ? applyMembershipRole(u) : null))
      .then(setUser)
      .catch(() => setUser(null))
      .finally(() => setLoading(false))

    const subscription = subscribeToAuthChanges((u) => {
      if (!u) { setUser(null); return }
      applyMembershipRole(u).then(setUser).catch(() => setUser(u))
    })
    return () => subscription.unsubscribe()
  }, [])

  async function signIn(email: string, password: string) {
    const u = await _signIn(email, password)
    setUser(await applyMembershipRole(u))
  }

  async function signOut() {
    await _signOut()
    setUser(null)
  }

  function can(minRole: Role) {
    return user ? hasRole(user.role, minRole) : false
  }

  return <Ctx.Provider value={{ user, loading, signIn, signOut, can }}>{children}</Ctx.Provider>
}

export function useAuth(): AuthCtx {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useAuth must be inside AuthProvider')
  return ctx
}
