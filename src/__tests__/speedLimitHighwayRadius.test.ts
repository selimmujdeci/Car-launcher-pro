/**
 * speedLimitHighwayRadius.test.ts — KİLİT: hız limiti levhasının geçerlilik
 * yarıçapı yol SINIFINDAN türer.
 *
 * SAHA ÖLÇÜMÜ 2026-08-04 (cihaz `4L45OFZDX84X55GE`, Ankara-Tarsus Otoyolu O-21,
 * ortalama 89 km/h, 50 saniye, 1 sn'lik DOM örneklemesi):
 *
 *   Overpass GERÇEK veri döndürdü — `maxspeed=130`, `highway=motorway`,
 *   `name=Ankara-Tarsus Otoyolu` (HTTP 200, 0,8 sn). Levha DOĞRU değeri (130)
 *   gösterdi ama ekranda kalma oranı yalnız **%36** oldu:
 *
 *     ...................130130130130130...130130130130130130..130130130130130130130........
 *
 *   Yani sürücü levhaya bakamadı — sürekli yanıp söndü.
 *
 * KÖK: sabit `SPEED_LIMIT_MAX_DISTANCE_M = 200`. 89 km/h = 24,7 m/s → 200 m
 * **8 saniyede** aşılıyor; ölçülen ardışık Overpass sorgu aralığı ~9 sn.
 * Yani levha yapısal olarak yetişemiyordu.
 *
 * Bu dosya düzeltmeyi ve — daha önemlisi — ŞEHİR İÇİ DAVRANIŞININ
 * DEĞİŞMEDİĞİNİ kilitler.
 */
import { describe, it, expect } from 'vitest';
import {
  classifySpeedLimit, isSpeedLimitDisplayable, speedLimitMaxDistanceM,
  SPEED_LIMIT_MAX_DISTANCE_M,
  type SpeedLimitObservation,
} from '../platform/navigation/core/speedLimitTruthModel';

/** ~1 derece boylam ≈ 111 320 m × cos(enlem). Sahadaki enlemde (37,6°) kullanılır. */
const LAT = 37.65;
function lonOffsetFor(meters: number): number {
  return meters / (111_320 * Math.cos(LAT * (Math.PI / 180)));
}

function obs(over: Partial<SpeedLimitObservation> = {}): SpeedLimitObservation {
  return {
    kmh: 130,
    source: 'osm',
    resolvedAtMs: 1_000,
    resolvedAtLat: LAT,
    resolvedAtLon: 34.68,
    conflicting: false,
    highway: 'motorway',
    ...over,
  };
}

describe('yarıçap yol sınıfından türer', () => {
  it('bilinmeyen/boş sınıf muhafazakâr 200 m varsayılanında kalır', () => {
    expect(speedLimitMaxDistanceM(null)).toBe(SPEED_LIMIT_MAX_DISTANCE_M);
    expect(speedLimitMaxDistanceM(undefined)).toBe(SPEED_LIMIT_MAX_DISTANCE_M);
    expect(speedLimitMaxDistanceM('bilinmeyen_sinif')).toBe(SPEED_LIMIT_MAX_DISTANCE_M);
  });

  it('ŞEHİR İÇİ DEĞİŞMEZ — residential/service/living_street hâlâ 200 m', () => {
    // REGRESYON KİLİDİ: dar sokakta 200 m gerçekten yeni bir yol olabilir.
    for (const h of ['residential', 'service', 'living_street', 'unclassified']) {
      expect(speedLimitMaxDistanceM(h)).toBe(SPEED_LIMIT_MAX_DISTANCE_M);
    }
  });

  it('otoyol > ana yol > ara yol sıralaması korunur', () => {
    expect(speedLimitMaxDistanceM('motorway')).toBeGreaterThan(speedLimitMaxDistanceM('primary'));
    expect(speedLimitMaxDistanceM('primary')).toBeGreaterThan(speedLimitMaxDistanceM('secondary'));
    expect(speedLimitMaxDistanceM('secondary')).toBeGreaterThan(speedLimitMaxDistanceM('residential'));
    expect(speedLimitMaxDistanceM('motorway_link')).toBe(speedLimitMaxDistanceM('motorway'));
  });
});

describe('SAHA SENARYOSU — otoyolda 89 km/h', () => {
  /** 89 km/h × 8 sn ≈ 198 m; ölçümde levha tam burada kayboluyordu. */
  const M_8SN = 198;
  /** İki Overpass sorgusu arasında ölçülen gerçek yer değiştirme (9 sn). */
  const M_9SN = 248;

  it('KRİTİK: otoyolda 248 m sonra levha HÂLÂ görünür (eskiden gizleniyordu)', () => {
    const v = classifySpeedLimit(
      obs({ highway: 'motorway' }),
      { lat: LAT, lon: 34.68 + lonOffsetFor(M_9SN), nowMs: 2_000 },
      false,
    );
    expect(v.state).toBe('AVAILABLE');
    expect(v.kmh).toBe(130);
    expect(isSpeedLimitDisplayable(v)).toBe(true);
    expect(v.distanceFromFixM).toBeGreaterThan(SPEED_LIMIT_MAX_DISTANCE_M);
  });

  it('aynı mesafe ŞEHİR İÇİ sokakta hâlâ STALE — dürüstlük korunur', () => {
    const v = classifySpeedLimit(
      obs({ highway: 'residential', kmh: 50 }),
      { lat: LAT, lon: 34.68 + lonOffsetFor(M_9SN), nowMs: 2_000 },
      false,
    );
    expect(v.state).toBe('STALE');
    expect(v.kmh).toBeNull();          // AVAILABLE dışında ASLA sayı dönmez
    expect(isSpeedLimitDisplayable(v)).toBe(false);
  });

  it('otoyolda 8 saniyelik mesafede de kesintisiz görünür', () => {
    const v = classifySpeedLimit(
      obs({ highway: 'motorway' }),
      { lat: LAT, lon: 34.68 + lonOffsetFor(M_8SN), nowMs: 2_000 },
      false,
    );
    expect(v.state).toBe('AVAILABLE');
  });

  it('otoyolda bile sınıfın yarıçapı AŞILIRSA gizlenir (sınırsız değil)', () => {
    const v = classifySpeedLimit(
      obs({ highway: 'motorway' }),
      { lat: LAT, lon: 34.68 + lonOffsetFor(speedLimitMaxDistanceM('motorway') + 50), nowMs: 2_000 },
      false,
    );
    expect(v.state).toBe('STALE');
    expect(v.kmh).toBeNull();
  });
});

describe('diğer dürüstlük kapıları yarıçaptan ETKİLENMEZ', () => {
  it('çelişen limitler otoyolda da gizlenir', () => {
    const v = classifySpeedLimit(
      obs({ highway: 'motorway', conflicting: true }),
      { lat: LAT, lon: 34.68, nowMs: 2_000 },
      false,
    );
    expect(v.state).toBe('CONFLICTED');
    expect(v.kmh).toBeNull();
  });

  it('yol sınıfından ÇIKARIM otoyolda da levha sayılmaz (allowInferred=false)', () => {
    const v = classifySpeedLimit(
      obs({ highway: 'motorway', source: 'inferred' }),
      { lat: LAT, lon: 34.68, nowMs: 2_000 },
      false,
    );
    expect(v.state).toBe('UNAVAILABLE');
    expect(v.kmh).toBeNull();
  });

  it('yaş tavanı (3 dk) yarıçaptan bağımsız çalışır', () => {
    const v = classifySpeedLimit(
      obs({ highway: 'motorway' }),
      { lat: LAT, lon: 34.68, nowMs: 1_000 + 180_001 },
      false,
    );
    expect(v.state).toBe('STALE');
    expect(v.kmh).toBeNull();
  });
});
