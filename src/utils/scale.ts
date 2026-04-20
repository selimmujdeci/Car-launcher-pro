const BASE_W = 1280;
const BASE_H = 720;

let _w = typeof window !== 'undefined' ? window.innerWidth : BASE_W;
let _h = typeof window !== 'undefined' ? window.innerHeight : BASE_H;

export function initScale(w: number, h: number) {
  _w = w;
  _h = h;
}

/** Horizontal scale relative to 1280px baseline */
export function scale(n: number): number {
  return Math.round((n * _w) / BASE_W);
}

/** Vertical scale relative to 720px baseline */
export function verticalScale(n: number): number {
  return Math.round((n * _h) / BASE_H);
}

/**
 * Moderate scale — blends horizontal scale with original size.
 * factor=0 → no scaling, factor=1 → full scale(), factor=0.5 → balanced.
 */
export function moderateScale(n: number, factor = 0.5): number {
  return Math.round(n + (scale(n) - n) * factor);
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
