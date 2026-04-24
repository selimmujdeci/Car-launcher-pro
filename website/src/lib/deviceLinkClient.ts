import { supabaseBrowser } from './supabase';
import type { LiveVehicle } from '@/types/realtime';

async function authHeader(): Promise<Record<string, string>> {
  if (!supabaseBrowser) return {};
  const { data } = await supabaseBrowser.auth.getSession();
  const token = data.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export interface LinkedVehicle {
  id: string;
  name: string;
  device_id?: string;
  plate?: string;
  role?: string;
  created_at?: string;
}

/** Enter a 6-digit pairing code from the vehicle display. */
export async function linkVehicle(code: string): Promise<LinkedVehicle> {
  const headers = await authHeader();

  const res = await fetch('/api/vehicle/link', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ code }),
  });

  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? 'Bağlama başarısız.');

  return json.vehicle as LinkedVehicle;
}

/** Fetch all vehicles linked to the currently logged-in user. */
export async function fetchMyVehicles(): Promise<LinkedVehicle[]> {
  const headers = await authHeader();

  const res = await fetch('/api/vehicles', { headers });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? 'Araçlar alınamadı.');

  return (json.vehicles ?? []) as LinkedVehicle[];
}

/** Convert a LinkedVehicle from the API to a full LiveVehicle for the store. */
export function toLiveVehicle(v: LinkedVehicle): LiveVehicle {
  return {
    id:            v.id,
    name:          v.name ?? 'Araç',
    plate:         v.plate ?? v.device_id ?? v.id,
    driver:        '—',
    status:        'offline',
    lat:           0,
    lng:           0,
    speed:         0,
    fuel:          0,
    engineTemp:    0,
    rpm:           0,
    odometer:      0,
    location:      '—',
    lastSeen:      'Bilinmiyor',
    lastTimestamp: 0,
  };
}
