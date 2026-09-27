/**
 * Ana ekran temaları — sahte araç rozetleri kalıcı olarak kapalı.
 *
 * Eskiden: Pro sabit "90" limit + "D AUTO", Tesla "D AUTO" + "4WD" + "Normal",
 * Expedition "Normal", Horizon "4WD · High" + "Normal" basıyordu — OBD'siz,
 * araç kapalıyken bile. Artık tek projeksiyon (`useThemeVehicleBadges`) kanonik
 * kaynaklardan okur; kanıt yoksa rozet çizilmez / "Veri Yok" görünür.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => Object.defineProperty(navigator, 'userAgent', { value: 'Vitest', configurable: true }));

const source = vi.hoisted(() => ({
  veh: 'obd-offline' as string,
  vehicle: { canGearPos: null as number | null },
  limit: { effectiveLimitKmh: null as number | null, state: 'UNKNOWN' as string },
}));

vi.mock('../hooks/useLivingThemeState', () => ({ useLivingThemeState: () => ({ veh: source.veh }) }));
vi.mock('../platform/vehicleDataLayer/UnifiedVehicleStore', () => ({
  useUnifiedVehicleStore: (select: (s: typeof source.vehicle) => unknown) => select(source.vehicle),
}));
vi.mock('../platform/navigation/useEffectiveSpeedLimit', () => ({ useEffectiveSpeedLimit: () => source.limit }));

import {
  useVehicleStatusBadge, useGearLabel, useSpeedLimitSign, vehicleStatusColor,
} from '../hooks/useThemeVehicleBadges';

let root: Root;
let container: HTMLDivElement;
let seen: { status: ReturnType<typeof useVehicleStatusBadge>; gear: string | null; limit: ReturnType<typeof useSpeedLimitSign> } | null;

function Probe() {
  seen = { status: useVehicleStatusBadge(), gear: useGearLabel(), limit: useSpeedLimitSign() };
  return null;
}

beforeEach(() => {
  source.veh = 'obd-offline';
  source.vehicle = { canGearPos: null };
  source.limit = { effectiveLimitKmh: null, state: 'UNKNOWN' };
  seen = null;
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

const probe = () => { act(() => root.render(<Probe />)); return seen!; };

describe('useThemeVehicleBadges — kanıt yoksa sahte değer yok', () => {
  it('OBD yok → "Normal" DEĞİL; vites ve limit null', () => {
    const r = probe();
    expect(r.status.status).toBe('obd-offline');
    expect(r.status.label).toBe('OBD Bağlı Değil');
    expect(r.status.short).toBe('Veri Yok');
    expect(r.status.tone).toBe('unknown');
    expect(r.gear).toBeNull();
    expect(r.limit).toBeNull();
  });

  it('canlı durum eksenleri doğru etiket/ton alır', () => {
    for (const [veh, label, tone] of [
      ['normal', 'Normal', 'ok'], ['fuel-low', 'Yakıt Düşük', 'warn'], ['temp-high', 'Motor Isısı Yüksek', 'critical'],
    ] as const) {
      source.veh = veh;
      const r = probe();
      expect([r.status.label, r.status.tone]).toEqual([label, tone]);
    }
    expect(vehicleStatusColor('ok', 'INK', 'MUTED')).toBe('INK');
    expect(vehicleStatusColor('unknown', 'INK', 'MUTED')).toBe('MUTED');
  });

  it('vites CAN canGearPos → gearLabel (kokpitle aynı hüküm)', () => {
    source.vehicle = { canGearPos: -1 }; expect(probe().gear).toBe('R');
    source.vehicle = { canGearPos: 0 };  expect(probe().gear).toBe('N/P');
    source.vehicle = { canGearPos: 3 };  expect(probe().gear).toBe('D');
    source.vehicle = { canGearPos: 42 }; expect(probe().gear).toBeNull();
  });

  it('limit yalnız gösterilebilir hükümde; ROAD_ONLY kesin değil', () => {
    source.limit = { effectiveLimitKmh: 82.4, state: 'AVAILABLE' };
    expect(probe().limit).toEqual({ kmh: 82, definitive: true });
    source.limit = { effectiveLimitKmh: 50, state: 'ROAD_ONLY' };
    expect(probe().limit?.definitive).toBe(false);
    source.limit = { effectiveLimitKmh: 90, state: 'UNKNOWN' };
    expect(probe().limit).toBeNull();
    source.limit = { effectiveLimitKmh: 0, state: 'AVAILABLE' };
    expect(probe().limit).toBeNull();
  });
});

describe('tema kaynakları — sabit rozet regresyon kilidi', () => {
  const read = (f: string) => readFileSync(join(__dirname, '../components/themes', f), 'utf8');
  const files = ['ProLayout.tsx', 'TeslaLayout.tsx', 'ExpeditionLayout.tsx', 'HorizonLayout.tsx'];

  it.each(files)('%s sabit "Normal"/"4WD"/"AUTO"/"90" JSX metni basmaz', (f) => {
    const src = read(f);
    expect(src).not.toMatch(/>\s*Normal\s*</);
    expect(src).not.toMatch(/>\s*4WD[^<]*</);
    expect(src).not.toMatch(/>\s*AUTO\s*</);
    expect(src).not.toMatch(/>\s*90\s*</);
    expect(src).not.toMatch(/>KM\/S</);
  });

  it('Tesla/Expedition/Horizon araç durumu ortak projeksiyondan okur', () => {
    for (const f of ['TeslaLayout.tsx', 'ExpeditionLayout.tsx', 'HorizonLayout.tsx']) {
      expect(read(f)).toContain('useVehicleStatusBadge()');
    }
    expect(read('ProLayout.tsx')).toContain('useSpeedLimitSign()');
    expect(read('TeslaLayout.tsx')).toContain('useSpeedLimitSign()');
  });
});
