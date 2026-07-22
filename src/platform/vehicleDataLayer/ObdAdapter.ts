import { onOBDData, getObdSpeedFresh } from '../obdService';
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
      //
      // HIZ — KAYNAK DOĞRULUĞU KAPISI (saha 2026-07-22, Trafic/KWP):
      // `obd.speed` tipi `number` ve varsayılanı `0`'dır; `010D` hiç gelmese bile
      // `0 >= 0` doğrudur → "hız verisi yok" durumu aşağı akışa GEÇERLİ "0 km/h"
      // olarak sızıyordu. Artık damgalı kapıdan geçer: doğrulanmamış/bayat hız
      // `undefined` olur → resolver `null` yayar → store hızı DÜŞÜRÜR.
      const freshSpeed = getObdSpeedFresh();
      this._data.speed = freshSpeed === null ? undefined : freshSpeed;

      if (obd.fuelLevel >= 0) {
        this._data.fuel = obd.fuelLevel;
      } else {
        this._data.fuel = undefined;
      }

      // RPM — EV'de -1 gelir; negatif değerler yok sayılır
      if (obd.rpm >= 0) {
        this._data.rpm = obd.rpm;
      } else {
        this._data.rpm = undefined;
      }

      // Soğutma suyu sıcaklığı (PID 0x05) — EV'de -1 gelir; obdSanitizer.ts ile
      // aynı sentinel kuralı: negatif = "yok/desteklenmiyor" (bilinen kısıt:
      // 0°C altı gerçek okumalar da elenir — obdSanitizer.ts:104-105 ile tutarlı).
      if (obd.engineTemp >= 0) {
        this._data.coolantTemp = obd.engineTemp;
      } else {
        this._data.coolantTemp = undefined;
      }

      // reverse: CAN bus'tan gelir, OBD'de yok
      this._data.reverse = undefined;

      this._listeners.forEach((fn) => fn(this._data));
      dbgIncObd();
    });
  }

  stop(): void {
    this._unsub?.();
    this._unsub = null;
    this._listeners.clear();
    // Pre-allocated nesneyi temizle — bir sonraki start() için hazırla
    this._data.speed       = undefined;
    this._data.fuel        = undefined;
    this._data.rpm         = undefined;
    this._data.coolantTemp = undefined;
    this._data.reverse     = undefined;
  }

  onData(cb: Callback): () => void {
    this._listeners.add(cb);
    return () => this._listeners.delete(cb);
  }
}
