import { onOBDData } from '../obdService';
import type { ObdAdapterData } from './types';
import { dbgIncObd } from '../debug';

type Callback = (data: ObdAdapterData) => void;

export class ObdAdapter {
  private _listeners = new Set<Callback>();
  private _unsub: (() => void) | null = null;

  // Pre-allocated data object — React state'e GIRMEZ, observer'lara referans olarak verilir.
  // Her callback'te yeni nesne yerine mevcut nesne mutate edilir → GC baskısı sıfır.
  // CLAUDE.md §3: observer'lar veriyi aynı tick içinde tüketmeli, referans saklamama.
  private readonly _data: ObdAdapterData = {};

  start(): void {
    this._unsub = onOBDData((obd) => {
      // Zero-allocation: sadece değişen alanlar güncellenir
      if (obd.speed >= 0) {
        this._data.speed = obd.speed;
      } else {
        this._data.speed = undefined;
      }

      if (obd.fuelLevel >= 0) {
        this._data.fuel = obd.fuelLevel;
      } else {
        this._data.fuel = undefined;
      }

      // Geri vites: OBD source'ta -1 = desteklenmiyor, 0 = ileri, 1 = geri
      // undefined bırakılırsa VehicleSignalResolver bu alanı işlemez
      this._data.reverse = obd.rpm === 0 ? undefined : undefined; // CAN'dan gelir, OBD'de yok

      this._listeners.forEach((fn) => fn(this._data));
      dbgIncObd();
    });
  }

  stop(): void {
    this._unsub?.();
    this._unsub = null;
    this._listeners.clear();
    // Pre-allocated nesneyi temizle — bir sonraki start() için hazırla
    this._data.speed   = undefined;
    this._data.fuel    = undefined;
    this._data.reverse = undefined;
  }

  onData(cb: Callback): () => void {
    this._listeners.add(cb);
    return () => this._listeners.delete(cb);
  }
}
