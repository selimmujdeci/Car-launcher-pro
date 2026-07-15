/**
 * signalHub.test — PR-OBD-KWP-1: tek otoriter sinyal okuma yüzeyi kilitleri.
 *
 * Sözleşme: sahte değer yok · "0" ≠ "no_data" · unsupported/no_data/stale/valid ayrışır ·
 * her zarf provenance (source/updatedAt/confidence) taşır.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: vi.fn().mockReturnValue(true) },
}));
vi.mock('../platform/nativePlugin', () => ({
  CarLauncher: { readObdDid: vi.fn(), setObdExtendedPids: vi.fn().mockResolvedValue(undefined), addListener: vi.fn().mockResolvedValue({ remove: vi.fn() }) },
}));
vi.mock('../platform/crashLogger', () => ({ logError: vi.fn() }));
vi.mock('../platform/obdDiagnosticRecorder', () => ({ recordDiag: vi.fn() }));
vi.mock('../platform/safety/vinContext', () => ({ getHandshakeVin: vi.fn().mockReturnValue(null) }));

// obdService ağır bağımlılık zinciri çeker — hub'ın tek ihtiyacı snapshot getter'ı.
const mockSnapshot = vi.fn();
vi.mock('../platform/obdService', () => ({
  getOBDDataSnapshot: () => mockSnapshot() as unknown,
}));

import { readSignal, coreSignalIds } from '../platform/obd/signalHub';
import { INITIAL } from '../platform/obdTypes';
import type { OBDData } from '../platform/obdTypes';
import { _internals as extInternals, seedSupportedPids } from '../platform/obd/extendedPidService';
import { _internals as m22Internals } from '../platform/obd/manufacturerPidService';

function snap(over: Partial<OBDData> = {}): OBDData {
  return { ...INITIAL, ...over };
}

describe('signalHub — core sinyaller', () => {
  beforeEach(() => {
    mockSnapshot.mockReset();
    extInternals.reset();
    m22Internals.reset();
  });

  it('"0" ≠ "no_data": duran araçta hız 0 GEÇERLİ bir değerdir', () => {
    const now = Date.now();
    mockSnapshot.mockReturnValue(snap({ source: 'real', speed: 0, lastSeenMs: now - 500 }));
    const s = readSignal('speed', now);
    expect(s.state).toBe('valid');
    expect(s.value).toBe(0);
    expect(s.confidence).toBe(1);
  });

  it('hiç veri gelmemişse (lastSeenMs=0) → no_data + value:null (0 SIZMAZ)', () => {
    mockSnapshot.mockReturnValue(snap({ source: 'none' }));
    const s = readSignal('speed');
    expect(s.state).toBe('no_data');
    expect(s.value).toBeNull();
    expect(s.confidence).toBe(0);
  });

  it('rpm=-1 (OBD konvansiyonu) → unsupported (arıza değil, araç sınırı)', () => {
    const now = Date.now();
    mockSnapshot.mockReturnValue(snap({ source: 'real', rpm: -1, lastSeenMs: now - 500 }));
    const s = readSignal('rpm', now);
    expect(s.state).toBe('unsupported');
    expect(s.value).toBeNull();
  });

  it('bayat veri → stale + kanıttan türeyen düşük confidence', () => {
    const now = Date.now();
    mockSnapshot.mockReturnValue(snap({ source: 'real', speed: 90, lastSeenMs: now - 10_000 }));
    const s = readSignal('speed', now);
    expect(s.state).toBe('stale');
    expect(s.value).toBe(90);
    expect(s.confidence).toBeLessThan(0.5);
  });

  it('mock kaynak → source:mock + confidence 0.1 (sahte veri karar kanıtı değildir)', () => {
    const now = Date.now();
    mockSnapshot.mockReturnValue(snap({ source: 'mock', speed: 60, lastSeenMs: now - 100 }));
    const s = readSignal('speed', now);
    expect(s.source).toBe('mock');
    expect(s.confidence).toBeLessThanOrEqual(0.1);
  });

  it('bilinmeyen kimlik fırlatmaz → no_data zarfı (yazım hatası sahte alarm üretmez)', () => {
    mockSnapshot.mockReturnValue(snap());
    expect(readSignal('typo').state).toBe('no_data');
    expect(readSignal('typo').value).toBeNull();
  });

  it('coreSignalIds bilinen kimlikleri döner', () => {
    expect(coreSignalIds()).toContain('speed');
    expect(coreSignalIds()).toContain('coolant');
  });
});

describe('signalHub — extended (pid:) sinyaller', () => {
  beforeEach(() => {
    mockSnapshot.mockReturnValue(snap());
    extInternals.reset();
  });

  it('taze extended değer → valid + provenance', () => {
    extInternals.onExtendedData({ pid: '5C', data: '8C' }); // 0x8C-40 = 100°C
    const s = readSignal('pid:5C');
    expect(s.state).toBe('valid');
    expect(s.value).toBe(100);
    expect(s.unit).toBe('°C');
    expect(s.updatedAt).toBeGreaterThan(0);
  });

  it('native NO_DATA demote kanıtı → no_data (değer önbelleği olsa bile)', () => {
    extInternals.onExtendedData({ pid: '5C', data: '8C' });
    extInternals.onExtendedPidStatus({ pid: '5C', status: 'no_data' });
    const s = readSignal('pid:5C');
    expect(s.state).toBe('no_data');
    expect(s.value).toBeNull();
  });

  it('bitmap desteklemiyor → unsupported', () => {
    seedSupportedPids([0x0c, 0x0d]); // handshake kanıtı: 5C destekli DEĞİL
    const s = readSignal('pid:5C');
    expect(s.state).toBe('unsupported');
    expect(s.value).toBeNull();
  });
});
