/**
 * vehicleEvidenceBus.ts — NAV v3 · ARAÇ KANIT BUS'I SINIRI (SAF · F0 · YALNIZ ARAYÜZ).
 *
 * Belge: `CAROS-NAV-ARCH-SPEC-3.0` §F0/9.
 *
 * SAF: I/O YOK · timer YOK · `Date.now` YOK · React YOK · modül durumu YOK.
 *
 * ── AMAÇ ─────────────────────────────────────────────────────────────────
 * Navigasyonun araç bus'ından (CAN/OBD) ihtiyaç duyduğu sinyaller için TEK
 * salt-okunur SINIR. Bu dosya:
 *  · yalnız ARAYÜZ tanımlar — gerçek acquisition implementasyonu YOK,
 *  · `VEHICLE_BUS` kaynağından gelen `Evidenced<number>` döndürür,
 *  · acquisition confidence'ı NAVİGASYON TARAFINDA YENİDEN HESAPLAMAZ —
 *    bus'ın verdiği `grade`/`confidence` OLDUĞU GİBİ taşınır,
 *  · acquisition authority henüz bağlanmadıysa FAIL-CLOSED: her okuma
 *    `UNAVAILABLE` döner (`UNAVAILABLE_VEHICLE_EVIDENCE_BUS`).
 *
 * ── BU FAZDA YAPILMAYAN ──────────────────────────────────────────────────
 * CAN mimarisi DEĞİŞTİRİLMEZ. Gerçek bus adaptörü (mevcut VDL / signalHub /
 * canonicalVehicleSignal otoritelerini SARAN) ayrı bir fazda, bu arayüzü
 * uygulayarak eklenir.
 */

import type { Evidenced } from './navEvidence';
import { unavailableNav } from './navEvidence';

/** Navigasyonun araç bus'ından okuduğu sinyaller (yalnız gerekli olanlar). */
export type VehicleEvidenceSignalId =
  | 'SPEED_MPS'          // araç hızı (ego füzyonu için — OBD ölçeği bus tarafında)
  | 'WHEEL_SPEED_MPS'    // tekerlek hızı (ZUPT / kayma tespiti)
  | 'YAW_RATE_DPS'       // sapma hızı (DR / IMU köprüsü)
  | 'LONG_ACCEL_MPS2'    // boylamsal ivme
  | 'GEAR'               // vites (reverse / park tespiti)
  | 'PARK_BRAKE'         // el freni (ZUPT güçlendirme)
  | 'ODOMETER_M';        // toplam yol (menzil / öğrenme temeli)

export const VEHICLE_EVIDENCE_SIGNAL_IDS: readonly VehicleEvidenceSignalId[] = [
  'SPEED_MPS', 'WHEEL_SPEED_MPS', 'YAW_RATE_DPS', 'LONG_ACCEL_MPS2',
  'GEAR', 'PARK_BRAKE', 'ODOMETER_M',
] as const;

export interface VehicleEvidenceReading {
  readonly signal: VehicleEvidenceSignalId;
  /** Değer + kanıt. `grade` bus'tan gelir; navigasyonda YENİDEN HESAPLANMAZ. */
  readonly value: Evidenced<number>;
}

/**
 * Salt-okunur araç kanıt bus'ı sınırı. `read` senkron ve saf-görünümlüdür
 * (uygulama tarafı son okunan snapshot'ı döndürür; navigasyon burada I/O
 * BEKLEMEZ).
 */
export interface VehicleEvidenceBus {
  read(signal: VehicleEvidenceSignalId): VehicleEvidenceReading;
}

/**
 * FAIL-CLOSED varsayılan bus. Acquisition authority bağlanana kadar HER okuma
 * `UNAVAILABLE` döner — "sinyal yok" ile "sinyal 0" ASLA karıştırılmaz.
 */
export const UNAVAILABLE_VEHICLE_EVIDENCE_BUS: VehicleEvidenceBus = {
  read(signal: VehicleEvidenceSignalId): VehicleEvidenceReading {
    return { signal, value: unavailableNav<number>('VEHICLE_BUS', 'NO_SOURCE') };
  },
};

/** Verilen değerin geçerli bir sinyal kimliği olup olmadığı (guard yardımcı). */
export function isVehicleEvidenceSignalId(v: unknown): v is VehicleEvidenceSignalId {
  return typeof v === 'string'
    && (VEHICLE_EVIDENCE_SIGNAL_IDS as readonly string[]).includes(v);
}
