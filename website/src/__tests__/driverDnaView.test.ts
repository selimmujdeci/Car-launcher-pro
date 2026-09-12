/**
 * driverDnaView.test.ts — FLEET UI · SÜRÜCÜ DNA KARTI KİLİTLERİ.
 *
 * ── KİLİTLENEN KURALLAR ────────────────────────────────────────────────
 *  1. Eşik altında DNA GÖSTERİLMEZ ve NEDENİ yazılır (boş kart yok).
 *  2. Kanıtı olmayan oran `null` — **`0` DEĞİL**.
 *  3. Metrik FORMÜLLERİ website'e KOPYALANMAZ (iki otorite yasağı).
 *  4. Sürücü değişimi nedeniyle geri alma GİZLENMEZ.
 *  5. Kart PII taşımaz (sürücü adı yok).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  buildDriverDnaView, dnaAbsenceExplanation,
  dnaStatusLabel, dnaLearningLevelLabel, dnaDriftLabel,
  DNA_STATUSES, DNA_LEARNING_LEVELS, DNA_DRIFT_STATES,
  EMPTY_DNA_VIEW, type DriverDnaRow,
} from '@/lib/fleet/driverDnaView';

function row(over: Partial<DriverDnaRow> = {}): DriverDnaRow {
  return {
    driver_id: 'd-1', status: 'ACTIVE', learning_level: 'ESTABLISHED',
    trip_count: 120, total_distance_km: '4200.500',
    first_trip_at: '2026-01-01T00:00:00Z', last_trip_at: '2026-07-01T00:00:00Z',
    brake_sum: '240', brake_count: 120, brake_km: '4200', brake_measured_only: true,
    accel_sum: '120', accel_count: 120, accel_km: '4200', accel_measured_only: true,
    fuel_sum: '300', fuel_count: 100, fuel_km: '4000',
    idle_sum: '600', idle_count: 120, moving_sum: '5400',
    drift_state: 'STABLE', drift_relative_change: '0.05',
    integrity_state: 'CLEAN', retracted_trip_count: 0,
    revision: 240, updated_at: '2026-07-01T10:00:00Z',
    ...over,
  };
}

describe('DriverDnaView · A. Yokluk dürüstlüğü', () => {
  it('A1. 🔒 satır yoksa DNA GÖSTERİLMEZ ve gerekçe verilir', () => {
    const v = buildDriverDnaView(null);
    expect(v.present).toBe(false);
    expect(v.absentReason).toBe('NO_ROW');
    expect(dnaAbsenceExplanation(v)).toContain('yolculuk');
    expect(v).toEqual(EMPTY_DNA_VIEW);
  });

  it('A2. 🔒 EŞİK ALTINDA DNA gösterilmez ama SAYAÇLAR dürüstçe taşınır', () => {
    const v = buildDriverDnaView(row({
      status: 'NO_DNA', learning_level: 'NASCENT',
      trip_count: 3, total_distance_km: '22',
    }));
    expect(v.present).toBe(false);
    expect(v.absentReason).toBe('BELOW_THRESHOLD');
    expect(v.tripCount).toBe(3);
    expect(v.totalDistanceKm).toBe(22);
    expect(v.rates).toHaveLength(0);
    expect(dnaAbsenceExplanation(v)).toContain('tahmin');
  });

  it('A3. 🔒 bozuk/eksik satır ÇÖKERTMEZ ve sahte değer üretmez', () => {
    const v = buildDriverDnaView({ status: 'UYDURMA', trip_count: 'x' } as unknown as DriverDnaRow);
    expect(v.present).toBe(false);
    expect(v.tripCount).toBeNull();
  });
});

describe('DriverDnaView · B. Kanıt dürüstlüğü', () => {
  it('B1. 🔒 oranlar TANIMSAL bölmedir ve MEASURED işaretlenir', () => {
    const v = buildDriverDnaView(row());
    const brake = v.rates.find((r) => r.label === 'Sert fren')!;
    expect(brake.value).toBeCloseTo((240 / 4200) * 100, 6);
    expect(brake.provenance).toBe('MEASURED');
    expect(brake.sampleCount).toBe(120);
  });

  it('B2. 🔒 kanıtı OLMAYAN oran null — 0 DEĞİL', () => {
    const v = buildDriverDnaView(row({
      fuel_sum: null, fuel_count: 0, fuel_km: '0',
      brake_sum: null, brake_count: 0, brake_km: '0',
    }));
    const fuel = v.rates.find((r) => r.label === 'Yakıt')!;
    const brake = v.rates.find((r) => r.label === 'Sert fren')!;
    expect(fuel.value).toBeNull();
    expect(fuel.provenance).toBe('UNKNOWN');
    expect(brake.value).toBeNull();
    expect(v.unknownRateCount).toBe(2);
  });

  it('B3. 🔒 DERIVED kanıt provenance i DÜŞÜRÜR', () => {
    const v = buildDriverDnaView(row({ brake_measured_only: false }));
    expect(v.rates.find((r) => r.label === 'Sert fren')!.provenance).toBe('DERIVED');
  });

  it('B4. 🔒 rölanti payı 0..1 oranıdır', () => {
    const v = buildDriverDnaView(row());
    const idle = v.rates.find((r) => r.label === 'Rölanti payı')!;
    expect(idle.value).toBeCloseTo(600 / 6000, 6);
  });
});

describe('DriverDnaView · C. Sapma ve bütünlük', () => {
  it('C1. 🔒 sapma durumu sözleşmeden gelir', () => {
    expect(buildDriverDnaView(row({ drift_state: 'DRIFTING' })).driftState).toBe('DRIFTING');
    expect(buildDriverDnaView(row({ drift_state: 'UYDURMA' })).driftState)
      .toBe('INSUFFICIENT');
  });

  it('C2. 🔒 sürücü değişimi GİZLENMEZ', () => {
    const v = buildDriverDnaView(row({
      integrity_state: 'RETRACTED', retracted_trip_count: 4,
    }));
    expect(v.retracted).toBe(true);
    expect(v.retractedTripCount).toBe(4);
  });
});

describe('DriverDnaView · D. İki otorite yasağı ve PII', () => {
  const VIEW = readFileSync(
    join(process.cwd(), 'src/lib/fleet/driverDnaView.ts'), 'utf8');
  const CARD = readFileSync(
    join(process.cwd(), 'src/components/dashboard/DriverDnaCard.tsx'), 'utf8');

  it('D1. 🔒 karakter metriklerinin FORMÜLÜ website e KOPYALANMAMIŞ', () => {
    for (const forbidden of ['MECHANICAL_SYMPATHY', 'AGGRESSIVENESS',
                             'DRIVING_SMOOTHNESS', 'CONSISTENCY', 'buildDnaMetrics']) {
      expect(VIEW).not.toContain(forbidden);
      expect(CARD).not.toContain(forbidden);
    }
  });

  it('D2. 🔒 kart PUAN/SIRALAMA üretmez', () => {
    for (const forbidden of ['score', 'rating', 'rank', 'grade', 'leaderboard']) {
      expect(CARD.toLowerCase()).not.toContain(forbidden);
    }
  });

  it('D3. 🔒 kart PII taşımaz (sürücü adı yok)', () => {
    /* TANIMLAYICI sınırıyla aranır — ham alt dizge yanıltıcıdır
       ("moving_sum" içinde "vin" geçer, bu bir VIN sızıntısı DEĞİLDİR). */
    for (const forbidden of ['display_name', 'displayName', 'driver_name',
                             'phone', 'email', 'plate', 'vin', 'licence']) {
      const re = new RegExp(String.raw`\b${forbidden}\b`, 'i');
      expect(CARD).not.toMatch(re);
      expect(VIEW).not.toMatch(re);
    }
  });

  it('D4. 🔒 görünüm modeli SAF (I/O · zaman yok)', () => {
    const code = VIEW.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
    expect(code).not.toContain('Date.now()');
    expect(code).not.toContain('fetch(');
    expect(code).not.toContain('supabase');
  });

  it('D5. 🔒 etiketler tüm enum değerlerini KAPSAR', () => {
    for (const s of DNA_STATUSES) expect(dnaStatusLabel(s).length).toBeGreaterThan(0);
    for (const l of DNA_LEARNING_LEVELS) expect(dnaLearningLevelLabel(l).length).toBeGreaterThan(0);
    for (const d of DNA_DRIFT_STATES) expect(dnaDriftLabel(d).length).toBeGreaterThan(0);
  });
});
