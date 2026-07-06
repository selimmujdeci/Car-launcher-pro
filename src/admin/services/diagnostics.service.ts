/**
 * diagnostics.service.ts — Erişilebilir tanı okuma (super_admin GEREKTİRMEZ).
 *
 * getRemoteIncidents (superadmin.service) doğrudan vehicle_events'i okur →
 * super_admin RLS policy'sine takılır. Bu servis, migration 025'teki
 * get_recent_diagnostics SECURITY DEFINER RPC'sini çağırır: sıradan girişli
 * (authenticated) bir admin, super_admin claim'i olmadan tanı verisini görür.
 * Yalnız 4 tanı tipi döner; payload cihazda + görüntülemede sanitize edilir.
 */

import { supabase } from '../lib/supabaseClient'
import {
  INCIDENT_TYPES,
  type IncidentEntry,
  type IncidentType,
  type IncidentFilter,
  type IncidentQueryResult,
} from './superadmin.service'

export { INCIDENT_TYPES }
export type { IncidentEntry, IncidentType, IncidentFilter, IncidentQueryResult }

/**
 * Son tanı kayıtlarını RPC üzerinden döner (getRemoteIncidents ile AYNI
 * imza + dönüş tipi — IncidentCenter bileşeni loader olarak kullanabilir).
 * Sıralama created_at DESC; hata IncidentQueryResult.error'da (sessiz [] değil).
 */
export async function getRecentDiagnostics(filter: IncidentFilter = {}): Promise<IncidentQueryResult> {
  try {
    const { data, error } = await supabase.rpc('get_recent_diagnostics', {
      p_type:        filter.type       ?? null,
      p_vehicle_id:  filter.vehicleId  ?? null,
      p_app_version: filter.appVersion ?? null,
      p_since:       filter.since      ?? null,
      p_until:       filter.until      ?? null,
      p_limit:       filter.limit      ?? 50,
      p_offset:      filter.offset     ?? 0,
    })
    if (error) return { rows: [], error: error.message }
    return { rows: (data ?? []) as IncidentEntry[], error: null }
  } catch (e) {
    return { rows: [], error: e instanceof Error ? e.message : 'unknown_error' }
  }
}
