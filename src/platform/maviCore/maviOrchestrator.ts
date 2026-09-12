/**
 * maviCore/maviOrchestrator.ts — MAVİ ÇEKİRDEĞİ Faz-1 · ORKESTRATÖR (saf iskelet).
 *
 * AMAÇ: Altı alt sistemi (lifecycle · actionRegistry · actionSafety · contextStore ·
 * executionEngine · latencyTelemetry) TEK tutarlı sesli-etkileşim turunda birleştirir. Bir
 * "tur" şu akıştır: wake/listen → capture → execute(plan) → speak → finish. Her adım doğru
 * lifecycle geçişini + gecikme işaretini + bağlam güncellemesini tetikler.
 *
 * KAPSAM SINIRLARI (task kuralları · CLAUDE.md):
 *  - LLM · STT · TTS · WAKE WORD BAĞLANMAZ. Niyet/plan ÜRETİMİ (parser/LLM) bu katmanın DIŞINDA;
 *    orkestratör yalnız DIŞARIDAN verilen planı yürütür. `onSpeak` sadece bir GÖZLEMCİDİR (gerçek
 *    TTS wiring sonraki faz). SystemBoot wiring YOK.
 *  - İKİNCİ OTORİTE YOK: güvenlik kararı actionSafety→AiSafetyGate'te; orkestratör karar VERMEZ.
 *  - BARGE-IN / STALE: her tur `capture()` anındaki oturum kuşağını (generation) taşır; araya yeni
 *    tur girerse (kullanıcı böler → yeni oturum, kuşak artar) eski turun planı executionEngine
 *    tarafından stale reddedilir. Böylece bayat plan asla çalışmaz.
 *  - İDEMPOTENT: start/dispose/restart güvenli tekrarlanır. TIMER YOK · yan etkisiz import.
 */

import { createMaviLifecycle, MaviLifecycle, type MaviState } from './maviLifecycle';
import { createPilotActionRegistry, MaviActionRegistry } from './actionRegistry';
import { createMaviContextStore, MaviContextStore, type MaviContextSnapshot } from './contextStore';
import { createExecutionEngine, MaviExecutionEngine, type ActionHandler, type MaviPlan, type PlanResult } from './executionEngine';
import {
  createLatencyTracker, MaviLatencyTracker, type LatencySegments, type SessionLatency, type SlowStageEvent,
} from './latencyTelemetry';
import { createAiSafetyGate, AiSafetyGate } from '../aiCore/safetyGate';

/* ══════════════════════════════════════════════════════════════════════════
 * Kontratlar
 * ════════════════════════════════════════════════════════════════════════ */

/** capture() sonucu — bu turu tanımlayan jeton (execute'e AYNEN geri verilir → stale koruması). */
export interface MaviTurnToken {
  readonly generation: number;
}

export interface MaviOrchestratorDeps {
  /** actionId → gerçek yürütme handler'ı (media/nav/ui/health portları). Zorunlu (DI). */
  readonly handlers: ReadonlyMap<string, ActionHandler> | Readonly<Record<string, ActionHandler>>;
  /** Araç güvenlik kapısı. Varsayılan: createAiSafetyGate() (yalnız 'read'). */
  readonly gate?: AiSafetyGate;
  /** Eylem defteri. Varsayılan: pilot eylem seti. */
  readonly registry?: MaviActionRegistry;
  /** Monotonik saat (test enjekte eder). */
  readonly now?: () => number;
  readonly dedupeWindowMs?: number;
  readonly stageThresholdMs?: number;
  /** Gözlemciler (yalnız bildirim — TTS/UI BAĞLAMA DEĞİL). */
  readonly onStateChange?: (state: MaviState) => void;
  readonly onSlowStage?: (e: SlowStageEvent) => void;
  /** Cevap seslendirme NİYETİ (gerçek TTS sonraki faz — burada yalnız gözlem). */
  readonly onSpeak?: (text: string) => void;
}

export interface MaviOrchestratorSnapshot {
  readonly state: MaviState;
  readonly generation: number;
  readonly context: MaviContextSnapshot;
  readonly recentLatency: readonly SessionLatency[];
}

/* ══════════════════════════════════════════════════════════════════════════
 * Orkestratör
 * ════════════════════════════════════════════════════════════════════════ */

export class MaviOrchestrator {
  readonly lifecycle: MaviLifecycle;
  readonly registry: MaviActionRegistry;
  readonly gate: AiSafetyGate;
  readonly context: MaviContextStore;
  readonly engine: MaviExecutionEngine;
  readonly telemetry: MaviLatencyTracker;

  private readonly _onSpeak?: (text: string) => void;
  private _started = false;
  private _lastSeenGeneration = 0;
  private _unsubState: (() => void) | null = null;

  constructor(deps: MaviOrchestratorDeps) {
    const now = deps.now;
    this.lifecycle = createMaviLifecycle({ now });
    this.registry = deps.registry ?? createPilotActionRegistry();
    this.gate = deps.gate ?? createAiSafetyGate();
    this.context = createMaviContextStore({ now });
    this.telemetry = createLatencyTracker({
      now, stageThresholdMs: deps.stageThresholdMs, onSlowStage: deps.onSlowStage,
    });
    this.engine = createExecutionEngine({
      registry: this.registry,
      gate: this.gate,
      handlers: deps.handlers,
      now,
      dedupeWindowMs: deps.dedupeWindowMs,
      // Stale koruması: motor "mevcut kuşağı" lifecycle'dan okur; plan turun kuşağını taşır.
      currentGeneration: () => this.lifecycle.generation,
    });
    this._onSpeak = typeof deps.onSpeak === 'function' ? deps.onSpeak : undefined;

    if (typeof deps.onStateChange === 'function') {
      const cb = deps.onStateChange;
      this._unsubState = this.lifecycle.subscribe((snap) => cb(snap.state));
    }
  }

  /* ── Lifecycle (idempotent) ─────────────────────────────────── */
  start(): void {
    if (this._started) return;
    this._started = true;
    this.lifecycle.start();
    this.context.start();
  }

  dispose(): void {
    this._started = false;
    if (this._unsubState) { this._unsubState(); this._unsubState = null; }
    this.lifecycle.dispose();
    this.context.dispose();
    this.telemetry.reset();
    this._lastSeenGeneration = 0;
  }

  restart(): void { this.dispose(); this.start(); }

  /* ── Tur akışı ──────────────────────────────────────────────── */

  /** Wake tetiği (idle→waking). Yeni oturum → telemetri başlar + 'wake' işareti. */
  wake(): boolean {
    const r = this.lifecycle.dispatch('wake');
    if (!r.accepted) return false;
    this._ensureSession();
    this.telemetry.mark('wake');
    return true;
  }

  /** Dinlemeye geç (idle→listening veya waking→listening). Yeni oturumsa telemetri başlar. */
  beginListening(): boolean {
    const r = this.lifecycle.dispatch('listen');
    if (!r.accepted) return false;
    this._ensureSession();
    this.telemetry.mark('listening');
    return true;
  }

  /**
   * Konuşma yakalandı (listening→understanding). Bu turu tanımlayan jetonu döner — execute()'e
   * AYNEN geri verilir; araya yeni tur girerse eski jetonlu plan stale reddedilir.
   */
  capture(): MaviTurnToken | null {
    const r = this.lifecycle.dispatch('capture');
    if (!r.accepted) return null;
    this.telemetry.mark('speechEnd');
    return Object.freeze({ generation: this.lifecycle.generation });
  }

  /**
   * Dışarıda (parser/LLM) üretilmiş planı yürüt. understanding→planning→executing geçişlerini,
   * planStart/firstAction işaretlerini, güvenlik+yürütme+bağlam güncellemesini yapar. Plan, turun
   * kuşağıyla damgalanır → bayatsa motor reddeder (barge-in koruması). Lifecycle 'executing'te kalır;
   * çağıran speak()/finish() ile turu kapatır.
   */
  async execute(plan: MaviPlan, token: MaviTurnToken): Promise<PlanResult> {
    // Lifecycle geçişleri best-effort (bayat/yanlış-sıra durumunda motor yine stale reddeder).
    this.lifecycle.dispatch('plan');
    this.telemetry.mark('planStart');
    this.lifecycle.dispatch('execute');
    this.telemetry.mark('firstAction');

    const gen = token && typeof token.generation === 'number' ? token.generation : this.lifecycle.generation;
    const stamped: MaviPlan = { ...plan, generation: gen };
    const result = await this.engine.executePlan(stamped);

    this._updateContextFromResult(plan, result);
    return result;
  }

  /** Cevabı seslendirme niyeti (executing→speaking). Gerçek TTS yok — yalnız onSpeak gözlemi. */
  speak(text: string): boolean {
    const r = this.lifecycle.dispatch('reply');
    if (!r.accepted) return false;
    if (this._onSpeak && typeof text === 'string' && text.length > 0) {
      try { this._onSpeak(text); } catch { /* gözlemci hatası turu bozmaz */ }
    }
    return true;
  }

  /** Takip dinlemesi (speaking→listening) — sürekli sohbet için aynı oturum. */
  followUp(): boolean {
    const r = this.lifecycle.dispatch('follow');
    if (!r.accepted) return false;
    this.telemetry.mark('listening'); // yeni turda ilk işaret zaten alınmışsa korunur
    return true;
  }

  /** Turu kapat (speaking/executing→idle). 'complete' işareti + telemetri oturumu yazılır. */
  finish(): LatencySegments {
    this.telemetry.mark('complete');
    // speaking'ten veya doğrudan executing'ten idle'a settle.
    this.lifecycle.dispatch('settle');
    const entry = this.telemetry.endSession();
    return entry.segments;
  }

  /**
   * İptal / barge-in (herhangi bir aktif durum → cancelled). Telemetri oturumu kapatılır;
   * lifecycle 'cancelled'ta bırakılır (recover() ile idle'a döner). Sonraki tur yeni oturum
   * kuşağı üreteceğinden, bu turun geç gelen planı otomatik stale reddedilir.
   */
  cancel(): boolean {
    const r = this.lifecycle.dispatch('cancel');
    if (!r.accepted) return false;
    this.telemetry.endSession();
    return true;
  }

  /** Hata (aktif → error). */
  fail(): boolean {
    const r = this.lifecycle.dispatch('fail');
    if (!r.accepted) return false;
    this.telemetry.endSession();
    return true;
  }

  /** cancelled/error → idle. */
  recover(): boolean {
    return this.lifecycle.dispatch('recover').accepted;
  }

  /* ── Gözlem ─────────────────────────────────────────────────── */
  get state(): MaviState { return this.lifecycle.state; }

  snapshot(): MaviOrchestratorSnapshot {
    return Object.freeze({
      state: this.lifecycle.state,
      generation: this.lifecycle.generation,
      context: this.context.snapshot(),
      recentLatency: this.telemetry.recent(),
    });
  }

  /* ── İç yardımcılar ─────────────────────────────────────────── */

  /** Yeni oturum başladıysa (generation arttı) telemetri oturumunu aç. */
  private _ensureSession(): void {
    const gen = this.lifecycle.generation;
    if (gen !== this._lastSeenGeneration) {
      this._lastSeenGeneration = gen;
      this.telemetry.beginSession(this.lifecycle.sessionId);
    }
  }

  /** Başarılı adımlardan kısa-süreli bağlamı güncelle (son eylem/ekran + asistan turu). */
  private _updateContextFromResult(plan: MaviPlan, result: PlanResult): void {
    for (let i = 0; i < result.steps.length; i++) {
      const step = result.steps[i];
      if (step.status !== 'ok') continue;
      this.context.setLastAction(step.actionId);
      this.context.pushTurn({ role: 'assistant', intentId: step.actionId });
      // Ekran açan eylem → referans çözümleme için son ekranı sakla.
      if (step.actionId === 'ui.page.open') {
        const payload = plan.steps[i]?.payload as { page?: string } | undefined;
        if (payload && typeof payload.page === 'string') this.context.setLastScreen(payload.page);
      }
    }
  }
}

/** Fabrika — DI ile orkestratör. Import yan etkisizdir (hiçbir singleton/timer/native YOK). */
export function createMaviOrchestrator(deps: MaviOrchestratorDeps): MaviOrchestrator {
  return new MaviOrchestrator(deps);
}
