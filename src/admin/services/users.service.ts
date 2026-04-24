/**
 * users.service — Company member CRUD via Supabase.
 *
 * listUsers(companyId?):
 *   Queries memberships JOIN users JOIN companies.
 *   RLS ensures only co-members of the caller's companies are visible.
 *
 * createUser(dto):
 *   Calls add_member_by_email RPC — target user must already have a
 *   Supabase auth account (self-registered or invited via dashboard).
 *
 * updateUser(id, patch):
 *   Updates public.users profile AND memberships.role atomically.
 *
 * deleteUser(id):
 *   Calls remove_member RPC — removes membership only, auth account preserved.
 *
 * Falls back to MOCK_USERS when Supabase is not configured.
 */

import { supabase }             from '../lib/supabaseClient'
import { getStoredCompanyId }   from './membership.service'
import type { User, CreateUserDTO, Role, UserStatus } from '../types'
import { MOCK_USERS }           from './mock.data'

const USE_SUPABASE = Boolean(import.meta.env.VITE_SUPABASE_URL)

/* ── DB row shape (memberships JOIN users JOIN companies) ────── */

interface MembershipRow {
  user_id:    string
  role:       string
  created_at: string
  // PostgREST returns embedded relations as arrays even for to-one FK
  users: Array<{
    id:         string
    email:      string
    full_name:  string
    phone:      string | null
    created_at: string
  }> | null
  companies: Array<{
    name: string
  }> | null
}

function toUser(row: MembershipRow): User {
  const u = row.users?.[0] ?? null
  const c = row.companies?.[0] ?? null
  return {
    id:          row.user_id,
    email:       u?.email     ?? '',
    full_name:   u?.full_name ?? '',
    phone:       u?.phone     ?? undefined,
    role:        row.role as Role,
    status:      'active' as UserStatus,  // membership exists → user is active
    institution: c?.name      ?? undefined,
    created_at:  u?.created_at ?? row.created_at,
  }
}

/* ── Mock fallback store ─────────────────────────────────────── */

let _mockStore: User[] = [...MOCK_USERS]

/* ── Public API ─────────────────────────────────────────────── */

/**
 * List users in the current company.
 * Pass companyId to filter; omit to let RLS show all accessible users.
 */
export async function listUsers(companyId?: string): Promise<User[]> {
  if (!USE_SUPABASE) return [..._mockStore]

  let q = supabase
    .from('memberships')
    .select(`
      user_id,
      role,
      created_at,
      users ( id, email, full_name, phone, created_at ),
      companies ( name )
    `)
    .order('created_at', { ascending: false })

  if (companyId) q = q.eq('company_id', companyId)

  const { data, error } = await q
  if (error) throw new Error(error.message)

  return (data as unknown as MembershipRow[])
    .filter((row) => row.users !== null && row.users.length > 0)
    .map(toUser)
}

/**
 * Add an existing Supabase user to the active company.
 * The target user must already have an auth account.
 * Calls the add_member_by_email SECURITY DEFINER RPC.
 */
export async function createUser(dto: CreateUserDTO): Promise<User> {
  if (!USE_SUPABASE) {
    const user: User = {
      ...dto,
      id:         crypto.randomUUID(),
      status:     'pending',
      created_at: new Date().toISOString(),
    }
    _mockStore = [user, ..._mockStore]
    return user
  }

  const companyId = getStoredCompanyId()
  if (!companyId) throw new Error('Aktif şirket seçili değil')

  const { data, error } = await supabase.rpc('add_member_by_email', {
    p_email:      dto.email.trim().toLowerCase(),
    p_company_id: companyId,
    p_role:       dto.role,
    p_full_name:  dto.full_name || null,
  })

  if (error) throw new Error(error.message)

  return {
    id:          (data as { user_id: string }).user_id,
    email:       dto.email.trim().toLowerCase(),
    full_name:   dto.full_name,
    role:        dto.role,
    status:      'active',
    institution: dto.institution,
    created_at:  new Date().toISOString(),
  }
}

/**
 * Update user profile fields and/or their membership role.
 * Profile changes (full_name, phone) go to public.users.
 * Role changes go to memberships for the active company.
 */
export async function updateUser(id: string, patch: Partial<User>): Promise<User> {
  if (!USE_SUPABASE) {
    const idx = _mockStore.findIndex((u) => u.id === id)
    if (idx === -1) throw new Error('Kullanıcı bulunamadı')
    _mockStore[idx] = { ..._mockStore[idx], ...patch }
    return _mockStore[idx]
  }

  // ── Update profile table ──────────────────────────────────
  const profilePatch: Record<string, unknown> = {}
  if (patch.full_name !== undefined) profilePatch.full_name = patch.full_name
  if (patch.phone     !== undefined) profilePatch.phone     = patch.phone

  if (Object.keys(profilePatch).length > 0) {
    const { error } = await supabase.from('users').update(profilePatch).eq('id', id)
    if (error) throw new Error(error.message)
  }

  // ── Update membership role ────────────────────────────────
  if (patch.role !== undefined) {
    const companyId = getStoredCompanyId()
    if (companyId) {
      const { error } = await supabase
        .from('memberships')
        .update({ role: patch.role })
        .eq('user_id', id)
        .eq('company_id', companyId)
      if (error) throw new Error(error.message)
    }
  }

  // ── Return refreshed record ───────────────────────────────
  const companyId = getStoredCompanyId()
  const { data, error } = await supabase
    .from('memberships')
    .select(`
      user_id, role, created_at,
      users ( id, email, full_name, phone, created_at ),
      companies ( name )
    `)
    .eq('user_id', id)
    .eq('company_id', companyId ?? '')
    .single()

  if (error) throw new Error(error.message)
  return toUser(data as unknown as MembershipRow)
}

/**
 * Remove user from the active company (membership only).
 * Their Supabase auth account is NOT deleted.
 * Calls the remove_member SECURITY DEFINER RPC.
 */
export async function deleteUser(id: string): Promise<void> {
  if (!USE_SUPABASE) {
    _mockStore = _mockStore.filter((u) => u.id !== id)
    return
  }

  const companyId = getStoredCompanyId()
  if (!companyId) throw new Error('Aktif şirket seçili değil')

  const { error } = await supabase.rpc('remove_member', {
    p_user_id:    id,
    p_company_id: companyId,
  })
  if (error) throw new Error(error.message)
}
