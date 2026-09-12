/**
 * tripCorridorEngine.test — MAVI4-TRIP-2 saf koridor öneri motoru.
 *
 * Kapsam: düz rota · eğri rota · koridor dışı/içi · aynı mesafe (tie-break) ·
 * boş rota · boş POI · performans · deterministik sıralama.
 * Rota/preview/apply/ETA DEĞİŞMEZ — yalnız öneri üretir.
 *
 * Geometri formatı: [lon, lat][] (proje standardı, OSRM uyumlu).
 */
import { describe, it, expect } from 'vitest';
import { computeCorridorCandidates, type CorridorCandidate } from '../platform/trip/tripCorridorEngine';
import type { StoredLocation } from '../platform/offlineSearchService';

/** Test POI üretici — sadece koridor motorunun okuduğu alanlar anlamlı. */
function poi(id: string, lat: number, lng: number): StoredLocation {
  return { id, name: id, lat, lng, source: 'search', timestamp: 0, useCount: 0 };
}

// Düz doğu rotası, sabit enlem 39.90; boylam 32.80 → 32.90 ([lon, lat]).
const STRAIGHT: [number, number][] = [
  [32.80, 39.90], [32.85, 39.90], [32.90, 39.90],
];

// 0.001° enlem ≈ 111.2 m referansı (assertion aralıkları için).
const M_PER_DEG_LAT = 111_195;

describe('computeCorridorCandidates — sınır durumları', () => {
  it('boş rota → []', () => {
    expect(computeCorridorCandidates([], [poi('a', 39.90, 32.85)], 1000)).toEqual([]);
  });

  it('tek noktalı rota (segment yok) → []', () => {
    expect(computeCorridorCandidates([[32.80, 39.90]], [poi('a', 39.90, 32.85)], 1000)).toEqual([]);
  });

  it('null rota → []', () => {
    expect(computeCorridorCandidates(null, [poi('a', 39.90, 32.85)], 1000)).toEqual([]);
  });

  it('boş POI → []', () => {
    expect(computeCorridorCandidates(STRAIGHT, [], 1000)).toEqual([]);
  });

  it('null POI → []', () => {
    expect(computeCorridorCandidates(STRAIGHT, null, 1000)).toEqual([]);
  });

  it('geçersiz maxCorridorMeters (0 / negatif / NaN) → []', () => {
    const p = [poi('a', 39.905, 32.85)];
    expect(computeCorridorCandidates(STRAIGHT, p, 0)).toEqual([]);
    expect(computeCorridorCandidates(STRAIGHT, p, -100)).toEqual([]);
    expect(computeCorridorCandidates(STRAIGHT, p, NaN)).toEqual([]);
  });

  it('NaN koordinatlı POI atlanır', () => {
    const res = computeCorridorCandidates(STRAIGHT, [poi('bad', NaN, 32.85)], 1000);
    expect(res).toEqual([]);
  });
});

describe('computeCorridorCandidates — düz rota koridor filtresi', () => {
  it('koridor içi POI dahil, koridor dışı POI elenir', () => {
    const inside  = poi('in',  39.905, 32.85); // ~556 m kuzey
    const outside = poi('out', 39.950, 32.85); // ~5560 m kuzey
    const res = computeCorridorCandidates(STRAIGHT, [inside, outside], 1000);
    expect(res.map(r => r.location.id)).toEqual(['in']);
  });

  it('distanceToRoute rotaya dik mesafeyi verir (~556 m)', () => {
    const res = computeCorridorCandidates(STRAIGHT, [poi('in', 39.905, 32.85)], 1000);
    expect(res).toHaveLength(1);
    // 0.005° enlem ≈ 556 m — haversine yaklaşımı için geniş tolerans.
    expect(res[0].distanceToRoute).toBeGreaterThan(520);
    expect(res[0].distanceToRoute).toBeLessThan(600);
  });

  it('estimatedDetour = 2 × distanceToRoute (ETA değil, kaba tahmin)', () => {
    const res = computeCorridorCandidates(STRAIGHT, [poi('in', 39.905, 32.85)], 1000);
    expect(res[0].estimatedDetour).toBeCloseTo(res[0].distanceToRoute * 2, 6);
  });

  it('score 0..1 aralığında; daha yakın POI daha yüksek skor + önce sıralanır', () => {
    const near = poi('near', 39.902, 32.85); // ~222 m
    const far  = poi('far',  39.908, 32.85); // ~889 m
    const res = computeCorridorCandidates(STRAIGHT, [far, near], 1000);
    expect(res.map(r => r.location.id)).toEqual(['near', 'far']);
    for (const r of res) {
      expect(r.score).toBeGreaterThanOrEqual(0);
      expect(r.score).toBeLessThanOrEqual(1);
    }
    expect(res[0].score).toBeGreaterThan(res[1].score);
  });

  it('routeProgress rota boyunca konumu yansıtır (başa yakın < sona yakın)', () => {
    const start = poi('start', 39.902, 32.805); // rota başına yakın
    const end   = poi('end',   39.902, 32.895); // rota sonuna yakın
    const res = computeCorridorCandidates(STRAIGHT, [start, end], 1000);
    const byId = Object.fromEntries(res.map(r => [r.location.id, r]));
    expect(byId.start.routeProgress).toBeLessThan(0.15);
    expect(byId.end.routeProgress).toBeGreaterThan(0.85);
    for (const r of res) {
      expect(r.routeProgress).toBeGreaterThanOrEqual(0);
      expect(r.routeProgress).toBeLessThanOrEqual(1);
    }
  });

  it('rota üstündeki POI: distanceToRoute≈0, score≈1', () => {
    const res = computeCorridorCandidates(STRAIGHT, [poi('on', 39.90, 32.85)], 1000);
    expect(res[0].distanceToRoute).toBeLessThan(1);
    expect(res[0].score).toBeGreaterThan(0.999);
  });
});

describe('computeCorridorCandidates — eğri (L) rota', () => {
  // Doğuya git, sonra kuzeye dön.
  const CURVED: [number, number][] = [
    [32.80, 39.90], [32.90, 39.90], [32.90, 40.00],
  ];

  it('köşeye yakın POI koridor içinde kalır', () => {
    const corner = poi('corner', 39.905, 32.905); // köşe (32.90,39.90) yakını
    const res = computeCorridorCandidates(CURVED, [corner], 2000);
    expect(res).toHaveLength(1);
    expect(res[0].distanceToRoute).toBeLessThan(2000);
  });

  it('ilk bacağa uzak ama ikinci bacağa yakın POI dahil edilir', () => {
    const nearSecondLeg = poi('leg2', 39.95, 32.902); // dikey bacağa ~185 m
    const res = computeCorridorCandidates(CURVED, [nearSecondLeg], 1000);
    expect(res).toHaveLength(1);
    expect(res[0].distanceToRoute).toBeLessThan(1000);
  });
});

describe('computeCorridorCandidates — deterministik sıralama', () => {
  it('aynı mesafe → routeProgress sonra id ile deterministik (id artan)', () => {
    // İkisi de aynı boylamda (aynı progress), simetrik ±0.005° → aynı mesafe.
    const north = poi('zeta',  39.905, 32.85);
    const south = poi('alpha', 39.895, 32.85);
    const res = computeCorridorCandidates(STRAIGHT, [north, south], 1000);
    expect(res).toHaveLength(2);
    // Eşit skor + eşit progress → id artan: 'alpha' < 'zeta'.
    expect(res.map(r => r.location.id)).toEqual(['alpha', 'zeta']);
  });

  it('girdi sırasından bağımsız — aynı çıktı (iki kez, ters girdi)', () => {
    const list = [
      poi('c', 39.905, 32.87),
      poi('a', 39.902, 32.85),
      poi('b', 39.908, 32.83),
    ];
    const r1 = computeCorridorCandidates(STRAIGHT, list, 1000);
    const r2 = computeCorridorCandidates(STRAIGHT, [...list].reverse(), 1000);
    expect(r1.map(r => r.location.id)).toEqual(r2.map(r => r.location.id));
  });

  it('maxCandidate çıktı sayısını kısar (en iyi N korunur)', () => {
    const list = [
      poi('far',  39.909, 32.85),
      poi('mid',  39.905, 32.85),
      poi('near', 39.901, 32.85),
    ];
    const res = computeCorridorCandidates(STRAIGHT, list, 1000, 2);
    expect(res).toHaveLength(2);
    expect(res.map(r => r.location.id)).toEqual(['near', 'mid']);
  });

  it('maxCandidate=0 veya geçersiz → tümü döner (kısıtlama yok)', () => {
    const list = [poi('a', 39.902, 32.85), poi('b', 39.905, 32.85)];
    expect(computeCorridorCandidates(STRAIGHT, list, 1000, 0)).toHaveLength(2);
    expect(computeCorridorCandidates(STRAIGHT, list, 1000, NaN)).toHaveLength(2);
  });
});

describe('computeCorridorCandidates — saflık & performans', () => {
  it('girdi dizileri/objeleri mutasyona uğratılmaz', () => {
    const geo: [number, number][] = STRAIGHT.map(p => [...p] as [number, number]);
    const geoCopy = JSON.parse(JSON.stringify(geo));
    const list = [poi('a', 39.905, 32.85)];
    const listCopy = JSON.parse(JSON.stringify(list));
    computeCorridorCandidates(geo, list, 1000);
    expect(geo).toEqual(geoCopy);
    expect(list).toEqual(listCopy);
  });

  it('döndürülen location girdi referansıdır (kopya değil)', () => {
    const p = poi('a', 39.905, 32.85);
    const res = computeCorridorCandidates(STRAIGHT, [p], 1000);
    expect(res[0].location).toBe(p);
  });

  it('500 segment × 200 POI < 100 ms', () => {
    const geo: [number, number][] = [];
    for (let i = 0; i < 500; i++) geo.push([32.80 + i * 0.001, 39.90]);
    const pois: StoredLocation[] = [];
    for (let i = 0; i < 200; i++) pois.push(poi(`p${i}`, 39.90 + (i % 20) * 0.0005, 32.80 + i * 0.0025));

    const t0 = performance.now();
    const res: CorridorCandidate[] = computeCorridorCandidates(geo, pois, 1500);
    const dt = performance.now() - t0;

    expect(res.length).toBeGreaterThan(0);
    expect(dt).toBeLessThan(100);
  });

  // Referans: 0.001° enlem ≈ 111 m — assertion aralıklarının dayanağı.
  it('mesafe ölçeği referansı tutarlı (~111 m/0.001°)', () => {
    expect(M_PER_DEG_LAT / 1000).toBeGreaterThan(100);
    expect(M_PER_DEG_LAT / 1000).toBeLessThan(120);
  });
});
