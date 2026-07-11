/**
 * deepScanOrchestrator — Deep Scan'in TÜM katmanlarını yöneten tek koordinatör
 * (FOUNDATION).
 *
 * NE YAPAR: Deep Scan sürecini deterministik faz sırasıyla yürütür — Ignition doğrula
 * → Mode seç (full_scan/change_check) → Identity → Protocol → ECU/PID/DID/Firmware
 * keşif → Fingerprint/Knowledge/Evidence/Pattern projeksiyonu → Change detection →
 * Persistence güncelle → Report → Completed. Runtime state machine'i sürer, Ignition
 * Source'tan kontağı besler, Persistence'tan mod kararını okur, sonuçları Persistence'a
 * yazar. Olay yayınlar, gerçek fazlara göre ilerleme üretir.
 *
 * NE YAPMAZ (bilinçli — bu PR yalnız ORCHESTRATION'dır):
 *  - Gerçek OBD komutu GÖNDERMEZ · yeni PID/DID/Discovery algoritması EKLEMEZ ·
 *    native koda DOKUNMAZ · SystemBoot/Assistant/Dashboard WIRING YAPMAZ · SQL YOK.
 *  - Fazların GERÇEK işi enjekte edilen `handlers` ile yapılır (foundation'da yok →
 *    hepsi `skipped`); ileride orchestration'a gerçek discovery servisleri BAĞLANIR.
 *  - Timer AÇMAZ · yeni thread AÇMAZ · sürekli döngü KURMAZ · hot-path'e GİRMEZ ·
 *    OBD polling'e dokunmaz. Fazlar ÇAĞRILABİLİR API'dir (`runNextPhase()` / `run()`).
 *  - Import edilmesi YAN ETKİSİZDİR (yapıcı timer/abonelik/native çağrı açmaz).
 *
 * FAIL-SOFT (zincir): Firmware düşse Knowledge yine çalışır · Fingerprint düşse
 * Knowledge yine · Knowledge düşse Persistence yine yazılır · Persistence düşse Report
 * yine üretilir. Tek modül tüm Deep Scan'i ÇÖKERTMEZ. Yalnız KRİTİK aktif fazlar
 * (identity/protocol) başarısızlığı taramayı `failed` yapar (runtime CRITICAL_PHASES).
 *
 * PROGRESS: gerçek faz tamamlanmasına göre artar (runtime PHASE_PROGRESS_FLOOR +
 * ölçülmüş `updateProgress`). Sahte yüzde ÜRETİLMEZ.
 *
 * ZERO-LEAK: `dispose()` yalnız kendi dinleyicilerini bırakır (enjekte edilen runtime/
 * persistence/ignition çağıranındır). Timer/abonelik açılmadığı için başka kaynak yok.
 */

import {
  isActivePhase,
  sanitizeText,
  type DeepScanMode,
  type DeepScanPhase,
  type DeepScanReportSummary,
  type DeepScanSnapshot,
  type DeepScanStatus,
} from './deepScanModel';
import { DeepScanRuntimeService, deepScanRuntimeService } from './deepScanRuntimeService';
import { DeepScanPersistenceStore, deepScanPersistenceStore } from './deepScanPersistence';
import { DeepScanIgnitionSource, deepScanIgnitionSource } from './deepScanIgnitionSource';

/* ══════════════════════════════════════════════════════════════════════════
 * Faz sırası (deterministik) — runtime'ın 12 fazı, vizyon akışıyla hizalı
 * ════════════════════════════════════════════════════════════════════════ */

export const DEEP_SCAN_PHASE_SEQUENCE: readonly DeepScanPhase[] = [
  'vehicle_identity',
  'protocol_detection',
  'ecu_discovery',
  'standard_pid_discovery',
  'manufacturer_did_discovery',
  'firmware_inventory',
  'capability_analysis',
  'fingerprint_update',
  'knowledge_update',
  'evidence_update',       // Evidence + Pattern projeksiyonu + Persistence checkpoint
  'change_detection',
  'report_generation',
];

/* ── Bounded keşif birikim tavanları (persistence ile hizalı) ─────────────── */
const MAX_ACC_ECUS = 128;
const MAX_ACC_PIDS = 512;
const MAX_ACC_DIDS = 512;
const MAX_ACC_FIRMWARE = 128;
const MAX_ORCH_LISTENERS = 32;
const MAX_ORCH_WARNINGS = 16;

/* ══════════════════════════════════════════════════════════════════════════
 * Tipler
 * ════════════════════════════════════════════════════════════════════════ */

export type OrchestratorStatus =
  | 'idle' | 'running' | 'waiting_for_ignition' | 'completed' | 'failed' | 'cancelled';

export type PhaseOutcomeStatus = 'success' | 'skipped' | 'error' | 'timeout' | 'cancelled';

/** Bir keşif sinyali (PID/DID) sonucu. */
export interface DiscoverySignalResult {
  readonly pidOrDid: string;
  readonly ecuAddress?: string;
  readonly isNew?: boolean;
}

/** Firmware sonucu (ham response DEĞİL — ECU + normalize sürüm kimliği). */
export interface FirmwareResultEntry {
  readonly ecu?: string;
  readonly version?: string;
  readonly changed?: boolean;
}

/** Bir fazın sonucu (enjekte edilen handler döndürür). Girdi immutable. */
export interface PhaseResult {
  readonly status: PhaseOutcomeStatus;
  /** Ölçülmüş ilerleme (0–100, opsiyonel). */
  readonly progress?: number;
  readonly errorCode?: string;
  readonly reason?: string;
  readonly ecus?: readonly string[];
  readonly pids?: readonly DiscoverySignalResult[];
  readonly dids?: readonly DiscoverySignalResult[];
  readonly firmware?: readonly FirmwareResultEntry[];
  readonly changedFirmware?: boolean;
  readonly changedEcu?: boolean;
}

/** Handler bağlamı — salt-okunur. */
export interface PhaseContext {
  readonly phase: DeepScanPhase;
  readonly mode: DeepScanMode;
  readonly snapshot: DeepScanSnapshot;
  readonly isCancelled: () => boolean;
}

export type PhaseHandler = (ctx: PhaseContext) => PhaseResult | Promise<PhaseResult>;

export type OrchestratorEventType =
  | 'scan_started' | 'phase_started' | 'phase_completed' | 'phase_failed'
  | 'progress_changed' | 'report_ready' | 'scan_completed' | 'scan_cancelled' | 'scan_failed';

export interface OrchestratorEvent {
  readonly type: OrchestratorEventType;
  readonly at: number;
  readonly phase: DeepScanPhase | null;
  readonly progressPercent: number;
  readonly status: OrchestratorStatus;
  readonly reason: string | null;
  readonly reportSummary: DeepScanReportSummary | null;
}

export type OrchestratorListener = (event: OrchestratorEvent) => void;

export interface OrchestratorSnapshot {
  readonly status: OrchestratorStatus;
  readonly mode: DeepScanMode | null;
  readonly currentPhase: DeepScanPhase | null;
  readonly currentPhaseIndex: number;
  readonly totalPhases: number;
  readonly progressPercent: number;
  readonly runtimeStatus: DeepScanStatus;
  readonly reportSummary: DeepScanReportSummary | null;
  readonly warnings: readonly string[];
}

export interface StartOrchestrationInput {
  readonly vehicleFingerprintHash?: string;
  /** Kontak durumu dışarıdan verilmezse Ignition Source'tan okunur. */
  readonly ignitionConfirmed?: boolean | null;
}

export interface DeepScanOrchestratorDeps {
  readonly runtime?: DeepScanRuntimeService;
  readonly persistence?: DeepScanPersistenceStore;
  readonly ignitionSource?: DeepScanIgnitionSource;
  readonly handlers?: Partial<Record<DeepScanPhase, PhaseHandler>>;
  readonly now?: () => number;
}

/* ══════════════════════════════════════════════════════════════════════════
 * Saf yardımcılar
 * ════════════════════════════════════════════════════════════════════════ */

function _normId(v: unknown): string {
  if (typeof v !== 'string') return '';
  return v.trim().toUpperCase().replace(/\s+/g, '').replace(/^0X/, '');
}

function _addBounded(set: Set<string>, key: string, max: number): void {
  if (key && !set.has(key) && set.size < max) set.add(key);
}

/* ══════════════════════════════════════════════════════════════════════════
 * Orchestrator
 * ════════════════════════════════════════════════════════════════════════ */

export class DeepScanOrchestrator {
  private readonly _runtime: DeepScanRuntimeService;
  private readonly _persistence: DeepScanPersistenceStore;
  private readonly _ignition: DeepScanIgnitionSource;
  private readonly _handlers: Partial<Record<DeepScanPhase, PhaseHandler>>;
  private readonly _now: () => number;

  private readonly _listeners = new Set<OrchestratorListener>();

  private _started = false;
  private _cancelled = false;
  private _finalized = false;
  private _index = 0;
  private _mode: DeepScanMode | null = null;
  private _lastProgress = 0;
  private _disposed = false;
  private _warnings: string[] = [];

  /* Persistence'a yansıtılacak keşif kimlik birikimi (bounded). */
  private _ecus = new Set<string>();
  private _pids = new Set<string>();
  private _dids = new Set<string>();
  private _firmware: FirmwareResultEntry[] = [];

  constructor(deps: DeepScanOrchestratorDeps = {}) {
    this._runtime = deps.runtime ?? deepScanRuntimeService;
    this._persistence = deps.persistence ?? deepScanPersistenceStore;
    this._ignition = deps.ignitionSource ?? deepScanIgnitionSource;
    this._handlers = deps.handlers ?? {};
    this._now = typeof deps.now === 'function' ? deps.now : () => Date.now();
  }

  /* ── Dahili ──────────────────────────────────────────────────────────── */

  private _nowSafe(): number {
    try { const n = this._now(); return Number.isFinite(n) ? n : 0; } catch { return 0; }
  }

  private _warn(msg: string): void {
    const clean = sanitizeText(msg);
    if (!clean) return;
    this._warnings.push(clean);
    if (this._warnings.length > MAX_ORCH_WARNINGS) {
      this._warnings.splice(0, this._warnings.length - MAX_ORCH_WARNINGS);
    }
  }

  private _deriveStatus(): OrchestratorStatus {
    if (!this._started) return 'idle';
    let rs: DeepScanStatus = 'idle';
    try { rs = this._runtime.getSnapshot().status; } catch { /* fail-soft */ }
    if (rs === 'completed') return 'completed';
    if (rs === 'failed') return 'failed';
    if (rs === 'cancelled') return 'cancelled';
    if (rs === 'waiting_for_ignition') return 'waiting_for_ignition';
    return 'running';
  }

  private _runtimeSnapshot(): DeepScanSnapshot {
    return this._runtime.getSnapshot();
  }

  private _emit(type: OrchestratorEventType, phase: DeepScanPhase | null, reason?: string): void {
    if (this._disposed || this._listeners.size === 0) return;
    let snap: DeepScanSnapshot | null = null;
    try { snap = this._runtimeSnapshot(); } catch { /* fail-soft */ }
    const event: OrchestratorEvent = Object.freeze({
      type,
      at: this._nowSafe(),
      phase,
      progressPercent: snap ? snap.progressPercent : this._lastProgress,
      status: this._deriveStatus(),
      reason: reason ? sanitizeText(reason) : null,
      reportSummary: snap ? snap.reportSummary : null,
    });
    for (const listener of [...this._listeners]) {
      try { listener(event); }
      catch (err) { console.error(`[DeepScanOrchestrator] dinleyici hatası (${type}) — servis etkilenmedi`, err); }
    }
  }

  /** Kontağı Ignition Source'tan (varsa dışarıdan) çekip runtime'a besler. */
  private _syncIgnition(explicit?: boolean | null): void {
    let value: boolean | null = explicit ?? null;
    if (explicit === undefined) {
      try { value = this._ignition.getConfirmedValue(); } catch { value = null; }
    }
    try { this._runtime.setIgnitionConfirmed(value); } catch { /* fail-soft */ }
  }

  private _maybeEmitProgress(phase: DeepScanPhase | null): void {
    let p = this._lastProgress;
    try { p = this._runtimeSnapshot().progressPercent; } catch { /* */ }
    if (p > this._lastProgress) {
      this._lastProgress = p;
      this._emit('progress_changed', phase);
    }
  }

  /* ── Keşif sonucunu runtime'a + persistence birikimine yaz ─────────────── */

  private _applyResult(result: PhaseResult): void {
    // ECU
    if (Array.isArray(result.ecus)) {
      for (const raw of result.ecus) {
        const ecu = _normId(raw);
        if (!ecu) continue;
        try { this._runtime.recordEcuDiscovery({ ecuAddress: ecu, isNew: false }); } catch { /* */ }
        _addBounded(this._ecus, ecu, MAX_ACC_ECUS);
      }
    }
    // PID
    if (Array.isArray(result.pids)) {
      for (const p of result.pids) {
        const pid = _normId(p?.pidOrDid);
        if (!pid) continue;
        try { this._runtime.recordPidDiscovery({ pidOrDid: pid, ecuAddress: p?.ecuAddress, isNew: p?.isNew }); } catch { /* */ }
        _addBounded(this._pids, pid, MAX_ACC_PIDS);
      }
    }
    // DID
    if (Array.isArray(result.dids)) {
      for (const d of result.dids) {
        const did = _normId(d?.pidOrDid);
        if (!did) continue;
        try { this._runtime.recordDidDiscovery({ pidOrDid: did, ecuAddress: d?.ecuAddress, isNew: d?.isNew }); } catch { /* */ }
        _addBounded(this._dids, did, MAX_ACC_DIDS);
      }
    }
    // Firmware
    if (Array.isArray(result.firmware)) {
      for (const f of result.firmware) {
        try { this._runtime.recordFirmwareResult({ ecuAddress: f?.ecu, changed: f?.changed }); } catch { /* */ }
        if (this._firmware.length < MAX_ACC_FIRMWARE) this._firmware.push({ ecu: f?.ecu, version: f?.version, changed: f?.changed });
      }
    }
    // Change detection
    if (result.changedFirmware === true || result.changedEcu === true) {
      try { this._runtime.recordChangeDetection({ changedFirmware: result.changedFirmware, changedEcu: result.changedEcu, reason: result.reason }); } catch { /* */ }
    }
    // Ölçülmüş ilerleme
    if (typeof result.progress === 'number') {
      try { this._runtime.updateProgress(result.progress); } catch { /* */ }
    }
  }

  /** Persistence'a fail-soft checkpoint (bir modül düşse diğerleri yine yazsın). */
  private _checkpointPersistence(): void {
    try {
      this._persistence.saveSnapshot({
        snapshot: this._runtimeSnapshot(),
        ecuAddresses: [...this._ecus],
        pidIds: [...this._pids],
        didIds: [...this._dids],
        firmware: this._firmware,
      });
    } catch (err) {
      this._warn('persistence_checkpoint_failed');
      console.error('[DeepScanOrchestrator] persistence checkpoint fail-soft', err);
    }
  }

  /* ── Public API ──────────────────────────────────────────────────────── */

  /**
   * Taramayı başlatır. İDEMPOTENT — zaten başlamışsa no-op. Mod: Persistence'tan
   * `resolveMode(hash)` (tam tarama tamamlanmışsa `change_check`). Kontak Ignition
   * Source'tan (veya dışarıdan) beslenir → doğrulanmazsa `waiting_for_ignition`.
   */
  start(input: StartOrchestrationInput = {}): OrchestratorSnapshot {
    if (this._disposed || this._started) return this.getSnapshot();
    this._started = true;
    this._cancelled = false;
    this._finalized = false;
    this._index = 0;
    this._lastProgress = 0;

    const hash = input.vehicleFingerprintHash;
    let hasCompleted = false;
    try { hasCompleted = this._persistence.hasCompletedFullScan(hash); } catch { hasCompleted = false; }
    this._mode = hasCompleted ? 'CHANGE_CHECK' : 'FULL_SCAN';

    // Kontağı önce besle → startScan doğru başlangıç durumunu seçsin.
    let ignition: boolean | null = input.ignitionConfirmed ?? null;
    if (input.ignitionConfirmed === undefined) {
      try { ignition = this._ignition.getConfirmedValue(); } catch { ignition = null; }
    }

    try {
      this._runtime.startScan({
        vehicleFingerprintHash: hash,
        hasCompletedScanBefore: hasCompleted,
        ignitionConfirmed: ignition,
      });
    } catch (err) {
      this._warn('runtime_start_failed');
      console.error('[DeepScanOrchestrator] runtime.startScan fail-soft', err);
    }

    this._emit('scan_started', null);
    this._maybeEmitProgress(null);
    return this.getSnapshot();
  }

  /**
   * Sıradaki fazı yürütür (ÇAĞRILABİLİR primitif — otonom döngü YOK). Aktif faz
   * kontak doğrulanmadan çalışmaz → `waiting_for_ignition`'da durur (index İLERLEMEZ).
   * @returns güncel snapshot
   */
  async runNextPhase(): Promise<OrchestratorSnapshot> {
    if (this._disposed || !this._started) return this.getSnapshot();

    // Terminal veya iptal → dur.
    const status = this._deriveStatus();
    if (status === 'completed' || status === 'failed' || status === 'cancelled') return this.getSnapshot();
    if (this._cancelled) { this._doCancel('cancelled'); return this.getSnapshot(); }
    if (this._index >= DEEP_SCAN_PHASE_SEQUENCE.length) { this._finalize(); return this.getSnapshot(); }

    const phase = DEEP_SCAN_PHASE_SEQUENCE[this._index];
    const active = isActivePhase(phase);

    // Aktif faz: kontağı yeniden senkronla; doğrulanmamışsa DURDUR (index ilerlemez).
    if (active) {
      this._syncIgnition();
      if (this._runtimeSnapshot().ignitionConfirmed !== true) {
        try { this._runtime.updatePhase(phase); } catch { /* runtime waiting_for_ignition yapar */ }
        this._emit('phase_failed', phase, 'waiting_for_ignition');
        return this.getSnapshot(); // aynı faza sonra tekrar denenebilir
      }
    }

    // Fazı runtime'a bildir (aktif→scanning, offline→analyzing; progress floor).
    try { this._runtime.updatePhase(phase); } catch { /* fail-soft */ }
    this._emit('phase_started', phase);
    this._maybeEmitProgress(phase);

    // Handler'ı çalıştır (foundation'da yok → skipped). Hata izole.
    const handler = this._handlers[phase];
    let result: PhaseResult;
    if (typeof handler === 'function') {
      try {
        const ctx: PhaseContext = Object.freeze({
          phase, mode: this._mode ?? 'FULL_SCAN',
          snapshot: this._runtimeSnapshot(),
          isCancelled: () => this._cancelled,
        });
        result = await Promise.resolve(handler(ctx));
        if (!result || typeof result !== 'object') result = { status: 'error', errorCode: 'invalid_result' };
      } catch (err) {
        console.error(`[DeepScanOrchestrator] handler hatası (${phase}) fail-soft`, err);
        result = { status: 'error', errorCode: 'handler_exception' };
      }
    } else {
      result = { status: 'skipped' };
    }

    this._mapOutcome(phase, result);
    this._checkpointPersistence();
    this._maybeEmitProgress(phase);

    // Faz ilerlet (cancel/fail durumunda _mapOutcome zaten terminal yaptı).
    const after = this._deriveStatus();
    if (after === 'failed' || after === 'cancelled') return this.getSnapshot();

    this._index++;
    if (this._index >= DEEP_SCAN_PHASE_SEQUENCE.length) this._finalize();
    return this.getSnapshot();
  }

  /**
   * Tüm fazları SIRAYLA yürütür (SONLU sıra — otonom/sürekli döngü değil; en fazla
   * faz sayısı kadar iterasyon). Terminal veya `waiting_for_ignition`'da durur.
   */
  async run(input?: StartOrchestrationInput): Promise<OrchestratorSnapshot> {
    if (input !== undefined && !this._started) this.start(input);
    else if (!this._started) this.start();

    // SONLU guard: her faz için en çok bir kez. Terminal'de dur; `waiting_for_ignition`'da
    // bir kez DENE (kontak sonradan gelmiş olabilir) → ilerleme olmazsa kır (no-progress).
    for (let i = 0; i <= DEEP_SCAN_PHASE_SEQUENCE.length; i++) {
      const status = this._deriveStatus();
      if (status === 'completed' || status === 'failed' || status === 'cancelled') break;
      const beforeIndex = this._index;
      await this.runNextPhase();
      // İlerleme olmadıysa (ör. hâlâ waiting_for_ignition) → sonsuz döngü önle.
      if (this._index === beforeIndex && this._deriveStatus() !== 'completed') break;
    }
    return this.getSnapshot();
  }

  private _mapOutcome(phase: DeepScanPhase, result: PhaseResult): void {
    switch (result.status) {
      case 'success':
      case 'skipped':
        this._applyResult(result);
        this._emit('phase_completed', phase, result.reason);
        break;
      case 'cancelled':
        this._cancelled = true;
        this._doCancel(result.reason ?? 'phase_cancelled');
        break;
      case 'error':
      case 'timeout': {
        const code = sanitizeText(result.errorCode ?? result.status, 64) || result.status;
        // KRİTİK faz → runtime failed; kritik olmayan → skip + warn (FAIL-SOFT devam).
        try { this._runtime.reportPhaseFailure(phase, code); } catch { /* */ }
        this._warn(`phase_${result.status}:${phase}`);
        this._emit('phase_failed', phase, code);
        if (this._deriveStatus() === 'failed') {
          this._checkpointPersistence(); // failed öncesi son durum yazılabilsin (fail-soft)
          this._emit('scan_failed', phase, code);
        }
        break;
      }
    }
  }

  private _doCancel(reason: string): void {
    try { this._runtime.cancelScan(reason); } catch { /* */ }
    this._checkpointPersistence();
    this._emit('scan_cancelled', null, reason);
  }

  /** Tarama tamamlama: report üret (runtime) → persistence completeScan → olaylar. */
  private _finalize(): void {
    if (this._finalized) return;
    this._finalized = true;

    // 1) Report projeksiyonu — runtime.completeScan report üretir (Persistence düşse
    //    bile Report üretilebilsin diye ÖNCE burada).
    try { this._runtime.completeScan({ note: this._mode ? `mode:${this._mode}` : undefined }); }
    catch (err) { this._warn('runtime_complete_failed'); console.error('[DeepScanOrchestrator] completeScan fail-soft', err); }

    // 2) Persistence completeScan (fail-soft — Report zaten üretildi).
    try {
      this._persistence.completeScan({
        snapshot: this._runtimeSnapshot(),
        ecuAddresses: [...this._ecus],
        pidIds: [...this._pids],
        didIds: [...this._dids],
        firmware: this._firmware,
      });
    } catch (err) {
      this._warn('persistence_complete_failed');
      console.error('[DeepScanOrchestrator] persistence.completeScan fail-soft', err);
    }

    this._maybeEmitProgress('report_generation');
    this._emit('report_ready', 'report_generation');
    this._emit('scan_completed', null);
  }

  /** Taramayı iptal eder (çağrılabilir). */
  cancel(reason?: string): OrchestratorSnapshot {
    if (this._disposed || !this._started) return this.getSnapshot();
    if (this._deriveStatus() === 'completed') return this.getSnapshot();
    this._cancelled = true;
    this._doCancel(reason ?? 'user_cancel');
    return this.getSnapshot();
  }

  getSnapshot(): OrchestratorSnapshot {
    let rt: DeepScanSnapshot | null = null;
    try { rt = this._runtimeSnapshot(); } catch { /* */ }
    const idx = this._index;
    return Object.freeze({
      status: this._deriveStatus(),
      mode: this._mode,
      currentPhase: this._started && idx < DEEP_SCAN_PHASE_SEQUENCE.length ? DEEP_SCAN_PHASE_SEQUENCE[idx] : null,
      currentPhaseIndex: idx,
      totalPhases: DEEP_SCAN_PHASE_SEQUENCE.length,
      progressPercent: rt ? rt.progressPercent : this._lastProgress,
      runtimeStatus: rt ? rt.status : 'idle',
      reportSummary: rt ? rt.reportSummary : null,
      warnings: Object.freeze([...this._warnings]),
    });
  }

  subscribe(listener: OrchestratorListener): () => void {
    if (this._disposed || typeof listener !== 'function') return () => { /* no-op */ };
    if (!this._listeners.has(listener) && this._listeners.size >= MAX_ORCH_LISTENERS) {
      return () => { /* no-op */ };
    }
    this._listeners.add(listener);
    return () => { this._listeners.delete(listener); };
  }

  get listenerCount(): number {
    return this._listeners.size;
  }

  /** Orchestrator + runtime durumunu sıfırlar (yeni tarama için). */
  reset(): void {
    if (this._disposed) return;
    this._started = false;
    this._cancelled = false;
    this._finalized = false;
    this._index = 0;
    this._mode = null;
    this._lastProgress = 0;
    this._warnings = [];
    this._ecus = new Set();
    this._pids = new Set();
    this._dids = new Set();
    this._firmware = [];
    try { this._runtime.reset(); } catch { /* */ }
  }

  /** Zero-leak: yalnız kendi dinleyicilerini bırakır (enjekte deps çağıranındır). */
  dispose(): void {
    if (this._disposed) return;
    this._listeners.clear();
    this._ecus = new Set();
    this._pids = new Set();
    this._dids = new Set();
    this._firmware = [];
    this._warnings = [];
    this._disposed = true;
  }

  get isDisposed(): boolean {
    return this._disposed;
  }
}

/**
 * Fabrika — bağımlılık enjeksiyonu (test için). Yapıcı YAN ETKİSİZ: timer/abonelik/
 * native çağrı YOK; runtime/persistence/ignition yalnız `start()`/`run()` çağrılınca
 * kullanılır → import edilmesi hiçbir davranış değiştirmez.
 */
export function createDeepScanOrchestrator(deps: DeepScanOrchestratorDeps = {}): DeepScanOrchestrator {
  return new DeepScanOrchestrator(deps);
}

/**
 * Uygulama geneli tekil orchestrator (varsayılan tekil runtime/persistence/ignition ile).
 * SystemBoot'a BAĞLI DEĞİLDİR; handler YOK (tüm fazlar `skipped`) → gerçek discovery
 * servisleri ileride orchestration PR'ında `handlers` ile bağlanır.
 */
export const deepScanOrchestrator = new DeepScanOrchestrator();
