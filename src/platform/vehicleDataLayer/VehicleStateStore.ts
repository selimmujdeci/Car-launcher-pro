import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { openRearCamera, closeRearCamera } from '../cameraService';
import type { VehicleState } from './types';
import { safeStorage } from '../../utils/safeStorage';

interface VehicleStore extends VehicleState {
  odometer: number;
  updateVehicle: (patch: Partial<VehicleState>) => void;
}

// 4s write throttle — eMMC write protection (automotive grade)
let _pendingWrite: (() => void) | null = null;
let _writeTimer: ReturnType<typeof setTimeout> | null = null;

const throttledStorage = createJSONStorage(() => ({
  getItem: (name: string) => safeStorage.getItem(name),
  setItem: (name: string, value: string) => {
    _pendingWrite = () => safeStorage.setItem(name, value);
    if (!_writeTimer) {
      _writeTimer = setTimeout(() => {
        _writeTimer = null;
        _pendingWrite?.();
        _pendingWrite = null;
      }, 4000);
    }
  },
  removeItem: (name: string) => safeStorage.removeItem(name),
}));

export const useVehicleStore = create<VehicleStore>()(
  persist(
    (set, get) => ({
      speed: 0,
      reverse: false,
      fuel: null,
      heading: null,
      location: null,
      odometer: 0,

      updateVehicle(patch) {
        const cur = get();
        const changed = (Object.keys(patch) as Array<keyof VehicleState>).some(
          (k) => cur[k as keyof VehicleStore] !== patch[k as keyof typeof patch],
        );
        if (!changed) return;

        if ('reverse' in patch && patch.reverse !== cur.reverse) {
          if (patch.reverse) {
            openRearCamera();
          } else {
            closeRearCamera();
          }
        }

        set(patch);
      },
    }),
    {
      name: 'car-launcher-vehicle-state',
      storage: throttledStorage,
      partialize: (state) => ({ odometer: state.odometer }),
    },
  ),
);
