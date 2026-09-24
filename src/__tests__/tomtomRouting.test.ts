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
import { fetchRoute, getRouteState, clearRoute } from '../platform/routingService';

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

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); clearRoute(); });

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

  it('🔒 anahtar yoksa TomTom HİÇ denenmez (satışta kaldırma = anahtarı silmek)', async () => {
    vi.stubEnv('VITE_TOMTOM_API_KEY', '');
    const f = vi.fn(async () => new Response('{}', { status: 500 }));
    vi.stubGlobal('fetch', f);
    await fetchRoute(36.9165, 34.895, 36.9065, 34.885);
    expect(urls(f).some((u) => u.includes('api.tomtom.com'))).toBe(false);
  });
});
