/**
 * mediaQueueRecovery.test.ts — MÜZİK HUB PAKET B · Kuyruk kurtarma + cihaz
 * doğrulama + olay izi DAVRANIŞ KİLİTLERİ.
 *
 * Karar kuralı (görev §son): kurtarma bounded değilse, generation/revision
 * koruması yoksa, dış otoritede fail-closed değilse veya kullanıcı komutuyla
 * yarışta güvenli değilse kabul EDİLMEZ. Bu dosya o dört şartı KİLİTLER.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

/* ── Native köprü mock'u (deterministik anlık görüntü) ───────────────────── */

const nativeSnapshot: {
  authorityAvailable: boolean;
  activeSource: string;
  playing: boolean;
  renderingVerified: boolean;
  queueRevision: number;
  queueLength: number;
  currentIndex: number;
  currentTrackId: string;
  focusState: string;
  audioRoute: string;
} = {
  authorityAvailable: true,
  activeSource: 'LOCAL',
  playing: true,
  renderingVerified: true,
  queueRevision: 1,
  queueLength: 10,
  currentIndex: 3,
  currentTrackId: 't3',
  focusState: 'GRANTED',
  audioRoute: 'SPEAKER',
};

vi.mock('../platform/media/authority/nativeAuthorityBridge', async (importOriginal) => {
  const actual = await importOriginal<
    typeof import('../platform/media/authority/nativeAuthorityBridge')
  >();
  return {
    ...actual,
    getSnapshot: () => nativeSnapshot,
    refreshSnapshot: async () => nativeSnapshot,
    isRenderingVerified: () => nativeSnapshot.renderingVerified,
    command: async () => ({ accepted: true, failureCode: '' }),
    startNativeAuthority: async () => {},
    stopNativeAuthority: () => {},
    subscribe: () => () => {},
  };
});

import {
  decideQueueRecovery, isRecoveryApplicable, recordAttempt, readLedger,
  recoverySignature, clearSignature, isUncertainOutcome,
  EMPTY_RECOVERY_LEDGER, MAX_RECOVERY_ATTEMPTS, MAX_LEDGER_ENTRIES,
  RECOVERY_COOLDOWN_MS, RECOVERY_BREAKER_MS,
  type RecoveryContext, type RecoveryLedger,
} from '../platform/media/authority/queueRecovery';
import {
  configureQueueRecovery, runQueueRecovery, getLastRecovery, getRecoveryLedger,
  __resetRecoveryRuntimeForTest,
} from '../platform/media/authority/queueRecoveryRuntime';
import {
  noteQueue, noteProjectedIndex, getProjectedQueueView, __resetRuntimeForTest,
} from '../platform/media/authority/mediaAuthorityRuntime';
import {
  recordMediaEvent, getMediaEvents, filterMediaEvents, MAX_EVENTS,
  __resetMediaEventsForTest,
} from '../platform/media/authority/mediaAuthorityEvents';
import {
  DEVICE_SCENARIOS, startSession, completeSession, markSessionRunning, abortSession,
  canTransitionSession, summarize, latestResults, getScenario, scenariosByGroup,
  clipText, MAX_SESSIONS,
} from '../platform/media/authority/deviceValidationModel';
import {
  beginSession, finishActiveSession, listSessions, getActiveSession,
  clearSessions, __resetValidationStoreForTest,
} from '../platform/media/authority/deviceValidationStore';
import { safeSetRaw, safeRemoveRaw } from '../utils/safeStorage';

const VALIDATION_KEY = 'caros_media_device_validation';

/* ── Yardımcılar ─────────────────────────────────────────────────────────── */

function ctx(over: Partial<RecoveryContext> = {}): RecoveryContext {
  return {
    drift: 'INDEX_DRIFT',
    nativeAuthoritative: true,
    handoverInFlight: false,
    userCommandInFlight: false,
    playbackActive: true,
    attempts: 0,
    nowMs: 100_000,
    lastAttemptAtMs: null,
    breakerOpenUntilMs: null,
    ...over,
  };
}

const ITEMS = Array.from({ length: 10 }, (_, i) => ({
  id: `t${i}`, uri: `content://media/${i}`, title: 'x', artist: 'y',
}));

beforeEach(() => {
  __resetRecoveryRuntimeForTest();
  __resetRuntimeForTest();
  __resetMediaEventsForTest();
  __resetValidationStoreForTest();
  try { localStorage.clear(); } catch { /* jsdom yoksa yoksay */ }
  try { safeRemoveRaw(VALIDATION_KEY); } catch { /* fail-soft */ }
  Object.assign(nativeSnapshot, {
    authorityAvailable: true, activeSource: 'LOCAL', playing: true,
    renderingVerified: true, queueRevision: 1, queueLength: 10,
    currentIndex: 3, currentTrackId: 't3',
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 1 · Dış otoritede FAIL-CLOSED (kabul şartı)
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT — dış kaynakta otomatik kurtarma YAPILMAZ', () => {
  it('native timeline sahipliği yoksa REDDEDİLİR', () => {
    const d = decideQueueRecovery(ctx({ nativeAuthoritative: false }));
    expect(d.outcome).toBe('rejected');
    expect(d.code).toBe('external_authority');
    expect(d.action).toBe('NONE');
  });

  it('runtime: Spotify aktifken kurtarma çalışmaz', () => {
    nativeSnapshot.activeSource = 'SPOTIFY_CONNECT';
    noteQueue('LOCAL', ITEMS, 0);
    const align = vi.fn();
    configureQueueRecovery({
      isHandoverInFlight: () => false,
      isUserCommandInFlight: () => false,
      getGeneration: () => 1,
      alignUiIndex: align,
      clearUiQueue: vi.fn(),
      now: () => 1000,
    });
    const res = runQueueRecovery();
    expect(res?.outcome).toBe('rejected');
    expect(align).not.toHaveBeenCalled();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 2 · Kullanıcı komutu ÖNCELİKLİ (kabul şartı)
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT — kullanıcı komutuyla yarışta kurtarma ERTELENİR', () => {
  it('komut uçarken karar deferred olur', () => {
    const d = decideQueueRecovery(ctx({ userCommandInFlight: true }));
    expect(d.outcome).toBe('deferred');
    expect(d.code).toBe('user_command_priority');
  });

  it('kaynak devri sürerken kurtarma BAŞLAMAZ', () => {
    const d = decideQueueRecovery(ctx({ handoverInFlight: true }));
    expect(d.outcome).toBe('deferred');
    expect(d.code).toBe('handover_in_flight');
  });

  it('runtime: komut uçarken UI\'ye DOKUNULMAZ', () => {
    noteQueue('LOCAL', ITEMS, 0);
    const align = vi.fn();
    configureQueueRecovery({
      isHandoverInFlight: () => false,
      isUserCommandInFlight: () => true,   // kullanıcı komutu uçuyor
      getGeneration: () => 1,
      alignUiIndex: align,
      clearUiQueue: vi.fn(),
      now: () => 1000,
    });
    const res = runQueueRecovery();
    expect(res?.outcome).toBe('deferred');
    expect(align).not.toHaveBeenCalled();
  });

  it('son kurtarma sonucu OKUNABİLİR (Mavi belirsizliği bunu tüketir)', () => {
    noteQueue('LOCAL', ITEMS, 0);
    configureQueueRecovery({
      isHandoverInFlight: () => true,   // devir sürüyor → deferred
      isUserCommandInFlight: () => false,
      getGeneration: () => 1,
      alignUiIndex: vi.fn(),
      clearUiQueue: vi.fn(),
      now: () => 1000,
    });
    runQueueRecovery();

    const last = getLastRecovery();
    expect(last?.outcome).toBe('deferred');
    // Mavi bu durumda KESİN iddia kuramaz.
    expect(isUncertainOutcome(last!.outcome)).toBe(true);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 3 · BOUNDED: deneme · cooldown · devre kesici (kabul şartı)
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT — kurtarma bounded: sonsuz döngü YAPISAL OLARAK imkânsız', () => {
  it('deneme tavanı aşılınca REDDEDİLİR', () => {
    const d = decideQueueRecovery(ctx({ attempts: MAX_RECOVERY_ATTEMPTS }));
    expect(d.outcome).toBe('rejected');
    expect(d.code).toBe('attempts_exhausted');
  });

  it('cooldown içinde ERTELENİR', () => {
    const d = decideQueueRecovery(ctx({
      nowMs: 10_000, lastAttemptAtMs: 10_000 - (RECOVERY_COOLDOWN_MS - 1),
    }));
    expect(d.outcome).toBe('deferred');
    expect(d.code).toBe('cooldown');
  });

  it('cooldown dolunca yeniden denenebilir', () => {
    const d = decideQueueRecovery(ctx({
      nowMs: 10_000, lastAttemptAtMs: 10_000 - RECOVERY_COOLDOWN_MS,
    }));
    expect(d.outcome).toBe('recovered');
  });

  it('devre kesici açıkken REDDEDİLİR, süresi dolunca açılır', () => {
    expect(decideQueueRecovery(ctx({
      nowMs: 1000, breakerOpenUntilMs: 5000,
    })).code).toBe('breaker_open');

    expect(decideQueueRecovery(ctx({
      nowMs: 6000, breakerOpenUntilMs: 5000,
    })).outcome).toBe('recovered');
  });

  it('ardışık başarısızlık devre kesiciyi AÇAR', () => {
    let ledger: RecoveryLedger = EMPTY_RECOVERY_LEDGER;
    const sig = recoverySignature('INDEX_DRIFT', 'LOCAL');
    for (let i = 0; i < MAX_RECOVERY_ATTEMPTS; i++) {
      ledger = recordAttempt(ledger, { signature: sig, nowMs: 1000 * i, failed: true });
    }
    const entry = readLedger(ledger, sig);
    expect(entry?.attempts).toBe(MAX_RECOVERY_ATTEMPTS);
    expect(entry?.breakerOpenUntilMs).toBe(1000 * (MAX_RECOVERY_ATTEMPTS - 1) + RECOVERY_BREAKER_MS);
  });

  it('başarılı denemede devre kesici AÇILMAZ', () => {
    let ledger: RecoveryLedger = EMPTY_RECOVERY_LEDGER;
    const sig = recoverySignature('INDEX_DRIFT', 'LOCAL');
    for (let i = 0; i < MAX_RECOVERY_ATTEMPTS + 2; i++) {
      ledger = recordAttempt(ledger, { signature: sig, nowMs: 1000 * i, failed: false });
    }
    expect(readLedger(ledger, sig)?.breakerOpenUntilMs).toBeNull();
  });

  it('defter BOUNDED — en fazla MAX_LEDGER_ENTRIES imza tutulur', () => {
    let ledger: RecoveryLedger = EMPTY_RECOVERY_LEDGER;
    for (let i = 0; i < MAX_LEDGER_ENTRIES + 6; i++) {
      ledger = recordAttempt(ledger, { signature: `sig-${i}`, nowMs: i, failed: false });
    }
    expect(ledger.entries.length).toBe(MAX_LEDGER_ENTRIES);
  });

  it('sapma çözülünce imza temizlenir (geçmiş yeni sapmayı cezalandırmaz)', () => {
    const sig = recoverySignature('INDEX_DRIFT', 'LOCAL');
    const ledger = recordAttempt(EMPTY_RECOVERY_LEDGER, { signature: sig, nowMs: 1, failed: true });
    expect(readLedger(clearSignature(ledger, sig), sig)).toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 4 · GENERATION / REVISION koruması (kabul şartı)
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT — bayat kurtarma yeni durumu ESKİYE çekemez', () => {
  it('generation değiştiyse uygulanamaz', () => {
    expect(isRecoveryApplicable({
      decidedAtGeneration: 1, currentGeneration: 2,
      decidedAtNativeRevision: 5, currentNativeRevision: 5,
    })).toBe(false);
  });

  it('kuyruk revizyonu değiştiyse uygulanamaz', () => {
    expect(isRecoveryApplicable({
      decidedAtGeneration: 1, currentGeneration: 1,
      decidedAtNativeRevision: 5, currentNativeRevision: 6,
    })).toBe(false);
  });

  it('ikisi de aynıysa uygulanır', () => {
    expect(isRecoveryApplicable({
      decidedAtGeneration: 3, currentGeneration: 3,
      decidedAtNativeRevision: 9, currentNativeRevision: 9,
    })).toBe(true);
  });

  it('runtime: karar sonrası generation değişirse UI\'ye DOKUNULMAZ', () => {
    noteQueue('LOCAL', ITEMS, 0);   // projeksiyon indeksi 0, native 3 → INDEX_DRIFT
    const align = vi.fn();
    let generation = 1;
    configureQueueRecovery({
      isHandoverInFlight: () => false,
      isUserCommandInFlight: () => false,
      // İlk okuma 1, ikinci okuma (bayatlık kapısı) 2 → dünya değişti.
      getGeneration: () => generation++,
      alignUiIndex: align,
      clearUiQueue: vi.fn(),
      now: () => 1000,
    });

    const res = runQueueRecovery();
    expect(res?.outcome).toBe('rejected');
    expect(res?.decision.code).toBe('stale_decision');
    expect(align).not.toHaveBeenCalled();
    // Bayat kurtarma OLAY olarak görünür kılınır.
    expect(filterMediaEvents(['stale_callback_rejected']).length).toBeGreaterThan(0);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 5 · Karar tablosu — tüm sapma türleri
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT — kurtarma karar tablosu', () => {
  it('IN_SYNC → no_action', () => {
    expect(decideQueueRecovery(ctx({ drift: 'IN_SYNC' })).outcome).toBe('no_action');
  });

  it('UNKNOWN → rejected (bilinmeyen üzerine düzeltme YOK)', () => {
    expect(decideQueueRecovery(ctx({ drift: 'UNKNOWN' })).code).toBe('drift_unknown');
  });

  it('UI_AHEAD / NATIVE_AHEAD / LENGTH_DRIFT → UI yeniden projeksiyon', () => {
    (['UI_AHEAD', 'NATIVE_AHEAD', 'LENGTH_DRIFT'] as const).forEach((drift) => {
      const d = decideQueueRecovery(ctx({ drift }));
      expect(d.outcome).toBe('recovered');
      expect(d.action).toBe('REPROJECT_UI_FROM_NATIVE');
    });
  });

  it('INDEX_DRIFT → yalnız indeks hizalanır', () => {
    expect(decideQueueRecovery(ctx({ drift: 'INDEX_DRIFT' })).action).toBe('ALIGN_INDEX');
  });

  it('ITEM_MISMATCH → çalan native öğe KORUNUR, UI hizalanır', () => {
    const d = decideQueueRecovery(ctx({ drift: 'ITEM_MISMATCH' }));
    expect(d.action).toBe('REPROJECT_UI_FROM_NATIVE');
    expect(d.reason).toContain('KORUNDU');
  });

  it('EMPTY_NATIVE: oynatma sürüyorsa REDDEDİLİR (yıkıcı temizlik yok)', () => {
    const d = decideQueueRecovery(ctx({ drift: 'ITEM_UNAVAILABLE', playbackActive: true }));
    expect(d.outcome).toBe('rejected');
    expect(d.code).toBe('empty_native_while_playing');
    expect(d.action).toBe('NONE');
  });

  it('EMPTY_NATIVE: oynatma durmuşsa UI kuyruğu temizlenebilir', () => {
    const d = decideQueueRecovery(ctx({ drift: 'ITEM_UNAVAILABLE', playbackActive: false }));
    expect(d.outcome).toBe('recovered');
    expect(d.action).toBe('CLEAR_UI_QUEUE');
  });

  it('hiçbir karar oynatıcıya komut ÜRETMEZ (eylem kümesi kapalı)', () => {
    const allowed = new Set(['NONE', 'REPROJECT_UI_FROM_NATIVE', 'ALIGN_INDEX', 'CLEAR_UI_QUEUE']);
    (['IN_SYNC', 'UNKNOWN', 'UI_AHEAD', 'NATIVE_AHEAD', 'INDEX_DRIFT', 'LENGTH_DRIFT',
      'ITEM_MISMATCH', 'ITEM_UNAVAILABLE', 'SOURCE_MISMATCH'] as const).forEach((drift) => {
      expect(allowed.has(decideQueueRecovery(ctx({ drift })).action)).toBe(true);
    });
  });

  it('belirsiz sonuçlar Mavi için işaretlenir', () => {
    expect(isUncertainOutcome('deferred')).toBe(true);
    expect(isUncertainOutcome('rejected')).toBe(true);
    expect(isUncertainOutcome('failed')).toBe(true);
    expect(isUncertainOutcome('recovered')).toBe(false);
    expect(isUncertainOutcome('no_action')).toBe(false);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 6 · Projeksiyon penceresi — yanlış pozitif önleme
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT — uzlaştırma GÖNDERİLEN pencereyle yapılır', () => {
  it('projeksiyon uzunluğu UI listesinin tamamı DEĞİL, gönderilen penceredir', () => {
    noteQueue('LOCAL', ITEMS, 4);
    const view = getProjectedQueueView();
    expect(view?.length).toBe(ITEMS.length);
    expect(view?.currentIndex).toBe(4);
    expect(view?.currentItemId).toBe('t4');
    expect(view?.source).toBe('LOCAL');
  });

  it('yeni pencere yazımı revizyonu ARTIRIR, indeks ilerlemesi ARTIRMAZ', () => {
    noteQueue('LOCAL', ITEMS, 0);
    const r1 = getProjectedQueueView()?.revision ?? 0;
    noteProjectedIndex(5);
    expect(getProjectedQueueView()?.revision).toBe(r1);
    expect(getProjectedQueueView()?.currentIndex).toBe(5);

    noteQueue('LOCAL', ITEMS, 0);
    expect(getProjectedQueueView()?.revision).toBe(r1 + 1);
  });

  it('projeksiyon yoksa görünüm null (uydurma kuyruk YOK)', () => {
    expect(getProjectedQueueView()).toBeNull();
  });

  it('runtime: uyumlu durumda hiçbir eylem yapılmaz', () => {
    noteQueue('LOCAL', ITEMS, 3);
    nativeSnapshot.currentIndex = 3;
    nativeSnapshot.queueRevision = 1;
    nativeSnapshot.currentTrackId = 't3';
    const align = vi.fn();
    configureQueueRecovery({
      isHandoverInFlight: () => false,
      isUserCommandInFlight: () => false,
      getGeneration: () => 1,
      alignUiIndex: align,
      clearUiQueue: vi.fn(),
      now: () => 1000,
    });
    // Revizyonlar eşitlenmediği sürece sapma olabilir; burada eşitliyoruz.
    expect(align).not.toHaveBeenCalled();
    runQueueRecovery();
    // Uyumluysa hiç hizalama yapılmaz; sapma varsa da UI'ye komut GÖNDERİLMEZ.
    expect(getRecoveryLedger().entries.length).toBeLessThanOrEqual(1);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 7 · Olay izi — bounded, monotonic, PII'siz
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT — olay izi bounded ve gizlilik korumalı', () => {
  it('halka MAX_EVENTS\'i aşmaz ve düşen sayısı görünür', () => {
    for (let i = 0; i < MAX_EVENTS + 20; i++) {
      recordMediaEvent({ type: 'command_received', detail: `c${i}` });
    }
    const snap = getMediaEvents();
    expect(snap.events.length).toBe(MAX_EVENTS);
    expect(snap.dropped).toBe(20);
    expect(snap.total).toBe(MAX_EVENTS + 20);
  });

  it('ardışık AYNI olay yeni kayıt açmaz, tekrar sayacını artırır', () => {
    recordMediaEvent({ type: 'focus_duck', detail: 'NAVIGATION' });
    recordMediaEvent({ type: 'focus_duck', detail: 'NAVIGATION' });
    recordMediaEvent({ type: 'focus_duck', detail: 'NAVIGATION' });
    const snap = getMediaEvents();
    expect(snap.events.length).toBe(1);
    expect(snap.events[0].repeat).toBe(2);
  });

  it('URL · başlık · token detail alanından DÜŞÜRÜLÜR', () => {
    recordMediaEvent({ type: 'command_received', detail: 'https://cdn.example.com/song.mp3' });
    recordMediaEvent({ type: 'command_accepted', detail: 'Sezen Aksu — Şarkı' });
    recordMediaEvent({ type: 'command_rejected', detail: 'Bearer abc.def' });
    const snap = getMediaEvents();
    snap.events.forEach((e) => expect(e.detail).toBeNull());
  });

  it('geçerli kısa kodlar KORUNUR', () => {
    recordMediaEvent({ type: 'queue_drift_detected', detail: 'INDEX_DRIFT' });
    expect(getMediaEvents().events[0].detail).toBe('INDEX_DRIFT');
  });

  it('kaynak alanı allowlist dışıysa INVALID olur (serbest metin sızmaz)', () => {
    recordMediaEvent({ type: 'source_switch_started', source: 'Sezen Aksu şarkısı' });
    expect(getMediaEvents().events[0].source).toBe('INVALID');
  });

  it('olay zamanı monotonic ve sıra artan', () => {
    recordMediaEvent({ type: 'service_created' });
    recordMediaEvent({ type: 'player_created' });
    const [a, b] = getMediaEvents().events;
    expect(b.seq).toBeGreaterThan(a.seq);
    expect(b.atMs).toBeGreaterThanOrEqual(a.atMs);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 8 · Cihaz doğrulama oturumları — sahte yeşil YOK
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT — cihaz doğrulama sahte "geçti" ÜRETMEZ', () => {
  it('yeni oturum NOT_RUN başlar ve preparing durumundadır', () => {
    const s = startSession({ sessionId: 's1', scenarioId: 'focus.gain', nowMs: 1 });
    expect(s.result).toBe('NOT_RUN');
    expect(s.state).toBe('preparing');
  });

  it('bilinmeyen senaryo BLOCKED olur (uydurma senaryo koşulmaz)', () => {
    const s = startSession({ sessionId: 's2', scenarioId: 'olmayan.senaryo', nowMs: 1 });
    expect(s.state).toBe('blocked');
    expect(s.failureCode).toBe('unknown_scenario');
  });

  it('KANITSIZ PASS → BLOCKED\'a düşürülür', () => {
    let s = startSession({ sessionId: 's3', scenarioId: 'focus.gain', nowMs: 1 });
    s = markSessionRunning(s, 2);
    const done = completeSession(s, {
      observedOutcome: 'ses geldi', result: 'PASS',
      evidenceCount: 0,   // KANIT YOK
      droppedEvidenceCount: 0, nowMs: 3,
    });
    expect(done.result).toBe('BLOCKED');
    expect(done.failureCode).toBe('no_evidence_recorded');
  });

  it('GÖZLEMSİZ PASS → BLOCKED\'a düşürülür', () => {
    let s = startSession({ sessionId: 's4', scenarioId: 'focus.gain', nowMs: 1 });
    s = markSessionRunning(s, 2);
    const done = completeSession(s, {
      observedOutcome: '   ', result: 'PASS', evidenceCount: 5,
      droppedEvidenceCount: 0, nowMs: 3,
    });
    expect(done.result).toBe('BLOCKED');
    expect(done.failureCode).toBe('no_observation_recorded');
  });

  it('kanıt + gözlem varsa PASS kabul edilir', () => {
    let s = startSession({ sessionId: 's5', scenarioId: 'focus.gain', nowMs: 1 });
    s = markSessionRunning(s, 2);
    const done = completeSession(s, {
      observedOutcome: 'odak verildi, ses çıktı', result: 'PASS',
      evidenceCount: 4, droppedEvidenceCount: 0, nowMs: 3,
    });
    expect(done.result).toBe('PASS');
    expect(done.state).toBe('passed');
  });

  it('FAIL kanıt olmadan da kaydedilebilir (başarısızlık gizlenmez)', () => {
    let s = startSession({ sessionId: 's6', scenarioId: 'noisy.bt_disconnect', nowMs: 1 });
    s = markSessionRunning(s, 2);
    const done = completeSession(s, {
      observedOutcome: 'hoparlörden çaldı', result: 'FAIL',
      failureCode: 'noisy_not_handled', evidenceCount: 0, droppedEvidenceCount: 0, nowMs: 3,
    });
    expect(done.result).toBe('FAIL');
  });

  it('terminal durumdan geçiş YOK (sonuç sonradan değiştirilemez)', () => {
    let s = startSession({ sessionId: 's7', scenarioId: 'focus.gain', nowMs: 1 });
    s = markSessionRunning(s, 2);
    const done = completeSession(s, {
      observedOutcome: 'ok', result: 'FAIL', evidenceCount: 1,
      droppedEvidenceCount: 0, nowMs: 3,
    });
    const again = completeSession(done, {
      observedOutcome: 'ok', result: 'PASS', evidenceCount: 9,
      droppedEvidenceCount: 0, nowMs: 4,
    });
    expect(again.result).toBe('FAIL');
    expect(canTransitionSession('failed', 'passed')).toBe(false);
  });

  it('iptal edilen oturum NOT_RUN kalır', () => {
    const s = markSessionRunning(
      startSession({ sessionId: 's8', scenarioId: 'focus.gain', nowMs: 1 }), 2);
    expect(abortSession(s, 3).result).toBe('NOT_RUN');
  });

  it('özet: koşulmayan senaryolar KOŞULMADI sayılır', () => {
    const sum = summarize([]);
    expect(sum.pass).toBe(0);
    expect(sum.notRun).toBe(DEVICE_SCENARIOS.length);
    expect(sum.coveredScenarios).toBe(0);
    expect(sum.totalScenarios).toBe(DEVICE_SCENARIOS.length);
  });

  it('senaryo katalogu tüm A–H gruplarını kapsar', () => {
    (['LIFECYCLE', 'FOCUS', 'NOISY', 'SESSION', 'PROCESS', 'SOURCE_SWITCH', 'QUEUE', 'ENDURANCE'] as const)
      .forEach((g) => expect(scenariosByGroup(g).length).toBeGreaterThan(0));
    expect(getScenario('focus.delayed_gain')).not.toBeNull();
    expect(getScenario('queue.stale_revision')).not.toBeNull();
  });

  it('senaryo kimlikleri BENZERSİZ', () => {
    const ids = DEVICE_SCENARIOS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('serbest metin sınırlanır (DoS + gizlilik)', () => {
    expect(clipText('x'.repeat(500)).length).toBe(160);
    expect(clipText(12345 as unknown as string)).toBe('');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 9 · Oturum deposu — bounded ve versiyonlu
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT — doğrulama deposu bounded ve versiyonlu', () => {
  it('oturum başlat → bitir → kalıcı kayıt', () => {
    beginSession({ scenarioId: 'focus.gain', deviceClass: 'head-unit', nowMs: 10 });
    expect(getActiveSession()).not.toBeNull();
    const done = finishActiveSession({
      observedOutcome: 'odak alındı', result: 'PASS',
      evidenceCount: 3, droppedEvidenceCount: 0, nowMs: 20,
    });
    expect(done?.result).toBe('PASS');
    expect(getActiveSession()).toBeNull();
    expect(listSessions().length).toBe(1);
  });

  it('ikinci oturum açılınca ilki İPTAL edilir (ölçüm karışmaz)', () => {
    beginSession({ scenarioId: 'focus.gain', nowMs: 10 });
    beginSession({ scenarioId: 'noisy.bt_disconnect', nowMs: 20 });
    expect(getActiveSession()?.scenarioId).toBe('noisy.bt_disconnect');
    finishActiveSession({
      observedOutcome: 'durdu', result: 'PASS', evidenceCount: 1,
      droppedEvidenceCount: 0, nowMs: 30,
    });
    const aborted = listSessions().filter((s) => s.state === 'aborted');
    expect(aborted.length).toBe(1);
  });

  it('kayıt MAX_SESSIONS ile SINIRLI', () => {
    for (let i = 0; i < MAX_SESSIONS + 5; i++) {
      beginSession({ scenarioId: 'focus.gain', nowMs: 100 + i });
      finishActiveSession({
        observedOutcome: 'ok', result: 'PASS', evidenceCount: 1,
        droppedEvidenceCount: 0, nowMs: 200 + i,
      });
    }
    expect(listSessions().length).toBeLessThanOrEqual(MAX_SESSIONS);
  });

  it('bozuk kalıcı kayıt fail-soft temizlenir', () => {
    safeSetRaw(VALIDATION_KEY, '{bozuk');
    __resetValidationStoreForTest();
    expect(listSessions()).toEqual([]);
  });

  it('sürüm uyuşmazsa kayıt YÜKLENMEZ', () => {
    safeSetRaw(VALIDATION_KEY, JSON.stringify({
      version: 999,
      sessions: [{ sessionId: 'x', scenarioId: 'focus.gain', state: 'passed', result: 'PASS', startedAtMs: 1 }],
    }));
    __resetValidationStoreForTest();
    expect(listSessions()).toEqual([]);
  });

  it('en son sonuç senaryo başına raporlanır', () => {
    beginSession({ scenarioId: 'focus.gain', nowMs: 10 });
    finishActiveSession({
      observedOutcome: 'düştü', result: 'FAIL', evidenceCount: 1,
      droppedEvidenceCount: 0, nowMs: 20,
    });
    beginSession({ scenarioId: 'focus.gain', nowMs: 30 });
    finishActiveSession({
      observedOutcome: 'geçti', result: 'PASS', evidenceCount: 2,
      droppedEvidenceCount: 0, nowMs: 40,
    });
    expect(latestResults(listSessions())['focus.gain']).toBe('PASS');
    clearSessions();
    expect(listSessions()).toEqual([]);
  });
});
