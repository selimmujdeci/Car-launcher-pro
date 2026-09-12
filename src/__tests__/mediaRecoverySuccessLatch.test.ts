/**
 * mediaRecoverySuccessLatch.test.ts — E-26 KİLİDİ: kurtarma BAŞARISI işaretlenir.
 *
 * ── BULUNAN KUSUR (envanter denetimi E-26) ─────────────────────────────
 * `runRecovery` deneme sayacını ÖNCE yazıyordu (`markRecoveryAttempt`) ama
 * kurtarma tamamlandığında `markRecoverySucceeded` HİÇBİR yerden çağrılmıyordu
 * (ürün yolunda sıfır çağıran). Sonuç: her açılış sayacı bir artırır,
 * `MAX_RECOVERY_ATTEMPTS` (3) sonrası `decideRecovery` kalıcı olarak
 * `attempts_exhausted` döner — çalışan bir sistemde bile kurtarma ölür.
 *
 * Bu dosya ZİNCİRİ test eder (statik "fonksiyon var mı" değil): gerçek
 * `startMediaAuthority()` koşturulur, kalıcı kayıt diskten geri okunur.
 *
 * KONTROL TESTİ ZORUNLU: kurtarma BAŞARISIZ olduğunda sayaç sıfırlanMAmalı —
 * aksi hâlde kilit her koşulda geçer ve hiçbir şey ölçmez.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/* ── Native köprü mock'u (deterministik) ─────────────────────────────────── */

const nativeState = {
  snapshot: {
    authorityAvailable: true,
    activeSource: 'NONE',
    focusState: 'GRANTED',
    audioRoute: 'SPEAKER',
    playing: false,
    renderingVerified: false,
    queueLength: 0,
  },
  accept: true,
};

vi.mock('../platform/bridge', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../platform/bridge')>();
  return { ...actual, isNative: true };
});

vi.mock('../platform/media/authority/nativeAuthorityBridge', async (importOriginal) => {
  const actual = await importOriginal<
    typeof import('../platform/media/authority/nativeAuthorityBridge')
  >();
  let seq = 0;
  return {
    ...actual,
    getSnapshot: () => nativeState.snapshot,
    refreshSnapshot: async () => nativeState.snapshot,
    isRenderingVerified: () => false,
    nextCommandId: (prefix = 'cmd') => { seq += 1; return `${prefix}-${seq}`; },
    command: async () => ({ accepted: nativeState.accept, failureCode: '' }),
    startNativeAuthority: async () => {},
    stopNativeAuthority: () => {},
    subscribe: () => () => {},
  };
});

import {
  decideRecovery, persistPlaybackState, readPersistedRaw,
  MAX_RECOVERY_ATTEMPTS,
} from '../platform/media/authority/mediaRecovery';
import {
  startMediaAuthority, stopMediaAuthority,
} from '../platform/media/authority/mediaAuthorityRuntime';
import {
  getMediaAuthorityEvidence, __resetEvidenceForTest,
} from '../platform/media/authority/mediaAuthorityEvidence';
import * as gateway from '../platform/media/authority/mediaCommandGateway';
import type { BackendAdapter, StartOutcome, StopOutcome } from
  '../platform/media/authority/sourceCoordinator';
import type { SourceClass } from '../platform/media/authority/sourceCapabilities';
import { safeSetRaw } from '../utils/safeStorage';

const ITEM = { id: 't1', uri: 'file:///a.mp3', title: 'A', artist: 'B' };

function adapter(sourceClass: SourceClass, startOk: boolean): BackendAdapter {
  let active = false;
  return {
    sourceClass,
    isActive: () => active,
    async stop(): Promise<StopOutcome> {
      active = false;
      return { accepted: true, verified: true, failureCode: null };
    },
    async prepare() { return { ready: true, failureCode: null }; },
    async start(): Promise<StartOutcome> {
      if (startOk) active = true;
      return {
        accepted: startOk,
        started: startOk,
        renderingVerified: false,
        failureCode: startOk ? null : 'start_failed',
      };
    },
  };
}

/** Kurtarılabilir bir kayıt yazar; `recoveryAttempts` 0 ile başlar. */
function seedPersistedState(attempts = 0): void {
  expect(persistPlaybackState({
    source: 'LOCAL', queueRevision: 3, items: [ITEM], currentIndex: 0,
    positionMs: 5000, shuffle: false, repeat: 'off',
    userPaused: false, lastObservedPlaying: true, nowMs: Date.now(),
  })).toBe(true);
  if (attempts > 0) {
    const raw = JSON.parse(readPersistedRaw() ?? '{}') as Record<string, unknown>;
    safeSetRaw(
      'caros_media_authority_state',
      JSON.stringify({ ...raw, recoveryAttempts: attempts }),
    );
  }
}

function persistedAttempts(): number | null {
  const raw = readPersistedRaw();
  if (!raw) return null;
  try {
    const p = JSON.parse(raw) as { recoveryAttempts?: number };
    return typeof p.recoveryAttempts === 'number' ? p.recoveryAttempts : null;
  } catch { return null; }
}

describe('E-26 — media kurtarma BAŞARISI kalıcı kayda işlenir', () => {
  beforeEach(() => {
    localStorage.clear();
    __resetEvidenceForTest();
    nativeState.accept = true;
  });

  afterEach(() => {
    stopMediaAuthority();
    gateway.__resetGatewayForTest();
    vi.useRealTimers();
  });

  it('kurtarma tamamlanınca deneme sayacı SIFIRLANIR ve başarı sayılır', async () => {
    seedPersistedState();
    gateway.__resetGatewayForTest(new Map([['LOCAL' as SourceClass, adapter('LOCAL', true)]]));

    await startMediaAuthority();

    /* Kalıcı kayıttaki deneme sayacı geri sıfıra döndü → bir sonraki açılışta
       kurtarma HÂLÂ mümkün. */
    expect(persistedAttempts()).toBe(0);
    expect(getMediaAuthorityEvidence().counters.recoveryCount).toBe(1);
    expect(getMediaAuthorityEvidence().counters.recoverySucceeded).toBe(1);

    /* Kurtarma kapısı açık kaldı. */
    expect(decideRecovery(readPersistedRaw(), Date.now()).action).toBe('RESTORE_PAUSED');
  });

  it('KONTROL — kurtarma başarısız olursa sayaç SIFIRLANMAZ (kilit körü körüne geçmiyor)', async () => {
    seedPersistedState();
    gateway.__resetGatewayForTest(new Map([['LOCAL' as SourceClass, adapter('LOCAL', false)]]));

    await startMediaAuthority();

    expect(persistedAttempts()).toBe(1);
    expect(getMediaAuthorityEvidence().counters.recoveryCount).toBe(1);
    expect(getMediaAuthorityEvidence().counters.recoverySucceeded).toBe(0);
  });

  it('KÖK KANIT — sıfırlama olmadan üçüncü denemeden sonra kurtarma KALICI kapanır', () => {
    seedPersistedState(MAX_RECOVERY_ATTEMPTS);
    expect(decideRecovery(readPersistedRaw(), Date.now()))
      .toEqual({ action: 'NONE', reason: 'attempts_exhausted' });
  });
});
