/**
 * cameraDirection.ts — Kameranın yola göre yönünü HAREKETTEN ölçer (SAF).
 *
 * Fizik: araç ileri giderken yerdeki bir nokta öne bakan kameraya YAKLAŞIR →
 * görüntüde ufuktan uzaklaşıp AŞAĞI iner. Geri görüş kamerasında aynı nokta
 * UZAKLAŞIR → ufka doğru YUKARI çıkar. Araç içine bakan kamerada sahne araçla
 * birlikte hareket eder → akış YOK (oy çıkmaz, kamera doğrulanmaz).
 *
 * Ölçüm: küçük gri karede (96×54) üç yatay yer bandında ardışık kareler arası
 * dikey kaymanın işareti (blok SAD). Bant ayrımı hız aralığını kapsar: yavaşta
 * alt bant, hızlıda üst bant ölçülebilir kayma verir. Titreşim / yunuslama iki
 * yönde simetrik gürültüdür; en az oy + %80 çoğunluk kuralı onu eler.
 *
 * I/O · timer · global durum YOK.
 */

export const DIR_MIN_SPEED_KMH = 20;
/** Yer bantları (normalize y) — ufkun altı, kaputun üstü. */
export const DIR_BANDS: ReadonlyArray<readonly [number, number]> = [[0.52, 0.64], [0.64, 0.76], [0.76, 0.88]];
export const DIR_MAX_SHIFT = 6;
/** En iyi kaymanın sıfır kaymaya göre en az göreli iyileşmesi. */
export const DIR_MIN_GAIN = 0.12;
/** Bant içi en düşük ortalama dikey gradyan (gri düzey) — dokusuz asfaltta oy yok. */
export const DIR_MIN_TEXTURE = 3;
export const DIR_MIN_VOTES = 40;
export const DIR_AGREEMENT = 0.8;
/** Bu kadar oya rağmen hüküm çıkmazsa (karışık kanıt) baştan sayılır. */
export const DIR_RESET_VOTES = DIR_MIN_VOTES * 4;

export interface LumaFrame {
  readonly w: number;
  readonly h: number;
  readonly data: Uint8Array;
}

/**
 * Bir bandın kare-arası dikey kayması (px, + = aşağı). Hareket yoksa 0;
 * doku yetersiz ya da en iyi kayma belirgin değilse `null`.
 */
export function bandShift(
  prev: LumaFrame, cur: LumaFrame, y0n: number, y1n: number, maxShift = DIR_MAX_SHIFT,
): number | null {
  if (prev.w !== cur.w || prev.h !== cur.h) return null;
  const { w, h } = cur;
  const a = prev.data;
  const b = cur.data;
  const y0 = Math.max(maxShift + 1, Math.floor(y0n * h));
  const y1 = Math.min(h - 1 - maxShift, Math.ceil(y1n * h));
  if (y1 - y0 < 2) return null;

  let tex = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = 0; x < w; x++) tex += Math.abs(b[y * w + x] - b[(y - 1) * w + x]);
  }
  if (tex / ((y1 - y0) * w) < DIR_MIN_TEXTURE) return null;

  const sad = (d: number): number => {
    let s = 0;
    for (let y = y0; y < y1; y++) {
      const ry = (y - d) * w;
      const cy = y * w;
      for (let x = 0; x < w; x++) s += Math.abs(b[cy + x] - a[ry + x]);
    }
    return s;
  };
  const s0 = sad(0);
  let best = 0;
  let bestSad = s0;
  for (let d = -maxShift; d <= maxShift; d++) {
    if (d === 0) continue;
    const v = sad(d);
    if (v < bestSad) { bestSad = v; best = d; }
  }
  if (best === 0) return 0;
  if (!(s0 > 0) || (s0 - bestSad) / s0 < DIR_MIN_GAIN) return null;
  return best;
}

export interface DirectionVoter {
  /** Doku aşağı aktı (öne bakan kamera kanıtı). */
  readonly down: number;
  /** Doku yukarı aktı (geri görüş kamerası kanıtı). */
  readonly up: number;
}

export const EMPTY_VOTER: DirectionVoter = { down: 0, up: 0 };

/** Bir kare çiftinden oy (bantların çoğunluğu); koşul yoksa voter aynen döner. */
export function voteDirection(
  v: DirectionVoter, prev: LumaFrame | null, cur: LumaFrame | null, speedKmh: number | null,
): DirectionVoter {
  if (!prev || !cur || speedKmh === null || !(speedKmh >= DIR_MIN_SPEED_KMH)) return v;
  let down = 0;
  let up = 0;
  for (const [y0, y1] of DIR_BANDS) {
    const s = bandShift(prev, cur, y0, y1);
    if (s === null || s === 0) continue;
    if (s > 0) down++; else up++;
  }
  if (down === up) return v;
  const next = down > up ? { ...v, down: v.down + 1 } : { ...v, up: v.up + 1 };
  if (next.down + next.up >= DIR_RESET_VOTES && directionVerdict(next) === null) return EMPTY_VOTER;
  return next;
}

/** Yeterli ve tutarlı kanıt varsa hüküm; yoksa `null`. */
export function directionVerdict(v: DirectionVoter): 'forward' | 'backward' | null {
  const n = v.down + v.up;
  if (n < DIR_MIN_VOTES) return null;
  if (v.down / n >= DIR_AGREEMENT) return 'forward';
  if (v.up / n >= DIR_AGREEMENT) return 'backward';
  return null;
}

/** 0–1 kanıt birikimi (arayüz ilerlemesi). */
export function directionProgress(v: DirectionVoter): number {
  return Math.max(0, Math.min(1, (v.down + v.up) / DIR_MIN_VOTES));
}
