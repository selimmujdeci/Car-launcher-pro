/**
 * storage.ts — OFFLINE KUYRUK DEPOLAMA ADAPTÖRÜ.
 *
 * Kuyruk mantığı depolamadan AYRIDIR: tarayıcıda kalıcı (localStorage),
 * testte bellek. Bozuk/okunamayan depo **fail-soft** açılır — uygulama
 * çökmez, kuyruk boş başlar ve bozuk kayıt karantinaya alınır.
 */

export interface QueueStorage {
  read(): Promise<string | null>;
  write(raw: string): Promise<void>;
  clear(): Promise<void>;
}

/** Test ve SSR için bellek deposu (kalıcı değil). */
export class MemoryQueueStorage implements QueueStorage {
  private value: string | null = null;

  async read(): Promise<string | null> {
    return this.value;
  }

  async write(raw: string): Promise<void> {
    this.value = raw;
  }

  async clear(): Promise<void> {
    this.value = null;
  }
}

/**
 * Tarayıcı deposu. Kullanıcı başına ayrı anahtar kullanılır →
 * hesap değişiminde başka kullanıcının kuyruğu OKUNAMAZ.
 */
export class BrowserQueueStorage implements QueueStorage {
  private readonly key: string;

  constructor(namespace: string) {
    this.key = `caros.fleet.queue.${namespace}`;
  }

  private available(): boolean {
    return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
  }

  async read(): Promise<string | null> {
    if (!this.available()) return null;
    try {
      return window.localStorage.getItem(this.key);
    } catch {
      return null; // kota/gizli mod → fail-soft
    }
  }

  async write(raw: string): Promise<void> {
    if (!this.available()) return;
    try {
      window.localStorage.setItem(this.key, raw);
    } catch {
      /* kota dolu → sessizce vazgeç; kuyruk bellekte çalışmaya devam eder */
    }
  }

  async clear(): Promise<void> {
    if (!this.available()) return;
    try {
      window.localStorage.removeItem(this.key);
    } catch {
      /* fail-soft */
    }
  }
}

/** Bozuk kaydı karantinaya alır (teşhis için saklanır, kuyruğa girmez). */
export function quarantineKey(namespace: string): string {
  return `caros.fleet.queue.corrupt.${namespace}`;
}
