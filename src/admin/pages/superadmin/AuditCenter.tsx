/**
 * AuditCenter — Denetim Merkezi
 *
 * Tüm Super Admin aksiyonlarını listeler.
 * Satıra tıklanınca JSON Before/After diff görünümü açılır.
 * "Critical Only" toggle ile acil durum kayıtları izoleli görüntülenir.
 */

import { useEffect, useState, useCallback } from 'react'
import { RefreshCw, Filter, ChevronRight, AlertTriangle, Info, Clock } from 'lucide-react'
import {
  getAuditLogs,
  getAuditLogDetail,
  type AuditLogEntry,
} from '../../services/superadmin.service'
import { Button }   from '../../components/ui/Button'
import '../../styles/admin-enterprise.css'

// ── Yardımcılar ───────────────────────────────────────────────────────────────

function _fmt(iso: string): string {
  try {
    return new Date(iso).toLocaleString('tr-TR', {
      day: '2-digit', month: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    })
  } catch { return iso }
}

function _actorShort(id: string | null): string {
  if (!id) return 'SYSTEM'
  return id.replace(/-/g, '').slice(0, 8).toUpperCase()
}

function _actionLabel(action: string): { label: string; color: string } {
  if (action.startsWith('system.emergency')) return { label: action, color: '#dc2626' }
  if (action.startsWith('flag.'))            return { label: action, color: '#d97706' }
  if (action.startsWith('policy.'))          return { label: action, color: '#60a5fa' }
  if (action.startsWith('superadmin.'))      return { label: action, color: '#4b5563' }
  return { label: action, color: '#4b5563' }
}

// ── JSON Diff Renderer ────────────────────────────────────────────────────────

function renderDiff(value: unknown): React.ReactNode {
  if (value === null || value === undefined) {
    return <span style={{ color: '#2d3748' }}>null</span>
  }
  const lines = JSON.stringify(value, null, 2).split('\n')
  return lines.map((line, i) => {
    const isKey  = /^\s+"[\w.]+":/.test(line)
    const style: React.CSSProperties = isKey ? { color: '#60a5fa' } : { color: '#4b5563' }
    return <div key={i} style={style}>{line}</div>
  })
}

// ── AuditCenter ───────────────────────────────────────────────────────────────

export function AuditCenter() {
  const [logs,         setLogs]         = useState<AuditLogEntry[]>([])
  const [loading,      setLoading]      = useState(true)
  const [criticalOnly, setCriticalOnly] = useState(false)
  const [selected,     setSelected]     = useState<AuditLogEntry | null>(null)
  const [detailLoading,setDetailLoading]= useState(false)
  const [lastFetch,    setLastFetch]    = useState(0)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setLogs(await getAuditLogs(200, criticalOnly))
      setLastFetch(Date.now())
    } finally {
      setLoading(false)
    }
  }, [criticalOnly])

  useEffect(() => {
    void load()
    const id = setInterval(() => { void load() }, 30_000)
    return () => clearInterval(id)
  }, [load])

  async function handleRowClick(entry: AuditLogEntry) {
    if (selected?.id === entry.id) { setSelected(null); return }
    setDetailLoading(true)
    try {
      const detail = await getAuditLogDetail(entry.id)
      setSelected(detail ?? entry)
    } finally {
      setDetailLoading(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 1, maxWidth: 1200 }}>

      {/* Header */}
      <div className="flex items-center justify-between" style={{ marginBottom: 14 }}>
        <div>
          <p className="sa-label">AUDIT CENTER</p>
          <p style={{ fontSize: 10, color: '#2d3748', fontFamily: 'var(--sa-font-ui)', marginTop: 2 }}>
            {lastFetch > 0
              ? `${logs.length} records · refreshed ${Math.floor((Date.now() - lastFetch) / 1000)}s ago`
              : 'Loading audit trail…'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Critical Only toggle */}
          <button
            onClick={() => setCriticalOnly((v) => !v)}
            style={{
              display:       'flex',
              alignItems:    'center',
              gap:            6,
              padding:       '5px 10px',
              background:    criticalOnly ? 'rgba(220,38,38,0.08)' : 'transparent',
              border:        `1px solid ${criticalOnly ? '#dc2626' : '#1a1a1a'}`,
              borderRadius:   2,
              cursor:        'pointer',
              fontFamily:    'var(--sa-font-ui)',
              fontSize:       9,
              fontWeight:     700,
              letterSpacing: '0.08em',
              color:         criticalOnly ? '#dc2626' : '#4b5563',
              textTransform: 'uppercase',
              transition:    'all 150ms ease',
            }}
          >
            <Filter size={10} />
            Critical Only
          </button>
          <Button variant="outline" size="sm" disabled={loading} onClick={() => { void load() }}>
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
            Refresh
          </Button>
        </div>
      </div>

      {/* Table */}
      <div
        style={{
          background:    '#0d0d0d',
          border:        '1px solid #1a1a1a',
          borderRadius:   2,
          overflow:      'hidden',
        }}
      >
        {/* Table header */}
        <div
          style={{
            display:             'grid',
            gridTemplateColumns: '140px 80px 1fr 140px 72px 24px',
            gap:                  0,
            padding:             '7px 12px',
            background:          '#080808',
            borderBottom:        '1px solid #1a1a1a',
          }}
        >
          {['TIMESTAMP', 'ACTOR', 'ACTION', 'TARGET', 'SEV', ''].map((h) => (
            <span key={h} className="sa-label">{h}</span>
          ))}
        </div>

        {loading && logs.length === 0 ? (
          <AuditSkeleton />
        ) : logs.length === 0 ? (
          <div className="sa-empty">
            <Info size={16} style={{ color: '#2d3748', opacity: 0.5 }} />
            NO_RECORDS: Audit trail is empty
          </div>
        ) : (
          <div style={{ maxHeight: 520, overflowY: 'auto' }} className="sa-scroll">
            {logs.map((entry) => (
              <AuditRow
                key={entry.id}
                entry={entry}
                active={selected?.id === entry.id}
                onClick={() => { void handleRowClick(entry) }}
              />
            ))}
          </div>
        )}
      </div>

      {/* Detail Panel — JSON Diff */}
      {selected && (
        <DetailPanel
          entry={selected}
          loading={detailLoading}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  )
}

// ── Audit Row ─────────────────────────────────────────────────────────────────

function AuditRow({
  entry, active, onClick,
}: {
  entry: AuditLogEntry; active: boolean; onClick: () => void
}) {
  const { label, color } = _actionLabel(entry.action)
  const isEmergency = entry.action.includes('emergency')

  return (
    <div
      onClick={onClick}
      style={{
        display:             'grid',
        gridTemplateColumns: '140px 80px 1fr 140px 72px 24px',
        gap:                  0,
        padding:             '6px 12px',
        borderBottom:        '1px solid #141414',
        cursor:              'pointer',
        background:          active
          ? 'rgba(96,165,250,0.04)'
          : isEmergency ? 'rgba(220,38,38,0.03)' : 'transparent',
        transition:          'background 100ms ease',
        alignItems:          'center',
      }}
      onMouseEnter={(e) => {
        if (!active) (e.currentTarget as HTMLDivElement).style.background = 'rgba(255,255,255,0.015)'
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLDivElement).style.background = active
          ? 'rgba(96,165,250,0.04)'
          : isEmergency ? 'rgba(220,38,38,0.03)' : 'transparent'
      }}
    >
      {/* Timestamp */}
      <span
        className="sa-mono"
        style={{ fontSize: 10, color: '#374151' }}
      >
        {_fmt(entry.created_at)}
      </span>

      {/* Actor */}
      <span
        className="sa-mono"
        style={{ fontSize: 9, color: '#2d3748', letterSpacing: '0.06em' }}
      >
        {_actorShort(entry.actor_id)}
      </span>

      {/* Action */}
      <span
        className="sa-mono"
        style={{ fontSize: 10, color, fontWeight: isEmergency ? 700 : 400 }}
      >
        {label}
      </span>

      {/* Target */}
      <span
        className="sa-mono"
        style={{ fontSize: 9, color: '#374151', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
      >
        {entry.target}
      </span>

      {/* Severity */}
      <SevBadge severity={entry.severity} />

      {/* Expand icon */}
      <ChevronRight
        size={11}
        style={{
          color:       '#2d3748',
          transform:   active ? 'rotate(90deg)' : 'none',
          transition:  'transform 150ms ease',
        }}
      />
    </div>
  )
}

// ── Severity Badge ────────────────────────────────────────────────────────────

function SevBadge({ severity }: { severity: string }) {
  const map: Record<string, { color: string; icon: React.ReactNode }> = {
    critical: { color: '#dc2626', icon: <AlertTriangle size={9} /> },
    warning:  { color: '#d97706', icon: <AlertTriangle size={9} /> },
    info:     { color: '#4b5563', icon: <Info size={9} /> },
  }
  const s = map[severity] ?? map['info']
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, color: s.color }}>
      {s.icon}
      <span
        style={{
          fontFamily:    'var(--sa-font-ui)',
          fontSize:       8,
          fontWeight:     700,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
        }}
      >
        {severity}
      </span>
    </div>
  )
}

// ── Detail Panel ──────────────────────────────────────────────────────────────

function DetailPanel({
  entry, loading, onClose,
}: {
  entry: AuditLogEntry; loading: boolean; onClose: () => void
}) {
  return (
    <div
      style={{
        background:    '#0d0d0d',
        border:        '1px solid #1a1a1a',
        borderRadius:   2,
        overflow:      'hidden',
      }}
    >
      {/* Panel header */}
      <div
        style={{
          display:       'flex',
          alignItems:    'center',
          justifyContent: 'space-between',
          padding:       '8px 12px',
          borderBottom:  '1px solid #1a1a1a',
          background:    '#080808',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Clock size={11} style={{ color: '#2d3748' }} />
          <span className="sa-label">JSON DIFF — {entry.action}</span>
          <span
            className="sa-mono"
            style={{ fontSize: 9, color: '#2d3748' }}
          >
            {_fmt(entry.created_at)}
          </span>
        </div>
        <button
          onClick={onClose}
          style={{
            background: 'transparent', border: 'none', cursor: 'pointer',
            color: '#374151', fontSize: 10, fontFamily: 'var(--sa-font-mono)',
            letterSpacing: '0.08em',
          }}
        >
          CLOSE
        </button>
      </div>

      {loading ? (
        <div
          style={{
            height: 100, display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontFamily: 'var(--sa-font-mono)', fontSize: 10, color: '#2d3748',
          }}
        >
          LOADING_DIFF…
        </div>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: 1,
          }}
        >
          {/* Before */}
          <div style={{ padding: '10px 12px' }}>
            <p className="sa-label" style={{ marginBottom: 6 }}>
              BEFORE
            </p>
            <div className="sa-diff-panel">
              {renderDiff(entry.before_val)}
            </div>
          </div>

          {/* After */}
          <div style={{ padding: '10px 12px' }}>
            <p
              className="sa-label"
              style={{ marginBottom: 6, color: entry.severity === 'critical' ? '#dc2626' : undefined }}
            >
              AFTER
            </p>
            <div
              className="sa-diff-panel"
              style={entry.severity === 'critical' ? { borderColor: '#dc262640' } : undefined}
            >
              {renderDiff(entry.after_val)}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Skeleton ──────────────────────────────────────────────────────────────────

function AuditSkeleton() {
  return (
    <div style={{ padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 3 }}>
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} style={{ height: 26, borderRadius: 2, background: '#0f0f0f', opacity: 1 - i * 0.12 }} />
      ))}
    </div>
  )
}
