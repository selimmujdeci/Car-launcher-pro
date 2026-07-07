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

import { useEffect, useState, useCallback, Component, type ReactNode } from 'react'
import { RefreshCw, ChevronRight, ChevronLeft, AlertTriangle, Info, Stethoscope, Camera } from 'lucide-react'
import {
  getRemoteIncidents,
  redactIncidentMetadata,
  INCIDENT_TYPES,
  type IncidentEntry,
  type IncidentType,
  type IncidentFilter,
  type IncidentQueryResult,
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

// Detay render'ını izole eden hata sınırı — bir bölüm patlasa bile TÜM admin
// sayfası kararmaz (fail-soft), hatayı okunur gösterir. Satır başına key ile
// sıfırlanır. (Admin'de global boundary yoktu — saha bulgusu 2026-07-06: tanı
// satırına tıklayınca boş sayfa.)
class DetailErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null }
  static getDerivedStateFromError(error: Error) { return { error } }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 12, background: '#1a0808', border: '1px solid #dc2626', borderRadius: 2, color: '#fca5a5', fontSize: 11, fontFamily: 'var(--sa-font-mono)' }}>
          <div style={{ fontWeight: 700, marginBottom: 4 }}>Detay render hatası (fail-soft — panel çökmedi)</div>
          <div style={{ color: '#f87171' }}>{String(this.state.error.message)}</div>
        </div>
      )
    }
    return this.props.children
  }
}

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

interface IncidentCenterProps {
  /** Veri kaynağı — varsayılan getRemoteIncidents (super_admin RLS). Erişilebilir
   *  "Tanı" sayfası bunu getRecentDiagnostics (RPC) ile geçer. */
  loader?:   (filter: IncidentFilter) => Promise<IncidentQueryResult>
  title?:    string
  subtitle?: string
}

export function IncidentCenter({
  loader   = getRemoteIncidents,
  title    = 'OLAY MERKEZİ — TANI KAYITLARI',
  subtitle = 'critical_error · obd_diag · support_snapshot · voice_diag — cihazda sanitize edilmiş uzak tanı verisi',
}: IncidentCenterProps = {}) {
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
      const result = await loader({
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
  }, [loader, typeFilter, vehicleId, appVersion, since, until, page])

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
          <p className="sa-label">{title}</p>
          <p style={{ fontSize: 10, color: '#2d3748', fontFamily: 'var(--sa-font-ui)', marginTop: 2 }}>
            {subtitle}
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
      {selected && (
        <DetailErrorBoundary key={selected.id}>
          <IncidentDetail entry={selected} onClose={() => setSelected(null)} />
        </DetailErrorBoundary>
      )}
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
          {/* Tanı Robotu — aktif self-test taraması (source: self_test) */}
          {md['selfTest'] != null && (
            <div style={{ gridColumn: '1 / -1' }}>
              <SelfTestSection report={md['selfTest'] as SelfTestReportLike} />
            </div>
          )}
          {/* UI aktivite — zamansız açılan modal/overlay izi */}
          {md['uiActivity'] != null && (
            <div style={{ gridColumn: '1 / -1' }}>
              <UiActivitySection activity={md['uiActivity'] as UiActivityLike} />
            </div>
          )}
          {/* OBD derin — adaptör + sensör tazeliği + canlı sinyaller + PID + DTC */}
          {md['obdDeep'] != null && (
            <div style={{ gridColumn: '1 / -1' }}>
              <ObdDeepSection deep={md['obdDeep'] as ObdDeepLike} />
            </div>
          )}
          {/* Perf zaman serisi — termal/bellek/fps/lag trendi */}
          {md['perfSeries'] != null && (
            <div style={{ gridColumn: '1 / -1' }}>
              <PerfSeriesSection series={md['perfSeries'] as PerfSeriesLike} />
            </div>
          )}
          {/* Ağ / AI sağlığı — online + devre kesici + sağlayıcı kota pencereleri */}
          {md['netAi'] != null && (
            <div style={{ gridColumn: '1 / -1' }}>
              <NetAiSection netAi={md['netAi'] as NetAiLike} />
            </div>
          )}
          {/* GPS derin — izin + fix tazeliği + doğruluk + DR (🔒 koordinat YOK) */}
          {md['gps'] != null && (
            <div style={{ gridColumn: '1 / -1' }}>
              <GpsDeepSection gps={md['gps'] as GpsDeepLike} />
            </div>
          )}
          {/* Sesli asistan / STT — Vosk hazırlığı + wake word + son sonuç (ham transkript YOK) */}
          {md['voice'] != null && (
            <div style={{ gridColumn: '1 / -1' }}>
              <VoiceDiagSection voice={md['voice'] as VoiceDiagLike} />
            </div>
          )}
          {/* Güvenli bölge (geofence) — bulut-okuma durumu + bölge sayısı */}
          {md['geofence'] != null && (
            <div style={{ gridColumn: '1 / -1' }}>
              <GeofenceDiagSection geofence={md['geofence'] as GeofenceDiagLike} />
            </div>
          )}
          {/* Depolama + kuyruk — bekleyen at-least-once event sayısı + disk kullanımı */}
          {md['storageQueue'] != null && (
            <div style={{ gridColumn: '1 / -1' }}>
              <StorageQueueSection sq={md['storageQueue'] as StorageQueueLike} />
            </div>
          )}
          {/* Güç/Akü sağlığı — 12V voltaj + kaynak + rozet + son 10sn min/max */}
          {md['power'] != null && (
            <div style={{ gridColumn: '1 / -1' }}>
              <PowerSection power={md['power'] as PowerLike} />
            </div>
          )}
          {/* Sensör füzyon tutarlılığı — aktif hız kaynağı + GPS/donanım farkı + güven */}
          {md['fusion'] != null && (
            <div style={{ gridColumn: '1 / -1' }}>
              <FusionSection fusion={md['fusion'] as FusionLike} />
            </div>
          )}
          {/* Boot zaman çizelgesi — her Wave süresi + toplam cold-start + en yavaş dalga */}
          {md['bootTiming'] != null && (
            <div style={{ gridColumn: '1 / -1' }}>
              <BootTimingSection timing={md['bootTiming'] as BootTimingLike} />
            </div>
          )}
          {/* Transport/bağlantı sağlığı — aktif transport + reconnect sayısı + son kopma nedeni */}
          {md['transport'] != null && (
            <div style={{ gridColumn: '1 / -1' }}>
              <TransportSection transport={md['transport'] as TransportLike} />
            </div>
          )}
          {/* Olay izi (breadcrumb) — soruna ne yol açtı */}
          {Array.isArray(md['trail']) && (md['trail'] as unknown[]).length > 0 && (
            <div style={{ gridColumn: '1 / -1' }}>
              <TrailSection trail={md['trail'] as TrailEventLike[]} />
            </div>
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

// ── Tanı Robotu (self-test) render ─────────────────────────────────────────────
// Yapısal (decoupled) tip — platform modülünü admin bundle'ına bağlamamak için.
type SelfTestStatusLike = 'pass' | 'warn' | 'fail' | 'skip'
interface SelfTestProbeLike {
  name: string; category: string; status: SelfTestStatusLike; detail: string; metric?: number; durationMs: number
}
interface SelfTestReportLike {
  totalMs?: number
  worst?: SelfTestStatusLike
  summary?: Partial<Record<SelfTestStatusLike, number>>
  env?: { tier?: string; webView?: number; cores?: number; memoryMb?: number }
  results?: SelfTestProbeLike[]
}

const SELFTEST_COLOR: Record<SelfTestStatusLike, string> = {
  pass: '#16a34a', warn: '#d97706', fail: '#dc2626', skip: '#4b5563',
}
const SELFTEST_MARK: Record<SelfTestStatusLike, string> = {
  pass: '✓', warn: '!', fail: '✕', skip: '·',
}

function SelfTestSection({ report }: { report: SelfTestReportLike }) {
  const results = Array.isArray(report.results) ? report.results : []
  const s = report.summary ?? {}
  const worst = report.worst ?? 'skip'
  // En kötüden en iyiye sırala (fail → warn → pass → skip)
  const rank: Record<SelfTestStatusLike, number> = { fail: 0, warn: 1, pass: 2, skip: 3 }
  const sorted = [...results].sort((a, b) => (rank[a.status] ?? 9) - (rank[b.status] ?? 9))

  return (
    <div style={{ padding: '10px 12px', borderTop: '1px solid #1a1a1a' }}>
      <p className="sa-label" style={{ marginBottom: 6, color: SELFTEST_COLOR[worst] }}>
        TANI ROBOTU — SELF-TEST TARAMASI
      </p>
      <div className="sa-mono" style={{ fontSize: 10, color: '#6b7280', marginBottom: 8, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <span style={{ color: SELFTEST_COLOR.pass }}>✓ {s.pass ?? 0}</span>
        <span style={{ color: SELFTEST_COLOR.warn }}>! {s.warn ?? 0}</span>
        <span style={{ color: SELFTEST_COLOR.fail }}>✕ {s.fail ?? 0}</span>
        <span style={{ color: SELFTEST_COLOR.skip }}>· {s.skip ?? 0}</span>
        {report.env?.tier && <span>tier: {report.env.tier}</span>}
        {report.totalMs != null && <span>{report.totalMs}ms</span>}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {sorted.map((p, i) => (
          <div
            key={`${p.name}-${i}`}
            style={{
              display: 'flex', alignItems: 'baseline', gap: 8,
              padding: '4px 8px', borderRadius: 2, background: '#0a0a0a',
              borderLeft: `2px solid ${SELFTEST_COLOR[p.status] ?? '#333'}`,
            }}
          >
            <span className="sa-mono" style={{ color: SELFTEST_COLOR[p.status] ?? '#333', fontSize: 11, width: 12 }}>
              {SELFTEST_MARK[p.status] ?? '?'}
            </span>
            <span className="sa-mono" style={{ color: '#9ca3af', fontSize: 10, minWidth: 110 }}>{p.name}</span>
            <span className="sa-mono" style={{ color: '#6b7280', fontSize: 10, flex: 1 }}>{p.detail}</span>
            <span className="sa-mono" style={{ color: '#374151', fontSize: 9 }}>{p.durationMs}ms</span>
          </div>
        ))}
        {sorted.length === 0 && (
          <span className="sa-mono" style={{ color: '#4b5563', fontSize: 10 }}>tarama sonucu yok</span>
        )}
      </div>
    </div>
  )
}

// ── UI aktivite (zamansız modal avcısı) render ─────────────────────────────────
interface UiSurfaceEventLike {
  ts: number; action: 'open' | 'close'; desc: string; speed: number | null
  reverse: boolean; sinceUserMs: number; untimely: boolean; reasons: string[]
}
interface UiActivityLike {
  installed?: boolean
  openNow?: string[]
  recent?: UiSurfaceEventLike[]
  untimelyCount?: number
  lastUserMsAgo?: number
}

function UiActivitySection({ activity }: { activity: UiActivityLike }) {
  const recent = Array.isArray(activity.recent) ? activity.recent : []
  const untimely = activity.untimelyCount ?? 0
  const openNow = Array.isArray(activity.openNow) ? activity.openNow : []
  // En yeni önce
  const rows = [...recent].reverse()

  return (
    <div style={{ padding: '10px 12px', borderTop: '1px solid #1a1a1a' }}>
      <p className="sa-label" style={{ marginBottom: 6, color: untimely > 0 ? '#dc2626' : '#16a34a' }}>
        UI AKTİVİTE — ZAMANSIZ MODAL AVCISI
      </p>
      <div className="sa-mono" style={{ fontSize: 10, color: '#6b7280', marginBottom: 8, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <span style={{ color: untimely > 0 ? '#dc2626' : '#16a34a' }}>zamansız: {untimely}</span>
        <span>şu an açık: {openNow.length}</span>
        <span>olay: {recent.length}</span>
        {activity.installed === false && <span style={{ color: '#d97706' }}>kaydedici kurulmadı</span>}
      </div>
      {openNow.length > 0 && (
        <div className="sa-mono" style={{ fontSize: 10, color: '#9ca3af', marginBottom: 8 }}>
          açık yüzeyler: {openNow.join(' · ')}
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {rows.map((e, i) => (
          <div
            key={`${e.ts}-${i}`}
            style={{
              display: 'flex', alignItems: 'baseline', gap: 8,
              padding: '4px 8px', borderRadius: 2, background: '#0a0a0a',
              borderLeft: `2px solid ${e.untimely ? '#dc2626' : e.action === 'open' ? '#2d3748' : '#1a1a1a'}`,
            }}
          >
            <span className="sa-mono" style={{ color: e.action === 'open' ? '#9ca3af' : '#4b5563', fontSize: 10, width: 40 }}>
              {e.action === 'open' ? 'AÇILDI' : 'kapandı'}
            </span>
            <span className="sa-mono" style={{ color: '#6b7280', fontSize: 10, flex: 1 }}>{e.desc}</span>
            {e.untimely && (
              <span className="sa-mono" style={{ color: '#dc2626', fontSize: 9 }}>⚠ {(e.reasons ?? []).join(',')}</span>
            )}
            {e.action === 'open' && !e.untimely && (
              <span className="sa-mono" style={{ color: '#374151', fontSize: 9 }}>
                {e.speed != null ? `${Math.round(e.speed)}km/h` : ''}
              </span>
            )}
          </div>
        ))}
        {rows.length === 0 && (
          <span className="sa-mono" style={{ color: '#4b5563', fontSize: 10 }}>UI olayı kaydedilmedi</span>
        )}
      </div>
    </div>
  )
}

// ── Olay izi (breadcrumb) render ───────────────────────────────────────────────
interface TrailEventLike { ts: number; kind: string; label: string; detail?: string }

const TRAIL_COLOR: Record<string, string> = {
  boot: '#6b7280', mode: '#3b82f6', screen: '#8b5cf6', obd: '#d97706',
  action: '#9ca3af', error: '#dc2626', modal: '#0ea5e9',
}

function TrailSection({ trail }: { trail: TrailEventLike[] }) {
  const t0 = trail.length ? trail[0].ts : 0
  return (
    <div style={{ padding: '10px 12px', borderTop: '1px solid #1a1a1a' }}>
      <p className="sa-label" style={{ marginBottom: 6, color: '#9ca3af' }}>
        OLAY İZİ — SORUNA NE YOL AÇTI ({trail.length})
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        {trail.map((e, i) => {
          const dt = t0 ? ((e.ts - t0) / 1000).toFixed(1) : '0.0'
          const col = TRAIL_COLOR[e.kind] ?? '#4b5563'
          return (
            <div
              key={`${e.ts}-${i}`}
              style={{
                display: 'flex', alignItems: 'baseline', gap: 8,
                padding: '3px 8px', borderLeft: `2px solid ${col}`, background: '#0a0a0a',
              }}
            >
              <span className="sa-mono" style={{ color: '#374151', fontSize: 9, width: 44 }}>+{dt}s</span>
              <span className="sa-mono" style={{ color: col, fontSize: 9, width: 52, textTransform: 'uppercase' }}>{e.kind}</span>
              <span className="sa-mono" style={{ color: '#9ca3af', fontSize: 10, flex: 1 }}>
                {e.label}{e.detail ? <span style={{ color: '#4b5563' }}> — {e.detail}</span> : null}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── OBD DERİN render ──────────────────────────────────────────────────────────
interface ObdDeepLike {
  adapter?: { source?: string; connectionState?: string; vehicleType?: string; lastSeenMs?: number }
  health?: { connectionQuality?: number; lastPacketAgeMs?: number; reconnectPressure?: number; sensorReliability?: Record<string, number> }
  live?: Record<string, number>
  extended?: { discovered?: boolean; supportedCount?: number; samples?: { pid: string; name: string; value: number; ageMs: number }[] }
  dtc?: { count?: number; isStale?: boolean; error?: string | null; lastReadAt?: number | null; codes?: { code: string; severity: string; system: string }[] }
}

const DTC_COLOR: Record<string, string> = { critical: '#dc2626', warning: '#d97706', info: '#6b7280' }

function fmtAge(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '?'
  if (ms < 1000) return `${Math.round(ms)}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.round(ms / 60_000)}dk`
}

function ObdDeepSection({ deep }: { deep: ObdDeepLike }) {
  const a = deep.adapter ?? {}
  const h = deep.health ?? {}
  const live = deep.live ?? {}
  const ext = deep.extended ?? {}
  const dtc = deep.dtc ?? {}
  const rel = h.sensorReliability ?? {}
  const liveKeys = Object.keys(live)
  const relKeys = Object.keys(rel)
  const dtcCodes = dtc.codes ?? []
  const connected = a.source && a.source !== 'none'
  return (
    <div style={{ padding: '10px 12px', borderTop: '1px solid #1a1a1a' }}>
      <p className="sa-label" style={{ marginBottom: 6, color: connected ? '#16a34a' : '#6b7280' }}>
        OBD DERİN — ADAPTÖR · TAZELİK · PID · DTC
      </p>
      <div className="sa-mono" style={{ fontSize: 10, color: '#6b7280', marginBottom: 8, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <span style={{ color: connected ? '#16a34a' : '#d97706' }}>kaynak: {a.source ?? '?'}</span>
        <span>durum: {a.connectionState ?? '?'}</span>
        <span>tip: {a.vehicleType ?? '?'}</span>
        {h.connectionQuality != null && <span>kalite: {h.connectionQuality}%</span>}
        {h.lastPacketAgeMs != null && h.lastPacketAgeMs >= 0 && <span>son paket: {fmtAge(h.lastPacketAgeMs)}</span>}
        {a.lastSeenMs != null && a.lastSeenMs > 0 && <span>görüldü: {fmtAge(Date.now() - a.lastSeenMs)} önce</span>}
      </div>
      {liveKeys.length > 0 && (
        <div className="sa-mono" style={{ fontSize: 10, color: '#9ca3af', marginBottom: 8, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {liveKeys.map((k) => <span key={k} style={{ color: '#374151' }}>{k}: <span style={{ color: '#9ca3af' }}>{live[k]}</span></span>)}
        </div>
      )}
      {relKeys.length > 0 && (
        <div className="sa-mono" style={{ fontSize: 9, marginBottom: 8, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {relKeys.map((k) => {
            const v = rel[k]
            return <span key={k} style={{ color: v >= 80 ? '#16a34a' : v >= 50 ? '#d97706' : '#dc2626' }}>{k} {v}%</span>
          })}
        </div>
      )}
      <div className="sa-mono" style={{ fontSize: 10, color: '#6b7280', marginBottom: 4 }}>
        Extended PID: {ext.discovered ? `${ext.supportedCount ?? 0} desteklenen (keşif tamam)` : 'keşif yapılmadı'}
      </div>
      {(ext.samples ?? []).length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 1, marginBottom: 8 }}>
          {(ext.samples ?? []).map((s, i) => (
            <div key={`${s.pid}-${i}`} className="sa-mono" style={{ display: 'flex', gap: 8, fontSize: 9, color: '#6b7280' }}>
              <span style={{ width: 44, color: '#374151' }}>{s.pid}</span>
              <span style={{ flex: 1, color: '#9ca3af' }}>{s.name}</span>
              <span style={{ color: '#9ca3af' }}>{Number.isFinite(s.value) ? s.value : '—'}</span>
              <span style={{ width: 48, textAlign: 'right', color: s.ageMs > 10_000 ? '#d97706' : '#374151' }}>{fmtAge(s.ageMs)}</span>
            </div>
          ))}
        </div>
      )}
      <div className="sa-mono" style={{ fontSize: 10, marginTop: 4, color: (dtc.count ?? 0) > 0 ? '#dc2626' : '#16a34a' }}>
        DTC arıza kodu: {dtc.count ?? 0}{dtc.isStale ? ' (bayat)' : ''}{dtc.error ? ` · hata: ${dtc.error}` : ''}
        {dtc.lastReadAt ? ` · okundu ${fmtAge(Date.now() - dtc.lastReadAt)} önce` : ' · hiç okunmadı'}
      </div>
      {dtcCodes.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 1, marginTop: 4 }}>
          {dtcCodes.map((c, i) => (
            <div key={`${c.code}-${i}`} className="sa-mono" style={{ display: 'flex', gap: 8, fontSize: 9 }}>
              <span style={{ width: 56, color: DTC_COLOR[c.severity] ?? '#6b7280', fontWeight: 700 }}>{c.code}</span>
              <span style={{ color: '#6b7280' }}>{c.system}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── PERF ZAMAN SERİSİ render ──────────────────────────────────────────────────
interface PerfSampleLike { ts: number; tempC: number; level: number; memMb: number; fps: number; maxGapMs: number; lagMs: number }
interface PerfSeriesLike { installed?: boolean; sampleMs?: number; samples?: PerfSampleLike[] }

// Küçük ASCII sparkline — bağımlılıksız (payload sayısal, tek satır trend).
function sparkline(vals: number[]): string {
  const valid = vals.filter((v) => Number.isFinite(v) && v >= 0)
  if (!valid.length) return '—'
  const bars = '▁▂▃▄▅▆▇█'
  const min = Math.min(...valid), max = Math.max(...valid)
  const span = max - min || 1
  return vals.map((v) => (Number.isFinite(v) && v >= 0 ? bars[Math.min(7, Math.floor(((v - min) / span) * 7))] : '·')).join('')
}

function PerfSeriesSection({ series }: { series: PerfSeriesLike }) {
  const samples = series.samples ?? []
  const last = samples.length ? samples[samples.length - 1] : null
  const temps = samples.map((s) => s.tempC)
  const mems = samples.map((s) => s.memMb)
  const fpss = samples.map((s) => s.fps)
  const lags = samples.map((s) => s.lagMs)
  const memGrew = mems.length >= 2 && mems[mems.length - 1] > mems[0] + 30
  return (
    <div style={{ padding: '10px 12px', borderTop: '1px solid #1a1a1a' }}>
      <p className="sa-label" style={{ marginBottom: 6, color: '#9ca3af' }}>
        PERF ZAMAN SERİSİ — TERMAL · BELLEK · FPS · LAG ({samples.length} örnek)
      </p>
      {samples.length === 0 ? (
        <span className="sa-mono" style={{ color: '#4b5563', fontSize: 10 }}>henüz örnek yok (ilk ~12s sonra)</span>
      ) : (
        <div className="sa-mono" style={{ fontSize: 10, display: 'flex', flexDirection: 'column', gap: 3 }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <span style={{ width: 64, color: '#6b7280' }}>termal°C</span>
            <span style={{ color: '#d97706', letterSpacing: 1 }}>{sparkline(temps)}</span>
            <span style={{ color: '#374151' }}>{last?.tempC != null && last.tempC >= 0 ? `${last.tempC}° (L${last.level})` : 'kaynak yok'}</span>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <span style={{ width: 64, color: '#6b7280' }}>bellek MB</span>
            <span style={{ color: memGrew ? '#dc2626' : '#3b82f6', letterSpacing: 1 }}>{sparkline(mems)}</span>
            <span style={{ color: memGrew ? '#dc2626' : '#374151' }}>{last?.memMb != null && last.memMb >= 0 ? `${last.memMb}MB${memGrew ? ' ↑sızıntı?' : ''}` : 'API yok'}</span>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <span style={{ width: 64, color: '#6b7280' }}>fps</span>
            <span style={{ color: '#16a34a', letterSpacing: 1 }}>{sparkline(fpss)}</span>
            <span style={{ color: '#374151' }}>{last?.fps != null && last.fps >= 0 ? `${last.fps}fps` : 'düşük-tier (atlandı)'}</span>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <span style={{ width: 64, color: '#6b7280' }}>lag ms</span>
            <span style={{ color: '#8b5cf6', letterSpacing: 1 }}>{sparkline(lags)}</span>
            <span style={{ color: (last?.lagMs ?? 0) > 50 ? '#dc2626' : '#374151' }}>{last?.lagMs != null ? `${last.lagMs}ms` : '?'}</span>
          </div>
        </div>
      )}
    </div>
  )
}

// ── AĞ / AI SAĞLIĞI render ────────────────────────────────────────────────────
interface NetAiLike {
  online?: boolean
  ai?: { healthy?: boolean; consecFails?: number; blockedForMs?: number }
  quota?: { geminiCooldownMs?: number; groqCooldownMs?: number; haikuCooldownMs?: number }
}

function NetAiSection({ netAi }: { netAi: NetAiLike }) {
  const ai = netAi.ai ?? {}
  const q = netAi.quota ?? {}
  const cd = (ms?: number): string => (ms && ms > 0 ? `${Math.ceil(ms / 1000)}s kota` : 'açık')
  const cdColor = (ms?: number): string => (ms && ms > 0 ? '#dc2626' : '#16a34a')
  return (
    <div style={{ padding: '10px 12px', borderTop: '1px solid #1a1a1a' }}>
      <p className="sa-label" style={{ marginBottom: 6, color: netAi.online ? '#16a34a' : '#d97706' }}>
        AĞ / AI SAĞLIĞI
      </p>
      <div className="sa-mono" style={{ fontSize: 10, display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 6 }}>
        <span style={{ color: netAi.online ? '#16a34a' : '#dc2626' }}>{netAi.online ? '● online' : '○ offline'}</span>
        <span style={{ color: ai.healthy ? '#16a34a' : '#dc2626' }}>
          AI devre: {ai.healthy ? 'kapalı (sağlıklı)' : `AÇIK — ${Math.ceil((ai.blockedForMs ?? 0) / 1000)}s`}
        </span>
        {ai.consecFails != null && ai.consecFails > 0 && <span style={{ color: '#d97706' }}>ardışık hata: {ai.consecFails}</span>}
      </div>
      <div className="sa-mono" style={{ fontSize: 9, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <span style={{ color: cdColor(q.geminiCooldownMs) }}>Gemini: {cd(q.geminiCooldownMs)}</span>
        <span style={{ color: cdColor(q.groqCooldownMs) }}>Groq: {cd(q.groqCooldownMs)}</span>
        <span style={{ color: cdColor(q.haikuCooldownMs) }}>Haiku: {cd(q.haikuCooldownMs)}</span>
      </div>
    </div>
  )
}

// ── GPS DERİN render ────────────────────────────────────────────────────────
// 🔒 KOORDİNAT YOK — mahremiyet kilidi (CLAUDE.md): yalnız izin/tazelik/doğruluk.
interface GpsDeepLike {
  permission?: string
  fixAgeMs?: number
  accuracyM?: number
  source?: string
  drActive?: boolean
  tracking?: boolean
}

function GpsDeepSection({ gps }: { gps: GpsDeepLike }) {
  const permColor = gps.permission === 'granted' ? '#16a34a' : gps.permission === 'denied' ? '#dc2626' : '#d97706'
  const hasFix = gps.fixAgeMs != null && gps.fixAgeMs >= 0
  return (
    <div style={{ padding: '10px 12px', borderTop: '1px solid #1a1a1a' }}>
      <p className="sa-label" style={{ marginBottom: 6, color: gps.tracking ? '#16a34a' : '#6b7280' }}>
        GPS DERİN — İZİN · TAZELİK · DOĞRULUK
      </p>
      <div className="sa-mono" style={{ fontSize: 10, color: '#6b7280', display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <span style={{ color: permColor }}>izin: {gps.permission ?? '?'}</span>
        <span>kaynak: {gps.source ?? '?'}</span>
        <span style={{ color: hasFix ? '#374151' : '#d97706' }}>
          fix: {hasFix ? `${fmtAge(gps.fixAgeMs as number)} önce` : 'yok'}
        </span>
        {gps.accuracyM != null && gps.accuracyM >= 0 && <span>doğruluk: {gps.accuracyM}m</span>}
        <span style={{ color: gps.drActive ? '#d97706' : '#374151' }}>{gps.drActive ? 'DR (tünel) aktif' : 'DR kapalı'}</span>
        <span style={{ color: gps.tracking ? '#16a34a' : '#6b7280' }}>{gps.tracking ? '● izleniyor' : '○ izlenmiyor'}</span>
      </div>
    </div>
  )
}

// ── SESLİ / STT render ───────────────────────────────────────────────────────
// Ham transkript YOK — yalnız durum/zaman/başarı bayrağı (PII değil).
interface VoiceDiagLike {
  voskReady?: boolean
  wakeWordEnabled?: boolean
  status?: string
  lastSttAgeMs?: number
  lastSttOk?: boolean | null
}

function VoiceDiagSection({ voice }: { voice: VoiceDiagLike }) {
  const okColor = voice.lastSttOk === true ? '#16a34a' : voice.lastSttOk === false ? '#dc2626' : '#6b7280'
  const hasLast = voice.lastSttAgeMs != null && voice.lastSttAgeMs >= 0
  return (
    <div style={{ padding: '10px 12px', borderTop: '1px solid #1a1a1a' }}>
      <p className="sa-label" style={{ marginBottom: 6, color: voice.voskReady ? '#16a34a' : '#d97706' }}>
        SESLİ / STT — VOSK · WAKE WORD · SON SONUÇ
      </p>
      <div className="sa-mono" style={{ fontSize: 10, color: '#6b7280', display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <span style={{ color: voice.voskReady ? '#16a34a' : '#d97706' }}>vosk: {voice.voskReady ? 'hazır' : 'yükleniyor'}</span>
        <span style={{ color: voice.wakeWordEnabled ? '#16a34a' : '#6b7280' }}>wake word: {voice.wakeWordEnabled ? 'açık' : 'kapalı'}</span>
        <span>durum: {voice.status ?? '?'}</span>
        <span style={{ color: okColor }}>
          son sonuç: {voice.lastSttOk == null ? 'yok' : voice.lastSttOk ? 'başarılı' : 'hata'}
          {hasLast ? ` (${fmtAge(voice.lastSttAgeMs as number)} önce)` : ''}
        </span>
      </div>
    </div>
  )
}

// ── GÜVENLİ BÖLGE (GEOFENCE) render ──────────────────────────────────────────
interface GeofenceDiagLike {
  readState?: string
  zoneCount?: number
  cloudSync?: boolean
}

const GEOFENCE_STATE_COLOR: Record<string, string> = {
  ok: '#16a34a', not_paired: '#6b7280', schema_missing: '#dc2626', error: '#dc2626', idle: '#6b7280',
}

function GeofenceDiagSection({ geofence }: { geofence: GeofenceDiagLike }) {
  const color = GEOFENCE_STATE_COLOR[geofence.readState ?? 'idle'] ?? '#6b7280'
  return (
    <div style={{ padding: '10px 12px', borderTop: '1px solid #1a1a1a' }}>
      <p className="sa-label" style={{ marginBottom: 6, color }}>
        GÜVENLİ BÖLGE (GEOFENCE) — BULUT OKUMA · BÖLGE SAYISI
      </p>
      <div className="sa-mono" style={{ fontSize: 10, color: '#6b7280', display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <span style={{ color }}>okuma: {geofence.readState ?? '?'}</span>
        <span>bölge sayısı: {geofence.zoneCount ?? 0}</span>
        <span style={{ color: geofence.cloudSync ? '#16a34a' : '#6b7280' }}>
          {geofence.cloudSync ? '● bulut senkron aktif' : '○ bulut senkron yok'}
        </span>
      </div>
    </div>
  )
}

// ── DEPOLAMA + KUYRUK render ──────────────────────────────────────────────────
interface StorageQueueLike {
  queuePending?: number
  storagePct?: number
  storageWarn?: boolean
}

function StorageQueueSection({ sq }: { sq: StorageQueueLike }) {
  const hasStorage = sq.storagePct != null && sq.storagePct >= 0
  return (
    <div style={{ padding: '10px 12px', borderTop: '1px solid #1a1a1a' }}>
      <p className="sa-label" style={{ marginBottom: 6, color: sq.storageWarn ? '#dc2626' : '#9ca3af' }}>
        DEPOLAMA + KUYRUK — BEKLEYEN OLAY · DİSK KULLANIMI
      </p>
      <div className="sa-mono" style={{ fontSize: 10, color: '#6b7280', display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <span style={{ color: (sq.queuePending ?? 0) > 0 ? '#d97706' : '#374151' }}>kuyrukta: {sq.queuePending ?? 0}</span>
        <span style={{ color: sq.storageWarn ? '#dc2626' : '#374151' }}>
          disk: {hasStorage ? `${sq.storagePct}%` : 'bilinmiyor'}{sq.storageWarn ? ' ⚠' : ''}
        </span>
      </div>
    </div>
  )
}

// ── GÜÇ / AKÜ SAĞLIĞI render ──────────────────────────────────────────────────
interface PowerLike {
  source?:   string
  voltageV?: number | null
  severity?: string
  charging?: boolean
  stats?:    { minV: number; maxV: number; sampleCount: number; windowMs: number } | null
}

const POWER_SEVERITY_COLOR: Record<string, string> = {
  critical: '#dc2626', low: '#d97706', normal: '#16a34a', unknown: '#6b7280',
}

function PowerSection({ power }: { power: PowerLike }) {
  const color = POWER_SEVERITY_COLOR[power.severity ?? 'unknown'] ?? '#6b7280'
  const hasV = power.voltageV != null
  const stats = power.stats
  return (
    <div style={{ padding: '10px 12px', borderTop: '1px solid #1a1a1a' }}>
      <p className="sa-label" style={{ marginBottom: 6, color }}>
        GÜÇ / AKÜ SAĞLIĞI — 12V VOLTAJ · KAYNAK · EĞİLİM
      </p>
      <div className="sa-mono" style={{ fontSize: 10, color: '#6b7280', display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <span style={{ color }}>voltaj: {hasV ? `${power.voltageV!.toFixed(1)} V` : 'ölçüm yok'}</span>
        <span>kaynak: {power.source ?? 'none'}</span>
        <span style={{ color }}>durum: {power.severity ?? 'unknown'}</span>
        {power.charging && <span style={{ color: '#16a34a' }}>⚡ şarj oluyor</span>}
      </div>
      {stats && (
        <div className="sa-mono" style={{ fontSize: 9, color: '#4b5563', marginTop: 4 }}>
          son {Math.round(stats.windowMs / 1000)}sn: min {stats.minV.toFixed(2)}V · maks {stats.maxV.toFixed(2)}V
          {(stats.maxV - stats.minV) > 0.5 ? ' — ani düşüş (marş/güç sorunu olabilir)' : ''} ({stats.sampleCount} örnek)
        </div>
      )}
    </div>
  )
}

// ── SENSÖR FÜZYON TUTARLILIĞI render ──────────────────────────────────────────
interface FusionLike {
  activeSource?:    string
  gpsSpeedKmh?:     number | null
  vehicleSpeedKmh?: number | null
  diffKmh?:         number | null
  confidence?:      string
  drActive?:        boolean
}

const FUSION_CONFIDENCE_COLOR: Record<string, string> = {
  high: '#16a34a', medium: '#d97706', low: '#dc2626', unknown: '#6b7280',
}

function FusionSection({ fusion }: { fusion: FusionLike }) {
  const color = FUSION_CONFIDENCE_COLOR[fusion.confidence ?? 'unknown'] ?? '#6b7280'
  return (
    <div style={{ padding: '10px 12px', borderTop: '1px solid #1a1a1a' }}>
      <p className="sa-label" style={{ marginBottom: 6, color }}>
        SENSÖR FÜZYON TUTARLILIĞI — GÜVEN: {(fusion.confidence ?? 'unknown').toUpperCase()}
      </p>
      <div className="sa-mono" style={{ fontSize: 10, color: '#6b7280', display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <span>aktif kaynak: {fusion.activeSource ?? 'none'}</span>
        <span>GPS: {fusion.gpsSpeedKmh != null ? `${fusion.gpsSpeedKmh} km/h` : '—'}</span>
        <span>donanım: {fusion.vehicleSpeedKmh != null ? `${fusion.vehicleSpeedKmh} km/h` : '—'}</span>
        {fusion.diffKmh != null && (
          <span style={{ color }}>fark: {fusion.diffKmh} km/h</span>
        )}
        <span style={{ color: fusion.drActive ? '#d97706' : '#374151' }}>{fusion.drActive ? 'DR (tünel) aktif' : 'DR kapalı'}</span>
      </div>
    </div>
  )
}

// ── BOOT ZAMAN ÇİZELGESİ render ────────────────────────────────────────────────
interface BootWaveLike { name: string; durationMs: number }
interface BootTimingLike {
  waves?:       BootWaveLike[]
  totalMs?:     number
  slowestWave?: string | null
}

function BootTimingSection({ timing }: { timing: BootTimingLike }) {
  const waves = timing.waves ?? []
  return (
    <div style={{ padding: '10px 12px', borderTop: '1px solid #1a1a1a' }}>
      <p className="sa-label" style={{ marginBottom: 6, color: '#9ca3af' }}>
        BOOT ZAMAN ÇİZELGESİ — TOPLAM {timing.totalMs != null ? fmtAge(timing.totalMs) : '?'}
      </p>
      {waves.length === 0 ? (
        <span className="sa-mono" style={{ color: '#4b5563', fontSize: 10 }}>ölçüm yok</span>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          {waves.map((w, i) => (
            <div key={`${w.name}-${i}`} className="sa-mono" style={{ display: 'flex', gap: 8, fontSize: 9 }}>
              <span style={{ flex: 1, color: w.name === timing.slowestWave ? '#d97706' : '#6b7280' }}>
                {w.name}{w.name === timing.slowestWave ? ' ← en yavaş' : ''}
              </span>
              <span style={{ color: '#9ca3af' }}>{fmtAge(w.durationMs)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── TRANSPORT / BAĞLANTI SAĞLIĞI render ────────────────────────────────────────
interface TransportLike {
  transport?:            string
  connected?:            boolean
  reconnectAttempts?:    number
  lastDisconnectReason?: string | null
}

function TransportSection({ transport }: { transport: TransportLike }) {
  return (
    <div style={{ padding: '10px 12px', borderTop: '1px solid #1a1a1a' }}>
      <p className="sa-label" style={{ marginBottom: 6, color: transport.connected ? '#16a34a' : '#d97706' }}>
        TRANSPORT / BAĞLANTI SAĞLIĞI
      </p>
      <div className="sa-mono" style={{ fontSize: 10, color: '#6b7280', display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <span style={{ color: transport.connected ? '#16a34a' : '#dc2626' }}>
          {transport.connected ? '● bağlı' : '○ bağlı değil'}
        </span>
        <span>transport: {transport.transport ?? 'none'}</span>
        <span style={{ color: (transport.reconnectAttempts ?? 0) > 0 ? '#d97706' : '#374151' }}>
          reconnect denemesi: {transport.reconnectAttempts ?? 0}
        </span>
        {transport.lastDisconnectReason && (
          <span style={{ color: '#dc2626' }}>son kopma: {transport.lastDisconnectReason}</span>
        )}
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
