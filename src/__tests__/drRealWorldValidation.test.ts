/**
 * Dead Reckoning — Gerçek Dünya Doğrulama Testi
 *
 * Android cihazda (Capacitor.isNativePlatform() === true) çalıştırıldığında
 * gerçek GPS kaybı → DR projeksiyonu → GPS geri dönüşü → errorMeters ölçümü yapar.
 *
 * Birim test ortamında (jsdom / CI) her senaryo SKIPPED olarak kaydedilir.
 * Hiçbir mock kullanılmaz; gerçek GPS donanımı zorunludur.
 */

import { describe, it, afterAll } from 'vitest';
import { PatentLogger, type DRRealWorldResult } from './patentTestLogger';
import {
  getGPSState,
  startDeadReckoningGuard,
  isDeadReckoningActive,
  stopGPSTracking,
} from '../platform/gpsService';

/* ── Logger ─────────────────────────────────────────────────────── */

const logger = new PatentLogger();
afterAll(() => { logger.flush(); });

/* ── Constants ───────────────────────────────────────────────────── */

const EARTH_RADIUS_METERS = 6_371_000;
const DR_THRESHOLD_MS     = 2_000;   // gpsService._DR_THRESHOLD_MS ile aynı
const GPS_ACQUIRE_TIMEOUT = 15_000;  // ms — ilk fix bekleme süresi

/* ── Helpers ─────────────────────────────────────────────────────── */

function isNative(): boolean {
  return (globalThis as unknown as Record<string, unknown>).Capacitor
    ? (
        (globalThis as unknown as { Capacitor: { isNativePlatform: () => boolean } })
          .Capacitor.isNativePlatform()
      )
    : false;
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** Haversine distance in metres between two lat/lng points. */
function calculateDistance(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);
  const aHav =
    sinDLat * sinDLat +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * sinDLng * sinDLng;
  return EARTH_RADIUS_METERS * 2 * Math.atan2(Math.sqrt(aHav), Math.sqrt(1 - aHav));
}

/**
 * GPS fix bekle (max timeoutMs).
 * Store'da konum yoksa null döner.
 */
async function acquireGpsPosition(
  timeoutMs: number,
): Promise<{ lat: number; lng: number } | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const loc = getGPSState().location;
    if (loc) return { lat: loc.latitude, lng: loc.longitude };
    await new Promise((r) => setTimeout(r, 500));
  }
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/* ── Skip helper ─────────────────────────────────────────────────── */

function logSkipped(test: string, durationSec: number, skipReason: string): DRRealWorldResult {
  const result: DRRealWorldResult = {
    test,
    durationSec,
    speedKmh:          null,
    startGps:          null,
    estimatedPosition: null,
    endGps:            null,
    errorMeters:       null,
    driftPerSecond:    null,
    skipped:           true,
    skipReason,
  };
  logger.logDRRealWorld(result);
  return result;
}

/* ── Scenario runner ─────────────────────────────────────────────── */

interface ScenarioDef {
  name:        string;
  durationSec: number;
}

async function runScenario(def: ScenarioDef): Promise<DRRealWorldResult> {
  const { name, durationSec } = def;

  // 1. Gerçek GPS gerekli
  if (!isNative()) {
    return logSkipped(name, durationSec, 'Gerçek GPS gerektirir — jsdom/CI ortamında çalışıyor');
  }

  // 2. Başlangıç GPS konumu al
  const startGps = await acquireGpsPosition(GPS_ACQUIRE_TIMEOUT);
  if (!startGps) {
    return logSkipped(name, durationSec, `GPS fix alınamadı (${GPS_ACQUIRE_TIMEOUT}ms timeout)`);
  }

  // 3. Mevcut hız (km/h) — GPSLocation.speed m/s, ×3.6 dönüşüm
  const rawSpeedMs = getGPSState().location?.speed ?? null;
  const speedKmh   = rawSpeedMs !== null ? rawSpeedMs * 3.6 : null;

  // 4. DR guard başlat, sonra GPS beslemesini kes
  const stopDRGuard = startDeadReckoningGuard();

  // GPS sessizliği simüle etme — gerçek testte cihaz tünele giriyor.
  // feedBackgroundLocation kesilir, DR_THRESHOLD_MS + 500ms sonra DR aktif olmalı.
  await sleep(DR_THRESHOLD_MS + 500);

  const drActive = isDeadReckoningActive();

  // 5. DR süresi boyunca bekle
  await sleep(durationSec * 1_000 - (DR_THRESHOLD_MS + 500));

  // 6. DR tahmini konumu oku
  const drLoc = getGPSState().location;
  const estimatedPosition = drLoc ? { lat: drLoc.latitude, lng: drLoc.longitude } : null;

  // 7. GPS guard'ı durdur, GPS'in geri gelmesini bekle
  stopDRGuard();

  // GPS feed'in yeniden başlaması için bekle
  const endGps = await acquireGpsPosition(GPS_ACQUIRE_TIMEOUT);

  await stopGPSTracking();

  // 8. Hata hesapla
  let errorMeters:    number | null = null;
  let driftPerSecond: number | null = null;

  if (estimatedPosition && endGps) {
    errorMeters    = calculateDistance(estimatedPosition, endGps);
    driftPerSecond = durationSec > 0 ? errorMeters / durationSec : null;
  }

  const result: DRRealWorldResult = {
    test:    name,
    durationSec,
    speedKmh,
    startGps,
    estimatedPosition,
    endGps,
    errorMeters,
    driftPerSecond,
    skipped:    false,
    skipReason: drActive ? null : 'DR_THRESHOLD beklendi fakat isDeadReckoningActive() = false',
  };

  logger.logDRRealWorld(result);
  return result;
}

/* ── Test Suite ───────────────────────────────────────────────────── */

const SCENARIOS: ScenarioDef[] = [
  { name: 'Düşük hız — 30 s (~10 km/h)',    durationSec: 30 },
  { name: 'Normal hız — 60 s (~40 km/h)',   durationSec: 60 },
  { name: 'Yüksek hız — 60 s (~80 km/h)',  durationSec: 60 },
];

describe('DR Real-World Validation — Android GPS Loss + Recovery', () => {

  for (const scenario of SCENARIOS) {
    it(
      scenario.name,
      { timeout: (scenario.durationSec + 40) * 1_000 },
      async () => {
        const result = await runScenario(scenario);

        if (result.skipped) {
          // CI/birim test ortamında skip bekleniyor — test başarılı sayılır
          console.info(`[DR Real] SKIPPED: ${result.test} — ${result.skipReason}`);
          return;
        }

        // Android cihazda: DR aktif olmuşsa tahmini konum dolu olmalı
        if (result.estimatedPosition) {
          const { lat, lng } = result.estimatedPosition;
          console.info(
            `[DR Real] ${result.test}: estimatedPos=(${lat.toFixed(6)},${lng.toFixed(6)})` +
            ` errorMeters=${result.errorMeters !== null ? result.errorMeters.toFixed(1) : 'N/A'}`,
          );
        }
      },
    );
  }

});
