/**
 * soak.cross-service.test.ts — T4 Commit 7: cross-service 24h aggregate leak invariant.
 *
 * Amaç: Araçsız SANAL 24 saat boyunca safeStorage + OBD reconnect modeli +
 * AdaptiveRuntimeManager (zombie/thermal/worker) + telemetry + connectivity +
 * remoteCommand AYNI sanal zaman döngüsünde birlikte çalışırken toplam
 * timer/interval/listener/worker/yazım sayısının SINIRSIZ büyümediğini tek bir
 * agregat invariant ile doğrular. Gerçek bekleme YOK; deterministik.
 *
 * İzolasyon kararları (mock çakışması — production'a dokunmadan):
 *   - safeStorage GERÇEK (Capacitor mock'lu, web/localStorage yolu) → eMMC yazım
 *     sayacı gerçek; runtime PERSIST + remoteCommand retry queue gerçek persist.
 *   - OBD reconnect MODELİ (GERÇEK obdRetryPolicy ile; obdService import EDİLMEZ)
 *     → obdService'in runtimeManager mock'u gerekmez, gerçek AdaptiveRuntimeManager
 *     ile çakışma olmaz (Commit 3 ile aynı sadık model).
 *   - runtime/telemetry/connectivity/remoteCommand GERÇEK; yalnız bağımlılıkları
 *     mock'lanır (Commit 4/5/6 ile birebir aynı, birleştirilmiş tek set).
 *
 * Kurallar (CLAUDE.md): production/native hot-path'e DOKUNULMAZ; yalnız
 * src/__tests__ altında; yeni production hook yok.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/* ── Birleşik mock seti ── */
vi.mock('@capacitor/core', () => ({
  Capacitor:      { isNativePlatform: () => false, getPlatform: () => 'web' },
  registerPlugin: () => ({}),
}));
vi.mock('@capacitor/filesystem', () => ({
  Filesystem: {
    readdir:    vi.fn().mockResolvedValue({ files: [] }),
    readFile:   vi.fn().mockResolvedValue({ data: '' }),
    writeFile:  vi.fn().mockResolvedValue({}),
    deleteFile: vi.fn().mockResolvedValue({}),
    rename:     vi.fn().mockResolvedValue({}),
    stat:       vi.fn().mockResolvedValue({ size: 10 }),
  },
  Directory: { Data: 'DATA' },
  Encoding:  { UTF8: 'utf8' },
}));
const net = vi.hoisted(() => ({ connected: true, cb: null as ((s: { connected: boolean }) => void) | null }));
vi.mock('@capacitor/network', () => ({
  Network: {
    getStatus:   vi.fn(async () => ({ connected: net.connected })),
    addListener: vi.fn(async (_e: string, cb: (s: { connected: boolean }) => void) => { net.cb = cb; return { remove: vi.fn() }; }),
  },
}));
// runtime (Commit 4)
const env = vi.hoisted(() => ({ tier: 'high' as 'low' | 'mid' | 'high', weakGpu: false }));
vi.mock('../platform/deviceCapabilities', () => ({ getDeviceTier: () => env.tier }));
vi.mock('../utils/detectWeakGpu', () => ({ hasWeakGpu: () => env.weakGpu, getGpuRenderer: () => '' }));
// telemetry (Commit 5)
vi.mock('../platform/speedFusion', () => ({ getFusedSpeed: () => ({ confidence: 1, speed: 0, source: 'none' }) }));
vi.mock('../platform/system/SystemHealthMonitor', () => ({ healthMonitor: { getGlobalHealthSnapshot: () => ({}) } }));
// remoteCommand (Commit 6)
const sb = vi.hoisted(() => ({ handler: null as ((evt: { new: Record<string, unknown> }) => void) | null }));
vi.mock('../platform/supabaseClient', () => ({
  getSupabaseClient: () => {
    const ch: Record<string, unknown> = {};
    ch['on'] = (_e: unknown, _c: unknown, cb: (evt: { new: Record<string, unknown> }) => void) => { sb.handler = cb; return ch; };
    ch['subscribe']   = () => ch;
    ch['unsubscribe'] = () => {};
    // _fetchMissedCommands için chainable thenable query → { data: [] } (kaçırılan komut yok)
    const q: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'gte', 'order', 'limit']) q[m] = () => q;
    q['then'] = (resolve: (v: { data: unknown[] }) => void) => resolve({ data: [] });
    return { channel: () => ch, from: () => q };
  },
}));
vi.mock('../platform/sensitiveKeyStore', () => ({ sensitiveKeyStore: { get: async () => 'api-key' } }));
vi.mock('../platform/intentEngine', () => ({ fromAIResponse: () => ({ type: 'unlock' }) }));
vi.mock('../platform/commandExecutor', () => ({ executeIntent: vi.fn(async () => {}) }));
vi.mock('../platform/liveStyleEngine', () => ({ applyVars: vi.fn() }));
vi.mock('../platform/commandCrypto', () => ({
  isE2EPayload: () => true, decryptE2EPayload: async () => ({ intent: 'unlock' }),
  getCarPrivateKey: () => 'privkey', loadOrCreateDeviceKey: async () => {},
}));
// telemetry + remoteCommand ortak
vi.mock('../platform/vehicleIdentityService', () => ({
  getVehicleIdentity:        async () => ({ vehicleId: 'v1' }),
  updateRemoteCommandStatus: vi.fn(async () => {}),
  pushVehicleEvent:          vi.fn(async () => {}),
}));
vi.mock('../platform/debug', () => ({ logInfo: vi.fn(), logError: vi.fn(), logWarn: vi.fn() }));

/* ── Imports (mock'lardan sonra) — safeStorage GERÇEK ── */
import { RuntimeMode } from '../core/runtime/runtimeTypes';
import { telemetryService } from '../platform/telemetryService';
import { connectivityService } from '../platform/connectivityService';
import { startRemoteCommands, stopRemoteCommands, setRemoteCommandContext } from '../platform/remoteCommandService';
import type { CommandContext } from '../platform/commandExecutor';
import type { VehicleSignalResolver } from '../platform/vehicleDataLayer/VehicleSignalResolver';
import { safeSetRaw, safeGetRaw, safeFlushAll, getEmmcWriteCount, resetEmmcWriteCount } from '../utils/safeStorage';
import {
  getReconnectDelay, shouldAttemptReconnect, DEEP_RECONNECT_INTERVAL_MS,
} from '../platform/obdRetryPolicy';
import {
  forceMode, makeMockWorker,
  startVirtualClock, installSoakProbes,
  peak, growth, isBounded,
  SECONDS, MINUTES, HOURS,
} from './sim/soakHarness';

const SOAK_EPOCH = Date.UTC(2030, 0, 1);

function setOnline(v: boolean): void {
  Object.defineProperty(navigator, 'onLine', { value: v, configurable: true });
}
function makeResolver(): { resolver: VehicleSignalResolver } {
  const resolver = { onResolved: () => () => {} } as unknown as VehicleSignalResolver;
  return { resolver };
}
function emitCommand(id: string): void {
  sb.handler?.({ new: { id, type: 'unlock', status: 'pending', created_at: new Date(Date.now()).toISOString(), payload: { fmt: 'ecdh_v1' } } });
}

/** OBD _scheduleReconnect/_scheduleDeepReconnect sadık modeli (gerçek obdRetryPolicy). */
function makeReconnectModel(connect: () => boolean) {
  let attempts = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const clear = (): void => { if (timer) { clearTimeout(timer); timer = null; } };
  function fire(): void { timer = null; if (connect()) { attempts = 0; return; } schedule(); }
  function schedule(): void {
    if (!shouldAttemptReconnect(attempts)) { attempts = 0; clear(); timer = setTimeout(fire, DEEP_RECONNECT_INTERVAL_MS); return; }
    const d = getReconnectDelay(attempts); attempts++; clear(); timer = setTimeout(fire, d);
  }
  return { drop: schedule, stop: (): void => { clear(); attempts = 0; } };
}

/* ── In-memory IndexedDB shim (connectivity) ── */
type Handler = (() => void) | null;
interface FakeRequest { result: unknown; error: unknown; onsuccess: Handler; onerror: Handler; onupgradeneeded: Handler }
interface FakeStore { createIndex: () => void; getAll: () => FakeRequest; put: (e: { id: string }) => void; delete: (id: string) => void }
interface FakeTx { objectStore: () => FakeStore; oncomplete: Handler; onerror: Handler; error: unknown }
interface FakeDB { createObjectStore: () => FakeStore; transaction: () => FakeTx }
function installFakeIDB(): void {
  const data = new Map<string, { id: string }>();
  let created = false;
  const store = (): FakeStore => ({
    createIndex: () => {},
    getAll: () => { const r: FakeRequest = { result: undefined, error: null, onsuccess: null, onerror: null, onupgradeneeded: null }; queueMicrotask(() => { r.result = [...data.values()]; r.onsuccess?.(); }); return r; },
    put: (e) => { data.set(e.id, e); }, delete: (id) => { data.delete(id); },
  });
  const db = (): FakeDB => ({ createObjectStore: () => store(), transaction: () => { const tx: FakeTx = { objectStore: () => store(), oncomplete: null, onerror: null, error: null }; queueMicrotask(() => { tx.oncomplete?.(); }); return tx; } });
  (globalThis as unknown as { indexedDB: unknown }).indexedDB = {
    open: () => { const r: FakeRequest = { result: db(), error: null, onsuccess: null, onerror: null, onupgradeneeded: null }; queueMicrotask(() => { if (!created) { created = true; r.onupgradeneeded?.(); } r.onsuccess?.(); }); return r; },
  };
}

beforeEach(() => {
  safeFlushAll();
  localStorage.clear();
  resetEmmcWriteCount();
  setOnline(true);
  net.connected = true; net.cb = null; sb.handler = null;
  globalThis.fetch = vi.fn(async () => ({ ok: true, status: 200 } as Response));
  installFakeIDB();
});
afterEach(() => {
  vi.useRealTimers();
  telemetryService.stop();
  connectivityService.destroy();
  stopRemoteCommands();
  safeFlushAll();
  localStorage.clear();
  setOnline(true);
  vi.clearAllMocks();
});

describe('T4 — cross-service 24h aggregate leak', () => {
  it('tüm servisler 24h birlikte → timer/interval/listener/worker/yazım bounded; stop temiz', async () => {
    const clock  = startVirtualClock(SOAK_EPOCH);
    const probes = installSoakProbes();

    // ── Servisleri başlat (fake timer aktif) ──
    const rtm = forceMode(RuntimeMode.BALANCED);
    rtm.setZombieRestartCallback(() => {});
    rtm.start();
    rtm.registerWorker('VehicleCompute', makeMockWorker().worker, 'CRITICAL'); // hep yaşar
    telemetryService.start(makeResolver().resolver);
    await connectivityService.init();
    await startRemoteCommands();
    setRemoteCommandContext({} as CommandContext);
    const obd = makeReconnectModel(() => false); // bağlantı hep başarısız → deep-loop
    obd.drop();

    // ── 24h döngü (5dk adım) ──
    const STEP = MINUTES(5);
    const steps = HOURS(24) / STEP; // 288
    const intervalsS: number[] = [];
    const timeoutsS:  number[] = [];
    const workersS:   number[] = [];
    const winS:       number[] = [];
    let seq = 0;

    for (let i = 1; i <= steps; i++) {
      // safeStorage yüksek frekanslı yazım (aynı normal key → debounce coalesce)
      for (let w = 0; w < 10; w++) safeSetRaw('car-cache-xsoak', `v${i}-${w}`);
      // runtime: OPTIONAL worker churn + periyodik bellek baskısı + termal döngü
      rtm.registerWorker('VisionCompute', makeMockWorker().worker, 'OPTIONAL');
      if (i % 3 === 0) rtm.handleMemoryPressure('MODERATE');
      if (i % 5 === 0) { rtm.setThermalConstraint(2); rtm.setThermalConstraint(0); }
      // remoteCommand: ack-timeout (adım içinde 10s'de çözülür)
      emitCommand(`x${seq}`);
      // connectivity: online enqueue (başarı → drain, timer birikmez)
      void connectivityService.enqueue('https://x', 'POST', {}, { seq }, 'normal', 't');
      seq++;

      await clock.advance(STEP);

      intervalsS.push(probes.timers.activeIntervals());
      timeoutsS.push(probes.timers.activeTimeouts());
      workersS.push(rtm.getWorkers().size);
      winS.push(probes.windowListeners.active());
    }

    const emmc = getEmmcWriteCount().count;

    // ── Stop / cleanup (scenario 6) ──
    telemetryService.stop();
    connectivityService.destroy();
    stopRemoteCommands();
    rtm.destroy();
    obd.stop();
    await clock.advance(SECONDS(11)); // bekleyen son ack timer self-clear

    const afterIntervals = probes.timers.activeIntervals();
    const afterTimeouts  = probes.timers.activeTimeouts();
    const afterWorkers   = rtm.getWorkers().size;
    const afterWin       = probes.windowListeners.active();

    probes.restore();
    clock.restore();

    // ── Aggregate timer bound ──
    expect(peak(intervalsS)).toBeLessThanOrEqual(5);          // zombie + heartbeat + health
    expect(growth(intervalsS)).toBe(0);                        // plato — sınırsız artış yok
    expect(peak(timeoutsS)).toBeLessThanOrEqual(15);           // reconnect + transientler
    expect(isBounded(timeoutsS, 12)).toBe(true);               // monotonik büyüme yok

    // ── Worker bound ──
    expect(peak(workersS)).toBeLessThanOrEqual(2);             // Vehicle + Vision
    expect(growth(workersS)).toBe(0);                          // registry sabit (key bazlı)

    // ── Listener bound ──
    expect(isBounded(winS, 0)).toBe(true);                     // online listener tekil (sabit 1)
    expect(peak(winS)).toBeLessThanOrEqual(2);

    // ── Write bound (safeStorage debounce üst sınırı) ──
    expect(emmc).toBeLessThanOrEqual(Math.ceil(HOURS(24) / 5_000)); // 24h/5s = 17280
    expect(emmc).toBeGreaterThan(100);                         // veri kalıcı (yutulmadı)

    // ── Recovery after stop ──
    expect(afterIntervals).toBe(0);  // tüm interval'lar temizlendi
    expect(afterTimeouts).toBe(0);   // reconnect + ack timer'ları temiz
    expect(afterWorkers).toBe(0);    // registry boşaldı
    expect(afterWin).toBe(0);        // online listener kaldırıldı
  });

  it('offline kuyruk bound: connectivity + remoteCommand kontrollü büyür, online\'da drain', async () => {
    const clock = startVirtualClock(SOAK_EPOCH);
    setOnline(false); net.connected = false;
    await connectivityService.init();      // offline
    await startRemoteCommands();
    setRemoteCommandContext({} as CommandContext);

    // 40 offline kritik komut + 40 connectivity enqueue
    for (let i = 0; i < 40; i++) {
      void connectivityService.enqueue('https://x', 'POST', {}, { i }, 'normal', 't');
      emitCommand(`oq${i}`);
      await clock.advance(1); // zincirleri ilerlet (offline branch → enqueue/_enqueueRetry)
    }
    const connQ = await connectivityService.queueSize();
    const rcRaw = safeGetRaw('cmd-retry-queue-v1');
    const rcLen = rcRaw ? (JSON.parse(rcRaw) as unknown[]).length : 0;

    // Online ol → drain
    setOnline(true); net.connected = true;
    net.cb?.({ connected: true });                 // connectivity drain
    window.dispatchEvent(new Event('online'));     // remoteCommand drain
    await clock.advance(SECONDS(5));
    const connQAfter = await connectivityService.queueSize();

    connectivityService.destroy();
    stopRemoteCommands();
    clock.restore();

    expect(connQ).toBe(40);                 // kontrollü büyüme (her enqueue 1, dup yok)
    expect(rcLen).toBeLessThanOrEqual(50);  // remoteCommand QUEUE_MAX — sınırsız değil
    expect(rcLen).toBeGreaterThan(0);       // gerçekten kuyruğa alındı
    expect(connQAfter).toBe(0);             // online → tekil drain ile boşaldı
  });
});
