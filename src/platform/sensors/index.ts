/**
 * platform/sensors — Cihaz sensör aboneliği kapıları (gate).
 *
 * Şu an yalnız Orientation Sensor Gate foundation'ı (PR 1) barındırır.
 * Tüketici wiring'i (gpsService compass, smartDrivingEngine, arAlignment, …)
 * AYRI PR'larda bu kapıya taşınır.
 */

export type {
  OrientationCallback,
  MotionCallback,
  Release,
  OrientationGateStatus,
  OrientationGateChannelStatus,
  OrientationGateSubscriberCounts,
} from './orientationSensorGate';

export {
  subscribeOrientationAbsolute,
  subscribeOrientation,
  subscribeMotion,
  getSubscriberCounts,
  getStatus,
  reset,
  dispose,
} from './orientationSensorGate';
