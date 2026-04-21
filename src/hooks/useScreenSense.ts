/**
 * useScreenSense — Adaptive screen aspect-ratio tracker
 *
 * Ekranın genişlik/yükseklik oranını 4 kategoriye ayırır ve
 * document.documentElement'e data-screen-ratio attr olarak yazar.
 * ResizeObserver ile runtime'da güncellenir (Zero-Leak: disconnect ile temizlenir).
 *
 * Kategoriler:
 *   portrait   — ar < 1.0  (dikey, telefon/tablet)
 *   square     — 1.0 ≤ ar < 1.4  (~4:3, eski 7" HU)
 *   wide       — 1.4 ≤ ar < 2.0  (16:9, standart HU)
 *   ultra-wide — ar ≥ 2.0  (21:9+, premium HU / dual screen)
 */

import { useState, useEffect } from 'react';

export type ScreenRatio = 'portrait' | 'square' | 'wide' | 'ultra-wide';

export interface ScreenSense {
  ratio:       ScreenRatio;
  aspectRatio: number;
  width:       number;
  height:      number;
}

function classifyRatio(w: number, h: number): ScreenRatio {
  const ar = w / h;
  if (ar < 1.0) return 'portrait';
  if (ar < 1.4) return 'square';
  if (ar < 2.0) return 'wide';
  return 'ultra-wide';
}

function snapshot(): ScreenSense {
  const w = window.innerWidth;
  const h = window.innerHeight;
  return { ratio: classifyRatio(w, h), aspectRatio: w / h, width: w, height: h };
}

export function useScreenSense(): ScreenSense {
  const [sense, setSense] = useState<ScreenSense>(snapshot);

  useEffect(() => {
    // DOM initial sync
    document.documentElement.setAttribute('data-screen-ratio', snapshot().ratio);

    const update = () => {
      const next = snapshot();
      setSense((prev) => {
        if (prev.ratio === next.ratio && prev.width === next.width && prev.height === next.height) return prev;
        document.documentElement.setAttribute('data-screen-ratio', next.ratio);
        return next;
      });
    };

    const ro = new ResizeObserver(update);
    ro.observe(document.documentElement);
    return () => ro.disconnect();
  }, []);

  return sense;
}
