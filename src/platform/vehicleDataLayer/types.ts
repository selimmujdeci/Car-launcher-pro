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
  reverse?: boolean;
}

export interface GpsAdapterData {
  speed?: number;
  heading?: number;
  location?: { lat: number; lng: number; accuracy: number };
}

export interface VehicleState {
  speed: number;
  reverse: boolean;
  fuel: number | null;
  heading: number | null;
  location: { lat: number; lng: number; accuracy: number } | null;
  /** OBD odometer (km) — mevcut olduğunda maintenance için Source of Truth */
  odometer?: number;
}
