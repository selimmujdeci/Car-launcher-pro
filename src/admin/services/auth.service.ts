import type { User as SupabaseUser, Subscription } from '@supabase/supabase-js'
import { supabase } from '../lib/supabaseClient'
import type { AuthUser, Role } from '../types'

function mapUser(u: SupabaseUser): AuthUser {
  const meta = u.user_metadata as Record<string, unknown>
  return {
    id:          u.id,
    email:       u.email ?? '',
    full_name:   (meta?.full_name as string) ?? u.email?.split('@')[0] ?? 'Kullanıcı',
    role:        (meta?.role as Role) ?? 'viewer',
    institution: meta?.institution as string | undefined,
    avatar_url:  meta?.avatar_url as string | undefined,
  }
}

export async function getSession(): Promise<AuthUser | null> {
  const { data: { session }, error } = await supabase.auth.getSession()
  if (error) throw new Error(error.message)
  return session?.user ? mapUser(session.user) : null
}

export async function signIn(email: string, password: string): Promise<AuthUser> {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) throw new Error(error.message)
  return mapUser(data.user)
}

export async function signOut(): Promise<void> {
  const { error } = await supabase.auth.signOut()
  if (error) throw new Error(error.message)
}

export function subscribeToAuthChanges(
  callback: (user: AuthUser | null) => void,
): Subscription {
  const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
    callback(session?.user ? mapUser(session.user) : null)
  })
  return subscription
}
