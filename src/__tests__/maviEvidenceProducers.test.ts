/**
 * maviEvidenceProducers.test.ts — MAVİ ÇEKİRDEĞİ · PR-DIAG-2 üretici entegrasyonu.
 *
 * KİLİTLENEN: köprü/port/legacy üreticileri kanıt deposunu MEVCUT akıştan besler; correlationId
 * tek ses komutunun tüm parçalarını birleştirir; çift yürütme uçtan uca kritik hata üretir;
 * hiçbir üretici davranışı değiştirmez ve fail-soft'tur.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMaviWiring } from '../platform/maviCore/wiring/maviWiring';
import { createTakeoverPolicy } from '../platform/maviCore/wiring/takeoverPolicy';
import { createTakeoverArbiter } from '../platform/maviCore/wiring/takeoverArbiter';
import { createMediaNextPort } from '../platform/maviCore/wiring/maviMediaPort';
import {
  buildMaviEvidenceReport, _resetMaviEvidenceForTest,
  sessionCorrelationId, commandCorrelationId, setCurrentCorrelation, getCurrentCorrelation,
  recordLegacyExecution,
} from '../platform/maviCore/wiring/maviEvidence';
import { commandIdentityOf, type ParsedCommandLike, type VoiceLifecycleEventLike } from '../platform/maviCore/wiring/maviVoiceBridge';
import type { PilotHandlerDeps } from '../platform/maviCore/wiring/maviPilotHandlers';

function pilotDeps(over: Partial<PilotHandlerDeps> = {}): PilotHandlerDeps {
  return {
    setTheme: vi.fn(), openScreen: () => true, mediaPlay: vi.fn(), mediaPause: vi.fn(),
    mediaNext: vi.fn(), setVolume: vi.fn(), navigateTo: vi.fn(), openNavScreen: () => true,
    cancelNavigation: vi.fn(),
    readHealth: async () => ({ dtcCount: 0, criticalCount: 0, summary: 'x' }),
    ...over,
  };
}

interface Harness {
  dispatch: (c: ParsedCommandLike) => void;
  emit: (e: VoiceLifecycleEventLike) => void;
  handle: ReturnType<typeof createMaviWiring>;
}

function setup(opts: { takeover?: boolean; mediaNext?: () => void } = {}): Harness {
  let cmdL: ((c: ParsedCommandLike) => void) | null = null;
  // Gerçek voiceService bir Set multiplexer'dır — iki abone (köprü + telemetri) AYNI olayı alır.
  const stateSubs = new Set<(e: VoiceLifecycleEventLike) => void>();
  let clock = 1_000;
  const mode = opts.takeover ? 'takeover' : 'shadow';
  const handle = createMaviWiring({
    pilotDeps: pilotDeps(opts.mediaNext ? { mediaNext: opts.mediaNext } : {}),
    registerCommandHandler: (fn) => { cmdL = fn; return () => { cmdL = null; }; },
    subscribeVoiceState: (fn) => { stateSubs.add(fn); return () => { stateSubs.delete(fn); }; },
    ttsCancel: vi.fn(),
    mode,
    policy: createTakeoverPolicy({ mode, allowlist: ['media.next'] }),
    arbiter: createTakeoverArbiter({ now: () => clock }),
    now: () => clock,
  });
  handle.start();
  return {
    dispatch: (c) => cmdL?.(c),
    emit: (e) => { for (const fn of [...stateSubs]) fn(e); },
    handle,
  };
}

const flush = async (): Promise<void> => { for (let i = 0; i < 4; i++) await new Promise<void>((r) => setTimeout(r, 0)); };
const NEXT: ParsedCommandLike = { type: 'music_next', raw: 'sonraki şarkı' };

beforeEach(() => { _resetMaviEvidenceForTest(); });

/* ── Correlation saf türetim ─────────────────────────────── */

describe('PR-DIAG-2 — correlation saf türetim', () => {
  it('aynı gen+session → aynı oturum correlationId (state yok)', () => {
    expect(sessionCorrelationId(2, 5)).toBe('g2.s5');
    expect(sessionCorrelationId(2, 5)).toBe(sessionCorrelationId(2, 5));
  });

  it('komut correlationId oturum kimliğini prefix alır (join edilebilir)', () => {
    const cid = commandCorrelationId(2, 5, 'abc');
    expect(cid).toBe('g2.s5#abc');
    expect(cid.startsWith(sessionCorrelationId(2, 5))).toBe(true);
  });

  it('ambient correlation set/clear çalışır ve boş değeri null\'a çevirir', () => {
    setCurrentCorrelation('g1.s1#x');
    expect(getCurrentCorrelation()).toBe('g1.s1#x');
    setCurrentCorrelation('');
    expect(getCurrentCorrelation()).toBeNull();
  });
});

/* ── Üretici #1: lifecycle ham olay ──────────────────────── */

describe('PR-DIAG-2 — lifecycle ham olay üreticisi', () => {
  it('her voice-state olayı ham kayıt + correlationId + latency üretir', async () => {
    const h = setup({ takeover: false });
    h.emit({ phase: 'wake_detected', generationId: 1, sessionId: 1, at: 100 });
    h.emit({ phase: 'listening', generationId: 1, sessionId: 1, at: 250 });
    h.emit({ phase: 'transcribing', generationId: 1, sessionId: 1, at: 400 });
    const r = buildMaviEvidenceReport();
    expect(r.lifecycleEvents.length).toBe(3);
    expect(r.lifecycleEvents[0]).toMatchObject({ phase: 'wake_detected', correlationId: 'g1.s1' });
    expect(r.lifecycleEvents[1]?.latencyMs).toBe(150); // 250-100
    expect(r.phaseCoverage.find((p) => p.id === 'phase.wake_detected')?.verdict).toBe('OBSERVED');
  });

  it('emit edilmeyen fazlar raporda NO_SOURCE kalır (üretici uydurmaz)', async () => {
    const h = setup({ takeover: false });
    h.emit({ phase: 'listening', generationId: 1, sessionId: 1, at: 10 });
    const r = buildMaviEvidenceReport();
    expect(r.phaseCoverage.find((p) => p.id === 'phase.planning')?.verdict).toBe('NO_SOURCE');
    expect(r.phaseCoverage.find((p) => p.id === 'phase.speech_end')?.verdict).toBe('NO_SOURCE');
  });
});

/* ── Üretici #2: komut kararı ────────────────────────────── */

describe('PR-DIAG-2 — komut kararı üreticisi', () => {
  it('TAKEOVER: media.next kararı executedBy=mavi + owner=mavi + completed release', async () => {
    const h = setup({ takeover: true });
    h.emit({ phase: 'listening', generationId: 1, sessionId: 1, at: 10 });
    h.dispatch({ ...NEXT });
    await flush();
    const r = buildMaviEvidenceReport();
    const d = r.takeoverDecisions.find((x) => x.resolvedAction === 'media.next');
    expect(d?.executedBy).toBe('mavi');
    expect(d?.owner).toBe('mavi');
    expect(d?.ownershipDecision).toBe(true);
    expect(d?.releaseReason).toBe('completed');
    expect(d?.correlationId).toBe(commandCorrelationId(1, 1, commandIdentityOf(NEXT)));
  });

  it('SHADOW: karar executedBy=none (gerçek servis yok)', async () => {
    const h = setup({ takeover: false });
    h.dispatch({ ...NEXT });
    await flush();
    const d = buildMaviEvidenceReport().takeoverDecisions[0];
    expect(d?.executedBy).toBe('none');
    expect(d?.flagState).toBe('shadow');
  });

  it('duplicate ikinci komut ayrı karar kaydı üretir (claimOutcome=duplicate)', async () => {
    const h = setup({ takeover: true });
    h.emit({ phase: 'listening', generationId: 1, sessionId: 1, at: 10 });
    h.dispatch({ ...NEXT });
    await flush();
    h.dispatch({ ...NEXT });
    await flush();
    const decisions = buildMaviEvidenceReport().takeoverDecisions;
    expect(decisions.some((d) => d.claimOutcome === 'duplicate')).toBe(true);
  });
});

/* ── Üretici #3: media.next port ─────────────────────────── */

describe('PR-DIAG-2 — media.next port üreticisi', () => {
  it('queue varken: duck çağrıldı + next çağrıldı + serviceResult ok + nextCallCount artar', () => {
    const port = createMediaNextPort({
      cancelAssistantDuck: vi.fn(), hasQueue: () => true, hasSession: () => false, next: vi.fn(),
    });
    setCurrentCorrelation('g1.s1#k');
    port();
    setCurrentCorrelation(null);
    const m = buildMaviEvidenceReport().mediaNext[0];
    expect(m).toMatchObject({
      correlationId: 'g1.s1#k', port: 'mavi', nextCallCount: 1,
      cancelAssistantDuckCalled: true, hasQueue: true, nextCalled: true, serviceResult: 'ok',
    });
  });

  it('ön-koşul yokken: next çağrılmaz, serviceResult unavailable', () => {
    const next = vi.fn();
    const port = createMediaNextPort({
      cancelAssistantDuck: vi.fn(), hasQueue: () => false, hasSession: () => false, next,
    });
    expect(() => port()).toThrow();
    expect(next).not.toHaveBeenCalled();
    const m = buildMaviEvidenceReport().mediaNext[0];
    expect(m.serviceResult).toBe('unavailable');
    expect(m.nextCalled).toBe(false);
  });

  it('port iki kez çağrılırsa nextCallCount 2 olur → çift atlama KRİTİK', () => {
    const port = createMediaNextPort({
      cancelAssistantDuck: vi.fn(), hasQueue: () => true, hasSession: () => false, next: vi.fn(),
    });
    setCurrentCorrelation('g1.s1#k');
    port(); port();
    setCurrentCorrelation(null);
    const r = buildMaviEvidenceReport();
    expect(r.mediaNext[r.mediaNext.length - 1]?.nextCallCount).toBe(2);
    expect(r.criticalFindings.some((f) => f.includes('tek turda'))).toBe(true);
  });
});

/* ── Üretici #4: legacy yürütme (uçtan uca correlation join) ─ */

describe('PR-DIAG-2 — legacy yürütme + çift yürütme tespiti', () => {
  it('SHADOW: eski hat çalıştırır → legacyExecuted 1, Mavi 0, kritik YOK', async () => {
    // SHADOW'da köprü gerçek servisi çağırmaz; eski hattı taklit et.
    recordLegacyExecution({
      generationId: 1, sessionId: 1, commandId: commandIdentityOf(NEXT),
      resolvedAction: 'media.next', atMs: 1_000,
    });
    const r = buildMaviEvidenceReport();
    expect(r.mediaNextTotals.legacyExecuted).toBe(1);
    expect(r.mediaNextTotals.maviExecuted).toBe(0);
    expect(r.criticalFindings).toHaveLength(0);
  });

  it('AYNI correlationId hem köprü(mavi) hem legacy → ÇİFT YÜRÜTME kritiği', async () => {
    const h = setup({ takeover: true });
    h.emit({ phase: 'listening', generationId: 1, sessionId: 1, at: 10 });
    h.dispatch({ ...NEXT });
    await flush();
    // Aynı komutu eski hat da yürütmüş gibi kaydet (bozuk senaryo).
    recordLegacyExecution({
      generationId: 1, sessionId: 1, commandId: commandIdentityOf(NEXT),
      resolvedAction: 'media.next', atMs: 1_000,
    });
    const r = buildMaviEvidenceReport();
    expect(r.criticalFindings.some((f) => f.includes('ÇİFT YÜRÜTME'))).toBe(true);
  });
});

/* ── Üretici #5: lifecycle sayaçları + sızıntı ───────────── */

describe('PR-DIAG-2 — lifecycle sayaçları', () => {
  it('start/dispose sayılır; tek kayıt → sızıntı yok', () => {
    const h = setup({ takeover: true });
    const before = buildMaviEvidenceReport().lifecycleCounters;
    expect(before.starts).toBe(1);
    expect(before.commandListeners).toBe(1);
    expect(before.voiceStateSubscriptions).toBe(1);
    h.handle.dispose();
    const after = buildMaviEvidenceReport().lifecycleCounters;
    expect(after.disposes).toBe(1);
    expect(after.commandListeners).toBe(0);
    expect(after.voiceStateSubscriptions).toBe(0);
  });

  it('start idempotent → ikinci start sayacı ARTIRMAZ (sızıntı yok)', () => {
    const h = setup({ takeover: true });
    h.handle.start(); h.handle.start();
    const c = buildMaviEvidenceReport().lifecycleCounters;
    expect(c.starts).toBe(1);
    expect(c.commandListeners).toBe(1);
    expect(c.voiceStateSubscriptions).toBe(1);
    expect(buildMaviEvidenceReport().checklist.find((x) => x.id === 'lifecycle.noLeak')?.verdict).toBe('OBSERVED');
  });
});

/* ── Davranış değişmezliği + fail-soft ───────────────────── */

describe('PR-DIAG-2 — davranış değişmez / fail-soft', () => {
  it('TAKEOVER media.next hâlâ TAM 1 kez gerçek servisi çağırır (üretici davranışı bozmaz)', async () => {
    const mediaNext = vi.fn();
    const h = setup({ takeover: true, mediaNext });
    h.emit({ phase: 'listening', generationId: 1, sessionId: 1, at: 10 });
    h.dispatch({ ...NEXT });
    await flush();
    expect(mediaNext).toHaveBeenCalledTimes(1);
  });

  it('gerçek servis THROW etse bile üretici raporu yine yazılır + ownership serbest', async () => {
    const h = setup({ takeover: true, mediaNext: () => { throw new Error('servis düştü'); } });
    h.emit({ phase: 'listening', generationId: 1, sessionId: 1, at: 10 });
    h.dispatch({ ...NEXT });
    await flush();
    const d = buildMaviEvidenceReport().takeoverDecisions.find((x) => x.executedBy === 'mavi');
    expect(d?.errorReason).toBeTruthy();
    expect(d?.releaseReason).toBe('error');
  });

  it('correlation tur sonunda TEMİZLENİR (bağlam sızmaz)', async () => {
    const h = setup({ takeover: true });
    h.emit({ phase: 'listening', generationId: 1, sessionId: 1, at: 10 });
    h.dispatch({ ...NEXT });
    await flush();
    expect(getCurrentCorrelation()).toBeNull();
  });
});
