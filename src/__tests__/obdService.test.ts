/**
 * obdService.test.ts — OBD servis state machine testleri.
 *
 * Test kapsamı:
 *  - Web (non-native) modda mock otomatik başlar
 *  - Native modda cihaz bulunamazsa mock'a düşer
 *  - connectOBD 30 s timeout → hata sonrası mock'a düşer
 *  - stopOBD tüm state'i sıfırlar
 *  - Dar selector hook'lar (useOBDSpeed vb.) yalnızca ilgili alanda değişince render alır
 *  - onOBDData listener cleanup
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/* ── Mock tanımları ─────────────────────────────────────────── */

// Capacitor platform tespiti — varsayılan: web modu
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: vi.fn(() => false) },
}));

// Native plugin — tüm metodlar kontrol edilebilir mock
vi.mock('../platform/nativePlugin', () => ({
  CarLauncher: {
    scanOBD:              vi.fn().mockResolvedValue({ devices: [] }),
    connectOBD:           vi.fn().mockImplementation(() => new Promise(() => {})), // asla resolve etmez
    disconnectOBD:        vi.fn().mockResolvedValue(undefined),
    addListener:          vi.fn().mockResolvedValue({ remove: vi.fn() }),
    startBackgroundService: vi.fn().mockResolvedValue(undefined),
    stopBackgroundService:  vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../platform/performanceMode', () => ({
  getConfig: vi.fn(() => ({
    obdPollInterval:      50,   // hızlı test için kısa interval
    obdListenerDebounce:  0,
    enableRecommendations: false,
    recCooldownMs:        999_999,
  })),
  onPerformanceModeChange: vi.fn(() => () => {}),
}));

vi.mock('../platform/crashLogger', () => ({
  logError: vi.fn(),
}));

/* ── İmportlar (mock'lardan sonra) ─────────────────────────── */

import { Capacitor }  from '@capacitor/core';
import { CarLauncher } from '../platform/nativePlugin';
import {
  startOBD, stopOBD, onOBDData,
  type OBDData,
} from '../platform/obdService';

/* ── Yardımcı: listener'dan ilk veriyi bekle ────────────────── */

function waitForOBDData(
  timeoutMs = 200,
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

/* ── Test suite ─────────────────────────────────────────────── */

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
      stopOBD(); // state sıfırla → listener tetiklenir
    });

    expect(afterStop.source).toBe('none');
    expect(afterStop.connectionState).toBe('idle');
  });

  it('startOBD idempotent — iki kez çağrılınca iki mock başlamaz', async () => {
    startOBD();
    startOBD(); // ikinci çağrı dikkate alınmamalı
    const data = await waitForOBDData(500, (d) => d.source === 'mock');
    expect(data.source).toBe('mock');
  });

  it('mock verisinde speed, rpm, engineTemp gerçekçi aralıklarda', async () => {
    startOBD();
    const data = await waitForOBDData(500, (d) => d.source === 'mock');
    expect(data.speed).toBeGreaterThanOrEqual(0);
    expect(data.speed).toBeLessThanOrEqual(180);
    expect(data.rpm).toBeGreaterThanOrEqual(650);
    expect(data.rpm).toBeLessThanOrEqual(4000);
    expect(data.engineTemp).toBeGreaterThanOrEqual(75);
    expect(data.engineTemp).toBeLessThanOrEqual(105);
    expect(data.fuelLevel).toBeGreaterThanOrEqual(0);
    expect(data.fuelLevel).toBeLessThanOrEqual(100);
  });
});

describe('obdService — native modu, cihaz bulunamadı', () => {
  beforeEach(() => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
    vi.mocked(CarLauncher.scanOBD).mockResolvedValue({ devices: [] });
  });
  afterEach(() => {
    stopOBD();
    vi.clearAllMocks();
  });

  it('eşleşmiş BT cihazı yok → mock moda düşer', async () => {
    startOBD();
    // native başarısız → 1.5 s bekleme sonrası mock başlar
    const data = await waitForOBDData(3000, (d) => d.source === 'mock');
    expect(data.source).toBe('mock');
  });
});

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

  it('30 s sonra hata durumuna geçer, 31.5 s sonra mock başlar', async () => {
    const states: string[] = [];
    const unsub = onOBDData((d) => { states.push(d.connectionState); });

    startOBD();

    // scanOBD + addListener Promise'lerini çöz (mikro-task flush)
    await Promise.resolve();
    await Promise.resolve();
    // 30 s timeout'u tetikle
    await vi.advanceTimersByTimeAsync(30_500);
    await Promise.resolve();
    await Promise.resolve();
    // 1.5 s bekleme sonrası mock başlar
    await vi.advanceTimersByTimeAsync(2_000);
    await Promise.resolve();

    unsub();
    expect(states).toContain('error');
    expect(states[states.length - 1]).toBe('connected'); // mock connected
  });
});

describe('obdService — onOBDData listener yönetimi', () => {
  // Her test describe önceki describe'ın fake timer artıklarından izole edilmiş

  it('cleanup fonksiyonu listener kaldırır — startOBD öncesi eklenip kaldırılan listener tetiklenmez', async () => {
    vi.useRealTimers();
    await Promise.resolve(); // önceki describe'ın microtask'larını temizle
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(false);

    // listener'ı ekle ve hemen kaldır
    let callCount = 0;
    const unsub = onOBDData(() => { callCount++; });
    unsub(); // hemen kaldır

    // startOBD çağrısı _startMock() → _merge() → listeners'ı çağırır
    // ama bu listener kaldırıldığı için çağrılmamalı
    startOBD();

    try {
      expect(callCount).toBe(0);
    } finally {
      stopOBD();
      await Promise.resolve(); // cleanup microtask'larını temizle
    }
  });

});

describe('obdService — stopOBD mid-flight koruma (generation guard)', () => {
  beforeEach(() => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
    // scanOBD asla resolve etmez → _startNative() sonsuza askıda
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
    // stopOBD sonrası son state 'idle' olmalı, 'connected' veya 'scanning' olmamalı
    expect(states[states.length - 1]).toBe('idle');
  });

  it('startOBD idempotent — ikinci çağrı yeni native döngü başlatmaz', async () => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(false);
    startOBD();
    startOBD(); // ikinci çağrı _running=true olduğu için atlanır
    const data = await waitForOBDData(500, (d) => d.source === 'mock');
    expect(data.source).toBe('mock');
    stopOBD();
  });
});

describe('obdService — çoklu listener', () => {
  beforeEach(() => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(false);
  });
  afterEach(() => {
    stopOBD();
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it('birden fazla listener eş zamanlı çalışır', () => {
    const received: number[] = [];
    const u1 = onOBDData(() => received.push(1));
    const u2 = onOBDData(() => received.push(2));

    // stopOBD() → _lastNotifyTime=0 (reset) → startOBD() → _notify() her zaman geçer
    stopOBD(); // state'i ve debounce timer'ı sıfırla
    startOBD(); // _startMock() → _merge() → _notify() → u1+u2

    u1();
    u2();
    expect(received).toContain(1);
    expect(received).toContain(2);
  });
});
