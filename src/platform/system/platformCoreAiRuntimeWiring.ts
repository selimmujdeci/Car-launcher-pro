/**
 * platformCoreAiRuntimeWiring — AI Core RUNTIME WIRING (Faz-2, SystemBoot-uyumlu).
 *
 * AMAÇ: AI Core Faz-1 foundation'ını (Orchestrator · AI Usta · Vehicle Memory) gerçek
 * platform singleton'larına bağlar:
 *
 *   appEventBus (W3) ──edge olay──▶ AiCoreRuntime ──oku──▶ vehicleHal (snapshot/identity)
 *                                        │
 *                                        ▼ Orchestrator (read-only Safety Gate) → AI Usta
 *                                        ▼ ai.mechanic.report (READ-ONLY event) + result store
 *
 * ⚠️ KOD GERÇEĞİ: `getAppEventBus()` W3'ün TEK bus'ını verir (yoksa null → fail-soft no-op).
 * `vehicleHal` singleton yapısal olarak RuntimeHalLike'a uyar. AiCoreRuntime edge-tetikli +
 * BOUNDED'dır (poll YOK, her frame YOK). Faz-1 modülleri DEĞİŞTİRİLMEZ (yalnız kullanılır).
 *
 * NE YAPMAZ (bilinçli — Faz-2 yalnız WIRING'dir):
 *  - İkinci polling/veri/karar otoritesi KURMAZ · yeni sensör/PID/DID sorgusu AÇMAZ ·
 *    LLM/UI EKLEMEZ · ECU write/coding/actuator (Orchestrator read-only gate zorlar) ·
 *    Diagnostics/HAL/Bus foundation davranışını DEĞİŞTİRMEZ · yeni event catalog girdisi
 *    zorlamaz (ai.mechanic.report bus'ın açık-adlı yayınıdır).
 *
 * SAHİPLİK: runtime + orchestrator + memory bu modülündür → cleanup runtime'ı dispose eder;
 * `vehicleHal` ve `appEventBus` (başka sahipleri var) DISPOSE EDİLMEZ. TEK INSTANCE: aktif
 * runtime varken ikinci start no-op; bayat (disposed) kayıt serbest; cleanup yalnız KENDİ
 * kaydını siler → boot→shutdown→boot güvenli. FAIL-SOFT: public API dışarı exception KAÇIRMAZ;
 * hata bir kez logError; ham event/sinyal/VIN LOGLANMAZ. ZERO-LEAK: cleanup abonelik+timer bırakır.
 */

import { logError } from '../crashLogger';
import { getAppEventBus } from './platformCoreEventBusWiring';
import { vehicleHal } from '../vehicleHal';
import { AiOrchestrator } from '../aiCore/aiOrchestrator';
import { aiMechanic } from '../aiCore/agents/aiMechanic';
import { createVehicleMemoryStore, type VehicleMemoryStore } from '../aiCore/vehicleMemory';
import {
  AiCoreRuntime, type RuntimeBusLike, type RuntimeHalLike, type AiCoreRuntimeStatus,
} from '../aiCore/runtime/aiCoreRuntime';
import type { AiOrchestratorRunResult } from '../aiCore/aiOrchestrator';

/** Test için opsiyonel DI; üretimde `getAppEventBus()` + `vehicleHal` + varsayılan orchestrator. */
export interface AiRuntimeWiringDeps {
  readonly bus?: RuntimeBusLike;
  readonly hal?: RuntimeHalLike;
  readonly orchestrator?: AiOrchestrator;
  readonly memory?: VehicleMemoryStore;
}

export type AiRuntimeWiringCleanup = () => void;

export interface AiRuntimeWiringStatus {
  /** Runtime kurulu mu (false → "ölçülemiyor", 0 çalışmayla KARIŞTIRILMAZ). */
  readonly present: boolean;
  readonly started: boolean;
  readonly disposed: boolean;
  readonly subscriptions: number;
  readonly runCount: number;
  readonly publishedCount: number;
  readonly errorCount: number;
  readonly lastRunAt: number | null;
}

const NOOP_CLEANUP: AiRuntimeWiringCleanup = () => { /* no-op */ };

const ABSENT_STATUS: AiRuntimeWiringStatus = Object.freeze({
  present: false, started: false, disposed: false, subscriptions: 0,
  runCount: 0, publishedCount: 0, errorCount: 0, lastRunAt: null,
});

let _active: AiCoreRuntime | null = null;

/** Bayat kayıt (HMR/restart artığı: dispose edilmiş runtime) → serbest bırak. */
function _pruneStale(): void {
  if (_active && _active.isDisposed) _active = null;
}

/**
 * AI Core runtime'ı oluşturur, gerçek bus+HAL'e bağlar ve başlatır. YALNIZ cleanup thunk döner.
 * Dışarı exception KAÇIRMAZ. İDEMPOTENT (ikinci çağrı yeni abonelik AÇMAZ). Bus yoksa fail-soft
 * no-op (boot sürer).
 */
export function startPlatformCoreAiRuntimeWiring(deps: AiRuntimeWiringDeps = {}): AiRuntimeWiringCleanup {
  let runtime: AiCoreRuntime | null = null;
  try {
    _pruneStale();
    if (_active) return NOOP_CLEANUP;              // zaten aktif → ikinci runtime YOK

    const appBus = getAppEventBus();               // W3'ün TEK aktif bus'ı
    const bus: RuntimeBusLike | null = deps.bus ?? (appBus as RuntimeBusLike | null);
    if (!bus) return NOOP_CLEANUP;                 // bus yok → sessiz no-op (boot sürer)
    const hal: RuntimeHalLike = deps.hal ?? (vehicleHal as RuntimeHalLike);

    // Orchestrator: varsayılan read-only Safety Gate + araç hafızası + AI Usta.
    let orchestrator = deps.orchestrator;
    if (!orchestrator) {
      const memory = deps.memory ?? createVehicleMemoryStore();
      orchestrator = new AiOrchestrator({ memory });
      orchestrator.register(aiMechanic);
    }

    runtime = new AiCoreRuntime({
      bus, hal, orchestrator,
      online: () => (typeof navigator !== 'undefined' ? navigator.onLine !== false : true),
    });
    const own = runtime;
    _active = own;
    own.start();                                   // edge aboneliği (runtime içi fail-soft)

    let disposed = false;
    return () => {
      if (disposed) return;                        // İDEMPOTENT
      disposed = true;
      try {
        own.dispose();                             // YALNIZ runtime — HAL/Bus DISPOSE EDİLMEZ
      } catch (e) {
        logError('aiRuntimeWiring:cleanup', e);    // cleanup hatası shutdown'ı engellemez
      }
      if (_active === own) _active = null;         // yalnız KENDİ kaydını siler
    };
  } catch (e) {
    if (runtime && _active === runtime) _active = null;   // yarım kayıt bırakma
    logError('aiRuntimeWiring:init', e);                  // ham event/sinyal/VIN LOGLANMAZ
    return NOOP_CLEANUP;                                  // boot devam eder (fail-soft)
  }
}

/** Bounded teşhis görünümü. Runtime yoksa present:false + sıfır sayaçlar. Throw ETMEZ. */
export function getAiRuntimeStatus(): AiRuntimeWiringStatus {
  _pruneStale();
  const rt = _active;
  if (!rt) return ABSENT_STATUS;
  try {
    const s: AiCoreRuntimeStatus = rt.getStatus();
    return Object.freeze({
      present: true,
      started: s.started,
      disposed: s.disposed,
      subscriptions: s.subscriptions,
      runCount: s.runCount,
      publishedCount: s.publishedCount,
      errorCount: s.errorCount,
      lastRunAt: s.lastRunAt,
    });
  } catch {
    return ABSENT_STATUS;   // teşhis yolu asla çökmez
  }
}

/** Son AI Usta çalışmasının tam sonucu (READ-ONLY store). Runtime yoksa/çalışmadıysa null. */
export function getLastAiMechanicResult(): AiOrchestratorRunResult | null {
  _pruneStale();
  try { return _active ? _active.getLastResult() : null; } catch { return null; }
}
