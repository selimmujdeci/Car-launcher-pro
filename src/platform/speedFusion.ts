/**
 * Speed Fusion Service — CAN → OBD → GPS öncelik zinciri.
 *
 * Öncelik:
 *  1. CAN bus  (3s timeout)  — head unit MCU varsa en güvenilir
 *  2. OBD real (10s timeout) — ELM327/iCar bağlıysa
 *  3. GPS      (5s timeout)  — her zaman fallback
 *  4. Hiçbiri → 0 km/h, source='none'
 *
 * OBD+GPS aynı anda aktifse plausibility cross-check yapılır:
 *  |OBD − GPS| > 15 km/h, 2 ardışık → OBD şüpheli, GPS'e geç.
 *
 * EMA yok — sayısal hız anlık raw değerdir.
 * Görsel yumuşatma useFusedSpeed() içindeki RAF lerp ile ibre animasyonuna uygulanır.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { Capacitor }          from '@capacitor/core';
import { CarLauncher }        from './nativePlugin';
import { onOBDData }          from './obdService';
import { onGPSLocation }      from './gpsService';
import { getPerformanceMode } from './performanceMode';
import type { OBDData }       from './obdService';
import type { GPSLocation }   from './gpsService';

/* ── Sabitler ───────────────────────────────────────────────── */

/** km/h cinsinden OBD-GPS uyuşmazlık eşiği */
const PLAUSIBILITY_KMH = 15;

/** Kaç ardışık uyuşmazlık sonrası GPS'e geçilsin */
const PLAUSIBILITY_LIMIT = 2;

/** Listener bildirim aralığı (ms) — max çıktı frekansı: 500ms = 2 Hz */
const NOTIFY_THROTTLE_MS = 500;

/* ── Tip tanımları ──────────────────────────────────────────── */

export type SpeedSource = 'can' | 'obd' | 'gps' | 'fused' | 'none';

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
  /** Güven skoru 0.0–1.0: fused=0.9 | obd=0.7 | gps=0.6 | spike=0.3 | geçersiz=0.0 */
  confidence: number;
}

/* ── Sabitler (staleness timeout) ───────────────────────────── */

const CAN_TIMEOUT_MS = 3_000;
const OBD_TIMEOUT_MS = 10_000;
const GPS_TIMEOUT_MS = 5_000;

/* ── Modül-düzey durum ──────────────────────────────────────── */

let _fused: FusedSpeedData = {
  speed: 0, source: 'none', obdRaw: 0, gpsRaw: null, plausibilityWarning: false, confidence: 0,
};

const _listeners = new Set<(d: FusedSpeedData) => void>();

// CAN
let _lastCanKmh: number | null = null;
let _canLastMs  = 0;

// OBD
let _lastObd    = 0;
let _obdLastMs  = 0;
let _obdSource: OBDData['source'] = 'none';

// GPS
let _lastGpsKmh: number | null = null;
let _prevGpsKmh: number | null = null;
let _lastGpsTsMs  = 0;
let _prevGpsTsMs  = 0;

let _mismatchCnt    = 0;
let _lastMismatchMs = 0;
const MISMATCH_WINDOW_MS = 10_000;
let _lastNotifyMs   = 0;
let _initialized    = false;

/* ── Füzyon hesabı ──────────────────────────────────────────── */

function _computeAndNotify(): void {
  const now = Date.now();

  // ── GPS Velocity Guard ───────────────────────────────────────
  let velGuardRejected = false;
  if (_lastGpsKmh !== null && _prevGpsKmh !== null) {
    const dtSec = (_lastGpsTsMs - _prevGpsTsMs) / 1000;
    if (dtSec > 0 && dtSec <= 1.0 && Math.abs(_lastGpsKmh - _prevGpsKmh) > 50) {
      _lastGpsKmh = _prevGpsKmh;
      velGuardRejected = true;
    } else if (_lastGpsTsMs > _prevGpsTsMs) {
      _prevGpsKmh  = _lastGpsKmh;
      _prevGpsTsMs = _lastGpsTsMs;
    }
  } else if (_lastGpsKmh !== null) {
    _prevGpsKmh  = _lastGpsKmh;
    _prevGpsTsMs = _lastGpsTsMs;
  }

  // ── Staleness kontrolleri ────────────────────────────────────
  const canAlive = _lastCanKmh !== null && (now - _canLastMs) < CAN_TIMEOUT_MS;
  const obdReal  = _obdSource === 'real' && (now - _obdLastMs) < OBD_TIMEOUT_MS;
  const gpsOk    = _lastGpsKmh !== null && _lastGpsKmh >= 0 &&
                   (now - _lastGpsTsMs) < GPS_TIMEOUT_MS;

  let raw: number;
  let source: SpeedSource;
  let warn = false;

  // ── Öncelik: CAN → OBD → GPS ────────────────────────────────
  if (canAlive) {
    // CAN bus: en güvenilir kaynak (head unit MCU direkt araç hattı)
    raw    = _lastCanKmh!;
    source = 'can';
    _mismatchCnt = 0;
  } else if (obdReal) {
    if (gpsOk) {
      const diff = Math.abs(_lastObd - _lastGpsKmh!);
      if (diff > PLAUSIBILITY_KMH) {
        if (now - _lastMismatchMs > MISMATCH_WINDOW_MS) _mismatchCnt = 0;
        _mismatchCnt++;
        _lastMismatchMs = now;
        if (_mismatchCnt >= PLAUSIBILITY_LIMIT) {
          raw    = _lastGpsKmh!;
          source = 'gps';
          warn   = true;
        } else {
          raw    = _lastObd;
          source = 'obd';
        }
      } else {
        _mismatchCnt = 0;
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

  // ── Confidence skoru ─────────────────────────────────────────
  const confidence: number =
    source === 'none'  ? 0.0 :
    velGuardRejected   ? 0.3 :
    warn               ? 0.3 :
    source === 'can'   ? 1.0 :
    source === 'fused' ? 0.9 :
    source === 'gps'   ? 0.6 :
    /* 'obd' */          0.7;

  // Ham değer — EMA yok, anlık hız
  const smoothed = Math.max(0, Math.round(raw));

  const prev = _fused;
  _fused = { speed: smoothed, source, obdRaw: _lastObd, gpsRaw: _lastGpsKmh, plausibilityWarning: warn, confidence };

  // Throttle: listener'ları max 2 Hz'de bilgilendir
  if (now - _lastNotifyMs < NOTIFY_THROTTLE_MS) return;

  // Değer gerçekten değişmediyse bildirim gönderme
  if (
    prev.speed === smoothed &&
    prev.source === source  &&
    prev.plausibilityWarning === warn &&
    prev.confidence === confidence
  ) return;

  _lastNotifyMs = now;
  const snap = { ..._fused };
  _listeners.forEach((fn) => fn(snap));
}

/* ── Abonelik başlatma (lazy, bir kez) ─────────────────────── */

let _cleanupCan: (() => void) | null = null;
let _cleanupObd: (() => void) | null = null;
let _cleanupGps: (() => void) | null = null;

function _init(): void {
  if (_initialized) return;
  _initialized = true;

  // ── CAN bus (Priority 1) — native only ──────────────────────
  if (Capacitor.isNativePlatform()) {
    CarLauncher.addListener('canData', (raw) => {
      if (raw.speed != null && raw.speed >= 0 && raw.speed <= 300) {
        _lastCanKmh = raw.speed;
        _canLastMs  = Date.now();
        _computeAndNotify();
      }
    }).then((handle) => {
      _cleanupCan = () => handle.remove();
    });
  }

  // ── OBD (Priority 2) ────────────────────────────────────────
  _cleanupObd = onOBDData((d) => {
    _lastObd   = d.speed >= 0 ? d.speed : 0;
    _obdSource = d.source;
    _obdLastMs = Date.now();
    _computeAndNotify();
  });

  // ── GPS (Priority 3) ────────────────────────────────────────
  _cleanupGps = onGPSLocation((loc: GPSLocation | null) => {
    _lastGpsTsMs = Date.now();
    const ms = loc?.speed;
    _lastGpsKmh = (ms != null && Number.isFinite(ms) && ms >= 0) ? ms * 3.6 : null;
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
    _cleanupCan?.();
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

  // Lite ve balanced modda animasyon yok — RAF 60fps CPU harcamasını önle
  const isLite = getPerformanceMode() !== 'premium';

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
