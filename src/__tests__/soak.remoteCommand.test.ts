/**
 * soak.remoteCommand.test.ts — T4 Commit 6: remoteCommand ACK-timeout + queue eviction.
 *
 * Amaç: 8 saatlik SANAL çalışmada GERÇEK remoteCommandService'in ACK timeout,
 * pending-ack temizliği, dedup, retry-queue eviction ve stop cleanup davranışını
 * doğrulamak. Gerçek bekleme YOK; T4 soakHarness sanal saati.
 *
 * Erişim: ACK mekanizması (_awaitHardwareAck / _pendingAcks) PRIVATE'tır ve yalnız
 * _processCommand'ın critical-komut (lock/unlock + E2E) yolundan populate edilir.
 * _processCommand da yalnız Realtime INSERT handler'ından çağrılır. Bu yüzden
 * supabase channel mock'u handler'ı yakalar; emit() ile GERÇEK _processCommand
 * sürülür → ACK timer/pending GERÇEK kodda oluşur. Gözlemlenebilir yüzeyler:
 *   - updateRemoteCommandStatus mock çağrıları (received/executing/failed/completed)
 *   - leakHarness timer spy (ack timer sayısı)
 *   - safeStorage (cmd-retry-queue-v1 persist) → retry queue uzunluğu
 * acknowledgeCommand / timeoutCommandAck mevcut public API olarak kullanılır.
 *
 * Kurallar (CLAUDE.md): production/native hot-path'e DOKUNULMAZ; remote command
 * davranışı değişmez; yeni production hook yok; yalnız src/__tests__ altında.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/* ── start() kapıları + komut hattı bağımlılık mock'ları ── */
const sb = vi.hoisted(() => ({ handler: null as ((evt: { new: Record<string, unknown> }) => void) | null }));
vi.mock('../platform/supabaseClient', () => ({
  getSupabaseClient: () => {
    const ch: Record<string, unknown> = {};
    ch['on'] = (_e: unknown, _c: unknown, cb: (evt: { new: Record<string, unknown> }) => void) => { sb.handler = cb; return ch; };
    ch['subscribe']   = () => ch; // SUBSCRIBED tetikleme YOK → _fetchMissedCommands atlanır
    ch['unsubscribe'] = () => {};
    return { channel: () => ch };
  },
}));
vi.mock('../platform/debug', () => ({ logInfo: vi.fn(), logError: vi.fn(), logWarn: vi.fn() }));
vi.mock('../platform/vehicleIdentityService', () => ({
  getVehicleIdentity:        async () => ({ vehicleId: 'v1' }),
  updateRemoteCommandStatus: vi.fn(async () => {}),
  pushVehicleEvent:          vi.fn(async () => {}),
}));
vi.mock('../platform/sensitiveKeyStore', () => ({ sensitiveKeyStore: { get: async () => 'api-key-123' } }));
vi.mock('../platform/intentEngine', () => ({ fromAIResponse: () => ({ type: 'unlock' }) }));
vi.mock('../platform/commandExecutor', () => ({ executeIntent: vi.fn(async () => {}) }));
vi.mock('../platform/liveStyleEngine', () => ({ applyVars: vi.fn() }));
vi.mock('../platform/commandCrypto', () => ({
  isE2EPayload:        () => true,
  decryptE2EPayload:   async () => ({ intent: 'unlock' }),
  getCarPrivateKey:    () => 'privkey',
  loadOrCreateDeviceKey: async () => {},
}));
const store = vi.hoisted(() => new Map<string, string>());
vi.mock('../utils/safeStorage', () => ({
  safeStorage:  { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); }, removeItem: (k: string) => { store.delete(k); } },
  safeFlushKey: () => {},
  safeGetRaw:   (k: string) => store.get(k) ?? null,
  safeSetRaw:   (k: string, v: string) => { store.set(k, v); },
}));

import {
  startRemoteCommands,
  stopRemoteCommands,
  setRemoteCommandContext,
  acknowledgeCommand,
  timeoutCommandAck,
} from '../platform/remoteCommandService';
import { updateRemoteCommandStatus } from '../platform/vehicleIdentityService';
import type { CommandContext } from '../platform/commandExecutor';
import {
  startVirtualClock,
  installSoakProbes,
  runSoak,
  seriesOf,
  peak,
  isBounded,
  SECONDS,
  MINUTES,
  HOURS,
} from './sim/soakHarness';

const SOAK_EPOCH = Date.UTC(2030, 0, 1);
const QUEUE_KEY  = 'cmd-retry-queue-v1';

function setOnline(v: boolean): void {
  Object.defineProperty(navigator, 'onLine', { value: v, configurable: true });
}

/** Realtime INSERT eventi simüle et → GERÇEK _processCommand sürülür. */
function emit(id: string, type = 'unlock'): void {
  sb.handler?.({
    new: { id, type, status: 'pending', created_at: new Date(Date.now()).toISOString(), payload: { fmt: 'ecdh_v1' } },
  });
}

/** _processCommand'ın await zincirini (decrypt/execute → _awaitHardwareAck) ilerlet. */
function statusesFor(id: string): string[] {
  return vi.mocked(updateRemoteCommandStatus).mock.calls
    .filter((c) => c[0] === id)
    .map((c) => c[1] as string);
}

beforeEach(() => {
  setOnline(true);
  sb.handler = null;
  store.clear();
});
afterEach(() => {
  vi.useRealTimers();
  stopRemoteCommands();
  setOnline(true);
  vi.clearAllMocks();
});

describe('T4 — remoteCommand ACK timeout', () => {
  it('ACK beklerken 10s timeout tetiklenir, pending temizlenir, timer birikmez', async () => {
    const clock  = startVirtualClock(SOAK_EPOCH);
    const probes = installSoakProbes();
    await startRemoteCommands();
    setRemoteCommandContext({} as CommandContext);

    const before = probes.timers.activeTimeouts();
    emit('cmd1', 'unlock');
    await clock.advance(1); // zinciri ilerlet → _awaitHardwareAck pending + 10s timer
    const afterEmit = probes.timers.activeTimeouts();

    await clock.advance(SECONDS(10) + 100); // 10s ACK timeout
    await clock.advance(1);                  // failed continuation
    const afterTimeout = probes.timers.activeTimeouts();
    const statuses = statusesFor('cmd1');

    probes.restore();
    clock.restore();

    expect(afterEmit).toBe(before + 1);   // tek ACK timer kuruldu
    expect(afterTimeout).toBe(before);    // timeout sonrası pending/timer temizlendi
    expect(statuses).toContain('failed'); // ACK timeout → failed
  });

  it('100+ komut pending ACK: her timeout tekil, sonrasında map boşalır', async () => {
    const clock  = startVirtualClock(SOAK_EPOCH);
    const probes = installSoakProbes();
    await startRemoteCommands();
    setRemoteCommandContext({} as CommandContext);

    const before = probes.timers.activeTimeouts();
    const N = 120;
    for (let i = 0; i < N; i++) emit(`m${i}`, 'unlock');
    await clock.advance(1); // tüm zincirleri ilerlet → N pending ack timer
    const afterEmit = probes.timers.activeTimeouts();

    await clock.advance(SECONDS(10) + 100); // tüm ACK'lar timeout
    await clock.advance(1);
    const afterTimeout = probes.timers.activeTimeouts();

    probes.restore();
    clock.restore();

    expect(afterEmit).toBe(before + N);  // her komut tek ack timer
    expect(afterTimeout).toBe(before);   // hepsi timeout → pending map boş
  });
});

describe('T4 — remoteCommand ACK success', () => {
  it('acknowledgeCommand zamanında gelirse timeout çalışmaz, pending temizlenir', async () => {
    const clock  = startVirtualClock(SOAK_EPOCH);
    const probes = installSoakProbes();
    await startRemoteCommands();
    setRemoteCommandContext({} as CommandContext);

    const before = probes.timers.activeTimeouts();
    emit('ack1', 'unlock');
    await clock.advance(1);
    const afterEmit = probes.timers.activeTimeouts();

    acknowledgeCommand('ack1'); // zamanında ACK → resolve(true), timer clear
    await clock.advance(1);
    const afterAck = probes.timers.activeTimeouts();

    await clock.advance(SECONDS(20)); // timeout penceresini geç
    const statuses = statusesFor('ack1');

    probes.restore();
    clock.restore();

    expect(afterEmit).toBe(before + 1);
    expect(afterAck).toBe(before);            // ACK → timer temizlendi
    expect(statuses).toContain('completed');  // timeout değil → completed
    expect(statuses).not.toContain('failed'); // timeout çalışmadı
  });
});

describe('T4 — remoteCommand duplicate / dedup safety', () => {
  it('aynı commandId tekrar gelince çift ACK timer üretmez (dedup)', async () => {
    const clock  = startVirtualClock(SOAK_EPOCH);
    const probes = installSoakProbes();
    await startRemoteCommands();
    setRemoteCommandContext({} as CommandContext);

    const before = probes.timers.activeTimeouts();
    emit('dupX', 'unlock');
    await clock.advance(1);
    const afterFirst = probes.timers.activeTimeouts();

    emit('dupX', 'unlock'); // aynı id → dedup → suppress
    await clock.advance(1);
    const afterSecond = probes.timers.activeTimeouts();

    timeoutCommandAck('dupX'); // temizle
    await clock.advance(1);

    probes.restore();
    clock.restore();

    expect(afterFirst).toBe(before + 1);  // ilk → 1 timer
    expect(afterSecond).toBe(afterFirst); // ikinci → çift timer YOK (dedup)
  });
});

describe('T4 — remoteCommand stop cleanup', () => {
  it('stop → online listener kaldırılır; bekleyen ACK timer kalıcı sızmaz', async () => {
    const clock  = startVirtualClock(SOAK_EPOCH);
    const probes = installSoakProbes();
    await startRemoteCommands();
    setRemoteCommandContext({} as CommandContext);

    const onlineAfterStart = probes.windowListeners.active('online');
    emit('stop1', 'unlock');
    await clock.advance(1);
    const timersBeforeStop = probes.timers.activeTimeouts();

    stopRemoteCommands();
    const onlineAfterStop  = probes.windowListeners.active('online');
    const timersAfterStop  = probes.timers.activeTimeouts();

    // stop pending ACK timer'ı iptal ETMEZ (gerçek davranış) — ama 10s'de kendi
    // kendine temizlenir → kalıcı sızıntı yok.
    await clock.advance(SECONDS(10) + 100);
    await clock.advance(1);
    const timersAfterSelfClear = probes.timers.activeTimeouts();

    probes.restore();
    clock.restore();

    expect(onlineAfterStart).toBe(1);
    expect(onlineAfterStop).toBe(0);                    // online listener kaldırıldı
    expect(timersBeforeStop).toBeGreaterThanOrEqual(1); // bekleyen ack timer vardı
    expect(timersAfterStop).toBe(timersBeforeStop);     // stop iptal etmedi (by-design)
    expect(timersAfterSelfClear).toBe(0);               // self-clear → kalıcı sızıntı yok
  });

  it('stop idempotent, listener kalıntısı bırakmaz', async () => {
    const probes = installSoakProbes();
    await startRemoteCommands();
    stopRemoteCommands();
    stopRemoteCommands();
    const online = probes.windowListeners.active('online');
    probes.restore();
    expect(online).toBe(0);
  });
});

describe('T4 — remoteCommand 8h cross soak', () => {
  it('8h boyunca komut akışında timer/listener bounded, growth sınırsız değil', async () => {
    await startRemoteCommands();
    setRemoteCommandContext({} as CommandContext);

    let seq = 0;
    const result = await runSoak({
      durationMs:   HOURS(8),
      stepMs:       MINUTES(5), // >> 10s ack timeout → her ack adım içinde çözülür
      startEpochMs: SOAK_EPOCH,
      onStep: () => { emit(`soak${seq++}`, 'unlock'); }, // adım başı bir komut
    });

    const timeouts       = seriesOf(result, 'timeouts');
    const onlineListeners = seriesOf(result, 'windowListeners');
    result.teardown();

    expect(peak(timeouts)).toBeLessThanOrEqual(2);    // ack timer adım içinde timeout → birikmez
    expect(isBounded(onlineListeners, 0)).toBe(true); // online listener tekil (eklenip birikmiyor)
  });
});

/* ── Offline retry-queue eviction — EN SONDA: _retryQueue modül state'i bırakır ── */
describe('T4 — remoteCommand offline retry queue eviction', () => {
  it('QUEUE_MAX (50) tavanında kalır; en eski savedAt evict edilir (8h sınırsız büyümez)', async () => {
    const clock = startVirtualClock(SOAK_EPOCH);
    setOnline(false);
    await startRemoteCommands();
    setRemoteCommandContext({} as CommandContext);

    // 120 offline kritik komut → her biri _enqueueRetry → QUEUE_MAX'te shift (eviction)
    for (let i = 0; i < 120; i++) {
      emit(`q${i}`, 'unlock');
      await clock.advance(1); // zinciri ilerlet → offline branch → _enqueueRetry persist
    }

    const raw = store.get(QUEUE_KEY);
    const q = raw ? (JSON.parse(raw) as Array<{ row: { id: string } }>) : [];
    const ids = q.map((e) => e.row.id);

    clock.restore();
    setOnline(true);

    expect(q.length).toBe(50);          // QUEUE_MAX — sınırsız büyümedi
    expect(ids).toContain('q119');       // en yeni korundu
    expect(ids).not.toContain('q0');     // en eski (savedAt) evict edildi
  });
});
