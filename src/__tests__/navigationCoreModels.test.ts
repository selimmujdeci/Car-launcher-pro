/**
 * navigationCoreModels.test.ts — NAV-CORE-P0 saf çekirdek kilitleri.
 *
 * Kapsam (görev §12 A·B·D·E):
 *   A. Map matching   — doğru segment · paralel yol · ters yön · düşük doğruluk
 *                       · bayat fix · süreklilik · ani sıçrama · bilinmiyor
 *   B. Off-route      — tek kötü fix · doğrulanmış sapma · tünel · yavaş/hızlı
 *                       araç · rotaya dönüş
 *   D. Route validation — geçerli · geçersiz geometri · hedeften sapmış ·
 *                       ters başlangıç · gereksiz U dönüşü · bayat istek
 *   E. Maneuver       — yol-boyu mesafe · geçilen manevra · çapa çözünürlüğü
 *
 * Modeller SAFtır: gerçek zaman OKUNMAZ, `nowMs`/`tsMs` testten verilir.
 */
import { describe, it, expect } from 'vitest';

import {
  matchToRoute, MATCH_STALE_MS, CORRIDOR_BASE_M,
  type MapMatchSample, type MapMatchFix,
} from '../platform/navigation/core/mapMatchModel';
import {
  initialOffRoute, stepOffRoute, markRerouting, markRouteCommitted,
  requiredEvidenceFor, requiredEvidenceMsFor,
  type OffRouteMachine, type OffRouteEvidence,
} from '../platform/navigation/core/offRouteModel';
import {
  validateRoute, pickBestRoute,
  type RouteCandidate, type ValidationStep,
} from '../platform/navigation/core/routeValidationModel';
import {
  buildManeuverAnchors, alongRouteDistanceToManeuver, hasPassedManeuverAlongRoute,
} from '../platform/navigation/core/maneuverIndexModel';
import { buildCumulativeDistances, hav } from '../platform/navigation/core/geo';

/* ── Sabit test sahası ──────────────────────────────────────────────────────
 * Doğu-batı düz rota, lat 36.80, lon 34.60 → 34.64, 0.01° adımlarla.
 * Bu enlemde 0.01° boylam ≈ 891 m; 0.001° enlem ≈ 111 m. */
const ROUTE: [number, number][] = [
  [34.60, 36.80], [34.61, 36.80], [34.62, 36.80], [34.63, 36.80], [34.64, 36.80],
];
const CUM = buildCumulativeDistances(ROUTE);
const EAST = 90;   // rotanın gidiş yönü
const WEST = 270;

function sample(over: Partial<MapMatchSample> = {}): MapMatchSample {
  return {
    lat: 36.80, lon: 34.615, accuracyM: 6, headingDeg: EAST,
    speedKmh: 50, tsMs: 10_000, ...over,
  };
}

/* ══════════════════════════════════════════════════════════════════════════
   A. MAP MATCHING
   ══════════════════════════════════════════════════════════════════════════ */
describe('A. Map matching', () => {
  it('doğru segmente eşleşir ve rotaya oturtulmuş konum üretir', () => {
    const fix = matchToRoute(sample(), ROUTE, CUM, null, 10_000);
    expect(fix.state).toBe('MATCHED');
    expect(fix.segIdx).toBe(1);                       // 34.61 → 34.62
    expect(fix.snappedLat).toBeCloseTo(36.80, 4);
    expect(fix.snappedLon).toBeCloseTo(34.615, 4);
    expect(fix.lateralM!).toBeLessThan(5);
    expect(fix.confidence).toBeGreaterThan(0.5);
  });

  it('HAM GPS KAYBOLMAZ — eşleşme olsa bile ayrı taşınır', () => {
    const fix = matchToRoute(sample({ lat: 36.8001 }), ROUTE, CUM, null, 10_000);
    expect(fix.rawLat).toBe(36.8001);
    expect(fix.rawLon).toBe(34.615);
    // Oturtulmuş konum ham konumdan FARKLI olmalı (yoksa oturtma yapılmamış demektir)
    expect(fix.snappedLat).not.toBe(fix.rawLat);
  });

  it('TERS YÖN: aynı asfaltta karşı şeritte MATCHED VERİLMEZ', () => {
    const fix = matchToRoute(sample({ headingDeg: WEST }), ROUTE, CUM, null, 10_000);
    expect(fix.state).toBe('MATCH_UNCERTAIN');
    expect(fix.reasons).toContain('HEADING_MISMATCH');
    expect(fix.headingDeltaDeg).toBeCloseTo(180, 0);
    // Belirsiz eşleşme ASLA yüksek güven taşımaz
    expect(fix.confidence).toBeLessThanOrEqual(0.40);
  });

  it('PARALEL YOL: koridor içindeki yan yol ters yönde ise ayrıştırılır', () => {
    // Rotanın 25 m kuzeyinde, ters yönde giden araç (bölünmüş bulvar karşı şeridi)
    const fix = matchToRoute(
      sample({ lat: 36.80022, headingDeg: WEST }), ROUTE, CUM, null, 10_000);
    expect(fix.lateralM!).toBeGreaterThan(15);
    expect(fix.lateralM!).toBeLessThan(CORRIDOR_BASE_M);  // koridor İÇİNDE
    expect(fix.state).not.toBe('MATCHED');                // ama yön TUTMUYOR
    expect(fix.reasons).toContain('HEADING_MISMATCH');
  });

  it('DÜŞÜK DOĞRULUK: kesin eşleşme İDDİA EDİLMEZ', () => {
    const fix = matchToRoute(sample({ accuracyM: 60 }), ROUTE, CUM, null, 10_000);
    expect(fix.state).toBe('MATCH_UNCERTAIN');
    expect(fix.reasons).toContain('LOW_ACCURACY');
  });

  it('DOĞRULUK BİLİNMİYOR: kötümser davranılır', () => {
    const fix = matchToRoute(sample({ accuracyM: null }), ROUTE, CUM, null, 10_000);
    expect(fix.state).toBe('MATCH_UNCERTAIN');
    expect(fix.reasons).toContain('LOW_ACCURACY');
  });

  it('BAYAT FIX: konum kararı verilmez', () => {
    const fix = matchToRoute(sample({ tsMs: 0 }), ROUTE, CUM, null, MATCH_STALE_MS + 1);
    expect(fix.state).toBe('STALE');
    expect(fix.segIdx).toBe(-1);
    expect(fix.snappedLat).toBeNull();
    expect(fix.reasons).toContain('STALE_FIX');
  });

  it('DURAKTA YÖN GÜRÜLTÜDÜR: hız düşükken yön kanıt sayılmaz', () => {
    const fix = matchToRoute(sample({ speedKmh: 2 }), ROUTE, CUM, null, 10_000);
    expect(fix.reasons).toContain('HEADING_UNKNOWN');
    expect(fix.headingDeltaDeg).toBeNull();
    expect(fix.state).toBe('MATCH_UNCERTAIN');
  });

  it('KORİDOR DIŞI: araç rotadan çok uzaksa OFF_NETWORK (UNKNOWN DEĞİL)', () => {
    // 0.005° enlem ≈ 555 m kuzey — koridorun 3 katının da ötesinde
    const fix = matchToRoute(sample({ lat: 36.805 }), ROUTE, CUM, null, 10_000);
    expect(fix.state).toBe('OFF_NETWORK');
    expect(fix.lateralM!).toBeGreaterThan(400);
    expect(fix.reasons).toContain('OFF_CORRIDOR');
    // Fail-closed: koridor dışında oturtulmuş konum ÜRETİLMEZ
    expect(fix.snappedLat).toBeNull();
    expect(fix.confidence).toBe(0);
  });

  it('SÜREKLİLİK: ardışık makul fix\'lerde ilerleme monoton azalır', () => {
    let prev: MapMatchFix | null = null;
    const alongs: number[] = [];
    /* Adım başına ~445 m; 50 km/h'de bu 32 saniyedir. Zaman damgaları
       FİZİKSEL olarak tutarlı olmalı — aksi hâlde model haklı olarak
       "imkânsız sıçrama" der (bkz. bir sonraki test). */
    for (let i = 0; i < 4; i++) {
      const lon = 34.605 + i * 0.005;
      const t = 10_000 + i * 32_000;
      const s = sample({ lon, tsMs: t });
      prev = matchToRoute(s, ROUTE, CUM, prev, t);
      expect(prev.state).toBe('MATCHED');
      alongs.push(prev.alongRemainingM!);
    }
    for (let i = 1; i < alongs.length; i++) {
      expect(alongs[i]).toBeLessThan(alongs[i - 1]);
    }
  });

  it('ANİ SIÇRAMA: fiziksel olarak imkânsız ilerlemede kesin eşleşme YOK', () => {
    const first = matchToRoute(
      sample({ lon: 34.601, tsMs: 10_000, speedKmh: 10 }), ROUTE, CUM, null, 10_000);
    expect(first.state).toBe('MATCHED');
    // 1 saniyede ~2.6 km ileri — 10 km/h'de imkânsız
    const jumped = matchToRoute(
      sample({ lon: 34.631, tsMs: 11_000, speedKmh: 10 }), ROUTE, CUM, first, 11_000);
    expect(jumped.reasons).toContain('JUMP_REJECTED');
    expect(jumped.state).toBe('MATCH_UNCERTAIN');
  });

  it('BİLİNMİYOR: rota geometrisi yoksa UNKNOWN', () => {
    expect(matchToRoute(sample(), null, null, null, 10_000).state).toBe('UNKNOWN');
    expect(matchToRoute(sample(), [], null, null, 10_000).reasons).toContain('NO_GEOMETRY');
  });

  it('GEÇERSİZ GİRDİ: NaN koordinat eşleştirilmez', () => {
    const fix = matchToRoute(sample({ lat: NaN }), ROUTE, CUM, null, 10_000);
    expect(fix.state).toBe('UNKNOWN');
    expect(fix.reasons).toContain('BAD_INPUT');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   B. OFF-ROUTE DURUM MAKİNESİ
   ══════════════════════════════════════════════════════════════════════════ */
const CORRIDOR = 60;

function ev(over: Partial<OffRouteEvidence> = {}): OffRouteEvidence {
  return {
    matchState: 'OFF_NETWORK', lateralM: 300, headingDeltaDeg: null,
    progressM: null, accuracyM: 8, speedKmh: 50, tsMs: 0, ...over,
  };
}

function feed(m: OffRouteMachine, samples: OffRouteEvidence[]): OffRouteMachine {
  let cur = m;
  for (const s of samples) cur = stepOffRoute(cur, s, CORRIDOR);
  return cur;
}

describe('B. Off-route algılama', () => {
  it('TEK kötü fix ASLA sapma doğrulamaz', () => {
    const m = stepOffRoute(initialOffRoute(), ev({ tsMs: 1_000 }), CORRIDOR);
    expect(m.state).toBe('SUSPECTED_OFF_ROUTE');
    expect(m.confirmedAtMs).toBeNull();
  });

  it('tek gürültü örneğinden sonra rotaya dönülürse sapma SAYILMAZ', () => {
    let m = stepOffRoute(initialOffRoute(), ev({ tsMs: 1_000 }), CORRIDOR);
    m = stepOffRoute(m, ev({ matchState: 'MATCHED', lateralM: 4, tsMs: 2_000 }), CORRIDOR);
    expect(m.state).toBe('ON_ROUTE');
    expect(m.evidenceCount).toBe(0);
  });

  it('ardışık DOĞRULANMIŞ sapma CONFIRMED üretir ve T0 damgalar', () => {
    const m = feed(initialOffRoute(), [
      ev({ tsMs: 1_000 }), ev({ tsMs: 2_000 }), ev({ tsMs: 3_000 }),
    ]);
    expect(m.state).toBe('CONFIRMED_OFF_ROUTE');
    expect(m.confirmedAtMs).toBe(3_000);
  });

  it('T0 sonraki örneklerde KAYMAZ (gecikme ölçümü bozulmaz)', () => {
    let m = feed(initialOffRoute(), [ev({ tsMs: 1_000 }), ev({ tsMs: 2_000 }), ev({ tsMs: 3_000 })]);
    m = stepOffRoute(m, ev({ tsMs: 4_000 }), CORRIDOR);
    expect(m.confirmedAtMs).toBe(3_000);
  });

  it('TÜNEL / GPS KAYBI sapma DEĞİLDİR — karar verilmez', () => {
    let m = feed(initialOffRoute(), [ev({ tsMs: 1_000 }), ev({ tsMs: 2_000 })]);
    expect(m.state).toBe('SUSPECTED_OFF_ROUTE');
    m = stepOffRoute(m, ev({ matchState: 'STALE', tsMs: 3_000 }), CORRIDOR);
    expect(m.state).not.toBe('CONFIRMED_OFF_ROUTE');
    expect(m.evidenceCount).toBe(0);
    expect(m.reasons).toContain('HELD_NO_DECISION');
  });

  it('GPS BİLİNMİYORSA sapma kararı verilmez', () => {
    const m = feed(initialOffRoute(), [
      ev({ matchState: 'UNKNOWN', tsMs: 1_000 }),
      ev({ matchState: 'UNKNOWN', tsMs: 2_000 }),
      ev({ matchState: 'UNKNOWN', tsMs: 3_000 }),
      ev({ matchState: 'UNKNOWN', tsMs: 4_000 }),
    ]);
    expect(m.state).not.toBe('CONFIRMED_OFF_ROUTE');
    expect(m.reasons).toContain('GPS_UNKNOWN');
  });

  it('HIZLI araçta kanıt penceresi DAHA KISA (geç kalmak tehlikelidir)', () => {
    expect(requiredEvidenceFor(110, 8, false)).toBeLessThan(requiredEvidenceFor(10, 8, false));
    expect(requiredEvidenceMsFor(110)).toBeLessThan(requiredEvidenceMsFor(10));
  });

  it('KÖTÜ doğrulukta kanıt penceresi UZAR', () => {
    expect(requiredEvidenceFor(50, 40, false)).toBeGreaterThan(requiredEvidenceFor(50, 8, false));
  });

  it('KABA sapmada kanıt penceresi kısalır (gürültü olamaz)', () => {
    expect(requiredEvidenceFor(50, 8, true)).toBeLessThan(requiredEvidenceFor(50, 8, false));
    expect(requiredEvidenceMsFor(10, true)).toBeLessThan(requiredEvidenceMsFor(10, false));
  });

  it('YAVAŞ araçta tek örnek yine yetmez, ama kaba sapma yine de doğrulanır', () => {
    const m = feed(initialOffRoute(), [
      ev({ speedKmh: 8, tsMs: 1_000 }), ev({ speedKmh: 8, tsMs: 2_000 }),
      ev({ speedKmh: 8, tsMs: 3_000 }),
    ]);
    expect(m.state).toBe('CONFIRMED_OFF_ROUTE');
  });

  it('SAYI yetse bile SÜRE yetmezse doğrulanmaz (yüksek frekanslı kaynak)', () => {
    // 4 örnek ama toplam 300 ms — kanıt "sürmüyor"
    const m = feed(initialOffRoute(), [
      ev({ lateralM: 90, speedKmh: 40, tsMs: 0 }),
      ev({ lateralM: 90, speedKmh: 40, tsMs: 100 }),
      ev({ lateralM: 90, speedKmh: 40, tsMs: 200 }),
      ev({ lateralM: 90, speedKmh: 40, tsMs: 300 }),
    ]);
    expect(m.state).toBe('SUSPECTED_OFF_ROUTE');
  });

  it('ROTAYA DÖNÜŞ: CONFIRMED sonrası iki temiz örnek ON_ROUTE yapar', () => {
    let m = feed(initialOffRoute(), [ev({ tsMs: 1_000 }), ev({ tsMs: 2_000 }), ev({ tsMs: 3_000 })]);
    expect(m.state).toBe('CONFIRMED_OFF_ROUTE');
    m = stepOffRoute(m, ev({ matchState: 'MATCHED', lateralM: 5, tsMs: 4_000 }), CORRIDOR);
    expect(m.state).toBe('REJOINED');
    m = stepOffRoute(m, ev({ matchState: 'MATCHED', lateralM: 5, tsMs: 5_000 }), CORRIDOR);
    expect(m.state).toBe('ON_ROUTE');
  });

  it('REROUTING sırasında eski rotaya göre sapma yeniden SAYILMAZ', () => {
    let m = markRerouting(feed(initialOffRoute(), [
      ev({ tsMs: 1_000 }), ev({ tsMs: 2_000 }), ev({ tsMs: 3_000 })]));
    expect(m.state).toBe('REROUTING');
    m = feed(m, [ev({ tsMs: 4_000 }), ev({ tsMs: 5_000 }), ev({ tsMs: 6_000 })]);
    expect(m.state).toBe('REROUTING');
    expect(m.evidenceCount).toBe(0);
  });

  it('MATCH_UNCERTAIN tek başına sapma kanıtı DEĞİLDİR', () => {
    const m = feed(initialOffRoute(), [
      ev({ matchState: 'MATCH_UNCERTAIN', lateralM: 10, tsMs: 1_000 }),
      ev({ matchState: 'MATCH_UNCERTAIN', lateralM: 10, tsMs: 2_000 }),
      ev({ matchState: 'MATCH_UNCERTAIN', lateralM: 10, tsMs: 3_000 }),
      ev({ matchState: 'MATCH_UNCERTAIN', lateralM: 10, tsMs: 4_000 }),
    ]);
    expect(m.state).toBe('ON_ROUTE');
    expect(m.reasons).toContain('MATCH_UNCERTAIN');
  });

  it('yeni rota commit edilince makine TEMİZ başlar', () => {
    const m = markRouteCommitted();
    expect(m.state).toBe('ON_ROUTE');
    expect(m.evidenceCount).toBe(0);
    expect(m.confirmedAtMs).toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   D. ROTA DOĞRULAMA KAPISI
   ══════════════════════════════════════════════════════════════════════════ */
function step(over: Partial<ValidationStep> = {}): ValidationStep {
  return { maneuverType: 'turn', maneuverModifier: 'right', distance: 500,
           coordinate: [34.61, 36.80], ...over };
}

function cand(over: Partial<RouteCandidate> = {}): RouteCandidate {
  return {
    geometry: ROUTE, distanceM: 3_500, durationS: 300,
    steps: [step({ maneuverType: 'depart', maneuverModifier: 'straight' }),
            step({ maneuverType: 'arrive', maneuverModifier: 'straight' })],
    ...over,
  };
}

const BASE_INPUT = {
  originLat: 36.80, originLon: 34.60,
  destLat: 36.80,   destLon: 34.64,
  vehicleHeadingDeg: EAST as number | null,
  isStaleRequest: false,
};

describe('D. Rota doğrulama kapısı', () => {
  it('sağlıklı rota GEÇERLİ', () => {
    const r = validateRoute({ ...BASE_INPUT, candidate: cand() });
    expect(r.verdict).toBe('VALID');
    expect(r.failCount).toBe(0);
  });

  it('BAYAT istek → REDDEDİLDİ (başka denetime bakılmaz)', () => {
    const r = validateRoute({ ...BASE_INPUT, candidate: cand(), isStaleRequest: true });
    expect(r.verdict).toBe('REJECTED');
    expect(r.checks[0].id).toBe('STALE_REQUEST');
  });

  it('GEÇERSİZ geometri → REDDEDİLDİ', () => {
    const r = validateRoute({ ...BASE_INPUT, candidate: cand({ geometry: [[34.6, 36.8]] }) });
    expect(r.verdict).toBe('REJECTED');
  });

  it('NaN koordinat içeren geometri → REDDEDİLDİ', () => {
    const bad: [number, number][] = [[34.60, 36.80], [NaN, 36.80], [34.64, 36.80]];
    const r = validateRoute({ ...BASE_INPUT, candidate: cand({ geometry: bad }) });
    expect(r.verdict).toBe('REJECTED');
  });

  it('HEDEFE ULAŞMAYAN rota → REDDEDİLDİ', () => {
    const r = validateRoute({ ...BASE_INPUT, candidate: cand(), destLon: 34.90 });
    expect(r.checks.find(c => c.id === 'REACHES_DESTINATION')?.status).toBe('FAIL');
    expect(r.verdict).toBe('REJECTED');
  });

  it('TERS BAŞLANGIÇ (araç yönüne 180° zıt) → REDDEDİLDİ', () => {
    const r = validateRoute({ ...BASE_INPUT, candidate: cand(), vehicleHeadingDeg: WEST });
    expect(r.checks.find(c => c.id === 'START_HEADING')?.status).toBe('FAIL');
    expect(r.verdict).toBe('REJECTED');
  });

  it('ARAÇ YÖNÜ BİLİNMİYORSA denetim UNKNOWN — "geçti" SAYILMAZ', () => {
    const r = validateRoute({ ...BASE_INPUT, candidate: cand(), vehicleHeadingDeg: null });
    expect(r.checks.find(c => c.id === 'START_HEADING')?.status).toBe('UNKNOWN');
  });

  it('BAŞLANGIÇTA U DÖNÜŞÜ (ters şeride yapışma işareti) → KUSURLU', () => {
    const r = validateRoute({ ...BASE_INPUT, candidate: cand({
      steps: [step({ maneuverModifier: 'uturn', distance: 20 }),
              step({ maneuverType: 'arrive', maneuverModifier: 'straight' })],
    }) });
    expect(r.checks.find(c => c.id === 'EARLY_UTURN')?.status).toBe('WARN');
    expect(r.verdict).toBe('DEGRADED');
  });

  it('ABSÜRT UZUN rota (kuş uçuşunun 6 katından fazla) → REDDEDİLDİ', () => {
    const r = validateRoute({ ...BASE_INPUT, candidate: cand({ distanceM: 40_000, durationS: 3_000 }) });
    expect(r.checks.find(c => c.id === 'DETOUR_RATIO')?.status).toBe('FAIL');
    expect(r.verdict).toBe('REJECTED');
  });

  it('YOL SINIFI KANITI YOKSA denetim UNKNOWN — uydurulmaz', () => {
    const r = validateRoute({ ...BASE_INPUT, candidate: cand() });
    expect(r.checks.find(c => c.id === 'ROAD_CLASS_MIX')?.status).toBe('UNKNOWN');
  });

  it('pickBestRoute: REDDEDİLEN aday ASLA seçilmez', () => {
    const good = cand();
    const bad  = cand({ geometry: [[34.6, 36.8]] });
    const picked = pickBestRoute([
      { candidate: bad,  validation: validateRoute({ ...BASE_INPUT, candidate: bad }) },
      { candidate: good, validation: validateRoute({ ...BASE_INPUT, candidate: good }) },
    ]);
    expect(picked).not.toBeNull();
    expect(picked!.index).toBe(1);
  });

  it('pickBestRoute: hepsi reddedilmişse null (fail-closed)', () => {
    const bad = cand({ geometry: [[34.6, 36.8]] });
    const picked = pickBestRoute([
      { candidate: bad, validation: validateRoute({ ...BASE_INPUT, candidate: bad }) },
    ]);
    expect(picked).toBeNull();
  });

  it('pickBestRoute: DAHA AZ kusurlu olan kazanır (sağlayıcı sırası değil)', () => {
    const warned = cand({ steps: [step({ maneuverModifier: 'uturn', distance: 20 }),
                                  step({ maneuverType: 'arrive' })] });
    const clean  = cand();
    const picked = pickBestRoute([
      { candidate: warned, validation: validateRoute({ ...BASE_INPUT, candidate: warned }) },
      { candidate: clean,  validation: validateRoute({ ...BASE_INPUT, candidate: clean }) },
    ]);
    expect(picked!.index).toBe(1);   // sağlayıcının İLK rotası değil
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   E. MANEVRA MESAFESİ (yol-boyu)
   ══════════════════════════════════════════════════════════════════════════ */
describe('E. Manevra mesafesi ve çapalar', () => {
  const STEPS = [
    { coordinate: [34.60, 36.80] as [number, number], geometryPointCount: 2 },
    { coordinate: [34.61, 36.80] as [number, number], geometryPointCount: 2 },
    { coordinate: [34.62, 36.80] as [number, number], geometryPointCount: 2 },
    { coordinate: [34.63, 36.80] as [number, number], geometryPointCount: 2 },
    { coordinate: [34.64, 36.80] as [number, number], geometryPointCount: 1 },
  ];

  it('uç uca ekleme yöntemi KESİN çapa üretir', () => {
    const a = buildManeuverAnchors(ROUTE, CUM, STEPS);
    expect(a.map(x => x.geometryIndex)).toEqual([0, 1, 2, 3, 4]);
    expect(a.every(x => x.method === 'CONCATENATION')).toBe(true);
    expect(a[4].alongRemainingM).toBe(0);
  });

  it('nokta sayısı verilmezse EN YAKIN nokta yedeğine düşer', () => {
    const a = buildManeuverAnchors(ROUTE, CUM, STEPS.map(s => ({ coordinate: s.coordinate })));
    expect(a[0].method).toBe('CONCATENATION');   // ilk adım cursor=0'da tutar
    expect(a[2].method).toBe('NEAREST');
    expect(a[2].geometryIndex).toBe(2);
  });

  it('geometriye BAĞLANAMAYAN manevra dürüstçe UNRESOLVED — mesafe null', () => {
    const far = [{ coordinate: [40.0, 40.0] as [number, number] }];
    const a = buildManeuverAnchors(ROUTE, CUM, far);
    expect(a[0].method).toBe('UNRESOLVED');
    expect(a[0].alongRemainingM).toBeNull();
    expect(alongRouteDistanceToManeuver(1_000, a[0])).toBeNull();
  });

  it('YOL-BOYU mesafe kuş uçuşundan FARKLI ve DAHA UZUNDUR (L şeklinde rota)', () => {
    /* L rotası: batıdan doğuya, sonra kuzeye. Araç köşenin batısında;
       manevra noktası KÖŞE değil, kuzey uçtaki dönüştür. */
    const L: [number, number][] = [
      [34.60, 36.80], [34.62, 36.80], [34.62, 36.81],
    ];
    const lcum = buildCumulativeDistances(L);
    const anchors = buildManeuverAnchors(L, lcum, [
      { coordinate: [34.60, 36.80], geometryPointCount: 2 },
      { coordinate: [34.62, 36.81], geometryPointCount: 1 },
    ]);
    // Araç başlangıçta: yol-boyu kalan = tüm rota
    const alongAll = lcum[0];
    const dAlong   = alongRouteDistanceToManeuver(alongAll, anchors[1])!;
    const dCrow    = hav(36.80, 34.60, 36.81, 34.62);
    expect(dAlong).toBeGreaterThan(dCrow);   // KUŞ UÇUŞU KISA ÇIKAR — düzeltilen kusur
    expect(dAlong).toBeCloseTo(alongAll, 0);
  });

  it('GEÇİLEN manevra yol-boyu ilerlemeyle tespit edilir', () => {
    const a = buildManeuverAnchors(ROUTE, CUM, STEPS);
    // Araç 34.625'te → kalan ≈ cum[3] + yarım segment
    const alongAt = CUM[3] + hav(36.80, 34.625, 36.80, 34.63);
    expect(hasPassedManeuverAlongRoute(alongAt, a[2])).toBe(true);   // 34.62 geçildi
    expect(hasPassedManeuverAlongRoute(alongAt, a[3])).toBe(false);  // 34.63 geçilmedi
  });

  it('konum bilinmiyorsa mesafe UYDURULMAZ (null döner, 0 DEĞİL)', () => {
    const a = buildManeuverAnchors(ROUTE, CUM, STEPS);
    expect(alongRouteDistanceToManeuver(null, a[2])).toBeNull();
    expect(hasPassedManeuverAlongRoute(null, a[2])).toBe(false);
  });

  it('manevra geçilmişse mesafe NEGATİFE düşmez (geriye sayma yok)', () => {
    const a = buildManeuverAnchors(ROUTE, CUM, STEPS);
    expect(alongRouteDistanceToManeuver(0, a[1])).toBe(0);
  });
});
