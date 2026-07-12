/**
 * platformKernel — CarOS Pro Platform Kernel / Service Lifecycle — FOUNDATION.
 *
 * AMAÇ: Platform servislerinin (Vehicle HAL · Capability Registry · Event Bus · Deep Scan ·
 * Navigation · AI · Fleet · Remote · Health · Vision …) yaşam döngüsünü, bağımlılıklarını,
 * başlatma/durdurma SIRASINI, sağlık durumunu ve HATA İZOLASYONUNU yöneten merkezi çekirdek.
 *
 * ⚠️ BUGÜNKÜ DURUM (salt-okunur analiz): Lifecycle ≥3 ayrı desende parçalı — SystemBoot
 * "Wave 1-4" + LIFO cleanup + named restart/backoff (MAX_RESTARTS=2, BACKOFF_BASE 5s,
 * COOLOFF 5dk); modül-düzeyi `startX()/stopX()` fonksiyonları; servis-içi `_listeners`/
 * `_reg` cleanup. ORTAK bir descriptor/bağımlılık/health/circuit modeli YOK. Kernel bu
 * boşluğu doldurur — ama gerçek servisleri BU PR'da BAĞLAMAZ (yalnız DI ile yönetir).
 *
 * NE YAPMAZ (bilinçli — bu PR yalnız FOUNDATION'dır):
 *  - SystemBoot'u DEĞİŞTİRMEZ · gerçek servisleri OTOMATİK başlatmaz · HAL/Registry/Event
 *    Bus'ı KENDİSİ YARATMAZ (DI ile alır) · native/OBD/CAN/poll DEĞİŞTİRMEZ · UI/SQL/cloud
 *    YOK · persistence YOK (runtime-memory) · GLOBAL SINGLETON oluşturmaz.
 *  - Import YAN ETKİSİZDİR (yalnız `DeviceTier` TYPE import; timer/abonelik/native yok).
 *  - Servislerin İŞ MANTIĞINI bilmez; yalnız descriptor + lifecycle method'larını çağırır.
 *
 * ZERO-LEAK: lifecycle timeout timer'ı YALNIZ aktif çağrı boyunca yaşar (settle'da temizlenir);
 * `dispose()` tüm aktif timer'ları + dinleyicileri bırakır; steady-state timer/polling YOK.
 * FAIL-SOFT: servis exception İZOLE, public API throw ETMEZ, bir servis düşse bağımsızlar sürer,
 * Event Bus yoksa lifecycle çalışır. Bounded · immutable snapshot · deterministik sıra.
 */

import type { DeviceTier } from '../deviceCapabilities';

/* ══════════════════════════════════════════════════════════════════════════
 * Model
 * ════════════════════════════════════════════════════════════════════════ */

export type PlatformServiceState =
  | 'registered' | 'initializing' | 'ready' | 'starting' | 'running'
  | 'degraded' | 'paused' | 'stopping' | 'stopped' | 'failed' | 'disposed';

export type PlatformServiceCriticality =
  | 'safety' | 'critical' | 'important' | 'normal' | 'optional' | 'background';

export type PlatformServiceStartPolicy =
  | 'eager' | 'lazy' | 'on_demand' | 'capability_gated' | 'device_tier_gated' | 'manual';

export type PlatformServiceRestartPolicy =
  | 'never' | 'manual' | 'on_failure' | 'bounded_auto';

export type PlatformServiceHealth = 'healthy' | 'degraded' | 'unhealthy' | 'unknown';

export interface PlatformServiceDescriptor {
  readonly id: string;
  readonly version?: string;
  readonly criticality: PlatformServiceCriticality;
  readonly dependencies?: readonly string[];
  readonly optionalDependencies?: readonly string[];
  readonly requiredCapabilities?: readonly string[];
  readonly minimumDeviceTier?: DeviceTier;
  readonly startPolicy: PlatformServiceStartPolicy;
  readonly restartPolicy?: PlatformServiceRestartPolicy;
  readonly initTimeoutMs?: number;
  readonly startTimeoutMs?: number;
  readonly stopTimeoutMs?: number;
  readonly owner?: string;
  readonly experimental?: boolean;
}

export interface PlatformServiceStatus {
  readonly id: string;
  readonly state: PlatformServiceState;
  readonly health: PlatformServiceHealth;
  readonly startedAt: number | null;
  readonly stoppedAt: number | null;
  readonly lastTransitionAt: number;
  readonly restartCount: number;
  readonly failureCount: number;
  readonly lastErrorCode: string | null;
  readonly degradedReasons: readonly string[];
  readonly dependencyState: Readonly<Record<string, string>>;
  readonly capabilityState: Readonly<Record<string, string>>;
}

/** Servis sözleşmesi — tüm method'lar OPTIONAL (eksik → no-op). */
export interface PlatformService {
  readonly id: string;
  init?(): Promise<void> | void;
  start?(): Promise<void> | void;
  pause?(): Promise<void> | void;
  resume?(): Promise<void> | void;
  stop?(): Promise<void> | void;
  health?(): Promise<PlatformServiceHealth> | PlatformServiceHealth;
  dispose?(): Promise<void> | void;
}

/** Capability gate kaynağı (DI — Capability Registry yapısal uyar, doğrudan import YOK). */
export interface KernelCapabilitySource {
  isAvailable(id: string): boolean;
  getStatus(id: string): string;
  subscribe?(listener: (...args: unknown[]) => void): (() => void);
}

/** Opsiyonel Event publisher (DI — Platform Event Bus yapısal uyar). */
export interface KernelEventPublisher {
  publishName(name: string, payload?: unknown, metadata?: Record<string, unknown>): unknown;
}

export interface PlatformKernelDeps {
  readonly now?: () => number;
  readonly deviceTier?: DeviceTier | (() => DeviceTier);
  readonly capabilities?: KernelCapabilitySource;
  readonly publisher?: KernelEventPublisher;
  readonly limits?: Partial<KernelLimits>;
  readonly timeouts?: Partial<KernelTimeouts>;
}

export interface KernelLimits {
  readonly maxServices: number;
  readonly maxListeners: number;
  readonly maxDegradedReasons: number;
}

export interface KernelTimeouts {
  readonly initTimeoutMs: number;
  readonly startTimeoutMs: number;
  readonly stopTimeoutMs: number;
}

export type KernelChangeType =
  | 'registered' | 'unregistered' | 'transition' | 'health' | 'degraded' | 'reset';

export interface KernelChangeEvent {
  readonly type: KernelChangeType;
  readonly id: string | null;
  readonly state: PlatformServiceState | null;
  readonly at: number;
}

export type KernelListener = (event: KernelChangeEvent) => void;

export interface KernelSnapshot {
  readonly generatedAt: number;
  readonly deviceTier: DeviceTier;
  readonly serviceCount: number;
  readonly runningCount: number;
  readonly degradedCount: number;
  readonly failedCount: number;
  readonly health: PlatformServiceHealth;
  readonly services: readonly PlatformServiceStatus[];
}

/* ══════════════════════════════════════════════════════════════════════════
 * Sabitler (SystemBoot / proje konvansiyonundan türetildi — magic değil)
 * ════════════════════════════════════════════════════════════════════════ */

// Proje 5s servis timeout konvansiyonu (VehicleProfileService FETCH_TIMEOUT_MS=5000,
// SystemBoot BACKOFF_BASE_MS=5000) → lifecycle default'ları.
export const DEFAULT_KERNEL_TIMEOUTS: KernelTimeouts = Object.freeze({
  initTimeoutMs: 5_000,
  startTimeoutMs: 5_000,
  stopTimeoutMs: 5_000,
});

export const DEFAULT_KERNEL_LIMITS: KernelLimits = Object.freeze({
  maxServices: 128,       // öneri: bounded 128
  maxListeners: 32,       // öneri: 32
  maxDegradedReasons: 8,
});

// SystemBoot MAX_RESTARTS=2 türevi; safety-critical daha kısıtlayıcı (fail-fast → güvenli durum).
const DEFAULT_MAX_AUTO_RESTARTS = 2;
const SAFETY_MAX_AUTO_RESTARTS = 1;
const BACKOFF_BASE_MS = 5_000;    // SystemBoot BACKOFF_BASE_MS
const BACKOFF_MAX_MS = 160_000;   // SystemBoot BACKOFF_MAX_MS

const TIER_RANK: Readonly<Record<DeviceTier, number>> = { low: 0, mid: 1, high: 2 };

const RUNNING_STATES: ReadonlySet<PlatformServiceState> = new Set<PlatformServiceState>(['running', 'degraded']);

/** Geçerli state geçişleri (geçersiz → reddedilir, throw YOK). */
const ALLOWED_TRANSITIONS: Readonly<Record<PlatformServiceState, ReadonlySet<PlatformServiceState>>> = {
  registered: new Set(['initializing', 'starting', 'stopped', 'disposed']),
  initializing: new Set(['ready', 'failed', 'disposed', 'stopped']),
  ready: new Set(['starting', 'stopped', 'disposed', 'initializing']),
  starting: new Set(['running', 'degraded', 'failed', 'disposed', 'stopping']),
  running: new Set(['degraded', 'paused', 'stopping', 'failed', 'disposed']),
  degraded: new Set(['running', 'paused', 'stopping', 'failed', 'disposed']),
  paused: new Set(['running', 'degraded', 'stopping', 'disposed']),
  stopping: new Set(['stopped', 'failed', 'disposed']),
  stopped: new Set(['starting', 'initializing', 'disposed']),
  failed: new Set(['initializing', 'starting', 'stopped', 'disposed']),
  disposed: new Set([]),
};

/** Exponential backoff (SAF contract — bu PR'da TIMER kurulmaz; ileride scheduler kullanır). */
export function computeKernelBackoffMs(attempt: number): number {
  const a = typeof attempt === 'number' && attempt > 0 ? Math.floor(attempt) : 0;
  const ms = BACKOFF_BASE_MS * Math.pow(2, a);
  return ms > BACKOFF_MAX_MS ? BACKOFF_MAX_MS : ms;
}

/* ══════════════════════════════════════════════════════════════════════════
 * Dahili kayıt
 * ════════════════════════════════════════════════════════════════════════ */

interface ServiceEntry {
  readonly descriptor: PlatformServiceDescriptor;
  readonly service: PlatformService;
  state: PlatformServiceState;
  health: PlatformServiceHealth;
  startedAt: number | null;
  stoppedAt: number | null;
  lastTransitionAt: number;
  restartCount: number;
  failureCount: number;
  lastErrorCode: string | null;
  degradedReasons: string[];
  dependencyState: Record<string, string>;
  capabilityState: Record<string, string>;
  circuitOpen: boolean;
  initialized: boolean;
}

function _text(v: unknown, max = 64): string | null {
  if (typeof v !== 'string') return null;
  const s = v.replace(/\b(?:sk|pk|api|key|token|bearer)[-_]?[A-Za-z0-9_-]{12,}\b/gi, '[redacted]')
    .replace(/\b(?:[0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}\b/g, '[redacted]')
    .replace(/\b[A-HJ-NPR-Z0-9]{17}\b/g, '[redacted]')
    .replace(/-?\d{1,3}\.\d{4,}\s*[,;]\s*-?\d{1,3}\.\d{4,}/g, '[redacted]')
    .trim();
  const c = s.length > max ? s.slice(0, max) : s;
  return c || null;
}

function _errorCode(e: unknown): string {
  if (e && typeof e === 'object' && 'code' in e) { const c = _text(String((e as { code: unknown }).code)); if (c) return c; }
  if (e instanceof Error) return _text(e.name) ?? 'error';
  return 'error';
}

/* ══════════════════════════════════════════════════════════════════════════
 * Kernel
 * ════════════════════════════════════════════════════════════════════════ */

export class PlatformKernel {
  private readonly _now: () => number;
  private readonly _deviceTier: () => DeviceTier;
  private readonly _caps: KernelCapabilitySource | null;
  private readonly _publisher: KernelEventPublisher | null;
  private readonly _limits: KernelLimits;
  private readonly _timeouts: KernelTimeouts;

  private readonly _services = new Map<string, ServiceEntry>();
  private readonly _listeners = new Set<KernelListener>();
  private readonly _activeTimers = new Set<ReturnType<typeof setTimeout>>();
  private _runtimeStarted = false;
  private _disposed = false;

  constructor(deps: PlatformKernelDeps = {}) {
    this._now = typeof deps.now === 'function' ? deps.now : () => Date.now();
    const tier = deps.deviceTier;
    this._deviceTier = typeof tier === 'function' ? tier : () => (tier ?? 'low');
    this._caps = deps.capabilities ?? null;
    this._publisher = deps.publisher ?? null;
    this._limits = { ...DEFAULT_KERNEL_LIMITS, ...(deps.limits ?? {}) };
    this._timeouts = { ...DEFAULT_KERNEL_TIMEOUTS, ...(deps.timeouts ?? {}) };
  }

  private _nowSafe(): number {
    try { const n = this._now(); return Number.isFinite(n) ? n : 0; } catch { return 0; }
  }

  private _tierSafe(): DeviceTier {
    try { const t = this._deviceTier(); return t === 'low' || t === 'mid' || t === 'high' ? t : 'low'; } catch { return 'low'; }
  }

  /* ── Kayıt ─────────────────────────────────────────────────────────────── */

  registerService(descriptor: PlatformServiceDescriptor, service: PlatformService): boolean {
    if (this._disposed) return false;
    if (!descriptor || typeof descriptor.id !== 'string' || !descriptor.id) return false;
    if (!service || typeof service !== 'object') return false;
    if (this._services.has(descriptor.id)) return false;                 // duplicate reddi
    if (this._services.size >= this._limits.maxServices) return false;   // bounded
    // Döngü reddi: bu servis eklenince mevcut kayıtlı deps arasında cycle oluşur mu?
    if (this._wouldCreateCycle(descriptor)) return false;

    const now = this._nowSafe();
    this._services.set(descriptor.id, {
      descriptor: Object.freeze({ ...descriptor }),
      service,
      state: 'registered',
      health: 'unknown',
      startedAt: null,
      stoppedAt: null,
      lastTransitionAt: now,
      restartCount: 0,
      failureCount: 0,
      lastErrorCode: null,
      degradedReasons: [],
      dependencyState: {},
      capabilityState: {},
      circuitOpen: false,
      initialized: false,
    });
    this._emit('registered', descriptor.id, 'registered');
    return true;
  }

  unregisterService(id: string): boolean {
    if (this._disposed) return false;
    const e = this._services.get(id);
    if (!e) return false;
    this._services.delete(id);
    this._emit('unregistered', id, null);
    return true;
  }

  hasService(id: string): boolean {
    return this._services.has(id);
  }

  /* ── Bağımlılık grafiği ────────────────────────────────────────────────── */

  private _deps(id: string): readonly string[] {
    const e = this._services.get(id);
    return e && Array.isArray(e.descriptor.dependencies) ? e.descriptor.dependencies : [];
  }

  /** Tentatif ekleme sonrası bu servisten başlayan bir cycle var mı (yalnız kayıtlı düğümler). */
  private _wouldCreateCycle(descriptor: PlatformServiceDescriptor): boolean {
    const deps = Array.isArray(descriptor.dependencies) ? descriptor.dependencies : [];
    const stack = new Set<string>([descriptor.id]);
    const visit = (id: string, chain: Set<string>): boolean => {
      for (const d of (id === descriptor.id ? deps : this._deps(id))) {
        if (d === descriptor.id) return true;              // geri dönüş → cycle
        if (chain.has(d)) continue;
        if (!this._services.has(d)) continue;              // henüz kayıtlı değil → cycle değil
        chain.add(d);
        if (visit(d, chain)) return true;
      }
      return false;
    };
    return visit(descriptor.id, stack);
  }

  /** Topolojik başlatma sırası (deterministik tie-break = id). Cycle'daki düğümler dışlanır. */
  resolveStartOrder(): string[] {
    const ids = [...this._services.keys()].sort();
    const order: string[] = [];
    const visited = new Set<string>();
    const inStack = new Set<string>();
    const visit = (id: string): void => {
      if (visited.has(id) || inStack.has(id)) return;
      inStack.add(id);
      for (const d of [...this._deps(id)].sort()) {
        if (this._services.has(d) && !inStack.has(d)) visit(d);
      }
      inStack.delete(id);
      if (!visited.has(id)) { visited.add(id); order.push(id); }
    };
    for (const id of ids) visit(id);
    return order;
  }

  /* ── Gate değerlendirmesi ──────────────────────────────────────────────── */

  private _evaluateGates(e: ServiceEntry): { blocked: boolean; degraded: boolean; reasons: string[]; dependencyState: Record<string, string>; capabilityState: Record<string, string> } {
    const d = e.descriptor;
    const reasons: string[] = [];
    const dependencyState: Record<string, string> = {};
    const capabilityState: Record<string, string> = {};
    let blocked = false;
    let degraded = false;

    // Required dependencies.
    for (const dep of (d.dependencies ?? [])) {
      const de = this._services.get(dep);
      const st = de ? de.state : 'missing';
      dependencyState[dep] = st;
      if (!de || !RUNNING_STATES.has(de.state)) { blocked = true; reasons.push(`dep_not_ready:${dep}`); }
      else if (de.state === 'degraded') { degraded = true; reasons.push(`dep_degraded:${dep}`); }
    }
    // Optional dependencies → eksik/failed engellemez ama degraded.
    for (const dep of (d.optionalDependencies ?? [])) {
      const de = this._services.get(dep);
      if (!de || !RUNNING_STATES.has(de.state)) { degraded = true; reasons.push(`opt_dep_missing:${dep}`); }
    }
    // Required capabilities (DI gate).
    if (this._caps) {
      for (const cap of (d.requiredCapabilities ?? [])) {
        let st = 'unknown';
        try { st = this._caps.getStatus(cap) || 'unknown'; } catch { st = 'unknown'; }
        capabilityState[cap] = st;
        if (st === 'available') continue;
        if (st === 'degraded') { degraded = true; reasons.push(`cap_degraded:${cap}`); }
        else { blocked = true; reasons.push(`cap_${st}:${cap}`); }   // unknown/unavailable/unsupported/restricted
      }
    } else if ((d.requiredCapabilities ?? []).length > 0) {
      // Gate yok ama capability gerekiyor → kanıt yok → başlatma (fail-closed).
      for (const cap of d.requiredCapabilities!) { capabilityState[cap] = 'no_gate'; }
      blocked = true; reasons.push('capability_gate_absent');
    }
    // DeviceTier minimumu.
    if (d.minimumDeviceTier) {
      const cur = this._tierSafe();
      if (TIER_RANK[cur] < TIER_RANK[d.minimumDeviceTier]) { blocked = true; reasons.push(`device_tier_below:${d.minimumDeviceTier}`); }
    }
    return { blocked, degraded, reasons, dependencyState, capabilityState };
  }

  /* ── State geçişleri ───────────────────────────────────────────────────── */

  private _transition(e: ServiceEntry, next: PlatformServiceState): boolean {
    if (e.state === next) return true;
    const allowed = ALLOWED_TRANSITIONS[e.state];
    if (!allowed || !allowed.has(next)) return false;    // geçersiz geçiş → reddedilir (throw yok)
    e.state = next;
    e.lastTransitionAt = this._nowSafe();
    this._emit('transition', e.descriptor.id, next);
    return true;
  }

  /* ── Timeout sarmalayıcı (timer yalnız aktif çağrı boyunca) ────────────── */

  private async _callWithTimeout(fn: (() => Promise<void> | void) | undefined, timeoutMs: number, label: string): Promise<void> {
    if (typeof fn !== 'function') return;                // eksik method → no-op
    const p = Promise.resolve().then(() => fn());
    if (!(timeoutMs > 0)) { await p; return; }
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true; this._activeTimers.delete(timer);
        reject(new Error(`kernel_timeout:${label}`));
      }, timeoutMs);
      this._activeTimers.add(timer);
      p.then(
        () => { if (!settled) { settled = true; clearTimeout(timer); this._activeTimers.delete(timer); resolve(); } },
        (err) => { if (!settled) { settled = true; clearTimeout(timer); this._activeTimers.delete(timer); reject(err instanceof Error ? err : new Error('error')); } },
      );
    });
  }

  /* ── Lifecycle ─────────────────────────────────────────────────────────── */

  async initializeService(id: string): Promise<PlatformServiceState> {
    if (this._disposed) return 'disposed';
    const e = this._services.get(id);
    if (!e) return 'stopped';
    if (e.initialized && (e.state === 'ready' || RUNNING_STATES.has(e.state) || e.state === 'paused')) return e.state; // idempotent
    if (e.state === 'disposed') return 'disposed';
    if (!this._transition(e, 'initializing')) return e.state;
    try {
      await this._callWithTimeout(e.service.init?.bind(e.service), e.descriptor.initTimeoutMs ?? this._timeouts.initTimeoutMs, `init:${id}`);
      e.initialized = true;
      this._transition(e, 'ready');
    } catch (err) {
      this._fail(e, err);
    }
    return e.state;
  }

  async startService(id: string): Promise<PlatformServiceState> {
    if (this._disposed) return 'disposed';
    const e = this._services.get(id);
    if (!e) return 'stopped';
    if (RUNNING_STATES.has(e.state)) return e.state;     // idempotent
    if (e.state === 'disposed') return 'disposed';

    // Gate.
    const gate = this._evaluateGates(e);
    e.dependencyState = gate.dependencyState;
    e.capabilityState = gate.capabilityState;
    if (gate.blocked) {
      this._setDegradedReasons(e, gate.reasons);
      return e.state;                                    // başlatılamaz → mevcut state korunur
    }

    // Init (gerekiyorsa) — init başarısızsa BAŞLATMA (annotated local: TS narrowing tuzağını atlar).
    if (!e.initialized) {
      await this.initializeService(id);
      const afterInit: string = e.state;   // string: metod-içi mutasyon sonrası TS narrowing tuzağını atlar
      if (afterInit === 'failed' || afterInit === 'disposed') return e.state;
    }
    // Yalnız ready/stopped'tan başlanır — geçersiz geçişi transition kuralları reddeder.
    if (!this._transition(e, 'starting')) return e.state;
    try {
      await this._callWithTimeout(e.service.start?.bind(e.service), e.descriptor.startTimeoutMs ?? this._timeouts.startTimeoutMs, `start:${id}`);
      if (gate.degraded) {
        this._setDegradedReasons(e, gate.reasons);
        this._transition(e, 'running');
        this._transition(e, 'degraded');
        this._publish('platform.service.started', { id, degraded: true });
      } else {
        e.degradedReasons = [];
        this._transition(e, 'running');
        this._publish('platform.service.started', { id, degraded: false });
      }
      e.startedAt = this._nowSafe();
      e.health = gate.degraded ? 'degraded' : 'healthy';
    } catch (err) {
      this._fail(e, err);
    }
    return e.state;
  }

  async startAll(): Promise<void> {
    if (this._disposed) return;
    if (!this._runtimeStarted) { this._runtimeStarted = true; this._publish('platform.runtime.started', {}); }
    for (const id of this.resolveStartOrder()) {
      const e = this._services.get(id);
      if (!e) continue;
      // eager/capability_gated/device_tier_gated/lazy → startAll'da denenir; manual/on_demand ATLANIR.
      if (e.descriptor.startPolicy === 'manual' || e.descriptor.startPolicy === 'on_demand') continue;
      await this.startService(id);
    }
    if (this._anyCriticalDown()) this._publish('platform.runtime.degraded', {});
  }

  async pauseService(id: string): Promise<PlatformServiceState> {
    if (this._disposed) return 'disposed';
    const e = this._services.get(id);
    if (!e) return 'stopped';
    if (e.state === 'paused') return e.state;            // idempotent
    if (!RUNNING_STATES.has(e.state)) return e.state;
    try { await this._callWithTimeout(e.service.pause?.bind(e.service), this._timeouts.stopTimeoutMs, `pause:${id}`); } catch { /* fail-soft */ }
    this._transition(e, 'paused');
    return e.state;
  }

  async resumeService(id: string): Promise<PlatformServiceState> {
    if (this._disposed) return 'disposed';
    const e = this._services.get(id);
    if (!e) return 'stopped';
    if (e.state !== 'paused') return e.state;
    try { await this._callWithTimeout(e.service.resume?.bind(e.service), this._timeouts.startTimeoutMs, `resume:${id}`); } catch { /* fail-soft */ }
    this._transition(e, 'running');
    return e.state;
  }

  async stopService(id: string): Promise<PlatformServiceState> {
    if (this._disposed) return 'disposed';
    const e = this._services.get(id);
    if (!e) return 'stopped';
    if (e.state === 'stopped' || e.state === 'registered' || e.state === 'ready') { // idempotent / hiç başlamadı
      if (e.state === 'ready' || e.state === 'registered') return e.state;
      return e.state;
    }
    if (e.state === 'disposed') return 'disposed';
    if (!this._transition(e, 'stopping')) return e.state;
    try {
      await this._callWithTimeout(e.service.stop?.bind(e.service), e.descriptor.stopTimeoutMs ?? this._timeouts.stopTimeoutMs, `stop:${id}`);
    } catch { /* stop hatası fail-soft — yine de stopped'a geç */ }
    this._transition(e, 'stopped');
    e.stoppedAt = this._nowSafe();
    e.health = 'unknown';
    this._publish('platform.service.stopped', { id });
    return e.state;
  }

  async stopAll(): Promise<void> {
    if (this._disposed) return;
    for (const id of this.resolveStartOrder().reverse()) {  // ters topolojik
      await this.stopService(id);
    }
    if (this._runtimeStarted) { this._runtimeStarted = false; this._publish('platform.runtime.stopped', {}); }
  }

  async restartService(id: string): Promise<PlatformServiceState> {
    if (this._disposed) return 'disposed';
    const e = this._services.get(id);
    if (!e) return 'stopped';
    const policy = e.descriptor.restartPolicy ?? 'manual';
    if (policy === 'never') return e.state;              // asla restart edilmez
    if (e.circuitOpen) return e.state;                   // circuit açık → bloke
    e.restartCount++;
    // Circuit: on_failure/bounded_auto policy'lerinde max aşımında aç.
    if (policy === 'on_failure' || policy === 'bounded_auto') {
      const max = e.descriptor.criticality === 'safety' ? SAFETY_MAX_AUTO_RESTARTS : DEFAULT_MAX_AUTO_RESTARTS;
      if (e.restartCount >= max) e.circuitOpen = true;
    }
    await this.stopService(id);
    return this.startService(id);
  }

  markDegraded(id: string, reason: string): boolean {
    if (this._disposed) return false;
    const e = this._services.get(id);
    if (!e) return false;
    this._addDegradedReason(e, _text(reason) ?? 'degraded');
    if (RUNNING_STATES.has(e.state) || e.state === 'running') {
      if (e.state === 'running') this._transition(e, 'degraded');
      e.health = 'degraded';
      this._emit('degraded', id, e.state);
      if (e.descriptor.criticality === 'safety' || e.descriptor.criticality === 'critical') this._publish('platform.runtime.degraded', { id });
    }
    return true;
  }

  /* ── Health ────────────────────────────────────────────────────────────── */

  async runHealthCheck(id?: string): Promise<void> {
    if (this._disposed) return;
    const targets = typeof id === 'string' ? [this._services.get(id)].filter(Boolean) as ServiceEntry[] : [...this._services.values()];
    for (const e of targets) {
      let h: PlatformServiceHealth;
      if (typeof e.service.health === 'function') {
        try { h = this._normHealth(await Promise.resolve(e.service.health())); } catch { h = 'unknown'; } // fail-soft
      } else {
        h = e.state === 'running' ? 'healthy' : e.state === 'degraded' ? 'degraded' : e.state === 'failed' ? 'unhealthy' : 'unknown';
      }
      e.health = h;                                        // state MUTATE EDİLMEZ, yalnız health
      this._emit('health', e.descriptor.id, e.state);
    }
  }

  private _normHealth(v: unknown): PlatformServiceHealth {
    return v === 'healthy' || v === 'degraded' || v === 'unhealthy' ? v : 'unknown';
  }

  /* ── Sorgu ─────────────────────────────────────────────────────────────── */

  getServiceStatus(id: string): PlatformServiceStatus | null {
    const e = this._services.get(id);
    return e ? this._freezeStatus(e) : null;
  }

  listServices(filter?: (s: PlatformServiceStatus) => boolean): PlatformServiceStatus[] {
    const all = [...this._services.keys()].sort().map((k) => this._freezeStatus(this._services.get(k)!));
    return typeof filter === 'function' ? all.filter((s) => { try { return filter(s); } catch { return false; } }) : all;
  }

  getKernelSnapshot(): KernelSnapshot {
    const services = this.listServices();
    let running = 0, degraded = 0, failed = 0;
    for (const s of services) {
      if (s.state === 'running') running++;
      else if (s.state === 'degraded') degraded++;
      else if (s.state === 'failed') failed++;
    }
    const health: PlatformServiceHealth = failed > 0 ? 'unhealthy' : degraded > 0 ? 'degraded' : services.length > 0 ? 'healthy' : 'unknown';
    return Object.freeze({
      generatedAt: this._nowSafe(),
      deviceTier: this._tierSafe(),
      serviceCount: services.length,
      runningCount: running,
      degradedCount: degraded,
      failedCount: failed,
      health,
      services: Object.freeze(services),
    });
  }

  private _freezeStatus(e: ServiceEntry): PlatformServiceStatus {
    return Object.freeze({
      id: e.descriptor.id,
      state: e.state,
      health: e.health,
      startedAt: e.startedAt,
      stoppedAt: e.stoppedAt,
      lastTransitionAt: e.lastTransitionAt,
      restartCount: e.restartCount,
      failureCount: e.failureCount,
      lastErrorCode: e.lastErrorCode,
      degradedReasons: Object.freeze([...e.degradedReasons]),
      dependencyState: Object.freeze({ ...e.dependencyState }),
      capabilityState: Object.freeze({ ...e.capabilityState }),
    });
  }

  /* ── Dinleyici ─────────────────────────────────────────────────────────── */

  subscribe(listener: KernelListener): () => void {
    if (this._disposed || typeof listener !== 'function') return () => { /* no-op */ };
    if (!this._listeners.has(listener) && this._listeners.size >= this._limits.maxListeners) return () => { /* no-op */ };
    this._listeners.add(listener);
    return () => { this._listeners.delete(listener); };
  }

  get listenerCount(): number { return this._listeners.size; }
  get serviceCount(): number { return this._services.size; }
  get isDisposed(): boolean { return this._disposed; }

  /* ── Yardımcılar ───────────────────────────────────────────────────────── */

  private _fail(e: ServiceEntry, err: unknown): void {
    e.failureCount++;
    e.lastErrorCode = _errorCode(err);
    this._addDegradedReason(e, e.lastErrorCode);
    this._transition(e, 'failed');
    e.health = 'unhealthy';
    this._publish('platform.service.failed', { id: e.descriptor.id, code: e.lastErrorCode });
    if (e.descriptor.criticality === 'safety' || e.descriptor.criticality === 'critical') this._publish('platform.runtime.degraded', { id: e.descriptor.id });
  }

  private _setDegradedReasons(e: ServiceEntry, reasons: string[]): void {
    e.degradedReasons = reasons.map((r) => _text(r) ?? '').filter(Boolean).slice(0, this._limits.maxDegradedReasons);
  }

  private _addDegradedReason(e: ServiceEntry, reason: string): void {
    if (e.degradedReasons.length >= this._limits.maxDegradedReasons) return;
    if (!e.degradedReasons.includes(reason)) e.degradedReasons.push(reason);
  }

  private _anyCriticalDown(): boolean {
    for (const e of this._services.values()) {
      if ((e.descriptor.criticality === 'safety' || e.descriptor.criticality === 'critical') && (e.state === 'failed' || e.state === 'degraded')) return true;
    }
    return false;
  }

  private _emit(type: KernelChangeType, id: string | null, state: PlatformServiceState | null): void {
    if (this._listeners.size === 0) return;
    const ev: KernelChangeEvent = Object.freeze({ type, id, state, at: this._nowSafe() });
    for (const l of [...this._listeners]) {
      try { l(ev); } catch { /* listener izole — kernel çökmez */ }
    }
  }

  private _publish(name: string, payload: Record<string, unknown>): void {
    if (!this._publisher) return;                          // Event Bus yoksa lifecycle sürer
    try { this._publisher.publishName(name, payload, { domain: 'platform', source: 'platform_kernel' }); } catch { /* publish hatası izole */ }
  }

  /* ── Reset / Dispose ───────────────────────────────────────────────────── */

  reset(): void {
    if (this._disposed) return;
    this._clearTimers();
    this._services.clear();
    this._runtimeStarted = false;
    this._emit('reset', null, null);
  }

  /** Zero-leak: timer'ları + dinleyicileri bırakır; kayıtlı servisleri policy'ye göre dispose eder.
   * Shared external dependency'leri (capabilities/publisher) dispose ETMEZ. */
  dispose(): void {
    if (this._disposed) return;
    this._clearTimers();
    for (const e of [...this._services.values()].reverse()) {
      if (typeof e.service.dispose === 'function') { try { void e.service.dispose(); } catch { /* izole */ } }
    }
    this._services.clear();
    this._listeners.clear();
    this._disposed = true;
  }

  private _clearTimers(): void {
    for (const t of this._activeTimers) { try { clearTimeout(t); } catch { /* */ } }
    this._activeTimers.clear();
  }
}

/**
 * Fabrika — DI ile örnek üretir. YAN ETKİSİZ: servis çağrılmaz, timer/abonelik açılmaz
 * (yalnız açık lifecycle çağrılarında) → import edilmesi davranış değiştirmez. SINGLETON YOK.
 */
export function createPlatformKernel(deps: PlatformKernelDeps = {}): PlatformKernel {
  return new PlatformKernel(deps);
}
