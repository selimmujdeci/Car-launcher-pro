/**
 * Rich GPS fix — gpsService'ten gelen tam nesne.
 * UnifiedVehicleStore.location, geofence servisi ve harita bileşenleri bu tipi kullanır.
 * speed: m/s (GPS Doppler hız)
 */
export interface GPSLocation {
  latitude:  number;
  longitude: number;
  accuracy:  number;
  altitude?: number;
  heading?:  number;
  speed?:    number;    // m/s
  timestamp: number;
}

export interface CanAdapterData {
  speed?: number;
  reverse?: boolean;
  fuel?: number;
  doorOpen?: boolean;
  headlightsOn?: boolean;
  tpms?: number[];
}

export interface ObdAdapterData {
  speed?: number;
  fuel?: number;
  /** Motor devri (RPM). EV veya desteklenmeyen PID için undefined. */
  rpm?: number;
  reverse?: boolean;
  /** Araç kümülatif kilometre sayacı (km). Varsa GPS hesabına göre önceliklidir. */
  totalDistance?: number;
}

export interface GpsAdapterData {
  speed?: number;
  heading?: number;
  location?: { lat: number; lng: number; accuracy: number };
}

export interface VehicleState {
  /** km/h — null: sensör yok/bağlantı kesildi; 0: araç duruyor */
  speed: number | null;
  reverse: boolean;
  fuel: number | null;
  /** Motor devri (RPM) — yalnızca SAB zero-copy kanalı üzerinden gelir; postMessage yolunda undefined */
  rpm?: number;
  heading: number | null;
  location: { lat: number; lng: number; accuracy: number } | null;
  /** OBD odometer (km) — mevcut olduğunda maintenance için Source of Truth */
  odometer?: number;
}

/**
 * Worker'a gönderilen geofence zona tanımı.
 * center: [lat, lng] tuple; radiusM: metre cinsinden yarıçap.
 * polygon: [lat, lng] çiftlerinden oluşan poligon köşeleri.
 */
export interface WorkerGeofenceZone {
  id:       string;
  name:     string;
  type:     'polygon' | 'circle';
  polygon?: [number, number][];
  center?:  [number, number];
  radiusM?: number;
}
