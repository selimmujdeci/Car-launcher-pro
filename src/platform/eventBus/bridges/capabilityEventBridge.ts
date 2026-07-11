/**
 * capabilityEventBridge — Capability Registry değişikliklerini Platform Event Bus'a
 * aktaran SALT-OKUNUR köprü — FOUNDATION.
 *
 * KÖPRÜ: (Capability Registry değişimi) → PlatformEvent (`capability.*`). Yalnız bu.
 *
 * ⚠️ KOD GERÇEĞİ (salt-okunur analiz): `CapabilityRegistry.subscribe(listener)` listener'a
 * yalnız `{type, id, revision, at}` (registered/updated/removed/reset) verir — record'un
 * KENDİSİNİ vermez. Köprü record'u `getCapability(id)` ile ÇEKER. Full registry snapshot
 * Event Bus'a TAŞINMAZ; `capability.snapshot.changed` yalnız {revision, sayımlar, changedIds}
 * taşır. Sayımlar başlangıçta BİR KEZ `createSnapshot()` ile tohumlanır, sonra INCREMENTAL
 * (O(1), değişiklik başına full snapshot allocation YOK).
 *
 * YAYINLANAN EVENT'LER:
 *  - `capability.record.registered` → yeni record (getCapability payload).
 *  - `capability.record.changed`    → record değişince (imza-dedup: aynıysa event YOK).
 *  - `capability.record.removed`    → {id}.
 *  - `capability.snapshot.changed`  → RETAINED, küçük payload {revision, counts, changedIds(bounded)}.
 *
 * NE YAPMAZ (bilinçli): Registry KARAR KURALLARINI değiştirmez (yalnız taşır) · SystemBoot'a
 * BAĞLANMAZ · provider adapter'ları BAŞLATMAZ · native/SQL/UI YOK · timer/polling YOK.
 * Registry'yi DOĞRUDAN import ETMEZ (yapısal DI) → import YAN ETKİSİZ. Kaynakların SAHİBİ
 * DEĞİL: `dispose()` Registry'yi/Bus'ı dispose ETMEZ, yalnız kendi aboneliğini bırakır.
 *
 * ZERO-LEAK: start/stop/dispose İDEMPOTENT; tek abonelik; dispose sonrası callback no-op.
 * FAIL-SOFT: Registry subscribe hatası / Bus publish hatası / tek bozuk record köprüyü
 * çökertmez; public API throw ETMEZ; publish reddi → `droppedCount`. PRIVACY: record.reason/
 * limitations Registry'ce zaten sanitize; payload'a VIN/MAC/koordinat/ham/anahtar girmez.
 */

import type { PlatformEvent } from '../platformEventBus';

/* ══════════════════════════════════════════════════════════════════════════
 * DI hedefleri (yapısal — CapabilityRegistry / PlatformEventBus uyar)
 * ════════════════════════════════════════════════════════════════════════ */

export interface CapabilityChangeEventLike {
  readonly type: 'registered' | 'updated' | 'removed' | 'reset';
  readonly id: string | null;
  readonly revision: number;
  readonly at: number;
}

/** Registry record (CapabilityRecord alt kümesi — yapısal, salt-okunur). */
export interface CapabilityRecordLike {
  readonly id: string;
  readonly domain: string;
  readonly status: string;
  readonly available: boolean;
  readonly quality: string;
  readonly confidence: number;
  readonly source: string;
  readonly stale: boolean;
  readonly reason: string | null;
  readonly limitations?: readonly string[];
}

export interface CapabilitySnapshotLike {
  readonly revision: number;
  readonly availableCount: number;
  readonly unavailableCount: number;
  readonly unknownCount: number;
  readonly degradedCount: number;
  readonly capabilities: readonly CapabilityRecordLike[];
}

/** Registry kaynağı (DI) — gerçek wiring PR'ı `capabilityRegistry`'yi geçirir. */
export interface CapabilityRegistrySource {
  subscribe: (listener: (event: CapabilityChangeEventLike) => void) => (() => void);
  getCapability: (id: string) => CapabilityRecordLike | null;
  createSnapshot: () => CapabilitySnapshotLike;
}

export interface EventBusPublishTarget {
  publish: (input: {
    name: string;
    payload?: unknown;
    domain?: string;
    source?: string;
    transient?: boolean;
    retained?: boolean;
  }) => PlatformEvent | null;
}

export interface CapabilityEventBridgeDeps {
  readonly registry: CapabilityRegistrySource;
  readonly bus: EventBusPublishTarget;
  readonly now?: () => number;
}

export interface CapabilityEventBridgeStatus {
  readonly started: boolean;
  readonly disposed: boolean;
  readonly publishedCount: number;
  readonly droppedCount: number;
  readonly lastPublishAt: number | null;
}

const MAX_LIMITATIONS = 4;

/* ══════════════════════════════════════════════════════════════════════════
 * Saf yardımcılar
 * ════════════════════════════════════════════════════════════════════════ */

type Bucket = 'available' | 'unavailable' | 'unknown' | 'degraded';

/** createSnapshot ile AYNI kovalama (available/unavailable+unsupported/degraded/diğer). */
function _bucket(status: string): Bucket {
  if (status === 'available') return 'available';
  if (status === 'unavailable' || status === 'unsupported') return 'unavailable';
  if (status === 'degraded') return 'degraded';
  return 'unknown'; // unknown + restricted
}

function _recordSig(r: CapabilityRecordLike): string {
  return `${r.status}|${r.available}|${r.quality}|${r.confidence}|${r.source}|${r.stale}|${r.reason ?? ''}`;
}

/** Record → küçük, güvenli payload (reason/limitations Registry'ce zaten sanitize). */
function _recordPayload(r: CapabilityRecordLike): Record<string, unknown> {
  return {
    id: r.id,
    domain: r.domain,
    status: r.status,
    available: r.available,
    quality: r.quality,
    confidence: typeof r.confidence === 'number' ? r.confidence : 0,
    source: r.source,
    stale: !!r.stale,
    reason: r.reason ?? null,
    limitations: Array.isArray(r.limitations) ? r.limitations.slice(0, MAX_LIMITATIONS) : [],
  };
}

/* ══════════════════════════════════════════════════════════════════════════
 * Köprü
 * ════════════════════════════════════════════════════════════════════════ */

export class CapabilityEventBridge {
  private readonly _registry: CapabilityRegistrySource;
  private readonly _bus: EventBusPublishTarget;
  private readonly _now: () => number;

  private _unsub: (() => void) | null = null;
  private _started = false;
  private _disposed = false;
  private _publishedCount = 0;
  private _droppedCount = 0;
  private _lastPublishAt: number | null = null;

  private readonly _recordState = new Map<string, { sig: string; bucket: Bucket }>();
  private readonly _counts: Record<Bucket, number> = { available: 0, unavailable: 0, unknown: 0, degraded: 0 };
  private _revision = 0;

  constructor(deps: CapabilityEventBridgeDeps) {
    this._registry = deps.registry;
    this._bus = deps.bus;
    this._now = typeof deps.now === 'function' ? deps.now : () => Date.now();
  }

  private _nowSafe(): number {
    try { const n = this._now(); return Number.isFinite(n) ? n : 0; } catch { return 0; }
  }

  /** Registry'ye abone olur + sayımları BİR KEZ tohumlar (SESSİZ — event yok). İDEMPOTENT. */
  start(): void {
    if (this._disposed || this._started) return;
    this._started = true;
    // Başlangıç sayımları — tek seferlik cold-path (createSnapshot); event YAYINLANMAZ.
    try {
      const snap = this._registry.createSnapshot();
      if (snap && Array.isArray(snap.capabilities)) {
        for (const r of snap.capabilities) {
          if (!r || typeof r.id !== 'string') continue;
          const bucket = _bucket(r.status);
          this._recordState.set(r.id, { sig: _recordSig(r), bucket });
          this._counts[bucket]++;
        }
        this._revision = typeof snap.revision === 'number' ? snap.revision : 0;
      }
    } catch { /* fail-soft: boş baseline */ }
    try {
      this._unsub = this._registry.subscribe((ev) => this._onChange(ev));
    } catch {
      this._unsub = null;                          // abonelik kurulamadı → fail-soft
    }
  }

  private _onChange(ev: CapabilityChangeEventLike): void {
    if (this._disposed || !this._started) return;  // dispose/stop sonrası no-op
    if (!ev || typeof ev !== 'object') return;
    if (typeof ev.revision === 'number') this._revision = ev.revision;

    if (ev.type === 'reset') {
      for (const k of Object.keys(this._counts) as Bucket[]) this._counts[k] = 0;
      this._recordState.clear();
      this._publishSnapshot([]);
      return;
    }

    if (typeof ev.id !== 'string') return;

    if (ev.type === 'removed') {
      const prev = this._recordState.get(ev.id);
      if (prev) { this._counts[prev.bucket]--; this._recordState.delete(ev.id); }
      this._publish('capability.record.removed', { id: ev.id });
      this._publishSnapshot([ev.id]);
      return;
    }

    // registered | updated
    let rec: CapabilityRecordLike | null = null;
    try { rec = this._registry.getCapability(ev.id); } catch { rec = null; }
    if (!rec || typeof rec !== 'object') return;    // record yok → fail-soft

    const sig = _recordSig(rec);
    const prev = this._recordState.get(ev.id);
    if (prev && prev.sig === sig) return;           // değişmedi → event YOK (record + snapshot)

    const bucket = _bucket(rec.status);
    if (prev) this._counts[prev.bucket]--;
    this._counts[bucket]++;
    this._recordState.set(ev.id, { sig, bucket });

    const name = ev.type === 'registered' && !prev ? 'capability.record.registered' : 'capability.record.changed';
    this._publish(name, _recordPayload(rec));
    this._publishSnapshot([ev.id]);
  }

  /** capability.snapshot.changed (retained, küçük payload — full registry TAŞINMAZ). */
  private _publishSnapshot(changedCapabilityIds: readonly string[]): void {
    this._publish('capability.snapshot.changed', {
      revision: this._revision,
      availableCount: this._counts.available,
      unavailableCount: this._counts.unavailable,
      unknownCount: this._counts.unknown,
      degradedCount: this._counts.degraded,
      changedCapabilityIds: changedCapabilityIds.slice(0, 8),
    }, { retained: true });
  }

  private _publish(name: string, payload: unknown, opts: { retained?: boolean } = {}): void {
    try {
      const ev = this._bus.publish({ name, payload, domain: 'capability', source: 'capability_registry', retained: opts.retained });
      if (ev) { this._publishedCount++; this._lastPublishAt = this._nowSafe(); }
      else { this._droppedCount++; }
    } catch {
      this._droppedCount++;
    }
  }

  stop(): void {
    if (!this._started) return;
    this._started = false;
    if (this._unsub) { try { this._unsub(); } catch { /* */ } this._unsub = null; }
  }

  getStatus(): CapabilityEventBridgeStatus {
    return Object.freeze({
      started: this._started,
      disposed: this._disposed,
      publishedCount: this._publishedCount,
      droppedCount: this._droppedCount,
      lastPublishAt: this._lastPublishAt,
    });
  }

  getPublishedCount(): number { return this._publishedCount; }
  getDroppedCount(): number { return this._droppedCount; }

  /** Zero-leak: aboneliği bırakır + kilitler. Registry/Bus çağıranındır → dispose EDİLMEZ. */
  dispose(): void {
    if (this._disposed) return;
    this.stop();
    this._recordState.clear();
    this._disposed = true;
  }

  get isDisposed(): boolean { return this._disposed; }
}

/**
 * Fabrika — DI ile örnek üretir. YAN ETKİSİZ: abonelik/Registry okuma yalnız `start()`'ta →
 * import edilmesi davranış değiştirmez. GLOBAL SINGLETON YOK.
 */
export function createCapabilityEventBridge(deps: CapabilityEventBridgeDeps): CapabilityEventBridge {
  return new CapabilityEventBridge(deps);
}
