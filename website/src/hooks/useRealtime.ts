'use client';

import { useEffect } from 'react';
import { createRealtimeEngine } from '@/lib/realtimeEngine';
import { NotificationEngine } from '@/lib/notificationEngine';
import { useVehicleStore } from '@/store/vehicleStore';
import { useNotificationStore } from '@/store/notificationStore';

export function useRealtime(): void {
  useEffect(() => {
    const notifEngine = new NotificationEngine();

    // Pass vehicle IDs so SupabaseRealtimeEngine subscribes only to the user's vehicles
    const vehicleIds = Object.keys(useVehicleStore.getState().vehicles);

    const engine = createRealtimeEngine({
      onUpdate: (update) => {
        const vehicleState = useVehicleStore.getState();
        const existing = vehicleState.vehicles[update.vehicleId];
        if (!existing) return;

        // Apply vehicle update to store
        vehicleState.applyUpdate(update);

        // Run notification rules against updated state
        const events = notifEngine.process(update, existing);
        if (events.length > 0) {
          useNotificationStore.getState().addNotifications(events);
        }
      },
      onConnectionChange: (status) => {
        useVehicleStore.getState().setConnectionStatus(status);
      },
    }, vehicleIds);

    engine.connect();
    const stopWatchdog = useVehicleStore.getState().startWatchdog();

    return () => {
      engine.disconnect();
      stopWatchdog();
    };
  }, []);
}
