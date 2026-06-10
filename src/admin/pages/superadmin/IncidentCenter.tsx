/**
 * IncidentCenter — Tanı Kayıtları (Remote Log v1 / Commit 5)
 *
 * vehicle_events içindeki critical_error / obd_diag / support_snapshot
 * kayıtlarını filtreli + sayfalı listeler (AuditCenter deseni).
 * Satır tıklanınca detay paneli: support_snapshot için health/obd/ota/
 * lastCritical bölümleri, diğer tipler için tam (redact edilmiş) JSON.
 * Tüm metadata render'dan önce redactIncidentMetadata'dan geçer —
 * konum/VIN/plaka/MAC/token admin ekranında asla görünmez.
 */

import { useEffect, useState, useCallback } from 'react'
import { RefreshCw, ChevronRight, ChevronLeft, AlertTriangle, Info, Stethoscope, Camera } from 'lucide-react'
import {
  getRemoteIncidents,
  redactIncidentMetadata,
  INCIDENT_TYPES,
  type IncidentEntry,
  type IncidentType,
} from '../../services/superadmin.service'
import { Button } from '../../components/ui/Button'
import '../../styles/admin-enterprise.css'

const PAGE_SIZE = 50

// ── Yardımcılar ───────────────────────────────────────────────────────────────

function _fmt(iso: string): string {
  try {
    return new Date(iso).toLocaleString('tr-TR', {
      day: '2-digit', month: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    })
  } catch { return iso }
}

function _vehicleShort(id: string): string {
  return id.replace(/-/g, '').slice(0, 8).toUpperCase()
}

const TYPE_STYLE: Record<IncidentType, { color: string; label: string }> = {
  critical_error:   { color: '#dc2626', label: 'KRİTİK' },
  obd_diag:         { color: '#d97706', label: 'OBD_TANI' },
  support_snapshot: { color: '#60a5fa', label: 'ANLIK_GÖRÜNTÜ' },
  voice_diag:       { color: '#a78bfa', label: 'SES' },
}

function _str(v: unknown): string {
  return typeof v === 'string' ? v : v == null ? '—' : String(v)
}

// ── JSON Renderer (AuditCenter renderDiff deseni) ─────────────────────────────

function renderJson(value: unknown): React.ReactNode {
  if (value === null || value === undefined) {
    return <span style={{ color: '#2d3748' }}>null</span>
  }
  const lines = JSON.stringify(value, null, 2).split('\n')
  return lines.map((line, i) => {
    const isKey = /^\s+"[\w.]+":/.test(line)
    return <div key={i} style={{ color: isKey ? '#60a5fa' : '#4b5563' }}>{line}</div>
  })
}

// ── IncidentCenter ────────────────────────────────────────────────────────────

export function IncidentCenter() {
  const [rows,       setRows]       = useState<IncidentEntry[]>([])
  const [loading,    setLoading]    = useState(true)
  const [queryError, setQueryError] = useState<string | null>(null)
  const [selected,   setSelected]   = useState<IncidentEntry | null>(null)

  // Filtreler
  const [typeFilter, setTypeFilter] = useState<IncidentType | ''>('')
  const [vehicleId,  setVehicleId]  = useState('')
  const [appVersion, setAppVersion] = useState('')
  const [since,      setSince]      = useState('') // yyyy-mm-dd
  const [until,      setUntil]      = useState('')
  const [page,       setPage]       = useState(0)

  const load = useCallback(async () => {
    setLoading(true)
    setSelected(null)
    try {
      const result = await getRemoteIncidents({
        type:       typeFilter || undefined,
        vehicleId:  vehicleId.trim()  || undefined,
        appVersion: appVersion.trim() || undefined,
        since:      since ? new Date(since).toISOString() : undefined,
        // until: gün SONU dahil olsun (tarih alanı 00:00 döner)
        until:      until ? new Date(`${until}T23:59:59.999Z`).toISOString() : undefined,
        limit:      PAGE_SIZE,
        offset:     page * PAGE_SIZE,
      })
      setRows(result.rows)
      setQueryError(result.error)
    } finally {
      setLoading(false)
    }
  }, [typeFilter, vehicleId, appVersion, since, until, page])

  useEffect(() => { void load() }, [load])

  // Filtre değişiminde sayfa başa döner
  function onFilterChange<T>(setter: (v: T) => void): (v: T) => void {
    return (v) => { setPage(0); setter(v) }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 1, maxWidth: 1280 }}>

      {/* Header */}
      <div className="flex items-center justify-between" style={{ marginBottom: 10 }}>
        <div>
          <p className="sa-label">OLAY MERKEZİ — TANI KAYITLARI</p>
          <p style={{ fontSize: 10, color: '#2d3748', fontFamily: 'var(--sa-font-ui)', marginTop: 2 }}>
            critical_error · obd_diag · support_snapshot · voice_diag — cihazda sanitize edilmiş uzak tanı verisi
          </p>
        </div>
        <Button variant="outline" size="sm" disabled={loading} onClick={() => { void load() }}>
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
          Yenile
        </Button>
      </div>

      {/* Filtre çubuğu */}
      <div
        style={{
          display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center',
          padding: '8px 12px', background: '#0d0d0d',
          border: '1px solid #1a1a1a', borderRadius: 2, marginBottom: 1,
        }}
      >
        <select
          aria-label="Event tipi"
          value={typeFilter}
          onChange={(e) => onFilterChange(setTypeFilter)(e.target.value as IncidentType | '')}
          className="sa-mono"
          style={_filterStyle}
        >
          <option value="">TÜM TİPLER</option>
          {INCIDENT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <input
          aria-label="Araç ID"
          placeholder="araç id"
          value={vehicleId}
          onChange={(e) => onFilterChange(setVehicleId)(e.target.value)}
          className="sa-mono"
          style={{ ..._filterStyle, width: 180 }}
        />
        <input
          aria-label="Uygulama sürümü"
          placeholder="uygulama sürümü (ör. 2.4.0)"
          value={appVersion}
          onChange={(e) => onFilterChange(setAppVersion)(e.target.value)}
          className="sa-mono"
          style={{ ..._filterStyle, width: 140 }}
        />
        <input
          aria-label="Başlangıç tarihi"
          type="date"
          value={since}
          onChange={(e) => onFilterChange(setSince)(e.target.value)}
          className="sa-mono"
          style={_filterStyle}
        />
        <span style={{ color: '#2d3748', fontSize: 10 }}>→</span>
        <input
          aria-label="Bitiş tarihi"
          type="date"
          value={until}
          onChange={(e) => onFilterChange(setUntil)(e.target.value)}
          className="sa-mono"
          style={_filterStyle}
        />
      </div>

      {/* Hata durumu */}
      {queryError && (
        <div
          style={{
            display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px',
            background: 'rgba(220,38,38,0.06)', border: '1px solid rgba(220,38,38,0.35)',
            borderRadius: 2, marginBottom: 1,
          }}
        >
          <AlertTriangle size={12} style={{ color: '#dc2626' }} />
          <span className="sa-mono" style={{ fontSize: 10, color: '#f87171' }}>
            SORGU_HATASI: {queryError}
          </span>
          <button
            onClick={() => { void load() }}
            className="sa-mono"
            style={{
              marginLeft: 'auto', background: 'transparent', cursor: 'pointer',
              border: '1px solid #dc2626', borderRadius: 2, color: '#f87171',
              fontSize: 9, padding: '3px 8px', letterSpacing: '0.08em',
            }}
          >
            TEKRAR DENE
          </button>
        </div>
      )}

      {/* Tablo */}
      <div style={{ background: '#0d0d0d', border: '1px solid #1a1a1a', borderRadius: 2, overflow: 'hidden' }}>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '120px 90px 90px 110px 130px 1fr 24px',
            padding: '7px 12px', background: '#080808', borderBottom: '1px solid #1a1a1a',
          }}
        >
          {['ZAMAN', 'ARAÇ', 'TİP', 'BAĞLAM/AŞAMA', 'HATA KODU', 'MESAJ / SÜRÜM', ''].map((h) => (
            <span key={h} className="sa-label">{h}</span>
          ))}
        </div>

        {loading && rows.length === 0 ? (
          <IncidentSkeleton />
        ) : rows.length === 0 ? (
          <div className="sa-empty">
            <Info size={16} style={{ color: '#2d3748', opacity: 0.5 }} />
            {queryError ? 'SORGU_BAŞARISIZ: Kayıtlar alınamadı' : 'OLAY_YOK: Tanı kaydı yok'}
          </div>
        ) : (
          <div style={{ maxHeight: 480, overflowY: 'auto' }} className="sa-scroll">
            {rows.map((entry) => (
              <IncidentRow
                key={entry.id}
                entry={entry}
                active={selected?.id === entry.id}
                onClick={() => setSelected(selected?.id === entry.id ? null : entry)}
              />
            ))}
          </div>
        )}

        {/* Pagination */}
        <div
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '6px 12px', borderTop: '1px solid #1a1a1a', background: '#080808',
          }}
        >
          <span className="sa-mono" style={{ fontSize: 9, color: '#2d3748' }}>
            SAYFA {page + 1} · {rows.length} SATIR
          </span>
          <div style={{ display: 'flex', gap: 6 }}>
            <Button variant="outline" size="sm" disabled={loading || page === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}>
              <ChevronLeft size={11} /> Önceki
            </Button>
            <Button variant="outline" size="sm" disabled={loading || rows.length < PAGE_SIZE}
              onClick={() => setPage((p) => p + 1)}>
              Sonraki <ChevronRight size={11} />
            </Button>
          </div>
        </div>
      </div>

      {/* Detay paneli */}
      {selected && <IncidentDetail entry={selected} onClose={() => setSelected(null)} />}
    </div>
  )
}

const _filterStyle: React.CSSProperties = {
  background: '#080808', border: '1px solid #1a1a1a', borderRadius: 2,
  color: '#94a3b8', fontSize: 10, padding: '4px 8px', letterSpacing: '0.04em',
}

// ── Satır ─────────────────────────────────────────────────────────────────────

function IncidentRow({
  entry, active, onClick,
}: {
  entry: IncidentEntry; active: boolean; onClick: () => void
}) {
  const t  = TYPE_STYLE[entry.type] ?? { color: '#4b5563', label: entry.type }
  const md = entry.metadata ?? {}
  // voice_diag: aşama CTX kolonunda, intent/command + süre MSG kolonunda
  const ctxPhase  = entry.type === 'voice_diag'
    ? _str(md['stage'])
    : _str(md['phase'] ?? md['ctx'])
  const errorCode = _str(md['errorCode'])
  // support_snapshot'ta msg yok → appVersion göster (+ Dev Inspector kaynağı işareti)
  const msgCell = entry.type === 'support_snapshot'
    ? `v${_str(md['appVersion'])}${md['source'] === 'dev_inspector' ? ' · inspector' : ''}`
    : entry.type === 'voice_diag'
    ? `${_str(md['intent'] ?? md['command'])} · ${_str(md['durationMs'])}ms`
    : _str(md['msg'])

  return (
    <div
      onClick={onClick}
      style={{
        display: 'grid',
        gridTemplateColumns: '120px 90px 90px 110px 130px 1fr 24px',
        padding: '6px 12px', borderBottom: '1px solid #141414', cursor: 'pointer',
        alignItems: 'center',
        background: active ? 'rgba(96,165,250,0.04)'
          : entry.type === 'critical_error' ? 'rgba(220,38,38,0.03)' : 'transparent',
        transition: 'background 100ms ease',
      }}
    >
      <span className="sa-mono" style={{ fontSize: 10, color: '#374151' }}>{_fmt(entry.created_at)}</span>
      <span className="sa-mono" style={{ fontSize: 9, color: '#2d3748', letterSpacing: '0.06em' }}>
        {_vehicleShort(entry.vehicle_id)}
      </span>
      <span className="sa-mono" style={{ fontSize: 9, color: t.color, fontWeight: 700, letterSpacing: '0.06em' }}>
        {t.label}
      </span>
      <span className="sa-mono" style={{ fontSize: 10, color: '#4b5563', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {ctxPhase}
      </span>
      <span className="sa-mono" style={{ fontSize: 9, color: errorCode === '—' ? '#2d3748' : '#d97706', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {errorCode}
      </span>
      <span className="sa-mono" style={{ fontSize: 10, color: '#4b5563', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {msgCell}
      </span>
      <ChevronRight size={11} style={{ color: '#2d3748', transform: active ? 'rotate(90deg)' : 'none', transition: 'transform 150ms ease' }} />
    </div>
  )
}

// ── Detay paneli ──────────────────────────────────────────────────────────────

function IncidentDetail({ entry, onClose }: { entry: IncidentEntry; onClose: () => void }) {
  // Defense-in-depth: sanitizer ÖNCESİ eski kayıtlar konum/kimlik içerebilir —
  // admin ekranı render etmeden HER zaman redact eder.
  const md = redactIncidentMetadata(entry.metadata ?? {}) as Record<string, unknown>
  const isSnapshot = entry.type === 'support_snapshot'

  return (
    <div style={{ background: '#0d0d0d', border: '1px solid #1a1a1a', borderRadius: 2, overflow: 'hidden' }}>
      <div
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '8px 12px', borderBottom: '1px solid #1a1a1a', background: '#080808',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {isSnapshot ? <Camera size={11} style={{ color: '#2d3748' }} /> : <Stethoscope size={11} style={{ color: '#2d3748' }} />}
          <span className="sa-label">
            {entry.type.toUpperCase()} — {_vehicleShort(entry.vehicle_id)}
          </span>
          <span className="sa-mono" style={{ fontSize: 9, color: '#2d3748' }}>{_fmt(entry.created_at)}</span>
        </div>
        <button
          onClick={onClose}
          style={{
            background: 'transparent', border: 'none', cursor: 'pointer',
            color: '#374151', fontSize: 10, fontFamily: 'var(--sa-font-mono)', letterSpacing: '0.08em',
          }}
        >
          KAPAT
        </button>
      </div>

      {isSnapshot ? (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1 }}>
          <SnapshotSection title="SAĞLIK"     value={md['health']} />
          <SnapshotSection title="OBD"        value={md['obd']} />
          <SnapshotSection title="OTA"        value={md['ota']} />
          <SnapshotSection title="SON KRİTİK" value={md['lastCritical']} critical />
          {/* Dev Inspector "Tanı Gönder" — runtime/timeline/network özeti (source: dev_inspector) */}
          {md['inspector'] != null && (
            <SnapshotSection title="INSPECTOR" value={md['inspector']} />
          )}
        </div>
      ) : (
        <div style={{ padding: '10px 12px' }}>
          <p className="sa-label" style={{ marginBottom: 6 }}>VERİ</p>
          <div className="sa-diff-panel">{renderJson(md)}</div>
        </div>
      )}
    </div>
  )
}

function SnapshotSection({ title, value, critical }: { title: string; value: unknown; critical?: boolean }) {
  return (
    <div style={{ padding: '10px 12px' }}>
      <p className="sa-label" style={{ marginBottom: 6, color: critical && value ? '#dc2626' : undefined }}>
        {title}
      </p>
      <div className="sa-diff-panel" style={critical && value ? { borderColor: '#dc262640' } : undefined}>
        {renderJson(value ?? null)}
      </div>
    </div>
  )
}

// ── Skeleton ──────────────────────────────────────────────────────────────────

function IncidentSkeleton() {
  return (
    <div style={{ padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 3 }}>
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} style={{ height: 26, borderRadius: 2, background: '#0f0f0f', opacity: 1 - i * 0.12 }} />
      ))}
    </div>
  )
}
