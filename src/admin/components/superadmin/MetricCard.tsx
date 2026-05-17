/**
 * MetricCard — Modüler Mühendislik Metrik Bloğu
 *
 * Yapı: Label / Value + Unit / Sub-text / Sparkline (mini SVG)
 * Sparkline: statik SVG polylne, son 8 veri noktası, 0-100 normalize.
 * No glow, no blur, hairline border, 2px radius.
 */

import '../../styles/admin-enterprise.css'

// ── Tipler ────────────────────────────────────────────────────────────────────

export type MetricStatus = 'stable' | 'warning' | 'critical' | 'neutral'

export interface MetricCardProps {
  label:      string
  value:      string | number
  unit?:      string
  sub?:       string
  status?:    MetricStatus
  /** 0-100 normalize 8 nokta — yoksa düz çizgi */
  sparkData?: number[]
}

// ── Renk haritası ─────────────────────────────────────────────────────────────

const STATUS_COLOR: Record<MetricStatus, string> = {
  stable:   '#4ade80',
  warning:  '#d97706',
  critical: '#dc2626',
  neutral:  '#4b5563',
}

// ── Sparkline — Mali-400 dostu: statik SVG, transform yok ────────────────────

function Sparkline({ data, color }: { data: number[]; color: string }) {
  const W = 100   // viewBox genişliği
  const H = 20    // viewBox yüksekliği
  const pts = data.slice(-8)    // son 8 nokta

  if (pts.length < 2) {
    // Düz çizgi
    return (
      <svg
        width="100%" height={H}
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        style={{ display: 'block' }}
      >
        <line
          x1={0} y1={H / 2} x2={W} y2={H / 2}
          stroke={color} strokeWidth={0.8} strokeOpacity={0.25}
        />
      </svg>
    )
  }

  const step  = W / (pts.length - 1)
  const coords = pts.map((v, i) => {
    const x = i * step
    const y = H - (Math.max(0, Math.min(100, v)) / 100) * (H - 2) - 1
    return `${x.toFixed(1)},${y.toFixed(1)}`
  })

  return (
    <svg
      width="100%" height={H}
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      style={{ display: 'block' }}
    >
      <polyline
        points={coords.join(' ')}
        fill="none"
        stroke={color}
        strokeWidth={1}
        strokeOpacity={0.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

// ── MetricCard ────────────────────────────────────────────────────────────────

export function MetricCard({
  label,
  value,
  unit,
  sub,
  status = 'neutral',
  sparkData,
}: MetricCardProps) {
  const color = STATUS_COLOR[status]

  return (
    <div className="sa-mc">
      {/* Label */}
      <span className="sa-mc-label">{label}</span>

      {/* Value + Unit */}
      <div className="sa-mc-value-row">
        <span className="sa-mc-value" style={{ color }}>
          {value}
        </span>
        {unit && (
          <span className="sa-mc-unit">{unit}</span>
        )}
      </div>

      {/* Sub-text */}
      {sub && (
        <span className="sa-mc-sub">{sub}</span>
      )}

      {/* Sparkline */}
      <div className="sa-mc-spark">
        <Sparkline
          data={sparkData ?? [50, 50, 50, 50, 50, 50, 50, 50]}
          color={color}
        />
      </div>
    </div>
  )
}
