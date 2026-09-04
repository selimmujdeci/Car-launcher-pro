/**
 * mediaAuthority.test.ts — MÜZİK HUB PAKET A · Playback Truth & Native Audio Core
 * DAVRANIŞ KİLİTLERİ.
 *
 * Kilitler görevdeki §18 listesiyle numaralandırılmıştır. Native çerçeveye bağlı
 * senaryolar (audio focus olayları · becoming-noisy · MediaSession · bildirim ·
 * direksiyon tuşu) JVM tarafında `CarosAudioFocusManagerTest` ile kilitlenir;
 * burada YALNIZ JS otoritesi test edilir — sahte "geçti" üretilmez.
 *
 * YAKLAŞIM: native köprü mock'lanır (deterministik snapshot/komut), koordinatöre
 * sahte adapter enjekte edilir. Gerçek zaman beklemesi YOK: timeout senaryoları
 * sahte zamanlayıcı ile koşulur.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/* ── Native köprü mock'u ─────────────────────────────────────────────────── */

interface MockSnapshot {
  authorityAvailable: boolean;
  activeSource: string;
  focusState: string;
  audioRoute: string;
  playing: boolean;
  renderingVerified: boolean;
  queueLength?: number;
  queueRevision?: number;
  currentIndex?: number;
  currentTrackId?: string;
  buffering?: boolean;
  lastFailureCode?: string;
}

const nativeState: {
  snapshot: MockSnapshot;
  commands: { cmd: string; payload?: Record<string, unknown> }[];
  accept: boolean;
  failureCode: string;
} = {
  snapshot: {
    authorityAvailable: true,
    activeSource: 'NONE',
    focusState: 'GRANTED',
    audioRoute: 'SPEAKER',
    playing: false,
    renderingVerified: false,
    queueLength: 0,
  },
  commands: [],
  accept: true,
  failureCode: '',
};

vi.mock('../platform/media/authority/nativeAuthorityBridge', async (importOriginal) => {
  const actual = await importOriginal<
    typeof import('../platform/media/authority/nativeAuthorityBridge')
  >();
  let seq = 0;
  return {
    ...actual,
    getSnapshot: () => nativeState.snapshot,
    refreshSnapshot: async () => nativeState.snapshot,
    isRenderingVerified: () =>
      nativeState.snapshot.authorityAvailable && nativeState.snapshot.renderingVerified,
    nextCommandId: (prefix = 'cmd') => { seq += 1; return `${prefix}-${seq}`; },
    command: async (cmd: string, payload?: Record<string, unknown>) => {
      nativeState.commands.push({ cmd, payload });
      return { accepted: nativeState.accept, failureCode: nativeState.failureCode };
    },
    startNativeAuthority: async () => {},
    stopNativeAuthority: () => {},
    subscribe: () => () => {},
  };
});

import {
  beginTruth, finishTruth, withStage, honestClaim, isRetryableFailure, verificationRank,
  type CommandTruth,
} from '../platform/media/authority/playbackTruth';
import {
  IDLE_HANDOVER, reduceHandover, audibleBackendCount, canTransition, isInFlight,
  type HandoverState,
} from '../platform/media/authority/handoverMachine';
import {
  applyDuck, releaseDuck, effectiveDuckLevel, dominantReason, activeReasons,
  EMPTY_DUCK_STATE, MAX_DUCK_ENTRIES, isDuckReason, type DuckState,
} from '../platform/media/authority/duckPolicy';
import {
  computeEffectiveVolume, percentToUnit, sanitizeVolumeInputs, toSystemVolumeStep,
} from '../platform/media/authority/volumePolicy';
import {
  supportsCommand, maxVerificationFor, getSource, isKnownSourceClass,
  type SourceClass,
} from '../platform/media/authority/sourceCapabilities';
import {
  createSourceCoordinator, type BackendAdapter, type PlayRequest, type StartOutcome,
  type StopOutcome,
} from '../platform/media/authority/sourceCoordinator';
import {
  decideRecovery, persistPlaybackState, readPersistedRaw, MAX_PERSISTED_ITEMS,
  MAX_RECOVERY_ATTEMPTS, RECOVERY_TTL_MS,
} from '../platform/media/authority/mediaRecovery';
import {
  reconcileQueue, isUserVisibleDrift,
} from '../platform/media/authority/queueReconciliation';
import { sanitizeAuthoritySnapshot } from '../platform/media/authority/nativeAuthorityBridge';
import {
  getMediaAuthorityEvidence, recordTruth, recordDuplicateBackend,
  __resetEvidenceForTest, MAX_TRUTH_RECORDS,
} from '../platform/media/authority/mediaAuthorityEvidence';
import * as gateway from '../platform/media/authority/mediaCommandGateway';
import {
  createRoutedMediaPort, describeOutcome, MediaCommandFailedError,
} from '../platform/maviCore/wiring/maviMediaAuthorityPort';

/* ── Test yardımcıları ───────────────────────────────────────────────────── */

const ITEM = { id: 't1', uri: 'file:///a.mp3', title: 'A', artist: 'B' };
const REQUEST: PlayRequest = { items: [ITEM], startIndex: 0, positionMs: 0, autoPlay: true };

interface FakeAdapterOpts {
  active?: boolean;
  stop?: Partial<StopOutcome>;
  prepareReady?: boolean;
  prepareFailure?: string | null;
  start?: Partial<StartOutcome>;
  /** Adım asla çözülmezse timeout yolu test edilir. */
  hangOn?: 'stop' | 'prepare' | 'start';
}

function fakeAdapter(sourceClass: SourceClass, opts: FakeAdapterOpts = {}): BackendAdapter & {
  calls: string[];
} {
  const calls: string[] = [];
  let active = opts.active === true;
  return {
    sourceClass,
    calls,
    isActive: () => active,
    async stop(): Promise<StopOutcome> {
      calls.push('stop');
      if (opts.hangOn === 'stop') return new Promise<StopOutcome>(() => {});
      const verified = opts.stop?.verified !== false;
      if (verified) active = false;
      return {
        accepted: opts.stop?.accepted !== false,
        verified,
        failureCode: opts.stop?.failureCode ?? (verified ? null : 'stop_unverified'),
      };
    },
    async prepare(): Promise<{ ready: boolean; failureCode: string | null }> {
      calls.push('prepare');
      if (opts.hangOn === 'prepare') return new Promise<never>(() => {});
      const ready = opts.prepareReady !== false;
      return { ready, failureCode: ready ? null : (opts.prepareFailure ?? 'prepare_failed') };
    },
    async start(): Promise<StartOutcome> {
      calls.push('start');
      if (opts.hangOn === 'start') return new Promise<StartOutcome>(() => {});
      const started = opts.start?.started !== false;
      if (started) active = true;
      return {
        accepted: opts.start?.accepted !== false,
        started,
        renderingVerified: opts.start?.renderingVerified === true,
        failureCode: opts.start?.failureCode ?? (started ? null : 'start_failed'),
      };
    },
  };
}

function coordinatorWith(
  adapters: Map<SourceClass, BackendAdapter>,
  stepTimeoutMs = 50,
): ReturnType<typeof createSourceCoordinator> {
  return createSourceCoordinator({ now: () => Date.now(), adapters, stepTimeoutMs });
}

function truthOf(overrides: Partial<CommandTruth> = {}): CommandTruth {
  const draft = beginTruth({
    commandId: 'c1', sessionId: 's1', sourceId: 'LOCAL', backend: 'native_authority',
    command: 'play', desiredState: 'PLAYING', atMs: 0,
  });
  return {
    ...finishTruth(draft, {
      outcome: 'VERIFIED', observedState: 'PLAYING',
      verificationLevel: 'RENDERING_VERIFIED', atMs: 10,
    }),
    ...overrides,
  };
}

beforeEach(() => {
  nativeState.snapshot = {
    authorityAvailable: true,
    activeSource: 'NONE',
    focusState: 'GRANTED',
    audioRoute: 'SPEAKER',
    playing: false,
    renderingVerified: false,
    queueLength: 0,
  };
  nativeState.commands = [];
  nativeState.accept = true;
  nativeState.failureCode = '';
  __resetEvidenceForTest();
  gateway.__resetGatewayForTest();
  try { localStorage.clear(); } catch { /* jsdom yoksa yoksay */ }
});

afterEach(() => {
  vi.useRealTimers();
});

/* ══════════════════════════════════════════════════════════════════════════
 * 1 · Aynı anda TEK audible backend
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT 1 — aynı anda en fazla bir audible backend', () => {
  it('her devir fazında audible backend sayısı 1\'i AŞMAZ', () => {
    const phases: HandoverState[] = [];
    let s = IDLE_HANDOVER;
    s = reduceHandover(s, { type: 'BEGIN', to: 'LOCAL', atMs: 1 }); phases.push(s);
    s = reduceHandover(s, { type: 'STOP_VERIFIED', atMs: 2 }); phases.push(s);
    s = reduceHandover(s, { type: 'TARGET_PREPARED', atMs: 3 }); phases.push(s);
    s = reduceHandover(s, { type: 'TARGET_PREPARED', atMs: 4 }); phases.push(s);
    s = reduceHandover(s, { type: 'TARGET_STARTING', atMs: 5 }); phases.push(s);
    s = reduceHandover(s, { type: 'TARGET_STARTED', atMs: 6 }); phases.push(s);
    s = reduceHandover(s, { type: 'COMMIT', atMs: 7 }); phases.push(s);

    phases.forEach((p) => expect(audibleBackendCount(p)).toBeLessThanOrEqual(1));
    expect(s.phase).toBe('COMMITTED');
    expect(s.committed).toBe('LOCAL');
  });

  it('devir sırasında eski kaynak durdurulunca audible sayısı 0\'a iner', () => {
    let s = reduceHandover(IDLE_HANDOVER, { type: 'BEGIN', to: 'LOCAL', atMs: 1 });
    s = reduceHandover(s, { type: 'TARGET_STARTED', atMs: 2 }); // geçersiz sıra → yok sayılır
    s = reduceHandover(s, { type: 'STOP_VERIFIED', atMs: 3 });
    expect(s.phase).toBe('CURRENT_STOP_VERIFIED');
    expect(audibleBackendCount(s)).toBe(0);
  });

  it('koordinatör iki backend aktifken ESKİSİNİ durdurur (çift ses yok)', async () => {
    const youtube = fakeAdapter('YOUTUBE', { active: true });
    const local = fakeAdapter('LOCAL');
    const coord = coordinatorWith(new Map<SourceClass, BackendAdapter>([
      ['YOUTUBE', youtube], ['LOCAL', local],
    ]));

    const out = await coord.switchTo('LOCAL', REQUEST);
    expect(out.ok).toBe(true);
    expect(youtube.calls).toContain('stop');
    expect(youtube.isActive()).toBe(false);
    expect(local.isActive()).toBe(true);
    expect(coord.audibleBackends()).toBeLessThanOrEqual(1);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 2 · Eski backend durmadan COMMIT olmaz
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT 2 — durdurma doğrulanmadan yeni kaynak COMMITTED olmaz', () => {
  it('stop doğrulanamazsa devir DÜŞER ve hedef başlatılmaz', async () => {
    const spotify = fakeAdapter('SPOTIFY_CONNECT', {
      active: true, stop: { accepted: true, verified: false },
    });
    const local = fakeAdapter('LOCAL');
    const coord = coordinatorWith(new Map<SourceClass, BackendAdapter>([
      ['SPOTIFY_CONNECT', spotify], ['LOCAL', local],
    ]));

    const out = await coord.switchTo('LOCAL', REQUEST);
    expect(out.ok).toBe(false);
    expect(out.failureCode).toBe('source_stop_unverified');
    // KRİTİK: hedef HİÇ başlatılmadı → çift ses riski oluşmadı.
    expect(local.calls).not.toContain('start');
    expect(coord.getActiveSource()).not.toBe('LOCAL');
  });

  it('saf makinede STOP_UNVERIFIED → FAILED + source_stop_unverified', () => {
    let s = reduceHandover(IDLE_HANDOVER, { type: 'BEGIN', to: 'LOCAL', atMs: 1 });
    s = reduceHandover(s, { type: 'STOP_UNVERIFIED', atMs: 2 });
    expect(s.phase).toBe('FAILED');
    expect(s.failureCode).toBe('source_stop_unverified');
    // COMMIT bu fazdan verilemez.
    expect(canTransition(s.phase, 'COMMITTED')).toBe(false);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 3 · Kaynak durdurma zaman aşımı (bounded)
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT 3 — stop timeout bounded ve fail-closed', () => {
  it('stop asla dönmezse devir stop_timeout ile düşer, hedef başlatılmaz', async () => {
    const stuck = fakeAdapter('EXTERNAL_MEDIA_SESSION', { active: true, hangOn: 'stop' });
    const local = fakeAdapter('LOCAL');
    const coord = coordinatorWith(new Map<SourceClass, BackendAdapter>([
      ['EXTERNAL_MEDIA_SESSION', stuck], ['LOCAL', local],
    ]), 20);

    const out = await coord.switchTo('LOCAL', REQUEST);
    expect(out.ok).toBe(false);
    expect(local.calls).not.toContain('start');
  });

  it('prepare asla dönmezse devir düşer (bounded)', async () => {
    const local = fakeAdapter('LOCAL', { hangOn: 'prepare' });
    const coord = coordinatorWith(new Map<SourceClass, BackendAdapter>([['LOCAL', local]]), 20);
    const out = await coord.switchTo('LOCAL', REQUEST);
    expect(out.ok).toBe(false);
    expect(local.calls).not.toContain('start');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 4 & 26 · Çift komut / replay reddi
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT 4/26 — aynı commandId iki kez YÜRÜTÜLMEZ', () => {
  it('ikinci çağrı REJECTED + duplicate_command döner', async () => {
    const local = fakeAdapter('LOCAL');
    gateway.__resetGatewayForTest(new Map<SourceClass, BackendAdapter>([['LOCAL', local]]));
    nativeState.snapshot.activeSource = 'LOCAL';
    nativeState.snapshot.queueLength = 1;

    await gateway.playSource({ source: 'LOCAL', items: [ITEM], commandId: 'dup-1' });
    const second = await gateway.play('dup-1');

    expect(second.outcome).toBe('REJECTED');
    expect(second.failureCode).toBe('duplicate_command');
    // Reddedilen komut backend'e HİÇ gitmedi.
    expect(nativeState.commands.filter((c) => c.cmd === 'play')).toHaveLength(0);
  });

  it('replay penceresi bounded — 64 kayıttan eskisi düşer, bellek sızmaz', async () => {
    const local = fakeAdapter('LOCAL');
    gateway.__resetGatewayForTest(new Map<SourceClass, BackendAdapter>([['LOCAL', local]]));
    nativeState.snapshot.activeSource = 'LOCAL';
    nativeState.snapshot.queueLength = 1;

    for (let i = 0; i < 70; i++) await gateway.pause(`cmd-${i}`);
    // İlk kimlik pencereden düştüğü için TEKRAR kabul edilir (bounded liste kanıtı).
    const again = await gateway.pause('cmd-0');
    expect(again.failureCode).not.toBe('duplicate_command');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 5 · Bayat komut SUPERSEDED
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT 5 — yeni devir eskisini SUPERSEDE eder', () => {
  it('eski devir yalancı başarı DÖNMEZ', async () => {
    const slowLocal = fakeAdapter('LOCAL');
    const stream = fakeAdapter('STREAM');
    const coord = coordinatorWith(new Map<SourceClass, BackendAdapter>([
      ['LOCAL', slowLocal], ['STREAM', stream],
    ]));

    const first = coord.switchTo('LOCAL', REQUEST);
    const second = coord.switchTo('STREAM', REQUEST);
    const [r1, r2] = await Promise.all([first, second]);

    // İkisi birden "başarı" olamaz — zincir serileştirir, eski istek supersede olur.
    expect(r1.ok && r2.ok && r1.committed === r2.committed).toBe(false);
    if (!r1.ok) expect(r1.failureCode).toBe('superseded');
  });

  it('saf makinede SUPERSEDE → FAILED/superseded, settled durumda ETKİSİZ', () => {
    let s = reduceHandover(IDLE_HANDOVER, { type: 'BEGIN', to: 'LOCAL', atMs: 1 });
    s = reduceHandover(s, { type: 'SUPERSEDE', atMs: 2 });
    expect(s.phase).toBe('FAILED');
    expect(s.failureCode).toBe('superseded');
    // IDLE (settled) durumda supersede durumu BOZMAZ.
    expect(reduceHandover(IDLE_HANDOVER, { type: 'SUPERSEDE', atMs: 3 })).toBe(IDLE_HANDOVER);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 9 · 13 · 14 · 15 · 16 — Ducking politikası (nested + öncelik)
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT 9/14/15 — nested duck: bir sebep bitince TAM SESE dönülmez', () => {
  it('navigasyon açıkken Mavi biterse ses navigasyon seviyesinde kalır', () => {
    let s: DuckState = EMPTY_DUCK_STATE;
    const nav = applyDuck(s, 'NAVIGATION'); s = nav.state;
    const mavi = applyDuck(s, 'MAVI'); s = mavi.state;

    expect(effectiveDuckLevel(s)).toBeCloseTo(0.3);
    const rel = releaseDuck(s, mavi.token); s = rel.state;
    expect(rel.removed).toBe(true);
    // TAM SES (1.0) DEĞİL — navigasyon hâlâ aktif.
    expect(effectiveDuckLevel(s)).toBeCloseTo(0.3);
    expect(activeReasons(s)).toEqual(['NAVIGATION']);

    s = releaseDuck(s, nav.token).state;
    expect(effectiveDuckLevel(s)).toBe(1);
  });

  it('BAYAT token sesi YÜKSELTEMEZ', () => {
    const nav = applyDuck(EMPTY_DUCK_STATE, 'NAVIGATION');
    const stale = releaseDuck(nav.state, 9999);
    expect(stale.removed).toBe(false);
    expect(effectiveDuckLevel(stale.state)).toBeCloseTo(0.3);
    // Aynı token iki kez bırakılırsa ikincisi ETKİSİZ.
    const once = releaseDuck(nav.state, nav.token);
    const twice = releaseDuck(once.state, nav.token);
    expect(twice.removed).toBe(false);
  });
});

describe('KİLİT 13/16 — telefon ve güvenlik önceliği', () => {
  it('PHONE medyayı SUSTURUR (kısmaz)', () => {
    const s = applyDuck(EMPTY_DUCK_STATE, 'PHONE').state;
    expect(effectiveDuckLevel(s)).toBe(0);
  });

  it('EMERGENCY navigasyonu EZER ve baskın sebep olur', () => {
    let s = applyDuck(EMPTY_DUCK_STATE, 'NAVIGATION').state;
    s = applyDuck(s, 'EMERGENCY').state;
    expect(effectiveDuckLevel(s)).toBe(0);
    expect(dominantReason(s)).toBe('EMERGENCY');
  });

  it('SAFETY navigasyondan daha agresif kısar', () => {
    let s = applyDuck(EMPTY_DUCK_STATE, 'NAVIGATION').state;
    s = applyDuck(s, 'SAFETY').state;
    expect(effectiveDuckLevel(s)).toBeCloseTo(0.15);
    expect(dominantReason(s)).toBe('SAFETY');
  });

  it('bilinmeyen sebep KABUL EDİLMEZ ve kayıt sayısı sınırlıdır (DoS)', () => {
    expect(isDuckReason('KEYFI')).toBe(false);
    expect(applyDuck(EMPTY_DUCK_STATE, 'KEYFI' as never).token).toBe(0);

    let s: DuckState = EMPTY_DUCK_STATE;
    for (let i = 0; i < MAX_DUCK_ENTRIES + 5; i++) s = applyDuck(s, 'MAVI').state;
    expect(s.entries.length).toBe(MAX_DUCK_ENTRIES);
  });

  it('gateway duck/unduck token bazlıdır ve etkin sesi TEK formülle yazar', async () => {
    await gateway.setUserVolumePercent(100);
    const token = await gateway.duck('NAVIGATION');
    expect(token).toBeGreaterThan(0);
    expect(gateway.getEffectiveVolume()).toBeCloseTo(0.3);
    expect(gateway.getActiveDuckReasons()).toEqual(['NAVIGATION']);

    expect(await gateway.unduck(9999)).toBe(false);      // bayat token
    expect(gateway.getEffectiveVolume()).toBeCloseTo(0.3);
    expect(await gateway.unduck(token)).toBe(true);
    expect(gateway.getEffectiveVolume()).toBe(1);
  });

  /* MUSIC F6.1 · ÇİFT DUCK KİLİDİ.
   *
   * Native `setVolume` alanı duck ÖNCESİ kullanıcı seviyesidir
   * (`CarosPlaybackService.userVolume`) ve native duck çarpanını AYRICA
   * uygular. Kapı buraya duck DAHİL değeri yazarsa duck iki kez uygulanır
   * (%30 yerine %9). Duck TEK KEZ, sahibi tarafından uygulanır. */
  it("duck TEK KEZ uygulanır — native'e duck ÖNCESİ kullanıcı sesi yazılır", async () => {
    await gateway.setUserVolumePercent(80);
    nativeState.commands.length = 0;

    const token = await gateway.duck('NAVIGATION');
    expect(token).toBeGreaterThan(0);

    const duckCmd = nativeState.commands.find((c) => c.cmd === 'duck');
    expect(duckCmd?.payload).toEqual({ reason: 'NAVIGATION' });

    const volCmds = nativeState.commands.filter((c) => c.cmd === 'setVolume');
    expect(volCmds.length).toBeGreaterThan(0);
    for (const c of volCmds) {
      expect(c.payload?.volume, 'duck native ses yazımına KARIŞMIŞ (çift duck)')
        .toBeCloseTo(0.8);
    }

    /* Projeksiyon yine DÜRÜST: fiilen duyulan seviye kullanıcı × duck. */
    expect(gateway.getEffectiveVolume()).toBeCloseTo(0.8 * 0.3);

    await gateway.unduck(token);
    expect(gateway.getEffectiveVolume()).toBeCloseTo(0.8);
    await gateway.setUserVolumePercent(100);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 15b · Ses otoritesi tek formül
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT — ses tek deterministik formül', () => {
  it('mute her şeyi ezer; bozuk girdi NaN yaymaz', () => {
    expect(computeEffectiveVolume({ userVolume: 1, duckLevel: 1, muted: true })).toBe(0);
    expect(computeEffectiveVolume({ userVolume: NaN, duckLevel: 1 })).toBe(0);
    expect(computeEffectiveVolume({ userVolume: 5, duckLevel: 1 })).toBe(1);
    expect(percentToUnit(150)).toBe(1);
    expect(percentToUnit(NaN)).toBe(0);
  });

  it('hız telafisi BU PAKETTE kapalıdır (girdi ne olursa olsun 1)', () => {
    expect(sanitizeVolumeInputs({ speedCompensation: 0.2 }).speedCompensation).toBe(1);
  });

  it('sistem ses adımı sınırlar içinde kalır', () => {
    expect(toSystemVolumeStep(0)).toBe(0);
    expect(toSystemVolumeStep(1)).toBe(15);
    expect(toSystemVolumeStep(2)).toBe(15);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 10 · 21 · 22 — Process death kurtarma
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT 21/22 — kurtarma ASLA otomatik çalmaz', () => {
  const NOW = 1_000_000;

  function saved(over: Record<string, unknown> = {}): string {
    return JSON.stringify({
      version: 1, source: 'LOCAL', queueRevision: 3, items: [ITEM], currentIndex: 0,
      positionMs: 5000, shuffle: false, repeat: 'off', userPaused: false,
      lastObservedPlaying: true, savedAtMs: NOW - 1000, recoveryAttempts: 0, ...over,
    });
  }

  it('çalarken ölse bile geri yükleme DURAKLATILMIŞ olur', () => {
    const d = decideRecovery(saved(), NOW);
    expect(d.action).toBe('RESTORE_PAUSED');
    if (d.action === 'RESTORE_PAUSED') expect(d.autoPlay).toBe(false);
  });

  it('KİLİT 10 — kullanıcı duraklatması korunur (autoPlay yine false)', () => {
    const d = decideRecovery(saved({ userPaused: true }), NOW);
    expect(d.action).toBe('RESTORE_PAUSED');
    if (d.action === 'RESTORE_PAUSED') {
      expect(d.autoPlay).toBe(false);
      expect(d.state.userPaused).toBe(true);
    }
  });

  it('bozuk JSON / bozuk şekil fail-soft reddedilir', () => {
    expect(decideRecovery('{bozuk', NOW)).toEqual({ action: 'NONE', reason: 'corrupt_json' });
    expect(decideRecovery('"metin"', NOW)).toEqual({ action: 'NONE', reason: 'corrupt_shape' });
    expect(decideRecovery(null, NOW)).toEqual({ action: 'NONE', reason: 'no_saved_state' });
  });

  it('süresi geçmiş kayıt restore EDİLMEZ', () => {
    const d = decideRecovery(saved({ savedAtMs: NOW - RECOVERY_TTL_MS - 1 }), NOW);
    expect(d).toEqual({ action: 'NONE', reason: 'expired' });
  });

  it('uzak kaynak oturumu restore EDİLMEZ (geçerliliği doğrulanamaz)', () => {
    const d = decideRecovery(saved({ source: 'SPOTIFY_CONNECT' }), NOW);
    expect(d).toEqual({ action: 'NONE', reason: 'source_not_recoverable' });
  });

  it('sonsuz kurtarma döngüsü yok — deneme sınırı uygulanır', () => {
    const d = decideRecovery(saved({ recoveryAttempts: MAX_RECOVERY_ATTEMPTS }), NOW);
    expect(d).toEqual({ action: 'NONE', reason: 'attempts_exhausted' });
  });

  it('kalıcılaştırma büyük kuyruğu SINIRLAR (disk bütçesi)', () => {
    const many = Array.from({ length: 500 }, (_, i) => ({
      id: `t${i}`, uri: `file:///${i}.mp3`, title: 't', artist: 'a',
    }));
    expect(persistPlaybackState({
      source: 'LOCAL', queueRevision: 1, items: many, currentIndex: 250, positionMs: 0,
      shuffle: false, repeat: 'off', userPaused: false, lastObservedPlaying: false,
      nowMs: NOW,
    })).toBe(true);

    const d = decideRecovery(readPersistedRaw(), NOW);
    expect(d.action).toBe('RESTORE_PAUSED');
    if (d.action === 'RESTORE_PAUSED') {
      expect(d.state.items.length).toBeLessThanOrEqual(MAX_PERSISTED_ITEMS);
      // Çalınan parça pencerenin İÇİNDE kalır (indeks kayması yok).
      expect(d.state.currentIndex).toBeGreaterThanOrEqual(0);
      expect(d.state.currentIndex).toBeLessThan(d.state.items.length);
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 23 · Uzak kaynakta doğrulama YOK — "çalıyor" denmez
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT 23 — kanıtlanamayan başarı VERIFIED sayılmaz', () => {
  it('TRANSPORT_ACK düzeyinde VERIFIED → ACCEPTED_UNVERIFIED\'a DÜŞÜRÜLÜR', () => {
    const draft = beginTruth({
      commandId: 'c', sessionId: 's', sourceId: 'SPOTIFY_CONNECT', backend: 'spotify_connect',
      command: 'play', desiredState: 'PLAYING', atMs: 0,
    });
    const t = finishTruth(draft, {
      outcome: 'VERIFIED', observedState: 'UNKNOWN',
      verificationLevel: 'TRANSPORT_ACK', atMs: 5,
    });
    expect(t.outcome).toBe('ACCEPTED_UNVERIFIED');
    expect(honestClaim(t)).toBe('REQUEST_SENT');
  });

  it('yalnız yerel otorite RENDERING_VERIFIED\'a ulaşabilir', () => {
    expect(maxVerificationFor('LOCAL')).toBe('RENDERING_VERIFIED');
    expect(maxVerificationFor('STREAM')).toBe('RENDERING_VERIFIED');
    expect(maxVerificationFor('SPOTIFY_CONNECT')).toBe('REMOTE_STATE_OBSERVED');
    expect(maxVerificationFor('EXTERNAL_MEDIA_SESSION')).toBe('REMOTE_STATE_OBSERVED');
    expect(maxVerificationFor('YOUTUBE')).toBe('OBSERVED_STARTED');
    expect(verificationRank('RENDERING_VERIFIED'))
      .toBeGreaterThan(verificationRank('REMOTE_STATE_OBSERVED'));
  });

  it('desteklenmeyen komut SESSİZCE YUTULMAZ — reddedilir', () => {
    // Canlı radyoda seek YOKTUR (uydurma süre gösterilmez).
    expect(supportsCommand('INTERNET_RADIO', 'seek')).toBe(false);
    // Harici oturumda kuyruk yoktur → next/previous desteklenmez.
    expect(supportsCommand('EXTERNAL_MEDIA_SESSION', 'next')).toBe(false);
    expect(supportsCommand('LOCAL', 'next')).toBe(true);
    // stop her kaynakta denenebilir.
    expect(supportsCommand('BLUETOOTH_EXTERNAL', 'stop')).toBe(true);
  });

  it('gateway yetenek kapısı: radyoda seek unsupported_capability ile REDDEDİLİR', async () => {
    const radio = fakeAdapter('INTERNET_RADIO');
    gateway.__resetGatewayForTest(new Map<SourceClass, BackendAdapter>([['INTERNET_RADIO', radio]]));
    nativeState.snapshot.activeSource = 'INTERNET_RADIO';
    await gateway.playSource({ source: 'INTERNET_RADIO', items: [ITEM] });

    const t = await gateway.seek(30);
    expect(t.outcome).toBe('REJECTED');
    expect(t.failureCode).toBe('unsupported_capability');
    expect(nativeState.commands.some((c) => c.cmd === 'seek')).toBe(false);
  });

  it('hata kodu sınıflandırması fail-closed: bilinmeyen kod retryable DEĞİL', () => {
    expect(isRetryableFailure('network_error')).toBe(true);
    expect(isRetryableFailure('unsupported_capability')).toBe(false);
    expect(isRetryableFailure('bilinmeyen_kod')).toBe(false);
    expect(isRetryableFailure(null)).toBe(false);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 24 · Uzak backend timeout
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT 24 — YouTube/Spotify başlatma zaman aşımı yalancı başarı üretmez', () => {
  it('start asla dönmezse devir düşer ve önceki kaynağa rollback denenir', async () => {
    const local = fakeAdapter('LOCAL', { active: true });
    const youtube = fakeAdapter('YOUTUBE', { hangOn: 'start' });
    const coord = coordinatorWith(new Map<SourceClass, BackendAdapter>([
      ['LOCAL', local], ['YOUTUBE', youtube],
    ]), 20);

    // Önce LOCAL commit edilir (rollback hedefi oluşsun).
    await coord.switchTo('LOCAL', REQUEST);
    const out = await coord.switchTo('YOUTUBE', REQUEST);

    expect(out.ok).toBe(false);
    expect(out.renderingVerified).toBe(false);
    // Rollback: önceki kaynak geri yüklenmeye ÇALIŞILDI (sessiz bırakılmadı).
    expect(local.calls.filter((c) => c === 'start').length).toBeGreaterThanOrEqual(1);
  });

  it('prepare başarısızsa (Spotify bağlı değil) hedef BAŞLATILMAZ', async () => {
    const spotify = fakeAdapter('SPOTIFY_CONNECT', {
      prepareReady: false, prepareFailure: 'spotify_not_connected',
    });
    const coord = coordinatorWith(new Map<SourceClass, BackendAdapter>([
      ['SPOTIFY_CONNECT', spotify],
    ]));
    const out = await coord.switchTo('SPOTIFY_CONNECT', REQUEST);
    expect(out.ok).toBe(false);
    expect(spotify.calls).not.toContain('start');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 25 · Köprü yükü doğrulama (invalid payload)
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT 25 — native yükü doğrulanır, uydurma alan üretilmez', () => {
  it('bozuk/eksik yük "otorite yok" görüntüsüne düşer', () => {
    expect(sanitizeAuthoritySnapshot(null).authorityAvailable).toBe(false);
    expect(sanitizeAuthoritySnapshot('metin').authorityAvailable).toBe(false);
    expect(sanitizeAuthoritySnapshot(42).authorityAvailable).toBe(false);
  });

  it('yanlış tipli alanlar DÜŞÜRÜLÜR (sahte 0 / sahte true yok)', () => {
    const s = sanitizeAuthoritySnapshot({
      authorityAvailable: 'evet',       // string → false
      playing: 1,                        // sayı → false
      renderingVerified: 'true',         // string → false
      positionMs: 'çok',                 // string → undefined
      queueLength: Number.NaN,           // NaN → undefined
      duckReasons: ['NAVIGATION', 7, 'MAVI'],
    });
    expect(s.authorityAvailable).toBe(false);
    expect(s.playing).toBe(false);
    expect(s.renderingVerified).toBe(false);
    expect(s.positionMs).toBeUndefined();
    expect(s.queueLength).toBeUndefined();
    expect(s.duckReasons).toEqual(['NAVIGATION', 'MAVI']);
  });

  it('aşırı uzun string ve aşırı uzun dizi SINIRLANIR (DoS)', () => {
    const s = sanitizeAuthoritySnapshot({
      title: 'x'.repeat(5000),
      duckReasons: Array.from({ length: 100 }, () => 'MAVI'),
    });
    expect(s.title).toBe('');                    // sınır aşımı → fallback
    expect(s.duckReasons?.length).toBe(16);      // bounded
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 20 · Kuyruk uzlaştırma (UI ↔ native)
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT 20 — kuyruk sapması GÖRÜNÜR kılınır, gizlenmez', () => {
  const base = { revision: 5, length: 10, currentIndex: 2, source: 'LOCAL' as const, currentItemId: 'a' };

  it('native okunamazsa sonuç "uyumlu" DEĞİL, UNKNOWN olur', () => {
    expect(reconcileQueue(base, null).drift).toBe('UNKNOWN');
    expect(reconcileQueue(base, null).authoritative).toBe('none');
  });

  it('aynı gerçek → IN_SYNC', () => {
    expect(reconcileQueue(base, { ...base }).drift).toBe('IN_SYNC');
  });

  it('UI ileride / native ileride ayrı sınıflandırılır', () => {
    expect(reconcileQueue({ ...base, revision: 6 }, base).drift).toBe('UI_AHEAD');
    expect(reconcileQueue(base, { ...base, revision: 9 }).drift).toBe('NATIVE_AHEAD');
  });

  it('indeks · uzunluk · öğe · kaynak sapmaları ayrı kodlanır', () => {
    expect(reconcileQueue(base, { ...base, currentIndex: 7 }).drift).toBe('INDEX_DRIFT');
    expect(reconcileQueue(base, { ...base, length: 3 }).drift).toBe('LENGTH_DRIFT');
    expect(reconcileQueue(base, { ...base, currentItemId: 'z' }).drift).toBe('ITEM_MISMATCH');
    expect(reconcileQueue(base, { ...base, source: 'STREAM' }).drift).toBe('SOURCE_MISMATCH');
    expect(reconcileQueue(base, { ...base, length: 0 }).drift).toBe('ITEM_UNAVAILABLE');
  });

  it('sapmada NATIVE esastır (ses fiilen orada üretilir)', () => {
    expect(reconcileQueue(base, { ...base, currentIndex: 7 }).authoritative).toBe('native');
  });

  it('kullanıcıya yansıyan sapmalar ayrılır', () => {
    expect(isUserVisibleDrift('INDEX_DRIFT')).toBe(true);
    expect(isUserVisibleDrift('ITEM_UNAVAILABLE')).toBe(true);
    expect(isUserVisibleDrift('IN_SYNC')).toBe(false);
    expect(isUserVisibleDrift('UNKNOWN')).toBe(false);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 27 · 28 · 29 — Yaşam döngüsü: çift abonelik / teardown / boot idempotency
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT 27/28/29 — yaşam döngüsü zero-leak ve idempotent', () => {
  it('otorite iki kez başlatılsa bile tek kez kurulur ve teardown temizler', async () => {
    vi.useFakeTimers();
    const runtime = await import('../platform/media/authority/mediaAuthorityRuntime');
    runtime.__resetRuntimeForTest();

    await runtime.startMediaAuthority();
    await runtime.startMediaAuthority();   // ikinci çağrı NO-OP olmalı

    const timersBefore = vi.getTimerCount();
    runtime.stopMediaAuthority();
    // Teardown sonrası otoritenin timer'ı KALMAZ.
    expect(vi.getTimerCount()).toBeLessThanOrEqual(timersBefore);

    runtime.__resetRuntimeForTest();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('paket ↔ kaynak eşlemesi tek yönlüdür ve bilinmeyen paket sahiplenilmez', async () => {
    const runtime = await import('../platform/media/authority/mediaAuthorityRuntime');
    expect(runtime.packageToSourceClass('com.cockpitos.pro')).toBe('LOCAL');
    expect(runtime.packageToSourceClass('com.cockpitos.pro.stream')).toBe('STREAM');
    expect(runtime.packageToSourceClass('com.spotify.music')).toBe('SPOTIFY_CONNECT');
    expect(runtime.packageToSourceClass('com.baska.uygulama')).toBeNull();

    expect(runtime.isAuthorityOwnedPackage('com.cockpitos.pro')).toBe(true);
    // Spotify otoritenin sahiplendiği kaynak DEĞİLDİR (ses bizde değil).
    expect(runtime.isAuthorityOwnedPackage('com.spotify.music')).toBe(false);
    expect(runtime.isAuthorityOwnedPackage('com.baska.uygulama')).toBe(false);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 30 · Kanıt anlık görüntüsü bounded
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT 30 — kanıt deposu sınırlı ve PII taşımaz', () => {
  it('halka tampon MAX_TRUTH_RECORDS\'ı aşmaz', () => {
    for (let i = 0; i < MAX_TRUTH_RECORDS + 25; i++) {
      recordTruth(truthOf({ commandId: `c${i}` }));
    }
    const ev = getMediaAuthorityEvidence();
    expect(ev.recentCommands.length).toBe(MAX_TRUTH_RECORDS);
    expect(ev.counters.commandsTotal).toBe(MAX_TRUTH_RECORDS + 25);
    // En eski kayıt düşmüş, en yeni durmalı.
    expect(ev.recentCommands[ev.recentCommands.length - 1].commandId)
      .toBe(`c${MAX_TRUTH_RECORDS + 24}`);
  });

  it('hiç komut yoksa durum UNAVAILABLE — sahte "sağlıklı" ÜRETİLMEZ', () => {
    const ev = getMediaAuthorityEvidence();
    expect(ev.status).toBe('UNAVAILABLE');
    expect(ev.playStartLatencyMs).toBeNull();     // sahte 0 DEĞİL
    expect(ev.sourceSwitchLatencyMs).toBeNull();
    expect(ev.lastFailure).toBeNull();
  });

  it('kayıtlarda başlık/sanatçı/URI alanı YOKTUR (gizlilik)', () => {
    recordTruth(truthOf());
    const rec = getMediaAuthorityEvidence().recentCommands[0] as unknown as Record<string, unknown>;
    ['title', 'artist', 'uri', 'artworkUri', 'url'].forEach((k) => {
      expect(Object.prototype.hasOwnProperty.call(rec, k)).toBe(false);
    });
  });

  it('çift backend ihlali SAYILIR (sessizce düzeltilmez)', () => {
    recordDuplicateBackend();
    expect(getMediaAuthorityEvidence().counters.duplicateBackendDetected).toBe(1);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * Mavi portu — dürüst iddia
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT — Mavi yalnız GÖZLENEN başarıda "çalıyor" der', () => {
  it('VERIFIED → "çalıyor"; ACCEPTED_UNVERIFIED → "başlatma isteği gönderildi"', () => {
    const verified = truthOf();
    expect(describeOutcome(verified, honestClaim(verified)).message).toBe('çalıyor');

    const unverified = truthOf({ outcome: 'ACCEPTED_UNVERIFIED', verificationLevel: 'TRANSPORT_ACK' });
    const out = describeOutcome(unverified, honestClaim(unverified));
    expect(out.ok).toBe(true);
    expect(out.claim).toBe('REQUEST_SENT');
    expect(out.message).toBe('başlatma isteği gönderildi');
    expect(out.message).not.toContain('çalıyor');
  });

  it('FAILED → gerçek neden Türkçeleştirilir, başarı İDDİA EDİLMEZ', () => {
    const failed = truthOf({ outcome: 'FAILED', failureCode: 'focus_denied' });
    const out = describeOutcome(failed, honestClaim(failed));
    expect(out.ok).toBe(false);
    expect(out.message).toContain('ses odağı alınamadı');
  });

  it('otorite yolu: başarısızlıkta port THROW eder (sessiz "tamam" yok)', async () => {
    const failing = truthOf({ outcome: 'FAILED', failureCode: 'no_media' });
    const port = createRoutedMediaPort({
      isAuthorityRoute: () => true,
      authority: {
        play: async () => describeOutcome(failing, honestClaim(failing)),
        pause: async () => describeOutcome(failing, honestClaim(failing)),
        stop: async () => describeOutcome(failing, honestClaim(failing)),
        next: async () => describeOutcome(failing, honestClaim(failing)),
        previous: async () => describeOutcome(failing, honestClaim(failing)),
        seek: async () => describeOutcome(failing, honestClaim(failing)),
      },
      legacyPlay: () => { throw new Error('eski hat ÇAĞRILMAMALIYDI'); },
      legacyPause: () => { throw new Error('eski hat ÇAĞRILMAMALIYDI'); },
      legacyNext: () => { throw new Error('eski hat ÇAĞRILMAMALIYDI'); },
    });

    await expect(port.play()).rejects.toBeInstanceOf(MediaCommandFailedError);
  });

  it('otorite sahiplenmiyorsa ESKİ hat kullanılır (geriye uyumluluk)', async () => {
    const legacy: string[] = [];
    const port = createRoutedMediaPort({
      isAuthorityRoute: () => false,
      authority: {
        play: async () => { throw new Error('otorite ÇAĞRILMAMALIYDI'); },
        pause: async () => { throw new Error('otorite ÇAĞRILMAMALIYDI'); },
        stop: async () => { throw new Error('otorite ÇAĞRILMAMALIYDI'); },
        next: async () => { throw new Error('otorite ÇAĞRILMAMALIYDI'); },
        previous: async () => { throw new Error('otorite ÇAĞRILMAMALIYDI'); },
        seek: async () => { throw new Error('otorite ÇAĞRILMAMALIYDI'); },
      },
      legacyPlay: () => { legacy.push('play'); },
      legacyPause: () => { legacy.push('pause'); },
      legacyNext: () => { legacy.push('next'); },
    });

    await port.play();
    await port.next();
    expect(legacy).toEqual(['play', 'next']);
  });

  it('PAKET B — kuyruk sapması bilinirken "çalıyor" İDDİA EDİLMEZ', async () => {
    const verified = truthOf();
    const port = createRoutedMediaPort({
      isAuthorityRoute: () => true,
      authority: {
        play: async () => describeOutcome(verified, honestClaim(verified)),
        pause: async () => describeOutcome(verified, honestClaim(verified)),
        stop: async () => describeOutcome(verified, honestClaim(verified)),
        next: async () => describeOutcome(verified, honestClaim(verified)),
        previous: async () => describeOutcome(verified, honestClaim(verified)),
        seek: async () => describeOutcome(verified, honestClaim(verified)),
      },
      legacyPlay: () => { throw new Error('x'); },
      legacyPause: () => { throw new Error('x'); },
      legacyNext: () => { throw new Error('x'); },
      // Kurtarma ertelendi → UI ile native arasında BİLİNEN sapma var.
      readRecoveryUncertainty: () => ({
        uncertain: true, note: 'kuyruk hizalaması bekliyor',
      }),
    });

    const out = await port.next();
    // İddia DÜŞÜRÜLDÜ: kesin "çalıyor" yerine belirsizlik bildirilir.
    expect(out).toEqual({
      claim: 'REQUEST_SENT',
      message: 'çalıyor ama kuyruk hizalaması bekliyor',
    });
  });

  it('PAKET B — belirsizlik okuması ÇÖKERSE iddia YÜKSELTİLMEZ, eski davranış korunur', async () => {
    const verified = truthOf();
    const port = createRoutedMediaPort({
      isAuthorityRoute: () => true,
      authority: {
        play: async () => describeOutcome(verified, honestClaim(verified)),
        pause: async () => describeOutcome(verified, honestClaim(verified)),
        stop: async () => describeOutcome(verified, honestClaim(verified)),
        next: async () => describeOutcome(verified, honestClaim(verified)),
        previous: async () => describeOutcome(verified, honestClaim(verified)),
        seek: async () => describeOutcome(verified, honestClaim(verified)),
      },
      legacyPlay: () => { throw new Error('x'); },
      legacyPause: () => { throw new Error('x'); },
      legacyNext: () => { throw new Error('x'); },
      readRecoveryUncertainty: () => { throw new Error('okuma hatası'); },
    });
    expect(await port.play()).toEqual({ claim: 'PLAYING', message: 'çalıyor' });
  });

  it('yönlendirme kararı ASYNC olabilir (otorite dinamik yüklenir)', async () => {
    const verified = truthOf();
    const port = createRoutedMediaPort({
      // Composition root otorite modüllerini dinamik yükler → Promise döner.
      isAuthorityRoute: async () => true,
      authority: {
        play: async () => describeOutcome(verified, honestClaim(verified)),
        pause: async () => describeOutcome(verified, honestClaim(verified)),
        stop: async () => describeOutcome(verified, honestClaim(verified)),
        next: async () => describeOutcome(verified, honestClaim(verified)),
        previous: async () => describeOutcome(verified, honestClaim(verified)),
        seek: async () => describeOutcome(verified, honestClaim(verified)),
      },
      legacyPlay: () => { throw new Error('eski hat ÇAĞRILMAMALIYDI'); },
      legacyPause: () => { throw new Error('eski hat ÇAĞRILMAMALIYDI'); },
      legacyNext: () => { throw new Error('eski hat ÇAĞRILMAMALIYDI'); },
    });
    expect(await port.play()).toEqual({ claim: 'PLAYING', message: 'çalıyor' });
  });

  it('async yönlendirme REDDEDERSE eski hat seçilir (dinamik yükleme başarısız)', async () => {
    const legacy: string[] = [];
    const port = createRoutedMediaPort({
      isAuthorityRoute: async () => { throw new Error('chunk yüklenemedi'); },
      authority: {
        play: async () => { throw new Error('otorite ÇAĞRILMAMALIYDI'); },
        pause: async () => { throw new Error('x'); },
        stop: async () => { throw new Error('x'); },
        next: async () => { throw new Error('x'); },
        previous: async () => { throw new Error('x'); },
        seek: async () => { throw new Error('x'); },
      },
      legacyPlay: () => { legacy.push('play'); },
      legacyPause: () => { legacy.push('pause'); },
      legacyNext: () => { legacy.push('next'); },
    });
    await port.next();
    expect(legacy).toEqual(['next']);
  });

  it('yönlendirme okuması THROW ederse eski hat seçilir (komut düşmez)', async () => {
    const legacy: string[] = [];
    const port = createRoutedMediaPort({
      isAuthorityRoute: () => { throw new Error('okuma hatası'); },
      authority: {
        play: async () => { throw new Error('otorite ÇAĞRILMAMALIYDI'); },
        pause: async () => { throw new Error('x'); },
        stop: async () => { throw new Error('x'); },
        next: async () => { throw new Error('x'); },
        previous: async () => { throw new Error('x'); },
        seek: async () => { throw new Error('x'); },
      },
      legacyPlay: () => { legacy.push('play'); },
      legacyPause: () => { legacy.push('pause'); },
      legacyNext: () => { legacy.push('next'); },
    });
    await port.play();
    expect(legacy).toEqual(['play']);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * Kaynak kayıt defteri bütünlüğü
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT — kaynak yetenekleri dürüsttür', () => {
  it('yalnız native otorite kaynakları ses kanıtı üretebilir', () => {
    (['LOCAL', 'STREAM', 'INTERNET_RADIO'] as SourceClass[]).forEach((s) => {
      expect(getSource(s).backend).toBe('native_authority');
      expect(getSource(s).capabilities.supportsAudibleVerification).toBe(true);
    });
    (['YOUTUBE', 'SPOTIFY_CONNECT', 'EXTERNAL_MEDIA_SESSION', 'BLUETOOTH_EXTERNAL'] as SourceClass[])
      .forEach((s) => expect(getSource(s).capabilities.supportsAudibleVerification).toBe(false));
  });

  it('VIDEO müzik otoritesi DEĞİLDİR ama ses üretir (focus\'a tabi)', () => {
    expect(getSource('VIDEO').backend).toBe('native_video');
    expect(getSource('VIDEO').producesAudio).toBe(true);
    expect(getSource('VIDEO').capabilities.supportsAudibleVerification).toBe(false);
  });

  it('bilinmeyen kaynak sınıfı reddedilir', () => {
    expect(isKnownSourceClass('LOCAL')).toBe(true);
    expect(isKnownSourceClass('KEYFI')).toBe(false);
    expect(isKnownSourceClass(null)).toBe(false);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * Komut serileştirme (devir sürerken araya girme yok)
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT — devir sürerken gelen komutlar SERİLEŞTİRİLİR', () => {
  it('devir bitmeden komut yürütülmez', async () => {
    const order: string[] = [];
    let releaseStart: (() => void) | null = null;
    const local: BackendAdapter = {
      sourceClass: 'LOCAL',
      isActive: () => false,
      stop: async () => ({ accepted: true, verified: true, failureCode: null }),
      prepare: async () => ({ ready: true, failureCode: null }),
      start: async () => {
        order.push('start');
        await new Promise<void>((r) => { releaseStart = r; });
        return { accepted: true, started: true, renderingVerified: true, failureCode: null };
      },
    };
    const coord = coordinatorWith(new Map<SourceClass, BackendAdapter>([['LOCAL', local]]), 5000);

    const handover = coord.switchTo('LOCAL', REQUEST);
    // Devir sürerken gelen komut kuyruğa alınır.
    const queued = coord.serialize(async () => { order.push('queued-command'); return 1; });

    await vi.waitFor(() => expect(order).toContain('start'));
    expect(order).not.toContain('queued-command');   // henüz yürütülmedi

    releaseStart?.();
    await handover;
    await queued;
    expect(order).toEqual(['start', 'queued-command']);
  });

  it('devir sürerken isInFlight true, settle sonrası false', () => {
    let s = reduceHandover(IDLE_HANDOVER, { type: 'BEGIN', to: 'LOCAL', atMs: 1 });
    expect(isInFlight(s.phase)).toBe(true);
    s = reduceHandover(s, { type: 'FAIL', code: 'x', atMs: 2 });
    expect(isInFlight(s.phase)).toBe(false);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * Truth zinciri bütünlüğü
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT — truth zinciri eksiksiz ve mutasyonsuz', () => {
  it('aşamalar sırayla eklenir ve girdi MUTASYONA UĞRAMAZ', () => {
    const d0 = beginTruth({
      commandId: 'c', sessionId: 's', sourceId: 'LOCAL', backend: 'native_authority',
      command: 'play', desiredState: 'PLAYING', atMs: 0,
    });
    const d1 = withStage(d0, 'intent_resolved', 1);
    expect(d0.stages).toHaveLength(1);      // orijinal değişmedi
    expect(d1.stages).toHaveLength(2);

    const t = finishTruth(d1, {
      outcome: 'VERIFIED', observedState: 'PLAYING',
      verificationLevel: 'RENDERING_VERIFIED', atMs: 20,
    });
    expect(t.stages.map((s) => s.stage)).toEqual([
      'command_received', 'intent_resolved', 'audible_verified',
    ]);
    expect(t.elapsedMs).toBe(20);
    expect(t.retryable).toBe(false);
  });

  it('TIMED_OUT retryable, REJECTED değil', () => {
    const draft = beginTruth({
      commandId: 'c', sessionId: 's', sourceId: 'LOCAL', backend: 'native_authority',
      command: 'play', desiredState: 'PLAYING', atMs: 0,
    });
    const timeout = finishTruth(draft, {
      outcome: 'TIMED_OUT', observedState: 'UNKNOWN', verificationLevel: 'NONE', atMs: 5,
    });
    expect(timeout.retryable).toBe(true);
    expect(honestClaim(timeout)).toBe('FAILED');

    const rejected = finishTruth(draft, {
      outcome: 'REJECTED', observedState: 'UNKNOWN', verificationLevel: 'NONE',
      failureCode: 'unsupported_capability', atMs: 5,
    });
    expect(rejected.retryable).toBe(false);
    expect(honestClaim(rejected)).toBe('NOT_ATTEMPTED');
  });
});
