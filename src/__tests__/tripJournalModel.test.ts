/**
 * tripJournalModel.test.ts — KANONİK SEYİR DEFTERİ MODELİ KİLİTLERİ.
 *
 * Bu testler üç kusuru kilitler:
 *  1. TEK GPS örneğiyle yolculuk açılması (sahte yolculuk).
 *  2. Kanıt yokken "park hâlinde"/"hareket ediyor" İDDİA EDİLMESİ.
 *  3. Kısa duruşun yolculuğu kapatmış gibi gösterilmesi.
 */

import { describe, it, expect } from 'vitest';
import {
  deriveTripJournalState, isTripOpen,
  observeMotion, hasMotionEvidence, emptyMotionEvidence,
  MOTION_EVIDENCE_MIN_SPAN_MS, MOTION_EVIDENCE_WINDOW_MS,
  JOURNAL_EVIDENCE_STALE_MS,
  decideRouteSample, encodeRouteTrace, decodeRouteTrace,
  ROUTE_MIN_DISTANCE_M, ROUTE_STOPPED_INTERVAL_MS, ROUTE_MAX_POINTS,
  readTripJournalRecord, isCleanEndReason,
  type RoutePoint,
} from '../platform/trip/tripJournalModel';

/* ══════════════════════════════════════════════════════════════════════════
 * 1. HAREKET KANITI KAPISI
 * ════════════════════════════════════════════════════════════════════════ */

describe('hareket kanıtı kapısı', () => {
  const obs = (monoMs: number, speedKmh: number | null, source: 'GPS' | 'OBD' = 'GPS') =>
    ({ monoMs, speedKmh, source, thresholdKmh: 5 } as const);

  it('TEK örnek yolculuk açmaya YETMEZ (sahte yolculuk kilidi)', () => {
    const ev = observeMotion(emptyMotionEvidence(), obs(1_000, 40));
    expect(ev.count).toBe(1);
    expect(hasMotionEvidence(ev)).toBe(false);
  });

  it('aynı ana sıkışmış iki örnek de YETMEZ — kanıt DAĞILMALI', () => {
    let ev = observeMotion(emptyMotionEvidence(), obs(1_000, 40));
    ev = observeMotion(ev, obs(1_000 + MOTION_EVIDENCE_MIN_SPAN_MS - 1, 42));
    expect(ev.count).toBe(2);
    expect(hasMotionEvidence(ev)).toBe(false);
  });

  it('yeterli aralıkla gelen iki örnek kapıyı AÇAR', () => {
    let ev = observeMotion(emptyMotionEvidence(), obs(1_000, 40));
    ev = observeMotion(ev, obs(1_000 + MOTION_EVIDENCE_MIN_SPAN_MS, 42));
    expect(hasMotionEvidence(ev)).toBe(true);
  });

  it('yolculuk başlangıcı İLK kanıtın anıdır, kapının geçildiği an DEĞİL', () => {
    let ev = observeMotion(emptyMotionEvidence(), obs(5_000, 40));
    ev = observeMotion(ev, obs(9_000, 45));
    expect(hasMotionEvidence(ev)).toBe(true);
    expect(ev.firstMonoMs).toBe(5_000);
  });

  it('eşik ALTI örnek birikmiş kanıtı SIFIRLAR', () => {
    let ev = observeMotion(emptyMotionEvidence(), obs(1_000, 40));
    ev = observeMotion(ev, obs(2_500, 0));
    expect(ev.count).toBe(0);
    expect(hasMotionEvidence(ev)).toBe(false);
  });

  it('pencere dolduktan sonraki örnek YENİ zincir başlatır (gün boyu birikme YOK)', () => {
    let ev = observeMotion(emptyMotionEvidence(), obs(1_000, 40));
    ev = observeMotion(ev, obs(1_000 + MOTION_EVIDENCE_WINDOW_MS + 1, 40));
    expect(ev.count).toBe(1);
    expect(hasMotionEvidence(ev)).toBe(false);
  });

  it('ölçülemeyen hız kanıtı ne artırır ne siler', () => {
    let ev = observeMotion(emptyMotionEvidence(), obs(1_000, 40));
    const before = ev;
    ev = observeMotion(ev, obs(2_000, null));
    expect(ev).toEqual(before);
  });

  it('geriye giden zaman örneği YOK SAYILIR', () => {
    let ev = observeMotion(emptyMotionEvidence(), obs(5_000, 40));
    ev = observeMotion(ev, obs(9_000, 40));
    const before = ev;
    ev = observeMotion(ev, obs(8_000, 40));
    expect(ev).toEqual(before);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 2. SEYİR DURUMU PROJEKSİYONU
 * ════════════════════════════════════════════════════════════════════════ */

describe('seyir durumu projeksiyonu', () => {
  const base = {
    monoMs: 100_000, active: false, lastSampleMonoMs: 99_000,
    stopSinceMonoMs: null, endPending: false, justCompleted: false,
  } as const;

  it('aktif yolculuk + taze kanıt + hareket → MOVING', () => {
    expect(deriveTripJournalState({ ...base, active: true })).toBe('MOVING');
  });

  it('aktif yolculuk + duruş → STOPPED_IN_TRIP (trip KAPANMAZ)', () => {
    const s = deriveTripJournalState({ ...base, active: true, stopSinceMonoMs: 95_000 });
    expect(s).toBe('STOPPED_IN_TRIP');
    expect(isTripOpen(s)).toBe(true);
  });

  it('kapanış penceresi işlerken TRIP_ENDING — hâlâ AÇIK yolculuk', () => {
    const s = deriveTripJournalState({
      ...base, active: true, stopSinceMonoMs: 95_000, endPending: true,
    });
    expect(s).toBe('TRIP_ENDING');
    expect(isTripOpen(s)).toBe(true);
  });

  it('kapanış gözlendiğinde COMPLETED her şeyin önünde gelir', () => {
    const s = deriveTripJournalState({
      ...base, active: true, endPending: true, justCompleted: true,
    });
    expect(s).toBe('COMPLETED');
    expect(isTripOpen(s)).toBe(false);
  });

  it('yolculuk yok + kanıt taze → PARKED', () => {
    expect(deriveTripJournalState(base)).toBe('PARKED');
  });

  it('yolculuk yok + kanıt BAYAT → PARKED İDDİA EDİLMEZ (UNKNOWN_DEGRADED)', () => {
    const s = deriveTripJournalState({
      ...base, lastSampleMonoMs: base.monoMs - JOURNAL_EVIDENCE_STALE_MS,
    });
    expect(s).toBe('UNKNOWN_DEGRADED');
  });

  it('hiç örnek gelmediyse hüküm VERİLMEZ', () => {
    expect(deriveTripJournalState({ ...base, lastSampleMonoMs: null }))
      .toBe('UNKNOWN_DEGRADED');
  });

  it('aktif yolculukta kanıt bayatsa "hareket ediyor" DENMEZ', () => {
    const s = deriveTripJournalState({
      ...base, active: true,
      lastSampleMonoMs: base.monoMs - JOURNAL_EVIDENCE_STALE_MS,
    });
    expect(s).toBe('UNKNOWN_DEGRADED');
  });

  it('kanıt kaybı aktif yolculuğu KAPATMAZ — gözlenmiş duruş korunur', () => {
    const s = deriveTripJournalState({
      ...base, active: true, stopSinceMonoMs: 50_000,
      lastSampleMonoMs: base.monoMs - JOURNAL_EVIDENCE_STALE_MS,
    });
    expect(s).toBe('STOPPED_IN_TRIP');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 3. BİTİŞ GEREKÇESİ
 * ════════════════════════════════════════════════════════════════════════ */

describe('bitiş gerekçesi', () => {
  it('yalnız duruş penceresi düzgün kapanıştır', () => {
    expect(isCleanEndReason('IDLE_WINDOW')).toBe(true);
    expect(isCleanEndReason('DATA_SILENCE')).toBe(false);
    expect(isCleanEndReason('SERVICE_STOPPED')).toBe(false);
    expect(isCleanEndReason('UNKNOWN')).toBe(false);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 4. ADAPTİF ROTA ÖRNEKLEMESİ
 * ════════════════════════════════════════════════════════════════════════ */

describe('adaptif rota örneklemesi', () => {
  const pt = (lat: number, lon: number, t: number): RoutePoint =>
    ({ lat, lon, tOffsetMs: t, speedKmh: 50 });

  it('ilk nokta daima kaydedilir', () => {
    const d = decideRouteSample({
      lat: 36.9, lon: 34.6, tOffsetMs: 0, speedKmh: 50,
      last: null, recordedCount: 0, stopped: false,
    });
    expect(d.record).toBe(true);
  });

  it('eşik altı mesafe gürültüdür — yazılmaz', () => {
    const d = decideRouteSample({
      lat: 36.90001, lon: 34.6, tOffsetMs: 1_000, speedKmh: 50,
      last: pt(36.9, 34.6, 0), recordedCount: 1, stopped: false,
    });
    expect(d.record).toBe(false);
    expect(d.skipReason).toBe('TOO_CLOSE');
  });

  it('eşiği aşan mesafe yazılır', () => {
    /* ~55 m kuzey. */
    const d = decideRouteSample({
      lat: 36.9005, lon: 34.6, tOffsetMs: 4_000, speedKmh: 50,
      last: pt(36.9, 34.6, 0), recordedCount: 1, stopped: false,
    });
    expect(d.record).toBe(true);
    expect(ROUTE_MIN_DISTANCE_M).toBeGreaterThan(0);
  });

  it('DURURKEN saniyelik nokta YAZILMAZ (depo sözleşmesi)', () => {
    const d = decideRouteSample({
      lat: 36.9005, lon: 34.6, tOffsetMs: 1_000, speedKmh: 0,
      last: pt(36.9, 34.6, 0), recordedCount: 1, stopped: true,
    });
    expect(d.record).toBe(false);
    expect(d.skipReason).toBe('STOPPED_THROTTLE');
  });

  it('dururken seyrek "hâlâ burada" damgası yazılır', () => {
    const d = decideRouteSample({
      lat: 36.9, lon: 34.6, tOffsetMs: ROUTE_STOPPED_INTERVAL_MS, speedKmh: 0,
      last: pt(36.9, 34.6, 0), recordedCount: 1, stopped: true,
    });
    expect(d.record).toBe(true);
  });

  it('kapasite dolduğunda başka hiçbir gerekçe yazmayı meşrulaştırmaz', () => {
    const d = decideRouteSample({
      lat: 36.95, lon: 34.65, tOffsetMs: 900_000, speedKmh: 90,
      last: pt(36.9, 34.6, 0), recordedCount: ROUTE_MAX_POINTS, stopped: false,
    });
    expect(d.record).toBe(false);
    expect(d.skipReason).toBe('CAPACITY');
  });

  it('geçersiz fix yazılmaz', () => {
    const d = decideRouteSample({
      lat: null, lon: null, tOffsetMs: 1_000, speedKmh: 50,
      last: null, recordedCount: 0, stopped: false,
    });
    expect(d.record).toBe(false);
    expect(d.skipReason).toBe('NO_FIX');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 5. ROTA SIKIŞTIRMA
 * ════════════════════════════════════════════════════════════════════════ */

describe('rota izi sıkıştırma', () => {
  const trace: RoutePoint[] = [
    { lat: 36.9000, lon: 34.6000, tOffsetMs: 0,      speedKmh: 30 },
    { lat: 36.9010, lon: 34.6012, tOffsetMs: 5_000,  speedKmh: 55 },
    { lat: 36.9025, lon: 34.6030, tOffsetMs: 11_000, speedKmh: 72 },
    { lat: 36.9040, lon: 34.6051, tOffsetMs: 17_000, speedKmh: null },
  ];

  it('kodla→çöz turu noktaları ~1 m içinde korur', () => {
    const back = decodeRouteTrace(encodeRouteTrace(trace));
    expect(back).toHaveLength(trace.length);
    back.forEach((p, i) => {
      const src = trace[i] as RoutePoint;
      expect(Math.abs(p.lat - src.lat)).toBeLessThan(1e-5);
      expect(Math.abs(p.lon - src.lon)).toBeLessThan(1e-5);
      expect(p.tOffsetMs).toBe(src.tOffsetMs);
    });
  });

  it('BİLİNMEYEN hız `0` olarak geri GELMEZ', () => {
    const back = decodeRouteTrace(encodeRouteTrace(trace));
    expect(back[3]?.speedKmh).toBeNull();
    expect(back[0]?.speedKmh).toBe(30);
  });

  it('delta kodlama ham JSON’dan küçüktür', () => {
    const long: RoutePoint[] = Array.from({ length: 400 }, (_, i) => ({
      lat: 36.9 + i * 0.0004, lon: 34.6 + i * 0.0005,
      tOffsetMs: i * 4_000, speedKmh: 60 + (i % 7),
    }));
    const raw = JSON.stringify(long).length;
    const enc = JSON.stringify(encodeRouteTrace(long)).length;
    expect(enc).toBeLessThan(raw);
  });

  it('boş iz `null` döner — boş kayıt UYDURULMAZ', () => {
    expect(encodeRouteTrace([])).toBeNull();
  });

  it('bozuk kodlama YARIM iz döndürmez', () => {
    expect(decodeRouteTrace({ v: 1, lat0: 1, lon0: 1, t0: 0, dlat: [1], dlon: [], dt: [1], spd: [1, 2] })).toEqual([]);
    expect(decodeRouteTrace({ v: 2 })).toEqual([]);
    expect(decodeRouteTrace(null)).toEqual([]);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 6. KAYIT OKUMA (SAVUNMACI)
 * ════════════════════════════════════════════════════════════════════════ */

describe('seyir kaydı okuma', () => {
  it('kimliksiz kayıt reddedilir', () => {
    expect(readTripJournalRecord({ startedAtMs: 1 })).toBeNull();
    expect(readTripJournalRecord(null)).toBeNull();
  });

  it('bozuk rota bütün kaydı DÜŞÜRMEZ', () => {
    const rec = readTripJournalRecord({
      tripId: 'trip-1', startedAtMs: 1_000, endedAtMs: 2_000,
      endReason: 'IDLE_WINDOW', route: { v: 9 }, stops: [], events: [],
    });
    expect(rec).not.toBeNull();
    expect(rec?.route).toBeNull();
    expect(rec?.endReason).toBe('IDLE_WINDOW');
  });

  it('tanınmayan bitiş gerekçesi UYDURULMAZ → UNKNOWN', () => {
    const rec = readTripJournalRecord({
      tripId: 't', startedAtMs: 1, endReason: 'HAYALI_SEBEP',
    });
    expect(rec?.endReason).toBe('UNKNOWN');
  });

  it('Null Island konumu gerçek konum SAYILMAZ', () => {
    const rec = readTripJournalRecord({
      tripId: 't', startedAtMs: 1, startLocation: { lat: 0, lon: 0 },
    });
    expect(rec?.startLocation).toBeNull();
  });

  it('bitiş zamanı yoksa uydurma tarih üretilmez', () => {
    const rec = readTripJournalRecord({ tripId: 't', startedAtMs: 1 });
    expect(rec?.endedAtMs).toBeNull();
  });
});
