/**
 * useDriveModeDetection — otomatik harita sürüş görünümü.
 * Kusur 1: efekt temizliği her hız güncellemesinde zamanlayıcıyı siliyordu →
 *          1 Hz GPS ile 3 sn aktivasyon HİÇ tetiklenmiyordu.
 * Kusur 2: bilinmeyen hız 0 sayılıp 2 sn sonra `false` yazılıyordu (navigasyonda bile).
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => Object.defineProperty(navigator, 'userAgent', { value: 'Vitest', configurable: true }));

const source = vi.hoisted(() => ({
  speed: null as number | null,
  guidance: false,
  setDrivingMode: vi.fn(),
}));
vi.mock('../hooks/useDisplaySpeed', () => ({ useDisplaySpeed: () => source.speed }));
vi.mock('../platform/mapService', () => ({ setDrivingMode: source.setDrivingMode }));
vi.mock('../platform/navigationService', () => ({ getNavigationState: () => ({ isGuidanceActive: source.guidance }) }));

import {
  useDriveModeDetection, DRIVE_MODE_ACTIVATE_MS, DRIVE_MODE_DEACTIVATE_MS,
} from '../hooks/useDriveModeDetection';
import type { AppSettings } from '../store/useStore';

let root: Root;
let container: HTMLDivElement;
let enabled = true;

function Host() {
  useDriveModeDetection({ settings: { smartContextEnabled: enabled } as AppSettings });
  return null;
}
const setSpeed = (v: number | null) => { source.speed = v; act(() => root.render(<Host />)); };

beforeEach(() => {
  vi.useFakeTimers();
  source.speed = null; source.guidance = false; source.setDrivingMode.mockClear();
  enabled = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  act(() => root.render(<Host />));
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
  delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
});

describe('useDriveModeDetection', () => {
  it('1 Hz hız güncellemelerinde bile 3 sn sonra sürüş görünümü açılır', () => {
    for (let i = 0; i < 4; i++) {
      setSpeed(40 + i);
      act(() => { vi.advanceTimersByTime(1000); });
    }
    expect(source.setDrivingMode).toHaveBeenCalledWith(true);
    expect(source.setDrivingMode).toHaveBeenCalledTimes(1);
  });

  it('bilinmeyen hız hiçbir şey yazmaz', () => {
    setSpeed(null);
    act(() => { vi.advanceTimersByTime(DRIVE_MODE_DEACTIVATE_MS * 2); });
    expect(source.setDrivingMode).not.toHaveBeenCalled();
  });

  it('kırmızı ışıkta kısa duruş sürüş görünümünü kapatmaz; uzun duruş kapatır', () => {
    setSpeed(50);
    act(() => { vi.advanceTimersByTime(DRIVE_MODE_ACTIVATE_MS); });
    source.setDrivingMode.mockClear();
    setSpeed(0);
    act(() => { vi.advanceTimersByTime(10_000); });
    setSpeed(30);
    act(() => { vi.advanceTimersByTime(1000); });
    expect(source.setDrivingMode).not.toHaveBeenCalledWith(false);
    setSpeed(0);
    act(() => { vi.advanceTimersByTime(DRIVE_MODE_DEACTIVATE_MS); });
    expect(source.setDrivingMode).toHaveBeenCalledWith(false);
  });

  it('rehberlik sürerken duruş sürüş görünümünü kapatmaz', () => {
    source.guidance = true;
    setSpeed(0);
    act(() => { vi.advanceTimersByTime(DRIVE_MODE_DEACTIVATE_MS * 2); });
    expect(source.setDrivingMode).not.toHaveBeenCalledWith(false);
  });

  it('Smart Engine kapalıysa hiçbir şey yazmaz', () => {
    enabled = false;
    setSpeed(80);
    act(() => { vi.advanceTimersByTime(DRIVE_MODE_ACTIVATE_MS * 2); });
    expect(source.setDrivingMode).not.toHaveBeenCalled();
  });
});
