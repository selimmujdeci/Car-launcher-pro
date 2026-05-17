/**
 * DebugConsole — Gerçek Zamanlı Debug Terminal
 *
 * JetBrains Mono · siyah arka plan · yeşil terminal metni.
 * Gelen loglar anonymize edilmiş sistem mesajlarıdır.
 * "DOWNLOAD DEBUG BUNDLE" → JSON export (session verisinin tamamı).
 *
 * Privacy Garantisi:
 *   GPS verisi asla gösterilmez.
 *   Yalnızca operasyonel runtime metrikleri (thermal, ram, worker state).
 */

import { useEffect, useRef, useState } from 'react'
import { Download, Terminal } from 'lucide-react'
import type { LiveEvent }    from '../../services/superadmin.service'
import '../../styles/admin-enterprise.css'

// ── Sabitler ──────────────────────────────────────────────────────────────────

const MAX_LINES = 200

// ── Log formatı ───────────────────────────────────────────────────────────────

function _ts(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString('en-GB', { hour12: false })
  } catch { return '??:??:??' }
}

/** Tag → terminal rengi */
const TAG_COLOR: Record<string, string> = {
  OK:       '#22c55e',
  RECOVERY: '#60a5fa',
  WARN:     '#d97706',
  PANIC:    '#ef4444',
}

function tagColor(tag: string): string {
  return TAG_COLOR[tag] ?? '#4b5563'
}

// ── DebugConsole ──────────────────────────────────────────────────────────────

export interface DebugConsoleProps {
  events:     LiveEvent[]
  active:     boolean
  deviceHash: string
  sessionStart?: string
}

export function DebugConsole({ events, active, deviceHash, sessionStart }: DebugConsoleProps) {
  const bottomRef = useRef<HTMLDivElement>(null)
  const [autoScroll, setAutoScroll] = useState(true)

  // Yeni event gelince aşağı kaydır
  useEffect(() => {
    if (autoScroll && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'auto' })
    }
  }, [events.length, autoScroll])

  function handleDownload() {
    const bundle = {
      sessionMeta: {
        deviceHash,
        sessionStart: sessionStart ?? new Date().toISOString(),
        exportedAt:   new Date().toISOString(),
        eventCount:   events.length,
        privacy:      'ANONYMIZED — no GPS, no user data',
      },
      events: events.map((e) => ({
        ts:      e.ts,
        tag:     e.tag,
        message: e.message,
        count:   e.count,
      })),
    }
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href     = url
    a.download = `debug-bundle-${deviceHash}-${Date.now()}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const visibleLines = events.slice(-MAX_LINES)

  return (
    <div
      style={{
        display:       'flex',
        flexDirection: 'column',
        background:    '#000',
        border:        '1px solid #1a1a1a',
        borderRadius:   2,
        overflow:      'hidden',
      }}
    >
      {/* Console toolbar */}
      <div
        style={{
          display:       'flex',
          alignItems:    'center',
          justifyContent: 'space-between',
          padding:       '6px 12px',
          background:    '#080808',
          borderBottom:  '1px solid #111',
          flexShrink:     0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Terminal size={11} style={{ color: '#22c55e' }} />
          <span
            style={{
              fontFamily:    'var(--sa-font-mono)',
              fontSize:       10,
              fontWeight:     700,
              color:         '#22c55e',
              letterSpacing: '0.10em',
            }}
          >
            DEBUG_CONSOLE · dev:{deviceHash}
          </span>

          {/* LIVE indicator */}
          {active && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginLeft: 8 }}>
              <span
                className="sa-dot"
                style={{ background: '#22c55e', width: 5, height: 5 }}
              />
              <span
                style={{
                  fontFamily:    'var(--sa-font-mono)',
                  fontSize:       8,
                  fontWeight:     700,
                  color:         '#22c55e',
                  letterSpacing: '0.12em',
                  animation:     'sa-blink 1.2s ease-in-out infinite',
                }}
              >
                LIVE_DEBUG_ACTIVE
              </span>
            </div>
          )}
          {!active && events.length > 0 && (
            <span
              style={{
                fontFamily:    'var(--sa-font-mono)',
                fontSize:       8,
                color:         '#2d3748',
                letterSpacing: '0.08em',
                marginLeft:     8,
              }}
            >
              SESSION_ENDED
            </span>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {/* Auto-scroll toggle */}
          <button
            onClick={() => setAutoScroll((v) => !v)}
            style={{
              background:    'transparent',
              border:        `1px solid ${autoScroll ? '#22c55e30' : '#1a1a1a'}`,
              borderRadius:   2,
              padding:       '2px 6px',
              cursor:        'pointer',
              fontFamily:    'var(--sa-font-mono)',
              fontSize:       8,
              color:         autoScroll ? '#22c55e' : '#2d3748',
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
            }}
          >
            AUTO-SCROLL {autoScroll ? 'ON' : 'OFF'}
          </button>

          {/* Download */}
          <button
            onClick={handleDownload}
            disabled={events.length === 0}
            style={{
              display:       'flex',
              alignItems:    'center',
              gap:            4,
              background:    'transparent',
              border:        `1px solid ${events.length > 0 ? '#22c55e30' : '#111'}`,
              borderRadius:   2,
              padding:       '2px 8px',
              cursor:        events.length > 0 ? 'pointer' : 'not-allowed',
              fontFamily:    'var(--sa-font-mono)',
              fontSize:       8,
              fontWeight:     700,
              color:         events.length > 0 ? '#22c55e' : '#1a1a1a',
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              transition:    'border-color 150ms ease',
            }}
          >
            <Download size={9} />
            DOWNLOAD DEBUG BUNDLE
          </button>
        </div>
      </div>

      {/* Log output */}
      <div
        style={{
          height:       320,
          overflowY:    'auto',
          overflowX:    'hidden',
          padding:      '8px 12px',
          fontFamily:   'var(--sa-font-mono)',
          fontSize:      11,
          lineHeight:    1.6,
        }}
        className="sa-scroll"
        onScroll={(e) => {
          const el = e.currentTarget
          const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 20
          if (atBottom !== autoScroll) setAutoScroll(atBottom)
        }}
      >
        {visibleLines.length === 0 ? (
          <ConsoleIdle active={active} />
        ) : (
          visibleLines.map((e) => <LogLine key={`${e.id}-${e.count}`} event={e} />)
        )}
        <div ref={bottomRef} />
      </div>

      {/* Footer */}
      <div
        style={{
          display:       'flex',
          alignItems:    'center',
          justifyContent: 'space-between',
          padding:       '4px 12px',
          background:    '#080808',
          borderTop:     '1px solid #111',
          flexShrink:     0,
        }}
      >
        <span
          style={{
            fontFamily:    'var(--sa-font-mono)',
            fontSize:       8,
            color:         '#1a1a1a',
            letterSpacing: '0.06em',
          }}
        >
          {visibleLines.length}/{MAX_LINES} lines · GPS_EXCLUDED · USER_DATA_EXCLUDED
        </span>
        {events.length > MAX_LINES && (
          <span
            style={{
              fontFamily:    'var(--sa-font-mono)',
              fontSize:       8,
              color:         '#2d3748',
              letterSpacing: '0.06em',
            }}
          >
            showing last {MAX_LINES}
          </span>
        )}
      </div>
    </div>
  )
}

// ── Log Line ──────────────────────────────────────────────────────────────────

function LogLine({ event: e }: { event: LiveEvent }) {
  const color = tagColor(e.tag)
  return (
    <div
      className={e.isNew ? 'sa-event-new' : undefined}
      style={{
        display:    'flex',
        gap:         8,
        marginBottom: 1,
        background: e.tag === 'PANIC' ? 'rgba(239,68,68,0.04)' : 'transparent',
        padding:    e.tag === 'PANIC' ? '1px 4px' : undefined,
        borderRadius: 1,
      }}
    >
      {/* Timestamp */}
      <span style={{ color: '#1a1a1a', flexShrink: 0, minWidth: 54 }}>
        {_ts(e.ts)}
      </span>

      {/* Tag */}
      <span style={{ color, fontWeight: 700, flexShrink: 0, minWidth: 62 }}>
        [{e.tag}]
      </span>

      {/* Message */}
      <span style={{ color: e.tag === 'OK' ? '#166534' : color, flex: 1 }}>
        {e.message}
        {e.count > 1 && (
          <span style={{ color: '#1a1a1a', marginLeft: 8 }}>×{e.count}</span>
        )}
      </span>
    </div>
  )
}

// ── Console Idle State ────────────────────────────────────────────────────────

function ConsoleIdle({ active }: { active: boolean }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ color: '#22c55e' }}>CarOS Pro — Remote Debug Terminal v1.0</span>
      <span style={{ color: '#166534' }}>Privacy: GPS_EXCLUDED · USER_DATA_EXCLUDED</span>
      <span style={{ color: '#1a1a1a' }}>─────────────────────────────────────────</span>
      {active ? (
        <span style={{ color: '#22c55e', animation: 'sa-blink 1s ease-in-out infinite' }}>
          STREAM_ACTIVE: Waiting for vehicle telemetry...
        </span>
      ) : (
        <span style={{ color: '#2d3748' }}>
          STREAM_IDLE: Start a debug session to see live logs.
        </span>
      )}
    </div>
  )
}
