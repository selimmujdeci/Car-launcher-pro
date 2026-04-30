/**
 * useSystemStore — Araç olaylarından türetilen uygulama-düzeyi UI durumu.
 *
 * Sadece SystemOrchestrator yazabilir; UI bileşenleri yalnızca okur.
 * (dismiss gibi kullanıcı eylemleri istisnadır.)
 *
 * Persist edilmez — her oturum taze başlar.
 */

import { create } from 'zustand';
import type { TripRecord } from '../platform/tripLogService';

/* ── Alert tipi ──────────────────────────────────────────── */

export type AlertSeverity = 'WARNING' | 'CRITICAL';
export type AlertEventType = 'LOW_FUEL' | 'CRITICAL_FUEL' | 'MAINTENANCE_REQUIRED' | 'CRASH_DETECTED';

export interface SystemAlert {
  id:         number;
  type:       AlertEventType;
  severity:   AlertSeverity;
  label:      string;
  sublabel:   string;
  ts:         number;
  suppressed: boolean; // true = geri vites aktifken gizlendi, yakında geri gelecek
}

/* ── Store arayüzü ───────────────────────────────────────── */

interface SystemState {
  /* Araç durumu */
  isReverseActive:   boolean;
  isDriving:         boolean;

  /* Navigasyon — Orchestrator'dan tetikleyici sinyal */
  navOpenTrigger:    number; // her increment = "haritayı aç"

  /* Uyarılar */
  activeAlerts:      SystemAlert[];

  /* Trip özeti */
  showTripSummary:   boolean;
  lastCompletedTrip: TripRecord | null;

  /* Manuel override — otomatik Gün/Gece + Parlaklık'ı bloke eder */
  userOverrideUntil: number; // epoch ms; 0 = aktif değil

  /* Geofence ihlali alarmı */
  geofenceAlarm: { zoneId: string; zoneName: string; ts: number } | null;

  /* Theater Mode */
  isTheaterModeActive: boolean;
  setTheaterMode: (v: boolean) => void;

  /* ── Yalnızca Orchestrator'ın çağırdığı aksiyonlar ── */
  setReverse:          (v: boolean) => void;
  setDriving:          (v: boolean) => void;
  triggerNavOpen:      () => void;
  addAlert:            (data: Omit<SystemAlert, 'id' | 'suppressed'>) => void;
  suppressNonCritical: () => void;
  unsuppressAll:       () => void;
  setTripSummary:      (trip: TripRecord) => void;

  /* ── UI bileşenlerinin çağırabileceği aksiyonlar ── */
  dismissAlert:     (id: number) => void;
  closeTripSummary: () => void;
  /** Otomatik Gün/Gece + Parlaklık sistemini durationMs boyunca sustur. */
  setUserOverride:  (durationMs: number) => void;
  setGeofenceAlarm: (alarm: { zoneId: string; zoneName: string; ts: number } | null) => void;
}

let _alertSeq = 0;

export const useSystemStore = create<SystemState>()((set) => ({
  isReverseActive:   false,
  isDriving:         false,
  navOpenTrigger:    0,
  activeAlerts:      [],
  showTripSummary:   false,
  lastCompletedTrip: null,
  userOverrideUntil: 0,
  geofenceAlarm:       null,
  isTheaterModeActive: false,

  setReverse:  (v) => set({ isReverseActive: v }),
  setDriving:  (v) => set({ isDriving: v }),
  triggerNavOpen: () => set((s) => ({ navOpenTrigger: s.navOpenTrigger + 1 })),

  addAlert: (data) => set((s) => ({
    activeAlerts: [...s.activeAlerts, { ...data, id: ++_alertSeq, suppressed: false }],
  })),

  dismissAlert: (id) => set((s) => ({
    activeAlerts: s.activeAlerts.filter((a) => a.id !== id),
  })),

  suppressNonCritical: () => set((s) => ({
    activeAlerts: s.activeAlerts.map((a) =>
      a.severity === 'CRITICAL' ? a : { ...a, suppressed: true },
    ),
  })),

  unsuppressAll: () => set((s) => ({
    activeAlerts: s.activeAlerts.map((a) =>
      a.suppressed ? { ...a, suppressed: false } : a,
    ),
  })),

  setTripSummary:   (trip) => set({ lastCompletedTrip: trip, showTripSummary: true }),
  closeTripSummary: ()     => set({ showTripSummary: false }),
  setUserOverride:  (durationMs) => set({ userOverrideUntil: Date.now() + durationMs }),
  setGeofenceAlarm: (alarm)      => set({ geofenceAlarm: alarm }),
  setTheaterMode:   (v)          => set({ isTheaterModeActive: v }),
}));
