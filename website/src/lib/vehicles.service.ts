import { getSupabaseBrowserClient } from '@/lib/supabaseBrowser';
import { formatLastSeen } from '@/lib/utils';
import type { LiveVehicle } from '@/types/realtime';

interface VehicleRow {
  id: string;
  plate: string | null;
  name: string | null;
  driver_name: string | null;
  odometer_km: number | null;
  company_id: string;
}

interface LocationRow {
  vehicle_id: string;
  lat: number;
  lng: number;
  created_at: string;
}

interface TelemetryRow {
  vehicle_id: string;
  speed: number | null;
  fuel: number | null;
  temp: number | null;
  rpm: number | null;
  updated_at: string;
}

export async function fetchVehicles(): Promise<LiveVehicle[]> {
  const supabase = getSupabaseBrowserClient();

  const { data: vehicles, error: vehiclesError } = await supabase
    .from('vehicles')
    .select('id, plate, name, driver_name, odometer_km, company_id')
    .order('created_at', { ascending: false });
  if (vehiclesError) throw vehiclesError;

  const rows = (vehicles ?? []) as VehicleRow[];
  const ids = rows.map((v) => v.id);
  if (ids.length === 0) return [];

  const [{ data: locations, error: locationsError }, { data: telemetry, error: telemetryError }] = await Promise.all([
    supabase
      .from('vehicle_locations')
      .select('vehicle_id, lat, lng, created_at')
      .in('vehicle_id', ids)
      .order('created_at', { ascending: false }),
    supabase
      .from('vehicle_telemetry')
      .select('vehicle_id, speed, fuel, temp, rpm, updated_at')
      .in('vehicle_id', ids),
  ]);

  if (locationsError) throw locationsError;
  if (telemetryError) throw telemetryError;

  const latestLocationByVehicle = new Map<string, LocationRow>();
  for (const location of (locations ?? []) as LocationRow[]) {
    if (!latestLocationByVehicle.has(location.vehicle_id)) {
      latestLocationByVehicle.set(location.vehicle_id, location);
    }
  }

  const latestTelemetryByVehicle = new Map<string, TelemetryRow>();
  for (const event of (telemetry ?? []) as TelemetryRow[]) {
    if (!latestTelemetryByVehicle.has(event.vehicle_id)) {
      latestTelemetryByVehicle.set(event.vehicle_id, event);
    }
  }

  return rows.map((vehicle): LiveVehicle => {
    const loc = latestLocationByVehicle.get(vehicle.id);
    const tel = latestTelemetryByVehicle.get(vehicle.id);
    const timestamp = new Date(tel?.updated_at ?? loc?.created_at ?? 0).getTime();

    return {
      id: vehicle.id,
      plate: vehicle.plate ?? vehicle.id,
      name: vehicle.name ?? 'Araç',
      driver: vehicle.driver_name ?? '—',
      status: timestamp > 0 && Date.now() - timestamp < 10_000 ? 'online' : 'offline',
      lat: loc?.lat ?? 0,
      lng: loc?.lng ?? 0,
      speed: tel?.speed ?? 0,
      fuel: tel?.fuel ?? 0,
      engineTemp: tel?.temp ?? 0,
      rpm: tel?.rpm ?? 0,
      odometer: vehicle.odometer_km ?? 0,
      location: '—',
      lastSeen: formatLastSeen(timestamp),
      lastTimestamp: Number.isFinite(timestamp) ? timestamp : 0,
    };
  });
}
