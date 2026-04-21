import { supabase } from '../lib/supabaseClient'
import type { Role } from '../types'

export interface Company {
  id:           string
  name:         string
  slug:         string
  is_active:    boolean
  created_at:   string
  member_count: number
}

export interface CompanyMember {
  user_id:    string
  full_name:  string
  email:      string
  role:       Role
  joined_at:  string
}

export interface CreateCompanyDTO {
  name: string
  slug: string
}

// ── Companies ─────────────────────────────────────────────────────────────────

export async function listAllCompanies(): Promise<Company[]> {
  const { data, error } = await supabase
    .from('companies')
    .select('id, name, slug, is_active, created_at, memberships(count)')
    .order('created_at', { ascending: false })

  if (error) throw new Error(error.message)

  return (data ?? []).map((row) => ({
    id:           row.id as string,
    name:         row.name as string,
    slug:         row.slug as string,
    is_active:    (row.is_active ?? true) as boolean,
    created_at:   row.created_at as string,
    member_count: (row.memberships as unknown as { count: number }[])?.[0]?.count ?? 0,
  }))
}

export async function createCompany(dto: CreateCompanyDTO): Promise<Company> {
  const { data, error } = await supabase
    .from('companies')
    .insert({ name: dto.name, slug: dto.slug })
    .select('id, name, slug, is_active, created_at')
    .single()

  if (error) throw new Error(error.message)

  return { ...(data as Company), member_count: 0 }
}

export async function setCompanyActive(id: string, is_active: boolean): Promise<void> {
  const { error } = await supabase
    .from('companies')
    .update({ is_active })
    .eq('id', id)

  if (error) throw new Error(error.message)
}

export async function deleteCompany(id: string): Promise<void> {
  const { error } = await supabase
    .from('companies')
    .delete()
    .eq('id', id)

  if (error) throw new Error(error.message)
}

// ── Members ───────────────────────────────────────────────────────────────────

export async function listCompanyMembers(companyId: string): Promise<CompanyMember[]> {
  const { data, error } = await supabase
    .from('memberships')
    .select('role, created_at, users(id, full_name, email)')
    .eq('company_id', companyId)
    .order('created_at', { ascending: true })

  if (error) throw new Error(error.message)

  return (data ?? []).map((row) => {
    const u = row.users as unknown as { id: string; full_name: string; email: string } | null
    return {
      user_id:   u?.id ?? '',
      full_name: u?.full_name ?? '',
      email:     u?.email ?? '',
      role:      row.role as Role,
      joined_at: row.created_at as string,
    }
  })
}

export async function assignUserByEmail(
  companyId: string,
  email:     string,
  role:      Role,
): Promise<void> {
  const { data: userRow, error: userErr } = await supabase
    .from('users')
    .select('id')
    .eq('email', email)
    .single()

  if (userErr || !userRow) throw new Error('Kullanıcı bulunamadı: ' + email)

  const { error } = await supabase
    .from('memberships')
    .insert({ user_id: (userRow as { id: string }).id, company_id: companyId, role })

  if (error) throw new Error(error.message)
}

export async function updateMemberRole(
  userId:    string,
  companyId: string,
  role:      Role,
): Promise<void> {
  const { error } = await supabase
    .from('memberships')
    .update({ role })
    .eq('user_id', userId)
    .eq('company_id', companyId)

  if (error) throw new Error(error.message)
}

export async function removeMember(userId: string, companyId: string): Promise<void> {
  const { error } = await supabase
    .from('memberships')
    .delete()
    .eq('user_id', userId)
    .eq('company_id', companyId)

  if (error) throw new Error(error.message)
}

// ── Util ──────────────────────────────────────────────────────────────────────

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
}
