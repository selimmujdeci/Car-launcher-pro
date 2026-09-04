/**
 * drivingContextSources.ts — MUSIC F8 · Bağlam sinyallerinin TEK okuma katmanı.
 *
 * Desen A3–A8 turlarıyla aynıdır: senkron getter'lar, her biri kendi
 * try/catch'i içinde, hiçbir şey başlatmaz, timer kurmaz, komut göndermez.
 *
 * OTORİTE SINIRI (Cross-Domain §2 · §10): buradaki hiçbir değer BURADA
 * üretilmez. Hız `UnifiedVehicleStore`un, yolculuk `tripLogService`in,
 * rehberlik `navigationService`in truth'udur; bu modül YALNIZ okur.
 *
 * GİZLİLİK: koordinat · hedef adı · adres · rota geometrisi BU KATMANDAN
 * GEÇMEZ. Navigasyondan yalnız "rehberlik sürüyor mu", "kalan mesafe kaç
 * metre" ve "bu mesafe rota boyu mu ölçüldü" okunur.
 */

import { useUnifiedVehicleStore } from '../../vehicleDataLayer/UnifiedVehicleStore';
import { getTripSnapshot } from '../../tripLogService';
import { getNavigationState } from '../../navigationService';
import type { DrivingContextInput, MotionClass } from './drivingContextModel';

function safe<T>(read: () => T, fallback: T): T {
  try {
    const v = read();
    return v === undefined ? fallback : v;
  } catch {
    return fallback;
  }
}

/** Kanonik araç hızı (km/h) — ölçülemiyorsa `null` (sahte 0 YOK). */
export function readVehicleSpeedKmh(): number | null {
  return safe(() => {
    const v = useUnifiedVehicleStore.getState().speed;
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
  }, null);
}

export interface TripReading {
  readonly active: boolean;
  readonly durationMin: number | null;
  readonly distanceKm: number | null;
}

/** Açık yolculuğun süresi/mesafesi — kayıt yoksa `active:false` (uydurma yok). */
export function readTrip(): TripReading {
  return safe<TripReading>(() => {
    const snap = getTripSnapshot();
    if (!snap.active || !snap.current) {
      return Object.freeze({ active: false, durationMin: null, distanceKm: null });
    }
    const durationMin = typeof snap.current.liveDurationMin === 'number'
      && Number.isFinite(snap.current.liveDurationMin) ? snap.current.liveDurationMin : null;
    const distanceKm = typeof snap.current.liveDistanceKm === 'number'
      && Number.isFinite(snap.current.liveDistanceKm) ? snap.current.liveDistanceKm : null;
    return Object.freeze({ active: true, durationMin, distanceKm });
  }, Object.freeze({ active: false, durationMin: null, distanceKm: null }));
}

export interface GuidanceReading {
  readonly active: boolean;
  readonly remainingMeters: number | null;
  /** `false` = kuş uçuşu TAHMİN (kütük #404) — uzun yol kanıtı sayılmaz. */
  readonly routeMeasured: boolean;
}

/**
 * Rehberlik okuması.
 *
 * `isNavigating` KULLANILMAZ: sahada `PREVIEW` durumunda da `true` olduğu
 * ölçüldü (kütük #416/#418). Rehberlik iddiası yalnız `isGuidanceActive`tir.
 */
export function readGuidance(): GuidanceReading {
  return safe<GuidanceReading>(() => {
    const nav = getNavigationState();
    if (nav.isGuidanceActive !== true) {
      return Object.freeze({ active: false, remainingMeters: null, routeMeasured: false });
    }
    const meters = typeof nav.distanceMeters === 'number' && Number.isFinite(nav.distanceMeters)
      ? nav.distanceMeters : null;
    /* Kaynak bildirilmemişse veya kuş uçuşuysa ÖLÇÜM sayılmaz (fail-closed). */
    const routeMeasured = nav.distanceSource === 'ALONG_ROUTE';
    return Object.freeze({ active: true, remainingMeters: meters, routeMeasured });
  }, Object.freeze({ active: false, remainingMeters: null, routeMeasured: false }));
}

/** Yerel saat (0–23) — okunamazsa `null`. */
export function readLocalHour(nowMs?: number): number | null {
  return safe(() => {
    const d = nowMs === undefined ? new Date() : new Date(nowMs);
    const h = d.getHours();
    return Number.isInteger(h) ? h : null;
  }, null);
}

/**
 * Modelin beklediği girdiyi TEK turda toplar.
 *
 * Bu fonksiyon HOT PATH DEĞİLDİR: yalnız dinleme oturumu değiştiğinde veya
 * müzik yüzeyi değerlendirme istediğinde çağrılır (F8 timer KURMAZ).
 */
export function readDrivingContextInput(
  previousMotion: MotionClass = 'UNKNOWN', nowMs?: number,
): DrivingContextInput {
  const trip = readTrip();
  const guidance = readGuidance();
  return Object.freeze({
    speedKmh: readVehicleSpeedKmh(),
    tripActive: trip.active,
    tripDurationMin: trip.durationMin,
    tripDistanceKm: trip.distanceKm,
    guidanceActive: guidance.active,
    remainingMeters: guidance.remainingMeters,
    remainingIsRouteMeasured: guidance.routeMeasured,
    localHour: readLocalHour(nowMs),
    previousMotion,
  });
}
