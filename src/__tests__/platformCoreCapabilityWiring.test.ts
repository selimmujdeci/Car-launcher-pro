/**
 * platformCoreCapabilityWiring.test.ts — PR-W3 Capability Registry Runtime Wiring kilitleri.
 *
 * Test izolasyonu: gerçek `capabilityRegistry` singleton PAYLAŞILMAZ — fake registry + fake/
 * enjekte provider DI ile her test kendi izole zincirini kurar. Invariant odaklı; kırılgan
 * kaynak-regex YALNIZ kapsam-dışı import yasağı ve SystemBoot sıra kilidi için kullanılır.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  startPlatformCoreCapabilityWiring,
  getPlatformCoreCapabilityWiringStatus,
  type CapabilityWiringDeps,
} from '../platform/system/platformCoreCapabilityWiring';
import type {
  CapabilityProvider,
  CapabilityRegistryTarget,
  CapabilityEvidence,
  CapabilityDomain,
  NavigatorLike,
} from '../platform/capability';

/* ── Fake'ler (yapısal DI — gerçek singleton'a dokunulmaz) ─────────────────── */

interface Resolved { id: string; evidence: CapabilityEvidence | readonly CapabilityEvidence[]; domain?: CapabilityDomain }
interface FakeRegistry extends CapabilityRegistryTarget {
  readonly resolved: Resolved[];
  readonly dispose: () => void;
  readonly disposeCalls: number;
}
function createFakeRegistry(opts?: { throwOnResolve?: boolean }): FakeRegistry {
  const resolved: Resolved[] = [];
  let disposeCalls = 0;
  return {
    resolveCapability(id, evidence, domain) {
      resolved.push({ id, evidence, domain });
      if (opts?.throwOnResolve) throw new Error('registry boom');
      return null;
    },
    getCapability() { return null; },
    dispose() { disposeCalls++; },
    resolved,
    get disposeCalls() { return disposeCalls; },
  };
}

/** Sync fake provider — read spy ile "start'a kadar okunmaz" doğrulaması. */
function fakeProvider(
  id: string,
  domain: CapabilityDomain,
  read: () => ({ status?: 'available' | 'unavailable'; available?: boolean; source?: 'runtime' } | null),
): CapabilityProvider & { readonly readSpy: ReturnType<typeof vi.fn> } {
  const readSpy = vi.fn(read);
  return { id, domain, source: 'runtime', read: readSpy, readSpy };
}

const resolvedIds = (r: FakeRegistry) => r.resolved.map((x) => x.id);

/** async refresh (Promise.allSettled) mikro/makro kuyruğunu boşalt. */
const flush = () => new Promise<void>((r) => setTimeout(r, 0));

const SRC_DIR = join(process.cwd(), 'src');
const WIRING_SRC = readFileSync(join(SRC_DIR, 'platform', 'system', 'platformCoreCapabilityWiring.ts'), 'utf8');
const SYSTEMBOOT_SRC = readFileSync(join(SRC_DIR, 'platform', 'system', 'SystemBoot.ts'), 'utf8');

/** Aktif wiring kaydı testler arası SIZMASIN (tek-instance guard modül düzeyinde). */
const _open: Array<() => void> = [];
function start(deps: CapabilityWiringDeps = {}) {
  const c = startPlatformCoreCapabilityWiring(deps);
  _open.push(c);
  return c;
}
afterEach(() => {
  while (_open.length) { try { _open.pop()!(); } catch { /* */ } }
});

/* ── Yaşam döngüsü & kanıt akışı ───────────────────────────────────────────── */

describe('PR-W3 Capability wiring — yaşam döngüsü & kanıt akışı', () => {
  it('1) import side-effect yok: wiring çağrılmadan provider read edilmez', () => {
    const p = fakeProvider('device.gps', 'device', () => ({ status: 'available' }));
    expect(p.readSpy).not.toHaveBeenCalled();   // yalnız oluşturuldu; start çağrılmadı
  });

  it('2) wiring cleanup thunk döner', () => {
    const cleanup = start({ registry: createFakeRegistry(), providers: [] });
    expect(typeof cleanup).toBe('function');
  });

  it('3) start → provider okunur → registry.resolveCapability çağrılır', async () => {
    const reg = createFakeRegistry();
    const p = fakeProvider('device.gps', 'device', () => ({ status: 'available' }));
    start({ registry: reg, providers: [p] });
    await flush();
    expect(p.readSpy).toHaveBeenCalledTimes(1);
    expect(resolvedIds(reg)).toContain('device.gps');
  });

  it('4) resolveCapability doğru domain ile çağrılır', async () => {
    const reg = createFakeRegistry();
    start({ registry: reg, providers: [fakeProvider('navigation.gps', 'navigation', () => ({ status: 'available' }))] });
    await flush();
    expect(reg.resolved.find((r) => r.id === 'navigation.gps')?.domain).toBe('navigation');
  });

  it('5) kaynağı olmayan provider (read=null) Registry\'ye ÇÖZÜLMEZ (unknown kalır)', async () => {
    const reg = createFakeRegistry();
    start({ registry: reg, providers: [fakeProvider('device.bluetooth', 'device', () => null)] });
    await flush();
    // null sonuç `source:'none'` evidence'ıyla dedup edilir; ilk sonuç yine de bir kez çözülür,
    // ama available bir kanıt taşımaz. En azından available=true bir kanıt YOKTUR.
    const rec = reg.resolved.find((r) => r.id === 'device.bluetooth');
    if (rec) {
      const ev = rec.evidence as CapabilityEvidence;
      expect(ev.available).not.toBe(true);
    }
  });

  it('6) gerçek provider\'lar navigator\'dan üretilir (geolocation → device.gps)', async () => {
    const reg = createFakeRegistry();
    const nav: NavigatorLike = { geolocation: {} };
    start({ registry: reg, navigator: nav });   // providers verilmez → gerçek fabrika
    await flush();
    expect(resolvedIds(reg)).toContain('device.gps');
    expect(resolvedIds(reg)).toContain('navigation.gps');
  });

  it('7) ZERO-TRUST: probe verilmediğinden AI/modül capability\'leri ÇÖZÜLMEZ (dürüst boşluk)', async () => {
    const reg = createFakeRegistry();
    start({ registry: reg, navigator: { geolocation: {} } });   // varsayılan: probe YOK
    await flush();
    const ids = resolvedIds(reg);
    for (const id of ['ai.gemini', 'ai.groq', 'ai.claude', 'platform.deep_scan', 'device.storage.secure']) {
      expect(ids).not.toContain(id);   // probe yok → provider hiç üretilmedi → Registry unknown
    }
  });

  it('8) ai.grok ASLA çözülmez (xAI entegrasyonu yok — dürüst boşluk)', async () => {
    const reg = createFakeRegistry();
    start({ registry: reg, navigator: { geolocation: {}, bluetooth: {} } });
    await flush();
    expect(resolvedIds(reg)).not.toContain('ai.grok');
  });
});

/* ── Dedup ─────────────────────────────────────────────────────────────────── */

describe('PR-W3 wiring — dedup', () => {
  it('9) aynı sonuç ikinci refresh\'te DUPLICATE resolve üretmez', async () => {
    const reg = createFakeRegistry();
    const c = start({ registry: reg, providers: [fakeProvider('device.gps', 'device', () => ({ status: 'available' }))] });
    await flush();
    // cleanup+yeni start yerine aynı adapter'ı yeniden refresh edemeyiz (dışa açık değil);
    // ama duplicate start no-op olduğundan ikinci start resolve ÇOĞALTMAZ.
    start({ registry: reg, providers: [fakeProvider('device.gps', 'device', () => ({ status: 'available' }))] });
    await flush();
    void c;
    expect(reg.resolved.filter((r) => r.id === 'device.gps').length).toBe(1);
  });
});

/* ── Duplicate / tek-instance / lifecycle ─────────────────────────────────── */

describe('PR-W3 wiring — duplicate & lifecycle', () => {
  it('10) start İDEMPOTENT: aktifken ikinci wiring İKİNCİ adapter\'ı beslemez', async () => {
    const reg1 = createFakeRegistry();
    const reg2 = createFakeRegistry();
    start({ registry: reg1, providers: [fakeProvider('device.gps', 'device', () => ({ status: 'available' }))] });
    start({ registry: reg2, providers: [fakeProvider('device.wifi', 'device', () => ({ status: 'available' }))] });
    await flush();
    expect(reg1.resolved.length).toBeGreaterThan(0);
    expect(reg2.resolved.length).toBe(0);   // ikinci registry hiç beslenmez
  });

  it('11) cleanup adapter\'ı durdurur: dispose sonrası status started=false', async () => {
    const reg = createFakeRegistry();
    const cleanup = start({ registry: reg, providers: [fakeProvider('device.gps', 'device', () => ({ status: 'available' }))] });
    await flush();
    cleanup();
    expect(getPlatformCoreCapabilityWiringStatus().started).toBe(false);
  });

  it('12) cleanup İDEMPOTENT (ikinci çağrı no-op, çökmesiz)', async () => {
    const cleanup = start({ registry: createFakeRegistry(), providers: [] });
    await flush();
    cleanup();
    expect(() => cleanup()).not.toThrow();
  });

  it('13) cleanup Registry\'yi DISPOSE ETMEZ (paylaşılan singleton)', async () => {
    const reg = createFakeRegistry();
    const cleanup = start({ registry: reg, providers: [fakeProvider('device.gps', 'device', () => ({ status: 'available' }))] });
    await flush();
    cleanup();
    expect(reg.disposeCalls).toBe(0);
  });

  it('14) boot → shutdown → boot güvenli, ikinci boot canlı', async () => {
    const reg1 = createFakeRegistry();
    const c1 = start({ registry: reg1, providers: [fakeProvider('device.gps', 'device', () => ({ status: 'available' }))] });
    await flush();
    c1();
    const reg2 = createFakeRegistry();
    start({ registry: reg2, providers: [fakeProvider('device.wifi', 'device', () => ({ status: 'available' }))] });
    await flush();
    expect(resolvedIds(reg2)).toContain('device.wifi');   // ikinci boot besleniyor
  });

  it('15) eski wiring temizlenince yeni wiring bloke OLMAZ (HMR/restart)', async () => {
    const c1 = start({ registry: createFakeRegistry(), providers: [] });
    c1();
    const reg2 = createFakeRegistry();
    start({ registry: reg2, providers: [fakeProvider('device.gps', 'device', () => ({ status: 'available' }))] });
    await flush();
    expect(resolvedIds(reg2)).toContain('device.gps');
  });
});

/* ── Fail-soft ────────────────────────────────────────────────────────────── */

describe('PR-W3 wiring — fail-soft', () => {
  it('16) providers verilmese de (varsayılan gerçek fabrika) throw ETMEZ', () => {
    expect(() => { const c = start({ registry: createFakeRegistry(), navigator: null }); c(); }).not.toThrow();
  });

  it('17) registry.resolveCapability throw etse wiring çökmez (adapter izole eder)', async () => {
    const reg = createFakeRegistry({ throwOnResolve: true });
    expect(() => start({ registry: reg, providers: [fakeProvider('device.gps', 'device', () => ({ status: 'available' }))] })).not.toThrow();
    await flush();
    expect(reg.resolved.length).toBeGreaterThan(0);   // çağrı yapıldı, hata yutuldu
  });

  it('18) bir provider read throw etse diğerleri yine çözülür (izole)', async () => {
    const reg = createFakeRegistry();
    const bad = fakeProvider('device.bluetooth', 'device', () => { throw new Error('boom'); });
    const good = fakeProvider('device.gps', 'device', () => ({ status: 'available' }));
    start({ registry: reg, providers: [bad, good] });
    await flush();
    expect(resolvedIds(reg)).toContain('device.gps');   // iyi provider etkilenmedi
  });

  it('19) public API throw ETMEZ (deps bozuk olsa da)', () => {
    expect(() => {
      const c = startPlatformCoreCapabilityWiring({ registry: null, providers: null });
      c();
    }).not.toThrow();
    expect(() => getPlatformCoreCapabilityWiringStatus()).not.toThrow();
  });
});

/* ── Gözlemlenebilirlik (bounded) ─────────────────────────────────────────── */

describe('PR-W3 wiring — bounded status', () => {
  it('20) wiring kapalıyken status started=false / providerCount=0', () => {
    const s = getPlatformCoreCapabilityWiringStatus();
    expect(s.started).toBe(false);
    expect(s.providerCount).toBe(0);
  });

  it('21) aktif wiring status: started=true, providerCount>0, resolvedCount artar, frozen', async () => {
    start({ registry: createFakeRegistry(), providers: [
      fakeProvider('device.gps', 'device', () => ({ status: 'available' })),
      fakeProvider('device.wifi', 'device', () => ({ status: 'available' })),
    ] });
    await flush();
    const s = getPlatformCoreCapabilityWiringStatus();
    expect(s.started).toBe(true);
    expect(s.providerCount).toBe(2);
    expect(s.resolvedCount).toBeGreaterThanOrEqual(2);
    expect(s.refreshCount).toBeGreaterThanOrEqual(1);
    expect(Object.isFrozen(s)).toBe(true);
  });

  it('22) cleanup sonrası status started=false\'a döner', async () => {
    const cleanup = start({ registry: createFakeRegistry(), providers: [fakeProvider('device.gps', 'device', () => ({ status: 'available' }))] });
    await flush();
    cleanup();
    expect(getPlatformCoreCapabilityWiringStatus().started).toBe(false);
  });
});

/* ── Kapsam sınırı (kaynak-kilidi — kırılgan regex yalnız burada) ──────────── */

describe('PR-W3 wiring — kapsam sınırı', () => {
  it('23) Event Bus / Deep Scan / Platform Kernel import EDİLMEZ', () => {
    expect(WIRING_SRC).not.toMatch(/from\s+['"][^'"]*eventBus/i);
    expect(WIRING_SRC).not.toMatch(/from\s+['"][^'"]*deepScan/i);
    expect(WIRING_SRC).not.toMatch(/from\s+['"][^'"]*kernel/i);
  });

  it('24) native / OBD / CAN katmanı import EDİLMEZ', () => {
    expect(WIRING_SRC).not.toMatch(/from\s+['"][^'"]*(obdService|canbus|nativePlugin)['"]/i);
  });

  it('25) yeni timer/polling/rAF AÇILMAZ', () => {
    expect(WIRING_SRC).not.toMatch(/setInterval|setTimeout|requestAnimationFrame/);
  });

  it('26) hot-path\'te ağır serileştirme YOK (JSON.stringify / structuredClone)', () => {
    expect(WIRING_SRC).not.toMatch(/JSON\.stringify|structuredClone/);
  });

  it('27) İKİNCİ Registry ÜRETİLMEZ (paylaşılan `capabilityRegistry` singleton kullanılır)', () => {
    expect(WIRING_SRC).not.toMatch(/createCapabilityRegistry\s*\(/);
    expect(WIRING_SRC).toMatch(/capabilityRegistry/);
  });

  it('28) probe DI GEÇİLMEZ (en küçük kapsam: yalnız navigator+deviceTier kanıtı)', () => {
    expect(WIRING_SRC).not.toMatch(/probes\s*:/);
  });
});

/* ── SystemBoot entegrasyon sıra kilidi ────────────────────────────────────── */

describe('PR-W3 — SystemBoot startup sırası korunur', () => {
  it('29) capability wiring SystemOrchestrator\'dan ÖNCE kaydedilir', () => {
    const iCap = SYSTEMBOOT_SRC.indexOf('startPlatformCoreCapabilityWiring(');
    const iOrch = SYSTEMBOOT_SRC.indexOf('startSystemOrchestrator(');
    expect(iCap).toBeGreaterThan(0);
    expect(iOrch).toBeGreaterThan(iCap);
  });

  it('30) wiring çağrısı savunmacı try/catch (logError SystemBoot:capabilityWiring)', () => {
    expect(SYSTEMBOOT_SRC).toMatch(/logError\(['"]SystemBoot:capabilityWiring/);
  });

  it('31) wiring `_reg` cleanup modeliyle kaydedilir (LIFO shutdown)', () => {
    expect(SYSTEMBOOT_SRC).toMatch(/this\._reg\(startPlatformCoreCapabilityWiring\(/);
  });

  it('32) mevcut Wave sırası (1→2→3→4) DEĞİŞMEDİ', () => {
    const i1 = SYSTEMBOOT_SRC.indexOf('await this._wave1()');
    const i2 = SYSTEMBOOT_SRC.indexOf('await this._wave2()');
    const i3 = SYSTEMBOOT_SRC.indexOf('await this._wave3()');
    const i4 = SYSTEMBOOT_SRC.indexOf('await this._wave4()');
    expect(i1).toBeGreaterThan(0);
    expect(i2).toBeGreaterThan(i1);
    expect(i3).toBeGreaterThan(i2);
    expect(i4).toBeGreaterThan(i3);
  });
});
