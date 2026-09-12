/**
 * obdConnectAuthority.test.ts — P0-OBD-CORE-06 · TEK ÇALIŞAN CONNECT DENEMESİ.
 *
 * ── SAHA (2026-08-25) ───────────────────────────────────────────────────────
 *   failedAttemptsBeforeData = 17 · çok sayıda CONNECT_FAILED · reconnectPressure
 *   1.48–2.52 — AMA bağlantı kurulduktan sonra hat KUSURSUZ (34/34 başarılı,
 *   0 no-data, 0 timeout, RTT 223–330 ms).
 *
 * Bu testler iki şeyi kilitler:
 *   1. Hat sahipliği kuralı (saf model) — hangi motor ne zaman susar.
 *   2. Servis davranışı — uçuşta bir deneme varken İKİNCİ `connectOBD()` GİTMEZ,
 *      ve önlenen istek "başarısız deneme" olarak SAYILMAZ (17 sayısını şişiren
 *      tam olarak buydu).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.hoisted(() => { process.env['VITE_ENABLE_OBD_MOCK'] = 'false'; });

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: vi.fn(() => true) },
}));

/* Native köprü: connectOBD BİLEREK askıda kalır — "uçuştaki deneme" penceresi budur. */
vi.mock('../platform/nativePlugin', () => ({
  CarLauncher: {
    scanOBD:                vi.fn().mockResolvedValue({ devices: [] }),
    connectOBD:             vi.fn().mockImplementation(() => new Promise(() => {})),
    disconnectOBD:          vi.fn().mockResolvedValue(undefined),
    addListener:            vi.fn().mockResolvedValue({ remove: vi.fn() }),
    startBackgroundService: vi.fn().mockResolvedValue(undefined),
    stopBackgroundService:  vi.fn().mockResolvedValue(undefined),
    performHandshake:       vi.fn().mockResolvedValue({ raw09: '', raw0100: '' }),
    getObdBondState:        vi.fn().mockResolvedValue({ bonded: true }),
  },
}));

vi.mock('../platform/performanceMode', () => ({
  getConfig: vi.fn(() => ({
    obdPollInterval: 50, obdListenerDebounce: 0,
    enableRecommendations: false, recCooldownMs: 999_999,
  })),
  onPerformanceModeChange: vi.fn(() => () => {}),
}));

vi.mock('../platform/canSnapshotService', () => ({
  hydrateCanSnapshotSync:  vi.fn(() => ({})),
  hydrateCanSnapshotAsync: vi.fn(() => Promise.resolve({})),
  scheduleCanSnapshot: vi.fn(), flushCanSnapshotNow: vi.fn(), stopCanSnapshot: vi.fn(),
}));

vi.mock('../platform/obdBinaryParser', () => ({
  parseBinaryOBDFrame: vi.fn(() => null),
  hasBinaryFrame: vi.fn(() => false),
  clearAccumulatedBuffer: vi.fn(),
}));

vi.mock('../platform/rafSmoother', () => ({ useRafSmoothed: vi.fn((v: number) => v) }));

vi.mock('../core/runtime/AdaptiveRuntimeManager', () => ({
  runtimeManager: {
    getMode: vi.fn(() => 'BALANCED'),
    getConfig: vi.fn(() => ({
      obdPollingMs: 50, gpsUpdateMs: 200, uiFpsTarget: 60,
      enableBlur: false, enableAnimations: false, loggingLevel: 'silent',
    })),
    subscribe: vi.fn(() => () => {}),
    reportFailure: vi.fn(), reportRecovery: vi.fn(),
  },
  AdaptiveRuntimeManager: { getInstance: vi.fn() },
}));

vi.mock('../platform/crashLogger', () => ({ logError: vi.fn() }));

import { CarLauncher } from '../platform/nativePlugin';
import {
  startOBD, stopOBD, notifyAppForeground, getObdReconnectLifecycle,
} from '../platform/obdService';
import {
  lineOwner, canScheduleTransportReconnect, canStartEcuRecovery,
  canResumeFromForeground, reconnectFireDecision, type ObdLineState,
} from '../platform/obd/connectAuthority';

const IDLE: ObdLineState = {
  connectInFlight: false, reconnectPending: false,
  nativeReconnectInFlight: false, recoveryInFlight: false,
};

/* ═══════════════════════════════════════════════════════════════════════════
   1. SAF MODEL — hattın sahibi kim
═══════════════════════════════════════════════════════════════════════════ */

describe('connectAuthority — hat sahipliği (saf model)', () => {
  it('öncelik: connect > native_reconnect > recovery > reconnect_pending', () => {
    expect(lineOwner(IDLE)).toBe('idle');
    expect(lineOwner({ ...IDLE, reconnectPending: true })).toBe('reconnect_pending');
    expect(lineOwner({ ...IDLE, reconnectPending: true, recoveryInFlight: true })).toBe('recovery');
    expect(lineOwner({ ...IDLE, recoveryInFlight: true, nativeReconnectInFlight: true }))
      .toBe('native_reconnect');
    expect(lineOwner({ ...IDLE, nativeReconnectInFlight: true, connectInFlight: true }))
      .toBe('connect');
  });

  it('uçuşta deneme varken YENİ transport reconnect turu AÇILMAZ', () => {
    expect(canScheduleTransportReconnect(IDLE)).toBe(true);
    expect(canScheduleTransportReconnect({ ...IDLE, connectInFlight: true })).toBe(false);
    // Kurtarma tek başına merdiveni ENGELLEMEZ (tetik ertelenir, iptal edilmez).
    expect(canScheduleTransportReconnect({ ...IDLE, recoveryInFlight: true })).toBe(true);
  });

  it('SESSION RECOVERY ile TRANSPORT RECONNECT aynı anda çalışamaz', () => {
    // Transport tarafı meşgulse kurtarma başlamaz…
    expect(canStartEcuRecovery({ ...IDLE, connectInFlight: true })).toBe(false);
    expect(canStartEcuRecovery({ ...IDLE, reconnectPending: true })).toBe(false);
    expect(canStartEcuRecovery({ ...IDLE, nativeReconnectInFlight: true })).toBe(false);
    expect(canStartEcuRecovery(IDLE)).toBe(true);
    // …ve kurtarma sürerken ateşlenen tetik İPTAL EDİLMEZ, ERTELENİR.
    expect(reconnectFireDecision({ ...IDLE, recoveryInFlight: true }, 0, 8)).toBe('yield_to_recovery');
    expect(reconnectFireDecision({ ...IDLE, recoveryInFlight: true }, 8, 8)).toBe('start');
    expect(reconnectFireDecision(IDLE, 0, 8)).toBe('start');
  });

  it('foreground resume YALNIZ hat sahipsizken müdahale eder', () => {
    expect(canResumeFromForeground(IDLE)).toBe(true);
    for (const k of ['connectInFlight', 'reconnectPending', 'nativeReconnectInFlight', 'recoveryInFlight'] as const) {
      expect(canResumeFromForeground({ ...IDLE, [k]: true }), k).toBe(false);
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   2. SERVİS — tek-uçuş kapısı gerçek yolda
═══════════════════════════════════════════════════════════════════════════ */

const ADDR = '11:22:33:44:55:66';

/** obdStatus dinleyicisini yakalar (native olay simülasyonu için). */
function captureStatusHandler(): { fire: (ev: Record<string, unknown>) => void } {
  const handlers: ((ev: Record<string, unknown>) => void)[] = [];
  vi.mocked(CarLauncher.addListener).mockImplementation(
    ((event: string, cb: (ev: Record<string, unknown>) => void) => {
      if (event === 'obdStatus') handlers.push(cb);
      return Promise.resolve({ remove: vi.fn() });
    }) as unknown as typeof CarLauncher.addListener,
  );
  return { fire: (ev) => handlers.forEach((h) => h(ev)) };
}

const tick = (ms = 0): Promise<void> => new Promise((r) => setTimeout(r, ms));

/* Sayaçlar OTURUM ömürlüdür (modül durumu testler arası sıfırlanmaz) — bu
   yüzden mutlak değer değil DELTA ölçülür; sayaçların doyumlu olması ürünün
   sözleşmesidir, testin onu ezmesi yanlış olurdu. */
function baseline(): { started0: number; busy0: number } {
  const lc = getObdReconnectLifecycle();
  return { started0: lc.connectAttemptsStarted, busy0: lc.connectBusyRejections };
}

describe('obdService — tek çalışan connect denemesi (single-flight)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    vi.mocked(CarLauncher.connectOBD).mockImplementation(() => new Promise(() => {}));
    vi.mocked(CarLauncher.disconnectOBD).mockResolvedValue(undefined);
    vi.mocked(CarLauncher.getObdBondState).mockResolvedValue({ bonded: true });
  });
  afterEach(() => { stopOBD(); });

  it('10 eşzamanlı kopma bildirimi → TEK gerçek connect denemesi', async () => {
    const { started0, busy0 } = baseline();
    const status = captureStatusHandler();
    startOBD(ADDR);
    await tick(20);

    const afterFirst = vi.mocked(CarLauncher.connectOBD).mock.calls.length;
    expect(afterFirst, 'ilk deneme başlamalı').toBe(1);

    // Native, ölü soketi kapatırken art arda kopma bildirebilir (sahadaki durum).
    for (let i = 0; i < 10; i++) status.fire({ reason: 'link_lost' });
    await tick(60);

    expect(vi.mocked(CarLauncher.connectOBD).mock.calls.length,
      'ikinci bir connectOBD gitti → çift otorite geri geldi').toBe(1);

    const lc = getObdReconnectLifecycle();
    expect(lc.connectInFlight).toBe(true);
    expect(lc.connectAttemptsStarted - started0).toBe(1);
    expect(lc.connectBusyRejections - busy0, 'kapı hiç devreye girmediyse test yanlış kurulmuş')
      .toBeGreaterThan(0);
  });

  it('foreground resume, uçuştaki denemeyi BÖLMEZ', async () => {
    const { started0 } = baseline();
    captureStatusHandler();
    startOBD(ADDR);
    await tick(20);
    expect(vi.mocked(CarLauncher.connectOBD).mock.calls.length).toBe(1);

    notifyAppForeground();          // debounce 600 ms
    await tick(900);

    expect(vi.mocked(CarLauncher.connectOBD).mock.calls.length,
      'foreground resume ikinci soket açtı — sahadaki fırtınanın tetiği').toBe(1);
    expect(getObdReconnectLifecycle().connectAttemptsStarted - started0).toBe(1);
  });

  it('önlenen istek "başarısız deneme" olarak SAYILMAZ', async () => {
    const { started0, busy0 } = baseline();
    const status = captureStatusHandler();
    startOBD(ADDR);
    await tick(20);
    for (let i = 0; i < 5; i++) status.fire({ reason: 'link_lost' });
    await tick(60);

    const lc = getObdReconnectLifecycle();
    // Kapıda reddedilen istekler sayaca girmemeli: hiç deneme YAPILMADI.
    expect(lc.connectAttemptsStarted - started0).toBe(1);
    expect(lc.connectBusyRejections - busy0).toBeGreaterThanOrEqual(5);
  });

  it('CONNECT_FAILED nedeni native SINIFIYLA taşınır (UNKNOWN’a düşmez)', async () => {
    const status = captureStatusHandler();
    startOBD(ADDR);
    await tick(20);

    // Native: mesaj null olsa bile sınıf ayrı alanda gelir.
    status.fire({ reason: 'connect_failed', failureClass: 'resource_busy' });
    await tick(10);

    expect(getObdReconnectLifecycle().lastNativeFailureClass).toBe('resource_busy');
  });

  it('tanınmayan native sınıf KABUL EDİLMEZ (kapalı küme)', async () => {
    const status = captureStatusHandler();
    startOBD(ADDR);
    await tick(20);

    status.fire({ reason: 'connect_failed', failureClass: 'uydurma_sinif' });
    await tick(10);

    expect(getObdReconnectLifecycle().lastNativeFailureClass).toBeNull();
  });
});
