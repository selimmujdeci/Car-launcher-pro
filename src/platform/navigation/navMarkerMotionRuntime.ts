/**
 * navMarkerMotionRuntime.ts — araç işareti hareketinin TEK sahibi.
 *
 * ── ÇÖZDÜĞÜ ARIZA (NAVIGATION_MOTION_CAMERA_P0) ─────────────────────────────
 * `FullMapView` kendi RAF döngüsünde ara değer üretiyordu; `MiniMapWidget` ise
 * marker'ı doğrudan GPS geri çağrısında çiziyordu (2 Hz) → **mini haritada araç
 * saniyede iki kez zıplıyordu.** Aynı üründe iki farklı akıcılık, "amatör
 * görünüm" şikâyetinin en görünür kaynağıydı.
 *
 * ── SÖZLEŞME ────────────────────────────────────────────────────────────────
 *  · Örnekleri TEK yerden alır: `navigationSessionRuntime` (mevcut tek GPS
 *    aboneliği). Bu modül **kendi GPS aboneliğini veya timer'ını KURMAZ** →
 *    ikinci dinleyici/ikinci RAF döngüsü doğamaz.
 *  · Görünümler yalnız `getRenderedMotion(now)` SORAR. Ara değer matematiği
 *    saf modeldedir (`core/markerMotionModel`); bileşenler kendi motorunu
 *    kurmaz.
 *  · Durum modül düzeyindedir → tam ekran açılıp kapanınca marker SIÇRAMAZ ve
 *    yön değişiminde motion durumu KORUNUR.
 */

import { useEffect, useState } from 'react';
import {
  computeRenderedMotion, MARKER_MOTION_STATE_LABEL,
  type MotionSample, type RenderedMotion, type MarkerMotionState,
} from './core/markerMotionModel';

export { MARKER_MOTION_STATE_LABEL };
export type { MarkerMotionState, RenderedMotion };

/* ── Durum ────────────────────────────────────────────────────────────────── */

let _prev: MotionSample | null = null;
let _cur:  MotionSample | null = null;
let _lastBearing: number | null = null;
/** Kaç örnek işlendi (LAB). */
let _sampleCount = 0;
/** Kaç kez `SNAP_CORRECTION` üretildi (LAB — sıçrama/düzeltme kanıtı). */
let _snapCount = 0;
/** Kaç ayrı besleyici kaydoldu — 1'den büyükse ÇİFT RUNTIME vardır. */
let _feederCount = 0;

const _listeners = new Set<() => void>();

function _notify(): void {
  for (const fn of [..._listeners]) { try { fn(); } catch { /* fail-soft */ } }
}

/**
 * Yeni bir gerçek konum örneği bildir.
 *
 * YALNIZ `navigationSessionRuntime` çağırır (gerçek GPS fix'i ve ölü hesaplama
 * tick'i). Görünümler bu fonksiyonu ÇAĞIRMAZ.
 */
export function noteMotionSample(sample: MotionSample): void {
  if (!Number.isFinite(sample.lat) || !Number.isFinite(sample.lon)) return;
  // Aynı damgayla ikinci kez beslenirse (çift tick) örnek YAZILMAZ.
  if (_cur && sample.tsMs <= _cur.tsMs) return;
  _prev = _cur;
  _cur = sample;
  _sampleCount++;
  _notify();
}

/** Besleyici kaydı — birden fazla olursa LAB'da GÖRÜNÜR (duplicate runtime kilidi). */
export function registerMotionFeeder(): () => void {
  _feederCount++;
  let released = false;
  return () => { if (!released) { released = true; _feederCount = Math.max(0, _feederCount - 1); } };
}

/**
 * O anda çizilecek konum/yön. Çağıran RAF içinden her karede çağırabilir.
 * SAF hesap — yan etkisi yalnız `lastBearing` hatırlamasıdır (ani dönüş önleme).
 */
export function getRenderedMotion(nowMs: number): RenderedMotion {
  const r = computeRenderedMotion({
    prev: _prev, cur: _cur, nowMs, lastBearingDeg: _lastBearing,
  });
  if (r.bearingDeg !== null) _lastBearing = r.bearingDeg;
  return r;
}

export interface MarkerMotionSnapshot {
  readonly state: MarkerMotionState;
  readonly interpolationProgress: number;
  readonly sourceAgeMs: number;
  readonly confidence: number;
  /** MASKELİ ham konum — koordinat SIZDIRILMAZ, yalnız VAR/YOK + doğruluk. */
  readonly rawPositionMasked: string;
  /** MASKELİ çizilen konum. */
  readonly renderedPositionMasked: string;
  readonly sampleCount: number;
  readonly snapCorrectionCount: number;
  /** 1'den büyükse İKİNCİ bir motion runtime beslemesi var demektir. */
  readonly duplicateMotionRuntimeCount: number;
  readonly reason: string;
}

/** Koordinatı gizler, tanı için gerekeni bırakır (CLAUDE.md gözlem kuralı 6). */
function _mask(lat: number | null, lon: number | null, accM: number | null): string {
  if (lat === null || lon === null) return 'YOK';
  const acc = accM !== null && Number.isFinite(accM) ? ` ±${Math.round(accM)} m` : '';
  return `VAR${acc}`;
}

/** Senkron okuma — CAROS LAB için. Koordinat TAŞIMAZ. */
export function getMarkerMotionSnapshot(nowMs: number): MarkerMotionSnapshot {
  const r = computeRenderedMotion({
    prev: _prev, cur: _cur, nowMs, lastBearingDeg: _lastBearing,
  });
  return {
    state: r.state,
    interpolationProgress: Number(r.interpolationProgress.toFixed(3)),
    sourceAgeMs: Math.round(r.sourceAgeMs),
    confidence: Number(r.confidence.toFixed(2)),
    rawPositionMasked: _mask(_cur?.lat ?? null, _cur?.lon ?? null, _cur?.accuracyM ?? null),
    renderedPositionMasked: _mask(r.lat, r.lon, null),
    sampleCount: _sampleCount,
    snapCorrectionCount: _snapCount,
    duplicateMotionRuntimeCount: Math.max(0, _feederCount - 1),
    reason: r.reason,
  };
}

/** React aboneliği — yalnız YENİ ÖRNEK geldiğinde tetiklenir (RAF değil). */
export function useMarkerMotionSampleTick(): number {
  const [n, setN] = useState(_sampleCount);
  useEffect(() => {
    const fn = () => setN(_sampleCount);
    _listeners.add(fn);
    fn();
    return () => { _listeners.delete(fn); };
  }, []);
  return n;
}

/** Navigasyon bitti / oturum kapandı → hareket geçmişi temizlenir. */
export function resetMarkerMotion(): void {
  _prev = null;
  _cur = null;
  _lastBearing = null;
}

/** @internal — testler arası izolasyon (sayaçlar dahil). */
export function _resetMarkerMotionForTest(): void {
  resetMarkerMotion();
  _sampleCount = 0;
  _snapCount = 0;
  _feederCount = 0;
  _listeners.clear();
}

/** @internal — `SNAP_CORRECTION` sayacı runtime tarafından işaretlenir. */
export function _noteSnapCorrection(): void { _snapCount++; }
