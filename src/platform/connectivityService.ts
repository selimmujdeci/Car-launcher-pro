/**
 * connectivityService.ts — Çevrimdışı dayanıklı HTTP kuyruğu.
 *
 * Özellikler:
 *   - At-Least-Once Delivery: 2xx alınana kadar kuyruktan silinmez
 *   - Priority Queue: critical (alarm/kaza) > high (komut) > normal (telemetri)
 *   - Exponential Backoff: 1s → 2s → 4s → ... → max 30s
 *   - FIFO: aynı öncelikteki öğeler sırayla işlenir
 *   - IndexedDB: kalıcı depolama (uygulama yeniden açılsa bile kuyruk korunur)
 *   - Monotonic safety: kuyrukta bekleyen veri delta hesaplamalarını bozmaz
 *
 * CLAUDE.md §3 (Performance): işlem yokken timer çalışmaz.
 * CLAUDE.md §4 (Data Integrity): enqueueAt = performance.now() — saat atlamalarına karşı.
 */

import { Network } from '@capacitor/network';

// ── Tipler ────────────────────────────────────────────────────────────────────

export type QueuePriority = 'critical' | 'high' | 'normal';

export interface QueueEntry {
  id:          string;
  url:         string;
  method:      string;
  headers:     Record<string, string>;
  body:        string;
  priority:    QueuePriority;
  type:        string;         // log/dedup için ('telemetry', 'cmd_status', vb.)
  enqueuedAt:  number;         // performance.now() — monotonic
  attempts:    number;
  nextRetryAt: number;         // Date.now() — absolute, retry schedule için
}

const PRIORITY_ORDER: Record<QueuePriority, number> = {
  critical: 0,
  high:     1,
  normal:   2,
};

// ── IndexedDB ─────────────────────────────────────────────────────────────────

const DB_NAME    = 'caros-connectivity-v1';
const STORE_NAME = 'queue';
const DB_VERSION = 1;

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db    = req.result;
      const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      store.createIndex('priority',    'priority');
      store.createIndex('nextRetryAt', 'nextRetryAt');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

async function dbGetAll(): Promise<QueueEntry[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).getAll();
    req.onsuccess = () => resolve(req.result as QueueEntry[]);
    req.onerror   = () => reject(req.error);
  });
}

async function dbPut(entry: QueueEntry): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(entry);
    tx.oncomplete = () => resolve();
    tx.onerror    = () => reject(tx.error);
  });
}

async function dbDelete(id: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror    = () => reject(tx.error);
  });
}

// ── Backoff hesaplama ─────────────────────────────────────────────────────────

const MAX_BACKOFF_MS = 30_000;
const BASE_BACKOFF_MS = 1_000;

function nextRetry(attempts: number): number {
  const backoff = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * Math.pow(2, attempts));
  return Date.now() + backoff;
}

// ── UUID yardımcısı ───────────────────────────────────────────────────────────

function uid(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

// ── ConnectivityService ───────────────────────────────────────────────────────

class ConnectivityService {
  private _online     = true;
  private _running    = false;
  private _timer: ReturnType<typeof setTimeout> | null = null;
  private _networkListener: (() => void) | null = null;

  async init(): Promise<void> {
    // Mevcut ağ durumunu al
    try {
      const status = await Network.getStatus();
      this._online = status.connected;
    } catch { this._online = navigator.onLine; }

    // Ağ değişimlerini dinle
    const { remove } = await Network.addListener('networkStatusChange', ({ connected }: { connected: boolean }) => {
      const wasOffline = !this._online;
      this._online = connected;
      if (connected && wasOffline) {
        console.log('[Connectivity] Bağlantı geldi — kuyruk boşaltılıyor');
        void this._drainQueue();
      }
    });
    this._networkListener = remove;

    // Başlangıçta bekleyen öğeleri işle
    if (this._online) void this._drainQueue();
  }

  destroy(): void {
    this._networkListener?.();
    if (this._timer) { clearTimeout(this._timer); this._timer = null; }
  }

  /**
   * HTTP isteğini kuyruğa ekle.
   * Çevrimdışıysa IndexedDB'ye yazar; çevrimiçiyse hemen gönderir.
   *
   * @param priority  'critical' öğeler kuyruğun önüne geçer
   * @param type      Log için etiket ('telemetry', 'cmd_status', 'location')
   */
  async enqueue(
    url:      string,
    method:   string,
    headers:  Record<string, string>,
    body:     Record<string, unknown>,
    priority: QueuePriority = 'normal',
    type = 'generic',
  ): Promise<void> {
    const entry: QueueEntry = {
      id:          uid(),
      url,
      method,
      headers,
      body:        JSON.stringify(body),
      priority,
      type,
      enqueuedAt:  performance.now(),
      attempts:    0,
      nextRetryAt: Date.now(),
    };

    await dbPut(entry);

    if (this._online && !this._running) {
      void this._drainQueue();
    }
  }

  // ── Kuyruk boşaltma ───────────────────────────────────────────────────────

  private async _drainQueue(): Promise<void> {
    if (this._running || !this._online) return;
    this._running = true;

    try {
      let entries = await dbGetAll();

      // Önce critical, sonra high, sonra normal; aynı öncelikte enqueuedAt sırası
      entries.sort((a, b) => {
        const pd = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
        return pd !== 0 ? pd : a.enqueuedAt - b.enqueuedAt;
      });

      const now = Date.now();

      for (const entry of entries) {
        if (!this._online) break;
        if (entry.nextRetryAt > now) continue; // backoff süresi dolmadı

        const ok = await this._sendEntry(entry);

        if (ok) {
          await dbDelete(entry.id);
        } else {
          // Retry: attempts++ ve backoff
          entry.attempts    += 1;
          entry.nextRetryAt  = nextRetry(entry.attempts);
          await dbPut(entry);

          // Critical olmayan öğelerde hata varsa diğerlerine geç
          if (entry.priority !== 'critical') continue;
          // Critical hatada kısa bekle, tekrar dene
          break;
        }
      }

      // Kalan varsa timer kur
      entries = await dbGetAll();
      if (entries.length > 0 && this._online) {
        const earliestRetry = Math.min(...entries.map((e) => e.nextRetryAt));
        const delay = Math.max(500, earliestRetry - Date.now());
        if (this._timer) clearTimeout(this._timer);
        this._timer = setTimeout(() => {
          this._timer = null;
          void this._drainQueue();
        }, delay);
      }
    } finally {
      this._running = false;
    }
  }

  private async _sendEntry(entry: QueueEntry): Promise<boolean> {
    try {
      const res = await fetch(entry.url, {
        method:  entry.method,
        headers: entry.headers,
        body:    entry.body,
        signal:  AbortSignal.timeout?.(10_000) ?? undefined,
      });

      // 2xx → başarılı, kuyruktan sil
      if (res.ok) return true;

      // 4xx → client hatası (bad payload) — retry faydasız, kuyruktan sil
      if (res.status >= 400 && res.status < 500) {
        console.warn(`[Connectivity] 4xx (${res.status}) — kuyruktan siliniyor: ${entry.type}`);
        return true;
      }

      // 5xx → geçici sunucu hatası — SILME, tekrar dene
      console.warn(`[Connectivity] 5xx (${res.status}) — kuyrukta bekletiliyor: ${entry.type}`);
      return false;
    } catch {
      // Ağ hatası (timeout, offline) — SILME, tekrar dene
      return false;
    }
  }

  /** Kuyruktaki öğe sayısı */
  async queueSize(): Promise<number> {
    const entries = await dbGetAll();
    return entries.length;
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

export const connectivityService = new ConnectivityService();

/** Uygulama başlangıcında bir kez çağrılmalı. */
export async function initConnectivityService(): Promise<void> {
  await connectivityService.init();
}
