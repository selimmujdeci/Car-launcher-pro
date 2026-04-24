import { DEFAULT_GEOFENCES, TIMING } from './constants';
import type { GeofenceZone, VehicleUpdate } from '@/types/realtime';

// Ray-casting point-in-polygon
function pointInPolygon(lat: number, lng: number, polygon: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [latI, lngI] = polygon[i];
    const [latJ, lngJ] = polygon[j];
    const intersect =
      lngI > lng !== lngJ > lng &&
      lat < ((latJ - latI) * (lng - lngI)) / (lngJ - lngI) + latI;
    if (intersect) inside = !inside;
  }
  return inside;
}

// Haversine distance in meters
function metersBetween(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function isInsideZone(lat: number, lng: number, zone: GeofenceZone): boolean {
  if (zone.type === 'polygon' && zone.polygon) {
    return pointInPolygon(lat, lng, zone.polygon);
  }
  if (zone.type === 'circle' && zone.center && zone.radius) {
    return metersBetween(lat, lng, zone.center[0], zone.center[1]) <= zone.radius;
  }
  return true;
}

export class GeofenceEngine {
  private zones: GeofenceZone[];
  // vehicleId → zoneId → wasInside (null = first check, assume inside)
  private vehicleZoneState = new Map<string, Map<string, boolean>>();
  // last fired time per vehicle+zone pair
  private lastFired = new Map<string, number>();

  constructor(zones: GeofenceZone[] = DEFAULT_GEOFENCES) {
    this.zones = zones;
  }

  /** Returns name of zone exited, or null */
  check(update: VehicleUpdate): string | null {
    const { vehicleId, lat, lng } = update;

    if (!this.vehicleZoneState.has(vehicleId)) {
      this.vehicleZoneState.set(vehicleId, new Map());
    }
    const zoneStates = this.vehicleZoneState.get(vehicleId)!;

    for (const zone of this.zones) {
      const inside = isInsideZone(lat, lng, zone);
      const wasInside = zoneStates.get(zone.id) ?? true; // assume inside on first seen

      zoneStates.set(zone.id, inside);

      if (wasInside && !inside) {
        const key = `${vehicleId}:${zone.id}`;
        const lastTime = this.lastFired.get(key) ?? 0;
        if (Date.now() - lastTime >= TIMING.GEOFENCE_DEBOUNCE_MS) {
          this.lastFired.set(key, Date.now());
          return zone.name;
        }
      }
    }

    return null;
  }
}
