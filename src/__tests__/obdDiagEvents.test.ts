/**
 * obdDiagEvents.test.ts — Remote Log v1 / Commit 3: obdService entegrasyonu
 *
 * obdService GERÇEK hata yollarından sürülür (native mock'lar ile);
 * emitObdDiag GERÇEK (suppression aktif), remoteLogService.reportObdDiag
 * yakalanan-parametre mock'u:
 *  - scan fail        → obd_diag phase='scan'
 *  - connect fail     → obd_diag phase='connect' (transport/protocol doğru)
 *  - handshake fail   → obd_diag phase='handshake'
 *  - data gate fail   → obd_diag phase='data_gate'
 *  - stale data       → obd_diag phase='stale_data'
 *  - başarılı bağlantı → SIFIR obd_diag
 *  - payload'da MAC/cihaz adı yok
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const M = vi.hoisted(() => ({
  diags: [] as Array<Record<string, unknown>>,
  listeners: {} as Record<string, (d: unknown) => void>,
}));

/* ── remoteLogService: yakalama mock'u (emitter GERÇEK kalır) ── */
vi.mock('../platform/remoteLogService', () => ({
  reportObdDiag: vi.fn(async (p: Record<string, unknown>) => { M.diags.push(p); }),
}));

/* ── Native platform + plugin ───────────────────────────────── */
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: vi.fn(() => true) },
}));

vi.mock('../platform/nativePlugin', () => ({
  CarLauncher: {
    scanOBD:       vi.fn().mockResolvedValue({ devices: [] }),
    connectOBD:    vi.fn().mockResolvedValue(undefined),
    disconnectOBD: vi.fn().mockResolvedValue(undefined),
    addListener:   vi.fn(async (event: string, cb: (d: unknown) => void) => {
      M.listeners[event] = cb;
      return { remove: vi.fn() };
    }),
    // performHandshake / getObdBondState testte senaryoya göre atanır
  } as Record<string, unknown>,
}));

/* ── obdService bağımlılıkları (obdService.test.ts deseni) ──── */
vi.mock('../platform/performanceMode', () => ({
  getConfig: vi.fn(() => ({ obdPollInterval: 50, obdListenerDebounce: 0 })),
  onPerformanceModeChange: vi.fn(() => () => {}),
}));

vi.mock('../core/runtime/AdaptiveRuntimeManager', () => ({
  runtimeManager: {
    getMode:       vi.fn(() => 'BALANCED'),
    getConfig:     vi.fn(() => ({ obdPollingMs: 50 })),
    subscribe:     vi.fn(() => () => {}),
    reportFailure: vi.fn(),
  },
}));

vi.mock('../platform/crashLogger', () => ({ logError: vi.fn() }));
vi.mock('../platform/rafSmoother', () => ({ useRafSmoothed: vi.fn((v: number) => v) }));

vi.mock('../platform/obdBinaryParser', () => ({
  parseBinaryOBDFrame:    vi.fn(() => null),
  hasBinaryFrame:         vi.fn(() => false),
  clearAccumulatedBuffer: vi.fn(),
}));

vi.mock('../platform/canSnapshotService', () => ({
  hydrateCanSnapshotSync:  vi.fn(() => ({})),
  hydrateCanSnapshotAsync: vi.fn(() => Promise.resolve({})),
  scheduleCanSnapshot:     vi.fn(),
  flushCanSnapshotNow:     vi.fn(),
  stopCanSnapshot:         vi.fn(),
}));

vi.mock('../platform/safety/SafetyBrain', () => ({
  isFeatureEnabled: vi.fn(() => false), // gate-fail sonrası auto-reconnect kapalı
  recordFault:      vi.fn(),
}));

vi.mock('../platform/obdStorage', () => ({
  loadObdAddress:    vi.fn(() => null),
  saveObdAddress:    vi.fn(),
  clearObdAddress:   vi.fn(),
  loadObdTransport:  vi.fn(() => null),
  saveObdTransport:  vi.fn(),
  loadObdTransportVerified: vi.fn(() => false),
  saveObdTransportVerified: vi.fn(),
  clearObdTransport: vi.fn(),
  loadObdProfileId:  vi.fn(() => null),
  saveObdProfileId:  vi.fn(),
  // Patch 3 — protokol öğrenme (ElmInitSequencer ATDPN persist)
  loadObdProtocol:   vi.fn(() => null),
  saveObdProtocol:   vi.fn(),
  clearObdProtocol:  vi.fn(),
}));

vi.mock('../platform/vehicleProfileService', () => ({ persistHandshakeVin: vi.fn() }));
vi.mock('../platform/obdDiagnosticRecorder', () => ({ recordDiag: vi.fn() }));

// Sanitizer passthrough: gelen patch aynen geçer (gate testleri deterministik)
vi.mock('../platform/obdSanitizer', () => ({
  sanitizeNativeOBDPacket: vi.fn((d: Record<string, unknown>) => ({ patch: d, nextRpm: null })),
}));

import { CarLauncher } from '../platform/nativePlugin';
import { startOBD, stopOBD } from '../platform/obdService';
import { _resetObdDiagEmitterForTest } from '../platform/obdDiagEmitter';
import { DATA_GATE_TIMEOUT_MS, STALE_THRESHOLD_MS } from '../platform/obdRetryPolicy';

const DEVICE = { name: 'ELM327 BT', address: '00:11:22:33:44:55' };
const CL = CarLauncher as unknown as Record<string, ReturnType<typeof vi.fn> | undefined>;

function diagsOf(phase: string): Array<Record<string, unknown>> {
  return M.diags.filter((d) => d.phase === phase);
}

beforeEach(() => {
  _resetObdDiagEmitterForTest();
  M.diags = [];
  M.listeners = {};
  delete CL['performHandshake'];
  delete CL['getObdBondState'];
});

afterEach(() => {
  stopOBD();
  vi.clearAllMocks();
  vi.useRealTimers();
});

/* ═══ 1. ADRES YOK — OTOMATİK TARAMA YASAK (PERF 2026-06-11) ══ */

describe('kayıtlı adres yok', () => {
  it('otomatik scanOBD ÇAĞRILMAZ → obd_diag phase=scan, OBD_NO_DEVICE (manuel bağlantı gerekli)', async () => {
    startOBD(); // adres verilmedi + kayıtlı adres yok

    await vi.waitFor(() => expect(diagsOf('scan')).toHaveLength(1));
    const d = diagsOf('scan')[0]!;
    expect(d.errorCode).toBe('OBD_NO_DEVICE');
    expect(d.ctx).toBe('OBD');
    expect(typeof d.elapsedMs).toBe('number');
    // PERF sözleşmesi: açılışta BT INQUIRY tetiklenmez (GPS jitter + A2DP glitch
    // + Bridge tıkanması). İlk bağlantı OBDConnectModal → startOBD(address) ile.
    expect(vi.mocked(CarLauncher.scanOBD)).not.toHaveBeenCalled();
  });
});

/* ═══ 2. CONNECT FAIL ═════════════════════════════════════════ */

describe('connect fail', () => {
  it('her iki transport reddeder → obd_diag phase=connect; transport/protocol doğru', async () => {
    // PERF 2026-06-11 sözleşmesi: otomatik tarama yok → testler adresle bağlanır
    vi.mocked(CarLauncher.connectOBD).mockRejectedValue(new Error('GATT bağlantı reddetti'));
    startOBD(DEVICE.address);

    await vi.waitFor(() => expect(diagsOf('connect')).toHaveLength(1));
    const d = diagsOf('connect')[0]!;
    expect(d.errorCode).toBe('OBD_CONNECT_FAIL');     // 'zaman aşımı' değil → FAIL
    expect(d.transport).toBe('ble+classic');           // doğrulanmamış oturum: BLE önce
    expect(d.protocol).toBe('auto');                   // ilk deneme → ATSP0 otomatik
    expect(d.attempts).toBe(0);
    expect(d.msg).toBe('Her iki transport ile bağlantı başarısız');
  });

  it('payload\'da MAC / cihaz adı / adres YOK', async () => {
    vi.mocked(CarLauncher.connectOBD).mockRejectedValue(new Error('reddetti'));
    startOBD(DEVICE.address);

    await vi.waitFor(() => expect(diagsOf('connect')).toHaveLength(1));
    const flat = JSON.stringify(M.diags);
    expect(flat).not.toContain(DEVICE.address);
    expect(flat).not.toContain(DEVICE.name);
    expect(flat).not.toContain('OBD Adaptörü');
  });

  it('duplicate suppression: peş peşe ikinci hata turu yeni event üretmez', async () => {
    vi.mocked(CarLauncher.connectOBD).mockRejectedValue(new Error('reddetti'));
    startOBD(DEVICE.address);
    await vi.waitFor(() => expect(diagsOf('connect')).toHaveLength(1));

    // Aynı pencere içinde ikinci tam tur (DirectConnect yolu — servis çalışıyor)
    startOBD(DEVICE.address);
    await vi.waitFor(() => expect(vi.mocked(CarLauncher.connectOBD).mock.calls.length).toBeGreaterThanOrEqual(4));
    await new Promise((r) => setTimeout(r, 20)); // emit mikro-task'larını boşalt
    expect(diagsOf('connect')).toHaveLength(1);   // bastırıldı
  });
});

/* ═══ 3. HANDSHAKE FAIL ═══════════════════════════════════════ */

describe('handshake fail', () => {
  it('performHandshake reddeder → obd_diag phase=handshake', async () => {
    vi.mocked(CarLauncher.connectOBD).mockResolvedValue(undefined);
    CL['performHandshake'] = vi.fn().mockRejectedValue(new Error('ELM327 yanıt yok'));
    startOBD(DEVICE.address);

    await vi.waitFor(() => expect(diagsOf('handshake')).toHaveLength(1));
    const d = diagsOf('handshake')[0]!;
    expect(d.errorCode).toBe('OBD_HANDSHAKE_FAIL');
    expect(d.transport).toBe('ble'); // doğrulanmamış oturumda primary BLE bağlandı
    expect(d.protocol).toBe('auto');
  });
});

/* ═══ 4. DATA GATE FAIL ═══════════════════════════════════════ */

describe('data gate fail', () => {
  it('bağlandı ama PID gelmedi → obd_diag phase=data_gate', async () => {
    vi.useFakeTimers();
    vi.mocked(CarLauncher.connectOBD).mockResolvedValue(undefined);
    startOBD(DEVICE.address);

    // connect zinciri (mikro-task) + gate timeout'u ilerlet
    await vi.advanceTimersByTimeAsync(10);
    await vi.advanceTimersByTimeAsync(DATA_GATE_TIMEOUT_MS + 100);

    const gate = diagsOf('data_gate');
    expect(gate).toHaveLength(1);
    expect(gate[0]!.errorCode).toBe('OBD_DATA_GATE_TIMEOUT');
    expect(gate[0]!.elapsedMs).toBe(DATA_GATE_TIMEOUT_MS);
  });
});

/* ═══ 5. BAŞARILI BAĞLANTI — SIFIR DIAG ═══════════════════════ */

describe('başarılı bağlantı', () => {
  it('veri akışı gate\'i geçer → HİÇBİR obd_diag gönderilmez', async () => {
    vi.useFakeTimers();
    vi.mocked(CarLauncher.connectOBD).mockResolvedValue(undefined);
    startOBD(DEVICE.address);

    await vi.advanceTimersByTimeAsync(10); // connect zinciri tamamlansın
    expect(M.listeners['obdData']).toBeTypeOf('function');
    M.listeners['obdData']!({ speed: 42, rpm: 1800 }); // gate geçer → connected

    // Gate süresi + watchdog birkaç tur — hiçbir tanı eventi üretilmemeli
    await vi.advanceTimersByTimeAsync(DATA_GATE_TIMEOUT_MS + 1_000);
    expect(M.diags).toHaveLength(0);
  });
});

/* ═══ 6. STALE DATA ═══════════════════════════════════════════ */

describe('stale data', () => {
  it('akış kesilir → obd_diag phase=stale_data', async () => {
    vi.useFakeTimers();
    vi.mocked(CarLauncher.connectOBD).mockResolvedValue(undefined);
    startOBD(DEVICE.address);

    await vi.advanceTimersByTimeAsync(10);
    M.listeners['obdData']!({ speed: 42, rpm: 1800 }); // connected + watchdog başlar

    // STALE_THRESHOLD_MS (12s) aşılana dek watchdog turları (5s aralık)
    await vi.advanceTimersByTimeAsync(STALE_THRESHOLD_MS + 6_000);

    const stale = diagsOf('stale_data');
    expect(stale).toHaveLength(1);
    expect(stale[0]!.errorCode).toBe('OBD_STALE_DATA');
    expect(stale[0]!.source).toBe('real'); // akış varken kesildi
    expect(stale[0]!.elapsedMs as number).toBeGreaterThan(STALE_THRESHOLD_MS);
  });
});
