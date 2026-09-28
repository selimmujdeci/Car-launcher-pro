/**
 * ecuIdentityService → multiEcuScan statik import'u kaldırıldı (import döngüsü);
 * keşif dinamik import ile çağrılır. Kilit: envanter listesi hâlâ discoverEcus'tan
 * gelir ve keşif hatası envanteri düşürmez.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parseEcuProbe } from '../platform/obd/ecuDiscovery';

const discoverEcus = vi.fn();
vi.mock('../platform/obd/multiEcuScan', () => ({ discoverEcus: () => discoverEcus() }));

import { buildEcuInventory, _resetEcuIdentityForTest } from '../platform/obd/ecuIdentityService';

describe('ECU envanteri — keşif yolu', () => {
  beforeEach(() => {
    _resetEcuIdentityForTest();
    discoverEcus.mockReset();
  });

  it('envanter listesi discoverEcus sonucundan kurulur', async () => {
    discoverEcus.mockResolvedValue({ ecus: parseEcuProbe('7E8064100BE3FA813\n7E9064100BE3FA813') });
    const inv = await buildEcuInventory();
    expect(discoverEcus).toHaveBeenCalledTimes(1);
    expect(inv.ecus.map((e) => e.rxHeader)).toEqual(['7E8', '7E9']);
    expect(inv.ecus[0]!.role).toBe('engine');
    expect(inv.ecus[1]!.role).toBe('unknown');
  });

  it('keşif hatası envanteri düşürmez (boş liste, fail-soft)', async () => {
    discoverEcus.mockRejectedValue(new Error('hat meşgul'));
    const inv = await buildEcuInventory();
    expect(inv.ecus).toEqual([]);
  });
});
