/**
 * platformCoreDeepScanWiring — Deep Scan RUNTIME OWNERSHIP WIRING (W5-1).
 *
 * AMAÇ: Daha önce foundation olarak hazırlanmış Deep Scan singleton'larını (runtime /
 * persistence / ignition source) üretim yaşam döngüsüne bağlar ve bunları besleyen bir
 * `DeepScanOrchestrator` örneğini DI fabrikasıyla OLUŞTURUP SAHİPLENİR. Yalnız SAHİPLİK +
 * erişim + cleanup + bounded status. Zincir yalnız KURULUR — ÇALIŞTIRILMAZ.
 *
 * NE YAPMAZ (bilinçli — W5-1 yalnız ownership'tir):
 *  - `start()`/`run()`/`runNextPhase()` ÇAĞIRMAZ → hiçbir tarama başlamaz, hiçbir faz yürümez.
 *  - `handlers` BAĞLAMAZ (orchestrator boş handler ile kurulur → tüm fazlar `skipped` kalırdı,
 *    ama zaten çalıştırılmaz). Aktif ECU/PID/DID sorgusu YOK · native/OBD/CAN'e DOKUNMAZ.
 *  - Event Bus'a PUBLISH ETMEZ · Capability Registry'yi GÜNCELLEMEZ · Assistant Context/Deep Scan
 *    Event Bridge/offline-run/capability-evidence — HİÇBİRİ (ayrı W5-2..W5-5 PR'ları). UI/SQL YOK.
 *  - Ignition'ı BYPASS ETMEZ · manual scan AÇMAZ · RPM/voltaj/OBD'den kontak ÇIKARSAMAZ.
 *  - Import edilmesi YAN ETKİSİZDİR (yapıcı timer/abonelik/native çağrı/tarama açmaz);
 *    runtime/persistence/ignition yalnız `start...()` çağrılınca REFERANS alınır.
 *
 * FAIL-CLOSED: ignition source'ta gerçek authoritative kanıt YOK → `ignitionConfirmed` DAİMA
 * `null`. Aktif fazlar (ileride bir tarama başlatılırsa) `waiting_for_ignition`'da bloke kalır.
 * Bu PR hiçbir aktif sorgu üretmez.
 *
 * SAHİPLİK:
 *  - Runtime / Persistence / Ignition → PAYLAŞILAN app singleton'ları (foundation). Wiring bunları
 *    yalnız REFERANS alır, DISPOSE ETMEZ (başka tüketiciler de kullanabilir).
 *  - Orchestrator → bu wiring FABRİKA ile OLUŞTURUR (createDeepScanOrchestrator) → SAHİBİDİR →
 *    `cleanup()` YALNIZ orchestrator'ı dispose eder.
 * TEK INSTANCE: aktif wiring varken ikinci `start...()` YENİ orchestrator OLUŞTURMAZ (no-op
 * cleanup). Bayat (disposed) kayıt otomatik serbest bırakılır; cleanup yalnız KENDİ kaydını siler
 * → boot→shutdown→boot güvenli, HMR/restart artığı kalmaz.
 *
 * FAIL-SOFT: başlatma dışarı EXCEPTION KAÇIRMAZ — init hatası bir kez `logError` + no-op cleanup
 * (boot devam eder; ham telemetri/VIN LOGLANMAZ). ZERO-LEAK: timer/abonelik açılmaz; cleanup İDEMPOTENT.
 */

import { logError } from '../crashLogger';
import {
  createDeepScanOrchestrator,
  deepScanRuntimeService,
  deepScanPersistenceStore,
  deepScanIgnitionSource,
  type DeepScanRuntimeService,
  type DeepScanPersistenceStore,
  type DeepScanIgnitionSource,
  type DeepScanOrchestratorDeps,
  type OrchestratorStatus,
  type OrchestratorSnapshot,
  type DeepScanStatus,
  type DeepScanMode,
  type DeepScanPhase,
} from '../deepScan';

/** Wiring'in SAHİPLENDİĞİ orchestrator — yalnız gereken salt-okunur yüzey (yapısal). */
export interface OwnedOrchestrator {
  getSnapshot(): OrchestratorSnapshot;
  dispose(): void;
  readonly isDisposed: boolean;
}

/** Bağımlılıklar — hepsi opsiyonel (test enjeksiyonu); üretimde paylaşılan singleton'lar + gerçek fabrika. */
export interface DeepScanWiringDeps {
  readonly runtime?: DeepScanRuntimeService;
  readonly persistence?: DeepScanPersistenceStore;
  readonly ignitionSource?: DeepScanIgnitionSource;
  /** Test için orchestrator fabrikası; verilmezse üretim `createDeepScanOrchestrator`. */
  readonly createOrchestrator?: (deps: DeepScanOrchestratorDeps) => OwnedOrchestrator;
  readonly now?: () => number;
}

/** Tek cleanup thunk — İDEMPOTENT + fail-soft. YALNIZ owned orchestrator'ı dispose eder. */
export type DeepScanWiringCleanup = () => void;

/** Bounded teşhis görünümü — full snapshot / ham telemetri / VIN / koordinat TAŞIMAZ. */
export interface DeepScanWiringStatus {
  /** Orchestrator kuruldu ve wiring aktif mi. */
  readonly present: boolean;
  readonly started: boolean;
  /** Deep Scan runtime state machine durumu (tarama yürümediği için `idle`). */
  readonly runtimeState: DeepScanStatus;
  /** Orchestrator durumu (idle/running/waiting_for_ignition/...). */
  readonly scanState: OrchestratorStatus;
  /** Kontak: gerçek authoritative kaynak yok → `null` (fail-closed). */
  readonly ignitionConfirmed: boolean | null;
  readonly mode: DeepScanMode | null;
  readonly currentPhase: DeepScanPhase | null;
  readonly progressPercent: number;
  readonly warningCount: number;
  /** W5-1 handler bağlamaz → daima false. */
  readonly hasHandlers: boolean;
  /** W5-1 → daima 0. */
  readonly activeHandlerCount: number;
  readonly lastErrorCode: 'init_failed' | 'cleanup_failed' | null;
  readonly lastTransitionAt: number | null;
}

const NOOP_CLEANUP: DeepScanWiringCleanup = () => { /* no-op */ };

interface ActiveWiring {
  readonly orchestrator: OwnedOrchestrator;
  readonly ignition: DeepScanIgnitionSource;
  readonly startedAt: number;
}

let _active: ActiveWiring | null = null;
let _lastErrorCode: DeepScanWiringStatus['lastErrorCode'] = null;

const IDLE_STATUS: DeepScanWiringStatus = Object.freeze({
  present: false,
  started: false,
  runtimeState: 'idle',
  scanState: 'idle',
  ignitionConfirmed: null,
  mode: null,
  currentPhase: null,
  progressPercent: 0,
  warningCount: 0,
  hasHandlers: false,
  activeHandlerCount: 0,
  lastErrorCode: null,
  lastTransitionAt: null,
});

/** Bayat kayıt (HMR/restart artığı: dispose edilmiş orchestrator) → serbest bırak. */
function _pruneStale(): void {
  if (_active && _active.orchestrator.isDisposed) _active = null;
}

/**
 * Deep Scan singleton'larını bağlar ve orchestrator'ı OLUŞTURUR (ÇALIŞTIRMAZ). YALNIZ cleanup
 * thunk döner. Dışarı exception KAÇIRMAZ. İDEMPOTENT: aktif wiring varken ikinci çağrı YENİ
 * orchestrator açmaz. Hiçbir tarama başlatılmaz.
 */
export function startPlatformCoreDeepScanWiring(deps: DeepScanWiringDeps = {}): DeepScanWiringCleanup {
  let active: ActiveWiring | null = null;
  try {
    _pruneStale();
    if (_active) return NOOP_CLEANUP;      // zaten aktif → ikinci orchestrator YOK

    const runtime = deps.runtime ?? deepScanRuntimeService;
    const persistence = deps.persistence ?? deepScanPersistenceStore;
    const ignition = deps.ignitionSource ?? deepScanIgnitionSource;
    const factory = deps.createOrchestrator ?? createDeepScanOrchestrator;
    const now = typeof deps.now === 'function' ? deps.now : () => Date.now();

    // Orchestrator'ı paylaşılan singleton'larla KUR — handler YOK → hiçbir faz gerçek iş yapmaz.
    // start()/run() ÇAĞRILMAZ → tarama başlamaz, aktif sorgu üretilmez.
    const orchestrator = factory({ runtime, persistence, ignitionSource: ignition });

    let startedAt = 0;
    try { const n = now(); startedAt = Number.isFinite(n) ? n : 0; } catch { startedAt = 0; }

    active = { orchestrator, ignition, startedAt };
    _active = active;
    _lastErrorCode = null;

    let disposed = false;
    return () => {
      if (disposed) return;                // İDEMPOTENT
      disposed = true;
      try {
        orchestrator.dispose();            // YALNIZ owned orchestrator — paylaşılan deps DISPOSE EDİLMEZ
      } catch (e) {
        _lastErrorCode = 'cleanup_failed';  // cleanup hatası shutdown'ı engellemez
        logError('deepScanWiring:cleanup', e);
      }
      if (active && _active === active) _active = null;   // yalnız KENDİ kaydını siler
    };
  } catch (e) {
    if (active && _active === active) _active = null;      // yarım kayıt bırakma
    _lastErrorCode = 'init_failed';
    logError('deepScanWiring:init', e);                    // ham telemetri/VIN LOGLANMAZ
    return NOOP_CLEANUP;                                   // boot devam eder (fail-soft)
  }
}

/** Bounded teşhis görünümü (payload/telemetri YOK). Throw ETMEZ. */
export function getDeepScanWiringStatus(): DeepScanWiringStatus {
  _pruneStale();
  const a = _active;
  if (!a) {
    return _lastErrorCode ? Object.freeze({ ...IDLE_STATUS, lastErrorCode: _lastErrorCode }) : IDLE_STATUS;
  }
  try {
    const snap = a.orchestrator.getSnapshot();
    // Kontak: gerçek authoritative kaynak yok → null (pür getter; provider ÇAĞRILMAZ, tarama yok).
    let ignitionConfirmed: boolean | null = null;
    try { ignitionConfirmed = a.ignition.getConfirmedValue(); } catch { ignitionConfirmed = null; }
    return Object.freeze({
      present: true,
      started: true,
      runtimeState: snap.runtimeStatus,
      scanState: snap.status,
      ignitionConfirmed,
      mode: snap.mode,
      currentPhase: snap.currentPhase,
      progressPercent: typeof snap.progressPercent === 'number' ? snap.progressPercent : 0,
      warningCount: Array.isArray(snap.warnings) ? snap.warnings.length : 0,
      hasHandlers: false,           // W5-1 handler bağlamaz
      activeHandlerCount: 0,
      lastErrorCode: _lastErrorCode,
      lastTransitionAt: a.startedAt,
    });
  } catch {
    return IDLE_STATUS;   // teşhis yolu asla çökmez
  }
}
