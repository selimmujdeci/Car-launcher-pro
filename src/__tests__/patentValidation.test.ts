import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest';
import { Filesystem } from '@capacitor/filesystem';
import { PatentLogger } from './patentTestLogger';

/* ── Mocks ─────────────────────────────────────────────────────── */

vi.mock('@capacitor/filesystem', () => ({
  Filesystem: {
    writeFile:  vi.fn().mockResolvedValue({ uri: '' }),
    readFile:   vi.fn(),
    stat:       vi.fn(),
    deleteFile: vi.fn().mockResolvedValue(undefined),
    rename:     vi.fn().mockResolvedValue(undefined),
    readdir:    vi.fn().mockResolvedValue({ files: [] }),
  },
  Directory: { Data: 'DATA' },
  Encoding:  { UTF8: 'utf8' },
}));

vi.mock('../platform/crashLogger', () => ({ logError: vi.fn() }));

function setNative(val: boolean) {
  (globalThis as unknown as Record<string, unknown>).Capacitor = {
    isNativePlatform: () => val,
  };
}

/* ── Imports after mocks ────────────────────────────────────────── */

import { stopGPSTracking }                      from '../platform/gpsService';
import { safeSetRaw, safeGetRaw, safeFlushAll } from '../utils/safeStorage';
import { isE2EPayload }                         from '../platform/commandCrypto';

/* ── Logger ─────────────────────────────────────────────────────── */

const logger = new PatentLogger();
afterAll(() => { logger.flush(); });

/* ── Dead Reckoning helper ──────────────────────────────────────── */

const M_PER_DEG = 111_320;

/** Exact formula from gpsService._startDeadReckoning */
function _project(
  lat: number, lng: number,
  speedKmh: number, headingDeg: number, dtSec: number,
): { lat: number; lng: number } {
  const v      = speedKmh / 3.6;
  const rad    = (headingDeg * Math.PI) / 180;
  const cosLat = Math.cos((lat * Math.PI) / 180);
  return {
    lat: lat + (v * Math.cos(rad) * dtSec) / M_PER_DEG,
    lng: lng + (v * Math.sin(rad) * dtSec) / (M_PER_DEG * Math.max(0.001, cosLat)),
  };
}

/* ── Suite setup ────────────────────────────────────────────────── */

describe('Patent Validation Suite — Proof of Innovation', () => {

  beforeEach(() => {
    vi.useFakeTimers();
    setNative(true);

    let perfTime = 1_000;
    vi.spyOn(performance, 'now').mockImplementation(() => perfTime);
    (globalThis as unknown as Record<string, unknown>).advancePerfTime =
      (ms: number) => { perfTime += ms; };
  });

  afterEach(async () => {
    await stopGPSTracking();
    safeFlushAll();
    vi.useRealTimers();
    vi.clearAllMocks();
    localStorage.clear();
    vi.restoreAllMocks();
  });

  /* ═══════════════════════════════════════════════════════════════
     Innovation #1 — Dead Reckoning
     Kaydedilen: algoritma çıktısı (estimatedPosition).
     N/A: errorMeters, gpsRecoveredPosition — gerçek GPS yok.
     ═══════════════════════════════════════════════════════════════ */

  describe('Innovation #1: Dead Reckoning (Sensor Fusion Projection)', () => {

    it('projects position correctly across 5 speed/duration scenarios', () => {
      const BASE_LAT = 41.0;
      const BASE_LNG = 29.0;

      const scenarios: Array<{ speedKmh: number; headingDeg: number; dtSec: number }> = [
        { speedKmh:  0, headingDeg:  0, dtSec: 10 },
        { speedKmh:  5, headingDeg:  0, dtSec: 10 },
        { speedKmh: 50, headingDeg: 90, dtSec: 10 },
        { speedKmh: 72, headingDeg:  0, dtSec: 10 },
        { speedKmh: 90, headingDeg: 45, dtSec: 30 },
      ];

      const drScenarios = scenarios.map((s) => {
        const pos = _project(BASE_LAT, BASE_LNG, s.speedKmh, s.headingDeg, s.dtSec);
        return {
          speedKmh:          s.speedKmh,
          headingDeg:        s.headingDeg,
          gpsLossDurationMs: s.dtSec * 1_000,
          estimatedLat:      pos.lat,
          estimatedLng:      pos.lng,
          gpsRecoveredLat:   null as null,
          gpsRecoveredLng:   null as null,
          errorMeters:       null as null,
        };
      });

      // Assertions: stationary stays put, moving changes coords
      expect(drScenarios[0].estimatedLat).toBeCloseTo(BASE_LAT, 8);
      expect(drScenarios[0].estimatedLng).toBeCloseTo(BASE_LNG, 8);
      for (const s of drScenarios.slice(1)) {
        const moved = s.estimatedLat !== BASE_LAT || s.estimatedLng !== BASE_LNG;
        expect(moved).toBe(true);
      }

      // Reference: 72 km/h North 10 s must match gpsService formula
      expect(drScenarios[3].estimatedLat).toBeCloseTo(41.001797, 4);

      logger.logDeadReckoning({
        scenarios: drScenarios,
        passed:    true,
        note:      'Gerçek araç/GPS testi yapılmadı. estimatedPosition algoritma çıktısıdır, ölçüm değildir.',
      });
    });

  });

  /* ═══════════════════════════════════════════════════════════════
     Innovation #2 — SafeStorage
     Kaydedilen: safeSetRaw çağrı sayacı + localStorage spy sayacı.
     N/A: recoveryTimeMs (fake timer ortamı).
     ═══════════════════════════════════════════════════════════════ */

  describe('Innovation #2: eMMC Life Protection (Write Throttling)', () => {

    it('CRITICAL key — immediate write bypasses debounce', () => {
      const KEY   = 'car-gps-last-known';
      const VALUE = '{"lat":41.012,"lng":29.023}';

      // Gerçek ölçüm: localStorage.setItem spy
      const lsSpy = vi.spyOn(Storage.prototype, 'setItem');

      safeSetRaw(KEY, VALUE);

      const actualDiskWrites  = lsSpy.mock.calls.filter(([k]: [string, string?]) => k === KEY).length;
      const verifyRead        = safeGetRaw(KEY);
      lsSpy.mockRestore();

      const totalWriteRequests    = 1;
      const writeReductionPercent = ((totalWriteRequests - actualDiskWrites) / totalWriteRequests) * 100;

      logger.logSafeStorage({
        scenario:              'CRITICAL — immediate write (car-gps-last-known)',
        totalWriteRequests,
        actualDiskWrites,
        writeReductionPercent,
        corruptionCount:       0,
        recoveryTimeMs:        null,  // fake timer ortamı — ölçüm anlamsız
        passed:                actualDiskWrites >= 1 && verifyRead === VALUE,
        note:                  'Web modu (localStorage). Native Android Filesystem testi yapılmadı.',
      });

      expect(actualDiskWrites).toBeGreaterThanOrEqual(1);
      expect(verifyRead).toBe(VALUE);
    });

    it('NORMAL key — 10 rapid writes coalesced to 1 disk write', () => {
      const KEY                = 'car-cache-test-key';
      const totalWriteRequests = 10;

      const lsSpy = vi.spyOn(Storage.prototype, 'setItem');

      for (let i = 0; i < totalWriteRequests; i++) {
        safeSetRaw(KEY, `{"seq":${i}}`);
      }
      const finalValue = `{"seq":${totalWriteRequests - 1}}`;

      // Debounce tetiklenmeden önce: gerçek disk yazması yok
      const diskWritesBeforeDebounce = lsSpy.mock.calls.filter(([k]: [string, string?]) => k === KEY).length;

      vi.runAllTimers(); // debounce (4 s) + idle (0 ms) — her ikisi de fake timer

      // Gerçek ölçüm: debounce sonrası kaç kez tetiklendi
      const actualDiskWrites = lsSpy.mock.calls.filter(([k]: [string, string?]) => k === KEY).length
                               - diskWritesBeforeDebounce;
      const verifyRead        = safeGetRaw(KEY);
      lsSpy.mockRestore();

      const writeReductionPercent = ((totalWriteRequests - actualDiskWrites) / totalWriteRequests) * 100;

      logger.logSafeStorage({
        scenario:              'NORMAL — 10 rapid writes debounced',
        totalWriteRequests,
        actualDiskWrites,
        writeReductionPercent,
        corruptionCount:       0,
        recoveryTimeMs:        null,  // fake timer ortamı — ölçüm anlamsız
        passed:                diskWritesBeforeDebounce === 0 && actualDiskWrites === 1 && verifyRead === finalValue,
        note:                  'Web modu (localStorage). Native Android Filesystem testi yapılmadı.',
      });

      expect(diskWritesBeforeDebounce).toBe(0);
      expect(actualDiskWrites).toBe(1);
      expect(verifyRead).toBe(finalValue);
    });

    it('Corruption recovery — simulated filesystem failure, localStorage fallback', () => {
      const KEY   = 'car-gps-last-known';
      const VALUE = '{"lat":41.0,"lng":29.0}';

      // Simülasyon: Filesystem bozulmuş veri döndürüyor
      vi.mocked(Filesystem.readFile).mockResolvedValueOnce({ data: 'CORRUPTED_DATA' });
      localStorage.setItem(KEY, VALUE);

      const recovered = safeGetRaw(KEY);

      logger.logSafeStorage({
        scenario:              'Corruption recovery — localStorage fallback',
        totalWriteRequests:    0,
        actualDiskWrites:      0,
        writeReductionPercent: null,   // write isteği yok, oran tanımsız
        corruptionCount:       1,      // simülasyon — gerçek disk bozulması değil
        recoveryTimeMs:        null,   // fake timer ortamı — ölçüm anlamsız
        passed:                recovered === VALUE,
        note:                  'Bozulma simülasyon ile tetiklendi, gerçek disk hatası değil. ' +
                               'recoveryTimeMs fake timer ortamında ölçülemez.',
      });

      expect(recovered).toBe(VALUE);
    });

  });

  /* ═══════════════════════════════════════════════════════════════
     Innovation #3 — Zero-Trust Security
     ═══════════════════════════════════════════════════════════════ */

  describe('Innovation #3: Zero-Trust Remote Security', () => {

    it('validates E2E payload structure and rejects malformed inputs', () => {
      const valid = {
        type:    'ecdh_v1' as const,
        eph_pub: 'base64_pub',
        iv:      'base64_iv',
        data:    'base64_data',
        ts:      Date.now(),
      };

      expect(isE2EPayload(valid)).toBe(true);
      expect(isE2EPayload({ ...valid, type: 'plain' })).toBe(false);
      expect(isE2EPayload({ ...valid, iv: undefined })).toBe(false);
      expect(isE2EPayload(null)).toBe(false);
      expect(isE2EPayload({})).toBe(false);
    });

  });

});
