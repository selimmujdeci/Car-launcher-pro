import { onOBDData } from '../obdService';
import type { ObdAdapterData } from './types';
import { dbgIncObd } from '../debug';

type Callback = (data: ObdAdapterData) => void;

export class ObdAdapter {
  private _listeners = new Set<Callback>();
  private _unsub: (() => void) | null = null;

  start(): void {
    this._unsub = onOBDData((obd) => {
      const data: ObdAdapterData = {};
      if (obd.speed >= 0) data.speed = obd.speed;
      if (obd.fuelLevel >= 0) data.fuel = obd.fuelLevel;
      this._listeners.forEach((fn) => fn(data));
      dbgIncObd();
    });
  }

  stop(): void {
    this._unsub?.();
    this._unsub = null;
    this._listeners.clear();
  }

  onData(cb: Callback): () => void {
    this._listeners.add(cb);
    return () => this._listeners.delete(cb);
  }
}
