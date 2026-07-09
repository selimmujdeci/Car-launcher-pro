/**
 * DiscoveryCache — keşif kayıtları için HASH-tabanlı, sınırlı (bounded) deduplikasyon.
 *
 * NEDEN: aynı ECU + mode + PID/DID tekrar tekrar gözlemlenir (poll turları); bunları
 * her seferinde kaydetmek kuyruğu/logu şişirir. Cache, bir keşfin FNV-1a kimlik hash'ini
 * tutar → ikinci gözlemi O(1) eler.
 *
 * ZERO-LEAK (CLAUDE.md — sınırlı bellek): hash kümesi SABİT tavanla (maxEntries) sınırlıdır;
 * tavan aşılınca EN ESKİ hash düşürülür (insertion-order, FIFO). Böylece uzun oturumlarda
 * bile bellek sabit kalır. (Düşen hash ileride yeniden yakalanabilir — sınırlı bellek,
 * mükemmel dedup'tan önceliklidir; tavan geniş tutulur.)
 *
 * SAF: React/Capacitor/native importu yok — kök vitest paketinden test edilebilir.
 */

import { discoveryHash, type DiscoveryRecord } from './discoveryModel';

/** Kimlik alt kümesi — hash için yeterli (tam kayıt gerekmez). */
type Identity = Pick<DiscoveryRecord, 'discoverySource' | 'mode' | 'ecuAddress' | 'pidOrDid'>;

export class DiscoveryCache {
  /** Ekleme sırası korunan hash kümesi (Map anahtar sırası = FIFO eviction). */
  private readonly _seen = new Map<string, true>();
  private readonly maxEntries: number;

  constructor(maxEntries = 1024) {
    if (maxEntries < 1) throw new Error('DiscoveryCache maxEntries ≥ 1 olmalı');
    this.maxEntries = maxEntries;
  }

  /** Bu kimlik daha önce görüldü mü. */
  has(id: Identity): boolean {
    return this._seen.has(discoveryHash(id));
  }

  /**
   * Kimliği kaydeder. @returns true = YENİ (ilk kez), false = zaten görülmüştü.
   * Tavan aşılırsa en eski hash düşürülür (bounded).
   */
  add(id: Identity): boolean {
    const h = discoveryHash(id);
    if (this._seen.has(h)) return false;
    this._seen.set(h, true);
    if (this._seen.size > this.maxEntries) {
      // En eski anahtar (ilk eklenen) — Map iterasyonu ekleme sırasındadır.
      const oldest = this._seen.keys().next().value;
      if (oldest !== undefined) this._seen.delete(oldest);
    }
    return true;
  }

  /** Kayıtlı benzersiz kimlik sayısı. */
  get size(): number {
    return this._seen.size;
  }

  /** Tümünü temizler (oturum sıfırlama / araç değişimi). */
  clear(): void {
    this._seen.clear();
  }
}
