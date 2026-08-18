/**
 * routeStepLabelsModel.test.ts — rota bandı üstü sokak adı etiketleri (kök 1).
 *
 * Google Maps rota çizgisi üstüne geçilen her sokağın adını basar. Bu SAF
 * model, OSRM adımlarını (`streetName` + `coordinate` + `geometryPointCount`)
 * rota geometrisi üstünde isimli segmentlere çevirir — `maneuverIndexModel`
 * (painted-arrow'un da kullandığı AYNI anchor çözücü) üstünden.
 *
 * Kilitlenen sözleşme:
 *   1) İsimsiz adım (OSRM `name: ""`) etiket ÜRETMEZ.
 *   2) Bağlanamayan (anchor çözülemeyen) adım ATLANIR — uydurma konum YOK.
 *   3) Segment sınırları ardışık adımların anchor indeksleriyle birebir örtüşür.
 *   4) Son adımın segmenti geometri dizisinin SONUNA kadar uzanır.
 */

import { describe, it, expect } from 'vitest';
import {
  buildRouteStepLabelSegments,
  type RouteStepLabelInput,
} from '../platform/map/core/routeStepLabelsModel';

/* ── Sentetik rota (Ankara civarı, paintedArrowModel.test.ts ile aynı ölçek) ─
   10 nokta, 10 m aralıklarla kuzeye. Üç adım paylaşımlı uçlarla (OSRM deseni):
     Adım 0 "0451. Sokak"  → nokta 0..4 (geometryPointCount=5)
     Adım 1 "Mavi Bulvar"  → nokta 4..7 (geometryPointCount=4)
     Adım 2 "0469. Sokak"  → nokta 7..9 (geometryPointCount=3)             */
const LAT0 = 39.0, LON0 = 32.0;
const DLAT = 10 / 111_320;

function makeGeometry(n: number): Array<[number, number]> {
  const pts: Array<[number, number]> = [];
  for (let i = 0; i < n; i++) pts.push([LON0, LAT0 + i * DLAT]);
  return pts;
}

const GEOMETRY = makeGeometry(10);

function threeStepInput(): RouteStepLabelInput[] {
  return [
    { streetName: '0451. Sokak', coordinate: GEOMETRY[0], geometryPointCount: 5 },
    { streetName: 'Mavi Bulvar', coordinate: GEOMETRY[4], geometryPointCount: 4 },
    { streetName: '0469. Sokak', coordinate: GEOMETRY[7], geometryPointCount: 3 },
  ];
}

describe('buildRouteStepLabelSegments — temel segmentasyon', () => {
  it('DAVRANIŞ: üç adım üç segmente ayrılır, sınırlar anchor indeksleriyle örtüşür', () => {
    const segs = buildRouteStepLabelSegments(GEOMETRY, threeStepInput());
    expect(segs.map(s => s.name)).toEqual(['0451. Sokak', 'Mavi Bulvar', '0469. Sokak']);

    expect(segs[0].coordinates).toEqual(GEOMETRY.slice(0, 5));
    expect(segs[1].coordinates).toEqual(GEOMETRY.slice(4, 8));
    // Son adım: geometrinin SONUNA kadar uzanır (nokta 7..9)
    expect(segs[2].coordinates).toEqual(GEOMETRY.slice(7, 10));
  });

  it('DAVRANIŞ: stepIndex orijinal adım sırasını korur', () => {
    const segs = buildRouteStepLabelSegments(GEOMETRY, threeStepInput());
    expect(segs.map(s => s.stepIndex)).toEqual([0, 1, 2]);
  });
});

describe('buildRouteStepLabelSegments — dürüstlük kapıları', () => {
  it('DAVRANIŞ: isimsiz adım (OSRM name: "") etiket ÜRETMEZ', () => {
    const steps = threeStepInput();
    steps[1] = { ...steps[1], streetName: '' };
    const segs = buildRouteStepLabelSegments(GEOMETRY, steps);
    expect(segs.map(s => s.name)).toEqual(['0451. Sokak', '0469. Sokak']);
  });

  it('DAVRANIŞ: yalnız boşluk içeren ad da isimsiz sayılır', () => {
    const steps = threeStepInput();
    steps[0] = { ...steps[0], streetName: '   ' };
    const segs = buildRouteStepLabelSegments(GEOMETRY, steps);
    expect(segs.find(s => s.stepIndex === 0)).toBeUndefined();
  });

  it('DAVRANIŞ: bağlanamayan adım (anchor ÇÖZÜLEMEZ) ATLANIR — uydurma konum YOK', () => {
    const steps = threeStepInput();
    // Adım 1'in koordinatını rota geometrisinden ÇOK uzağa taşı (başka kıta).
    steps[1] = { ...steps[1], coordinate: [-58.3816, -34.6037] }; // Buenos Aires
    const segs = buildRouteStepLabelSegments(GEOMETRY, steps);
    expect(segs.map(s => s.name), 'çözülemeyen adım İDDİA EDİLMEDEN atlanmalı')
      .toEqual(['0451. Sokak', '0469. Sokak']);
  });

  it('DAVRANIŞ: geometri yoksa veya tek noktaysa boş sonuç döner', () => {
    for (const g of [null, [] as Array<[number, number]>, [GEOMETRY[0]] as Array<[number, number]>]) {
      expect(buildRouteStepLabelSegments(g, threeStepInput())).toEqual([]);
    }
  });

  it('DAVRANIŞ: adım listesi boşsa boş sonuç döner', () => {
    expect(buildRouteStepLabelSegments(GEOMETRY, [])).toEqual([]);
  });
});

describe('buildRouteStepLabelSegments — tek adımlı rota (kısa mesafe, "60 m sonra dönün" sınıfı)', () => {
  it('DAVRANIŞ: tek adım geometrinin TAMAMINI segment olarak alır', () => {
    const shortGeom = makeGeometry(3);
    const steps: RouteStepLabelInput[] = [
      { streetName: 'Mavi Bulvar', coordinate: shortGeom[0], geometryPointCount: 3 },
    ];
    const segs = buildRouteStepLabelSegments(shortGeom, steps);
    expect(segs).toHaveLength(1);
    expect(segs[0].coordinates).toEqual(shortGeom);
  });
});
