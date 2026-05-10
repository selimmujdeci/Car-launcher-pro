import { isNative } from '../bridge';
import { CarLauncher } from '../nativePlugin';
import type { CanAdapterData } from './types';
import { dbgPushCanRaw, dbgUpdateCanExtras } from '../debug';
import { useUnifiedVehicleStore } from './UnifiedVehicleStore';

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
  private readonly _data: CanAdapterData = {};
  private readonly _tpmsBuffer: [number, number, number, number] = [0, 0, 0, 0];

  start(): void {
    if (this._unsub) return;
    if (!isNative) return;

    CarLauncher.addListener('canStatus', (status) => {
      console.info('[CAN]', status.mode, status.port, status.connected ? '✓' : '✗');
    }).catch(() => {});

    CarLauncher.addListener('canData', (raw) => {
      // ── Temel sürüş ──────────────────────────────────────────────────────
      this._data.speed        = raw.speed        ?? undefined;
      this._data.reverse      = raw.reverse      ?? undefined;
      this._data.fuel         = raw.fuel         ?? undefined;

      // ── Motor ─────────────────────────────────────────────────────────────
      this._data.rpm          = raw.rpm          ?? undefined;
      this._data.coolantTemp  = raw.coolantTemp  ?? undefined;
      this._data.oilTemp      = raw.oilTemp      ?? undefined;
      this._data.throttle     = raw.throttle     ?? undefined;

      // ── Elektrik ──────────────────────────────────────────────────────────
      this._data.batteryVolt  = raw.batteryVolt  ?? undefined;

      // ── Vites ─────────────────────────────────────────────────────────────
      this._data.gearPos      = raw.gearPos      ?? undefined;

      // ── Çevre ─────────────────────────────────────────────────────────────
      this._data.ambientTemp  = raw.ambientTemp  ?? undefined;

      // ── Kapı / aydınlatma ─────────────────────────────────────────────────
      this._data.doorOpen     = raw.doorOpen     ?? undefined;
      this._data.headlightsOn = raw.headlightsOn ?? undefined;

      // ── Şasi güvenliği ────────────────────────────────────────────────────
      this._data.abs              = raw.abs              ?? undefined;
      this._data.tractionControl  = raw.tractionControl  ?? undefined;
      this._data.stabilityControl = raw.stabilityControl ?? undefined;

      // ── Gövde / konfor ────────────────────────────────────────────────────
      this._data.parkingBrake  = raw.parkingBrake  ?? undefined;
      this._data.seatbelt      = raw.seatbelt      ?? undefined;
      this._data.wipers        = raw.wipers        ?? undefined;
      this._data.airCondition  = raw.airCondition  ?? undefined;
      this._data.cruiseControl = raw.cruiseControl ?? undefined;

      // ── TPMS (pre-allocated buffer) ───────────────────────────────────────
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
      this._unsub = () => { handle.remove(); };
    });

    CarLauncher.startCanBus?.();
  }

  stop(): void {
    this._unsub?.();
    this._unsub = null;
    this._listeners.clear();
    // CAN transport kesilince stale veri UI'da donmasın — anında sıfırla
    useUnifiedVehicleStore.getState().resetCanData();
    // Pre-allocated nesneyi temizle
    Object.keys(this._data).forEach(k => {
      (this._data as Record<string, unknown>)[k] = undefined;
    });
    if (isNative) CarLauncher.stopCanBus?.();
  }

  onData(cb: Callback): () => void {
    this._listeners.add(cb);
    return () => this._listeners.delete(cb);
  }
}
