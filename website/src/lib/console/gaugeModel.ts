/**
 * RADYAL GÖSTERGE MODELİ — saf matematik (#662).
 *
 * I/O · timer · `Date.now` · global durum · React importu YOK.
 *
 * Kadran sözleşmesi: -132° … +132° (270° toplam), 0° = yukarı (12 yönü).
 * SVG koordinatında açı saat yönünde artar ve 0° yukarıyı gösterecek şekilde
 * kaydırılır.
 *
 * KANIT YOKSA İBRE ORTAYA YASLANMAZ: değer `null` iken ibre başlangıç
 * açısına (-132°) düşer ve gri kalır. Ortalama/varsayılan bir değere
 * yaslanmak, ölçüm yokken ölçüm varmış izlenimi verir — bu yasaktır.
 */

export const GAUGE_START_DEG = -132;
export const GAUGE_END_DEG = 132;
export const GAUGE_SWEEP_DEG = GAUGE_END_DEG - GAUGE_START_DEG;

export type BandTone = 'critical' | 'warning' | 'verified' | 'unknown';

export interface GaugeBand {
  /** Bant başlangıcı (değer birimi). */
  readonly from: number;
  /** Bant sonu (değer birimi). */
  readonly to: number;
  readonly tone: BandTone;
}

export interface GaugeScale {
  readonly min: number;
  readonly max: number;
  readonly bands: readonly GaugeBand[];
}

/** Değeri [0,1] aralığına sıkıştırır — ölçek dışı değer kadranı taşırmaz. */
export function normalize(value: number, min: number, max: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(min) || !Number.isFinite(max)) return 0;
  if (max <= min) return 0;
  const t = (value - min) / (max - min);
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

/**
 * Değer → ibre açısı. `null` (kanıt yok) → başlangıç açısı.
 * Ölçüm yokken ibre ASLA ortaya gitmez.
 */
export function valueToAngle(value: number | null, min: number, max: number): number {
  if (value === null || !Number.isFinite(value)) return GAUGE_START_DEG;
  return GAUGE_START_DEG + normalize(value, min, max) * GAUGE_SWEEP_DEG;
}

/** Kutupsal → kartezyen. `angleDeg` 0 = yukarı, saat yönünde artar. */
export function polarToXY(
  cx: number,
  cy: number,
  radius: number,
  angleDeg: number,
): { x: number; y: number } {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + radius * Math.cos(rad), y: cy + radius * Math.sin(rad) };
}

/** SVG yay `d` yolu — iki açı arasında tek yay komutu. */
export function describeArc(
  cx: number,
  cy: number,
  radius: number,
  startDeg: number,
  endDeg: number,
): string {
  const start = polarToXY(cx, cy, radius, startDeg);
  const end = polarToXY(cx, cy, radius, endDeg);
  const largeArc = Math.abs(endDeg - startDeg) > 180 ? 1 : 0;
  const sweep = endDeg >= startDeg ? 1 : 0;
  return `M ${start.x.toFixed(3)} ${start.y.toFixed(3)} A ${radius} ${radius} 0 ${largeArc} ${sweep} ${end.x.toFixed(3)} ${end.y.toFixed(3)}`;
}

/** Bandın kadran üzerindeki açı aralığı. */
export function bandAngles(
  band: GaugeBand,
  min: number,
  max: number,
): { start: number; end: number } {
  return {
    start: valueToAngle(band.from, min, max),
    end: valueToAngle(band.to, min, max),
  };
}

/** Kadran çizgisi açıları — eşit aralıklı `count` adet (uçlar dahil). */
export function tickAngles(count: number): number[] {
  if (count < 2) return [GAUGE_START_DEG, GAUGE_END_DEG];
  const out: number[] = [];
  for (let i = 0; i < count; i += 1) {
    out.push(GAUGE_START_DEG + (i / (count - 1)) * GAUGE_SWEEP_DEG);
  }
  return out;
}

/** Değerin hangi banda düştüğü — bant yoksa `unknown`. */
export function toneForValue(
  value: number | null,
  bands: readonly GaugeBand[],
): BandTone {
  if (value === null || !Number.isFinite(value)) return 'unknown';
  for (const band of bands) {
    const lo = Math.min(band.from, band.to);
    const hi = Math.max(band.from, band.to);
    if (value >= lo && value <= hi) return band.tone;
  }
  return 'unknown';
}

/* ── Ürün ölçekleri ────────────────────────────────────────────────────────
   Eşikler ürünün başka yerlerinde kullanılan değerlerle uyumludur; burada
   YENİ bir otorite kurulmaz, yalnız GÖSTERİM ölçeği tanımlanır. */

/** Akü voltajı — 12 V kurşun-asit aralığı. */
export const BATTERY_SCALE: GaugeScale = {
  min: 10,
  max: 15,
  bands: [
    { from: 10,   to: 11.8, tone: 'critical' },
    { from: 11.8, to: 12.2, tone: 'warning'  },
    { from: 12.2, to: 14.8, tone: 'verified' },
    { from: 14.8, to: 15,   tone: 'warning'  },
  ],
};

/** GPS tazeliği — saniye. Küçük iyi; 10 sn üstü kadranı doldurur. */
export const GPS_FRESHNESS_SCALE: GaugeScale = {
  min: 0,
  max: 10,
  bands: [
    { from: 0, to: 3,  tone: 'verified' },
    { from: 3, to: 6,  tone: 'warning'  },
    { from: 6, to: 10, tone: 'critical' },
  ],
};

/** Motor sıcaklığı — °C. */
export const ENGINE_TEMP_SCALE: GaugeScale = {
  min: 60,
  max: 130,
  bands: [
    { from: 60,  to: 75,  tone: 'warning'  },
    { from: 75,  to: 100, tone: 'verified' },
    { from: 100, to: 110, tone: 'warning'  },
    { from: 110, to: 130, tone: 'critical' },
  ],
};
