/**
 * HealthCenter — Sistem Sağlık Merkezi (Bento Box Layout)
 *
 * Privacy-First: bireysel araç/kullanıcı verisi içermez.
 * Veri akışı: vehicle_events → getFleetHealthStats → 60s poll
 *
 * Layout (12-kolon Bento):
 *   Row 1: Stability Score (5) | Critical (2) | Thermal L3 (2) | UI Freeze (2) | Restarts (1)
 *   Row 2: Fleet activity bar (7) | Version breakdown (5)
 *   Row 3: Incident tablosu (12)
 *   Row 4: Live Event Stream (12)
 */

import { useEffect, useState, useCallback } from 'react'
import {
  Activity, AlertTriangle, CheckCircle, XCircle,
  Clock, RefreshCw, Thermometer, RotateCcw, Zap,
} from 'lucide-react'
import {
  getFleetHealthStats,
  getIncidentLogs,
  type FleetHealthStats,
  type IncidentLog,
} from '../../services/superadmin.service'
import { MetricCard }      from '../../components/superadmin/MetricCard'
import { LiveEventStream } from '../../components/superadmin/LiveEventStream'
import { IncidentReplay }  from './IncidentReplay'
import { Button }          from '../../components/ui/Button'
import '../../styles/admin-enterprise.css'

// ── Renk yardımcıları ─────────────────────────────────────────────────────────

function scoreColor(n: number): string {
  if (n >= 80) return '#4ade80'
  if (n >= 60) return '#d97706'
  if (n >= 40) return '#ea580c'
  return '#dc2626'
}

function scoreLabel(n: number): string {
  if (n >= 80) return 'NORMAL'
  if (n >= 60) return 'KABUL EDİLEBİLİR'
  if (n >= 40) return 'BOZULMUŞ'
  return 'KRİTİK'
}

function _relTime(iso: string | null): string {
  if (!iso) return '—'
  const ms = Date.now() - new Date(iso).getTime()
  if (ms < 60_000)     return 'az önce'
  if (ms < 3_600_000)  return `${Math.floor(ms / 60_000)} dk önce`
  return `${Math.floor(ms / 3_600_000)} sa önce`
}

// ── HealthCenter ──────────────────────────────────────────────────────────────

export function HealthCenter() {
  const [stats,           setStats]           = useState<FleetHealthStats | null>(null)
  const [incidents,       setIncidents]       = useState<IncidentLog[]>([])
  const [loading,         setLoading]         = useState(true)
  const [lastFetch,       setLastFetch]       = useState(0)
  const [replayIncident,  setReplayIncident]  = useState<IncidentLog | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [s, i] = await Promise.all([
        getFleetHealthStats(24),
        getIncidentLogs(20),
      ])
      setStats(s)
      setIncidents(i)
      setLastFetch(Date.now())
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
    const id = setInterval(() => { void load() }, 60_000)
    return () => clearInterval(id)
  }, [load])

  const score = stats?.stabilityScore ?? 100
  const sColor = scoreColor(score)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 1, maxWidth: 1280 }}>

      {/* ── Black Box Replay Modal ───────────────────────────────────── */}
      <IncidentReplay
        incident={replayIncident}
        onClose={() => setReplayIncident(null)}
      />

      {/* ── Page header ─────────────────────────────────────────────── */}
      <div
        className="flex items-center justify-between"
        style={{ marginBottom: 14 }}
      >
        <div>
          <p
            style={{
              fontFamily:    'var(--sa-font-ui)',
              fontSize:       11,
              fontWeight:     600,
              color:         '#4b5563',
              letterSpacing: '0.10em',
              textTransform: 'uppercase',
            }}
          >
            SAĞLIK MERKEZİ
          </p>
          <p style={{ fontSize: 10, color: '#2d3748', fontFamily: 'var(--sa-font-ui)', marginTop: 2 }}>
            {lastFetch > 0
              ? `Son eşitleme ${_relTime(new Date(lastFetch).toISOString())} · 24 saatlik pencere`
              : 'Filo verisi yükleniyor…'}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={loading}
          onClick={() => { void load() }}
        >
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
          Eşitle
        </Button>
      </div>

      {/* ── ROW 1 — Bento grid ──────────────────────────────────────── */}
      <div
        style={{
          display:             'grid',
          gridTemplateColumns: '5fr 2fr 2fr 2fr 1fr',
          gap:                  1,
        }}
      >
        {/* Stability Score — büyük blok */}
        <div
          style={{
            background:    '#0d0d0d',
            border:        '1px solid #1a1a1a',
            borderRadius:   2,
            padding:       '18px 20px',
          }}
        >
          <p className="sa-label" style={{ marginBottom: 12 }}>FİLO KARARLILIK PUANI</p>

          {loading && !stats ? (
            <div style={{ height: 52, background: '#111', borderRadius: 2, animation: 'pulse 2s infinite' }} />
          ) : (
            <>
              <div className="flex items-end gap-3" style={{ marginBottom: 14 }}>
                <span
                  className="sa-mono"
                  style={{ fontSize: 52, fontWeight: 700, color: sColor, lineHeight: 1, letterSpacing: '-0.04em' }}
                >
                  {score.toFixed(0)}
                </span>
                <span style={{ fontSize: 16, color: '#2d3748', fontFamily: 'var(--sa-font-mono)', marginBottom: 4 }}>
                  / 100
                </span>
                <span
                  className="sa-mono"
                  style={{
                    fontSize:      9,
                    fontWeight:    700,
                    color:         sColor,
                    letterSpacing: '0.12em',
                    marginBottom:   6,
                    marginLeft:     4,
                  }}
                >
                  {scoreLabel(score)}
                </span>
              </div>

              {/* Linear gauge */}
              <div className="sa-gauge-track">
                <div
                  className="sa-gauge-fill"
                  style={{ width: `${score}%`, background: sColor }}
                />
              </div>

              {/* Tick marks */}
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
                {[0, 25, 50, 75, 100].map((t) => (
                  <span
                    key={t}
                    className="sa-mono"
                    style={{ fontSize: 8, color: score >= t ? '#2d3748' : '#1a1a1a' }}
                  >
                    {t}
                  </span>
                ))}
              </div>

              <p style={{ fontSize: 10, color: '#2d3748', fontFamily: 'var(--sa-font-ui)', marginTop: 10 }}>
                {stats?.totalEvents ?? 0} sağlık olayı incelendi · 24 saatlik pencere
              </p>
            </>
          )}
        </div>

        {/* Critical */}
        <MetricCard
          label="Kritik Olaylar"
          value={stats?.criticalEvents ?? '—'}
          sub={`toplam ${stats?.totalEvents ?? 0}`}
          status={
            !stats ? 'neutral'
            : stats.criticalEvents > 5 ? 'critical'
            : stats.criticalEvents > 0 ? 'warning'
            : 'stable'
          }
          sparkData={stats?.criticalEvents != null
            ? Array(8).fill(0).map((_, i) =>
                i === 7 ? Math.min(100, stats.criticalEvents * 10) : 0)
            : undefined}
        />

        {/* Thermal L3 */}
        <MetricCard
          label="Termal S3"
          value={stats?.thermalL3Count ?? '—'}
          sub={`ort. seviye ${stats?.avgThermalLevel?.toFixed(1) ?? '—'}`}
          status={
            !stats ? 'neutral'
            : stats.thermalL3Count > 3 ? 'critical'
            : stats.thermalL3Count > 0 ? 'warning'
            : 'stable'
          }
        />

        {/* UI Freeze */}
        <MetricCard
          label="Arayüz Donması"
          value={stats?.uiFreezeTotal ?? '—'}
          sub="iş parçacığı blokları"
          status={
            !stats ? 'neutral'
            : stats.uiFreezeTotal > 5 ? 'warning'
            : stats.uiFreezeTotal > 0 ? 'warning'
            : 'stable'
          }
        />

        {/* Worker Restarts — küçük blok */}
        <MetricCard
          label="Yeniden Başlatma"
          value={stats?.workerRestartTotal ?? '—'}
          status={
            !stats ? 'neutral'
            : stats.workerRestartTotal > 5 ? 'warning'
            : 'neutral'
          }
        />
      </div>

      {/* ── ROW 2 — Activity + Version breakdown ────────────────────── */}
      <div
        style={{
          display:             'grid',
          gridTemplateColumns: '7fr 5fr',
          gap:                  1,
          marginTop:            1,
        }}
      >
        {/* Fleet activity */}
        <div
          style={{
            background: '#0d0d0d',
            border:     '1px solid #1a1a1a',
            borderRadius: 2,
            padding:    '14px 16px',
          }}
        >
          <p className="sa-label" style={{ marginBottom: 12 }}>FİLO ETKİNLİĞİ — 24 SA</p>
          {!stats || stats.totalEvents === 0 ? (
            <div className="sa-empty" style={{ padding: '24px 0' }}>
              SİSTEM_BEKLEMEDE: Pencerede olay yok
            </div>
          ) : (
            <ActivityBar stats={stats} />
          )}
        </div>

        {/* Version breakdown */}
        <div
          style={{
            background: '#0d0d0d',
            border:     '1px solid #1a1a1a',
            borderRadius: 2,
            padding:    '14px 16px',
          }}
        >
          <p className="sa-label" style={{ marginBottom: 12 }}>SÜRÜME GÖRE HATA DAĞILIMI</p>
          {!stats || stats.errorsByVersion.length === 0 ? (
            <div className="sa-empty" style={{ padding: '24px 0' }}>
              HATA_YOK: Tüm sürümler normal
            </div>
          ) : (
            <VersionBreakdown items={stats.errorsByVersion} />
          )}
        </div>
      </div>

      {/* ── ROW 3 — Incident table ──────────────────────────────────── */}
      <div
        style={{
          background:   '#0d0d0d',
          border:       '1px solid #1a1a1a',
          borderRadius:  2,
          marginTop:     1,
          overflow:     'hidden',
        }}
      >
        <div
          className="flex items-center justify-between"
          style={{ padding: '10px 12px', borderBottom: '1px solid #1a1a1a' }}
        >
          <p className="sa-label">OLAY KAYDI</p>
          <span style={{ fontSize: 9, color: '#2d3748', fontFamily: 'var(--sa-font-ui)' }}>
            {incidents.length} kayıt
          </span>
        </div>

        {loading && incidents.length === 0 ? (
          <IncidentSkeleton />
        ) : incidents.length === 0 ? (
          <div className="sa-empty">
            <CheckCircle size={18} style={{ color: '#4ade80', opacity: 0.5 }} />
            OLAY_YOK: Filo normal çalışıyor
          </div>
        ) : (
          <div>
            {/* Header */}
            <div
              className="sa-inc-row"
              style={{ background: '#080808', borderBottom: '1px solid #1a1a1a' }}
            >
              <span className="sa-label" style={{ width: 64 }}>SAAT</span>
              <span className="sa-label" style={{ width: 60 }}>ÖNEM</span>
              <span className="sa-label" style={{ width: 52 }}>SÜRÜM</span>
              <span className="sa-label" style={{ width: 56 }}>TERMAL</span>
              <span className="sa-label" style={{ flex: 1 }}>AYRINTILAR</span>
            </div>
            {incidents.map((inc) => (
              <IncidentRow
                key={inc.id}
                inc={inc}
                onClick={() => setReplayIncident(inc)}
              />
            ))}
          </div>
        )}
      </div>

      {/* ── ROW 4 — Live Event Stream ───────────────────────────────── */}
      <div style={{ marginTop: 1 }}>
        <LiveEventStream height={320} />
        <p
          style={{
            marginTop:  4,
            fontSize:    9,
            color:      '#1a1a1a',
            fontFamily: 'var(--sa-font-mono)',
            letterSpacing: '0.06em',
          }}
        >
          ⚠ Realtime: Supabase → Database → Replication → vehicle_events tablosunu publication'a ekle
        </p>
      </div>

    </div>
  )
}

// ── Activity Bar ──────────────────────────────────────────────────────────────

function ActivityBar({ stats }: { stats: FleetHealthStats }) {
  const total    = stats.totalEvents || 1
  const segments = [
    { label: 'Sağlıklı', count: stats.healthyEvents,  color: '#4ade80' },
    { label: 'Bozulmuş', count: stats.degradedEvents, color: '#d97706' },
    { label: 'Kritik',   count: stats.criticalEvents, color: '#dc2626' },
  ]

  return (
    <div>
      {/* Stacked bar */}
      <div
        style={{
          display:       'flex',
          height:         6,
          borderRadius:   1,
          overflow:       'hidden',
          background:    '#111',
          marginBottom:   12,
        }}
      >
        {segments.map((s) => (
          <div
            key={s.label}
            style={{
              width:      `${(s.count / total) * 100}%`,
              background: s.color,
              transition: 'width 600ms ease',
            }}
          />
        ))}
      </div>

      {/* Legend */}
      <div style={{ display: 'flex', gap: 20 }}>
        {segments.map((s) => (
          <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 8, height: 8, borderRadius: 1, background: s.color, flexShrink: 0 }} />
            <span style={{ fontFamily: 'var(--sa-font-ui)', fontSize: 10, color: '#4b5563' }}>
              {s.label}
            </span>
            <span className="sa-mono" style={{ fontSize: 11, color: '#6b7280' }}>
              {s.count}
            </span>
            <span style={{ fontSize: 9, color: '#374151' }}>
              ({((s.count / total) * 100).toFixed(0)}%)
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Version Breakdown ─────────────────────────────────────────────────────────

function VersionBreakdown({ items }: { items: FleetHealthStats['errorsByVersion'] }) {
  const max = items[0]?.count ?? 1
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {items.map(({ version, count }) => (
        <div key={version} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <code
            className="sa-mono"
            style={{ fontSize: 10, color: '#6b7280', width: 72, flexShrink: 0 }}
          >
            {version}
          </code>
          <div
            style={{
              flex:        1,
              height:       3,
              borderRadius: 1,
              background:  '#111',
              overflow:    'hidden',
            }}
          >
            <div
              style={{
                height:     '100%',
                width:      `${(count / max) * 100}%`,
                background: '#dc2626',
                opacity:     0.7,
              }}
            />
          </div>
          <span className="sa-mono" style={{ fontSize: 10, color: '#4b5563', width: 24, textAlign: 'right' }}>
            {count}
          </span>
        </div>
      ))}
    </div>
  )
}

// ── Incident Row ──────────────────────────────────────────────────────────────

function IncidentRow({ inc, onClick }: { inc: IncidentLog; onClick: () => void }) {
  const isCritical = inc.severity === 'critical'
  return (
    <div
      className="sa-inc-row"
      onClick={onClick}
      title="Kara Kutu Tekrarını açmak için tıkla"
      style={{ cursor: 'pointer' }}
    >
      <span
        className="sa-mono"
        style={{ fontSize: 10, color: '#4b5563', width: 64, flexShrink: 0 }}
      >
        {new Date(inc.ts).toLocaleTimeString('en-GB', { hour12: false })}
      </span>
      <span
        style={{
          width:         60,
          flexShrink:    0,
          fontSize:       9,
          fontWeight:     700,
          fontFamily:    'var(--sa-font-ui)',
          letterSpacing: '0.08em',
          color:         isCritical ? '#dc2626' : '#d97706',
        }}
      >
        {isCritical ? 'KRİTİK' : 'UYARI'}
      </span>
      <code
        className="sa-mono"
        style={{ fontSize: 10, color: '#6b7280', width: 52, flexShrink: 0 }}
      >
        v{inc.appVersion}
      </code>
      <span
        style={{
          width:      56,
          flexShrink: 0,
          fontSize:    10,
          fontFamily: 'var(--sa-font-ui)',
          color:      inc.thermalLevel >= 3 ? '#ea580c'
                    : inc.thermalLevel >= 2 ? '#d97706'
                    : '#4b5563',
        }}
      >
        L{inc.thermalLevel}
      </span>
      <span
        style={{
          flex:       1,
          fontSize:    10,
          color:      '#4b5563',
          fontFamily: 'var(--sa-font-ui)',
          overflow:   'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {[
          inc.uiFreezeCount > 0 && `donma×${inc.uiFreezeCount}`,
          inc.restartCount  > 0 && `yeniden başlatma×${inc.restartCount}`,
          inc.overallHealth,
        ].filter(Boolean).join(' · ')}
      </span>
    </div>
  )
}

// ── Incident Skeleton ─────────────────────────────────────────────────────────

function IncidentSkeleton() {
  return (
    <div style={{ padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 4 }}>
      {Array.from({ length: 4 }).map((_, i) => (
        <div
          key={i}
          style={{
            height:     28,
            borderRadius: 2,
            background:  '#0f0f0f',
            animation:  'pulse 2s ease-in-out infinite',
          }}
        />
      ))}
    </div>
  )
}

// ── Unused imports cleanup — keep icons available for future use ──────────────
void Activity; void AlertTriangle; void CheckCircle; void XCircle;
void Clock; void Thermometer; void RotateCcw; void Zap;
