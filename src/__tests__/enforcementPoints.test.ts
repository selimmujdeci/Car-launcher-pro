/**
 * enforcementPoints.test.ts — DENETİM NOKTASI zinciri kilitleri.
 *
 * Kapsam: saf paket katmanı (doğrulama · süzgeç · indeks · geometri) →
 * `enforcementMapSource` kapıları → `speedCameraWarningRule`'un `'unspecified'`
 * davranışı → LAB modelinin hükmü.
 *
 * KİLİTLENEN ÜRÜN GERÇEKLERİ (zayıflatma/silme YASAK):
 *  · Boş/bozuk paket → UNAVAILABLE. "0 nokta" ASLA "denetim yok" DEĞİL.
 *  · Sahte hız limiti üretilmez — kaynakta hiç yok, çıktı hep `null`.
 *  · Türü bilinmeyen noktada "radar" kelimesi HİÇBİR metinde geçmez.
 *  · Konum belirsizliği tavanı aşılınca uyarı ÜRETİLMEZ (#508).
 *  · Yön bilinmiyor/yavaşken uyarı ÜRETİLMEZ (fail-closed).
 *  · `'unknown'` (varlık bilinmiyor) ile `'unspecified'` (varlık gözlendi,
 *    tür bilinmiyor) AYRI davranır — ilki sessiz, ikincisi uyarır.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  parseEnforcementPackage, buildEnforcementIndex, findNearestEnforcementPoint,
  filterDrivingRelevantPoints, haversineMeters, bearingDegrees, angleDeltaDegrees,
  ENFORCEMENT_SCHEMA_VERSION,
  type EnforcementPoint,
} from '../platform/navigation/enforcement/enforcementPointsPackage';
import {
  evaluateSpeedCameraRisk,
} from '../platform/navigation/guardian/rules/speedCameraWarningRule';
import {
  GUARDIAN_ENFORCEMENT_SEVERITY, GUARDIAN_ENFORCEMENT_MIN_CONFIDENCE,
  GUARDIAN_ENFORCEMENT_MAX_POSITION_UNCERTAINTY_M,
} from '../platform/navigation/guardian/runtime/guardianEnforcementPolicy';

/* ── Fixture ───────────────────────────────────────────────────────────────── */

function rawPoint(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    lat: 36.8, lng: 34.6, type: 'UNKNOWN', role: null,
    speedLimitKph: null, directionHint: null, label: 'Test noktası', ...over,
  };
}

function rawPackage(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: ENFORCEMENT_SCHEMA_VERSION,
    sourceId: 'EGM_EDS_MAP',
    sourceUrl: 'https://example.invalid/eds',
    sourceNote: 'test',
    fetchedAt: '2026-08-13T06:56:23.382Z',
    count: 1,
    typeCounts: { UNKNOWN: 1 },
    points: [rawPoint()],
    ...over,
  };
}

/* ══════════════════════════════════════════════════════════════════════════
 * Paket doğrulama
 * ══════════════════════════════════════════════════════════════════════════ */

describe('parseEnforcementPackage — boş liste ≠ "denetim yok"', () => {
  it('SIFIR nokta taşıyan paket REDDEDİLİR (NO_VALID_POINTS)', () => {
    const r = parseEnforcementPackage(rawPackage({ points: [] }));
    expect(r.pkg).toBeNull();
    expect(r.reason).toBe('NO_VALID_POINTS');
  });

  it('tüm noktaları bozuk olan paket de REDDEDİLİR — sessiz "temiz yol" üretmez', () => {
    const r = parseEnforcementPackage(rawPackage({
      points: [rawPoint({ lat: 'abc' }), rawPoint({ lng: null })],
    }));
    expect(r.pkg).toBeNull();
    expect(r.reason).toBe('NO_VALID_POINTS');
    expect(r.droppedPointCount).toBe(2);
  });

  it('nesne olmayan / şema uyuşmayan / kaynaksız / tarihsiz paket REDDEDİLİR', () => {
    expect(parseEnforcementPackage(null).reason).toBe('NOT_AN_OBJECT');
    expect(parseEnforcementPackage(rawPackage({ schemaVersion: 99 })).reason).toBe('SCHEMA_VERSION_MISMATCH');
    expect(parseEnforcementPackage(rawPackage({ sourceId: '' })).reason).toBe('MISSING_SOURCE_FIELDS');
    expect(parseEnforcementPackage(rawPackage({ fetchedAt: '' })).reason).toBe('MISSING_FETCHED_AT');
    expect(parseEnforcementPackage(rawPackage({ points: 'x' })).reason).toBe('POINTS_NOT_ARRAY');
  });

  it('THROW ETMEZ — bozuk girdi karşısında bile', () => {
    expect(() => parseEnforcementPackage(undefined)).not.toThrow();
    expect(() => parseEnforcementPackage({ schemaVersion: 1, points: [1, 2, 3] })).not.toThrow();
  });
});

describe('parseEnforcementPackage — sahte veri üretmez', () => {
  it('hız limiti kaynakta ne yazarsa yazsın çıktı HER ZAMAN null', () => {
    const r = parseEnforcementPackage(rawPackage({
      points: [rawPoint({ speedLimitKph: 90 })],
    }));
    expect(r.pkg?.points[0].speedLimitKph).toBeNull();
  });

  it('tanınmayan tür TAHMİN EDİLMEZ → UNKNOWN', () => {
    const r = parseEnforcementPackage(rawPackage({
      points: [rawPoint({ type: 'RADAR_SUPER' })],
    }));
    expect(r.pkg?.points[0].type).toBe('UNKNOWN');
  });

  it('count BEYAN edilen değil SAYILAN değerdir', () => {
    const r = parseEnforcementPackage(rawPackage({
      count: 999,
      points: [rawPoint(), rawPoint({ lat: 36.9 })],
    }));
    expect(r.pkg?.count).toBe(2);
  });

  it('kimlik KOORDİNAT TAŞIMAZ (gizlilik — LAB\'a giden alan)', () => {
    const r = parseEnforcementPackage(rawPackage({ points: [rawPoint({ lat: 41.123456 })] }));
    expect(r.pkg?.points[0].id).toBe('p-0');
    expect(r.pkg?.points[0].id).not.toContain('41');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * Süzgeç + indeks + geometri
 * ══════════════════════════════════════════════════════════════════════════ */

describe('filterDrivingRelevantPoints', () => {
  it('park ihlali noktaları sorgu dışı kalır, diğerleri kalır', () => {
    const pkg = parseEnforcementPackage(rawPackage({
      points: [
        rawPoint({ type: 'PARKING' }),
        rawPoint({ type: 'UNKNOWN', lat: 36.81 }),
        rawPoint({ type: 'RED_LIGHT', lat: 36.82 }),
      ],
    })).pkg;
    const kept = filterDrivingRelevantPoints(pkg!.points);
    expect(kept).toHaveLength(2);
    expect(kept.some((p) => p.type === 'PARKING')).toBe(false);
  });
});

describe('geometri — saf', () => {
  it('angleDeltaDegrees negatif girdide DOĞRU (JS % kalan operatörü tuzağı)', () => {
    expect(angleDeltaDegrees(350, 10)).toBe(20);
    expect(angleDeltaDegrees(10, 350)).toBe(20);
    expect(angleDeltaDegrees(-10, 10)).toBe(20);
    expect(angleDeltaDegrees(0, 180)).toBe(180);
  });

  it('haversine bilinen mesafeyi makul verir (~1 km)', () => {
    const d = haversineMeters(36.8, 34.6, 36.809, 34.6);
    expect(d).toBeGreaterThan(950);
    expect(d).toBeLessThan(1050);
  });

  it('bearing kuzey ~0°, doğu ~90°', () => {
    expect(bearingDegrees(36.8, 34.6, 36.81, 34.6)).toBeCloseTo(0, 0);
    expect(bearingDegrees(36.8, 34.6, 36.8, 34.61)).toBeCloseTo(90, 0);
  });
});

describe('findNearestEnforcementPoint', () => {
  const points: readonly EnforcementPoint[] = parseEnforcementPackage(rawPackage({
    points: [
      rawPoint({ lat: 36.8045, lng: 34.6 }),  // ~500 m KUZEY
      rawPoint({ lat: 36.7955, lng: 34.6 }),  // ~500 m GÜNEY
    ],
  })).pkg!.points;
  const index = buildEnforcementIndex(points);

  it('yarıçap dışındaki nokta HİÇ değerlendirilmez', () => {
    const hit = findNearestEnforcementPoint(index, {
      lat: 36.8, lng: 34.6, radiusMeters: 100,
      headingDegrees: null, aheadHalfAngleDegrees: 60,
    });
    expect(hit).toBeNull();
  });

  it('yön biliniyorsa ARKADAKİ nokta elenir — kuzeye giderken güney noktası uyarmaz', () => {
    const hit = findNearestEnforcementPoint(index, {
      lat: 36.8, lng: 34.6, radiusMeters: 700,
      headingDegrees: 0, aheadHalfAngleDegrees: 60,
    });
    expect(hit).not.toBeNull();
    expect(hit!.point.lat).toBeGreaterThan(36.8); // kuzeydeki
    expect(hit!.candidateCount).toBe(2);          // ikisi de yarıçapta, biri elendi
  });

  it('güneye giderken güneydeki nokta seçilir (simetri)', () => {
    const hit = findNearestEnforcementPoint(index, {
      lat: 36.8, lng: 34.6, radiusMeters: 700,
      headingDegrees: 180, aheadHalfAngleDegrees: 60,
    });
    expect(hit!.point.lat).toBeLessThan(36.8);
  });

  it('yön bilinmiyorsa koni uygulanmaz ve headingKnown=false döner', () => {
    const hit = findNearestEnforcementPoint(index, {
      lat: 36.8, lng: 34.6, radiusMeters: 700,
      headingDegrees: null, aheadHalfAngleDegrees: 60,
    });
    expect(hit).not.toBeNull();
    expect(hit!.headingKnown).toBe(false);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * Kural: 'unspecified' — varlık gözlendi, tür bilinmiyor
 * ══════════════════════════════════════════════════════════════════════════ */

describe('speedCameraWarningRule — unspecified ≠ unknown', () => {
  const policy = {
    severityByCameraType: GUARDIAN_ENFORCEMENT_SEVERITY,
    minimumConfidence: GUARDIAN_ENFORCEMENT_MIN_CONFIDENCE,
  };
  const cam = (cameraType: 'unspecified' | 'unknown') => ({
    camera: { id: 'p-7', cameraType, distanceMeters: 420, confidence: 0.9 },
    policy,
  });

  it('unknown → olay YOK (varlık bile bilinmiyor — kilit KORUNDU)', () => {
    expect(evaluateSpeedCameraRisk(cam('unknown')).riskEvents).toEqual([]);
  });

  it('unspecified → olay VAR (paketin %93\'ü sessizce yutulmaz)', () => {
    const ev = evaluateSpeedCameraRisk(cam('unspecified')).riskEvents;
    expect(ev).toHaveLength(1);
    expect(ev[0].severity).toBe('LOW');
  });

  it('unspecified metinlerinde "radar"/"ceza"/"polis" GEÇMEZ ve TÜR İDDİA EDİLMEZ', () => {
    const e = evaluateSpeedCameraRisk(cam('unspecified')).riskEvents[0];
    const all = `${e.title} ${e.message} ${e.recommendedAction}`;
    for (const word of ['radar', 'Radar', 'ceza', 'Ceza', 'polis', 'Polis']) {
      expect(all).not.toContain(word);
    }
    // Türü bilinmeyen noktaya "hız denetimi" demek de bir tür iddiasıdır.
    expect(e.title).toBe('Denetim noktası');
  });

  it('unspecified mesajı HIZ EŞİĞİ İDDİA ETMEZ (K4 — kaynakta limit yok)', () => {
    const e = evaluateSpeedCameraRisk(cam('unspecified')).riskEvents[0];
    expect(e.message).not.toMatch(/\d+\s*(km\/h|km\/s|kmh)/i);
    expect(e.title).not.toMatch(/\d/);
  });

  it('politika haritasında unspecified eşlemesi YOKSA THROW — sessizce düşmez', () => {
    expect(() => evaluateSpeedCameraRisk({
      camera: { id: 'p-1', cameraType: 'unspecified', distanceMeters: 100, confidence: 0.9 },
      policy: { severityByCameraType: { fixed_speed: 'MEDIUM' } },
    })).toThrow();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * enforcementMapSource — kapılar
 * ══════════════════════════════════════════════════════════════════════════ */

vi.mock('../platform/vehicleDataLayer/UnifiedVehicleStore', () => ({
  useUnifiedVehicleStore: { getState: () => ({ location: null }) },
}));

const READY_PACKAGE = rawPackage({
  points: [rawPoint({ lat: 36.8045, lng: 34.6 })], // ~500 m kuzey
});

async function loadReadyPackage(): Promise<void> {
  const mod = await import('../platform/navigation/enforcement/enforcementPointsSource');
  mod._resetEnforcementSourceForTest();
  const original = globalThis.fetch;
  globalThis.fetch = (async () => ({
    ok: true, text: async () => JSON.stringify(READY_PACKAGE),
  })) as unknown as typeof fetch;
  await mod.ensureEnforcementPointsLoaded('/test-package.json');
  globalThis.fetch = original;
}

describe('enforcementMapSource — fail-closed kapılar', () => {
  const NOW = 1_800_000_000_000;
  const clock = { nowMs: () => NOW };

  /** Tüm kapıları GEÇEN taban okuma — her test bundan tek alan bozar. */
  function baseSnapshot() {
    return {
      latitude: 36.8, longitude: 34.6,
      accuracyMeters: 10,
      headingDegrees: 0,          // kuzeye gidiyor → nokta ileride
      speedMps: 20,               // 72 km/h
      timestampMs: NOW - 1000,    // 1 s bayat → belirsizlik 10 + 20 = 30 m
    };
  }

  beforeEach(async () => {
    const src = await import('../platform/navigation/guardian/providers/concrete/enforcementMapSource');
    src._resetEnforcementGateCountersForTest();
    await loadReadyPackage();
  });

  async function readWith(patch: Record<string, unknown>) {
    const src = await import('../platform/navigation/guardian/providers/concrete/enforcementMapSource');
    const source = src.createEnforcementMapSource({
      port:  { getLatestLocation: () => ({ ...baseSnapshot(), ...patch }) },
      clock,
    });
    const out = source.read();
    return { out, counters: src.getEnforcementGateCounters() };
  }

  it('taban okuma dilim ÜRETİR (kapılar geçilebilir olmalı — test kendi kendini kandırmasın)', async () => {
    const { out, counters } = await readWith({});
    expect(out?.speedCamera).toBeDefined();
    expect(out!.speedCamera!.cameraType).toBe('unspecified');
    expect(counters.emittedCount).toBe(1);
    expect(counters.lastGate).toBeNull();
  });

  it('KONUM BELİRSİZLİĞİ tavanı aşılınca uyarı ÜRETİLMEZ (#508)', async () => {
    // 30 m/s × 19,5 s = 585 m ≫ tavan
    const { out, counters } = await readWith({ speedMps: 30, timestampMs: NOW - 19_500 });
    expect(out).toBeUndefined();
    expect(counters.lastGate).toBe('UNCERTAIN_POSITION');
    expect(counters.uncertainPosition).toBe(1);
    expect(counters.lastUncertaintyM).toBeGreaterThan(GUARDIAN_ENFORCEMENT_MAX_POSITION_UNCERTAINTY_M);
  });

  it('yavaş/durağan araçta uyarı ÜRETİLMEZ (yön güvenilmez)', async () => {
    const { out, counters } = await readWith({ speedMps: 1 });
    expect(out).toBeUndefined();
    expect(counters.lastGate).toBe('HEADING_UNAVAILABLE');
  });

  it('yön alanı yoksa uyarı ÜRETİLMEZ (fail-closed)', async () => {
    const { out, counters } = await readWith({ headingDegrees: undefined });
    expect(out).toBeUndefined();
    expect(counters.lastGate).toBe('HEADING_UNAVAILABLE');
  });

  it('hız okunamıyorsa belirsizlik hesaplanamaz → uyarı ÜRETİLMEZ', async () => {
    const { out, counters } = await readWith({ speedMps: undefined });
    expect(out).toBeUndefined();
    expect(counters.lastGate).toBe('NO_SPEED');
  });

  it('gelecekten gelen / ölü fix REDDEDİLİR', async () => {
    expect((await readWith({ timestampMs: NOW + 5000 })).counters.lastGate).toBe('STALE_FIX');
    expect((await readWith({ timestampMs: NOW - 120_000 })).counters.lastGate).toBe('STALE_FIX');
  });

  it('koordinat yoksa uyarı ÜRETİLMEZ', async () => {
    const { counters } = await readWith({ latitude: undefined });
    expect(counters.lastGate).toBe('NO_LOCATION');
  });

  it('arkadaki noktaya uyarı VERİLMEZ (güneye giderken kuzeydeki nokta)', async () => {
    const { out, counters } = await readWith({ headingDegrees: 180 });
    expect(out).toBeUndefined();
    expect(counters.lastGate).toBe('NO_POINT_AHEAD');
  });

  it('port THROW ederse read() throw ETMEZ (fail-soft)', async () => {
    const src = await import('../platform/navigation/guardian/providers/concrete/enforcementMapSource');
    const source = src.createEnforcementMapSource({
      port:  { getLatestLocation: () => { throw new Error('boom'); } },
      clock,
    });
    expect(() => source.read()).not.toThrow();
    expect(source.read()).toBeUndefined();
  });

  it('üretilen dilimin kimliği KOORDİNAT TAŞIMAZ', async () => {
    const { out } = await readWith({});
    expect(out!.speedCamera!.id).toBe('EGM_EDS_MAP:p-0');
    expect(out!.speedCamera!.id).not.toContain('36.8');
    expect(out!.speedCamera!.id).not.toContain('34.6');
  });
});

describe('enforcementMapSource — paket yokken', () => {
  it('paket hazır değilse PACKAGE_NOT_READY sayılır — sessiz "denetim yok" DEĞİL', async () => {
    const store = await import('../platform/navigation/enforcement/enforcementPointsSource');
    store._resetEnforcementSourceForTest();
    const src = await import('../platform/navigation/guardian/providers/concrete/enforcementMapSource');
    src._resetEnforcementGateCountersForTest();

    const source = src.createEnforcementMapSource({
      port:  { getLatestLocation: () => ({ latitude: 36.8, longitude: 34.6 }) },
      clock: { nowMs: () => 1 },
    });
    expect(source.read()).toBeUndefined();
    expect(src.getEnforcementGateCounters().lastGate).toBe('PACKAGE_NOT_READY');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * Kaynak katmanı — bozuk paket
 * ══════════════════════════════════════════════════════════════════════════ */

describe('enforcementPointsSource — yükleme dürüstlüğü', () => {
  it('HTTP hatası → FAILED, nokta sayısı null (sahte 0 YOK)', async () => {
    const mod = await import('../platform/navigation/enforcement/enforcementPointsSource');
    mod._resetEnforcementSourceForTest();
    const original = globalThis.fetch;
    globalThis.fetch = (async () => ({ ok: false, text: async () => '' })) as unknown as typeof fetch;
    await mod.ensureEnforcementPointsLoaded('/x.json');
    globalThis.fetch = original;

    const st = mod.getEnforcementSourceStatus();
    expect(st.loadState).toBe('FAILED');
    expect(st.failureKind).toBe('HTTP_ERROR');
    expect(st.pointCount).toBeNull();
    expect(mod.isEnforcementPackageReady()).toBe(false);
  });

  it('bozuk JSON → FAILED (JSON_ERROR), throw ETMEZ', async () => {
    const mod = await import('../platform/navigation/enforcement/enforcementPointsSource');
    mod._resetEnforcementSourceForTest();
    const original = globalThis.fetch;
    globalThis.fetch = (async () => ({ ok: true, text: async () => '{bozuk' })) as unknown as typeof fetch;
    await expect(mod.ensureEnforcementPointsLoaded('/x.json')).resolves.toBeUndefined();
    globalThis.fetch = original;
    expect(mod.getEnforcementSourceStatus().failureKind).toBe('JSON_ERROR');
  });

  it('hazır pakette sorguya giren sayı park ihlallerini KAPSAMAZ ve fark GÖRÜNÜR', async () => {
    const mod = await import('../platform/navigation/enforcement/enforcementPointsSource');
    mod._resetEnforcementSourceForTest();
    const original = globalThis.fetch;
    globalThis.fetch = (async () => ({
      ok: true,
      text: async () => JSON.stringify(rawPackage({
        points: [rawPoint(), rawPoint({ type: 'PARKING', lat: 36.81 })],
      })),
    })) as unknown as typeof fetch;
    await mod.ensureEnforcementPointsLoaded('/x.json');
    globalThis.fetch = original;

    const st = mod.getEnforcementSourceStatus();
    expect(st.pointCount).toBe(2);
    expect(st.queryablePointCount).toBe(1);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * LAB modeli — hüküm
 * ══════════════════════════════════════════════════════════════════════════ */

describe('enforcementPointsModel — hüküm fail-closed', () => {
  it('paket yokken hüküm NO_PACKAGE ve gerekçe "denetim yok değil" der', async () => {
    const { deriveEnforcementVerdict } = await import('../platform/devtools/enforcementPointsModel');
    const v = deriveEnforcementVerdict({
      readAt: 1, packageUrl: '/x', queryCount: 0, hitCount: 0,
      radiusM: 700, maxUncertaintyM: 150, aheadHalfAngleDeg: 60,
      minHeadingSpeedMps: 5, maxFixAgeMs: 30000, minConfidence: 0.3,
      severityUnspecified: 'LOW',
      status: {
        loadState: 'FAILED', fetchedAt: null, pointCount: null,
        queryablePointCount: null, typeCounts: null, sourceId: null,
        schemaVersion: null, droppedPointCount: null, failureKind: 'NO_VALID_POINTS',
        loadedAtWallMs: null, loadDurationMs: null,
      },
      gates: {
        readCount: 0, emittedCount: 0, packageNotReady: 0, noLocation: 0,
        staleFix: 0, noSpeed: 0, uncertainPosition: 0, headingUnavailable: 0,
        noPointAhead: 0, lastGate: null, lastUncertaintyM: null, lastDistanceM: null,
      },
    });
    expect(v.status).toBe('NO_PACKAGE');
    expect(v.reasons.join(' ')).toContain('aynı şey değildir');
  });

  it('okumaların çoğu konum kapısında düşüyorsa hüküm POSITION_BLIND (#508 izi)', async () => {
    const { deriveEnforcementVerdict } = await import('../platform/devtools/enforcementPointsModel');
    const v = deriveEnforcementVerdict({
      readAt: 1, packageUrl: '/x', queryCount: 0, hitCount: 0,
      radiusM: 700, maxUncertaintyM: 150, aheadHalfAngleDeg: 60,
      minHeadingSpeedMps: 5, maxFixAgeMs: 30000, minConfidence: 0.3,
      severityUnspecified: 'LOW',
      status: {
        loadState: 'READY', fetchedAt: '2026-08-13T00:00:00Z', pointCount: 1503,
        queryablePointCount: 1495, typeCounts: { UNKNOWN: 1400 }, sourceId: 'EGM_EDS_MAP',
        schemaVersion: 1, droppedPointCount: 0, failureKind: null,
        loadedAtWallMs: 1, loadDurationMs: 12,
      },
      gates: {
        readCount: 100, emittedCount: 0, packageNotReady: 0, noLocation: 0,
        staleFix: 0, noSpeed: 0, uncertainPosition: 90, headingUnavailable: 5,
        noPointAhead: 5, lastGate: 'UNCERTAIN_POSITION', lastUncertaintyM: 540, lastDistanceM: null,
      },
    });
    expect(v.status).toBe('POSITION_BLIND');
    expect(v.reasons.join(' ')).toContain('#508');
  });
});
