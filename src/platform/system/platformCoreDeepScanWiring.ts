/**
 * platformCoreDeepScanWiring — Deep Scan RUNTIME OWNERSHIP WIRING (W5-1)
 *                              + OFFLINE PASS TRIGGER (W5-3b).
 *
 * AMAÇ: Daha önce foundation olarak hazırlanmış Deep Scan singleton'larını (runtime /
 * persistence / ignition source) üretim yaşam döngüsüne bağlar ve bunları besleyen bir
 * `DeepScanOrchestrator` örneğini DI fabrikasıyla OLUŞTURUP SAHİPLENİR. Yalnız SAHİPLİK +
 * erişim + cleanup + bounded status. Aktif tarama zinciri yalnız KURULUR — ÇALIŞTIRILMAZ.
 *
 * W5-3b (offline trigger): `runOfflinePass()` İLK kez üretim wiring'ine bağlanır —
 * `triggerDeepScanOfflinePass()` tek deterministik giriş noktasıdır (hash/dedup guard,
 * single-flight). Runtime `idle → running → idle` döner (pass sonunda `runtime.reset()`
 * W5-3a garantisi).
 *
 * W5-3c-3 (change detection handler): offline `change_detection` fazı artık GERÇEK bir
 * handler'a bağlıdır → bu faz `skipped` DEĞİL, karar üretir (`no_baseline` /
 * `unchanged_offline` / `ecu_set_changed`). Handler YALNIZ PASİF OKUMA yapar (fingerprint
 * store + deep scan geçmişi): araca sorgu YOK · yazma YOK · Event Bus YOK. Diğer offline
 * fazlar (capability/fingerprint/knowledge/evidence/report) hâlâ handler'sız → `skipped`.
 * Aktif ECU/PID/DID/Firmware sorgusu YOK.
 *
 * NE YAPMAZ (bilinçli):
 *  - `start()`/`run()`/`runNextPhase()` ÇAĞIRMAZ → aktif tarama başlamaz (yalnız offline pass).
 *  - AKTİF faza handler BAĞLAMAZ — `OfflinePhaseHandlers` tip kilidi bunu DERLEME HATASI
 *    yapar. Aktif ECU/PID/DID sorgusu YOK · native/OBD/CAN'e DOKUNMAZ.
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
  type OfflinePassInput,
  type OfflinePassSummary,
  type OfflinePassBlockedReason,
} from '../deepScan';
import { createOfflineChangeDetectionHandler } from '../deepScan/offlineChangeDetectionHandler';

/**
 * Wiring'in SAHİPLENDİĞİ orchestrator — yalnız gereken salt-okunur yüzey (yapısal).
 *
 * ⚠️ Aktif tarama API'leri (`start`/`run`/`runNextPhase`) BİLİNÇLİ OLARAK YOK →
 * compile-time garanti: bu wiring hiçbir AKTİF tarama (araca sorgu) başlatamaz.
 * W5-3b'de yalnız `runOfflinePass` (araca sorgu GÖNDERMEYEN offline yüzey) + iptal
 * eklendi; trigger onu çağırır. Offline yüzey aktif tarama DEĞİLDİR.
 */
export interface OwnedOrchestrator {
  getSnapshot(): OrchestratorSnapshot;
  /** W5-3b: offline (non-active) pass yüzeyi — deterministik trigger tarafından çağrılır. */
  runOfflinePass(input?: OfflinePassInput): Promise<OfflinePassSummary>;
  /** Yürüyen offline pass'i iptal eder (fail-soft; pass yoksa no-op). */
  cancelOfflinePass(): void;
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

/* ══════════════════════════════════════════════════════════════════════════
 * W5-3b — OFFLINE PASS TRIGGER + BOUNDED DIAGNOSTICS
 *
 * `runOfflinePass()` İLK kez üretim wiring'ine bağlanır: tek deterministik giriş
 * noktası (`triggerDeepScanOfflinePass`) hash/dedup guard'ıyla pass'i EN FAZLA bir
 * kez başlatır. HANDLER YOK (W5-3c) → tüm fazlar `skipped` → GERÇEK İŞ YAPILMAZ →
 * üretim davranışı DEĞİŞMEZ. Aktif ECU/PID/DID/Firmware sorgusu YOK (offline yüzey).
 * ════════════════════════════════════════════════════════════════════════ */

/** Offline pass tetikleme sonucu (bounded — VIN/GPS/secret/ham CAN-OBD TAŞIMAZ). */
export type OfflinePassResult = 'ran' | 'blocked';

/** Bounded teşhis görünümü — offline pass tetikleme durumu. Ham telemetri TAŞIMAZ. */
export interface DeepScanOfflinePassStatus {
  /** Wiring aktif ve trigger çağrılabilir mi. */
  readonly present: boolean;
  /** En az bir kez tetiklenmeye çalışıldı mı. */
  readonly started: boolean;
  /** Şu an bir pass yürüyor mu (wiring bookkeeping). */
  readonly running: boolean;
  /** Orchestrator canlı + çağrılabilir mi (dispose edilmemiş). */
  readonly active: boolean;
  /** Son pass iptal edildi mi. */
  readonly cancelled: boolean;
  /** Kaç kez tetiklendi (dedup kanıtı — guard çalışıyorsa ≤1 kalır). */
  readonly triggerCount: number;
  /** Son pass başlangıç zamanı (monotonik değil; yalnız teşhis). */
  readonly lastRun: number | null;
  readonly lastDuration: number | null;
  readonly lastResult: OfflinePassResult | null;
  /** `blocked` ise sebep (offline pass yüzeyinden). */
  readonly lastReason: OfflinePassBlockedReason | null;
  /** Temizlenmiş hata kodu (yoksa null). Ham veri TAŞIMAZ. */
  readonly lastError: 'trigger_failed' | null;
  readonly phaseCount: number;
  readonly summaryAvailable: boolean;
}

/** Deterministik guard varsayılan anahtarı — boot'ta pass EN FAZLA bir kez tetiklenir. */
export const DEEP_SCAN_OFFLINE_TRIGGER_KEY = 'deepscan.offline.boot';

/** Wiring örneğine bağlı (restart'ta doğal sıfırlanan) mutable pass durumu. */
interface OfflinePassWiringState {
  triggeredKey: string | null;
  triggerCount: number;
  running: boolean;
  cancelled: boolean;
  lastRun: number | null;
  lastDuration: number | null;
  lastResult: OfflinePassResult | null;
  lastReason: OfflinePassBlockedReason | null;
  lastError: 'trigger_failed' | null;
  lastPhaseCount: number;
  lastSummaryAvailable: boolean;
}

function _freshOfflineState(): OfflinePassWiringState {
  return {
    triggeredKey: null,
    triggerCount: 0,
    running: false,
    cancelled: false,
    lastRun: null,
    lastDuration: null,
    lastResult: null,
    lastReason: null,
    lastError: null,
    lastPhaseCount: 0,
    lastSummaryAvailable: false,
  };
}

const IDLE_OFFLINE_STATUS: DeepScanOfflinePassStatus = Object.freeze({
  present: false,
  started: false,
  running: false,
  active: false,
  cancelled: false,
  triggerCount: 0,
  lastRun: null,
  lastDuration: null,
  lastResult: null,
  lastReason: null,
  lastError: null,
  phaseCount: 0,
  summaryAvailable: false,
});

const NOOP_CLEANUP: DeepScanWiringCleanup = () => { /* no-op */ };

interface ActiveWiring {
  readonly orchestrator: OwnedOrchestrator;
  readonly ignition: DeepScanIgnitionSource;
  readonly startedAt: number;
  readonly now: () => number;
  readonly offline: OfflinePassWiringState;
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

    active = { orchestrator, ignition, startedAt, now, offline: _freshOfflineState() };
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

/* ══════════════════════════════════════════════════════════════════════════
 * W5-3b — Offline pass trigger (tek deterministik giriş noktası) + teşhis
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * Deep Scan offline pass'i TEK giriş noktasından, deterministik dedup guard'ıyla
 * tetikler. Boot'ta yalnız uygun koşul (wiring aktif) varsa çağrılır ve aynı guard
 * anahtarı için EN FAZLA BİR KEZ çalışır (tekrar/duplicate YOK). Handler bağlanmadığı
 * için (W5-3c) pass GERÇEK İŞ YAPMAZ → üretim davranışı değişmez; runtime
 * `idle → running → idle` döner (pass sonunda `runtime.reset()` W5-3a garantisi).
 *
 * Fail-soft: wiring yoksa / zaten yürüyorsa / aynı guard tekrar gelirse → `null` (no-op).
 * Dışarı EXCEPTION KAÇIRMAZ. Boot'u BLOKLAMAZ (çağıran await etmeyebilir).
 *
 * @returns pass özeti; tetiklenmediyse (guard/no-op) `null`.
 */
export async function triggerDeepScanOfflinePass(
  opts: { readonly triggerKey?: string; readonly phaseTimeoutMs?: number } = {},
): Promise<OfflinePassSummary | null> {
  _pruneStale();
  const a = _active;
  if (!a) return null;                         // wiring yok → tetiklenemez
  const st = a.offline;
  if (st.running) return null;                 // SINGLE-FLIGHT: yürüyen pass varken tetiklenmez

  // DETERMİNİSTİK DEDUP GUARD: aynı anahtar ikinci kez pass BAŞLATMAZ.
  const key = typeof opts.triggerKey === 'string' && opts.triggerKey.length > 0
    ? opts.triggerKey
    : DEEP_SCAN_OFFLINE_TRIGGER_KEY;
  if (st.triggeredKey === key) return null;    // aynı guard → tekrar YOK

  st.triggeredKey = key;
  st.triggerCount += 1;
  st.running = true;
  st.cancelled = false;

  let startedAt = 0;
  try { const n = a.now(); startedAt = Number.isFinite(n) ? n : 0; } catch { startedAt = 0; }
  st.lastRun = startedAt;

  try {
    // W5-3c-3: YALNIZ `change_detection` handler'ı bağlıdır (offline faz — araca sorgu YOK,
    // yazma YOK, Event Bus YOK; pasif okuma: fingerprint store + deep scan geçmişi).
    // Diğer offline fazlar hâlâ handler'sız → `skipped`. AKTİF fazlara handler bağlamak
    // DERLEME HATASIDIR (`OfflinePhaseHandlers` tip kilidi).
    // Handler kurulumu LAZY'dir: baseline diski yalnız faza gelinince okunur.
    const summary = await a.orchestrator.runOfflinePass({
      phaseTimeoutMs: opts.phaseTimeoutMs,
      handlers: { change_detection: createOfflineChangeDetectionHandler() },
    });
    st.lastResult = summary.ran ? 'ran' : 'blocked';
    st.lastReason = summary.blockedReason;
    st.lastPhaseCount = summary.phaseCount;
    st.cancelled = summary.cancelled;
    st.lastSummaryAvailable = true;
    st.lastError = null;
    let doneAt = startedAt;
    try { const n = a.now(); doneAt = Number.isFinite(n) ? n : startedAt; } catch { doneAt = startedAt; }
    st.lastDuration = Math.max(0, doneAt - startedAt);
    return summary;
  } catch (e) {
    st.lastResult = 'blocked';
    st.lastError = 'trigger_failed';
    st.lastSummaryAvailable = false;
    logError('deepScanWiring:offlineTrigger', e);   // ham telemetri/VIN LOGLANMAZ
    return null;
  } finally {
    st.running = false;                        // ZERO-LEAK: her yolda bookkeeping temizlenir
  }
}

/** Yürüyen offline pass'i iptal eder (fail-soft; wiring/pass yoksa no-op). */
export function cancelDeepScanOfflinePass(): void {
  _pruneStale();
  const a = _active;
  if (!a) return;
  a.offline.cancelled = true;
  try { a.orchestrator.cancelOfflinePass(); } catch (e) { logError('deepScanWiring:offlineCancel', e); }
}

/** Bounded teşhis görünümü — offline pass tetikleme durumu. Throw ETMEZ; payload TAŞIMAZ. */
export function getDeepScanOfflinePassStatus(): DeepScanOfflinePassStatus {
  _pruneStale();
  const a = _active;
  if (!a) return IDLE_OFFLINE_STATUS;
  const st = a.offline;
  let active = false;
  try { active = !a.orchestrator.isDisposed; } catch { active = false; }
  return Object.freeze({
    present: true,
    started: st.triggerCount > 0,
    running: st.running,
    active,
    cancelled: st.cancelled,
    triggerCount: st.triggerCount,
    lastRun: st.lastRun,
    lastDuration: st.lastDuration,
    lastResult: st.lastResult,
    lastReason: st.lastReason,
    lastError: st.lastError,
    phaseCount: st.lastPhaseCount,
    summaryAvailable: st.lastSummaryAvailable,
  });
}
