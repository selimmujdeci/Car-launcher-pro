/**
 * Traffic Intelligence — In-Memory LRU Cache
 *
 * Segment trafik durumlarını ve saatlik tahminleri bellekte tutar.
 * Disk I/O yoktur — uçucu veri için tasarlanmıştır.
 *
 * Özellikler:
 *  - LRU eviction: kapasite aşılınca en eski giriş atılır
 *  - TTL: süresi dolan girişler okumada null döner
 *  - dispose(): tüm veriyi temizler (unmount / HMR için)
 */

import type { SegmentTrafficState, HourlyPrediction } from './trafficTypes';

/* ── LRU Node ────────────────────────────────────────────────── */

interface LRUNode<V> {
  key:      string;
  value:    V;
  /** Verinin geçerli olduğu son epoch ms */
  expiresMs: number;
  prev:     LRUNode<V> | null;
  next:     LRUNode<V> | null;
}

/* ── LRU Cache ───────────────────────────────────────────────── */

class LRUCache<V> {
  private readonly capacity: number;
  private readonly map: Map<string, LRUNode<V>>;
  private head: LRUNode<V> | null = null; // en yeni (MRU)
  private tail: LRUNode<V> | null = null; // en eski (LRU)

  constructor(capacity: number) {
    this.capacity = Math.max(1, capacity);
    this.map      = new Map();
  }

  get(key: string, nowMs = Date.now()): V | null {
    const node = this.map.get(key);
    if (!node) return null;
    if (node.expiresMs > 0 && nowMs > node.expiresMs) {
      this._remove(node);
      return null;
    }
    this._moveToHead(node);
    return node.value;
  }

  set(key: string, value: V, ttlMs: number): void {
    const existing = this.map.get(key);
    if (existing) {
      existing.value     = value;
      existing.expiresMs = ttlMs > 0 ? Date.now() + ttlMs : 0;
      this._moveToHead(existing);
      return;
    }

    const node: LRUNode<V> = {
      key,
      value,
      expiresMs: ttlMs > 0 ? Date.now() + ttlMs : 0,
      prev: null,
      next: null,
    };

    this.map.set(key, node);
    this._addToHead(node);

    if (this.map.size > this.capacity) {
      const evicted = this._removeTail();
      if (evicted) this.map.delete(evicted.key);
    }
  }

  has(key: string, nowMs = Date.now()): boolean {
    return this.get(key, nowMs) !== null;
  }

  delete(key: string): void {
    const node = this.map.get(key);
    if (!node) return;
    this._remove(node);
  }

  clear(): void {
    this.map.clear();
    this.head = null;
    this.tail = null;
  }

  get size(): number { return this.map.size; }

  /* ── Doubly-linked list helpers ──────────────────────────── */

  private _addToHead(node: LRUNode<V>): void {
    node.prev = null;
    node.next = this.head;
    if (this.head) this.head.prev = node;
    this.head = node;
    if (!this.tail) this.tail = node;
  }

  private _remove(node: LRUNode<V>): void {
    if (node.prev) node.prev.next = node.next;
    else           this.head      = node.next;
    if (node.next) node.next.prev = node.prev;
    else           this.tail      = node.prev;
    node.prev = null;
    node.next = null;
    this.map.delete(node.key);
  }

  private _moveToHead(node: LRUNode<V>): void {
    if (this.head === node) return;
    this._remove(node);
    this.map.set(node.key, node);
    this._addToHead(node);
  }

  private _removeTail(): LRUNode<V> | null {
    const tail = this.tail;
    if (!tail) return null;
    this._remove(tail);
    this.map.set(tail.key, tail); // _remove siler, biz zaten üstte sileceğiz
    this.map.delete(tail.key);
    return tail;
  }
}

/* ── Cache sabitleri ─────────────────────────────────────────── */

/** Segment trafik durumunu kaç ms saklarız (canlı veri: 3 dk) */
const SEGMENT_TTL_MS   = 3 * 60 * 1_000;

/** Saatlik tahmin kaç ms saklarız (6 saat — değişmez veri) */
const PREDICTION_TTL_MS = 6 * 60 * 60 * 1_000;

/** Maksimum kaç segment state tutulur */
const SEGMENT_CAPACITY  = 200;

/** Maksimum kaç saatlik tahmin tutulur */
const PREDICTION_CAPACITY = 500;

/* ── Singleton cache instance'ları ──────────────────────────── */

const _segmentCache    = new LRUCache<SegmentTrafficState>(SEGMENT_CAPACITY);
const _predictionCache = new LRUCache<HourlyPrediction>(PREDICTION_CAPACITY);

/* ── Public API — segment state ──────────────────────────────── */

export function getCachedSegment(segmentId: string): SegmentTrafficState | null {
  return _segmentCache.get(segmentId);
}

export function setCachedSegment(state: SegmentTrafficState): void {
  _segmentCache.set(state.segmentId, state, SEGMENT_TTL_MS);
}

export function deleteCachedSegment(segmentId: string): void {
  _segmentCache.delete(segmentId);
}

/* ── Public API — hourly predictions ────────────────────────── */

function _predictionKey(segmentId: string, dayOfWeek: number, hour: number): string {
  return `${segmentId}:${dayOfWeek}:${hour}`;
}

export function getCachedPrediction(
  segmentId: string,
  dayOfWeek: number,
  hour:      number,
): HourlyPrediction | null {
  return _predictionCache.get(_predictionKey(segmentId, dayOfWeek, hour));
}

export function setCachedPrediction(prediction: HourlyPrediction): void {
  const key = _predictionKey(
    prediction.segmentId,
    prediction.dayOfWeek,
    prediction.hour,
  );
  _predictionCache.set(key, prediction, PREDICTION_TTL_MS);
}

/* ── Diagnostics ─────────────────────────────────────────────── */

export function getCacheStats(): { segments: number; predictions: number } {
  return {
    segments:    _segmentCache.size,
    predictions: _predictionCache.size,
  };
}

/* ── Cleanup ─────────────────────────────────────────────────── */

/**
 * Tüm cache'i temizle.
 * App unmount / HMR sırasında çağrılır.
 */
export function disposeTrafficCache(): void {
  _segmentCache.clear();
  _predictionCache.clear();
}

/* ── HMR cleanup ─────────────────────────────────────────────── */

if (import.meta.hot) {
  import.meta.hot.dispose(() => disposeTrafficCache());
}
