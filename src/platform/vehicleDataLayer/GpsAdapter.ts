import { onGPSLocation } from '../gpsService';
import type { GpsAdapterData } from './types';
import { dbgIncGps } from '../debug';

type Callback = (data: GpsAdapterData) => void;

const THROTTLE_MS = 500;
const SPEED_DEADZONE_KMH = 2;

export class GpsAdapter {
  private _listeners = new Set<Callback>();
  private _unsub: (() => void) | null = null;
  private _lastEmit = 0;

  start(): void {
    this._unsub = onGPSLocation((loc) => {
      if (!loc) return;
      const now = Date.now();
      if (now - this._lastEmit < THROTTLE_MS) return;
      this._lastEmit = now;

      const data: GpsAdapterData = {
        location: { lat: loc.latitude, lng: loc.longitude, accuracy: loc.accuracy },
      };

      if (loc.heading != null) data.heading = loc.heading;

      if (loc.speed != null) {
        const kmh = loc.speed * 3.6;
        data.speed = kmh < SPEED_DEADZONE_KMH ? 0 : kmh;
      }

      this._listeners.forEach((fn) => fn(data));
      dbgIncGps();
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
