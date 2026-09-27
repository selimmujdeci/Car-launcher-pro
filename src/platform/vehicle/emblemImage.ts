/**
 * emblemImage — kullanıcının kendi amblem görselini cihazda hazırlar:
 * 256×256 kareye ortalar, düz renkli arka planı (varsa) saydam yapar, PNG
 * data URL döner. Ağ yok; görsel yalnız araç profiline (cihazda) yazılır.
 */

export const EMBLEM_SIZE = 256;

/**
 * Köşe piksellerinin ortalaması "düz arka plan" ise, ona yakın pikselleri saydam
 * yapar. Köşeler birbirinden farklıysa (fotoğraf/gradyan) DOKUNMAZ — yanlışlıkla
 * amblemi silmektense arka planı bırakmak tercih edilir. Değişti mi döner.
 */
export function removeFlatBackground(data: Uint8ClampedArray, w: number, h: number, tol = 36): boolean {
  const at = (x: number, y: number) => (y * w + x) * 4;
  const corners = [at(0, 0), at(w - 1, 0), at(0, h - 1), at(w - 1, h - 1)];
  if (corners.some((i) => data[i + 3]! < 200)) return false;           // zaten saydam
  const avg = [0, 1, 2].map((c) => corners.reduce((s, i) => s + data[i + c]!, 0) / 4);
  const dist = (i: number) => Math.hypot(data[i]! - avg[0]!, data[i + 1]! - avg[1]!, data[i + 2]! - avg[2]!);
  if (corners.some((i) => dist(i) > tol / 2)) return false;           // düz değil

  let changed = false;
  for (let i = 0; i < data.length; i += 4) {
    const d = dist(i);
    if (d <= tol) { data[i + 3] = 0; changed = true; }
    else if (d <= tol * 1.6) {                                          // kenarda yumuşak geçiş
      data[i + 3] = Math.round(data[i + 3]! * ((d - tol) / (tol * 0.6)));
      changed = true;
    }
  }
  return changed;
}

/** Dosyayı yükler, ortalar, arka planı temizler → PNG data URL. */
export async function prepareEmblemImage(file: Blob): Promise<string> {
  const bmp = await createImageBitmap(file);
  const canvas = document.createElement('canvas');
  canvas.width = EMBLEM_SIZE; canvas.height = EMBLEM_SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas');
  const k = Math.min(EMBLEM_SIZE / bmp.width, EMBLEM_SIZE / bmp.height) * 0.9;
  const dw = bmp.width * k, dh = bmp.height * k;
  ctx.drawImage(bmp, (EMBLEM_SIZE - dw) / 2, (EMBLEM_SIZE - dh) / 2, dw, dh);
  bmp.close?.();
  // Kanvas köşeleri boş (saydam) → arka plan tespiti yalnız çizilen alanda yapılır.
  const x0 = Math.round((EMBLEM_SIZE - dw) / 2), y0 = Math.round((EMBLEM_SIZE - dh) / 2);
  const cw = Math.max(1, Math.round(dw)), ch = Math.max(1, Math.round(dh));
  const inner = ctx.getImageData(x0, y0, cw, ch);
  if (removeFlatBackground(inner.data, cw, ch)) ctx.putImageData(inner, x0, y0);
  return canvas.toDataURL('image/png');
}
