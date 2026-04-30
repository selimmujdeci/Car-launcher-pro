/**
 * geofenceService (Security) — Supabase kaynaklı geofence izleme servisi.
 *
 * Akış:
 *   1. Bağlı araç ID'sini sensitiveKeyStore'dan al
 *   2. Supabase'den vehicle_geofences tablosunu çek
 *   3. Zona listesini Worker'a gönder (updateGeofenceZones)
 *   4. VehicleEventHub'dan GEOFENCE_EXIT / GEOFENCE_ENTER dinle
 *   5. EXIT → useSystemStore.geofenceAlarm set → GeofenceAlarmOverlay tetikler
 *
 * Offline Security:
 *   Zonalar bir kez Worker'a yüklendikten sonra internet kesilse bile
 *   Worker içinde denetim kesintisiz devam eder.
 *
 * Performance:
 *   Worker'daki _checkGeofences() yalnızca speed > 0 iken çalışır.
 */

import { onVehicleEvent }        from '../vehicleDataLayer/VehicleEventHub';
import { updateGeofenceZones }   from '../vehicleDataLayer/index';
import { sensitiveKeyStore }     from '../sensitiveKeyStore';
import { getSupabaseClient }     from '../supabaseClient';
import { useSystemStore }        from '../../store/useSystemStore';
import { speakAlert }            from '../ttsService';
import { logError }              from '../crashLogger';
import type { WorkerGeofenceZone } from '../vehicleDataLayer/types';

// ── Sabitler ──────────────────────────────────────────────────────────────────

const TABLE      = 'vehicle_geofences';
const RETRY_MS   = 60_000; // Çekme başarısız olursa 1 dk sonra tekrar dene

// ── Modül state ───────────────────────────────────────────────────────────────

let _active       = false;
let _unsubEvent:  (() => void) | null = null;
let _retryTimer:  ReturnType<typeof setTimeout> | null = null;

// ── Supabase'den zona çekme ────────────────────────────────────────────────────

interface SupabaseZoneRow {
  id:       string;
  name:     string;
  type:     'polygon' | 'circle';
  polygon?: unknown;   // [[lat, lng], ...]
  center?:  unknown;   // [lat, lng]
  radius_m?: number;
  is_active?: boolean;
}

async function _fetchZones(vehicleId: string): Promise<WorkerGeofenceZone[]> {
  const supabase = getSupabaseClient();
  if (!supabase) return [];
  const { data, error } = await supabase
    .from(TABLE)
    .select('id, name, type, polygon, center, radius_m, is_active')
    .eq('vehicle_id', vehicleId)
    .eq('is_active', true);

  if (error) throw error;
  if (!data || data.length === 0) return [];

  return (data as SupabaseZoneRow[]).map((row) => ({
    id:      row.id,
    name:    row.name,
    type:    row.type,
    polygon: Array.isArray(row.polygon) ? (row.polygon as [number, number][]) : undefined,
    center:  Array.isArray(row.center)  ? (row.center  as [number, number])   : undefined,
    radiusM: typeof row.radius_m === 'number' ? row.radius_m : undefined,
  }));
}

// ── İhlal işleyicisi ──────────────────────────────────────────────────────────

function _onGeofenceExit(zoneId: string, zoneName: string, ts: number): void {
  useSystemStore.getState().setGeofenceAlarm({ zoneId, zoneName, ts });
  speakAlert(`Güvenlik uyarısı: Araç ${zoneName} bölgesinden ayrıldı.`);
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function startGeofenceService(): Promise<() => void> {
  if (_active) return stopGeofenceService;
  _active = true;

  // VehicleEventHub aboneliği
  _unsubEvent = onVehicleEvent((e) => {
    if (!_active) return;
    if (e.type === 'GEOFENCE_EXIT') {
      _onGeofenceExit(e.zoneId, e.zoneName, e.ts);
    }
    // GEOFENCE_ENTER: şimdilik sadece logla (opsiyonel bildirim)
  });

  // Zona yükle
  await _loadAndPushZones();

  return stopGeofenceService;
}

async function _loadAndPushZones(): Promise<void> {
  if (!_active) return;
  try {
    const vehicleId = await sensitiveKeyStore.get('veh_vehicle_id');
    if (!vehicleId) return; // Araç bağlı değil

    const zones = await _fetchZones(vehicleId);
    updateGeofenceZones(zones);
  } catch (e) {
    logError('geofenceService:_loadAndPushZones', e);
    // Hata durumunda 1 dk sonra tekrar dene
    if (_active) {
      _retryTimer = setTimeout(() => {
        _retryTimer = null;
        void _loadAndPushZones();
      }, RETRY_MS);
    }
  }
}

export function stopGeofenceService(): void {
  if (!_active) return;
  _active = false;
  _unsubEvent?.(); _unsubEvent = null;
  if (_retryTimer) { clearTimeout(_retryTimer); _retryTimer = null; }
  // Worker'a boş liste gönder → geofence deaktif
  updateGeofenceZones([]);
}

/**
 * Zona listesini harici olarak güncelle (yerel ayarlardan, ör: SecuritySuite).
 * Internet bağlantısı olmasa bile çağrılabilir.
 */
export function pushLocalZones(zones: WorkerGeofenceZone[]): void {
  updateGeofenceZones(zones);
}
