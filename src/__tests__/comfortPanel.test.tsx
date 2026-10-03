/**
 * ComfortPanel — koltuk masajı + iç ambiyans kontrolleri yalnız araç bildirdiyse görünür;
 * gösterilen durum aracın bildirdiğidir (yerel sahte durum yok).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

const fake = vi.hoisted(() => ({ state: { canMassage: null as unknown, canAmbient: null as unknown } }));
vi.mock('../platform/vehicleDataLayer/UnifiedVehicleStore', () => {
  const hook = (sel: (s: typeof fake.state) => unknown) => sel(fake.state);
  hook.getState = () => fake.state;
  return { useUnifiedVehicleStore: hook };
});

import { ComfortPanel } from '../components/climate/ComfortPanel';
import type { VehicleAccessState, FeatureAvailability } from '../platform/vehicleDataLayer/vehicleAccess';

const access = (massage: FeatureAvailability, ambient: FeatureAvailability): VehicleAccessState => ({
  tier: 'FULL', missingSetup: [], profile: null, rawFlowing: true, stream: 'LIVE', streamAgeMs: 1000,
  features: { climate: 'AVAILABLE', doors: 'AVAILABLE', steering: 'AVAILABLE', tpms: 'AVAILABLE', trip: 'AVAILABLE', massage, ambient },
});

beforeEach(() => { fake.state = { canMassage: null, canAmbient: null }; });

describe('konfor paneli', () => {
  it('araç bildiriyor → aracın durumu gösterilir (masaj tonik · 4/5 · ambiyans %50)', () => {
    fake.state = {
      canMassage: { driverOn: true, mode: 2, strength: 3, speed: 5, passengerOn: false, atMs: 1 },
      canAmbient: { on: true, front: true, rear: true, colorIndex: 1, brightness: 50, atMs: 1 },
    };
    const html = renderToStaticMarkup(<ComfortPanel access={access('AVAILABLE', 'AVAILABLE')} />);
    expect(html).toContain('Koltuk masajı');
    expect(html).toContain('tonik');
    expect(html).toContain('4/5');
    expect(html).toContain('İç ambiyans');
    expect(html).toContain('%50');
    expect(html).toContain('aria-label="kırmızı"');
  });

  it('araç bildirmiyorsa hiç görünmez; kurulum yoksa yol gösterir', () => {
    expect(renderToStaticMarkup(<ComfortPanel access={access('NOT_SEEN', 'NOT_SEEN')} />)).toBe('');
    expect(renderToStaticMarkup(<ComfortPanel access={null} />)).toBe('');
    expect(renderToStaticMarkup(<ComfortPanel access={access('LOCKED', 'LOCKED')} />))
      .toContain('bir kerelik araç bağlantısı kurulumu gerekiyor');
  });
});
