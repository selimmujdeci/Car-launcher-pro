/**
 * tripSessionContinuityAndComputer.test.ts
 *
 * İKİ GERÇEĞİ KİLİTLER:
 *
 *  1. YENİDEN BAŞLATMA SÜREKLİLİĞİ — süreç/uygulama/baş ünite yeniden
 *     başlasa bile AYNI fiziksel yolculuk (ya da sürüş günlüğü) devam eder.
 *     Yeniden başlatma bir TAMAMLANMA DEĞİLDİR; sahte "yolculuk bitti"
 *     üretmez ve ikinci bir yolculuk doğurmaz.
 *
 *  2. TRIP COMPUTER OTORİTESİ — ekran artık tek bir depolama segmentini
 *     değil, oturumun BAŞINDAN İTİBAREN toplamını gösterir. Dinlenme
 *     tesisinde mühürlenen segment kullanıcı için yolculuğun ortasıdır.
 *
 * Yeni ölçüm otoritesi YOKTUR: mesafe · süre · hız · yakıt · sert manevra
 * sahipleri değişmedi (bkz. 9d78b68e), oturum yalnız TOPLAR.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  advanceTripSession, projectTripSession, emptyTripSession,
  serializeTripSession, deserializeTripSession,
  TRIP_SESSION_PERSIST_MAX_AGE_MS, TRIP_SESSION_PERSIST_VERSION,
  type TripSession, type TripSessionSample, type TripSessionSegment,
} from '../platform/trip/core/tripSessionModel';
import { selectTrip, has, consumptionL100 } from '../components/cockpit/tripComputerModel';
import {
  getTripSessionSnapshot, getTripSessionRestoreVerdict, setTripSessionVehicle,
  _resetTripSessionForTest, _restoreTripSessionForTest, _feedTripStateForTest,
  _simulateProcessRestartForTest,
} from '../platform/trip/tripSessionService';
import { registerNavIntentReader } from '../platform/trip/navIntentPort';
import { createAccumulator } from '../platform/trip/tripMetricsAccumulator';
import { safeGetRaw, safeSetRaw } from '../utils/safeStorage';
import type { TripState } from '../platform/tripLogService';

const MIN = 60_000;
const WALL0 = 1_700_000_000_000;

function seg(over: Partial<TripSessionSegment> & { key: number }): TripSessionSegment {
  return {
    startedMonoMs: over.key,
    startedWallMs: WALL0 + over.key,
    movingMs: 0, idleMs: 0, unknownMs: 0, distanceM: 0,
    stoppedSinceMonoMs: null,
    ...over,
  };
}

function sample(
  monoMs: number,
  segment: TripSessionSegment | null,
  intent: { routeActive?: boolean; arrivalSeq?: number } = {},
): TripSessionSample {
  return {
    monoMs, wallMs: WALL0 + monoMs,
    segment, lat: 36.9, lon: 34.6,
    routeActive: intent.routeActive === true,
    arrivalSeq: intent.arrivalSeq ?? 0,
  };
}

/* Tarsus → Antalya: 120 km sürüldü, dinlenme tesisinde segment mühürlendi. */
function journeyAfterFirstLeg(): TripSession {
  let s = emptyTripSession();
  s = advanceTripSession(s, sample(10 * MIN, seg({ key: 10 * MIN }), { routeActive: true }));
  s = advanceTripSession(s, sample(100 * MIN, seg({
    key: 10 * MIN, movingMs: 88 * MIN, idleMs: 2 * MIN,
    distanceM: 120_000, gpsDistanceM: 120_000,
    maxSpeedKmh: 132, speedSum: 8_800, speedCount: 100,
    stopCount: 2, harshBrakeCount: 1, harshAccelCount: 2,
    maxRpm: 3_100, maxEngineTempC: 91, fuelUsedPct: 12,
    priceUnit: 50, priceCurrency: 'TRY', priceSource: 'MANUAL',
  }), { routeActive: true }));
  /* Duruş penceresi doldu → depolama segmenti MÜHÜRLENDİ (mola başladı). */
  s = advanceTripSession(s, sample(101 * MIN, null, { routeActive: true }));
  return s;
}

/* ══════════════════════════════════════════════════════════════════════════
 * 1) YENİDEN BAŞLATMA SÜREKLİLİĞİ
 * ════════════════════════════════════════════════════════════════════════ */

describe('yeniden başlatma sürekliliği', () => {
  it('1 · JOURNEY → restart → AYNI oturum kimliği devam eder', () => {
    const before = journeyAfterFirstLeg();
    const payload = serializeTripSession(before, 130 * MIN, WALL0 + 130 * MIN, 'veh-A');
    expect(payload).not.toBeNull();
    expect(payload!.kind).toBe('JOURNEY');

    /* YENİ SÜREÇ: monotonik saat SIFIRDAN başlar, duvar saati ilerlemiş. */
    const newMono = 500;
    const newWall = WALL0 + 131 * MIN;
    const res = deserializeTripSession(payload, newMono, newWall, 'veh-A');
    expect(res.restored).toBe(true);
    if (!res.restored) return;

    expect(res.session.sessionId).toBe(before.sessionId);
    expect(res.session.kind).toBe('JOURNEY');
    expect(res.session.completion).toBe('OPEN');
    /* Mühürlenmiş toplamlar KORUNDU. */
    expect(res.session.sealedDistanceM).toBe(120_000);
    expect(res.session.sealedHarshBrakeCount).toBe(1);
    expect(res.session.sealedHarshAccelCount).toBe(2);
    /* Yeniden başlatma bir MOLADIR: süren segment yok. */
    expect(res.session.currentSegment).toBeNull();
    expect(res.session.state).toBe('STOPPED');
    /* Geçen süre yeni monotonik tabana taşındı, uydurulmadı. */
    const p = projectTripSession(res.session, newMono);
    expect(Math.round(p.elapsedMs / MIN)).toBe(121);
  });

  it('1b · restart sonrası yeniden hareket AYNI yolculuğa eklenir', () => {
    const payload = serializeTripSession(
      journeyAfterFirstLeg(), 130 * MIN, WALL0 + 130 * MIN, 'veh-A');
    const newMono = 500;
    const newWall = WALL0 + 131 * MIN;
    const res = deserializeTripSession(payload, newMono, newWall, 'veh-A');
    if (!res.restored) throw new Error('restore basarisiz');

    let s = res.session;
    const resumeAt = newMono + 2 * MIN;
    s = advanceTripSession(s, sample(resumeAt, seg({ key: resumeAt }), { routeActive: true }));
    s = advanceTripSession(s, sample(resumeAt + 150 * MIN, seg({
      key: resumeAt, movingMs: 148 * MIN, distanceM: 180_000, gpsDistanceM: 180_000,
      maxSpeedKmh: 128, speedSum: 14_800, speedCount: 150,
      stopCount: 1, harshBrakeCount: 2, harshAccelCount: 1, fuelUsedPct: 18,
      priceUnit: 50, priceCurrency: 'TRY', priceSource: 'MANUAL',
    }), { routeActive: true }));

    const p = projectTripSession(s, resumeAt + 150 * MIN);
    expect(p.sessionId).toBe(res.session.sessionId);
    /* 120 + 180 = 300 km — restart yolculuğu BÖLMEDİ. */
    expect(p.distanceMeters).toBe(300_000);
    expect(p.harshBrakeCount).toBe(3);
    expect(p.harshAccelCount).toBe(3);
    expect(p.journeyCompleted).toBe(false);
  });

  it('2 · DRIVE_LOG → restart → kayıt sürekliliği korunur', () => {
    let s = emptyTripSession();
    s = advanceTripSession(s, sample(5 * MIN, seg({ key: 5 * MIN })));
    s = advanceTripSession(s, sample(40 * MIN, seg({
      key: 5 * MIN, movingMs: 35 * MIN, distanceM: 26_000, gpsDistanceM: 26_000,
    })));
    const payload = serializeTripSession(s, 41 * MIN, WALL0 + 41 * MIN, null);
    expect(payload!.kind).toBe('DRIVE_LOG');

    const res = deserializeTripSession(payload, 300, WALL0 + 42 * MIN, null);
    expect(res.restored).toBe(true);
    if (!res.restored) return;
    expect(res.session.sessionId).toBe(s.sessionId);
    expect(res.session.kind).toBe('DRIVE_LOG');
    expect(res.session.sealedDistanceM).toBe(26_000);
  });

  it('3 · restart SAHTE journeyCompleted üretmez', () => {
    const payload = serializeTripSession(
      journeyAfterFirstLeg(), 130 * MIN, WALL0 + 130 * MIN, 'veh-A');
    const res = deserializeTripSession(payload, 100, WALL0 + 131 * MIN, 'veh-A');
    if (!res.restored) throw new Error('restore basarisiz');
    expect(res.session.completion).toBe('OPEN');
    expect(projectTripSession(res.session, 100).journeyCompleted).toBe(false);
  });

  it('3b · TAMAMLANMIŞ yolculuk hiç yazılmaz (biten yolculuk dirilmez)', () => {
    let s = journeyAfterFirstLeg();
    const resumeAt = 120 * MIN;
    s = advanceTripSession(s, sample(resumeAt, seg({ key: resumeAt }), { routeActive: true }));
    s = advanceTripSession(s, sample(resumeAt + MIN, seg({ key: resumeAt, movingMs: MIN }), {
      routeActive: true, arrivalSeq: 1,
    }));
    expect(s.completion).toBe('DESTINATION_REACHED');
    expect(serializeTripSession(s, resumeAt + MIN, WALL0 + resumeAt + MIN, 'veh-A')).toBeNull();
  });

  it('4 · ESKİ varış mührü geri yüklenen oturumu TAMAMLAMAZ', () => {
    const payload = serializeTripSession(
      journeyAfterFirstLeg(), 130 * MIN, WALL0 + 130 * MIN, 'veh-A');
    const res = deserializeTripSession(payload, 100, WALL0 + 131 * MIN, 'veh-A');
    if (!res.restored) throw new Error('restore basarisiz');
    /* Yeni süreçte varış sayacı sıfırdan başlar → taban 0. */
    expect(res.session.arrivalSeqAtOpen).toBe(0);

    /* Restart ÖNCESİNDE olmuş bir varışın sırası (5) yeni süreçte GÖRÜLMEZ;
       navigasyon otoritesi sıfırdan sayar. Gerçek yeni varış (1) ise sayılır. */
    let s = advanceTripSession(res.session, sample(2 * MIN, seg({ key: 2 * MIN }), {
      routeActive: true, arrivalSeq: 0,
    }));
    expect(s.completion).toBe('OPEN');
    s = advanceTripSession(s, sample(3 * MIN, seg({ key: 2 * MIN, movingMs: MIN }), {
      routeActive: true, arrivalSeq: 1,
    }));
    expect(s.completion).toBe('DESTINATION_REACHED');
  });

  it('5 · BOZUK kayıt güvenli reddedilir (fail-closed)', () => {
    const now = WALL0 + 10 * MIN;
    expect(deserializeTripSession(null, 0, now, null).restored).toBe(false);
    expect(deserializeTripSession('{}', 0, now, null)).toEqual({
      restored: false, reason: 'BAD_SHAPE',
    });
    expect(deserializeTripSession({ v: 99 }, 0, now, null)).toEqual({
      restored: false, reason: 'VERSION_MISMATCH',
    });
    expect(deserializeTripSession(
      { v: TRIP_SESSION_PERSIST_VERSION, sessionId: '', kind: 'JOURNEY' }, 0, now, null,
    )).toEqual({ restored: false, reason: 'BAD_SHAPE' });
    /* İmkânsız geçiş: hareket süresi yolculuğun kendisinden uzun. */
    const impossible = {
      ...serializeTripSession(journeyAfterFirstLeg(), 130 * MIN, WALL0 + 130 * MIN, null)!,
      sealedMovingMs: 999 * MIN,
    };
    expect(deserializeTripSession(impossible, 0, WALL0 + 131 * MIN, null)).toEqual({
      restored: false, reason: 'IMPOSSIBLE_STATE',
    });
  });

  it('6 · BAYAT ve GELECEKTEN kayıt reddedilir', () => {
    const payload = serializeTripSession(
      journeyAfterFirstLeg(), 130 * MIN, WALL0 + 130 * MIN, null)!;
    const tooOld = WALL0 + 130 * MIN + TRIP_SESSION_PERSIST_MAX_AGE_MS + MIN;
    expect(deserializeTripSession(payload, 0, tooOld, null)).toEqual({
      restored: false, reason: 'STALE',
    });
    /* Kayıt "gelecekte" ise saat oynamış demektir — güvenilmez. */
    expect(deserializeTripSession(payload, 0, WALL0 + 100 * MIN, null)).toEqual({
      restored: false, reason: 'FUTURE_TIMESTAMP',
    });
  });

  it('7 · A aracının oturumu B aracına SIZMAZ', () => {
    const payload = serializeTripSession(
      journeyAfterFirstLeg(), 130 * MIN, WALL0 + 130 * MIN, 'veh-A');
    expect(deserializeTripSession(payload, 0, WALL0 + 131 * MIN, 'veh-B')).toEqual({
      restored: false, reason: 'VEHICLE_MISMATCH',
    });
    /* Aynı araca dönülürse kendi yolculuğunu bulur. */
    expect(deserializeTripSession(payload, 0, WALL0 + 131 * MIN, 'veh-A').restored).toBe(true);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 1b) SERVİS SEVİYESİ — gerçek `safeStorage` + gerçek `TripState` örnekleri
 * ════════════════════════════════════════════════════════════════════════
 * Saf model testleri kuralı kanıtlar; burası ÜRETİM YOLUNU: `tripLogService`
 * yayını şeklinde örnek → servis → `safeStorage` → süreç ölümü → geri yükleme
 * → aynı oturum → TripComputer projeksiyonu.
 */

const PERSIST_KEY = 'trip_session_state';
const NO_TRIP = { active: false, current: null, history: [] } as const;

/** `tripLogService.onTripState` yayınının biçiminde aktif yolculuk örneği. */
function tripState(over: {
  startPerfMs: number; startTime: number; distanceKm: number; movingMs: number;
} | null): TripState {
  if (over === null) {
    return { active: false, current: null, history: [], totalDistanceKm: 0, totalTrips: 0 };
  }
  const metrics = { ...createAccumulator(), movingMs: over.movingMs };
  return {
    active: true, history: [], totalDistanceKm: 0, totalTrips: 0,
    current: {
      tripId: `t-${over.startPerfMs}`, startTime: over.startTime, startPerfMs: over.startPerfMs,
      distanceKm: over.distanceKm, maxSpeedKmh: 120, speedSum: 0, speedCount: 0,
      fuelAtStart: 0, lastPerfMs: 0, lastSpeed: 0, harshEvents: 0,
      lastGPSLat: 36.9, lastGPSLng: 34.6, lastGPSTs: null, lastSamplePerfMs: 0,
      gpsDistanceKm: over.distanceKm, obdDistanceKm: 0,
      metrics,
      price: { unitPrice: null, currency: null, source: 'UNAVAILABLE', capturedAtMs: null },
      liveDurationMin: 0, liveDistanceKm: over.distanceKm,
    } as unknown as NonNullable<TripState['current']>,
  };
}

describe('servis seviyesi — süreç ölümü sonrası devralma (üretim yolu)', () => {
  let mono = 0;
  let wall = WALL0;
  const clock = (m: number) => { mono = m; wall = WALL0 + m; };

  beforeEach(() => {
    vi.spyOn(performance, 'now').mockImplementation(() => mono);
    vi.spyOn(Date, 'now').mockImplementation(() => wall);
    _resetTripSessionForTest();
    registerNavIntentReader(() => ({ routeActive: true, arrivalSeq: 0 }));
  });
  afterEach(() => {
    _resetTripSessionForTest();
    registerNavIntentReader(null);
    vi.restoreAllMocks();
  });

  /** Tarsus'tan çık, 120 km sür, dinlenme tesisinde segment mühürlensin. */
  function driveFirstLeg(): string {
    setTripSessionVehicle('veh-A');
    clock(10 * MIN);
    _feedTripStateForTest(tripState({ startPerfMs: 10 * MIN, startTime: WALL0 + 10 * MIN, distanceKm: 0, movingMs: 0 }));
    clock(100 * MIN);
    _feedTripStateForTest(tripState({ startPerfMs: 10 * MIN, startTime: WALL0 + 10 * MIN, distanceKm: 120, movingMs: 88 * MIN }));
    clock(101 * MIN);
    _feedTripStateForTest(tripState(null));
    const id = getTripSessionSnapshot().sessionId;
    expect(id).not.toBeNull();
    expect(safeGetRaw(PERSIST_KEY)).not.toBeNull();
    return id as string;
  }

  /** Süreç öldü: monotonik saat sıfırdan, duvar saati ilerlemiş. */
  function restartProcess(wallMinutesLater: number): void {
    _simulateProcessRestartForTest();
    mono = 500;
    wall = WALL0 + wallMinutesLater * MIN;
  }

  it('1 · JOURNEY → restart → aynı oturum kimliği ve 120+180 = 300 km', () => {
    const id = driveFirstLeg();
    restartProcess(131);
    setTripSessionVehicle('veh-A');
    _restoreTripSessionForTest();
    expect(getTripSessionRestoreVerdict()).toBe('RESTORED');

    const restored = getTripSessionSnapshot();
    expect(restored.sessionId).toBe(id);
    expect(restored.kind).toBe('JOURNEY');
    expect(restored.journeyCompleted).toBe(false);
    expect(restored.distanceMeters).toBe(120_000);
    expect(restored.state).toBe('STOPPED');

    /* Yeniden hareket: tripLog YENİ bir segment açar (yeni startPerfMs). */
    const resumeMono = 500 + 2 * MIN;
    mono = resumeMono; wall = WALL0 + 133 * MIN;
    _feedTripStateForTest(tripState({ startPerfMs: resumeMono, startTime: wall, distanceKm: 0, movingMs: 0 }));
    mono = resumeMono + 150 * MIN; wall = WALL0 + 283 * MIN;
    _feedTripStateForTest(tripState({ startPerfMs: resumeMono, startTime: WALL0 + 133 * MIN, distanceKm: 180, movingMs: 148 * MIN }));

    const p = getTripSessionSnapshot();
    expect(p.sessionId).toBe(id);
    expect(p.distanceMeters).toBe(300_000);
    expect(p.segmentCount).toBe(2);
    expect(p.journeyCompleted).toBe(false);
    /* TripComputer aynı projeksiyonu gösterir: 300 km, tek yolculuk. */
    const st = selectTrip(NO_TRIP, { tankL: 50 }, p);
    expect(st.metrics.distanceKm.value).toBe(300);
    expect(st.view).toBe('active');
    /* Restart molası da bir duruştur: 1 mola + 0 segment içi duruş. */
    expect(st.metrics.stopCount.value).toBe(1);
  });

  it('2 · DRIVE_LOG → restart → kayıt sürekliliği, sahte tamamlanma yok', () => {
    registerNavIntentReader(() => ({ routeActive: false, arrivalSeq: 0 }));
    const id = driveFirstLeg();
    expect(getTripSessionSnapshot().kind).toBe('DRIVE_LOG');
    restartProcess(110);
    setTripSessionVehicle('veh-A');
    _restoreTripSessionForTest();
    const p = getTripSessionSnapshot();
    expect(p.sessionId).toBe(id);
    expect(p.kind).toBe('DRIVE_LOG');
    expect(p.journeyCompleted).toBe(false);
  });

  it('7 · A aracının kaydı B seçilince SIZMAZ, silinmez, A dönünce bulunur', () => {
    const id = driveFirstLeg();
    restartProcess(131);
    setTripSessionVehicle('veh-B');
    _restoreTripSessionForTest();
    expect(getTripSessionRestoreVerdict()).toBe('VEHICLE_MISMATCH');
    expect(getTripSessionSnapshot().sessionId).toBeNull();
    /* B aracında hareket YOKKEN gelen örnek A'nın kaydını SİLMEZ. */
    _feedTripStateForTest(tripState(null));
    expect(safeGetRaw(PERSIST_KEY)).not.toBeNull();
    /* Araç değişimi devralmayı yeniden dener — servis ayaktayken de. */
    setTripSessionVehicle('veh-A');
    _restoreTripSessionForTest();
    expect(getTripSessionRestoreVerdict()).toBe('RESTORED');
    expect(getTripSessionSnapshot().sessionId).toBe(id);
  });

  it('5 · bozuk kayıt reddedilir ve SİLİNİR; temiz kayıt durumuna geçilir', () => {
    safeSetRaw(PERSIST_KEY, '{"v":1,"sessionId":');
    setTripSessionVehicle('veh-A');
    _restoreTripSessionForTest();
    expect(getTripSessionRestoreVerdict()).toBe('BAD_SHAPE');
    expect(safeGetRaw(PERSIST_KEY)).toBeNull();
    expect(getTripSessionSnapshot().sessionId).toBeNull();
    expect(getTripSessionSnapshot().journeyCompleted).toBe(false);
  });

  it('6 · bayat kayıt (4 saat+) reddedilir — sahte devam yok', () => {
    driveFirstLeg();
    restartProcess(101 + 5 * 60);
    setTripSessionVehicle('veh-A');
    _restoreTripSessionForTest();
    expect(getTripSessionRestoreVerdict()).toBe('STALE');
    expect(getTripSessionSnapshot().sessionId).toBeNull();
  });

  it('15 · varış → kayıt silinir; restart biten yolculuğu DİRİLTMEZ', () => {
    const id = driveFirstLeg();
    clock(130 * MIN);
    _feedTripStateForTest(tripState({ startPerfMs: 130 * MIN, startTime: WALL0 + 130 * MIN, distanceKm: 0, movingMs: 0 }));
    registerNavIntentReader(() => ({ routeActive: true, arrivalSeq: 1 }));
    clock(131 * MIN);
    _feedTripStateForTest(tripState({ startPerfMs: 130 * MIN, startTime: WALL0 + 130 * MIN, distanceKm: 1, movingMs: MIN }));
    expect(getTripSessionSnapshot().journeyCompleted).toBe(true);
    expect(getTripSessionSnapshot().sessionId).toBe(id);
    expect(safeGetRaw(PERSIST_KEY)).toBeNull();

    restartProcess(135);
    setTripSessionVehicle('veh-A');
    _restoreTripSessionForTest();
    expect(getTripSessionRestoreVerdict()).toBe('NO_RECORD');
    expect(getTripSessionSnapshot().sessionId).toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 2) TRIP COMPUTER — OTURUM TOPLAMI
 * ════════════════════════════════════════════════════════════════════════ */

/** İki bacaklı yolculuk: 120 km + 180 km, arada mühürlenmiş segment. */
function twoLegJourney(): TripSession {
  let s = journeyAfterFirstLeg();
  const resumeAt = 130 * MIN;
  s = advanceTripSession(s, sample(resumeAt, seg({ key: resumeAt }), { routeActive: true }));
  s = advanceTripSession(s, sample(resumeAt + 150 * MIN, seg({
    key: resumeAt, movingMs: 148 * MIN, idleMs: MIN,
    distanceM: 180_000, gpsDistanceM: 180_000,
    maxSpeedKmh: 128, speedSum: 14_400, speedCount: 120,
    stopCount: 1, harshBrakeCount: 2, harshAccelCount: 1,
    maxRpm: 2_900, maxEngineTempC: 94, fuelUsedPct: 18,
    priceUnit: 50, priceCurrency: 'TRY', priceSource: 'MANUAL',
  }), { routeActive: true }));
  return s;
}

describe('TripComputer oturum toplamını gösterir', () => {
  it('8 · 120 km + 180 km → 300 km (son segment DEĞİL)', () => {
    const p = projectTripSession(twoLegJourney(), 280 * MIN);
    const st = selectTrip(NO_TRIP, { tankL: 50 }, p);
    expect(st.metrics.distanceKm.value).toBe(300);
    expect(st.metrics.distanceKm.source).toBe('MEASURED');
  });

  it('9 · segment mühürlenince ekran SIFIRLANMAZ', () => {
    /* Mola anı: aktif yolculuk YOK, oturum açık. */
    const p = projectTripSession(journeyAfterFirstLeg(), 110 * MIN);
    const st = selectTrip(NO_TRIP, { tankL: 50 }, p);
    expect(st.metrics.distanceKm.value).toBe(120);
    expect(st.view).toBe('active');
    expect(has(st.metrics.movingTimeMin)).toBe(true);
  });

  it('10 · hareket/duruş/bilinmeyen süreler segmentler arası toplanır', () => {
    const p = projectTripSession(twoLegJourney(), 280 * MIN);
    const st = selectTrip(NO_TRIP, { tankL: 50 }, p);
    expect(st.metrics.movingTimeMin.value).toBe(88 + 148);
    /* Duruş = segment içi rölanti (2+1) + segmentler arası mola. Mola,
       segmentin SON GÖZLENDİĞİ andan (100 dk) yeniden harekete (130 dk) kadar
       sayılır = 30 dk — mühürün fark edildiği örnek anından değil. */
    expect(st.metrics.idleTimeMin.value).toBe(2 + 1 + 30);
    /* Duruş sayısı = debounce'lu duruşlar + mola sayısı. */
    expect(st.metrics.stopCount.value).toBe(2 + 1 + 1);
    /* Toplam süre yola çıkalı geçen süredir. */
    expect(st.metrics.durationMin.value).toBe(270);
  });

  it('11 · sert manevralar KANONİK segment sayaçlarından toplanır', () => {
    const p = projectTripSession(twoLegJourney(), 280 * MIN);
    const st = selectTrip(NO_TRIP, { tankL: 50 }, p);
    expect(st.metrics.harshBrakeCount.value).toBe(3);
    expect(st.metrics.harshAccelCount.value).toBe(3);
    expect(st.metrics.harshBrakeCount.source).toBe('MEASURED');
  });

  it('11b · tepe ve ortalama hız oturum boyunca doğru', () => {
    const p = projectTripSession(twoLegJourney(), 280 * MIN);
    const st = selectTrip(NO_TRIP, { tankL: 50 }, p);
    /* Tepe TOPLANMAZ — en büyüğü alınır. */
    expect(st.metrics.maximumSpeedKmh.value).toBe(132);
    /* Ortalama = oturumun yolu / sürüş süresi (mola HARİÇ) — segment ortalamalarının
       ortalaması da, hız örneklerinin ortalaması da DEĞİL (saha 2026-09-25). */
    expect(st.metrics.averageSpeedKmh.value).toBe(75);
  });

  it('12 · yakıt ölçülebildiyse segmentler toplanır ve litreye çevrilir', () => {
    const p = projectTripSession(twoLegJourney(), 280 * MIN);
    expect(p.fuelUsedPct).toBe(30);
    const st = selectTrip(NO_TRIP, { tankL: 50 }, p);
    /* %30 × 50 L = 15 L. Litre DERIVED'dır (yüzde ölçülendir). */
    expect(st.metrics.fuelUsedL.value).toBe(15);
    expect(st.metrics.fuelUsedL.source).toBe('DERIVED');
    expect(st.metrics.estimatedCost.value).toBe(750);
    expect(consumptionL100(st.metrics).value).toBe(5);
  });

  it('13 · BİR segment ölçülemediyse toplam UNAVAILABLE kalır (kısmi sayı yok)', () => {
    let s = emptyTripSession();
    s = advanceTripSession(s, sample(10 * MIN, seg({ key: 10 * MIN }), { routeActive: true }));
    s = advanceTripSession(s, sample(50 * MIN, seg({
      key: 10 * MIN, movingMs: 40 * MIN, distanceM: 60_000, fuelUsedPct: null,
    }), { routeActive: true }));
    s = advanceTripSession(s, sample(51 * MIN, null, { routeActive: true }));
    const resumeAt = 60 * MIN;
    s = advanceTripSession(s, sample(resumeAt, seg({ key: resumeAt }), { routeActive: true }));
    s = advanceTripSession(s, sample(resumeAt + 30 * MIN, seg({
      key: resumeAt, movingMs: 30 * MIN, distanceM: 40_000, fuelUsedPct: 9,
    }), { routeActive: true }));

    const p = projectTripSession(s, resumeAt + 30 * MIN);
    expect(p.fuelUsedPct).toBeNull();
    const st = selectTrip(NO_TRIP, { tankL: 50 }, p);
    expect(st.metrics.fuelUsedL.source).toBe('UNAVAILABLE');
    expect(st.metrics.fuelUsedL.value).toBeNull();
    expect(st.metrics.estimatedCost.source).toBe('UNAVAILABLE');
    /* Mesafe ölçülüyor — yakıt bilinmiyor diye mesafe kaybolmaz. */
    expect(st.metrics.distanceKm.value).toBe(100);
  });

  it('14 · GERÇEK sıfır ile veri yokluğu domain\'de ayrıdır', () => {
    let s = emptyTripSession();
    s = advanceTripSession(s, sample(10 * MIN, seg({ key: 10 * MIN })));
    s = advanceTripSession(s, sample(20 * MIN, seg({
      key: 10 * MIN, movingMs: 10 * MIN, distanceM: 8_000,
      speedSum: 480, speedCount: 10, harshBrakeCount: 0,
    })));
    const st = selectTrip(NO_TRIP, { tankL: null }, projectTripSession(s, 20 * MIN));
    /* Sert manevra GERÇEKTEN 0 → MEASURED 0. */
    expect(st.metrics.harshBrakeCount.value).toBe(0);
    expect(st.metrics.harshBrakeCount.source).toBe('MEASURED');
    expect(has(st.metrics.harshBrakeCount)).toBe(true);
    /* Depo hacmi yapılandırılmamış → yakıt BİLİNMİYOR (0 değil). */
    expect(st.metrics.fuelUsedL.source).toBe('UNAVAILABLE');
    expect(has(st.metrics.fuelUsedL)).toBe(false);
  });

  it('15 · varış → journeyCompleted ve ekran tamamlanmış yolculuğu gösterir', () => {
    let s = twoLegJourney();
    s = advanceTripSession(s, sample(281 * MIN, seg({
      key: 130 * MIN, movingMs: 149 * MIN, distanceM: 181_000,
    }), { routeActive: true, arrivalSeq: 1 }));
    const p = projectTripSession(s, 281 * MIN);
    expect(p.journeyCompleted).toBe(true);
    expect(selectTrip(NO_TRIP, { tankL: 50 }, p).view).toBe('last');
  });

  it('19 · depolama mührü / servis durması journey completion DEĞİLDİR', () => {
    const p = projectTripSession(journeyAfterFirstLeg(), 110 * MIN);
    expect(p.journeyCompleted).toBe(false);
    expect(selectTrip(NO_TRIP, { tankL: 50 }, p).view).toBe('active');
  });

  it('oturum yoksa ESKİ davranışa düşülür (sahte toplam üretilmez)', () => {
    expect(selectTrip(NO_TRIP, { tankL: 50 }, null).view).toBe('none');
    const empty = projectTripSession(emptyTripSession(), 0);
    expect(selectTrip(NO_TRIP, { tankL: 50 }, empty).view).toBe('none');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 3) YAPISAL KİLİTLER
 * ════════════════════════════════════════════════════════════════════════ */

function src(...parts: string[]): string {
  return readFileSync(join(process.cwd(), ...parts), 'utf-8');
}

describe('yapısal kilitler — yeni otorite doğmadı', () => {
  it('21 · harsh-event tek otoritesi (9d78b68e) korunuyor', () => {
    const trip = src('src', 'platform', 'tripLogService.ts');
    expect(trip).not.toContain('_active.harshBrakeEvents');
    expect(trip).toContain('harshBrakeCount: acc.harshBrakeCount');
    /* Oturum katmanı sert manevrayı SAYMAZ, yalnız segment sayacını taşır. */
    const svc = src('src', 'platform', 'trip', 'tripSessionService.ts');
    expect(svc).toContain('harshBrakeCount: m ? m.harshBrakeCount : 0');
    expect(svc).not.toMatch(/HARSH_DELTA|lastSpeedKmh|speedDelta/);
  });

  it('22 · rota niyeti semantiği (4543ccf9) korunuyor', () => {
    const model = src('src', 'platform', 'trip', 'core', 'tripSessionModel.ts');
    expect(model).toContain("kind: TripSessionKind");
    expect(model).toContain('SESSION_MAX_BREAK_MS && !session.routeActive');
    expect(model).toContain("completion === 'DESTINATION_REACHED'");
    /* Canlı rota iddiası kalıcı kayıttan DİRİLTİLMEZ. */
    expect(model).toContain('routeActive: false,');
  });

  it('oturum katmanı yeni ölçüm motoru KURMAZ', () => {
    const svc = src('src', 'platform', 'trip', 'tripSessionService.ts');
    /* Mesafe/yakıt/hız hesabı YOK — yalnız kanonik sahiplerden okuma. */
    /* Yorumlarda sahip ADI geçebilir; aranan şey ÇAĞRI/UYGULAMAdır. */
    expect(svc).not.toMatch(/haversine\(|Math\.sqrt\(|fuelPercentToLitres\(/);
    expect(svc).toContain('evaluateFuelMeasurement');
    /* Yeni zamanlayıcı YOK. */
    expect(svc).not.toMatch(/setInterval\(|setTimeout\(|requestAnimationFrame\(/);
  });

  it('20 · TripComputer sunum katmanı (gün/gece · kaydırma · geometri) değişmedi', () => {
    const screen = src('src', 'components', 'cockpit', 'TripComputerScreen.tsx');
    /* Zero-presentation ve provenance korunuyor. */
    expect(screen).toContain('data-trip-source');
    expect(screen).toContain('tripc-band');
    const page = src('src', 'components', 'cockpit', 'TripComputerPage.tsx');
    expect(page).toContain('settings.dayNightMode');
    /* Sayfa hâlâ kendi gezinmesine SAHİP DEĞİL (pager sahibi). */
    expect(page).toContain('onHome');
  });

  it('kalıcılık mevcut primitive üzerinden — yeni depolama sistemi yok', () => {
    const svc = src('src', 'platform', 'trip', 'tripSessionService.ts');
    expect(svc).toContain("from '../../utils/safeStorage'");
    expect(svc).not.toMatch(/indexedDB|openDatabase|sqlite|createStore\(/i);
  });
});
