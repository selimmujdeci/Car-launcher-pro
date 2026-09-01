import { beforeEach, describe, expect, it, vi } from 'vitest';

const isNativePlatform = vi.fn(() => false);
const addListener = vi.fn();
const consumePendingLocation = vi.fn();

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform },
}));

vi.mock('../platform/nativePlugin', () => {
  return { CarLauncher: { addListener, consumePendingLocation } };
});

describe('incoming location bridge platform gate', () => {
  beforeEach(() => {
    vi.resetModules();
    isNativePlatform.mockReturnValue(false);
    addListener.mockClear();
    consumePendingLocation.mockClear();
  });

  it('does not materialize the Android plugin on web', async () => {
    const bridge = await import('../platform/navigation/incomingLocationBridge');

    const cleanup = bridge.startIncomingLocationBridge();
    await Promise.resolve();

    expect(addListener).not.toHaveBeenCalled();
    expect(consumePendingLocation).not.toHaveBeenCalled();
    expect(bridge.getIncomingLocationSnapshot().started).toBe(false);
    cleanup();
  });
});
