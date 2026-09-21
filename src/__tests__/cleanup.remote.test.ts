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
  safeRemoveRaw: () => {},
}));

/* ── Imports (mock'lardan sonra) ── */
import {
  startRemoteCommands, stopRemoteCommands, acknowledgeCommand,
} from '../platform/remoteCommandService';
import { spyEventTarget } from './sim/leakHarness';
/* CONNECTIVITY F7-B: `remoteCommandService` artik tarayicinin `online` olayini
   DINLEMEZ — kanonik `ConnectivityAuthority`ye abone olur (ikinci ag gozlemcisi
   yok). Sizinti kilidi AYNEN gecerlidir; yalnizca SAYILAN abonelik degisti. */
import { getConnectivityTelemetry } from '../platform/connectivity/connectivityAuthority';

afterEach(() => { stopRemoteCommands(); vi.clearAllMocks(); });

describe('T3 — remoteCommandService cleanup', () => {
  it('start → kanonik bağlantı aboneliği eklenir; stop sonrası sökülür', async () => {
    const win = spyEventTarget(window);
    const before = getConnectivityTelemetry().subscriberCount;
    try {
      await startRemoteCommands();
      expect(getConnectivityTelemetry().subscriberCount - before).toBe(1);
      /* Tarayıcı `online` olayı ARTIK dinlenmiyor. */
      expect(win.active('online')).toBe(0);

      stopRemoteCommands();
      expect(getConnectivityTelemetry().subscriberCount - before).toBe(0);
      expect(win.active('online')).toBe(0);
    } finally {
      win.restore();
    }
  });

  it('stop idempotent ve listener kalıntısı bırakmaz', async () => {
    const win = spyEventTarget(window);
    const before = getConnectivityTelemetry().subscriberCount;
    try {
      await startRemoteCommands();
      stopRemoteCommands();
      stopRemoteCommands();
      expect(win.active('online')).toBe(0);
      expect(getConnectivityTelemetry().subscriberCount - before).toBe(0);
    } finally {
      win.restore();
    }
  });

  it('acknowledgeCommand bilinmeyen id ile güvenli (no-op cleanup)', () => {
    expect(() => acknowledgeCommand('nonexistent')).not.toThrow();
  });
});
