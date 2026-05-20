/**
 * DiagnosticsBridgeLite — Canlı Uzak Teşhis Modalı
 *
 * 60 saniyelik TTL ile seçili cihazın anlık telemetrisini akışa alır.
 * GPS verisi asla gösterilmez — sadece sistem sağlık metrikleri.
 * Mali-400 uyumlu: opacity geçişleri, blur/gradient yok.
 */

import { useEffect, useRef, useState } from 'react';
import { X, Activity, Loader2 } from 'lucide-react';
import {
  requestRemoteDiagnostics,
  subscribeToDeviceHeartbeat,
  type DiagnosticsHeartbeat,
  type RecentIncident,
} from '../../platform/superadmin/superAdminService';

// ── Sabitler ──────────────────────────────────────────────────────────────────

const BG    = '#050505';
const BORD  = '#1c1c1c';
const TEXT  = '#e5e7eb';
const MUTED = '#4b5563';
const DIM   = '#2d3748';
const RED   = '#dc2626';
const GREEN = '#4ade80';
const BLUE  = '#60a5fa';
const AMB   = '#d97706';

const TTL_SECONDS = 60;
const MAX_LOG_ENTRIES = 80;

// ── Tipler ────────────────────────────────────────────────────────────────────

interface LogEntry {
  id:      number
  ts:      string
  message: string
  level:   'info' | 'warn' | 'critical'
}

interface Props {
  incident: RecentIncident
  onClose:  () => void
}

let _logSeq = 0;

function makeLog(message: string): LogEntry {
  const level: LogEntry['level'] =
    message.startsWith('THERMAL') || message.startsWith('MEM') || message.startsWith('HEALTH') ? 'warn'
    : message.includes('RESTART') || message.includes('FREEZE')                                 ? 'critical'
    : 'info';
  return { id: ++_logSeq, ts: new Date().toISOString(), message, level };
}

function fmtTs(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString('tr-TR', {
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
  } catch { return '--:--:--'; }
}

// ── DiagnosticsBridgeLite ─────────────────────────────────────────────────────

export function DiagnosticsBridgeLite({ incident, onClose }: Props) {
  const [connected, setConnected] = useState(false);
  const [heartbeat, setHeartbeat] = useState<DiagnosticsHeartbeat | null>(null);
  const [logs,      setLogs]      = useState<LogEntry[]>([]);
  const [ttl,       setTtl]       = useState(TTL_SECONDS);

  const unsubRef   = useRef<(() => void) | null>(null);
  const timerRef   = useRef<ReturnType<typeof setInterval> | null>(null);
  const logsEndRef = useRef<HTMLDivElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  function pushLog(message: string) {
    setLogs((prev) => {
      const next = [...prev, makeLog(message)];
      return next.length > MAX_LOG_ENTRIES ? next.slice(-MAX_LOG_ENTRIES) : next;
    });
  }

  // TTL sıfırlandığında kapat
  useEffect(() => {
    if (ttl <= 0) {
      unsubRef.current?.();
      if (timerRef.current) clearInterval(timerRef.current);
      onCloseRef.current();
    }
  }, [ttl]);

  // Auto-scroll log listesi
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  // Init: audit + remote command + heartbeat subscription + TTL timer
  useEffect(() => {
    let cancelled = false;

    async function init() {
      try {
        await requestRemoteDiagnostics(incident.deviceHash);
        if (cancelled) return;
        setConnected(true);
        pushLog('DIAG_SESSION_START: Bağlantı kuruldu');
      } catch (e) {
        if (!cancelled) {
          const msg = e instanceof Error ? e.message : 'Başlatma hatası';
          // remote_commands tablosu henüz yoksa bağlantıyı yine de göster
          setConnected(true);
          pushLog(`DIAG_CMD_WARN: ${msg} — izleme devam ediyor`);
        }
      }

      if (cancelled) return;

      unsubRef.current = subscribeToDeviceHeartbeat(incident.deviceHash, (hb: DiagnosticsHeartbeat) => {
        if (cancelled) return;
        setHeartbeat(hb);
        hb.verbosityLogs.forEach((msg: string) => pushLog(msg));
      });

      timerRef.current = setInterval(() => {
        if (cancelled) return;
        setTtl((prev) => Math.max(0, prev - 1));
      }, 1000);
    }

    void init();

    return () => {
      cancelled = true;
      unsubRef.current?.();
      unsubRef.current = null;
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    };
  }, [incident.deviceHash]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleClose() {
    unsubRef.current?.();
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    onClose();
  }

  const ttlColor = ttl > 30 ? GREEN : ttl > 10 ? AMB : RED;

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1200,
      background: BG, display: 'flex', flexDirection: 'column',
      fontFamily: '"JetBrains Mono", monospace, system-ui',
    }}>

      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '12px 16px', borderBottom: `0.5px solid ${BORD}`,
        background: '#060606', flexShrink: 0,
      }}>
        <button onClick={handleClose} style={{
          background: 'transparent', border: 'none', cursor: 'pointer',
          color: MUTED, padding: 4, flexShrink: 0,
        }}>
          <X size={16} />
        </button>

        {/* CANLI BAĞLANTI indikatörü */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '3px 8px',
          background: connected ? 'rgba(96,165,250,0.07)' : 'rgba(75,85,99,0.07)',
          border: `0.5px solid ${connected ? `${BLUE}40` : `${MUTED}30`}`,
          borderRadius: 3, flexShrink: 0,
        }}>
          <div style={{
            width: 6, height: 6, borderRadius: '50%',
            background: connected ? BLUE : MUTED,
            animation: connected ? 'diag-pulse 1.2s ease-in-out infinite' : 'none',
          }} />
          <span style={{
            fontFamily: 'monospace', fontSize: 9, fontWeight: 700,
            color: connected ? BLUE : MUTED, letterSpacing: '0.12em',
          }}>
            {connected ? 'CANLI BAĞLANTI' : 'BAĞLANIYOR...'}
          </span>
        </div>

        {/* Başlık */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{
            fontFamily: 'monospace', fontSize: 10, fontWeight: 700,
            color: BLUE, letterSpacing: '0.10em', textTransform: 'uppercase',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>
            CANLI TEŞHİS — dev:{incident.deviceHash}
          </p>
        </div>

        {/* TTL Geri Sayım */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', flexShrink: 0 }}>
          <p style={{ fontFamily: 'monospace', fontSize: 18, fontWeight: 700, color: ttlColor, lineHeight: 1 }}>
            {String(ttl).padStart(2, '0')}
          </p>
          <p style={{ fontFamily: 'monospace', fontSize: 7, color: DIM, letterSpacing: '0.10em' }}>TTL</p>
        </div>
      </div>

      {/* Cihaz Meta Satırı */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '8px 16px',
        background: '#080808', borderBottom: `0.5px solid ${BORD}`,
        flexShrink: 0, flexWrap: 'wrap', gap: 8,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <MetaChip label="CİHAZ SINIFI" value={heartbeat?.deviceClass    ?? '—'} />
          <MetaChip label="ANDROID"      value={heartbeat?.androidVersion ?? '—'} />
          <MetaChip label="VERSİYON"     value={`v${incident.appVersion}`}         />
        </div>
        {heartbeat && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <ThermalBadge level={heartbeat.thermalLevel} />
            <span style={{
              fontFamily: 'monospace', fontSize: 9,
              color: heartbeat.ramPressure > 80 ? RED : heartbeat.ramPressure > 60 ? AMB : MUTED,
            }}>
              RAM:{heartbeat.ramPressure}%
            </span>
          </div>
        )}
      </div>

      {/* Log Akışı */}
      <div style={{
        flex: 1, overflowY: 'auto', padding: '10px 16px',
        display: 'flex', flexDirection: 'column', gap: 0,
      }}>
        {/* Header etiketi */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8,
        }}>
          <Activity size={10} style={{ color: DIM }} />
          <span style={{
            fontFamily: 'monospace', fontSize: 8, color: DIM,
            letterSpacing: '0.12em', textTransform: 'uppercase',
          }}>
            VERBOSITY LOG
          </span>
        </div>

        {logs.length === 0 ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, paddingTop: 4 }}>
            <Loader2 size={10} style={{ color: DIM, animation: 'spin 1s linear infinite' }} />
            <p style={{ fontFamily: 'monospace', fontSize: 9, color: DIM, letterSpacing: '0.06em' }}>
              LOG_STREAM: Mesaj bekleniyor...
            </p>
          </div>
        ) : (
          logs.map((entry) => <LogLine key={entry.id} entry={entry} />)
        )}
        <div ref={logsEndRef} />
      </div>

      {/* Animasyon keyframe */}
      <style>{`
        @keyframes diag-pulse {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0.25; }
        }
      `}</style>
    </div>
  );
}

// ── Alt Bileşenler ────────────────────────────────────────────────────────────

function MetaChip({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p style={{ fontFamily: 'monospace', fontSize: 7, color: DIM, letterSpacing: '0.10em', textTransform: 'uppercase' }}>
        {label}
      </p>
      <p style={{ fontFamily: 'monospace', fontSize: 10, fontWeight: 700, color: TEXT, marginTop: 1 }}>
        {value}
      </p>
    </div>
  );
}

function ThermalBadge({ level }: { level: number }) {
  const color = level >= 3 ? RED : level >= 2 ? AMB : level >= 1 ? '#ca8a04' : GREEN;
  return (
    <span style={{
      fontFamily: 'monospace', fontSize: 9, fontWeight: 700,
      color, border: `0.5px solid ${color}40`, borderRadius: 3,
      padding: '1px 5px',
    }}>
      T:L{level}
    </span>
  );
}

const LOG_COLORS: Record<LogEntry['level'], string> = {
  info:     MUTED,
  warn:     AMB,
  critical: RED,
};

function LogLine({ entry }: { entry: LogEntry }) {
  const color = LOG_COLORS[entry.level];
  return (
    <div style={{
      display: 'flex', alignItems: 'baseline', gap: 8,
      padding: '3px 0', borderBottom: `0.5px solid ${BORD}`,
    }}>
      <span style={{ fontFamily: 'monospace', fontSize: 8, color: DIM, flexShrink: 0, minWidth: 60 }}>
        {fmtTs(entry.ts)}
      </span>
      <span style={{ fontFamily: 'monospace', fontSize: 9, color, letterSpacing: '0.04em' }}>
        {entry.message}
      </span>
    </div>
  );
}
