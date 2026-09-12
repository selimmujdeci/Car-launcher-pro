import { onGPSLocation } from '../gpsService';
import type { GpsAdapterData } from './types';
import { dbgIncGps } from '../debug';
/* ARCH-06/F4 — YALNIZ SAYAÇ. GPS kadansı, throttle'ı ve ARCH-02/F2
   nesil/sıra guard'ları DEĞİŞMEDİ; koordinat sayaca GİRMEZ. */
import { bumpPerf } from '../perf/perfCounters';

type Callback = (data: GpsAdapterData) => void;

const THROTTLE_MS = 200;

// GpsAdapter artık birim dönüşümü YAPMAZ.
// m/s → km/h dönüşümü + deadzone uygulaması SignalNormalizer.fromGPS()'e taşındı.
// `data.speed` ham m/s değeri içerir (VAL mimarisi: SignalNormalizer standart birim garantisi sağlar).

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
        // Kaynaktaki ÖLÇÜM anı taşınır (varış anı değil) — kütük #458.
        fixTs: loc.timestamp,
      };

      if (loc.heading != null) data.heading = loc.heading;
      // Ham m/s — SignalNormalizer.fromGPS() km/h'e çevirir
      if (loc.speed != null) data.speed = loc.speed;

      /* VDL sınırına ULAŞAN fix sayısı. `gpsService` tarafındaki
         `fixAccepted` ile birlikte okunur: ikisi arasındaki fark bu
         adaptörün KENDİ throttle'ının (THROTTLE_MS) elediği fix'tir. */
      bumpPerf('gps.publishedToStore');
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
