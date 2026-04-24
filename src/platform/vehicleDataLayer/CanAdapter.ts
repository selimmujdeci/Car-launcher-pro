import { isNative } from '../bridge';
import { CarLauncher } from '../nativePlugin';
import type { CanAdapterData } from './types';
import { dbgPushCanRaw, dbgUpdateCanExtras } from '../debug';

// READ-ONLY: CAN bus'tan yalnızca veri okunur.
// Araç sistemlerine hiçbir yazma veya kontrol komutu gönderilemez.

type Callback = (data: CanAdapterData) => void;

export interface ICanAdapter {
  readonly start: () => void;
  readonly stop: () => void;
  readonly onData: (cb: Callback) => () => void;
}

export class CanAdapter implements ICanAdapter {
  private readonly _listeners = new Set<Callback>();
  private _unsub: (() => void) | null = null;

  start(): void {
    if (this._unsub) return; // double-init guard
    if (!isNative) return;   // web modda CAN verisi yok

    CarLauncher.addListener('canData', (raw) => {
      const data: CanAdapterData = {};
      if (raw.speed        != null) data.speed        = raw.speed;
      if (raw.reverse      != null) data.reverse      = raw.reverse;
      if (raw.fuel         != null) data.fuel          = raw.fuel;
      if (raw.doorOpen     != null) data.doorOpen      = raw.doorOpen;
      if (raw.headlightsOn != null) data.headlightsOn  = raw.headlightsOn;
      if (raw.tpms         != null) data.tpms          = raw.tpms;
      this._listeners.forEach((fn) => fn(data));
      dbgPushCanRaw(data as Record<string, unknown>);
      dbgUpdateCanExtras({
        doorOpen: data.doorOpen,
        headlightsOn: data.headlightsOn,
        tpms: data.tpms,
      });
    }).then((handle) => {
      this._unsub = () => handle.remove();
    });

    // Native CAN okumayı başlat
    CarLauncher.startCanBus?.();
  }

  stop(): void {
    this._unsub?.();
    this._unsub = null;
    this._listeners.clear();
    if (isNative) CarLauncher.stopCanBus?.();
  }

  onData(cb: Callback): () => void {
    this._listeners.add(cb);
    return () => this._listeners.delete(cb);
  }
}
