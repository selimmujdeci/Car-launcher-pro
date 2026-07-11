/**
 * capabilityProviderAdapter.test.ts — Capability Provider Adapter Foundation testleri.
 *
 * Kapsam: provider yok · start/stop idempotent · Registry'ye aktarım · available/
 * unavailable/unknown/degraded/restricted · confidence clamp · source/quality · native
 * authoritative · config donanımı açmaz · UI/modül kanıt değil · stale · duplicate/değişen
 * update · provider throw/timeout/izolasyon · ignition/TPMS/grok/offline-map kaynaksız →
 * unknown · DeviceTier · immutability · privacy · dispose zero-leak · Registry dispose
 * edilmiyor · import yan etkisi · Event Bus/SystemBoot/persistence wiring yok.
 */

import { describe, it, expect } from 'vitest';
import {
  createCapabilityProviderAdapter,
  createCapabilityRegistry,
  DEFAULT_CAPABILITY_CATALOG,
  MAX_CAPABILITY_PROVIDERS,
  type CapabilityProvider,
  type CapabilityProviderResult,
  type CapabilityRegistryTarget,
  type CapabilityDomain,
} from '../platform/capability';
import adapterSource from '../platform/capability/capabilityProviderAdapter.ts?raw';

const NOW = 7_000_000;
const reg = (deps = {}) =>
  createCapabilityRegistry({ now: () => NOW, deviceTier: 'high', seedCatalog: DEFAULT_CAPABILITY_CATALOG, ...deps });

function prov(id: string, domain: CapabilityDomain, read: CapabilityProvider['read'], extra: Partial<CapabilityProvider> = {}): CapabilityProvider {
  return { id, domain, source: 'native', read, ...extra };
}
function adapter(registry: CapabilityRegistryTarget, providers: CapabilityProvider[], deps = {}) {
  return createCapabilityProviderAdapter({ registry, providers, now: () => NOW, ...deps });
}

function spyRegistry() {
  const calls: { id: string }[] = [];
  const target: CapabilityRegistryTarget = {
    resolveCapability: (id) => { calls.push({ id }); return null; },
    getCapability: () => null,
  };
  return { target, calls };
}

/* ══════════════════════════════════════════════════════════════════════════
 * 1–9 · Temel + status
 * ════════════════════════════════════════════════════════════════════════ */

describe('temel ve status', () => {
  it('1) provider yok — refresh no-op', async () => {
    const r = reg(); const a = adapter(r, []);
    await a.refresh();
    expect(a.getStatus().providerCount).toBe(0);
    expect(a.getStatus().resolvedCount).toBe(0);
  });

  it('2) start idempotent', () => {
    const a = adapter(reg(), [prov('device.wifi', 'device', () => ({ available: true }))]);
    a.start(); a.start();
    expect(a.getStatus().started).toBe(true);
    expect(a.getStatus().providerCount).toBe(1);
  });

  it('3) stop idempotent', () => {
    const a = adapter(reg(), []);
    a.start();
    expect(() => { a.stop(); a.stop(); }).not.toThrow();
  });

  it('4-5) available — provider sonucu Registry\'ye aktarılıyor', async () => {
    const r = reg();
    const a = adapter(r, [prov('device.wifi', 'device', () => ({ available: true, source: 'native', confidence: 0.95 }))]);
    await a.refresh();
    expect(r.getStatus('device.wifi')).toBe('available');
    expect(r.isAvailable('device.wifi')).toBe(true);
  });

  it('6) unavailable', async () => {
    const r = reg();
    await adapter(r, [prov('device.cellular', 'device', () => ({ available: false, source: 'native' }))]).refresh();
    expect(r.getStatus('device.cellular')).toBe('unavailable');
  });

  it('7) unknown — provider null sonuç', async () => {
    const r = reg();
    await adapter(r, [prov('device.wifi', 'device', () => null)]).refresh();
    expect(r.getStatus('device.wifi')).toBe('unknown');
  });

  it('8) degraded — düşük confidence/kalite', async () => {
    const r = reg();
    await adapter(r, [prov('device.gps', 'device', () => ({ available: true, source: 'native', confidence: 0.9, quality: 'low' }))]).refresh();
    expect(r.getStatus('device.gps')).toBe('degraded');
  });

  it('9) restricted — safety-critical writable + non-authoritative', async () => {
    const r = reg();
    await adapter(r, [prov('vehicle.coding', 'vehicle', () => ({ available: true, source: 'user', confidence: 0.9 }), { source: 'user', authoritative: false })]).refresh();
    expect(r.getStatus('vehicle.coding')).toBe('restricted');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 10–16 · Metadata / karar
 * ════════════════════════════════════════════════════════════════════════ */

describe('metadata ve karar', () => {
  it('10) confidence clamp', async () => {
    const r = reg();
    await adapter(r, [prov('device.wifi', 'device', () => ({ available: true, source: 'native', confidence: 5 }))]).refresh();
    expect(r.getConfidence('device.wifi')).toBe(1);
  });

  it('11) source korunuyor (can)', async () => {
    const r = reg();
    await adapter(r, [prov('vehicle.obd', 'vehicle', () => ({ available: true, source: 'can', confidence: 0.9 }))]).refresh();
    expect(r.getCapability('vehicle.obd')?.source).toBe('can');
  });

  it('12) native authoritative → available', async () => {
    const r = reg();
    await adapter(r, [prov('device.bluetooth', 'device', () => ({ available: true, source: 'native' }))]).refresh();
    expect(r.getStatus('device.bluetooth')).toBe('available');
  });

  it('13) config tek başına donanımı açmıyor → unknown', async () => {
    const r = reg();
    await adapter(r, [prov('device.camera.rear', 'device', () => ({ available: true, source: 'config', confidence: 0.9 }), { source: 'config' })]).refresh();
    expect(r.getStatus('device.camera.rear')).toBe('unknown');
  });

  it('14) UI/modül varlığı kanıt değil — null → unknown', async () => {
    const r = reg();
    await adapter(r, [prov('vehicle.live_pid', 'vehicle', () => null)]).refresh();
    expect(r.getStatus('vehicle.live_pid')).toBe('unknown');
  });

  it('15) stale sonuç available değil → unknown', async () => {
    const r = reg();
    await adapter(r, [prov('device.wifi', 'device', () => ({ available: true, source: 'native', observedAt: NOW - 70_000 }))]).refresh();
    expect(r.getStatus('device.wifi')).toBe('unknown');
  });

  it('16) çelişkili/değişen sonuç deterministik — son kanıt kazanır', async () => {
    const r = reg();
    let avail = true;
    const a = adapter(r, [prov('device.wifi', 'device', () => ({ available: avail, source: 'native' }))]);
    await a.refresh();
    expect(r.getStatus('device.wifi')).toBe('available');
    avail = false;
    await a.refresh();
    expect(r.getStatus('device.wifi')).toBe('unavailable');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 17–23 · Dedup / fail-soft
 * ════════════════════════════════════════════════════════════════════════ */

describe('dedup ve fail-soft', () => {
  it('17) aynı sonuç duplicate Registry update üretmiyor', async () => {
    const s = spyRegistry();
    const a = adapter(s.target, [prov('device.wifi', 'device', () => ({ available: true, source: 'native' }))]);
    await a.refresh(); await a.refresh(); await a.refresh();
    expect(s.calls.length).toBe(1); // yalnız ilk sonuç
  });

  it('18) değişen sonuç update üretir', async () => {
    const s = spyRegistry();
    let v = 1;
    const a = adapter(s.target, [prov('device.wifi', 'device', () => ({ available: true, source: 'native', confidence: v / 10 }))]);
    await a.refresh(); v = 2; await a.refresh();
    expect(s.calls.length).toBe(2);
  });

  it('19-20) provider throw fail-soft — diğerleri sürer', async () => {
    const r = reg();
    await adapter(r, [
      prov('device.wifi', 'device', () => { throw new Error('boom'); }),
      prov('device.bluetooth', 'device', () => ({ available: true, source: 'native' })),
    ]).refresh();
    expect(r.getStatus('device.wifi')).toBe('unknown');       // hata → güvenli unknown
    expect(r.getStatus('device.bluetooth')).toBe('available'); // izole, diğeri sürdü
  });

  it('21) Registry update hata izolasyonu', async () => {
    let good = 0;
    const target: CapabilityRegistryTarget = {
      resolveCapability: (id) => { if (id === 'device.wifi') throw new Error('reg boom'); good++; return null; },
      getCapability: () => null,
    };
    const a = adapter(target, [
      prov('device.wifi', 'device', () => ({ available: true, source: 'native' })),
      prov('device.bluetooth', 'device', () => ({ available: true, source: 'native' })),
    ]);
    await expect(a.refresh()).resolves.toBeUndefined();
    expect(good).toBe(1); // bluetooth çözüldü
  });

  it('22) bozuk provider sonucu → unknown', async () => {
    const r = reg();
    await adapter(r, [prov('device.wifi', 'device', () => 42 as unknown as CapabilityProviderResult)]).refresh();
    expect(r.getStatus('device.wifi')).toBe('unknown');
  });

  it('23) provider timeout fail-soft → unknown', async () => {
    const r = reg();
    const a = adapter(r, [prov('device.wifi', 'device', () => new Promise<CapabilityProviderResult>(() => { /* asla resolve olmaz */ }))], { timeoutMs: 15 });
    await a.refresh();
    expect(r.getStatus('device.wifi')).toBe('unknown');
    expect(a.getProviderResults()['device.wifi']?.reason).toBe('provider_timeout');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 24–30 · Kaynaksız capability + DeviceTier
 * ════════════════════════════════════════════════════════════════════════ */

describe('kaynaksız capability ve DeviceTier', () => {
  it('24) gerçek ignition yok → unknown', async () => {
    const r = reg();
    await adapter(r, [prov('device.wifi', 'device', () => ({ available: true, source: 'native' }))]).refresh();
    expect(r.getStatus('vehicle.ignition')).toBe('unknown'); // provider yok → unknown kalır
  });

  it('25) gerçek TPMS yok → unknown', async () => {
    const r = reg();
    await adapter(r, []).refresh();
    expect(r.getStatus('vehicle.tpms')).toBe('unknown');
  });

  it('26) Grok entegrasyonu yok → unavailable/unknown', async () => {
    const r = reg();
    await adapter(r, [prov('ai.grok', 'ai', () => null)]).refresh(); // gerçek entegrasyon yok
    expect(r.isAvailable('ai.grok')).toBe(false);
  });

  it('27) offline map paketi yok → unavailable', async () => {
    const r = reg();
    await adapter(r, [prov('navigation.offline_map', 'navigation', () => ({ available: false, source: 'runtime', reason: 'no_tile_pack' }))]).refresh();
    expect(r.getStatus('navigation.offline_map')).toBe('unavailable');
  });

  it('28-29) Mali-400 (low) — local model restricted (kanıt olsa bile)', async () => {
    const r = reg({ deviceTier: 'low' });
    await adapter(r, [prov('ai.local_model', 'ai', () => ({ available: true, source: 'native' }))]).refresh();
    expect(r.getStatus('ai.local_model')).toBe('restricted'); // tier engeli
  });

  it('30) high tier — kanıtsız capability AÇILMIYOR', async () => {
    const r = reg({ deviceTier: 'high' });
    await adapter(r, []).refresh(); // device.npu için provider yok
    expect(r.getStatus('device.npu')).toBe('unknown');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 31–40 · Bounded / immutability / yaşam döngüsü
 * ════════════════════════════════════════════════════════════════════════ */

describe('bounded, immutability, yaşam döngüsü', () => {
  it('31) provider sayısı bounded', () => {
    const many = Array.from({ length: MAX_CAPABILITY_PROVIDERS + 20 }, (_, i) => prov(`plugin.p${i}.x`, 'plugin', () => null));
    const a = adapter(reg(), many);
    expect(a.getStatus().providerCount).toBe(MAX_CAPABILITY_PROVIDERS);
  });

  it('32) duplicate provider (aynı id) engelleniyor', () => {
    const a = adapter(reg(), [
      prov('device.wifi', 'device', () => ({ available: true })),
      prov('device.wifi', 'device', () => ({ available: false })),
    ]);
    expect(a.getStatus().providerCount).toBe(1);
  });

  it('33) refreshProvider — tek provider', async () => {
    const r = reg();
    const a = adapter(r, [prov('device.wifi', 'device', () => ({ available: true, source: 'native' }))]);
    await a.refreshProvider('device.wifi');
    expect(r.getStatus('device.wifi')).toBe('available');
  });

  it('34-35) getProviderResults immutable (nested dahil)', async () => {
    const a = adapter(reg(), [prov('device.wifi', 'device', () => ({ available: true, source: 'native', details: { note: 'ok' } }))]);
    await a.refresh();
    const res = a.getProviderResults();
    expect(Object.isFrozen(res['device.wifi'])).toBe(true);
    expect(Object.isFrozen(res['device.wifi'].details)).toBe(true);
  });

  it('36) girdi provider sonucu mutate edilmiyor', async () => {
    const result = { available: true, source: 'native' as const, details: { a: '1' } };
    await adapter(reg(), [prov('device.wifi', 'device', () => result)]).refresh();
    expect(result.details).toEqual({ a: '1' });
  });

  it('37) privacy — VIN/koordinat sanitize', async () => {
    const r = reg();
    const a = adapter(r, [prov('vehicle.obd', 'vehicle', () => ({ available: true, source: 'can', provider: 'ecu 1HGCM82633A004352', details: { loc: '41.0082,28.9784' } }))]);
    await a.refresh();
    const serialized = JSON.stringify(a.getProviderResults()) + JSON.stringify(r.getCapability('vehicle.obd'));
    expect(serialized).not.toContain('1HGCM82633A004352');
    expect(serialized).not.toContain('41.0082,28.9784');
  });

  it('38) dispose zero-leak', async () => {
    const a = adapter(reg(), [prov('device.wifi', 'device', () => ({ available: true }))]);
    await a.refresh(); a.dispose();
    expect(a.isDisposed).toBe(true);
    expect(a.getProviderResults()).toEqual({});
  });

  it('39) dispose sonrası callback no-op', async () => {
    const s = spyRegistry();
    const a = adapter(s.target, [prov('device.wifi', 'device', () => ({ available: true, source: 'native' }))]);
    await a.refresh();
    const before = s.calls.length;
    a.dispose();
    await a.refresh(); // dispose sonrası
    expect(s.calls.length).toBe(before);
  });

  it('40) Registry adapter tarafından dispose EDİLMİYOR', async () => {
    const r = reg();
    const a = adapter(r, [prov('device.wifi', 'device', () => ({ available: true, source: 'native' }))]);
    await a.refresh(); a.dispose();
    expect(r.isDisposed).toBe(false);        // Registry çağıranındır
    expect(r.getStatus('device.wifi')).toBe('available'); // Registry hâlâ kullanılabilir
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 41–45 · Yalıtım
 * ════════════════════════════════════════════════════════════════════════ */

describe('yalıtım', () => {
  it('41) import yan etkisiz — steady-state timer/native YOK, yalnız type import', () => {
    // setInterval yok (steady-state polling yok); setTimeout yalnız opt-in timeout için (settle'da temizlenir).
    expect(/setInterval/.test(adapterSource)).toBe(false);
    // Yalnız TYPE import → değer importu yok (native/store/registry çekilmez, import yan etkisiz).
    expect(/^\s*import\s+type\s/m.test(adapterSource)).toBe(true);
    expect(/^\s*import\s+(?!type)[\w{]/m.test(adapterSource)).toBe(false);
  });

  it('42) SystemBoot wiring yok (import edilmiyor)', () => {
    expect(/from\s+['"][^'"]*SystemBoot['"]/.test(adapterSource)).toBe(false);
  });

  it('43) Event Bus wiring yok', () => {
    expect(/from\s+['"][^'"]*eventBus[^'"]*['"]/.test(adapterSource)).toBe(false);
  });

  it('44) persistence yok', () => {
    expect(/safeStorage|from\s+['"][^'"]*safeStorage/.test(adapterSource)).toBe(false);
  });

  it('45) BASIC_JS — değişmeyen sonuç yeniden Registry update üretmez', async () => {
    const s = spyRegistry();
    const a = adapter(s.target, [
      prov('device.wifi', 'device', () => ({ available: true, source: 'native' })),
      prov('device.gps', 'device', () => ({ available: true, source: 'native' })),
    ]);
    await a.refresh();
    const after = s.calls.length; // 2
    await a.refresh(); await a.refresh();
    expect(s.calls.length).toBe(after); // ek update yok (dedup)
  });
});
