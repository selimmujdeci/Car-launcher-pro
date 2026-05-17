/**
 * DiagnosticsCenter — Canlı Uzak Teşhis Merkezi
 *
 * "Surgical Debugging" arayüzü:
 *   Sol panel:  DeviceHash bazlı cihaz seçici
 *   Sağ panel:  60sn canlı grafik + DebugConsole + raporlar
 *
 * Güvenlik Garantileri:
 *   - GPS verisi asla çekilmez/gösterilmez
 *   - Kullanıcı özelinde veri yok — yalnızca anonim runtime metrikleri
 *   - Her debug oturumu audit_logs'a 'system.debug_session_started' kaydedilir
 */

import { useEffect, useState, useCallback, useRef } from 'react'
import {
  RefreshCw, Terminal, PlayCircle, StopCircle,
  AlertTriangle, CheckCircle, Activity,
} from 'lucide-react'
import {
  getKnownDevices,
  getDiagnosticReport,
  subscribeToDeviceLogs,
  type KnownDevice,
  type DiagnosticReport,
} from '../../services/superadmin.service'
import type { LiveEvent }  from '../../services/superadmin.service'
import { DebugConsole }    from '../../components/superadmin/DebugConsole'
import { useAuth }         from '../../hooks/useAuth'
import '../../styles/admin-enterprise.css'

// ── Sabitler ──────────────────────────────────────────────────────────────────

const SESSION_DURATION_S = 60

// ── Renk yardımcıları ─────────────────────────────────────────────────────────

function healthColor(h: string): string {
  if (h === 'critical') return '#dc2626'
  if (h === 'degraded') return '#d97706'
  return '#4ade80'
}

function thermalColor(l: number): string {
  if (l >= 3) return '#dc2626'
  if (l >= 2) return '#ea580c'
  if (l >= 1) return '#d97706'
  return '#4ade80'
}

function _ago(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  return `${Math.floor(s / 3600)}h ago`
}

// ── DiagnosticsCenter ─────────────────────────────────────────────────────────

export function DiagnosticsCenter() {
  const { user }                         = useAuth()
  const [devices,    setDevices]         = useState<KnownDevice[]>([])
  const [devLoading, setDevLoading]      = useState(true)
  const [selected,   setSelected]        = useState<string | null>(null)
  const [report,     setReport]          = useState<DiagnosticReport | null>(null)
  const [, setRepLoading]                = useState(false)
  const [sessionState, setSessionState]  = useState<'idle'|'confirm'|'active'|'ended'>('idle')
  const [countdown,  setCountdown]       = useState(SESSION_DURATION_S)
  const [liveEvents, setLiveEvents]      = useState<LiveEvent[]>([])
  const [sessionStart, setSessionStart]  = useState<string | undefined>()
  const unsubRef   = useRef<(() => void) | null>(null)
  const timerRef   = useRef<ReturnType<typeof setInterval> | null>(null)

  // Cihaz listesini yükle
  const loadDevices = useCallback(async () => {
    setDevLoading(true)
    try { setDevices(await getKnownDevices()) }
    finally { setDevLoading(false) }
  }, [])

  useEffect(() => {
    void loadDevices()
  }, [loadDevices])

  // Cihaz seçildiğinde rapor yükle (session başlatmadan)
  const handleSelectDevice = useCallback(async (hash: string) => {
    if (!user) return
    if (sessionState === 'active') stopSession()
    setSelected(hash)
    setLiveEvents([])
    setSessionState('idle')
    setReport(null)
    setRepLoading(true)
    try {
      const r = await getDiagnosticReport(hash, user.id)
      setReport(r)
    } finally {
      setRepLoading(false)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, sessionState])

  // Session başlat
  function startSession() {
    if (!selected || sessionState !== 'idle') return
    const start = new Date().toISOString()
    setSessionStart(start)
    setLiveEvents([])
    setCountdown(SESSION_DURATION_S)
    setSessionState('active')

    // Realtime subscription
    unsubRef.current = subscribeToDeviceLogs(selected, (e) => {
      setLiveEvents((prev) => [e, ...prev].slice(0, 200))
    })

    // 60s countdown
    timerRef.current = setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) { stopSession(); return 0 }
        return c - 1
      })
    }, 1000)
  }

  function stopSession() {
    if (unsubRef.current)  { unsubRef.current();  unsubRef.current = null }
    if (timerRef.current)  { clearInterval(timerRef.current); timerRef.current = null }
    setSessionState('ended')
  }

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      unsubRef.current?.()
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [])

  return (
    <div style={{ display: 'flex', gap: 1, maxWidth: 1280, height: 'calc(100vh - 120px)', minHeight: 600 }}>

      {/* ── Left Panel — Device Selector ───────────────────────────── */}
      <div
        style={{
          width:        220,
          flexShrink:    0,
          background:   '#0d0d0d',
          border:       '1px solid #1a1a1a',
          borderRadius:  2,
          display:      'flex',
          flexDirection: 'column',
          overflow:     'hidden',
        }}
      >
        {/* Header */}
        <div
          style={{
            padding:      '8px 12px',
            borderBottom: '1px solid #1a1a1a',
            background:   '#080808',
            display:      'flex',
            alignItems:   'center',
            justifyContent: 'space-between',
          }}
        >
          <p className="sa-label">KNOWN DEVICES</p>
          <button
            onClick={() => { void loadDevices() }}
            disabled={devLoading}
            style={{
              background: 'transparent', border: 'none',
              cursor: 'pointer', color: '#2d3748', padding: 2,
            }}
          >
            <RefreshCw size={10} className={devLoading ? 'animate-spin' : ''} />
          </button>
        </div>

        {/* Device list */}
        <div style={{ flex: 1, overflowY: 'auto' }} className="sa-scroll">
          {devLoading ? (
            <div className="sa-empty" style={{ padding: '24px 12px' }}>
              SCANNING...
            </div>
          ) : devices.length === 0 ? (
            <div className="sa-empty" style={{ padding: '24px 12px' }}>
              NO_DEVICES
            </div>
          ) : (
            devices.map((dev) => (
              <DeviceRow
                key={dev.hash}
                device={dev}
                selected={selected === dev.hash}
                onClick={() => { void handleSelectDevice(dev.hash) }}
              />
            ))
          )}
        </div>

        {/* Privacy notice */}
        <div style={{ padding: '8px 12px', borderTop: '1px solid #141414' }}>
          <p
            style={{
              fontFamily:    'var(--sa-font-mono)',
              fontSize:       7,
              color:         '#1a1a1a',
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
            }}
          >
            GPS_EXCLUDED · ANON ONLY
          </p>
        </div>
      </div>

      {/* ── Right Panel — Diagnostics ───────────────────────────────── */}
      <div
        style={{
          flex:          1,
          display:       'flex',
          flexDirection: 'column',
          gap:            1,
          overflow:      'hidden',
          minWidth:       0,
        }}
      >
        {!selected ? (
          <SelectDevicePrompt />
        ) : (
          <>
            {/* Session control bar */}
            <SessionBar
              deviceHash={selected}
              sessionState={sessionState}
              countdown={countdown}
              onStartRequest={() => setSessionState('confirm')}
              onConfirm={() => startSession()}
              onAbortConfirm={() => setSessionState('idle')}
              onStop={stopSession}
            />

            {/* Live chart + report row */}
            <div style={{ display: 'flex', gap: 1, flex: '0 0 auto' }}>
              {/* 60s Rolling Chart */}
              <div
                style={{
                  flex:          1,
                  background:    '#0d0d0d',
                  border:        '1px solid #1a1a1a',
                  borderRadius:   2,
                  padding:       '12px 14px',
                  minWidth:       0,
                }}
              >
                <p className="sa-label" style={{ marginBottom: 10 }}>
                  60-SECOND ROLLING TELEMETRY
                </p>
                <LiveMiniChart
                  report={report}
                  liveEvents={liveEvents}
                  active={sessionState === 'active'}
                />
              </div>

              {/* Panic snapshot */}
              {report?.lastPanic && (
                <div
                  style={{
                    width:         220,
                    flexShrink:     0,
                    background:    'rgba(220,38,38,0.04)',
                    border:        '1px solid rgba(220,38,38,0.2)',
                    borderRadius:   2,
                    padding:       '12px 14px',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
                    <AlertTriangle size={11} style={{ color: '#dc2626' }} />
                    <p className="sa-label" style={{ color: '#dc2626' }}>LAST PANIC</p>
                  </div>
                  <PanicSnapshot panic={report.lastPanic} />
                </div>
              )}
            </div>

            {/* Debug Console */}
            <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
              <DebugConsole
                events={liveEvents}
                active={sessionState === 'active'}
                deviceHash={selected}
                sessionStart={sessionStart}
              />
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ── Device Row ────────────────────────────────────────────────────────────────

function DeviceRow({
  device, selected, onClick,
}: {
  device: KnownDevice; selected: boolean; onClick: () => void
}) {
  const hColor = healthColor(device.lastHealth)
  return (
    <div
      onClick={onClick}
      style={{
        padding:      '8px 12px',
        borderBottom: '1px solid #141414',
        cursor:       'pointer',
        background:   selected ? 'rgba(59,130,246,0.06)' : 'transparent',
        borderLeft:   `2px solid ${selected ? '#3b82f6' : 'transparent'}`,
        transition:   'background 100ms ease',
      }}
      onMouseEnter={(e) => {
        if (!selected) (e.currentTarget as HTMLDivElement).style.background = 'rgba(255,255,255,0.02)'
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLDivElement).style.background = selected ? 'rgba(59,130,246,0.06)' : 'transparent'
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span
          className="sa-mono"
          style={{ fontSize: 11, fontWeight: 600, color: selected ? '#93c5fd' : '#6b7280' }}
        >
          dev:{device.hash}
        </span>
        <span
          className="sa-dot"
          style={{ background: hColor, width: 5, height: 5, animationPlayState: selected ? 'running' : 'paused' }}
        />
      </div>
      <p style={{ fontFamily: 'var(--sa-font-ui)', fontSize: 9, color: '#2d3748', marginTop: 3 }}>
        {_ago(device.lastSeen)} · {device.eventCount} events
      </p>
      <p
        style={{
          fontFamily:    'var(--sa-font-mono)',
          fontSize:       9,
          color:         device.thermalLevel >= 2 ? thermalColor(device.thermalLevel) : '#2d3748',
          marginTop:      2,
        }}
      >
        T:L{device.thermalLevel} · {device.lastHealth.toUpperCase()}
      </p>
    </div>
  )
}

// ── Session Control Bar ───────────────────────────────────────────────────────

function SessionBar({
  deviceHash, sessionState, countdown,
  onStartRequest, onConfirm, onAbortConfirm, onStop,
}: {
  deviceHash:     string
  sessionState:   string
  countdown:      number
  onStartRequest: () => void
  onConfirm:      () => void
  onAbortConfirm: () => void
  onStop:         () => void
}) {
  return (
    <div
      style={{
        display:       'flex',
        alignItems:    'center',
        gap:            12,
        padding:       '8px 14px',
        background:    '#0d0d0d',
        border:        '1px solid #1a1a1a',
        borderRadius:   2,
        flexShrink:     0,
      }}
    >
      <Terminal size={12} style={{ color: '#4b5563' }} />
      <span className="sa-mono" style={{ fontSize: 10, color: '#4b5563' }}>
        dev:{deviceHash}
      </span>

      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
        {sessionState === 'idle' && (
          <SessionBtn
            label="START REMOTE DEBUG"
            color="#60a5fa"
            icon={<PlayCircle size={11} />}
            onClick={onStartRequest}
          />
        )}

        {sessionState === 'confirm' && (
          <>
            <span
              style={{
                fontFamily:    'var(--sa-font-mono)',
                fontSize:       9,
                color:         '#d97706',
                letterSpacing: '0.08em',
              }}
            >
              Confirm 60s debug session?
            </span>
            <SessionBtn label="CONFIRM" color="#d97706" icon={<CheckCircle size={11} />} onClick={onConfirm} />
            <SessionBtn label="CANCEL"  color="#4b5563" onClick={onAbortConfirm} />
          </>
        )}

        {sessionState === 'active' && (
          <>
            <span
              className="sa-mono"
              style={{ fontSize: 10, color: countdown <= 10 ? '#dc2626' : '#4ade80' }}
            >
              {countdown}s remaining
            </span>
            <SessionBtn label="STOP" color="#dc2626" icon={<StopCircle size={11} />} onClick={onStop} />
          </>
        )}

        {sessionState === 'ended' && (
          <>
            <span className="sa-mono" style={{ fontSize: 9, color: '#2d3748' }}>SESSION_ENDED</span>
            <SessionBtn label="NEW SESSION" color="#60a5fa" icon={<PlayCircle size={11} />} onClick={onStartRequest} />
          </>
        )}
      </div>
    </div>
  )
}

function SessionBtn({
  label, color, icon, onClick,
}: {
  label: string; color: string; icon?: React.ReactNode; onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      style={{
        display:       'flex',
        alignItems:    'center',
        gap:            4,
        padding:       '4px 10px',
        background:    `${color}10`,
        border:        `1px solid ${color}40`,
        borderRadius:   2,
        cursor:        'pointer',
        fontFamily:    'var(--sa-font-mono)',
        fontSize:       9,
        fontWeight:     700,
        color,
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        transition:    'border-color 150ms ease',
      }}
    >
      {icon}{label}
    </button>
  )
}

// ── Live Mini Chart ───────────────────────────────────────────────────────────

function LiveMiniChart({
  report, liveEvents, active,
}: {
  report:      DiagnosticReport | null
  liveEvents:  LiveEvent[]
  active:      boolean
}) {
  // Combine baseline events + live events into time-ordered points
  const basePoints = report?.events.slice(-30) ?? []

  // Convert LiveEvents to display-compatible points
  const W = 600, HT = 28, HR = 28
  const all = basePoints

  if (all.length === 0 && liveEvents.length === 0) {
    return (
      <div
        style={{
          display:         'flex',
          alignItems:      'center',
          justifyContent:  'center',
          height:           64,
          fontFamily:      'var(--sa-font-mono)',
          fontSize:         10,
          color:           '#2d3748',
          letterSpacing:   '0.06em',
        }}
      >
        {active ? 'AWAITING_TELEMETRY...' : 'NO_DATA: Start a session to see live metrics'}
      </div>
    )
  }

  const n     = all.length
  const xOf   = (i: number) => n > 1 ? (i / (n - 1)) * (W - 4) + 2 : W / 2
  const yT    = (l: number) => HT - 2 - (l / 3) * (HT - 4)
  const yR    = (p: number) => HR - 2 - (p / 100) * (HR - 4)

  // Thermal line
  const thermalPts = all.map((p, i) => `${xOf(i).toFixed(1)},${yT(p.thermalLevel).toFixed(1)}`).join(' ')

  // RAM area
  const ramLine = all.map((p, i) => `${xOf(i).toFixed(1)},${yR(p.ramPressure).toFixed(1)}`).join(' ')
  const ramArea = `M 2,${HR} L ${all.map((p, i) => `${xOf(i).toFixed(1)},${yR(p.ramPressure).toFixed(1)}`).join(' L ')} L ${xOf(n-1).toFixed(1)},${HR} Z`

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {/* Thermal */}
      <div>
        <p className="sa-label" style={{ marginBottom: 3 }}>THERMAL</p>
        <svg viewBox={`0 0 ${W} ${HT}`} preserveAspectRatio="none" style={{ width: '100%', height: HT }}>
          <polyline points={thermalPts} fill="none" stroke="#d97706" strokeWidth={1} strokeOpacity={0.8} />
          {active && n > 0 && (
            <circle cx={xOf(n-1)} cy={yT(all[n-1].thermalLevel)} r={2} fill="#d97706" />
          )}
        </svg>
      </div>

      {/* RAM */}
      <div>
        <p className="sa-label" style={{ marginBottom: 3 }}>RAM PRESSURE</p>
        <svg viewBox={`0 0 ${W} ${HR}`} preserveAspectRatio="none" style={{ width: '100%', height: HR }}>
          <path d={ramArea} fill="#60a5fa" fillOpacity={0.08} />
          <polyline points={ramLine} fill="none" stroke="#60a5fa" strokeWidth={1} strokeOpacity={0.6} />
          {active && n > 0 && (
            <circle cx={xOf(n-1)} cy={yR(all[n-1].ramPressure)} r={2} fill="#60a5fa" />
          )}
        </svg>
      </div>
    </div>
  )
}

// ── Panic Snapshot ────────────────────────────────────────────────────────────

function PanicSnapshot({ panic }: { panic: Record<string, unknown> }) {
  const fields = [
    { label: 'TIMESTAMP', value: typeof panic['ts'] === 'string' ? panic['ts'].slice(0, 19).replace('T', ' ') : '—' },
    { label: 'THERMAL',   value: `L${panic['thermal'] ?? '?'}` },
    { label: 'HEALTH',    value: String(panic['overallHealth'] ?? 'critical').toUpperCase() },
  ]
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {fields.map((f) => (
        <div key={f.label}>
          <p className="sa-label">{f.label}</p>
          <p className="sa-mono" style={{ fontSize: 11, color: '#dc2626', marginTop: 2 }}>{f.value}</p>
        </div>
      ))}
    </div>
  )
}

// ── Empty states ──────────────────────────────────────────────────────────────

function SelectDevicePrompt() {
  return (
    <div
      style={{
        flex:            1,
        display:         'flex',
        flexDirection:   'column',
        alignItems:      'center',
        justifyContent:  'center',
        gap:              12,
        border:          '1px solid #1a1a1a',
        borderRadius:     2,
      }}
    >
      <Activity size={20} style={{ color: '#2d3748' }} />
      <p
        style={{
          fontFamily:    'var(--sa-font-mono)',
          fontSize:       11,
          color:         '#2d3748',
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
        }}
      >
        SELECT_DEVICE: Choose a device from the list to begin diagnostics
      </p>
    </div>
  )
}
