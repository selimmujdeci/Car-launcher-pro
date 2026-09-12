/**
 * maviCore/executionEngine.ts — MAVİ ÇEKİRDEĞİ Faz-1 · Çok-eylemli YÜRÜTME MOTORU.
 *
 * AMAÇ: Bir aksiyon planını (bir/çok eylem, sıralı veya paralel) GÜVENLİ yürütmek. Her adım
 * defterden (actionRegistry) çözülür, payload doğrulanır, güvenlik köprüsünden (actionSafety →
 * AiSafetyGate) geçer, ardından DI edilmiş handler ile bounded-timeout içinde çalışır.
 *
 * SÖZLEŞME (VİZYON "8 Kapı" gate-8 → aksiyon; CLAUDE.md §2/§3):
 *  - PARTIAL SUCCESS: bir adımın düşmesi diğerlerini otomatik iptal ETMEZ; her adımın sonucu
 *    ayrı raporlanır. (İstenirse rollbackOnFailure ile atomic-best-effort'a çevrilir.)
 *  - ROLLBACK yalnız reversible=true eylemlerde: handler geri-alma döndürürse ve plan
 *    rollbackOnFailure ise, başarısızlıkta önceki başarılı+reversible adımlar TERS sırada geri alınır.
 *  - BOUNDED TIMEOUT: her adım def.timeoutMs içinde bitmezse AbortSignal ile kesilir ('timeout').
 *    (setTimeout tek-atım — sürekli loop DEĞİL.)
 *  - DUPLICATE SUPPRESSION: aynı (actionId+payload) imzası dedupe penceresinde tekrar gelirse
 *    atlanır ('duplicate') — çift STT/çift tetik aynı eylemi iki kez yaptırmaz.
 *  - STALE REDDİ: plan üretildiği oturum kuşağını taşır; mevcut kuşakla uyuşmazsa plan tümüyle
 *    'rejected' (bayat plan hiçbir adımı çalıştırmaz).
 *  - FAIL-CLOSED · fail-soft: bilinmeyen eylem/handler/bozuk girdi güvenli reddedilir; hiçbir
 *    handler hatası motoru çökertmez.
 */

import type { MaviActionRegistry } from './actionRegistry';
import type { AiSafetyGate } from '../aiCore/safetyGate';
import { evaluateActionSafety } from './actionSafety';

/* ══════════════════════════════════════════════════════════════════════════
 * Handler portu (*Like — gerçek servis DI ile bağlanır; motor servise bağımlı DEĞİL)
 * ════════════════════════════════════════════════════════════════════════ */

/** Bir eylemin gerçek yürütme sonucu (handler döndürür). */
export interface ActionExecResult {
  readonly ok: boolean;
  /** resultContract:'value' eylemler için taşınan veri (ör. araç sağlığı özeti). */
  readonly value?: unknown;
  readonly error?: string;
  /** reversible eylem başarılıysa geri-alma fonksiyonu — motor rollback'te çağırır. */
  readonly rollback?: () => Promise<void> | void;
}

/**
 * Eylem handler'ı — doğrulanmış payload + iptal sinyali alır. Gerçek servis çağrısı BURADA
 * (media/nav/ui/health portları). AbortSignal'e saygı göstermeli (timeout'ta iptal); göstermese
 * bile motor adımı 'timeout' raporlar (yarış).
 */
export type ActionHandler = (
  payload: Readonly<Record<string, unknown>>,
  signal: AbortSignal,
) => Promise<ActionExecResult> | ActionExecResult;

/* ══════════════════════════════════════════════════════════════════════════
 * Plan + sonuç kontratları
 * ════════════════════════════════════════════════════════════════════════ */

export interface PlanStep {
  readonly actionId: string;
  readonly payload?: unknown;
  /** Kullanıcı bu adımı (orta/yüksek risk) önceden onayladı mı. */
  readonly confirmed?: boolean;
}

export type PlanMode = 'sequential' | 'parallel';

export interface MaviPlan {
  readonly mode: PlanMode;
  readonly steps: readonly PlanStep[];
  /** Planın üretildiği oturum kuşağı (stale reddi için). */
  readonly generation?: number;
  /** Sıralı/paralel: bir adım düşerse başarılı+reversible adımları geri al (atomic best-effort). */
  readonly rollbackOnFailure?: boolean;
}

export type StepStatus =
  | 'ok'
  | 'failed'
  | 'timeout'
  | 'denied'
  | 'needs_confirmation'
  | 'invalid'
  | 'unknown_action'
  | 'no_handler'
  | 'duplicate'
  | 'rolled_back';

export interface StepResult {
  readonly actionId: string;
  readonly status: StepStatus;
  readonly reason?: string;
  readonly value?: unknown;
}

export type PlanStatus = 'completed' | 'partial' | 'failed' | 'rejected';

export interface PlanResult {
  readonly status: PlanStatus;
  readonly steps: readonly StepResult[];
  readonly rolledBack: boolean;
  /** Stale/boş plan gibi durumlarda makine-okur gerekçe. */
  readonly reason?: string;
}

/* ══════════════════════════════════════════════════════════════════════════
 * Motor
 * ════════════════════════════════════════════════════════════════════════ */

export interface ExecutionEngineDeps {
  readonly registry: MaviActionRegistry;
  readonly gate: AiSafetyGate;
  /** actionId → handler. Handler'ı olmayan kayıtlı eylem 'no_handler' ile düşer. */
  readonly handlers: ReadonlyMap<string, ActionHandler> | Readonly<Record<string, ActionHandler>>;
  /** Monotonik saat (dedupe/telemetri). Varsayılan performance.now → Date.now. */
  readonly now?: () => number;
  /** Duplicate suppression penceresi (ms). Varsayılan 1500. 0 → dedupe kapalı. */
  readonly dedupeWindowMs?: number;
  /** Mevcut oturum kuşağı — stale plan reddi. Yoksa stale kontrolü YAPILMAZ. */
  readonly currentGeneration?: () => number;
}

interface RollbackEntry {
  readonly actionId: string;
  readonly rollback: () => Promise<void> | void;
}

export class MaviExecutionEngine {
  private readonly _registry: MaviActionRegistry;
  private readonly _gate: AiSafetyGate;
  private readonly _handlers: ReadonlyMap<string, ActionHandler>;
  private readonly _now: () => number;
  private readonly _dedupeWindowMs: number;
  private readonly _currentGeneration?: () => number;
  /** İmza → son çalışma zamanı (bounded — pencere dışı girişler budanır). */
  private readonly _lastRun = new Map<string, number>();

  constructor(deps: ExecutionEngineDeps) {
    this._registry = deps.registry;
    this._gate = deps.gate;
    this._handlers = normalizeHandlers(deps.handlers);
    this._now = typeof deps.now === 'function' ? deps.now : defaultNow;
    this._dedupeWindowMs = typeof deps.dedupeWindowMs === 'number' && deps.dedupeWindowMs >= 0
      ? deps.dedupeWindowMs : 1_500;
    this._currentGeneration = typeof deps.currentGeneration === 'function' ? deps.currentGeneration : undefined;
  }

  /** Bir planı yürüt. Asla throw etmez — tüm hatalar StepResult/PlanResult'a düşer. */
  async executePlan(plan: MaviPlan): Promise<PlanResult> {
    // Bozuk/boş plan → fail-closed.
    if (!plan || !Array.isArray(plan.steps) || plan.steps.length === 0) {
      return frozenPlan('rejected', [], false, 'empty_plan');
    }

    // Stale reddi: plan bir kuşak taşıyor ve mevcut kuşakla uyuşmuyorsa hiçbir adım çalışmaz.
    if (typeof plan.generation === 'number' && this._currentGeneration) {
      let cur: number | undefined;
      try { cur = this._currentGeneration(); } catch { cur = undefined; }
      if (typeof cur === 'number' && cur !== plan.generation) {
        return frozenPlan('rejected', [], false, 'stale_generation');
      }
    }

    const mode: PlanMode = plan.mode === 'parallel' ? 'parallel' : 'sequential';
    const rollbacks: RollbackEntry[] = [];
    let results: StepResult[];

    if (mode === 'sequential') {
      results = await this._runSequential(plan, rollbacks);
    } else {
      results = await this._runParallel(plan, rollbacks);
    }

    // Rollback kararı: rollbackOnFailure ve en az bir "gerçek başarısızlık" varsa geri al.
    let rolledBack = false;
    if (plan.rollbackOnFailure === true && rollbacks.length > 0 && hasHardFailure(results)) {
      rolledBack = await this._rollback(rollbacks, results);
    }

    return frozenPlan(deriveStatus(results, rolledBack), results, rolledBack);
  }

  /* ── Sıralı yürütme ─────────────────────────────────────────── */
  private async _runSequential(plan: MaviPlan, rollbacks: RollbackEntry[]): Promise<StepResult[]> {
    const results: StepResult[] = [];
    for (const step of plan.steps) {
      const { result, rollback } = await this._runStep(step);
      results.push(result);
      if (rollback) rollbacks.push(rollback);
      // Atomic mod: ilk gerçek başarısızlıkta dur (kalan adımlar çalışmaz → rollback tetiklenir).
      if (plan.rollbackOnFailure === true && isHardFailure(result.status)) break;
    }
    return results;
  }

  /* ── Paralel yürütme (barrier — tüm adımlar toplanır) ──────── */
  private async _runParallel(plan: MaviPlan, rollbacks: RollbackEntry[]): Promise<StepResult[]> {
    const settled = await Promise.all(plan.steps.map((step) => this._runStep(step)));
    const results: StepResult[] = [];
    for (const s of settled) {
      results.push(s.result);
      if (s.rollback) rollbacks.push(s.rollback);
    }
    return results;
  }

  /* ── Tek adım ──────────────────────────────────────────────── */
  private async _runStep(step: PlanStep): Promise<{ result: StepResult; rollback?: RollbackEntry }> {
    const actionId = step?.actionId;
    if (typeof actionId !== 'string' || actionId.length === 0) {
      return { result: { actionId: 'unknown', status: 'unknown_action', reason: 'missing_action_id' } };
    }

    // 1. Defter — bilinmeyen eylem fail-closed.
    const def = this._registry.get(actionId);
    if (!def) return { result: { actionId, status: 'unknown_action' } };

    // 2. Payload doğrulama.
    const validation = def.validate(step.payload);
    if (!validation.ok) {
      return { result: { actionId, status: 'invalid', reason: validation.errors[0] ?? 'invalid_payload' } };
    }
    const payload = validation.value ?? Object.freeze({});

    // 3. Duplicate suppression (imza = actionId + doğrulanmış payload).
    const sig = actionId + '|' + stableStringify(payload);
    if (this._isDuplicate(sig)) {
      return { result: { actionId, status: 'duplicate' } };
    }

    // 4. Güvenlik köprüsü (araç kapısı delegasyonu + UX risk).
    const safety = evaluateActionSafety(def, this._gate, { confirmed: step.confirmed });
    if (safety.outcome === 'deny') {
      return { result: { actionId, status: 'denied', reason: safety.gateReason ?? safety.reason } };
    }
    if (safety.outcome === 'confirm') {
      return { result: { actionId, status: 'needs_confirmation', reason: safety.reason } };
    }

    // 5. Handler — kayıtlı ama yürütücüsü yoksa 'no_handler'.
    const handler = this._handlers.get(actionId);
    if (!handler) return { result: { actionId, status: 'no_handler' } };

    // İmzayı ÇALIŞMA ÖNCESİ işaretle (aynı tick'teki ikinci kopya duplicate sayılsın).
    this._markRun(sig);

    // 6. Bounded-timeout içinde çalıştır.
    const exec = await this._runWithTimeout(handler, payload, def.timeoutMs);
    if (exec.kind === 'timeout') {
      return { result: { actionId, status: 'timeout', reason: `>${def.timeoutMs}ms` } };
    }
    if (exec.kind === 'error') {
      return { result: { actionId, status: 'failed', reason: exec.error } };
    }
    const r = exec.result;
    if (!r || r.ok !== true) {
      return { result: { actionId, status: 'failed', reason: r?.error ?? 'handler_not_ok' } };
    }

    // 7. Başarılı — reversible ise rollback kaydını taşı.
    const result: StepResult = { actionId, status: 'ok', value: r.value };
    const rollback = def.reversible && typeof r.rollback === 'function'
      ? { actionId, rollback: r.rollback }
      : undefined;
    return { result, rollback };
  }

  /** Handler'ı def.timeoutMs ile yarıştırır; timeout → abort. */
  private _runWithTimeout(
    handler: ActionHandler,
    payload: Readonly<Record<string, unknown>>,
    timeoutMs: number,
  ): Promise<{ kind: 'result'; result: ActionExecResult } | { kind: 'error'; error: string } | { kind: 'timeout' }> {
    const ac = new AbortController();
    let timer: ReturnType<typeof setTimeout> | null = null;

    const timeoutP = new Promise<{ kind: 'timeout' }>((resolve) => {
      timer = setTimeout(() => { try { ac.abort(); } catch { /* noop */ } resolve({ kind: 'timeout' }); },
        Math.max(1, timeoutMs));
    });

    const runP = (async () => {
      try {
        const result = await handler(payload, ac.signal);
        return { kind: 'result' as const, result };
      } catch (e) {
        return { kind: 'error' as const, error: e instanceof Error ? e.message : String(e) };
      }
    })();

    return Promise.race([runP, timeoutP]).then((outcome) => {
      if (timer !== null) clearTimeout(timer);
      return outcome;
    });
  }

  /* ── Rollback ───────────────────────────────────────────────── */
  private async _rollback(rollbacks: RollbackEntry[], results: StepResult[]): Promise<boolean> {
    let any = false;
    // Ters sırada (son yapılanı önce geri al).
    for (let i = rollbacks.length - 1; i >= 0; i--) {
      const entry = rollbacks[i];
      try {
        await entry.rollback();
        any = true;
        // Sonuç kaydını 'rolled_back' olarak işaretle (ilk eşleşen 'ok' adımı).
        for (let j = 0; j < results.length; j++) {
          if (results[j].actionId === entry.actionId && results[j].status === 'ok') {
            results[j] = { actionId: entry.actionId, status: 'rolled_back', value: results[j].value };
            break;
          }
        }
      } catch { /* rollback hatası diğerlerini engellemez (fail-soft) */ }
    }
    return any;
  }

  /* ── Dedupe yardımcıları ────────────────────────────────────── */
  private _isDuplicate(sig: string): boolean {
    if (this._dedupeWindowMs === 0) return false;
    const prev = this._lastRun.get(sig);
    if (prev === undefined) return false;
    return (this._safeNow() - prev) < this._dedupeWindowMs;
  }

  private _markRun(sig: string): void {
    if (this._dedupeWindowMs === 0) return;
    const now = this._safeNow();
    this._lastRun.set(sig, now);
    // Bounded: pencere dışı girişleri buda (sınırsız büyümesin).
    if (this._lastRun.size > 64) {
      for (const [k, t] of this._lastRun) {
        if (now - t >= this._dedupeWindowMs) this._lastRun.delete(k);
      }
    }
  }

  private _safeNow(): number {
    try {
      const t = this._now();
      return typeof t === 'number' && Number.isFinite(t) ? t : 0;
    } catch { return 0; }
  }
}

/* ══════════════════════════════════════════════════════════════════════════
 * Saf yardımcılar
 * ════════════════════════════════════════════════════════════════════════ */

function defaultNow(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now() : Date.now();
}

function normalizeHandlers(
  h: ReadonlyMap<string, ActionHandler> | Readonly<Record<string, ActionHandler>>,
): ReadonlyMap<string, ActionHandler> {
  if (h instanceof Map) return h;
  const m = new Map<string, ActionHandler>();
  if (h && typeof h === 'object') {
    for (const k of Object.keys(h)) {
      const fn = (h as Record<string, ActionHandler>)[k];
      if (typeof fn === 'function') m.set(k, fn);
    }
  }
  return m;
}

/** Deterministik anahtar-sıralı stringify (dedupe imzası için — anahtar sırası imzayı değiştirmesin). */
function stableStringify(obj: Readonly<Record<string, unknown>>): string {
  const keys = Object.keys(obj).sort();
  const parts: string[] = [];
  for (const k of keys) parts.push(JSON.stringify(k) + ':' + JSON.stringify(obj[k]));
  return '{' + parts.join(',') + '}';
}

/** "Gerçek başarısızlık" = eylemin çalışıp/çalışamayıp hedefe ulaşamadığı durumlar. */
const HARD_FAILURE: ReadonlySet<StepStatus> = new Set<StepStatus>([
  'failed', 'timeout', 'denied', 'invalid', 'unknown_action', 'no_handler',
]);

function isHardFailure(status: StepStatus): boolean {
  return HARD_FAILURE.has(status);
}

function hasHardFailure(results: readonly StepResult[]): boolean {
  return results.some((r) => isHardFailure(r.status));
}

function deriveStatus(results: readonly StepResult[], rolledBack: boolean): PlanStatus {
  const okCount = results.filter((r) => r.status === 'ok').length;
  const hardFails = results.filter((r) => isHardFailure(r.status)).length;
  if (rolledBack) return 'failed';
  if (hardFails === 0 && results.every((r) => r.status === 'ok')) return 'completed';
  if (okCount === 0 && hardFails > 0) return 'failed';
  return 'partial';
}

function frozenPlan(status: PlanStatus, steps: StepResult[], rolledBack: boolean, reason?: string): PlanResult {
  return Object.freeze({ status, steps: Object.freeze(steps.slice()), rolledBack, reason });
}

/** Fabrika — DI ile motor örneği. Import yan etkisizdir. */
export function createExecutionEngine(deps: ExecutionEngineDeps): MaviExecutionEngine {
  return new MaviExecutionEngine(deps);
}
