/**
 * aiCore/runtime/aiCoreRuntime.ts — AI CORE RUNTIME MOTORU (edge-triggered · bounded · Faz-2).
 *
 * AMAÇ: AI Core'u canlı platforma bağlar. Event Bus'ın araç olaylarına ABONE olur; bir edge
 * olayı geldiğinde HAL'ı OKUYUP (poll DEĞİL) bağlam kurar, Orchestrator'ı (read-only Safety
 * Gate) çalıştırır ve sonucu READ-ONLY platform event (`ai.mechanic.report`) + result store
 * olarak yayınlar.
 *
 * ANAYASAL SINIRLAR (görev sözleşmesi):
 *  - İKİNCİ POLLING/VERİ/KARAR OTORİTESİ YOK: hiçbir setInterval/poll açılmaz. Tek zamanlayıcı
 *    edge-olayıyla TETİKLENEN debounce/min-interval coalescer'dır (kendi başına ateşlenmez).
 *  - HER FRAME'DE AJAN YOK: bounded — art arda olaylar tek çalışmaya coalesce edilir; iki
 *    çalışma arası en az `minRunIntervalMs` (varsayılan 4s). `vehicle.signal.changed` (3Hz)
 *    sağanağı tek çalışmaya iner.
 *  - DETERMİNİSTİK ÇEKİRDEK: Orchestrator/Verdict offline çalışır; LLM YOK (Faz-2 kapsam dışı).
 *  - ECU write/coding/actuator: Orchestrator'ın Safety Gate'i (varsayılan read-only) zorlar.
 *  - KANIT YOKSA DÜRÜST SUSMA: AI Usta zaten yapar; runtime raporu olduğu gibi yayınlar.
 *
 * FAIL-SOFT / ZERO-LEAK: bus/HAL yoksa no-op; abonelik/timer cleanup'ta bırakılır; start/dispose
 * İDEMPOTENT; dispose sonrası hiçbir çalışma/yayın olmaz (terminal). DI: bus/hal/orchestrator/
 * zaman/timer enjekte edilir → HAL/bus kurmadan test edilir. Import YAN ETKİSİZ.
 */

import type { AiOrchestrator, AiOrchestratorRunResult } from '../aiOrchestrator';
import { assembleVehicleContext } from '../vehicleContext';
import { AI_MECHANIC_ID } from '../agents/aiMechanic';
import {
  halSnapshotToContextInput, type HalSnapshotLike, type HalIdentityLike,
} from './halAdapter';
import {
  deriveDiagnosticEvidence, obdDeepToSections,
  type DiagObdDeepLike, type DiagSourceHealthLike, type DiagFreezeFrameLike, type DiagMemoryLimitLike,
} from './diagnosticEvidence';
import type { AiEvidenceItem } from '../types';
import type { TriageSections } from '../../diagnosticTriage';

/**
 * Faz-2.5 tanı zenginleştirme sağlayıcısı (DI). Edge çalışmasında ÇAĞRILIR — mevcut
 * Diagnostics V2 anlık görüntüsünü (obdDeep) + kaynak sağlığı + cache freeze döndürür.
 * Yeni poll AÇMAZ (mevcut snapshot okunur). null → zenginleştirme yok (Faz-2 davranışı).
 */
export interface DiagnosticsProviderResult {
  readonly obdDeep?: DiagObdDeepLike | null;
  readonly sourceHealth?: DiagSourceHealthLike | null;
  readonly freezeFrame?: DiagFreezeFrameLike | null;
  readonly memoryLimits?: readonly DiagMemoryLimitLike[];
}
export type DiagnosticsProvider = () => DiagnosticsProviderResult | null;

/* ── Decoupled runtime bağımlılıkları (PlatformEventBus / vehicleHal yapısal uyar) ── */

export interface RuntimeBusLike {
  subscribe(
    eventName: string,
    listener: (event: unknown) => void,
    options?: { readonly replayLast?: boolean; readonly owner?: string },
  ): string | null;
  unsubscribe(id: string): boolean;
  publish(input: {
    name: string; payload?: unknown; domain?: string; source?: string;
    transient?: boolean; retained?: boolean; vehicleFingerprintHash?: string;
  }): unknown;
}

export interface RuntimeHalLike {
  getSnapshot(): HalSnapshotLike;
  getVehicleIdentity(): HalIdentityLike;
}

export interface AiCoreRuntimeDeps {
  readonly bus: RuntimeBusLike;
  readonly hal: RuntimeHalLike;
  readonly orchestrator: AiOrchestrator;
  /** Faz-2.5: tanı zenginleştirme sağlayıcısı (opsiyonel). Yoksa Faz-2 davranışı (minimal). */
  readonly diagnosticsProvider?: DiagnosticsProvider;
  readonly now?: () => number;
  readonly online?: () => boolean;
  /** İki çalışma arası minimum (bounded). Varsayılan 4000ms. */
  readonly minRunIntervalMs?: number;
  /** Sağanak coalesce penceresi. Varsayılan 600ms. */
  readonly debounceMs?: number;
  /** Test enjeksiyonu — varsayılan global setTimeout/clearTimeout. */
  readonly setTimeoutFn?: (fn: () => void, ms: number) => unknown;
  readonly clearTimeoutFn?: (handle: unknown) => void;
}

/** AI Core sonucunu taşıyan READ-ONLY platform event adı (domain 'ai'). */
export const AI_MECHANIC_REPORT_EVENT = 'ai.mechanic.report';

/** Edge-trigger olayları — HAL bridge'in yayınladığı gerçek `vehicle.*` olayları. */
const TRIGGER_EVENTS: readonly string[] = [
  'vehicle.connection.changed',
  'vehicle.ignition.changed',
  'vehicle.identity.changed',
  'vehicle.signal.changed',
];
/** replayLast (opt-in) yalnız RETAINED olaylar için anlamlı (transient signal hariç). */
const RETAINED_TRIGGERS: ReadonlySet<string> = new Set([
  'vehicle.connection.changed', 'vehicle.ignition.changed', 'vehicle.identity.changed',
]);

const DEFAULT_MIN_RUN_INTERVAL_MS = 4_000;
const DEFAULT_DEBOUNCE_MS = 600;

export interface AiCoreRuntimeStatus {
  readonly started: boolean;
  readonly disposed: boolean;
  readonly subscriptions: number;
  readonly runCount: number;
  readonly publishedCount: number;
  readonly errorCount: number;
  readonly pending: boolean;
  readonly lastRunAt: number | null;
}

export class AiCoreRuntime {
  private readonly _bus: RuntimeBusLike;
  private readonly _hal: RuntimeHalLike;
  private readonly _orchestrator: AiOrchestrator;
  private readonly _diagProvider: DiagnosticsProvider | null;
  private readonly _now: () => number;
  private readonly _online: () => boolean;
  private readonly _minInterval: number;
  private readonly _debounce: number;
  private readonly _setTimeout: (fn: () => void, ms: number) => unknown;
  private readonly _clearTimeout: (handle: unknown) => void;

  private readonly _subIds: string[] = [];
  private _timer: unknown = null;
  private _lastRunAt = 0;
  private _started = false;
  private _disposed = false;

  private _runCount = 0;
  private _publishedCount = 0;
  private _errorCount = 0;
  private _lastResult: AiOrchestratorRunResult | null = null;

  constructor(deps: AiCoreRuntimeDeps) {
    this._bus = deps.bus;
    this._hal = deps.hal;
    this._orchestrator = deps.orchestrator;
    this._diagProvider = deps.diagnosticsProvider ?? null;
    this._now = typeof deps.now === 'function' ? deps.now : () => Date.now();
    this._online = typeof deps.online === 'function' ? deps.online : () => true;
    this._minInterval = deps.minRunIntervalMs && deps.minRunIntervalMs > 0 ? deps.minRunIntervalMs : DEFAULT_MIN_RUN_INTERVAL_MS;
    this._debounce = deps.debounceMs && deps.debounceMs >= 0 ? deps.debounceMs : DEFAULT_DEBOUNCE_MS;
    this._setTimeout = deps.setTimeoutFn ?? ((fn, ms) => setTimeout(fn, ms));
    this._clearTimeout = deps.clearTimeoutFn ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  }

  /** Edge olaylarına abone olur. İDEMPOTENT; dispose sonrası no-op (terminal). */
  start(): void {
    if (this._started || this._disposed) return;
    this._started = true;
    for (const name of TRIGGER_EVENTS) {
      const id = this._bus.subscribe(
        name,
        () => this._schedule(),
        { owner: 'aiCoreRuntime', replayLast: RETAINED_TRIGGERS.has(name) },
      );
      if (typeof id === 'string') this._subIds.push(id);
    }
  }

  /** Bir çalışma zamanla — art arda çağrılar tek çalışmaya coalesce edilir (bounded). */
  private _schedule(): void {
    if (this._disposed) return;
    if (this._timer !== null) return;                 // zaten zamanlı → coalesce
    const since = this._now() - this._lastRunAt;
    const wait = since >= this._minInterval
      ? this._debounce
      : Math.max(this._debounce, this._minInterval - since);   // min-interval'i koru (bounded)
    this._timer = this._setTimeout(() => {
      this._timer = null;
      void this._run();
    }, wait);
  }

  private async _run(): Promise<void> {
    if (this._disposed) return;
    this._lastRunAt = this._now();
    this._runCount++;
    try {
      const now = this._now();
      const snapshot = this._hal.getSnapshot();
      const identity = this._hal.getVehicleIdentity();
      const ctxInput = halSnapshotToContextInput(snapshot, identity, now, this._safeOnline());

      // Faz-2.5: tanı zenginleştirme — mevcut Diagnostics V2 anlık görüntüsünden EK kanıt +
      // zengin sections (verdict çekirdeğini DAHA İYİ besler; ikinci otorite değil). Provider
      // yoksa Faz-2 davranışı (minimal). Provider hatası izole → minimal bağlama düşülür.
      let sections: TriageSections | null | undefined = ctxInput.diagnosticSections;
      let extraEvidence: AiEvidenceItem[] = [];
      if (this._diagProvider) {
        try {
          const diag = this._diagProvider();
          if (diag) {
            if (diag.obdDeep) sections = obdDeepToSections(diag.obdDeep);
            extraEvidence = deriveDiagnosticEvidence({
              obdDeep: diag.obdDeep, sourceHealth: diag.sourceHealth,
              freezeFrame: diag.freezeFrame, memoryLimits: diag.memoryLimits,
            }, now);
          }
        } catch (e) {
          console.error('[AiCoreRuntime] tanı zenginleştirme hatası — izole, minimal bağlam', e);
        }
      }

      const ctx = assembleVehicleContext({ ...ctxInput, diagnosticSections: sections });
      const result = await this._orchestrator.run({ context: ctx, extraEvidence });
      if (this._disposed) return;                     // await sırasında dispose geldi → yayınlama
      this._lastResult = result;
      this._publishResult(result, ctx.fingerprintHash);
    } catch (e) {
      this._errorCount++;
      console.error('[AiCoreRuntime] çalışma hatası — izole, sistem etkilenmedi', e);
    }
  }

  private _safeOnline(): boolean {
    try { return this._online() === true; } catch { return false; }
  }

  /** AI Usta raporunu READ-ONLY, PII-güvenli küçük payload ile yayınlar. */
  private _publishResult(result: AiOrchestratorRunResult, fingerprintHash: string | null): void {
    const report = result.reports.find((r) => r.agentId === AI_MECHANIC_ID) ?? result.reports[0];
    if (!report) return;                              // ajan raporu yok → sessiz (uydurma yok)
    try {
      const published = this._bus.publish({
        name: AI_MECHANIC_REPORT_EVENT,
        domain: 'ai',
        retained: true,                               // son rapor geç-abonelere replayLast ile ulaşır
        vehicleFingerprintHash: fingerprintHash ?? undefined,
        payload: {                                    // yalnız sayısal/enum özet — sinyal değeri/PII YOK
          agentId: report.agentId,
          urgency: report.urgency,
          confidence: report.confidence,
          hasEvidence: report.hasEvidence,
          causeCount: report.possibleCauses.length,
          counterCount: report.counterEvidence.length,
          topCode: report.possibleCauses[0]?.code ?? null,
          generatedAt: report.generatedAt,
        },
      });
      if (published) this._publishedCount++;
    } catch (e) {
      console.error('[AiCoreRuntime] yayın hatası — izole', e);
    }
  }

  /** Son çalışmanın tam sonucu (read-only store). Yoksa null. */
  getLastResult(): AiOrchestratorRunResult | null {
    return this._lastResult;
  }

  getStatus(): AiCoreRuntimeStatus {
    return Object.freeze({
      started: this._started,
      disposed: this._disposed,
      subscriptions: this._subIds.length,
      runCount: this._runCount,
      publishedCount: this._publishedCount,
      errorCount: this._errorCount,
      pending: this._timer !== null,
      lastRunAt: this._lastRunAt > 0 ? this._lastRunAt : null,
    });
  }

  /** Abonelikleri ve timer'ı bırakır. İDEMPOTENT; terminal (yeniden start etmez). */
  dispose(): void {
    if (this._disposed) return;
    this._disposed = true;
    if (this._timer !== null) { try { this._clearTimeout(this._timer); } catch { /* yoksay */ } this._timer = null; }
    for (const id of this._subIds) { try { this._bus.unsubscribe(id); } catch { /* yoksay */ } }
    this._subIds.length = 0;
  }

  get isDisposed(): boolean {
    return this._disposed;
  }
}

export function createAiCoreRuntime(deps: AiCoreRuntimeDeps): AiCoreRuntime {
  return new AiCoreRuntime(deps);
}
