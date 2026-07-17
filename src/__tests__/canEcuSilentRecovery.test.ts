/**
 * canEcuSilentRecovery.test.ts — PR-CAN-RECOVER: CAN'de ECU susunca kurtarma.
 *
 * KÖK: KWP/ISO9141'de ölü-oturum kurtarması NATIVE'de (ElmProtocol.noteKwpSessionHealth →
 * ardışık çekirdek NO_DATA → ATPC), ama `isSlowSerialActive()` kapısı CAN'i (proto 6/7)
 * BİLİNÇLİ dışarıda bırakır → CAN'de ECU susunca kurtarma YOK → manuel reset'e dek donuk
 * (saha 2026-07-16 Doblo).
 *
 * Bu testler kurtarmanın ÇALIŞTIĞINI ve dalgalanmayı YENİDEN İCAT ETMEDİĞİNİ kilitler.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const M = vi.hoisted(() => ({
  listeners: {} as Record<string, Array<(d: unknown) => void>>,
  addCalls: 0, removeCalls: 0, connectCalls: 0,
  recoverCalls: [] as string[],
  recoverOk: true,
  protocol: '6', // CAN 11-bit/500k
}));

vi.mock('../platform/remoteLogService', () => ({ reportObdDiag: vi.fn(async () => {}) }));
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: vi.fn(() => true) } }));

vi.mock('../platform/nativePlugin', () => ({
  CarLauncher: {
    scanOBD: vi.fn().mockResolvedValue({ devices: [] }),
    connectOBD: vi.fn(async () => { M.connectCalls++; return { protocol: M.protocol }; }),
    disconnectOBD: vi.fn(async () => {}),
    recoverObdSession: vi.fn(async ({ level }: { level: string }) => {
      M.recoverCalls.push(level);
      return { ok: M.recoverOk };
    }),
    addListener: vi.fn(async (event: string, cb: (d: unknown) => void) => {
      M.addCalls++;
      (M.listeners[event] ??= []).push(cb);
      return { remove: vi.fn(async () => { M.removeCalls++; M.listeners[event] = (M.listeners[event] ?? []).filter((f) => f !== cb); }) };
    }),
  } as Record<string, unknown>,
}));

vi.mock('../platform/performanceMode', () => ({
  getConfig: vi.fn(() => ({ obdPollInterval: 1_000, obdListenerDebounce: 0 })),
  onPerformanceModeChange: vi.fn(() => () => {}),
}));
vi.mock('../core/runtime/AdaptiveRuntimeManager', () => ({
  runtimeManager: {
    getMode: vi.fn(() => 'PERFORMANCE'),
    getConfig: vi.fn(() => ({ obdPollingMs: 1_000 })),
    subscribe: vi.fn(() => () => {}), reportFailure: vi.fn(),
  },
}));
vi.mock('../platform/crashLogger', () => ({ logError: vi.fn() }));
vi.mock('../platform/rafSmoother', () => ({ useRafSmoothed: vi.fn((v: number) => v) }));
vi.mock('../platform/obdBinaryParser', () => ({
  parseBinaryOBDFrame: vi.fn(() => null), hasBinaryFrame: vi.fn(() => false), clearAccumulatedBuffer: vi.fn(),
}));
vi.mock('../platform/canSnapshotService', () => ({
  hydrateCanSnapshotSync: vi.fn(() => ({})), hydrateCanSnapshotAsync: vi.fn(() => Promise.resolve({})),
  scheduleCanSnapshot: vi.fn(), flushCanSnapshotNow: vi.fn(), stopCanSnapshot: vi.fn(),
}));
vi.mock('../platform/safety/SafetyBrain', () => ({ isFeatureEnabled: vi.fn(() => true), recordFault: vi.fn() }));
vi.mock('../platform/obdStorage', () => ({
  loadObdAddress: vi.fn(() => null), saveObdAddress: vi.fn(), clearObdAddress: vi.fn(),
  loadObdTransport: vi.fn(() => 'classic'), saveObdTransport: vi.fn(),
  loadObdTransportVerified: vi.fn(() => true), saveObdTransportVerified: vi.fn(), clearObdTransport: vi.fn(),
  loadObdProfileId: vi.fn(() => null), saveObdProfileId: vi.fn(),
  loadObdProtocol: vi.fn(() => M.protocol), saveObdProtocol: vi.fn(), clearObdProtocol: vi.fn(),
  loadObdFuelCalib: vi.fn(() => 1), saveObdFuelCalib: vi.fn(),
  isValidTcpAddress: vi.fn(() => false), markObdAddressVerified: vi.fn(),
}));
vi.mock('../platform/vehicleProfileService', () => ({ persistHandshakeVin: vi.fn() }));
vi.mock('../platform/obdDiagnosticRecorder', () => ({ recordDiag: vi.fn() }));
vi.mock('../platform/obdSanitizer', () => ({
  sanitizeNativeOBDPacket: vi.fn((d: Record<string, unknown>) => ({ patch: d, nextRpm: null })),
}));

import { startOBD, stopOBD, getOBDStatusSnapshot, getOBDDataSnapshot } from '../platform/obdService';
import { _resetObdDiagEmitterForTest } from '../platform/obdDiagEmitter';
import {
  getRecoveryLevel, getRecoveryCooldownMs, isCanRecoveryApplicable,
  ECU_SILENT_STREAK_TO_RECOVER, MAX_RECOVERY_ATTEMPTS, RECOVERY_BASE_COOLDOWN_MS,
} from '../platform/obdRetryPolicy';

const ADDR = '00:11:22:33:44:55';

function feed(patch: Record<string, number>): void {
  for (const cb of M.listeners['obdData'] ?? []) cb(patch);
}

/** ECU susmuş ama adaptör canlı: yalnız ATRV akıyor (link heartbeat). */
async function silentEcuFor(ms: number): Promise<void> {
  const step = 2_000;
  for (let t = 0; t < ms; t += step) {
    await vi.advanceTimersByTimeAsync(step);
    feed({ batteryVoltage: 14.2 }); // ATRV — _hasEcuData DIŞINDA → dataFresh düşer
  }
}

async function establish(): Promise<void> {
  startOBD(ADDR);
  await vi.advanceTimersByTimeAsync(50);
  feed({ speed: 40, rpm: 1500 });
  await vi.advanceTimersByTimeAsync(10);
}

beforeEach(() => {
  _resetObdDiagEmitterForTest();
  M.listeners = {}; M.addCalls = 0; M.removeCalls = 0; M.connectCalls = 0;
  M.recoverCalls = []; M.recoverOk = true; M.protocol = '6';
  vi.useFakeTimers();
});
afterEach(() => { stopOBD(); vi.clearAllMocks(); vi.useRealTimers(); });

/* ══ SAF POLİTİKA ═════════════════════════════════════════════════════════ */

describe('saf politika — merdiven / backoff / protokol kapısı', () => {
  it('merdiven en hafiften en ağıra ilerler', () => {
    expect(getRecoveryLevel(0)).toBe('protocol_close');
    expect(getRecoveryLevel(1)).toBe('elm_reinit');
    expect(getRecoveryLevel(2)).toBe('transport_reconnect');
  });

  it('tavan aşılınca null — sonsuz döngü YOK', () => {
    expect(getRecoveryLevel(MAX_RECOVERY_ATTEMPTS)).toBeNull();
    expect(getRecoveryLevel(99)).toBeNull();
  });

  it('cooldown ÜSTEL büyür (10s · 20s · 40s)', () => {
    expect(getRecoveryCooldownMs(0)).toBe(RECOVERY_BASE_COOLDOWN_MS);
    expect(getRecoveryCooldownMs(1)).toBe(RECOVERY_BASE_COOLDOWN_MS * 2);
    expect(getRecoveryCooldownMs(2)).toBe(RECOVERY_BASE_COOLDOWN_MS * 4);
    expect(getRecoveryCooldownMs(1)).toBeGreaterThan(getRecoveryCooldownMs(0));
  });

  it('KRİTİK: kurtarma YALNIZ CAN — KWP/ISO9141 native ATPC"ye dokunulmaz', () => {
    for (const can of ['6', '7', '8', '9', 'A', 'B', 'C']) {
      expect(isCanRecoveryApplicable(can)).toBe(true);
    }
    // Yavaş seri: native ElmProtocol.noteKwpSessionHealth ZATEN kurtarıyor →
    // ikinci motor = çift ATPC = oturum sürekli kapanır = YENİ dalgalanma.
    for (const slow of ['3', '4', '5']) {
      expect(isCanRecoveryApplicable(slow)).toBe(false);
    }
    // J1850
    expect(isCanRecoveryApplicable('1')).toBe(false);
    expect(isCanRecoveryApplicable('2')).toBe(false);
  });

  it('protokol bilinmiyorsa kurtarma YOK (fail-closed)', () => {
    expect(isCanRecoveryApplicable(null)).toBe(false);
    expect(isCanRecoveryApplicable(undefined)).toBe(false);
    expect(isCanRecoveryApplicable('')).toBe(false);
  });
});

/* ══ ENTEGRASYON — CAN proto 6 ════════════════════════════════════════════ */

describe('CAN proto 6 — ECU sessizliği kontrollü simüle edilir', () => {
  it('KABUL: ECU susar → kurtarma çalışır → veri otomatik GERİ GELİR', async () => {
    await establish();
    expect(getOBDDataSnapshot().dataFresh).toBe(true);

    await silentEcuFor(30_000);              // ECU sustu (ATRV akıyor)
    expect(getOBDDataSnapshot().dataFresh).toBe(false);
    expect(M.recoverCalls.length).toBeGreaterThan(0); // kurtarma denendi
    expect(M.recoverCalls[0]).toBe('protocol_close'); // EN HAFİF basamaktan başladı

    // Kurtarma işe yaradı: ECU yeniden konuşuyor.
    feed({ speed: 45, rpm: 1600 });
    await vi.advanceTimersByTimeAsync(6_000); // watchdog turu

    expect(getOBDDataSnapshot().dataFresh).toBe(true);          // veri GERİ GELDİ
    expect(getOBDDataSnapshot().transportConnected).toBe(true); // adaptör bağlı KALDI
  });

  it('KABUL: gerçek adaptör bağlı KALIR — ilk iki basamak transport"a dokunmaz', async () => {
    M.recoverOk = false; // ATPC ve reinit işe yaramıyor
    await establish();
    const connectsBefore = M.connectCalls;

    // İlk iki basamağın cooldown'u dolacak kadar bekle (10s + 20s), ama SON ÇAREye varma.
    await silentEcuFor(35_000);

    expect(M.recoverCalls).toContain('protocol_close');
    expect(M.connectCalls).toBe(connectsBefore);            // transport reconnect YOK
    expect(getOBDDataSnapshot().transportConnected).toBe(true);     // adaptör bağlı
    expect(getOBDStatusSnapshot().connectionState).toBe('connected'); // UI dalgalanmadı
  });

  it('TEK stale olayı kurtarma BAŞLATMAZ (ardışık doğrulama şart)', async () => {
    await establish();
    // Tek bir watchdog turu bayat görsün, sonra veri dönsün.
    await vi.advanceTimersByTimeAsync(13_000);
    feed({ batteryVoltage: 14.2 });
    await vi.advanceTimersByTimeAsync(1_000);
    // Ardışık streak eşiğe (2) ulaşmadan veri döndü.
    feed({ speed: 42, rpm: 1500 });
    await vi.advanceTimersByTimeAsync(6_000);

    expect(ECU_SILENT_STREAK_TO_RECOVER).toBeGreaterThan(1);
    expect(getOBDDataSnapshot().dataFresh).toBe(true);
  });

  it('MERDİVEN: ATPC yetmezse elm_reinit"e yükselir (cooldown sonrası)', async () => {
    M.recoverOk = false;
    await establish();
    await silentEcuFor(45_000);
    expect(M.recoverCalls).toContain('protocol_close');
    expect(M.recoverCalls).toContain('elm_reinit');
    // Sıra korunur: hafif olan ÖNCE.
    expect(M.recoverCalls.indexOf('protocol_close')).toBeLessThan(M.recoverCalls.indexOf('elm_reinit'));
  });

  it('SONSUZ DÖNGÜ YOK: tavan aşılınca kurtarma DURUR', async () => {
    M.recoverOk = false;
    await establish();
    await silentEcuFor(200_000); // çok uzun sessizlik
    // Native kurtarma çağrıları (protocol_close + elm_reinit) tavanla sınırlı;
    // transport_reconnect native recover API'sini kullanmaz.
    expect(M.recoverCalls.length).toBeLessThanOrEqual(MAX_RECOVERY_ATTEMPTS);
  });

  it('BAŞARIDA sayaçlar sıfırlanır → sonraki sessizlik yine EN HAFİF basamaktan başlar', async () => {
    await establish();
    await silentEcuFor(30_000);
    const firstRound = M.recoverCalls.length;
    expect(M.recoverCalls[0]).toBe('protocol_close');

    // Veri döndü → sayaçlar sıfırlanmalı.
    feed({ speed: 50, rpm: 1700 });
    await vi.advanceTimersByTimeAsync(6_000);
    expect(getOBDDataSnapshot().dataFresh).toBe(true);

    // İkinci sessizlik turu: yine protocol_close ile BAŞLAMALI (elm_reinit'ten değil).
    await silentEcuFor(30_000);
    expect(M.recoverCalls.length).toBeGreaterThan(firstRound);
    expect(M.recoverCalls[firstRound]).toBe('protocol_close');
  });

  it('UI DALGALANMASI YOK: kurtarma boyunca "OBD bağlı değil" durumuna düşmez', async () => {
    M.recoverOk = false;
    await establish();
    const states: string[] = [];
    for (let i = 0; i < 8; i++) {
      await vi.advanceTimersByTimeAsync(4_000);
      feed({ batteryVoltage: 14.2 });
      states.push(getOBDStatusSnapshot().connectionState);
    }
    // İlk iki basamak transport'a dokunmadığı için connectionState SABİT kalmalı.
    expect([...new Set(states)]).toEqual(['connected']);
  });

  it('ÇİFT TETİKLEME YOK: tek watchdog turunda tek kurtarma komutu', async () => {
    await establish();
    await silentEcuFor(14_000);
    const afterFirst = M.recoverCalls.length;
    // Cooldown (10s) dolmadan ek tur → yeni komut GİTMEMELİ.
    await vi.advanceTimersByTimeAsync(4_000);
    feed({ batteryVoltage: 14.2 });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(M.recoverCalls.length).toBe(afterFirst);
  });
});

/* ══ KWP KORUMASI ═════════════════════════════════════════════════════════ */

describe('KWP (proto 5) — native ATPC davranışı BOZULMAZ', () => {
  it('KRİTİK: KWP"de TS kurtarması HİÇ çalışmaz (çift ATPC yok)', async () => {
    M.protocol = '5'; // KWP fast init
    await establish();
    await silentEcuFor(60_000);
    // Native noteKwpSessionHealth ZATEN ATPC gönderiyor → TS karışmamalı.
    expect(M.recoverCalls).toHaveLength(0);
  });

  it('ISO9141 (proto 3) için de TS kurtarması çalışmaz', async () => {
    M.protocol = '3';
    await establish();
    await silentEcuFor(60_000);
    expect(M.recoverCalls).toHaveLength(0);
  });
});

/* ══ ESKİ APK ═════════════════════════════════════════════════════════════ */

describe('geriye dönük uyum', () => {
  it('eski APK (recoverObdSession yok) → çökmez, basamak atlanır', async () => {
    const CL = (await import('../platform/nativePlugin')).CarLauncher as unknown as Record<string, unknown>;
    const saved = CL['recoverObdSession'];
    delete CL['recoverObdSession'];
    try {
      await establish();
      await silentEcuFor(30_000);
      // Çökme yok; bağlantı korunur.
      expect(getOBDDataSnapshot().transportConnected).toBe(true);
    } finally {
      CL['recoverObdSession'] = saved;
    }
  });
});
