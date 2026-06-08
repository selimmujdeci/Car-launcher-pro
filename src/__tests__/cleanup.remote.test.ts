/**
 * cleanup.remote.test.ts — T3: remoteCommandService kaynak temizliği.
 *
 * stopRemoteCommands() sonrası window 'online' listener'ı + realtime channel
 * kalmamalı. start() üç kapıyı (supabase/identity/apiKey) geçince listener ekler;
 * bu kapılar mock'lanır. Gerçek komut/Supabase davranışı değiştirilmez.
 *
 * Pending-ACK timer temizliği komut işleme hattını (private _awaitHardwareAck)
 * gerektirdiğinden manuel/e2e checklist'e bırakıldı — bkz. rapor.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

/* ── start() kapıları + ağır bağımlılıklar mock ── */
vi.mock('@capacitor/core', () => ({
  Capacitor:      { isNativePlatform: () => false, getPlatform: () => 'web' },
  registerPlugin: () => ({}),
}));
vi.mock('../platform/nativePlugin', () => ({ CarLauncher: {} }));
vi.mock('../platform/supabaseClient', () => ({
  getSupabaseClient: () => {
    const ch = { on: () => ch, subscribe: () => ch, unsubscribe: () => {} };
    return { channel: () => ch };
  },
}));
vi.mock('../platform/vehicleIdentityService', () => ({
  getVehicleIdentity:        async () => ({ vehicleId: 'v1' }),
  updateRemoteCommandStatus: vi.fn(),
  pushVehicleEvent:          vi.fn(),
}));
vi.mock('../platform/sensitiveKeyStore', () => ({
  sensitiveKeyStore: { get: async () => 'api-key-123' },
}));
vi.mock('../utils/safeStorage', () => ({
  safeStorage:  { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  safeFlushKey: () => {},
  safeGetRaw:   () => null,
  safeSetRaw:   () => {},
}));

/* ── Imports (mock'lardan sonra) ── */
import {
  startRemoteCommands, stopRemoteCommands, acknowledgeCommand,
} from '../platform/remoteCommandService';
import { spyEventTarget } from './sim/leakHarness';

afterEach(() => { stopRemoteCommands(); vi.clearAllMocks(); });

describe('T3 — remoteCommandService cleanup', () => {
  it('start → window online listener eklenir; stop sonrası kaldırılır', async () => {
    const win = spyEventTarget(window);
    try {
      await startRemoteCommands();
      expect(win.active('online')).toBe(1);

      stopRemoteCommands();
      expect(win.active('online')).toBe(0);
    } finally {
      win.restore();
    }
  });

  it('stop idempotent ve listener kalıntısı bırakmaz', async () => {
    const win = spyEventTarget(window);
    try {
      await startRemoteCommands();
      stopRemoteCommands();
      stopRemoteCommands();
      expect(win.active('online')).toBe(0);
    } finally {
      win.restore();
    }
  });

  it('acknowledgeCommand bilinmeyen id ile güvenli (no-op cleanup)', () => {
    expect(() => acknowledgeCommand('nonexistent')).not.toThrow();
  });
});
