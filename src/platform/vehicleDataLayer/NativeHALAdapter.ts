/**
 * NativeHALAdapter — AAOS VHAL Capacitor plugin polling köprüsü.
 *
 * Phase 3 VehicleHALPlugin.java henüz addListener desteklemiyor;
 * 500 ms polling ile getSignal() çağrısı yapılır.
 *
 * Birim dönüşümü (AAOS native → VehicleHALData canonical):
 *   speedMs (m/s)   → speed (km/h)  = speedMs × 3.6
 *   coolantTempC    → coolantTemp   (birim aynı, alan adı map)
 *   gear            → gearPos       (alan adı map)
 *   fuelL (litre)   → tank kapasitesi bilinmeden % hesaplanamaz;
 *                      bu alan NativeHALAdapter'dan emit edilmez,
 *                      OBD / CAN yakıt kaynağına bırakılır.
 *
 * FAIL-SAFE: startHAL() başarısız olur veya connected:false dönerse
 *   adaptör sessizce durur; CAN/OBD fallback devreye girer.
 * READ-ONLY: Plugin'e hiçbir veri yazma komutu gönderilmez.
 */

import { isNative }        from '../bridge';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — VehicleHAL CI ortamında tip çözümlenemiyor
import { VehicleHAL }      from '../nativePlugin';
import type { IHALAdapter } from './MockHALAdapter';
import type { VehicleHALData } from './types';
import { useHALStatusStore } from './halStatusStore';

/** Phase 3 Java plugin'in gerçekte gönderdiği alanlar (AAOS native birimleri) */
type _RawSignal = {
  connected:     boolean;
  // AAOS native — NativeHALAdapter dönüştürür
  speedMs?:      number;   // m/s  ← PERF_VEHICLE_SPEED
  rpm?:          number;   // devir/dak
  fuelL?:        number;   // litre ← FUEL_LEVEL (tank % bilinmez)
  coolantTempC?: number;   // °C
  gear?:         number;   // vites pozisyonu
  ts?:           number;   // epoch ms
  // Canonical alanlar — Java gelecekte bu isimlere geçtiğinde de çalışır
  speed?:        number;   // km/h
  fuel?:         number;   // 0–100 %
  coolantTemp?:  number;   // °C
  gearPos?:      number;
};

const POLL_INTERVAL_MS = 500; // addListener yokken 2 Hz polling

export class NativeHALAdapter implements IHALAdapter {
  private readonly _listeners = new Set<(data: VehicleHALData) => void>();
  private _timer:    ReturnType<typeof setInterval> | null = null;
  private _starting  = false;
  private _polling   = false;
  private _failCount = 0;
  private static readonly MAX_FAILURES = 3;

  /** Bağlantıyı başlat. isNative=false ise sessizce döner. */
  start(): void {
    if (this._timer !== null || this._starting || !isNative) return;
    this._starting = true;
    void this._init();
  }

  stop(): void {
    if (this._timer !== null) {
      clearInterval(this._timer);
      this._timer = null;
    }
    this._starting  = false;
    this._failCount = 0;
    useHALStatusStore.getState().setHALConnected(false);
    // Fire-and-forget: plugin başlamamışsa sessizce geçer
    VehicleHAL.stopHAL().catch(() => {});
  }

  onData(cb: (data: VehicleHALData) => void): () => void {
    this._listeners.add(cb);
    return () => { this._listeners.delete(cb); };
  }

  // ── Dahili akış ─────────────────────────────────────────────────────────

  private async _init(): Promise<void> {
    try {
      const result = await VehicleHAL.startHAL();
      if (!result.connected) {
        // AAOS değil veya bağlantı kurulamadı — OBD/CAN fallback aktif kalır
        console.info('[NativeHAL] AAOS not connected — HAL adapter idle');
        this._starting = false;
        return;
      }
      this._timer    = setInterval(() => void this._poll(), POLL_INTERVAL_MS);
      this._starting = false;
      useHALStatusStore.getState().setHALConnected(true);
      console.info('[NativeHAL] connected — polling at', POLL_INTERVAL_MS, 'ms');
    } catch (e) {
      console.warn('[NativeHAL] startHAL failed:', e);
      this._starting = false;
    }
  }

  private async _poll(): Promise<void> {
    if (this._polling) return; // önceki tamamlanmadı — bu tiki atla
    this._polling = true;
    try {
      // Plugin dönüş tipi VehicleHALData & {connected} ama Java şu an raw AAOS birimleri
      // gönderiyor; _RawSignal cast'i her iki durumu da kapsar.
      const raw = await VehicleHAL.getSignal() as unknown as _RawSignal;

      if (!raw.connected) {
        // Bağlantı kesildi — polling durdur, OBD/CAN fallback devralır
        console.warn('[NativeHAL] connection lost — stopping adapter');
        this.stop();
        return;
      }

      const data: VehicleHALData = {};

      // ── Hız: m/s → km/h (AAOS native) veya km/h (canonical) ─────────────
      const speedMs  = raw.speedMs;
      const speedKmh = raw.speed;
      if      (speedKmh != null) data.speed = speedKmh;
      else if (speedMs  != null) data.speed = speedMs * 3.6;

      // ── RPM ───────────────────────────────────────────────────────────────
      if (raw.rpm != null) data.rpm = raw.rpm;

      // ── Soğutma suyu: alan adı map ────────────────────────────────────────
      const coolant = raw.coolantTemp ?? raw.coolantTempC;
      if (coolant != null) data.coolantTemp = coolant;

      // ── Vites: alan adı map ───────────────────────────────────────────────
      const gear = raw.gearPos ?? raw.gear;
      if (gear != null) data.gearPos = gear;

      // ── Yakıt: fuelL litre cinsinden; tank kapasitesi olmadan % hesaplanamaz
      //    Canonical fuel % varsa kullan; yoksa bu alanı emit etme.
      if (raw.fuel != null) data.fuel = raw.fuel;

      if (Object.keys(data).length > 0) {
        this._failCount = 0; // başarılı veri → hata sayacını sıfırla
        this._listeners.forEach((cb) => cb(data));
      }
    } catch (e) {
      this._failCount += 1;
      console.warn('[NativeHAL] getSignal failed (', this._failCount, '/', NativeHALAdapter.MAX_FAILURES, '):', e);
      if (this._failCount >= NativeHALAdapter.MAX_FAILURES) {
        console.error('[NativeHAL] Retry limit reached — adapter stopped; OBD/CAN fallback active');
        this.stop();
        return;
      }
    } finally {
      this._polling = false;
    }
  }
}
