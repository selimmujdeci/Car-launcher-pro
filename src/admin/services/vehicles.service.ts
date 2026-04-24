/**
 * vehicles.service — Fleet vehicle CRUD via Supabase.
 *
 * listVehicles(companyId?):
 *   1. Queries company vehicles (RLS: memberships → company_id).
 *   2. Merges with device-linked vehicles from vehicleLinking.service.
 *   Falls back to MOCK_VEHICLES when Supabase is not configured.
 *
 * updateVehicle / deleteVehicle:
 *   Direct Supabase mutations. RLS enforces operator+ for update,
 *   admin+ for delete (see initial_schema migration policies).
 */

import { supabase }             from '../lib/supabaseClient'
import { listLinkedVehicles }   from './vehicleLinking.service'
import type { Vehicle, FuelType, VehicleStatus } from '../types'
import { MOCK_VEHICLES }        from './mock.data'

const USE_SUPABASE = Boolean(import.meta.env.VITE_SUPABASE_URL)

/* ── DB row shape ────────────────────────────────────────────── */

interface VehicleRow {
  id:          string
  plate:       string | null
  brand:       string | null
  model:       string | null
  year:        number | null
  fuel_type:   string | null
  status:      string
  current_km:  number
  ins_expiry:  string | null
  created_at:  string
  speed:       number | null
  last_seen:   string | null
  device_name: string | null
  // PostgREST returns embedded relations as arrays (even for to-one FK)
  users:       Array<{ full_name: string }> | null
  companies:   Array<{ name: string }>      | null
}

function toVehicle(row: VehicleRow): Vehicle {
  return {
    id:          row.id,
    plate:       row.plate      ?? '—',
    brand:       row.brand      ?? '—',
    model:       row.model      ?? '',
    year:        row.year       ?? new Date().getFullYear(),
    fuel_type:   (row.fuel_type ?? 'diesel') as FuelType,
    status:      row.status     as VehicleStatus,
    current_km:  row.current_km,
    driver_name: row.users?.[0]?.full_name    ?? undefined,
    institution: row.companies?.[0]?.name     ?? undefined,
    speed:       row.speed      ?? undefined,
    last_seen:   row.last_seen  ?? undefined,
    ins_expiry:  row.ins_expiry ?? undefined,
    created_at:  row.created_at,
  }
}

/* ── Patch: map Vehicle fields → DB columns ─────────────────── */

function toPatch(patch: Partial<Vehicle>): Record<string, unknown> {
  const db: Record<string, unknown> = {}
  if (patch.status     !== undefined) db.status      = patch.status
  if (patch.current_km !== undefined) db.current_km  = patch.current_km
  if (patch.plate      !== undefined) db.plate       = patch.plate
  if (patch.brand      !== undefined) db.brand       = patch.brand
  if (patch.model      !== undefined) db.model       = patch.model
  if (patch.year       !== undefined) db.year        = patch.year
  if (patch.fuel_type  !== undefined) db.fuel_type   = patch.fuel_type
  if (patch.ins_expiry !== undefined) db.ins_expiry  = patch.ins_expiry
  return db
}

/* ── Mock fallback store ─────────────────────────────────────── */

let _mockStore: Vehicle[] = [...MOCK_VEHICLES]

/* ── Public API ─────────────────────────────────────────────── */

/**
 * List vehicles the current user is authorised to see.
 * Combines company fleet (via memberships) with device-linked vehicles.
 *
 * @param companyId  Active company UUID from useRole context.
 *                   Omit to let RLS filter automatically (returns all companies).
 */
export async function listVehicles(companyId?: string): Promise<Vehicle[]> {
  if (!USE_SUPABASE) return [..._mockStore]

  // ── Company vehicles ──────────────────────────────────────
  let q = supabase
    .from('vehicles')
    .select(`
      id, plate, brand, model, year, fuel_type, status, current_km,
      ins_expiry, created_at, speed, last_seen, device_name,
      users ( full_name ),
      companies ( name )
    `)
    .not('company_id', 'is', null)    // company-registered fleet only
    .order('created_at', { ascending: false })

  if (companyId) q = q.eq('company_id', companyId)

  const { data, error } = await q
  if (error) throw new Error(error.message)

  const companyVehicles = (data as unknown as VehicleRow[]).map(toVehicle)

  // ── Device-linked vehicles (merge, deduplicate) ───────────
  const linkedVehicles = await listLinkedVehicles()
  const seen = new Set(companyVehicles.map((v) => v.id))

  return [
    ...companyVehicles,
    ...linkedVehicles.filter((v) => !seen.has(v.id)),
  ]
}

/**
 * Update vehicle fields. Supabase RLS requires operator+ role.
 * Returns the updated Vehicle with joined driver/company data.
 */
export async function updateVehicle(id: string, patch: Partial<Vehicle>): Promise<Vehicle> {
  if (!USE_SUPABASE) {
    const idx = _mockStore.findIndex((v) => v.id === id)
    if (idx === -1) throw new Error('Araç bulunamadı')
    _mockStore[idx] = { ..._mockStore[idx], ...patch }
    return _mockStore[idx]
  }

  const { data, error } = await supabase
    .from('vehicles')
    .update(toPatch(patch))
    .eq('id', id)
    .select(`
      id, plate, brand, model, year, fuel_type, status, current_km,
      ins_expiry, created_at, speed, last_seen, device_name,
      users ( full_name ),
      companies ( name )
    `)
    .single()

  if (error) throw new Error(error.message)
  return toVehicle(data as unknown as VehicleRow)
}

/**
 * Delete vehicle. Supabase RLS requires admin+ role.
 */
export async function deleteVehicle(id: string): Promise<void> {
  if (!USE_SUPABASE) {
    _mockStore = _mockStore.filter((v) => v.id !== id)
    return
  }

  const { error } = await supabase.from('vehicles').delete().eq('id', id)
  if (error) throw new Error(error.message)
}
