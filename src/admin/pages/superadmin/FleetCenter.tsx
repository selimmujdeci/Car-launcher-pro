/**
 * FleetCenter — Filo Donanım Envanteri & Sağlık Matrisi
 *
 * STRICTLY ANONYMOUS — Bireysel araç ID'si veya GPS verisi gösterilmez.
 * Yalnızca anonim, toplu donanım profili istatistikleri.
 *
 * 3 Bento Widget:
 *   1. GPU Architecture Matrix  — Donanım sınıfı dağılımı (SVG bar)
 *   2. App Version Distribution — Sürüm parçalanması (horizontal bar)
 *   3. Device Health Scorecard  — Sınıf bazlı kararlılık skoru
 */

import { useEffect, useState, useCallback } from 'react'
import { RefreshCw, Shield, Cpu, Layers } from 'lucide-react'
import {
  getFleetInventory,
  type FleetInventory,
  type GpuClassBucket,
  type VersionBucket,
} from '../../services/superadmin.service'
import { Button } from '../../components/ui/Button'
import '../../styles/admin-enterprise.css'

// ── Renk yardımcıları ─────────────────────────────────────────────────────────

function scoreColor(n: number): string {
  if (n >= 80) return '#4ade80'
  if (n >= 60) return '#d97706'
  if (n >= 40) return '#ea580c'
  return '#dc2626'
}

function gpuColor(label: string): string {
  if (label.includes('HIGH'))   return '#4ade80'
  if (label.includes('MID'))    return '#60a5fa'
  return '#d97706'
}

function ramColor(level: 'low' | 'medium' | 'high'): string {
  return level === 'low' ? '#4ade80' : level === 'medium' ? '#d97706' : '#dc2626'
}

function _ago(iso: string | null): string {
  if (!iso) return '—'
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return `${s}s ago`
  return `${Math.floor(s / 60)}m ago`
}

// ── FleetCenter ───────────────────────────────────────────────────────────────

export function FleetCenter() {
  const [inv,     setInv]     = useState<FleetInventory | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setInv(await getFleetInventory())
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
    const id = setInterval(() => { void load() }, 120_000)
    return () => clearInterval(id)
  }, [load])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 1, maxWidth: 1200 }}>

      {/* Header */}
      <div className="flex items-center justify-between" style={{ marginBottom: 14 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <p className="sa-label">FLEET INVENTORY</p>
            <span
              style={{
                fontFamily:    'var(--sa-font-mono)',
                fontSize:       8,
                fontWeight:     700,
                color:         '#dc2626',
                letterSpacing: '0.10em',
                padding:       '1px 5px',
                border:        '1px solid rgba(220,38,38,0.3)',
                borderRadius:   2,
              }}
            >
              STRICTLY ANONYMOUS
            </span>
          </div>
          <p style={{ fontSize: 10, color: '#2d3748', fontFamily: 'var(--sa-font-ui)', marginTop: 2 }}>
            {loading
              ? 'SCANNING_FLEET_ASSETS...'
              : inv && inv.totalDevices > 0
              ? `${inv.totalDevices} unique devices · 24h window · last scan ${_ago(inv.lastScanned)}`
              : 'No fleet data in 24h window'}
          </p>
        </div>
        <Button variant="outline" size="sm" disabled={loading} onClick={() => { void load() }}>
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
          Scan
        </Button>
      </div>

      {loading && !inv ? (
        <ScanningState />
      ) : !inv || inv.totalDevices === 0 ? (
        <EmptyState />
      ) : (
        <>
          {/* ── ROW 1 — GPU Matrix (5) + RAM Profile (7) ──────────── */}
          <div style={{ display: 'grid', gridTemplateColumns: '5fr 7fr', gap: 1 }}>
            <GpuMatrixWidget gpuClasses={inv.gpuClasses} />
            <RamProfileWidget ramProfile={inv.ramProfile} />
          </div>

          {/* ── ROW 2 — Version Distribution (full) ──────────────── */}
          <VersionDistWidget versionDist={inv.versionDist} />

          {/* ── ROW 3 — Health Scorecard (full) ─────────────────── */}
          <HealthScorecardWidget gpuClasses={inv.gpuClasses} versionDist={inv.versionDist} />
        </>
      )}
    </div>
  )
}

// ── Widget 1: GPU Architecture Matrix ────────────────────────────────────────

function GpuMatrixWidget({
  gpuClasses,
}: {
  gpuClasses: GpuClassBucket[]
}) {
  const maxCount = Math.max(...gpuClasses.map((g) => g.count), 1)

  return (
    <WidgetWrap label="GPU ARCHITECTURE MATRIX" icon={<Cpu size={11} />}>
      {gpuClasses.length === 0 ? (
        <EmptyWidget />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {gpuClasses.map((g) => (
            <div key={g.label}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span
                  style={{
                    fontFamily:    'var(--sa-font-mono)',
                    fontSize:       10,
                    fontWeight:     600,
                    color:         gpuColor(g.label),
                    letterSpacing: '0.04em',
                  }}
                >
                  {g.label}
                </span>
                <div style={{ display: 'flex', gap: 10 }}>
                  <span className="sa-mono" style={{ fontSize: 10, color: '#4b5563' }}>
                    {g.count} dev
                  </span>
                  <span className="sa-mono" style={{ fontSize: 10, color: '#2d3748' }}>
                    {g.pct}%
                  </span>
                </div>
              </div>
              {/* SVG bar */}
              <svg
                viewBox={`0 0 300 8`}
                preserveAspectRatio="none"
                style={{ width: '100%', height: 8, display: 'block' }}
              >
                <rect x={0} y={0} width={300} height={8} fill="#0f0f0f" rx={1} />
                <rect
                  x={0} y={0}
                  width={Math.round((g.count / maxCount) * 300)}
                  height={8}
                  fill={gpuColor(g.label)}
                  fillOpacity={0.7}
                  rx={1}
                />
              </svg>
              <p style={{ fontFamily: 'var(--sa-font-ui)', fontSize: 9, color: '#2d3748', marginTop: 3 }}>
                avg stability {g.avgStability}/100
              </p>
            </div>
          ))}
          <p style={{ fontFamily: 'var(--sa-font-ui)', fontSize: 9, color: '#1a1a1a', marginTop: 4 }}>
            * Thermal+RAM heuristic — no direct GPU API access
          </p>
        </div>
      )}
    </WidgetWrap>
  )
}

// ── Widget 2b: RAM Profile ────────────────────────────────────────────────────

function RamProfileWidget({
  ramProfile,
}: {
  ramProfile: FleetInventory['ramProfile']
}) {
  const segments: Array<{ label: string; pct: number; level: 'low'|'medium'|'high'; desc: string }> = [
    { label: 'LOW PRESSURE',    pct: ramProfile.low,    level: 'low',    desc: 'avg RAM < 40%' },
    { label: 'MEDIUM PRESSURE', pct: ramProfile.medium, level: 'medium', desc: 'avg RAM 40-70%' },
    { label: 'HIGH PRESSURE',   pct: ramProfile.high,   level: 'high',   desc: 'avg RAM > 70%' },
  ]

  return (
    <WidgetWrap label="RAM PRESSURE PROFILE" icon={<Layers size={11} />}>
      {/* Stacked bar */}
      <div
        style={{
          display:       'flex',
          height:         8,
          borderRadius:   1,
          overflow:       'hidden',
          background:    '#0f0f0f',
          marginBottom:  16,
        }}
      >
        {segments.map((s) => (
          <div
            key={s.label}
            style={{
              width:      `${s.pct}%`,
              background: ramColor(s.level),
              opacity:     0.75,
              transition: 'width 400ms ease',
            }}
          />
        ))}
      </div>

      {/* Legend */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {segments.map((s) => (
          <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 8, height: 8, borderRadius: 1, background: ramColor(s.level), flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ fontFamily: 'var(--sa-font-ui)', fontSize: 9, fontWeight: 600, color: '#4b5563', letterSpacing: '0.08em' }}>
                {s.label}
              </p>
              <p style={{ fontFamily: 'var(--sa-font-ui)', fontSize: 9, color: '#2d3748' }}>{s.desc}</p>
            </div>
            <span className="sa-mono" style={{ fontSize: 12, fontWeight: 700, color: ramColor(s.level), flexShrink: 0 }}>
              {s.pct}%
            </span>
          </div>
        ))}
      </div>
    </WidgetWrap>
  )
}

// ── Widget 2: Version Distribution ───────────────────────────────────────────

function VersionDistWidget({
  versionDist,
}: {
  versionDist: VersionBucket[]
}) {
  const maxCount = Math.max(...versionDist.map((v) => v.count), 1)

  return (
    <WidgetWrap label="APP VERSION DISTRIBUTION" icon={<Shield size={11} />}>
      {versionDist.length === 0 ? (
        <EmptyWidget />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {/* Header row */}
          <div style={{ display: 'flex', gap: 8 }}>
            <span className="sa-label" style={{ width: 72 }}>VERSION</span>
            <span className="sa-label" style={{ flex: 1 }}>DISTRIBUTION</span>
            <span className="sa-label" style={{ width: 40, textAlign: 'right' }}>DEVICES</span>
            <span className="sa-label" style={{ width: 40, textAlign: 'right' }}>STAB.</span>
          </div>

          {versionDist.map((v) => {
            const color = scoreColor(v.stability)
            return (
              <div key={v.version} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <code
                  className="sa-mono"
                  style={{ fontSize: 10, color: '#6b7280', width: 72, flexShrink: 0 }}
                >
                  v{v.version}
                </code>
                {/* SVG bar */}
                <div style={{ flex: 1 }}>
                  <svg
                    viewBox="0 0 400 6"
                    preserveAspectRatio="none"
                    style={{ width: '100%', height: 6, display: 'block' }}
                  >
                    <rect x={0} y={0} width={400} height={6} fill="#0f0f0f" rx={1} />
                    <rect
                      x={0} y={0}
                      width={Math.round((v.count / maxCount) * 400)}
                      height={6}
                      fill={color}
                      fillOpacity={0.65}
                      rx={1}
                    />
                  </svg>
                </div>
                <span className="sa-mono" style={{ fontSize: 10, color: '#4b5563', width: 40, textAlign: 'right', flexShrink: 0 }}>
                  {v.count}
                </span>
                <span className="sa-mono" style={{ fontSize: 10, fontWeight: 700, color, width: 40, textAlign: 'right', flexShrink: 0 }}>
                  {v.stability}
                </span>
              </div>
            )
          })}

          <p style={{ fontFamily: 'var(--sa-font-ui)', fontSize: 9, color: '#1a1a1a', marginTop: 4 }}>
            {versionDist.reduce((s, v) => s + v.count, 0)} total devices · {versionDist.length} versions detected · 24h window
          </p>
        </div>
      )}
    </WidgetWrap>
  )
}

// ── Widget 3: Health Scorecard ────────────────────────────────────────────────

function HealthScorecardWidget({
  gpuClasses, versionDist,
}: {
  gpuClasses:  GpuClassBucket[]
  versionDist: VersionBucket[]
}) {
  // Find best/worst version
  const sorted = [...versionDist].sort((a, b) => b.stability - a.stability)
  const best   = sorted[0]
  const worst  = sorted[sorted.length - 1]

  return (
    <WidgetWrap label="DEVICE HEALTH SCORECARD" icon={<Shield size={11} />}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 1 }}>

        {/* GPU classes */}
        {gpuClasses.map((g) => (
          <ScorecardCell
            key={g.label}
            label={g.label}
            score={g.avgStability}
            sub={`${g.count} devices · ${g.pct}% of fleet`}
          />
        ))}

        {/* Best version */}
        {best && (
          <ScorecardCell
            label={`BEST: v${best.version}`}
            score={best.stability}
            sub={`${best.count} devices`}
          />
        )}

        {/* Worst version */}
        {worst && worst.version !== best?.version && (
          <ScorecardCell
            label={`WATCH: v${worst.version}`}
            score={worst.stability}
            sub={`${worst.count} devices · needs attention`}
          />
        )}
      </div>
    </WidgetWrap>
  )
}

function ScorecardCell({ label, score, sub }: { label: string; score: number; sub: string }) {
  const color = scoreColor(score)
  return (
    <div
      style={{
        background:    '#0a0a0a',
        border:        '1px solid #1a1a1a',
        borderRadius:   2,
        padding:       '12px 14px',
      }}
    >
      <p className="sa-label" style={{ marginBottom: 8 }}>{label}</p>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, marginBottom: 6 }}>
        <span className="sa-mono" style={{ fontSize: 28, fontWeight: 700, color, lineHeight: 1, letterSpacing: '-0.03em' }}>
          {score}
        </span>
        <span className="sa-mono" style={{ fontSize: 10, color: '#4b5563' }}>/100</span>
      </div>
      {/* Mini gauge */}
      <div style={{ height: 2, background: '#1a1a1a', borderRadius: 1, overflow: 'hidden', marginBottom: 6 }}>
        <div style={{ height: '100%', width: `${score}%`, background: color, transition: 'width 400ms ease' }} />
      </div>
      <p style={{ fontFamily: 'var(--sa-font-ui)', fontSize: 9, color: '#2d3748' }}>{sub}</p>
    </div>
  )
}

// ── Widget Wrapper ────────────────────────────────────────────────────────────

function WidgetWrap({
  label, icon, children,
}: {
  label:    string
  icon:     React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div
      style={{
        background:    '#0d0d0d',
        border:        '1px solid #1a1a1a',
        borderRadius:   2,
        padding:       '14px 16px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 14 }}>
        <span style={{ color: '#2d3748' }}>{icon}</span>
        <p className="sa-label">{label}</p>
      </div>
      {children}
    </div>
  )
}

// ── States ────────────────────────────────────────────────────────────────────

function ScanningState() {
  return (
    <div
      style={{
        display:         'flex',
        flexDirection:   'column',
        alignItems:      'center',
        justifyContent:  'center',
        height:           200,
        gap:               8,
        border:          '1px solid #1a1a1a',
        borderRadius:     2,
      }}
    >
      <RefreshCw size={14} style={{ color: '#2d3748', animation: 'spin 1s linear infinite' }} />
      <p
        style={{
          fontFamily:    'var(--sa-font-mono)',
          fontSize:       11,
          color:         '#2d3748',
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
        }}
      >
        SCANNING_FLEET_ASSETS...
      </p>
      <p style={{ fontFamily: 'var(--sa-font-ui)', fontSize: 9, color: '#1a1a1a' }}>
        Aggregating anonymous telemetry from vehicle_events
      </p>
    </div>
  )
}

function EmptyState() {
  return (
    <div className="sa-empty" style={{ border: '1px solid #1a1a1a', borderRadius: 2, height: 200 }}>
      <Cpu size={18} style={{ color: '#2d3748', opacity: 0.5 }} />
      NO_FLEET_DATA: No system_health events in 24h window
      <span style={{ fontSize: 9, color: '#1a1a1a' }}>
        Vehicles must push telemetry events to populate inventory
      </span>
    </div>
  )
}

function EmptyWidget() {
  return (
    <div
      style={{
        fontFamily:    'var(--sa-font-mono)',
        fontSize:       10,
        color:         '#2d3748',
        letterSpacing: '0.06em',
        padding:       '16px 0',
        textAlign:     'center',
      }}
    >
      SYSTEM_IDLE: No data
    </div>
  )
}
