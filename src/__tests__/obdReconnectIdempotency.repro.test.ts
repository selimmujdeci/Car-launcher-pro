/**
 * obdReconnectIdempotency.repro.test.ts — KANIT: yanlış stale reconnect donmayı tetikliyor mu?
 *
 * HİPOTEZ: stale watchdog eşiği (12s CAN) zayıf modlarda gerçek poll periyodundan
 * (POWER_SAVE 15s / SAFE_MODE 10s) KÜÇÜK olduğu için SAHTE reconnect ateşleniyor.
 * Soru: bu sahte reconnect'in KENDİSİ donma üretiyor mu (sızan timer / çift poll /
 * yeniden başlamayan scheduler / eski oturum event'i)?
 *
 * ÖLÇÜLENLER (reconnect ÖNCESİ vs SONRASI):
 *   - sessionId          → addListener çağrı turu (her _startNative yeni tur açar)
 *   - aktif native handle → addListener sayısı − remove sayısı
 *   - poll timer sayısı   → vi.getTimerCount() (stale watchdog + gate + reconnect)
 *   - connect/disconnect  → CarLauncher çağrı sayaçları
 *   - lastValidFrameAt    → getOBDStatusSnapshot().lastSeenMs
 *
 * KONTROL GRUBU: aynı adaptörde HİÇ reconnect olmadan veri akışı — donma var mı?
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const M = vi.hoisted(() => ({
  listeners: {} as Record<string, Array<(d: unknown) => void>>,
  addCalls: 0,
  removeCalls: 0,
  connectCalls: 0,
  disconnectCalls: 0,
}));

vi.mock('../platform/remoteLogService', () => ({ reportObdDiag: vi.fn(async () => {}) }));
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: vi.fn(() => true) } }));

vi.mock('../platform/nativePlugin', () => ({
  CarLauncher: {
    scanOBD: vi.fn().mockResolvedValue({ devices: [] }),
    connectOBD: vi.fn(async () => { M.connectCalls++; }),
    disconnectOBD: vi.fn(async () => { M.disconnectCalls++; }),
    addListener: vi.fn(async (event: string, cb: (d: unknown) => void) => {
      M.addCalls++;
      (M.listeners[event] ??= []).push(cb);
      return {
        remove: vi.fn(async () => {
          M.removeCalls++;
          M.listeners[event] = (M.listeners[event] ?? []).filter((f) => f !== cb);
        }),
      };
    }),
  } as Record<string, unknown>,
}));

vi.mock('../platform/performanceMode', () => ({
  getConfig: vi.fn(() => ({ obdPollInterval: 15_000, obdListenerDebounce: 0 })),
  onPerformanceModeChange: vi.fn(() => () => {}),
}));

vi.mock('../core/runtime/AdaptiveRuntimeManager', () => ({
  runtimeManager: {
    // POWER_SAVE: obdPollingMs 15s > stale eşiği 12s → SAHTE reconnect zemini.
    getMode: vi.fn(() => 'POWER_SAVE'),
    getConfig: vi.fn(() => ({ obdPollingMs: 15_000 })),
    subscribe: vi.fn(() => () => {}),
    reportFailure: vi.fn(),
  },
}));

vi.mock('../platform/crashLogger', () => ({ logError: vi.fn() }));
vi.mock('../platform/rafSmoother', () => ({ useRafSmoothed: vi.fn((v: number) => v) }));
vi.mock('../platform/obdBinaryParser', () => ({
  parseBinaryOBDFrame: vi.fn(() => null),
  hasBinaryFrame: vi.fn(() => false),
  clearAccumulatedBuffer: vi.fn(),
}));
vi.mock('../platform/canSnapshotService', () => ({
  hydrateCanSnapshotSync: vi.fn(() => ({})),
  hydrateCanSnapshotAsync: vi.fn(() => Promise.resolve({})),
  scheduleCanSnapshot: vi.fn(), flushCanSnapshotNow: vi.fn(), stopCanSnapshot: vi.fn(),
}));
vi.mock('../platform/safety/SafetyBrain', () => ({
  isFeatureEnabled: vi.fn(() => true), recordFault: vi.fn(),
}));
vi.mock('../platform/obdStorage', () => ({
  loadObdAddress: vi.fn(() => null), saveObdAddress: vi.fn(), clearObdAddress: vi.fn(),
  loadObdTransport: vi.fn(() => 'classic'), saveObdTransport: vi.fn(),
  loadObdTransportVerified: vi.fn(() => true), saveObdTransportVerified: vi.fn(),
  clearObdTransport: vi.fn(),
  loadObdProfileId: vi.fn(() => null), saveObdProfileId: vi.fn(),
  loadObdProtocol: vi.fn(() => '6'), saveObdProtocol: vi.fn(), clearObdProtocol: vi.fn(),
  loadObdFuelCalib: vi.fn(() => 1), saveObdFuelCalib: vi.fn(),
  isValidTcpAddress: vi.fn(() => false), markObdAddressVerified: vi.fn(),
}));
vi.mock('../platform/vehicleProfileService', () => ({ persistHandshakeVin: vi.fn() }));
vi.mock('../platform/obdDiagnosticRecorder', () => ({ recordDiag: vi.fn() }));
vi.mock('../platform/obdSanitizer', () => ({
  sanitizeNativeOBDPacket: vi.fn((d: Record<string, unknown>) => ({ patch: d, nextRpm: null })),
}));

import { startOBD, stopOBD, getOBDStatusSnapshot } from '../platform/obdService';
import { _resetObdDiagEmitterForTest } from '../platform/obdDiagEmitter';

const ADDR = '00:11:22:33:44:55';

/** Tüm kayıtlı obdData dinleyicilerine ECU verisi gönderir (native poll paketi taklidi). */
function feedEcuData(patch: Record<string, number>): void {
  for (const cb of M.listeners['obdData'] ?? []) cb(patch);
}

/** Ölçüm anlık görüntüsü — reconnect öncesi/sonrası karşılaştırma için. */
function probe() {
  const snap = getOBDStatusSnapshot();
  return {
    activeHandles: M.addCalls - M.removeCalls,
    liveDataListeners: (M.listeners['obdData'] ?? []).length,
    liveStatusListeners: (M.listeners['obdStatus'] ?? []).length,
    pendingTimers: vi.getTimerCount(),
    connectCalls: M.connectCalls,
    disconnectCalls: M.disconnectCalls,
    connectionState: snap.connectionState,
    lastValidFrameAt: snap.lastSeenMs,
  };
}

beforeEach(() => {
  _resetObdDiagEmitterForTest();
  M.listeners = {};
  M.addCalls = 0; M.removeCalls = 0; M.connectCalls = 0; M.disconnectCalls = 0;
  vi.useFakeTimers();
});

afterEach(() => {
  stopOBD();
  vi.clearAllMocks();
  vi.useRealTimers();
});

/** Temiz bağlı oturum kurar (gate geçmiş, watchdog çalışıyor). */
async function establishConnection(): Promise<void> {
  startOBD(ADDR);
  await vi.advanceTimersByTimeAsync(50); // connect zinciri (mikro-task)
  feedEcuData({ speed: 40, rpm: 1500 }); // gate geçer → connected + watchdog başlar
  await vi.advanceTimersByTimeAsync(10);
}

describe('1. TEMİZ BAĞLANTI — taban ölçüm', () => {
  it('gate geçer, tek oturum, veri akar', async () => {
    await establishConnection();
    const p = probe();
    expect(p.connectionState).toBe('connected');
    expect(p.liveDataListeners).toBe(1);   // TEK data dinleyicisi
    expect(p.liveStatusListeners).toBe(1); // TEK status dinleyicisi
    expect(p.connectCalls).toBe(1);
    expect(p.lastValidFrameAt).toBeGreaterThan(0);
  });
});

describe('5. KONTROL GRUBU — reconnect OLMADAN donma var mı?', () => {
  it('poll akarken (10s aralık < 12s eşik) reconnect TETİKLENMEZ ve veri akmaya devam eder', async () => {
    await establishConnection();
    const before = probe();

    // 10 sn'de bir ECU verisi → eşiğin (12s) ALTINDA → watchdog susmalı.
    for (let i = 0; i < 6; i++) {
      await vi.advanceTimersByTimeAsync(10_000);
      feedEcuData({ speed: 40 + i, rpm: 1500 });
    }
    const after = probe();

    expect(after.connectCalls).toBe(before.connectCalls); // HİÇ reconnect olmadı
    expect(after.connectionState).toBe('connected');
    expect(after.lastValidFrameAt).toBeGreaterThan(before.lastValidFrameAt); // veri AKIYOR
    expect(after.liveDataListeners).toBe(1); // sızıntı yok
  });
});

describe('2. DALGALANMA KÖK DÜZELTMESİ — sahte reconnect ARTIK ateşlenmemeli', () => {
  it('KÖK KİLİDİ: POWER_SAVE (15s poll) sağlıklı kadansta reconnect TETİKLEMEZ', async () => {
    // Bu test kök nedeni belgeler: eşik artık kadansa bağlı
    // (max(12s taban, 15s×3 + 2s jitter) = 47s) → 15s'lik poll SAHTE bayatlık üretmez.
    // Düzeltmeden ÖNCE: sabit 12s eşik < 15s poll → her turda sahte reconnect.
    await establishConnection();
    const before = probe();
    expect(before.connectCalls).toBe(1);

    // Gerçek POWER_SAVE kadansı: 15s'de bir çekirdek PID — eski 12s eşiğini AŞAR.
    for (let i = 0; i < 8; i++) {
      await vi.advanceTimersByTimeAsync(15_000);
      feedEcuData({ speed: 40 + i, rpm: 1500 });
    }

    const after = probe();
    expect(after.connectCalls).toBe(before.connectCalls); // SIFIR sahte reconnect
    expect(after.connectionState).toBe('connected');       // dalgalanma YOK
  });

  it('VERİ BAYAT ≠ KOPMA: link canlıyken (ATRV akıyor) ECU susarsa reconnect BAŞLAMAZ', async () => {
    await establishConnection();
    const before = probe();

    // ECU sustu ama adaptör canlı: yalnız ATRV (batteryVoltage) akmaya devam ediyor.
    // ATRV `_hasEcuData` DIŞINDADIR → dataFresh düşer, ama link heartbeat'i tazeler.
    for (let i = 0; i < 12; i++) {
      await vi.advanceTimersByTimeAsync(5_000);
      feedEcuData({ batteryVoltage: 14.2 }); // yalnız ATRV — ECU verisi YOK
    }

    const after = probe();
    expect(after.connectCalls).toBe(before.connectCalls); // TEARDOWN YOK
    expect(after.liveDataListeners).toBe(1);              // native handle KALDIRILMADI
    expect(after.connectionState).toBe('connected');      // bağlantı DÜŞMEDİ
  });
});

describe('3+4. GERÇEK LINK ÖLÜMÜ — hızlı algılanmalı ve idempotent olmalı', () => {
  /** Hiçbir paket göndermeden (ATRV dahil) linki öldürür → gerçek kopma. */
  async function killLink(): Promise<void> {
    await vi.advanceTimersByTimeAsync(60_000); // hiçbir feed yok → heartbeat ölür
    await vi.advanceTimersByTimeAsync(10_000); // reconnect turu ilerlesin
  }

  it('GERÇEK KOPMA GİZLENMEZ: hiç paket gelmezse (ATRV dahil) reconnect TETİKLENİR', async () => {
    await establishConnection();
    const before = probe();
    await killLink();
    const after = probe();
    expect(after.connectCalls).toBeGreaterThan(before.connectCalls);
  });

  it('IDEMPOTENT: gerçek reconnect sonrası TEK data + TEK status dinleyicisi (çift poll yok)', async () => {
    await establishConnection();
    await killLink();
    feedEcuData({ speed: 55, rpm: 2000 });
    await vi.advanceTimersByTimeAsync(10);

    const p = probe();
    expect(p.liveDataListeners).toBe(1);   // eski dinleyici SIZMADI
    expect(p.liveStatusListeners).toBe(1);
    expect(p.activeHandles).toBe(2);       // yalnız yeni oturumun 2 handle'ı
  });

  it('IDEMPOTENT: reconnect sonrası poll scheduler YENİDEN başlar (veri akışı geri gelir)', async () => {
    await establishConnection();
    const beforeFrame = probe().lastValidFrameAt;
    await killLink();
    feedEcuData({ speed: 55, rpm: 2000 });
    await vi.advanceTimersByTimeAsync(10);

    const p = probe();
    // DONMA KANITI: reconnect sonrası veri AKMIYORSA lastValidFrameAt ilerlemez.
    expect(p.lastValidFrameAt).toBeGreaterThan(beforeFrame);
    expect(p.connectionState).toBe('connected');
  });

  it('IDEMPOTENT: ESKİ oturumun event"i reddedilmeli (sessionId guard)', async () => {
    await establishConnection();
    const staleCb = (M.listeners['obdData'] ?? [])[0]!; // 1. oturumun dinleyicisi
    await killLink();
    feedEcuData({ speed: 55, rpm: 2000 });
    await vi.advanceTimersByTimeAsync(10);
    const beforeGhost = probe();

    // Eski oturumun callback'i "hayalet" paket gönderirse state DEĞİŞMEMELİ.
    staleCb({ speed: 999, rpm: 9999 });
    await vi.advanceTimersByTimeAsync(10);

    expect(probe().lastValidFrameAt).toBe(beforeGhost.lastValidFrameAt);
  });

  it('TIMER SIZINTISI: tekrarlanan gerçek reconnect timer sayısını BÜYÜTMEMELİ', async () => {
    await establishConnection();

    const counts: number[] = [];
    for (let cycle = 0; cycle < 3; cycle++) {
      await killLink();
      feedEcuData({ speed: 50, rpm: 1800 });
      await vi.advanceTimersByTimeAsync(10);
      counts.push(vi.getTimerCount());
    }
    // Her tur aynı sayıda timer bırakmalı — artıyorsa sızıntı var (donma adayı).
    expect(counts[2]).toBeLessThanOrEqual(counts[0]!);
  });
});
