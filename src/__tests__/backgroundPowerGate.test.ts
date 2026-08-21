/**
 * backgroundPowerGate — kararın GERÇEKTEN uygulandığını kilitler.
 *
 * Model doğru karar verse bile kapı onu servislere geçirmezse pil sızıntısı
 * sürer (saha ölçümü 2026-08-20). Bu testler wiring'i doğrular: doğru servis,
 * doğru sırada, gereksiz tekrar olmadan.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const applyGpsPowerMode      = vi.fn(() => Promise.resolve());
const pauseWakeWordForPower  = vi.fn();
const resumeWakeWordForPower = vi.fn();
let   wakeEnabled            = true;

vi.mock('../platform/gpsService', () => ({
  applyGpsPowerMode: (mode: string) => applyGpsPowerMode(mode),
}));

vi.mock('../platform/wakeWordService', () => ({
  getWakeWordState:       () => ({ enabled: wakeEnabled }),
  pauseWakeWordForPower:  () => pauseWakeWordForPower(),
  resumeWakeWordForPower: () => resumeWakeWordForPower(),
}));

import {
  reevaluateBackgroundPower,
  notifyNavigationActiveForPower,
  getBackgroundPowerSnapshot,
  _resetBackgroundPowerGateForTest,
  _setBackgroundPowerInputsForTest,
} from '../platform/power/backgroundPowerGate';

beforeEach(() => {
  _resetBackgroundPowerGateForTest();
  applyGpsPowerMode.mockClear();
  pauseWakeWordForPower.mockClear();
  resumeWakeWordForPower.mockClear();
  wakeEnabled = true;
});

describe('backgroundPowerGate — uygulama', () => {
  it('arka plan + pil → GPS kısılır ve mikrofon susturulur', () => {
    _setBackgroundPowerInputsForTest({ started: true, appActive: false, externalPower: false });
    reevaluateBackgroundPower();

    expect(applyGpsPowerMode).toHaveBeenCalledWith('low');
    expect(pauseWakeWordForPower).toHaveBeenCalledTimes(1);
    expect(resumeWakeWordForPower).not.toHaveBeenCalled();
  });

  it('harici güç varken (head unit) hiçbir şey kısılmaz', () => {
    _setBackgroundPowerInputsForTest({ started: true, appActive: false, externalPower: true });
    reevaluateBackgroundPower();

    expect(applyGpsPowerMode).toHaveBeenCalledWith('high');
    expect(pauseWakeWordForPower).not.toHaveBeenCalled();
  });

  it('öne dönünce tam güç geri gelir', () => {
    _setBackgroundPowerInputsForTest({ started: true, appActive: false, externalPower: false });
    reevaluateBackgroundPower();
    applyGpsPowerMode.mockClear();

    _setBackgroundPowerInputsForTest({ appActive: true });
    reevaluateBackgroundPower();

    expect(applyGpsPowerMode).toHaveBeenCalledWith('high');
    expect(resumeWakeWordForPower).toHaveBeenCalledTimes(1);
  });

  it('aynı karar tekrar uygulanmaz (donanım thrash yok)', () => {
    _setBackgroundPowerInputsForTest({ started: true, appActive: false, externalPower: false });
    reevaluateBackgroundPower();
    reevaluateBackgroundPower();
    reevaluateBackgroundPower();

    expect(applyGpsPowerMode).toHaveBeenCalledTimes(1);
    expect(pauseWakeWordForPower).toHaveBeenCalledTimes(1);
  });

  it('kapı kurulmadan hiçbir servise dokunulmaz', () => {
    _setBackgroundPowerInputsForTest({ started: false, appActive: false, externalPower: false });
    reevaluateBackgroundPower();

    expect(applyGpsPowerMode).not.toHaveBeenCalled();
    expect(pauseWakeWordForPower).not.toHaveBeenCalled();
  });
});

describe('backgroundPowerGate — navigasyon istisnası', () => {
  it('navigasyon başlayınca arka planda bile kısma kalkar', () => {
    _setBackgroundPowerInputsForTest({ started: true, appActive: false, externalPower: false });
    reevaluateBackgroundPower();
    expect(applyGpsPowerMode).toHaveBeenLastCalledWith('low');

    notifyNavigationActiveForPower(true);
    expect(applyGpsPowerMode).toHaveBeenLastCalledWith('high');
    expect(resumeWakeWordForPower).toHaveBeenCalled();
  });

  it('navigasyon bitince arka plandaysa kısma geri gelir', () => {
    _setBackgroundPowerInputsForTest({ started: true, appActive: false, externalPower: false });
    notifyNavigationActiveForPower(true);
    applyGpsPowerMode.mockClear();

    notifyNavigationActiveForPower(false);
    expect(applyGpsPowerMode).toHaveBeenCalledWith('low');
  });
});

describe('backgroundPowerGate — gözlemlenebilirlik', () => {
  it('snapshot ham girdileri ve son kararı verir (hüküm içermez)', () => {
    _setBackgroundPowerInputsForTest({ started: true, appActive: false, externalPower: false });
    reevaluateBackgroundPower();

    const snap = getBackgroundPowerSnapshot();
    expect(snap.started).toBe(true);
    expect(snap.inputs.appActive).toBe(false);
    expect(snap.lastApplied?.reason).toBe('background_battery');
  });

  it('wake ayarı kapalıyken karar mikrofonu açmaya çalışmaz', () => {
    wakeEnabled = false;
    _setBackgroundPowerInputsForTest({ started: true, appActive: true });
    reevaluateBackgroundPower();

    expect(resumeWakeWordForPower).not.toHaveBeenCalled();
    expect(getBackgroundPowerSnapshot().lastApplied?.mic).toBe('off');
  });
});
