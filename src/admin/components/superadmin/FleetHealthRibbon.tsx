/**
 * FleetHealthRibbon — Sabit üst telemetri şeridi (32px)
 *
 * 60s polling, değişen hücreye 200ms flash animasyonu,
 * SYSTEM_TIME etiketi. Privacy-First.
 */

import { useEffect, useRef, useState } from 'react'
import { getFleetHealthStats }         from '../../services/superadmin.service'
import type { FleetHealthStats }       from '../../services/superadmin.service'
import '../../styles/admin-enterprise.css'

const POLL_MS = 60_000

// ── Yardımcılar ───────────────────────────────────────────────────────────────

function scoreColor(score: number): string {
  if (score >= 80) return '#4ade80'
  if (score >= 60) return '#d97706'
  if (score >= 40) return '#ea580c'
  return '#dc2626'
}

function _ago(iso: string | null): string {
  if (!iso) return 'YOK'
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60)  return `${s} sn önce`
  const m = Math.floor(s / 60)
  if (m < 60)  return `${m} dk önce`
  return `${Math.floor(m / 60)} sa önce`
}

// ── FleetHealthRibbon ─────────────────────────────────────────────────────────

export function FleetHealthRibbon() {
  const [stats,   setStats]   = useState<FleetHealthStats | null>(null)
  const [syncing, setSyncing] = useState(true)
  const prevRef  = useRef<FleetHealthStats | null>(null)
  const timer    = useRef<ReturnType<typeof setInterval> | null>(null)

  async function poll() {
    try {
      const s = await getFleetHealthStats(1)
      prevRef.current = stats
      setStats(s)
    } catch { /* keep previous */ }
    finally  { setSyncing(false) }
  }

  useEffect(() => {
    void poll()
    timer.current = setInterval(() => void poll(), POLL_MS)
    return () => { if (timer.current) clearInterval(timer.current) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const score  = stats?.stabilityScore ?? 0
  const sColor = scoreColor(score)
  const prev   = prevRef.current

  return (
    <div
      className="shrink-0 flex items-center overflow-x-auto sa-scroll"
      style={{
        height:       32,
        background:   '#080808',
        borderBottom: '1px solid #1a1a1a',
      }}
    >
      {/* Stability anchor */}
      <div
        className="flex items-center gap-2 px-4 h-full shrink-0"
        style={{ borderRight: '1px solid #1a1a1a', minWidth: 168 }}
      >
        <span className="sa-dot" style={{ background: sColor }} />
        <span className="sa-cell-label">FİLO KARARLILIĞI</span>
        <span
          className={`sa-cell-value sa-mono${
            prev && prev.stabilityScore !== score ? ' sa-cell-flash' : ''
          }`}
          style={{ color: sColor, marginLeft: 6 }}
        >
          {syncing ? '—' : score.toFixed(1)}
        </span>
      </div>

      {/* Metrik hücreler */}
      <div className="flex items-center flex-1 h-full">
        <FlashCell
          label="OLAY/1SA"
          value={syncing ? '—' : String(stats?.totalEvents ?? 0)}
          color="#6b7280"
          changed={prev?.totalEvents !== stats?.totalEvents}
        />
        <FlashCell
          label="KRİTİK"
          value={syncing ? '—' : String(stats?.criticalEvents ?? 0)}
          color={(stats?.criticalEvents ?? 0) > 0 ? '#dc2626' : '#374151'}
          changed={prev?.criticalEvents !== stats?.criticalEvents}
        />
        <FlashCell
          label="TERMAL S3"
          value={syncing ? '—' : String(stats?.thermalL3Count ?? 0)}
          color={(stats?.thermalL3Count ?? 0) > 0 ? '#ea580c' : '#374151'}
          changed={prev?.thermalL3Count !== stats?.thermalL3Count}
        />
        <FlashCell
          label="ARAYÜZ DONMASI"
          value={syncing ? '—' : String(stats?.uiFreezeTotal ?? 0)}
          color={(stats?.uiFreezeTotal ?? 0) > 0 ? '#d97706' : '#374151'}
          changed={prev?.uiFreezeTotal !== stats?.uiFreezeTotal}
        />
        <FlashCell
          label="YENİDEN BAŞLATMA"
          value={syncing ? '—' : String(stats?.workerRestartTotal ?? 0)}
          color={(stats?.workerRestartTotal ?? 0) > 2 ? '#ea580c' : '#374151'}
          changed={prev?.workerRestartTotal !== stats?.workerRestartTotal}
        />
        <FlashCell
          label="SON EŞİTLEME"
          value={syncing ? 'eşitleniyor…' : _ago(stats?.lastUpdated ?? null)}
          color="#374151"
          changed={false}
        />
      </div>

      {/* SYSTEM_TIME */}
      <SystemTime />
    </div>
  )
}

// ── Flash Cell ────────────────────────────────────────────────────────────────

function FlashCell({
  label, value, color, changed,
}: {
  label: string; value: string; color: string; changed: boolean
}) {
  // flash key — değer değişince animasyonu yeniden başlatmak için key değişir
  const [flashKey, setFlashKey] = useState(0)
  const prevVal = useRef(value)

  useEffect(() => {
    if (changed && prevVal.current !== value) {
      prevVal.current = value
      setFlashKey((k) => k + 1)
    }
  }, [value, changed])

  return (
    <div className="sa-cell h-full">
      <span className="sa-cell-label">{label}</span>
      <span
        key={flashKey}
        className={`sa-cell-value${flashKey > 0 ? ' sa-cell-flash' : ''}`}
        style={{ color }}
      >
        {value}
      </span>
    </div>
  )
}

// ── SYSTEM_TIME ───────────────────────────────────────────────────────────────

function SystemTime() {
  const [t, setT] = useState(() =>
    new Date().toLocaleTimeString('en-GB', { hour12: false }),
  )

  useEffect(() => {
    const id = setInterval(
      () => setT(new Date().toLocaleTimeString('en-GB', { hour12: false })),
      1000,
    )
    return () => clearInterval(id)
  }, [])

  return (
    <div
      className="flex flex-col justify-center px-4 h-full shrink-0"
      style={{ borderLeft: '1px solid #1a1a1a', minWidth: 88 }}
    >
      <span className="sa-cell-label">SİSTEM_SAATİ</span>
      <span className="sa-cell-value sa-mono" style={{ color: '#374151', fontSize: 11 }}>
        {t}
      </span>
    </div>
  )
}
