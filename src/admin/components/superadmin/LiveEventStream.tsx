/**
 * LiveEventStream — Gerçek Zamanlı Operasyonel Olay Akışı
 *
 * Terminal / Engineering Console estetiği.
 * Satır yapısı: [TS]  [TAG]  dev:XXXXXX  —  Message  (×N)
 *
 * Performance garantileri:
 *   - Max 100 event bellekte tutulur (LRU slice)
 *   - overflow:hidden → Mali-400 GPU clipping overhead yok
 *   - Animasyon: yalnızca yeni satır mount'ında 100ms fade-in
 *   - Smooth scroll yasak (GPU yükü)
 *   - Hysteresis: aynı cihaz + aynı tag, 10s içinde → sayaç artışı
 */

import { useEffect, useRef, useState, useCallback } from 'react'
import {
  subscribeToLiveEvents,
  type LiveEvent,
  type LiveEventTag,
} from '../../services/superadmin.service'
import '../../styles/admin-enterprise.css'

// ── Sabitler ──────────────────────────────────────────────────────────────────

const MAX_EVENTS      = 100
const HYSTERESIS_MS   = 10_000   // 10 saniye
const ANIM_CLEAR_MS   =    200   // isNew flag temizleme gecikmesi

// ── Renk haritası ─────────────────────────────────────────────────────────────

const TAG_STYLE: Record<LiveEventTag, { color: string; bg: string }> = {
  OK:       { color: '#4ade80', bg: 'rgba(74,222,128,0.08)'  },
  RECOVERY: { color: '#60a5fa', bg: 'rgba(96,165,250,0.08)'  },
  WARN:     { color: '#facc15', bg: 'rgba(250,204,21,0.08)'  },
  PANIC:    { color: '#f87171', bg: 'rgba(248,113,113,0.08)' },
}

// ── Timestamp formatı ─────────────────────────────────────────────────────────

function _fmt(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString('en-GB', {
      hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit',
    })
  } catch { return '??:??:??' }
}

// ── Hysteresis anahtarı ───────────────────────────────────────────────────────

function _hysteresisKey(e: LiveEvent): string {
  return `${e.deviceHash}:${e.tag}`
}

// ── LiveEventStream ───────────────────────────────────────────────────────────

interface LiveEventStreamProps {
  height?: number   // px — varsayılan 360
  title?:  string
}

export function LiveEventStream({ height = 360, title }: LiveEventStreamProps) {
  const [events, setEvents] = useState<LiveEvent[]>([])
  const [connected, setConnected] = useState(false)

  // Hysteresis haritası: key → { ts, idx in events array }
  const hyMap = useRef(new Map<string, { ts: number; eventId: string }>())

  const handleEvent = useCallback((incoming: LiveEvent) => {
    const key  = _hysteresisKey(incoming)
    const now  = Date.now()
    const prev = hyMap.current.get(key)

    if (prev && now - prev.ts < HYSTERESIS_MS) {
      // Aynı cihaz + aynı tag → sayacı artır, yeni satır ekleme
      hyMap.current.set(key, { ts: now, eventId: prev.eventId })
      setEvents((evs) =>
        evs.map((e) =>
          e.id === prev.eventId ? { ...e, count: e.count + 1, isNew: false } : e,
        ),
      )
      return
    }

    // Yeni event
    hyMap.current.set(key, { ts: now, eventId: incoming.id })
    setEvents((evs) => [incoming, ...evs].slice(0, MAX_EVENTS))

    // isNew flag'ini 200ms sonra temizle (animasyon tamamlanmış olur)
    setTimeout(() => {
      setEvents((evs) =>
        evs.map((e) => (e.id === incoming.id ? { ...e, isNew: false } : e)),
      )
    }, ANIM_CLEAR_MS)
  }, [])

  useEffect(() => {
    const unsub = subscribeToLiveEvents(handleEvent)
    setConnected(true)
    return () => {
      unsub()
      setConnected(false)
    }
  }, [handleEvent])

  return (
    <div>
      {/* Başlık */}
      <div
        className="flex items-center justify-between px-3 h-8 shrink-0"
        style={{
          background:   '#0d0d0d',
          borderBottom: '1px solid rgba(255,255,255,0.07)',
          borderRadius: '6px 6px 0 0',
          border:       '1px solid rgba(255,255,255,0.07)',
        }}
      >
        <div className="flex items-center gap-2">
          <span
            style={{
              display:       'inline-block',
              width:          5,
              height:         5,
              borderRadius:  '50%',
              background:    connected ? '#22c55e' : '#475569',
              animation:     connected ? 'sa-blink 2.4s ease-in-out infinite' : 'none',
            }}
          />
          <span
            style={{
              fontFamily:    'var(--sa-font-mono, monospace)',
              fontSize:       10,
              color:         '#475569',
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
            }}
          >
            {title ?? 'CANLI_OPERASYON_AKIŞI'}
          </span>
        </div>
        <span
          style={{
            fontFamily:    'var(--sa-font-mono, monospace)',
            fontSize:       9,
            color:         '#334155',
            letterSpacing: '0.08em',
          }}
        >
          {events.length}/{MAX_EVENTS} olay · 10 sn histerezis
        </span>
      </div>

      {/* Stream container */}
      <div
        style={{
          height,
          overflowY:    'auto',
          overflowX:    'hidden',
          background:   '#080808',
          border:       '1px solid rgba(255,255,255,0.07)',
          borderTop:    'none',
          borderRadius: '0 0 6px 6px',
        }}
        className="sa-scroll"
      >
        {events.length === 0 ? (
          <EmptyTerminal connected={connected} />
        ) : (
          events.map((e) => <EventRow key={e.id} event={e} />)
        )}
      </div>
    </div>
  )
}

// ── Event Satırı ──────────────────────────────────────────────────────────────

function EventRow({ event: e }: { event: LiveEvent }) {
  const style = TAG_STYLE[e.tag]

  return (
    <div
      className={`sa-event-row${e.isNew ? ' sa-event-new' : ''}`}
      style={e.tag === 'PANIC' ? { background: style.bg } : undefined}
    >
      {/* Timestamp */}
      <span style={{ color: '#334155', flexShrink: 0, fontSize: 10 }}>
        {_fmt(e.ts)}
      </span>

      {/* Tag */}
      <span
        style={{
          color:         style.color,
          fontWeight:    700,
          flexShrink:    0,
          letterSpacing: '0.06em',
          minWidth:      58,
          fontSize:      10,
        }}
      >
        [{e.tag}]
      </span>

      {/* Device hash */}
      <span style={{ color: '#475569', flexShrink: 0, fontSize: 10 }}>
        dev:{e.deviceHash}
      </span>

      {/* Separator */}
      <span style={{ color: '#1e293b', flexShrink: 0 }}>—</span>

      {/* Message */}
      <span
        style={{
          color:    style.color,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          opacity:  e.tag === 'OK' ? 0.7 : 1,
        }}
      >
        {e.message}
      </span>

      {/* Hysteresis counter */}
      {e.count > 1 && (
        <span
          style={{
            marginLeft:    'auto',
            flexShrink:    0,
            color:         '#334155',
            fontSize:       9,
            letterSpacing: '0.06em',
          }}
        >
          ×{e.count}
        </span>
      )}
    </div>
  )
}

// ── Boş Terminal ──────────────────────────────────────────────────────────────

function EmptyTerminal({ connected }: { connected: boolean }) {
  return (
    <div
      style={{
        display:         'flex',
        flexDirection:   'column',
        alignItems:      'center',
        justifyContent:  'center',
        height:          '100%',
        gap:              8,
        fontFamily:      'var(--sa-font-mono, monospace)',
      }}
    >
      <span style={{ fontSize: 11, color: '#334155', letterSpacing: '0.08em' }}>
        {connected
          ? 'AKIŞ_AKTİF: vehicle_events bekleniyor...'
          : 'AKIŞ_ÇEVRİMDIŞI: Supabase Realtime bağlantısı kuruluyor...'}
      </span>
      <span style={{ fontSize: 9, color: '#1e293b', letterSpacing: '0.06em' }}>
        system_health · critical_error · hysteresis:10s
      </span>
    </div>
  )
}
