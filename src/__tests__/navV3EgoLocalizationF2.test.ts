/**
 * navV3EgoLocalizationF2.test.ts — NAV v3 · F2 · L2 EGO / LOCALIZATION
 * (EKF + HMM) KİLİTLERİ.
 *
 * Belge: `CAROS-NAV-ARCH-SPEC-3.0` §F2.
 *
 * Kapsam:
 *  0) F2.0 monotonik zaman — duvar saati tazelik otoritesi OLAMAZ
 *  1) EKF — tahmin · güncelleme · kapılar · reddedilen ölçüm başarı DEĞİL
 *  2) Mod makinesi — DR 90 sn tavanı + belirsizlik kapısı (erken degrade)
 *  3) HMM — emisyon/geçiş/Viterbi · zorla snap YASAK
 *  4) Aday kaynağı — yalnız L1 sınırı · fail-closed
 *  5) Otorite — tek cephe · kanıt · map-lock koruması
 *  6) Mimari kilitler (12 madde)
 *
 * SAHA: bu testin yeşili F2'yi "tamam" YAPMAZ (kütük #1212–#1219 ·
 * `UNKNOWN / DEVICE VALIDATION REQUIRED`).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

/* gpsService / VDL üretim zincirini teste sokmadan mockla — F2 çekirdeği
   bunlara DEĞİL, port'lara bağlıdır; mock bunu da kanıtlar. */
vi.mock('../platform/gpsService', () => ({
  LOCATION_STALE_MS: 5_000,
  getLocationEvidence: vi.fn(() => ({
    lat: null, lng: null, accuracyM: null, fixAgeMs: null, observedAtWallMs: null,
    source: 'NONE', stale: true, headingDeg: null, speedMs: null,
  })),
}));
vi.mock('../platform/vehicleDataLayer/UnifiedVehicleStore', () => ({
  useUnifiedVehicleStore: { getState: () => ({ speed: null }) },
}));

import { readMonotonicNow, isMonotonicClockAvailable, _resetNavClockProbeForTest }
  from '../platform/navigation/time/navClock';
import {
  recordOfflineGraphOutcome, getOfflineRoutingStatus, _resetOfflineRoutingStatusForTest,
} from '../platform/navigation/offlineRoutingStatus';
import {
  initEgoState, predictEgo, updateEgoPosition, updateEgoSpeed, updateEgoHeading,
  applyZupt, reanchorIfNeeded, egoLatLon, egoSigmaHorizontalM, egoSigmaHeadingRad,
  wrapPi, latLonToEN, enToLatLon,
  GNSS_ACCURACY_REJECT_M, MAHALANOBIS_GATE_2D, TANGENT_REANCHOR_M,
  EGO_N, IDX_PE, IDX_PN, IDX_V,
  type EgoKalmanState,
} from '../platform/navigation/ego/egoKalman';
import {
  decideEgoMode, egoConfidenceFromSigma,
  DR_TOTAL_MAX_MS, GNSS_FRESH_MAX_MS, EGO_SIGMA_DEGRADE_M, EGO_SIGMA_LAST_KNOWN_M,
  type EgoModeInput,
} from '../platform/navigation/ego/egoModeModel';
import {
  emissionLogProb, transitionLogProb, stepHmm, decodeHmm,
  EMPTY_HMM_STATE, DEFAULT_HMM_PARAMS, HMM_MAX_CANDIDATES,
  type RoadCandidate, type HmmObservation,
} from '../platform/navigation/matching/hmmMatchModel';
import {
  productionRoadCandidateSource, UNAVAILABLE_ROAD_CANDIDATE_SOURCE,
  UNKNOWN_NETWORK_DISTANCE, candidateRadiusM, rankCandidates,
  CANDIDATE_RADIUS_MAX_M,
} from '../platform/navigation/matching/roadCandidateSource';
import { createEgoAuthority, EGO_DR_MAX_MS } from '../platform/navigation/ego/egoAuthority';
import { UNAVAILABLE_EGO_SENSOR_PORT, type EgoSensorSample }
  from '../platform/navigation/ego/egoSensorPort';
import { asMonotonic } from '../platform/navigation/contracts/navMonotonicTime';
import { egoModeAllowsGuidance, matchedPoseCarriesRaw, EGO_FIX_MODES }
  from '../platform/navigation/contracts/navEgoPose';
import { toCanonicalEdgeId } from '../platform/navigation/map/store/legacyEdgeIdAdapter';

const SRC = resolve(__dirname, '..');
const readSrc = (rel: string) => readFileSync(resolve(SRC, rel), 'utf8');
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');

const L2_DIRS = [
  'platform/navigation/ego',
  'platform/navigation/matching',
  'platform/navigation/time',
];
function l2Files(): string[] {
  const out: string[] = [];
  for (const d of L2_DIRS) {
    for (const f of readdirSync(resolve(SRC, d))) {
      if (f.endsWith('.ts')) out.push(`${d}/${f}`);
    }
  }
  return out;
}

/* ══════════════════════════════════════════════════════════════════════════
   0) F2.0 — MONOTONİK ZAMAN
   ══════════════════════════════════════════════════════════════════════════ */
describe('F2.0 · monotonik zaman otoritesi', () => {
  beforeEach(() => { _resetNavClockProbeForTest(); _resetOfflineRoutingStatusForTest(); });

  it('navClock monotonik an üretir ve GERİYE GİTMEZ', () => {
    expect(isMonotonicClockAvailable()).toBe(true);
    const a = readMonotonicNow();
    const b = readMonotonicNow();
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(b as number).toBeGreaterThanOrEqual(a as number);
  });

  it('navClock `Date.now` KULLANMAZ (kaynak kilidi)', () => {
    expect(strip(readSrc('platform/navigation/time/navClock.ts'))).not.toContain('Date.now(');
  });

  it('F1/B4 KAPANDI: offlineRoutingStatus monotonik damga taşıyor', () => {
    recordOfflineGraphOutcome('AVAILABLE', 1_700_000_000_000, 12_345);
    const s = getOfflineRoutingStatus();
    expect(s.lastAttemptAt).toBe(1_700_000_000_000);   // duvar saati (gösterim)
    expect(s.lastAttemptAtMonoMs).toBe(12_345);        // monotonik (tazelik)
  });

  it('monotonik damga verilmezse UYDURULMAZ — null kalır (bayatlık hesaplanmaz)', () => {
    recordOfflineGraphOutcome('AVAILABLE', 1_700_000_000_000);
    expect(getOfflineRoutingStatus().lastAttemptAtMonoMs).toBeNull();
    _resetOfflineRoutingStatusForTest();
    recordOfflineGraphOutcome('AVAILABLE', 1, Number.NaN);
    expect(getOfflineRoutingStatus().lastAttemptAtMonoMs).toBeNull();
  });

  it('L2 ağacında duvar saati (`Date.now`) HİÇ kullanılmıyor', () => {
    for (const f of l2Files()) {
      expect(strip(readSrc(f)), `${f}: Date.now()`).not.toContain('Date.now(');
      expect(strip(readSrc(f)), `${f}: new Date()`).not.toContain('new Date(');
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   1) EKF
   ══════════════════════════════════════════════════════════════════════════ */
const T0 = asMonotonic(1_000);

function freshState(over: Partial<Parameters<typeof initEgoState>[0]> = {}): EgoKalmanState {
  const s = initEgoState({
    lat: 36.80, lon: 34.60, accuracyM: 5, headingRad: 0, speedMps: 10, tsMonoMs: T0, ...over,
  });
  expect(s).not.toBeNull();
  return s as EgoKalmanState;
}

describe('F2.1/F2.2 · EKF çekirdeği', () => {
  it('geçersiz koordinat → null (uydurma başlangıç YOK)', () => {
    expect(initEgoState({ lat: NaN, lon: 34, accuracyM: 5, headingRad: 0, speedMps: 0, tsMonoMs: T0 })).toBeNull();
    expect(initEgoState({ lat: 91, lon: 34, accuracyM: 5, headingRad: 0, speedMps: 0, tsMonoMs: T0 })).toBeNull();
    expect(initEgoState({ lat: 36, lon: 181, accuracyM: 5, headingRad: 0, speedMps: 0, tsMonoMs: T0 })).toBeNull();
  });

  it('yön BİLİNMİYORSA başlangıç belirsizliği TAM (sahte kesinlik yok)', () => {
    const known = freshState({ headingRad: 0 });
    const unknown = freshState({ headingRad: null });
    expect(egoSigmaHeadingRad(unknown)).toBeGreaterThan(egoSigmaHeadingRad(known));
    expect(egoSigmaHeadingRad(unknown)).toBeGreaterThan(1.0); // ~π/√3 ≈ 1.81 rad
  });

  it('tahmin aracı YÖN DOĞRULTUSUNDA ilerletir (ψ=0 → kuzey)', () => {
    const s0 = freshState({ headingRad: 0, speedMps: 10 });
    const s1 = predictEgo(s0, 1000, null);
    expect(s1.x[IDX_PN]).toBeCloseTo(10, 3);   // 10 m/s × 1 s kuzeye
    expect(s1.x[IDX_PE]).toBeCloseTo(0, 6);
    /* ψ = 90° → doğu */
    const e0 = freshState({ headingRad: Math.PI / 2, speedMps: 10 });
    const e1 = predictEgo(e0, 1000, null);
    expect(e1.x[IDX_PE]).toBeCloseTo(10, 3);
    expect(e1.x[IDX_PN]).toBeCloseTo(0, 6);
  });

  it('tahmin BELİRSİZLİĞİ BÜYÜTÜR — kovaryans gerçek durumun parçası', () => {
    const s0 = freshState();
    const before = egoSigmaHorizontalM(s0);
    let s = s0;
    for (let i = 0; i < 30; i++) s = predictEgo(s, 1000, null);
    expect(egoSigmaHorizontalM(s)).toBeGreaterThan(before);
    expect(egoSigmaHeadingRad(s)).toBeGreaterThan(egoSigmaHeadingRad(s0));
  });

  it('jiro YOKKEN yön belirsizliği DAHA HIZLI büyür (dürüst bilgisizlik)', () => {
    const s0 = freshState();
    const noGyro = predictEgo(s0, 5000, null);
    const withGyro = predictEgo(s0, 5000, 0);
    expect(egoSigmaHeadingRad(noGyro)).toBeGreaterThan(egoSigmaHeadingRad(withGyro));
  });

  it('geriye/sıfır dt tahmin YAPMAZ', () => {
    const s0 = freshState();
    expect(predictEgo(s0, 0, null)).toBe(s0);
    expect(predictEgo(s0, -100, null)).toBe(s0);
  });

  it('konum güncellemesi belirsizliği KÜÇÜLTÜR ve durumu ölçüme çeker', () => {
    let s = freshState({ accuracyM: 30 });
    s = predictEgo(s, 1000, null);
    const before = egoSigmaHorizontalM(s);
    const r = updateEgoPosition(s, 36.8005, 34.6005, 4);
    expect(r.accepted).toBe(true);
    expect(egoSigmaHorizontalM(r.state)).toBeLessThan(before);
    const ll = egoLatLon(r.state);
    expect(Math.abs(ll.lat - 36.8005)).toBeLessThan(Math.abs(egoLatLon(s).lat - 36.8005));
  });

  it('KAPI 1 — doğruluk tavanı: > 50 m ölçüm REDDEDİLİR, durum DEĞİŞMEZ', () => {
    const s = freshState();
    const r = updateEgoPosition(s, 36.81, 34.61, GNSS_ACCURACY_REJECT_M + 1);
    expect(r.accepted).toBe(false);
    expect(r.rejectReason).toBe('ACCURACY_CEILING');
    expect(r.state).toBe(s);                       // AYNI referans → durum dokunulmadı
  });

  it('KAPI 2 — doğruluk BİLİNMİYORSA ölçüm kabul EDİLMEZ (fail-closed)', () => {
    const s = freshState();
    for (const acc of [null, 0, -5]) {
      const r = updateEgoPosition(s, 36.8001, 34.6001, acc as number | null);
      expect(r.accepted, `acc=${acc}`).toBe(false);
      expect(r.state).toBe(s);
    }
  });

  it('KAPI 3 — Mahalanobis: çöp fix konumu KOPARMAZ', () => {
    let s = freshState({ accuracyM: 3 });
    s = predictEgo(s, 1000, null);
    /* ~2 km uzağa sıçrayan bir fix — d² kapıyı aşmalı. */
    const r = updateEgoPosition(s, 36.82, 34.60, 5);
    expect(r.accepted).toBe(false);
    expect(r.rejectReason).toBe('MAHALANOBIS_GATE');
    expect(r.mahalanobis).toBeGreaterThan(MAHALANOBIS_GATE_2D);
    expect(r.state).toBe(s);
  });

  it('REDDEDİLEN ÖLÇÜM BAŞARI SAYILAMAZ — accepted=false ⇒ durum aynı nesne', () => {
    const s = freshState();
    const rejected = [
      updateEgoPosition(s, NaN, 34.6, 5),
      updateEgoPosition(s, 36.8, 34.6, 999),
      updateEgoSpeed(s, -1, 0.3),
      updateEgoHeading(s, 0, 0.1, 0.5),
    ];
    for (const r of rejected) {
      expect(r.accepted).toBe(false);
      expect(r.state).toBe(s);
    }
  });

  it('ZUPT — bus hızı 0 ve jiro sakin → hız SIFIRA çekilir (hayalet hız ölür)', () => {
    let s = freshState({ speedMps: 12 });
    s = predictEgo(s, 1000, null);
    const z = applyZupt(s, 0, 0);
    expect(z.accepted).toBe(true);
    expect(z.state.x[IDX_V]).toBeLessThan(1);
  });

  it('ZUPT koşulsuz UYGULANMAZ (dönüyorsa / hız 0 değilse)', () => {
    const s = freshState({ speedMps: 12 });
    expect(applyZupt(s, 5, 0).accepted).toBe(false);
    expect(applyZupt(s, 0, 0.5).accepted).toBe(false);   // 0.5 rad/s ≫ 2°/s
    expect(applyZupt(s, null, 0).accepted).toBe(false);
  });

  it('yön ölçümü DURAKTA reddedilir (GNSS yönü orada gürültüdür)', () => {
    const s = freshState({ speedMps: 0 });
    const slow = updateEgoHeading(s, 1.0, 0.2, 0.5);
    expect(slow.accepted).toBe(false);
    expect(slow.rejectReason).toBe('NOT_APPLICABLE');
    const fast = updateEgoHeading(s, 1.0, 0.2, 20);
    expect(fast.accepted).toBe(true);
  });

  it('yeniden çapalama konumu KORUR ve kovaryansı TAŞIR', () => {
    let s = freshState({ headingRad: 0, speedMps: 100 });
    for (let i = 0; i < 200; i++) s = predictEgo(s, 1000, null);   // ~20 km kuzey
    expect(Math.hypot(s.x[IDX_PE], s.x[IDX_PN])).toBeGreaterThan(TANGENT_REANCHOR_M);
    const before = egoLatLon(s);
    const sigmaBefore = egoSigmaHorizontalM(s);
    const re = reanchorIfNeeded(s);
    const after = egoLatLon(re);
    expect(after.lat).toBeCloseTo(before.lat, 6);
    expect(after.lon).toBeCloseTo(before.lon, 6);
    expect(egoSigmaHorizontalM(re)).toBeCloseTo(sigmaBefore, 6);
    expect(Math.hypot(re.x[IDX_PE], re.x[IDX_PN])).toBeLessThan(1e-6);
  });

  it('kovaryans SİMETRİK ve köşegeni pozitif kalır', () => {
    let s = freshState();
    for (let i = 0; i < 20; i++) {
      s = predictEgo(s, 1000, 0.01);
      const r = updateEgoPosition(s, 36.80 + i * 1e-5, 34.60, 6);
      if (r.accepted) s = r.state;
      s = updateEgoSpeed(s, 10, 0.3).state;
    }
    for (let i = 0; i < EGO_N; i++) {
      expect(s.P[i * EGO_N + i], `P[${i}][${i}] pozitif değil`).toBeGreaterThan(0);
      for (let j = i + 1; j < EGO_N; j++) {
        expect(s.P[i * EGO_N + j]).toBeCloseTo(s.P[j * EGO_N + i], 10);
      }
    }
  });

  it('teğet düzlem dönüşümü round-trip yapar', () => {
    const { e, n } = latLonToEN(36.8123, 34.6456, 36.80, 34.60);
    const back = enToLatLon(e, n, 36.80, 34.60);
    expect(back.lat).toBeCloseTo(36.8123, 9);
    expect(back.lon).toBeCloseTo(34.6456, 9);
  });

  it('wrapPi açıyı [-π, π) aralığına sarar', () => {
    expect(wrapPi(0)).toBeCloseTo(0, 12);
    expect(wrapPi(3 * Math.PI)).toBeCloseTo(-Math.PI, 12);
    expect(wrapPi(-3 * Math.PI)).toBeCloseTo(-Math.PI, 12);
    expect(wrapPi(NaN)).toBe(0);
  });

  it('düz sürüş: gerçek yola YAKINSAR (gürültülü fix zinciri)', () => {
    /* 36.80'den kuzeye 10 m/s; her saniye ±8 m gürültülü fix. */
    let s = freshState({ headingRad: 0, speedMps: 10, accuracyM: 8 });
    const mLat = 111_194.9;
    for (let i = 1; i <= 40; i++) {
      s = predictEgo(s, 1000, 0);
      const trueLat = 36.80 + (i * 10) / mLat;
      const noise = ((i * 37) % 17 - 8) / mLat;   // deterministik "gürültü"
      const r = updateEgoPosition(s, trueLat + noise, 34.60, 8);
      if (r.accepted) s = r.state;
      s = updateEgoSpeed(s, 10, 0.3).state;
    }
    const finalLat = egoLatLon(s).lat;
    const expected = 36.80 + (40 * 10) / mLat;
    expect(Math.abs(finalLat - expected) * mLat).toBeLessThan(15);   // < 15 m hata
    expect(egoSigmaHorizontalM(s)).toBeLessThan(GNSS_ACCURACY_REJECT_M);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   2) MOD MAKİNESİ — DR TAVANI + BELİRSİZLİK KAPISI
   ══════════════════════════════════════════════════════════════════════════ */
function modeIn(over: Partial<EgoModeInput> = {}): EgoModeInput {
  return {
    hasEverFixed: true, fixAgeMs: 0, producer: 'GPS',
    hasSpeedSource: true, sigmaHorizontalM: 5, ...over,
  };
}

describe('F2.2 · ego mod makinesi', () => {
  it('DR TAVANI 90 SANİYEYİ AŞAMAZ (spec invaryantı)', () => {
    expect(DR_TOTAL_MAX_MS).toBeLessThanOrEqual(90_000);
    expect(EGO_DR_MAX_MS).toBe(DR_TOTAL_MAX_MS);
  });

  it('fix yoksa NONE', () => {
    expect(decideEgoMode(modeIn({ hasEverFixed: false })).mode).toBe('NONE');
  });

  it('taze fix + GPS üretici → GNSS', () => {
    const v = decideEgoMode(modeIn({ fixAgeMs: GNSS_FRESH_MAX_MS - 1 }));
    expect(v.mode).toBe('GNSS');
    expect(v.guidanceAllowed).toBe(true);
  });

  it('bayat fix ama üretici hâlâ GPS → GNSS_DR', () => {
    const v = decideEgoMode(modeIn({ fixAgeMs: 30_000 }));
    expect(v.mode).toBe('GNSS_DR');
    expect(v.guidanceAllowed).toBe(true);
  });

  it('üretici ölü hesaplama → DR_ONLY (rehberlik KAPALI)', () => {
    const v = decideEgoMode(modeIn({ fixAgeMs: 30_000, producer: 'DEAD_RECKONING' }));
    expect(v.mode).toBe('DR_ONLY');
    expect(v.guidanceAllowed).toBe(false);
  });

  it('90 sn AŞILINCA → LAST_KNOWN (süre tavanı)', () => {
    const ok = decideEgoMode(modeIn({ fixAgeMs: DR_TOTAL_MAX_MS }));
    expect(ok.mode).not.toBe('LAST_KNOWN');
    const over = decideEgoMode(modeIn({ fixAgeMs: DR_TOTAL_MAX_MS + 1 }));
    expect(over.mode).toBe('LAST_KNOWN');
    expect(over.reason).toBe('DR_TIME_CEILING');
    expect(over.degradedByTime).toBe(true);
    expect(over.guidanceAllowed).toBe(false);
  });

  it('BELİRSİZLİK KAPISI 90 sn DOLMADAN degrade eder (erken fail-closed)', () => {
    /* 10 saniyelik fix — süre tavanının çok altında. */
    const healthy = decideEgoMode(modeIn({ fixAgeMs: 10_000, sigmaHorizontalM: 10 }));
    expect(healthy.mode).toBe('GNSS_DR');

    const degraded = decideEgoMode(modeIn({
      fixAgeMs: 10_000, sigmaHorizontalM: EGO_SIGMA_DEGRADE_M + 1,
    }));
    expect(degraded.mode).toBe('DR_ONLY');
    expect(degraded.reason).toBe('SIGMA_DEGRADED');
    expect(degraded.degradedBySigma).toBe(true);
    expect(degraded.degradedByTime).toBe(false);
    expect(degraded.guidanceAllowed).toBe(false);
  });

  it('belirsizlik LAST_KNOWN tavanını aşarsa süre BAKILMADAN düşer', () => {
    const v = decideEgoMode(modeIn({ fixAgeMs: 0, sigmaHorizontalM: EGO_SIGMA_LAST_KNOWN_M + 1 }));
    expect(v.mode).toBe('LAST_KNOWN');
    expect(v.reason).toBe('SIGMA_CEILING');
    expect(v.degradedBySigma).toBe(true);
  });

  it('belirsizlik ÖLÇÜLEMEDİYSE kötümser (LAST_KNOWN) — kanıtsız kesinlik yok', () => {
    expect(decideEgoMode(modeIn({ sigmaHorizontalM: null })).mode).toBe('LAST_KNOWN');
    expect(decideEgoMode(modeIn({ sigmaHorizontalM: Number.POSITIVE_INFINITY })).mode).toBe('LAST_KNOWN');
  });

  it('fix yaşı ölçülemiyorsa tazelik İDDİA EDİLMEZ', () => {
    const v = decideEgoMode(modeIn({ fixAgeMs: null }));
    expect(v.mode).toBe('LAST_KNOWN');
    expect(v.reason).toBe('AGE_UNKNOWN');
  });

  it('bayat fix + hız kaynağı YOK → ilerletilecek bir şey yok', () => {
    const v = decideEgoMode(modeIn({ fixAgeMs: 20_000, hasSpeedSource: false }));
    expect(v.mode).toBe('LAST_KNOWN');
    expect(v.reason).toBe('NO_SPEED_SOURCE');
  });

  it('guidanceAllowed F0 `egoModeAllowsGuidance` ile BİREBİR (ikinci kural yok)', () => {
    for (const m of EGO_FIX_MODES) {
      const cases: EgoModeInput[] = [
        modeIn({ hasEverFixed: false }),
        modeIn({ fixAgeMs: 0 }),
        modeIn({ fixAgeMs: 30_000 }),
        modeIn({ fixAgeMs: 30_000, producer: 'DEAD_RECKONING' }),
        modeIn({ fixAgeMs: DR_TOTAL_MAX_MS + 1 }),
      ];
      for (const c of cases) {
        const v = decideEgoMode(c);
        expect(v.guidanceAllowed, `${v.mode}`).toBe(egoModeAllowsGuidance(v.mode));
      }
      expect(EGO_FIX_MODES).toContain(m);
    }
  });

  it('GÜVEN yalnız σ\'dan gelir — "GPS var → 1" ÜRETİLEMEZ', () => {
    expect(egoConfidenceFromSigma(0)).toBe(1);
    expect(egoConfidenceFromSigma(EGO_SIGMA_DEGRADE_M)).toBeLessThan(0.6);
    expect(egoConfidenceFromSigma(EGO_SIGMA_LAST_KNOWN_M)).toBe(0);
    expect(egoConfidenceFromSigma(1000)).toBe(0);
    expect(egoConfidenceFromSigma(null)).toBe(0);          // kanıt yok → 0
    expect(egoConfidenceFromSigma(Number.NaN)).toBe(0);
    /* σ > 0 iken güven ASLA 1 olamaz. */
    expect(egoConfidenceFromSigma(0.001)).toBeLessThan(1);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   3) HMM
   ══════════════════════════════════════════════════════════════════════════ */
function cand(over: Partial<RoadCandidate> = {}): RoadCandidate {
  return {
    edgeId: toCanonicalEdgeId(1, 0),
    snappedLat: 36.80, snappedLon: 34.60,
    perpDistM: 3, bearingDeg: 90, alongEdgeM: 10,
    metadata: { lengthM: 500, oneway: false, roadClass: 3 },
    ...over,
  };
}
function obsAt(lat: number, lon: number, t: number, heading: number | null = 90): HmmObservation {
  return { lat, lon, headingDeg: heading, tsMonoMs: asMonotonic(t) };
}

describe('F2.3 · HMM emisyon / geçiş', () => {
  it('emisyon dik mesafeyle AZALIR', () => {
    const near = emissionLogProb(cand({ perpDistM: 2 }), obsAt(36.8, 34.6, 0));
    const far = emissionLogProb(cand({ perpDistM: 40 }), obsAt(36.8, 34.6, 0));
    expect(near).toBeGreaterThan(far);
  });

  it('yön uyumsuzluğu CEZALANDIRILIR — ama yalnız İKİSİ DE biliniyorsa', () => {
    const aligned = emissionLogProb(cand({ bearingDeg: 90 }), obsAt(36.8, 34.6, 0, 90));
    const opposed = emissionLogProb(cand({ bearingDeg: 270 }), obsAt(36.8, 34.6, 0, 90));
    expect(aligned).toBeGreaterThan(opposed);
    /* Gözlem yönü bilinmiyorsa ceza YOK (bilgisizlik ceza değildir). */
    const noObsHeading = emissionLogProb(cand({ bearingDeg: 270 }), obsAt(36.8, 34.6, 0, null));
    expect(noObsHeading).toBeCloseTo(emissionLogProb(cand({ bearingDeg: null }), obsAt(36.8, 34.6, 0, 90)), 10);
  });

  it('geçiş: ağ mesafesi BİLİNMİYORSA null (uydurma mesafe YASAK)', () => {
    const t = transitionLogProb(cand(), cand(), obsAt(36.80, 34.60, 0), obsAt(36.801, 34.60, 1000),
      UNKNOWN_NETWORK_DISTANCE);
    expect(t).toBeNull();
  });

  it('geçiş: ağ mesafesi gözlem mesafesine YAKINSA daha olası', () => {
    const p = obsAt(36.800, 34.60, 0);
    const q = obsAt(36.801, 34.60, 1000);   // ~111 m
    const good = transitionLogProb(cand(), cand(), p, q, () => 111);
    const bad = transitionLogProb(cand(), cand(), p, q, () => 900);
    expect(good).not.toBeNull();
    expect(bad).not.toBeNull();
    expect(good as number).toBeGreaterThan(bad as number);
  });
});

describe('F2.3 · Viterbi ve karar', () => {
  it('aday YOKSA katman eklenmez, durum aynen kalır', () => {
    const s = stepHmm(EMPTY_HMM_STATE, obsAt(36.8, 34.6, 0), [], UNKNOWN_NETWORK_DISTANCE);
    expect(s).toBe(EMPTY_HMM_STATE);
    expect(decodeHmm(s).outcome).toBe('NO_CANDIDATES');
    expect(decodeHmm(s).candidate).toBeNull();
  });

  it('aday sayısı 8 ile SINIRLI (v2 §3.4)', () => {
    const many = Array.from({ length: 20 }, (_, i) =>
      cand({ edgeId: toCanonicalEdgeId(i + 1, 0), perpDistM: i + 1 }));
    const s = stepHmm(EMPTY_HMM_STATE, obsAt(36.8, 34.6, 0), many, UNKNOWN_NETWORK_DISTANCE);
    expect(s.layers[0].nodes.length).toBeLessThanOrEqual(HMM_MAX_CANDIDATES);
  });

  it('pencere SINIRLI — sınırsız kuyruk YASAK', () => {
    let s = EMPTY_HMM_STATE;
    for (let i = 0; i < 50; i++) {
      s = stepHmm(s, obsAt(36.8 + i * 1e-4, 34.6, i * 1000), [cand()], UNKNOWN_NETWORK_DISTANCE);
    }
    expect(s.layers.length).toBe(DEFAULT_HMM_PARAMS.windowW);
  });

  it('YAYIN GECİKMESİ: pencere ısınmadan kesin eşleşme ÜRETİLMEZ', () => {
    const s = stepHmm(EMPTY_HMM_STATE, obsAt(36.8, 34.6, 0), [cand()], UNKNOWN_NETWORK_DISTANCE);
    const d = decodeHmm(s);   // 1 katman, lag 2 → henüz yayınlanamaz
    expect(d.outcome).not.toBe('MATCHED');
    expect(d.reason).toBe('WARMING_UP');
    expect(d.candidate).toBeNull();
  });

  it('AYRIŞMA ZAYIFSA → AMBIGUOUS, aday NULL (zorla snap YASAK)', () => {
    /* İki neredeyse özdeş aday: paralel yol / karşı şerit senaryosu. */
    const a = cand({ edgeId: toCanonicalEdgeId(1, 0), perpDistM: 10.0 });
    const b = cand({ edgeId: toCanonicalEdgeId(2, 0), perpDistM: 10.05 });
    let s = EMPTY_HMM_STATE;
    for (let i = 0; i < 5; i++) {
      s = stepHmm(s, obsAt(36.8, 34.6, i * 1000), [a, b], () => 0);
    }
    const d = decodeHmm(s);
    expect(d.outcome).toBe('AMBIGUOUS');
    expect(d.reason).toBe('LOW_SEPARATION');
    expect(d.candidate).toBeNull();
    expect(d.confidence).toBe(0);
  });

  it('METADATA ve TOPOLOJİ kanıtı YOKSA kesin eşleşme ÜRETİLMEZ', () => {
    const bare = cand({ metadata: null });
    let s = EMPTY_HMM_STATE;
    for (let i = 0; i < 5; i++) {
      s = stepHmm(s, obsAt(36.8, 34.6, i * 1000), [bare], UNKNOWN_NETWORK_DISTANCE);
    }
    const d = decodeHmm(s);
    expect(d.outcome).toBe('INSUFFICIENT_METADATA');
    expect(d.candidate).toBeNull();
    expect(d.topologyEvidence).toBe(false);
  });

  it('metadata VARSA ve ayrışma yeterliyse MATCHED — aday yayınlanır', () => {
    const good = cand({ edgeId: toCanonicalEdgeId(7, 0), perpDistM: 2 });
    const bad = cand({ edgeId: toCanonicalEdgeId(8, 0), perpDistM: 45 });
    let s = EMPTY_HMM_STATE;
    for (let i = 0; i < 6; i++) {
      s = stepHmm(s, obsAt(36.8, 34.6, i * 1000), [good, bad], UNKNOWN_NETWORK_DISTANCE);
    }
    const d = decodeHmm(s);
    expect(d.outcome).toBe('MATCHED');
    expect(d.candidate).not.toBeNull();
    expect(d.confidence).toBeGreaterThan(0);
    expect(d.confidence).toBeLessThanOrEqual(1);
  });

  it('YAPISAL: `candidate` YALNIZ MATCHED iken dolu olabilir', () => {
    const states = [
      EMPTY_HMM_STATE,
      stepHmm(EMPTY_HMM_STATE, obsAt(36.8, 34.6, 0), [cand({ metadata: null })], UNKNOWN_NETWORK_DISTANCE),
    ];
    for (const s of states) {
      const d = decodeHmm(s);
      if (d.outcome !== 'MATCHED') expect(d.candidate).toBeNull();
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   4) ADAY KAYNAĞI — L1 SINIRI
   ══════════════════════════════════════════════════════════════════════════ */
describe('F2.3 · aday kaynağı yalnız L1 sınırından', () => {
  it('arama yarıçapı v2 §3.4 formülüyle: min(200, 3σ+25)', () => {
    expect(candidateRadiusM(0)).toBe(25);
    expect(candidateRadiusM(10)).toBe(55);
    expect(candidateRadiusM(1000)).toBe(CANDIDATE_RADIUS_MAX_M);
    /* σ ölçülemezse en geniş yarıçap (kötümser). */
    expect(candidateRadiusM(null)).toBe(CANDIDATE_RADIUS_MAX_M);
  });

  it('üretim kaynağı bugün aday ÜRETEMEZ ve bunu DÜRÜSTÇE söyler (F1/B2)', () => {
    const r = productionRoadCandidateSource.query(36.8, 34.6, 100, asMonotonic(1000));
    expect(r.candidates).toEqual([]);
    expect(['NOT_MEASURED', 'SOURCE_UNAVAILABLE', 'SOURCE_INVALID']).toContain(r.outcome);
    expect(r.networkDistance(cand(), cand())).toBeNull();
  });

  it('geçersiz sorgu → fail-closed, aday YOK', () => {
    const r = productionRoadCandidateSource.query(NaN, 34.6, 100, asMonotonic(1));
    expect(r.outcome).toBe('SOURCE_UNAVAILABLE');
    expect(r.candidates).toEqual([]);
  });

  it('varsayılan kaynak hiçbir şey bilmez (ölçülmedi ≠ yok)', () => {
    const r = UNAVAILABLE_ROAD_CANDIDATE_SOURCE.query(36.8, 34.6, 50, asMonotonic(1));
    expect(r.outcome).toBe('NOT_MEASURED');
    expect(r.candidates).toEqual([]);
  });

  it('rankCandidates dik mesafeye göre sıralar ve 8\'e kırpar', () => {
    const list = Array.from({ length: 15 }, (_, i) =>
      cand({ edgeId: toCanonicalEdgeId(i + 1, 0), perpDistM: 15 - i }));
    const r = rankCandidates(list);
    expect(r.length).toBe(HMM_MAX_CANDIDATES);
    for (let i = 1; i < r.length; i++) expect(r[i].perpDistM).toBeGreaterThanOrEqual(r[i - 1].perpDistM);
    expect(rankCandidates([])).toEqual([]);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   5) OTORİTE
   ══════════════════════════════════════════════════════════════════════════ */
function sample(over: Partial<EgoSensorSample> = {}): EgoSensorSample {
  return {
    nowMonoMs: asMonotonic(10_000),
    lat: 36.80, lon: 34.60, accuracyM: 5, fixAgeMs: 0,
    producer: 'GPS', hasEverFixed: true,
    gnssHeadingDeg: 0, gnssSpeedMps: 10, busSpeedMps: 10, yawRateRadPerSec: null,
    ...over,
  };
}

describe('F2.5 · egoAuthority tek cephesi', () => {
  it('MONOTONİK SAAT YOKSA hiçbir poz YAYINLANMAZ (fail-closed)', () => {
    const a = createEgoAuthority({
      sensor: { read: () => sample({ nowMonoMs: null }) },
      candidates: UNAVAILABLE_ROAD_CANDIDATE_SOURCE,
    });
    a.observe();
    expect(a.getRealtimeEgoPose()).toBeNull();
    expect(a.getMatchedRoadPose()).toBeNull();
    expect(a.getDiagnostics().monotonicClock).toBe(false);
  });

  it('tamamen boş port kümesi → poz YOK, mod NONE', () => {
    const a = createEgoAuthority({
      sensor: UNAVAILABLE_EGO_SENSOR_PORT, candidates: UNAVAILABLE_ROAD_CANDIDATE_SOURCE,
    });
    a.observe();
    expect(a.getRealtimeEgoPose()).toBeNull();
    expect(a.getDiagnostics().mode).toBe('NONE');
  });

  it('sensör PATLARSA otorite çökmez (fail-soft) ve poz üretmez', () => {
    const a = createEgoAuthority({
      sensor: { read: () => { throw new Error('boom'); } },
      candidates: UNAVAILABLE_ROAD_CANDIDATE_SOURCE,
    });
    expect(() => a.observe()).not.toThrow();
    expect(a.getRealtimeEgoPose()).toBeNull();
  });

  it('geçerli fix zinciri → kanıtlı RealtimeEgoPose', () => {
    let t = 10_000;
    let lat = 36.80;
    const a = createEgoAuthority({
      sensor: { read: () => sample({ nowMonoMs: asMonotonic(t), lat }) },
      candidates: UNAVAILABLE_ROAD_CANDIDATE_SOURCE,
    });
    for (let i = 0; i < 5; i++) { a.observe(); t += 1000; lat += 1e-4; }

    const p = a.getRealtimeEgoPose();
    expect(p).not.toBeNull();
    expect(p!.kind).toBe('REALTIME_EGO');
    expect(p!.mode).toBe('GNSS');
    /* Konum bir FÜZYON çıktısıdır → DERIVED (ham ölçüm değil). */
    expect(p!.lat.grade).toBe('DERIVED');
    expect(p!.lat.source).toBe('GNSS');
    expect(p!.lat.value).not.toBeNull();
    /* Güven ASLA kanıtsız 1 olamaz. */
    expect(p!.lat.confidence).toBeGreaterThan(0);
    expect(p!.lat.confidence).toBeLessThan(1);
    /* Hız araç bus'ından geliyorsa kaynak VEHICLE_BUS. */
    expect(p!.speedMps.source).toBe('VEHICLE_BUS');
    expect(p!.horizontalSigmaM).not.toBeNull();
  });

  it('REDDEDİLEN ölçüm sayılır ama duruma İŞLENMEZ', () => {
    let t = 10_000;
    const a = createEgoAuthority({
      sensor: {
        read: () => sample({
          nowMonoMs: asMonotonic(t),
          accuracyM: t > 12_000 ? 400 : 5,      // 3. örnekten sonra çöp doğruluk
          lat: t > 12_000 ? 37.5 : 36.80,
        }),
      },
      candidates: UNAVAILABLE_ROAD_CANDIDATE_SOURCE,
    });
    for (let i = 0; i < 6; i++) { a.observe(); t += 1000; }
    const d = a.getDiagnostics();
    expect(d.positionUpdatesRejected).toBeGreaterThan(0);
    expect(d.lastRejectReason).toBe('ACCURACY_CEILING');
    /* Konum 37.5'e KAÇMAMIŞ olmalı (çöp fix işlenmedi). */
    expect(a.getRealtimeEgoPose()!.lat.value!).toBeLessThan(36.9);
  });

  it('DR 90 sn AŞILINCA mod LAST_KNOWN ve rehberlik KAPALI', () => {
    const a = createEgoAuthority({
      sensor: { read: () => sample({ fixAgeMs: DR_TOTAL_MAX_MS + 5_000, producer: 'DEAD_RECKONING' }) },
      candidates: UNAVAILABLE_ROAD_CANDIDATE_SOURCE,
    });
    a.observe();
    const d = a.getDiagnostics();
    expect(d.mode).toBe('LAST_KNOWN');
    expect(d.guidanceAllowed).toBe(false);
    expect(d.degradedByTime).toBe(true);
  });

  it('MatchedRoadPose ham pozu DAİMA taşır (map-lock koruması)', () => {
    const a = createEgoAuthority({
      sensor: { read: () => sample() },
      candidates: UNAVAILABLE_ROAD_CANDIDATE_SOURCE,
    });
    a.observe();
    const m = a.getMatchedRoadPose();
    expect(m).not.toBeNull();
    expect(matchedPoseCarriesRaw(m)).toBe(true);
    expect(m!.rawPose.kind).toBe('REALTIME_EGO');
  });

  it('ADAY YOKKEN edgeId NULL ve durum UNAVAILABLE — zorla snap YOK', () => {
    const a = createEgoAuthority({
      sensor: { read: () => sample() },
      candidates: UNAVAILABLE_ROAD_CANDIDATE_SOURCE,
    });
    a.observe();
    const m = a.getMatchedRoadPose()!;
    expect(m.matchState).toBe('UNAVAILABLE');
    expect(m.edgeId).toBeNull();
    expect(m.snappedLat.grade).toBe('UNAVAILABLE');
    expect(m.alongEdgeM.value).toBeNull();
  });

  it('kaynak SAĞLAM ama kapsam yoksa OFF_NETWORK (bilmiyorum ≠ yol dışısın)', () => {
    const a = createEgoAuthority({
      sensor: { read: () => sample() },
      candidates: {
        query: () => ({
          outcome: 'NO_COVERAGE' as const, candidates: [],
          reason: 'COVERAGE_NONE' as const, networkDistance: UNKNOWN_NETWORK_DISTANCE,
        }),
      },
    });
    a.observe();
    expect(a.getMatchedRoadPose()!.matchState).toBe('OFF_NETWORK');
  });

  it('gerçek aday akışıyla MATCHED üretir ve kanonik EdgeId yayınlar', () => {
    let t = 10_000;
    const good = cand({ edgeId: toCanonicalEdgeId(42, 0), perpDistM: 2 });
    const far = cand({ edgeId: toCanonicalEdgeId(43, 0), perpDistM: 50 });
    const a = createEgoAuthority({
      sensor: { read: () => sample({ nowMonoMs: asMonotonic(t) }) },
      candidates: {
        query: () => ({
          outcome: 'CANDIDATES' as const, candidates: [good, far],
          reason: 'LIVE_SOURCE' as const, networkDistance: UNKNOWN_NETWORK_DISTANCE,
        }),
      },
    });
    for (let i = 0; i < 6; i++) { a.observe(); t += 1000; }
    const m = a.getMatchedRoadPose()!;
    expect(m.matchState).toBe('MATCHED');
    expect(m.edgeId).not.toBeNull();
    expect(m.edgeId).toEqual(good.edgeId);
    expect(m.snappedLat.grade).toBe('DERIVED');
    expect(m.snappedLat.source).toBe('MAP_MATCH');
    expect(m.lateralOffsetM).toBe(2);
    expect(matchedPoseCarriesRaw(m)).toBe(true);
  });

  it('reset durumu tamamen temizler', () => {
    const a = createEgoAuthority({
      sensor: { read: () => sample() }, candidates: UNAVAILABLE_ROAD_CANDIDATE_SOURCE,
    });
    a.observe();
    expect(a.getRealtimeEgoPose()).not.toBeNull();
    a.reset();
    expect(a.getRealtimeEgoPose()).toBeNull();
    expect(a.getDiagnostics().observations).toBe(0);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   6) MİMARİ KİLİTLER
   ══════════════════════════════════════════════════════════════════════════ */
describe('F2 · mimari kilitler', () => {
  it('K1 — L2 ham HARİTA kaynaklarını import EDEMEZ (yalnız L1 MapStore)', () => {
    const forbidden = [
      'routing-graph', 'NavigationCompute.worker', 'mapSourceManager', 'mapSourceStore',
      'mapTileProbe', 'offlineTileDownloader', 'overpass', 'maplibre-gl',
      'offlineRoutingService', 'CacheLRUManager', 'serviceWorkerManager',
    ];
    for (const f of l2Files()) {
      const src = strip(readSrc(f));
      for (const bad of forbidden) {
        expect(src, `${f}: yasak harita kaynağı "${bad}"`).not.toContain(bad);
      }
    }
  });

  it('K2 — L2 ham GPS/native sağlayıcı SAHİPLENEMEZ (port üzerinden tüketir)', () => {
    const forbidden = [
      'navigator.geolocation', 'watchPosition', 'getCurrentPosition',
      '@capacitor', 'Capacitor', 'deviceorientation', 'devicemotion',
      'addEventListener', 'subscribeMotion', 'subscribeOrientation',
      'startGPSTracking', 'onGPSLocation', 'onGPSFixArrival',
    ];
    for (const f of l2Files()) {
      const src = strip(readSrc(f));
      for (const bad of forbidden) {
        expect(src, `${f}: ham sağlayıcı "${bad}"`).not.toContain(bad);
      }
    }
  });

  it('K3 — EKF/HMM saf çekirdekleri timer/I/O/React/native İÇEREMEZ', () => {
    for (const f of [
      'platform/navigation/ego/egoKalman.ts',
      'platform/navigation/ego/egoModeModel.ts',
      'platform/navigation/matching/hmmMatchModel.ts',
    ]) {
      const src = strip(readSrc(f));
      for (const bad of [
        'setInterval(', 'setTimeout(', 'requestAnimationFrame(', 'scheduleTask',
        'fetch(', 'node:fs', '.subscribe(', 'Date.now(', 'performance.now(',
      ]) {
        expect(src, `${f}: ${bad}`).not.toContain(bad);
      }
      expect(src, `${f}: React`).not.toMatch(/from ['"]react['"]/);
      /* Saf çekirdek yalnız göreli sözleşme/komşu import eder. */
      const imports = [...readSrc(f).matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);
      for (const imp of imports) {
        expect(imp.startsWith('.'), `${f}: paket dışı import ${imp}`).toBe(true);
      }
    }
  });

  it('K4 — L2 ağacında hiçbir dosya timer/scheduler SAHİBİ değil', () => {
    for (const f of l2Files()) {
      const src = strip(readSrc(f));
      for (const bad of ['setInterval(', 'setTimeout(', 'requestAnimationFrame(', 'scheduleTask', 'new Worker']) {
        expect(src, `${f}: ${bad}`).not.toContain(bad);
      }
      expect(src, `${f}: React`).not.toMatch(/from ['"]react['"]/);
    }
  });

  it('K5 — kanonik localization cephesi TEK tanımlı', () => {
    const files = l2Files();
    for (const decl of [
      'export function createEgoAuthority',
      'export interface EgoAuthority',
      'export function getEgoAuthority',
      'export interface EgoSensorPort',
      'export interface RoadCandidateSource',
    ]) {
      const hits = files.filter((f) => readSrc(f).includes(decl));
      expect(hits.length, `${decl} → ${hits.join(', ')}`).toBe(1);
    }
  });

  it('K6 — RealtimeEgoPose / MatchedRoadPose src genelinde YENİDEN TANIMLANAMAZ', () => {
    const counts: Record<string, string[]> = {
      'export interface RealtimeEgoPose': [],
      'export interface MatchedRoadPose': [],
      'export interface EdgeId {': [],
      'export type EvidenceGrade': [],
      'export interface Evidenced<': [],
    };
    const walk = (rel: string): void => {
      for (const e of readdirSync(resolve(SRC, rel), { withFileTypes: true })) {
        const p = `${rel}/${e.name}`;
        if (e.isDirectory()) { if (e.name !== '__tests__') walk(p); continue; }
        if (!/\.tsx?$/.test(e.name)) continue;
        const s = readFileSync(resolve(SRC, p), 'utf8');
        for (const d of Object.keys(counts)) if (s.includes(d)) counts[d].push(p);
      }
    };
    walk('.');
    for (const [decl, files] of Object.entries(counts)) {
      expect(files.length, `${decl} → ${files.join(', ')}`).toBe(1);
    }
  });

  it('K7 — DR süre tavanı 90 sn\'yi AŞAMAZ (kaynak + çalışma zamanı)', () => {
    expect(DR_TOTAL_MAX_MS).toBeLessThanOrEqual(90_000);
    const src = readSrc('platform/navigation/ego/egoModeModel.ts');
    const m = /DR_TOTAL_MAX_MS\s*=\s*([0-9_]+)/.exec(src);
    expect(m).not.toBeNull();
    expect(Number((m as RegExpExecArray)[1].replace(/_/g, ''))).toBeLessThanOrEqual(90_000);
  });

  it('K8 — HMM aday YOKLUĞUNU başarılı eşleşme olarak SUNAMAZ', () => {
    for (const s of [EMPTY_HMM_STATE, { layers: [] }]) {
      const d = decodeHmm(s);
      expect(d.outcome).not.toBe('MATCHED');
      expect(d.candidate).toBeNull();
      expect(d.confidence).toBe(0);
    }
  });

  it('K9 — bozuk/ölçülmemiş harita kanıtı KESİN yol eşleşmesine dönüşemez', () => {
    for (const outcome of ['NOT_MEASURED', 'SOURCE_UNAVAILABLE', 'SOURCE_INVALID'] as const) {
      const a = createEgoAuthority({
        sensor: { read: () => sample() },
        candidates: {
          query: () => ({
            outcome, candidates: [], reason: 'NO_SOURCE' as const,
            networkDistance: UNKNOWN_NETWORK_DISTANCE,
          }),
        },
      });
      a.observe();
      const m = a.getMatchedRoadPose()!;
      expect(m.matchState, outcome).toBe('UNAVAILABLE');
      expect(m.edgeId).toBeNull();
    }
  });

  it('K10 — L4–L6 ham kaynak bağımlılığı BÜYÜMEDİ', () => {
    const L4_L6 = [
      'platform/routingService.ts',
      'platform/navigationService.ts',
      'platform/navigation/voiceGuidanceRuntime.ts',
    ];
    const raw = [
      'gpsService', 'mapService', 'mapSourceManager', 'mapSourceStore',
      'mapTileProbe', 'offlineTileDownloader', 'speedLimitService',
      'geo/overpassCategorySearch', 'offlineDataService',
    ];
    for (const rel of L4_L6) {
      const imports = [...readSrc(rel).matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);
      for (const imp of imports) {
        const base = imp.split('/').pop() ?? imp;
        for (const bad of raw) {
          expect(base === bad || imp.endsWith(`/${bad}`), `${rel}: "${imp}"`).toBe(false);
        }
      }
    }
  });

  it('K11 — okuma katmanı hiçbir sağlayıcıyı BAŞLATMAZ/DURDURMAZ', () => {
    const src = strip(readSrc('platform/navigation/ego/egoSources.ts'));
    for (const bad of [
      'startGPSTracking', 'stopGPSTracking', 'applyGpsPowerMode',
      'setGPSTestOverride', 'feedBackgroundLocation', 'startDeadReckoningGuard',
      'setState(',
    ]) {
      expect(src, `okuma katmanı ${bad} çağırıyor`).not.toContain(bad);
    }
    /* MEVCUT otoriteyi okuduğu KANITLANIR (kör guard değil). */
    expect(readSrc('platform/navigation/ego/egoSources.ts')).toContain('getLocationEvidence');
  });

  it('K12 — mevcut rota-göreli eşleştirici DEĞİŞTİRİLMEDİ (ikinci otorite yok)', () => {
    /* `mapMatchModel` L4 ilerleme zincirinin sahibi olarak KALIR; F2 onu
       ne siler ne sarar. Tek `matchToRoute` üreticisi ve tek tüketici zinciri. */
    const mm = readSrc('platform/navigation/core/mapMatchModel.ts');
    expect(mm).toContain('export function matchToRoute');
    for (const f of l2Files()) {
      expect(strip(readSrc(f)), `${f}: matchToRoute'a dokunuyor`).not.toContain('matchToRoute');
    }
  });
});
