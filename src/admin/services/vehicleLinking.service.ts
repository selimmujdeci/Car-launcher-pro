/**
 * vehicleLinking.service — Admin panel side of the device linking flow.
 *
 * linkVehicleByCode: user enters 6-digit code from vehicle display → backend
 *   validates it (60s window, single-use) → creates vehicle_users record.
 *
 * listLinkedVehicles: returns vehicles the current user is linked to.
 *
 * subscribeToVehicle: Supabase Realtime channel for live telemetry events.
 *
 * Falls back to in-memory mock when VITE_SUPABASE_URL is not configured.
 */

import { supabase } from '../lib/supabaseClient'
import type { LinkResult, Vehicle, VehicleEvent } from '../types'
import type { RealtimeChannel } from '@supabase/supabase-js'

const USE_SUPABASE = Boolean(import.meta.env.VITE_SUPABASE_URL)

/* ── Mock fallback ──────────────────────────────────────────── */

interface MockCodeEntry { vehicleId: string; expires: number; name: string }
const _mockCodes = new Map<string, MockCodeEntry>()

/** Test helper — register a mock linking code (bypasses real backend). */
export function __devRegisterMockCode(
  code: string,
  vehicleId: string,
  name = 'Mock Araç',
): void {
  _mockCodes.set(code, { vehicleId, expires: Date.now() + 60_000, name })
}

/* ── Core service ───────────────────────────────────────────── */

/**
 * Attempt to link the current user to a vehicle using the 6-digit code
 * displayed on the Android device.
 */
export async function linkVehicleByCode(code: string): Promise<LinkResult> {
  const trimmed = code.trim().replace(/\s/g, '')
  if (!/^\d{6}$/.test(trimmed)) throw new Error('Kod 6 haneli bir sayı olmalıdır')

  if (!USE_SUPABASE) {
    const entry = _mockCodes.get(trimmed)
    if (!entry || Date.now() > entry.expires) {
      throw new Error('Geçersiz veya süresi dolmuş bağlama kodu')
    }
    _mockCodes.delete(trimmed)
    return { vehicle_id: entry.vehicleId, name: entry.name }
  }

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) throw new Error('Araç bağlamak için oturum açmanız gerekiyor')

  const { data, error } = await supabase.rpc('link_vehicle', {
    p_linking_code: trimmed,
    p_user_id:      user.id,
  })
  if (error) throw new Error(error.message)
  const res = data as { vehicle_id: string; name: string; plate?: string; brand?: string; model?: string; device_id?: string }
  return {
    vehicle_id: res.vehicle_id,
    name:       res.name ?? 'Araç',
    plate:      res.plate,
    brand:      res.brand,
    model:      res.model,
    device_id:  res.device_id,
  }
}

/**
 * Fetch all vehicles the current user is linked to.
 * RLS on the vehicles table enforces this automatically.
 */
export async function listLinkedVehicles(): Promise<Vehicle[]> {
  if (!USE_SUPABASE) return []

  const { data, error } = await supabase
    .from('vehicles')
    .select('id, plate, brand, model, year, fuel_type, status, current_km, ins_expiry, created_at, speed, last_seen, device_name')
    .not('device_id', 'is', null)    // device-registered vehicles only
    .order('created_at', { ascending: false })

  if (error) throw new Error(error.message)
  return (data ?? []) as unknown as Vehicle[]
}

/**
 * Subscribe to realtime telemetry events for a specific vehicle.
 * The callback fires whenever the Android device pushes a new event.
 * Call the returned unsubscribe() on component unmount.
 */
export function subscribeToVehicleEvents(
  vehicleId: string,
  onEvent: (event: VehicleEvent) => void,
): () => void {
  if (!USE_SUPABASE) return () => {}

  let channel: RealtimeChannel | null = supabase
    .channel(`vehicle-events-${vehicleId}`)
    .on(
      'postgres_changes',
      {
        event:  'INSERT',
        schema: 'public',
        table:  'events',
        filter: `vehicle_id=eq.${vehicleId}`,
      },
      (payload) => {
        onEvent(payload.new as VehicleEvent)
      },
    )
    .subscribe()

  return () => {
    if (channel) {
      supabase.removeChannel(channel)
      channel = null
    }
  }
}
