/**
 * canSnapshotService.test.ts — Persistence Chain Polish.
 *
 * Kapsam: snapshot kurtarma (_buildPatch via hydrateCanSnapshotSync) artık
 * source='real' taşıyor → boot'ta UI 'none/idle' boş göstergede takılmaz, son
 * bilinen değerleri gösterir. Bayat veride source EKLENMEZ (Object.keys kontrolü
 * korunur). Per-field stale eşikleri (dinamik 30s / yarı-statik 5dk / statik 12sa).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const STORE = vi.hoisted(() => ({ raw: null as string | null }));
vi.mock('../utils/safeStorage', () => ({
  safeGetRaw: () => STORE.raw,
  safeSetRaw: vi.fn(),
  safeSetRawImmediate: vi.fn(),
}));
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => false } }));
vi.mock('../platform/crashLogger', () => ({ logError: vi.fn() }));

import { hydrateCanSnapshotSync } from '../platform/canSnapshotService';

function makeSnap(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    ts: Date.now(), speed: 60, rpm: 2200, engineTemp: 88,
    fuelLevel: 23, batteryLevel: 80, batteryTemp: 25, range: 140,
    vehicleType: 'standard', ...overrides,
  });
}

describe('canSnapshotService — snapshot kurtarmada source devamlılığı', () => {
  beforeEach(() => { STORE.raw = null; });

  it('taze snapshot → patch source="real" + değerler (UI artık idle\'da kalmaz)', () => {
    STORE.raw = makeSnap();
    const patch = hydrateCanSnapshotSync();
    expect(patch.source).toBe('real');
    expect(patch.fuelLevel).toBe(23);
    expect(patch.speed).toBe(60);
    expect(patch.range).toBe(140);
  });

  it('tamamen bayat snapshot (>12sa) → patch BOŞ, source YOK', () => {
    STORE.raw = makeSnap({ ts: Date.now() - 13 * 60 * 60_000 });
    const patch = hydrateCanSnapshotSync();
    expect(Object.keys(patch)).toHaveLength(0);
    expect(patch.source).toBeUndefined();   // boş patch'e source eklenmez (kontrol korundu)
  });

  it('kısmi bayatlık: dinamik bayat (>30s) + statik taze → source="real", speed YOK', () => {
    STORE.raw = makeSnap({ ts: Date.now() - 60_000 }); // 1 dk
    const patch = hydrateCanSnapshotSync();
    expect(patch.source).toBe('real');       // statik alanlar kurtarıldı → real
    expect(patch.speed).toBeUndefined();     // dinamik alan bayat → kurtarılmadı
    expect(patch.fuelLevel).toBe(23);        // statik alan taze
  });

  it('localStorage boş → {} (source yok, UI INITIAL kalır)', () => {
    STORE.raw = null;
    const patch = hydrateCanSnapshotSync();
    expect(Object.keys(patch)).toHaveLength(0);
  });

  it('bozuk JSON → {} (fail-soft, source sızmaz)', () => {
    STORE.raw = '{bozuk json';
    const patch = hydrateCanSnapshotSync();
    expect(Object.keys(patch)).toHaveLength(0);
  });
});
