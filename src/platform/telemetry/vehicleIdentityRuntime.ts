/**
 * vehicleIdentityRuntime.ts — KİMLİK KOORDİNATÖRÜNÜN CANLI TEKİLİ.
 *
 * Koordinatörü gerçek bağımlılıklarla (ağ ucu + zamanlayıcı) kurar ve
 * canlı üreticiye (`AutomaticVehicleFingerprint`) bağlanacak TEK giriş
 * fonksiyonunu ihraç eder.
 *
 * Bu dosya İNCEDİR: politika `vehicleIdentityObservation.ts` (saf) ve
 * `vehicleIdentityCoordinator.ts` (durum makinesi) içindedir. Burada
 * yalnız kablolama var — böylece politika testleri gerçek ağ/timer
 * olmadan koşulabilir.
 */

import { telemetryService } from '../telemetryService';
import {
  VehicleIdentityCoordinator,
  type IdentityCoordinatorSnapshot,
} from './vehicleIdentityCoordinator';
import type { BuildIdentityInput } from './vehicleIdentityObservation';

/**
 * Uygulama geneli TEK kimlik koordinatörü.
 *
 * `publish` doğrudan `telemetryService.publishIdentityObservation`'a bağlıdır
 * — kimliğin sunucuya çıkan TEK yolu budur.
 */
export const vehicleIdentityCoordinator = new VehicleIdentityCoordinator({
  publish: (obs) => telemetryService.publishIdentityObservation(obs),
  now: () => Date.now(),
  setTimer: (fn, ms) => setTimeout(fn, ms),
  clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
});

/**
 * Kimlik kanıtı bildirir — canlı üreticinin çağırdığı TEK fonksiyon.
 *
 * SENKRON ve fail-soft: `observe()` ağ çağrısı yapmaz, yayını mikrotask'a
 * atar. Bu yüzden zustand abonelik yolundan güvenle çağrılabilir.
 */
export function observeVehicleIdentity(input: BuildIdentityInput): void {
  vehicleIdentityCoordinator.observe(input);
}

/** CAROS LAB salt-okur — hiçbir şey BAŞLATMAZ. */
export function readIdentityCoordinatorSnapshot(): IdentityCoordinatorSnapshot {
  return vehicleIdentityCoordinator.getSnapshot();
}

/** Kapatma (zero-leak) — SystemBoot cleanup zincirinden çağrılır. */
export function stopVehicleIdentityCoordinator(): void {
  vehicleIdentityCoordinator.stop();
}
