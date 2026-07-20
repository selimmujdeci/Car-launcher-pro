/**
 * tripRecommendationEngine.test — MAVI4-TRIP-3 saf öneri/filtre/karşılaştırma motoru.
 *
 * Kapsam: kategori filtresi · boş filtre · deterministik sıralama · aynı skor ·
 * reasonCode · NO_SOURCE · karşılaştırma · performans · saflık · mutasyonsuzluk.
 * Rota/ETA/preview/nav DEĞİŞMEZ — yalnız öneri.
 */
import { describe, it, expect } from 'vitest';
import {
  generateRecommendations,
  compareRecommendations,
  type TripCandidate,
  type Recommendation,
  type PoiCategory,
} from '../platform/trip/tripRecommendationEngine';
import type { StoredLocation } from '../platform/offlineSearchService';

function loc(id: string): StoredLocation {
  return { id, name: id, lat: 39.9, lng: 32.8, source: 'search', timestamp: 0, useCount: 0 };
}

/** TRIP-2 benzeri aday üretici. */
function cand(
  id: string,
  opts: { dist?: number; detour?: number; progress?: number; score?: number; category?: PoiCategory } = {},
): TripCandidate {
  const dist = opts.dist ?? 100;
  return {
    location:        loc(id),
    distanceToRoute: dist,
    estimatedDetour: opts.detour ?? dist * 2,
    routeProgress:   opts.progress ?? 0.5,
    score:           opts.score ?? 0.9,
    category:        opts.category,
  };
}

describe('generateRecommendations — sınır durumları', () => {
  it('boş aday → []', () => {
    expect(generateRecommendations([])).toEqual([]);
    expect(generateRecommendations(null)).toEqual([]);
    expect(generateRecommendations(undefined)).toEqual([]);
  });

  it('boş filtre → tüm adaylar döner (filtreleme yok)', () => {
    const res = generateRecommendations([cand('a'), cand('b')], undefined, {});
    expect(res).toHaveLength(2);
  });
});

describe('generateRecommendations — skorlama & NO_SOURCE mimarisi', () => {
  it('bugün beslenmeyen kaynaklar NO_SOURCE, skora katılmaz', () => {
    const [r] = generateRecommendations([cand('a', { score: 0.8 })]);
    const byKey = Object.fromEntries(r.signals.map(s => [s.key, s]));
    // proximity aktif:
    expect(byKey.proximity.status).toBe('ACTIVE');
    // gelecek kaynaklar NO_SOURCE + value null:
    for (const k of ['weather', 'traffic', 'popularity', 'childFriendly', 'sunset', 'openStatus', 'accessibility', 'fuelNeed']) {
      expect(byKey[k].status).toBe('NO_SOURCE');
      expect(byKey[k].value).toBeNull();
    }
    // Yalnız proximity aktif → finalScore = proximity value.
    expect(r.score).toBeCloseTo(0.8, 6);
  });

  it('kategori yoksa userInterest NO_SOURCE (tercih verilse bile)', () => {
    const [r] = generateRecommendations([cand('a')], { interests: ['scenic'] });
    const ui = r.signals.find(s => s.key === 'userInterest')!;
    expect(ui.status).toBe('NO_SOURCE');
    expect(r.category).toBe('unknown');
  });

  it('tercih + eşleşen kategori → userInterest ACTIVE ve skoru yükseltir', () => {
    const noPref  = generateRecommendations([cand('a', { score: 0.6, category: 'scenic' })]);
    const withPref = generateRecommendations([cand('a', { score: 0.6, category: 'scenic' })], { interests: ['scenic'] });
    const ui = withPref[0].signals.find(s => s.key === 'userInterest')!;
    expect(ui.status).toBe('ACTIVE');
    expect(ui.value).toBe(1);
    // userInterest=1 (>proximity 0.6) ağırlıklı ortalamayı yukarı çeker.
    expect(withPref[0].score).toBeGreaterThan(noPref[0].score);
  });

  it('tercih var ama kategori eşleşmiyor → userInterest=0, skoru düşürür', () => {
    const match   = generateRecommendations([cand('a', { score: 0.6, category: 'scenic' })], { interests: ['scenic'] });
    const noMatch = generateRecommendations([cand('a', { score: 0.6, category: 'museum' })], { interests: ['scenic'] });
    expect(noMatch[0].score).toBeLessThan(match[0].score);
  });

  it('recommendationLevel skordan türetilir (high/medium/low)', () => {
    expect(generateRecommendations([cand('a', { score: 0.9 })])[0].recommendationLevel).toBe('high');
    expect(generateRecommendations([cand('a', { score: 0.6 })])[0].recommendationLevel).toBe('medium');
    expect(generateRecommendations([cand('a', { score: 0.2 })])[0].recommendationLevel).toBe('low');
  });
});

describe('generateRecommendations — reasonCode & summary (uydurma yok)', () => {
  it('yakınlık kodları mesafeden türetilir', () => {
    const veryClose = generateRecommendations([cand('a', { dist: 50 })])[0];
    expect(veryClose.reasonCodes).toContain('VERY_CLOSE_TO_ROUTE');
    expect(veryClose.summary).toBe('Rotaya çok yakın.');

    const close = generateRecommendations([cand('b', { dist: 300 })])[0];
    expect(close.reasonCodes).toContain('CLOSE_TO_ROUTE');
    expect(close.reasonCodes).not.toContain('VERY_CLOSE_TO_ROUTE');
  });

  it('progress kodları: erken / geç', () => {
    expect(generateRecommendations([cand('a', { progress: 0.1 })])[0].reasonCodes).toContain('EARLY_ON_ROUTE');
    expect(generateRecommendations([cand('b', { progress: 0.9 })])[0].reasonCodes).toContain('LATE_ON_ROUTE');
  });

  it('bilinen kategori → KNOWN_CATEGORY + kategori özeti', () => {
    const r = generateRecommendations([cand('a', { dist: 600, category: 'scenic' })])[0];
    expect(r.reasonCodes).toContain('KNOWN_CATEGORY');
    expect(r.summary).toBe('Manzara noktası.');
  });

  it('eşleşen ilgi → MATCHES_INTEREST + kategori özeti öncelikli', () => {
    const r = generateRecommendations([cand('a', { category: 'rest' })], { interests: ['rest'] })[0];
    expect(r.reasonCodes).toContain('MATCHES_INTEREST');
    expect(r.summary).toBe('Kısa mola için uygun.');
  });

  it('NO_SOURCE (kategori yok + uzak) → summary boş', () => {
    const r = generateRecommendations([cand('a', { dist: 600 })])[0]; // >CLOSE_M, kategori yok
    expect(r.category).toBe('unknown');
    expect(r.summary).toBe('');
  });
});

describe('generateRecommendations — filtreler', () => {
  const list = [
    cand('scenic1', { dist: 100, category: 'scenic', score: 0.9 }),
    cand('museum1', { dist: 200, category: 'museum', score: 0.8 }),
    cand('rest1',   { dist: 900, category: 'rest',   score: 0.5 }),
  ];

  it('kategori filtresi yalnız istenen kategoriyi bırakır', () => {
    const res = generateRecommendations(list, undefined, { categories: ['scenic', 'museum'] });
    expect(res.map(r => r.poiId).sort()).toEqual(['museum1', 'scenic1']);
  });

  it('minScore filtresi düşük skorluları eler', () => {
    const res = generateRecommendations(list, undefined, { minScore: 0.75 });
    expect(res.map(r => r.poiId).sort()).toEqual(['museum1', 'scenic1']);
  });

  it('maxDetourMeters filtresi uzak sapmaları eler', () => {
    const res = generateRecommendations(list, undefined, { maxDetourMeters: 500 });
    // scenic1 detour 200, museum1 400 kalır; rest1 1800 elenir.
    expect(res.map(r => r.poiId).sort()).toEqual(['museum1', 'scenic1']);
  });

  it('onRouteOnly yalnız rota üzeri (≤ eşik) adayları bırakır', () => {
    const res = generateRecommendations(list, undefined, { onRouteOnly: true, onRouteThresholdMeters: 150 });
    expect(res.map(r => r.poiId)).toEqual(['scenic1']);
  });

  it('maxCandidate çıktı sayısını kısar (en iyi N)', () => {
    const res = generateRecommendations(list, undefined, { maxCandidate: 2 });
    expect(res).toHaveLength(2);
    expect(res.map(r => r.poiId)).toEqual(['scenic1', 'museum1']);
  });
});

describe('generateRecommendations — deterministik sıralama', () => {
  it('skor azalan sıralanır', () => {
    const res = generateRecommendations([
      cand('low',  { score: 0.4 }),
      cand('high', { score: 0.95 }),
      cand('mid',  { score: 0.7 }),
    ]);
    expect(res.map(r => r.poiId)).toEqual(['high', 'mid', 'low']);
  });

  it('aynı skor → routeProgress sonra poiId ile deterministik', () => {
    const res = generateRecommendations([
      cand('zeta',  { score: 0.8, progress: 0.5 }),
      cand('alpha', { score: 0.8, progress: 0.5 }),
      cand('beta',  { score: 0.8, progress: 0.3 }),
    ]);
    // progress 0.3 önce; sonra eşit progress'te id artan (alpha<zeta).
    expect(res.map(r => r.poiId)).toEqual(['beta', 'alpha', 'zeta']);
  });

  it('girdi sırasından bağımsız — aynı çıktı', () => {
    const list = [cand('c', { score: 0.6 }), cand('a', { score: 0.9 }), cand('b', { score: 0.6, progress: 0.2 })];
    const r1 = generateRecommendations(list).map(r => r.poiId);
    const r2 = generateRecommendations([...list].reverse()).map(r => r.poiId);
    expect(r1).toEqual(r2);
  });
});

describe('compareRecommendations — saf karşılaştırma', () => {
  const build = (id: string, o: Parameters<typeof cand>[1]): Recommendation =>
    generateRecommendations([cand(id, o)])[0];

  it('yakınlık / skor / öncelik / reasonCode farkı', () => {
    const a = build('a', { dist: 100, score: 0.9, progress: 0.2, category: 'scenic' });
    const b = build('b', { dist: 300, score: 0.7, progress: 0.6 });
    const cmp = compareRecommendations(a, b);
    expect(cmp.closerPoiId).toBe('a');
    expect(cmp.higherScorePoiId).toBe('a');
    expect(cmp.earlierPoiId).toBe('a');
    // a bilinen kategori → KNOWN_CATEGORY yalnız a'da; a erken → EARLY yalnız a'da.
    expect(cmp.onlyInA).toContain('KNOWN_CATEGORY');
    expect(cmp.onlyInB).not.toContain('KNOWN_CATEGORY');
  });

  it('eşit alanlar → null', () => {
    const a = build('a', { dist: 100, score: 0.8, progress: 0.5 });
    const b = build('b', { dist: 100, score: 0.8, progress: 0.5 });
    const cmp = compareRecommendations(a, b);
    expect(cmp.closerPoiId).toBeNull();
    expect(cmp.higherScorePoiId).toBeNull();
    expect(cmp.earlierPoiId).toBeNull();
  });
});

describe('generateRecommendations — saflık & performans', () => {
  it('girdi adayları mutasyona uğratılmaz', () => {
    const list = [cand('a', { category: 'scenic' }), cand('b')];
    const snapshot = JSON.parse(JSON.stringify(list));
    generateRecommendations(list, { interests: ['scenic'] }, { minScore: 0.1, maxCandidate: 5 });
    expect(list).toEqual(snapshot);
  });

  it('1000 aday < 100 ms', () => {
    const list: TripCandidate[] = [];
    for (let i = 0; i < 1000; i++) {
      list.push(cand(`p${i}`, {
        dist: (i % 10) * 100,
        progress: (i % 100) / 100,
        score: (i % 100) / 100,
        category: (['scenic', 'museum', 'rest', 'nature'] as PoiCategory[])[i % 4],
      }));
    }
    const t0 = performance.now();
    const res = generateRecommendations(list, { interests: ['scenic'] }, { minScore: 0.2 });
    const dt = performance.now() - t0;
    expect(res.length).toBeGreaterThan(0);
    expect(dt).toBeLessThan(100);
  });
});
