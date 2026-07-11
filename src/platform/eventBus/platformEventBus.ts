/**
 * platformEventBus — CarOS Pro Platform Event Bus — FOUNDATION.
 *
 * AMAÇ: Platform modüllerinin birbirini DOĞRUDAN çağırması yerine tip-güvenli, bounded,
 * fail-soft, performans-duyarlı ve İZOLE bir olay omurgası üzerinden haberleşmesini sağlar.
 * İleride Vehicle HAL · Capability Registry · Deep Scan · Vehicle Brain · Navigation ·
 * Eagle Eye · Health · Companion AI · Assistant Context · Remote · Fleet · Vision · Media ·
 * Platform Kernel · Plugin Runtime · OEM modülleri bunun üstünden konuşacak.
 *
 * ⚠️ BUGÜNKÜ DURUM (salt-okunur analiz): Olay/abonelik ≥5 ayrı desende parçalı:
 *  (a) her servis KENDİ `_listeners = new Set`'ini tutuyor (≥40 servis: deepScanRuntimeService,
 *      capabilityRegistry, vehicleHal, deepScanOrchestrator, SafetyBrain, adaptörler…),
 *  (b) DOM `CustomEvent`/`window.dispatchEvent`/`addEventListener` (safeStorage integrity, layout),
 *  (c) Zustand `store.subscribe`, (d) mini-bus'lar (`errorBus`, `VehicleEventHub`),
 *  (e) native plugin listener'ları. ORTAK event-adı standardı YOK, duplicate-suppression her
 *  serviste AYRI. Platform Event Bus bu boşluğu doldurur.
 *
 * NE YAPMAZ (bilinçli — bu PR yalnız FOUNDATION'dır):
 *  - Mevcut event kaynaklarını TAŞIMAZ · gerçek modülleri BAĞLAMAZ (Vehicle HAL/Capability/
 *    Deep Scan event YAYINLAMAZ) · mevcut servis davranışı DEĞİŞMEZ · native/SQL/UI YOK.
 *  - SystemBoot'a BAĞLANMAZ · global singleton OTOMATİK yaratılmaz (yalnız factory/class ile).
 *  - Import YAN ETKİSİZDİR (timer/abonelik/native çağrı yok). Güvenlik KARARI ÜRETMEZ —
 *    yalnız safety olayını TAŞIR (karar sahibi Safety Kernel/Health).
 *
 * ZERO-LEAK: `dispose()` tüm abonelikleri bırakır (timer açılmadığı için başka kaynak yok).
 * FAIL-SOFT: bozuk event reddedilir, public API throw ETMEZ, listener hatası izole. Bounded ·
 * immutable · deterministik dispatch · monotonic sequence · re-entrant/recursion korumalı.
 */

/* ══════════════════════════════════════════════════════════════════════════
 * Model
 * ════════════════════════════════════════════════════════════════════════ */

export type PlatformEventPriority = 'safety' | 'critical' | 'high' | 'normal' | 'low' | 'background';

export type PlatformEventDomain =
  | 'platform' | 'vehicle' | 'capability' | 'deep_scan' | 'health' | 'navigation'
  | 'eagle_eye' | 'ai' | 'assistant' | 'remote' | 'fleet' | 'vision' | 'media'
  | 'security' | 'oem' | 'plugin';

export type PlatformEventSource =
  | 'native' | 'vehicle_hal' | 'capability_registry' | 'deep_scan' | 'vehicle_brain'
  | 'navigation' | 'eagle_eye' | 'assistant' | 'remote' | 'fleet' | 'vision' | 'media'
  | 'platform_kernel' | 'plugin' | 'unknown';

export interface PlatformEvent<T = unknown> {
  readonly id: string;
  readonly name: string;
  readonly domain: PlatformEventDomain;
  readonly source: PlatformEventSource;
  readonly priority: PlatformEventPriority;
  readonly timestamp: number;
  readonly sequence: number;
  readonly payload: T;
  readonly correlationId: string | null;
  readonly causationId: string | null;
  readonly vehicleFingerprintHash: string | null;
  readonly replayable: boolean;
  readonly retained: boolean;
  readonly experimental: boolean;
}

export interface PublishMetadata {
  readonly domain?: PlatformEventDomain;
  readonly source?: PlatformEventSource;
  readonly priority?: PlatformEventPriority;
  readonly correlationId?: string;
  readonly causationId?: string;
  readonly vehicleFingerprintHash?: string;
  readonly retained?: boolean;
  readonly transient?: boolean;
  readonly replayable?: boolean;
  readonly experimental?: boolean;
}

export interface PublishInput<T = unknown> extends PublishMetadata {
  readonly name: string;
  readonly payload?: T;
}

export type PlatformEventListener<T = unknown> = (event: PlatformEvent<T>) => void;

export interface SubscribeOptions {
  readonly priority?: PlatformEventPriority;
  readonly once?: boolean;
  readonly owner?: string;
  /** Son retained event varsa abonelik anında teslim edilsin mi (opt-in). */
  readonly replayLast?: boolean;
}

export interface PlatformEventBusStats {
  readonly publishedCount: number;
  readonly deliveredCount: number;
  readonly droppedCount: number;
  readonly listenerErrorCount: number;
  readonly duplicateSubscriptionCount: number;
  readonly recursionDropCount: number;
  readonly activeListenerCount: number;
  readonly retainedEventCount: number;
  readonly historyCount: number;
  readonly lastEventAt: number | null;
}

export interface EventCatalogEntry {
  readonly name: string;
  readonly domain: PlatformEventDomain;
  readonly priority: PlatformEventPriority;
  readonly retained?: boolean;
  readonly transient?: boolean;
  readonly replayable?: boolean;
  readonly experimental?: boolean;
}

export interface EventBusLimits {
  readonly maxEventNames: number;
  readonly maxListeners: number;
  readonly maxListenersPerEvent: number;
  readonly maxDomainListeners: number;
  readonly maxHistory: number;
  readonly maxPublishDepth: number;
  readonly maxRetained: number;
}

export interface PlatformEventBusDeps {
  readonly now?: () => number;
  readonly limits?: Partial<EventBusLimits>;
  readonly catalog?: readonly EventCatalogEntry[];
}

export interface RecentEventFilter {
  readonly name?: string;
  readonly domain?: PlatformEventDomain;
  readonly priority?: PlatformEventPriority;
}

/* ══════════════════════════════════════════════════════════════════════════
 * Sabitler
 * ════════════════════════════════════════════════════════════════════════ */

export const DEFAULT_EVENT_BUS_LIMITS: EventBusLimits = Object.freeze({
  maxEventNames: 256,
  maxListeners: 512,
  maxListenersPerEvent: 64,
  maxDomainListeners: 32,
  maxHistory: 256,
  maxPublishDepth: 16,
  maxRetained: 32,
});

const PRIORITY_RANK: Readonly<Record<PlatformEventPriority, number>> = {
  safety: 0, critical: 1, high: 2, normal: 3, low: 4, background: 5,
};
const PRIORITY_ORDER: readonly PlatformEventPriority[] = ['safety', 'critical', 'high', 'normal', 'low', 'background'];

const VALID_DOMAINS: ReadonlySet<string> = new Set<PlatformEventDomain>([
  'platform', 'vehicle', 'capability', 'deep_scan', 'health', 'navigation', 'eagle_eye',
  'ai', 'assistant', 'remote', 'fleet', 'vision', 'media', 'security', 'oem', 'plugin',
]);
const VALID_SOURCES: ReadonlySet<string> = new Set<PlatformEventSource>([
  'native', 'vehicle_hal', 'capability_registry', 'deep_scan', 'vehicle_brain', 'navigation',
  'eagle_eye', 'assistant', 'remote', 'fleet', 'vision', 'media', 'platform_kernel', 'plugin', 'unknown',
]);
const VALID_PRIORITIES: ReadonlySet<string> = new Set<PlatformEventPriority>(PRIORITY_ORDER);

/** Event adı standardı: domain.entity.action (küçük harf, alt çizgi, nokta). */
const EVENT_NAME_RE = /^[a-z_]+\.[a-z_]+\.[a-z_]+$/;

const MAX_TEXT_CHARS = 64;
const MAX_SUMMARY_KEYS = 12;
const FREEZE_MAX_DEPTH = 4;

/* ══════════════════════════════════════════════════════════════════════════
 * İlk event kataloğu (isim standardı + type contract — GERÇEK modüle BAĞLI DEĞİL)
 * ════════════════════════════════════════════════════════════════════════ */

export const DEFAULT_EVENT_CATALOG: readonly EventCatalogEntry[] = Object.freeze([
  // Platform
  { name: 'platform.runtime.started', domain: 'platform', priority: 'critical', retained: true },
  { name: 'platform.runtime.stopped', domain: 'platform', priority: 'critical' },
  { name: 'platform.runtime.degraded', domain: 'platform', priority: 'high', retained: true },
  { name: 'platform.service.started', domain: 'platform', priority: 'normal' },
  { name: 'platform.service.stopped', domain: 'platform', priority: 'normal' },
  { name: 'platform.service.failed', domain: 'platform', priority: 'high' },
  // Vehicle
  { name: 'vehicle.connection.changed', domain: 'vehicle', priority: 'high', retained: true },
  { name: 'vehicle.ignition.changed', domain: 'vehicle', priority: 'high', retained: true },
  { name: 'vehicle.signal.changed', domain: 'vehicle', priority: 'high', transient: true },
  { name: 'vehicle.identity.changed', domain: 'vehicle', priority: 'normal', retained: true },
  { name: 'vehicle.health.changed', domain: 'vehicle', priority: 'high' },
  // Capability
  { name: 'capability.record.registered', domain: 'capability', priority: 'low' },
  { name: 'capability.record.changed', domain: 'capability', priority: 'low' },
  { name: 'capability.record.removed', domain: 'capability', priority: 'low' },
  { name: 'capability.snapshot.changed', domain: 'capability', priority: 'normal', retained: true },
  // Deep Scan
  { name: 'deep_scan.scan.started', domain: 'deep_scan', priority: 'normal' },
  { name: 'deep_scan.phase.started', domain: 'deep_scan', priority: 'normal' },
  { name: 'deep_scan.phase.completed', domain: 'deep_scan', priority: 'normal' },
  { name: 'deep_scan.phase.failed', domain: 'deep_scan', priority: 'high' },
  { name: 'deep_scan.scan.completed', domain: 'deep_scan', priority: 'normal' },
  { name: 'deep_scan.scan.failed', domain: 'deep_scan', priority: 'high' },
  { name: 'deep_scan.scan.cancelled', domain: 'deep_scan', priority: 'normal' },
  { name: 'deep_scan.report.ready', domain: 'deep_scan', priority: 'normal' },
  // Health
  { name: 'health.condition.warning', domain: 'health', priority: 'high' },
  { name: 'health.condition.critical', domain: 'health', priority: 'safety' },
  { name: 'health.thermal.changed', domain: 'health', priority: 'high', retained: true },
  { name: 'health.power.changed', domain: 'health', priority: 'high', retained: true },
  // Navigation
  { name: 'navigation.route.started', domain: 'navigation', priority: 'normal' },
  { name: 'navigation.route.changed', domain: 'navigation', priority: 'normal' },
  { name: 'navigation.route.completed', domain: 'navigation', priority: 'normal' },
  { name: 'navigation.reroute.requested', domain: 'navigation', priority: 'high' },
  // Eagle Eye
  { name: 'eagle_eye.hazard.detected', domain: 'eagle_eye', priority: 'safety' },
  { name: 'eagle_eye.hazard.updated', domain: 'eagle_eye', priority: 'high' },
  { name: 'eagle_eye.hazard.cleared', domain: 'eagle_eye', priority: 'normal' },
  // Assistant
  { name: 'assistant.context.changed', domain: 'assistant', priority: 'low', transient: true },
  { name: 'assistant.request.received', domain: 'assistant', priority: 'normal' },
  { name: 'assistant.response.ready', domain: 'assistant', priority: 'normal' },
  { name: 'assistant.safety.blocked', domain: 'assistant', priority: 'safety' },
  // Remote
  { name: 'remote.command.received', domain: 'remote', priority: 'high' },
  { name: 'remote.command.authorized', domain: 'remote', priority: 'high' },
  { name: 'remote.command.executed', domain: 'remote', priority: 'high' },
  { name: 'remote.command.failed', domain: 'remote', priority: 'high' },
  // Fleet
  { name: 'fleet.vehicle.status_changed', domain: 'fleet', priority: 'normal' },
  { name: 'fleet.alert.created', domain: 'fleet', priority: 'high' },
]);

/* ══════════════════════════════════════════════════════════════════════════
 * Saf yardımcılar
 * ════════════════════════════════════════════════════════════════════════ */

function _text(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v
    .replace(/\b(?:sk|pk|api|key|token|bearer)[-_]?[A-Za-z0-9_-]{12,}\b/gi, '[redacted]') // secret önce
    .replace(/\b(?:[0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}\b/g, '[redacted]')                 // MAC
    .replace(/\b[A-HJ-NPR-Z0-9]{17}\b/g, '[redacted]')                                     // VIN (17)
    .replace(/-?\d{1,3}\.\d{4,}\s*[,;]\s*-?\d{1,3}\.\d{4,}/g, '[redacted]')                 // koordinat
    .replace(/\b[0-9A-Fa-f]{8,}\b/g, '[redacted]')                                         // ham hex (CAN frame) en son
    .trim();
  const c = s.length > MAX_TEXT_CHARS ? s.slice(0, MAX_TEXT_CHARS) : s;
  return c || null;
}

/** Fingerprint hash — HAM VIN reddedilir (17 karakter), yalnız 8–64 hex anonim hash. */
function _fingerprint(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (s.length === 17) return null;
  if (!/^[0-9a-fA-F]{8,64}$/.test(s)) return null;
  return s.toLowerCase();
}

function _domain(v: unknown): PlatformEventDomain | null {
  return typeof v === 'string' && VALID_DOMAINS.has(v) ? (v as PlatformEventDomain) : null;
}
function _source(v: unknown): PlatformEventSource {
  return typeof v === 'string' && VALID_SOURCES.has(v) ? (v as PlatformEventSource) : 'unknown';
}
function _priority(v: unknown): PlatformEventPriority | null {
  return typeof v === 'string' && VALID_PRIORITIES.has(v) ? (v as PlatformEventPriority) : null;
}

/** Adın ilk parçasından domain türet (bilinmeyen event için). */
function _deriveDomain(name: string): PlatformEventDomain {
  const head = name.split('.')[0];
  return VALID_DOMAINS.has(head) ? (head as PlatformEventDomain) : 'platform';
}

/** Bounded derinlikte derin dondurma (küçük payload varsayımı). */
function _deepFreeze<T>(v: T, depth = 0): T {
  if (v === null || typeof v !== 'object' || depth >= FREEZE_MAX_DEPTH) return v;
  if (Object.isFrozen(v)) return v;
  Object.freeze(v);
  for (const val of Object.values(v as Record<string, unknown>)) _deepFreeze(val, depth + 1);
  return v;
}

/** History için gizlilik-güvenli KÜÇÜK özet (yalnız primitif üst alanlar, string sanitize). */
function _payloadSummary(payload: unknown): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  if (!payload || typeof payload !== 'object') {
    if (typeof payload === 'number' || typeof payload === 'boolean') out.value = payload;
    else if (typeof payload === 'string') { const t = _text(payload); if (t) out.value = t; }
    return out;
  }
  let n = 0;
  for (const [k, val] of Object.entries(payload as Record<string, unknown>)) {
    if (n >= MAX_SUMMARY_KEYS) break;
    if (typeof val === 'number' && Number.isFinite(val)) { out[k] = val; n++; }
    else if (typeof val === 'boolean') { out[k] = val; n++; }
    else if (typeof val === 'string') { const t = _text(val); if (t) { out[k] = t; n++; } }
  }
  return out;
}

interface PendingEntry {
  readonly event: PlatformEvent;
  readonly transient: boolean;
  readonly depth: number;
}

interface Subscription {
  readonly id: string;
  readonly seq: number;
  readonly eventName: string | null;
  readonly domain: PlatformEventDomain | null;
  readonly priority: PlatformEventPriority;
  once: boolean;
  active: boolean;
  readonly createdAt: number;
  readonly owner: string | null;
  readonly listener: PlatformEventListener;
}

/* ══════════════════════════════════════════════════════════════════════════
 * Platform Event Bus
 * ════════════════════════════════════════════════════════════════════════ */

export class PlatformEventBus {
  private readonly _now: () => number;
  private readonly _limits: EventBusLimits;
  private readonly _catalog = new Map<string, EventCatalogEntry>();

  private readonly _nameSubs = new Map<string, Subscription[]>();
  private readonly _domainSubs = new Map<PlatformEventDomain, Subscription[]>();
  private readonly _subById = new Map<string, Subscription>();
  private readonly _retained = new Map<string, PlatformEvent>();
  private readonly _seenNames = new Set<string>();
  private _history: PlatformEvent[] = [];

  /** Öncelikli bekleyen kuyruk (re-entrant publish burada birikir). */
  private readonly _pending: Record<PlatformEventPriority, PendingEntry[]> = {
    safety: [], critical: [], high: [], normal: [], low: [], background: [],
  };
  private _dispatching = false;
  private _currentDepth = 0;

  private _sequence = 0;
  private _subSeq = 0;
  private _idCounter = 0;
  private _disposed = false;

  private _stats = {
    publishedCount: 0, deliveredCount: 0, droppedCount: 0, listenerErrorCount: 0,
    duplicateSubscriptionCount: 0, recursionDropCount: 0, lastEventAt: null as number | null,
  };

  constructor(deps: PlatformEventBusDeps = {}) {
    this._now = typeof deps.now === 'function' ? deps.now : () => Date.now();
    this._limits = { ...DEFAULT_EVENT_BUS_LIMITS, ...(deps.limits ?? {}) };
    const catalog = deps.catalog ?? DEFAULT_EVENT_CATALOG;
    for (const e of catalog) {
      if (e && typeof e.name === 'string' && EVENT_NAME_RE.test(e.name) && this._seenNames.size < this._limits.maxEventNames) {
        this._catalog.set(e.name, e);
        this._seenNames.add(e.name);
      }
    }
  }

  /* ── Dahili ──────────────────────────────────────────────────────────── */

  private _nowSafe(): number {
    try { const n = this._now(); return Number.isFinite(n) ? n : 0; } catch { return 0; }
  }

  private _totalListeners(): number {
    return this._subById.size;
  }

  /* ── Publish ─────────────────────────────────────────────────────────── */

  publish<T = unknown>(input: PublishInput<T>): PlatformEvent<T> | null {
    if (this._disposed) return null;
    if (!input || typeof input !== 'object' || typeof input.name !== 'string' || !EVENT_NAME_RE.test(input.name)) {
      this._stats.droppedCount++;
      return null;
    }
    // Recursion/depth koruması.
    const depth = this._dispatching ? this._currentDepth + 1 : 0;
    if (depth > this._limits.maxPublishDepth) {
      this._stats.recursionDropCount++;
      this._stats.droppedCount++;
      return null;
    }
    // Yeni bilinmeyen ad tavanı.
    if (!this._seenNames.has(input.name)) {
      if (this._seenNames.size >= this._limits.maxEventNames) { this._stats.droppedCount++; return null; }
      this._seenNames.add(input.name);
    }

    const cat = this._catalog.get(input.name);
    const now = this._nowSafe();
    const event: PlatformEvent<T> = Object.freeze({
      id: `evt-${++this._idCounter}`,
      name: input.name,
      domain: _domain(input.domain) ?? cat?.domain ?? _deriveDomain(input.name),
      source: _source(input.source),
      priority: _priority(input.priority) ?? cat?.priority ?? 'normal',
      timestamp: now,
      sequence: ++this._sequence,           // MONOTONİK (saat geriye gitse bile artar)
      payload: _deepFreeze(input.payload as T),
      correlationId: _text(input.correlationId),
      causationId: _text(input.causationId),
      vehicleFingerprintHash: _fingerprint(input.vehicleFingerprintHash),
      replayable: input.replayable ?? cat?.replayable ?? false,
      retained: input.retained ?? cat?.retained ?? false,
      experimental: input.experimental ?? cat?.experimental ?? false,
    });
    // transient bayrağı (katalog veya metadata) — history dışı.
    const transient = input.transient ?? cat?.transient ?? false;

    this._stats.publishedCount++;
    this._stats.lastEventAt = now;

    // Retained (bounded).
    if (event.retained) this._retain(event);

    // Kuyruğa al + drain.
    this._pending[event.priority].push({ event, transient, depth });
    if (!this._dispatching) this._drain();
    return event;
  }

  publishName<T = unknown>(name: string, payload?: T, metadata?: PublishMetadata): PlatformEvent<T> | null {
    return this.publish<T>({ name, payload, ...(metadata ?? {}) });
  }

  private _retain(event: PlatformEvent): void {
    if (!this._retained.has(event.name) && this._retained.size >= this._limits.maxRetained) return; // bounded
    this._retained.set(event.name, event);
  }

  private _takeNext(): PendingEntry | null {
    for (const p of PRIORITY_ORDER) {
      const q = this._pending[p];
      if (q.length > 0) return q.shift()!;   // safety önce; aynı öncelikte FIFO (sequence sırası)
    }
    return null;
  }

  private _drain(): void {
    this._dispatching = true;
    try {
      let guard = 0;
      const hardCap = this._limits.maxEventNames * this._limits.maxListenersPerEvent + 1024;
      let entry = this._takeNext();
      while (entry !== null) {
        if (++guard > hardCap) { this._stats.recursionDropCount++; break; } // sonsuz zincir kırıcı
        this._currentDepth = entry.depth;
        this._dispatchOne(entry.event);
        this._recordHistory(entry.event, entry.transient);
        entry = this._takeNext();
      }
    } finally {
      this._currentDepth = 0;
      this._dispatching = false;
    }
  }

  private _dispatchOne(event: PlatformEvent): void {
    const nameSubs = this._nameSubs.get(event.name) ?? [];
    const domainSubs = this._domainSubs.get(event.domain) ?? [];
    // Deterministik: önce yüksek subscription önceliği, sonra kayıt sırası (seq).
    const targets = [...nameSubs, ...domainSubs]
      .filter((s) => s.active)
      .sort((a, b) => (PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]) || (a.seq - b.seq));

    const toRemove: Subscription[] = [];
    for (const sub of targets) {
      if (!sub.active) continue;
      try {
        sub.listener(event);
        this._stats.deliveredCount++;
      } catch (err) {
        this._stats.listenerErrorCount++;      // izole — safety dahil diğer listener'lar engellenmez
        console.error(`[PlatformEventBus] listener hatası (${event.name}) — servis etkilenmedi`, err);
      }
      if (sub.once) { sub.active = false; toRemove.push(sub); }
    }
    for (const sub of toRemove) this._removeSub(sub.id);
  }

  private _recordHistory(event: PlatformEvent, transient: boolean): void {
    if (transient) return; // transient → history dışı
    try {
      const entry = Object.freeze({ ...event, payload: Object.freeze(_payloadSummary(event.payload)) });
      this._history.push(entry);
      if (this._history.length > this._limits.maxHistory) this._evictHistory();
    } catch { /* history yazma hatası publish'i engellemez */ }
  }

  /** Öncelik-duyarlı eviction: background→low→…→safety; aynı öncelikte en eski önce. */
  private _evictHistory(): void {
    const over = this._history.length - this._limits.maxHistory;
    if (over <= 0) return;
    for (let removed = 0; removed < over;) {
      let victimIdx = -1; let victimRank = -1; let victimSeq = Infinity;
      for (let i = 0; i < this._history.length; i++) {
        const e = this._history[i];
        const rank = PRIORITY_RANK[e.priority];       // yüksek rank sayı = düşük öncelik → önce silinir
        if (rank > victimRank || (rank === victimRank && e.sequence < victimSeq)) {
          victimRank = rank; victimSeq = e.sequence; victimIdx = i;
        }
      }
      if (victimIdx < 0) break;
      this._history.splice(victimIdx, 1);
      removed++;
    }
  }

  /* ── Subscribe ───────────────────────────────────────────────────────── */

  subscribe<T = unknown>(eventName: string, listener: PlatformEventListener<T>, options: SubscribeOptions = {}): string | null {
    if (this._disposed || typeof eventName !== 'string' || !EVENT_NAME_RE.test(eventName) || typeof listener !== 'function') return null;
    return this._addSub(eventName, null, listener as PlatformEventListener, options);
  }

  subscribeDomain<T = unknown>(domain: PlatformEventDomain, listener: PlatformEventListener<T>, options: SubscribeOptions = {}): string | null {
    if (this._disposed || !VALID_DOMAINS.has(domain) || typeof listener !== 'function') return null;
    return this._addSub(null, domain, listener as PlatformEventListener, options);
  }

  once<T = unknown>(eventName: string, listener: PlatformEventListener<T>, options: SubscribeOptions = {}): string | null {
    return this.subscribe(eventName, listener, { ...options, once: true });
  }

  private _addSub(
    eventName: string | null, domain: PlatformEventDomain | null,
    listener: PlatformEventListener, options: SubscribeOptions,
  ): string | null {
    const bucket = eventName !== null ? (this._nameSubs.get(eventName) ?? []) : (this._domainSubs.get(domain!) ?? []);
    // Duplicate: aynı listener + aynı hedef → yeni oluşturma.
    const dup = bucket.find((s) => s.listener === listener && s.active);
    if (dup) { this._stats.duplicateSubscriptionCount++; return dup.id; }
    // Bounded.
    if (this._totalListeners() >= this._limits.maxListeners) return null;
    if (eventName !== null && bucket.length >= this._limits.maxListenersPerEvent) return null;
    if (domain !== null && bucket.length >= this._limits.maxDomainListeners) return null;

    const sub: Subscription = {
      id: `sub-${++this._idCounter}`,
      seq: ++this._subSeq,
      eventName, domain,
      priority: _priority(options.priority) ?? 'normal',
      once: options.once === true,
      active: true,
      createdAt: this._nowSafe(),
      owner: _text(options.owner),
      listener,
    };
    bucket.push(sub);
    if (eventName !== null) this._nameSubs.set(eventName, bucket); else this._domainSubs.set(domain!, bucket);
    this._subById.set(sub.id, sub);

    // replayLast (opt-in): son retained event varsa hemen teslim et.
    if (options.replayLast === true && eventName !== null) {
      const retained = this._retained.get(eventName);
      if (retained) { try { listener(retained); this._stats.deliveredCount++; } catch { this._stats.listenerErrorCount++; } }
    }
    return sub.id;
  }

  unsubscribe(subscriptionId: string): boolean {
    return this._removeSub(subscriptionId);
  }

  private _removeSub(id: string): boolean {
    const sub = this._subById.get(id);
    if (!sub) return false;                 // idempotent
    sub.active = false;
    this._subById.delete(id);
    const bucket = sub.eventName !== null ? this._nameSubs.get(sub.eventName) : (sub.domain !== null ? this._domainSubs.get(sub.domain) : undefined);
    if (bucket) {
      const idx = bucket.indexOf(sub);
      if (idx >= 0) bucket.splice(idx, 1);
    }
    return true;
  }

  hasSubscribers(eventName: string): boolean {
    const nameCount = (this._nameSubs.get(eventName)?.filter((s) => s.active).length) ?? 0;
    if (nameCount > 0) return true;
    const cat = this._catalog.get(eventName);
    const dom = cat?.domain ?? (EVENT_NAME_RE.test(eventName) ? _deriveDomain(eventName) : null);
    if (dom && (this._domainSubs.get(dom)?.some((s) => s.active))) return true;
    return false;
  }

  listenerCount(eventName?: string): number {
    if (eventName === undefined) return this._totalListeners();
    return (this._nameSubs.get(eventName)?.filter((s) => s.active).length) ?? 0;
  }

  /* ── Gözlemlenebilirlik ──────────────────────────────────────────────── */

  getStats(): PlatformEventBusStats {
    return Object.freeze({
      publishedCount: this._stats.publishedCount,
      deliveredCount: this._stats.deliveredCount,
      droppedCount: this._stats.droppedCount,
      listenerErrorCount: this._stats.listenerErrorCount,
      duplicateSubscriptionCount: this._stats.duplicateSubscriptionCount,
      recursionDropCount: this._stats.recursionDropCount,
      activeListenerCount: this._totalListeners(),
      retainedEventCount: this._retained.size,
      historyCount: this._history.length,
      lastEventAt: this._stats.lastEventAt,
    });
  }

  getRecentEvents(filter?: RecentEventFilter): PlatformEvent[] {
    let list = this._history;
    if (filter) {
      list = list.filter((e) =>
        (filter.name === undefined || e.name === filter.name) &&
        (filter.domain === undefined || e.domain === filter.domain) &&
        (filter.priority === undefined || e.priority === filter.priority));
    }
    return list.map((e) => e);   // öğeler zaten frozen
  }

  clearRecentEvents(): void {
    this._history = [];
  }

  /* ── Yaşam döngüsü ───────────────────────────────────────────────────── */

  reset(): void {
    if (this._disposed) return;
    this._nameSubs.clear();
    this._domainSubs.clear();
    this._subById.clear();
    this._retained.clear();
    this._history = [];
    for (const p of PRIORITY_ORDER) this._pending[p] = [];
    this._sequence = 0;
    this._stats = {
      publishedCount: 0, deliveredCount: 0, droppedCount: 0, listenerErrorCount: 0,
      duplicateSubscriptionCount: 0, recursionDropCount: 0, lastEventAt: null,
    };
  }

  dispose(): void {
    if (this._disposed) return;
    this._nameSubs.clear();
    this._domainSubs.clear();
    this._subById.clear();
    this._retained.clear();
    this._history = [];
    for (const p of PRIORITY_ORDER) this._pending[p] = [];
    this._disposed = true;
  }

  get isDisposed(): boolean {
    return this._disposed;
  }
}

/**
 * Fabrika — DI ile örnek üretir. GLOBAL SINGLETON YOK: bus yalnız açıkça bununla (veya
 * `new PlatformEventBus`) oluşturulunca çalışır → import edilmesi hiçbir davranış değiştirmez.
 */
export function createPlatformEventBus(deps: PlatformEventBusDeps = {}): PlatformEventBus {
  return new PlatformEventBus(deps);
}
