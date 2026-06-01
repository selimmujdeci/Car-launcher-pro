import { useState, useEffect } from 'react';
import { useShallow } from 'zustand/react/shallow';
import {
  onVehicleDetection,
  getVehicleDetectionSnapshot,
  type VehicleDetectionState,
} from '../platform/vehicleProfileService';
import { useStore } from '../store/useStore';
import type { VehicleProfile } from '../store/useStore';

export interface VehicleProfileState {
  activeProfile: VehicleProfile | null;
  isDetected: boolean;
  matchMethod: VehicleDetectionState['matchMethod'];
  lastCheckedAt: number;
}

export function useVehicleProfile(): VehicleProfileState {
  const [detection, setDetection] = useState<VehicleDetectionState>(
    getVehicleDetectionSnapshot,
  );
  // Narrow selector: araç profili dışındaki store güncellemelerinde re-render olmaz.
  const settings = useStore(useShallow((s) => ({
    vehicleProfiles:        s.settings.vehicleProfiles,
    activeVehicleProfileId: s.settings.activeVehicleProfileId,
  })));

  useEffect(() => onVehicleDetection(setDetection), []);

  const activeProfile =
    settings.vehicleProfiles.find((p) => p.id === settings.activeVehicleProfileId) ?? null;

  return {
    activeProfile,
    isDetected: detection.detectedProfileId !== null,
    matchMethod: detection.matchMethod,
    lastCheckedAt: detection.lastCheckedAt,
  };
}
