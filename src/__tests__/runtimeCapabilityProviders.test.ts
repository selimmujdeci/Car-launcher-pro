/**
 * runtimeCapabilityProviders.test.ts — İlk gerçek Capability provider kaynakları testleri.
 *
 * Kapsam (12–45): GPS/mikrofon/bluetooth/wifi/cellular browser-API presence & type;
 * secure storage authoritative; deep_scan/vehicle_learning/assistant_context/ota runtime;
 * offline commands/conversation; gemini/groq/claude configured; grok yok; local model yok;
 * safety kernel; offline map/routing; push/cloud commands; factory bounded; fail-soft;
 * privacy; immutability; input mutate yok; low-tier ağır provider yok; timer/SystemBoot/
 * EventBus wiring yok; import yan etkisiz.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  createRuntimeCapabilityProviders,
  MAX_RUNTIME_CAPABILITY_PROVIDERS,
  type RuntimeCapabilityProvidersDeps,
  type NavigatorLike,
} from '../platform/capability/providers/runtimeCapabilityProviders';
import type { CapabilityProvider, CapabilityProviderResult } from '../platform/capability';
import providersSource from '../platform/capability/providers/runtimeCapabilityProviders.ts?raw';

/* ── Yardımcılar ─────────────────────────────────────────────────────── */

function build(deps: RuntimeCapabilityProvidersDeps = {}): Map<string, CapabilityProvider> {
  const list = createRuntimeCapabilityProviders(deps);
  const map = new Map<string, CapabilityProvider>();
  for (const p of list) map.set(p.id, p);
  return map;
}

async function read(p: CapabilityProvider | undefined): Promise<CapabilityProviderResult | null> {
  if (!p) return null;
  return await Promise.resolve(p.read());
}

const NAV_EMPTY: NavigatorLike = {};
const NAV_GPS: NavigatorLike = { geolocation: {} };

/* ══════════════════════════════════════════════════════════════════════
 * 12–13 · device.gps
 * ════════════════════════════════════════════════════════════════════ */

describe('device.gps / navigation.gps', () => {
  it('12) GPS API presence → degraded (düşük confidence, donanım doğrulanamaz)', async () => {
    const m = build({ env: { navigator: NAV_GPS } });
    const r = await read(m.get('device.gps'));
    expect(r?.status).toBe('degraded');
    expect(r?.confidence).toBeLessThan(0.6);
    expect(r?.available).not.toBe(true);
    // navigation.gps device.gps'e bağımlı — aynı kanıt.
    expect((await read(m.get('navigation.gps')))?.status).toBe('degraded');
  });

  it('13) GPS API yok → unknown (read null)', async () => {
    const m = build({ env: { navigator: NAV_EMPTY } });
    expect(await read(m.get('device.gps'))).toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════════
 * 14–15 · device.microphone (permission)
 * ════════════════════════════════════════════════════════════════════ */

describe('device.microphone', () => {
  it('14) permission unknown → degraded (available değil)', async () => {
    const nav: NavigatorLike = { mediaDevices: { getUserMedia: () => {} } };
    const r = await read(build({ env: { navigator: nav } }).get('device.microphone'));
    expect(r?.status).toBe('degraded');
    expect(r?.available).not.toBe(true);
  });

  it('15) permission denied → restricted/unavailable (available değil)', async () => {
    const nav: NavigatorLike = {
      mediaDevices: { getUserMedia: () => {} },
      permissions: { query: async () => ({ state: 'denied' }) },
    };
    const r = await read(build({ env: { navigator: nav } }).get('device.microphone'));
    expect(['restricted', 'unavailable']).toContain(r?.status);
    expect(r?.available).not.toBe(true);
  });

  it('15b) permission granted → available (orta confidence)', async () => {
    const nav: NavigatorLike = {
      mediaDevices: { getUserMedia: () => {} },
      permissions: { query: async () => ({ state: 'granted' }) },
    };
    const r = await read(build({ env: { navigator: nav } }).get('device.microphone'));
    expect(r?.status).toBe('available');
  });

  it('15c) mediaDevices API yok → unknown', async () => {
    const r = await read(build({ env: { navigator: NAV_EMPTY } }).get('device.microphone'));
    expect(r).toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════════
 * 16 · device.bluetooth
 * ════════════════════════════════════════════════════════════════════ */

describe('device.bluetooth', () => {
  it('16) Web Bluetooth API presence → degraded', async () => {
    const r = await read(build({ env: { navigator: { bluetooth: {} } } }).get('device.bluetooth'));
    expect(r?.status).toBe('degraded');
    expect(r?.available).not.toBe(true);
  });
  it('16b) Bluetooth API yok → unknown', async () => {
    expect(await read(build({ env: { navigator: NAV_EMPTY } }).get('device.bluetooth'))).toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════════
 * 17–18 · wifi / cellular (exact connection type)
 * ════════════════════════════════════════════════════════════════════ */

describe('device.wifi / device.cellular', () => {
  it('17) connection.type === wifi → available; başka tip → unknown', async () => {
    const wifi = await read(build({ env: { navigator: { connection: { type: 'wifi' } } } }).get('device.wifi'));
    expect(wifi?.status).toBe('available');
    expect(wifi?.available).toBe(true);
    const notWifi = await read(build({ env: { navigator: { connection: { type: 'cellular' } } } }).get('device.wifi'));
    expect(notWifi).toBeNull();
  });

  it('18) connection.type === cellular → available; başka tip → unknown', async () => {
    const cell = await read(build({ env: { navigator: { connection: { type: 'cellular' } } } }).get('device.cellular'));
    expect(cell?.status).toBe('available');
    const notCell = await read(build({ env: { navigator: { connection: { type: 'wifi' } } } }).get('device.cellular'));
    expect(notCell).toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════════
 * 19 · secure storage (authoritative)
 * ════════════════════════════════════════════════════════════════════ */

describe('secure storage', () => {
  it('19) native secure storage → available (authoritative, yüksek confidence)', async () => {
    const m = build({ probes: { secureStorage: () => ({ available: true, native: true }) } });
    const r = await read(m.get('device.storage.secure'));
    expect(r?.status).toBe('available');
    expect(r?.source).toBe('native');
    expect(r?.confidence).toBeGreaterThanOrEqual(0.9);
    // platform.secure_storage de aynı authoritative kanıtı yansıtır.
    expect((await read(m.get('platform.secure_storage')))?.status).toBe('available');
  });

  it('19b) non-native → degraded; unavailable → unavailable; probe yok → provider yok', async () => {
    const degraded = await read(build({ probes: { secureStorage: () => ({ available: true, native: false }) } }).get('device.storage.secure'));
    expect(degraded?.status).toBe('degraded');
    const unavail = await read(build({ probes: { secureStorage: () => ({ available: false }) } }).get('device.storage.secure'));
    expect(unavail?.status).toBe('unavailable');
    expect(build({}).has('device.storage.secure')).toBe(false); // probe yok → provider üretilmez
  });
});

/* ══════════════════════════════════════════════════════════════════════
 * 20–23 · platform modülleri (varlık ↔ runtime)
 * ════════════════════════════════════════════════════════════════════ */

describe('platform modülleri', () => {
  it('20) Deep Scan module exists but unwired → degraded/experimental', async () => {
    const r = await read(build({ probes: { deepScan: () => ({ moduleExists: true, runtimeReady: false }) } }).get('platform.deep_scan'));
    expect(r?.status).toBe('degraded');
    expect(r?.reason).toContain('unwired');
  });

  it('20b) Deep Scan runtimeReady → available; modül yok → unknown', async () => {
    expect((await read(build({ probes: { deepScan: () => ({ moduleExists: true, runtimeReady: true }) } }).get('platform.deep_scan')))?.status).toBe('available');
    expect(await read(build({ probes: { deepScan: () => ({ moduleExists: false }) } }).get('platform.deep_scan'))).toBeNull();
  });

  it('21) Vehicle Learning runtime availability', async () => {
    expect((await read(build({ probes: { vehicleLearning: () => ({ runtimeReady: true }) } }).get('platform.vehicle_learning')))?.status).toBe('available');
  });

  it('22) Assistant Context runtime availability', async () => {
    expect((await read(build({ probes: { assistantContext: () => ({ runtimeReady: true }) } }).get('platform.assistant_context')))?.status).toBe('available');
  });

  it('23) OTA runtime availability', async () => {
    expect((await read(build({ probes: { ota: () => ({ moduleExists: true, runtimeReady: false }) } }).get('platform.ota')))?.status).toBe('degraded');
    expect((await read(build({ probes: { ota: () => ({ runtimeReady: true }) } }).get('platform.ota')))?.status).toBe('available');
  });
});

/* ══════════════════════════════════════════════════════════════════════
 * 24–31 · AI
 * ════════════════════════════════════════════════════════════════════ */

describe('AI providers', () => {
  it('24) Offline commands runtime → available', async () => {
    expect((await read(build({ probes: { offlineCommands: () => ({ runtimeReady: true }) } }).get('ai.offline_commands')))?.status).toBe('available');
  });

  it('25) Offline conversation runtime', async () => {
    expect((await read(build({ probes: { offlineConversation: () => ({ moduleExists: true } ) } }).get('ai.offline_conversation')))?.status).toBe('degraded');
  });

  it('26-28) Gemini/Groq/Claude configured + usable → available; not configured → unavailable', async () => {
    const usable = { configured: true, usable: true };
    const m = build({ probes: { aiProvider: () => usable } });
    for (const id of ['ai.gemini', 'ai.groq', 'ai.claude']) {
      const r = await read(m.get(id));
      expect(r?.status).toBe('available');
      expect(r?.source).toBe('config');
    }
    const notConf = build({ probes: { aiProvider: () => ({ configured: false }) } });
    expect((await read(notConf.get('ai.gemini')))?.status).toBe('unavailable');
  });

  it('28b) ai.cloud — en az bir provider usable ise available', async () => {
    const m = build({ probes: { aiProvider: (id) => (id === 'groq' ? { configured: true, usable: true } : { configured: false }) } });
    expect((await read(m.get('ai.cloud')))?.status).toBe('available');
    const none = build({ probes: { aiProvider: () => ({ configured: false }) } });
    expect((await read(none.get('ai.cloud')))?.status).toBe('unavailable');
  });

  it('29) Grok integration yok → ai.grok provider ÜRETİLMEZ', () => {
    const m = build({ probes: { aiProvider: () => ({ configured: true, usable: true }) } });
    expect(m.has('ai.grok')).toBe(false);
  });

  it('30) Local model — high tier + probe modelLoaded=false → unavailable; non-high → provider yok', async () => {
    const high = build({ env: { deviceTier: 'high' }, probes: { localModel: () => ({ modelLoaded: false }) } });
    expect((await read(high.get('ai.local_model')))?.status).toBe('unavailable');
    // low/mid tier → ağır provider hiç oluşturulmaz.
    expect(build({ env: { deviceTier: 'low' }, probes: { localModel: () => ({ modelLoaded: true }) } }).has('ai.local_model')).toBe(false);
  });

  it('31) Safety Kernel runtime availability', async () => {
    expect((await read(build({ probes: { safetyKernel: () => ({ runtimeReady: true }) } }).get('ai.safety_kernel')))?.status).toBe('available');
  });
});

/* ══════════════════════════════════════════════════════════════════════
 * 32–35 · navigation kaynakları + remote
 * ════════════════════════════════════════════════════════════════════ */

describe('navigation / remote', () => {
  it('32) Offline map paketi yok → unavailable; var → available', async () => {
    expect((await read(build({ probes: { offlineMap: () => ({ present: false }) } }).get('navigation.offline_map')))?.status).toBe('unavailable');
    expect((await read(build({ probes: { offlineMap: () => ({ present: true }) } }).get('navigation.offline_map')))?.status).toBe('available');
  });

  it('33) Offline routing graph yok → unavailable; hazır → available; var ama hazır değil → degraded', async () => {
    expect((await read(build({ probes: { offlineRouting: () => ({ present: false }) } }).get('navigation.offline_routing')))?.status).toBe('unavailable');
    expect((await read(build({ probes: { offlineRouting: () => ({ present: true, ready: true }) } }).get('navigation.offline_routing')))?.status).toBe('available');
    expect((await read(build({ probes: { offlineRouting: () => ({ present: true, ready: false }) } }).get('navigation.offline_routing')))?.status).toBe('degraded');
  });

  it('34) Push availability', async () => {
    expect((await read(build({ probes: { pushNotifications: () => ({ runtimeReady: true }) } }).get('remote.push_notifications')))?.status).toBe('available');
  });

  it('35) Cloud command runtime', async () => {
    expect((await read(build({ probes: { cloudCommands: () => ({ moduleExists: true, runtimeReady: false }) } }).get('remote.cloud_commands')))?.status).toBe('degraded');
  });
});

/* ══════════════════════════════════════════════════════════════════════
 * 36–45 · sözleşme/hijyen
 * ════════════════════════════════════════════════════════════════════ */

describe('sözleşme ve hijyen', () => {
  it('36) provider factory bounded + duplicate id yok', () => {
    const list = createRuntimeCapabilityProviders({
      env: { navigator: NAV_GPS, deviceTier: 'high' },
      probes: {
        secureStorage: () => ({ available: true, native: true }),
        aiProvider: () => ({ configured: true, usable: true }),
        deepScan: () => ({ runtimeReady: true }), vehicleLearning: () => ({ runtimeReady: true }),
        assistantContext: () => ({ runtimeReady: true }), ota: () => ({ runtimeReady: true }),
        offlineCommands: () => ({ runtimeReady: true }), offlineConversation: () => ({ runtimeReady: true }),
        localModel: () => ({ modelLoaded: true }), safetyKernel: () => ({ runtimeReady: true }),
        offlineMap: () => ({ present: true }), offlineRouting: () => ({ present: true, ready: true }),
        pushNotifications: () => ({ runtimeReady: true }), cloudCommands: () => ({ runtimeReady: true }),
      },
    });
    expect(list.length).toBeLessThanOrEqual(MAX_RUNTIME_CAPABILITY_PROVIDERS);
    const ids = list.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length); // duplicate yok
  });

  it('37) provider exception fail-soft — probe throw → read null (throw etmez)', async () => {
    const m = build({ probes: { deepScan: () => { throw new Error('boom'); } } });
    const p = m.get('platform.deep_scan')!;
    let r: CapabilityProviderResult | null = { status: 'available' };
    await expect((async () => { r = await read(p); })()).resolves.not.toThrow();
    expect(r).toBeNull();
  });

  it('38) privacy — probe rogue alanları (VIN vb.) sonuca SIZMAZ', async () => {
    const rogue = { available: true, native: true, vin: '1HGCM82633A004352', apiKey: 'sk-secret-token-123456' } as unknown as { available: boolean; native: boolean };
    const r = await read(build({ probes: { secureStorage: () => rogue } }).get('device.storage.secure'));
    const json = JSON.stringify(r);
    expect(json).not.toContain('1HGCM82633A004352');
    expect(json).not.toContain('sk-secret-token');
  });

  it('39) immutability — sonuç dondurulmuş', async () => {
    const r = await read(build({ env: { navigator: NAV_GPS } }).get('device.gps'));
    expect(Object.isFrozen(r)).toBe(true);
  });

  it('40) input mutate edilmiyor — deps/probes değişmez', async () => {
    const deps: RuntimeCapabilityProvidersDeps = {
      env: { navigator: NAV_GPS, deviceTier: 'high' },
      probes: { secureStorage: () => ({ available: true, native: true }) },
    };
    const before = JSON.stringify({ env: { deviceTier: deps.env?.deviceTier } });
    const m = build(deps);
    await read(m.get('device.gps'));
    await read(m.get('device.storage.secure'));
    expect(JSON.stringify({ env: { deviceTier: deps.env?.deviceTier } })).toBe(before);
  });

  it('41) low-tier ağır provider yok — ai.local_model oluşturulmaz', () => {
    const m = build({ env: { deviceTier: 'low' }, probes: { localModel: () => ({ modelLoaded: true }) } });
    expect(m.has('ai.local_model')).toBe(false);
    const mid = build({ env: { deviceTier: 'mid' }, probes: { localModel: () => ({ modelLoaded: true }) } });
    expect(mid.has('ai.local_model')).toBe(false);
  });

  it('42) kaynak dosyada timer/polling YOK', () => {
    expect(providersSource).not.toMatch(/setInterval|setTimeout|requestAnimationFrame/);
  });

  it('43) SystemBoot wiring YOK', () => {
    expect(providersSource).not.toMatch(/from ['"].*SystemBoot/);
  });

  it('44) Event Bus wiring YOK', () => {
    expect(providersSource).not.toMatch(/from ['"].*[eE]ventBus/);
    // Registry'yi de import etmez (yalnız TYPE import) — value import yok.
    expect(providersSource).not.toMatch(/import\s+\{[^}]*createCapabilityRegistry/);
  });

  it('45) import yan etkisiz — fabrika probe/navigator OKUMAZ (yalnız read())', () => {
    let navRead = false;
    const nav: NavigatorLike = Object.defineProperty({}, 'geolocation', { get() { navRead = true; return {}; }, enumerable: true });
    const probe = vi.fn(() => ({ available: true, native: true }));
    createRuntimeCapabilityProviders({ env: { navigator: nav }, probes: { secureStorage: probe } });
    expect(navRead).toBe(false);
    expect(probe).not.toHaveBeenCalled();
  });
});
