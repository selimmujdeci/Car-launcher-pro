/**
 * altLowerBound.ts — ALT (landmark) ALT SINIRI: SAF matematik.
 *
 * I/O yok · zamanlayıcı yok · global durum yok · React yok. Kanonik A*'ın
 * sezgiseli bu modüldeki tek fonksiyonu çağırır; ön işleme artefaktını
 * `scripts/build-rtg4-alt.ts` üretir.
 *
 * ── SÖZLEŞME ──────────────────────────────────────────────────────────────
 * Yönlü üçgen eşitsizliği, hedef `t` ve düğüm `v` için:
 *     d(v→t) ≥ d(v→L) − d(t→L)
 *     d(v→t) ≥ d(L→t) − d(L→v)
 * Her iki kol da her landmark için denenir, en büyüğü döndürülür.
 *
 * ── NEDEN FAZLA TAHMİN EDEMEZ (ÜÇ KATMANLI GARANTİ) ───────────────────────
 * 1. Ön işleme metriği EN GEVŞEK graftır: yalnız tek yön uygulanır; dönüş
 *    yasağı, via-way zinciri ve destination-only cezası UYGULANMAZ. Kanonik
 *    A*'ın gerçek maliyeti bu metrikten küçük olamaz.
 * 2. Mesafeler `scaleM` metrelik kovalara AŞAĞI yuvarlanmıştır. Kova `b` olan
 *    gerçek mesafe `[b·s, (b+1)·s)` aralığındadır; bu yüzden her kolda
 *    `(b_a − b_b − 1)·s` kullanılır — belirsizlik DAİMA sınırın aleyhinedir.
 * 3. Bilinmeyen (`unreachable`) terim sınıra HİÇ katılmaz; uydurma değer
 *    üretilmez.
 */

/** Dilim düzeni: düğüm başına `[d(L0→v), d(v→L0), d(L1→v), d(v→L1), …]`. */
export const ALT_SLICE_STRIDE_PER_LANDMARK = 2;

export interface AltTargetRow {
  /** Landmark başına `d(L→t)` kovası. */
  readonly fromLandmark: Uint16Array;
  /** Landmark başına `d(t→L)` kovası. */
  readonly toLandmark: Uint16Array;
}

/**
 * `v` düğümünden hedefe kalan yolun ALT sınırı (metre). Kanıt eksikse `0`
 * döner — yani sınır KATKI VERMEZ, asla uydurulmaz.
 */
export function altLowerBoundM(
  window: Uint16Array | null,
  node: number,
  landmarkCount: number,
  scaleM: number,
  unreachable: number,
  target: AltTargetRow | null,
): number {
  if (window === null || target === null || landmarkCount <= 0 || scaleM <= 0) return 0;
  if (node < 0) return 0;
  const stride = landmarkCount * ALT_SLICE_STRIDE_PER_LANDMARK;
  const base = node * stride;
  if (base < 0 || base + stride > window.length) return 0;      // dilim eksik → katkı YOK
  const { fromLandmark, toLandmark } = target;
  if (fromLandmark.length < landmarkCount || toLandmark.length < landmarkCount) return 0;
  let best = 0;
  for (let i = 0; i < landmarkCount; i++) {
    const dLv = window[base + i * 2];          // d(L→v)
    const dvL = window[base + i * 2 + 1];      // d(v→L)
    const dLt = fromLandmark[i];               // d(L→t)
    const dtL = toLandmark[i];                 // d(t→L)
    if (dvL !== unreachable && dtL !== unreachable) {
      const bound = (dvL - dtL - 1) * scaleM;
      if (bound > best) best = bound;
    }
    if (dLt !== unreachable && dLv !== unreachable) {
      const bound = (dLt - dLv - 1) * scaleM;
      if (bound > best) best = bound;
    }
  }
  return best;
}
