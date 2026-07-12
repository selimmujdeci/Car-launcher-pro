/**
 * platformCoreDeepScanBridgeWiring — Deep Scan Orchestrator → Event Bus BRIDGE WIRING (W5-2).
 *
 * AMAÇ: W5-1'in SAHİPLENDİĞİ (owned) `DeepScanOrchestrator`'ın MEVCUT olaylarını, W3'ün TEK
 * aktif `appEventBus`'ına — küçük, sanitize, bounded payload'la — taşır. Zincir:
 *
 *   DeepScanOrchestrator  (W5-1 owned, getActiveDeepScanOrchestrator())
 *     → DeepScanEventBridge  (abone; olay → PlatformEvent map)
 *     → appEventBus          (W3 owned, getAppEventBus())   [abone YOK — consumer AYRI PR]
 *
 * W4C (HAL→bus) / W4 (capability→bus) bridge'lerinin Deep Scan eşleniğidir.
 *
 * NE YAPMAZ (bilinçli — W5-2 yalnız EVENT BRIDGE'dir):
 *  - Tarama BAŞLATMAZ · `start()`/`run()`/`runNextPhase()` ÇAĞIRMAZ (orchestrator görünümünde
 *    bu metotlar YOK → compile-time garanti) · handler bağlamaz · offline-run/active-discovery YOK.
 *  - İKİNCİ bus YARATMAZ (getAppEventBus tüketilir) · Capability Registry/Assistant/Deep Scan
 *    ownership'e DOKUNMAZ · native/OBD/CAN/SQL/UI YOK · yeni event catalog girdisi EKLEMEZ.
 *  - `progress_changed` YAYINLANMAZ: katalogda karşılığı YOK → yeni event UYDURULMAZ.
 *
 * OLAY EŞLEMESİ (yalnız MEVCUT katalog isimleri):
 *   scan_started→deep_scan.scan.started · phase_started→deep_scan.phase.started ·
 *   phase_completed→deep_scan.phase.completed · phase_failed→deep_scan.phase.failed ·
 *   report_ready→deep_scan.report.ready · scan_completed→deep_scan.scan.completed ·
 *   scan_failed→deep_scan.scan.failed · scan_cancelled→deep_scan.scan.cancelled.
 *   TRANSIENT (history dışı): phase.* (ara/sık). HISTORY-ELIGIBLE (transient=false): scan.* + report.
 *   RETAINED: hiçbiri (varsayılan false).
 *
 * PAYLOAD (küçük/bounded/sanitize): {state, progress, at, [phase], [reason≤96]} + report/completed'da
 *   reportSummary SAYIMLARI (mode/ecu/pid/did/newDiscoveries/firmwareChecked/changedFirmware/
 *   changedEcu/warningCount/durationMs). ASLA: VIN/MAC/koordinat/ham CAN-OBD/ham PID-DID/full
 *   ECU envanteri/full report body/secret/kullanıcı kimliği. reportSummary.note TAŞINMAZ.
 *
 * SAHİPLİK: bridge YALNIZ kendi aboneliğinin sahibidir → cleanup yalnız unsub eder. Orchestrator
 * (W5-1 owned) ve appEventBus (W3 owned) DISPOSE EDİLMEZ. TEK INSTANCE: aktif bridge varken ikinci
 * `start` YENİ abonelik açmaz; cleanup yalnız KENDİ kaydını siler → boot→shutdown→boot güvenli.
 *
 * FAIL-SOFT: orchestrator YOKSA veya bus YOKSA sessizce no-op cleanup (boot sürer). Orchestrator
 * subscribe hatası / bus publish hatası / bozuk event → köprüyü çökertmez (publish reddi
 * `droppedCount`). Public API throw ETMEZ; ham event/telemetri LOGLANMAZ. ZERO-LEAK: cleanup
 * aboneliği bırakır; timer/polling YOK → scan yürümezken SIFIR event/yük.
 */

import { logError } from '../crashLogger';
import type {
  PlatformEvent,
  PlatformEventBus,
  PlatformEventDomain,
  PlatformEventSource,
} from '../eventBus';
import {
  getActiveDeepScanOrchestrator,
  type DeepScanOrchestratorSubscribable,
} from './platformCoreDeepScanWiring';
import { getAppEventBus } from './platformCoreEventBusWiring';
import { sanitizeText, type OrchestratorEvent, type OrchestratorEventType } from '../deepScan';

/** Bus publish hedefi (yapısal — PlatformEventBus uyar). */
export interface DeepScanBridgePublishTarget {
  publish(input: {
    name: string;
    payload?: unknown;
    domain?: string;
    source?: string;
    transient?: boolean;
    retained?: boolean;
  }): PlatformEvent | null;
}

/** Test için opsiyonel DI; üretimde `getActiveDeepScanOrchestrator()` + `getAppEventBus()`. */
export interface DeepScanBridgeWiringDeps {
  readonly orchestrator?: DeepScanOrchestratorSubscribable | null;
  readonly bus?: DeepScanBridgePublishTarget | null;
  readonly now?: () => number;
}

export type DeepScanBridgeWiringCleanup = () => void;

/** Bounded teşhis görünümü — ham event payload TAŞIMAZ. */
export interface DeepScanBridgeWiringStatus {
  readonly present: boolean;
  readonly started: boolean;
  readonly activeSubscriptionCount: number;
  readonly publishedCount: number;
  readonly droppedCount: number;
  readonly listenerErrorCount: number;
  readonly lastEventName: string | null;
  readonly lastEventAt: number | null;
  readonly lastErrorCode: 'init_failed' | 'cleanup_failed' | null;
}

/** Orchestrator olay tipi → katalog adı + transient (progress_changed HARİÇ — katalog yok). */
const EVENT_MAP: Readonly<Partial<Record<OrchestratorEventType, { name: string; transient: boolean }>>> = {
  scan_started:    { name: 'deep_scan.scan.started',    transient: false },
  phase_started:   { name: 'deep_scan.phase.started',   transient: true },
  phase_completed: { name: 'deep_scan.phase.completed', transient: true },
  phase_failed:    { name: 'deep_scan.phase.failed',    transient: true },
  report_ready:    { name: 'deep_scan.report.ready',    transient: false },
  scan_completed:  { name: 'deep_scan.scan.completed',  transient: false },
  scan_failed:     { name: 'deep_scan.scan.failed',     transient: false },
  scan_cancelled:  { name: 'deep_scan.scan.cancelled',  transient: false },
  // progress_changed: katalog karşılığı YOK → EŞLENMEZ, YAYINLANMAZ.
};

const DEEP_SCAN_DOMAIN = 'deep_scan';
const DEEP_SCAN_SOURCE = 'deep_scan';

function _num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/** Küçük, sanitize payload — ham/PII/full-body ASLA. reportSummary.note TAŞINMAZ. */
function _payload(ev: OrchestratorEvent): Record<string, unknown> {
  const p: Record<string, unknown> = {
    state: ev.status,
    progress: _num(ev.progressPercent),
    at: _num(ev.at),
  };
  if (ev.phase) p.phase = ev.phase;
  if (ev.reason) { const r = sanitizeText(ev.reason, 96); if (r) p.reason = r; }
  const rs = ev.reportSummary;
  if (rs && typeof rs === 'object') {
    p.mode = rs.mode;
    p.ecuCount = _num(rs.ecuCount);
    p.pidCount = _num(rs.pidCount);
    p.didCount = _num(rs.didCount);
    p.newDiscoveriesCount = _num(rs.newDiscoveriesCount);
    p.firmwareCheckedCount = _num(rs.firmwareCheckedCount);
    p.changedFirmware = rs.changedFirmware === true;
    p.changedEcu = rs.changedEcu === true;
    p.warningCount = _num(rs.warningCount);
    p.durationMs = _num(rs.durationMs);
    // rs.note BİLİNÇLİ ATLANIR (full report body kuralı).
  }
  return p;
}

/** İmza — ARDIŞIK duplicate publish önleme (scan reset sonrası tekrar YANLIŞ ELENMEZ). */
function _sig(ev: OrchestratorEvent): string {
  return `${ev.type}|${ev.phase ?? ''}|${ev.status}`;
}

/* ══════════════════════════════════════════════════════════════════════════
 * Bridge
 * ════════════════════════════════════════════════════════════════════════ */

class DeepScanEventBridge {
  private readonly _orchestrator: DeepScanOrchestratorSubscribable;
  private readonly _bus: DeepScanBridgePublishTarget;
  private readonly _now: () => number;

  private _unsub: (() => void) | null = null;
  private _started = false;
  private _disposed = false;
  private _publishedCount = 0;
  private _droppedCount = 0;
  private _listenerErrorCount = 0;
  private _lastEventName: string | null = null;
  private _lastEventAt: number | null = null;
  private _lastSig: string | null = null;

  constructor(deps: { orchestrator: DeepScanOrchestratorSubscribable; bus: DeepScanBridgePublishTarget; now: () => number }) {
    this._orchestrator = deps.orchestrator;
    this._bus = deps.bus;
    this._now = deps.now;
  }

  private _nowSafe(): number {
    try { const n = this._now(); return Number.isFinite(n) ? n : 0; } catch { return 0; }
  }

  /** Orchestrator'a abone olur (İDEMPOTENT). Tarama BAŞLATMAZ. */
  start(): void {
    if (this._disposed || this._started) return;
    this._started = true;
    try {
      this._unsub = this._orchestrator.subscribe((ev) => this._onEvent(ev));
    } catch {
      this._unsub = null;   // abonelik kurulamadı → fail-soft
    }
  }

  private _onEvent(ev: OrchestratorEvent): void {
    if (this._disposed || !this._started) return;   // dispose/stop sonrası no-op
    try {
      if (!ev || typeof ev !== 'object') return;
      const map = EVENT_MAP[ev.type];
      if (!map) return;                              // progress_changed / bilinmeyen → YAYINLANMAZ
      const sig = _sig(ev);
      if (sig === this._lastSig) return;             // ARDIŞIK duplicate → event yok
      this._lastSig = sig;
      this._publish(map.name, _payload(ev), map.transient);
    } catch (err) {
      this._listenerErrorCount++;                    // iç hata izole — köprü çökmez
      console.error('[DeepScanEventBridge] event map hatası — servis etkilenmedi', err);
    }
  }

  private _publish(name: string, payload: unknown, transient: boolean): void {
    try {
      const ev = this._bus.publish({ name, payload, domain: DEEP_SCAN_DOMAIN, source: DEEP_SCAN_SOURCE, transient, retained: false });
      if (ev) { this._publishedCount++; this._lastEventName = name; this._lastEventAt = this._nowSafe(); }
      else { this._droppedCount++; }
    } catch {
      this._droppedCount++;   // publish hatası scan lifecycle'ı ETKİLEMEZ
    }
  }

  getStatus(): Omit<DeepScanBridgeWiringStatus, 'present' | 'lastErrorCode'> {
    return {
      started: this._started,
      activeSubscriptionCount: this._unsub ? 1 : 0,
      publishedCount: this._publishedCount,
      droppedCount: this._droppedCount,
      listenerErrorCount: this._listenerErrorCount,
      lastEventName: this._lastEventName,
      lastEventAt: this._lastEventAt,
    };
  }

  stop(): void {
    if (!this._started) return;
    this._started = false;
    if (this._unsub) { try { this._unsub(); } catch { /* */ } this._unsub = null; }
  }

  /** Zero-leak: aboneliği bırakır + kilitler. Orchestrator/Bus çağıranındır → dispose EDİLMEZ. */
  dispose(): void {
    if (this._disposed) return;
    this.stop();
    this._disposed = true;
  }

  get isDisposed(): boolean { return this._disposed; }
}

/* ══════════════════════════════════════════════════════════════════════════
 * Wiring
 * ════════════════════════════════════════════════════════════════════════ */

/** Bridge publish sözleşmesi geniş `string` domain/source ister; bus dar union bekler → sarmala. */
function _toPublishTarget(bus: PlatformEventBus): DeepScanBridgePublishTarget {
  return {
    publish: (input) => bus.publish({
      name: input.name,
      payload: input.payload,
      domain: input.domain as PlatformEventDomain | undefined,
      source: input.source as PlatformEventSource | undefined,
      transient: input.transient,
      retained: input.retained,
    }),
  };
}

const NOOP_CLEANUP: DeepScanBridgeWiringCleanup = () => { /* no-op */ };

const ABSENT_STATUS: DeepScanBridgeWiringStatus = Object.freeze({
  present: false, started: false, activeSubscriptionCount: 0,
  publishedCount: 0, droppedCount: 0, listenerErrorCount: 0,
  lastEventName: null, lastEventAt: null, lastErrorCode: null,
});

let _active: DeepScanEventBridge | null = null;
let _lastErrorCode: DeepScanBridgeWiringStatus['lastErrorCode'] = null;

function _pruneStale(): void {
  if (_active && _active.isDisposed) _active = null;
}

/**
 * Bridge'i oluşturur ve owned orchestrator'a abone eder → olayları TEK appEventBus'a publish eder.
 * YALNIZ cleanup thunk döner. Dışarı exception KAÇIRMAZ. İDEMPOTENT. Orchestrator veya bus yoksa
 * fail-soft no-op. Tarama BAŞLATMAZ.
 */
export function startPlatformCoreDeepScanBridgeWiring(deps: DeepScanBridgeWiringDeps = {}): DeepScanBridgeWiringCleanup {
  let bridge: DeepScanEventBridge | null = null;
  try {
    _pruneStale();
    if (_active) return NOOP_CLEANUP;                 // zaten aktif → ikinci abonelik YOK

    const orchestrator = 'orchestrator' in deps ? deps.orchestrator : getActiveDeepScanOrchestrator();
    if (!orchestrator) return NOOP_CLEANUP;           // orchestrator yok → sessiz no-op

    const appBus = getAppEventBus();
    const bus: DeepScanBridgePublishTarget | null =
      'bus' in deps ? (deps.bus ?? null) : (appBus ? _toPublishTarget(appBus) : null);
    if (!bus) return NOOP_CLEANUP;                    // bus yok → sessiz no-op (boot sürer)

    const now = typeof deps.now === 'function' ? deps.now : () => Date.now();
    bridge = new DeepScanEventBridge({ orchestrator, bus, now });
    const own = bridge;
    _active = own;
    own.start();                                      // yalnız ABONELİK — tarama başlatmaz
    _lastErrorCode = null;

    let disposed = false;
    return () => {
      if (disposed) return;                           // İDEMPOTENT
      disposed = true;
      try {
        own.dispose();                                // YALNIZ abonelik — orchestrator/bus DISPOSE EDİLMEZ
      } catch (e) {
        _lastErrorCode = 'cleanup_failed';
        logError('deepScanBridgeWiring:cleanup', e);
      }
      if (_active === own) _active = null;
    };
  } catch (e) {
    if (bridge && _active === bridge) _active = null;
    _lastErrorCode = 'init_failed';
    logError('deepScanBridgeWiring:init', e);         // ham event/telemetri LOGLANMAZ
    return NOOP_CLEANUP;
  }
}

/** Bounded teşhis görünümü. Bridge yoksa present:false. Throw ETMEZ. */
export function getDeepScanBridgeStatus(): DeepScanBridgeWiringStatus {
  _pruneStale();
  const b = _active;
  if (!b) {
    return _lastErrorCode ? Object.freeze({ ...ABSENT_STATUS, lastErrorCode: _lastErrorCode }) : ABSENT_STATUS;
  }
  try {
    const s = b.getStatus();
    return Object.freeze({ present: true, lastErrorCode: _lastErrorCode, ...s });
  } catch {
    return ABSENT_STATUS;
  }
}
