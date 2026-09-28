/**
 * Active-profile vehicle type bridge. `obdService` remains the sole
 * vehicleType owner; the settings store only reports "the active profile's
 * type is X". A static store → obdService import closed a 91-module import
 * cycle (see importCycleGuard). Same pattern as obdEpochReader. Unbound → no-op.
 */
import type { VehicleType } from '../obdTypes';

let _sink: ((type: VehicleType) => void) | null = null;

export function bindActiveVehicleTypeSink(sink: (type: VehicleType) => void): void {
  _sink = sink;
}

export function noteActiveVehicleType(type: VehicleType): void {
  _sink?.(type);
}
