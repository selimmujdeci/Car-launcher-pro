/**
 * Import döngüsü kırılırken dinamik import'a geçen iki fire-and-forget yolun
 * davranış kilidi (importCycleGuard):
 *  - geofence/vale ihlali → telemetryService.pushAlert (uzak alarm)
 *  - UI donması → SystemPanicHandler.capturePanicSnapshot
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const M = vi.hoisted(() => ({ pushAlert: vi.fn(), capturePanicSnapshot: vi.fn(async () => {}) }));

vi.mock('../platform/telemetryService', () => ({
  telemetryService: { pushAlert: M.pushAlert },
}));
vi.mock('../platform/system/SystemPanicHandler', () => ({
  capturePanicSnapshot: M.capturePanicSnapshot,
}));

import {
  checkGeofence, setValeMode, setValeSpeedLimit, _resetGeofenceStateForTest,
} from '../platform/geofenceService';
import { healthMonitor } from '../platform/system/SystemHealthMonitor';

describe('vale ihlali uzak alarmı', () => {
  beforeEach(async () => {
    try { localStorage.clear(); sessionStorage.clear(); } catch { /* jsdom */ }
    _resetGeofenceStateForTest();
    M.pushAlert.mockReset();
    await setValeMode(true);
    await setValeSpeedLimit(50);
  });

  it('hız sınırı aşılınca valet_alert telemetriye itilir', async () => {
    checkGeofence(41.0, 29.0, 95);
    await vi.waitFor(() => expect(M.pushAlert).toHaveBeenCalledTimes(1));
    expect(M.pushAlert).toHaveBeenCalledWith('valet_alert', expect.objectContaining({
      violation: 'speed_limit', speedKmh: 95, limitKmh: 50,
    }));
  });

  it('sınır altında alarm itilmez', async () => {
    checkGeofence(41.0, 29.0, 40);
    await new Promise((r) => setTimeout(r, 0));
    expect(M.pushAlert).not.toHaveBeenCalled();
  });
});

describe('UI donması panik yakalaması', () => {
  afterEach(() => {
    healthMonitor.stop();
    vi.useRealTimers();
  });

  it('eşik aşan donma panik anlık görüntüsünü tetikler', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] });
    M.capturePanicSnapshot.mockClear();
    healthMonitor.start();
    // Bir sonraki watchdog tick'i 60 sn "geç" ateşlemiş gibi: ana iş parçacığı dondu.
    const base = performance.now();
    const now = vi.spyOn(performance, 'now').mockReturnValue(base + 60_000);
    await vi.advanceTimersByTimeAsync(8_100);
    now.mockRestore();
    vi.useRealTimers();
    await vi.waitFor(() => expect(M.capturePanicSnapshot).toHaveBeenCalled());
    expect(M.capturePanicSnapshot.mock.calls[0]![0]).toMatch(/^ui_freeze:/);
  });
});
