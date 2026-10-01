/**
 * frameSampler.ts — İşleme video'sundan küçük gri kare (yön doğrulaması için).
 *
 * 96×54 tek kanal: kare başına ~5 bin piksel, ana iş parçacığında ihmal
 * edilebilir maliyet. Tuval yoksa (eski WebView / test ortamı) `null` döner —
 * yön doğrulanamaz ve uyarı verilmez (fail-closed).
 */
import type { LumaFrame } from './cameraDirection';

export interface LumaSampler {
  sample(video: HTMLVideoElement | null): LumaFrame | null;
  dispose(): void;
}

export function createLumaSampler(w = 96, h = 54): LumaSampler {
  let ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null = null;
  try {
    if (typeof OffscreenCanvas !== 'undefined') {
      ctx = new OffscreenCanvas(w, h).getContext('2d', { willReadFrequently: true });
    } else if (typeof document !== 'undefined') {
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      ctx = c.getContext('2d', { willReadFrequently: true });
    }
  } catch {
    ctx = null;
  }
  return {
    sample(video) {
      if (!ctx || !video || video.readyState < 2 || !video.videoWidth) return null;
      try {
        ctx.drawImage(video, 0, 0, w, h);
        const rgba = ctx.getImageData(0, 0, w, h).data;
        const data = new Uint8Array(w * h);
        for (let i = 0, j = 0; i < data.length; i++, j += 4) {
          data[i] = (rgba[j] * 77 + rgba[j + 1] * 150 + rgba[j + 2] * 29) >> 8;
        }
        return { w, h, data };
      } catch {
        return null;
      }
    },
    dispose() { ctx = null; },
  };
}
