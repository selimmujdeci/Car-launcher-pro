/**
 * soak.remoteCommand.test.ts — T4 Commit 6: remoteCommand defter/queue eviction soak'ı.
 *
 * F0.2 GÜNCELLEMESİ (2026-09-17): `remoteCommandService` artık fiziksel yürütücü
 * DEĞİLDİR — kanonik yürütme otoritesi `commandListener`dır (bkz. remoteCommandService.ts
 * içindeki `_processCommand` yorumu ve `remoteCommandSingleAuthority.test.ts`).
 * `_awaitHardwareAck` yalnız devre dışı bırakılmış `_legacyExecuteCommandDisabled`
 * gövdesinden çağrılır ve o gövde hiçbir production yolundan tetiklenmez; bu yüzden
 * `_pendingAcks` production'da hep boştur ve `acknowledgeCommand`/`timeoutCommandAck`
 * artık yalnızca güvenli no-op'tur (gerçek native ACK producer da yok — grep ile
 * doğrulandı). Bu dosyadaki testler artık YENİ sözleşmeyi ölçer:
 *   - `_processCommand` hiçbir ACK timer kurmaz, hiçbir status yazmaz (taşıma/defter).
 *   - Soak değeri (100+ komut, dedup, stop lifecycle, offline queue eviction) korunur.
 * Gözlemlenebilir yüzeyler:
 *   - leakHarness timer spy (artık her zaman 0 — ACK timer retired)
 *   - safeStorage (cmd-retry-queue-v1 persist) → offline kritik komut defteri
 *   - getDelegatedCommandCount() → devredilen (taşınan) komut sayısı
 *
 * Kurallar (CLAUDE.md): production/native hot-path'e DOKUNULMAZ; yeni production hook
 * yok; yalnız src/__tests__ altında.
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
  getDelegatedCommandCount,
} from '../platform/remoteCommandService';
import { updateRemoteCommandStatus } from '../platform/vehicleIdentityService';
/* CONNECTIVITY F7-B: `remoteCommandService` artik tarayicinin `online` olayini
   DINLEMEZ — kanonik `ConnectivityAuthority`ye abone olur. Sizinti kilidi ayni
   sekilde gecerlidir; yalnizca SAYILAN abonelik degisti. */
import { getConnectivityTelemetry } from '../platform/connectivity/connectivityAuthority';
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

describe('T4 — remoteCommand ACK-wait retired (fiziksel yürütme commandListener\'da)', () => {
  it('online kritik komut teslim edilir; ACK-wait timer ASLA kurulmaz (INVARIANT 1/7)', async () => {
    const clock  = startVirtualClock(SOAK_EPOCH);
    const probes = installSoakProbes();
    await startRemoteCommands();
    setRemoteCommandContext({} as CommandContext);

    const before = probes.timers.activeTimeouts();
    emit('cmd1', 'unlock');
    await clock.advance(1); // _processCommand ilerler → yalnız defter/dedup, ACK yok
    const afterEmit = probes.timers.activeTimeouts();

    await clock.advance(SECONDS(10) + 100); // eski 10s ACK penceresi geçse de
    await clock.advance(1);
    const afterWindow = probes.timers.activeTimeouts();
    const statuses = statusesFor('cmd1');

    probes.restore();
    clock.restore();

    expect(afterEmit).toBe(before);   // ACK timer hiç kurulmadı — mekanizma retired
    expect(afterWindow).toBe(before); // pencere geçse de timer birikmedi
    expect(statuses).toHaveLength(0); // remoteCommandService status YAZMAZ (tek sahip commandListener)
  });

  it('100+ komut ardışık teslim edilir: hepsi devredilir (taşıma), hiçbiri timer/pending üretmez', async () => {
    const clock  = startVirtualClock(SOAK_EPOCH);
    const probes = installSoakProbes();
    await startRemoteCommands();
    setRemoteCommandContext({} as CommandContext);

    const before = probes.timers.activeTimeouts();
    const beforeDelegated = getDelegatedCommandCount();
    const N = 120;
    for (let i = 0; i < N; i++) emit(`m${i}`, 'unlock');
    await clock.advance(1); // tüm zincirleri ilerlet
    const afterEmit = probes.timers.activeTimeouts();

    await clock.advance(SECONDS(10) + 100); // eski ACK penceresi geçse de
    await clock.advance(1);
    const afterWindow = probes.timers.activeTimeouts();

    probes.restore();
    clock.restore();

    expect(getDelegatedCommandCount() - beforeDelegated).toBe(N); // 120 komut devredildi (LAB gözlemi)
    expect(afterEmit).toBe(before);    // 120 komutta bile ACK timer kurulmadı
    expect(afterWindow).toBe(before);  // leak yok — sabit kalır
  });
});

describe('T4 — remoteCommand ACK API dead-but-safe', () => {
  it('gerçekten teslim edilmiş bir id için bile acknowledgeCommand/timeoutCommandAck no-op kalır; sahte completed/failed ÜRETİLMEZ', async () => {
    const clock  = startVirtualClock(SOAK_EPOCH);
    const probes = installSoakProbes();
    await startRemoteCommands();
    setRemoteCommandContext({} as CommandContext);

    emit('ack1', 'unlock');
    await clock.advance(1);
    const before = probes.timers.activeTimeouts();

    // _pendingAcks hiçbir zaman doldurulmadı (live path _awaitHardwareAck çağırmaz) →
    // bu iki çağrı da no-op olmalı; ne timer değişir ne sahte status üretilir.
    expect(() => acknowledgeCommand('ack1')).not.toThrow();
    expect(() => timeoutCommandAck('ack1')).not.toThrow();
    const after = probes.timers.activeTimeouts();
    const statuses = statusesFor('ack1');

    probes.restore();
    clock.restore();

    expect(after).toBe(before);                    // no-op — pending hiç yoktu
    expect(statuses).not.toContain('completed');    // sahte VERIFIED/completed üretilmedi (INVARIANT 5/6)
    expect(statuses).not.toContain('failed');
  });
});

describe('T4 — remoteCommand duplicate / dedup safety', () => {
  it('aynı commandId offlineyken tekrar gelince yerel deftere İKİ KEZ girmez (dedup canlı yolda)', async () => {
    const clock = startVirtualClock(SOAK_EPOCH);
    setOnline(false);
    await startRemoteCommands();
    setRemoteCommandContext({} as CommandContext);

    emit('dupX', 'unlock');
    await clock.advance(1); // offline + kritik → _enqueueRetry
    emit('dupX', 'unlock'); // aynı id → _isDuplicate → suppress, ikinci kayıt YOK
    await clock.advance(1);

    const raw = store.get(QUEUE_KEY);
    const q = raw ? (JSON.parse(raw) as Array<{ row: { id: string } }>) : [];
    const dupCount = q.filter((e) => e.row.id === 'dupX').length;

    clock.restore();
    setOnline(true);

    expect(dupCount).toBe(1); // dedup → tek kayıt (çift kayıt yok)
  });
});

describe('T4 — remoteCommand stop cleanup', () => {
  it('stop → bağlantı aboneliği sökülür; offline kuyruğu kalıcıdır, ACK timer hiç yok', async () => {
    const clock  = startVirtualClock(SOAK_EPOCH);
    const probes = installSoakProbes();
    const subsBefore = getConnectivityTelemetry().subscriberCount;
    setOnline(false);
    await startRemoteCommands();
    setRemoteCommandContext({} as CommandContext);

    const onlineAfterStart = getConnectivityTelemetry().subscriberCount - subsBefore;
    /* Tarayici `online` olayi ARTIK dinlenmiyor — ikinci gozlemci yok (§29). */
    expect(probes.windowListeners.active('online')).toBe(0);
    emit('stop1', 'unlock'); // offline + kritik → yerel deftere yazılır
    await clock.advance(1);
    const timersBeforeStop = probes.timers.activeTimeouts();
    const beforeStopHasEntry = (JSON.parse(store.get(QUEUE_KEY) ?? '[]') as Array<{ row: { id: string } }>)
      .some((e) => e.row.id === 'stop1');

    stopRemoteCommands();
    const onlineAfterStop  = getConnectivityTelemetry().subscriberCount - subsBefore;
    const timersAfterStop  = probes.timers.activeTimeouts();
    const afterStopHasEntry = (JSON.parse(store.get(QUEUE_KEY) ?? '[]') as Array<{ row: { id: string } }>)
      .some((e) => e.row.id === 'stop1');

    probes.restore();
    clock.restore();
    setOnline(true);

    expect(onlineAfterStart).toBe(1);        // tam 1 kanonik abonelik
    expect(onlineAfterStop).toBe(0);         // abonelik söküldü (sızıntı yok)
    expect(timersBeforeStop).toBe(0);        // ACK-wait timer artık hiç kurulmuyor
    expect(timersAfterStop).toBe(0);         // stop sonrası da timer yok
    expect(beforeStopHasEntry).toBe(true);   // offline kritik komut deftere yazıldı
    expect(afterStopHasEntry).toBe(true);    // stop kuyruğu SİLMEZ — kalıcı (by-design, kod yorumu)
  });

  it('stop idempotent, listener kalıntısı bırakmaz', async () => {
    const probes = installSoakProbes();
    const subsBefore = getConnectivityTelemetry().subscriberCount;
    await startRemoteCommands();
    stopRemoteCommands();
    stopRemoteCommands();
    const online = probes.windowListeners.active('online');
    const subs   = getConnectivityTelemetry().subscriberCount - subsBefore;
    probes.restore();
    expect(online).toBe(0);
    expect(subs).toBe(0);   // çift stop kanonik aboneliği de sızdırmaz
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
