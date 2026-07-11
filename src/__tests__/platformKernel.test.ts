/**
 * platformKernel.test.ts — Platform Kernel / Service Lifecycle Foundation testleri (50).
 *
 * Kapsam: register/duplicate/unregister · start/stop/dispose idempotent · init→start ·
 * dependency start/stop order · circular reddi · required/optional dep · dep-fail izolasyon ·
 * capability/DeviceTier gate · Mali-400 ağır servis gate · timeout · timer cleanup · exception
 * izolasyon · health · markDegraded · restart/circuit · listener · immutability · privacy ·
 * event publisher opsiyonel/fail-soft · unknown-service · partial-start · reset · bounded ·
 * import yan etkisiz · SystemBoot/auto-start wiring yok · BASIC_JS sürekli yük yok.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  createPlatformKernel,
  computeKernelBackoffMs,
  type PlatformService, type PlatformServiceDescriptor,
  type PlatformServiceHealth, type KernelCapabilitySource,
} from '../platform/kernel/platformKernel';
import kernelSource from '../platform/kernel/platformKernel.ts?raw';

/* ── Yardımcılar ─────────────────────────────────────────────────────── */

function desc(id: string, o: Partial<PlatformServiceDescriptor> = {}): PlatformServiceDescriptor {
  return { id, criticality: o.criticality ?? 'normal', startPolicy: o.startPolicy ?? 'eager', ...o };
}

interface RecOpts {
  order?: string[];
  failStart?: boolean;
  hangStart?: boolean;
  health?: PlatformServiceHealth | (() => PlatformServiceHealth | Promise<PlatformServiceHealth>);
  healthThrows?: boolean;
  onDispose?: () => void;
}
function recSvc(id: string, o: RecOpts = {}): PlatformService & { calls: string[] } {
  const calls: string[] = [];
  const svc: PlatformService & { calls: string[] } = {
    id, calls,
    init() { calls.push('init'); o.order?.push(`init:${id}`); },
    start() {
      calls.push('start'); o.order?.push(`start:${id}`);
      if (o.failStart) throw new Error('start_fail');
      if (o.hangStart) return new Promise<void>(() => { /* asla resolve etmez */ });
    },
    stop() { calls.push('stop'); o.order?.push(`stop:${id}`); },
    dispose() { calls.push('dispose'); o.onDispose?.(); },
  };
  if (o.health !== undefined || o.healthThrows) {
    svc.health = () => {
      if (o.healthThrows) throw new Error('health_boom');
      return typeof o.health === 'function' ? o.health() : (o.health ?? 'healthy');
    };
  }
  return svc;
}

function fakeCaps(map: Record<string, string>): KernelCapabilitySource {
  return {
    isAvailable: (id) => map[id] === 'available',
    getStatus: (id) => map[id] ?? 'unknown',
  };
}

/* ══════════════════════════════════════════════════════════════════════
 * 1–8 · Temel lifecycle
 * ════════════════════════════════════════════════════════════════════ */

describe('temel lifecycle', () => {
  it('1) boş kernel', () => {
    const k = createPlatformKernel();
    expect(k.serviceCount).toBe(0);
    expect(k.getKernelSnapshot().serviceCount).toBe(0);
    expect(k.getServiceStatus('x')).toBeNull();
  });

  it('2) servis register', () => {
    const k = createPlatformKernel();
    expect(k.registerService(desc('a'), recSvc('a'))).toBe(true);
    expect(k.hasService('a')).toBe(true);
    expect(k.getServiceStatus('a')!.state).toBe('registered');
  });

  it('3) duplicate register engelleniyor', () => {
    const k = createPlatformKernel();
    k.registerService(desc('a'), recSvc('a'));
    expect(k.registerService(desc('a'), recSvc('a'))).toBe(false);
    expect(k.serviceCount).toBe(1);
  });

  it('4) unregister', () => {
    const k = createPlatformKernel();
    k.registerService(desc('a'), recSvc('a'));
    expect(k.unregisterService('a')).toBe(true);
    expect(k.hasService('a')).toBe(false);
    expect(k.unregisterService('a')).toBe(false);
  });

  it('5) start service', async () => {
    const k = createPlatformKernel();
    k.registerService(desc('a'), recSvc('a'));
    expect(await k.startService('a')).toBe('running');
  });

  it('6) start idempotent', async () => {
    const k = createPlatformKernel();
    const s = recSvc('a'); k.registerService(desc('a'), s);
    await k.startService('a'); await k.startService('a');
    expect(s.calls.filter((c) => c === 'start').length).toBe(1);
  });

  it('7) stop idempotent', async () => {
    const k = createPlatformKernel();
    const s = recSvc('a'); k.registerService(desc('a'), s);
    await k.startService('a');
    await k.stopService('a'); await k.stopService('a');
    expect(k.getServiceStatus('a')!.state).toBe('stopped');
    expect(s.calls.filter((c) => c === 'stop').length).toBe(1);
  });

  it('8) dispose', () => {
    const k = createPlatformKernel();
    const s = recSvc('a'); k.registerService(desc('a'), s);
    k.dispose();
    expect(k.isDisposed).toBe(true);
    expect(s.calls).toContain('dispose');
  });

  it('9) init→start sırası', async () => {
    const order: string[] = [];
    const k = createPlatformKernel();
    k.registerService(desc('a'), recSvc('a', { order }));
    await k.startService('a');
    expect(order).toEqual(['init:a', 'start:a']);
  });
});

/* ══════════════════════════════════════════════════════════════════════
 * 10–16 · Bağımlılık
 * ════════════════════════════════════════════════════════════════════ */

describe('bağımlılık', () => {
  it('10) dependency start order (topolojik)', async () => {
    const order: string[] = [];
    const k = createPlatformKernel();
    k.registerService(desc('b', { dependencies: ['a'] }), recSvc('b', { order }));
    k.registerService(desc('a'), recSvc('a', { order }));
    await k.startAll();
    expect(order.indexOf('start:a')).toBeLessThan(order.indexOf('start:b'));
  });

  it('11) reverse stop order', async () => {
    const order: string[] = [];
    const k = createPlatformKernel();
    k.registerService(desc('a'), recSvc('a', { order }));
    k.registerService(desc('b', { dependencies: ['a'] }), recSvc('b', { order }));
    await k.startAll();
    await k.stopAll();
    expect(order.indexOf('stop:b')).toBeLessThan(order.indexOf('stop:a'));
  });

  it('12) circular dependency reddi', () => {
    const k = createPlatformKernel();
    expect(k.registerService(desc('a', { dependencies: ['b'] }), recSvc('a'))).toBe(true);
    expect(k.registerService(desc('b', { dependencies: ['a'] }), recSvc('b'))).toBe(false); // cycle → red
    expect(k.hasService('b')).toBe(false);
  });

  it('13) eksik required dependency → başlamaz', async () => {
    const k = createPlatformKernel();
    k.registerService(desc('a', { dependencies: ['missing'] }), recSvc('a'));
    await k.startService('a');
    expect(k.getServiceStatus('a')!.state).not.toBe('running');
    expect(k.getServiceStatus('a')!.dependencyState.missing).toBe('missing');
  });

  it('14) eksik optional dependency → degraded başlar', async () => {
    const k = createPlatformKernel();
    k.registerService(desc('a', { optionalDependencies: ['missing'] }), recSvc('a'));
    expect(await k.startService('a')).toBe('degraded');
    expect(k.getServiceStatus('a')!.degradedReasons.some((r) => r.includes('opt_dep_missing'))).toBe(true);
  });

  it('15) dependency fail dependent’i bloklar', async () => {
    const k = createPlatformKernel();
    k.registerService(desc('a'), recSvc('a', { failStart: true }));
    k.registerService(desc('b', { dependencies: ['a'] }), recSvc('b'));
    await k.startAll();
    expect(k.getServiceStatus('a')!.state).toBe('failed');
    expect(k.getServiceStatus('b')!.state).not.toBe('running');
  });

  it('16) bağımsız servis devam eder', async () => {
    const k = createPlatformKernel();
    k.registerService(desc('a'), recSvc('a', { failStart: true }));
    k.registerService(desc('c'), recSvc('c'));
    await k.startAll();
    expect(k.getServiceStatus('a')!.state).toBe('failed');
    expect(k.getServiceStatus('c')!.state).toBe('running');
  });
});

/* ══════════════════════════════════════════════════════════════════════
 * 17–21 · Capability / DeviceTier gate
 * ════════════════════════════════════════════════════════════════════ */

describe('capability / deviceTier gate', () => {
  it('17) capability unavailable → gate', async () => {
    const k = createPlatformKernel({ capabilities: fakeCaps({ 'device.gps': 'unavailable' }) });
    k.registerService(desc('a', { requiredCapabilities: ['device.gps'] }), recSvc('a'));
    await k.startService('a');
    expect(k.getServiceStatus('a')!.state).not.toBe('running');
    expect(k.getServiceStatus('a')!.capabilityState['device.gps']).toBe('unavailable');
  });

  it('18) capability unknown → gate', async () => {
    const k = createPlatformKernel({ capabilities: fakeCaps({}) });
    k.registerService(desc('a', { requiredCapabilities: ['device.gps'] }), recSvc('a'));
    await k.startService('a');
    expect(k.getServiceStatus('a')!.state).not.toBe('running');
  });

  it('19) degraded capability → degraded başlar', async () => {
    const k = createPlatformKernel({ capabilities: fakeCaps({ 'device.gps': 'degraded' }) });
    k.registerService(desc('a', { requiredCapabilities: ['device.gps'] }), recSvc('a'));
    expect(await k.startService('a')).toBe('degraded');
  });

  it('20) DeviceTier minimum gate', async () => {
    const k = createPlatformKernel({ deviceTier: 'low' });
    k.registerService(desc('a', { minimumDeviceTier: 'high' }), recSvc('a'));
    await k.startService('a');
    expect(k.getServiceStatus('a')!.state).not.toBe('running');
    expect(k.getServiceStatus('a')!.degradedReasons.some((r) => r.includes('device_tier_below'))).toBe(true);
  });

  it('21) Mali-400 (low) optional ağır servis açılmıyor', async () => {
    const k = createPlatformKernel({ deviceTier: 'low' });
    k.registerService(desc('vision', { criticality: 'optional', minimumDeviceTier: 'high' }), recSvc('vision'));
    await k.startAll();
    expect(k.getServiceStatus('vision')!.state).not.toBe('running');
  });
});

/* ══════════════════════════════════════════════════════════════════════
 * 22–25 · Timeout / cleanup / izolasyon
 * ════════════════════════════════════════════════════════════════════ */

describe('timeout / cleanup / izolasyon', () => {
  it('22) start timeout → failed', async () => {
    vi.useFakeTimers();
    const k = createPlatformKernel({ timeouts: { initTimeoutMs: 1000, startTimeoutMs: 1000, stopTimeoutMs: 1000 } });
    k.registerService(desc('a', { startTimeoutMs: 1000 }), recSvc('a', { hangStart: true }));
    const p = k.startService('a');
    await vi.advanceTimersByTimeAsync(1500);
    expect(await p).toBe('failed');
    vi.useRealTimers();
  });

  it('23) stop timeout fail-soft → stopped', async () => {
    vi.useFakeTimers();
    const k = createPlatformKernel();
    const s: PlatformService = { id: 'a', start() {}, stop() { return new Promise<void>(() => {}); } };
    k.registerService(desc('a', { stopTimeoutMs: 1000 }), s);
    await k.startService('a');
    const p = k.stopService('a');
    await vi.advanceTimersByTimeAsync(1500);
    expect(await p).toBe('stopped');   // timeout olsa da güvenli stopped'a geçer
    vi.useRealTimers();
  });

  it('24) timer cleanup — başarılı start sonrası bekleyen timer YOK', async () => {
    vi.useFakeTimers();
    const k = createPlatformKernel();
    k.registerService(desc('a'), recSvc('a'));
    await k.startService('a');
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
  });

  it('25) service exception izolasyonu', async () => {
    const k = createPlatformKernel();
    k.registerService(desc('a'), recSvc('a', { failStart: true }));
    k.registerService(desc('b'), recSvc('b'));
    await expect(k.startAll()).resolves.toBeUndefined();  // throw etmez
    expect(k.getServiceStatus('b')!.state).toBe('running');
  });
});

/* ══════════════════════════════════════════════════════════════════════
 * 26–31 · Health / degraded / restart / circuit
 * ════════════════════════════════════════════════════════════════════ */

describe('health / restart / circuit', () => {
  it('26) health check', async () => {
    const k = createPlatformKernel();
    k.registerService(desc('a'), recSvc('a', { health: 'healthy' }));
    await k.startService('a');
    await k.runHealthCheck('a');
    expect(k.getServiceStatus('a')!.health).toBe('healthy');
  });

  it('27) health exception fail-soft → unknown', async () => {
    const k = createPlatformKernel();
    k.registerService(desc('a'), recSvc('a', { healthThrows: true }));
    await k.startService('a');
    await expect(k.runHealthCheck('a')).resolves.toBeUndefined();
    expect(k.getServiceStatus('a')!.health).toBe('unknown');
  });

  it('28) markDegraded', async () => {
    const k = createPlatformKernel();
    k.registerService(desc('a'), recSvc('a'));
    await k.startService('a');
    expect(k.markDegraded('a', 'sensor_flaky')).toBe(true);
    expect(k.getServiceStatus('a')!.state).toBe('degraded');
    expect(k.getServiceStatus('a')!.health).toBe('degraded');
  });

  it('29) restart manual', async () => {
    const k = createPlatformKernel();
    const s = recSvc('a', { }); k.registerService(desc('a', { restartPolicy: 'manual' }), s);
    await k.startService('a');
    await k.restartService('a');
    expect(k.getServiceStatus('a')!.state).toBe('running');
    expect(k.getServiceStatus('a')!.restartCount).toBe(1);
    expect(s.calls.filter((c) => c === 'start').length).toBe(2);
  });

  it('30) restart never → engellenir', async () => {
    const k = createPlatformKernel();
    const s = recSvc('a'); k.registerService(desc('a', { restartPolicy: 'never' }), s);
    await k.startService('a');
    await k.restartService('a');
    expect(k.getServiceStatus('a')!.restartCount).toBe(0);   // never → hiç restart yok
    expect(s.calls.filter((c) => c === 'start').length).toBe(1);
  });

  it('31) bounded_auto circuit breaker — max sonrası bloke', async () => {
    const k = createPlatformKernel();
    const s = recSvc('a'); k.registerService(desc('a', { restartPolicy: 'bounded_auto', criticality: 'normal' }), s);
    await k.startService('a');
    await k.restartService('a');  // 1
    await k.restartService('a');  // 2 → circuit açılır (max 2)
    const startsBefore = s.calls.filter((c) => c === 'start').length;
    await k.restartService('a');  // 3 → bloke (circuit)
    expect(k.getServiceStatus('a')!.restartCount).toBe(2);
    expect(s.calls.filter((c) => c === 'start').length).toBe(startsBefore); // yeni start yok
  });

  it('31b) backoff contract saf fonksiyon (timer değil)', () => {
    expect(computeKernelBackoffMs(0)).toBe(5_000);
    expect(computeKernelBackoffMs(1)).toBe(10_000);
    expect(computeKernelBackoffMs(99)).toBe(160_000); // üst limit
  });
});

/* ══════════════════════════════════════════════════════════════════════
 * 32–37 · Listener / immutability
 * ════════════════════════════════════════════════════════════════════ */

describe('listener / immutability', () => {
  it('32) listener subscribe/unsubscribe', () => {
    const k = createPlatformKernel();
    const ev: string[] = [];
    const unsub = k.subscribe((e) => ev.push(e.type));
    k.registerService(desc('a'), recSvc('a'));
    expect(ev).toContain('registered');
    unsub();
    k.registerService(desc('b'), recSvc('b'));
    expect(ev.filter((t) => t === 'registered').length).toBe(1);
  });

  it('33) listener error izolasyonu', () => {
    const k = createPlatformKernel();
    const good: string[] = [];
    k.subscribe(() => { throw new Error('listener boom'); });
    k.subscribe((e) => good.push(e.type));
    expect(() => k.registerService(desc('a'), recSvc('a'))).not.toThrow();
    expect(good).toContain('registered');
  });

  it('34) duplicate listener yok', () => {
    const k = createPlatformKernel();
    const l = () => {};
    k.subscribe(l); k.subscribe(l);
    expect(k.listenerCount).toBe(1);
  });

  it('35) kernel snapshot immutable', () => {
    const k = createPlatformKernel();
    k.registerService(desc('a'), recSvc('a'));
    const snap = k.getKernelSnapshot();
    expect(Object.isFrozen(snap)).toBe(true);
    expect(Object.isFrozen(snap.services)).toBe(true);
  });

  it('36) nested status immutable', async () => {
    const k = createPlatformKernel();
    k.registerService(desc('a', { optionalDependencies: ['x'] }), recSvc('a'));
    await k.startService('a');
    const st = k.getServiceStatus('a')!;
    expect(Object.isFrozen(st.degradedReasons)).toBe(true);
    expect(Object.isFrozen(st.dependencyState)).toBe(true);
    expect(Object.isFrozen(st.capabilityState)).toBe(true);
  });

  it('37) input descriptor mutate edilmiyor', () => {
    const k = createPlatformKernel();
    const d = desc('a', { dependencies: ['x'] });
    const clone = JSON.parse(JSON.stringify(d));
    k.registerService(d, recSvc('a'));
    expect(JSON.parse(JSON.stringify(d))).toEqual(clone);
  });
});

/* ══════════════════════════════════════════════════════════════════════
 * 38–45 · Event publisher / fail-soft / reset / bounded
 * ════════════════════════════════════════════════════════════════════ */

describe('publisher / fail-soft / bounded', () => {
  it('38) event publisher opsiyonel — yoksa lifecycle çalışır', async () => {
    const k = createPlatformKernel();  // publisher yok
    k.registerService(desc('a'), recSvc('a'));
    expect(await k.startService('a')).toBe('running');
  });

  it('38b) publisher varsa event yayınlanır', async () => {
    const events: string[] = [];
    const k = createPlatformKernel({ publisher: { publishName: (n) => { events.push(n); return null; } } });
    k.registerService(desc('a'), recSvc('a'));
    await k.startAll();
    expect(events).toContain('platform.runtime.started');
    expect(events).toContain('platform.service.started');
  });

  it('39) publish error fail-soft', async () => {
    const k = createPlatformKernel({ publisher: { publishName: () => { throw new Error('bus boom'); } } });
    k.registerService(desc('a'), recSvc('a'));
    expect(await k.startService('a')).toBe('running');   // publish hatası lifecycle'ı durdurmaz
  });

  it('40) unknown service fail-soft', async () => {
    const k = createPlatformKernel();
    expect(await k.startService('nope')).toBe('stopped');
    expect(await k.stopService('nope')).toBe('stopped');
    expect(k.getServiceStatus('nope')).toBeNull();
    expect(k.markDegraded('nope', 'x')).toBe(false);
  });

  it('41) partial start + stopAll güvenli', async () => {
    const k = createPlatformKernel();
    k.registerService(desc('a'), recSvc('a'));
    k.registerService(desc('b'), recSvc('b', { failStart: true }));
    await k.startAll();
    await expect(k.stopAll()).resolves.toBeUndefined();
    expect(k.getServiceStatus('a')!.state).toBe('stopped');
  });

  it('42) dispose sonrası no-op', () => {
    const k = createPlatformKernel();
    k.dispose();
    expect(k.registerService(desc('a'), recSvc('a'))).toBe(false);
    expect(() => k.getKernelSnapshot()).not.toThrow();
  });

  it('42b) dispose sonrası startService → disposed', async () => {
    const k = createPlatformKernel();
    k.registerService(desc('a'), recSvc('a'));
    k.dispose();
    expect(await k.startService('a')).toBe('disposed');
  });

  it('43) reset', () => {
    const k = createPlatformKernel();
    k.registerService(desc('a'), recSvc('a'));
    k.registerService(desc('b'), recSvc('b'));
    k.reset();
    expect(k.serviceCount).toBe(0);
  });

  it('44) service limit bounded', () => {
    const k = createPlatformKernel({ limits: { maxServices: 2, maxListeners: 32, maxDegradedReasons: 8 } });
    k.registerService(desc('a'), recSvc('a'));
    k.registerService(desc('b'), recSvc('b'));
    expect(k.registerService(desc('c'), recSvc('c'))).toBe(false);
    expect(k.serviceCount).toBe(2);
  });

  it('45) listener limit bounded', () => {
    const k = createPlatformKernel({ limits: { maxServices: 128, maxListeners: 1, maxDegradedReasons: 8 } });
    k.subscribe(() => {});
    k.subscribe(() => {});
    expect(k.listenerCount).toBe(1);
  });
});

/* ══════════════════════════════════════════════════════════════════════
 * 46–50 · Sınır / hijyen
 * ════════════════════════════════════════════════════════════════════ */

describe('sınır / hijyen', () => {
  it('46) import yan etkisiz — fabrika now/tier ÇAĞIRMAZ, timer AÇMAZ', () => {
    vi.useFakeTimers();
    const now = vi.fn(() => 0);
    const tier = vi.fn(() => 'low' as const);
    createPlatformKernel({ now, deviceTier: tier });
    expect(now).not.toHaveBeenCalled();
    expect(tier).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
  });

  it('47) SystemBoot wiring YOK', () => {
    expect(kernelSource).not.toMatch(/from ['"].*SystemBoot/);
  });

  it('48) gerçek servis auto-start / value-import YOK (yalnız TYPE)', () => {
    expect(kernelSource).not.toMatch(/from ['"]\.\.\/vehicleHal/);
    expect(kernelSource).not.toMatch(/from ['"]\.\.\/capability/);
    expect(kernelSource).not.toMatch(/from ['"]\.\.\/eventBus/);
    expect(kernelSource).not.toMatch(/from ['"]\.\.\/system/);
    expect(kernelSource).toMatch(/import type \{ DeviceTier \}/);
    // GLOBAL SINGLETON yok (createPlatformKernel modül düzeyinde çağrılmıyor).
    expect(kernelSource).not.toMatch(/^export const \w+ = createPlatformKernel/m);
  });

  it('49) privacy — degraded reason / error kodu sanitize (VIN sızmaz)', async () => {
    const k = createPlatformKernel();
    k.registerService(desc('a'), recSvc('a'));
    await k.startService('a');
    k.markDegraded('a', 'fault at VIN 1HGCM82633A004352 detected');
    const json = JSON.stringify(k.getServiceStatus('a'));
    expect(json).not.toContain('1HGCM82633A004352');
  });

  it('50) BASIC_JS sürekli yük yok — steady-state timer/polling yok', async () => {
    expect(kernelSource).not.toMatch(/setInterval|requestAnimationFrame/);
    vi.useFakeTimers();
    const k = createPlatformKernel();
    k.registerService(desc('a'), recSvc('a'));
    await k.startAll();
    await k.runHealthCheck();
    await k.stopAll();
    expect(vi.getTimerCount()).toBe(0);   // işlemler bittiğinde bekleyen timer YOK
    vi.useRealTimers();
  });
});
