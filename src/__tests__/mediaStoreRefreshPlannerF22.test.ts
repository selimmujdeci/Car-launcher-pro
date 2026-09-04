import { describe, expect, it } from 'vitest';
import { planMediaStoreRefresh, type PersistedRefreshState, type VolumeRefreshFact } from '../platform/media/mediaStoreRefreshPlanner';
const v = (generation: number, name = 'external_primary'): VolumeRefreshFact => ({ volumeName: name, version: 'v1', generation, available: true });
const state = (volumes: readonly VolumeRefreshFact[]): PersistedRefreshState => ({ schema: 1, permissionGranted: true, volumes });
describe('F2.2 MediaStoreRefreshPlanner', () => {
  it('does not query/revise when version and generation are unchanged', () => expect(planMediaStoreRefresh(state([v(4)]), [v(4)], true).decision).toBe('UNCHANGED'));
  it('allows generation delta but labels delete reconciliation requirement', () => expect(planMediaStoreRefresh(state([v(4)]), [v(5)], true)).toMatchObject({ decision: 'DELTA', deltaVolumes: ['external_primary'] }));
  it('fails closed to full reconciliation on version, permission, corrupt state and volume changes', () => { expect(planMediaStoreRefresh(null, [v(1)], true).decision).toBe('FULL_RECONCILE'); expect(planMediaStoreRefresh(state([v(1)]), [v(1)], false).decision).toBe('FULL_RECONCILE'); expect(planMediaStoreRefresh(state([v(1)]), [v(1), v(1, 'sdcard')], true).decision).toBe('FULL_RECONCILE'); });
});
