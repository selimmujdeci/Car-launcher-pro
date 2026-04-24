'use client';

import { useEffect, useRef } from 'react';

// ── Arc geometry constants ────────────────────────────────────────────────
// SVG viewBox: 0 0 128 120  |  circle center: (64, 68)  |  radius: 54
// 270° arc — starts at 7:30 o'clock, sweeps clockwise to 4:30.
// transform="rotate(135 64 68)" positions the dash-array start at 7:30.

const CX = 64, CY = 68, R = 54;
const C_FULL = 2 * Math.PI * R;         // ≈ 339.29 (full circumference)
const C_ARC  = (270 / 360) * C_FULL;   // ≈ 254.47 (270° arc length)
const GATE_MS = 50;                     // 20 Hz update ceiling

// Full-circle SVG path (360° − ε) starting at 3-o'clock
const CIRCLE_PATH = `M ${CX + R} ${CY} A ${R} ${R} 0 1 1 ${CX + R - 0.001} ${CY}`;

// ── Helpers ───────────────────────────────────────────────────────────────

function toFillLen(value: number, min: number, max: number): number {
  const pct = Math.max(0, Math.min(1, (value - min) / (max - min)));
  return pct * C_ARC;
}

// Thresholds: [fraction_0_to_1, color][] — applied in order, last match wins
function pickColor(value: number, min: number, max: number, thresholds: [number, string][]): string {
  const pct = (value - min) / (max - min);
  let color = thresholds[0][1];
  for (const [t, c] of thresholds) {
    if (pct >= t) color = c;
  }
  return color;
}

// ── Gauge config ──────────────────────────────────────────────────────────

interface GaugeConfig {
  label: string;
  unit: string;
  min: number;
  max: number;
  thresholds: [number, string][];  // [fraction, color]
}

const SPEED_CONFIG: GaugeConfig = {
  label: 'HIZ', unit: 'km/h', min: 0, max: 200,
  thresholds: [[0, '#60a5fa'], [0.7, '#f59e0b'], [0.9, '#ef4444']],
};

const RPM_CONFIG: GaugeConfig = {
  label: 'DEVİR', unit: 'rpm', min: 0, max: 8000,
  thresholds: [[0, '#a78bfa'], [0.75, '#f59e0b'], [0.9, '#ef4444']],
};

const FUEL_CONFIG: GaugeConfig = {
  label: 'YAKIT', unit: '%', min: 0, max: 100,
  thresholds: [[0, '#ef4444'], [0.15, '#f59e0b'], [0.5, '#34d399']],
};

const TEMP_CONFIG: GaugeConfig = {
  label: 'ISI', unit: '°C', min: 0, max: 130,
  thresholds: [[0, '#22d3ee'], [0.6, '#34d399'], [0.85, '#f59e0b'], [0.95, '#ef4444']],
};

// ── Internal Gauge component ──────────────────────────────────────────────

interface GaugeProps { value: number; config: GaugeConfig; className?: string }

function Gauge({ value, config, className }: GaugeProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const arcRef  = useRef<SVGPathElement>(null);
  const textRef = useRef<SVGTextElement>(null);

  // Keep latest value accessible inside the stable RAF closure
  const valueRef = useRef(value);
  valueRef.current = value;

  // 20 Hz RAF loop — direct DOM mutation, zero React re-renders
  useEffect(() => {
    const { min, max, unit, thresholds } = config;
    let raf: number;
    let lastTick = 0;

    const tick = (ts: number) => {
      raf = requestAnimationFrame(tick);
      if (ts - lastTick < GATE_MS) return;
      lastTick = ts;

      const v    = valueRef.current;
      const fill = toFillLen(v, min, max);
      const col  = pickColor(v, min, max, thresholds);

      if (arcRef.current) {
        arcRef.current.style.strokeDasharray = `${fill} ${C_FULL}`;
        arcRef.current.style.stroke          = col;
      }
      if (textRef.current) {
        textRef.current.textContent = unit === '%' ? `${Math.round(v)}%` : `${Math.round(v)}`;
      }
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  // config is a module-level constant — stable reference, no re-run needed
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Responsive scaling
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        const scale = Math.min(width / 112, height / 105);
        const svg = container.querySelector('svg');
        if (svg) {
          svg.style.transform = `scale(${scale})`;
          svg.style.transformOrigin = 'center';
        }
      }
    });

    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  const initFill  = toFillLen(value, config.min, config.max);
  const initColor = pickColor(value, config.min, config.max, config.thresholds);

  return (
    <div ref={containerRef} className={`flex items-center justify-center overflow-hidden w-full h-full min-h-[105px] ${className ?? ''}`}>
      <svg
        viewBox="0 0 128 120"
        width="112"
        height="105"
        className="transition-transform duration-200 will-change-transform"
        aria-label={`${config.label} ${Math.round(value)} ${config.unit}`}
      >
        {/* Track (270° grey arc) */}
        <path
          d={CIRCLE_PATH}
          fill="none"
          stroke="rgba(255,255,255,0.08)"
          strokeWidth={7}
          strokeLinecap="round"
          strokeDasharray={`${C_ARC} ${C_FULL - C_ARC}`}
          transform={`rotate(135 ${CX} ${CY})`}
        />

        {/* Progress arc — updated by RAF via style override */}
        <path
          ref={arcRef}
          d={CIRCLE_PATH}
          fill="none"
          stroke={initColor}
          strokeWidth={7}
          strokeLinecap="round"
          strokeDasharray={`${initFill} ${C_FULL}`}
          transform={`rotate(135 ${CX} ${CY})`}
        />

        {/* Numeric value */}
        <text
          ref={textRef}
          x={CX}
          y={config.max >= 1000 ? CY - 1 : CY + 1}
          textAnchor="middle"
          dominantBaseline="middle"
          fontSize={config.max >= 1000 ? 14 : 19}
          fontWeight={700}
          fontFamily="ui-monospace, monospace"
          fill="rgba(255,255,255,0.92)"
        >
          {config.unit === '%' ? `${Math.round(value)}%` : `${Math.round(value)}`}
        </text>

        {/* Unit label (below number, only for non-% units) */}
        {config.unit !== '%' && (
          <text
            x={CX}
            y={CY + 14}
            textAnchor="middle"
            fontSize={8}
            fontFamily="ui-monospace, monospace"
            fill="rgba(255,255,255,0.30)"
          >
            {config.unit}
          </text>
        )}

        {/* Gauge label */}
        <text
          x={CX}
          y={105}
          textAnchor="middle"
          fontSize={8.5}
          fontFamily="ui-monospace, monospace"
          fill="rgba(255,255,255,0.28)"
        >
          {config.label}
        </text>

        {/* Min tick */}
        <text
          x={CX - R - 1}
          y={CY + 16}
          textAnchor="end"
          fontSize={6.5}
          fontFamily="ui-monospace, monospace"
          fill="rgba(255,255,255,0.18)"
        >
          {config.min}
        </text>

        {/* Max tick */}
        <text
          x={CX + R + 1}
          y={CY + 16}
          textAnchor="start"
          fontSize={6.5}
          fontFamily="ui-monospace, monospace"
          fill="rgba(255,255,255,0.18)"
        >
          {config.max}
        </text>
      </svg>
    </div>
  );
}

// ── Public exports ────────────────────────────────────────────────────────

interface PublicProps { value: number; className?: string }

export function SpeedGauge({ value, className }: PublicProps) {
  return <Gauge value={value} config={SPEED_CONFIG} className={className} />;
}

export function RpmGauge({ value, className }: PublicProps) {
  return <Gauge value={value} config={RPM_CONFIG} className={className} />;
}

export function FuelGauge({ value, className }: PublicProps) {
  return <Gauge value={value} config={FUEL_CONFIG} className={className} />;
}

export function TempGauge({ value, className }: PublicProps) {
  return <Gauge value={value} config={TEMP_CONFIG} className={className} />;
}
