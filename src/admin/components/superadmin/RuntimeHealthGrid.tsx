/**
 * RuntimeHealthGrid — Modüler metrik grid sistemi
 *
 * 12-kolon tabanlı grid'de telemetri metriklerini gösterir.
 * Veri yoksa mühendislik terminolojili empty state döner.
 */

import '../../styles/admin-enterprise.css'

// ── Tipler ────────────────────────────────────────────────────────────────────

export type MetricStatus = 'stable' | 'warning' | 'danger' | 'idle'

export interface GridMetric {
  label:   string
  value:   string | number
  unit?:   string
  status?: MetricStatus
  sub?:    string
}

interface RuntimeHealthGridProps {
  metrics:  GridMetric[]
  columns?: 2 | 3 | 4 | 6
  title?:   string
  emptyMsg?: string
}

// ── Renk haritası ─────────────────────────────────────────────────────────────

const S_COLOR: Record<MetricStatus, string> = {
  stable:  '#4ade80',
  warning: '#facc15',
  danger:  '#f87171',
  idle:    '#475569',
}

// ── RuntimeHealthGrid ─────────────────────────────────────────────────────────

export function RuntimeHealthGrid({
  metrics,
  columns = 4,
  title,
  emptyMsg = 'SİSTEM_BEKLEMEDE: Telemetri bekleniyor...',
}: RuntimeHealthGridProps) {

  if (metrics.length === 0) {
    return (
      <div className="sa-empty">
        <span
          style={{
            display:       'inline-block',
            width:          6,
            height:         6,
            borderRadius:  '50%',
            background:    '#334155',
            animation:     'sa-blink 2.4s ease-in-out infinite',
          }}
        />
        {emptyMsg}
      </div>
    )
  }

  return (
    <div>
      {title && (
        <p className="sa-label" style={{ marginBottom: 10 }}>{title}</p>
      )}
      <div
        style={{
          display:             'grid',
          gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
          gap:                  0,
          border:              '1px solid rgba(255,255,255,0.07)',
          borderRadius:         6,
          overflow:            'hidden',
        }}
      >
        {metrics.map((m, i) => {
          const color   = S_COLOR[m.status ?? 'idle']
          const lastRow = i >= metrics.length - (metrics.length % columns || columns)
          const lastCol = (i + 1) % columns === 0

          return (
            <div
              key={i}
              className="sa-metric"
              style={{
                borderRight:  !lastCol  ? '1px solid rgba(255,255,255,0.04)' : 'none',
                borderBottom: !lastRow  ? '1px solid rgba(255,255,255,0.04)' : 'none',
              }}
            >
              <p className="sa-label">{m.label}</p>
              <div style={{ display: 'flex', alignItems: 'baseline', marginTop: 6 }}>
                <span className="sa-metric-val" style={{ color }}>
                  {m.value}
                </span>
                {m.unit && (
                  <span className="sa-metric-unit">{m.unit}</span>
                )}
              </div>
              {m.sub && (
                <p style={{ fontSize: 10, color: '#334155', marginTop: 4, fontFamily: 'var(--sa-font-mono)' }}>
                  {m.sub}
                </p>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── SectionDivider — bölüm ayırıcı ───────────────────────────────────────────

export function SectionDivider({ label }: { label: string }) {
  return (
    <div
      style={{
        display:    'flex',
        alignItems: 'center',
        gap:         10,
        margin:     '20px 0 12px',
      }}
    >
      <span className="sa-label">{label}</span>
      <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.05)' }} />
    </div>
  )
}
