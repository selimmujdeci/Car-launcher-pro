/**
 * obdCoreV2.patch10.tcp.test.ts — Patch 10 (WiFi ELM327 TCP transport)
 *
 * Kilitler:
 *  (a) transport==='tcp' iken otomatik ble↔classic fallback ÇAĞRILMAZ — tek deneme
 *      başarısız olursa doğrudan hata durumuna düşer (yanlış IP'de 15s BT taraması yok).
 *  (b) isValidTcpAddress: "ip:port" regex doğrulaması (obdStorage.ts).
 *  (c) saveObdTransport/loadObdTransport 'tcp' değerini round-trip persist eder.
 *  (d) Geçersiz adres (ip:port değil) native'e HİÇ gönderilmeden dürüst error state'e düşer.
 *  (e) tcp bağlantısı başarılı olduğunda ATDPN protokol öğrenme persist'i (Patch 3
 *      sözleşmesi) BİREBİR aynı çalışır — transport'a kör.
 *  (f) reconnect disiplini (yalnız reason==='link_lost') tcp bağlamında da korunur —
 *      'connect_failed'/'user_disconnect' paralel reconnect TETİKLEMEZ.
 *
 * NOT: bu dosya obdStorage'ı MOCK'LAMIYOR — gerçek localStorage kullanılır (obdService.test.ts
 * Patch 3 bloğuyla aynı sözleşme). Her test öncesi/sonrası ilgili anahtarlar temizlenir.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/* ── MOCK_ENABLED: import.meta.env module-level sabit → import'lardan ÖNCE set et ── */
vi.hoisted(() => {
  process.env['VITE_ENABLE_OBD_MOCK'] = 'true';
});

/* ── Capacitor platform tespiti ─────────────────────────────── */

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: vi.fn(() => true) },
}));

/* ── Native plugin mock ─────────────────────────────────────── */

vi.mock('../platform/nativePlugin', () => ({
  CarLauncher: {
    scanOBD:                vi.fn().mockResolvedValue({ devices: [] }),
    connectOBD:             vi.fn().mockImplementation(() => new Promise(() => {})),
    disconnectOBD:          vi.fn().mockResolvedValue(undefined),
    addListener:            vi.fn().mockResolvedValue({ remove: vi.fn() }),
    startBackgroundService: vi.fn().mockResolvedValue(undefined),
    stopBackgroundService:  vi.fn().mockResolvedValue(undefined),
  },
}));

/* ── performanceMode mock ───────────────────────────────────── */

vi.mock('../platform/performanceMode', () => ({
  getConfig: vi.fn(() => ({
    obdPollInterval:       50,
    obdListenerDebounce:   0,
    enableRecommendations: false,
    recCooldownMs:         999_999,
  })),
  onPerformanceModeChange: vi.fn(() => () => {}),
}));

/* ── canSnapshotService mock ────────────────────────────────── */

vi.mock('../platform/canSnapshotService', () => ({
  hydrateCanSnapshotSync:  vi.fn(() => ({})),
  hydrateCanSnapshotAsync: vi.fn(() => Promise.resolve({})),
  scheduleCanSnapshot:     vi.fn(),
  flushCanSnapshotNow:     vi.fn(),
  stopCanSnapshot:         vi.fn(),
}));

/* ── obdBinaryParser mock ───────────────────────────────────── */

vi.mock('../platform/obdBinaryParser', () => ({
  parseBinaryOBDFrame:    vi.fn(() => null),
  hasBinaryFrame:         vi.fn(() => false),
  clearAccumulatedBuffer: vi.fn(),
}));

/* ── rafSmoother mock ───────────────────────────────────────── */

vi.mock('../platform/rafSmoother', () => ({
  useRafSmoothed: vi.fn((val: number) => val),
}));

/* ── AdaptiveRuntimeManager mock ────────────────────────────── */

vi.mock('../core/runtime/AdaptiveRuntimeManager', () => ({
  runtimeManager: {
    getMode:       vi.fn(() => 'BALANCED'),
    getConfig:     vi.fn(() => ({
      obdPollingMs:     50,
      gpsUpdateMs:      200,
      uiFpsTarget:      60,
      enableBlur:       false,
      enableAnimations: false,
      loggingLevel:     'silent',
    })),
    subscribe:     vi.fn(() => () => {}),
    reportFailure: vi.fn(),
  },
  AdaptiveRuntimeManager: { getInstance: vi.fn() },
}));

/* ── crashLogger mock ───────────────────────────────────────── */

vi.mock('../platform/crashLogger', () => ({
  logError: vi.fn(),
}));

/* ── Imports (mock'lardan sonra) ─────────────────────────────── */

import { Capacitor } from '@capacitor/core';
import { CarLauncher } from '../platform/nativePlugin';
import { startOBD, stopOBD, onOBDData } from '../platform/obdService';
import { isValidTcpAddress, saveObdTransport, loadObdTransport, clearObdTransport } from '../platform/obdStorage';

/* ═══════════════════════════════════════════════════════════════
   (b) isValidTcpAddress — "ip:port" regex doğrulaması
═══════════════════════════════════════════════════════════════ */

describe('Patch 10 — isValidTcpAddress', () => {
  it('geçerli IPv4:port kabul edilir', () => {
    expect(isValidTcpAddress('192.168.0.10:35000')).toBe(true);
  });

  it('geçerli hostname:port kabul edilir', () => {
    expect(isValidTcpAddress('elm327.local:35000')).toBe(true);
  });

  it('port olmadan reddedilir', () => {
    expect(isValidTcpAddress('192.168.0.10')).toBe(false);
  });

  it('port aralık dışıysa (0 veya >65535) reddedilir', () => {
    expect(isValidTcpAddress('192.168.0.10:0')).toBe(false);
    expect(isValidTcpAddress('192.168.0.10:70000')).toBe(false);
  });

  it('port sayısal değilse reddedilir', () => {
    expect(isValidTcpAddress('192.168.0.10:abc')).toBe(false);
  });

  it('boş/anlamsız string reddedilir', () => {
    expect(isValidTcpAddress('')).toBe(false);
    expect(isValidTcpAddress('sadece-bir-mac-adresi-degil')).toBe(false);
  });

  it('baştaki/sondaki boşluk trim edilerek doğrulanır', () => {
    expect(isValidTcpAddress('  192.168.0.10:35000  ')).toBe(true);
  });
});

/* ═══════════════════════════════════════════════════════════════
   (c) saveObdTransport / loadObdTransport — 'tcp' round-trip
═══════════════════════════════════════════════════════════════ */

describe('Patch 10 — transport persist/restore (tcp)', () => {
  afterEach(() => { clearObdTransport(); });

  it("saveObdTransport('tcp') sonrası loadObdTransport() 'tcp' döner", () => {
    saveObdTransport('tcp');
    expect(loadObdTransport()).toBe('tcp');
  });

  it('clearObdTransport sonrası null döner', () => {
    saveObdTransport('tcp');
    clearObdTransport();
    expect(loadObdTransport()).toBeNull();
  });
});

/* ═══════════════════════════════════════════════════════════════
   (a)+(d) startOBD ile tcp bağlantı davranışı — fallback yok + adres doğrulama
═══════════════════════════════════════════════════════════════ */

describe('obdService — Patch 10: tcp transport (fallback yok, adres doğrulama)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
    clearObdTransport();
    localStorage.removeItem('obd:lastAddress');
    localStorage.removeItem('obd:lastProtocol');
  });
  afterEach(() => {
    stopOBD();
    clearObdTransport();
    localStorage.removeItem('obd:lastAddress');
    localStorage.removeItem('obd:lastProtocol');
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it('(d) geçersiz "ip:port" adresi native\'e HİÇ gönderilmeden dürüst error state\'e düşer', async () => {
    const states: string[] = [];
    const unsub = onOBDData((d) => { states.push(d.connectionState); });

    startOBD('bu-bir-ip-port-degil', undefined, 'tcp');
    for (let i = 0; i < 4; i++) await Promise.resolve();

    expect(states[states.length - 1]).toBe('error');
    expect(vi.mocked(CarLauncher.connectOBD)).not.toHaveBeenCalled();

    unsub();
  });

  it('(a) tcp başarısız olunca ble/classic\'e OTOMATİK fallback YAPILMAZ — tek deneme, tek çağrı', async () => {
    vi.mocked(CarLauncher.connectOBD).mockRejectedValue(new Error('WiFi adaptörüne bağlanılamadı'));

    const states: string[] = [];
    const unsub = onOBDData((d) => { states.push(d.connectionState); });

    startOBD('192.168.0.10:35000', undefined, 'tcp');
    // connectOBD reddi + dış catch zincirinin (logError, _removeNativeHandles, _merge) akması için flush.
    for (let i = 0; i < 10; i++) await Promise.resolve();

    // Fallback YOK → tek çağrı, ve o çağrı transport='tcp' idi.
    expect(vi.mocked(CarLauncher.connectOBD).mock.calls.length).toBe(1);
    const call = vi.mocked(CarLauncher.connectOBD).mock.calls[0]?.[0] as { transport?: string };
    expect(call.transport).toBe('tcp');

    // disconnectOBD (fallback öncesi köprü adımı) da ÇAĞRILMADI — fallback denemesi hiç başlamadı.
    expect(vi.mocked(CarLauncher.disconnectOBD)).not.toHaveBeenCalled();

    expect(states[states.length - 1]).toBe('error');

    unsub();
  });

  it('(e) tcp bağlantısı başarılı olunca ATDPN protokolü BİREBİR aynı şekilde persist edilir', async () => {
    vi.mocked(CarLauncher.connectOBD).mockResolvedValue({ protocol: '6' });

    startOBD('192.168.0.10:35000', undefined, 'tcp');
    for (let i = 0; i < 8; i++) await Promise.resolve();

    const call = vi.mocked(CarLauncher.connectOBD).mock.calls[0]?.[0] as { transport?: string };
    expect(call.transport).toBe('tcp');
    expect(localStorage.getItem('obd:lastProtocol')).toBe('6');
  });
});

/* ═══════════════════════════════════════════════════════════════
   (f) obdStatus reason disiplini — tcp bağlamında da korunur
═══════════════════════════════════════════════════════════════ */

describe('obdService — Patch 10: tcp bağlamında reconnect disiplini', () => {
  afterEach(() => {
    stopOBD();
    clearObdTransport();
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("tcp'de 'connect_failed'/'user_disconnect' paralel reconnect TETİKLEMEZ; 'link_lost' tetikler", async () => {
    vi.useFakeTimers();
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);

    let statusCallback: ((e: unknown) => void) | null = null;
    let dataCallback:   ((e: unknown) => void) | null = null;
    vi.mocked(CarLauncher.addListener).mockImplementation(
      async (event: string, cb: (e: unknown) => void) => {
        if (event === 'obdStatus') statusCallback = cb;
        if (event === 'obdData')   dataCallback   = cb;
        return { remove: vi.fn() };
      },
    );
    vi.mocked(CarLauncher.connectOBD).mockResolvedValue(undefined);

    const states: string[] = [];
    const unsub = onOBDData((d) => states.push(d.connectionState));

    startOBD('192.168.0.10:35000', undefined, 'tcp');
    for (let i = 0; i < 6; i++) await Promise.resolve();
    await vi.advanceTimersByTimeAsync(2_001);
    for (let i = 0; i < 4; i++) await Promise.resolve();

    dataCallback?.({ speed: 50, rpm: 1_500 });
    for (let i = 0; i < 4; i++) await Promise.resolve();
    expect(states).toContain('connected');

    const connectCallsBefore = vi.mocked(CarLauncher.connectOBD).mock.calls.length;

    statusCallback?.({ state: 'disconnected', reason: 'user_disconnect' });
    for (let i = 0; i < 6; i++) await Promise.resolve();
    expect(states[states.length - 1]).toBe('connected');

    statusCallback?.({ state: 'error', reason: 'connect_failed' });
    for (let i = 0; i < 6; i++) await Promise.resolve();
    expect(states[states.length - 1]).toBe('connected');

    expect(vi.mocked(CarLauncher.connectOBD).mock.calls.length).toBe(connectCallsBefore);

    // link_lost GERÇEK kopma sayılır — reconnect tetiklenir.
    statusCallback?.({ state: 'disconnected', reason: 'link_lost' });
    for (let i = 0; i < 6; i++) await Promise.resolve();
    expect(states).toContain('reconnecting');

    // Reconnect denemesi de yine transport='tcp' ile yapılır (fallback'e sapmaz).
    await vi.advanceTimersByTimeAsync(500);
    for (let i = 0; i < 6; i++) await Promise.resolve();
    const lastCall = vi.mocked(CarLauncher.connectOBD).mock.calls[
      vi.mocked(CarLauncher.connectOBD).mock.calls.length - 1
    ]?.[0] as { transport?: string };
    expect(lastCall.transport).toBe('tcp');

    unsub();
  });
});
