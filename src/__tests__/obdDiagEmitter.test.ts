/**
 * obdDiagEmitter.test.ts — Remote Log v1 / Commit 3
 *
 * Emitter GERÇEK remoteLogService ile koşar (yalnız pushVehicleEvent
 * mock) → tel-üstü payload sanitize SONRASI doğrulanır:
 *  - phase/transport/protocol/attempts/elapsedMs/source/vehicleType/
 *    lastSeenMs/errorCode alanları allowlist'ten geçiyor
 *  - sensitive alanlar (MAC/cihaz adı/VIN/konum) yapısal olarak yok
 *  - duplicate suppression: aynı phase+errorCode 60sn penceresinde 1 kez
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const M = vi.hoisted(() => ({
  pushed: [] as Array<{ type: string; payload: Record<string, unknown> }>,
}));

vi.mock('../platform/vehicleIdentityService', () => ({
  pushVehicleEvent: vi.fn(async (type: string, payload: Record<string, unknown>) => {
    M.pushed.push({ type, payload });
  }),
}));

vi.mock('../platform/obdService', () => ({
  getOBDStatusSnapshot: vi.fn(),
}));

vi.mock('../platform/system/SystemHealthMonitor', () => ({
  healthMonitor: {
    getGlobalHealthSnapshot: () => ({
      appVersion: '2.4.0', overallHealth: 'healthy', services: [],
    }),
  },
}));

import {
  emitObdDiag,
  SUPPRESS_WINDOW_MS,
  _resetObdDiagEmitterForTest,
} from '../platform/obdDiagEmitter';
import { _resetRemoteLogServiceForTest } from '../platform/remoteLogService';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', 'Date', 'performance'] });
  _resetObdDiagEmitterForTest();
  _resetRemoteLogServiceForTest();
  M.pushed = [];
});

afterEach(() => {
  vi.useRealTimers();
});

const FULL_DETAIL = {
  transport: 'ble+classic', protocol: 'auto', attempts: 3, elapsedMs: 4500.7,
  source: 'none', vehicleType: 'ice', lastSeenMs: 0,
  msg: 'Her iki transport ile bağlantı başarısız',
};

describe('payload şekli — sanitize SONRASI tel-üstü alanlar', () => {
  it('tüm istenen alanlar obd_diag payload\'ında (allowlist geçişi)', async () => {
    expect(emitObdDiag('connect', 'OBD_CONNECT_TIMEOUT', FULL_DETAIL)).toBe(true);
    await vi.runAllTimersAsync();

    expect(M.pushed).toHaveLength(1);
    const { type, payload } = M.pushed[0]!;
    expect(type).toBe('obd_diag');
    expect(payload).toMatchObject({
      ctx:         'OBD',
      phase:       'connect',
      errorCode:   'OBD_CONNECT_TIMEOUT',
      transport:   'ble+classic',
      protocol:    'auto',
      attempts:    3,
      elapsedMs:   4501,          // Math.round
      source:      'none',
      vehicleType: 'ice',
      lastSeenMs:  0,
      appVersion:  '2.4.0',
    });
    expect(typeof payload.bootId).toBe('string');
  });

  it('sensitive alanlar yapısal olarak yok; msg\'deki MAC/VIN maskelenir', async () => {
    // Emitter'ın tip arayüzü mac/deviceName/vin kabul etmez; msg içine
    // sızsa bile remoteLogService regex maskesi yakalar (ikinci katman).
    emitObdDiag('connect', 'OBD_CONNECT_FAIL', {
      ...FULL_DETAIL,
      msg: 'cihaz AA:BB:CC:DD:EE:FF vin WVWZZZ1JZXW000001 konum 41.00821, 28.97842',
    });
    await vi.runAllTimersAsync();

    const payload = M.pushed[0]!.payload;
    const flat = JSON.stringify(payload);
    expect(flat).not.toContain('AA:BB:CC:DD:EE:FF');
    expect(flat).not.toContain('WVWZZZ1JZXW000001');
    expect(flat).not.toContain('41.00821');
    expect(payload).not.toHaveProperty('mac');
    expect(payload).not.toHaveProperty('deviceName');
    expect(payload).not.toHaveProperty('address');
    expect(payload).not.toHaveProperty('lat');
    expect(payload).not.toHaveProperty('lng');
  });

  it('opsiyonel alanlar verilmediğinde payload\'da hiç yer almaz', async () => {
    emitObdDiag('scan', 'OBD_NO_DEVICE', { msg: 'adaptör yok' });
    await vi.runAllTimersAsync();

    const payload = M.pushed[0]!.payload;
    expect(payload.phase).toBe('scan');
    expect(payload).not.toHaveProperty('transport');
    expect(payload).not.toHaveProperty('protocol');
    expect(payload).not.toHaveProperty('attempts');
    expect(payload).not.toHaveProperty('elapsedMs');
  });
});

describe('duplicate suppression — aynı phase+errorCode penceresi', () => {
  it('pencere içinde 2. emit bastırılır; pencere dolunca tekrar gider', async () => {
    expect(emitObdDiag('stale_data', 'OBD_STALE_DATA', FULL_DETAIL)).toBe(true);
    expect(emitObdDiag('stale_data', 'OBD_STALE_DATA', FULL_DETAIL)).toBe(false);
    expect(emitObdDiag('stale_data', 'OBD_STALE_DATA', FULL_DETAIL)).toBe(false);
    await vi.runAllTimersAsync();
    expect(M.pushed).toHaveLength(1);

    vi.advanceTimersByTime(SUPPRESS_WINDOW_MS + 1);
    expect(emitObdDiag('stale_data', 'OBD_STALE_DATA', FULL_DETAIL)).toBe(true);
    await vi.runAllTimersAsync();
    expect(M.pushed).toHaveLength(2);
  });

  it('farklı errorCode veya farklı phase bastırılmaz', async () => {
    emitObdDiag('connect', 'OBD_CONNECT_TIMEOUT', FULL_DETAIL);
    emitObdDiag('connect', 'OBD_CONNECT_FAIL',    FULL_DETAIL); // farklı kod
    emitObdDiag('data_gate', 'OBD_DATA_GATE_TIMEOUT', FULL_DETAIL); // farklı faz
    await vi.runAllTimersAsync();
    expect(M.pushed).toHaveLength(3);
  });
});
