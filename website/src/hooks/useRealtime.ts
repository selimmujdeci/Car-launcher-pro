'use client';

import { useEffect } from 'react';
import { createRealtimeEngine } from '@/lib/realtimeEngine';
import { NotificationEngine } from '@/lib/notificationEngine';
import { useVehicleStore } from '@/store/vehicleStore';
import { useNotificationStore } from '@/store/notificationStore';

export function useRealtime(): void {
  useEffect(() => {
    const notifEngine  = new NotificationEngine();
    const vehicleState = useVehicleStore.getState();

    // 1. Instant local load — shows the paired vehicle immediately, no auth needed
    vehicleState.initializeFromLocal();

    const engine = createRealtimeEngine({
      onUpdate: (update) => {
        const state    = useVehicleStore.getState();
        const existing = state.vehicles[update.vehicleId];
        if (!existing) return;
        state.applyUpdate(update);
        const events = notifEngine.process(update, existing);
        if (events.length > 0) useNotificationStore.getState().addNotifications(events);
      },
      onConnectionChange: (status) =>
        useVehicleStore.getState().setConnectionStatus(status),
    });

    // 2. Try Supabase in background — enriches data if user is logged in
    void vehicleState.initializeFromSupabase()
      .then(() => {
        const ids = Object.keys(useVehicleStore.getState().vehicles);
        if (ids.length > 0) {
          engine.setVehicleIds(ids);
          engine.connect();
        }
      })
      .catch(() => {
        // No auth / offline — local data is already displayed, no action needed
      });

    const stopWatchdog = useVehicleStore.getState().startWatchdog();

    return () => {
      engine.disconnect();
      stopWatchdog();
    };
  }, []);
}
