/**
 * navV3MapStoreF1.test.ts — NAV v3 · F1 · L1 MAPSTORE / MAP TRUTH AUTHORITY
 * KİLİTLERİ.
 *
 * Belge: `CAROS-NAV-ARCH-SPEC-3.0` §F1.
 *
 * Kapsam:
 *  1) `tileGrid` — ÜÇ eski uygulama ile BİREBİR sayısal parite + fail-closed katman
 *  2) `mapProvenance` — köken maskesi (kanıt sınıfı DEĞİL)
 *  3) `legacyEdgeIdAdapter` — precision-safe kimlik geçişi + gerçek grafik kanıtı
 *  4) `mapStore` — 4'lü epistemik durum · fail-closed · kökensiz kesinlik yasağı
 *  5) Mimari kilitler — saflık · tek authority · tek formül · L4–L6 borcu
 *
 * SAHA: bu testin yeşili F1'i "tamam" YAPMAZ (kütük #1208–#1211 ·
 * `UNKNOWN / DEVICE VALIDATION REQUIRED`).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  lngLatToTileRawClamped, lngLatToTileRawUnclamped,
  toTile, tileNorthWest, tileBounds, tileKey, parseTileKey, parentTile,
  tilesForBBox, isValidTile, isValidZoom,
  TILE_BBOX_MAX_RESULTS, TILE_Z_MAX, MERCATOR_LAT_LIMIT,
  type TileCoord,
} from '../platform/navigation/map/store/tileGrid';
import {
  MAP_SRC, MAP_SRC_NONE, MAP_SRC_ALL,
  isValidMask, hasSource, addSource, mergeMasks, isUnknownProvenance,
  describeMask, maskToBits,
} from '../platform/navigation/map/store/mapProvenance';
import {
  LEGACY_MONOLITH_TILE_ID, LEGACY_MAX_EDGE_ORDINAL,
  MEASURED_GRAPH_EDGE_COUNT, MEASURED_GRAPH_NODE_COUNT,
  toCanonicalEdgeId, toLegacyEdgeRef, isLegacyMonolithEdgeId,
  graphFitsCanonicalIdSpace,
} from '../platform/navigation/map/store/legacyEdgeIdAdapter';
import {
  createMapStore, classifyAvailability, UNMEASURED_DATASET,
  UNAVAILABLE_MAP_DATA_PORTS, MAP_DATASET_IDS, MAP_DATA_AVAILABILITIES,
  type MapDataPorts, type MapDatasetObservation, type StaticEdgeMetadata,
} from '../platform/navigation/map/store/mapStore';
import { makeEdgeId, splitEdgeId } from '../platform/navigation/contracts/navEdgeId';
import { asMonotonic } from '../platform/navigation/contracts/navMonotonicTime';

const SRC = resolve(__dirname, '..');
const ROOT = resolve(__dirname, '..', '..');
const STORE_DIR = 'platform/navigation/map/store';
const readSrc = (rel: string) => readFileSync(resolve(SRC, rel), 'utf8');
const storeFiles = readdirSync(resolve(SRC, STORE_DIR)).filter((f) => f.endsWith('.ts'));

function strip(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
}

const NOW = asMonotonic(100_000);

/* ══════════════════════════════════════════════════════════════════════════
   1) TILE GRID — parite + fail-closed
   ══════════════════════════════════════════════════════════════════════════ */

/* Eski üç uygulamanın GÖVDELERİ, referans kâhin (oracle) olarak birebir
   kopyalandı. Bunlar üründen SİLİNDİ; burada yalnız pariteyi kanıtlarlar. */
function ORACLE_mapTileProbe(lng: number, lat: number, zoom: number): { x: number; y: number } {
  const n = Math.pow(2, zoom);
  const x = Math.floor(((lng + 180) / 360) * n);
  const latRad = (lat * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n);
  return { x: Math.max(0, Math.min(n - 1, x)), y: Math.max(0, Math.min(n - 1, y)) };
}
function ORACLE_corridorSync(lat: number, lon: number, z: number): { x: number; y: number } {
  const n = 1 << z;
  const x = Math.floor(((lon + 180) / 360) * n);
  const lr = (lat * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(lr) + 1 / Math.cos(lr)) / Math.PI) / 2) * n);
  return { x, y };
}
function ORACLE_offlineTileDownloader(lat: number, lon: number, zoom: number): { x: number; y: number } {
  const n = 2 ** zoom;
  const x = Math.floor(((lon + 180) / 360) * n);
  const lr = (lat * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(lr) + 1 / Math.cos(lr)) / Math.PI) / 2) * n);
  return { x, y };
}

/* Gerçek kullanım alanı: Türkiye + kenar durumları. */
const SAMPLE_POINTS: Array<[lat: number, lon: number]> = [
  [41.0082, 28.9784],  // İstanbul
  [39.9334, 32.8597],  // Ankara
  [38.4237, 27.1428],  // İzmir
  [36.8000, 34.6000],  // Mersin (nav testlerinin sahası)
  [37.8746, 32.4932],  // Konya
  [0, 0],              // ekvator / başlangıç meridyeni
  [-33.8688, 151.2093],// güney yarımküre
  [85.0, 179.9],       // kutba yakın + doğu sınırı
  [-85.0, -179.9],     // kutba yakın + batı sınırı
];
const SAMPLE_ZOOMS = [0, 1, 5, 10, 11, 12, 13, 14, 18, 22];

describe('F1 · tileGrid — üç eski uygulama ile BİREBİR parite', () => {
  it('kırpmalı yol `mapTileProbe.lngLatToTile` ile aynı sayıyı verir', () => {
    for (const [lat, lon] of SAMPLE_POINTS) {
      for (const z of SAMPLE_ZOOMS) {
        expect(lngLatToTileRawClamped(lon, lat, z), `lat=${lat} lon=${lon} z=${z}`)
          .toEqual(ORACLE_mapTileProbe(lon, lat, z));
      }
    }
  });

  it('kırpmasız yol `offlineTileDownloader.latLonToTileXY` ile aynı sayıyı verir', () => {
    for (const [lat, lon] of SAMPLE_POINTS) {
      for (const z of SAMPLE_ZOOMS) {
        expect(lngLatToTileRawUnclamped(lon, lat, z), `lat=${lat} lon=${lon} z=${z}`)
          .toEqual(ORACLE_offlineTileDownloader(lat, lon, z));
      }
    }
  });

  it('kırpmasız yol `CorridorSyncEngine._tileXY` ile GERÇEK zoom aralığında (10-13) aynı', () => {
    /* Koridor motoru yalnız TILE_ZOOM_MIN..MAX = [10,13] kullanır. */
    for (const [lat, lon] of SAMPLE_POINTS) {
      for (const z of [10, 11, 12, 13]) {
        expect(lngLatToTileRawUnclamped(lon, lat, z), `lat=${lat} lon=${lon} z=${z}`)
          .toEqual(ORACLE_corridorSync(lat, lon, z));
      }
    }
  });

  it('KUSUR KAYDI: eski `1 << z` z≥31\'de NEGATİF üretirdi — tek kaynak üretmez', () => {
    expect(ORACLE_corridorSync(41.0, 29.0, 31).x).toBeLessThan(0);   // eski kusur
    expect(lngLatToTileRawUnclamped(29.0, 41.0, 31).x).toBeGreaterThanOrEqual(0);
  });
});

describe('F1 · tileGrid — kanonik FAIL-CLOSED katman', () => {
  it('geçersiz girdi → null (uydurma karo YOK)', () => {
    expect(toTile(NaN, 41, 12)).toBeNull();
    expect(toTile(29, Infinity, 12)).toBeNull();
    expect(toTile(29, 41, -1)).toBeNull();
    expect(toTile(29, 41, TILE_Z_MAX + 1)).toBeNull();
    expect(toTile(29, 41, 12.5)).toBeNull();
    expect(toTile(29, 41, '12' as unknown as number)).toBeNull();
  });

  it('geçerli girdi → aralık içinde karo', () => {
    for (const [lat, lon] of SAMPLE_POINTS) {
      for (const z of SAMPLE_ZOOMS) {
        const t = toTile(lon, lat, z);
        expect(t, `lat=${lat} lon=${lon} z=${z}`).not.toBeNull();
        expect(isValidTile(t)).toBe(true);
      }
    }
  });

  it('enlem Mercator tavanına kırpılır, boylam sarmalanır', () => {
    expect(toTile(29, 89, 10)).toEqual(toTile(29, MERCATOR_LAT_LIMIT, 10));
    expect(toTile(370, 41, 10)).toEqual(toTile(10, 41, 10));   // 370 → 10
    expect(toTile(-190, 41, 10)).toEqual(toTile(170, 41, 10)); // -190 → 170
  });

  it('tileBounds karonun kendi noktasını KAPSAR (round-trip tutarlılığı)', () => {
    for (const [lat, lon] of SAMPLE_POINTS.slice(0, 6)) {
      for (const z of [8, 12, 16]) {
        const t = toTile(lon, lat, z);
        expect(t).not.toBeNull();
        const b = tileBounds(t as TileCoord);
        expect(b, `z=${z}`).not.toBeNull();
        const [w, s, e, n] = b as [number, number, number, number];
        expect(lon).toBeGreaterThanOrEqual(w);
        expect(lon).toBeLessThanOrEqual(e);
        expect(lat).toBeGreaterThanOrEqual(s);
        expect(lat).toBeLessThanOrEqual(n);
      }
    }
  });

  it('tileKey / parseTileKey round-trip · bozuk anahtar → null', () => {
    const t: TileCoord = { z: 12, x: 2405, y: 1541 };
    expect(parseTileKey(tileKey(t))).toEqual(t);
    expect(parseTileKey('12/2405')).toBeNull();
    expect(parseTileKey('99/1/1')).toBeNull();        // zoom aralık dışı
    expect(parseTileKey('2/4/0')).toBeNull();         // x aralık dışı (n=4)
    expect(parseTileKey('abc')).toBeNull();
  });

  it('parentTile bir üst seviyeye çıkar · z=0\'da null', () => {
    expect(parentTile({ z: 12, x: 2405, y: 1541 })).toEqual({ z: 11, x: 1202, y: 770 });
    expect(parentTile({ z: 0, x: 0, y: 0 })).toBeNull();
    expect(parentTile({ z: 5, x: -1, y: 0 })).toBeNull();
  });

  it('tilesForBBox SINIRLI ve fail-closed (sınırsız kuyruk YASAK)', () => {
    expect(tilesForBBox([28.9, 40.9, 29.1, 41.1], 12).length).toBeGreaterThan(0);
    expect(tilesForBBox([29.1, 41.1, 28.9, 40.9], 12)).toEqual([]);   // ters bbox
    expect(tilesForBBox([NaN, 40.9, 29.1, 41.1], 12)).toEqual([]);
    expect(tilesForBBox([28.9, 40.9, 29.1, 41.1], 99)).toEqual([]);
    /* Tüm dünya z=12 → 16.7M karo; sonuç tavanı aşmamalı. */
    expect(tilesForBBox([-180, -85, 180, 85], 12).length).toBeLessThanOrEqual(TILE_BBOX_MAX_RESULTS);
  });

  it('isValidZoom / isValidTile aralık denetimi', () => {
    expect(isValidZoom(0)).toBe(true);
    expect(isValidZoom(TILE_Z_MAX)).toBe(true);
    expect(isValidZoom(TILE_Z_MAX + 1)).toBe(false);
    expect(isValidTile({ z: 1, x: 2, y: 0 })).toBe(false); // n=2 → x∈{0,1}
    expect(isValidTile({ z: 1, x: 1, y: 1 })).toBe(true);
    expect(isValidTile(null)).toBe(false);
  });

  it('tileNorthWest kenar indeksini (x=n) kabul eder — sınır kutusu hesabı için', () => {
    expect(tileNorthWest(1, 2, 2)).not.toBeNull();
    expect(tileNorthWest(1, 3, 0)).toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   2) KÖKEN MASKESİ
   ══════════════════════════════════════════════════════════════════════════ */

describe('F1 · mapProvenance köken maskesi', () => {
  it('köken maskesi kanıt sınıfını KOPYALAMAZ (paralel evidence sistemi yok)', () => {
    const src = readSrc(`${STORE_DIR}/mapProvenance.ts`);
    expect(src).not.toMatch(/export type EvidenceGrade/);
    expect(src).not.toMatch(/'OBSERVED'/);
    expect(src).not.toMatch(/'DERIVED'/);
    expect(src).not.toMatch(/export interface Evidenced/);
  });

  it('bitler 2\'nin kuvveti ve BENZERSİZ (kalıcı kayıt sözleşmesi)', () => {
    const bits = Object.values(MAP_SRC);
    expect(new Set(bits).size).toBe(bits.length);
    for (const b of bits) {
      expect(Number.isInteger(b) && b > 0 && (b & (b - 1)) === 0, `bit ${b}`).toBe(true);
    }
    expect(MAP_SRC_ALL).toBe(bits.reduce((a, b) => a | b, 0));
  });

  it('maske işlemleri saf ve fail-closed', () => {
    let m = MAP_SRC_NONE;
    expect(isUnknownProvenance(m)).toBe(true);
    m = addSource(m, MAP_SRC.PACKAGED_GRAPH);
    expect(hasSource(m, MAP_SRC.PACKAGED_GRAPH)).toBe(true);
    expect(hasSource(m, MAP_SRC.ONLINE_TILES)).toBe(false);
    expect(isUnknownProvenance(m)).toBe(false);
    const merged = mergeMasks(m, MAP_SRC.DEVICE_CACHE);
    expect(maskToBits(merged)).toEqual([MAP_SRC.PACKAGED_GRAPH, MAP_SRC.DEVICE_CACHE]);
    /* Bilinmeyen bit → geçersiz maske → fail-closed */
    expect(isValidMask(1 << 20)).toBe(false);
    expect(hasSource(1 << 20, MAP_SRC.PACKAGED_GRAPH)).toBe(false);
    expect(addSource(-1, MAP_SRC.PACKAGED_GRAPH)).toBe(MAP_SRC_NONE);
  });

  it('köken yoksa uydurma ad üretilmez', () => {
    expect(describeMask(MAP_SRC_NONE)).toBe('KÖKEN BİLİNMİYOR');
    expect(describeMask(-5)).toBe('KÖKEN BİLİNMİYOR');
    expect(describeMask(MAP_SRC.PACKAGED_GRAPH | MAP_SRC.DEVICE_CACHE)).toContain('+');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   3) LEGACY EDGE ID ADAPTER — precision-safe
   ══════════════════════════════════════════════════════════════════════════ */

describe('F1 · legacyEdgeIdAdapter', () => {
  const ordinals = [0, 1, 42, 1000, 295_345, LEGACY_MAX_EDGE_ORDINAL];

  it('round-trip KAYIPSIZ (sessiz truncate YOK)', () => {
    for (const o of ordinals) {
      for (const d of [0, 1] as const) {
        const id = toCanonicalEdgeId(o, d);
        expect(toLegacyEdgeRef(id), `ordinal=${o} dir=${d}`).toEqual({ edgeOrdinal: o, dir: d });
        expect(Number.isSafeInteger(id.hi)).toBe(true);
        expect(Number.isSafeInteger(id.lo)).toBe(true);
      }
    }
  });

  it('monolit ad alanı işaretlenir; karolu kimlik SESSİZCE yorumlanmaz', () => {
    const legacy = toCanonicalEdgeId(100, 0);
    expect(isLegacyMonolithEdgeId(legacy)).toBe(true);
    expect(splitEdgeId(legacy).tileId).toBe(LEGACY_MONOLITH_TILE_ID);

    const tiled = makeEdgeId(1234, 100, 0);   // gerçek karo kimliği
    expect(isLegacyMonolithEdgeId(tiled)).toBe(false);
    expect(() => toLegacyEdgeRef(tiled)).toThrow(RangeError);
  });

  it('aralık dışı → RangeError (fail-closed)', () => {
    expect(() => toCanonicalEdgeId(-1, 0)).toThrow(RangeError);
    expect(() => toCanonicalEdgeId(LEGACY_MAX_EDGE_ORDINAL + 1, 0)).toThrow(RangeError);
    expect(() => toCanonicalEdgeId(1.5, 0)).toThrow(RangeError);
    expect(() => toCanonicalEdgeId(1, 2 as unknown as 0)).toThrow(RangeError);
  });

  it('kapasite kapısı kimlik uzayını ÖNCEDEN bildirir', () => {
    expect(graphFitsCanonicalIdSpace(MEASURED_GRAPH_EDGE_COUNT)).toBe(true);
    expect(graphFitsCanonicalIdSpace(LEGACY_MAX_EDGE_ORDINAL + 2)).toBe(false);
    expect(graphFitsCanonicalIdSpace(-1)).toBe(false);
  });

  it('GERÇEK ARTEFAKT: public/maps/routing-graph.bin ölçülür ve kimlik uzayına SIĞAR', () => {
    const p = resolve(ROOT, 'public/maps/routing-graph.bin');
    if (!existsSync(p)) {
      /* Artefakt yoksa iddia edilmez — sahte başarı YOK. */
      expect(graphFitsCanonicalIdSpace(MEASURED_GRAPH_EDGE_COUNT)).toBe(true);
      return;
    }
    const buf = readFileSync(p);
    const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    let off = 0;
    const first = v.getUint32(off, true); off += 4;
    const version = first === 0x32475452 ? 2 : 1;          // 'RTG2' LE
    let nodeCount: number;
    if (version === 2) { nodeCount = v.getUint32(off, true); off += 4; } else { nodeCount = first; }
    off += nodeCount * 16;
    const edgeCount = v.getUint32(off, true);

    expect(version, 'graf sürümü RTG2 olmalı').toBe(2);
    expect(nodeCount).toBe(MEASURED_GRAPH_NODE_COUNT);
    expect(edgeCount).toBe(MEASURED_GRAPH_EDGE_COUNT);
    expect(graphFitsCanonicalIdSpace(edgeCount), 'graf kanonik kimlik uzayını aşıyor').toBe(true);

    /* Uçtaki gerçek kenar da kayıpsız çevrilebilmeli. */
    const last = toCanonicalEdgeId(edgeCount - 1, 1);
    expect(toLegacyEdgeRef(last)).toEqual({ edgeOrdinal: edgeCount - 1, dir: 1 });
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   4) MAPSTORE — epistemik durum, fail-closed
   ══════════════════════════════════════════════════════════════════════════ */

function obs(over: Partial<MapDatasetObservation> = {}): MapDatasetObservation {
  return { ...UNMEASURED_DATASET, ...over };
}
function portsOf(o: MapDatasetObservation, extra: Partial<MapDataPorts> = {}): MapDataPorts {
  return { readDataset: () => o, readTilePresence: () => null, readEdgeMetadata: () => null, ...extra };
}

describe('F1 · MapStore epistemik durum', () => {
  it('classifyAvailability dört durumu da üretir + "ölçülmedi" null döner', () => {
    expect(classifyAvailability(obs(), NOW)).toBeNull();                       // ölçülmedi
    expect(classifyAvailability(obs({ available: false }), NOW)).toBe('UNAVAILABLE');
    expect(classifyAvailability(obs({ invalid: true, available: true }), NOW)).toBe('INVALID');
    expect(classifyAvailability(
      obs({ available: true, provenance: MAP_SRC.PACKAGED_GRAPH }), NOW,
    )).toBe('AVAILABLE_FRESH');
    expect(classifyAvailability(obs({
      available: true, observedAtMonoMs: asMonotonic(1_000), freshnessBudgetMs: 5_000,
    }), NOW)).toBe('AVAILABLE_STALE');
    /* Dört durumun HEPSİ sözleşmede tanımlı olmalı. */
    expect(MAP_DATA_AVAILABILITIES).toHaveLength(4);
  });

  it('bütçe yoksa bayatlık HESAPLANMAZ (uydurma eşik YASAK — F0 kuralı)', () => {
    expect(classifyAvailability(obs({
      available: true, observedAtMonoMs: asMonotonic(1), freshnessBudgetMs: null,
    }), asMonotonic(9_999_999))).toBe('AVAILABLE_FRESH');
  });

  it('ÖLÇÜLMEDİ ≠ YOK: hiç ölçülmemiş veri kümesi UNAVAILABLE kanıt döner, "yok" DEMEZ', () => {
    const s = createMapStore(portsOf(obs()));
    const ev = s.getDatasetStatus('TILES', NOW);
    expect(ev.grade).toBe('UNAVAILABLE');
    expect(ev.value).toBeNull();                 // "availability: UNAVAILABLE" İDDİA EDİLMEZ
    expect(ev.reason).toBe('NO_SOURCE');
  });

  it('ölçülüp YOK bulunmuşsa hüküm VERİLİR (UNAVAILABLE durumu, kanıtlı)', () => {
    const s = createMapStore(portsOf(obs({
      available: false, provenance: MAP_SRC.PACKAGED_GRAPH, reason: 'NO_SOURCE',
    })));
    const ev = s.getDatasetStatus('ROUTING_GRAPH', NOW);
    expect(ev.grade).toBe('OBSERVED');
    expect(ev.value?.availability).toBe('UNAVAILABLE');
    expect(ev.value?.provenance).toBe(MAP_SRC.PACKAGED_GRAPH);
  });

  it('BOZUK veri başarı gibi SUNULMAZ', () => {
    const s = createMapStore(portsOf(obs({
      available: true, invalid: true, provenance: MAP_SRC.PACKAGED_GRAPH,
    })));
    const ev = s.getDatasetStatus('ROUTING_GRAPH', NOW);
    expect(ev.value?.availability).toBe('INVALID');
    expect(ev.value?.availability).not.toBe('AVAILABLE_FRESH');
  });

  it('KÖKENSİZ KESİNLİK YASAK: "var" ama köken bilinmiyorsa kanıt UNAVAILABLE\'a düşer', () => {
    const s = createMapStore(portsOf(obs({ available: true, provenance: MAP_SRC_NONE })));
    const ev = s.getDatasetStatus('TILES', NOW);
    expect(ev.grade).toBe('UNAVAILABLE');
    expect(ev.reason).toBe('BELOW_QUALITY_GATE');
  });

  it('bayat gözlem STALE kanıt taşır ve güven tavanı uygulanır', () => {
    const s = createMapStore(portsOf(obs({
      available: true, provenance: MAP_SRC.PACKAGED_TILES,
      observedAtMonoMs: asMonotonic(1_000), freshnessBudgetMs: 5_000,
    })));
    const ev = s.getDatasetStatus('TILES', NOW);
    expect(ev.grade).toBe('STALE');
    expect(ev.value?.availability).toBe('AVAILABLE_STALE');
    expect(ev.confidence).toBeLessThanOrEqual(0.5);
  });

  it('port PATLARSA sessiz "sağlıklı" YOK → PROVIDER_ERROR', () => {
    const s = createMapStore({
      readDataset: () => { throw new Error('boom'); },
      readTilePresence: () => { throw new Error('boom'); },
      readEdgeMetadata: () => { throw new Error('boom'); },
    });
    const ds = s.getDatasetStatus('TILES', NOW);
    expect(ds.grade).toBe('UNAVAILABLE');
    expect(ds.reason).toBe('PROVIDER_ERROR');
    expect(s.hasTile({ z: 12, x: 1, y: 1 }, NOW).reason).toBe('PROVIDER_ERROR');
    expect(s.getEdgeMetadata(makeEdgeId(1, 1, 0), NOW).reason).toBe('PROVIDER_ERROR');
  });

  it('hasTile: geçersiz karo · bilinmeyen varlık · bozuk veri kümesi → hepsi UNAVAILABLE', () => {
    const good = obs({ available: true, provenance: MAP_SRC.PACKAGED_TILES });

    const s1 = createMapStore(portsOf(good, { readTilePresence: () => true }));
    expect(s1.hasTile({ z: 99, x: 0, y: 0 } as TileCoord, NOW).grade).toBe('UNAVAILABLE');

    const s2 = createMapStore(portsOf(good, { readTilePresence: () => null }));
    expect(s2.hasTile({ z: 12, x: 1, y: 1 }, NOW).grade).toBe('UNAVAILABLE');

    const s3 = createMapStore(portsOf(
      obs({ available: true, invalid: true, provenance: MAP_SRC.PACKAGED_TILES }),
      { readTilePresence: () => true },
    ));
    const ev3 = s3.hasTile({ z: 12, x: 1, y: 1 }, NOW);
    expect(ev3.grade).toBe('UNAVAILABLE');
    expect(ev3.reason).toBe('VERSION_MISMATCH');
  });

  it('hasTile: veri kümesi ölçülmediyse tek karo hakkında da hüküm VERİLMEZ', () => {
    const s = createMapStore(portsOf(obs(), { readTilePresence: () => true }));
    expect(s.hasTile({ z: 12, x: 1, y: 1 }, NOW).grade).toBe('UNAVAILABLE');
  });

  it('hasTile: her şey ölçülüyse gerçek hüküm döner', () => {
    const good = obs({ available: true, provenance: MAP_SRC.PACKAGED_TILES });
    const yes = createMapStore(portsOf(good, { readTilePresence: () => true }));
    const no = createMapStore(portsOf(good, { readTilePresence: () => false }));
    expect(yes.hasTile({ z: 12, x: 1, y: 1 }, NOW).value).toBe(true);
    expect(no.hasTile({ z: 12, x: 1, y: 1 }, NOW).value).toBe(false);
  });

  it('getEdgeMetadata: kaynak yoksa UNAVAILABLE · varsa Evidenced değer', () => {
    const graph = obs({ available: true, provenance: MAP_SRC.PACKAGED_GRAPH });
    const none = createMapStore(portsOf(graph));
    expect(none.getEdgeMetadata(makeEdgeId(1, 1, 0), NOW).grade).toBe('UNAVAILABLE');

    const meta: StaticEdgeMetadata = { lengthM: 120, oneway: true, roadClass: 3 };
    const some = createMapStore(portsOf(graph, { readEdgeMetadata: () => meta }));
    const ev = some.getEdgeMetadata(toCanonicalEdgeId(7, 0), NOW);
    expect(ev.grade).toBe('OBSERVED');
    expect(ev.value).toEqual(meta);
    expect(ev.source).toBe('MAP_PACKAGE');
  });

  it('varsayılan port kümesi TAMAMEN fail-closed', () => {
    const s = createMapStore(UNAVAILABLE_MAP_DATA_PORTS);
    for (const d of MAP_DATASET_IDS) {
      expect(s.getDatasetStatus(d, NOW).grade, d).toBe('UNAVAILABLE');
    }
    expect(s.hasTile({ z: 10, x: 5, y: 5 }, NOW).grade).toBe('UNAVAILABLE');
    expect(s.getEdgeMetadata(makeEdgeId(0, 0, 0), NOW).grade).toBe('UNAVAILABLE');
  });

  it('getSnapshot her veri kümesini taşır ve kökenleri birleştirir', () => {
    const s = createMapStore({
      readDataset: (d) => (d === 'ROUTING_GRAPH'
        ? obs({ available: true, provenance: MAP_SRC.PACKAGED_GRAPH })
        : d === 'TILES'
          ? obs({ available: true, provenance: MAP_SRC.DEVICE_CACHE })
          : obs()),
      readTilePresence: () => null,
      readEdgeMetadata: () => null,
    });
    const snap = s.getSnapshot(NOW);
    expect(snap.datasets).toHaveLength(MAP_DATASET_IDS.length);
    expect(hasSource(snap.provenance, MAP_SRC.PACKAGED_GRAPH)).toBe(true);
    expect(hasSource(snap.provenance, MAP_SRC.DEVICE_CACHE)).toBe(true);
    expect(hasSource(snap.provenance, MAP_SRC.ONLINE_TILES)).toBe(false);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   5) MİMARİ KİLİTLER
   ══════════════════════════════════════════════════════════════════════════ */

describe('F1 · map/store/** mimari kilitleri', () => {
  it('hiçbir dosya timer · abonelik · scheduler · React · saat SAHİBİ değil', () => {
    expect(storeFiles.length).toBeGreaterThanOrEqual(5);
    for (const f of storeFiles) {
      const src = strip(readSrc(`${STORE_DIR}/${f}`));
      expect(src, `${f}: setInterval`).not.toContain('setInterval(');
      expect(src, `${f}: setTimeout`).not.toContain('setTimeout(');
      expect(src, `${f}: requestAnimationFrame`).not.toContain('requestAnimationFrame(');
      expect(src, `${f}: scheduleTask`).not.toContain('scheduleTask');
      expect(src, `${f}: abonelik`).not.toContain('.subscribe(');
      expect(src, `${f}: addEventListener`).not.toContain('addEventListener(');
      expect(src, `${f}: React`).not.toMatch(/from ['"]react['"]/);
      expect(src, `${f}: Date.now()`).not.toContain('Date.now(');
      expect(src, `${f}: performance.now()`).not.toContain('performance.now(');
      expect(src, `${f}: ağ çağrısı`).not.toContain('fetch(');
      expect(src, `${f}: node:fs`).not.toContain('node:fs');
    }
  });

  it('SAF çekirdek dosyalar hiçbir servisi import ETMEZ (yalnız göreli sözleşme)', () => {
    for (const f of ['tileGrid.ts', 'mapProvenance.ts', 'legacyEdgeIdAdapter.ts', 'mapStore.ts']) {
      const imports = [...readSrc(`${STORE_DIR}/${f}`).matchAll(/from\s+['"]([^'"]+)['"]/g)]
        .map((m) => m[1]);
      for (const imp of imports) {
        expect(imp.startsWith('./') || imp.startsWith('../../contracts/'),
          `${f}: yasak import ${imp} (saf çekirdek yalnız kendi paketi + F0 sözleşmeleri)`).toBe(true);
      }
    }
  });

  it('okuma katmanı MEVCUT otoriteleri sarar — yeni harita otoritesi KURMAZ', () => {
    const raw = readSrc(`${STORE_DIR}/mapStoreSources.ts`);
    expect(raw, 'mevcut graf yeteneği otoritesi okunmalı').toContain('offlineRoutingStatus');
    expect(raw, 'mevcut karo kaynak deposu okunmalı').toContain('mapSourceStore');
    /* Kaynakları TETİKLEMEZ / BAŞLATMAZ. Yorumlar sıyrılır — bir SÖZ bir
       ÇAĞRI değildir (docblock bu isimleri gerekçe olarak anar). */
    const src = strip(raw);
    for (const forbidden of [
      'initializeMapSources', 'refreshMapSources', 'probeLocalTiles',
      'downloadRegion', 'recordOfflineGraphOutcome', 'setActiveMapSource', 'setState(',
    ]) {
      expect(src, `okuma katmanı ${forbidden} çağırıyor — salt-okunur ihlali`).not.toContain(forbidden);
    }
  });

  it('TEK L1 CEPHESİ: createMapStore / MapStore arayüzü bir kez tanımlı', () => {
    const all = storeFiles.map((f) => readSrc(`${STORE_DIR}/${f}`));
    for (const decl of ['export function createMapStore', 'export interface MapStore', 'export interface MapDataPorts']) {
      expect(all.filter((s) => s.includes(decl)).length, decl).toBe(1);
    }
  });

  it('TEK SLIPPY FORMÜLÜ: Web Mercator karo matematiği src\'de tek dosyada', () => {
    const hits: string[] = [];
    const walk = (rel: string) => {
      for (const e of readdirSync(resolve(SRC, rel), { withFileTypes: true })) {
        const p = `${rel}/${e.name}`;
        if (e.isDirectory()) { if (e.name !== '__tests__') walk(p); continue; }
        if (!/\.tsx?$/.test(e.name)) continue;
        if (readFileSync(resolve(SRC, p), 'utf8').includes('Math.log(Math.tan(')) hits.push(p);
      }
    };
    walk('.');
    expect(hits, `slippy formülü ${hits.length} dosyada — tek kaynak olmalı`).toEqual([`./${STORE_DIR}/tileGrid.ts`]);
  });

  it('EdgeId · EvidenceGrade · Evidenced src genelinde TEK KEZ tanımlı (kopya yok)', () => {
    const counts: Record<string, string[]> = {
      'export interface EdgeId {': [],
      'export type EvidenceGrade': [],
      'export interface Evidenced<': [],
    };
    const walk = (rel: string) => {
      for (const e of readdirSync(resolve(SRC, rel), { withFileTypes: true })) {
        const p = `${rel}/${e.name}`;
        if (e.isDirectory()) { if (e.name !== '__tests__') walk(p); continue; }
        if (!/\.tsx?$/.test(e.name)) continue;
        const s = readFileSync(resolve(SRC, p), 'utf8');
        for (const decl of Object.keys(counts)) if (s.includes(decl)) counts[decl].push(p);
      }
    };
    walk('.');
    for (const [decl, files] of Object.entries(counts)) {
      expect(files.length, `${decl} → ${files.join(', ')}`).toBe(1);
    }
  });
});

describe('F1 · L4–L6 ham harita kaynağı borcu BÜYÜMEDİ', () => {
  /* L4 Routing · L5 Guidance · L6 Arbitration dosyaları. Bu katmanlar statik
     harita gerçeğini L1 MapStore'dan alır; ham kaynağa DOĞRUDAN bağlanamaz. */
  const L4_L6_FILES = [
    'platform/routingService.ts',
    'platform/navigationService.ts',
    'platform/navigation/voiceGuidanceRuntime.ts',
  ];
  const RAW_MAP_MODULES = [
    'gpsService', 'mapService', 'mapSourceManager', 'mapSourceStore',
    'mapTileProbe', 'offlineTileDownloader', 'speedLimitService',
    'geo/overpassCategorySearch', 'offlineDataService',
  ];

  it('L4–L6 hiçbir ham harita/konum kaynağını DOĞRUDAN import etmiyor', () => {
    for (const rel of L4_L6_FILES) {
      const imports = [...readSrc(rel).matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);
      for (const imp of imports) {
        for (const raw of RAW_MAP_MODULES) {
          const base = imp.split('/').pop() ?? imp;
          expect(base === raw || imp.endsWith(`/${raw}`),
            `${rel}: yasak ham kaynak importu "${imp}" — statik harita gerçeği L1 MapStore'dan alınır`,
          ).toBe(false);
        }
      }
    }
  });

  it('Guardian (L6) ham kaynakları PORT arkasında tutmaya devam ediyor', () => {
    /* `providers/concrete/**` bilinçli yalıtım katmanıdır; motor ve kurallar
       ham kaynağa DOKUNAMAZ. */
    const walk = (rel: string, acc: string[] = []): string[] => {
      for (const e of readdirSync(resolve(SRC, rel), { withFileTypes: true })) {
        const p = `${rel}/${e.name}`;
        if (e.isDirectory()) walk(p, acc);
        else if (e.name.endsWith('.ts')) acc.push(p);
      }
      return acc;
    };
    const files = walk('platform/navigation/guardian')
      .filter((p) => !p.includes('/providers/concrete/'));
    expect(files.length).toBeGreaterThan(10);
    for (const p of files) {
      const src = readSrc(p);
      for (const raw of ['gpsService', 'mapSourceManager', 'mapService', 'overpass', 'mapTileProbe']) {
        expect(src.includes(`from '../${raw}'`) || src.includes(`/${raw}'`),
          `${p}: ham kaynak "${raw}" port dışına sızmış`).toBe(false);
      }
    }
  });
});
