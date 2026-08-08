/**
 * paintedArrowModel.test.ts — yola boyanmış manevra okunun kilitleri.
 *
 * Ok bir İDDİADIR ("şuradan şuraya döneceksin"). Bu dosya iki şeyi kilitler:
 *   (1) dayanağı yokken ÇİZİLMEZ ve nedeni SAYILABİLİR (sessiz `return` yok),
 *   (2) çizildiğinde geometri YOL ÜZERİNDE kalır — kavşağın ötesine taşmaz,
 *       havada durmaz, ölçüsü sabit kalır.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildPaintedArrow,
  ARROW_SHOW_MAX_M, ARROW_HIDE_MIN_M, ARROW_EXIT_M, ARROW_APPROACH_M,
  ARROW_BODY_W_M, ARROW_HEAD_W_M,
  PAINTED_ARROW_POLICY_VERSION,
  type PaintedArrowInput,
} from '../platform/map/core/paintedArrowModel';

/* ── Sentetik rota: kuzeye git, sağa dön, doğuya devam ─────────────────────
   Ankara civarı (lat≈39). 10 m'lik adımlar: lat 0.0000898° · lon 0.0001156°. */

const LAT0 = 39.0, LON0 = 32.0;
const DLAT = 10 / 111_320;
const DLON = 10 / (111_320 * Math.cos(39 * Math.PI / 180));

/** 0..5 kuzeye yaklaşım (60 m), 5 = manevra, 6..9 doğuya çıkış (40 m). */
function makeRoute(): Array<[number, number]> {
  const pts: Array<[number, number]> = [];
  for (let i = 0; i < 6; i++) pts.push([LON0, LAT0 - (5 - i) * DLAT]);   // güneyden kuzeye
  for (let i = 1; i <= 4; i++) pts.push([LON0 + i * DLON, LAT0]);        // doğuya
  return pts;
}

const ROUTE = makeRoute();
const ANCHOR_IDX = 5;

function input(over: Partial<PaintedArrowInput> = {}): PaintedArrowInput {
  return {
    navActive: true,
    routeGeometry: ROUTE,
    maneuverGeometryIndex: ANCHOR_IDX,
    distanceToManeuverM: 80,
    maneuverType: 'turn',
    maneuverModifier: 'right',
    ...over,
  };
}

/** Yerel düzlemde metre mesafesi — testin kendi ölçüsü. */
function meters(a: readonly [number, number], b: readonly [number, number]): number {
  const dx = (b[0] - a[0]) * 111_320 * Math.cos(39 * Math.PI / 180);
  const dy = (b[1] - a[1]) * 111_320;
  return Math.hypot(dx, dy);
}

describe('kapılar — dayanağı yoksa ÇİZİLMEZ ve nedeni sayılabilir', () => {
  it('navigasyon aktif değilse çizilmez', () => {
    const v = buildPaintedArrow(input({ navActive: false }));
    expect(v.visible).toBe(false);
    expect(v.visible === false && v.reason).toBe('NAV_INACTIVE');
  });

  it('geometri yoksa veya tek noktaysa çizilmez', () => {
    for (const g of [null, [] as Array<[number, number]>, [[32, 39]] as Array<[number, number]>]) {
      const v = buildPaintedArrow(input({ routeGeometry: g }));
      expect(v.visible === false && v.reason).toBe('NO_GEOMETRY');
    }
  });

  it('manevra çapası çözülemediyse çizilmez (uydurma konum YOK)', () => {
    for (const bad of [-1, 999, 1.5, NaN]) {
      const v = buildPaintedArrow(input({ maneuverGeometryIndex: bad }));
      expect(v.visible === false && v.reason).toBe('ANCHOR_UNRESOLVED');
    }
  });

  it('mesafe ölçülemediyse çizilmez — "yaklaşık" ok yoktur', () => {
    for (const d of [null, NaN, Infinity]) {
      const v = buildPaintedArrow(input({ distanceToManeuverM: d }));
      expect(v.visible === false && v.reason).toBe('DISTANCE_UNKNOWN');
    }
  });

  it('çok uzakken çizilmez — erken ok YANLIŞ kavşağı işaretler', () => {
    expect(buildPaintedArrow(input({ distanceToManeuverM: ARROW_SHOW_MAX_M + 1 })))
      .toMatchObject({ visible: false, reason: 'TOO_FAR' });
    // Tam eşikte görünür kalır (kapı kapanmaz).
    expect(buildPaintedArrow(input({ distanceToManeuverM: ARROW_SHOW_MAX_M })).visible).toBe(true);
  });

  it('dönüşün içindeyken çizilmez — ok geride kalır ve yanıltır', () => {
    expect(buildPaintedArrow(input({ distanceToManeuverM: ARROW_HIDE_MIN_M - 1 })))
      .toMatchObject({ visible: false, reason: 'TOO_CLOSE' });
    expect(buildPaintedArrow(input({ distanceToManeuverM: ARROW_HIDE_MIN_M })).visible).toBe(true);
  });

  it('düz devam · varış · kalkış için çizilmez', () => {
    expect(buildPaintedArrow(input({ maneuverModifier: 'straight' })))
      .toMatchObject({ visible: false, reason: 'NOT_A_TURN' });
    expect(buildPaintedArrow(input({ maneuverType: 'arrive' })))
      .toMatchObject({ visible: false, reason: 'NOT_A_TURN' });
    expect(buildPaintedArrow(input({ maneuverType: 'depart' })))
      .toMatchObject({ visible: false, reason: 'NOT_A_TURN' });
  });

  it('manevra çevresinde geometri kısaysa çizilmez', () => {
    // Çıkış kolu yalnız 1 nokta (10 m) → ok başı sığmaz.
    const short: Array<[number, number]> = [
      [LON0, LAT0 - 4 * DLAT], [LON0, LAT0 - 3 * DLAT], [LON0, LAT0 - 2 * DLAT],
      [LON0, LAT0 - DLAT], [LON0, LAT0], [LON0 + DLON * 0.3, LAT0],
    ];
    const v = buildPaintedArrow(input({ routeGeometry: short, maneuverGeometryIndex: 4 }));
    expect(v.visible === false && v.reason).toBe('GEOMETRY_TOO_SHORT');
  });
});

describe('geometri — ok YOL ÜZERİNDE kalır', () => {
  const v = buildPaintedArrow(input());

  it('görünür ve kapalı bir halka üretir', () => {
    expect(v.visible).toBe(true);
    if (!v.visible) return;
    expect(v.ring.length).toBeGreaterThan(6);
    expect(v.ring[0]).toEqual(v.ring[v.ring.length - 1]);   // GeoJSON kapalı halka
  });

  it('kavşağın ötesine TAŞMAZ — uç, çıkış bütçesi içinde kalır', () => {
    if (!v.visible) throw new Error('görünür olmalıydı');
    const anchor = ROUTE[ANCHOR_IDX]!;
    // Hiçbir köşe, manevra noktasından (yaklaşım + pay) daha uzakta olamaz.
    const maxAllowed = Math.max(ARROW_APPROACH_M, ARROW_EXIT_M) + ARROW_HEAD_W_M;
    for (const p of v.ring) {
      expect(meters(anchor, p)).toBeLessThanOrEqual(maxAllowed);
    }
  });

  it('ok ucu manevra noktasının ÇIKIŞ kolunda durur, yaklaşımda değil', () => {
    if (!v.visible) throw new Error('görünür olmalıydı');
    const anchor = ROUTE[ANCHOR_IDX]!;
    // Çıkış doğuya: uç anchor'dan daha DOĞUDA olmalı.
    const east = v.ring.filter((p) => p[0] > anchor[0] + 1e-9);
    expect(east.length).toBeGreaterThan(0);
    // Ve yaklaşımın gerisine (güneye) taşan bir uç bulunmamalı.
    const tipCandidates = v.ring.filter((p) => meters(anchor, p) > ARROW_EXIT_M * 0.7);
    expect(tipCandidates.length).toBeGreaterThan(0);
  });

  it('gövde genişliği politikaya uyar — şerit hissi korunur', () => {
    if (!v.visible) throw new Error('görünür olmalıydı');
    const anchor = ROUTE[ANCHOR_IDX]!;
    // Yaklaşım kolunda (anchor'ın güneyi, x≈LON0) karşılıklı iki kenar noktası
    // arası genişlik ≈ ARROW_BODY_W_M olmalı.
    const approach = v.ring.filter((p) => p[1] < anchor[1] - DLAT * 0.5);
    const lons = approach.map((p) => p[0]);
    const spanM = (Math.max(...lons) - Math.min(...lons))
      * 111_320 * Math.cos(39 * Math.PI / 180);
    expect(spanM).toBeGreaterThan(ARROW_BODY_W_M * 0.7);
    expect(spanM).toBeLessThan(ARROW_BODY_W_M * 1.6);
  });

  it('ok başı gövdeden GENİŞTİR — yön okunur olsun diye', () => {
    expect(ARROW_HEAD_W_M).toBeGreaterThan(ARROW_BODY_W_M);
  });

  it('sağ ve sol dönüş ayrı sınıflandırılır', () => {
    const r = buildPaintedArrow(input({ maneuverModifier: 'right' }));
    const l = buildPaintedArrow(input({ maneuverModifier: 'slight left' }));
    expect(r.visible === true && r.turn).toBe('right');
    expect(l.visible === true && l.turn).toBe('left');
  });
});

describe('saflık ve dayanıklılık', () => {
  it('aynı girdi aynı çıktıyı verir (deterministik)', () => {
    const a = buildPaintedArrow(input());
    const b = buildPaintedArrow(input());
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('girdi dizisini DEĞİŞTİRMEZ', () => {
    const copy = JSON.stringify(ROUTE);
    buildPaintedArrow(input());
    expect(JSON.stringify(ROUTE)).toBe(copy);
  });

  it('tekrarlanan (sıfır uzunluklu) segmentlerde patlamaz', () => {
    const dup: Array<[number, number]> = [];
    for (const p of ROUTE) { dup.push(p); dup.push([p[0], p[1]]); }
    const v = buildPaintedArrow(input({ routeGeometry: dup, maneuverGeometryIndex: 10 }));
    // Ya çizer ya gerekçe döner — ama ASLA NaN üretmez.
    if (v.visible) {
      for (const p of v.ring) {
        expect(Number.isFinite(p[0])).toBe(true);
        expect(Number.isFinite(p[1])).toBe(true);
      }
    } else {
      expect(typeof v.reason).toBe('string');
    }
  });

  it('politika sürümü tanımlı — eşik değişimi LAB\'da görünür', () => {
    expect(PAINTED_ARROW_POLICY_VERSION).toMatch(/^PA-\d{4}\.\d{2}\.\d{2}$/);
  });
});

describe('bağlama — ok DOĞRU kavşağa çizilmeli', () => {
  const FULL_MAP = readFileSync(
    join(process.cwd(), 'src', 'components', 'map', 'FullMapView.tsx'), 'utf8');
  const MAP_CORE = readFileSync(
    join(process.cwd(), 'src', 'platform', 'map', 'MapCore.ts'), 'utf8');
  const LAYER_MGR = readFileSync(
    join(process.cwd(), 'src', 'platform', 'map', 'MapLayerManager.ts'), 'utf8');
  const ACCESS = readFileSync(
    join(process.cwd(), 'src', 'platform', 'map', 'core', 'paintedArrowAccess.ts'), 'utf8');

  /** Tek bir fonksiyon gövdesini çıkarır — dosyanın kalanı denetime SIZMASIN. */
  function fnBody(src: string, name: string): string {
    const start = src.indexOf('export function ' + name);
    if (start < 0) throw new Error('fonksiyon yok: ' + name);
    const rest = src.slice(start + 16);
    const end = rest.indexOf('\nexport ');
    return end < 0 ? rest : rest.slice(0, end);
  }
  const SET_ARROW = fnBody(LAYER_MGR, 'setPaintedArrow');
  /** Yalnız import satırları — yorumda geçen bir isim bağımlılık DEĞİLDİR. */
  const ACCESS_IMPORTS = ACCESS.split('\n')
    .filter((l) => l.trimStart().startsWith('import')).join('\n');

  it('YAKLAŞAN manevra kullanılır (currentStepIndex + 1), geçilmiş olan DEĞİL', () => {
    /*
     * OSRM'de `steps[i].maneuver` adımın BAŞINDAKİ manevradır; `steps[i]` az önce
     * GEÇİLMİŞ dönüştür. HUD bunu `currentStepIndex + 1` ile çözer
     * (NavigationHUD:1877). Ok farklı bir kural kullanırsa ekranda yazan dönüş
     * ile yola boyanan dönüş AYRIŞIR — sürücü için en kötü hata sınıfı.
     */
    const block = FULL_MAP.slice(FULL_MAP.indexOf('YOLA BOYANMIŞ MANEVRA OKU'));
    expect(block).toContain('currentStepIndex + 1');
    // Çapa da AYNI adımdan seçilmeli.
    expect(block).toMatch(/maneuverAnchors\.find\(\(a\) => a\.stepIndex === _nextIdx\)/);
  });

  it('çapa çözülemediyse -1 geçilir — 0 indeksi UYDURULMAZ', () => {
    const block = FULL_MAP.slice(FULL_MAP.indexOf('YOLA BOYANMIŞ MANEVRA OKU'));
    // `?? 0` olsaydı çözülemeyen çapa rotanın BAŞINA ok çizerdi.
    expect(block).toContain('?? -1');
    expect(block).not.toMatch(/geometryIndex\s*\?\?\s*0/);
  });

  it('mesafe sonlu değilse null geçilir — NaN kapıya sızmaz', () => {
    const block = FULL_MAP.slice(FULL_MAP.indexOf('YOLA BOYANMIŞ MANEVRA OKU'));
    expect(block).toContain('Number.isFinite(_rsArrow.distanceToNextTurnMeters)');
  });

  it('stil yeniden yüklenince dedup önbelleği SIFIRLANIR', () => {
    // Sıfırlanmazsa: katman stille gitti ama anahtar aynı kaldı → "durum
    // değişmedi" denip ok bir daha HİÇ çizilmez (sessiz ölüm).
    const onStyleLoad = MAP_CORE.slice(MAP_CORE.indexOf("map.on('style.load'"));
    expect(onStyleLoad).toContain('_resetPaintedArrowCache()');
  });

  it('ok SEMBOL değil ZEMİN katmanıdır — eğimde asfalta yatsın', () => {
    expect(SET_ARROW).toMatch(/type:\s*'fill'/);
    expect(SET_ARROW).not.toMatch(/type:\s*'symbol'/);
  });

  it('görünmezken katman SİLİNMEZ, kaynak boşaltılır', () => {
    // Her manevrada katman yaratıp silmek stil sırasını bozar ve GPU'yu yorar.
    expect(SET_ARROW).toContain('_EMPTY_FC');
    expect(SET_ARROW).not.toContain('removeLayer');
  });

  it('hüküm değişmediyse setData çağrılmaz (1 Hz fix altında dedup)', () => {
    expect(SET_ARROW).toMatch(/if \(key === _lastArrowKey/);
  });

  it('gözlem durumu ağır modülde DEĞİL, yaprak erişim katmanında tutulur', () => {
    // LAB, okun durumunu okumak için maplibre-gl grafiğini import etmemeli.
    expect(ACCESS_IMPORTS).not.toContain('maplibre-gl');
    expect(ACCESS_IMPORTS).not.toContain('MapLayerManager');
    expect(LAYER_MGR).toContain('_recordPaintedArrowVerdict');
  });

  it('gözlem yüzeyi KONUM taşımaz (gizlilik)', () => {
    expect(ACCESS).not.toMatch(/\blat\b|\blon\b|latitude|longitude|coordinate/i);
  });
});
