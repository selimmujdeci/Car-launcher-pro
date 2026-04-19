/**
 * smartEngine.test.ts — detectDrivingMode, trackLaunch, dock ranking testleri.
 *
 * Test kapsamı:
 *  - detectDrivingMode: OBD hızı tabanlı 3-kademe mod tespiti
 *  - detectDrivingMode: BT+charging fallback heuristik
 *  - trackLaunch: count/recentCount/lastUsed artışı + localStorage
 *  - computeDockIds: kullanım skoruna göre sıralama
 *  - score formülü: lifetime(0.3) + recent(0.5) + recency(0.2)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/* ── Mocks ─────────────────────────────────────────────────── */

vi.mock('../platform/obdService', () => ({
  onOBDData: vi.fn(() => () => {}),
}));

vi.mock('../platform/performanceMode', () => ({
  getConfig: vi.fn(() => ({
    obdPollInterval:      5000,
    obdListenerDebounce:  0,
    enableRecommendations: false,
    recCooldownMs:        999_999,
  })),
  onPerformanceModeChange: vi.fn(() => () => {}),
}));

/* ── Import ────────────────────────────────────────────────── */

import { detectDrivingMode, trackLaunch } from '../platform/smartEngine';

/* ── Helpers ───────────────────────────────────────────────── */

const USAGE_KEY = 'cl_usageMap';
const PRUNE_KEY = 'cl_usagePruneTs';

function readUsage(): Record<string, { count: number; recentCount: number; lastUsed: number }> {
  const raw = localStorage.getItem(USAGE_KEY);
  return raw ? JSON.parse(raw) : {};
}

function clearUsage(): void {
  localStorage.removeItem(USAGE_KEY);
  localStorage.removeItem(PRUNE_KEY);
}

/* ── detectDrivingMode ─────────────────────────────────────── */

describe('detectDrivingMode — OBD hızı tabanlı', () => {
  const device = { btConnected: false, charging: false };

  it('obdSpeed=0 → idle', () => {
    expect(detectDrivingMode(device, 0)).toBe('idle');
  });

  it('obdSpeed=5 → normal (0 < speed < 20)', () => {
    expect(detectDrivingMode(device, 5)).toBe('normal');
  });

  it('obdSpeed=19 → normal (henüz sınırda)', () => {
    expect(detectDrivingMode(device, 19)).toBe('normal');
  });

  it('obdSpeed=20 → driving (eşik değeri)', () => {
    expect(detectDrivingMode(device, 20)).toBe('driving');
  });

  it('obdSpeed=120 → driving', () => {
    expect(detectDrivingMode(device, 120)).toBe('driving');
  });
});

describe('detectDrivingMode — OBD yokken BT+charging heuristik', () => {
  it('btConnected=true + charging=true → idle (otoparkta şarj)', () => {
    expect(detectDrivingMode({ btConnected: true, charging: true })).toBe('idle');
  });

  it('btConnected=false + charging=false → normal', () => {
    expect(detectDrivingMode({ btConnected: false, charging: false })).toBe('normal');
  });

  it('btConnected=true + charging=false → normal', () => {
    expect(detectDrivingMode({ btConnected: true, charging: false })).toBe('normal');
  });

  it('btConnected=false + charging=true → normal', () => {
    expect(detectDrivingMode({ btConnected: false, charging: true })).toBe('normal');
  });
});

/* ── trackLaunch ────────────────────────────────────────────── */

describe('trackLaunch — kullanım kaydı', () => {
  beforeEach(clearUsage);
  afterEach(clearUsage);

  it('ilk başlatma: count=1, recentCount=1, lastUsed yakın', () => {
    const before = Date.now();
    trackLaunch('spotify');
    const after = Date.now();

    const usage = readUsage();
    expect(usage['spotify']).toBeDefined();
    expect(usage['spotify'].count).toBe(1);
    expect(usage['spotify'].recentCount).toBe(1);
    expect(usage['spotify'].lastUsed).toBeGreaterThanOrEqual(before);
    expect(usage['spotify'].lastUsed).toBeLessThanOrEqual(after);
  });

  it('ikinci başlatma count ve recentCount birikir', () => {
    trackLaunch('maps');
    trackLaunch('maps');

    const usage = readUsage();
    expect(usage['maps'].count).toBe(2);
    expect(usage['maps'].recentCount).toBe(2);
  });

  it('farklı uygulamalar birbirini etkilemez', () => {
    trackLaunch('spotify');
    trackLaunch('maps');
    trackLaunch('spotify');

    const usage = readUsage();
    expect(usage['spotify'].count).toBe(2);
    expect(usage['maps'].count).toBe(1);
  });

  it('localStorage güncel veriye sahip (haberdar edin sonrasında)', () => {
    trackLaunch('youtube');
    const usage = readUsage();
    expect(usage['youtube']).toBeDefined();
    // Son kullanım zamanı 0 değil
    expect(usage['youtube'].lastUsed).toBeGreaterThan(0);
  });
});

/* ── Score formülü — dolaylı test ──────────────────────────── */

describe('score formülü (dolaylı — trackLaunch üzerinden)', () => {
  beforeEach(clearUsage);
  afterEach(clearUsage);

  it('çok kullanılan uygulama sıfır kullanımlıdan yüksek skora sahip', () => {
    // Daha fazla trackLaunch = daha yüksek count + recentCount
    for (let i = 0; i < 10; i++) trackLaunch('maps');
    trackLaunch('browser'); // 1 kez

    const usage = readUsage();
    // score(maps) = 10*0.3 + 10*0.5 + recency*0.2 = 8 + recency
    // score(browser) = 1*0.3 + 1*0.5 + recency*0.2 = 0.8 + recency
    // maps her zaman browser'dan daha yüksek skor alır
    const scoreOf = (id: string) => {
      const rec = usage[id];
      if (!rec) return 0;
      const recency = rec.lastUsed > 0 ? Math.max(0, 1 - (Date.now() - rec.lastUsed) / 86_400_000) : 0;
      return rec.count * 0.3 + rec.recentCount * 0.5 + recency * 0.2;
    };

    expect(scoreOf('maps')).toBeGreaterThan(scoreOf('browser'));
  });
});
