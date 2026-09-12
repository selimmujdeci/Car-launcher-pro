/**
 * egoSources.ts — NAV v3 · L2 · SENSÖR OKUMA KATMANI (F2).
 *
 * Belge: `CAROS-NAV-ARCH-SPEC-3.0` §F2.1 · CLAUDE.md `<x>Sources.ts` deseni.
 *
 * ── SÖZLEŞME ──────────────────────────────────────────────────────────────
 *  · SENKRON tek okuma. **Timer YOK · abonelik YOK · ağ YOK · scheduler YOK ·
 *    React YOK.** Hiçbir sağlayıcıyı BAŞLATMAZ/DURDURMAZ/TETİKLEMEZ.
 *  · Her okuma kendi `try/catch`inde — bir kaynak patlarsa L2 çökmez, o alan
 *    `null` (kanıt yok) olur.
 *  · **Ham sağlayıcı SAHİPLENMEZ:** `navigator.geolocation` · Capacitor ·
 *    `watchPosition` · `addEventListener` bu dosyada YOKTUR. Yalnız MEVCUT
 *    otoriteler okunur:
 *      `gpsService.getLocationEvidence()` — G1 tek konum kanıt otoritesi
 *      `UnifiedVehicleStore.speed`        — füzyonlanmış araç hızı (VDL)
 *      `navClock.readMonotonicNow()`      — NAV v3 monotonik saat noktası
 *
 * ── JİRO (F3: C1 borcu kapandı) ──────────────────────────────────────────
 * `yawRateRadPerSec` artık runtime kenarındaki `navOrientationFeed`ten
 * SENKRON okunur. Bu dosya hâlâ hiçbir abonelik AÇMAZ: kapının ömrü tik
 * sahibinindir (F2 kilidi K2 + K11 korunur). Besleme yoksa/işaret
 * kanıtlanmadıysa değer `null` kalır ve EKF bunu dürüstçe "jiro kanıtı yok"
 * olarak işler (yön belirsizliği büyür).
 */

import type { EgoSensorPort, EgoSensorSample } from './egoSensorPort';
import { UNAVAILABLE_EGO_SAMPLE } from './egoSensorPort';
import type { EgoPositionProducer } from './egoModeModel';
import { readMonotonicNow } from '../time/navClock';
import { getLocationEvidence } from '../../gpsService';
import { useUnifiedVehicleStore } from '../../vehicleDataLayer/UnifiedVehicleStore';
import { readYawRate } from '../navOrientationFeed';

function _num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** Sapma hızı (rad/s). Kaynak/işaret kanıtı yoksa `null` — sahte 0 YASAK. */
function _readYawRateRadPerSec(nowMonoMs: number | null): number | null {
  try {
    return readYawRate(nowMonoMs).radPerSec;
  } catch {
    return null;
  }
}

/** Araç bus hızı (km/h → m/s). Kaynak yoksa `null` — sahte 0 ÜRETİLMEZ. */
function _readBusSpeedMps(): number | null {
  try {
    const kmh = useUnifiedVehicleStore.getState()?.speed;
    const v = _num(kmh);
    return v === null || v < 0 ? null : v / 3.6;
  } catch {
    return null;
  }
}

export const productionEgoSensorPort: EgoSensorPort = {
  read(): EgoSensorSample {
    const nowMonoMs = readMonotonicNow();

    let lat: number | null = null;
    let lon: number | null = null;
    let accuracyM: number | null = null;
    let fixAgeMs: number | null = null;
    let producer: EgoPositionProducer = 'NONE';
    let hasEverFixed = false;
    let gnssHeadingDeg: number | null = null;
    let gnssSpeedMps: number | null = null;

    try {
      const ev = getLocationEvidence();
      lat = _num(ev?.lat);
      lon = _num(ev?.lng);
      accuracyM = _num(ev?.accuracyM);
      fixAgeMs = _num(ev?.fixAgeMs);
      gnssHeadingDeg = _num(ev?.headingDeg);
      gnssSpeedMps = _num(ev?.speedMs);
      const src = ev?.source;
      producer = (src === 'GPS' || src === 'DEAD_RECKONING') ? src : 'NONE';
      /* "Hiç fix alındı mı" için UYDURMA yapılmaz: fix yaşı ölçülebiliyorsa
         en az bir fix gelmiştir (otoritenin kendi sözleşmesi). */
      hasEverFixed = fixAgeMs !== null && lat !== null && lon !== null;
    } catch {
      return { ...UNAVAILABLE_EGO_SAMPLE, nowMonoMs };
    }

    return {
      nowMonoMs,
      lat, lon, accuracyM, fixAgeMs, producer, hasEverFixed,
      gnssHeadingDeg, gnssSpeedMps,
      busSpeedMps: _readBusSpeedMps(),
      /* Jiro: yalnız OKUMA — abonelik kenarda (`navOrientationFeed`). Kanıt
         yoksa `null` döner; uydurma sapma hızı ÜRETİLMEZ. */
      yawRateRadPerSec: _readYawRateRadPerSec(nowMonoMs),
    };
  },
};
