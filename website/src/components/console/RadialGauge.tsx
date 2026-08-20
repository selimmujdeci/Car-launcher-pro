'use client';

/**
 * RADYAL GÖSTERGE — Kanıt Konsolu'nun imza bileşeni (#662).
 *
 * Otomotiv kadranı: 270° yay (-132° … +132°), renkli bölge yayları, kadran
 * çizgileri, dönen ibre.
 *
 * ── PAZARLIKSIZ KURAL ─────────────────────────────────────────────────────
 * Değer YOKSA ibre ORTAYA YASLANMAZ. `value === null` iken ibre başlangıç
 * açısına düşer, gri/donuk kalır ve kadranın ortasında **KANIT YOK** yazar.
 * Ölçüm yokken ibreyi ortalamaya yaslamak, olmayan bir ölçümü varmış gibi
 * gösterir — bu, sahte `0` ile aynı sınıf yalandır.
 *
 * Bileşen SAF ÇİZİMDİR: veri çekmez, timer kurmaz, kendi durumunu tutmaz.
 */

import {
  GAUGE_START_DEG,
  GAUGE_END_DEG,
  bandAngles,
  describeArc,
  polarToXY,
  tickAngles,
  toneForValue,
  valueToAngle,
  type GaugeScale,
} from '@/lib/console/gaugeModel';

const TONE_VAR: Record<string, string> = {
  critical: 'var(--cn-critical)',
  warning:  'var(--cn-warning)',
  verified: 'var(--cn-verified)',
  unknown:  'var(--cn-unknown)',
};

export type GaugeSize = 'hero' | 'compact';

interface Props {
  /** Ölçülen değer; `null` = KANIT YOK (0 DEĞİL). */
  value: number | null;
  scale: GaugeScale;
  unit: string;
  label: string;
  size?: GaugeSize;
  /** Değerin kaç ondalıkla yazılacağı. */
  precision?: number;
  /** Kadran altına düşen kanıt satırı (kaynak · örnek · yaş). */
  evidence?: string;
}

const GEOMETRY = {
  hero:    { box: 240, cx: 120, cy: 120, arcR: 92,  tickR: 104, needle: 78,  stroke: 9,   value: 34, unitSize: 12 },
  compact: { box: 160, cx: 80,  cy: 80,  arcR: 60,  tickR: 69,  needle: 50,  stroke: 6.5, value: 21, unitSize: 10 },
} as const;

export default function RadialGauge({
  value,
  scale,
  unit,
  label,
  size = 'compact',
  precision = 1,
  evidence,
}: Props) {
  const g = GEOMETRY[size];
  const hasEvidence = value !== null && Number.isFinite(value);

  const needleAngle = valueToAngle(hasEvidence ? value : null, scale.min, scale.max);
  const tone = toneForValue(hasEvidence ? value : null, scale.bands);
  const needleColor = hasEvidence ? 'var(--cn-copper)' : 'var(--cn-unknown)';

  const ticks = tickAngles(size === 'hero' ? 11 : 7);
  const needleEnd = polarToXY(g.cx, g.cy, g.needle, needleAngle);
  const needleTail = polarToXY(g.cx, g.cy, -g.needle * 0.14, needleAngle);

  return (
    <figure className="flex flex-col items-center gap-2 m-0">
      <svg
        viewBox={`0 0 ${g.box} ${g.box}`}
        className="w-full h-auto"
        style={{ maxWidth: g.box }}
        role="img"
        aria-label={
          hasEvidence
            ? `${label}: ${value!.toFixed(precision)} ${unit}`
            : `${label}: kanıt yok`
        }
      >
        {/* Kadran tabanı — ölçeğin tamamı, donuk */}
        <path
          d={describeArc(g.cx, g.cy, g.arcR, GAUGE_START_DEG, GAUGE_END_DEG)}
          fill="none"
          stroke="var(--cn-line)"
          strokeWidth={g.stroke}
          strokeLinecap="butt"
        />

        {/* Bölge yayları — kanıt yokken de ölçek görünür kalır ama soluklaşır */}
        {scale.bands.map((band, i) => {
          const { start, end } = bandAngles(band, scale.min, scale.max);
          return (
            <path
              key={i}
              d={describeArc(g.cx, g.cy, g.arcR, start, end)}
              fill="none"
              stroke={TONE_VAR[band.tone]}
              strokeWidth={g.stroke}
              strokeLinecap="butt"
              opacity={hasEvidence ? 0.9 : 0.22}
            />
          );
        })}

        {/* Kadran çizgileri */}
        {ticks.map((angle, i) => {
          const outer = polarToXY(g.cx, g.cy, g.tickR, angle);
          const inner = polarToXY(g.cx, g.cy, g.tickR - (i % 2 === 0 ? 9 : 5), angle);
          return (
            <line
              key={angle}
              x1={outer.x} y1={outer.y}
              x2={inner.x} y2={inner.y}
              stroke="var(--cn-text-3)"
              strokeWidth={i % 2 === 0 ? 1.6 : 1}
              opacity={0.75}
            />
          );
        })}

        {/* Ölçek uç etiketleri */}
        <text
          x={polarToXY(g.cx, g.cy, g.tickR - 20, GAUGE_START_DEG).x}
          y={polarToXY(g.cx, g.cy, g.tickR - 20, GAUGE_START_DEG).y}
          fill="var(--cn-text-3)"
          fontSize={size === 'hero' ? 11 : 9}
          fontFamily="var(--font-mono), monospace"
          textAnchor="middle"
          dominantBaseline="middle"
        >
          {scale.min}
        </text>
        <text
          x={polarToXY(g.cx, g.cy, g.tickR - 20, GAUGE_END_DEG).x}
          y={polarToXY(g.cx, g.cy, g.tickR - 20, GAUGE_END_DEG).y}
          fill="var(--cn-text-3)"
          fontSize={size === 'hero' ? 11 : 9}
          fontFamily="var(--font-mono), monospace"
          textAnchor="middle"
          dominantBaseline="middle"
        >
          {scale.max}
        </text>

        {/* İBRE — kanıt yoksa başlangıçta ve gri */}
        <line
          x1={needleTail.x} y1={needleTail.y}
          x2={needleEnd.x}  y2={needleEnd.y}
          stroke={needleColor}
          strokeWidth={size === 'hero' ? 3 : 2.2}
          strokeLinecap="round"
          opacity={hasEvidence ? 1 : 0.45}
          style={{ transition: 'all 420ms cubic-bezier(0.22,0.61,0.36,1)' }}
        />
        <circle
          cx={g.cx} cy={g.cy} r={size === 'hero' ? 7 : 5}
          fill="var(--cn-bg-bezel)"
          stroke={needleColor}
          strokeWidth={1.5}
          opacity={hasEvidence ? 1 : 0.5}
        />

        {/* Merkez okuma */}
        {hasEvidence ? (
          <>
            <text
              x={g.cx} y={g.cy + (size === 'hero' ? 44 : 30)}
              fill={TONE_VAR[tone] ?? 'var(--cn-text-1)'}
              fontSize={g.value}
              fontWeight={600}
              fontFamily="var(--font-mono), monospace"
              textAnchor="middle"
              style={{ fontVariantNumeric: 'tabular-nums' }}
            >
              {value!.toFixed(precision)}
            </text>
            <text
              x={g.cx} y={g.cy + (size === 'hero' ? 64 : 44)}
              fill="var(--cn-text-3)"
              fontSize={g.unitSize}
              fontFamily="var(--font-mono), monospace"
              textAnchor="middle"
              letterSpacing="0.18em"
            >
              {unit.toUpperCase()}
            </text>
          </>
        ) : (
          <text
            x={g.cx} y={g.cy + (size === 'hero' ? 50 : 34)}
            fill="var(--cn-unknown)"
            fontSize={size === 'hero' ? 13 : 10}
            fontFamily="var(--font-mono), monospace"
            textAnchor="middle"
            letterSpacing="0.2em"
          >
            KANIT YOK
          </text>
        )}
      </svg>

      <figcaption className="text-center">
        <div className="cn-eyebrow">{label}</div>
        {evidence && (
          <div className="cn-num text-[10px] text-t3 mt-1 tracking-tight">{evidence}</div>
        )}
      </figcaption>
    </figure>
  );
}
