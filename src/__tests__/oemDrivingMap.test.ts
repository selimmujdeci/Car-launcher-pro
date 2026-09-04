/**
 * oemDrivingMap.test — P0-NAV-03 · OEM+ sürüş haritası saf modelleri.
 *
 * Üç sözleşme kilitlenir: gürültü (declutter) · rota vurgusu · kamera
 * kompozisyonu. Hepsi SAF — harita/DOM/zaman gerekmez.
 */

import { describe, it, expect } from 'vitest';

import {
  resolveDeclutter, DECLUTTER_OWNED_LAYERS, DECLUTTER_POLICY_VERSION,
  MINI_ROAD_LABEL_FACTOR, MINI_ROAD_BODY_FACTOR,
} from '../platform/map/core/mapDeclutterModel';
import { NAV_SUPPRESS_TIERS } from '../platform/mapStyleBuilders';
import {
  resolveRouteEmphasis, routeConfidenceFrom, ALT_MAX_OPACITY,
  MIN_MAIN_OVER_ALT_RATIO, PROVISIONAL_DASH,
} from '../platform/map/core/routeEmphasisModel';
import {
  resolveTopPadForAnchor, updateAnchorBias, limitStep, limitAngleStep,
  ANCHOR_MIN, ANCHOR_MAX, ANCHOR_MAX_STEP, ANCHOR_BIAS_DEADBAND,
} from '../platform/map/core/cameraCompositionModel';
import {
  SPEED_BANDS, resolveSpeedBand, resolveManeuverBand, MANEUVER_BANDS,
} from '../platform/navigation/core/cameraPolicyModel';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const TIER0 = NAV_SUPPRESS_TIERS[0];

/* ══ 1. GÜRÜLTÜ SÖZLEŞMESİ ═══════════════════════════════════════════════ */

describe('P0-NAV-03 · gürültü sözleşmesi', () => {
  it('TEK OTORİTE: yol katmanları bu modelde YENİDEN TANIMLANMAZ', () => {
    /* `NAV_SUPPRESS_TIERS` yol katmanlarının tek sahibidir. Bu modelin sahip
       olduğu liste onunla KESİŞMEMELİ; kesişirse hangi değerin kazandığı çağrı
       sırasına kalır — depoda kayıtlı "iki otorite" kusur sınıfı. */
    const roadIds = new Set(TIER0.map(([id]) => id));
    for (const id of DECLUTTER_OWNED_LAYERS) {
      expect(roadIds.has(id), `${id} iki otoriteye birden ait`).toBe(false);
    }
  });

  it('TAM EKRAN: yol tablosu AYNEN geçirilir (bugünkü davranış korunur)', () => {
    for (let tier = 0; tier < NAV_SUPPRESS_TIERS.length; tier++) {
      const table = NAV_SUPPRESS_TIERS[tier];
      const d = resolveDeclutter(
        { surface: 'FULL', night: false, navActive: true, tier }, table,
      );
      expect(d.roadEntries).toEqual(table.map(([a, b, c]) => [a, b, c]));
    }
  });

  it('MİNİ: yol GÖVDESİ korunur, ETİKET agresif iner', () => {
    const d = resolveDeclutter(
      { surface: 'MINI', night: false, navActive: true, tier: 0 }, TIER0,
    );
    for (const [id, prop, value] of d.roadEntries) {
      const src = TIER0.find(([i, p]) => i === id && p === prop)!;
      const factor = prop === 'text-opacity' ? MINI_ROAD_LABEL_FACTOR : MINI_ROAD_BODY_FACTOR;
      expect(value).toBeCloseTo(src[2] * factor, 3);
    }
    /* Sürüş bağlamı = yol ağı. Gövde asla yarıdan aşağı inmez. */
    const bodies = d.roadEntries.filter(([, p]) => p !== 'text-opacity');
    for (const [id, , v] of bodies) expect(v, id).toBeGreaterThan(0.5);
  });

  it('MİNİ: bina · POI · şehir etiketi · kalkan TAMAMEN kapanır', () => {
    const d = resolveDeclutter(
      { surface: 'MINI', night: true, navActive: true, tier: 0 }, TIER0,
    );
    const off = ['building', 'building-3d', 'poi-gas', 'poi-hospital',
                 'poi-parking', 'poi-police', 'place-city', 'road-shield'];
    for (const id of off) {
      const e = d.noiseEntries.find(([i]) => i === id);
      expect(e, `${id} mini profilinde yok`).toBeDefined();
      expect(e![2], `${id} mini haritada hâlâ çiziliyor`).toBe(0);
    }
  });

  it('TAM EKRAN: hiçbir gürültü katmanı SIFIRA indirilmez (bağlam korunur)', () => {
    for (const night of [false, true]) {
      for (const navActive of [false, true]) {
        const d = resolveDeclutter({ surface: 'FULL', night, navActive, tier: 0 }, TIER0);
        for (const [id, , v] of d.noiseEntries) {
          expect(v, `${id} tam ekranda söndürülmüş (night=${night} nav=${navActive})`)
            .toBeGreaterThan(0);
        }
      }
    }
  });

  it('rehberlik başlayınca gürültü ARTMAZ (monotonik geri çekilme)', () => {
    for (const surface of ['FULL', 'MINI'] as const) {
      for (const night of [false, true]) {
        const idle = resolveDeclutter({ surface, night, navActive: false, tier: 0 }, TIER0);
        const nav  = resolveDeclutter({ surface, night, navActive: true,  tier: 0 }, TIER0);
        for (const [id, , v] of nav.noiseEntries) {
          const before = idle.noiseEntries.find(([i]) => i === id)![2];
          expect(v, `${id} rehberlikte ARTMIŞ`).toBeLessThanOrEqual(before);
        }
      }
    }
  });

  it('GECE gündüzün kopyası DEĞİL — bina kütlesi gece daha çok geri çekilir', () => {
    const day   = resolveDeclutter({ surface: 'FULL', night: false, navActive: true, tier: 0 }, TIER0);
    const night = resolveDeclutter({ surface: 'FULL', night: true,  navActive: true, tier: 0 }, TIER0);
    const b = (d: typeof day, id: string) => d.noiseEntries.find(([i]) => i === id)![2];
    expect(b(night, 'building')).toBeLessThan(b(day, 'building'));
    expect(b(night, 'building-3d')).toBeLessThan(b(day, 'building-3d'));
  });

  it('sözleşme SÜRÜMLÜ ve karar gerekçeli', () => {
    const d = resolveDeclutter({ surface: 'MINI', night: true, navActive: true, tier: 0 }, TIER0);
    expect(d.policyVersion).toBe(DECLUTTER_POLICY_VERSION);
    expect(d.reason.length).toBeGreaterThan(8);
    expect(d.entries.length).toBe(d.roadEntries.length + d.noiseEntries.length);
  });
});

/* ══ 2. ROTA VURGUSU ═════════════════════════════════════════════════════ */

describe('P0-NAV-03 · rota görsel dili', () => {
  const base = { navActive: true, lightBasemap: false, altCount: 2 } as const;

  it('alternatif ana rotayla YARIŞMAZ', () => {
    const d = resolveRouteEmphasis({ confidence: 'CONFIRMED', ...base });
    expect(d.altOpacity).toBeLessThanOrEqual(ALT_MAX_OPACITY);
    expect(d.mainOverAltRatio,
      'ana rota alternatiften yeterince baskın değil')
      .toBeGreaterThanOrEqual(MIN_MAIN_OVER_ALT_RATIO);
  });

  it('rehberlik başlayınca alternatif DAHA DA geri çekilir', () => {
    const preview = resolveRouteEmphasis({ confidence: 'CONFIRMED', ...base, navActive: false });
    const driving = resolveRouteEmphasis({ confidence: 'CONFIRMED', ...base, navActive: true });
    expect(driving.altOpacity).toBeLessThan(preview.altOpacity);
  });

  it('alternatif yoksa alternatif katmanı ÇİZİLMEZ', () => {
    const d = resolveRouteEmphasis({ confidence: 'CONFIRMED', ...base, altCount: 0 });
    expect(d.altOpacity).toBe(0);
    expect(d.mainOverAltRatio).toBe(Number.POSITIVE_INFINITY);
  });

  it('DÜZ HAT görsel KESİNLİK İDDİA ETMEZ', () => {
    const d = resolveRouteEmphasis({ confidence: 'PROVISIONAL', ...base });
    expect(d.coreDashed, 'düz hat kesintisiz çiziliyor').toBe(true);
    expect(d.coreDashArray).toEqual(PROVISIONAL_DASH);
    /* Olmayan bir yolda ilerleme animasyonu göstermek görsel bir yalandır. */
    expect(d.flowOpacity, 'düz hatta akış animasyonu açık').toBe(0);
    const confirmed = resolveRouteEmphasis({ confidence: 'CONFIRMED', ...base });
    expect(d.coreOpacity).toBeLessThan(confirmed.coreOpacity);
    expect(d.casingOpacity).toBeLessThan(confirmed.casingOpacity);
  });

  it('KUSURLU gerçek rota okunabilir kalır; dürüstlüğü HUD etiketi taşır', () => {
    const d = resolveRouteEmphasis({ confidence: 'DEGRADED', ...base });
    expect(d.coreOpacity).toBe(1);
    expect(d.coreDashed, 'kusurlu rota kesik çiziliyor (yalnız düz hat kesiktir)').toBe(false);
  });

  it('gündüz beyaz flow katmanı mavi çekirdeği maskelemez', () => {
    const d = resolveRouteEmphasis({ confidence: 'DEGRADED', ...base, lightBasemap: true });
    expect(d.flowOpacity).toBeLessThan(0.3);
    expect(d.flowOpacity).toBeLessThan(d.coreOpacity / 3);
  });

  it('akış animasyonu rehberlik YOKKEN çizilmez', () => {
    const d = resolveRouteEmphasis({ confidence: 'CONFIRMED', ...base, navActive: false });
    expect(d.flowOpacity).toBe(0);
  });

  it('güven sınıfı MEVCUT hükümlerden türer — fail-closed', () => {
    expect(routeConfidenceFrom('straight-line', 'VALID')).toBe('PROVISIONAL');
    expect(routeConfidenceFrom('osrm.route.at', 'VALID')).toBe('CONFIRMED');
    expect(routeConfidenceFrom('osrm.route.at', 'DEGRADED')).toBe('DEGRADED');
    /* Hüküm yoksa KESİN sayılmaz. */
    expect(routeConfidenceFrom('osrm.route.at', null)).toBe('DEGRADED');
    expect(routeConfidenceFrom('osrm.route.at', 'UNKNOWN')).toBe('DEGRADED');
    expect(routeConfidenceFrom(null, null)).toBe('DEGRADED');
  });

  it('RENK ve GENİŞLİK üretmez (başka otoritelerin işi)', () => {
    const d = resolveRouteEmphasis({ confidence: 'CONFIRMED', ...base });
    const json = JSON.stringify(d);
    expect(json).not.toMatch(/#[0-9a-fA-F]{6}/);          // renk yok
    expect(Object.keys(d)).not.toContain('width');
    expect(Object.keys(d)).not.toContain('coreWidth');
  });
});

/* ══ 3. KAMERA KOMPOZİSYONU ══════════════════════════════════════════════ */

describe('P0-NAV-03 · kamera kompozisyonu', () => {
  const H = 600;

  it('anchor arttıkça araç AŞAĞI iner (padding büyür)', () => {
    const a = resolveTopPadForAnchor({ anchorY: 0.55, containerHeight: H, lookAheadPx: 0 });
    const b = resolveTopPadForAnchor({ anchorY: 0.68, containerHeight: H, lookAheadPx: 0 });
    expect(b.topPad).toBeGreaterThan(a.topPad);
  });

  it('geometri TERSİNİR: padding uygulanınca istenen anchor elde edilir', () => {
    for (const anchor of [0.50, 0.58, 0.66, 0.72]) {
      for (const look of [0, 40, 90]) {
        const r = resolveTopPadForAnchor({ anchorY: anchor, containerHeight: H, lookAheadPx: look });
        if (!r.clamped) expect(r.effectiveAnchorY).toBeCloseTo(anchor, 6);
      }
    }
  });

  it('güvenlik bandı: araç ekranın son şeridine İTİLEMEZ', () => {
    const low  = resolveTopPadForAnchor({ anchorY: 0.05, containerHeight: H, lookAheadPx: 0 });
    const high = resolveTopPadForAnchor({ anchorY: 0.99, containerHeight: H, lookAheadPx: 0 });
    expect(low.clamped).toBe(true);
    expect(high.clamped).toBe(true);
    expect(high.effectiveAnchorY).toBeLessThanOrEqual(ANCHOR_MAX + 1e-9);
    expect(low.effectiveAnchorY).toBeGreaterThanOrEqual(ANCHOR_MIN - 1e-9);
  });

  it('ÖLÇÜLEMEYEN girdide kompozisyon UYGULANMAZ (uydurma padding yok)', () => {
    for (const bad of [0, -1, NaN]) {
      const r = resolveTopPadForAnchor({ anchorY: 0.6, containerHeight: bad, lookAheadPx: 0 });
      expect(r.topPad).toBe(0);
      expect(r.clamped).toBe(true);
    }
  });

  it('POLİTİKA ile aynı dili konuşur — her hız bandı geçerli anchor üretir', () => {
    for (const b of SPEED_BANDS) {
      for (const a of [b.anchorYLandscape, b.anchorYPortrait]) {
        const r = resolveTopPadForAnchor({ anchorY: a, containerHeight: H, lookAheadPx: 0 });
        expect(r.clamped, `${b.id} anchor ${a} bandın DIŞINDA`).toBe(false);
      }
    }
  });

  it('hız arttıkça araç AŞAĞI iner (ileri görüş açılır)', () => {
    /* Kompozisyonun ürün iddiası: sürüşte araç geometrik merkezde DURMAZ. */
    const city = SPEED_BANDS.find((b) => b.id === 'CITY')!;
    const hw   = SPEED_BANDS.find((b) => b.id === 'HIGHWAY')!;
    expect(hw.anchorYLandscape).toBeGreaterThan(city.anchorYLandscape);
    expect(city.anchorYLandscape).toBeGreaterThan(0.5);
  });

  /* ── Sıçrama sınırlayıcı ── */

  it('tek karede anchor sıçraması KESİLİR', () => {
    const jumped = limitStep(0.58, 0.68, ANCHOR_MAX_STEP);
    expect(jumped).toBeCloseTo(0.60, 6);
    /* İlk karede sınır YOK — açılışta yapay yavaşlama olmaz. */
    expect(limitStep(null, 0.68, ANCHOR_MAX_STEP)).toBe(0.68);
  });

  it('bearing sınırlayıcı 0/360 sarmasını DOĞRU ele alır', () => {
    /* 350° → 10° gerçek fark +20°'dir, −340° değil. */
    expect(limitAngleStep(350, 10, 12)).toBeCloseTo(2, 6);
    expect(limitAngleStep(10, 350, 12)).toBeCloseTo(358, 6);
    expect(limitAngleStep(10, 15, 12)).toBe(15);
  });

  /* ── Ölçülen geri besleme ── */

  it('bias ÖLÇÜLEN hatayı kapatır ve YAKINSAR (salınmaz)', () => {
    /* Gerçek dünyada araç istenenden 0,10 aşağıda çıkıyor olsun. */
    const desired = 0.62;
    const OFFSET = 0.10;
    let bias = 0;
    const history: number[] = [];
    for (let i = 0; i < 25; i++) {
      /* Fiziksel türev: ∂anchor/∂bias = −1/H (bkz. `updateAnchorBias` gerekçesi). */
      const measured = desired + OFFSET - bias / 600;
      history.push(measured);
      bias = updateAnchorBias({
        prevBiasPx: bias, measuredAnchorY: measured,
        desiredAnchorY: desired, containerHeight: 600,
      }).biasPx;
    }
    const final = history[history.length - 1];
    expect(Math.abs(final - desired), 'geri besleme yakınsamadı')
      .toBeLessThanOrEqual(ANCHOR_BIAS_DEADBAND + 1e-6);
    /* Aşım (overshoot) YOK: hata hiç işaret değiştirmemeli. */
    expect(history.every((m) => m >= desired - 1e-9), 'geri besleme aşım yaptı').toBe(true);
  });

  it('ölü bantta bias DEĞİŞMEZ (ölçüm gürültüsünde salınmaz)', () => {
    const r = updateAnchorBias({
      prevBiasPx: 40, measuredAnchorY: 0.6 + ANCHOR_BIAS_DEADBAND / 2,
      desiredAnchorY: 0.6, containerHeight: 600,
    });
    expect(r.settled).toBe(true);
    expect(r.biasPx).toBe(40);
  });

  it('ölçülemeyen girdide bias DOKUNULMAZ', () => {
    for (const bad of [NaN, Infinity]) {
      const r = updateAnchorBias({
        prevBiasPx: 12, measuredAnchorY: bad,
        desiredAnchorY: 0.6, containerHeight: 600,
      });
      expect(r.biasPx).toBe(12);
      expect(r.settled).toBe(true);
    }
  });

  it('hız bandı histerezisi KORUNUR (kompozisyon salınmaz)', () => {
    /* Kompozisyon banda bağlı; bant salınırsa ekran da salınır. */
    let band = resolveSpeedBand(60, null);
    expect(band).toBe('SUBURBAN');
    band = resolveSpeedBand(52, band);           // çıkış eşiği 48 → bantta KAL
    expect(band).toBe('SUBURBAN');
    band = resolveSpeedBand(40, band);
    expect(band).toBe('CITY');
  });
});

/* ══ 4. UYGULAYICI — STİL HAZIR DEĞİLKEN YENİDEN DENEME ══════════════════
   CİHAZDA ÖLÇÜLDÜ (2026-08-23, gece mini harita): ilk yazımda uygulayıcı
   `isStyleLoaded()` false iken sessizce dönüyordu ve "stil gelince tekrar
   denensin" diyordu — ama TEKRAR DENEYECEK KİMSE YOKTU. Gündüz→gece geçişi
   stili yeniden yüklerken profil bir daha yazılmadı ve mini haritada binalar
   görünmeye devam etti. Bu kilit o kusuru tutar. */

describe('P0-NAV-03 · sözleşme uygulayıcısı stil yarışına dayanır', () => {
  interface FakeMap {
    styleLoaded: boolean;
    styleHandlers: Array<() => void>;
    painted: Array<[string, string, unknown]>;
    paint: Map<string, unknown>;
    isStyleLoaded(): boolean;
    on(ev: string, cb: () => void): void;
    once(ev: string, cb: () => void): void;
    getLayer(id: string): unknown;
    getPaintProperty(id: string, prop: string): unknown;
    setPaintProperty(id: string, prop: string, v: unknown): void;
  }

  function makeMap(styleLoaded: boolean): FakeMap {
    return {
      styleLoaded,
      styleHandlers: [],
      painted: [],
      paint: new Map<string, unknown>(),
      isStyleLoaded() { return this.styleLoaded; },
      on(ev, cb) { if (ev === 'styledata') this.styleHandlers.push(cb); },
      once() { /* kalıcı gözlemci kullanılıyor */ },
      getLayer() { return {}; },
      getPaintProperty(id, prop) { return this.paint.get(`${id}|${prop}`); },
      setPaintProperty(id, prop, v) {
        this.painted.push([id, prop, v]);
        this.paint.set(`${id}|${prop}`, v);
      },
    };
  }

  it('stil HAZIR DEĞİLKEN yazmaz, stil gelince KENDİ KENDİNE yazar', async () => {
    const { applyMapDeclutter, invalidateMapDeclutter } =
      await import('../platform/map/MapLayerManager');
    invalidateMapDeclutter();
    const m = makeMap(false);
    applyMapDeclutter(m as never, 'MINI', true, true);
    expect(m.painted, 'stil yokken boyama yapılmış').toHaveLength(0);
    expect(m.styleHandlers.length, 'kalıcı stil gözlemcisi kurulmamış').toBe(1);

    m.styleLoaded = true;
    m.styleHandlers[0]!();
    const bldg = m.painted.find(([id]) => id === 'building');
    expect(bldg, 'stil gelince profil yazılmamış').toBeDefined();
    expect(bldg![2]).toBe(0);
    invalidateMapDeclutter();
  });

  it('stil TEKRAR yüklenirse sözleşme GERİ GELİR (cihazda ölçülen 2. kusur)', async () => {
    const { applyMapDeclutter, invalidateMapDeclutter } =
      await import('../platform/map/MapLayerManager');
    invalidateMapDeclutter();
    const m = makeMap(true);
    applyMapDeclutter(m as never, 'MINI', true, true);
    expect(m.paint.get('building|fill-opacity')).toBe(0);

    /* Tema geçişi / raster↔vektör: MapLibre katmanları yeniden yaratır ve
       boyalar varsayılana döner. Tek seferlik yeniden deneme bunu KAÇIRIYORDU. */
    m.paint.set('building|fill-opacity', 1);
    m.styleHandlers[0]!();
    expect(m.paint.get('building|fill-opacity'), 'sözleşme geri gelmedi').toBe(0);
    invalidateMapDeclutter();
  });

  it('SAPMA YOKSA gözlemci hiç yazmaz (kör yeniden yazma yok)', async () => {
    const { applyMapDeclutter, invalidateMapDeclutter } =
      await import('../platform/map/MapLayerManager');
    invalidateMapDeclutter();
    const m = makeMap(true);
    applyMapDeclutter(m as never, 'MINI', true, true);
    const n = m.painted.length;
    m.styleHandlers[0]!();
    m.styleHandlers[0]!();
    expect(m.painted.length, 'sapma yokken yeniden yazılmış').toBe(n);
    invalidateMapDeclutter();
  });

  it('idempotent: aynı profil iki kez yazılmaz', async () => {
    const { applyMapDeclutter, invalidateMapDeclutter } =
      await import('../platform/map/MapLayerManager');
    invalidateMapDeclutter();
    const m = makeMap(true);
    applyMapDeclutter(m as never, 'FULL', false, true);
    const n = m.painted.length;
    expect(n).toBeGreaterThan(0);
    applyMapDeclutter(m as never, 'FULL', false, true);
    expect(m.painted.length, 'aynı profil ikinci kez yazılmış').toBe(n);
    invalidateMapDeclutter();
  });
});

/* ══ 5. MANEVRA KAMERASI KAPISI — GÖLGEDEN ÜRETİME (OEM++ sunum turu) ═════
 *
 * ÖLÇÜLEN KUSUR (2026-09-04, kod okundu): `FullMapView` kamera için manevra
 * mesafesini YALNIZ `steps.length` kontrolüyle geçiriyordu
 * (`_rsTick.distanceToNextTurnMeters`); `distanceToNextTurnSource` HİÇ
 * denetlenmiyordu. Kaynak `STRAIGHT_LINE` iken kuş uçuşu mesafe virajlı
 * yaklaşımda gerçek yol mesafesinden KISA çıkar → kamera kavşağa ERKEN
 * girer ve rota vurgusu olmayan bir manevraya göre güçlenir.
 *
 * Kural ZATEN vardı ama yalnız GÖLGEDE koşuyordu: `decideCameraPolicy`
 * üretimde HİÇ tüketilmiyordu (yalnız `cameraShadowRuntime` + LAB). Bu
 * bölüm kapının ÜRETİMDE uygulandığını kilitler.
 * ════════════════════════════════════════════════════════════════════════ */

const SRC = resolve(__dirname, '..');
const readSrc = (rel: string) => readFileSync(resolve(SRC, rel), 'utf8');
const stripComments = (t: string) =>
  t.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');

describe('OEM++ · manevra kamerası kaynak kapısı', () => {
  it('KANONİK KURAL: yol-boyu OLMAYAN mesafe manevra bandı ÜRETMEZ', () => {
    /* Kural modelin kendisindedir — bu tur onu YENİDEN TANIMLAMADI. */
    expect(resolveManeuverBand(50, 'STRAIGHT_LINE')).toBe('NONE');
    expect(resolveManeuverBand(50, 'UNKNOWN')).toBe('NONE');
    /* Kilit KÖR DEĞİL: aynı mesafe yol-boyu iken bant GERÇEKTEN doğar. */
    expect(resolveManeuverBand(50, 'ALONG_ROUTE')).toBe('IMMINENT');
    expect(resolveManeuverBand(MANEUVER_BANDS.APPROACH_M, 'ALONG_ROUTE')).toBe('APPROACH');
    expect(resolveManeuverBand(MANEUVER_BANDS.FAR_M, 'ALONG_ROUTE')).toBe('FAR');
    expect(resolveManeuverBand(MANEUVER_BANDS.FAR_M + 1, 'ALONG_ROUTE')).toBe('NONE');
  });

  it('ölçülemeyen mesafe manevra kamerası AÇMAZ (sahte yakınlık yok)', () => {
    expect(resolveManeuverBand(null, 'ALONG_ROUTE')).toBe('NONE');
    expect(resolveManeuverBand(0, 'ALONG_ROUTE')).toBe('NONE');
    expect(resolveManeuverBand(Number.NaN, 'ALONG_ROUTE')).toBe('NONE');
  });

  it('ÜRETİM KAPISI: `setDrivingView` kanonik bandı okur ve mesafeyi KAPIDAN geçirir', () => {
    const src = stripComments(readSrc('platform/map/MapInteractionManager.ts'));
    /* Kapı kanonik modelden gelir — ikinci eşik/kural KURULMAZ. */
    expect(src, 'kanonik bant çözücü kullanılmıyor').toContain('resolveManeuverBand(');
    expect(src, 'kapı sonucu değişkeni yok').toContain('_gatedTurnM');
    /* Kamera hedefi ve yön öngörüsü HAM mesafeyi DEĞİL, kapılı mesafeyi alır. */
    expect(src).toContain('computeCameraTarget(effectiveSpeed, _gatedTurnM)');
    expect(src).toContain('computeAnticipatedBearing(heading, _gatedTurnM, nextTurnBearing)');
    expect(src, 'ham turnApproachM hâlâ kamera hedefine gidiyor')
      .not.toContain('computeCameraTarget(effectiveSpeed, turnApproachM)');
    expect(src, 'ham turnApproachM hâlâ yön öngörüsüne gidiyor')
      .not.toContain('computeAnticipatedBearing(heading, turnApproachM, nextTurnBearing)');
  });

  it('AYNI KAPI rota vurgusunda da geçerli (iki yüzey, TEK gerçek)', () => {
    const src = stripComments(readSrc('platform/map/MapInteractionManager.ts'));
    /* Kamera susarken rota rengi "kavşak geliyor" DİYEMEZ. */
    expect(src).toMatch(/_mTier\s*=\s*!_gatedTurnM/);
    expect(src, 'manevra kademesi hâlâ ham mesafeye bakıyor')
      .not.toMatch(/_mTier\s*=\s*!turnApproachM/);
  });

  it('UI KARAR VERMEZ, yalnız KAYNAĞI taşır (L7 sınırı)', () => {
    const ui = stripComments(readSrc('components/map/FullMapView.tsx'));
    /* Kaynağı okuyup GEÇİRİR… */
    expect(ui).toContain('_turnDistSource');
    expect(ui).toContain('_rsTick.distanceToNextTurnSource');
    /* …ama kapıyı KENDİSİ kurmaz: eşik/bant kararı UI'da OLMAZ. */
    expect(ui, 'UI kendi manevra bandını hesaplıyor').not.toContain('resolveManeuverBand');
    expect(ui, 'UI kendi manevra eşiğini tanımlıyor').not.toContain('MANEUVER_BANDS');
  });

  it('GERİYE DÖNÜK UYUM: kaynak bildirilmeyen çağrı davranışı DEĞİŞTİRMEZ', () => {
    const src = readSrc('platform/map/MapInteractionManager.ts');
    /* Eski çağrı imzası (`maneuverDistanceSource` yok) `ALONG_ROUTE` sayılır —
       bu tur mevcut davranışı sessizce KISITLAMADI. */
    expect(src).toContain("maneuverDistanceSource ?? 'ALONG_ROUTE'");
  });
});

/* ══ 6. SUNUM KATMANI SINIRLARI (L7) ═════════════════════════════════════ */

describe('OEM++ · sunum katmanı sınırları', () => {
  it('TEK KAMERA KOMPOZİSYON OTORİTESİ: anchor→padding tek yerde çözülür', () => {
    const hits = ['platform/map/core/cameraCompositionModel.ts',
      'platform/map/MapInteractionManager.ts', 'platform/cameraEngine.ts',
      'components/map/FullMapView.tsx']
      .filter((f) => readSrc(f).includes('export function resolveTopPadForAnchor'));
    expect(hits).toEqual(['platform/map/core/cameraCompositionModel.ts']);
  });

  it('TEK DECLUTTER OTORİTESİ: `resolveDeclutter` tek tanımlı', () => {
    const hits = ['platform/map/core/mapDeclutterModel.ts',
      'platform/map/MapLayerManager.ts', 'components/map/FullMapView.tsx',
      'components/map/MiniMapWidget.tsx']
      .filter((f) => readSrc(f).includes('export function resolveDeclutter'));
    expect(hits).toEqual(['platform/map/core/mapDeclutterModel.ts']);
  });

  it('UI navigasyon KARARI üretmez: rota/eşleşme/CEH hesabı yok', () => {
    const ui = stripComments(readSrc('components/map/FullMapView.tsx'));
    for (const forbidden of [
      'matchToRoute(', 'decideCameraPolicy(', 'resolveDeclutter(',
      'resolveRouteEmphasis(', 'buildHorizon(', 'stepOffRoute(', 'pickBestRoute(',
    ]) {
      expect(ui, `UI navigasyon kararı üretiyor: ${forbidden}`).not.toContain(forbidden);
    }
  });

  it('UI ikinci GPS aboneliği AÇMAZ (kanonik kancalar dışında)', () => {
    const ui = stripComments(readSrc('components/map/FullMapView.tsx'));
    expect(ui, 'UI doğrudan konum aboneliği açıyor').not.toContain('watchPosition(');
    expect(ui, 'UI doğrudan geolocation okuyor').not.toContain('navigator.geolocation');
  });

  it('SUNUM HATASI navigasyon otoritesini ETKİLEYEMEZ: CEH hâlâ SHADOW', () => {
    const gate = readSrc('platform/navigation/shadow/cehCutoverGate.ts');
    expect(gate).toContain('CEH_CUTOVER_DEFAULT_OPEN: boolean = false');
  });
});
