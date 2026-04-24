'use client';

import { useEffect } from 'react';
import { createRealtimeEngine } from '@/lib/realtimeEngine';
import { NotificationEngine } from '@/lib/notificationEngine';
import { useVehicleStore } from '@/store/vehicleStore';
import { useNotificationStore } from '@/store/notificationStore';

export function useRealtime(): void {
  useEffect(() => {
    const notifEngine = new NotificationEngine();
    const vehicleState = useVehicleStore.getState();

    const engine = createRealtimeEngine({
      onUpdate: (update) => {
        const state = useVehicleStore.getState();
        const existing = state.vehicles[update.vehicleId];
        if (!existing) return;
        state.applyUpdate(update);
        const events = notifEngine.process(update, existing);
        if (events.length > 0) useNotificationStore.getState().addNotifications(events);
      },
      onConnectionChange: (status) => useVehicleStore.getState().setConnectionStatus(status),
    });

    void vehicleState.initializeFromSupabase().then(() => {
      engine.setVehicleIds(Object.keys(useVehicleStore.getState().vehicles));
      engine.connect();
    });

    const stopWatchdog = useVehicleStore.getState().startWatchdog();

    return () => {
      engine.disconnect();
      stopWatchdog();
    };
  }, []);
}
