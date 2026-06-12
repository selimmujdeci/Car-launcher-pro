/**
 * IncidentReplay — Kara Kutu Analiz Arayüzü
 *
 * Sol Panel:  Incident meta verisi (zaman, versiyon, device hash, durum)
 * Sağ Panel:  IncidentTimeline (3 grafik) + Playback slider
 *
 * Slider hareket ettikçe o anki termal/RAM/restart değerleri güncellenir.
 *
 * Privacy Garantisi:
 *   - Gerçek araç ID'si veya GPS verisi asla gösterilmez.
 *   - Yalnızca anonim operasyonel runtime verileri.
 */

import { useEffect, useState, useCallback, useRef } from 'react'
import { X, AlertTriangle, ChevronLeft, ChevronRight, Play, Pause } from 'lucide-react'
import {
  getIncidentSequence,
  type IncidentLog,
  type IncidentDataPoint,
} from '../../services/superadmin.service'
import { IncidentTimeline } from '../../components/superadmin/IncidentTimeline'
import '../../styles/admin-enterprise.css'

// ── Yardımcılar ───────────────────────────────────────────────────────────────

function thermalColor(l: number): string {
  if (l >= 3) return '#dc2626'
  if (l >= 2) return '#ea580c'
  if (l >= 1) return '#d97706'
  return '#4ade80'
}

function healthColor(h: string): string {
  if (h === 'critical') return '#dc2626'
  if (h === 'degraded') return '#d97706'
  return '#4ade80'
}

const SEVERITY_LABEL: Record<string, string> = {
  critical: 'KRİTİK',
  warning:  'UYARI',
  info:     'BİLGİ',
}

const HEALTH_LABEL: Record<string, string> = {
  healthy:  'SAĞLIKLI',
  degraded: 'BOZULMUŞ',
  critical: 'KRİTİK',
  unknown:  'BİLİNMİYOR',
}

function _fmt(iso: string): string {
  try {
    return new Date(iso).toLocaleString('tr-TR', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    })
  } catch { return iso }
}

// ── IncidentReplay ────────────────────────────────────────────────────────────

interface IncidentReplayProps {
  incident: IncidentLog | null
  onClose:  () => void
}

export function IncidentReplay({ incident, onClose }: IncidentReplayProps) {
  const [sequence,    setSequence]    = useState<IncidentDataPoint[]>([])
  const [loading,     setLoading]     = useState(false)
  const [currentIdx,  setCurrentIdx]  = useState(0)
  const [isPlaying,   setIsPlaying]   = useState(false)
  const playTimer = useRef<ReturnType<typeof setInterval> | null>(null)

  // Sequence yükle
  const loadSequence = useCallback(async (inc: IncidentLog) => {
    setLoading(true)
    setCurrentIdx(0)
    setIsPlaying(false)
    try {
      const seq = await getIncidentSequence(inc.deviceHash, inc.ts)
      setSequence(seq)
      // Başlangıç pozisyonunu kritik noktaya getir
      if (seq.length > 0) {
        const target = new Date(inc.ts).getTime()
        let best = 0, bestDiff = Infinity
        seq.forEach((pt, i) => {
          const diff = Math.abs(new Date(pt.ts).getTime() - target)
          if (diff < bestDiff) { bestDiff = diff; best = i }
        })
        setCurrentIdx(best)
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (incident) void loadSequence(incident)
    return () => { if (playTimer.current) clearInterval(playTimer.current) }
  }, [incident, loadSequence])

  // Playback otomatik ilerleme
  useEffect(() => {
    if (!isPlaying) {
      if (playTimer.current) { clearInterval(playTimer.current); playTimer.current = null }
      return
    }
    playTimer.current = setInterval(() => {
      setCurrentIdx((idx) => {
        if (idx >= sequence.length - 1) {
          setIsPlaying(false)
          return idx
        }
        return idx + 1
      })
    }, 400)
    return () => { if (playTimer.current) clearInterval(playTimer.current) }
  }, [isPlaying, sequence.length])

  if (!incident) return null

  const current = sequence[currentIdx]

  return (
    <div
      style={{
        position:   'fixed',
        inset:       0,
        zIndex:      100,
        background: 'rgba(0,0,0,0.85)',
        display:    'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding:    24,
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        style={{
          width:       '100%',
          maxWidth:    1100,
          background:  '#0a0a0a',
          border:      '1px solid #1a1a1a',
          borderRadius: 2,
          display:     'flex',
          flexDirection: 'column',
          maxHeight:   '90vh',
          overflow:    'hidden',
        }}
      >
        {/* ── Header ─────────────────────────────────────────────────── */}
        <div
          style={{
            display:       'flex',
            alignItems:    'center',
            justifyContent: 'space-between',
            padding:       '10px 16px',
            borderBottom:  '1px solid #1a1a1a',
            background:    '#080808',
            flexShrink:     0,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <AlertTriangle size={13} style={{ color: incident.severity === 'critical' ? '#dc2626' : '#d97706' }} />
            <span
              style={{
                fontFamily:    'var(--sa-font-mono)',
                fontSize:       11,
                fontWeight:     700,
                color:         '#4b5563',
                letterSpacing: '0.12em',
                textTransform: 'uppercase',
              }}
            >
              KARA_KUTU_TEKRARI
            </span>
            <span
              style={{
                fontFamily:    'var(--sa-font-mono)',
                fontSize:       10,
                color:         '#2d3748',
                letterSpacing: '0.06em',
              }}
            >
              — {_fmt(incident.ts)}
            </span>
          </div>
          <button
            onClick={onClose}
            style={{
              background:    'transparent',
              border:        'none',
              cursor:        'pointer',
              color:         '#374151',
              padding:        4,
              borderRadius:   2,
              display:       'flex',
              alignItems:    'center',
              transition:    'color 150ms ease',
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = '#9ca3af' }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = '#374151' }}
          >
            <X size={14} />
          </button>
        </div>

        {/* ── Body ───────────────────────────────────────────────────── */}
        <div
          style={{
            display:   'flex',
            flex:       1,
            overflow:  'hidden',
            minHeight:  0,
          }}
        >
          {/* Left Panel — Incident Details */}
          <div
            style={{
              width:       260,
              flexShrink:   0,
              borderRight: '1px solid #1a1a1a',
              padding:     '16px 16px',
              overflowY:   'auto',
              background:  '#080808',
            }}
            className="sa-scroll"
          >
            <p className="sa-label" style={{ marginBottom: 14 }}>OLAY AYRINTILARI</p>

            <DetailRow label="ÖNEM"    value={SEVERITY_LABEL[incident.severity] ?? incident.severity.toUpperCase()}
              color={incident.severity === 'critical' ? '#dc2626' : '#d97706'} />
            <DetailRow label="DURUM"      value={HEALTH_LABEL[incident.overallHealth] ?? incident.overallHealth.toUpperCase()}
              color={healthColor(incident.overallHealth)} />
            <DetailRow label="ZAMAN"   value={_fmt(incident.ts)} mono />
            <DetailRow label="UYGULAMA SÜRÜMÜ" value={`v${incident.appVersion}`} mono />
            <DetailRow label="CİHAZ_HASH" value={incident.deviceHash} mono dim />

            <div style={{ marginTop: 20, marginBottom: 14 }}>
              <p className="sa-label" style={{ marginBottom: 10 }}>OLAY ANINDA</p>
              <div
                style={{
                  display:      'grid',
                  gridTemplateColumns: '1fr 1fr',
                  gap:           1,
                  border:       '1px solid #1a1a1a',
                  borderRadius:  2,
                  overflow:     'hidden',
                }}
              >
                <StatCell label="TERMAL"
                  value={`L${incident.thermalLevel}`}
                  color={thermalColor(incident.thermalLevel)} />
                <StatCell label="DONMALAR"
                  value={String(incident.uiFreezeCount)}
                  color={incident.uiFreezeCount > 0 ? '#d97706' : '#374151'} />
                <StatCell label="BAŞLATMALAR"
                  value={String(incident.restartCount)}
                  color={incident.restartCount > 0 ? '#60a5fa' : '#374151'} />
                <StatCell label="PENCERE"
                  value="−15 dk"
                  color="#374151" />
              </div>
            </div>

            {/* Current frame values */}
            {current && (
              <div style={{ marginTop: 4 }}>
                <p className="sa-label" style={{ marginBottom: 10 }}>OYNATMA KARESİ</p>
                <div
                  style={{
                    display:      'grid',
                    gridTemplateColumns: '1fr 1fr',
                    gap:           1,
                    border:       '1px solid #1a1a1a',
                    borderRadius:  2,
                    overflow:     'hidden',
                  }}
                >
                  <StatCell label="TERMAL"
                    value={`L${current.thermalLevel}`}
                    color={thermalColor(current.thermalLevel)} />
                  <StatCell label="RAM"
                    value={`${current.ramPressure}%`}
                    color={current.ramPressure > 80 ? '#dc2626' : current.ramPressure > 60 ? '#d97706' : '#4ade80'} />
                  <StatCell label="BAŞLATMALAR"
                    value={String(current.workerRestarts)}
                    color={current.workerRestarts > 0 ? '#60a5fa' : '#374151'} />
                  <StatCell label="DURUM"
                    value={(HEALTH_LABEL[current.overallHealth] ?? current.overallHealth).slice(0, 4).toUpperCase()}
                    color={healthColor(current.overallHealth)} />
                </div>
                <p
                  style={{
                    fontFamily:    'var(--sa-font-mono)',
                    fontSize:       8,
                    color:         '#2d3748',
                    marginTop:      6,
                    letterSpacing: '0.04em',
                  }}
                >
                  {new Date(current.ts).toLocaleTimeString('tr-TR', { hour12: false })} · kare {currentIdx + 1}/{sequence.length}
                </p>
              </div>
            )}
          </div>

          {/* Right Panel — Timeline + Playback */}
          <div
            style={{
              flex:      1,
              padding:   '16px 20px',
              overflowY: 'auto',
              display:   'flex',
              flexDirection: 'column',
              gap:        16,
            }}
            className="sa-scroll"
          >
            <p className="sa-label">TELEMETRİ TEKRARI — 15 DK PENCERE</p>

            {loading ? (
              <div
                style={{
                  display:         'flex',
                  alignItems:      'center',
                  justifyContent:  'center',
                  height:           160,
                  fontFamily:      'var(--sa-font-mono)',
                  fontSize:         10,
                  color:           '#2d3748',
                  letterSpacing:   '0.08em',
                }}
              >
                DİZİ_YÜKLENİYOR: vehicle_events sorgulanıyor…
              </div>
            ) : (
              <IncidentTimeline
                sequence={sequence}
                targetTs={incident.ts}
                currentIdx={currentIdx}
              />
            )}

            {/* Playback controls */}
            {!loading && sequence.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {/* Slider */}
                <input
                  type="range"
                  min={0}
                  max={sequence.length - 1}
                  value={currentIdx}
                  onChange={(e) => {
                    setIsPlaying(false)
                    setCurrentIdx(Number(e.target.value))
                  }}
                  style={{
                    width:        '100%',
                    accentColor:  '#374151',
                    cursor:       'pointer',
                    height:        2,
                  }}
                />

                {/* Controls row */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <button
                    onClick={() => setCurrentIdx((i) => Math.max(0, i - 1))}
                    style={ctrlBtnStyle}
                    onMouseEnter={hoverIn}
                    onMouseLeave={hoverOut}
                    title="Önceki"
                  >
                    <ChevronLeft size={12} />
                  </button>

                  <button
                    onClick={() => setIsPlaying((p) => !p)}
                    style={{ ...ctrlBtnStyle, minWidth: 60 }}
                    onMouseEnter={hoverIn}
                    onMouseLeave={hoverOut}
                    title={isPlaying ? 'Duraklat' : 'Oynat'}
                  >
                    {isPlaying
                      ? <><Pause size={10} /><span>DURAKLAT</span></>
                      : <><Play  size={10} /><span>OYNAT</span></>
                    }
                  </button>

                  <button
                    onClick={() => setCurrentIdx((i) => Math.min(sequence.length - 1, i + 1))}
                    style={ctrlBtnStyle}
                    onMouseEnter={hoverIn}
                    onMouseLeave={hoverOut}
                    title="Sonraki"
                  >
                    <ChevronRight size={12} />
                  </button>

                  <button
                    onClick={() => { setIsPlaying(false); setCurrentIdx(0) }}
                    style={ctrlBtnStyle}
                    onMouseEnter={hoverIn}
                    onMouseLeave={hoverOut}
                    title="Sıfırla"
                  >
                    SIFIRLA
                  </button>

                  <span
                    style={{
                      marginLeft:    'auto',
                      fontFamily:    'var(--sa-font-mono)',
                      fontSize:       9,
                      color:         '#2d3748',
                      letterSpacing: '0.06em',
                    }}
                  >
                    {sequence.length} kare · 15 dk pencere
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Detail Row ────────────────────────────────────────────────────────────────

function DetailRow({
  label, value, color, mono, dim,
}: {
  label: string; value: string; color?: string; mono?: boolean; dim?: boolean
}) {
  return (
    <div style={{ marginBottom: 10 }}>
      <p className="sa-label">{label}</p>
      <p
        style={{
          fontFamily:    mono ? 'var(--sa-font-mono)' : 'var(--sa-font-ui)',
          fontSize:       mono ? 10 : 11,
          fontWeight:     mono ? 400 : 500,
          color:         color ?? (dim ? '#2d3748' : '#6b7280'),
          letterSpacing: mono ? '0.04em' : undefined,
          marginTop:      2,
          wordBreak:     'break-all',
        }}
      >
        {value}
      </p>
    </div>
  )
}

// ── Stat Cell ─────────────────────────────────────────────────────────────────

function StatCell({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div
      style={{
        background:  '#0d0d0d',
        padding:     '8px 10px',
      }}
    >
      <p className="sa-label">{label}</p>
      <p
        className="sa-mono"
        style={{ fontSize: 14, fontWeight: 700, color, marginTop: 3, lineHeight: 1 }}
      >
        {value}
      </p>
    </div>
  )
}

// ── Stil yardımcıları ─────────────────────────────────────────────────────────

const ctrlBtnStyle: React.CSSProperties = {
  display:        'flex',
  alignItems:     'center',
  gap:             4,
  padding:        '4px 8px',
  background:     'transparent',
  border:         '1px solid #1a1a1a',
  borderRadius:    2,
  cursor:         'pointer',
  color:          '#374151',
  fontFamily:     'var(--sa-font-mono)',
  fontSize:        9,
  fontWeight:      700,
  letterSpacing:  '0.08em',
  textTransform:  'uppercase',
  transition:     'border-color 150ms ease, color 150ms ease',
}

function hoverIn(e: React.MouseEvent<HTMLButtonElement>) {
  e.currentTarget.style.color        = '#9ca3af'
  e.currentTarget.style.borderColor  = '#374151'
}
function hoverOut(e: React.MouseEvent<HTMLButtonElement>) {
  e.currentTarget.style.color        = '#374151'
  e.currentTarget.style.borderColor  = '#1a1a1a'
}
