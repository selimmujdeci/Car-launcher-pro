/**
 * MockHALAdapter — Geliştirme/Demo ortamı için HAL sinyal simülatörü.
 *
 * Yalnızca isNative=false (browser/demo) modunda çalışır.
 * Gerçek cihazda start() çağrılsa bile erken döner — üretime sıfır etkisi.
 *
 * READ-ONLY: Araç sistemlerine herhangi bir yazma komutu gönderilmez.
 *   Simülasyon yalnızca gelen sinyal akışını taklit eder.
 *
 * CONFIDENCE: Veriler SignalNormalizer.fromHAL ile CONF_HAL=0.98 güven skoru alır.
 *   Bu değer CAN (0.92) ve OBD (0.85) kaynakların önüne geçer.
 *   Demo modda HAL daima fusion'da kazanır.
 */

import { isNative } from '../bridge';
import type { VehicleHALData } from './types';
import { useHALStatusStore } from './halStatusStore';

type HALCallback = (data: VehicleHALData) => void;

export interface IHALAdapter {
  start(): void;
  stop(): void;
  onData(cb: HALCallback): () => void;
}

export class MockHALAdapter implements IHALAdapter {
  private readonly _listeners = new Set<HALCallback>();
  private _timer: ReturnType<typeof setInterval> | null = null;

  start(): void {
    if (this._timer !== null || isNative) return;
    this._timer = setInterval(() => this._tick(), 1_000);
    useHALStatusStore.getState().setHALConnected(true);
  }

  stop(): void {
    if (this._timer !== null) {
      clearInterval(this._timer);
      this._timer = null;
    }
    useHALStatusStore.getState().setHALConnected(false);
  }

  onData(cb: HALCallback): () => void {
    this._listeners.add(cb);
    return () => { this._listeners.delete(cb); };
  }

  private _tick(): void {
    // Demo/browser modunda gerçek sensör verisi yok — listener'lar bildirilmez.
    // Pipeline tüm sinyalleri stale kabul eder ve UI "--" gösterir.
  }
}
