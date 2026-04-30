/**
 * VehicleEventHub — Main thread dinleyici katmanı.
 *
 * Histerezis mantığı VehicleCompute.worker'a taşındı.
 * Bu modül yalnızca:
 *   • Dış abonelerin kayıt olduğu listener kümesini tutar  (onVehicleEvent)
 *   • Worker'dan gelen olayları abonelere dağıtır           (dispatchFromWorker)
 *   • MaintenanceBrain + BlackBoxService gibi harici        (dispatchMaintenanceRequired,
 *     servislerin doğrudan olay yaymasına izin verir         dispatchCrashDetected)
 *
 * Listener uyarısı: Geri çağrı fonksiyonu event nesnesinin REFERANSINI alır.
 * Worker tarafı pre-allocated nesneleri bir sonraki olayda mutate eder.
 * Kalıcı saklamak için shallow copy alın: `{ ...event }`.
 */

/* ── Olay türleri & öncelik seviyeleri ───────────────────────── */

export type VehicleEventType =
  | 'DRIVING_STARTED'
  | 'DRIVING_STOPPED'
  | 'LOW_FUEL'
  | 'CRITICAL_FUEL'
  | 'REVERSE_ENGAGED'
  | 'REVERSE_DISENGAGED'
  | 'MAINTENANCE_REQUIRED'
  | 'CRASH_DETECTED'
  | 'GEOFENCE_ENTER'
  | 'GEOFENCE_EXIT';

export type EventSeverity = 'CRITICAL' | 'WARNING' | 'INFO';

export type VehicleEvent =
  | { type: 'DRIVING_STARTED';      severity: 'INFO';     speedKmh:    number; ts: number }
  | { type: 'DRIVING_STOPPED';      severity: 'INFO';     speedKmh:    number; ts: number }
  | { type: 'LOW_FUEL';             severity: 'WARNING';  fuelPct:     number; ts: number }
  | { type: 'CRITICAL_FUEL';        severity: 'CRITICAL'; fuelPct:     number; ts: number }
  | { type: 'REVERSE_ENGAGED';      severity: 'CRITICAL'; ts: number }
  | { type: 'REVERSE_DISENGAGED';   severity: 'CRITICAL'; ts: number }
  | { type: 'MAINTENANCE_REQUIRED'; severity: 'WARNING';  healthScore: number; ts: number }
  | { type: 'CRASH_DETECTED';       severity: 'CRITICAL'; peakG:       number; ts: number }
  | { type: 'GEOFENCE_ENTER';       severity: 'INFO';     zoneId: string; zoneName: string; ts: number }
  | { type: 'GEOFENCE_EXIT';        severity: 'CRITICAL'; zoneId: string; zoneName: string; ts: number };

/* ── Modül-düzeyi listener kümesi ────────────────────────────── */

const _listeners = new Set<(e: VehicleEvent) => void>();

function _dispatch(event: VehicleEvent): void {
  _listeners.forEach((fn) => fn(event));
}

/**
 * Araç semantik olaylarına abone ol.
 * Dönen fonksiyon aboneliği iptal eder.
 */
export function onVehicleEvent(fn: (e: VehicleEvent) => void): () => void {
  _listeners.add(fn);
  return () => { _listeners.delete(fn); };
}

/**
 * VehicleSignalResolver tarafından çağrılır: worker'dan gelen VEHICLE_EVENT
 * mesajlarını tüm abonelere iletir.
 * Paket-içi erişim; dışarıdan çağrılmamalı.
 */
export function dispatchFromWorker(event: VehicleEvent): void {
  _dispatch(event);
}

/* ── Dışarıdan dispatch — harici servisler için ─────────────── */

const _evMaintenanceRequired: Extract<VehicleEvent, { type: 'MAINTENANCE_REQUIRED' }> =
  { type: 'MAINTENANCE_REQUIRED', severity: 'WARNING', healthScore: 0, ts: 0 };

/** MaintenanceBrain tarafından çağrılır. */
export function dispatchMaintenanceRequired(healthScore: number): void {
  _evMaintenanceRequired.healthScore = healthScore;
  _evMaintenanceRequired.ts          = Date.now();
  _dispatch(_evMaintenanceRequired);
}

const _evCrashDetected: Extract<VehicleEvent, { type: 'CRASH_DETECTED' }> =
  { type: 'CRASH_DETECTED', severity: 'CRITICAL', peakG: 0, ts: 0 };

/** BlackBoxService darbe eşiğini aştığında tüm abonelere CRASH_DETECTED yayar. */
export function dispatchCrashDetected(peakG: number): void {
  _evCrashDetected.peakG = peakG;
  _evCrashDetected.ts    = Date.now();
  _dispatch(_evCrashDetected);
}
