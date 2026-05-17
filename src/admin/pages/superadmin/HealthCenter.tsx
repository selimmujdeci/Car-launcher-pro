/**
 * HealthCenter — Sistem Sağlık Merkezi (Faz 2: Gerçek Veri)
 *
 * Privacy-First:
 *   Bireysel araç/kullanıcı verisi içermez.
 *   Yalnızca anonim, filo geneli toplamalı sağlık metrikleri gösterir.
 *
 * Veri Akışı:
 *   telemetryService → vehicle_events (system_health) → getFleetHealthStats()
 *   Yenileme: manuel veya 60s otomatik poll (mount'ta bir kez + interval).
 */

import { useEffect, useState, useCallback } from 'react'
import type { ServiceHealth, SystemHealthSnapshot, HealthStatus } from '../../types/superadmin'
import { Card }   from '../../components/ui/Card'
import { Badge }  from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import {
  Activity,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Clock,
  RefreshCw,
  Zap,
  Database,
  Globe,
  Server,
  Cpu,
  Thermometer,
  RotateCcw,
} from 'lucide-react'
import {
  getFleetHealthStats,
  getIncidentLogs,
  type FleetHealthStats,
  type IncidentLog,
} from '../../services/superadmin.service'

// ── Tip Yardımcıları ──────────────────────────────────────────────────────────

function _statusVariant(s: HealthStatus): 'success' | 'warning' | 'danger' | 'muted' {
  switch (s) {
    case 'healthy':  return 'success'
    case 'degraded': return 'warning'
    case 'critical': return 'danger'
    default:         return 'muted'
  }
}

function _statusLabel(s: HealthStatus): string {
  switch (s) {
    case 'healthy':  return 'Sağlıklı'
    case 'degraded': return 'Düşük Performans'
    case 'critical': return 'Kritik'
    default:         return 'Bilinmiyor'
  }
}

function _statusIcon(s: HealthStatus) {
  const props = { size: 14 } as const
  switch (s) {
    case 'healthy':  return <CheckCircle {...props} style={{ color: '#4ade80' }} />
    case 'degraded': return <AlertTriangle {...props} style={{ color: '#facc15' }} />
    case 'critical': return <XCircle {...props} style={{ color: '#f87171' }} />
    default:         return <Clock {...props} style={{ color: '#64748b' }} />
  }
}

function _scoreColor(score: number): string {
  if (score >= 80) return '#4ade80'
  if (score >= 60) return '#facc15'
  if (score >= 40) return '#fb923c'
  return '#f87171'
}

function _relTime(iso: string | null): string {
  if (!iso) return '—'
  const ms = Date.now() - new Date(iso).getTime()
  if (ms < 60_000) return 'Az önce'
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)} dk önce`
  return `${Math.floor(ms / 3_600_000)} sa önce`
}

// ── Bekleme servisleri ────────────────────────────────────────────────────────

const EXPECTED_SERVICES: Array<{ name: string; icon: React.ReactNode }> = [
  { name: 'API Gateway',      icon: <Globe     size={14} /> },
  { name: 'Realtime Engine',  icon: <Zap       size={14} /> },
  { name: 'Database',         icon: <Database  size={14} /> },
  { name: 'Auth Service',     icon: <Server    size={14} /> },
  { name: 'Compute Workers',  icon: <Cpu       size={14} /> },
  { name: 'Storage',          icon: <Database  size={14} /> },
]

// ── HealthCenter ──────────────────────────────────────────────────────────────

export function HealthCenter() {
  const [stats,     setStats]     = useState<FleetHealthStats | null>(null)
  const [incidents, setIncidents] = useState<IncidentLog[]>([])
  const [loading,   setLoading]   = useState(true)
  const [lastFetch, setLastFetch] = useState<number>(0)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [s, i] = await Promise.all([getFleetHealthStats(24), getIncidentLogs(10)])
      setStats(s)
      setIncidents(i)
      setLastFetch(Date.now())
    } finally {
      setLoading(false)
    }
  }, [])

  // İlk yükle + 60s polling
  useEffect(() => {
    void load()
    const id = setInterval(() => { void load() }, 60_000)
    return () => clearInterval(id)
  }, [load])

  // HealthCenter snapshot (servis uyumluluğu için)
  const snapshot: SystemHealthSnapshot | null = stats && stats.totalEvents > 0
    ? {
        ts:        stats.lastUpdated ?? new Date().toISOString(),
        overall:   stats.criticalEvents > 0 ? 'critical'
                   : stats.degradedEvents > 0 ? 'degraded' : 'healthy',
        services:  [],
        incidents: incidents.filter((i) => i.severity === 'critical').map((i) => i.id),
      }
    : null

  const scoreColor = stats ? _scoreColor(stats.stabilityScore) : '#64748b'

  return (
    <div className="space-y-6 max-w-5xl">

      {/* Sayfa başlığı */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold" style={{ color: '#e2e8f0' }}>
            Sistem Sağlık Merkezi
          </h1>
          <p className="text-xs mt-0.5" style={{ color: '#64748b' }}>
            Son 24 saatin anonim filo sağlık verileri.
            {lastFetch > 0 && (
              <span style={{ color: '#334155' }}> · Son güncelleme: {_relTime(new Date(lastFetch).toISOString())}</span>
            )}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={loading}
          className="shrink-0"
          onClick={() => { void load() }}
        >
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          Yenile
        </Button>
      </div>

      {/* Fleet Stability Score */}
      <div
        className="flex items-center gap-5 px-5 py-4 rounded-xl"
        style={{
          background: `${scoreColor}08`,
          border:     `1px solid ${scoreColor}20`,
        }}
      >
        <div
          className="flex items-center justify-center rounded-xl shrink-0"
          style={{ width: 52, height: 52, background: `${scoreColor}12`, border: `1px solid ${scoreColor}25` }}
        >
          <Activity size={22} style={{ color: scoreColor }} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: '#64748b' }}>
            Filo Kararlılık Skoru
          </p>
          {loading && !stats ? (
            <div className="h-8 w-24 rounded animate-pulse" style={{ background: 'rgba(255,255,255,0.06)' }} />
          ) : (
            <div className="flex items-end gap-3">
              <p className="text-3xl font-bold tabular-nums leading-none" style={{ color: scoreColor }}>
                {stats?.stabilityScore ?? 100}
              </p>
              <p className="text-sm mb-0.5" style={{ color: '#64748b' }}>/ 100</p>
            </div>
          )}
          <p className="text-xs mt-1" style={{ color: '#475569' }}>
            Son 24 saat · {stats?.totalEvents ?? 0} sağlık olayı analiz edildi
          </p>
        </div>
        {/* Score bar */}
        <div style={{ width: 120, flexShrink: 0 }}>
          <div style={{ height: 6, borderRadius: 3, background: 'rgba(255,255,255,0.06)', overflow: 'hidden' }}>
            <div style={{
              height:     '100%',
              width:      `${stats?.stabilityScore ?? 0}%`,
              background: scoreColor,
              transition: 'width 0.6s ease',
            }} />
          </div>
          <p className="text-[10px] mt-1 text-right" style={{ color: '#334155' }}>
            {stats ? (
              stats.stabilityScore >= 80 ? 'Stabil' :
              stats.stabilityScore >= 60 ? 'Kabul Edilebilir' :
              stats.stabilityScore >= 40 ? 'Dikkat' : 'Kritik'
            ) : '—'}
          </p>
        </div>
      </div>

      {/* Genel durum banner'ı */}
      {loading && !snapshot ? (
        <WaitingBanner />
      ) : snapshot ? (
        <OverallStatusBanner snapshot={snapshot} />
      ) : null}

      {/* Metrik kartlar */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <MetricCard
          label="Kritik Olay"
          value={stats ? String(stats.criticalEvents) : '—'}
          sub={`Son 24 saat · ${stats?.totalEvents ?? 0} toplam`}
          iconColor="#f87171"
          icon={<XCircle size={15} />}
          loading={loading && !stats}
        />
        <MetricCard
          label="Termal L3"
          value={stats ? String(stats.thermalL3Count) : '—'}
          sub={`Ort. seviye: ${stats?.avgThermalLevel?.toFixed(1) ?? '—'}`}
          iconColor="#fb923c"
          icon={<Thermometer size={15} />}
          loading={loading && !stats}
        />
        <MetricCard
          label="UI Donma"
          value={stats ? String(stats.uiFreezeTotal) : '—'}
          sub="Tespit edilen toplam"
          iconColor="#facc15"
          icon={<AlertTriangle size={15} />}
          loading={loading && !stats}
        />
        <MetricCard
          label="Worker Restart"
          value={stats ? String(stats.workerRestartTotal) : '—'}
          sub="Toplam yeniden başlatma"
          iconColor="#60a5fa"
          icon={<RotateCcw size={15} />}
          loading={loading && !stats}
        />
      </div>

      {/* Sürüm bazlı hata dağılımı */}
      {stats && stats.errorsByVersion.length > 0 && (
        <Card>
          <div className="flex items-center justify-between mb-4">
            <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: '#64748b' }}>
              Uygulama Versiyonu Bazlı Hata Dağılımı
            </p>
            <span className="text-[11px]" style={{ color: '#475569' }}>
              healthy olmayan eventler
            </span>
          </div>
          <div className="space-y-2">
            {stats.errorsByVersion.map(({ version, count }) => {
              const maxCount = stats.errorsByVersion[0]?.count ?? 1
              const pct      = Math.round((count / maxCount) * 100)
              return (
                <div key={version} className="flex items-center gap-3">
                  <code
                    className="text-[11px] font-mono shrink-0 w-24 truncate"
                    style={{ color: '#94a3b8' }}
                  >
                    {version}
                  </code>
                  <div className="flex-1" style={{ height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.06)', overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${pct}%`, background: '#f87171' }} />
                  </div>
                  <span className="text-[11px] tabular-nums shrink-0" style={{ color: '#64748b' }}>
                    {count}
                  </span>
                </div>
              )
            })}
          </div>
        </Card>
      )}

      {/* Servis listesi */}
      <Card>
        <div className="flex items-center justify-between mb-4">
          <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: '#64748b' }}>
            Servis Durumları
          </p>
          {!snapshot && (
            <span className="text-[11px]" style={{ color: '#475569' }}>
              Veri bekleniyor…
            </span>
          )}
        </div>

        {!snapshot ? (
          <ServiceListSkeleton />
        ) : snapshot.services.length > 0 ? (
          <ServiceList services={snapshot.services} />
        ) : (
          <ServiceListSkeleton />
        )}
      </Card>

      {/* Aktif incidentler */}
      <Card>
        <p className="text-xs font-semibold uppercase tracking-wider mb-4" style={{ color: '#64748b' }}>
          Son İncidentler
        </p>
        {loading && incidents.length === 0 ? (
          <SkeletonList rows={3} />
        ) : incidents.length === 0 ? (
          <EmptyState
            icon={<CheckCircle size={28} style={{ color: '#4ade80' }} />}
            title="Aktif incident yok"
            description="Son 24 saatte kritik veya düşük performanslı sistem olayı tespit edilmedi."
          />
        ) : (
          <IncidentTable incidents={incidents} />
        )}
      </Card>

      {/* Son olaylar zaman çizelgesi */}
      <Card>
        <p className="text-xs font-semibold uppercase tracking-wider mb-4" style={{ color: '#64748b' }}>
          Son Sistem Olayları
        </p>
        {loading && incidents.length === 0 ? (
          <SkeletonList rows={4} />
        ) : incidents.length === 0 ? (
          <EmptyState
            icon={<Activity size={28} style={{ color: '#475569' }} />}
            title="Zaman çizelgesi boş"
            description="Son 24 saatte incident kaydı yok."
          />
        ) : (
          <IncidentTimeline incidents={incidents.slice(0, 8)} />
        )}
      </Card>

    </div>
  )
}

// ── Bekleme Durumu Banner ─────────────────────────────────────────────────────

function WaitingBanner() {
  return (
    <div
      className="flex items-center gap-4 px-5 py-4 rounded-xl"
      style={{
        background: 'rgba(59,130,246,0.05)',
        border:     '1px solid rgba(59,130,246,0.15)',
      }}
    >
      <div
        className="flex items-center justify-center rounded-full shrink-0"
        style={{ width: 36, height: 36, background: 'rgba(59,130,246,0.1)' }}
      >
        <Clock size={18} style={{ color: '#60a5fa' }} />
      </div>
      <div>
        <p className="text-sm font-medium" style={{ color: '#93c5fd' }}>
          Filo verisi bekleniyor…
        </p>
        <p className="text-xs mt-0.5" style={{ color: '#475569' }}>
          vehicle_events tablosunda henüz system_health eventi yok.
          Araçlar bağlandıkça bu alan dolacak.
        </p>
      </div>
    </div>
  )
}

// ── Genel Durum Banner ────────────────────────────────────────────────────────

function OverallStatusBanner({ snapshot }: { snapshot: SystemHealthSnapshot }) {
  const statusColor = {
    healthy:  { bg: 'rgba(34,197,94,0.08)', border: 'rgba(34,197,94,0.2)', text: '#4ade80' },
    degraded: { bg: 'rgba(234,179,8,0.08)', border: 'rgba(234,179,8,0.2)', text: '#facc15' },
    critical: { bg: 'rgba(239,68,68,0.08)', border: 'rgba(239,68,68,0.2)', text: '#f87171' },
    unknown:  { bg: 'rgba(100,116,139,0.08)', border: 'rgba(100,116,139,0.2)', text: '#94a3b8' },
  }[snapshot.overall]

  return (
    <div
      className="flex items-center gap-4 px-5 py-4 rounded-xl"
      style={{ background: statusColor.bg, border: `1px solid ${statusColor.border}` }}
    >
      {_statusIcon(snapshot.overall)}
      <div>
        <p className="text-sm font-medium" style={{ color: statusColor.text }}>
          Genel Durum: {_statusLabel(snapshot.overall)}
        </p>
        <p className="text-[11px] mt-0.5" style={{ color: '#475569' }}>
          Son kontrol: {new Date(snapshot.ts).toLocaleString('tr-TR')}
          {snapshot.incidents.length > 0 && ` · ${snapshot.incidents.length} aktif incident`}
        </p>
      </div>
    </div>
  )
}

// ── Metrik Kartı ──────────────────────────────────────────────────────────────

interface MetricCardProps {
  label:     string
  value:     string
  sub:       string
  iconColor: string
  icon:      React.ReactNode
  loading?:  boolean
}

function MetricCard({ label, value, sub, iconColor, icon, loading }: MetricCardProps) {
  return (
    <Card>
      <div className="flex items-center justify-between mb-3">
        <p className="text-[11px] font-medium uppercase tracking-wider" style={{ color: '#475569' }}>
          {label}
        </p>
        <span style={{ color: iconColor }}>{icon}</span>
      </div>
      {loading ? (
        <div className="h-8 w-16 rounded animate-pulse" style={{ background: 'rgba(255,255,255,0.06)' }} />
      ) : (
        <p className="text-2xl font-bold tabular-nums" style={{ color: '#e2e8f0' }}>
          {value}
        </p>
      )}
      <p className="text-[11px] mt-0.5" style={{ color: '#475569' }}>
        {sub}
      </p>
    </Card>
  )
}

// ── Servis Listesi ────────────────────────────────────────────────────────────

function ServiceList({ services }: { services: ServiceHealth[] }) {
  return (
    <ul className="space-y-2">
      {services.map((svc) => (
        <li
          key={svc.service}
          className="flex items-center gap-3 px-3 py-2.5 rounded-lg"
          style={{ background: 'rgba(255,255,255,0.025)' }}
        >
          {_statusIcon(svc.status)}
          <span className="flex-1 text-sm font-medium" style={{ color: '#e2e8f0' }}>
            {svc.service}
          </span>
          <Badge variant={_statusVariant(svc.status)}>
            {_statusLabel(svc.status)}
          </Badge>
          {svc.latency_ms !== null && (
            <span className="text-[11px] tabular-nums" style={{ color: '#475569' }}>
              {svc.latency_ms}ms
            </span>
          )}
        </li>
      ))}
    </ul>
  )
}

// ── Servis Skeleton ───────────────────────────────────────────────────────────

function ServiceListSkeleton() {
  return (
    <ul className="space-y-2">
      {EXPECTED_SERVICES.map((svc) => (
        <li
          key={svc.name}
          className="flex items-center gap-3 px-3 py-2.5 rounded-lg"
          style={{ background: 'rgba(255,255,255,0.025)' }}
        >
          <span style={{ color: '#334155' }}>{svc.icon}</span>
          <span className="flex-1 text-sm" style={{ color: '#475569' }}>
            {svc.name}
          </span>
          <div className="h-5 w-20 rounded-full animate-pulse" style={{ background: 'rgba(255,255,255,0.05)' }} />
          <div className="h-3.5 w-10 rounded animate-pulse" style={{ background: 'rgba(255,255,255,0.04)' }} />
        </li>
      ))}
    </ul>
  )
}

// ── Incident Tablosu ──────────────────────────────────────────────────────────

function IncidentTable({ incidents }: { incidents: IncidentLog[] }) {
  return (
    <ul className="space-y-2">
      {incidents.map((inc) => (
        <li
          key={inc.id}
          className="flex items-center gap-3 px-3 py-2.5 rounded-lg"
          style={{ background: 'rgba(255,255,255,0.02)' }}
        >
          {inc.severity === 'critical'
            ? <XCircle size={14} style={{ color: '#f87171', flexShrink: 0 }} />
            : <AlertTriangle size={14} style={{ color: '#facc15', flexShrink: 0 }} />
          }
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <Badge variant={inc.severity === 'critical' ? 'danger' : 'warning'}>
                {inc.severity === 'critical' ? 'Kritik' : 'Uyarı'}
              </Badge>
              <span className="text-[11px] tabular-nums" style={{ color: '#475569' }}>
                {new Date(inc.ts).toLocaleString('tr-TR')}
              </span>
            </div>
            <p className="text-[11px] mt-0.5 truncate" style={{ color: '#64748b' }}>
              Termal L{inc.thermalLevel}
              {inc.uiFreezeCount > 0 && ` · ${inc.uiFreezeCount} UI donma`}
              {inc.restartCount > 0 && ` · ${inc.restartCount} restart`}
              {' · v'}{inc.appVersion}
            </p>
          </div>
        </li>
      ))}
    </ul>
  )
}

// ── Incident Zaman Çizelgesi ──────────────────────────────────────────────────

function IncidentTimeline({ incidents }: { incidents: IncidentLog[] }) {
  return (
    <div className="relative pl-5">
      {/* Dikey çizgi */}
      <div
        className="absolute left-1.5 top-1 bottom-1"
        style={{ width: 1, background: 'rgba(255,255,255,0.06)' }}
      />
      <ul className="space-y-4">
        {incidents.map((inc) => (
          <li key={inc.id} className="relative flex items-start gap-3">
            {/* Nokta */}
            <div
              className="absolute -left-3.5 top-1 rounded-full shrink-0"
              style={{
                width:      7,
                height:     7,
                background: inc.severity === 'critical' ? '#f87171' : '#facc15',
                flexShrink: 0,
              }}
            />
            <div className="ml-2 min-w-0">
              <p className="text-xs font-medium" style={{ color: '#94a3b8' }}>
                {new Date(inc.ts).toLocaleString('tr-TR')}
              </p>
              <p className="text-[11px] mt-0.5" style={{ color: '#475569' }}>
                {inc.overallHealth === 'critical' ? 'Kritik sistem durumu' : 'Düşük performans'}
                {inc.thermalLevel >= 2 && ` · Termal L${inc.thermalLevel}`}
                {inc.uiFreezeCount > 0 && ` · UI donma ×${inc.uiFreezeCount}`}
              </p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}

// ── Skeleton Satırlar ─────────────────────────────────────────────────────────

function SkeletonList({ rows }: { rows: number }) {
  return (
    <ul className="space-y-2">
      {Array.from({ length: rows }).map((_, i) => (
        <li key={i} className="h-10 rounded-lg animate-pulse" style={{ background: 'rgba(255,255,255,0.03)' }} />
      ))}
    </ul>
  )
}

// ── Boş Durum ─────────────────────────────────────────────────────────────────

function EmptyState({ icon, title, description }: {
  icon:        React.ReactNode
  title:       string
  description: string
}) {
  return (
    <div className="flex flex-col items-center justify-center py-10 gap-3">
      {icon}
      <p className="text-sm font-medium" style={{ color: '#94a3b8' }}>{title}</p>
      <p className="text-xs text-center max-w-sm" style={{ color: '#475569' }}>{description}</p>
    </div>
  )
}
