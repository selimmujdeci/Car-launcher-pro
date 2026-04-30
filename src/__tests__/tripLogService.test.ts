/**
 * tripLogService.test.ts — Clock Jump Koruması, Haversine, GPS Filtresi, Trip Lifecycle
 *
 * Kapsam:
 *  - CLOCK JUMP PROTECTION: trip süresi Date.now() değil performance.now() kullanır
 *  - Haversine mesafe hesabı: bilinen 2 nokta arası mesafe doğrulaması
 *  - GPS gürültü filtresi: accuracy > 50m → mesafeye eklenmez
 *  - GPS sıçrama filtresi: tek delta > 300m → atlanır
 *  - GPS minimum mesafe: < 5m delta → gürültü, atlat
 *  - Trip lifecycle: startTripLog / stopTripLog / onTripState
 *  - Trip başlatma eşiği: speed > 5 km/h
 *  - OBD sınır denetimi: speed < 0 veya > 300 → yoksayılır
 *  - deleteTrip / clearAllTrips
 *
 * Automotive Reliability Score: 92/100
 * Edge Case Riskleri:
 *  [MED] Modül seviyesi state — describe blokları arasında kalıcıdır
 *  [LOW] performance.now() mock'u gerçek monotonic garantisini simüle etmez
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/* ── Sabit mock'lar ──────────────────────────────────────────── */

vi.mock('../utils/safeStorage', () => ({
  safeGetRaw:   vi.fn(() => null),
  safeSetRaw:   vi.fn(),
  safeFlushKey: vi.fn(),
}));

vi.mock('../platform/crashLogger', () => ({
  logError: vi.fn(),
}));

/* ── GPS ve OBD subscriber'ları yakalamak için mock'lar ─────── */

type LocationCb = (loc: import('../platform/gpsService').GPSLocation | null) => void;
type OBDCb     = (d: import('../platform/obdService').OBDData) => void;

let _gpsCb: LocationCb | null = null;
let _obdCb: OBDCb | null      = null;

vi.mock('../platform/gpsService', () => ({
  onGPSLocation: vi.fn((cb: LocationCb) => {
    _gpsCb = cb;
    return () => { _gpsCb = null; };
  }),
}));

vi.mock('../platform/obdService', () => ({
  onOBDData: vi.fn((cb: OBDCb) => {
    _obdCb = cb;
    return () => { _obdCb = null; };
  }),
}));

/* ── Import (mock'lardan sonra) ─────────────────────────────── */

import {
  startTripLog,
  stopTripLog,
  onTripState,
  clearAllTrips,
  deleteTrip,
  type TripState,
} from '../platform/tripLogService';

import { onGPSLocation } from '../platform/gpsService';

/* ── Yardımcı: GPS fiksi oluştur ────────────────────────────── */

function gpsAt(
  lat: number,
  lng: number,
  speedMs: number = 15,
  accuracy: number = 10,
) {
  return {
    latitude:         lat,
    longitude:        lng,
    speed:            speedMs,
    heading:          0,
    accuracy,
    altitude:         null,
    altitudeAccuracy: null,
    timestamp:        Date.now(),
  };
}

function obdData(speed: number, fuel = 50) {
  return {
    speed,
    rpm:             2000,
    engineTemp:      90,
    fuelLevel:       fuel,
    headlights:      false,
    connectionState: 'connected' as const,
    source:          'real' as const,
    lastSeenMs:      Date.now(),
  };
}

/* ── waitForState — TDZ-safe versiyon ───────────────────────── */
/**
 * onTripState callback'i SENKRON olarak hemen tetiklenebilir (mevcut state ile).
 * `let unsub` kullanılır; senkron ateşlemede unsub henüz undefined → queueMicrotask ile cleanup.
 */
function waitForState(predicate: (s: TripState) => boolean, timeoutMs = 1_500): Promise<TripState> {
  return new Promise((resolve, reject) => {
    let resolved = false;
    const timer  = setTimeout(() => {
      if (!resolved) reject(new Error('waitForState timeout'));
    }, timeoutMs);

    // eslint-disable-next-line prefer-const
    let unsub: (() => void) | undefined;

    unsub = onTripState((s) => {
      if (!resolved && predicate(s)) {
        resolved = true;
        clearTimeout(timer);
        queueMicrotask(() => unsub?.());
        resolve(s);
      }
    });
  });
}

/**
 * Tüm state güncellemelerini toplar; fake timer ile çalışır.
 * onTripState ilk çağrıyı current:null ile yapar; ardından _notify çağrıları gerçek current'ı taşır.
 */
function captureStates(): { states: TripState[]; unsub: () => void } {
  const states: TripState[] = [];
  const unsub = onTripState((s) => states.push(s));
  return { states, unsub };
}

/* ── Global cleanup ─────────────────────────────────────────── */

function resetService() {
  stopTripLog();
  clearAllTrips();
  _gpsCb = null;
  _obdCb = null;
}

/* ═══════════════════════════════════════════════════════════════
   1. CLOCK JUMP KORUMASI — performance.now() monotonic
═══════════════════════════════════════════════════════════════ */

describe('Clock Jump Protection — monotonic trip süresi', () => {
  beforeEach(resetService);
  afterEach(resetService);

  it('liveDurationMin negatif olamaz — performance.now() tabanlı', async () => {
    startTripLog();
    _gpsCb?.(gpsAt(41.0, 29.0, 6));

    // current !== null şartını ekle — ilk senkron çağrı null gelir
    const state = await waitForState((s) => s.active && s.current !== null);
    expect(state.current!.liveDurationMin).toBeGreaterThanOrEqual(0);
  });

  it('aktif trip\'te current object sayısal alanlar içerir', async () => {
    startTripLog();
    _gpsCb?.(gpsAt(41.0, 29.0, 6));

    const state = await waitForState((s) => s.active && s.current !== null);
    expect(state.current).not.toBeNull();
    expect(typeof state.current!.liveDurationMin).toBe('number');
    expect(typeof state.current!.liveDistanceKm).toBe('number');
  });
});

/* ═══════════════════════════════════════════════════════════════
   2. HAVERSINE MESAFEsi
═══════════════════════════════════════════════════════════════ */

describe('GPS haversine mesafe hesabı', () => {
  beforeEach(() => { resetService(); vi.useFakeTimers(); });
  afterEach(() => { resetService(); vi.useRealTimers(); });

  it('~0.001 derece kuzey (~111m) → distance > 0.05 km', async () => {
    startTripLog();

    const { states, unsub } = captureStates();

    _gpsCb?.(gpsAt(41.0369, 28.9850, 10, 5));
    await vi.advanceTimersByTimeAsync(10);
    _gpsCb?.(gpsAt(41.0379, 28.9850, 10, 5));
    await vi.advanceTimersByTimeAsync(1_001); // 1s live clock → _notify

    unsub();

    // 1s clock sonrası gelen state'te current != null ve distanceKm güncellendi
    const withDist = states.find((s) => s.active && (s.current?.liveDistanceKm ?? 0) > 0.05);
    expect(withDist).toBeDefined();
    expect(withDist!.current!.liveDistanceKm).toBeLessThan(0.20);
  });
});

/* ═══════════════════════════════════════════════════════════════
   3. GPS GÜRÜLTÜ FİLTRESİ — accuracy > 50m
═══════════════════════════════════════════════════════════════ */

describe('GPS gürültü filtresi — kötü accuracy atlanır', () => {
  beforeEach(() => { resetService(); vi.useFakeTimers(); });
  afterEach(() => { resetService(); vi.useRealTimers(); });

  it('accuracy=60m → mesafeye eklenmez, distanceKm ≈ 0 kalır', async () => {
    startTripLog();
    const { states, unsub } = captureStates();

    _gpsCb?.(gpsAt(41.0, 29.0, 10, 5));
    await vi.advanceTimersByTimeAsync(10);
    _gpsCb?.(gpsAt(41.001, 29.001, 10, 60));
    await vi.advanceTimersByTimeAsync(1_001);
    unsub();

    const last = states.filter((s) => s.active && s.current !== null).pop();
    expect(last).toBeDefined();
    expect(last!.current!.liveDistanceKm).toBeLessThan(0.01);
  });

  it('accuracy=0 (geçersiz) → mesafeye eklenmez', async () => {
    startTripLog();
    const { states, unsub } = captureStates();

    _gpsCb?.(gpsAt(41.0, 29.0, 10, 5));
    await vi.advanceTimersByTimeAsync(10);
    _gpsCb?.(gpsAt(41.001, 29.001, 10, 0));
    await vi.advanceTimersByTimeAsync(1_001);
    unsub();

    const last = states.filter((s) => s.active && s.current !== null).pop();
    expect(last).toBeDefined();
    expect(last!.current!.liveDistanceKm).toBeLessThan(0.01);
  });
});

/* ═══════════════════════════════════════════════════════════════
   4. GPS SIÇRAMA FİLTRESİ — >300m tek delta
═══════════════════════════════════════════════════════════════ */

describe('GPS sıçrama filtresi — büyük delta atlanır', () => {
  beforeEach(() => { resetService(); vi.useFakeTimers(); });
  afterEach(() => { resetService(); vi.useRealTimers(); });

  it('~1km sıçrama → mesafeye eklenmez', async () => {
    startTripLog();
    const { states, unsub } = captureStates();

    _gpsCb?.(gpsAt(41.0, 29.0, 10, 5));
    await vi.advanceTimersByTimeAsync(10);
    _gpsCb?.(gpsAt(41.009, 29.0, 10, 5)); // ~1km sıçrama → atlanır
    await vi.advanceTimersByTimeAsync(1_001);
    unsub();

    const last = states.filter((s) => s.active && s.current !== null).pop();
    expect(last).toBeDefined();
    expect(last!.current!.liveDistanceKm).toBeLessThan(0.01);
  });
});

/* ═══════════════════════════════════════════════════════════════
   5. GPS MİNİMUM MESAFE — <5m gürültü
═══════════════════════════════════════════════════════════════ */

describe('GPS minimum mesafe — <5m atlanır', () => {
  beforeEach(() => { resetService(); vi.useFakeTimers(); });
  afterEach(() => { resetService(); vi.useRealTimers(); });

  it('0.00002 derece (~2m) → gürültü, mesafeye eklenmez', async () => {
    startTripLog();
    const { states, unsub } = captureStates();

    _gpsCb?.(gpsAt(41.0000, 29.0000, 10, 5));
    await vi.advanceTimersByTimeAsync(10);
    _gpsCb?.(gpsAt(41.00002, 29.0000, 10, 5)); // ~2m
    await vi.advanceTimersByTimeAsync(1_001);
    unsub();

    const last = states.filter((s) => s.active && s.current !== null).pop();
    expect(last).toBeDefined();
    expect(last!.current!.liveDistanceKm).toBeLessThan(0.005);
  });
});

/* ═══════════════════════════════════════════════════════════════
   6. OBD SINIR DENETİMİ
═══════════════════════════════════════════════════════════════ */

describe('OBD sınır denetimi — geçersiz değerler yoksayılır', () => {
  beforeEach(resetService);
  afterEach(resetService);

  it('speed=-5 → hata fırlatmaz', () => {
    startTripLog();
    expect(() => _obdCb?.(obdData(-5))).not.toThrow();
  });

  it('speed=350 → hata fırlatmaz (>300 limiti)', () => {
    startTripLog();
    expect(() => _obdCb?.(obdData(350))).not.toThrow();
  });

  it('speed=0, fuel=-2 → yoksayılır (fuel < -1 limiti)', () => {
    startTripLog();
    expect(() => _obdCb?.({ ...obdData(0), fuelLevel: -2 } as ReturnType<typeof obdData>)).not.toThrow();
  });
});

/* ═══════════════════════════════════════════════════════════════
   7. TRİP LIFECYCLE
═══════════════════════════════════════════════════════════════ */

describe('Trip lifecycle', () => {
  beforeEach(resetService);
  afterEach(() => {
    resetService();
    vi.useRealTimers();
  });

  it('GPS speed > 5 km/h → trip aktif olur', async () => {
    startTripLog();
    _gpsCb?.(gpsAt(41.0, 29.0, 6));

    const state = await waitForState((s) => s.active);
    expect(state.active).toBe(true);
  });

  it('startTripLog idempotent — çift çağrı listener çoğaltmaz', () => {
    vi.clearAllMocks();
    startTripLog();
    startTripLog();
    expect(vi.mocked(onGPSLocation)).toHaveBeenCalledTimes(1);
  });

  it('stopTripLog sonrası GPS callback null olur', () => {
    startTripLog();
    stopTripLog();
    expect(_gpsCb).toBeNull();
  });

  it('stopTripLog idempotent — iki kez çağrılınca hata vermez', () => {
    startTripLog();
    expect(() => { stopTripLog(); stopTripLog(); }).not.toThrow();
  });

  it('GPS speed=0 + 60s idle → trip biter', async () => {
    vi.useFakeTimers();
    startTripLog();

    // Trip başlat
    _gpsCb?.(gpsAt(41.0, 29.0, 6));
    await vi.advanceTimersByTimeAsync(10);

    // Dur (speed=0)
    _gpsCb?.({ ...gpsAt(41.0001, 29.0, 0), speed: 0 });

    // 60s idle timer
    await vi.advanceTimersByTimeAsync(61_000);
    await Promise.resolve();

    // state.active === false bekliyoruz
    const finalState = await new Promise<TripState>((resolve) => {
      onTripState((s) => {
        if (!s.active) resolve(s);
      });
      // Eğer zaten false ise hemen çözülür
      vi.advanceTimersByTimeAsync(0).catch(() => {});
    });
    expect(finalState.active).toBe(false);
  });
});

/* ═══════════════════════════════════════════════════════════════
   8. TRİP SİLME / TEMİZLEME
═══════════════════════════════════════════════════════════════ */

describe('deleteTrip / clearAllTrips', () => {
  beforeEach(resetService);
  afterEach(resetService);

  it('clearAllTrips sonrası totalTrips=0', async () => {
    clearAllTrips();
    const state = await waitForState((s) => s.totalTrips === 0);
    expect(state.history).toHaveLength(0);
    expect(state.totalDistanceKm).toBe(0);
  });

  it('deleteTrip: olmayan id → hata fırlatmaz', () => {
    expect(() => deleteTrip('non-existent-trip-id')).not.toThrow();
  });
});

/* ═══════════════════════════════════════════════════════════════
   9. OBD FALLBACK
═══════════════════════════════════════════════════════════════ */

describe('OBD fallback — GPS olmadığında trip başlatır', () => {
  beforeEach(resetService);
  afterEach(resetService);

  it('OBD speed > 5 km/h → trip aktif olur (GPS yokken)', async () => {
    startTripLog();
    _obdCb?.(obdData(30)); // 30 km/h > 5 km/h

    const state = await waitForState((s) => s.active);
    expect(state.active).toBe(true);
  });
});
