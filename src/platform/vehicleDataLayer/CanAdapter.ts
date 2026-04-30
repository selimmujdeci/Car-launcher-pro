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

  // Pre-allocated data object — her CAN frame'de yeni nesne yaratmak yerine
  // mevcut nesne mutate edilir. GC baskısı 0.
  // TPMS array: ayrıca pre-allocate edilir — 4 elemanlı sabit boyutlu dizi.
  private readonly _data: CanAdapterData = {};
  private readonly _tpmsBuffer: [number, number, number, number] = [0, 0, 0, 0];

  start(): void {
    if (this._unsub) return; // double-init guard
    if (!isNative) return;   // web modda CAN verisi yok

    CarLauncher.addListener('canData', (raw) => {
      // Zero-allocation: her alana direkt yaz, kontrol koşullu
      if (raw.speed        != null) { this._data.speed        = raw.speed;        }
      else                          { this._data.speed        = undefined;        }

      if (raw.reverse      != null) { this._data.reverse      = raw.reverse;      }
      else                          { this._data.reverse      = undefined;        }

      if (raw.fuel         != null) { this._data.fuel         = raw.fuel;         }
      else                          { this._data.fuel         = undefined;        }

      if (raw.doorOpen     != null) { this._data.doorOpen     = raw.doorOpen;     }
      else                          { this._data.doorOpen     = undefined;        }

      if (raw.headlightsOn != null) { this._data.headlightsOn = raw.headlightsOn; }
      else                          { this._data.headlightsOn = undefined;        }

      // TPMS: pre-allocate 4-element array — raw.tpms yeni dizi yerine buffer'a kopyalanır
      if (raw.tpms != null && raw.tpms.length === 4) {
        this._tpmsBuffer[0] = raw.tpms[0]!;
        this._tpmsBuffer[1] = raw.tpms[1]!;
        this._tpmsBuffer[2] = raw.tpms[2]!;
        this._tpmsBuffer[3] = raw.tpms[3]!;
        this._data.tpms = this._tpmsBuffer;
      } else {
        this._data.tpms = undefined;
      }

      this._listeners.forEach((fn) => fn(this._data));
      dbgPushCanRaw(this._data as Record<string, unknown>);
      dbgUpdateCanExtras({
        doorOpen:     this._data.doorOpen,
        headlightsOn: this._data.headlightsOn,
        tpms:         this._data.tpms,
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
    // Pre-allocated nesneyi temizle
    this._data.speed = this._data.reverse = this._data.fuel = undefined;
    this._data.doorOpen = this._data.headlightsOn = this._data.tpms = undefined;
    if (isNative) CarLauncher.stopCanBus?.();
  }

  onData(cb: Callback): () => void {
    this._listeners.add(cb);
    return () => this._listeners.delete(cb);
  }
}
