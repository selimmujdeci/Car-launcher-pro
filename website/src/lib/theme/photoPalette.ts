/**
 * photoPalette — FOTOĞRAFTAN TEMA (kullanıcı isteği 2026-09-26, Samsung Theme Park deseni).
 *
 * Fotoğraf CİHAZDA küçültülüp piksellerine bakılır; hiçbir yere yüklenmez.
 * Buradan yalnız 1-3 baskın RENK çıkar; palet mevcut `buildColorPreset` ile
 * kurulur → okunabilirlik disiplini (yazı/zemin, vurgu/kart) hazır taslaklarla
 * AYNIDIR. Yeni tema motoru YOK.
 *
 * Belirgin renk yoksa (gri/siyah/beyaz ağırlıklı fotoğraf) boş döner — zorlama
 * tema üretilmez.
 */
import { hsvToRgb, rgbaToHex, rgbToHsv } from './colorMath';
import { buildColorPreset, type ColorPreset } from './themePresets';

export interface PhotoColor {
  readonly hex: string;
  /** 0-360 */
  readonly hue: number;
  /** 0-1 */
  readonly sat: number;
  /** Renkli piksellerin içindeki payı (0-1). */
  readonly share: number;
}

const BUCKETS = 24;               // 15°'lik ton dilimleri
const MIN_SAT = 0.2;              // bunun altı gri sayılır
const MIN_V = 0.15;               // çok karanlık piksel ton taşımaz
const MIN_COLORFUL_SHARE = 0.06;  // renkli piksel oranı bunun altındaysa "belirgin renk yok"

/**
 * RGBA piksel dizisinden baskın renkler (en fazla `max`). Dilim ağırlığı
 * doygunluğun karesiyle çarpılır — geniş ama soluk bir gökyüzü, küçük ama canlı
 * bir kırmızı arabayı ezmesin.
 */
export function extractPhotoColors(px: ArrayLike<number>, max = 3): PhotoColor[] {
  const w = new Array<number>(BUCKETS).fill(0);
  const acc = Array.from({ length: BUCKETS }, () => ({ r: 0, g: 0, b: 0, n: 0 }));
  let total = 0; let colorful = 0;
  for (let i = 0; i + 3 < px.length; i += 4) {
    if (px[i + 3] < 128) continue;
    total++;
    const r = px[i], g = px[i + 1], b = px[i + 2];
    const hsv = rgbToHsv({ r, g, b, a: 1 });
    if (hsv.s < MIN_SAT || hsv.v < MIN_V) continue;
    colorful++;
    const k = Math.floor(((hsv.h % 360) / 360) * BUCKETS) % BUCKETS;
    /* Doygunluğun KARESİ: geniş ama orta doygun gökyüzü (s≈0.37), küçük ama canlı
       kırmızı arabayı eziyordu (yerel denemede kırmızı araba → mavi palet). */
    w[k] += hsv.s * hsv.s * (0.5 + hsv.v / 2);
    acc[k].r += r; acc[k].g += g; acc[k].b += b; acc[k].n++;
  }
  if (total === 0 || colorful / total < MIN_COLORFUL_SHARE) return [];
  const order = w.map((v, k) => ({ v, k })).filter((x) => x.v > 0).sort((a, b) => b.v - a.v);
  const out: PhotoColor[] = [];
  for (const { k } of order) {
    if (out.length >= max) break;
    const a = acc[k];
    const avg = { r: Math.round(a.r / a.n), g: Math.round(a.g / a.n), b: Math.round(a.b / a.n), a: 1 };
    const hsv = rgbToHsv(avg);
    // Komşu tonlar (±30°) aynı renk sayılır — 3 kırmızı tonu yerine 3 farklı renk.
    if (out.some((c) => Math.min(Math.abs(c.hue - hsv.h), 360 - Math.abs(c.hue - hsv.h)) < 30)) continue;
    out.push({ hex: rgbaToHex(avg), hue: hsv.h, sat: hsv.s, share: a.n / colorful });
  }
  return out;
}

/** Vurgu olarak kullanılabilir canlılıkta (ekranda sönük kalmasın). */
function vivid(c: PhotoColor, s = 0.78, v = 0.95): string {
  return rgbaToHex(hsvToRgb({ h: c.hue, s: Math.max(c.sat, s), v, a: 1 }));
}

/** Baskın renklerden 4 palet: Canlı · Sade · Gece · Gündüz. Renk yoksa boş. */
export function palettesFromPhoto(colors: readonly PhotoColor[]): ColorPreset[] {
  const main = colors[0];
  if (!main) return [];
  const second = colors[1] ?? main;
  return [
    buildColorPreset({ id: 'photo-canli', name: 'Canlı', mood: 'Fotoğrafın ana rengi, koyu zemin', mode: 'night',
      accent: vivid(main), hue: main.hue, sat: Math.min(0.6, main.sat) }),
    buildColorPreset({ id: 'photo-sade', name: 'Sade', mood: 'Aynı renk, yumuşak tonlar', mode: 'night',
      accent: vivid(main, 0.45, 0.85), hue: main.hue, sat: Math.min(0.3, main.sat * 0.5) }),
    buildColorPreset({ id: 'photo-gece', name: 'Gece', mood: 'Çok koyu zemin, renk yalnız vurguda', mode: 'night',
      accent: vivid(main), hue: second.hue, sat: 0.12 }),
    buildColorPreset({ id: 'photo-gunduz', name: 'Gündüz', mood: 'Açık zemin, güneşte okunur', mode: 'day',
      accent: vivid(main, 0.85, 0.7), hue: main.hue, sat: Math.min(0.5, main.sat) }),
  ];
}

/**
 * Tarayıcıda: dosyayı küçük bir tuvale çizip pikselleri okur (en uzun kenar 96px).
 * Fotoğraf ağ'a GİTMEZ. Okunamayan dosya → `null`.
 */
export async function readPhotoPixels(file: Blob, edge = 96): Promise<Uint8ClampedArray | null> {
  try {
    const bmp = await createImageBitmap(file);
    const k = Math.min(1, edge / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * k));
    const h = Math.max(1, Math.round(bmp.height * k));
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(bmp, 0, 0, w, h);
    bmp.close?.();
    return ctx.getImageData(0, 0, w, h).data;
  } catch {
    return null;
  }
}
