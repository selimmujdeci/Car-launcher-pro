/**
 * arProjectionService — AR Navigasyon Projeksiyon Motoru
 *
 * Navigasyon adımı (nextStep) + araç hızını alıp VisionAROverlay'e
 * hazır ARState üretir. Hafif matematik — RAF döngüsünde her kare
 * çağrılabilir, yeni nesne oluşturmaz.
 *
 * Veri akışı:
 *   VisionAROverlay → updateNavStep() / updateARSpeed()
 *                  ← getARState() (senkron, RAF içinde)
 *                  ← useARState() (React hook, HUD için)
 */

import { useSyncExternalStore } from 'react';

// ── Tipler ────────────────────────────────────────────────────────────────────

export type StepDirection = 'left' | 'right' | 'straight' | 'uturn' | null;

export interface NavStep {
  direction:   StepDirection;
  distanceM:   number;    // bu adıma kalan mesafe (m)
  instruction: string;    // "Sağa dön", "Hedefe devam" …
}

export interface ARState {
  showArrow:       boolean;   // distanceM < ARROW_SHOW_M && direction != null
  direction:       StepDirection;
  distanceM:       number;
  instruction:     string;
  arrowYawRad:     number;    // Three.js group.rotation.y
  arrowScale:      number;    // 1.0 @ 100m → 2.0 @ 20m
  showLDW:         boolean;   // hız > LDW_MIN_KMH
  cameraPitchRad:  number;    // hafif aşağı eğim — hıza göre
}

// ── Sabitler ──────────────────────────────────────────────────────────────────

const ARROW_SHOW_M  = 100;   // ok ne zaman belirecek (m)
const LDW_MIN_KMH   = 60;    // LDW aktifleşme hızı

/** Yön → Three.js Y-ekseni rotasyonu.
 *  Ok varsayılan hali +X'e bakıyor (buildArrow içinde shaft X ekseninde).
 *  Sağ = 0 (zaten +X), Sol = π, Düz = -π/2 (-Z = ileri), Geri = π/2. */
const _YAW_MAP: Record<NonNullable<StepDirection>, number> = {
  right:    0,
  left:     Math.PI,
  straight: -Math.PI / 2,
  uturn:    Math.PI / 2,
};

// ── Modül state ───────────────────────────────────────────────────────────────

let _step: NavStep  = { direction: null, distanceM: 999, instruction: '' };
let _speedKmh       = 0;
const _listeners    = new Set<() => void>();

// ── Projeksiyon hesabı (sıfır allocation) ────────────────────────────────────

/** Her RAF tikinde çağrılır — new nesne oluşturmaz, primitif döner. */
function _compute(): ARState {
  const { direction, distanceM, instruction } = _step;

  // Kamera pitch: hız arttıkça hafif aşağı (ufuk yaklaşır, ok zeminde görünür)
  // 0 km/h → -0.08 rad (~4°) | 120 km/h → -0.18 rad (~10°)
  const pitchExtra    = Math.min(_speedKmh / 120, 1) * 0.10;
  const cameraPitchRad = -(0.08 + pitchExtra);

  // Ok ölçeği: yaklaştıkça büyür (görünürlük + dikkat çekme)
  const arrowScale = direction
    ? Math.min(2.0, Math.max(1.0, 2.0 - distanceM / 50))
    : 1.0;

  return {
    showArrow:      !!direction && distanceM <= ARROW_SHOW_M,
    direction,
    distanceM,
    instruction,
    arrowYawRad:    direction ? _YAW_MAP[direction] : 0,
    arrowScale,
    showLDW:        _speedKmh >= LDW_MIN_KMH,
    cameraPitchRad,
  };
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Navigasyon adımını güncelle — dışarıdan (VisionAROverlay, SystemOrchestrator).
 * null: navigasyon yok / tamamlandı.
 */
export function updateNavStep(step: NavStep | null): void {
  _step = step ?? { direction: null, distanceM: 999, instruction: '' };
  _listeners.forEach((fn) => fn());
}

/**
 * Araç hızını güncelle (km/h).
 * 1 km/h dead-zone: gürültülü GPS sinyali ile gereksiz re-render önlenir.
 */
export function updateARSpeed(kmh: number): void {
  const clamped = Math.max(0, kmh);
  if (Math.abs(clamped - _speedKmh) < 1) return;
  _speedKmh = clamped;
  _listeners.forEach((fn) => fn());
}

/** Senkron, allocation-free okuma — RAF döngüsünde kullan. */
export function getARState(): ARState { return _compute(); }

/** Abonelik — useSyncExternalStore ve manuel için. Zero-Leak: cleanup thunk döner. */
export function subscribeAR(cb: () => void): () => void {
  _listeners.add(cb);
  return () => _listeners.delete(cb);
}

/** React hook — HUD bileşenleri için; her state değişiminde re-render tetikler. */
export function useARState(): ARState {
  return useSyncExternalStore(subscribeAR, _compute, _compute);
}

/* ── HMR cleanup ─────────────────────────────────────────────────────────────── */
if (import.meta.hot) {
  import.meta.hot.dispose(() => { _listeners.clear(); });
}
