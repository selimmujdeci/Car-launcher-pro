/**
 * fleetIntelligence.test.ts — FLEET INTELLIGENCE ENGINE P1 KİLİTLERİ.
 *
 * ── KİLİTLENEN ANA KURALLAR ────────────────────────────────────────────
 *  1. **Bu katman AI ÜRETMEZ** — LLM/model/tahmin/öneri/doğal dil yok.
 *  2. **Kanıtsız insight OLUŞMAZ** (fail-closed).
 *  3. **Tek araçtan HIGH çıkmaz** — filo iddiası olamaz.
 *  4. Aynı kanıt iki kez birikmez (replay).
 *  5. **Tek filo puanı ÜRETİLMEZ**; UNKNOWN gerçek bir cevaptır.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  INSIGHT_TYPES, INSIGHT_TYPES_WITHOUT_EVIDENCE, INSIGHT_CONFIDENCES,
  INSIGHT_STATES, INSIGHT_SOURCES, EVIDENCE_KINDS, TREND_METRICS,
  TREND_DIRECTIONS, HEALTH_DIMENSIONS, HEALTH_STATES, FLEET_DRIFT_STATES,
  INSIGHT_UNKNOWN_REASONS, INSIGHT_MIN_EVIDENCE, SINGLE_VEHICLE_CEILING,
  EMPTY_FLEET_HEALTH, fleetHealthSingleScore, evidenceKey,
  insightTypeLabel, insightStateLabel, trendMetricLabel, trendDirectionLabel,
  healthDimensionLabel, healthStateLabel, insightUnknownReasonLabel,
  type InsightEvidence,
} from '../platform/fleet/fleetIntelligence';
import {
  emptyDraft, addEvidence, buildInsight, computeInsightConfidence,
  computeTrend, detectFleetDrift, buildFleetHealth, computeCoverage,
  settleInsight, isInsightActive, readFleetIntelligence,
  fleetIntelligenceStore, _resetFleetIntelligenceStoreForTest,
  EMPTY_FLEET_INTELLIGENCE,
  type TrendWindow,
} from '../platform/fleet/fleetIntelligenceEngine';

const CO = 'co-1';
const T0 = Date.UTC(2026, 7, 1, 9, 0, 0);
const DAY = 86_400_000;

function ev(over: Partial<InsightEvidence> = {}): InsightEvidence {
  return {
    kind: 'VEHICLE', refId: 'veh-1', metric: 'fuel_l_per_100km',
    value: 9.4, provenance: 'MEASURED', ...over,
  };
}

/** N araçtan kanıt taşıyan taslak üretir. */
function draftWith(vehicles: number, trips = 0, provenance: InsightEvidence['provenance'] = 'MEASURED') {
  let d = emptyDraft(CO, 'FUEL_OUTLIER', 'TRIP_METRICS');
  for (let i = 0; i < vehicles; i++) {
    d = addEvidence(d, ev({ kind: 'VEHICLE', refId: `veh-${i}`, provenance }));
  }
  for (let i = 0; i < trips; i++) {
    d = addEvidence(d, ev({ kind: 'TRIP', refId: `trip-${i}`, provenance }));
  }
  return d;
}

function win(sum: number, n: number, vehicles: number): TrendWindow {
  return { sum, sampleCount: n, vehicleCount: vehicles };
}

beforeEach(() => { _resetFleetIntelligenceStoreForTest(); });

/* ═══ A. SÖZLEŞME ══════════════════════════════════════════════════════ */

describe('FleetIntelligence · A. Kanonik sözleşme', () => {
  it('A1. 🔒 13 insight tipi SÖZLEŞMEDİR', () => {
    expect(INSIGHT_TYPES).toHaveLength(13);
    for (const t of ['FUEL_OUTLIER', 'DRIVER_OUTLIER', 'VEHICLE_OUTLIER',
                     'MAINTENANCE_TREND', 'TEMPERATURE_TREND', 'BATTERY_TREND',
                     'BRAKE_PATTERN', 'IDLE_PATTERN', 'HIGH_UTILIZATION',
                     'LOW_UTILIZATION', 'DRIVER_CHANGE_PATTERN',
                     'VEHICLE_CHANGE_PATTERN', 'UNKNOWN']) {
      expect(INSIGHT_TYPES).toContain(t);
    }
  });

  it('A2. 🔒 KANIT KAYNAĞI OLMAYAN tipler AÇIKÇA beyan edilir', () => {
    /* Akü için voltaj, bakım için servis kaydı YOK. Sıcaklıktan "bakım
       gerekiyor" çıkarmak bir TAHMİNDİR ve bu paket tahmin üretmez. */
    expect([...INSIGHT_TYPES_WITHOUT_EVIDENCE]).toEqual(
      ['BATTERY_TREND', 'MAINTENANCE_TREND']);
  });

  it('A3. 🔒 insight bir CÜMLE DEĞİLDİR (doğal dil alanı yok)', () => {
    const i = buildInsight({ draft: draftWith(3, 25), id: 'i1', createdAt: T0 });
    for (const forbidden of ['title', 'message', 'recommendation', 'summary',
                             'text', 'description', 'advice']) {
      expect(Object.keys(i)).not.toContain(forbidden);
    }
  });

  it('A4. 🔒 sözleşme listeleri sabittir', () => {
    expect([...INSIGHT_CONFIDENCES]).toEqual(
      ['VERY_HIGH', 'HIGH', 'MEDIUM', 'LOW', 'UNKNOWN']);
    expect([...INSIGHT_STATES]).toEqual(
      ['DRAFT', 'ACTIVE', 'EXPIRED', 'SUPERSEDED', 'RETRACTED']);
    expect([...EVIDENCE_KINDS]).toEqual(['VEHICLE', 'DRIVER', 'TRIP', 'METRIC']);
    expect(INSIGHT_SOURCES).toContain('TRIP_METRICS');
    expect(HEALTH_DIMENSIONS).toHaveLength(6);
  });

  it('A5. 🔒 TEK FİLO PUANI ÜRETİLMEZ (bilinçli)', () => {
    expect(fleetHealthSingleScore()).toBeNull();
    expect(Object.keys(EMPTY_FLEET_HEALTH)).not.toContain('score');
    expect(Object.keys(EMPTY_FLEET_HEALTH)).not.toContain('overallScore');
  });
});

/* ═══ B. KANIT ═════════════════════════════════════════════════════════ */

describe('FleetIntelligence · B. Kanıt motoru', () => {
  it('B1. 🔒 AYNI kanıt iki kez eklenmez (replay)', () => {
    let d = emptyDraft(CO, 'FUEL_OUTLIER', 'TRIP_METRICS');
    d = addEvidence(d, ev());
    const once = d;
    for (let i = 0; i < 10; i++) d = addEvidence(d, ev());
    expect(d).toEqual(once);
    expect(d.evidence).toHaveLength(1);
  });

  it('B2. 🔒 ÖLÇÜLMEMİŞ kanıt (null + UNKNOWN) EKLENMEZ', () => {
    let d = emptyDraft(CO, 'BATTERY_TREND', 'TRIP_METRICS');
    d = addEvidence(d, ev({ value: null, provenance: 'UNKNOWN' }));
    expect(d.evidence).toHaveLength(0);
  });

  it('B3. 🔒 boş referans/metrik kanıt SAYILMAZ', () => {
    let d = emptyDraft(CO, 'FUEL_OUTLIER', 'TRIP_METRICS');
    d = addEvidence(d, ev({ refId: '' }));
    d = addEvidence(d, ev({ metric: '' }));
    expect(d.evidence).toHaveLength(0);
  });

  it('B4. 🔒 kanıt kimliği (kind|ref|metric) tekilliği sağlar', () => {
    expect(evidenceKey(ev())).toBe('VEHICLE|veh-1|fuel_l_per_100km');
    let d = emptyDraft(CO, 'FUEL_OUTLIER', 'TRIP_METRICS');
    d = addEvidence(d, ev({ metric: 'a' }));
    d = addEvidence(d, ev({ metric: 'b' }));
    expect(d.evidence).toHaveLength(2);   // farklı metrik = farklı kanıt
  });

  it('B5. 🔒 sayaçlar KANITTAN türetilir (araç/sürücü/yolculuk ayrı)', () => {
    let d = emptyDraft(CO, 'DRIVER_OUTLIER', 'TRIP_METRICS');
    d = addEvidence(d, ev({ kind: 'VEHICLE', refId: 'v1' }));
    d = addEvidence(d, ev({ kind: 'VEHICLE', refId: 'v2' }));
    d = addEvidence(d, ev({ kind: 'DRIVER', refId: 'd1' }));
    d = addEvidence(d, ev({ kind: 'TRIP', refId: 't1' }));
    const i = buildInsight({ draft: d, id: 'i1', createdAt: T0 });
    expect(i.vehicleCount).toBe(2);
    expect(i.driverCount).toBe(1);
    expect(i.tripCount).toBe(1);
    expect(i.evidenceCount).toBe(4);
    expect(i.evidence).toHaveLength(4);   // izlenebilirlik: satırlar TAŞINIR
  });
});

/* ═══ C. KANITSIZ İNSIGHT OLUŞMAZ ══════════════════════════════════════ */

describe('FleetIntelligence · C. Fail-closed', () => {
  it('C1. 🔒 KANIT YOKSA insight ACTIVE olmaz', () => {
    const i = buildInsight({
      draft: emptyDraft(CO, 'FUEL_OUTLIER', 'TRIP_METRICS'),
      id: 'i1', createdAt: T0,
    });
    expect(i.state).toBe('DRAFT');
    expect(i.confidence).toBe('UNKNOWN');
    expect(i.unknownReason).toBe('NO_EVIDENCE');
    expect(isInsightActive(i, T0)).toBe(false);
  });

  it('C2. 🔒 EŞİK ALTINDA kanıt yayımlanmaz', () => {
    const i = buildInsight({
      draft: draftWith(1, INSIGHT_MIN_EVIDENCE - 2), id: 'i1', createdAt: T0,
    });
    expect(i.state).toBe('DRAFT');
    expect(i.unknownReason).toBe('INSUFFICIENT_EVIDENCE');
  });

  it('C3. 🔒 KANIT KAYNAĞI OLMAYAN tip HİÇ üretilmez', () => {
    for (const type of INSIGHT_TYPES_WITHOUT_EVIDENCE) {
      let d = emptyDraft(CO, type, 'TRIP_METRICS');
      for (let i = 0; i < 10; i++) {
        d = addEvidence(d, ev({ refId: `veh-${i}` }));
      }
      const i = buildInsight({ draft: d, id: 'x', createdAt: T0 });
      expect(i.state).toBe('DRAFT');
      expect(i.confidence).toBe('UNKNOWN');
      expect(i.unknownReason).toBe('NO_EVIDENCE_SOURCE');
    }
  });

  it('C4. 🔒 SÜRESİZ insight YOKTUR ve kapanış idempotenttir', () => {
    const i = buildInsight({ draft: draftWith(3, 25), id: 'i1', createdAt: T0 });
    expect(i.expiresAt).toBeGreaterThan(i.createdAt);
    expect(isInsightActive(i, T0 + DAY)).toBe(true);

    const expired = settleInsight(i, T0 + 30 * DAY);
    expect(expired.state).toBe('EXPIRED');
    /* İkinci kapatma DEĞİŞTİRMEZ. */
    expect(settleInsight(expired, T0 + 60 * DAY)).toEqual(expired);
  });
});

/* ═══ D. GÜVEN — TEK ARAÇTAN HIGH ÇIKMAZ ═══════════════════════════════ */

describe('FleetIntelligence · D. Güven motoru', () => {
  it('D1. 🔒 TEK ARAÇTAN HIGH/VERY_HIGH ÇIKMAZ (pazarlıksız)', () => {
    const c = computeInsightConfidence({
      evidenceCount: 50, vehicleCount: 1, tripCount: 200, measuredRatio: 1,
    });
    expect(c).toBe(SINGLE_VEHICLE_CEILING);
    expect(['HIGH', 'VERY_HIGH']).not.toContain(c);
  });

  it('D2. 🔒 tek araçlı insight yayımlanır ama DAMGALANIR', () => {
    const i = buildInsight({ draft: draftWith(1, 25), id: 'i1', createdAt: T0 });
    expect(i.state).toBe('ACTIVE');
    expect(i.unknownReason).toBe('SINGLE_VEHICLE_ONLY');
    expect(['HIGH', 'VERY_HIGH']).not.toContain(i.confidence);
  });

  it('D3. 🔒 çok araç + çok yolculuk + ölçülmüş kanıt → VERY_HIGH', () => {
    const i = buildInsight({ draft: draftWith(6, 30), id: 'i1', createdAt: T0 });
    expect(i.confidence).toBe('VERY_HIGH');
    expect(i.unknownReason).toBeNull();
  });

  it('D4. 🔒 kanıt eşiği altında güven UNKNOWN', () => {
    expect(computeInsightConfidence({
      evidenceCount: 2, vehicleCount: 5, tripCount: 50, measuredRatio: 1,
    })).toBe('UNKNOWN');
  });

  it('D5. 🔒 ölçülmemiş kanıt oranı güveni DÜŞÜRÜR', () => {
    const strong = computeInsightConfidence({
      evidenceCount: 40, vehicleCount: 6, tripCount: 30, measuredRatio: 1,
    });
    const weak = computeInsightConfidence({
      evidenceCount: 40, vehicleCount: 6, tripCount: 30, measuredRatio: 0.2,
    });
    expect(strong).toBe('VERY_HIGH');
    expect(weak).toBe('LOW');
  });
});

/* ═══ E. TREND ═════════════════════════════════════════════════════════ */

describe('FleetIntelligence · E. Trend motoru', () => {
  it('E1. 🔒 MİNİMUM VERİ olmadan trend ÜRETİLMEZ', () => {
    const t = computeTrend('FUEL_PER_100KM', win(20, 2, 3), win(25, 2, 3));
    expect(t.direction).toBe('UNKNOWN');
    expect(t.unknownReason).toBe('INSUFFICIENT_EVIDENCE');
    expect(t.relativeChange).toBeNull();
  });

  it('E2. 🔒 TEK ARAÇLI trend filo iddiası ÜRETMEZ', () => {
    const t = computeTrend('FUEL_PER_100KM', win(70, 10, 1), win(90, 10, 1));
    expect(t.direction).toBe('UNKNOWN');
    expect(t.unknownReason).toBe('SINGLE_VEHICLE_ONLY');
  });

  it('E3. 🔒 anlamlı artış RISING olarak raporlanır', () => {
    const t = computeTrend('FUEL_PER_100KM', win(70, 10, 4), win(90, 10, 4));
    expect(t.direction).toBe('RISING');
    expect(t.baselineValue).toBeCloseTo(7, 6);
    expect(t.recentValue).toBeCloseTo(9, 6);
    expect(t.relativeChange).toBeCloseTo(2 / 7, 6);
    expect(t.vehicleCount).toBe(4);
  });

  it('E4. 🔒 küçük değişim FLAT (gürültü trend sayılmaz)', () => {
    const t = computeTrend('IDLE_RATIO', win(10, 10, 3), win(10.4, 10, 3));
    expect(t.direction).toBe('FLAT');
  });

  it('E5. 🔒 düşüş FALLING olarak raporlanır', () => {
    const t = computeTrend('UTILIZATION_KM_PER_VEHICLE', win(1000, 10, 5), win(700, 10, 5));
    expect(t.direction).toBe('FALLING');
    expect(t.relativeChange).toBeLessThan(0);
  });
});

/* ═══ F. FİLO SAPMASI ══════════════════════════════════════════════════ */

describe('FleetIntelligence · F. Filo sapması', () => {
  it('F1. 🔒 karşılaştırılabilir trend yoksa KARAR YOK', () => {
    const d = detectFleetDrift([computeTrend('FUEL_PER_100KM', win(20, 2, 3), win(25, 2, 3))]);
    expect(d.state).toBe('INSUFFICIENT');
    expect(d.evidence).toHaveLength(0);
  });

  it('F2. 🔒 filo davranışı değişirse DRIFTING + KANIT', () => {
    const trends = [
      computeTrend('FUEL_PER_100KM', win(70, 10, 4), win(90, 10, 4)),
      computeTrend('IDLE_RATIO', win(1.0, 10, 4), win(1.4, 10, 4)),
    ];
    const d = detectFleetDrift(trends);
    expect(d.state).toBe('DRIFTING');
    expect(d.evidence.length).toBeGreaterThanOrEqual(2);
    const fuel = d.evidence.find((e) => e.metric === 'FUEL_PER_100KM')!;
    expect(fuel.vehicleCount).toBe(4);
    expect(fuel.baselineSampleCount).toBe(10);
    expect(fuel.recentSampleCount).toBe(10);
  });

  it('F3. 🔒 kararlı filo STABLE (sahte sapma üretilmez)', () => {
    const d = detectFleetDrift([
      computeTrend('FUEL_PER_100KM', win(70, 10, 4), win(70.3, 10, 4)),
    ]);
    expect(d.state).toBe('STABLE');
    expect(d.evidence).toHaveLength(0);
  });

  it('F4. 🔒 TEK ARAÇLI trend filo sapmasına GİRMEZ', () => {
    const d = detectFleetDrift([
      computeTrend('FUEL_PER_100KM', win(70, 10, 1), win(120, 10, 1)),
    ]);
    expect(d.state).toBe('INSUFFICIENT');
  });
});

/* ═══ G. FİLO SAĞLIĞI ══════════════════════════════════════════════════ */

describe('FleetIntelligence · G. Filo sağlığı', () => {
  it('G1. 🔒 TÜM boyutlar için sonuç üretilir (sessiz boşluk yok)', () => {
    const h = buildFleetHealth({
      companyId: CO, dimensions: [], coverage: null,
      coverageVehicleCount: 0, computedAt: T0,
    });
    expect(h.dimensions).toHaveLength(HEALTH_DIMENSIONS.length);
    expect(h.unknownDimensionCount).toBe(HEALTH_DIMENSIONS.length);
  });

  it('G2. 🔒 ÖLÇÜLEMEYEN boyut UNKNOWN ve endeksi NULL (sahte 0 yok)', () => {
    const h = buildFleetHealth({
      companyId: CO,
      dimensions: [{ dimension: 'TELEMETRY_HEALTH', index: null, vehicleCount: 4, tripCount: 40 }],
      coverage: null, coverageVehicleCount: 0, computedAt: T0,
    });
    const d = h.dimensions.find((x) => x.dimension === 'TELEMETRY_HEALTH')!;
    expect(d.state).toBe('UNKNOWN');
    expect(d.index).toBeNull();
    expect(d.confidence).toBe('UNKNOWN');
    expect(d.unknownReason).not.toBeNull();
  });

  it('G3. 🔒 ölçülen boyut durum + güven taşır', () => {
    const h = buildFleetHealth({
      companyId: CO,
      dimensions: [{ dimension: 'DATA_HEALTH', index: 0.9, vehicleCount: 6, tripCount: 40 }],
      coverage: 0.8, coverageVehicleCount: 6, computedAt: T0,
    });
    const d = h.dimensions.find((x) => x.dimension === 'DATA_HEALTH')!;
    expect(d.state).toBe('GOOD');
    expect(d.index).toBeCloseTo(0.9, 6);
    expect(d.confidence).toBe('VERY_HIGH');
    expect(h.coverage).toBeCloseTo(0.8, 6);
  });

  it('G4. 🔒 bir boyutun bilinmemesi DİĞERLERİNİ belirsizleştirmez', () => {
    const h = buildFleetHealth({
      companyId: CO,
      dimensions: [
        { dimension: 'DATA_HEALTH', index: 0.9, vehicleCount: 6, tripCount: 40 },
        { dimension: 'TELEMETRY_HEALTH', index: null, vehicleCount: 0, tripCount: 0 },
      ],
      coverage: 0.5, coverageVehicleCount: 6, computedAt: T0,
    });
    expect(h.dimensions.find((x) => x.dimension === 'DATA_HEALTH')!.state).toBe('GOOD');
    expect(h.dimensions.find((x) => x.dimension === 'TELEMETRY_HEALTH')!.state).toBe('UNKNOWN');
  });

  it('G5. 🔒 KAPSAM: araç yoksa null (0 DEĞİL — bölme yapılamaz)', () => {
    expect(computeCoverage({ vehiclesTotal: 0, vehiclesReporting: 0 })).toBeNull();
    expect(computeCoverage({ vehiclesTotal: 10, vehiclesReporting: 4 })).toBeCloseTo(0.4, 6);
    expect(computeCoverage({ vehiclesTotal: 10, vehiclesReporting: 40 })).toBe(1);
  });
});

/* ═══ H. AI YOK · SAFLIK · GÖZLEM ══════════════════════════════════════ */

describe('FleetIntelligence · H. AI üretmez ve saftır', () => {
  const MODEL = readFileSync(
    join(process.cwd(), 'src/platform/fleet/fleetIntelligence.ts'), 'utf8');
  const ENGINE = readFileSync(
    join(process.cwd(), 'src/platform/fleet/fleetIntelligenceEngine.ts'), 'utf8');

  it('H1. 🔒 LLM/AI ÇAĞRISI YOK', () => {
    for (const src of [MODEL, ENGINE]) {
      const code = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
      for (const forbidden of ['fetch(', 'openrouter', 'gemini', 'anthropic',
                               'openai', 'aiService', 'semanticAi', 'llm']) {
        expect(code.toLowerCase()).not.toContain(forbidden.toLowerCase());
      }
    }
  });

  it('H2. 🔒 katman SAF (I/O · zaman · timer · depolama YOK)', () => {
    for (const src of [MODEL, ENGINE]) {
      const code = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
      expect(code).not.toContain('Date.now()');
      expect(code).not.toContain('setInterval');
      expect(code).not.toContain('setTimeout');
      expect(code).not.toContain('safeGetRaw');
      expect(code).not.toContain('supabase');
    }
  });

  it('H3. 🔒 DNA · trip · kimlik · doğrulama katmanları ÇAĞRILMAZ', () => {
    for (const src of [MODEL, ENGINE]) {
      for (const forbidden of ['driverDnaEngine', 'buildDna', 'tripLogService',
                               'resolveDriverPresence', 'resolveDriverAuthentication',
                               'vehicleIdentityService']) {
        expect(src).not.toContain(forbidden);
      }
    }
  });

  it('H4. 🔒 içgörü KİŞİSEL VERİ taşımaz', () => {
    const i = buildInsight({ draft: draftWith(3, 10), id: 'i1', createdAt: T0 });
    const keys = new Set<string>();
    const walk = (v: unknown): void => {
      if (Array.isArray(v)) { v.forEach(walk); return; }
      if (v !== null && typeof v === 'object') {
        for (const [k, val] of Object.entries(v)) { keys.add(k.toLowerCase()); walk(val); }
      }
    };
    walk(i);
    for (const forbidden of ['name', 'displayname', 'phone', 'email',
                             'plate', 'vin', 'latitude', 'longitude', 'route']) {
      expect(keys.has(forbidden)).toBe(false);
    }
  });

  it('H5. 🔒 etiketler tüm enum değerlerini KAPSAR', () => {
    for (const t of INSIGHT_TYPES) expect(insightTypeLabel(t).length).toBeGreaterThan(0);
    for (const s of INSIGHT_STATES) expect(insightStateLabel(s).length).toBeGreaterThan(0);
    for (const m of TREND_METRICS) expect(trendMetricLabel(m).length).toBeGreaterThan(0);
    for (const d of TREND_DIRECTIONS) expect(trendDirectionLabel(d).length).toBeGreaterThan(0);
    for (const d of HEALTH_DIMENSIONS) expect(healthDimensionLabel(d).length).toBeGreaterThan(0);
    for (const s of HEALTH_STATES) expect(healthStateLabel(s).length).toBeGreaterThan(0);
    for (const r of INSIGHT_UNKNOWN_REASONS) {
      expect(insightUnknownReasonLabel(r).length).toBeGreaterThan(0);
    }
    expect(FLEET_DRIFT_STATES).toHaveLength(3);
  });

  it('H6. 🔒 head unit deposu BOŞ başlar ve sahte veri üretmez', () => {
    const r = readFleetIntelligence(T0);
    expect(r.source).toBe('NONE');
    expect(r.insightCount).toBe(0);
    expect(r.coverage).toBeNull();
    expect(r.learningAgeMs).toBeNull();
    expect(r.snapshot).toEqual(EMPTY_FLEET_INTELLIGENCE);
  });

  it('H7. 🔒 sunucudan gelen anlık görüntü SAYILARI dürüstçe raporlanır', () => {
    const active = buildInsight({ draft: draftWith(4, 25), id: 'a', createdAt: T0 });
    const draft = buildInsight({
      draft: emptyDraft(CO, 'IDLE_PATTERN', 'TRIP_METRICS'), id: 'b', createdAt: T0,
    });
    fleetIntelligenceStore.setFromServer({
      insights: [active, draft],
      trends: [computeTrend('FUEL_PER_100KM', win(20, 2, 3), win(25, 2, 3))],
      health: buildFleetHealth({
        companyId: CO, dimensions: [], coverage: 0.5,
        coverageVehicleCount: 4, computedAt: T0,
      }),
      driftState: 'STABLE', driftEvidence: [],
      learningStartedAtMs: T0 - 10 * DAY, lastUpdateAtMs: T0,
    });
    const r = readFleetIntelligence(T0 + DAY);
    expect(r.source).toBe('SERVER');
    expect(r.insightCount).toBe(2);
    expect(r.activeInsightCount).toBe(1);
    expect(r.evidenceCount).toBe(active.evidenceCount);
    expect(r.trendCount).toBe(1);
    /* Bilinmeyenler GİZLENMEZ: 1 draft insight + 1 unknown trend + 6 sağlık boyutu. */
    expect(r.unknownCount).toBe(1 + 1 + 6);
    expect(r.learningAgeMs).toBe(11 * DAY);
    expect(r.coverage).toBeCloseTo(0.5, 6);
  });

  it('H8. 🔒 LAB ekranı istenen alanları GÖSTERİR', () => {
    const SCREEN = readFileSync(
      join(process.cwd(),
        'src/components/devtools/screens/FleetIntelligenceScreen.tsx'), 'utf8');
    for (const field of ['insightCount', 'evidenceCount', 'trendCount',
                         'unknownCount', 'confidence', 'Fleet Health',
                         'learningAge', 'drift', 'coverage']) {
      expect(SCREEN).toContain(field);
    }
    expect(SCREEN).not.toContain('setInterval');
  });
});
