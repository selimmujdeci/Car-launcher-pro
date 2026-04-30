/**
 * visionUtils.ts — Vision Engine yardımcı fonksiyonları.
 *
 * Saf (pure) matematik ve interpolasyon yardımcıları.
 * Bağımlılık yok — herhangi bir vision modülü güvenle import alabilir.
 */

/** Değeri [0, 1] aralığına kırp */
export function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/** Doğrusal interpolasyon (sayılar arası) */
export function lerpNum(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Piksel noktaları arasında doğrusal interpolasyon; null'lar için güvenli */
export function lerpPt(
  a: { x: number; y: number } | null,
  b: { x: number; y: number } | null,
  t: number,
): { x: number; y: number } | null {
  if (!a && !b) return null;
  if (!a) return b;
  if (!b) return a;
  return { x: lerpNum(a.x, b.x, t), y: lerpNum(a.y, b.y, t) };
}
