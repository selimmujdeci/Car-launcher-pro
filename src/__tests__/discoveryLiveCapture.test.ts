/**
 * discoveryLiveCapture.test.ts — Canlı discovery servislerinin DiscoveryCaptureService'e
 * bağlanması (PR-DISC-2).
 *
 * Kilitler:
 *  - extendedPidService: keşif bitmask'inde registry'de OLMAYAN PID → capture; registry'deki
 *    PID → capture YOK; aralık-bayrağı (00/20/…) → capture YOK; hot-poll/native liste değişmez.
 *  - didDiscoveryService: POZİTİF DID → capture; NO DATA/7F → capture YOK.
 *  - manufacturerPidService: profil DID'i "katalog" → setKnownDids ile bilinir → capture YOK.
 *  - Duplicate filtre, tanı event'i, queue, export.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const M = vi.hoisted(() => ({
  isNative: true,
  pushedLists: [] as string[][],
  readObdDidMock: vi.fn(),
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: vi.fn(() => M.isNative) },
}));
vi.mock('../platform/nativePlugin', () => ({
  CarLauncher: {
    setObdExtendedPids: vi.fn(async (opts: { pids: string[] }) => { M.pushedLists.push(opts.pids); }),
    setObdDiagnosticBurst: vi.fn(async () => {}),
    addListener: vi.fn(async () => ({ remove: vi.fn() })),
    readObdDid: (...args: unknown[]) => M.readObdDidMock(...args),
  },
}));
vi.mock('../platform/crashLogger', () => ({ logError: vi.fn() }));
vi.mock('../platform/safety/vinContext', () => ({ getHandshakeVin: () => null }));

import { discoveryCaptureService } from '../platform/obd/discovery';
import { watchPid, _internals as extInternals } from '../platform/obd/extendedPidService';
import { startDiscovery } from '../platform/obd/didDiscoveryService';
import {
  loadProfile, unloadProfile, watchDid, _internals as mfrInternals,
} from '../platform/obd/manufacturerPidService';
import { clear as clearDiag, getEvents } from '../platform/obdDiagnosticRecorder';
import type { VehicleDidProfile } from '../platform/obd/vehicleDidProfile';

const capturedPids = () => discoveryCaptureService.getCaptured().map((r) => r.pidOrDid);

beforeEach(() => {
  discoveryCaptureService.reset();
  extInternals.reset();
  mfrInternals.reset();
  clearDiag();
  M.isNative = true;
  M.pushedLists.length = 0;
  M.readObdDidMock.mockReset();
  try { localStorage.clear(); } catch { /* jsdom */ }
});

/* ── extendedPidService → PID keşif capture ───────────────────────────────── */

describe('extendedPidService — yeni PID capture', () => {
  it('bitmask\'te registry\'de OLMAYAN PID yakalanır; registry\'deki + aralık bayrağı yakalanmaz', () => {
    watchPid('5C', () => {});                                   // keşfi başlat (queue=['00'])
    extInternals.onExtendedData({ pid: '00', data: 'BE1FB813' }); // klasik SAE bitmask
    const caps = capturedPids();
    // '01' ve '03' registry'de yok (enum PID) → yakalanır
    expect(caps).toContain('01');
    expect(caps).toContain('03');
    // '04' (motor yükü) ve '0C' (RPM) registry'de var → yakalanmaz
    expect(caps).not.toContain('04');
    expect(caps).not.toContain('0C');
    // '20' aralık bayrağı (gerçek sinyal değil) → yakalanmaz
    expect(caps).not.toContain('20');
  });

  it('capture, native poll (hot-poll) listesine PID EKLEMEZ', () => {
    watchPid('5C', () => {});
    extInternals.onExtendedData({ pid: '00', data: 'BE1FB813' });
    // Yakalanan keşif PID'leri ('01'/'03') hiçbir native poll listesine sızmamalı.
    for (const list of M.pushedLists) {
      expect(list).not.toContain('01');
      expect(list).not.toContain('03');
    }
  });

  it('aynı keşif iki kez gelince tek capture (duplicate filtre)', () => {
    watchPid('5C', () => {});
    extInternals.onExtendedData({ pid: '00', data: 'BE1FB813' });
    const firstCount = discoveryCaptureService.getCaptured().length;
    // Aynı bitmask tekrar (yeni keşif turu) → yeni kayıt olmamalı.
    extInternals.onExtendedData({ pid: '00', data: 'BE1FB813' });
    expect(discoveryCaptureService.getCaptured().length).toBe(firstCount);
  });

  it('yeni PID keşfi tanı timeline\'ına \'ecuQuery\' event\'i düşürür', () => {
    watchPid('5C', () => {});
    extInternals.onExtendedData({ pid: '00', data: 'BE1FB813' });
    const evt = getEvents().find((e) => e.stage === 'ecuQuery' && e.technicalMessage.includes('PID'));
    expect(evt).toBeDefined();
    expect(evt?.status).toBe('info');
  });
});

/* ── didDiscoveryService → DID keşif capture ──────────────────────────────── */

describe('didDiscoveryService — DID capture', () => {
  it('POZİTİF DID yakalanır; NO DATA / 7F yakalanmaz', async () => {
    // 2000 pozitif (supported+data), 2001 desteklenmiyor (NO DATA)
    M.readObdDidMock.mockImplementation(async ({ did }: { did: string }) =>
      did === '2000' ? { supported: true, data: 'AABBCC' } : { supported: false, data: '' });

    const outcome = await startDiscovery({ tx: '7E0', rx: '7E8', from: '2000', to: '2001' });
    expect(outcome.summary.positive).toBe(1);

    const caps = discoveryCaptureService.getCaptured();
    expect(caps.map((r) => r.pidOrDid)).toEqual(['2000']); // yalnız pozitif
    const rec = caps[0]!;
    expect(rec.discoverySource).toBe('DID');
    expect(rec.ecuAddress).toBe('7E8');
    expect(rec.mode).toBe('22');
    expect(rec.request).toBe('222000');
    expect(rec.rawResponse).toBe('AABBCC');
    expect(rec.supported).toBe(true);
  });

  it('discovery başarısız (plugin yok) → capture oluşmaz', async () => {
    M.isNative = false; // readObdDid yolu kapalı → plugin_unavailable
    const outcome = await startDiscovery({ tx: '7E0', rx: '7E8', from: '2000', to: '2000' });
    expect(outcome.summary.stopReason).toBe('plugin_unavailable');
    expect(discoveryCaptureService.getCaptured()).toHaveLength(0);
  });
});

/* ── manufacturerPidService → katalog (profil) DID'i bilinir ──────────────── */

describe('manufacturerPidService — katalog DID capture edilmez', () => {
  const PROFILE: VehicleDidProfile = {
    brand: 'Test', source: 'ISO 14229-1 (test fixture)',
    ecus: [{ id: 'engine', name: 'Motor ECU', tx: '7E0', rx: '7E8' }],
    dids: [
      { did: 'F190', ecu: 'engine', name: 'VIN', unit: '', bytes: 17, min: 0, max: 0, category: 'kimlik', decode: { fn: 'ascii' } },
    ],
  };
  const hexOf = (t: string) => [...t].map((c) => c.charCodeAt(0).toString(16).padStart(2, '0')).join('');

  it('profildeki DID (F190) okununca capture OLUŞMAZ (katalog = bilinir)', async () => {
    loadProfile(PROFILE);                     // setKnownDids(['F190'])
    M.readObdDidMock.mockResolvedValue({ supported: true, data: hexOf('VF1AAAAA000000001') });
    const unsub = watchDid('F190', () => {});
    await mfrInternals.tick();
    unsub();
    expect(discoveryCaptureService.getCaptured()).toHaveLength(0);
  });

  it('profil DID\'i didDiscovery\'de de "bilinir" → yakalanmaz (setKnownDids köprüsü)', async () => {
    loadProfile(PROFILE);                     // F190 katalogda
    M.readObdDidMock.mockResolvedValue({ supported: true, data: 'AABB' });
    await startDiscovery({ tx: '7E0', rx: '7E8', from: 'F190', to: 'F190' });
    // F190 profil (katalog) DID'i → keşif değil.
    expect(discoveryCaptureService.getCaptured().map((r) => r.pidOrDid)).not.toContain('F190');
  });

  it('unloadProfile sonrası aynı DID artık katalog dışı → yakalanır', async () => {
    loadProfile(PROFILE);
    unloadProfile();                          // katalog boşaldı → F190 bilinmiyor
    M.readObdDidMock.mockResolvedValue({ supported: true, data: 'AABB' });
    await startDiscovery({ tx: '7E0', rx: '7E8', from: 'F190', to: 'F190' });
    expect(discoveryCaptureService.getCaptured().map((r) => r.pidOrDid)).toContain('F190');
  });
});

/* ── Queue + Export uçtan uca ─────────────────────────────────────────────── */

describe('PR-DISC-2 — queue + export uçtan uca', () => {
  it('yakalananlar queue\'ya düşer ve JSON export doğru serileşir', async () => {
    M.readObdDidMock.mockResolvedValue({ supported: true, data: 'AA' });
    await startDiscovery({ tx: '7E0', rx: '7E8', from: '3000', to: '3001' });

    expect(discoveryCaptureService.getCaptured().length).toBe(2); // 3000, 3001
    const parsed = JSON.parse(discoveryCaptureService.exportJson());
    expect(parsed.count).toBe(2);
    expect(parsed.records.map((r: { pidOrDid: string }) => r.pidOrDid).sort()).toEqual(['3000', '3001']);
  });
});
