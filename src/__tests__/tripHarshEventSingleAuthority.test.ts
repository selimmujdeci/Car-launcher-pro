/**
 * tripHarshEventSingleAuthority.test.ts
 *
 * SERT FREN / ANI HIZLANMA — TEK KANONİK SAYIM OTORİTESİ.
 *
 * ── NEDEN BU DOSYA VAR ────────────────────────────────────────────────────
 * Aynı fiziksel gerçek (sert manevra) İKİ ayrı yerde sayılıyordu:
 *   · canlı ekran → `ActiveTrip.harshBrakeEvents` (YALNIZ GPS, debounce YOK,
 *     kaynak-süreklilik kapısı YOK)
 *   · mühürlenen kayıt → `tripMetricsAccumulator` (GPS + OBD, 2 sn debounce,
 *     kaynak-değişimi ve veri-boşluğu kapıları)
 * Sonuç: yolculuk sürerken 3 görünen sayı kapanınca 2 olabiliyordu ve
 * GPS'siz (salt OBD) yolculukta canlı ekran 0'da kalıyordu.
 *
 * Bu testler TEK otoriteyi (akümülatör) ve onun UI'ya kadar olan yolunu
 * kilitler. Yeni dedektör/otorite KURULMADI — duplicate sayaç KALDIRILDI.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/* ── Mock'lar (import'lardan ÖNCE) ─────────────────────────────────────── */

vi.mock('../utils/safeStorage', () => ({
  isSafeStorageHydrated: () => true,
  safeGetRaw:   vi.fn(() => null),
  safeSetRaw:   vi.fn(),
  safeFlushKey: vi.fn(),
}));

vi.mock('../platform/crashLogger', () => ({ logError: vi.fn() }));

type LocationCb = (loc: import('../platform/gpsService').GPSLocation | null) => void;
type OBDCb     = (d: import('../platform/obdService').OBDData) => void;

let _gpsCb: LocationCb | null = null;
let _obdCb: OBDCb | null      = null;

vi.mock('../platform/gpsService', () => ({
  onGPSLocation: vi.fn((cb: LocationCb) => {
    _gpsCb = cb;
    cb(null);
    return () => { _gpsCb = null; };
  }),
}));

vi.mock('../platform/obdService', () => ({
  onOBDData: vi.fn((cb: OBDCb) => {
    _obdCb = cb;
    return () => { _obdCb = null; };
  }),
}));

import {
  applySample, createAccumulator, HARSH_DEBOUNCE_MS, HARSH_DELTA_KMH,
  SAMPLE_STALE_MS, type TripMetricsAccumulator,
} from '../platform/trip/tripMetricsAccumulator';
import { fromActiveTrip, has, type ActiveTripView } from '../components/cockpit/tripComputerModel';
import { toCanonicalTripSummary } from '../platform/trip/tripLifecycle';
import { EMPTY_TRIP_METRICS } from '../platform/trip/tripCanonicalModel';
import {
  startTripLog, stopTripLog, clearAllTrips, getTripSnapshot,
} from '../platform/tripLogService';
import type { TripRecord } from '../platform/tripLogService';

/* ══════════════════════════════════════════════════════════════════════════
 * 1) KANONİK DEDEKTÖR SÖZLEŞMESİ (saf — I/O YOK)
 * ════════════════════════════════════════════════════════════════════════ */

type Src = 'GPS' | 'OBD';

/** Tek örnek uygular; kapıların TAMAMI akümülatörün kendisindedir. */
function feed(
  acc: TripMetricsAccumulator, at: number, speed: number, source: Src = 'GPS',
): TripMetricsAccumulator {
  return applySample(acc, { perfNowMs: at, source, speedKmh: speed, fresh: true });
}

describe('kanonik sert manevra dedektörü — kaynak sürekliliği', () => {
  it('C · GPS → GPS: eşiği aşan gerçek fren SAYILIR', () => {
    let a = createAccumulator();
    a = feed(a, 1_000, 60);
    a = feed(a, 1_500, 60 - (HARSH_DELTA_KMH + 5));
    expect(a.harshBrakeCount).toBe(1);
    expect(a.harshAccelCount).toBe(0);
  });

  it('D · OBD → OBD: GPS HİÇ YOKKEN de olay sayılır', () => {
    let a = createAccumulator();
    a = feed(a, 1_000, 20, 'OBD');
    a = feed(a, 1_500, 20 + (HARSH_DELTA_KMH + 5), 'OBD');
    expect(a.harshAccelCount).toBe(1);
    expect(a.gpsSampleCount).toBe(0);
  });

  it('E · GPS → OBD kaynak değişimi SAHTE olay üretmez', () => {
    let a = createAccumulator();
    a = feed(a, 1_000, 60, 'GPS');
    a = feed(a, 1_500, 20, 'OBD');       // 40 km/s fark — ama KAYNAK değişti
    expect(a.harshBrakeCount).toBe(0);
    expect(a.sourceSwitchCount).toBe(1);
  });

  it('F · OBD → GPS kaynak değişimi SAHTE olay üretmez', () => {
    let a = createAccumulator();
    a = feed(a, 1_000, 20, 'OBD');
    a = feed(a, 1_500, 60, 'GPS');       // 40 km/s fark — ama KAYNAK değişti
    expect(a.harshAccelCount).toBe(0);
    expect(a.sourceSwitchCount).toBe(1);
  });

  it('G · veri boşluğu olay DEĞİLDİR (susan kaynağın dönüşü fren sayılmaz)', () => {
    let a = createAccumulator();
    a = feed(a, 1_000, 60);
    a = feed(a, 1_000 + SAMPLE_STALE_MS + 1_000, 10);
    expect(a.harshBrakeCount).toBe(0);
    expect(a.dataGapCount).toBe(1);
    /* Boşluk süresi DURUŞA yazılmaz — ayrı kovada kalır. */
    expect(a.unknownMs).toBeGreaterThan(0);
    expect(a.idleMs).toBe(0);
  });

  it('H · debounce penceresi içindeki tekrar AYNI olayı ikinci kez saymaz', () => {
    let a = createAccumulator();
    a = feed(a, 1_000, 80);
    a = feed(a, 1_400, 50);              // olay #1
    a = feed(a, 1_800, 20);              // aynı manevranın devamı (< 2 sn)
    expect(a.harshBrakeCount).toBe(1);
  });

  it('I · debounce SONRASI gerçek ikinci olay SAYILIR', () => {
    let a = createAccumulator();
    a = feed(a, 1_000, 80);
    a = feed(a, 1_400, 50);                                   // olay #1
    const t2 = 1_400 + HARSH_DEBOUNCE_MS + 100;
    a = feed(a, t2 - 400, 50);                                // ardışıklık korunur
    a = feed(a, t2, 20);                                      // olay #2
    expect(a.harshBrakeCount).toBe(2);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 2) MODEL KATMANI — canlı görüntü KANONİK sayaçtan okur
 * ════════════════════════════════════════════════════════════════════════ */

function activeView(acc: TripMetricsAccumulator, over: Partial<ActiveTripView> = {}): ActiveTripView {
  return {
    startTime: 1_700_000_000_000,
    liveDistanceKm: 12.5,
    liveDurationMin: 20,
    maxSpeedKmh: 90,
    speedSum: 1_200, speedCount: 20,
    gpsDistanceKm: 12.5, obdDistanceKm: 0,
    metrics: acc,
    price: { unitPrice: null, currency: null, source: 'UNAVAILABLE' },
    ...over,
  };
}

describe('TripComputer canlı görüntüsü — sayım otoritesi', () => {
  it('A · canlı sayılar KANONİK akümülatörden gelir', () => {
    let a = createAccumulator();
    a = feed(a, 1_000, 80);
    a = feed(a, 1_400, 50);                                   // fren
    const t2 = 1_400 + HARSH_DEBOUNCE_MS + 100;
    a = feed(a, t2 - 400, 50);
    a = feed(a, t2, 50 + HARSH_DELTA_KMH + 5);                // gaz
    expect(a.harshBrakeCount).toBe(1);
    expect(a.harshAccelCount).toBe(1);

    const s = fromActiveTrip(activeView(a), { tankL: null });
    expect(s.metrics.harshBrakeCount.value).toBe(a.harshBrakeCount);
    expect(s.metrics.harshAccelCount.value).toBe(a.harshAccelCount);
    expect(s.metrics.harshBrakeCount.source).toBe('MEASURED');
  });

  it('A2 · ESKİ GPS-only alan ARTIK OKUNMAZ (duplicate otorite yok)', () => {
    let a = createAccumulator();
    a = feed(a, 1_000, 20, 'OBD');
    a = feed(a, 1_500, 60, 'OBD');                            // OBD üzerinden gaz
    expect(a.harshAccelCount).toBe(1);

    /* Kaldırılmış alanlar yine de gönderilse bile hüküm DEĞİŞMEZ. */
    const legacy = { harshBrakeEvents: 9, harshAccelEvents: 9 } as unknown as Partial<ActiveTripView>;
    const s = fromActiveTrip(activeView(a, legacy), { tankL: null });
    expect(s.metrics.harshAccelCount.value).toBe(1);
    expect(s.metrics.harshBrakeCount.value).toBe(0);
  });

  it('K · ölçülmemiş kayıtta sayaç UNAVAILABLE kalır — domain 0 ÜRETMEZ', () => {
    expect(EMPTY_TRIP_METRICS.harshBrakeCount.source).toBe('UNAVAILABLE');
    expect(EMPTY_TRIP_METRICS.harshBrakeCount.value).toBeNull();
    expect(has(EMPTY_TRIP_METRICS.harshAccelCount)).toBe(false);

    /* Alanı OLMAYAN eski kayıt → UNAVAILABLE (sahte 0 değil). */
    const legacyRecord = {
      id: 't1', startTime: 1, endTime: 2, distanceKm: 10, durationMin: 12,
      avgSpeedKmh: 50, maxSpeedKmh: 90, fuelConsumptionL: 0, fuelCostTL: 0,
      drivingScore: 90, harshEvents: 0,
    } as unknown as TripRecord;
    const summary = toCanonicalTripSummary(legacyRecord, 'COMPLETED');
    expect(summary.metrics.harshBrakeCount.source).toBe('UNAVAILABLE');
    expect(summary.metrics.harshAccelCount.value).toBeNull();
  });

  it("K2 · GERÇEK sıfır ile veri yokluğu domain'de AYNI ŞEY DEĞİLDİR", () => {
    const measuredZero = fromActiveTrip(activeView(createAccumulator()), { tankL: null });
    expect(measuredZero.metrics.harshBrakeCount.value).toBe(0);
    expect(measuredZero.metrics.harshBrakeCount.source).toBe('MEASURED');
    expect(has(measuredZero.metrics.harshBrakeCount)).toBe(true);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 3) ÜRETİM YOLU — canlı sayı ile MÜHÜRLENEN sayı AYNI OLMALI
 * ════════════════════════════════════════════════════════════════════════ */

const GPS_ACC_M = 10;

function gpsFix(lat: number, lng: number, speedKmh: number) {
  return {
    latitude: lat, longitude: lng,
    speed: speedKmh / 3.6,
    heading: 0, accuracy: GPS_ACC_M,
    altitude: null, altitudeAccuracy: null,
    timestamp: Date.now(),
  };
}

function obdFrame(speedKmh: number) {
  return {
    speed: speedKmh, rpm: 2_000, engineTemp: 90, fuelLevel: 50,
    headlights: false, connectionState: 'connected' as const,
    source: 'real' as const, lastSeenMs: Date.now(),
    dataFresh: true, transportConnected: true,
  } as unknown as import('../platform/obdService').OBDData;
}

describe('LIVE → COMPLETED invariant (gerçek servis yolu)', () => {
  let mono = 0;
  let nowSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mono = 10_000;
    nowSpy = vi.spyOn(performance, 'now').mockImplementation(() => mono);
    clearAllTrips();
    startTripLog();
  });

  afterEach(() => {
    stopTripLog();
    clearAllTrips();
    nowSpy.mockRestore();
  });

  /** Monotonik saati ilerletir — GERÇEK bekleme YOK. */
  function tick(ms: number): void { mono += ms; }

  it('B · yeni olay oluşmadan kapanan yolculukta canlı sayı = kayıtlı sayı', () => {
    /* Hareket kanıtı: ≥1 sn ayrık iki örnek (tek fix yolculuk AÇMAZ). */
    _gpsCb!(gpsFix(36.900_0, 34.600_0, 60));
    tick(1_200);
    _gpsCb!(gpsFix(36.900_0, 34.600_0, 60));

    /* Gerçek sert fren: ardışık, taze, aynı kaynak. */
    tick(600);
    _gpsCb!(gpsFix(36.900_5, 34.600_0, 60));
    tick(600);
    _gpsCb!(gpsFix(36.901_0, 34.600_0, 30));        // −30 km/s → olay
    /* Debounce sonrası gerçek ikinci olay: ani hızlanma. */
    tick(HARSH_DEBOUNCE_MS + 500);
    _gpsCb!(gpsFix(36.901_5, 34.600_0, 30));
    tick(600);
    _gpsCb!(gpsFix(36.902_0, 34.600_0, 60));        // +30 km/s → olay

    const live = getTripSnapshot().current;
    expect(live, 'yolculuk açılmadı').not.toBeNull();
    const liveBrake = live!.metrics.harshBrakeCount;
    const liveAccel = live!.metrics.harshAccelCount;
    expect(liveBrake).toBe(1);
    expect(liveAccel).toBe(1);

    /* Canlı görüntünün TAM OLARAK gösterdiği sayı: */
    const shown = fromActiveTrip(
      live as unknown as ActiveTripView, { tankL: null },
    ).metrics;
    expect(shown.harshBrakeCount.value).toBe(liveBrake);
    expect(shown.harshAccelCount.value).toBe(liveAccel);

    /* Kayıt eşiklerini geç (≥1 dk, ≥100 m) ve YENİ OLAY ÜRETMEDEN kapat. */
    tick(90_000);
    stopTripLog();

    const rec = getTripSnapshot().history[0];
    expect(rec, 'yolculuk kaydedilmedi').toBeTruthy();
    expect(rec.harshBrakeCount).toBe(liveBrake);
    expect(rec.harshAccelCount).toBe(liveAccel);

    /* Kanonik özet de AYNI sayıyı taşır — sıçrama YOK. */
    const sealed = toCanonicalTripSummary(rec, 'COMPLETED');
    expect(sealed.metrics.harshBrakeCount.value).toBe(shown.harshBrakeCount.value);
    expect(sealed.metrics.harshAccelCount.value).toBe(shown.harshAccelCount.value);
  });

  it("D2 · GPS YOKKEN OBD hız kanıtı canlı ekranda da görünür (0'da kalmaz)", () => {
    _obdCb!(obdFrame(20));
    tick(1_200);
    _obdCb!(obdFrame(20));

    tick(600);
    _obdCb!(obdFrame(20));
    tick(600);
    _obdCb!(obdFrame(60));                          // +40 km/s → gaz olayı

    const live = getTripSnapshot().current;
    expect(live, 'OBD hızıyla yolculuk açılmadı').not.toBeNull();
    expect(live!.metrics.harshAccelCount).toBe(1);

    const shown = fromActiveTrip(
      live as unknown as ActiveTripView, { tankL: null },
    ).metrics;
    /* ESKİ DAVRANIŞ: GPS-only sayaç yüzünden burada 0 görünürdü. */
    expect(shown.harshAccelCount.value).toBe(1);
    expect(shown.harshAccelCount.source).toBe('MEASURED');
  });
});
