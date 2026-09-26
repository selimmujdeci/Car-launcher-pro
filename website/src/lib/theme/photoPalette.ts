/**
 * photoPalette — FOTOĞRAFTAN TEMA, Google'ın yöntemiyle (2026-09-26).
 *
 * Renk seçimi ve şema üretimi Google'ın açık kaynak Material Color Utilities
 * kütüphanesiyle yapılır (Android duvar kağıdı renkleriyle AYNI algoritma):
 *   1. Fotoğraf CİHAZDA küçültülür (hiçbir yere yüklenmez).
 *   2. `QuantizerCelebi` → `Score`: fotoğraftan en fazla 4 aday renk. Puan
 *      renk alanının büyüklüğü (%70) + canlılık (%30); griler elenir.
 *   3. Kullanıcı RENGİ seçer (tek renge bahis yok: kırmızı araba + mavi gökyüzü
 *      fotoğrafında ikisi de seçenek olur), sonra STİLİ seçer.
 *   4. Stiller HCT renk uzayında Material şemalarıyla üretilir → kontrast baştan
 *      garantilidir (Material rolleri: onSurface/surface, primary/…).
 *
 * Çıktı mevcut `GlobalTokens` yamasıdır — uygulama, geri alma ve "Araca Gönder"
 * hazır taslaklarla AYNI yoldan geçer. Yeni tema motoru YOK.
 */
import {
  argbFromRgb,
  Hct,
  hexFromArgb,
  QuantizerCelebi,
  SchemeNeutral,
  SchemeTonalSpot,
  SchemeVibrant,
  Score,
  type DynamicScheme,
} from '@material/material-color-utilities';
import type { GlobalTokens, Paint } from './themeManifest';
import type { ColorPreset, PresetMode } from './themePresets';

/** Hiçbir renk uygun değilse Score'un döndürdüğü yedek (Google mavisi) — bunu "fotoğrafın rengi" diye SUNMAYIZ. */
const FALLBACK = 0xff4285f4;

export interface PhotoColor {
  readonly hex: string;
  readonly argb: number;
}

/**
 * RGBA piksel dizisinden Google'ın seçtiği aday renkler (en fazla `max`).
 * Uygun renk yoksa (gri/siyah/beyaz fotoğraf) BOŞ — yedek mavi uydurulmaz.
 */
export function extractPhotoColors(px: ArrayLike<number>, max = 4): PhotoColor[] {
  const argb: number[] = [];
  for (let i = 0; i + 3 < px.length; i += 4) {
    if (px[i + 3] < 255) continue;
    argb.push(argbFromRgb(px[i], px[i + 1], px[i + 2]));
  }
  if (argb.length === 0) return [];
  const population = QuantizerCelebi.quantize(argb, 128);
  const ranked = Score.score(population, { desired: max + 2, fallbackColorARGB: FALLBACK, filter: true });
  const real = ranked.filter((c) => c !== FALLBACK || population.has(FALLBACK));
  /* Google 4'ü doldurmak için ton farkını 15°'ye kadar gevşetir; aynı gökyüzünün
     iki mavi tonu ayrı "renk" gibi görünüyordu (yerel deneme). Göze aynı görünenler
     (ton < 20° VE açıklık < 12) tek seçenek sayılır. */
  const picked: Hct[] = [];
  const out: PhotoColor[] = [];
  for (const c of real) {
    const h = Hct.fromInt(c);
    const dup = picked.some((p) => {
      const dh = Math.min(Math.abs(p.hue - h.hue), 360 - Math.abs(p.hue - h.hue));
      return dh < 20 && Math.abs(p.tone - h.tone) < 12;
    });
    if (dup) continue;
    picked.push(h);
    out.push({ argb: c, hex: hexFromArgb(c) });
    if (out.length >= max) break;
  }
  return out;
}

const solid = (argb: number): Paint =>
  ({ kind: 'solid', from: hexFromArgb(argb), to: null, angle: 180, stopA: 0, stopB: 100, alpha: 100 });

/** Material şeması → CarOS tema yaması (rol eşlemesi). `accentFrom` verilirse vurgu oradan gelir. */
function tokensOf(s: DynamicScheme, accentFrom: DynamicScheme = s): { tokens: Partial<GlobalTokens>; swatch: ColorPreset['swatch'] } {
  const hex = hexFromArgb;
  const accent = hex(accentFrom.primary);
  const bg = s.surface; const card = s.surfaceContainerHigh;
  return {
    tokens: {
      accentPrimary: accent,
      accentSecondary: hex(accentFrom.secondary),
      textPrimary: hex(s.onSurface),
      textSecondary: hex(s.onSurfaceVariant),
      borderColor: hex(s.outlineVariant),
      glowColor: accent,
      iconNav: accent,
      iconMedia: accent,
      iconDock: accent,
      bgPrimary: solid(bg),
      bgCard: solid(card),
    },
    swatch: [hex(bg), hex(card), accent, hex(s.onSurface)],
  };
}

function preset(id: string, name: string, mood: string, mode: PresetMode,
  built: { tokens: Partial<GlobalTokens>; swatch: ColorPreset['swatch'] }): ColorPreset {
  // `ColorPreset` spec alanları (accent/hue/sat) bu yolda yalnız bilgi amaçlıdır.
  return { id, name, mood, mode, accent: built.tokens.accentPrimary ?? '', hue: 0, sat: 0, ...built };
}

/** Seçilen renkten 4 stil: Canlı · Sade · Sürüş · Gündüz. */
export function palettesFromColor(color: PhotoColor): ColorPreset[] {
  const hct = Hct.fromInt(color.argb);
  const vibrantDark = new SchemeVibrant(hct, true, 0);
  return [
    preset('photo-canli', 'Canlı', 'Rengin kendisi, koyu zemin', 'night', tokensOf(vibrantDark)),
    preset('photo-sade', 'Sade', 'Aynı renk, yumuşak tonlar', 'night', tokensOf(new SchemeTonalSpot(hct, true, 0))),
    /* Google'ın araç kuralı: "siyahtan kur" — gri tonlu koyu zemin, TEK vurgu rengi. */
    preset('photo-surus', 'Sürüş', 'Koyu gri zemin, renk yalnız vurguda', 'night',
      tokensOf(new SchemeNeutral(hct, true, 0.5), vibrantDark)),
    preset('photo-gunduz', 'Gündüz', 'Açık zemin, yüksek kontrast', 'day', tokensOf(new SchemeTonalSpot(hct, false, 0.5))),
  ];
}

/**
 * Tarayıcıda: dosyayı küçük bir tuvale çizip pikselleri okur (en uzun kenar 112px).
 * Fotoğraf ağa GİTMEZ. Okunamayan dosya → `null`.
 */
export async function readPhotoPixels(file: Blob, edge = 112): Promise<Uint8ClampedArray | null> {
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
