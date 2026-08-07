import type { VehicleFreshness } from '@/lib/fleet/vehicleTelemetryFreshness';

export type VehicleStatus = 'online' | 'offline' | 'alarm';

// Raw telemetry packet from vehicle
export interface VehicleUpdate {
  vehicleId: string;
  lat: number;
  lng: number;
  speed: number;
  fuel: number;
  engineTemp: number;
  rpm: number;
  timestamp: number;
}

// Full in-memory vehicle state (superset of Vehicle — compatible with existing components)
export interface LiveVehicle {
  id: string;
  plate: string;
  name: string;
  driver: string;
  status: VehicleStatus;
  lat: number;
  lng: number;
  speed: number;
  fuel: number;
  engineTemp: number;
  rpm: number;
  odometer: number;
  location: string;
  lastSeen: string;     // formatted string for display
  lastTimestamp: number; // raw ms for offline detection
  batteryVoltage?: number; // OBD akü voltajı (V)
  /**
   * ÖLÇÜM GERÇEĞİ — `null` = BİLİNMİYOR (0 DEĞİL).
   *
   * Yukarıdaki `speed/fuel/engineTemp/rpm/lat/lng` alanları 92 çağrı yerinin
   * geriye uyumluluğu için sayısal KALIR; ancak bunlar bilinmeyeni `0` ile
   * dolduran ESKİ yüzeydir ve KULLANICIYA GÖSTERİLMEZ. Kullanıcıya dönük her
   * ekran bu alanı okur: burada `null` gerçekten "veri yok", `0` gerçekten
   * ölçülmüş sıfırdır ve her sinyalin tazeliği/kaynağı ayrı taşınır.
   *
   * Okunamadıysa `undefined` (eski davranışa düşülür, yalan söylenmez).
   */
  telemetry?: VehicleFreshness;
}

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'error';

export type NotificationType = 'speed' | 'fuel' | 'temp' | 'geofence';
export type NotificationSeverity = 'info' | 'warning' | 'critical';

export interface NotificationEvent {
  id: string;
  vehicleId: string;
  plate: string;
  type: NotificationType;
  message: string;
  severity: NotificationSeverity;
  timestamp: number;
  read: boolean;
}

export interface GeofenceZone {
  id: string;
  name: string;
  type: 'polygon' | 'circle';
  polygon?: [number, number][]; // [lat, lng][]
  center?: [number, number];
  radius?: number; // meters
}
