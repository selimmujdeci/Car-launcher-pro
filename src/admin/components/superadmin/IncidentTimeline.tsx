/**
 * IncidentTimeline — Kara Kutu Görsel Grafik Bileşeni
 *
 * 3 ayrı SVG tabanlı mini grafik, dikey istifleme:
 *   1. Thermal Level (0-3) — step line, renk kodlu
 *   2. RAM Pressure (0-100%) — area chart
 *   3. Worker Restarts — bar chart
 *
 * Dikey işaretçiler:
 *   • Kırmızı kesikli çizgi = CRITICAL POINT (targetTs)
 *   • Gri çizgi             = Slider pozisyonu (currentIdx)
 *
 * Mali-400 uyumlu: transform yok, clip-path yok, filter yok.
 */

import type { IncidentDataPoint } from '../../services/superadmin.service'

// ── Sabitler ──────────────────────────────────────────────────────────────────

const VW   = 600   // viewBox genişliği (sanal koordinat)
const PAD  = { t: 4, b: 4, l: 2, r: 2 }

// ── Termal renk ───────────────────────────────────────────────────────────────

function thermalColor(level: number): string {
  if (level >= 3) return '#dc2626'
  if (level >= 2) return '#ea580c'
  if (level >= 1) return '#d97706'
  return '#4ade80'
}

// ── X pozisyonu ───────────────────────────────────────────────────────────────

function xOf(i: number, n: number): number {
  if (n <= 1) return PAD.l + (VW - PAD.l - PAD.r) / 2
  return PAD.l + (i / (n - 1)) * (VW - PAD.l - PAD.r)
}

// ── Y pozisyonu ───────────────────────────────────────────────────────────────

function yOf(value: number, max: number, H: number): number {
  const inner = H - PAD.t - PAD.b
  const norm  = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0
  return PAD.t + inner * (1 - norm)
}

// ── Dikey işaretçi çizgisi ───────────────────────────────────────────────────

function VLine({
  x, H, color, dashed,
}: {
  x: number; H: number; color: string; dashed?: boolean
}) {
  return (
    <line
      x1={x} y1={0} x2={x} y2={H}
      stroke={color}
      strokeWidth={dashed ? 1 : 0.5}
      strokeDasharray={dashed ? '3 2' : undefined}
      strokeOpacity={dashed ? 0.9 : 0.4}
    />
  )
}

// ── Grafik kapsayıcı ─────────────────────────────────────────────────────────

function ChartWrap({
  label, children, H,
}: {
  label: string; children: React.ReactNode; H: number
}) {
  return (
    <div>
      <p
        style={{
          fontFamily:    'var(--sa-font-ui)',
          fontSize:       8,
          fontWeight:     600,
          color:         '#2d3748',
          letterSpacing: '0.10em',
          textTransform: 'uppercase',
          marginBottom:   3,
        }}
      >
        {label}
      </p>
      <div
        style={{
          background:   '#080808',
          border:       '1px solid #1a1a1a',
          borderRadius:  2,
          overflow:     'hidden',
          lineHeight:    0,
        }}
      >
        <svg
          viewBox={`0 0 ${VW} ${H}`}
          preserveAspectRatio="none"
          style={{ width: '100%', height: H, display: 'block' }}
        >
          {children}
        </svg>
      </div>
    </div>
  )
}

// ── 1. Thermal Level (step line) ─────────────────────────────────────────────

function ThermalChart({
  data, critX, curX, H = 40,
}: {
  data: IncidentDataPoint[]; critX: number; curX: number; H?: number
}) {
  const n = data.length
  if (n === 0) return <ChartWrap label="THERMAL LEVEL (0-3)" H={H}><text x={VW/2} y={H/2} fill="#2d3748" fontSize={9} textAnchor="middle">NO DATA</text></ChartWrap>

  // Level lines as colored horizontal segments
  const segments: React.ReactNode[] = []
  for (let i = 0; i < n - 1; i++) {
    const x1 = xOf(i,     n)
    const x2 = xOf(i + 1, n)
    const y  = yOf(data[i].thermalLevel, 3, H)
    segments.push(
      <line
        key={i}
        x1={x1} y1={y} x2={x2} y2={y}
        stroke={thermalColor(data[i].thermalLevel)}
        strokeWidth={1.5}
        strokeLinecap="round"
      />,
    )
    // Vertical connector
    const y2 = yOf(data[i + 1].thermalLevel, 3, H)
    if (y !== y2) {
      segments.push(
        <line key={`v${i}`} x1={x2} y1={y} x2={x2} y2={y2}
          stroke={thermalColor(data[i + 1].thermalLevel)} strokeWidth={1.5} />,
      )
    }
  }

  // Horizontal threshold lines
  const gridLines = [0, 1, 2, 3].map((lvl) => {
    const y = yOf(lvl, 3, H)
    return (
      <line
        key={`g${lvl}`}
        x1={PAD.l} y1={y} x2={VW - PAD.r} y2={y}
        stroke="#1a1a1a" strokeWidth={0.5}
      />
    )
  })

  return (
    <ChartWrap label="THERMAL LEVEL (L0-L3)" H={H}>
      {gridLines}
      {segments}
      <VLine x={critX} H={H} color="#dc2626" dashed />
      <VLine x={curX}  H={H} color="#374151" />
    </ChartWrap>
  )
}

// ── 2. RAM Pressure (area chart) ─────────────────────────────────────────────

function RamChart({
  data, critX, curX, H = 40,
}: {
  data: IncidentDataPoint[]; critX: number; curX: number; H?: number
}) {
  const n = data.length
  if (n === 0) return <ChartWrap label="RAM PRESSURE (%)" H={H}><text x={VW/2} y={H/2} fill="#2d3748" fontSize={9} textAnchor="middle">NO DATA</text></ChartWrap>

  // Area path
  const pts   = data.map((d, i) => `${xOf(i, n).toFixed(1)},${yOf(d.ramPressure, 100, H).toFixed(1)}`)
  const first = `${xOf(0, n).toFixed(1)},${(H - PAD.b).toFixed(1)}`
  const last  = `${xOf(n - 1, n).toFixed(1)},${(H - PAD.b).toFixed(1)}`
  const areaPath = `M ${first} L ${pts.join(' L ')} L ${last} Z`
  const linePath = `M ${pts.join(' L ')}`

  // Grid lines
  const gridLines = [0, 25, 50, 75, 100].map((v) => {
    const y = yOf(v, 100, H)
    return <line key={v} x1={PAD.l} y1={y} x2={VW - PAD.r} y2={y} stroke="#1a1a1a" strokeWidth={0.5} />
  })

  return (
    <ChartWrap label="RAM PRESSURE (%)" H={H}>
      {gridLines}
      <path d={areaPath} fill="#60a5fa" fillOpacity={0.08} />
      <path d={linePath} fill="none" stroke="#60a5fa" strokeWidth={1} strokeOpacity={0.6} />
      <VLine x={critX} H={H} color="#dc2626" dashed />
      <VLine x={curX}  H={H} color="#374151" />
    </ChartWrap>
  )
}

// ── 3. Worker Restarts (bar chart) ───────────────────────────────────────────

function RestartChart({
  data, critX, curX, H = 36,
}: {
  data: IncidentDataPoint[]; critX: number; curX: number; H?: number
}) {
  const n   = data.length
  const max = Math.max(...data.map((d) => d.workerRestarts), 1)
  if (n === 0) return <ChartWrap label="WORKER RESTARTS" H={H}><text x={VW/2} y={H/2} fill="#2d3748" fontSize={9} textAnchor="middle">NO DATA</text></ChartWrap>

  const bw    = Math.max(1, (VW - PAD.l - PAD.r) / n - 1)
  const inner = H - PAD.t - PAD.b

  const bars = data.map((d, i) => {
    const x = xOf(i, n) - bw / 2
    const h = d.workerRestarts > 0 ? Math.max(2, (d.workerRestarts / max) * inner) : 0
    const y = H - PAD.b - h
    return (
      <rect
        key={i}
        x={x} y={y} width={bw} height={h}
        fill={d.workerRestarts > 0 ? '#60a5fa' : 'transparent'}
        fillOpacity={0.7}
      />
    )
  })

  return (
    <ChartWrap label="WORKER RESTARTS" H={H}>
      {/* Baseline */}
      <line x1={PAD.l} y1={H - PAD.b} x2={VW - PAD.r} y2={H - PAD.b} stroke="#1a1a1a" strokeWidth={0.5} />
      {bars}
      <VLine x={critX} H={H} color="#dc2626" dashed />
      <VLine x={curX}  H={H} color="#374151" />
    </ChartWrap>
  )
}

// ── IncidentTimeline ─────────────────────────────────────────────────────────

export interface IncidentTimelineProps {
  sequence:   IncidentDataPoint[]
  targetTs:   string     // incident timestamp — kritik nokta
  currentIdx: number     // slider pozisyonu
}

export function IncidentTimeline({ sequence, targetTs, currentIdx }: IncidentTimelineProps) {
  const n = sequence.length

  // Kritik nokta X pozisyonu — targetTs'e en yakın index
  const critIdx = (() => {
    if (n === 0) return 0
    let best = 0
    let bestDiff = Infinity
    const target = new Date(targetTs).getTime()
    for (let i = 0; i < n; i++) {
      const diff = Math.abs(new Date(sequence[i].ts).getTime() - target)
      if (diff < bestDiff) { bestDiff = diff; best = i }
    }
    return best
  })()

  const critX = n > 0 ? xOf(critIdx,  n) : VW / 2
  const curX  = n > 0 ? xOf(currentIdx < n ? currentIdx : n - 1, n) : VW / 2

  if (n === 0) {
    return (
      <div
        style={{
          display:         'flex',
          alignItems:      'center',
          justifyContent:  'center',
          height:           140,
          fontFamily:      'var(--sa-font-mono)',
          fontSize:         11,
          color:           '#2d3748',
          letterSpacing:   '0.06em',
        }}
      >
        SEQUENCE_EMPTY: No telemetry in 15-minute window
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <ThermalChart data={sequence} critX={critX} curX={curX} H={44} />
      <RamChart     data={sequence} critX={critX} curX={curX} H={44} />
      <RestartChart data={sequence} critX={critX} curX={curX} H={36} />

      {/* X-axis: timestamps (first, middle, last) */}
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        {[0, Math.floor(n / 2), n - 1].map((idx) => (
          <span
            key={idx}
            style={{
              fontFamily:    'var(--sa-font-mono)',
              fontSize:       8,
              color:         '#2d3748',
              letterSpacing: '0.04em',
            }}
          >
            {new Date(sequence[idx]?.ts ?? '').toLocaleTimeString('en-GB', { hour12: false })}
          </span>
        ))}
      </div>

      {/* Legend */}
      <div style={{ display: 'flex', gap: 16, marginTop: 2 }}>
        <LegendItem color="#dc2626" dashed label="CRITICAL POINT" />
        <LegendItem color="#374151" label="CURRENT POSITION" />
      </div>
    </div>
  )
}

function LegendItem({ color, label, dashed }: { color: string; label: string; dashed?: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
      <svg width={16} height={8}>
        <line
          x1={0} y1={4} x2={16} y2={4}
          stroke={color} strokeWidth={1}
          strokeDasharray={dashed ? '3 2' : undefined}
        />
      </svg>
      <span
        style={{
          fontFamily:    'var(--sa-font-ui)',
          fontSize:       8,
          color:         '#2d3748',
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
        }}
      >
        {label}
      </span>
    </div>
  )
}
