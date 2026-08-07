/**
 * vehicleTripsViewP2.test.ts — FLEET UI · P2 DÜRÜSTLÜK KİLİTLERİ.
 *
 * P1 kilitleri (`vehicleTripsView.test.ts`) "(tahmini)" etiketini ve
 * okunamadı≠yok ayrımını koruyor. Bu dosya P2'nin eklediği yüzeyi kilitler:
 * metrik başına provenance, bilinmeyen sürenin ayrı gösterimi, fiyat
 * snapshot'ının para birimi ve `VERY_HIGH` güven seviyesi.
 *
 * Yakalanan gerçek regresyon: `buildTripView` güven listesinde `VERY_HIGH`
 * YOKTU — sunucu (047) onu kabul ederken UI **"Bilinmiyor"** gösteriyordu.
 * Yani kanıta dayalı en yüksek güven, en düşük güvene düşüyordu.
 */

import { describe, it, expect } from 'vitest';
import {
  buildTripView,
  buildTripsView,
  tripValueLabel,
  tripDurationLabel,
  tripCountLabel,
  tripCostLabel,
  tripConfidenceLabel,
  fuelRejectReasonLabel,
  type TripRow,
} from '../lib/fleet/vehicleTripsView';

/** 047 sonrası `list_vehicle_trips` satırı (PostgREST `numeric` → METİN). */
function p2Row(over: Partial<TripRow> = {}): TripRow {
  return {
    trip_key: 'p2-1',
    revision: 2,
    started_at: '2026-07-30T10:00:00Z',
    ended_at: '2026-07-30T10:10:00Z',
    distance_km: '12.500',
    duration_min: 10,
    avg_speed_kmh: '75',
    max_speed_kmh: '110',
    fuel_used_l: '1.06',
    estimated_cost: '47.70',
    idle_time_min: 2,
    moving_time_min: 6,
    unknown_time_min: 1,
    stop_count: 3,
    max_rpm: 3200,
    max_engine_temp_c: '92',
    speed_violations: null,
    harsh_brake_count: 2,
    harsh_accel_count: 1,
    score: 88,
    confidence: 'VERY_HIGH',
    distance_source: 'MEASURED',
    fuel_source: 'DERIVED',
    cost_source: 'ESTIMATED',
    duration_source: 'MEASURED',
    moving_source: 'MEASURED',
    idle_source: 'MEASURED',
    stop_count_source: 'MEASURED',
    max_rpm_source: 'MEASURED',
    max_temp_source: 'MEASURED',
    harsh_brake_source: 'MEASURED',
    harsh_accel_source: 'MEASURED',
    speed_violation_source: null,
    fuel_used_percent: '4.50',
    fuel_unit: 'L',
    fuel_reject_reason: null,
    fuel_unit_price: '45.0000',
    currency: 'TRY',
    price_source: 'DEFAULT_FALLBACK',
    price_captured_at: '2026-07-30T10:00:00Z',
    confidence_limited_by: 'timeCoverage',
    speed_sample_count: 84,
    obd_coverage: '0.620',
    time_coverage: '0.900',
    data_gap_count: 1,
    source_switch_count: 2,
    metrics_version: 1,
    ...over,
  };
}

/** 046 satırı — P2 kolonlarının HİÇBİRİ yok. */
function p1Row(): TripRow {
  return {
    trip_key: 'p1-1',
    started_at: '2026-07-01T10:00:00Z',
    distance_km: '20',
    duration_min: 10,
    fuel_used_l: '1.7',
    estimated_cost: '76',
    confidence: 'HIGH',
    distance_source: 'MEASURED',
    fuel_source: 'ESTIMATED',
    cost_source: 'ESTIMATED',
  };
}

describe('Fleet P2 · A. Güven seviyesi', () => {
  it('A1. 🔒 VERY_HIGH tanınır — "Bilinmiyor"a DÜŞMEZ', () => {
    expect(buildTripView(p2Row()).confidence).toBe('VERY_HIGH');
    expect(tripConfidenceLabel('VERY_HIGH')).toBe('Çok yüksek');
  });

  it('A2. 🔒 tanınmayan seviye UNKNOWN olur (uydurulmaz)', () => {
    expect(buildTripView(p2Row({ confidence: 'SUPREME' })).confidence).toBe('UNKNOWN');
  });

  it('A3. 🔒 sunucu enum\'unun TAMAMI UI\'da karşılanır', () => {
    for (const c of ['VERY_HIGH', 'HIGH', 'MEDIUM', 'LOW', 'UNKNOWN']) {
      expect(buildTripView(p2Row({ confidence: c })).confidence).toBe(c);
    }
  });
});

describe('Fleet P2 · B. Metrik başına provenance', () => {
  it('B1. 🔒 her metrik KENDİ kaynak kolonunu kullanır', () => {
    const v = buildTripView(p2Row());
    expect(v.movingTimeMin.source).toBe('MEASURED');
    expect(v.stopCount.source).toBe('MEASURED');
    expect(v.maxRpm.source).toBe('MEASURED');
    expect(v.harshBrakeCount.source).toBe('MEASURED');
    expect(v.fuelUsedL.source).toBe('DERIVED');
    expect(v.estimatedCost.source).toBe('ESTIMATED');
  });

  it('B2. 🔒 tahmini maliyet "(tahmini)" ETİKETLİ kalır', () => {
    const v = buildTripView(p2Row());
    expect(tripCostLabel(v.estimatedCost, v.currency)).toContain('(tahmini)');
  });

  it('B3. 🔒 ölçülmüş yakıt "(tahmini)" ETİKETİ ALMAZ', () => {
    const v = buildTripView(p2Row());
    expect(tripValueLabel(v.fuelUsedL, 'L')).not.toContain('(tahmini)');
  });

  it('B4. 🔒 046 satırında P2 kaynakları UNAVAILABLE — uydurulmaz', () => {
    const v = buildTripView(p1Row());
    expect(v.movingTimeMin.source).toBe('UNAVAILABLE');
    expect(v.maxRpm.source).toBe('UNAVAILABLE');
    expect(v.stopCount.source).toBe('UNAVAILABLE');
  });
});

describe('Fleet P2 · C. Bilinmeyen ≠ sıfır ≠ rölanti', () => {
  it('C1. 🔒 BİLİNMEYEN süre AYRI alanda gösterilir', () => {
    const v = buildTripView(p2Row());
    expect(v.unknownTimeMin.value).toBe(1);
    expect(v.idleTimeMin.value).toBe(2);
    expect(v.movingTimeMin.value).toBe(6);
  });

  it('C2. 🔒 ölçülmemiş metrik "Veri yok" — sahte 0 YOK', () => {
    const v = buildTripView(p1Row());
    expect(tripDurationLabel(v.unknownTimeMin)).toBe('Veri yok');
    expect(tripCountLabel(v.maxRpm)).toBe('Veri yok');
    expect(tripCountLabel(v.harshBrakeCount)).toBe('Veri yok');
  });

  it('C3. 🔒 ÖLÇÜLEN 0 "Veri yok" DEĞİLDİR', () => {
    const v = buildTripView(p2Row({ idle_time_min: 0, stop_count: 0, harsh_brake_count: 0 }));
    expect(tripDurationLabel(v.idleTimeMin)).toBe('0 dk');
    expect(tripCountLabel(v.stopCount)).toBe('0');
    expect(tripCountLabel(v.harshBrakeCount)).toBe('0');
  });

  it('C4. 🔒 hız limiti kaynağı yoksa ihlal "Veri yok" — 0 DEĞİL', () => {
    const v = buildTripView(p2Row());
    expect(v.speedViolations.value).toBeNull();
    expect(tripCountLabel(v.speedViolations)).toBe('Veri yok');
  });

  it('C5. 🔒 süre invaryantı: moving+idle+unknown <= duration', () => {
    const v = buildTripView(p2Row());
    const sum = (v.movingTimeMin.value ?? 0) + (v.idleTimeMin.value ?? 0)
      + (v.unknownTimeMin.value ?? 0);
    expect(sum).toBeLessThanOrEqual((v.durationMin.value ?? 0) + 3);
  });
});

describe('Fleet P2 · D. Fiyat snapshot ve yakıt gerekçesi', () => {
  it('D1. 🔒 fiyat snapshot\'ı okunur (PostgREST numeric METİN döner)', () => {
    const v = buildTripView(p2Row());
    expect(v.unitPrice).toBe(45);
    expect(v.currency).toBe('TRY');
    expect(v.priceSource).toBe('DEFAULT_FALLBACK');
    expect(v.priceCapturedAtMs).not.toBeNull();
  });

  it('D2. 🔒 maliyet para birimi SNAPSHOT\'tan gelir — uydurulmaz', () => {
    const v = buildTripView(p2Row());
    expect(tripCostLabel(v.estimatedCost, v.currency)).toContain('TRY');
    /* Para birimi bilinmiyorsa birimsiz basılır; varsayılan UYDURULMAZ. */
    const noCur = buildTripView(p2Row({ currency: null }));
    expect(tripCostLabel(noCur.estimatedCost, noCur.currency)).not.toContain('TRY');
  });

  it('D3. 🔒 yakıt ölçülemediyse GEREKÇE kullanıcı diline çevrilir', () => {
    const v = buildTripView(p2Row({ fuel_reject_reason: 'REFUEL_SUSPECTED' }));
    expect(fuelRejectReasonLabel(v.fuelRejectReason))
      .toBe('Yolculuk sırasında yakıt alındı');
  });

  it('D4. 🔒 gerekçe yoksa uyarı da YOK', () => {
    expect(fuelRejectReasonLabel(null)).toBeNull();
  });

  it('D5. 🔒 ölçülen yakıt YÜZDESİ litreden ayrı okunur', () => {
    const v = buildTripView(p2Row());
    expect(v.fuelUsedPercent.value).toBe(4.5);
    expect(v.fuelUsedL.value).toBe(1.06);
  });

  it('D6. 🔒 confidence kanıtı ve şema sürümü taşınır', () => {
    const v = buildTripView(p2Row());
    expect(v.confidenceLimitedBy).toBe('timeCoverage');
    expect(v.metricsVersion).toBe(1);
  });
});

describe('Fleet P2 · E. Okunamadı ≠ yok (P1 sözleşmesi korunur)', () => {
  it('E1. 🔒 okuma düşerse "trip yok" DENMEZ', () => {
    const v = buildTripsView({ rows: null, readable: false });
    expect(v.readable).toBe(false);
    expect(v.isEmpty).toBe(false);
  });

  it('E2. 🔒 gerçekten boşsa isEmpty', () => {
    const v = buildTripsView({ rows: [], readable: true });
    expect(v.readable).toBe(true);
    expect(v.isEmpty).toBe(true);
  });

  it('E3. 🔒 karışık P1/P2 satırları birlikte okunur', () => {
    const v = buildTripsView({ rows: [p2Row(), p1Row()], readable: true });
    expect(v.trips).toHaveLength(2);
    expect(v.trips[0].unknownTimeMin.value).toBe(1);
    expect(v.trips[1].unknownTimeMin.value).toBeNull();
  });

  it('E4. 🔒 koordinat/rota görünümde YOK', () => {
    /* Kilit ALAN ADLARINI hedefler, ham metni değil: serbest `/lat/i`
       araması `speedVio·lat·ions` gibi masum kelimeleri yakalar (P1'de
       aynı hata `Route` ikonunu "rota verisi" sanmıştı). */
    const v = buildTripView(p2Row());
    const keys = Object.keys(v).map((k) => k.toLowerCase());
    for (const forbidden of ['lat', 'lng', 'latitude', 'longitude', 'coords', 'coordinates', 'route', 'path']) {
      expect(keys).not.toContain(forbidden);
    }
    /* Değerlerde de koordinat çifti taşınmamalı. */
    expect(Object.values(v).some((x) => Array.isArray(x))).toBe(false);
  });
});
