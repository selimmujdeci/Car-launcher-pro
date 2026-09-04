/**
 * transitionRuntime.ts — MUSIC F20 · Geçiş politikasının TEK dikişi.
 *
 * Zincir (kanonik — yeni otorite YOK):
 *   `kullanıcı tercihi (kalıcı) + F10/F17 kanıtı + kaynak/duck gözlemi
 *      → transitionModel (SAF) → mediaCommandGateway.setTransitionPolicy
 *      → CarosPlaybackService (AYNI ses zinciri, aynı sahip)`
 *
 * PAZARLIKSIZ SINIRLAR:
 *   · **TIMER/POLLING YOKTUR.** Yalnız dinleme oturumu değiştiğinde ve
 *     tercih değiştiğinde çalışır.
 *   · **Kuyruğa DOKUNMAZ** — sıra gerçeği `PlayQueue`dadır (F3).
 *   · **Playback truth ÜRETMEZ** — geçiş bir kazanç rampasıdır; `playing`
 *     veya `renderingVerified` ondan etkilenmez.
 *   · **İkinci player AÇMAZ** — gerçek crossfade bu yüzden DESTEKLENMEZ ve
 *     öyle olduğu dürüstçe yazılır.
 *   · Aynı politika iki kez YAZILMAZ (gereksiz native komutu yok).
 */

import { logError } from '../../crashLogger';
import { getListeningSession, subscribeListeningSession } from '../session/listeningSession';
import { getMusicLibrarySnapshot } from '../musicIndex';
import { referenceTraitEvidence } from '../traits/traitRuntime';
import { getMusicCanonicalSnapshot } from '../authority/musicCanonicalSnapshot';
import {
  decideTransition, type TransitionContext, type TransitionPolicy,
} from './transitionModel';
import {
  _setTransitionApplyHook, getPreferencePersistCounters, getTransitionPreference,
} from './transitionPreference';
import { noteTransitionDecision, noteTransitionPush } from './transitionTelemetry';

let started = false;
let unsubscribe: (() => void) | null = null;
let lastPushed: { fadeEnabled: boolean; fadeOutMs: number; fadeInMs: number } | null = null;
let lastPolicy: TransitionPolicy | null = null;

function safe<T>(read: () => T, fallback: T): T {
  try {
    const v = read();
    return v === undefined ? fallback : v;
  } catch { return fallback; }
}

/* ── Bağlam okuma (salt okunur) ──────────────────────────────────────────── */

/** Kaynak canlı/süresi bilinmeyen mi — radyo ve süresiz akış. */
function readLiveContent(): boolean {
  return safe<boolean>(() => {
    const snap = getMusicCanonicalSnapshot();
    if (snap.activeSource === 'INTERNET_RADIO') return true;
    const duration = snap.durationMs;
    return !(typeof duration === 'number' && duration > 0);
  }, true);
}

function readDuckActive(): boolean {
  return safe<boolean>(() => {
    const snap = getMusicCanonicalSnapshot();
    return typeof snap.duckVolume === 'number' && snap.duckVolume < 1;
  }, false);
}

/**
 * Sıradaki öğe AYNI albümün devamı mı.
 *
 * Bu bir KANIT sorusudur: yalnız iki öğe de kütüphanede çözülebiliyorsa ve
 * albüm alanları EŞİTSE `true` döner. Bilinmiyorsa `false` (fade serbest) —
 * uydurma bir "albüm devamı" iddiası kurulmaz.
 */
function readAlbumContinuity(): boolean {
  return safe<boolean>(() => {
    const session = getListeningSession();
    const currentId = session?.currentItem?.libraryId ?? null;
    if (currentId === null) return false;
    const tracks = getMusicLibrarySnapshot().tracks;
    const current = tracks.find((t) => t.id === currentId) ?? null;
    if (current === null || !current.album) return false;

    const snap = getMusicCanonicalSnapshot();
    const ids = snap.queueEntryIds ?? [];
    const idx = typeof snap.currentIndex === 'number' ? snap.currentIndex : -1;
    if (idx < 0 || idx + 1 >= ids.length) return false;
    const nextId = ids[idx + 1];
    if (typeof nextId !== 'string') return false;
    const next = tracks.find((t) => t.id === nextId) ?? null;
    return next !== null && next.album === current.album;
  }, false);
}

export function readTransitionContext(): TransitionContext {
  const reference = safe(() => referenceTraitEvidence(), { evidence: null, id: null });
  return Object.freeze({
    liveContent: readLiveContent(),
    duckActive: readDuckActive(),
    albumContinuity: readAlbumContinuity(),
    evidence: reference.evidence,
  });
}

/* ── Uygulama ────────────────────────────────────────────────────────────── */

/**
 * Politikayı HESAPLAR ve native'e YAZAR.
 *
 * Aynı politika iki kez yazılmaz. Yazım düşerse politika UYGULANMAZ ama
 * oynatma ETKİLENMEZ (fail-soft) — sahte başarı sayılmaz.
 */
export async function applyTransitionPolicy(nowMs = Date.now()): Promise<TransitionPolicy> {
  const policy = decideTransition(getTransitionPreference(), readTransitionContext());
  lastPolicy = policy;

  noteTransitionDecision({
    kind: policy.kind,
    reason: policy.reason,
    fadeMs: policy.fadeOutMs,
    evidenceBacked: policy.evidenceBacked,
    atMs: nowMs,
  });

  const payload = {
    fadeEnabled: policy.kind === 'FADE',
    fadeOutMs: policy.fadeOutMs,
    fadeInMs: policy.fadeInMs,
  };
  if (lastPushed !== null
    && lastPushed.fadeEnabled === payload.fadeEnabled
    && lastPushed.fadeOutMs === payload.fadeOutMs
    && lastPushed.fadeInMs === payload.fadeInMs) {
    noteTransitionPush('UNCHANGED');
    return policy;
  }

  try {
    const { setTransitionPolicy } = await import('../authority/mediaCommandGateway');
    const accepted = await setTransitionPolicy(payload);
    if (accepted) { lastPushed = payload; noteTransitionPush('ACCEPTED'); }
    else noteTransitionPush('REJECTED');
  } catch (e) {
    noteTransitionPush('FAILED');
    logError('Transition:Apply', e);
  }
  return policy;
}

/**
 * Başlatır. TIMER KURMAZ — yalnız kanonik dinleme oturumuna abone olur.
 */
export function startTransitionPolicy(): void {
  if (started) return;
  started = true;
  try {
    unsubscribe = subscribeListeningSession(() => {
      void applyTransitionPolicy().catch((e) => logError('Transition:Observe', e));
    });
    /* Tercih değişince politika YENİDEN uygulanır — UI native'e komut
       göndermez, yalnız tercihi değiştirir (§14). */
    _setTransitionApplyHook(() => {
      void applyTransitionPolicy().catch((e) => logError('Transition:Preference', e));
    });
    void applyTransitionPolicy().catch((e) => logError('Transition:Init', e));
  } catch (e) {
    logError('Transition:Start', e);
    started = false;
  }
}

export function stopTransitionPolicy(): void {
  started = false;
  if (unsubscribe) { unsubscribe(); unsubscribe = null; }
  _setTransitionApplyHook(null);
  lastPushed = null;
  lastPolicy = null;
}

export function isTransitionPolicyStarted(): boolean { return started; }
export function getLastTransitionPolicy(): TransitionPolicy | null { return lastPolicy; }

/** Kalıcılık sayaçları — LAB için tercih sahibinden okunur. */
export function getTransitionPersistCounters(): {
  readonly persistFailures: number; readonly loadRejected: number;
} {
  return getPreferencePersistCounters();
}

export function _resetTransitionRuntimeForTest(): void {
  stopTransitionPolicy();
}
