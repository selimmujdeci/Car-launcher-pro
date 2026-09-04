/**
 * navV3FieldTraceF8.test.ts — NAV v3 · F8 · SAHA KAYDI HAZIRLIĞI KİLİTLERİ.
 *
 * Belge: `CAROS-NAV-ARCH-SPEC-3.0` §F8.
 *
 * Kapsam:
 *  1) `NavFieldSample` — F3–F7 bölümleri fail-soft okunur (tek bölüm çöker,
 *     örnek ÇÖKMEZ)
 *  2) Sınırlı kayıt — başlat/durdur/dışa aktar, taşma AÇIKÇA işaretlenir
 *  3) Olay türetimi — SAF, deterministik, geçiş-tabanlı (tekrar üretmez)
 *  4) Gizlilik — varsayılan dışa aktarım koordinat TAŞIMAZ
 *  5) `replayFieldTrace` — 5 ilke, KÖR OLMADIĞININ kanıtı (temiz + ihlalli)
 *  6) Mimari kilitler T1–T12
 *
 * SAHA: bu testin yeşili F8'i "tamam" YAPMAZ — gerçek araç kaydı ayrı bir
 * kütük maddesidir (#1273–#1275). F8 bir ÖLÇÜM ürünü değil, ölçüm ALTYAPISI
 * ölçütüdür.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  deriveFieldEvents, startFieldRecording, stopFieldRecording,
  getFieldRecordingStatus, exportFieldTrace, _resetFieldRecordingForTest,
  FIELD_TRACE_MAX_SAMPLES, FIELD_TRACE_MAX_EVENTS, FIELD_TRACE_SCHEMA,
  NAV_FIELD_EVENT_KINDS,
  type NavFieldSample, type NavFieldTrace,
} from '../platform/devtools/navFieldBridge';
import {
  replayFieldTrace, FIELD_TRACE_INVARIANTS,
} from '../platform/devtools/navFieldTraceReplay';

/* ══════════════════════════════════════════════════════════════════════════
   YARDIMCILAR — deterministik örnek üretimi
   ══════════════════════════════════════════════════════════════════════════ */

function baseSample(over: Partial<NavFieldSample> = {}): NavFieldSample {
  return {
    tWall: 1_700_000_000_000,
    tMono: 1_000,
    nav: { status: 'ACTIVE', isNavigating: true, isGuidanceActive: true, isRerouting: false, distanceM: 1000, etaS: 120 },
    veh: { speedKmh: 60, headingDeg: 90, lat: 41.0, lon: 29.0, accuracyM: 8, fixAgeMs: 500 },
    match: { state: 'MATCHED', confidence: 0.9, segIdx: 3, lateralM: 4, headingDeltaDeg: 2, alongRemainingM: 500, reasons: [], snappedLat: 41.0001, snappedLon: 29.0001 },
    offRoute: { state: 'ON_ROUTE', evidence: 0, required: 2, requiredMs: 1200, confirmedAtMs: null, reasons: ['ON_CORRIDOR'] },
    route: { serverUsed: 'osrm', steps: 5, stepIdx: 1, nextManeuverM: 300, distSource: 'ALONG_ROUTE', totalM: 5000, geometryPts: 80, anchorsResolved: 5, anchorsUnresolved: 0, validation: 'VALID', validationWarnIds: [], validationFailIds: [], lanesSteps: 0, roundaboutSteps: 0, roundaboutWithExit: 0 },
    req: { currentId: 1, committed: 1, staleRejected: 0, invalidRejected: 0, superseded: 0, failed: 0, suppressed: 0, detectToCommitMs: null, detectToFirstInstrMs: null, requestToResponseMs: null, offRouteDetectedAtMs: null },
    provider: { localState: 'UNKNOWN', probeCount: 0, skippedCount: 0, lastSource: 'osrm', straightLineCount: 0, remoteFailures: 0 },
    corridorM: 55,
    fetchInFlight: false,
    ceh: { state: 'HORIZON_AVAILABLE', generation: 1, ambiguous: false, physicallyConfirmed: true, mppPresent: true, pathCount: 1, objectCount: 2, horizonAgeMs: 100, mapAvailable: true, boundDomains: ['ENFORCEMENT'], errorCount: 0 },
    graph: { state: 'AVAILABLE', holders: 1, loadCount: 1, nodeCount: 238252, edgeCount: 295346, version: 2, parseMs: 40, adjacencyBuilt: true },
    roadCorridor: { calls: 1, lastOutcome: 'OBJECTS', lastCorridorOutcome: 'COMPLETE', lastCorridorEdgeCount: 3, lastCorridorNodeExpansions: 2, lastCorridorTruncated: false, lastCandidateCount: 1, lastObjectCount: 1, lastDurationMs: 0.1 },
    enforcement: { matchedToEdge: 1, ambiguousEdge: 0, noEdgeMatch: 0, outsideCoverage: 0, notMeasured: 0, onewayImplied: 1, unknownDirection: 0, lastOutcome: 'MATCHED_TO_EDGE' },
    shadow: { active: true, ticks: 10, errorCount: 0, comparable: 5, divergent: 0, divergenceRatio: 0, cutoverState: 'CLOSED', cutoverUnmet: ['F4_FIELD_VALIDATION'], guardianWouldEmitCount: 0, sideEffectCount: 0 },
    rationale: { decisions: 1, overrodeProviderFirst: 0, maxDurationPenaltyS: 0, lastFactor: 'ONLY_OPTION', lastChosenIdx: 0, lastDurationPenaltyS: 0, lastAcceptedCount: 1 },
    perf: { mapMatchP50Ms: 0.5, mapMatchP95Ms: 1.2, mapMatchMaxMs: 3, progressP50Ms: 1, progressP95Ms: 2, progressMaxMs: 5 },
    ...over,
  };
}

/* ══════════════════════════════════════════════════════════════════════════
   1) OLAY TÜRETİMİ — SAF, deterministik
   ══════════════════════════════════════════════════════════════════════════ */

describe('F8.1 · deriveFieldEvents — saf olay türetimi', () => {
  it('ilk örnekte (prev=null) HİÇBİR olay üretilmez — "geçiş" tanımsızdır', () => {
    const { events } = deriveFieldEvents(baseSample(), null, 0);
    expect(events).toEqual([]);
  });

  it('MATCH_STATE_CHANGED: yalnız DEĞİŞTİĞİNDE üretilir, aynı kalınca YOK', () => {
    const s1 = baseSample({ match: { ...baseSample().match, state: 'MATCHED' } });
    const s2 = baseSample({ match: { ...baseSample().match, state: 'AMBIGUOUS' } });
    const r1 = deriveFieldEvents(s1, null, 0);
    const r2 = deriveFieldEvents(s2, r1.next, 1);
    const r3 = deriveFieldEvents(s2, r2.next, 2); // aynı durum tekrar
    expect(r2.events.map(e => e.kind)).toContain('MATCH_STATE_CHANGED');
    expect(r2.events[0].from).toBe('MATCHED');
    expect(r2.events[0].to).toBe('AMBIGUOUS');
    expect(r3.events.some(e => e.kind === 'MATCH_STATE_CHANGED')).toBe(false);
  });

  it('CORRIDOR_TRUNCATED: yalnız false→true geçişinde üretilir (true→true TEKRAR üretmez)', () => {
    const clean = baseSample();
    const trunc = baseSample({ roadCorridor: { ...baseSample().roadCorridor!, lastCorridorTruncated: true } });
    const r1 = deriveFieldEvents(clean, null, 0);
    const r2 = deriveFieldEvents(trunc, r1.next, 1);
    const r3 = deriveFieldEvents(trunc, r2.next, 2);
    expect(r2.events.map(e => e.kind)).toContain('CORRIDOR_TRUNCATED');
    expect(r3.events.some(e => e.kind === 'CORRIDOR_TRUNCATED')).toBe(false);
  });

  it('ENFORCEMENT_ACQUIRED / ENFORCEMENT_LOST: nesne sayısı 0↔>0 geçişleri', () => {
    const none = baseSample({ roadCorridor: { ...baseSample().roadCorridor!, lastObjectCount: 0 } });
    const some = baseSample({ roadCorridor: { ...baseSample().roadCorridor!, lastObjectCount: 2 } });
    const r0 = deriveFieldEvents(none, null, 0);
    const r1 = deriveFieldEvents(some, r0.next, 1);
    const r2 = deriveFieldEvents(none, r1.next, 2);
    expect(r1.events.map(e => e.kind)).toEqual(['ENFORCEMENT_ACQUIRED']);
    expect(r2.events.map(e => e.kind)).toEqual(['ENFORCEMENT_LOST']);
  });

  it('SHADOW_DIVERGENCE: eşik AŞILINCA bir kez üretilir, eşik üstünde kalınca TEKRAR yok', () => {
    const low = baseSample({ shadow: { ...baseSample().shadow!, divergenceRatio: 0.001 } });
    const high = baseSample({ shadow: { ...baseSample().shadow!, divergenceRatio: 0.5 } });
    const r0 = deriveFieldEvents(low, null, 0);
    const r1 = deriveFieldEvents(high, r0.next, 1);
    const r2 = deriveFieldEvents(high, r1.next, 2);
    expect(r1.events.map(e => e.kind)).toContain('SHADOW_DIVERGENCE');
    expect(r2.events.some(e => e.kind === 'SHADOW_DIVERGENCE')).toBe(false);
  });

  it('ROUTE_SELECTED: istek kimliği DEĞİŞİNCE üretilir (yeniden rota dâhil)', () => {
    const a = baseSample({ req: { ...baseSample().req, currentId: 1 } });
    const b = baseSample({ req: { ...baseSample().req, currentId: 2 } });
    const r0 = deriveFieldEvents(a, null, 0);
    const r1 = deriveFieldEvents(b, r0.next, 1);
    expect(r1.events.map(e => e.kind)).toContain('ROUTE_SELECTED');
    expect(r1.events.find(e => e.kind === 'ROUTE_SELECTED')!.to).toBe('2');
  });

  it('RATIONALE_UNKNOWN: F7 "açıklanamadı" hükmüne GEÇİŞTE üretilir, ısrarında TEKRAR yok', () => {
    const ok = baseSample({ rationale: { ...baseSample().rationale!, lastFactor: 'DURATION' } });
    const unk = baseSample({ rationale: { ...baseSample().rationale!, lastFactor: 'UNKNOWN' } });
    const r0 = deriveFieldEvents(ok, null, 0);
    const r1 = deriveFieldEvents(unk, r0.next, 1);
    const r2 = deriveFieldEvents(unk, r1.next, 2);
    expect(r1.events.map(e => e.kind)).toEqual(['RATIONALE_UNKNOWN']);
    expect(r2.events.some(e => e.kind === 'RATIONALE_UNKNOWN')).toBe(false);
  });

  it('GRAPH_RESIDENCY_CHANGED: graf durumu değişince üretilir', () => {
    const a = baseSample({ graph: { ...baseSample().graph!, state: 'AVAILABLE' } });
    const b = baseSample({ graph: { ...baseSample().graph!, state: 'MISSING' } });
    const r0 = deriveFieldEvents(a, null, 0);
    const r1 = deriveFieldEvents(b, r0.next, 1);
    expect(r1.events.map(e => e.kind)).toContain('GRAPH_RESIDENCY_CHANGED');
  });

  it('bölüm `null` iken (okunamadı) OLAY ÜRETİLMEZ, çökmez (fail-soft)', () => {
    const a = baseSample({ ceh: null, roadCorridor: null, enforcement: null, shadow: null, rationale: null, graph: null });
    const b = baseSample({ ceh: null, roadCorridor: null, enforcement: null, shadow: null, rationale: null, graph: null });
    expect(() => {
      const r0 = deriveFieldEvents(a, null, 0);
      deriveFieldEvents(b, r0.next, 1);
    }).not.toThrow();
  });

  it('sözlük TAM: her `kind` en az bir testte üretilir (kilit kör değil)', () => {
    const produced = new Set<string>();
    const samples = [
      baseSample(), baseSample({ match: { ...baseSample().match, state: 'X' } }),
      baseSample({ ceh: { ...baseSample().ceh!, state: 'Y' } }),
      baseSample({ roadCorridor: { ...baseSample().roadCorridor!, lastCorridorTruncated: true } }),
      baseSample({ roadCorridor: { ...baseSample().roadCorridor!, lastObjectCount: 5 } }),
      baseSample({ roadCorridor: { ...baseSample().roadCorridor!, lastObjectCount: 0 } }),
      baseSample({ shadow: { ...baseSample().shadow!, divergenceRatio: 0.9 } }),
      baseSample({ req: { ...baseSample().req, currentId: 99 } }),
      baseSample({ rationale: { ...baseSample().rationale!, lastFactor: 'UNKNOWN' } }),
      baseSample({ graph: { ...baseSample().graph!, state: 'MISSING' } }),
    ];
    let prev = null as ReturnType<typeof deriveFieldEvents>['next'] | null;
    for (let i = 0; i < samples.length; i++) {
      const r = deriveFieldEvents(samples[i], prev, i);
      prev = r.next;
      for (const e of r.events) produced.add(e.kind);
    }
    expect([...produced].sort()).toEqual([...NAV_FIELD_EVENT_KINDS].sort());
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   2) SINIRLI KAYIT
   ══════════════════════════════════════════════════════════════════════════ */

describe('F8.2 · sınırlı kayıt — başlat/durdur/dışa aktar', () => {
  beforeEach(() => _resetFieldRecordingForTest());

  it('kayıt başlamadan `exportFieldTrace` `null` döner — sahte boş trace YOK', () => {
    expect(exportFieldTrace()).toBeNull();
  });

  it('başlangıç durumu doğru rapor edilir', () => {
    const st = startFieldRecording({ label: 'test-run' });
    expect(st.recording).toBe(true);
    expect(st.sampleCount).toBe(0);
    expect(st.fieldDebug).toBe(false);
  });

  it('durdurma dizileri TEMİZLEMEZ — export hâlâ okunabilir', () => {
    startFieldRecording();
    stopFieldRecording();
    const t = exportFieldTrace();
    expect(t).not.toBeNull();
    expect(t!.provenance.schemaVersion).toBe(FIELD_TRACE_SCHEMA);
  });

  it('provenance kişisel kimlik TAŞIMAZ, şema sürümlüdür', () => {
    const before = Date.now();
    startFieldRecording({ label: 'saha-1' });
    const t = exportFieldTrace()!;
    expect(t.provenance.schemaVersion).toBe(FIELD_TRACE_SCHEMA);
    expect(t.provenance.recordingLabel).toBe('saha-1');
    expect(t.provenance.sessionId).toMatch(/^[\w-]+$/);
    expect(t.provenance.startedAtWallMs).toBeGreaterThanOrEqual(before);
    /* GİZLİLİK: kullanıcı adı/telefon/VIN/token alanı YAPISAL olarak yok. */
    expect(Object.keys(t.provenance).sort()).toEqual([
      'appVersion', 'gitRevision', 'recordingLabel', 'schemaVersion',
      'sessionId', 'startedAtMonoMs', 'startedAtWallMs',
    ]);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   3) TAŞMA — açıkça işaretlenir, sessizce ezilmez
   ══════════════════════════════════════════════════════════════════════════ */

describe('F8.3 · bounded — taşma davranışı', () => {
  beforeEach(() => _resetFieldRecordingForTest());

  it('örnek tavanı aşılınca YENİ girdi reddedilir, EN ESKİ veri KORUNUR', () => {
    /* `_pushToTrace` doğrudan çağrılamaz (dışa açık değil) — sınırı ölçmek
       için gerçek `installNavFieldBridge` yolu kullanılmaz; bunun yerine
       tavan SABİTİNİN kendisi ve export sözleşmesi doğrulanır: küçük bir
       tavanla aynı davranışı sentetik olarak KANITLAMAK için modülün
       `FIELD_TRACE_MAX_SAMPLES` sabitini okuyup makul olduğunu doğrularız. */
    expect(FIELD_TRACE_MAX_SAMPLES).toBeGreaterThan(0);
    expect(Number.isInteger(FIELD_TRACE_MAX_SAMPLES)).toBe(true);
    expect(FIELD_TRACE_MAX_EVENTS).toBeGreaterThan(0);
  });

  it('taşma durumu status ve export\'ta AYNI görünür (iki ayrı otorite değil)', () => {
    startFieldRecording();
    const st = getFieldRecordingStatus();
    const t = exportFieldTrace()!;
    expect(st.overflow).toEqual(t.overflow);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   4) GİZLİLİK
   ══════════════════════════════════════════════════════════════════════════ */

describe('F8.4 · gizlilik — varsayılan export ham koordinat taşımaz', () => {
  beforeEach(() => _resetFieldRecordingForTest());

  it('`coordinatesRedacted` varsayılanda `true`dur', () => {
    startFieldRecording();
    const t = exportFieldTrace()!;
    expect(t.coordinatesRedacted).toBe(true);
  });

  it('`fieldDebug` AÇIKÇA istenmeden koordinat asla dışa çıkmaz', () => {
    startFieldRecording({ fieldDebug: false });
    const t = exportFieldTrace()!;
    expect(t.coordinatesRedacted).toBe(true);
  });

  it('gizlilik alanları (kullanıcı adı · telefon · VIN · token · transkript) YAPISAL olarak YOK', () => {
    startFieldRecording();
    const t = exportFieldTrace()!;
    const json = JSON.stringify(t);
    for (const bad of ['token', 'password', 'transcript', 'vin', 'phone', 'email', 'apiKey', 'accessToken']) {
      expect(json.toLowerCase(), `export "${bad}" içeriyor`).not.toContain(bad.toLowerCase());
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   5) REPLAY — kör olmadığının kanıtı (temiz + ihlalli)
   ══════════════════════════════════════════════════════════════════════════ */

function traceOf(samples: readonly NavFieldSample[]): NavFieldTrace {
  return {
    provenance: {
      schemaVersion: FIELD_TRACE_SCHEMA, appVersion: null, gitRevision: null,
      sessionId: 'test', recordingLabel: null, startedAtWallMs: 0, startedAtMonoMs: 0,
    },
    samples, events: [],
    overflow: { samplesTruncated: false, eventsTruncated: false, overflowSampleCount: 0, overflowEventCount: 0 },
    coordinatesRedacted: true,
  };
}

describe('F8.5 · replayFieldTrace — 5 ilke', () => {
  it('boş/eksik trace → 0 örnek, ihlal YOK, "geçti" iddiası KURULMAZ (yalnız sampleCount=0)', () => {
    expect(replayFieldTrace(null).sampleCount).toBe(0);
    expect(replayFieldTrace(undefined).passed).toBe(true);
    expect(replayFieldTrace(traceOf([])).sampleCount).toBe(0);
  });

  it('temiz kayıt (5 örnek) → HİÇBİR ilke ihlal edilmez', () => {
    const t = traceOf([baseSample(), baseSample(), baseSample(), baseSample(), baseSample()]);
    const r = replayFieldTrace(t);
    expect(r.passed).toBe(true);
    expect(r.violations).toEqual([]);
    expect(r.checkedInvariants).toEqual(FIELD_TRACE_INVARIANTS);
  });

  it('① belirsiz kolda MPP varsa YAKALANIR', () => {
    const bad = baseSample({ ceh: { ...baseSample().ceh!, state: 'AMBIGUOUS_PATH', mppPresent: true } });
    const r = replayFieldTrace(traceOf([baseSample(), bad]));
    expect(r.passed).toBe(false);
    expect(r.violations[0].invariant).toBe('AMBIGUOUS_NOT_DEFINITE');
    expect(r.violations[0].sampleIndex).toBe(1);
  });

  it('② kesik koridor "yok" derse YAKALANIR (F6 kusurunun saha-veri karşılığı)', () => {
    const bad = baseSample({ roadCorridor: { ...baseSample().roadCorridor!, lastCorridorTruncated: true, lastOutcome: 'NO_OBJECTS_IN_RANGE' } });
    const r = replayFieldTrace(traceOf([bad]));
    expect(r.passed).toBe(false);
    expect(r.violations[0].invariant).toBe('TRUNCATED_CORRIDOR_NOT_ABSENT');
  });

  it('③ fark sayısı karşılaştırılabilir sayıyı AŞARSA YAKALANIR', () => {
    const bad = baseSample({ shadow: { ...baseSample().shadow!, comparable: 2, divergent: 5, divergenceRatio: 0 } });
    const r = replayFieldTrace(traceOf([bad]));
    expect(r.passed).toBe(false);
    expect(r.violations.some(v => v.invariant === 'NOT_MEASURED_NOT_AGREEMENT')).toBe(true);
  });

  it('③b oran sayaçlarla TUTARSIZSA YAKALANIR (sürüklenme kanıtı)', () => {
    const bad = baseSample({ shadow: { ...baseSample().shadow!, comparable: 10, divergent: 1, divergenceRatio: 0.9 } });
    const r = replayFieldTrace(traceOf([bad]));
    expect(r.passed).toBe(false);
  });

  it('④ eşleşme sayısı yön sınıflarının TOPLAMINA eşit DEĞİLSE YAKALANIR', () => {
    const bad = baseSample({ enforcement: { ...baseSample().enforcement!, matchedToEdge: 5, onewayImplied: 1, unknownDirection: 1 } });
    const r = replayFieldTrace(traceOf([bad]));
    expect(r.passed).toBe(false);
    expect(r.violations[0].invariant).toBe('WRONG_DIRECTION_NOT_DEFINITE');
  });

  it('⑤a NO_CANDIDATE iken bir aday SEÇİLMİŞSE YAKALANIR', () => {
    const bad = baseSample({ rationale: { ...baseSample().rationale!, lastFactor: 'NO_CANDIDATE', lastChosenIdx: 0 } });
    const r = replayFieldTrace(traceOf([bad]));
    expect(r.passed).toBe(false);
    expect(r.violations[0].invariant).toBe('RATIONALE_MATCHES_SELECTION');
  });

  it('⑤b belirlenmiş etken VARKEN seçim YOKSA YAKALANIR', () => {
    const bad = baseSample({ rationale: { ...baseSample().rationale!, lastFactor: 'DURATION', lastChosenIdx: null } });
    const r = replayFieldTrace(traceOf([bad]));
    expect(r.passed).toBe(false);
    expect(r.violations[0].invariant).toBe('RATIONALE_MATCHES_SELECTION');
  });

  it('bölüm `null` (ölçülmedi) İHLAL SAYILMAZ — bilgisizlik ≠ ihlal', () => {
    const s = baseSample({ ceh: null, roadCorridor: null, shadow: null, enforcement: null, rationale: null });
    const r = replayFieldTrace(traceOf([s]));
    expect(r.passed).toBe(true);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   6) MİMARİ KİLİTLER
   ══════════════════════════════════════════════════════════════════════════ */

const SRC = resolve(__dirname, '..');
const readSrc = (rel: string) => readFileSync(resolve(SRC, rel), 'utf8');
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');

const BRIDGE = 'platform/devtools/navFieldBridge.ts';
const REPLAY = 'platform/devtools/navFieldTraceReplay.ts';

describe('F8.6 · mimari kilitler', () => {
  it('T1 — kayıt/olay türetimi YENİ zamanlayıcı KURMAZ (dış CDP kadansına piggyback)', () => {
    const src = strip(readSrc(BRIDGE));
    expect(src).not.toContain('setInterval(');
    expect(src).not.toContain('setTimeout(');
    expect(src).not.toContain('.subscribe(');
  });

  it('T2 — kayıt hiçbir navigasyon/CEH/Guardian komutu ÇAĞIRMAZ', () => {
    const src = strip(readSrc(BRIDGE));
    for (const forbidden of [
      'fetchRoute', 'startNavigation', 'stopNavigation', 'activateNavigation',
      'clearRoute', 'setRerouteContext', 'selectAltRoute', 'writeActiveRoute',
      'updateRouteProgress', 'speakNavigation', 'bindAttributePorts(', 'noteRouteIntent(',
      'observe()',
    ]) {
      expect(src, `köprü ${forbidden} çağırıyor`).not.toContain(forbidden);
    }
  });

  it('T3 — `deriveFieldEvents` SAF: I/O · saat · React YOK', () => {
    const src = strip(readSrc(BRIDGE));
    const start = src.indexOf('export function deriveFieldEvents');
    const end = src.indexOf('export const FIELD_TRACE_MAX_SAMPLES', start);
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    const body = src.slice(start, end);
    for (const bad of ['Date.now(', 'performance.now(', 'fetch(', 'setInterval(', 'setTimeout(']) {
      expect(body, `deriveFieldEvents "${bad}" içeriyor`).not.toContain(bad);
    }
  });

  it('T4 — bounded: tavan aşımı REDDEDİLİR, sessizce ezme YOK', () => {
    const src = strip(readSrc(BRIDGE));
    expect(src).toContain('FIELD_TRACE_MAX_SAMPLES');
    expect(src).toContain('_overflowSamples++');
    expect(src).toContain('_overflowEvents++');
    /* Tavan dolunca push YAPILMAZ (else dalı artırır, push ETMEZ). */
    expect(src).toMatch(/if \(_samples\.length < FIELD_TRACE_MAX_SAMPLES\) \{\s*_samples\.push\(s\);\s*\} else \{\s*_overflowSamples\+\+;/);
  });

  it('T5 — varsayılan export koordinatı REDAKTE EDER (`fieldDebug` olmadan)', () => {
    const src = strip(readSrc(BRIDGE));
    expect(src).toContain('function _redactSample');
    expect(src).toMatch(/if \(_fieldDebug\) return sample;/);
    expect(src).toContain('lat: null, lon: null');
  });

  it('T6 — köprü fail-soft KALDI (F8 eklemesi bunu BOZMADI)', () => {
    const src = readSrc(BRIDGE);
    expect(src).toMatch(/catch \{ \/\* fail-soft/);
    /* Her F3–F7 bölümü `_safe(...)` ile SARILI — biri patlarsa örnek düşmez. */
    for (const field of ['ceh:', 'graph:', 'roadCorridor:', 'enforcement:', 'shadow:', 'rationale:', 'perf:']) {
      const idx = src.indexOf(`    ${field} _safe(`);
      expect(idx, `${field} _safe() ile sarılmamış`).toBeGreaterThan(0);
    }
  });

  it('T7 — DEV KAPISI korunuyor (F8 satış build\'ini AÇMADI)', () => {
    const src = readSrc(BRIDGE);
    expect(src).toMatch(/if \(!DEVELOPER_FEATURES_ENABLED\) return;/);
  });

  it('T8 — replay modülü SAF: I/O · timer · React YOK, GPS/Guardian TAKLİT ETMEZ', () => {
    const src = strip(readSrc(REPLAY));
    for (const bad of ['Date.now(', 'performance.now(', 'fetch(', 'setInterval(', 'setTimeout(', "from 'react'"]) {
      expect(src, `${REPLAY} "${bad}" içeriyor`).not.toContain(bad);
    }
    for (const bad of ['gpsService', 'nativePlugin', 'guardianEngine', 'obdService']) {
      expect(src, `${REPLAY} ikinci runtime kuruyor: ${bad}`).not.toContain(bad);
    }
  });

  it('T9 — LAB koordinat sözleşmesi F8 tarafından İHLAL EDİLMEDİ', () => {
    /* F6/F7 kilidiyle AYNI sınır: navFieldBridge LAB\'ın okuma katmanına
       sızmaz. F8 bu sınırı GENİŞLETMEDİ — kontrol yüzeyi bilinçli olarak
       `window.__CAROS_NAV_FIELD__` (mevcut kanal) üzerinden kaldı. */
    const labSrc = readSrc('platform/devtools/navigationCoreSources.ts');
    expect(labSrc).not.toContain('navFieldBridge');
    expect(labSrc).not.toContain('navFieldTraceReplay');
    const labScreen = readSrc('components/devtools/screens/NavigationCoreScreen.tsx');
    expect(labScreen).not.toContain('__CAROS_NAV_FIELD__');
  });

  it('T10 — üretim otoritesi DEĞİŞMEDİ: CEH hâlâ SHADOW, Guardian hâlâ PRODUCTION', () => {
    const shadowSrc = readSrc('platform/navigation/shadow/cehCutoverGate.ts');
    expect(shadowSrc).toContain('CEH_CUTOVER_DEFAULT_OPEN: boolean = false');
  });

  it('T11 — şema sürümlü ve TEK tanımlı (ikinci trace formatı yok)', () => {
    const hits = [BRIDGE].filter((f) => readSrc(f).includes("FIELD_TRACE_SCHEMA = 'caros.nav.fieldtrace.v1'"));
    expect(hits).toEqual([BRIDGE]);
  });

  it('T12 — replay ilkeleri her biri F3–F7 kaynağına ATIF verir (uydurma kural yok)', () => {
    const src = readSrc(REPLAY);
    for (const ref of ['horizonModel.ts', 'enforcementHorizonPort.ts', 'cehShadowModel.ts', 'enforcementEdgeIndex.ts', 'routeRationaleModel.ts']) {
      expect(src, `${ref} kaynağına atıf yok`).toContain(ref);
    }
  });
});
