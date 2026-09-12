/**
 * routeVisibilityGuard.test.ts — #625 KİLİDİ
 * "Rota EKRANDA mı" ölçümü + giriş kamerasının yön kararı.
 *
 * ── NEDEN VAR (cihazda ÖLÇÜLDÜ, 2026-08-18 07:31, Xiaomi 23090RA98I) ────────
 * #623'ün kökü arandı ve paint denetçisi (#624) rota boyasını KUSURSUZ okudu:
 * kılıf `#f59e0b` · çekirdek gradient `#79b0ff → #a5aaff → #34d399` ·
 * `line-opacity` 1,00 · blur YOK · `lineMetrics: true` · z-sırası doğru.
 * `#79b0ff`in WCAG parlaklığı 0,424 — #622'nin hedeflediği 0,42'nin birebir
 * kendisi. Ama aynı karede rota EKRANDA HİÇ YOKTU:
 *
 *     MapLibre render kanıtı: 5 katmanın 5'inde de **0 özellik**
 *     rotanın 309 noktasının **0'ı** görüş alanında
 *     araç (451,301) · rotanın ilk noktası (465,**432**) · pencere 902×405
 *     kamera −42,5° (kuzeybatı) · rota güneybatıya gidiyor
 *
 * KÖK: `enterNavigationView` altı çağrı yerinin HEPSİNDE ham GPS heading
 * (`headingRef.current ?? 0`) ile çağrılıyordu. Park hâlindeki araçta GPS
 * heading fiziksel olarak anlamsızdır (Doppler yok) ve `?? 0` kamerayı düpedüz
 * kuzeye çevirir. Kamera bir kez yanlış kurulduktan sonra araç hareket etmediği
 * sürece hiçbir kod düzeltmez (`setDrivingView`in yön denetimi >5 km/h ister).
 *
 * KİLİTLENEN SÖZLEŞMELER:
 *   1. Durağan araçta giriş kamerası yönü ROTADAN alınır — GPS heading'den DEĞİL.
 *   2. Yön kaynağı yoksa kamera DÖNDÜRÜLMEZ; "kuzeye çevir" bir karar DEĞİLDİR.
 *   3. Hareket hâlinde GPS heading üstündür — MEVCUT DAVRANIŞ KORUNUR.
 *   4. Görünürlük ölçümü kanıtsız bilgi ÜRETMEZ: "ölçmedim" ≠ "0 görünüyor".
 *   5. Ölçüm SALT-OKUNURDUR — haritaya tek bir yazma bile yapmaz.
 *   6. Geometri yankısı BOUNDED'dır — ham rota kopyalanmaz.
 *   7. Boya kusursuzken rota ekran dışındaysa denetçi KÖK ADAYI ÜRETİR
 *      (paint kuralları sessiz kalır — bu, #624'ün yapısal kör noktasıydı).
 *
 * Kilitler ZAYIFLATILMAZ/SİLİNMEZ; davranış bilinçli değişirse GÜNCELLENİR.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  resolveEntryBearing, resolveRouteForwardBearing,
  HEADING_TRUST_KMH, ROUTE_FORWARD_MIN_M,
} from '../platform/navigation/core/navigationEntryBearing';
import {
  rememberRouteGeometry, getRouteGeometryEcho, captureRouteVisibility,
  _resetRouteGeometryEchoForTest, angleDelta, metersPerPixel,
  ROUTE_GEOM_SAMPLE_MAX,
} from '../platform/map/routeVisibilityProbe';
import { captureRouteLayerProbe, type RouteLayerProbe } from '../platform/map/routeLayerProbe';
import { buildRouteLayerView, deriveRouteFindings } from '../platform/devtools/routeLayerModel';
import { resolveRouteColor } from '../platform/map/core/routeColorModel';

/* ══════════════════════════════════════════════════════════════════════════
 * A — GİRİŞ KAMERASININ YÖN KARARI
 * ════════════════════════════════════════════════════════════════════════ */

describe('#625 — giriş kamerası yönü: durağan araçta ROTA otoritedir', () => {
  it('🔒 CİHAZDA ÖLÇÜLEN KUSUR: park hâlinde GPS heading DEĞİL rota yönü uygulanır', () => {
    /* Ölçümün birebir kendisi: araç 0 km/h, kamera −42,5° (kuzeybatı),
       rota güneybatıya (215°) gidiyor. Eski davranış GPS heading'i uygulardı
       ve rotanın 309 noktasının 0'ı ekranda kalırdı. */
    const d = resolveEntryBearing({
      routeBearing: 215,
      gpsHeading: -42.5,
      speedKmh: 0,
      currentBearing: -42.5,
    });
    expect(d.source, 'durağan araçta GPS heading uygulanmış — #625 geri geldi').toBe('ROUTE');
    expect(d.bearing).toBe(215);
    /* Eski davranışın bu kilidi GEÇEMEYECEĞİNİN kanıtı: */
    expect(d.bearing).not.toBe(-42.5);
    expect(((-42.5 % 360) + 360) % 360).toBe(317.5); // eski değer normalize edilse de yanlış
  });

  it('🔒 hız BİLİNMİYORSA durağan sayılır (fail-safe) — yön rotadan gelir', () => {
    const d = resolveEntryBearing({
      routeBearing: 90, gpsHeading: 270, speedKmh: null, currentBearing: 0,
    });
    expect(d.source).toBe('ROUTE');
    expect(d.bearing).toBe(90);
  });

  it('🔒 eşiğin ALTINDA (durağan) rota, ÜSTÜNDE (hareket) GPS kazanır', () => {
    const below = resolveEntryBearing({
      routeBearing: 90, gpsHeading: 270, speedKmh: HEADING_TRUST_KMH - 0.1, currentBearing: 0,
    });
    const above = resolveEntryBearing({
      routeBearing: 90, gpsHeading: 270, speedKmh: HEADING_TRUST_KMH, currentBearing: 0,
    });
    expect(below.source).toBe('ROUTE');
    expect(above.source, 'hareket hâlindeki MEVCUT davranış bozuldu').toBe('GPS_HEADING');
    expect(above.bearing).toBe(270);
  });

  it('🔒 durağan + rota yönü YOK → son bilinen GPS heading (kuzey DEĞİL)', () => {
    const d = resolveEntryBearing({
      routeBearing: null, gpsHeading: 137, speedKmh: 0, currentBearing: 10,
    });
    expect(d.source).toBe('GPS_HEADING');
    expect(d.bearing).toBe(137);
  });

  it('🔒 hiçbir yön kaynağı yoksa kamera DÖNDÜRÜLMEZ — `?? 0` kuzey kusuru geri gelmez', () => {
    const d = resolveEntryBearing({
      routeBearing: null, gpsHeading: null, speedKmh: 0, currentBearing: 123,
    });
    expect(d.source).toBe('CAMERA_HOLD');
    expect(d.bearing, 'kamera kuzeye çevrildi — bu bir karar değil, kayıp varsayılandır').toBe(123);
  });

  it('🔒 mevcut yön de okunamıyorsa bearing NULL döner (uydurma YOK)', () => {
    const d = resolveEntryBearing({
      routeBearing: null, gpsHeading: null, speedKmh: null, currentBearing: null,
    });
    expect(d.source).toBe('CAMERA_HOLD');
    expect(d.bearing).toBeNull();
  });

  it('🔒 açılar 0..360 aralığına normalize edilir (negatif GPS heading tuzağı)', () => {
    const d = resolveEntryBearing({
      routeBearing: null, gpsHeading: -42.5, speedKmh: 80, currentBearing: 0,
    });
    expect(d.bearing).toBeCloseTo(317.5, 6);
  });

  it('🔒 NaN/Infinity yön kaynağı YOK SAYILIR', () => {
    const d = resolveEntryBearing({
      routeBearing: Number.NaN, gpsHeading: Number.POSITIVE_INFINITY,
      speedKmh: 0, currentBearing: 45,
    });
    expect(d.source).toBe('CAMERA_HOLD');
    expect(d.bearing).toBe(45);
  });

  it('🔒 hareket hâlinde GPS yoksa rotaya düşer (kamera boşta kalmaz)', () => {
    const d = resolveEntryBearing({
      routeBearing: 30, gpsHeading: null, speedKmh: 90, currentBearing: 0,
    });
    expect(d.source).toBe('ROUTE');
    expect(d.bearing).toBe(30);
  });

  it('🔒 her kararın GEREKÇESİ vardır — LAB boş metin göstermez', () => {
    const cases = [
      { routeBearing: 10, gpsHeading: 20, speedKmh: 0, currentBearing: 0 },
      { routeBearing: null, gpsHeading: 20, speedKmh: 0, currentBearing: 0 },
      { routeBearing: null, gpsHeading: null, speedKmh: 0, currentBearing: 0 },
      { routeBearing: 10, gpsHeading: 20, speedKmh: 90, currentBearing: 0 },
    ];
    for (const c of cases) {
      expect(resolveEntryBearing(c).reason.length).toBeGreaterThan(20);
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * B — ROTANIN İLERİ YÖNÜ (tek otorite)
 * ════════════════════════════════════════════════════════════════════════ */

describe('#625 — rotanın ileri yönü: TEK otorite, gürültü ÜRETMEZ', () => {
  const AT_LAT = 36.9176, AT_LNG = 34.8620;

  it('🔒 `currentStepIndex + 1` adımı kullanılır (ürünün mevcut kuralı)', () => {
    const steps = [
      { coordinate: [34.8620, 36.9176] },            // 0 — kalkış
      { coordinate: [34.8620, 36.9276] },            // 1 — KUZEY (~1,1 km)
      { coordinate: [34.8720, 36.9176] },            // 2 — doğu
    ];
    const b = resolveRouteForwardBearing(AT_LAT, AT_LNG, steps, 0);
    expect(b).not.toBeNull();
    /* Kuzey = 0°; sarma nedeniyle 360'a çok yakın da olabilir. */
    expect(Math.min(b!, 360 - b!), `kuzey beklenirken ${b}° geldi`).toBeLessThan(1.5);
    /* Adım 2 (doğu) SEÇİLMEDİĞİNİN kanıtı — indeks kuralı korunuyor. */
    expect(Math.abs(b! - 90)).toBeGreaterThan(45);
  });

  it('🔒 doğu yönü ≈90° — açı sözleşmesi (0=kuzey, saat yönü)', () => {
    const steps = [{ coordinate: [0, 0] }, { coordinate: [34.8720, 36.9176] }];
    const b = resolveRouteForwardBearing(AT_LAT, AT_LNG, steps, 0);
    expect(b!).toBeGreaterThan(88);
    expect(b!).toBeLessThan(92);
  });

  it(`🔒 taban ${ROUTE_FORWARD_MIN_M} m altındaysa yön ÜRETİLMEZ (gürültü yasağı)`, () => {
    /* ~5 m kuzey — eşiğin altında. */
    const steps = [{ coordinate: [0, 0] }, { coordinate: [AT_LNG, AT_LAT + 0.000045] }];
    expect(resolveRouteForwardBearing(AT_LAT, AT_LNG, steps, 0)).toBeNull();
  });

  it('🔒 adım yok / indeks sınır dışı / koordinat bozuk → null (uydurma YOK)', () => {
    expect(resolveRouteForwardBearing(AT_LAT, AT_LNG, null, 0)).toBeNull();
    expect(resolveRouteForwardBearing(AT_LAT, AT_LNG, [], 0)).toBeNull();
    expect(resolveRouteForwardBearing(AT_LAT, AT_LNG, [{ coordinate: [1, 1] }], 0)).toBeNull();
    expect(resolveRouteForwardBearing(AT_LAT, AT_LNG, [{}, {}], 0)).toBeNull();
    expect(resolveRouteForwardBearing(AT_LAT, AT_LNG, [{}, { coordinate: [Number.NaN, 1] }], 0)).toBeNull();
    expect(resolveRouteForwardBearing(Number.NaN, AT_LNG, [{}, { coordinate: [1, 1] }], 0)).toBeNull();
  });

  it('🔒 ÜRÜN bu otoriteyi kullanır — iki ekranda paralel `atan2` kopyası KALMADI', () => {
    const root = join(process.cwd(), 'src', 'components', 'map');
    const mini = readFileSync(join(root, 'MiniMapWidget.tsx'), 'utf8');
    const full = readFileSync(join(root, 'FullMapView.tsx'), 'utf8');
    expect(mini).toContain('resolveRouteForwardBearing');
    expect(full).toContain('resolveRouteForwardBearing');
    /* Eski elle hesap geri gelirse kilit düşer. */
    expect(mini).not.toContain('Math.atan2(_dLon, _dLat)');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * C — GÖRÜNÜRLÜK ÖLÇÜMÜ
 * ════════════════════════════════════════════════════════════════════════ */

/** Sahte MapLibre — YAZMA çağrılarını sayar, projeksiyonu kontrol edilebilir. */
function makeProjMap(opts: {
  w?: number; h?: number; zoom?: number; bearing?: number; pitch?: number;
  /** lngLat → ekran; testin çizmek istediği senaryo. */
  project: (p: [number, number]) => { x: number; y: number };
  /** Gidiş-dönüş; verilmezse birebir döner (ufuk-ötesi yok). */
  unproject?: (xy: [number, number]) => { lng: number; lat: number };
  layers?: readonly string[];
  rendered?: number;
}) {
  const writes: string[] = [];
  const present = new Set(opts.layers ?? [
    'car-route-shadow', 'car-route-glow-sel', 'car-route-casing',
    'selected-route-layer', 'car-route-flow',
  ]);
  let lastProjected: [number, number] = [0, 0];
  const map = {
    getContainer: () => ({ clientWidth: opts.w ?? 902, clientHeight: opts.h ?? 405 }),
    getZoom:    () => opts.zoom ?? 18,
    getPitch:   () => opts.pitch ?? 38,
    getBearing: () => opts.bearing ?? -42.5,
    getLayer:   (id: string) => (present.has(id) ? { id } : undefined),
    project: (p: [number, number]) => { lastProjected = p; return opts.project(p); },
    unproject: (xy: [number, number]) => (
      opts.unproject ? opts.unproject(xy) : { lng: lastProjected[0], lat: lastProjected[1] }
    ),
    queryRenderedFeatures: () => new Array(opts.rendered ?? 0).fill({}),
    // Yazma yüzeyleri — çağrılırsa kilit DÜŞER.
    setPaintProperty: () => { writes.push('setPaintProperty'); },
    setLayoutProperty: () => { writes.push('setLayoutProperty'); },
    addLayer: () => { writes.push('addLayer'); },
    easeTo:   () => { writes.push('easeTo'); },
    jumpTo:   () => { writes.push('jumpTo'); },
    setData:  () => { writes.push('setData'); },
  };
  return { map, writes };
}

/** Mersin ölçümüne yakın bir rota: araçtan güneybatıya, 309 nokta. */
function makeRoute(n = 309): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    out.push([34.862289 - i * 0.00075, 36.917448 - i * 0.00039]);
  }
  return out;
}

describe('#625 — geometri yankısı BOUNDED ve dürüst', () => {
  beforeEach(() => { _resetRouteGeometryEchoForTest(); });

  it(`🔒 ${ROUTE_GEOM_SAMPLE_MAX} örnek tavanı aşılmaz; ilk ve son nokta DAİMA dâhil`, () => {
    const route = makeRoute(1000);
    rememberRouteGeometry(route, 1_000);
    const e = getRouteGeometryEcho()!;
    expect(e.totalPoints).toBe(1000);
    expect(e.sample.length).toBeLessThanOrEqual(ROUTE_GEOM_SAMPLE_MAX);
    expect(e.sample[0]).toEqual(route[0]);
    expect(e.sample[e.sample.length - 1]).toEqual(route[999]);
  });

  it('🔒 kısa rota tamamen taşınır (bilgi kaybı yok)', () => {
    rememberRouteGeometry([[1, 1], [2, 2], [3, 3]], 1_000);
    expect(getRouteGeometryEcho()!.sample.length).toBe(3);
  });

  it('🔒 rota kaldırılınca yankı TEMİZLENİR — hayalet kök adayı üretilmez', () => {
    rememberRouteGeometry(makeRoute(50), 1_000);
    expect(getRouteGeometryEcho()).not.toBeNull();
    rememberRouteGeometry(null, 2_000);
    expect(getRouteGeometryEcho()).toBeNull();
    rememberRouteGeometry([[1, 1]], 3_000);   // tek nokta = rota değil
    expect(getRouteGeometryEcho()).toBeNull();
  });
});

describe('#625 — görünürlük ölçümü SALT-OKUNUR ve kanıtsız bilgi üretmez', () => {
  beforeEach(() => { _resetRouteGeometryEchoForTest(); });

  it('🔒 ölçüm haritaya TEK BİR YAZMA bile yapmaz', () => {
    rememberRouteGeometry(makeRoute(), 1_000);
    const { map, writes } = makeProjMap({ project: () => ({ x: 100, y: 100 }), rendered: 3 });
    captureRouteVisibility(map as never, 2_000, true);
    expect(writes, `ölçüm yolu haritaya yazdı: ${writes.join(', ')}`).toEqual([]);
  });

  it('🔒 harita YOKSA sayımlar null — sahte 0 ÜRETİLMEZ', () => {
    rememberRouteGeometry(makeRoute(), 1_000);
    const s = captureRouteVisibility(null, 2_000, true);
    expect(s.sampled).toBeNull();
    expect(s.onScreen).toBeNull();
    expect(s.renderedFeatures).toBeNull();
    expect(s.geometryAgeMs).toBe(1_000);
  });

  it('🔒 rota YOKSA sayımlar null — "ölçemedim" ile "görünmüyor" ayrı', () => {
    const { map } = makeProjMap({ project: () => ({ x: 10, y: 10 }) });
    const s = captureRouteVisibility(map as never, 2_000, false);
    expect(s.sampled).toBeNull();
    expect(s.onScreen).toBeNull();
    expect(s.totalPoints).toBeNull();
  });

  it('🔒 `withRendered` istenmediyse render kanıtı NULL kalır (0 değil)', () => {
    rememberRouteGeometry(makeRoute(), 1_000);
    const { map } = makeProjMap({ project: () => ({ x: 10, y: 10 }), rendered: 7 });
    expect(captureRouteVisibility(map as never, 2_000, false).renderedFeatures).toBeNull();
    expect(captureRouteVisibility(map as never, 2_000, true).renderedFeatures).toBe(7);
  });

  it('🔒 CİHAZDA ÖLÇÜLEN KUSUR: tüm noktalar pencerenin ALTINDA → onScreen 0', () => {
    /* Ölçümün birebir kendisi: pencere 902×405, rota y≥432. */
    rememberRouteGeometry(makeRoute(), 1_000);
    const { map } = makeProjMap({
      w: 902, h: 405, rendered: 0,
      project: (p) => ({ x: 465, y: 432 + (36.917448 - p[1]) * 1000 }),
    });
    const s = captureRouteVisibility(map as never, 2_000, true);
    expect(s.sampled).toBeGreaterThan(0);
    expect(s.onScreen, 'ekran dışındaki rota "görünüyor" sayıldı').toBe(0);
    expect(s.headOnScreen).toBe(0);
    expect(s.renderedFeatures).toBe(0);
  });

  it('🔒 hepsi içerideyse onScreen === sampled (ölçüm gerçekten çalışıyor)', () => {
    rememberRouteGeometry(makeRoute(), 1_000);
    const { map } = makeProjMap({ w: 902, h: 405, project: () => ({ x: 451, y: 200 }), rendered: 3 });
    const s = captureRouteVisibility(map as never, 2_000, true);
    expect(s.onScreen).toBe(s.sampled);
    expect(s.headOnScreen).toBe(s.headSampled);
  });

  it('🔒 UFUK-ÖTESİ eleme: ekran koordinatı üretse de gidiş-dönüş tutmuyorsa SAYILMAZ', () => {
    /* Eğik kamerada kameranın ARKASINDAKİ noktalar da ekrana düşer; bu
       yanlış-pozitif "görünüyor" ölçümü kökü gizlerdi. */
    rememberRouteGeometry(makeRoute(), 1_000);
    const { map } = makeProjMap({
      w: 902, h: 405, zoom: 18,
      project: () => ({ x: 451, y: 200 }),
      unproject: () => ({ lng: 0, lat: 0 }),   // asla orijinale dönmez
    });
    const s = captureRouteVisibility(map as never, 2_000, false);
    expect(s.onScreen).toBe(0);
  });

  it('🔒 kamera ↔ rota yön farkı ölçülür (kökün imzası)', () => {
    rememberRouteGeometry(makeRoute(), 1_000);
    const { map } = makeProjMap({ bearing: -42.5, project: () => ({ x: 1e6, y: 1e6 }) });
    const s = captureRouteVisibility(map as never, 2_000, false);
    expect(s.routeBearing).not.toBeNull();
    /* Rota güneybatıya gidiyor (~242°), kamera 317,5° → fark 90°'den büyük. */
    expect(s.bearingDeltaDeg!).toBeGreaterThan(60);
  });

  it('🔒 açı farkı ve px/metre matematiği doğrudur', () => {
    expect(angleDelta(350, 10)).toBe(20);
    expect(angleDelta(10, 350)).toBe(20);
    expect(angleDelta(0, 180)).toBe(180);
    expect(angleDelta(-42.5, 317.5)).toBeCloseTo(0, 6);
    /* Ekvatorda z=0 → ~156 km/px; z arttıkça yarılanır. */
    expect(metersPerPixel(0, 0)).toBeCloseTo(156543.03392, 3);
    expect(metersPerPixel(1, 0)).toBeCloseTo(78271.51696, 3);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * D — DENETÇİ: boya kusursuzken kökü GÖRÜR
 * ════════════════════════════════════════════════════════════════════════ */

/** #625'in cihaz ölçümü: gece boyası KUSURSUZ. */
function healthyNightProbe(overrides: Partial<RouteLayerProbe> = {}): RouteLayerProbe {
  return {
    capturedAt: 10_000,
    reason: 'manual',
    mapPresent: true,
    styleLoaded: true,
    perfLow: false,
    sourcePresent: true,
    sourceLineMetrics: true,
    layers: [
      {
        id: 'car-route-shadow', present: true, zIndex: 31,
        lineColor: '#000000', lineColorIsExpression: false, lineColorUnset: false,
        hasGradient: false, gradientStops: [], lineOpacity: 0.2, lineBlur: 3,
        widthIsExpression: true, widthValue: null,
      },
      {
        id: 'car-route-glow-sel', present: true, zIndex: 32,
        lineColor: '#4285f4', lineColorIsExpression: false, lineColorUnset: false,
        hasGradient: false, gradientStops: [], lineOpacity: 0.2, lineBlur: 3,
        widthIsExpression: true, widthValue: null,
      },
      {
        id: 'car-route-casing', present: true, zIndex: 33,
        lineColor: '#f59e0b', lineColorIsExpression: false, lineColorUnset: false,
        hasGradient: false, gradientStops: [], lineOpacity: 0.95, lineBlur: null,
        widthIsExpression: true, widthValue: null,
      },
      {
        id: 'selected-route-layer', present: true, zIndex: 34,
        lineColor: null, lineColorIsExpression: false, lineColorUnset: false,
        hasGradient: true, gradientStops: ['#79b0ff', '#a5aaff', '#34d399'],
        lineOpacity: 1, lineBlur: null, widthIsExpression: true, widthValue: null,
      },
      {
        id: 'car-route-flow', present: true, zIndex: 35,
        lineColor: null, lineColorIsExpression: false, lineColorUnset: false,
        hasGradient: true, gradientStops: ['rgba(255,255,255,0)', 'rgba(255,255,255,0.80)'],
        lineOpacity: 0.85, lineBlur: null, widthIsExpression: true, widthValue: null,
      },
    ],
    visibility: null,
    ...overrides,
  };
}

const OFF_SCREEN_VIS = {
  capturedAt: 10_000, geometryAgeMs: 4_000,
  viewportW: 902, viewportH: 405, zoom: 18, pitch: 38, bearing: 317.5,
  totalPoints: 309, sampled: 64, onScreen: 0,
  headSampled: 16, headOnScreen: 0,
  routeBearing: 242, bearingDeltaDeg: 75.5, renderedFeatures: 0,
};

describe('#625 — denetçi: "boya doğru" ile "ekranda var" ayrımı', () => {
  it('🔒 #624 KÖR NOKTASI: kusursuz boya + görünürlük ölçümü YOK → hiçbir kök bulunmaz', () => {
    /* Bu, cihazda gerçekten yaşanan durumdur: ekran "kök adayı yok" derdi. */
    const f = deriveRouteFindings(healthyNightProbe(), resolveRouteColor({
      maneuverTier: 0, hazardHigh: false, lightBasemap: false,
    }));
    expect(f.filter((x) => x.severity === 'ROOT')).toHaveLength(0);
  });

  it('🔒 AYNI boya + görünürlük ölçümü VAR → KÖK ADAYI üretilir', () => {
    const f = deriveRouteFindings(
      healthyNightProbe({ visibility: OFF_SCREEN_VIS }),
      resolveRouteColor({ maneuverTier: 0, hazardHigh: false, lightBasemap: false }),
    );
    const roots = f.filter((x) => x.severity === 'ROOT');
    expect(roots.length, 'ekran dışındaki rota için kök adayı üretilmedi').toBeGreaterThan(0);
    expect(roots.some((x) => x.id === 'route-off-screen')).toBe(true);
    /* Kanıt SAYI içerir — genel laf değil. */
    const ev = roots.find((x) => x.id === 'route-off-screen')!.evidence;
    expect(ev).toContain('309');
    expect(ev).toContain('902×405');
  });

  it('🔒 kamera rotanın TERSİNE bakıyorsa uyarı üretilir', () => {
    const f = deriveRouteFindings(
      healthyNightProbe({
        visibility: { ...OFF_SCREEN_VIS, onScreen: 40, headOnScreen: 8, bearingDeltaDeg: 140 },
      }),
      null,
    );
    expect(f.some((x) => x.id === 'camera-against-route')).toBe(true);
  });

  it('🔒 rota ekranda ama BAŞI görünmüyorsa kök adayıdır (navigasyon işlevsiz)', () => {
    const f = deriveRouteFindings(
      healthyNightProbe({
        visibility: { ...OFF_SCREEN_VIS, onScreen: 12, headOnScreen: 0, bearingDeltaDeg: 20 },
      }),
      null,
    );
    expect(f.some((x) => x.id === 'route-head-off-screen' && x.severity === 'ROOT')).toBe(true);
  });

  it('🔒 türetilen sayım ile MapLibre render kanıtı ÇELİŞİRSE beyan edilir', () => {
    const f = deriveRouteFindings(
      healthyNightProbe({
        visibility: { ...OFF_SCREEN_VIS, onScreen: 30, headOnScreen: 8, renderedFeatures: 0 },
      }),
      null,
    );
    expect(f.some((x) => x.id === 'render-contradiction')).toBe(true);
  });

  it('🔒 sağlıklı görünürlükte görünürlük kökü ÜRETİLMEZ (yanlış alarm yok)', () => {
    const f = deriveRouteFindings(
      healthyNightProbe({
        visibility: {
          ...OFF_SCREEN_VIS, onScreen: 48, headOnScreen: 16,
          bearingDeltaDeg: 5, renderedFeatures: 3,
        },
      }),
      null,
    );
    expect(f.filter((x) => x.severity === 'ROOT')).toHaveLength(0);
    expect(f.some((x) => x.id === 'camera-against-route')).toBe(false);
  });
});

describe('#625 — görünüm: ölçümün YOKLUĞU da beyan edilir', () => {
  it('🔒 görünürlük ölçülmediyse `visibilityMeasured` false ve UNAVAILABLE satır çıkar', () => {
    const v = buildRouteLayerView(healthyNightProbe(), null, 10_000);
    expect(v.visibilityMeasured).toBe(false);
    expect(v.visibilityRows.length).toBeGreaterThan(0);
    expect(v.visibilityRows[0].klass).toBe('UNAVAILABLE');
  });

  it('🔒 ölçüldüyse satırlar sayıyla dolar ve render kanıtı OBSERVED olur', () => {
    const v = buildRouteLayerView(
      healthyNightProbe({ visibility: OFF_SCREEN_VIS }), null, 10_000,
    );
    expect(v.visibilityMeasured).toBe(true);
    const onScreen = v.visibilityRows.find((r) => r.id === 'vis-onscreen')!;
    expect(onScreen.value).toBe('0/64');
    expect(onScreen.klass).toBe('DERIVED');
    const rendered = v.visibilityRows.find((r) => r.id === 'vis-rendered')!;
    expect(rendered.klass).toBe('OBSERVED');
  });

  it('🔒 fotoğraf yoksa görünürlük satırı yine de VAR (sessiz kalmaz)', () => {
    const v = buildRouteLayerView(null, null, 10_000);
    expect(v.visibilityMeasured).toBe(false);
    expect(v.visibilityRows.length).toBeGreaterThan(0);
  });

  it('🔒 ekranın hüküm metni ölçüm yokken "kök adayı yok"u NİTELER', () => {
    const src = readFileSync(
      join(process.cwd(), 'src', 'components', 'devtools', 'screens', 'RouteLayerInspectorScreen.tsx'),
      'utf8',
    );
    expect(src).toContain('visibilityMeasured');
    expect(src).toContain('GÖRÜNÜRLÜK ÖLÇÜLMEDİ');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * E — SICAK YOL BÜTÇESİ
 * ════════════════════════════════════════════════════════════════════════ */

describe('#625 — pahalı ölçüm SICAK YOLDA çalışmaz', () => {
  beforeEach(() => { _resetRouteGeometryEchoForTest(); });

  it('🔒 renk yazımının fotoğrafı görünürlük ölçümü TAŞIMAZ', () => {
    /* `_applyRouteColorDecision` her renk kararında fotoğraf alır; orada
       projeksiyon + `queryRenderedFeatures` çalıştırmak Mali-400 sınıfı bir
       head unit'te bütçeyi bozardı. */
    const p = captureRouteLayerProbe(null, 'color');
    expect(p.visibility).toBeNull();
  });

  it('🔒 ÜRÜN sıcak yolda `withVisibility` İSTEMEZ, LAB ister', () => {
    const layerMgr = readFileSync(
      join(process.cwd(), 'src', 'platform', 'map', 'MapLayerManager.ts'), 'utf8');
    const labSrc = readFileSync(
      join(process.cwd(), 'src', 'platform', 'devtools', 'routeLayerSources.ts'), 'utf8');
    expect(layerMgr).toContain("captureRouteLayerProbe(map, 'color')");
    expect(labSrc).toContain("captureRouteLayerProbe(map, 'manual', true)");
  });

  it('🔒 geometri yankısı ürünün TEK yazıcısına bağlıdır (kurulum + kırpma + temizlik)', () => {
    const src = readFileSync(
      join(process.cwd(), 'src', 'platform', 'map', 'MapLayerManager.ts'), 'utf8');
    const hits = src.split('rememberRouteGeometry(').length - 1;
    /* ÜÇ yazıcı: kurulum `setData` · kat edilen kısmın kırpılması · rota temizliği.
       Biri kaçarsa ölçüm bayat ya da hayalet geometri okur. */
    expect(hits, 'geometri yazıcılarından biri yankılamıyor — ölçüm bayat geometri okur')
      .toBeGreaterThanOrEqual(3);
  });
});
