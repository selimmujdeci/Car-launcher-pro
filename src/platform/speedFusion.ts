/**
 * Speed Fusion Service — Automotive Sensor Fusion (OBD + GPS)
 *
 * Mimari:
 *  - OBD: 3 s push (ELM327 polling loop) → obdService.onOBDData()
 *  - GPS: ~2 s push (platform geolocation) → gpsService.onGPSLocation()
 *  - Çıktı: max 2 Hz, EMA düzeltmeli tek hız akımı
 *
 * Füzyon Stratejisi:
 *  1. OBD "real" bağlı + GPS geçerli:
 *       → Plausibility check: |OBD − GPS| > 20 km/h için 2 ardışık uyuşmazlık
 *         Uyuşmazlık yoksa: 0.75 OBD + 0.25 GPS (complementary filter)
 *         Uyuşmazlık varsa: GPS'e geç (sensör arızası şüphesi)
 *  2. OBD "real" bağlı, GPS yok:
 *       → Saf OBD; EMA ile yumuşatılmış
 *  3. OBD mock/none:
 *       → Saf GPS; EMA ile yumuşatılmış
 *  4. İkisi de yok:
 *       → 0 km/h, source='none'
 *
 * Neden Complementary Filter?
 *  OBD CAN/OBD-II hız verisi tekerlek dönüşünden türetilir — anlık, ama
 *  ELM327 3 s gecikmeli. GPS Doppler hızı anlık ve bağımsız — düşük hızlarda
 *  %5 hata payı var. İkisini birleştirince hem gecikme hem gürültü azalır.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { onOBDData }      from './obdService';
import { onGPSLocation }  from './gpsService';
import { getPerformanceMode } from './performanceMode';
import type { OBDData }   from './obdService';
import type { GPSLocation } from './gpsService';

/* ── Sabitler ───────────────────────────────────────────────── */

/** EMA yumuşatma katsayısı — 0=tam düz, 1=ham veri */
const EMA_ALPHA = 0.38;

/** km/h cinsinden OBD-GPS uyuşmazlık eşiği */
const PLAUSIBILITY_KMH = 20;

/** Kaç ardışık uyuşmazlık sonrası GPS'e geçilsin */
const PLAUSIBILITY_LIMIT = 2;

/** Listener bildirim aralığı (ms) — max çıktı frekansı: 500ms = 2 Hz */
const NOTIFY_THROTTLE_MS = 500;

/* ── Tip tanımları ──────────────────────────────────────────── */

export type SpeedSource = 'obd' | 'gps' | 'fused' | 'none';

export interface FusedSpeedData {
  /** Füzyon + EMA sonrası km/h (tam sayıya yuvarlanmış) */
  speed: number;
  /** Hangi kaynak otoriter */
  source: SpeedSource;
  /** Ham OBD hızı — debug/diagnose için */
  obdRaw: number;
  /** Ham GPS hızı km/h — null ise GPS fix yok */
  gpsRaw: number | null;
  /** OBD ve GPS arasında anlamlı uyuşmazlık var mı */
  plausibilityWarning: boolean;
}

/* ── Modül-düzey durum ──────────────────────────────────────── */

let _fused: FusedSpeedData = {
  speed: 0, source: 'none', obdRaw: 0, gpsRaw: null, plausibilityWarning: false,
};

const _listeners = new Set<(d: FusedSpeedData) => void>();
let _ema          = 0;
let _lastObd      = 0;
let _obdSource: OBDData['source'] = 'none';
let _lastGpsKmh: number | null    = null;
let _mismatchCnt  = 0;
let _lastNotifyMs = 0;
let _initialized  = false;

/* ── Füzyon hesabı ──────────────────────────────────────────── */

function _computeAndNotify(): void {
  const obdReal = _obdSource === 'real';
  const gpsOk   = _lastGpsKmh !== null && _lastGpsKmh >= 0;

  let raw: number;
  let source: SpeedSource;
  let warn = false;

  if (obdReal) {
    if (gpsOk) {
      const diff = Math.abs(_lastObd - _lastGpsKmh!);
      if (diff > PLAUSIBILITY_KMH) {
        _mismatchCnt++;
        if (_mismatchCnt >= PLAUSIBILITY_LIMIT) {
          // OBD şüpheli — GPS'e geç
          raw    = _lastGpsKmh!;
          source = 'gps';
          warn   = true;
        } else {
          raw    = _lastObd;
          source = 'obd';
        }
      } else {
        _mismatchCnt = 0;
        // Complementary filter — OBD ağırlıklı, GPS düzeltici
        raw    = _lastObd * 0.75 + _lastGpsKmh! * 0.25;
        source = 'fused';
      }
    } else {
      raw    = _lastObd;
      source = 'obd';
      _mismatchCnt = 0;
    }
  } else if (gpsOk) {
    raw    = _lastGpsKmh!;
    source = 'gps';
    _mismatchCnt = 0;
  } else {
    raw    = 0;
    source = 'none';
    _mismatchCnt = 0;
  }

  // OBD bağlantısı kesilince EMA'yı mevcut GPS hızına sıfırla (sıçramayı önle)
  if (!obdReal && _obdSource !== 'mock') {
    _ema = _lastGpsKmh ?? 0;
  }

  // Exponential Moving Average
  _ema = _ema + EMA_ALPHA * (raw - _ema);
  const smoothed = Math.max(0, Math.round(_ema));

  const prev = _fused;
  _fused = { speed: smoothed, source, obdRaw: _lastObd, gpsRaw: _lastGpsKmh, plausibilityWarning: warn };

  // Throttle: listener'ları max 2 Hz'de bilgilendir
  const now = Date.now();
  if (now - _lastNotifyMs < NOTIFY_THROTTLE_MS) return;

  // Değer gerçekten değişmediyse bildirim gönderme
  if (
    prev.speed === smoothed &&
    prev.source === source  &&
    prev.plausibilityWarning === warn
  ) return;

  _lastNotifyMs = now;
  const snap = { ..._fused };
  _listeners.forEach((fn) => fn(snap));
}

/* ── Abonelik başlatma (lazy, bir kez) ─────────────────────── */

let _cleanupObd: (() => void) | null = null;
let _cleanupGps: (() => void) | null = null;

function _init(): void {
  if (_initialized) return;
  _initialized = true;

  _cleanupObd = onOBDData((d) => {
    _lastObd   = d.speed >= 0 ? d.speed : 0;
    _obdSource = d.source;
    _computeAndNotify();
  });

  _cleanupGps = onGPSLocation((loc: GPSLocation | null) => {
    const ms = loc?.speed;
    _lastGpsKmh = (ms != null && Number.isFinite(ms) && ms > 0) ? ms * 3.6 : null;
    _computeAndNotify();
  });
}

/* ── Public non-React API ───────────────────────────────────── */

/** Anlık füzyon snapshot'ı — React dışı kullanım için */
export function getFusedSpeed(): FusedSpeedData {
  _init();
  return { ..._fused };
}

/** Non-React abonelik — cleanup fonksiyonu döner */
export function onFusedSpeed(fn: (d: FusedSpeedData) => void): () => void {
  _init();
  _listeners.add(fn);
  fn({ ..._fused }); // anında senkronizasyon
  return () => { _listeners.delete(fn); };
}

/* ── HMR cleanup ────────────────────────────────────────────── */
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    _cleanupObd?.();
    _cleanupGps?.();
    _listeners.clear();
    _initialized = false;
  });
}

/* ── React Hook ─────────────────────────────────────────────── */

/**
 * useFusedSpeed — tek hook, çift kaynak sorununu çözer.
 *
 * Performans garantileri:
 *  - Re-render yalnızca `speed` (tam sayı) veya `source` değiştiğinde tetiklenir
 *  - RAF aracılığıyla görsel değer interpolasyonu React render döngüsünden bağımsız
 *  - Lite modda (2 GB RAM) interpolasyon devre dışı → animasyon frame skip yok
 *
 * @returns displaySpeed: RAF interpole edilmiş görsel değer (0..240)
 * @returns data: ham füzyon verisi
 */
export function useFusedSpeed(): {
  displaySpeed: number;
  data: FusedSpeedData;
} {
  const [data, setData] = useState<FusedSpeedData>(() => getFusedSpeed());

  // RAF animasyon state'i — React re-render tetiklemiyor
  const displayRef  = useRef(data.speed);      // mevcut görsel değer
  const targetRef   = useRef(data.speed);      // hedef değer
  const rafIdRef    = useRef<number>(0);
  const [displaySpeed, setDisplaySpeed] = useState(data.speed);

  // Lite modda animasyon yok — doğrudan atlama
  const isLite = getPerformanceMode() === 'lite';

  // RAF lerp döngüsü
  const runRAF = useCallback(function animate() {
    const current = displayRef.current;
    const target  = targetRef.current;
    const diff    = target - current;

    if (Math.abs(diff) < 0.5) {
      // Hedefe ulaştık
      displayRef.current = target;
      setDisplaySpeed(Math.round(target));
      rafIdRef.current = 0;
      return;
    }

    // Lerp katsayısı: premium=0.18 (yumuşak), balanced=0.25 (hızlı)
    const lerpK = isLite ? 1.0 : getPerformanceMode() === 'premium' ? 0.18 : 0.25;
    displayRef.current = current + diff * lerpK;
    setDisplaySpeed(Math.round(displayRef.current));
    rafIdRef.current = requestAnimationFrame(animate);
  }, [isLite]);

  // Füzyon verisi değişince RAF başlat
  useEffect(() => {
    const cleanup = onFusedSpeed((next) => {
      // Reaktif güncelleme sadece anlamlı değişikliklerde
      setData((prev) => {
        if (prev.speed === next.speed && prev.source === next.source && prev.plausibilityWarning === next.plausibilityWarning) return prev;
        return next;
      });

      // Animasyon hedefini güncelle
      targetRef.current = next.speed;

      if (isLite) {
        // Lite: animasyon yok, direkt set
        displayRef.current = next.speed;
        setDisplaySpeed(next.speed);
        return;
      }

      // RAF başlat (zaten çalışıyorsa dokunma)
      if (rafIdRef.current === 0) {
        rafIdRef.current = requestAnimationFrame(runRAF);
      }
    });

    return () => {
      cleanup();
      if (rafIdRef.current !== 0) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = 0;
      }
    };
  }, [runRAF, isLite]);

  return { displaySpeed, data };
}
