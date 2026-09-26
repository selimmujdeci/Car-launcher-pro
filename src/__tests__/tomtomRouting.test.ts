/**
 * tomtomRouting.test — TomTom trafikli rota sağlayıcısı (Calculate Route v1).
 *
 * Yanıt biçimi 2026-09-24'te Tarsus→Mersin için alınan GERÇEK yanıttan kısaltıldı.
 * Kilitler: OSRM biçimine doğru çeviri · süreler trafikli toplamla tutarlı ·
 * anahtar yoksa TomTom HİÇ denenmez · TomTom düşerse OSRM zinciri sürer.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('../platform/bridge', () => ({ isNative: false }));

import {
  parseTomTomRoute, tomtomManeuverToOsrm, segmentDurationsFromKnots, tomtomRouteUrl,
  TOMTOM_ROUTING_SERVER,
} from '../platform/routing/tomtomRouting';
import { fetchRoute, getRouteState, clearRoute, _resetTomTomRoutingBreakerForTest } from '../platform/routingService';

const pts = (n: number, lat0: number, lon0: number) =>
  Array.from({ length: n }, (_, i) => ({ latitude: lat0 - i * 0.001, longitude: lon0 - i * 0.001 }));

/** 11 noktalı rota: kalkış → çıkış (sağ, tabela "Mersin") → otoyola katılım → bilgi → varış. */
const RAW = {
  summary: { lengthInMeters: 1400, travelTimeInSeconds: 100, trafficDelayInSeconds: 20 },
  legs: [{ points: pts(11, 36.9165, 34.895) }],
  sections: [{ startPointIndex: 4, endPointIndex: 8, sectionType: 'TOLL' }],
  guidance: {
    instructions: [
      { routeOffsetInMeters: 0, travelTimeInSeconds: 0, pointIndex: 0, maneuver: 'DEPART', street: 'İsmet Paşa Bulvarı' },
      { routeOffsetInMeters: 400, travelTimeInSeconds: 40, pointIndex: 3, maneuver: 'TAKE_EXIT',
        street: 'Tarsus Batı Bağlantı Yolu', signpostText: 'Mersin', turnAngleInDecimalDegrees: 45 },
      { routeOffsetInMeters: 700, travelTimeInSeconds: 60, pointIndex: 5, maneuver: 'ENTER_MOTORWAY',
        street: 'Çukurova Otoyolu', roadNumbers: ['O-51'] },
      { routeOffsetInMeters: 800, travelTimeInSeconds: 64, pointIndex: 6, maneuver: 'FOLLOW', street: 'Çukurova Otoyolu' },
      { routeOffsetInMeters: 1400, travelTimeInSeconds: 100, pointIndex: 10, maneuver: 'ARRIVE', street: 'Gazi Mustafa Kemal Bulvarı' },
    ],
  },
};

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); clearRoute(); _resetTomTomRoutingBreakerForTest(); });

describe('çözücü', () => {
  it('🔒 adımlar OSRM biçimine çevrilir; bilgi talimatı (FOLLOW) adım ÜRETMEZ', () => {
    const r = parseTomTomRoute(RAW)!;
    expect(r.geometry[0]).toEqual([34.895, 36.9165]);           // [lon, lat]
    expect(r.steps.map((s) => s.maneuver.type)).toEqual(['depart', 'off ramp', 'merge', 'arrive']);
    expect(r.steps[1]).toMatchObject({ name: 'Tarsus Batı Bağlantı Yolu', destinations: 'Mersin', distance: 300, duration: 20 });
    expect(r.steps[1]!.maneuver.modifier).toBe('slight right');
    expect(r.steps[2]).toMatchObject({ ref: 'O-51', distance: 700, duration: 40 });
    // Adım geometrileri uç uca: toplam segment = nokta − 1 (manevra çapaları kesin bağlanır).
    expect(r.steps.reduce((a, s) => a + s.geometry.coordinates.length - 1, 0)).toBe(10);
    expect(r.hasToll).toBe(true);
    expect(r.trafficDelayS).toBe(20);
  });

  it('🔒 segment süreleri trafikli toplamla BİREBİR tutarlı', () => {
    const r = parseTomTomRoute(RAW)!;
    expect(r.annotationDurations).toHaveLength(10);
    const sum = r.annotationDurations!.reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(100, 6);
    // 0→3 arası 40 sn, 3 eşit segmente dağılır.
    expect(r.annotationDurations![0]).toBeCloseTo(40 / 3, 1);
  });

  it('düğümler rotayı kapsamıyorsa süre UYDURULMAZ (null)', () => {
    const g: [number, number][] = [[0, 0], [0, 0.001], [0, 0.002]];
    expect(segmentDurationsFromKnots(g, [{ idx: 0, t: 0 }, { idx: 1, t: 5 }])).toBeNull();
    expect(segmentDurationsFromKnots(g, [{ idx: 0, t: 10 }, { idx: 2, t: 5 }])).toBeNull();
    expect(parseTomTomRoute({ summary: {}, legs: [] })).toBeNull();
  });

  it('manevra eşlemesi; tanınmayan kod yön UYDURMAZ', () => {
    expect(tomtomManeuverToOsrm('KEEP_LEFT')).toEqual({ type: 'fork', modifier: 'slight left' });
    expect(tomtomManeuverToOsrm('TAKE_EXIT', -30)).toEqual({ type: 'off ramp', modifier: 'slight left' });
    expect(tomtomManeuverToOsrm('MAKE_UTURN').modifier).toBe('uturn');
    expect(tomtomManeuverToOsrm('SOMETHING_NEW')).toEqual({ type: 'something_new', modifier: 'straight' });
  });

  it('istek trafiği ister, anahtarı kodlar, yönü yalnız biliniyorsa gönderir', () => {
    const u = tomtomRouteUrl('k&1', 36.9, 34.8, 36.8, 34.6, 370);
    expect(u).toContain('traffic=true');
    expect(u).toContain('key=k%261');
    expect(u).toContain('vehicleHeading=10');
    expect(tomtomRouteUrl('k', 36.9, 34.8, 36.8, 34.6, null)).not.toContain('vehicleHeading');
  });
});

describe('sağlayıcı zinciri (fetchRoute)', () => {
  const urls = (f: ReturnType<typeof vi.fn>) => f.mock.calls.map((c) => String(c[0]));

  it('🔒 anahtar varsa TomTom rotası kullanılır ve trafikli süre geçerli', async () => {
    vi.stubEnv('VITE_TOMTOM_API_KEY', 'test-key');
    const f = vi.fn(async (u: string) => u.includes('api.tomtom.com')
      ? new Response(JSON.stringify({ routes: [RAW] }), { status: 200 })
      : new Response('x', { status: 500 }));
    vi.stubGlobal('fetch', f);
    await fetchRoute(36.9165, 34.895, 36.9065, 34.885);
    const st = getRouteState();
    expect(st.serverUsed).toBe(TOMTOM_ROUTING_SERVER);
    expect(st.totalDurationSeconds).toBe(100);
    expect(st.steps[1]!.instruction).toBe('Sağdaki çıkışı kullanın (Mersin yönü)');
    expect(urls(f)[0]).toContain('api.tomtom.com/routing/1/calculateRoute');
  });

  it('🔒 TomTom düşerse (403) OSRM zinciri denenir', async () => {
    vi.stubEnv('VITE_TOMTOM_API_KEY', 'test-key');
    const f = vi.fn(async () => new Response('{}', { status: 403 }));
    vi.stubGlobal('fetch', f);
    await fetchRoute(36.9165, 34.895, 36.9065, 34.885);
    expect(urls(f).some((u) => u.includes('routing.openstreetmap.de'))).toBe(true);
    expect(getRouteState().serverUsed).not.toBe(TOMTOM_ROUTING_SERVER);
  });

  it('🔒 TomTom hata verince devre kesici: sonraki istekler 5 dk TomTom’u atlar', async () => {
    vi.stubEnv('VITE_TOMTOM_API_KEY', 'test-key');
    const f = vi.fn(async () => new Response('{}', { status: 403 }));
    vi.stubGlobal('fetch', f);
    await fetchRoute(36.9165, 34.895, 36.9065, 34.885);
    const before = urls(f).filter((u) => u.includes('api.tomtom.com')).length;
    expect(before).toBe(1);
    await fetchRoute(36.9165, 34.895, 36.9065, 34.885);   // yeniden rota
    expect(urls(f).filter((u) => u.includes('api.tomtom.com')).length).toBe(1);
  });

  it('🔒 anahtar yoksa TomTom HİÇ denenmez (satışta kaldırma = anahtarı silmek)', async () => {
    vi.stubEnv('VITE_TOMTOM_API_KEY', '');
    const f = vi.fn(async () => new Response('{}', { status: 500 }));
    vi.stubGlobal('fetch', f);
    await fetchRoute(36.9165, 34.895, 36.9065, 34.885);
    expect(urls(f).some((u) => u.includes('api.tomtom.com'))).toBe(false);
  });
});

describe('şerit ve rota trafiği (aynı istekte, ek maliyet yok)', () => {
  const WITH = {
    ...RAW,
    sections: [
      ...RAW.sections,
      { startPointIndex: 1, endPointIndex: 3, sectionType: 'LANES',
        lanes: [{ directions: ['STRAIGHT'] }, { directions: ['STRAIGHT'] }, { directions: ['SLIGHT_RIGHT'], follow: 'SLIGHT_RIGHT' }] },
      { startPointIndex: 6, endPointIndex: 8, sectionType: 'TRAFFIC', simpleCategory: 'JAM', magnitudeOfDelay: 2, delayInSeconds: 98 },
      { startPointIndex: 8, endPointIndex: 9, sectionType: 'TRAFFIC', simpleCategory: 'ROAD_CLOSURE', magnitudeOfDelay: 4 },
    ],
  };

  it('🔒 şerit bölümü, BİTTİĞİ manevra noktasına bağlanır; yalnız önerilen şerit geçerli', () => {
    const r = parseTomTomRoute(WITH)!;
    const exit = r.steps.find((s) => s.maneuver.type === 'off ramp')!;
    expect(exit.intersections![0]!.lanes).toEqual([
      { valid: false, active: false, indications: ['straight'] },
      { valid: false, active: false, indications: ['straight'] },
      { valid: true, active: true, indications: ['slight right'] },
    ]);
    expect(r.steps.filter((s) => s.intersections).length).toBe(1);
  });

  it('🔒 trafik bölümleri seviye ve gecikmeyle çözülür; kapalı yol en koyu', () => {
    const r = parseTomTomRoute(WITH)!;
    expect(r.trafficSections).toEqual([
      { startIdx: 6, endIdx: 8, level: 'heavy', kind: 'JAM', delayS: 98 },
      { startIdx: 8, endIdx: 9, level: 'standstill', kind: 'ROAD_CLOSURE', delayS: null },
    ]);
  });

  it('fetchRoute şeritleri RouteStep.lanes\'e, trafiği rota durumuna taşır', async () => {
    vi.stubEnv('VITE_TOMTOM_API_KEY', 'test-key');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ routes: [WITH] }), { status: 200 })));
    await fetchRoute(36.9165, 34.895, 36.9065, 34.885);
    const st = getRouteState();
    expect(st.steps[1]!.lanes?.[2]).toEqual({ valid: true, active: true, indications: ['slight right'] });
    expect(st.trafficSections).toHaveLength(2);
  });
});

describe('rota hız sınırı', () => {
  it('🔒 SPEED_LIMIT bölümleri çözülür; segment bölümdeyse sınır, değilse null (uydurma yok)', async () => {
    const { speedLimitOnRouteAt } = await import('../platform/routing/tomtomRouting');
    const r = parseTomTomRoute({ ...RAW, sections: [
      { startPointIndex: 0, endPointIndex: 4, sectionType: 'SPEED_LIMIT', maxSpeedLimitInKmh: 50 },
      { startPointIndex: 4, endPointIndex: 8, sectionType: 'SPEED_LIMIT', maxSpeedLimitInKmh: 120 },
      { startPointIndex: 8, endPointIndex: 9, sectionType: 'SPEED_LIMIT', maxSpeedLimitInKmh: 999 },
    ] })!;
    expect(r.speedLimitSections).toEqual([
      { startIdx: 0, endIdx: 4, kmh: 50 }, { startIdx: 4, endIdx: 8, kmh: 120 },
    ]);
    expect(speedLimitOnRouteAt(r.speedLimitSections, 3)).toBe(50);
    expect(speedLimitOnRouteAt(r.speedLimitSections, 4)).toBe(120);
    expect(speedLimitOnRouteAt(r.speedLimitSections, 9)).toBeNull();
  });

  it('🔒 rota kaynağı aynı sınıflandırıcıdan geçer: taze + araç yakında → gösterilir; uzaklaşınca gizlenir', async () => {
    const { classifySpeedLimit } = await import('../platform/navigation/core/speedLimitTruthModel');
    const obs = { kmh: 120, source: 'route' as const, resolvedAtMs: 1000, resolvedAtLat: 36.9, resolvedAtLon: 34.8 };
    const ok = classifySpeedLimit(obs, { lat: 36.9, lon: 34.8, nowMs: 1500 });
    expect(ok).toMatchObject({ state: 'AVAILABLE', kmh: 120, source: 'route' });
    expect(classifySpeedLimit(obs, { lat: 36.95, lon: 34.8, nowMs: 1500 }).state).toBe('STALE');
  });
});

describe('daha hızlı rota', () => {
  it('🔒 kazanç kuralı: en az 3 dk VE kalan sürenin %10\'u', async () => {
    const { betterRouteSaving } = await import('../platform/routing/tomtomRouting');
    expect(betterRouteSaving(2442, 2113)).toBe(329);        // gerçek TomTom ölçümü (Tarsus→Mersin)
    expect(betterRouteSaving(3600, 3480)).toBeNull();       // 2 dk — gürültü
    expect(betterRouteSaving(7200, 6900)).toBeNull();       // 5 dk ama %4
    expect(betterRouteSaving(0, 0)).toBeNull();
  });

  it('referans rota seyreltilir (uçlar korunur)', async () => {
    const { samplePolyline } = await import('../platform/routing/tomtomRouting');
    const g = Array.from({ length: 1000 }, (_, i) => [i, i] as [number, number]);
    const s = samplePolyline(g, 150);
    expect(s).toHaveLength(150);
    expect(s[0]).toEqual([0, 0]);
    expect(s[149]).toEqual([999, 999]);
  });

  it('istemci kalan rotayı POST gövdesinde referans verir; referans + alternatif süresi döner', async () => {
    const { fetchTomTomBetterRoute } = await import('../platform/routing/tomtomRouting');
    let body: { supportingPoints: { latitude: number; longitude: number }[] } | null = null;
    let url = '';
    const f = vi.fn(async (u: string, init?: RequestInit) => {
      url = u; body = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ routes: [
        { summary: { travelTimeInSeconds: 2442 } }, { summary: { travelTimeInSeconds: 2113 } },
      ] }), { status: 200 });
    });
    const r = await fetchTomTomBetterRoute('k', [[34.89, 36.91], [34.8, 36.85], [34.64, 36.81]], null, 5000, f as never);
    expect(r).toEqual({ referenceS: 2442, bestAlternativeS: 2113 });
    expect(url).toContain('alternativeType=betterRoute');
    expect(url).toContain('/36.910000,34.890000:36.810000,34.640000/');
    expect(body!.supportingPoints[1]).toEqual({ latitude: 36.85, longitude: 34.8 });
  });
});
