/**
 * AR Projeksiyon Servisi — Lane Departure Warning + Perspektif Projeksiyon
 *
 * Pseudo-CV tabanlı LDW: kamera pikseli analizi mümkün olmadığından,
 * navigasyon şeridi heading'i ile araç heading'i arasındaki sapma
 * ±5/±3 derece hysteresis ile şerit ihlali olarak işlenir.
 *
 * Hız-Perspektif: UnifiedVehicleStore.speed'e göre Three.js PerspectiveCamera
 * FOV'u dinamik güncellenir (hız arttıkça vanishing point ileri kayar).
 */

import { useUnifiedVehicleStore } from './vehicleDataLayer/UnifiedVehicleStore';

// ── LDW hysteresis eşikleri ───────────────────────────────────────────────────
const LDW_ON_DEG  = 5;   // sapma bu değeri geçince ihlal başlar
const LDW_OFF_DEG = 3;   // sapma bu değerin altına inince ihlal biter (anti-chatter)

// ── Hız → FOV haritalaması ────────────────────────────────────────────────────
const FOV_STOPPED_DEG = 48;   // 0 km/h — geniş açı, yakın vanishing point
const FOV_HIGHWAY_DEG = 22;   // 130+ km/h — dar açı, uzak vanishing point
const SPEED_CLAMP_KMH = 130;

// ── 10 Hz tick ────────────────────────────────────────────────────────────────
const TICK_INTERVAL_MS = 100;

export interface LDWState {
  departing:    boolean;
  deviationDeg: number;           // pozitif = sağa, negatif = sola
  side:         'left' | 'right' | 'none';
}

export interface ARProjectionParams {
  fovDeg:             number;  // Three.js PerspectiveCamera FOV
  vanishingDistanceM: number;  // dünya biriminde vanishing point mesafesi
}

type LDWSubscriber = (state: LDWState) => void;

// ── Module state ──────────────────────────────────────────────────────────────
let _ldwDeparting:     boolean = false;
let _currentDeviation: number  = 0;
let _laneHeadingDeg:   number | null = null;
let _tickInterval:     ReturnType<typeof setInterval> | null = null;
let _refCount:         number = 0;
const _subscribers:    Set<LDWSubscriber> = new Set();

// ── Helpers ───────────────────────────────────────────────────────────────────

/** İki heading arasındaki fark: −180..+180 (pozitif = saat yönü = sağa sapma) */
function angleDiff(from: number, to: number): number {
  return ((to - from + 540) % 360) - 180;
}

// ── Public API ────────────────────────────────────────────────────────────────

/** Hızı Three.js FOV derecesine dönüştürür. */
export function speedToFov(speedKmh: number): number {
  const t = Math.max(0, Math.min(speedKmh, SPEED_CLAMP_KMH)) / SPEED_CLAMP_KMH;
  return FOV_STOPPED_DEG - t * (FOV_STOPPED_DEG - FOV_HIGHWAY_DEG);
}

/** Anlık hıza göre AR projeksiyon parametrelerini döndürür. */
export function getARProjectionParams(): ARProjectionParams {
  const speedKmh = useUnifiedVehicleStore.getState().speed ?? 0;
  return {
    fovDeg:             speedToFov(speedKmh),
    vanishingDistanceM: Math.max(20, 20 + speedKmh * 0.7), // 20 m (0) → 111 m (130 km/h)
  };
}

/** Anlık LDW durumunu döndürür (non-reactive snapshot). */
export function getLDWState(): LDWState {
  const side: 'left' | 'right' | 'none' = _ldwDeparting
    ? (_currentDeviation > 0 ? 'right' : 'left')
    : 'none';
  return { departing: _ldwDeparting, deviationDeg: _currentDeviation, side };
}

/**
 * Beklenen şerit/rota heading'ini ayarlar.
 * NavigationService'den headingToDestination; navigasyon yoksa null.
 */
export function setLaneHeading(deg: number | null): void {
  _laneHeadingDeg = deg;
}

/** LDW durum değişikliklerine abone ol. Hemen mevcut durumu iletir. */
export function subscribeLDW(fn: LDWSubscriber): () => void {
  _subscribers.add(fn);
  fn(getLDWState());
  return () => { _subscribers.delete(fn); };
}

/**
 * AR servisini kullanmaya başla — ref-count tabanlı.
 * Son bileşen ayrılınca tick interval otomatik durur (Zero-Leak).
 * Döndürülen fonksiyonu unmount'ta çağır.
 */
export function acquireARService(): () => void {
  _refCount++;
  if (_tickInterval === null) {
    _tickInterval = setInterval(_tickLDW, TICK_INTERVAL_MS);
  }
  return () => {
    _refCount = Math.max(0, _refCount - 1);
    if (_refCount === 0 && _tickInterval !== null) {
      clearInterval(_tickInterval);
      _tickInterval = null;
    }
  };
}

// ── LDW tick (10 Hz) ──────────────────────────────────────────────────────────

function _tickLDW(): void {
  const { heading } = useUnifiedVehicleStore.getState();

  if (heading === null || _laneHeadingDeg === null) {
    if (_ldwDeparting) {
      _ldwDeparting     = false;
      _currentDeviation = 0;
      _notify();
    }
    return;
  }

  const dev     = angleDiff(_laneHeadingDeg, heading);
  const absDev  = Math.abs(dev);
  const prevDep = _ldwDeparting;
  const prevDev = _currentDeviation;
  _currentDeviation = dev;

  // Hysteresis: ayrı ON/OFF eşikleri → titreşme önlenir
  if (!_ldwDeparting && absDev > LDW_ON_DEG) {
    _ldwDeparting = true;
  } else if (_ldwDeparting && absDev < LDW_OFF_DEG) {
    _ldwDeparting = false;
  }

  if (_ldwDeparting !== prevDep || Math.abs(_currentDeviation - prevDev) > 0.5) {
    _notify();
  }
}

function _notify(): void {
  const state = getLDWState();
  _subscribers.forEach(fn => fn(state));
}
