/**
 * tomtomTraffic.test — TomTom akış/olay çözücüleri (belgelenmiş yanıt biçimleri).
 * Eksik alan UYDURULMAZ; ağ hatası "akıcı" sayılmaz.
 */
import { describe, it, expect } from 'vitest';
import {
  parseFlowSegment, parseIncidents, levelFromSpeeds, flowTileUrl, incidentsUrl, fetchRoad, haversineM,
} from '../platform/traffic/tomtomTraffic';

describe('akış (Flow Segment Data v4)', () => {
  it('anlık/serbest hız, gecikme, geometri ve seviye çözülür', () => {
    const r = parseFlowSegment({
      flowSegmentData: {
        frc: 'FRC2', currentSpeed: 22, freeFlowSpeed: 60, currentTravelTime: 180, freeFlowTravelTime: 66,
        confidence: 0.92, roadClosure: false,
        coordinates: { coordinate: [{ latitude: 36.91, longitude: 34.89 }, { latitude: 36.912, longitude: 34.895 }] },
      },
    })!;
    expect(r.level).toBe('heavy');
    expect(r.delaySec).toBe(114);
    expect(r.coordinates).toEqual([[34.89, 36.91], [34.895, 36.912]]);
    expect(r.frc).toBe('FRC2');
  });

  it('kapalı yol → tıkalı; hız yoksa null (uydurma yok)', () => {
    expect(parseFlowSegment({ flowSegmentData: { currentSpeed: 0, freeFlowSpeed: 50, roadClosure: true } })!.level).toBe('standstill');
    expect(parseFlowSegment({ flowSegmentData: { freeFlowSpeed: 50 } })).toBeNull();
    expect(parseFlowSegment({})).toBeNull();
  });

  it('seviye eşikleri', () => {
    expect(levelFromSpeeds(50, 50)).toBe('free');
    expect(levelFromSpeeds(30, 50)).toBe('moderate');
    expect(levelFromSpeeds(15, 50)).toBe('heavy');
    expect(levelFromSpeeds(5, 50)).toBe('standstill');
  });
});

describe('olaylar (Incident Details v5)', () => {
  const raw = {
    incidents: [
      { type: 'Feature', geometry: { type: 'LineString', coordinates: [[34.95, 36.92], [34.96, 36.93]] },
        properties: { id: 'a1', iconCategory: 6, magnitudeOfDelay: 2, events: [{ description: 'Duran trafik' }],
          from: 'Adana Yolu', to: 'Tarsus Merkez', length: 1850, delay: 420, roadNumbers: ['D400'] } },
      { type: 'Feature', geometry: { type: 'Point', coordinates: [34.90, 36.915] },
        properties: { id: 'b2', iconCategory: 1, magnitudeOfDelay: 3, events: [{ description: 'Kaza' }], from: 'Çevre Yolu', delay: 900 } },
      { type: 'Feature', geometry: { type: 'LineString', coordinates: [[34.8, 36.8]] },
        properties: { id: 'c3', iconCategory: 9, magnitudeOfDelay: 1, events: [{ description: 'Yol çalışması' }] } },
      { type: 'Feature', geometry: {}, properties: { id: 'bad' } },
    ],
  };

  it('tür, gerçek yol adları, gecikme; geometrisiz kayıt atlanır; gecikmeye göre sıralı', () => {
    const list = parseIncidents(raw, [34.89, 36.91]);
    expect(list.map((i) => i.id)).toEqual(['b2', 'a1', 'c3']);
    expect(list[0]).toMatchObject({ kind: 'accident', from: 'Çevre Yolu', delaySec: 900 });
    expect(list[1]).toMatchObject({ kind: 'jam', from: 'Adana Yolu', to: 'Tarsus Merkez', roadNumbers: ['D400'], lengthM: 1850 });
    expect(list[2]).toMatchObject({ kind: 'roadworks', delaySec: null, from: null });
    expect(list[0]!.distanceM).toBeGreaterThan(0);
  });

  it('bozuk yanıt → boş liste', () => {
    expect(parseIncidents(null, null)).toEqual([]);
    expect(parseIncidents({ incidents: 'x' }, null)).toEqual([]);
  });

  it('mesafe hesabı makul (≈1 km)', () => {
    expect(haversineM([34.89, 36.91], [34.89, 36.919])).toBeGreaterThan(950);
    expect(haversineM([34.89, 36.91], [34.89, 36.919])).toBeLessThan(1050);
  });
});

describe('istekler', () => {
  it('katman ve olay URL\'leri anahtarı kodlar, Türkçe dil ve güncel olay filtresi ister', () => {
    expect(flowTileUrl('k&1')).toContain('/tile/flow/relative0/{z}/{x}/{y}.png?key=k%261');
    const u = incidentsUrl('k', 36.91, 34.89);
    expect(u).toContain('language=tr-TR');
    expect(u).toContain('timeValidityFilter=present');
    expect(u).toContain('bbox=34.83000,36.85000,34.95000,36.97000');
  });

  it('HTTP hatası fırlatır (akıcı SANILMAZ)', async () => {
    const f = async () => new Response('nope', { status: 403 });
    await expect(fetchRoad('k', 1, 2, f)).rejects.toThrow('403');
  });
});
