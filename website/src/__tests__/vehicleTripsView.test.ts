/**
 * vehicleTripsView.test.ts — FLEET TRIPS DÜRÜSTLÜK KİLİTLERİ.
 *
 * Kilitlenenler:
 *   · TAHMİN edilmiş metrik "(tahmini)" olarak ETİKETLENİR
 *   · kanıt yoksa "Veri yok" — sahte 0 YASAK
 *   · okunamadı ≠ trip yok
 *   · PostgREST numeric METİN döner → sayıya çevrilir
 *   · görünüm koordinat/rota TAŞIMAZ
 */

import { describe, it, expect } from 'vitest';
import {
  buildTripView,
  buildTripsView,
  tripValueLabel,
  tripSourceLabel,
  tripConfidenceLabel,
  tripUploadStateLabel,
  tripScoreLabel,
  tripTimeLabel,
  tripTimeMs,
  normalizeTripSource,
  type TripRow,
} from '../lib/fleet/vehicleTripsView';

const START = '2026-07-30T08:00:00.000Z';
const END = '2026-07-30T08:55:00.000Z';

function row(over: Partial<TripRow> = {}): TripRow {
  return {
    trip_key: 't1700000000-1700003300-4250',
    trip_id: 'trip-abc',
    revision: 1,
    started_at: START,
    ended_at: END,
    /* PostgREST `numeric` alanları METİN döner — gerçek davranış. */
    distance_km: '42.500',
    duration_min: 55,
    avg_speed_kmh: '46.40',
    max_speed_kmh: '118.00',
    fuel_used_l: '3.600',
    estimated_cost: '162.00',
    score: 88,
    confidence: 'HIGH',
    distance_source: 'MEASURED',
    fuel_source: 'ESTIMATED',
    cost_source: 'ESTIMATED',
    received_at: END,
    ...over,
  };
}

describe('trips görünümü · TAHMİN etiketlenir', () => {
  it('1. 🔒 tahmini yakıt "(tahmini)" ekiyle gösterilir', () => {
    const t = buildTripView(row());
    expect(t.fuelUsedL.source).toBe('ESTIMATED');
    expect(tripValueLabel(t.fuelUsedL, 'L')).toBe('3.6 L (tahmini)');
  });

  it('2. 🔒 tahmini maliyet "(tahmini)" ekiyle gösterilir', () => {
    const t = buildTripView(row());
    expect(tripValueLabel(t.estimatedCost, 'TL', 0)).toBe('162 TL (tahmini)');
  });

  it('3. 🔒 ÖLÇÜLEN değer ek ALMAZ', () => {
    const t = buildTripView(row({ fuel_source: 'MEASURED' }));
    expect(tripValueLabel(t.fuelUsedL, 'L')).toBe('3.6 L');
    expect(tripValueLabel(t.maxSpeedKmh, 'km/h', 0)).toBe('118 km/h');
  });

  it('4. 🔒 tanınmayan kaynak UYDURULMAZ → UNAVAILABLE', () => {
    expect(normalizeTripSource('SIHIR')).toBe('UNAVAILABLE');
    expect(normalizeTripSource(null)).toBe('UNAVAILABLE');
    expect(buildTripView(row({ fuel_source: 'SIHIR' })).fuelUsedL.source).toBe('UNAVAILABLE');
  });

  it('5. 🔒 kaynak etiketleri kullanıcı diline çevrilir', () => {
    expect(tripSourceLabel('ESTIMATED')).toBe('Tahmini');
    expect(tripSourceLabel('MEASURED')).toBe('Ölçüldü');
    expect(tripSourceLabel('UNAVAILABLE')).toBe('Veri yok');
  });
});

describe('trips görünümü · sahte veri yasağı', () => {
  it('6. 🔒 bilinmeyen metrik "Veri yok" (sahte 0 YOK)', () => {
    const t = buildTripView(row({ fuel_used_l: null, estimated_cost: null }));
    expect(t.fuelUsedL.value).toBeNull();
    expect(tripValueLabel(t.fuelUsedL, 'L')).toBe('Veri yok');
    expect(tripValueLabel(t.estimatedCost, 'TL')).toBe('Veri yok');
  });

  it('7. 🔒 değer yoksa KAYNAK da UNAVAILABLE olur', () => {
    const t = buildTripView(row({ fuel_used_l: null, fuel_source: 'ESTIMATED' }));
    expect(t.fuelUsedL.source).toBe('UNAVAILABLE');
  });

  it('8. 🔒 ölçülen 0 "Veri yok" DEĞİLDİR', () => {
    const t = buildTripView(row({ fuel_used_l: '0.000' }));
    expect(t.fuelUsedL.value).toBe(0);
    /* Tam sayı ondalıksız basılır; asıl kilit "Veri yok" DEMEMESİDİR. */
    expect(tripValueLabel(t.fuelUsedL, 'L')).toBe('0 L (tahmini)');
    expect(tripValueLabel(t.fuelUsedL, 'L')).not.toBe('Veri yok');
  });

  it('9. 🔒 skor yoksa UYDURULMAZ', () => {
    expect(tripScoreLabel(null)).toBe('Veri yok');
    expect(tripScoreLabel(88)).toBe('88/100');
    expect(buildTripView(row({ score: null })).score).toBeNull();
  });

  it('10. 🔒 skor 0–100 aralığına kırpılır', () => {
    expect(buildTripView(row({ score: 150 })).score).toBe(100);
    expect(buildTripView(row({ score: -5 })).score).toBe(0);
  });

  it('11. 🔒 geçersiz tarih UYDURULMAZ', () => {
    expect(tripTimeMs('bozuk')).toBeNull();
    expect(tripTimeMs(null)).toBeNull();
    expect(tripTimeLabel(null)).toBe('Veri yok');
    expect(buildTripView(row({ started_at: 'bozuk' })).startedAtMs).toBeNull();
  });

  it('12. 🔒 geçersiz güven UNKNOWN olur', () => {
    expect(buildTripView(row({ confidence: 'SIHIR' })).confidence).toBe('UNKNOWN');
    expect(buildTripView(row({ confidence: null })).confidence).toBe('UNKNOWN');
    expect(tripConfidenceLabel('UNKNOWN')).toBe('Bilinmiyor');
  });
});

describe('trips görünümü · PostgREST numeric METİN döner', () => {
  it('13. 🔒 metin sayısal alanlar sayıya çevrilir', () => {
    const t = buildTripView(row());
    expect(t.distanceKm.value).toBe(42.5);
    expect(t.avgSpeedKmh.value).toBe(46.4);
    expect(t.estimatedCost.value).toBe(162);
  });

  it('14. 🔒 bozuk metin sayı SAYILMAZ', () => {
    expect(buildTripView(row({ distance_km: 'abc' })).distanceKm.value).toBeNull();
    expect(buildTripView(row({ distance_km: '' })).distanceKm.value).toBeNull();
  });
});

describe('trips görünümü · okunamadı ≠ trip yok', () => {
  it('15. 🔒 okuma BAŞARISIZ → readable=false, isEmpty=false', () => {
    const v = buildTripsView({ rows: null, readable: false });
    expect(v.readable).toBe(false);
    expect(v.isEmpty).toBe(false);
    expect(v.trips).toHaveLength(0);
  });

  it('16. 🔒 okuma BAŞARILI ama trip YOK → readable=true, isEmpty=true', () => {
    const v = buildTripsView({ rows: [], readable: true });
    expect(v.readable).toBe(true);
    expect(v.isEmpty).toBe(true);
  });

  it('17. 🔒 anahtarsız satır ELENİR', () => {
    const v = buildTripsView({ rows: [row(), row({ trip_key: null })], readable: true });
    expect(v.trips).toHaveLength(1);
  });

  it('18. 🔒 sunucudan okunan trip DAİMA yüklenmiştir', () => {
    expect(buildTripView(row()).uploadState).toBe('UPLOADED');
    expect(tripUploadStateLabel('UPLOADED')).toBe('Yüklendi');
    expect(tripUploadStateLabel('PENDING')).toBe('Yükleme bekliyor');
    expect(tripUploadStateLabel('FAILED')).toBe('Yüklenemedi');
  });
});

describe('trips görünümü · koordinat/rota TAŞIMAZ', () => {
  it('19. 🔒 görünüm nesnesinde konum alanı YOK', () => {
    const keys = Object.keys(buildTripView(row())).map((k) => k.toLowerCase());
    for (const forbidden of ['lat', 'lng', 'latitude', 'longitude', 'route', 'path', 'coords']) {
      expect(keys).not.toContain(forbidden);
    }
  });

  it('20. 🔒 serileştirilmiş görünümde konum izi YOK', () => {
    const s = JSON.stringify(buildTripsView({ rows: [row()], readable: true })).toLowerCase();
    for (const forbidden of ['latitude', 'longitude', '"lat"', '"lng"', 'polyline']) {
      expect(s).not.toContain(forbidden);
    }
  });

  it('21. 🔒 revizyon taşınır (dedupe gözlemi)', () => {
    expect(buildTripView(row({ revision: 3 })).revision).toBe(3);
    expect(buildTripView(row({ revision: null })).revision).toBeNull();
  });

  it('22. 🔒 kullanıcı metinlerinde teknik iç detay SIZMAZ', () => {
    const texts = [
      tripSourceLabel('ESTIMATED'), tripConfidenceLabel('LOW'),
      tripUploadStateLabel('FAILED'), tripScoreLabel(null),
      tripValueLabel({ value: null, source: 'UNAVAILABLE' }, 'L'),
    ].join(' ');
    expect(texts).not.toMatch(/rpc|sql|column|null|undefined|api_key/i);
  });
});
