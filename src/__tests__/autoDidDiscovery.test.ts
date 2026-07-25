/**
 * autoDidDiscovery.test — otomatik marka-DID keşfi: sağlık kapısı, cache, gizlilik, nazik-abort.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

/* ── Mock'lar ─────────────────────────────────────────────── */

let _health = { connectionState: 'connected', source: 'real', dataFresh: true };
const _obdListeners = new Set<() => void>();

vi.mock('../platform/obdService', () => ({
  getOBDDataSnapshot: () => _health,
  onOBDData: (fn: () => void) => { _obdListeners.add(fn); return () => _obdListeners.delete(fn); },
}));

const _readObdDid = vi.fn();
vi.mock('../platform/nativePlugin', () => ({
  CarLauncher: { get readObdDid() { return _readObdDid; } },
}));

const _startDiscovery = vi.fn();
vi.mock('../platform/obd/didDiscoveryService', () => ({
  startDiscovery: (...a: unknown[]) => _startDiscovery(...a),
}));

const _discoverEcus = vi.fn();
vi.mock('../platform/obd/multiEcuScan', () => ({
  discoverEcus: () => _discoverEcus(),
}));

const _store = new Map<string, string>();
vi.mock('../utils/safeStorage', () => ({
  safeGetRaw: (k: string) => _store.get(k) ?? null,
  safeSetRaw: (k: string, v: string) => { _store.set(k, v); },
}));

vi.mock('../platform/crashLogger', () => ({ logError: vi.fn() }));

import {
  maybeStartAutoDidDiscovery, getAutoDiscoveredDids, _resetAutoDidForTest,
} from '../platform/obd/autoDidDiscovery';

/** VIN F190 → hex ('WVW…' değil, basit ASCII hex). */
function vinHex(vin: string): string {
  return [...vin].map((c) => c.charCodeAt(0).toString(16).padStart(2, '0')).join('');
}

beforeEach(() => {
  _resetAutoDidForTest();
  _store.clear();
  _obdListeners.clear();
  _health = { connectionState: 'connected', source: 'real', dataFresh: true };
  _readObdDid.mockReset();
  _startDiscovery.mockReset();
  _discoverEcus.mockReset();
});

describe('autoDidDiscovery — sağlık kapısı + cache + gizlilik', () => {
  it('SAĞLIKSIZ bağlantıda tarama BAŞLAMAZ (core poll boğulmaz)', async () => {
    _health = { connectionState: 'reconnecting', source: 'none', dataFresh: false };
    await maybeStartAutoDidDiscovery();
    expect(_readObdDid).not.toHaveBeenCalled();
    expect(_startDiscovery).not.toHaveBeenCalled();
  });

  it('VIN okunamazsa tarama YAPILMAZ (keyleyemeyiz → bir sonraki pencerede tekrar)', async () => {
    _readObdDid.mockResolvedValue({ supported: false, data: null });
    await maybeStartAutoDidDiscovery();
    expect(_startDiscovery).not.toHaveBeenCalled();
  });

  it('SAĞLIKLI + yeni VIN → 2200-22FF taranır, sonuç expose + persist edilir', async () => {
    _readObdDid.mockResolvedValue({ supported: true, data: vinHex('VF1CDACIA0000001') });
    _discoverEcus.mockResolvedValue({ ecus: [{ txHeader: '7E0', rxHeader: '7E8' }] });
    _startDiscovery.mockResolvedValue({
      results: [{ did: '2201', dataHex: '4A20', bytes: [0x4a, 0x20] }],
      summary: { scanned: 256, positive: 1, negative: 255, stopReason: 'completed' },
    });

    await maybeStartAutoDidDiscovery();

    expect(_startDiscovery).toHaveBeenCalledOnce();
    const opts = _startDiscovery.mock.calls[0][0];
    expect(opts.from).toBe('2200');
    expect(opts.to).toBe('22FF');
    expect(opts.service).toBe('22');
    const found = getAutoDiscoveredDids();
    expect(found).toEqual([{ did: '2201', dataHex: '4A20', ecuRx: '7E8' }]);
    // Persist: bir cache anahtarı yazıldı (ham VIN DEĞİL — hash).
    expect([..._store.keys()].some((k) => k.startsWith('obd:autoDid:'))).toBe(true);
    expect([..._store.keys()].some((k) => k.includes('VF1CDACIA'))).toBe(false); // ham VIN sızmaz
  });

  it('AYNI VIN ikinci kez → cache\'ten döner, YENİDEN TARAMAZ', async () => {
    _readObdDid.mockResolvedValue({ supported: true, data: vinHex('VF1CDACIA0000001') });
    _discoverEcus.mockResolvedValue({ ecus: [{ txHeader: '7E0', rxHeader: '7E8' }] });
    _startDiscovery.mockResolvedValue({
      results: [{ did: '2201', dataHex: '4A20', bytes: [0x4a, 0x20] }],
      summary: { scanned: 256, positive: 1, negative: 255, stopReason: 'completed' },
    });
    await maybeStartAutoDidDiscovery();           // 1. tarama
    expect(_startDiscovery).toHaveBeenCalledOnce();

    _resetAutoDidForTest();                        // yeni oturum (cache KALIR — _store temizlenmedi)
    await maybeStartAutoDidDiscovery();            // 2. — cache hit
    expect(_startDiscovery).toHaveBeenCalledOnce(); // hâlâ 1 (yeniden taramadı)
    expect(getAutoDiscoveredDids()).toHaveLength(1);
  });
});
