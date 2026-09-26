/**
 * routeGlideModel — rotaya oturtulmuş aracın GPS örnekleri ARASINDA rota
 * çizgisi boyunca akıcı ilerlemesi. **SAF.**
 *
 * Saha 2026-09-24 (kullanıcı: "harita yağ gibi akmalı, takıla takıla gidiyor"):
 * cihazda 50 km/sa sürüşte kamera karelerin %68'inde hiç kıpırdamıyordu —
 * oturtulmuş konum yalnız GPS tick'inde (1 Hz) değişiyor, kamera onu ~0,5 sn'de
 * yakalayıp bir sonraki tick'i bekliyordu (git-dur).
 *
 * Kural: son iki örneğin rota-boyu ilerlemesinden hız çıkarılır ve konum rota
 * geometrisi üzerinde ileri kaydırılır (en fazla `GLIDE_MAX_EXTRAP_MS`). Yeni
 * örnek gelince oluşan küçük fark `GLIDE_CORRECT_MS` içinde sönümlenir —
 * geri sıçrama görünmez. Bu YALNIZ ÇİZİM içindir: manevra/ETA/sapma kararları
 * gerçek örnekten verilir, burada üretilen konum hiçbir karara girmez.
 */

export const GLIDE_MAX_EXTRAP_MS = 1_500;
export const GLIDE_CORRECT_MS = 250;
/** Bundan büyük fark (sıçrama) süzülmez — gerçeğe doğrudan geçilir. */
const GLIDE_SNAP_M = 30;
/** Bu aralığın dışındaki örnek çifti hız vermez (eski/çift örnek). */
const PAIR_MIN_MS = 100;
const PAIR_MAX_MS = 3_000;

export interface GlideSample {
  /** Rotanın sonuna kalan mesafe (m). */
  readonly alongRemainingM: number;
  readonly ts: number;
}

export interface GlideState {
  readonly prev: GlideSample | null;
  readonly last: GlideSample | null;
  /** Yeni örnek anında eski eğri ile örnek arasındaki fark (m) — sönümlenir. */
  readonly errM: number;
}

export const EMPTY_GLIDE: GlideState = { prev: null, last: null, errM: 0 };

function _predict(s: GlideState, nowMs: number): number | null {
  const { prev, last } = s;
  if (!last) return null;
  let v = 0;                                          // m/ms, rota sonuna doğru
  if (prev) {
    const dt = last.ts - prev.ts;
    if (dt >= PAIR_MIN_MS && dt <= PAIR_MAX_MS) v = Math.max(0, (prev.alongRemainingM - last.alongRemainingM) / dt);
  }
  const ext = Math.min(Math.max(0, nowMs - last.ts), GLIDE_MAX_EXTRAP_MS);
  return Math.max(0, last.alongRemainingM - v * ext);
}

/**
 * Yeni gerçek örnek. Fark, eski eğrinin ÖRNEK ANINDAKİ değerine göre ölçülür —
 * son çizilen kareye göre değil: o kare örnekten önce çizildiği için aradaki
 * yol "fark" sayılıyor ve her örnekte bir kare DURUYORDU.
 */
export function pushGlideSample(s: GlideState, sample: GlideSample): GlideState {
  const shown = glideAlongAt(s, sample.ts);
  /* Çok yakın ikinci örnek (ör. iki konum kaynağı) hız çiftini sıfırlamasın. */
  const prev = s.last && sample.ts - s.last.ts < PAIR_MIN_MS ? s.prev : s.last;
  const err = shown === null ? 0 : shown - sample.alongRemainingM;
  /* Büyük fark (yeniden rota, sıçrama) sönümlenmez — doğrudan gerçeğe geçilir. */
  return { prev, last: sample, errM: Math.abs(err) <= GLIDE_SNAP_M ? err : 0 };
}

/** Bu karede gösterilecek rota-boyu ilerleme; örnek yoksa `null`. */
export function glideAlongAt(s: GlideState, nowMs: number): number | null {
  const pred = _predict(s, nowMs);
  if (pred === null || !s.last) return null;
  const k = Math.exp(-Math.max(0, nowMs - s.last.ts) / GLIDE_CORRECT_MS);
  return Math.max(0, pred + s.errM * k);
}

/** Rota üzerindeki nokta. `cum[i]` = i. noktadan sona kalan. */
export function pointAtAlongRemaining(
  g: readonly (readonly [number, number])[], cum: ArrayLike<number>, along: number,
): { lat: number; lon: number } | null {
  if (g.length < 2 || cum.length !== g.length || !Number.isFinite(along)) return null;
  const a0 = Math.min(Math.max(along, 0), cum[0]!);
  let lo = 0, hi = g.length - 1;                      // cum azalan
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cum[mid]! >= a0) lo = mid; else hi = mid;
  }
  const a = cum[lo]!, b = cum[hi]!;
  const t = a === b ? 0 : (a - a0) / (a - b);
  const p = g[lo]!, q = g[hi]!;
  return { lon: p[0] + (q[0] - p[0]) * t, lat: p[1] + (q[1] - p[1]) * t };
}
