/**
 * tripEngine.test.ts — TRIP MOTORU KİLİTLERİ.
 *
 * Kilitlenen sözleşmeler:
 *   §2 tek kanonik model · her metrik KAYNAK etiketi taşır
 *   §3 yaşam döngüsü geçişleri (geçersiz geçiş YOK SAYILIR)
 *   §4 veri yoksa `null` — TAHMİN ÜRETİLMEZ; tahmin ÖLÇÜM gibi sunulmaz
 *   §5 trip anlık yüklenmez; kapanınca TEK özet
 *   §6 dedupe + revizyon — aynı yolculuk İKİ KEZ SAYILMAZ
 *   Trip KOORDİNAT TAŞIMAZ (rota geçmişi kapsam dışı)
 */

import { describe, it, expect } from 'vitest';
import {
  metric,
  buildTripKey,
  deriveTripConfidence,
  isUploadable,
  isTerminal,
  metricLabel,
  metricSourceLabel,
  tripStateLabel,
  tripConfidenceLabel,
  EMPTY_TRIP_METRICS,
  UNAVAILABLE_METRIC,
  TRIP_STATES,
  type TripSummary,
} from '../platform/trip/tripCanonicalModel';
import {
  applyTransition,
  canTransition,
  toCanonicalTripSummary,
  buildTripStatistics,
  type LegacyTripRecord,
} from '../platform/trip/tripLifecycle';
import {
  TripUploadCoordinator,
  parseTripAck,
  MAX_TRIP_UPLOAD_ATTEMPTS,
} from '../platform/trip/tripUploadCoordinator';

const NOW = 1_700_000_000_000;

/** `tripLogService`'in gerçekte ürettiği kayıt biçimi. */
function legacy(over: Partial<LegacyTripRecord> = {}): LegacyTripRecord {
  return {
    id: 'trip-abc',
    startTime: NOW,
    endTime: NOW + 3_300_000,
    distanceKm: 42.5,
    durationMin: 55,
    avgSpeedKmh: 46,
    maxSpeedKmh: 118,
    fuelConsumptionL: 3.6,
    fuelCostTL: 162,
    drivingScore: 88,
    harshEvents: 3,
    ...over,
  };
}

/* ══════════════════════════════════════════════════════════════════════ */

describe('§4 · TAHMİN ÖLÇÜM GİBİ SUNULMAZ', () => {
  it('1. 🔒 yakıt ÖLÇÜLMEDİYSE ESTIMATED etiketlenir', () => {
    /* `tripLogService` yakıtı 8.5 L/100km sabitiyle TAHMİN ediyor. */
    const s = toCanonicalTripSummary(legacy(), 'COMPLETED');
    expect(s.metrics.fuelUsedL.value).toBe(3.6);
    expect(s.metrics.fuelUsedL.source).toBe('ESTIMATED');
    expect(metricLabel(s.metrics.fuelUsedL, 'L')).toBe('3.6 L (tahmini)');
  });

  it('2. 🔒 maliyet sabit fiyatla hesaplandıysa ESTIMATED', () => {
    const s = toCanonicalTripSummary(legacy(), 'COMPLETED');
    expect(s.metrics.estimatedCost.source).toBe('ESTIMATED');
    /* Gerçek fiyat biliniyorsa DERIVED olur. */
    const s2 = toCanonicalTripSummary(legacy(), 'COMPLETED', { fuelPriceKnown: true });
    expect(s2.metrics.estimatedCost.source).toBe('DERIVED');
  });

  it('3. 🔒 yakıt GERÇEKTEN ölçüldüyse MEASURED olur', () => {
    const s = toCanonicalTripSummary(legacy(), 'COMPLETED', { fuelMeasured: true });
    expect(s.metrics.fuelUsedL.source).toBe('MEASURED');
    expect(metricLabel(s.metrics.fuelUsedL, 'L')).toBe('3.6 L');
  });

  it('4. 🔒 mesafe kaynağı GPS ise MEASURED, OBD Euler ise DERIVED', () => {
    expect(toCanonicalTripSummary(legacy(), 'COMPLETED', { distanceSource: 'MEASURED' })
      .metrics.distanceKm.source).toBe('MEASURED');
    expect(toCanonicalTripSummary(legacy(), 'COMPLETED', { distanceSource: 'DERIVED' })
      .metrics.distanceKm.source).toBe('DERIVED');
  });

  it('5. 🔒 VAR OLMAYAN metrikler UYDURULMAZ → UNAVAILABLE', () => {
    const s = toCanonicalTripSummary(legacy(), 'COMPLETED');
    /* `tripLogService` bunları HİÇ üretmiyor. */
    for (const m of [
      s.metrics.idleTimeMin, s.metrics.movingTimeMin, s.metrics.stopCount,
      s.metrics.maxRpm, s.metrics.maxEngineTempC, s.metrics.speedViolations,
    ]) {
      expect(m.value).toBeNull();
      expect(m.source).toBe('UNAVAILABLE');
      expect(metricLabel(m, 'x')).toBe('Veri yok');
    }
  });

  it('6. 🔒 sert manevra YÖN AYRIMI kalıcı değil → bağlam yoksa UNAVAILABLE', () => {
    const s = toCanonicalTripSummary(legacy(), 'COMPLETED');
    expect(s.metrics.harshBrakeCount.source).toBe('UNAVAILABLE');
    /* Canlı trip kapanırken bağlam verilirse MEASURED olur. */
    const s2 = toCanonicalTripSummary(legacy(), 'COMPLETED', {
      harshBrakeCount: 2, harshAccelCount: 1,
    });
    expect(s2.metrics.harshBrakeCount.value).toBe(2);
    expect(s2.metrics.harshBrakeCount.source).toBe('MEASURED');
  });

  it('7. 🔒 geçersiz sayı UNAVAILABLE\'a düşer, ölçülen 0 KORUNUR', () => {
    expect(metric(NaN, 'MEASURED').value).toBeNull();
    expect(metric(Infinity, 'MEASURED').source).toBe('UNAVAILABLE');
    expect(metric(0, 'MEASURED').value).toBe(0);
    expect(metric(0, 'MEASURED').source).toBe('MEASURED');
  });

  it('8. 🔒 negatif mesafe/süre kabul edilmez', () => {
    const s = toCanonicalTripSummary(legacy({ distanceKm: -5, durationMin: -1 }), 'COMPLETED');
    expect(s.metrics.distanceKm.value).toBeNull();
    expect(s.metrics.durationMin.value).toBeNull();
  });

  it('9. 🔒 etiket sözlüğü tahmin/ölçüm ayrımını taşır', () => {
    expect(metricSourceLabel('ESTIMATED')).toBe('Tahmini');
    expect(metricSourceLabel('MEASURED')).toBe('Ölçüldü');
    expect(metricSourceLabel('UNAVAILABLE')).toBe('Veri yok');
  });
});

describe('§2 · kanonik model bütünlüğü', () => {
  it('10. 🔒 boş metrik şablonunda TÜM alanlar UNAVAILABLE', () => {
    for (const m of Object.values(EMPTY_TRIP_METRICS)) {
      expect(m).toEqual(UNAVAILABLE_METRIC);
    }
  });

  it('11. 🔒 özet KOORDİNAT TAŞIMAZ (rota geçmişi kapsam dışı)', () => {
    const s = toCanonicalTripSummary(legacy(), 'COMPLETED', {
      events: [{ kind: 'HARSH_BRAKE', atOffsetMs: 120_000, magnitude: 22 }],
    });
    const json = JSON.stringify(s).toLowerCase();
    for (const forbidden of ['latitude', 'longitude', '"lat"', '"lng"', 'coord']) {
      expect(json).not.toContain(forbidden);
    }
  });

  it('12. 🔒 olaylar MUTLAK zaman değil OFFSET taşır', () => {
    const s = toCanonicalTripSummary(legacy(), 'COMPLETED', {
      events: [{ kind: 'HARSH_BRAKE', atOffsetMs: 120_000, magnitude: 22 }],
    });
    expect(s.events[0].atOffsetMs).toBe(120_000);
    expect(Object.keys(s.events[0])).toEqual(['kind', 'atOffsetMs', 'magnitude']);
  });

  it('13. 🔒 skor 0–100 aralığına kırpılır, geçersizse null', () => {
    expect(toCanonicalTripSummary(legacy({ drivingScore: 150 }), 'COMPLETED').score).toBe(100);
    expect(toCanonicalTripSummary(legacy({ drivingScore: -10 }), 'COMPLETED').score).toBe(0);
    expect(toCanonicalTripSummary(legacy({ drivingScore: NaN }), 'COMPLETED').score).toBeNull();
  });
});

describe('§6 · dedupe anahtarı DETERMİNİSTİK', () => {
  it('14. 🔒 aynı yolculuk AYNI anahtarı üretir (yeniden başlatmada da)', () => {
    const a = buildTripKey({ startedAtMs: NOW, endedAtMs: NOW + 3_300_000, distanceKm: 42.5 });
    const b = buildTripKey({ startedAtMs: NOW + 400, endedAtMs: NOW + 3_300_100, distanceKm: 42.5 });
    expect(a).toBe(b);   // saniye çözünürlüğü → milisaniye gürültüsü etkilemez
  });

  it('15. 🔒 FARKLI yolculuk FARKLI anahtar üretir', () => {
    const a = buildTripKey({ startedAtMs: NOW, endedAtMs: NOW + 3_300_000, distanceKm: 42.5 });
    expect(a).not.toBe(buildTripKey({ startedAtMs: NOW + 10_000, endedAtMs: NOW + 3_300_000, distanceKm: 42.5 }));
    expect(a).not.toBe(buildTripKey({ startedAtMs: NOW, endedAtMs: NOW + 3_300_000, distanceKm: 51.0 }));
  });

  it('16. 🔒 rastgele tripId dedupe anahtarına GİRMEZ', () => {
    const a = toCanonicalTripSummary(legacy({ id: 'trip-1' }), 'COMPLETED');
    const b = toCanonicalTripSummary(legacy({ id: 'trip-2' }), 'COMPLETED');
    expect(a.tripKey).toBe(b.tripKey);
    expect(a.tripId).not.toBe(b.tripId);
  });
});

describe('§3 · yaşam döngüsü', () => {
  it('17. 🔒 tam akış RUNNING→PAUSED→RESUMED→RUNNING', () => {
    let s = applyTransition('RUNNING', 'MOVE_STOPPED');
    expect(s.state).toBe('PAUSED');
    s = applyTransition(s.state, 'MOVE_STARTED');
    expect(s.state).toBe('RESUMED');
    s = applyTransition(s.state, 'MOVE_STARTED');
    expect(s.state).toBe('RUNNING');
  });

  it('18. 🔒 idle penceresi dolunca her aktif durumdan COMPLETED', () => {
    for (const st of ['RUNNING', 'PAUSED', 'RESUMED'] as const) {
      expect(applyTransition(st, 'IDLE_EXPIRED').state).toBe('COMPLETED');
    }
  });

  it('19. 🔒 COMPLETED→UPLOADED→ARCHIVED', () => {
    expect(applyTransition('COMPLETED', 'UPLOAD_ACCEPTED').state).toBe('UPLOADED');
    expect(applyTransition('UPLOADED', 'ARCHIVE').state).toBe('ARCHIVED');
  });

  it('20. 🔒 GEÇERSİZ geçiş YOK SAYILIR ve gerekçe döner', () => {
    const r = applyTransition('ARCHIVED', 'MOVE_STARTED');
    expect(r.changed).toBe(false);
    expect(r.state).toBe('ARCHIVED');
    expect(r.rejected).toBe('MOVE_STARTED');
    /* Yüklenmiş trip yeniden RUNNING olamaz. */
    expect(applyTransition('UPLOADED', 'MOVE_STARTED').changed).toBe(false);
    expect(canTransition('UPLOADED', 'MOVE_STARTED')).toBe(false);
  });

  it('21. 🔒 yalnız COMPLETED yüklenebilir; terminal durumlar kapalı', () => {
    for (const st of TRIP_STATES) {
      expect(isUploadable(st)).toBe(st === 'COMPLETED');
    }
    expect(isTerminal('UPLOADED')).toBe(true);
    expect(isTerminal('ARCHIVED')).toBe(true);
    expect(isTerminal('RUNNING')).toBe(false);
  });

  it('22. 🔒 durum etiketleri kullanıcı diline çevrilir', () => {
    expect(tripStateLabel('COMPLETED')).toBe('Yükleme bekliyor');
    expect(tripStateLabel('UPLOADED')).toBe('Yüklendi');
    expect(tripStateLabel('PAUSED')).toBe('Durdu');
  });
});

describe('§4 · güven türetimi', () => {
  it('23. 🔒 HIGH yalnız ÖLÇÜLEN mesafe + yeterli örnekle', () => {
    expect(deriveTripConfidence({
      distanceSource: 'MEASURED', durationSource: 'MEASURED',
      speedSampleCount: 50, fuelSource: 'ESTIMATED',
    })).toBe('HIGH');
  });

  it('24. 🔒 OBD Euler mesafesi HIGH olamaz', () => {
    expect(deriveTripConfidence({
      distanceSource: 'DERIVED', durationSource: 'MEASURED',
      speedSampleCount: 50, fuelSource: 'MEASURED',
    })).toBe('MEDIUM');
  });

  it('25. 🔒 az örnek güveni düşürür', () => {
    expect(deriveTripConfidence({
      distanceSource: 'DERIVED', durationSource: 'MEASURED',
      speedSampleCount: 2, fuelSource: 'MEASURED',
    })).toBe('LOW');
  });

  it('26. 🔒 mesafe/süre bilinmiyorsa UNKNOWN', () => {
    expect(deriveTripConfidence({
      distanceSource: 'UNAVAILABLE', durationSource: 'MEASURED',
      speedSampleCount: 50, fuelSource: 'MEASURED',
    })).toBe('UNKNOWN');
    expect(tripConfidenceLabel('UNKNOWN')).toBe('Bilinmiyor');
  });

  it('27. 🔒 yakıt tahmini güveni DÜŞÜRMEZ (ayrı alan)', () => {
    const a = deriveTripConfidence({
      distanceSource: 'MEASURED', durationSource: 'MEASURED',
      speedSampleCount: 50, fuelSource: 'ESTIMATED',
    });
    const b = deriveTripConfidence({
      distanceSource: 'MEASURED', durationSource: 'MEASURED',
      speedSampleCount: 50, fuelSource: 'MEASURED',
    });
    expect(a).toBe(b);
  });
});

/* ── Yükleme koordinatörü ──────────────────────────────────────────────── */

function summary(over: Partial<TripSummary> = {}): TripSummary {
  return { ...toCanonicalTripSummary(legacy(), 'COMPLETED'), ...over };
}

const ack = (state: string, rev: number | null = 1) =>
  parseTripAck({ state, serverRevision: rev });

describe('§5+§6 · yükleme otoritesi', () => {
  it('28. 🔒 kapanmamış trip YÜKLENMEZ', () => {
    const c = new TripUploadCoordinator();
    for (const st of ['RUNNING', 'PAUSED', 'RESUMED'] as const) {
      const d = c.decide(summary({ state: st }));
      expect(d.shouldEnqueue).toBe(false);
      expect(d.skipReason).toBe('NOT_COMPLETED');
    }
  });

  it('29. 🔒 mesafesiz trip YÜKLENMEZ', () => {
    const c = new TripUploadCoordinator();
    const s = summary({ metrics: { ...EMPTY_TRIP_METRICS } });
    const d = c.decide(s);
    expect(d.shouldEnqueue).toBe(false);
    expect(d.skipReason).toBe('NO_DISTANCE');
  });

  it('30. 🔒 kapanmış trip TEK kez kuyruğa verilir', () => {
    const c = new TripUploadCoordinator();
    const s = summary();
    expect(c.decide(s).shouldEnqueue).toBe(true);
    c.markQueued(s, 1, NOW);
    /* Uçuşta olan trip tekrar verilmez. */
    const d = c.decide(s);
    expect(d.shouldEnqueue).toBe(false);
    expect(d.skipReason).toBe('IN_FLIGHT');
  });

  it('31. 🔒 UPLOADED trip bir daha GÖNDERİLMEZ', () => {
    const c = new TripUploadCoordinator();
    const s = summary();
    c.markQueued(s, 1, NOW);
    c.applyAck(s.tripKey, ack('CREATED'), NOW + 100);
    const d = c.decide(s);
    expect(d.shouldEnqueue).toBe(false);
    expect(d.skipReason).toBe('ALREADY_UPLOADED');
    expect(c.getSnapshot().uploadedCount).toBe(1);
  });

  it('32. 🔒 DUPLICATE BAŞARI sayılır — retry döngüsü ÜRETMEZ', () => {
    const c = new TripUploadCoordinator();
    const s = summary();
    c.markQueued(s, 1, NOW);
    c.applyAck(s.tripKey, ack('DUPLICATE'), NOW + 100);
    const snap = c.getSnapshot();
    expect(snap.duplicateCount).toBe(1);
    expect(snap.failedCount).toBe(0);
    expect(snap.lastSuccessAtMs).toBe(NOW + 100);
    expect(c.decide(s).skipReason).toBe('ALREADY_DUPLICATE');
  });

  it('33. 🔒 geçici hatada revizyon ARTAR (§6 düzeltme)', () => {
    const c = new TripUploadCoordinator();
    const s = summary();
    c.markQueued(s, 1, NOW);
    c.applyTransportFailure(s.tripKey, NOW + 100);
    const d = c.decide(s);
    expect(d.shouldEnqueue).toBe(true);
    expect(d.revision).toBe(2);
  });

  it('34. 🔒 SONSUZ RETRY YOK — bütçe tükenince FAILED', () => {
    const c = new TripUploadCoordinator();
    const s = summary();
    for (let i = 0; i < MAX_TRIP_UPLOAD_ATTEMPTS; i += 1) {
      const d = c.decide(s);
      expect(d.shouldEnqueue).toBe(true);
      c.markQueued(s, d.revision, NOW + i);
      c.applyTransportFailure(s.tripKey, NOW + i);
    }
    const d = c.decide(s);
    expect(d.shouldEnqueue).toBe(false);
    expect(d.skipReason).toBe('BUDGET_EXHAUSTED');
    expect(c.getSnapshot().failedCount).toBe(1);
  });

  it('35. 🔒 REJECTED sunucu hükmüdür → retry YOK', () => {
    const c = new TripUploadCoordinator();
    const s = summary();
    c.markQueued(s, 1, NOW);
    c.applyAck(s.tripKey, parseTripAck({ state: 'REJECTED', reason: 'NO_DISTANCE' }), NOW + 1);
    const e = c.getEntry(s.tripKey)!;
    expect(e.state).toBe('FAILED');
    expect(e.lastFailureReason).toBe('NO_DISTANCE');
  });

  it('36. 🔒 OFFLINE REPLAY: 20 kez bildirilse TEK yükleme kalır', () => {
    const c = new TripUploadCoordinator();
    const s = summary();
    let enqueued = 0;
    for (let i = 0; i < 20; i += 1) {
      const d = c.decide(s);
      if (d.shouldEnqueue) { enqueued += 1; c.markQueued(s, d.revision, NOW + i); }
      c.applyAck(s.tripKey, ack('CREATED'), NOW + i);
    }
    expect(enqueued).toBe(1);
  });

  it('37. 🔒 sunucu revizyonu UYDURULMAZ', () => {
    expect(parseTripAck({ state: 'CREATED' }).serverRevision).toBeNull();
    expect(parseTripAck({ state: 'CREATED', serverRevision: 1.5 }).serverRevision).toBeNull();
    expect(parseTripAck({ state: 'CREATED', serverRevision: -1 }).serverRevision).toBeNull();
    expect(parseTripAck(null).state).toBe('UNKNOWN');
    expect(parseTripAck({ state: 'SIHIR' }).state).toBe('UNKNOWN');
  });

  it('38. 🔒 RESTART: defter kalıcılıkla geri gelir (yeniden yükleme YOK)', () => {
    const c1 = new TripUploadCoordinator();
    const s = summary();
    c1.markQueued(s, 1, NOW);
    c1.applyAck(s.tripKey, ack('CREATED'), NOW + 1);
    const saved = c1.serialize();

    const c2 = new TripUploadCoordinator();
    c2.hydrate(saved);
    expect(c2.decide(s).skipReason).toBe('ALREADY_UPLOADED');
  });

  it('39. 🔒 bozuk kalıcı kayıt SESSİZCE atlanır', () => {
    const c = new TripUploadCoordinator();
    expect(() => c.hydrate('metin')).not.toThrow();
    expect(() => c.hydrate([null, {}, { tripKey: '' }, { tripKey: 'x', state: 'SIHIR' }])).not.toThrow();
    expect(c.getSnapshot().entries).toHaveLength(0);
  });

  it('40. 🔒 anlık görüntü ASLA fırlatmaz ve uydurma değer vermez', () => {
    const c = new TripUploadCoordinator();
    const snap = c.getSnapshot();
    expect(() => c.getSnapshot()).not.toThrow();
    expect(snap.lastSuccessAtMs).toBeNull();
    expect(snap.lastFailureAtMs).toBeNull();
    expect(snap.queuedCount).toBe(0);
  });
});

describe('§2 · istatistik toplama', () => {
  it('41. 🔒 TEK tahmin varsa TOPLAM da tahminidir (en zayıf halka)', () => {
    const a = toCanonicalTripSummary(legacy(), 'COMPLETED');                       // fuel ESTIMATED
    const b = toCanonicalTripSummary(legacy(), 'COMPLETED', { fuelMeasured: true }); // MEASURED
    const st = buildTripStatistics([a, b]);
    expect(st.totalFuelL.source).toBe('ESTIMATED');
    expect(st.totalFuelL.value).toBe(7.2);
  });

  it('42. 🔒 null değerler toplamı BOZMAZ, hiç değer yoksa UNAVAILABLE', () => {
    const noFuel = toCanonicalTripSummary(legacy({ fuelConsumptionL: -1 }), 'COMPLETED');
    const st = buildTripStatistics([noFuel]);
    expect(st.totalFuelL.value).toBeNull();
    expect(st.totalFuelL.source).toBe('UNAVAILABLE');
    expect(st.totalDistanceKm.value).toBe(42.5);
  });

  it('43. 🔒 bekleyen yükleme sayısı gerçek durumdan gelir', () => {
    const st = buildTripStatistics([
      toCanonicalTripSummary(legacy(), 'COMPLETED'),
      toCanonicalTripSummary(legacy({ id: 'x', startTime: NOW + 1 }), 'UPLOADED'),
    ]);
    expect(st.tripCount).toBe(2);
    expect(st.pendingUploadCount).toBe(1);
  });

  it('44. 🔒 skor yoksa ortalama UYDURULMAZ', () => {
    const st = buildTripStatistics([toCanonicalTripSummary(legacy({ drivingScore: NaN }), 'COMPLETED')]);
    expect(st.averageScore).toBeNull();
    expect(buildTripStatistics([]).averageScore).toBeNull();
    expect(buildTripStatistics([]).tripCount).toBe(0);
  });
});
