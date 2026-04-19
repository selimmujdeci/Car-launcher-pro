import { useState, useEffect } from 'react';
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
  const { settings } = useStore();

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
