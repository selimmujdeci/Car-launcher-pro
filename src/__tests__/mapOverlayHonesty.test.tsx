/**
 * Harita kaynak rozeti + GPS katmanı — sahte "ONLINE" yok, çift kart yok.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => Object.defineProperty(navigator, 'userAgent', { value: 'Vitest', configurable: true }));

const source = vi.hoisted(() => ({
  net: { servingFrom: null as 'local' | 'online' | 'cached' | null, isOnline: true },
}));
vi.mock('../platform/mapSourceManager', () => ({ useMapNetworkStatus: () => source.net }));
vi.mock('../platform/gpsService', () => ({ useGPSState: () => ({ unavailable: false }) }));
vi.mock('../platform/mapService', () => ({ useDrivingMode: () => false }));

import { MapOverlay } from '../components/map/MapOverlay';

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  source.net = { servingFrom: null, isOnline: true };
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
});
const badge = () => container.querySelector('[data-testid="map-source-badge"]')?.textContent ?? null;

describe('MapOverlay compact — kaynak rozeti', () => {
  it('kaynak bilinmiyorsa rozet yok (eskiden "ONLINE")', () => {
    act(() => root.render(<MapOverlay compact location={null} speedKmh={null} />));
    expect(badge()).toBeNull();
  });

  it('çevrimiçi kaynak + bağlantı var → ONLINE; bağlantı yok → BAĞLANTI YOK', () => {
    // memo'lu bileşen mock hook'u yeniden okumaz → her durumda taze örnek (key).
    const cases = [
      [{ servingFrom: 'online', isOnline: true }, 'ONLINE'],
      [{ servingFrom: 'online', isOnline: false }, 'BAĞLANTI YOK'],
      [{ servingFrom: 'local', isOnline: false }, 'YEREL'],
    ] as const;
    cases.forEach(([net, label], i) => {
      source.net = { ...net };
      act(() => root.render(<MapOverlay key={i} compact location={null} speedKmh={null} />));
      expect(badge()).toBe(label);
    });
  });

  it('compact modda GPS-bekleniyor kartı çizilmez (sahibi MiniMapWidget)', () => {
    act(() => root.render(<MapOverlay compact location={null} speedKmh={null} />));
    expect(container.textContent).not.toMatch(/GPS BEKLENİYOR|GPS HATASI/);
  });
});

describe('tema harita kartları — sabit "Online" çipi yok', () => {
  it.each(['TeslaLayout.tsx', 'HorizonLayout.tsx'])('%s', (f) => {
    const src = readFileSync(join(__dirname, '../components/themes', f), 'utf8');
    expect(src).not.toMatch(/>\s*Online\s*</);
  });

  it('Tesla harita +/− düğmeleri gerçek zoom çağırır', () => {
    const src = readFileSync(join(__dirname, '../components/themes/TeslaLayout.tsx'), 'utf8');
    expect(src).toMatch(/m\?\.zoomIn\(\); else m\?\.zoomOut\(\);/);
  });
});
