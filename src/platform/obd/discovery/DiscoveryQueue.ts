/**
 * DiscoveryQueue — keşif kayıtları için OFFLINE-FIRST, kalıcı, sınırlı FIFO kuyruğu.
 *
 * TASARIM (görev: offline-first, ileride Supabase'e gönderilebilir, ŞİMDİLİK ağ YOK):
 *  - Kayıtlar safeStorage ile atomik/kota-güvenli yazılır (CLAUDE.md — safeStorage zorunlu).
 *  - HİÇBİR ağ çağrısı YOK: bu katman yalnız birikim + kalıcılık. Gelecekte bir "uploader"
 *    drain()/peekAll() ile okuyup Supabase'e gönderecek (bu PR kapsamı dışında, sözleşme hazır).
 *  - Bounded: MAX_QUEUE tavanı; taşınca EN ESKİ kayıt düşürülür (zero-leak, disk sınırı).
 *  - Yazma throttling: safeStorage debounce (yüksek frekanslı diske yazma yasağı — CLAUDE.md).
 *
 * SAF sınıf: yalnız safeStorage util'ine bağımlı; native/React yok.
 */

import { safeSetRaw, safeGetRaw, safeRemoveRaw } from '../../../utils/safeStorage';
import type { DiscoveryRecord } from './discoveryModel';

const STORAGE_KEY = 'obd-discovery-queue';
/** Kalıcı kuyruk tavanı — disk/bellek sınırı (bounded); aşınca en eski düşer. */
const MAX_QUEUE = 500;

export class DiscoveryQueue {
  private _items: DiscoveryRecord[] = [];
  private _loaded = false;
  private readonly storageKey: string;
  private readonly maxQueue: number;

  constructor(storageKey = STORAGE_KEY, maxQueue = MAX_QUEUE) {
    this.storageKey = storageKey;
    this.maxQueue = maxQueue;
  }

  /** İlk erişimde diskten yükler (lazy) — fail-soft: bozuk veri → boş kuyruk. */
  private _ensureLoaded(): void {
    if (this._loaded) return;
    this._loaded = true;
    try {
      const raw = safeGetRaw(this.storageKey);
      if (raw) {
        const parsed: unknown = JSON.parse(raw);
        if (Array.isArray(parsed)) this._items = parsed as DiscoveryRecord[];
      }
    } catch {
      this._items = []; // bozuk JSON → dürüstçe boş başla
    }
  }

  /** Diske yazar (safeStorage debounce — yüksek frekanslı yazma önlenir). */
  private _persist(): void {
    try {
      safeSetRaw(this.storageKey, JSON.stringify(this._items));
    } catch {
      /* kota/serileştirme hatası — bellek kuyruğu korunur, fail-soft */
    }
  }

  /**
   * Kayıt ekler (kuyruğun SONUNA). Tavan aşılırsa en eski (baş) düşürülür.
   * @returns kuyruğun güncel uzunluğu.
   */
  enqueue(record: DiscoveryRecord): number {
    this._ensureLoaded();
    this._items.push(record);
    if (this._items.length > this.maxQueue) {
      this._items.splice(0, this._items.length - this.maxQueue);
    }
    this._persist();
    return this._items.length;
  }

  /** Kuyruktaki tüm kayıtların KOPYASI (dış mutasyona kapalı) — uploader okuma yüzeyi. */
  peekAll(): DiscoveryRecord[] {
    this._ensureLoaded();
    return this._items.slice();
  }

  /** Bekleyen kayıt sayısı. */
  get size(): number {
    this._ensureLoaded();
    return this._items.length;
  }

  /**
   * Kuyruğu boşaltır ve boşaltılan kayıtları döndürür (gelecekteki uploader başarı
   * sonrası çağırır). Şimdilik yalnız yerel tüketiciler kullanır — ağ YOK.
   */
  drain(): DiscoveryRecord[] {
    this._ensureLoaded();
    const out = this._items;
    this._items = [];
    this._persist();
    return out;
  }

  /** Kuyruğu ve kalıcı kaydı tamamen temizler. */
  clear(): void {
    this._items = [];
    this._loaded = true;
    try { safeRemoveRaw(this.storageKey); } catch { /* yoksay */ }
  }
}
