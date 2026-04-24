import { ALERT_THRESHOLDS, TIMING } from './constants';
import { GeofenceEngine } from './geofenceEngine';
import { generateId } from './utils';
import type { VehicleUpdate, NotificationEvent, LiveVehicle } from '@/types/realtime';

export class NotificationEngine {
  private lastFired = new Map<string, number>(); // `${vehicleId}:${type}` → timestamp
  private geofence = new GeofenceEngine();

  private canFire(vehicleId: string, type: string): boolean {
    const key = `${vehicleId}:${type}`;
    const last = this.lastFired.get(key) ?? 0;
    if (Date.now() - last < TIMING.ALERT_DEBOUNCE_MS) return false;
    this.lastFired.set(key, Date.now());
    return true;
  }

  process(update: VehicleUpdate, vehicle: LiveVehicle): NotificationEvent[] {
    const events: NotificationEvent[] = [];
    const { vehicleId, speed, fuel, engineTemp } = update;
    const plate = vehicle.plate;

    // Speed rule
    if (speed > ALERT_THRESHOLDS.SPEED_LIMIT_KMH && this.canFire(vehicleId, 'speed')) {
      events.push({
        id: generateId(),
        vehicleId,
        plate,
        type: 'speed',
        message: `${plate} — Hız limiti aşıldı (${Math.round(speed)} km/h)`,
        severity: speed > 110 ? 'critical' : 'warning',
        timestamp: Date.now(),
        read: false,
      });
    }

    // Fuel rule
    if (fuel < ALERT_THRESHOLDS.FUEL_LOW_PCT && this.canFire(vehicleId, 'fuel')) {
      events.push({
        id: generateId(),
        vehicleId,
        plate,
        type: 'fuel',
        message: `${plate} — Yakıt seviyesi kritik (%${Math.round(fuel)})`,
        severity: fuel < 5 ? 'critical' : 'warning',
        timestamp: Date.now(),
        read: false,
      });
    }

    // Engine temp rule
    if (engineTemp > ALERT_THRESHOLDS.ENGINE_TEMP_HIGH_C && this.canFire(vehicleId, 'temp')) {
      events.push({
        id: generateId(),
        vehicleId,
        plate,
        type: 'temp',
        message: `${plate} — Motor sıcaklığı kritik (${Math.round(engineTemp)}°C)`,
        severity: engineTemp > 115 ? 'critical' : 'warning',
        timestamp: Date.now(),
        read: false,
      });
    }

    // Geofence rule
    const exitedZone = this.geofence.check(update);
    if (exitedZone && this.canFire(vehicleId, 'geofence')) {
      events.push({
        id: generateId(),
        vehicleId,
        plate,
        type: 'geofence',
        message: `${plate} — "${exitedZone}" bölgesi dışına çıktı`,
        severity: 'info',
        timestamp: Date.now(),
        read: false,
      });
    }

    return events;
  }
}
