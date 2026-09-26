/**
 * trafficPanel.test — trafik paneli YALNIZ gerçek veri gösterir.
 *
 * Saha (2026-09-23, Tarsus): anahtar yokken saat tablosu + SABİT listeden uydurma
 * "Çevre Yolu · doğu · Akıcı" ve konum çevresine sahte noktalar gösteriliyordu.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { TrafficState } from '../platform/trafficService';

const M = vi.hoisted(() => ({ state: null as unknown as TrafficState, loc: { latitude: 36.91, longitude: 34.89 } as unknown }));

vi.mock('../components/traffic/TrafficMapMini', () => ({ TrafficMapMini: () => null }));
vi.mock('../platform/vehicleDataLayer/UnifiedVehicleStore', () => ({
  useUnifiedVehicleStore: (sel: (s: { location: unknown }) => unknown) => sel({ location: M.loc }),
}));
vi.mock('../platform/trafficService', async (orig) => ({
  ...(await orig<typeof import('../platform/trafficService')>()),
  useTrafficState: () => M.state,
}));

import { TrafficPanel } from '../components/traffic/TrafficPanel';
import { fmtDelay, fmtDistance, fmtAge, incidentRoute, roadSpeedLine } from '../components/traffic/trafficPanelModel';

const base: TrafficState = { summary: null, tileLayerUrl: '', showLayer: false, loading: false, error: null, unavailable: null };
const html = () => { const d = document.createElement('div'); d.innerHTML = renderToStaticMarkup(<TrafficPanel />); return d; };

beforeEach(() => { M.state = base; M.loc = { latitude: 36.91, longitude: 34.89 }; });

describe('uydurma veri YOK', () => {
  it('🔒 anahtar yokken neden kartı; uydurma yol adı/yoğunluk çizilmez', () => {
    M.state = { ...base, unavailable: 'no_key' };
    const d = html();
    expect(d.querySelector('[data-traffic-unavailable="no_key"]')).not.toBeNull();
    expect(d.textContent).not.toMatch(/Çevre Yolu|Bağlantı Yolu|Bulvar|Akıcı|Tahmini/);
    expect(d.textContent).toContain('canlı veri yok');
  });

  it('konum yoksa "Konum bekleniyor"', () => {
    M.loc = null;
    M.state = { ...base };
    expect(html().querySelector('[data-traffic-unavailable="no_location"]')).not.toBeNull();
  });
});

describe('TomTom canlı veri', () => {
  it('bulunduğun yol + gerçek adlı olaylar + TomTom atfı', () => {
    M.state = {
      ...base, tileLayerUrl: 'https://tiles/{z}/{x}/{y}.png',
      summary: {
        level: 'heavy', delayMin: 2, updatedAt: Date.now(), segments: [], tileEnabled: true, source: 'tomtom',
        road: { currentSpeedKmh: 22, freeFlowSpeedKmh: 60, confidence: 0.9, roadClosed: false, delaySec: 114, level: 'heavy', frc: 'FRC2', coordinates: [] },
        incidents: [{
          id: 'a', kind: 'accident', description: 'Kaza', from: 'Adana Yolu', to: 'Tarsus Merkez', roadNumbers: ['D400'],
          delaySec: 420, lengthM: 1800, magnitude: 3, coordinates: [[34.9, 36.92]], distanceM: 1250,
        }],
      },
    };
    const d = html();
    expect(d.querySelector('[data-traffic-source="tomtom"]')).not.toBeNull();
    expect(d.querySelector('[data-traffic-road]')?.textContent).toContain('22 km/s · normalde 60 km/s');
    const inc = d.querySelector('[data-traffic-incident="accident"]')!;
    expect(inc.textContent).toContain('Adana Yolu → Tarsus Merkez · D400');
    expect(inc.textContent).toContain('+7 dk');
    expect(inc.textContent).toContain('1,3 km');
    expect(d.textContent).toContain('© TomTom');
  });

  it('olay yoksa dürüst "bildirilmiş olay yok"', () => {
    M.state = { ...base, summary: { level: 'free', delayMin: 0, updatedAt: Date.now(), segments: [], tileEnabled: false, source: 'tomtom', road: null, incidents: [] } };
    expect(html().textContent).toContain('Çevrede bildirilmiş olay yok');
  });
});

describe('biçim kuralları', () => {
  it('gecikme/mesafe/yaş; bilinmeyen parça gösterilmez', () => {
    expect(fmtDelay(30)).toBeNull();
    expect(fmtDelay(420)).toBe('+7 dk');
    expect(fmtDelay(3900)).toBe('+1 sa 5 dk');
    expect(fmtDelay(null)).toBeNull();
    expect(fmtDistance(430)).toBe('430 m');
    expect(fmtDistance(1250)).toBe('1,3 km');
    expect(fmtAge(1000, 1000 + 150_000)).toBe('3 dk önce');
    expect(incidentRoute({ from: null, to: null, roadNumbers: [] } as never)).toBeNull();
    expect(roadSpeedLine({ roadClosed: true } as never)).toBe('Yol kapalı');
  });
});
