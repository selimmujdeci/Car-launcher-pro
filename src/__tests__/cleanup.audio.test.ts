/**
 * cleanup.audio.test.ts — T3: audioService kaynak temizliği.
 *
 * destroy() → speed aboneliği iptal + tüm AudioNode disconnect + AudioContext close.
 * jsdom'da Web Audio yok → leakHarness.makeMockAudioContext kullanılır.
 * Kararsızlık riski (T7 Plan B): mock yeterli olmazsa manuel checklist'e taşınır.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { makeMockAudioContext, type MockAudioContextHandle } from './sim/leakHarness';

/* ── Store/persist mock'ları ── */
vi.mock('../platform/cameraService', () => ({
  openRearCamera:  vi.fn().mockResolvedValue(undefined),
  closeRearCamera: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../utils/safeStorage', () => ({
  safeStorage:  { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  safeFlushKey: () => {},
  safeGetRaw:   () => null,
  safeSetRaw:   () => {},
}));
vi.mock('@capacitor/core', () => ({
  Capacitor:      { isNativePlatform: () => false, getPlatform: () => 'web' },
  registerPlugin: () => ({}),
}));

import { initAudio, destroy, connectSource, getAudioContext } from '../platform/audioService';

let acHandle: MockAudioContextHandle;

beforeEach(() => {
  acHandle = makeMockAudioContext();
  (globalThis as unknown as { AudioContext: unknown }).AudioContext = acHandle.AudioContextClass;
});

afterEach(() => {
  try { destroy(); } catch { /* zaten kapalı */ }
  delete (globalThis as unknown as { AudioContext?: unknown }).AudioContext;
  vi.clearAllMocks();
});

describe('T3 — audioService cleanup', () => {
  it('initAudio AudioContext üretir', () => {
    const ctx = initAudio();
    expect(ctx).not.toBeNull();
    expect(acHandle.instances.length).toBe(1);
    expect(getAudioContext()).not.toBeNull();
  });

  it('destroy → AudioContext close + node disconnect çalışır', () => {
    initAudio();
    expect(acHandle.instances[0].state).toBe('running');

    destroy();

    expect(acHandle.instances[0].closeCount).toBeGreaterThanOrEqual(1);
    expect(acHandle.instances[0].state).toBe('closed');
    expect(acHandle.instances[0].nodeDisconnects()).toBeGreaterThan(0); // zincir çözüldü
    expect(getAudioContext()).toBeNull();
  });

  it('connectSource cleanup thunk döner ve hata fırlatmaz', () => {
    initAudio();
    const ctx = getAudioContext();
    expect(ctx).not.toBeNull();
    const source = ctx!.createGain();
    const cleanup = connectSource(source);
    expect(typeof cleanup).toBe('function');
    expect(() => cleanup()).not.toThrow();
  });

  it('destroy idempotent (çift çağrı güvenli)', () => {
    initAudio();
    destroy();
    expect(() => destroy()).not.toThrow();
  });
});
