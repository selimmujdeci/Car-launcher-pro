import { supabase } from '../lib/supabaseClient'
import type { Role } from '../types'

export interface MembershipRecord {
  company_id:   string
  company_name: string
  role:         Role
}

export async function fetchUserMemberships(userId: string): Promise<MembershipRecord[]> {
  const { data, error } = await supabase
    .from('memberships')
    .select('company_id, role, companies(name)')
    .eq('user_id', userId)

  if (error) throw new Error(error.message)

  return (data ?? []).map((row) => ({
    company_id:   row.company_id as string,
    company_name: (row.companies as unknown as { name: string } | null)?.name ?? '',
    role:         row.role as Role,
  }))
}

const ACTIVE_COMPANY_KEY = 'adm_active_company'

export function getStoredCompanyId(): string | null {
  return localStorage.getItem(ACTIVE_COMPANY_KEY)
}

export function storeCompanyId(id: string): void {
  localStorage.setItem(ACTIVE_COMPANY_KEY, id)
}

export function resolveActiveMembership(
  memberships: MembershipRecord[],
  preferredId?: string | null,
): MembershipRecord | null {
  if (!memberships.length) return null
  const preferred = preferredId
    ? memberships.find((m) => m.company_id === preferredId)
    : null
  return preferred ?? memberships[0]
}
