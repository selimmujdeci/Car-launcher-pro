/**
 * NeuralVisualizer — Crystal Cabin DSP v3 Görselleştirici
 *
 * Web Audio AnalyserNode → Canvas 2D render
 *
 * Görsel katmanlar:
 *  1. Aura Pulse  — Bass (bin 0–4) enerjisiyle dışa yayılan radyal halkalar
 *  2. Neural Trails — Mid/Treble (bin 5–60) merkeze akan sinirsel izler
 *
 * Zero-Leak: playing=false veya unmount → rAF anında iptal, canvas temizlenir.
 * Performance: Ham AudioBuffer işlenmez; yalnızca getByteFrequencyData (hardware DSP).
 */

import { memo, useEffect, useRef, useLayoutEffect } from 'react';
import { getOrCreateAnalyser } from '../../platform/audioService';

/* ── Props ──────────────────────────────────────────────────── */

interface Props {
  playing: boolean;
  /** Medya kaynağı rengi — hex (#rrggbb) */
  color: string;
}

/* ── Renk yardımcısı ─────────────────────────────────────────── */

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

function rgba(rgb: [number, number, number], alpha: number): string {
  return `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${alpha.toFixed(3)})`;
}

/* ── Bileşen ─────────────────────────────────────────────────── */

export const NeuralVisualizer = memo(function NeuralVisualizer({ playing, color }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef    = useRef<number>(0);

  // Canvas çözünürlüğünü container boyutuna eşitle (DPR dahil)
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const setSize = () => {
      const dpr = window.devicePixelRatio || 1;
      const w   = canvas.clientWidth  || 300;
      const h   = canvas.clientHeight || 300;
      if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
        canvas.width  = w * dpr;
        canvas.height = h * dpr;
        const ctx = canvas.getContext('2d');
        ctx?.scale(dpr, dpr);
      }
    };

    setSize();
    const ro = new ResizeObserver(setSize);
    ro.observe(canvas);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // ── Çalma durmuşsa: döngüyü durdur, canvas'ı temizle ─────────
    if (!playing) {
      cancelAnimationFrame(rafRef.current);
      ctx.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
      return;
    }

    // ── Analyser alınamıyorsa DSP henüz başlamamış ────────────────
    const analyser = getOrCreateAnalyser();
    if (!analyser) return;

    const bufferLength = analyser.frequencyBinCount; // fftSize/2 = 128
    const dataArray    = new Uint8Array(bufferLength);
    const rgb          = hexToRgb(color);
    let alive          = true;

    const draw = () => {
      if (!alive) return;
      rafRef.current = requestAnimationFrame(draw);

      analyser.getByteFrequencyData(dataArray);

      const W  = canvas.clientWidth;
      const H  = canvas.clientHeight;
      const CX = W / 2;
      const CY = H / 2;

      // ── Motion blur — yarı şeffaf silme, izleri bırakır ──────────
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = 'rgba(0,0,0,0.18)';
      ctx.fillRect(0, 0, W, H);

      // ── 1. Aura Pulse (Bass: bin 0–4) ────────────────────────────
      // Bins 0-4 ≈ DC + ~170–850 Hz alt tabanı (44100Hz / 256 fftSize)
      let bassSum = 0;
      for (let b = 0; b < 5; b++) bassSum += dataArray[b];
      const bassEnergy = bassSum / (5 * 255); // 0–1

      ctx.globalCompositeOperation = 'lighter'; // additive glow

      for (let ring = 0; ring < 4; ring++) {
        const baseR = Math.min(W, H) * 0.10;
        const r     = baseR + baseR * bassEnergy * (3 + ring * 1.2);
        const alpha = bassEnergy * (0.50 - ring * 0.10);
        if (alpha < 0.01 || r <= 0) continue;

        const grad = ctx.createRadialGradient(CX, CY, r * 0.15, CX, CY, r);
        grad.addColorStop(0,   rgba(rgb, alpha * 0.85));
        grad.addColorStop(0.5, rgba(rgb, alpha * 0.30));
        grad.addColorStop(1,   rgba(rgb, 0));

        ctx.beginPath();
        ctx.arc(CX, CY, r, 0, Math.PI * 2);
        ctx.fillStyle = grad;
        ctx.fill();
      }

      // ── 2. Neural Trails (Mid + Treble: bin 5–60) ────────────────
      // Dışarıdan merkeze doğru akan çizgiler; slow rotation → organik hareket
      const NUM_TRAILS = 80;
      const outerR     = Math.min(W, H) * 0.46;
      const t          = performance.now() * 0.00018; // yavaş döndür

      for (let i = 0; i < NUM_TRAILS; i++) {
        const binIdx = 5 + Math.floor((i / NUM_TRAILS) * Math.min(55, bufferLength - 5));
        const energy = dataArray[binIdx] / 255;
        if (energy < 0.04) continue;

        const angle  = (i / NUM_TRAILS) * Math.PI * 2 + t;
        const innerR = outerR * (1 - Math.pow(energy, 0.7) * 0.90);

        const x1 = CX + Math.cos(angle) * outerR;
        const y1 = CY + Math.sin(angle) * outerR;
        const x2 = CX + Math.cos(angle) * innerR;
        const y2 = CY + Math.sin(angle) * innerR;

        const alpha = Math.pow(energy, 0.55) * 0.65;

        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.strokeStyle = rgba(rgb, alpha);
        ctx.lineWidth   = 1.0 + energy * 1.8;
        ctx.lineCap     = 'round';
        ctx.stroke();
      }
    };

    draw();

    return () => {
      alive = true; // referans: alive=false döngüyü keser
      alive = false;
      cancelAnimationFrame(rafRef.current);
      ctx.globalCompositeOperation = 'source-over';
      ctx.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
    };
  }, [playing, color]);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 w-full h-full pointer-events-none"
      style={{
        zIndex:       1,
        opacity:      0.70,
        mixBlendMode: 'screen',  // album kapağı ile harmanla
      }}
    />
  );
});
