/**
 * driverDna.test.ts — DRIVER DNA P1 KİLİTLERİ.
 *
 * ── KİLİTLENEN ANA KURALLAR ────────────────────────────────────────────
 *  1. **Bu katman AI ÜRETMEZ** — model/tahmin/öneri yok, yalnız kanıt.
 *  2. **UNKNOWN gerçek bir cevaptır** — kanıtsız metrik `0` DEĞİL, `null`.
 *  3. Tek sürüş DNA değildir; eşik altında **DNA OLUŞMAZ**.
 *  4. Aynı yolculuk iki kez birikmez (replay).
 *  5. Araç etkisi **daima TAHMİNDİR** ve öyle işaretlenir.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  DNA_COMPONENTS, DNA_COMPONENTS_WITHOUT_EVIDENCE, DNA_PROVENANCES,
  DNA_LEARNING_LEVELS, DNA_MIN_TRIPS, DNA_MIN_DISTANCE_KM,
  NO_DRIVER_DNA, dnaLearningLevel, dnaAgeMs, dnaStalenessMs,
  dnaUnknownCount, dnaMeasuredCount, dnaMetric, unknownMetric,
  dnaComponentLabel, dnaLearningLevelLabel, dnaStatusLabel,
  dnaDriftStateLabel, dnaUnknownReasonLabel, vehicleImpactKindLabel,
  DNA_STATUSES, DNA_DRIFT_STATES, DNA_UNKNOWN_REASONS, VEHICLE_IMPACT_KINDS,
} from '../platform/fleet/driverDna';
import {
  EMPTY_DNA_ACCUMULATOR, UNAVAILABLE_SIGNAL, DNA_TRIP_KEY_MEMORY,
  accumulateTrip, buildDnaMetrics, computeDnaConfidence, detectDnaDrift,
  buildVehicleImpact, buildDna,
  type DnaTripEvidence, type TripSource,
} from '../platform/fleet/driverDnaEngine';

const T0 = Date.UTC(2026, 6, 1, 8, 0, 0);
const H = 3_600_000;

function sig(value: number | null, source: TripSource = 'MEASURED') {
  return { value, source };
}

function trip(over: Partial<DnaTripEvidence> = {}): DnaTripEvidence {
  return {
    tripKey: 'k-1', startedAtMs: T0,
    distanceKm: sig(50), durationMin: sig(60),
    idleMin: sig(6), movingMin: sig(54),
    avgSpeedKmh: sig(50), maxSpeedKmh: sig(110),
    harshBrakeCount: sig(2), harshAccelCount: sig(1),
    speedViolations: sig(0), stopCount: sig(8),
    maxRpm: sig(3000), maxEngineTempC: sig(92),
    fuelUsedL: sig(3.5), startedAtNight: false,
    ...over,
  };
}

/** N yolculukluk birikim üretir (her biri farklı anahtar). */
function accumulateMany(n: number, over: Partial<DnaTripEvidence> = {}) {
  let acc = EMPTY_DNA_ACCUMULATOR;
  for (let i = 0; i < n; i++) {
    acc = accumulateTrip(acc, trip({ tripKey: `k-${i}`, startedAtMs: T0 + i * H, ...over }));
  }
  return acc;
}

/* ═══ A. SÖZLEŞME ══════════════════════════════════════════════════════ */

describe('DriverDNA · A. Kanonik sözleşme', () => {
  it('A1. 🔒 provenance YALNIZ üç değer (ESTIMATED metrik provenance DEĞİL)', () => {
    expect([...DNA_PROVENANCES]).toEqual(['MEASURED', 'DERIVED', 'UNKNOWN']);
    expect(DNA_PROVENANCES).not.toContain('ESTIMATED');
  });

  it('A2. 🔒 14 bileşen SÖZLEŞMEDİR', () => {
    expect(DNA_COMPONENTS).toHaveLength(14);
    for (const c of ['DRIVING_SMOOTHNESS', 'AGGRESSIVENESS', 'FUEL_DISCIPLINE',
                     'MECHANICAL_SYMPATHY', 'NIGHT_DRIVING', 'URBAN_DRIVING',
                     'HIGHWAY_DRIVING', 'IDLE_BEHAVIOUR', 'BRAKING_STYLE',
                     'ACCELERATION_STYLE', 'CORNERING_STYLE', 'ENGINE_CARE',
                     'BATTERY_CARE', 'CONSISTENCY']) {
      expect(DNA_COMPONENTS).toContain(c);
    }
  });

  it('A3. 🔒 KANIT KAYNAĞI OLMAYAN bileşenler AÇIKÇA beyan edilir', () => {
    /* Bu bir EKSİKLİK BEYANIDIR: viraj için yanal ivme, akü için voltaj
       yolculuk modelinde YOK. Hızdan "viraj stili" türetmek uydurma olurdu. */
    expect([...DNA_COMPONENTS_WITHOUT_EVIDENCE]).toEqual(
      ['CORNERING_STYLE', 'BATTERY_CARE']);
  });

  it('A4. 🔒 UNKNOWN metrik DAİMA null değer taşır (sahte 0 YOK)', () => {
    const m = unknownMetric('BATTERY_CARE', 'NO_EVIDENCE_SOURCE');
    expect(m.value).toBeNull();
    expect(m.provenance).toBe('UNKNOWN');
    expect(m.unknownReason).toBe('NO_EVIDENCE_SOURCE');
    expect(m.sampleCount).toBe(0);
  });

  it('A5. 🔒 boş DNA sahte sayaç ÜRETMEZ', () => {
    expect(NO_DRIVER_DNA.status).toBe('NO_DNA');
    expect(NO_DRIVER_DNA.confidence).toBe('UNKNOWN');
    expect(NO_DRIVER_DNA.tripCount).toBe(0);
    expect(NO_DRIVER_DNA.metrics).toHaveLength(0);
    expect(dnaAgeMs(NO_DRIVER_DNA, T0)).toBeNull();
    expect(dnaStalenessMs(NO_DRIVER_DNA, T0)).toBeNull();
  });

  it('A6. 🔒 TEK BİR "sürücü puanı" alanı YOKTUR (bilinçli)', () => {
    expect(Object.keys(NO_DRIVER_DNA)).not.toContain('score');
    expect(Object.keys(NO_DRIVER_DNA)).not.toContain('rating');
    expect(Object.keys(NO_DRIVER_DNA)).not.toContain('grade');
  });
});

/* ═══ B. BİRİKİM VE REPLAY ═════════════════════════════════════════════ */

describe('DriverDNA · B. Kanıt birikimi', () => {
  it('B1. 🔒 AYNI yolculuk iki kez birikmez (replay kilidi)', () => {
    let acc = accumulateTrip(EMPTY_DNA_ACCUMULATOR, trip({ tripKey: 'x' }));
    const once = acc;
    for (let i = 0; i < 10; i++) acc = accumulateTrip(acc, trip({ tripKey: 'x' }));
    expect(acc).toEqual(once);
    expect(acc.tripCount).toBe(1);
  });

  it('B2. 🔒 ÖLÇÜLMEMİŞ sinyal birikime GİRMEZ (0 sayılmaz)', () => {
    const acc = accumulateTrip(EMPTY_DNA_ACCUMULATOR, trip({
      fuelUsedL: UNAVAILABLE_SIGNAL, harshBrakeCount: UNAVAILABLE_SIGNAL,
    }));
    expect(acc.fuel.count).toBe(0);
    expect(acc.fuel.sum).toBe(0);
    expect(acc.harshBrake.count).toBe(0);
    /* Ama ölçülenler birikmeye devam etti. */
    expect(acc.tripCount).toBe(1);
    expect(acc.harshAccel.count).toBe(1);
  });

  it('B3. 🔒 ESTIMATED kaynak kanıt SAYILMAZ', () => {
    const acc = accumulateTrip(EMPTY_DNA_ACCUMULATOR, trip({
      fuelUsedL: sig(9, 'ESTIMATED'),
    }));
    expect(acc.fuel.count).toBe(0);
  });

  it('B4. 🔒 DERIVED kanıt kabul edilir ama provenance DÜŞER', () => {
    const acc = accumulateTrip(EMPTY_DNA_ACCUMULATOR, trip({
      harshBrakeCount: sig(3, 'DERIVED'),
    }));
    expect(acc.harshBrake.count).toBe(1);
    expect(acc.harshBrake.measuredOnly).toBe(false);
    const m = buildDnaMetrics(acc).find((x) => x.component === 'BRAKING_STYLE');
    expect(m?.provenance).toBe('DERIVED');
  });

  it('B5. 🔒 yolculuk anahtarı hafızası SINIRLI (bellek sızıntısı yok)', () => {
    const acc = accumulateMany(DNA_TRIP_KEY_MEMORY + 50);
    expect(acc.tripKeys.length).toBeLessThanOrEqual(DNA_TRIP_KEY_MEMORY);
    expect(acc.tripCount).toBe(DNA_TRIP_KEY_MEMORY + 50);
  });

  it('B6. 🔒 ilk/son yolculuk anı DOĞRU (DNA yaşı buradan gelir)', () => {
    const acc = accumulateMany(5);
    expect(acc.firstTripAtMs).toBe(T0);
    expect(acc.lastTripAtMs).toBe(T0 + 4 * H);
  });
});

/* ═══ C. METRİK TÜRETME ════════════════════════════════════════════════ */

describe('DriverDNA · C. Metrik türetme', () => {
  it('C1. 🔒 kanıt kaynağı olmayan bileşenler HER ZAMAN UNKNOWN', () => {
    const metrics = buildDnaMetrics(accumulateMany(50));
    for (const c of DNA_COMPONENTS_WITHOUT_EVIDENCE) {
      const m = metrics.find((x) => x.component === c);
      expect(m?.provenance).toBe('UNKNOWN');
      expect(m?.value).toBeNull();
      expect(m?.unknownReason).toBe('NO_EVIDENCE_SOURCE');
    }
  });

  it('C2. 🔒 her bileşen için TAM BİR metrik üretilir (sessiz boşluk yok)', () => {
    const metrics = buildDnaMetrics(accumulateMany(10));
    expect(metrics).toHaveLength(DNA_COMPONENTS.length);
    for (const c of DNA_COMPONENTS) {
      expect(metrics.some((m) => m.component === c)).toBe(true);
    }
  });

  it('C3. 🔒 fren oranı 100 km başına ve MEASURED', () => {
    const acc = accumulateMany(10);                 // 10 × 50 km, 2 fren
    const m = buildDnaMetrics(acc).find((x) => x.component === 'BRAKING_STYLE')!;
    expect(m.unit).toBe('EVENTS_PER_100KM');
    expect(m.provenance).toBe('MEASURED');
    expect(m.value).toBeCloseTo(4, 5);              // 20 olay / 500 km × 100
    expect(m.sampleCount).toBe(10);
  });

  it('C4. 🔒 kanıt mesafesi YETERSİZSE metrik UNKNOWN (oran anlamsız)', () => {
    const acc = accumulateTrip(EMPTY_DNA_ACCUMULATOR, trip({ distanceKm: sig(0.3) }));
    const m = buildDnaMetrics(acc).find((x) => x.component === 'BRAKING_STYLE')!;
    expect(m.provenance).toBe('UNKNOWN');
    expect(m.unknownReason).toBe('INSUFFICIENT_DISTANCE');
  });

  it('C5. 🔒 TUTARLILIK tek yolculuktan hesaplanamaz', () => {
    const one = buildDnaMetrics(accumulateMany(1))
      .find((x) => x.component === 'CONSISTENCY')!;
    expect(one.provenance).toBe('UNKNOWN');
    expect(one.unknownReason).toBe('INSUFFICIENT_TRIPS');

    const many = buildDnaMetrics(accumulateMany(10))
      .find((x) => x.component === 'CONSISTENCY')!;
    expect(many.provenance).toBe('DERIVED');
    expect(many.value).not.toBeNull();
  });

  it('C6. 🔒 GECE bilgisi bilinmiyorsa UNKNOWN (UTC den türetilmez)', () => {
    const acc = accumulateMany(10, { startedAtNight: null });
    const m = buildDnaMetrics(acc).find((x) => x.component === 'NIGHT_DRIVING')!;
    expect(m.provenance).toBe('UNKNOWN');
    expect(m.value).toBeNull();
  });

  it('C7. 🔒 türetilmiş endeksler 0..1 aralığında KALIR', () => {
    const wild = accumulateMany(10, {
      harshBrakeCount: sig(400), harshAccelCount: sig(400),
      speedViolations: sig(100), maxRpm: sig(9000), maxEngineTempC: sig(140),
    });
    for (const m of buildDnaMetrics(wild)) {
      if (m.unit === 'INDEX_0_1' && m.value !== null) {
        expect(m.value).toBeGreaterThanOrEqual(0);
        expect(m.value).toBeLessThanOrEqual(1);
      }
    }
  });
});

/* ═══ D. GÜVEN VE ÖĞRENME ══════════════════════════════════════════════ */

describe('DriverDNA · D. Güven ve öğrenme', () => {
  it('D1. 🔒 öğrenme seviyeleri 1 / 10 / 100 / 1000 eşiklerinde', () => {
    expect(dnaLearningLevel(0)).toBe('NONE');
    expect(dnaLearningLevel(1)).toBe('NASCENT');
    expect(dnaLearningLevel(9)).toBe('NASCENT');
    expect(dnaLearningLevel(10)).toBe('DEVELOPING');
    expect(dnaLearningLevel(99)).toBe('DEVELOPING');
    expect(dnaLearningLevel(100)).toBe('ESTABLISHED');
    expect(dnaLearningLevel(999)).toBe('ESTABLISHED');
    expect(dnaLearningLevel(1000)).toBe('MATURE');
    expect([...DNA_LEARNING_LEVELS]).toHaveLength(5);
  });

  it('D2. 🔒 EŞİK ALTINDA güven UNKNOWN (yolculuk sayısı)', () => {
    const acc = accumulateMany(DNA_MIN_TRIPS - 1);
    expect(computeDnaConfidence(acc, buildDnaMetrics(acc))).toBe('UNKNOWN');
  });

  it('D3. 🔒 EŞİK ALTINDA güven UNKNOWN (kanıt mesafesi)', () => {
    /* 10 yolculuk ama toplam mesafe eşiğin altında. */
    const acc = accumulateMany(10, { distanceKm: sig(1) });
    expect(acc.totalDistanceKm).toBeLessThan(DNA_MIN_DISTANCE_KM);
    expect(computeDnaConfidence(acc, buildDnaMetrics(acc))).toBe('UNKNOWN');
  });

  it('D4. 🔒 güven yolculuk sayısıyla ARTAR', () => {
    const a10 = accumulateMany(10);
    const a150 = accumulateMany(150);
    expect(computeDnaConfidence(a10, buildDnaMetrics(a10))).toBe('MEDIUM');
    expect(computeDnaConfidence(a150, buildDnaMetrics(a150))).toBe('HIGH');
  });

  it('D5. 🔒 HİÇBİR sinyal ölçülmemişse güven UNKNOWN (200 yolculuk bile)', () => {
    /* Yolculuk çok ama hiçbir sinyal ölçülmemiş: "çok veri" ≠ "çok kanıt". */
    const blind = accumulateMany(200, {
      harshBrakeCount: UNAVAILABLE_SIGNAL, harshAccelCount: UNAVAILABLE_SIGNAL,
      speedViolations: UNAVAILABLE_SIGNAL, idleMin: UNAVAILABLE_SIGNAL,
      movingMin: UNAVAILABLE_SIGNAL, avgSpeedKmh: UNAVAILABLE_SIGNAL,
      maxRpm: UNAVAILABLE_SIGNAL, maxEngineTempC: UNAVAILABLE_SIGNAL,
      fuelUsedL: UNAVAILABLE_SIGNAL, startedAtNight: null,
    });
    expect(buildDnaMetrics(blind).every((m) => m.provenance === 'UNKNOWN')).toBe(true);
    expect(computeDnaConfidence(blind, buildDnaMetrics(blind))).toBe('UNKNOWN');
  });

  it('D5b. 🔒 BİLİNMEYEN ağırlıklıysa güven HIGH OLAMAZ (en zayıf halka)', () => {
    /* 200 yolculuk `HIGH` verirdi; ama metriklerin yarısından çoğu bilinmiyor
       → güven `LOW`a kırpılır. Çok yolculuk, çok bilgi DEMEK DEĞİLDİR. */
    const partial = accumulateMany(200, {
      idleMin: UNAVAILABLE_SIGNAL, movingMin: UNAVAILABLE_SIGNAL,
      avgSpeedKmh: UNAVAILABLE_SIGNAL, maxRpm: UNAVAILABLE_SIGNAL,
      maxEngineTempC: UNAVAILABLE_SIGNAL, fuelUsedL: UNAVAILABLE_SIGNAL,
      speedViolations: UNAVAILABLE_SIGNAL, startedAtNight: null,
    });
    const metrics = buildDnaMetrics(partial);
    const known = metrics.filter((m) => m.provenance !== 'UNKNOWN').length;
    expect(known).toBeGreaterThan(0);
    expect(known / metrics.length).toBeLessThan(0.5);
    expect(computeDnaConfidence(partial, metrics)).toBe('LOW');
  });

  it('D6. 🔒 EŞİK ALTINDA DNA OLUŞMAZ ve metrik listesi BOŞ kalır', () => {
    const dna = buildDna({
      driverId: 'd-1', companyId: 'co-1',
      accumulator: accumulateMany(2), revision: 1,
    });
    expect(dna.status).toBe('NO_DNA');
    expect(dna.confidence).toBe('UNKNOWN');
    expect(dna.metrics).toHaveLength(0);
    expect(dna.vehicleImpact).toHaveLength(0);
  });

  it('D7. 🔒 eşik aşılınca DNA oluşur ve sayaçlar GERÇEK veriden gelir', () => {
    const acc = accumulateMany(12);
    const dna = buildDna({ driverId: 'd-1', companyId: 'co-1', accumulator: acc, revision: 3 });
    expect(dna.status).toBe('ACTIVE');
    expect(dna.learningLevel).toBe('DEVELOPING');
    expect(dna.tripCount).toBe(12);
    expect(dna.totalDistanceKm).toBe(600);
    expect(dna.revision).toBe(3);
    expect(dnaMeasuredCount(dna)).toBeGreaterThan(0);
    expect(dnaUnknownCount(dna)).toBeGreaterThanOrEqual(2);   // kaynağı olmayan 2 bileşen
    expect(dnaMetric(dna, 'BRAKING_STYLE')?.value).toBeCloseTo(4, 5);
  });
});

/* ═══ E. SAPMA ═════════════════════════════════════════════════════════ */

describe('DriverDNA · E. Sapma (drift)', () => {
  it('E1. 🔒 yeterli örnek yoksa KARAR YOK (INSUFFICIENT)', () => {
    const base = buildDnaMetrics(accumulateMany(2));
    const recent = buildDnaMetrics(accumulateMany(2));
    expect(detectDnaDrift(base, recent).state).toBe('INSUFFICIENT');
  });

  it('E2. 🔒 davranış AYNIYSA STABLE', () => {
    const base = buildDnaMetrics(accumulateMany(10));
    const recent = buildDnaMetrics(accumulateMany(10));
    const d = detectDnaDrift(base, recent);
    expect(d.state).toBe('STABLE');
    expect(d.evidence).toHaveLength(0);
  });

  it('E3. 🔒 davranış DEĞİŞİRSE sapma KANITLA raporlanır', () => {
    const base = buildDnaMetrics(accumulateMany(10, { harshBrakeCount: sig(1) }));
    const recent = buildDnaMetrics(accumulateMany(10, { harshBrakeCount: sig(9) }));
    const d = detectDnaDrift(base, recent);
    expect(d.state).toBe('DRIFTING');
    const ev = d.evidence.find((x) => x.component === 'BRAKING_STYLE')!;
    expect(ev.recentValue).toBeGreaterThan(ev.baselineValue);
    expect(ev.relativeChange).toBeGreaterThan(0.25);
    expect(ev.baselineSampleCount).toBe(10);
    expect(ev.recentSampleCount).toBe(10);
  });

  it('E4. 🔒 UNKNOWN metrikler sapma karşılaştırmasına GİRMEZ', () => {
    const base = buildDnaMetrics(accumulateMany(10));
    const recent = buildDnaMetrics(accumulateMany(10));
    const d = detectDnaDrift(base, recent);
    for (const ev of d.evidence) {
      expect(DNA_COMPONENTS_WITHOUT_EVIDENCE).not.toContain(ev.component);
    }
  });
});

/* ═══ F. ARAÇ ETKİSİ (TAHMİN) ══════════════════════════════════════════ */

describe('DriverDNA · F. Araç etkisi', () => {
  it('F1. 🔒 her etki kaydı TAHMİN olarak işaretlidir (kaldırılamaz)', () => {
    const impact = buildVehicleImpact(buildDnaMetrics(accumulateMany(10)));
    expect(impact).toHaveLength(VEHICLE_IMPACT_KINDS.length);
    for (const i of impact) {
      expect(i.estimated).toBe(true);
      expect(i.provenance).not.toBe('MEASURED');   // ASLA ölçüm değil
    }
  });

  it('F2. 🔒 kanıt yoksa endeks null — "etkisi yok" DEMEK DEĞİL', () => {
    const blind = accumulateMany(10, {
      harshBrakeCount: UNAVAILABLE_SIGNAL, harshAccelCount: UNAVAILABLE_SIGNAL,
      speedViolations: UNAVAILABLE_SIGNAL, maxRpm: UNAVAILABLE_SIGNAL,
      maxEngineTempC: UNAVAILABLE_SIGNAL, fuelUsedL: UNAVAILABLE_SIGNAL,
    });
    const impact = buildVehicleImpact(buildDnaMetrics(blind));
    for (const i of impact) {
      expect(i.index).toBeNull();
      expect(i.provenance).toBe('UNKNOWN');
      expect(i.unknownReason).not.toBeNull();
    }
  });

  it('F3. 🔒 etki HANGİ metrikten türediğini taşır (izlenebilirlik)', () => {
    const impact = buildVehicleImpact(buildDnaMetrics(accumulateMany(10)));
    const brake = impact.find((i) => i.kind === 'BRAKE_WEAR')!;
    expect(brake.basedOn).toContain('BRAKING_STYLE');
    expect(brake.index).not.toBeNull();
  });

  it('F4. 🔒 daha sert sürüş DAHA YÜKSEK etki endeksi üretir', () => {
    const calm = buildVehicleImpact(buildDnaMetrics(
      accumulateMany(10, { harshBrakeCount: sig(1) })));
    const wild = buildVehicleImpact(buildDnaMetrics(
      accumulateMany(10, { harshBrakeCount: sig(10) })));
    const c = calm.find((i) => i.kind === 'BRAKE_WEAR')!.index!;
    const w = wild.find((i) => i.kind === 'BRAKE_WEAR')!.index!;
    expect(w).toBeGreaterThan(c);
  });
});

/* ═══ G. AI YOK · SAFLIK · ETİKETLER ═══════════════════════════════════ */

describe('DriverDNA · G. AI üretmez ve saftır', () => {
  const MODEL = readFileSync(
    join(process.cwd(), 'src/platform/fleet/driverDna.ts'), 'utf8');
  const ENGINE = readFileSync(
    join(process.cwd(), 'src/platform/fleet/driverDnaEngine.ts'), 'utf8');

  it('G1. 🔒 DNA katmanı AI/LLM/ağ ÇAĞIRMAZ', () => {
    for (const src of [MODEL, ENGINE]) {
      const code = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
      expect(code).not.toContain('fetch(');
      expect(code).not.toContain('openrouter');
      expect(code).not.toContain('gemini');
      expect(code).not.toContain('prompt');
      expect(code).not.toContain('aiService');
      expect(code).not.toContain('semanticAi');
    }
  });

  it('G2. 🔒 DNA katmanı SAF (I/O · zaman · timer YOK)', () => {
    for (const src of [MODEL, ENGINE]) {
      const code = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
      expect(code).not.toContain('Date.now()');
      expect(code).not.toContain('performance.now()');
      expect(code).not.toContain('setInterval');
      expect(code).not.toContain('setTimeout');
      expect(code).not.toContain('safeGetRaw');
      expect(code).not.toContain('supabase');
    }
  });

  it('G3. 🔒 DNA presence/authentication/trip katmanlarını DEĞİŞTİRMEZ', () => {
    for (const src of [MODEL, ENGINE]) {
      expect(src).not.toContain('resolveDriverPresence');
      expect(src).not.toContain('resolveDriverAuthentication');
      expect(src).not.toContain('tripLogService');
    }
  });

  it('G4. 🔒 etiketler tüm enum değerlerini KAPSAR', () => {
    for (const c of DNA_COMPONENTS) expect(dnaComponentLabel(c).length).toBeGreaterThan(0);
    for (const l of DNA_LEARNING_LEVELS) expect(dnaLearningLevelLabel(l).length).toBeGreaterThan(0);
    for (const s of DNA_STATUSES) expect(dnaStatusLabel(s).length).toBeGreaterThan(0);
    for (const d of DNA_DRIFT_STATES) expect(dnaDriftStateLabel(d).length).toBeGreaterThan(0);
    for (const r of DNA_UNKNOWN_REASONS) expect(dnaUnknownReasonLabel(r).length).toBeGreaterThan(0);
    for (const k of VEHICLE_IMPACT_KINDS) {
      /* Etiket TAHMİN olduğunu SÖYLEMELİ — kullanıcı ölçüm sanmamalı. */
      expect(vehicleImpactKindLabel(k)).toContain('tahmini');
    }
  });

  it('G5. 🔒 DNA kişisel veri TAŞIMAZ (ad/telefon/konum/VIN yok)', () => {
    const dna = buildDna({
      driverId: 'd-1', companyId: 'co-1',
      accumulator: accumulateMany(12), revision: 1,
    });
    /* Alan ADLARI denetlenir — serbest metin araması yanıltıcıdır
       ("relativeChange" içinde "lat" geçer, bu bir konum sızıntısı DEĞİLDİR). */
    const keys = new Set<string>();
    const walk = (v: unknown): void => {
      if (Array.isArray(v)) { v.forEach(walk); return; }
      if (v !== null && typeof v === 'object') {
        for (const [k, val] of Object.entries(v)) { keys.add(k.toLowerCase()); walk(val); }
      }
    };
    walk(dna);
    for (const forbidden of ['name', 'displayname', 'phone', 'email', 'licence',
                             'license', 'lat', 'lng', 'lon', 'latitude', 'longitude',
                             'vin', 'plate', 'route', 'address']) {
      expect(keys.has(forbidden)).toBe(false);
    }
    /* Sürücü kimliği REFERANSTIR; ad taşınmaz. */
    expect(keys.has('driverid')).toBe(true);
  });

  it('G6. 🔒 LAB ekranı istenen alanları GÖSTERİR', () => {
    const SCREEN = readFileSync(
      join(process.cwd(),
        'src/components/devtools/screens/FleetDriverDnaScreen.tsx'), 'utf8');
    for (const field of ['learningLevel', 'confidence', 'lastUpdate', 'dnaAge',
                         'metricCount', 'unknownCount', 'drift', 'Evidence',
                         'driftEvidenceCount', 'staleness']) {
      expect(SCREEN).toContain(field);
    }
    expect(SCREEN).not.toContain('setInterval');
  });
});
