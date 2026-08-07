/**
 * queueRecoveryRuntime.ts — MÜZİK HUB PAKET B · Kurtarma kararının UYGULANMASI.
 *
 * Karar tablosu SAF (`queueRecovery.ts`); burada yalnız yürütme vardır:
 * dünya durumunu topla → karar al → **bayatlık kapısından geçir** → uygula →
 * sonucu kanıt olarak yaz.
 *
 * NE YAPMAZ (pazarlıksız):
 *   - Native oynatıcıya HİÇBİR komut göndermez (çalan medya değişmez).
 *   - Kaynak değiştirmez, ses/duck değiştirmez, kuyruk yeniden yüklemez.
 *   - Zamanlayıcı KURMAZ: yalnız native anlık görüntü değiştiğinde tetiklenir
 *     (polling yok — düşük-uç bütçesi).
 *
 * Yaptığı tek şey **UI projeksiyonunu** ses üreten native gerçeğe hizalamaktır.
 */

import { reconcileQueue, type QueueDrift } from './queueReconciliation';
import {
  decideQueueRecovery, isRecoveryApplicable, recordAttempt, readLedger,
  recoverySignature, clearSignature, EMPTY_RECOVERY_LEDGER,
  type RecoveryDecision, type RecoveryLedger, type RecoveryOutcome,
} from './queueRecovery';
import { getProjectedQueueView, noteProjectedIndex } from './mediaAuthorityRuntime';
import { isKnownSourceClass } from './sourceCapabilities';
import { getSnapshot } from './nativeAuthorityBridge';
import { recordMediaEvent } from './mediaAuthorityEvents';

/* ── Dünya durumu bağlantıları (DI — test edilebilirlik) ─────────────────── */

export interface RecoveryRuntimeDeps {
  /** Kaynak devri sürüyor mu (sourceCoordinator in-flight). */
  readonly isHandoverInFlight: () => boolean;
  /** Kullanıcı/Mavi komutu uçuyor mu. */
  readonly isUserCommandInFlight: () => boolean;
  /** Otorite generation'ı — her devirde/kuyruk yazımında artar. */
  readonly getGeneration: () => number;
  /** UI projeksiyon indeksini native gerçeğe hizala. */
  readonly alignUiIndex: (nativeIndex: number) => void;
  /** UI kuyruğunu temizle (YALNIZ oynatma durmuşken çağrılır). */
  readonly clearUiQueue: () => void;
  readonly now: () => number;
}

export interface RecoveryRunResult {
  readonly drift: QueueDrift;
  readonly decision: RecoveryDecision;
  readonly outcome: RecoveryOutcome;
  readonly appliedAtMs: number;
}

let _ledger: RecoveryLedger = EMPTY_RECOVERY_LEDGER;
let _last: RecoveryRunResult | null = null;
let _deps: RecoveryRuntimeDeps | null = null;
/** Aynı anda ikinci kurtarma koşmaz (yeniden giriş kilidi). */
let _running = false;

export function configureQueueRecovery(deps: RecoveryRuntimeDeps): void {
  _deps = deps;
}

export function getLastRecovery(): RecoveryRunResult | null {
  return _last;
}

export function getRecoveryLedger(): RecoveryLedger {
  return _ledger;
}

/**
 * Bir kurtarma turu koşar. Tetikleyici: native anlık görüntü değişimi.
 * İdempotent ve yeniden-girişe kapalıdır; hiçbir koşulda throw etmez.
 */
export function runQueueRecovery(): RecoveryRunResult | null {
  const deps = _deps;
  if (!deps || _running) return null;
  _running = true;
  try {
    return runInternal(deps);
  } catch {
    return null;   // kurtarma ASLA oynatmayı bozmaz
  } finally {
    _running = false;
  }
}

function runInternal(deps: RecoveryRuntimeDeps): RecoveryRunResult | null {
  const snap = getSnapshot();
  const projected = getProjectedQueueView();

  // Otorite yoksa veya hiç projeksiyon yoksa uzlaştırılacak bir şey de yoktur.
  const nativeView = snap.authorityAvailable
    ? {
      revision: snap.queueRevision ?? 0,
      length: snap.queueLength ?? 0,
      currentIndex: snap.currentIndex ?? -1,
      source: isKnownSourceClass(snap.activeSource) ? snap.activeSource : null,
      currentItemId: snap.currentTrackId ? snap.currentTrackId : null,
    }
    : null;

  const reconciliation = reconcileQueue(projected, nativeView);
  const drift = reconciliation.drift;

  // Sapma çözüldüyse bu imzanın cezası kalkar (geçmiş yeni sapmayı cezalandırmaz).
  const sourceId = projected?.source ?? 'NONE';
  const signature = recoverySignature(drift, sourceId);
  if (drift === 'IN_SYNC') {
    _ledger = clearAllResolved(_ledger, sourceId);
    return null;
  }

  const nowMs = deps.now();
  const entry = readLedger(_ledger, signature);
  const generationAtDecision = safeCall(deps.getGeneration, 0);
  const revisionAtDecision = nativeView?.revision ?? -1;

  recordMediaEvent({
    type: 'queue_drift_detected',
    generation: generationAtDecision,
    source: sourceId,
    queueRevision: revisionAtDecision,
    detail: drift,
  });

  const decision = decideQueueRecovery({
    drift,
    // Native timeline sahipliği: yalnız otorite erişilebilir VE kaynak bizim
    // sahiplendiğimiz sınıflardan biriyse. Dış kaynakta FAIL-CLOSED.
    nativeAuthoritative: nativeView !== null && isOwnedSource(nativeView.source),
    handoverInFlight: safeCall(deps.isHandoverInFlight, false),
    userCommandInFlight: safeCall(deps.isUserCommandInFlight, false),
    playbackActive: snap.playing === true || snap.renderingVerified === true,
    attempts: entry?.attempts ?? 0,
    nowMs,
    lastAttemptAtMs: entry?.lastAttemptAtMs ?? null,
    breakerOpenUntilMs: entry?.breakerOpenUntilMs ?? null,
  });

  if (decision.outcome !== 'recovered') {
    _last = { drift, decision, outcome: decision.outcome, appliedAtMs: nowMs };
    return _last;
  }

  recordMediaEvent({
    type: 'queue_recovery_started',
    generation: generationAtDecision,
    source: sourceId,
    queueRevision: revisionAtDecision,
    detail: decision.code,
  });

  /* ── BAYATLIK KAPISI: karar ile uygulama arasında dünya değiştiyse ATıL ── */
  const currentSnap = getSnapshot();
  const applicable = isRecoveryApplicable({
    decidedAtGeneration: generationAtDecision,
    currentGeneration: safeCall(deps.getGeneration, 0),
    decidedAtNativeRevision: revisionAtDecision,
    currentNativeRevision: currentSnap.queueRevision ?? -1,
  });

  if (!applicable) {
    recordMediaEvent({
      type: 'stale_callback_rejected',
      generation: generationAtDecision,
      source: sourceId,
      detail: 'recovery_stale',
    });
    const stale: RecoveryDecision = {
      outcome: 'rejected',
      action: 'NONE',
      code: 'stale_decision',
      reason: 'Karar verildikten sonra kuyruk/generation değişti; kurtarma UYGULANMADI.',
    };
    _last = { drift, decision: stale, outcome: 'rejected', appliedAtMs: deps.now() };
    return _last;
  }

  /* ── Uygulama ────────────────────────────────────────────────────────── */
  let failed = false;
  try {
    switch (decision.action) {
      case 'ALIGN_INDEX':
      case 'REPROJECT_UI_FROM_NATIVE': {
        const idx = currentSnap.currentIndex ?? -1;
        if (idx >= 0) {
          deps.alignUiIndex(idx);
          noteProjectedIndex(idx);
        }
        break;
      }
      case 'CLEAR_UI_QUEUE':
        deps.clearUiQueue();
        break;
      default:
        break;
    }
  } catch {
    failed = true;
  }

  _ledger = recordAttempt(_ledger, { signature, nowMs: deps.now(), failed });

  recordMediaEvent({
    type: failed ? 'queue_recovery_failed' : 'queue_recovery_completed',
    generation: generationAtDecision,
    source: sourceId,
    queueRevision: currentSnap.queueRevision ?? null,
    detail: decision.code,
  });

  _last = {
    drift,
    decision: failed
      ? { ...decision, outcome: 'failed', reason: 'Kurtarma uygulanırken hata oluştu.' }
      : decision,
    outcome: failed ? 'failed' : 'recovered',
    appliedAtMs: deps.now(),
  };
  return _last;
}

/** Otoritenin native timeline'ına sahip olduğu kaynaklar. */
function isOwnedSource(source: string | null): boolean {
  return source === 'LOCAL' || source === 'STREAM' || source === 'INTERNET_RADIO';
}

function safeCall<T>(fn: () => T, fallback: T): T {
  try { return fn(); } catch { return fallback; }
}

/** Uyum sağlandığında bu kaynağa ait tüm sapma cezalarını temizler. */
function clearAllResolved(ledger: RecoveryLedger, sourceId: string): RecoveryLedger {
  let out = ledger;
  for (const e of ledger.entries) {
    if (e.signature.endsWith(`:${sourceId}`)) out = clearSignature(out, e.signature);
  }
  return out;
}

export function __resetRecoveryRuntimeForTest(): void {
  _ledger = EMPTY_RECOVERY_LEDGER;
  _last = null;
  _deps = null;
  _running = false;
}
