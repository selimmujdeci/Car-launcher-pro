/**
 * VehicleStatusCard — kapılar · bagaj · lastikler aracın bildirdiği gibi; sahte değer yok.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

const fake = vi.hoisted(() => ({ state: { canDoors: null as unknown, canTpms: null as unknown } }));
vi.mock('../platform/vehicleDataLayer/UnifiedVehicleStore', () => {
  const hook = (sel: (s: typeof fake.state) => unknown) => sel(fake.state);
  hook.getState = () => fake.state;
  return { useUnifiedVehicleStore: hook };
});

import { VehicleStatusCard } from '../components/vehicle/VehicleStatusCard';
import { tireAxleLow } from '../platform/vehicleDataLayer/canComfortControl';

beforeEach(() => { fake.state = { canDoors: null, canTpms: null }; });

describe('araç silüeti', () => {
  it('açık kapı/bagaj ve lastik değerleri aracın bildirdiği gibi', () => {
    fake.state = {
      canDoors: { frontLeft: true, frontRight: false, rearLeft: false, rearRight: false, trunk: true },
      canTpms: { statusCode: 2, bar: [2.37, 2.37, null, 1.89], atMs: 1 },
    };
    const html = renderToStaticMarkup(<VehicleStatusCard />);
    expect(html).toContain('Açık: ön sol kapı, bagaj');
    expect(html).toContain('2,4');
    expect(html).toContain('1,9');
    expect(html).toContain('—');                 // ölçülmeyen teker
  });

  it('veri yoksa dürüst metin; sahte "kapalı" yok', () => {
    const html = renderToStaticMarkup(<VehicleStatusCard />);
    expect(html).toContain('Kapı bilgisi gelmiyor');
    expect(html).toContain('Lastik basıncı henüz gelmedi.');
    expect(html).not.toContain('Tüm kapılar ve bagaj kapalı');
  });
});

describe('aynı aks lastik kuralı (Mavi ile ortak)', () => {
  it('yalnız aynı akstaki ≥0,3 bar fark işaretlenir; ön/arka farkı değil', () => {
    expect(tireAxleLow([2.4, 2.4, 2.0, 1.9])).toEqual([null, null, null, null]);
    expect(tireAxleLow([2.4, 2.4, 2.0, 1.6])).toEqual([null, null, null, 0.4]);
    expect(tireAxleLow([2.0, 2.4, null, 1.6])).toEqual([0.4, null, null, null]);
  });
});
