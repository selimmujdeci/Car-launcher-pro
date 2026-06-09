/**
 * soak.telemetry-connectivity.test.ts — T4 Commit 5: telemetry + connectivity endurance.
 *
 * Amaç: 8 saatlik SANAL çalışmada GERÇEK telemetryService ve connectivityService
 * uzun-süre davranışını (heartbeat sürekliliği, monotonik Δ, adaptive interval,
 * offline kuyruk büyümesi, backoff tavanı, online drain tekilliği, timer/listener
 * sızıntısı) doğrulamak. Gerçek bekleme YOK; T4 soakHarness sanal saati.
 *
 * Yapı:
 *   PART A — telemetryService (gerçek sınıf, mock bağımlılıklar).
 *   PART B — connectivityService (gerçek sınıf). IndexedDB jsdom'da yok ve
 *     fake-indexeddb bağımlılığı eklenmedi → testte minimal in-memory IDB shim
 *     ile GERÇEK servis sürülür (enqueue/drain/backoff/queue gerçek koddur).
 *
 * Kurallar (CLAUDE.md): production/native hot-path'e DOKUNULMAZ; yalnız mevcut
 * public API'ler kullanılır (yeni production hook yok); yalnız src/__tests__ altında.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/* ── PART A telemetry bağımlılık mock'ları ── */
vi.mock('../platform/vehicleIdentityService', () => ({ pushVehicleEvent: vi.fn() }));
vi.mock('../platform/speedFusion', () => ({ getFusedSpeed: () => ({ confidence: 1, speed: 0, source: 'none' }) }));
vi.mock('../platform/system/SystemHealthMonitor', () => ({ healthMonitor: { getGlobalHealthSnapshot: () => ({}) } }));

/* ── PART B connectivity bağımlılık mock'ları ── */
const net = vi.hoisted(() => ({ connected: true, cb: null as ((s: { connected: boolean }) => void) | null }));
vi.mock('@capacitor/network', () => ({
  Network: {
    getStatus:   vi.fn(async () => ({ connected: net.connected })),
    addListener: vi.fn(async (_evt: string, cb: (s: { connected: boolean }) => void) => {
      net.cb = cb;
      return { remove: vi.fn() };
    }),
  },
}));
vi.mock('../platform/debug', () => ({ logInfo: vi.fn(), logError: vi.fn(), logWarn: vi.fn() }));

import { telemetryService } from '../platform/telemetryService';
import { pushVehicleEvent } from '../platform/vehicleIdentityService';
import { connectivityService } from '../platform/connectivityService';
import type { VehicleState } from '../platform/vehicleDataLayer/types';
import type { VehicleSignalResolver } from '../platform/vehicleDataLayer/VehicleSignalResolver';
import {
  startVirtualClock,
  installSoakProbes,
  SECONDS,
  MINUTES,
  HOURS,
} from './sim/soakHarness';

/** Sanal saat epoch'u gerçek-zaman önünde (Date.now tabanlı backoff/uid taşma yok). */
const SOAK_EPOCH = Date.UTC(2030, 0, 1);

/** Sahte VehicleSignalResolver — onResolved aboneliği + emit. */
function makeResolver(): { resolver: VehicleSignalResolver; emit: (p: Partial<VehicleState>) => void } {
  let cb: ((p: Partial<VehicleState>) => void) | null = null;
  const resolver = {
    onResolved: (fn: (p: Partial<VehicleState>) => void) => { cb = fn; return () => { cb = null; }; },
  } as unknown as VehicleSignalResolver;
  return { resolver, emit: (p) => cb?.(p) };
}

/* ── Minimal in-memory IndexedDB shim (yalnız connectivityService'in kullandığı yüzey) ── */
type Handler = (() => void) | null;
interface FakeRequest { result: unknown; error: unknown; onsuccess: Handler; onerror: Handler; onupgradeneeded: Handler }
interface FakeStore { createIndex: () => void; getAll: () => FakeRequest; put: (e: { id: string }) => void; delete: (id: string) => void }
interface FakeTx { objectStore: () => FakeStore; oncomplete: Handler; onerror: Handler; error: unknown }
interface FakeDB { createObjectStore: () => FakeStore; transaction: (s: string, m?: string) => FakeTx }

function installFakeIDB(): { clear: () => void } {
  const data = new Map<string, { id: string }>();
  let created = false;

  const makeStore = (): FakeStore => ({
    createIndex: () => {},
    getAll: () => {
      const req: FakeRequest = { result: undefined, error: null, onsuccess: null, onerror: null, onupgradeneeded: null };
      queueMicrotask(() => { req.result = [...data.values()]; req.onsuccess?.(); });
      return req;
    },
    put:    (e) => { data.set(e.id, e); },
    delete: (id) => { data.delete(id); },
  });

  const makeDb = (): FakeDB => ({
    createObjectStore: () => makeStore(),
    transaction: () => {
      const tx: FakeTx = { objectStore: () => makeStore(), oncomplete: null, onerror: null, error: null };
      queueMicrotask(() => { tx.oncomplete?.(); }); // put/delete commit
      return tx;
    },
  });

  const factory = {
    open: () => {
      const req: FakeRequest = { result: makeDb(), error: null, onsuccess: null, onerror: null, onupgradeneeded: null };
      queueMicrotask(() => {
        if (!created) { created = true; req.onupgradeneeded?.(); }
        req.onsuccess?.();
      });
      return req;
    },
  };
  (globalThis as unknown as { indexedDB: unknown }).indexedDB = factory;
  return { clear: () => data.clear() };
}

/* ═══════════════════════════════════════════════════════════════════════════
   PART A — telemetryService endurance
═══════════════════════════════════════════════════════════════════════════ */

describe('T4 — telemetry endurance (PART A)', () => {
  beforeEach(() => { telemetryService.stop(); });
  afterEach(() => { vi.useRealTimers(); telemetryService.stop(); vi.clearAllMocks(); });

  it('heartbeat 8h sürekli, timer birikmez, stop sonrası kalmaz', async () => {
    const clock  = startVirtualClock();
    const probes = installSoakProbes();
    let heartbeats = 0;
    vi.mocked(pushVehicleEvent).mockImplementation((e: string) => { if (e === 'heartbeat') heartbeats++; });

    const r = makeResolver();
    telemetryService.start(r.resolver);
    const intervalsAfterStart = probes.timers.activeIntervals(); // heartbeat + health = 2

    await clock.advance(HOURS(8)); // parked 10dk → ~48 heartbeat
    const intervalsAfterSoak = probes.timers.activeIntervals();
    const hbDuringSoak = heartbeats;

    telemetryService.stop();
    const intervalsAfterStop = probes.timers.activeIntervals();

    probes.restore();
    clock.restore();

    expect(intervalsAfterStart).toBe(2);          // heartbeat + health interval
    expect(intervalsAfterSoak).toBe(2);            // 8h sonra birikim yok (singleton)
    expect(hbDuringSoak).toBeGreaterThanOrEqual(40); // ~48 (8h/10dk) sürekli akış
    expect(intervalsAfterStop).toBe(0);            // stop → tüm timer temizlendi
  });

  it('monotonic ts: 8h boyunca push ts negatif/azalan üretmez (performance.now)', async () => {
    const clock = startVirtualClock();
    const tsValues: number[] = [];
    vi.mocked(pushVehicleEvent).mockImplementation((_e: string, p?: Record<string, unknown>) => {
      const ts = p?.['ts'];
      if (typeof ts === 'number') tsValues.push(ts);
    });

    const r = makeResolver();
    telemetryService.start(r.resolver); // startup push ts≈0
    await clock.advance(HOURS(8));
    telemetryService.stop();
    clock.restore();

    expect(tsValues.length).toBeGreaterThan(0);
    expect(Math.min(...tsValues)).toBeGreaterThanOrEqual(0); // negatif Δ yok
    let monotonic = true;
    for (let i = 1; i < tsValues.length; i++) if (tsValues[i] < tsValues[i - 1]) monotonic = false;
    expect(monotonic).toBe(true);                            // non-decreasing
    expect(Math.max(...tsValues)).toBeLessThanOrEqual(HOURS(8)); // sanal süreyle tutarlı
  });

  it('adaptive interval sözleşmesi: parked 10dk / driving 5s / deep_sleep 1h', async () => {
    const clock = startVirtualClock();
    let count = 0;
    vi.mocked(pushVehicleEvent).mockImplementation((e: string) => { if (e === 'heartbeat') count++; });

    const r = makeResolver();
    telemetryService.start(r.resolver);

    // PARKED (10dk)
    count = 0;
    await clock.advance(MINUTES(60));
    const parkedCount = count;

    // DRIVING (5s) — hız sürüş eşiğini geçer
    r.emit({ speed: 50 });
    count = 0;
    await clock.advance(SECONDS(60));
    const drivingCount = count;

    // DEEP_SLEEP (1h) — voltaj 11.8V altına düşer
    telemetryService.setVoltage(11.0);
    count = 0;
    await clock.advance(HOURS(2));
    const deepCount = count;

    telemetryService.stop();
    clock.restore();

    expect(parkedCount).toBe(6);    // 60dk / 10dk
    expect(drivingCount).toBe(12);  // 60s / 5s
    expect(deepCount).toBe(2);      // 2h / 1h
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   PART B — connectivityService endurance (in-memory IDB shim)
═══════════════════════════════════════════════════════════════════════════ */

describe('T4 — connectivity endurance (PART B)', () => {
  let idb: { clear: () => void };

  beforeEach(() => {
    idb = installFakeIDB();
    net.connected = true;
    net.cb = null;
    globalThis.fetch = vi.fn(async () => ({ ok: false, status: 500 } as Response));
  });
  afterEach(() => {
    vi.useRealTimers();
    connectivityService.destroy();
    idb.clear();
    vi.clearAllMocks();
  });

  it('offline kuyruk kontrollü büyür (enqueue N → queueSize N, dup yok, fetch yok)', async () => {
    net.connected = false;
    await connectivityService.init(); // offline

    for (let i = 0; i < 50; i++) {
      await connectivityService.enqueue('https://x', 'POST', {}, { seq: i }, 'normal', 'telemetry');
    }
    const size = await connectivityService.queueSize();

    expect(size).toBe(50);                          // tam N — duplikasyon yok
    expect(globalThis.fetch).not.toHaveBeenCalled(); // offline → hiç gönderim
  });

  it('online + sürekli 5xx: backoff 30s tavanına oturur, retry storm yok', async () => {
    const clock = startVirtualClock(SOAK_EPOCH);
    net.connected = true; // online ama server hep 5xx (fetch ok:false)
    await connectivityService.init();
    await connectivityService.enqueue('https://x', 'POST', {}, { a: 1 }, 'normal', 'telemetry');

    await clock.advance(HOURS(8)); // 8h boyunca backoff'lu retry

    const fetches = vi.mocked(globalThis.fetch).mock.calls.length;
    const queueAfter = await connectivityService.queueSize();
    connectivityService.destroy(); // bekleyen retry _timer'ı fake timer aktifken temizle
    clock.restore();

    const cap = Math.ceil(HOURS(8) / 30_000); // 30s tavan → ~960 maks drain
    expect(fetches).toBeGreaterThan(50);          // donmadı, tekrar deniyor
    expect(fetches).toBeLessThanOrEqual(cap + 20); // 30s tavan → storm yok
    expect(queueAfter).toBe(1);                    // at-least-once: silinmedi (5xx)
  });

  it('online drain: birikmiş kuyruk tekil drain ile boşalır (dup/paralel yok)', async () => {
    const clock = startVirtualClock(SOAK_EPOCH);
    net.connected = false;
    await connectivityService.init(); // offline

    for (let i = 0; i < 20; i++) {
      await connectivityService.enqueue('https://x', 'POST', {}, { seq: i }, 'normal', 'telemetry');
    }
    const sizeBefore = await connectivityService.queueSize();

    // Online ol + server 2xx
    (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(async () => ({ ok: true, status: 200 } as Response));
    net.connected = true;
    net.cb?.({ connected: true }); // networkStatusChange → drain

    await clock.advance(SECONDS(5)); // drain'in tamamlanması
    const sizeAfter = await connectivityService.queueSize();
    const fetches   = vi.mocked(globalThis.fetch).mock.calls.length;
    clock.restore();

    expect(sizeBefore).toBe(20);
    expect(sizeAfter).toBe(0);   // kuyruk boşaldı
    expect(fetches).toBe(20);    // her entry TAM 1 kez → paralel drain / dup yok
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   PART C — cross-service timer/listener leak
═══════════════════════════════════════════════════════════════════════════ */

describe('T4 — telemetry + connectivity cross leak', () => {
  let idb: { clear: () => void };

  beforeEach(() => {
    idb = installFakeIDB();
    net.connected = true;
    net.cb = null;
    globalThis.fetch = vi.fn(async () => ({ ok: true, status: 200 } as Response)); // başarı → retry timer yok
    telemetryService.stop();
  });
  afterEach(() => {
    vi.useRealTimers();
    telemetryService.stop();
    connectivityService.destroy();
    idb.clear();
    vi.clearAllMocks();
  });

  it('8h birlikte çalışırken timer/listener bounded, stop sonrası sıfır', async () => {
    const clock  = startVirtualClock(SOAK_EPOCH);
    const probes = installSoakProbes();
    vi.mocked(pushVehicleEvent).mockImplementation(() => {});

    const r = makeResolver();
    telemetryService.start(r.resolver);
    await connectivityService.init();
    await connectivityService.enqueue('https://x', 'POST', {}, { a: 0 }, 'normal', 'telemetry');

    // 8 saat: her saat bir enqueue (başarı → anında drain, timer birikmez)
    for (let k = 0; k < 8; k++) {
      await clock.advance(HOURS(1));
      await connectivityService.enqueue('https://x', 'POST', {}, { k }, 'normal', 'telemetry');
    }
    await clock.advance(SECONDS(2)); // son enqueue'nun drain'i fake timer altında tamamlansın

    const intervalsDuring = probes.timers.activeIntervals();
    const timeoutsDuring  = probes.timers.activeTimeouts();

    telemetryService.stop();
    connectivityService.destroy();
    const intervalsAfterStop = probes.timers.activeIntervals();

    probes.restore();
    clock.restore();

    expect(intervalsDuring).toBeLessThanOrEqual(2);   // telemetry heartbeat + health
    expect(timeoutsDuring).toBeLessThanOrEqual(2);     // connectivity başarı → retry timer yok
    expect(intervalsAfterStop).toBe(0);                // her iki servis temiz kapanış
  });
});
