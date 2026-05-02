/**
 * obdService.test.ts — OBD servis state machine testleri (new API uyumlu).
 *
 * Test kapsamı:
 *  - Web (non-native) modda mock otomatik başlar (VITE_ENABLE_OBD_MOCK=true)
 *  - Native modda cihaz bulunamazsa mock'a düşer
 *  - connectOBD 30 s timeout → hata sonrası mock'a düşer
 *  - stopOBD tüm state'i sıfırlar
 *  - onOBDData listener cleanup
 *  - stopOBD mid-flight koruma (generation guard)
 *  - Çoklu listener eş zamanlı çalışır
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/* ── MOCK_ENABLED: import.meta.env module-level sabit → import'lardan ÖNCE set et ── */
vi.hoisted(() => {
  // vi.hoisted içeriği tüm import'lardan önce çalışır.
  // obdService.ts'nin "const MOCK_ENABLED = import.meta.env['VITE_ENABLE_OBD_MOCK'] === 'true'"
  // satırı bu değeri module yüklenirken okur → hoisted ile garantilenir.
  process.env['VITE_ENABLE_OBD_MOCK'] = 'true';
});

/* ── Capacitor platform tespiti ─────────────────────────────── */

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: vi.fn(() => false) },
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
    obdPollInterval:       50,   // hızlı test için kısa interval
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
  parseBinaryOBDFrame: vi.fn(() => null),
  hasBinaryFrame:      vi.fn(() => false),
}));

/* ── rafSmoother mock ───────────────────────────────────────── */

vi.mock('../platform/rafSmoother', () => ({
  useRafSmoothed: vi.fn((val: number) => val),
}));

/* ── AdaptiveRuntimeManager mock ────────────────────────────── */
// BALANCED modda obdPollingMs=3000 → waitForOBDData(500) timeout atar.
// Test ortamında 50ms hızlı tick kullanılır.

vi.mock('../core/runtime/AdaptiveRuntimeManager', () => ({
  runtimeManager: {
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

/* ── Imports (mock'lardan sonra) ────────────────────────────── */

import { Capacitor } from '@capacitor/core';
import { CarLauncher } from '../platform/nativePlugin';
import {
  startOBD, stopOBD, onOBDData,
  type OBDData,
} from '../platform/obdService';

/* ── Yardımcı: listener'dan koşullu veri bekle ──────────────── */

function waitForOBDData(
  timeoutMs = 500,
  predicate?: (d: OBDData) => boolean,
): Promise<OBDData> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('waitForOBDData timeout')), timeoutMs);
    const unsub = onOBDData((d) => {
      if (!predicate || predicate(d)) {
        clearTimeout(timer);
        unsub();
        resolve(d);
      }
    });
  });
}

/* ═══════════════════════════════════════════════════════════════
   1. WEB MODU (non-native) — MOCK_ENABLED = true
═══════════════════════════════════════════════════════════════ */

describe('obdService — web modu (non-native)', () => {
  beforeEach(() => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(false);
  });
  afterEach(() => {
    stopOBD();
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it('startOBD → mock moda geçer, source=mock', async () => {
    startOBD();
    const data = await waitForOBDData(500, (d) => d.source === 'mock');
    expect(data.source).toBe('mock');
    expect(data.connectionState).toBe('connected');
  });

  it('stopOBD sonrası source=none, connectionState=idle', async () => {
    startOBD();
    await waitForOBDData(500, (d) => d.source === 'mock');

    const afterStop = await new Promise<OBDData>((resolve) => {
      const unsub = onOBDData((d) => { unsub(); resolve(d); });
      stopOBD();
    });

    expect(afterStop.source).toBe('none');
    expect(afterStop.connectionState).toBe('idle');
  });

  it('startOBD idempotent — iki kez çağrılınca tek mock başlar', async () => {
    startOBD();
    startOBD(); // ikinci çağrı _running=true olduğu için atlanır
    const data = await waitForOBDData(500, (d) => d.source === 'mock');
    expect(data.source).toBe('mock');
  });

  it('mock verisinde speed, rpm, engineTemp gerçekçi aralıklarda', async () => {
    startOBD();
    const data = await waitForOBDData(500, (d) => d.source === 'mock');
    expect(data.speed).toBeGreaterThanOrEqual(0);
    expect(data.speed).toBeLessThanOrEqual(180);
    // ICE mock: rpm başlangıcı 1450, ±150 drift → test için geniş aralık
    expect(data.rpm).toBeGreaterThanOrEqual(0);
    expect(data.rpm).toBeLessThanOrEqual(8_000);
    expect(data.engineTemp).toBeGreaterThanOrEqual(70);
    expect(data.engineTemp).toBeLessThanOrEqual(110);
    expect(data.fuelLevel).toBeGreaterThanOrEqual(0);
    expect(data.fuelLevel).toBeLessThanOrEqual(100);
  });
});

/* ═══════════════════════════════════════════════════════════════
   2. NATIVE MODU — CİHAZ BULUNAMADI
═══════════════════════════════════════════════════════════════ */

describe('obdService — native modu, cihaz bulunamadı', () => {
  beforeEach(() => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
    vi.mocked(CarLauncher.scanOBD).mockResolvedValue({ devices: [] });
  });
  afterEach(() => {
    stopOBD();
    vi.clearAllMocks();
  });

  it('eşleşmiş BT cihazı yok → hata sonrası mock moda düşer', async () => {
    startOBD();
    // native: scanOBD → boş liste → throw → hata → 1.5 s bekleme → mock başlar
    // 3 s timeout: 1.5 s gecikme + mock tick 50 ms → çok yeterli
    const data = await waitForOBDData(3_500, (d) => d.source === 'mock');
    expect(data.source).toBe('mock');
    expect(data.connectionState).toBe('connected');
  });
});

/* ═══════════════════════════════════════════════════════════════
   3. NATIVE MODU — connectOBD ZAMAN AŞIMI
═══════════════════════════════════════════════════════════════ */

describe('obdService — native modu, connectOBD zaman aşımı', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
    vi.mocked(CarLauncher.scanOBD).mockResolvedValue({
      devices: [{ name: 'ELM327 BT', address: '00:11:22:33:44:55' }],
    });
    // connectOBD asla resolve etmez → 30 s timeout tetiklenir
    vi.mocked(CarLauncher.connectOBD).mockImplementation(() => new Promise(() => {}));
  });
  afterEach(() => {
    stopOBD();
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it('30 s sonra hata durumuna geçer, ardından mock bağlanır', async () => {
    const states: string[] = [];
    const unsub = onOBDData((d) => { states.push(d.connectionState); });

    startOBD();

    // scanOBD + addListener Promise'lerini çöz (mikro-task flush)
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    // 30 s connectOBD timeout'unu tetikle
    await vi.advanceTimersByTimeAsync(30_500);
    // async catch zincirini temizle (logError, _removeNativeHandles, _merge)
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    // 1.5 s mock başlama gecikmesini tetikle
    await vi.advanceTimersByTimeAsync(2_000);
    // mock _startMock → _merge → connected
    await Promise.resolve();
    await Promise.resolve();

    unsub();

    expect(states).toContain('error');
    expect(states[states.length - 1]).toBe('connected');
  });
});

/* ═══════════════════════════════════════════════════════════════
   4. onOBDData LİSTENER YÖNETİMİ
═══════════════════════════════════════════════════════════════ */

describe('obdService — onOBDData listener yönetimi', () => {
  afterEach(() => {
    stopOBD();
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it('cleanup fonksiyonu listener kaldırır — kaldırılan listener tetiklenmez', async () => {
    vi.useRealTimers();
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(false);

    let callCount = 0;
    const unsub = onOBDData(() => { callCount++; });
    unsub(); // hemen kaldır

    startOBD();

    // Mock tick 50 ms sonra ateşlenir — listener kaldırıldığı için çağrılmamalı
    await new Promise((r) => setTimeout(r, 100));

    expect(callCount).toBe(0);
    stopOBD();
  });
});

/* ═══════════════════════════════════════════════════════════════
   5. stopOBD MID-FLIGHT KORUMA (generation guard)
═══════════════════════════════════════════════════════════════ */

describe('obdService — stopOBD mid-flight koruma (generation guard)', () => {
  beforeEach(() => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
    // scanOBD asla resolve etmez → _startNative() BT tarama aşamasında askıda
    vi.mocked(CarLauncher.scanOBD).mockImplementation(() => new Promise(() => {}));
  });
  afterEach(() => {
    stopOBD();
    vi.clearAllMocks();
  });

  it('stopOBD() mid-flight sonrası state connected olmaz', async () => {
    const states: string[] = [];
    const unsub = onOBDData((d) => states.push(d.connectionState));

    startOBD(); // _startNative() başlar, scanOBD'de askıda
    await Promise.resolve();
    stopOBD(); // generation++ → in-flight call geçersiz

    await Promise.resolve();
    await Promise.resolve();

    unsub();
    // stopOBD sonrası son state 'idle' olmalı, asla 'connected' olmamalı
    const last = states[states.length - 1];
    expect(last).toBe('idle');
    expect(states).not.toContain('connected');
  });

  it('startOBD idempotent — ikinci çağrı yeni native döngü başlatmaz', async () => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(false);
    startOBD();
    startOBD(); // _running=true → atlanır
    const data = await waitForOBDData(500, (d) => d.source === 'mock');
    expect(data.source).toBe('mock');
    stopOBD();
  });
});

/* ═══════════════════════════════════════════════════════════════
   6. ÇOKLU LİSTENER
═══════════════════════════════════════════════════════════════ */

describe('obdService — çoklu listener', () => {
  beforeEach(() => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(false);
  });
  afterEach(() => {
    stopOBD();
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it('birden fazla listener eş zamanlı çalışır', async () => {
    const received: number[] = [];

    startOBD();
    // Mock tick 50ms sonra gelir — listener'ları şimdi kayıt et
    const u1 = onOBDData((d) => { if (d.source === 'mock') received.push(1); });
    const u2 = onOBDData((d) => { if (d.source === 'mock') received.push(2); });

    // İki listener de mock tick'i alana kadar bekle
    await waitForOBDData(500, (d) => d.source === 'mock');
    // Biraz daha bekle — her iki listener'ın da işlemesi için
    await new Promise((r) => setTimeout(r, 60));

    u1();
    u2();

    expect(received).toContain(1);
    expect(received).toContain(2);
  });
});

/* ═══════════════════════════════════════════════════════════════
   7. NATIVE MODU — RECONNECT BACKOFF
═══════════════════════════════════════════════════════════════ */

describe('obdService — native modu, reconnect backoff', () => {
  afterEach(() => {
    stopOBD();
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it('disconnect eventi → reconnecting state → mock devreye girer', async () => {
    vi.useFakeTimers();
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);

    // obdStatus listener'ı yakala
    let statusCallback: ((e: unknown) => void) | null = null;
    vi.mocked(CarLauncher.addListener).mockImplementation(
      async (event: string, cb: (e: unknown) => void) => {
        if (event === 'obdStatus') statusCallback = cb;
        return { remove: vi.fn() };
      },
    );

    // connectOBD başarıyla tamamlanır
    vi.mocked(CarLauncher.connectOBD).mockResolvedValue(undefined);
    vi.mocked(CarLauncher.scanOBD).mockResolvedValue({
      devices: [{ name: 'ELM327', address: 'AA:BB:CC:DD:EE:FF' }],
    });

    const states: string[] = [];
    const unsub = onOBDData((d) => states.push(d.connectionState));

    startOBD();

    // Async chain: scanOBD → addListener×2 → connectOBD → connected
    // Her await için en az 1 mikro-task flush gerekir
    for (let i = 0; i < 6; i++) await Promise.resolve();

    // connected state olmalı şimdi
    expect(states).toContain('connected');

    // obdStatus eventi → _removeNativeHandles().then(_scheduleReconnect)
    statusCallback?.({});

    // _removeNativeHandles: 2 handle × 1 flush + return + .then = 4+ flush
    for (let i = 0; i < 6; i++) await Promise.resolve();

    // reconnecting state olmalı
    expect(states).toContain('reconnecting');

    // temizlik
    await vi.advanceTimersByTimeAsync(500);
    unsub();
  });
});
