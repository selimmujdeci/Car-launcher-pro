import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { tileAt, bounds, summarize, decode, partCount } from './audit.mjs';

test('Tarsus koordinatı z14 sınırlarının içinde; z15/16 aynı ataya gider', () => {
  const center = tileAt(36.9175, 34.8621, 14);
  assert.deepEqual(center, { z: 14, x: 9778, y: 6381 });
  const [w, s, e, n] = bounds(center);
  assert.ok(w < 34.8621 && 34.8621 < e && s < 36.9175 && 36.9175 < n);
  for (const z of [15, 16]) {
    const tile = tileAt(36.9175, 34.8621, z);
    assert.equal(Math.floor(tile.x / 2 ** (z - 14)), center.x);
    assert.equal(Math.floor(tile.y / 2 ** (z - 14)), center.y);
  }
});
test('İç halka ikinci bina sayılmaz; MultiPolygon parçaları ayrı sayılır', () => {
  assert.equal(partCount({ type: 'Polygon', coordinates: [[], []] }), 1);
  assert.equal(partCount({ type: 'MultiPolygon', coordinates: [[[], []], [[]]] }), 2);
});
test('Gerçek PBF birleşik footprint ve adres katmanlarını korur', () => {
  const bytes = readFileSync(new URL('./14-9778-6381.pbf', import.meta.url));
  const layers = decode(bytes, { z: 14, x: 9778, y: 6381 });
  const summary = summarize(layers);
  assert.equal(summary.counts.building, 11);
  assert.ok(summary.geometryParts.building > 330);
  assert.equal(summary.counts.housenumber, 7);
  assert.ok(layers.housenumber.some(f => f.properties.housenumber === '22/D'));
  assert.equal(summary.building3dAccepted, 11);
  assert.equal(summary.buildingHeight.MISSING, 11);
  assert.ok(layers.transportation_name.some(f => f.properties.name === '0469. Sokak'));
});
test('Bozuk veri sıfır kapsam gibi raporlanamaz', () => {
  assert.throws(() => decode(Buffer.from([255, 255, 255]), { z: 14, x: 9778, y: 6381 }));
});
