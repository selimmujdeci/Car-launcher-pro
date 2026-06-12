/**
 * IncidentReplayLite — Black Box Lite Analiz Modalı
 *
 * Olay anındaki 5 dakikalık telemetri penceresini gösterir.
 * Saf SVG path ile çizilir — requestAnimationFrame/ağır JS loop yok.
 * GPS verisi asla gösterilmez.
 */

import { useEffect, useState } from 'react';
import { X, Download, ChevronLeft, ChevronRight, AlertTriangle, Loader2 } from 'lucide-react';
import {
  getIncidentContext,
  type RecentIncident,
  type IncidentDataPoint,
} from '../../platform/superadmin/superAdminService';

// ── Sabitler ──────────────────────────────────────────────────────────────────

const BG    = '#050505';
const SURF  = '#0d0d0d';
const BORD  = '#1c1c1c';
const MUTED = '#4b5563';
const DIM   = '#2d3748';
const RED   = '#dc2626';
const GREEN = '#4ade80';
const BLUE  = '#60a5fa';
const AMB   = '#d97706';

// ── SVG yardımcıları ──────────────────────────────────────────────────────────

const VW  = 400;
const PAD = { t: 4, b: 4, l: 2, r: 2 };

function xOf(i: number, n: number): number {
  if (n <= 1) return VW / 2;
  return PAD.l + (i / (n - 1)) * (VW - PAD.l - PAD.r);
}

function yOf(v: number, max: number, H: number): number {
  const norm = max > 0 ? Math.max(0, Math.min(1, v / max)) : 0;
  return PAD.t + (H - PAD.t - PAD.b) * (1 - norm);
}

function thermalColor(l: number): string {
  if (l >= 3) return RED;
  if (l >= 2) return AMB;
  if (l >= 1) return '#d97706';
  return GREEN;
}

// Kritik nokta X koordinatı
function critX(seq: IncidentDataPoint[], targetTs: string): number {
  const target = new Date(targetTs).getTime();
  let best = 0, bestDiff = Infinity;
  seq.forEach((p, i) => {
    const diff = Math.abs(new Date(p.ts).getTime() - target);
    if (diff < bestDiff) { bestDiff = diff; best = i; }
  });
  return xOf(best, seq.length);
}

const HEALTH_TR: Record<string, string> = {
  healthy:  'SAĞLIKLI',
  degraded: 'BOZULMUŞ',
  critical: 'KRİTİK',
  unknown:  'BİLİNMİYOR',
};

function fmtTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch { return '--:--:--'; }
}

// ── IncidentReplayLite ────────────────────────────────────────────────────────

interface Props {
  incident: RecentIncident;
  onClose:  () => void;
}

export function IncidentReplayLite({ incident, onClose }: Props) {
  const [seq,        setSeq]        = useState<IncidentDataPoint[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [currentIdx, setCurrentIdx] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void getIncidentContext(incident.deviceHash, incident.ts).then((data) => {
      if (!cancelled) {
        setSeq(data);
        // Slider'ı kritik noktaya konumlandır
        if (data.length > 0) {
          const target = new Date(incident.ts).getTime();
          let best = 0, bestDiff = Infinity;
          data.forEach((p, i) => {
            const diff = Math.abs(new Date(p.ts).getTime() - target);
            if (diff < bestDiff) { bestDiff = diff; best = i; }
          });
          setCurrentIdx(best);
        }
        setLoading(false);
      }
    });
    return () => { cancelled = true; };
  }, [incident.deviceHash, incident.ts]);

  function handleDownload() {
    const bundle = {
      privacy:      'ANONİMLEŞTİRİLMİŞ — GPS verisi yok',
      incidentId:   incident.id,
      deviceHash:   incident.deviceHash,
      ts:           incident.ts,
      health:       incident.overallHealth,
      appVersion:   incident.appVersion,
      thermalLevel: incident.thermalLevel,
      contextPoints: seq.map((p) => ({
        ts:             p.ts,
        thermalLevel:   p.thermalLevel,
        ramPressure:    p.ramPressure,
        workerRestarts: p.workerRestarts,
        uiFreezeCount:  p.uiFreezeCount,
        overallHealth:  p.overallHealth,
      })),
    };
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `incident-${incident.deviceHash}-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const current = seq[currentIdx];
  const cx      = seq.length > 0 ? critX(seq, incident.ts) : VW / 2;
  const curX    = seq.length > 0 ? xOf(currentIdx, seq.length) : 0;

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1100,
      background: BG, display: 'flex', flexDirection: 'column',
      fontFamily: 'system-ui, sans-serif',
    }}>

      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '12px 16px', borderBottom: `1px solid ${BORD}`,
        background: '#080808', flexShrink: 0,
      }}>
        <button onClick={onClose} style={{
          background: 'transparent', border: 'none', cursor: 'pointer',
          color: MUTED, padding: 4, flexShrink: 0,
        }}>
          <X size={16} />
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{
            fontFamily: 'monospace', fontSize: 10, fontWeight: 700,
            color: incident.severity === 'critical' ? RED : AMB,
            letterSpacing: '0.12em', textTransform: 'uppercase',
          }}>
            KARA_KUTU_LITE — dev:{incident.deviceHash}
          </p>
          <p style={{ fontSize: 9, color: DIM, fontFamily: 'monospace', marginTop: 2 }}>
            {fmtTime(incident.ts)} · v{incident.appVersion} · T:L{incident.thermalLevel}
          </p>
        </div>
        <button onClick={handleDownload} style={{
          display: 'flex', alignItems: 'center', gap: 4,
          padding: '5px 10px',
          background: 'transparent', border: `1px solid ${BORD}`, borderRadius: 4,
          cursor: 'pointer', color: MUTED,
          fontFamily: 'monospace', fontSize: 9, fontWeight: 700,
          letterSpacing: '0.08em', textTransform: 'uppercase',
          flexShrink: 0,
        }}>
          <Download size={11} />
          LOGLARI İNDİR
        </button>
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>

        {loading ? (
          <div style={{
            flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexDirection: 'column', gap: 10,
          }}>
            <Loader2 size={20} style={{ color: MUTED, animation: 'spin 1s linear infinite' }} />
            <p style={{ fontFamily: 'monospace', fontSize: 10, color: MUTED, letterSpacing: '0.08em' }}>
              BAĞLAM_YÜKLENİYOR...
            </p>
          </div>
        ) : seq.length === 0 ? (
          <div style={{
            flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexDirection: 'column', gap: 8,
          }}>
            <AlertTriangle size={20} style={{ color: DIM }} />
            <p style={{ fontFamily: 'monospace', fontSize: 10, color: DIM, letterSpacing: '0.06em' }}>
              DİZİ_BOŞ: 5 dakikalık pencerede veri yok
            </p>
          </div>
        ) : (
          <>
            {/* Olay anı özeti */}
            <div style={{
              display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr',
              gap: 1, border: `1px solid ${BORD}`, borderRadius: 4, overflow: 'hidden',
            }}>
              {[
                { label: 'SAĞLIK', value: HEALTH_TR[incident.overallHealth] ?? incident.overallHealth.toUpperCase(),
                  color: incident.severity === 'critical' ? RED : AMB },
                { label: 'TERMAL', value: `L${current?.thermalLevel ?? incident.thermalLevel}`,
                  color: thermalColor(current?.thermalLevel ?? incident.thermalLevel) },
                { label: 'RAM', value: `${current?.ramPressure ?? 0}%`,
                  color: (current?.ramPressure ?? 0) > 80 ? RED : (current?.ramPressure ?? 0) > 60 ? AMB : MUTED },
                { label: 'KARE', value: `${currentIdx + 1}/${seq.length}`, color: MUTED },
              ].map((m) => (
                <div key={m.label} style={{ background: SURF, padding: '8px 10px' }}>
                  <p style={{ fontFamily: 'monospace', fontSize: 7, color: DIM,
                    letterSpacing: '0.10em', textTransform: 'uppercase' }}>{m.label}</p>
                  <p style={{ fontFamily: 'monospace', fontSize: 13, fontWeight: 700,
                    color: m.color, marginTop: 3 }}>{m.value}</p>
                </div>
              ))}
            </div>

            {/* Grafik etiketi: zaman ekseni */}
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              {[0, Math.floor(seq.length / 2), seq.length - 1].map((idx) => (
                <span key={idx} style={{
                  fontFamily: 'monospace', fontSize: 7, color: DIM, letterSpacing: '0.04em',
                }}>
                  {fmtTime(seq[idx]?.ts ?? '')}
                </span>
              ))}
            </div>

            {/* SVG 1: Thermal Level */}
            <ChartBlock label="TERMAL SEVİYE (L0-L3)" H={44}>
              {/* Grid lines */}
              {[0, 1, 2, 3].map((l) => (
                <line key={l} x1={PAD.l} y1={yOf(l, 3, 44)} x2={VW - PAD.r} y2={yOf(l, 3, 44)}
                  stroke={BORD} strokeWidth={0.5} />
              ))}
              {/* Step line */}
              {seq.slice(0, -1).map((p, i) => {
                const x1 = xOf(i,     seq.length);
                const x2 = xOf(i + 1, seq.length);
                const y1 = yOf(p.thermalLevel, 3, 44);
                const y2 = yOf(seq[i + 1].thermalLevel, 3, 44);
                return (
                  <g key={i}>
                    <line x1={x1} y1={y1} x2={x2} y2={y1}
                      stroke={thermalColor(p.thermalLevel)} strokeWidth={1.5} />
                    {y1 !== y2 && (
                      <line x1={x2} y1={y1} x2={x2} y2={y2}
                        stroke={thermalColor(seq[i + 1].thermalLevel)} strokeWidth={1.5} />
                    )}
                  </g>
                );
              })}
              <VLine x={cx}   H={44} color={RED}   dashed />
              <VLine x={curX} H={44} color={MUTED} />
            </ChartBlock>

            {/* SVG 2: RAM Pressure */}
            <ChartBlock label="RAM BASKISI (%)" H={44}>
              {[0, 50, 100].map((v) => (
                <line key={v} x1={PAD.l} y1={yOf(v, 100, 44)} x2={VW - PAD.r} y2={yOf(v, 100, 44)}
                  stroke={BORD} strokeWidth={0.5} />
              ))}
              {seq.length > 1 && (() => {
                const pts = seq.map((p, i) =>
                  `${xOf(i, seq.length).toFixed(1)},${yOf(p.ramPressure, 100, 44).toFixed(1)}`
                );
                const lastX = xOf(seq.length - 1, seq.length).toFixed(1);
                const H44   = (44 - PAD.b).toFixed(1);
                return (
                  <>
                    <path
                      d={`M ${PAD.l},${H44} L ${pts.join(' L ')} L ${lastX},${H44} Z`}
                      fill={BLUE} fillOpacity={0.1}
                    />
                    <polyline
                      points={pts.join(' ')}
                      fill="none" stroke={BLUE} strokeWidth={1} strokeOpacity={0.7}
                    />
                  </>
                );
              })()}
              <VLine x={cx}   H={44} color={RED}   dashed />
              <VLine x={curX} H={44} color={MUTED} />
            </ChartBlock>

            {/* SVG 3: Worker Restarts */}
            <ChartBlock label="WORKER YENİDEN BAŞLATMALARI" H={36}>
              {(() => {
                const maxR = Math.max(...seq.map((p) => p.workerRestarts), 1);
                const bw   = Math.max(1, (VW - PAD.l - PAD.r) / seq.length - 1);
                const inner = 36 - PAD.t - PAD.b;
                return (
                  <>
                    <line x1={PAD.l} y1={36 - PAD.b} x2={VW - PAD.r} y2={36 - PAD.b}
                      stroke={BORD} strokeWidth={0.5} />
                    {seq.map((p, i) => {
                      const barH = p.workerRestarts > 0
                        ? Math.max(2, (p.workerRestarts / maxR) * inner)
                        : 0;
                      return (
                        <rect
                          key={i}
                          x={xOf(i, seq.length) - bw / 2}
                          y={36 - PAD.b - barH}
                          width={bw}
                          height={barH}
                          fill={BLUE}
                          fillOpacity={0.7}
                        />
                      );
                    })}
                    <VLine x={cx}   H={36} color={RED}   dashed />
                    <VLine x={curX} H={36} color={MUTED} />
                  </>
                );
              })()}
            </ChartBlock>

            {/* Legend */}
            <div style={{ display: 'flex', gap: 16 }}>
              <LegendItem color={RED}   dashed label="KRİTİK NOKTA" />
              <LegendItem color={MUTED} label="OYNATMA" />
            </div>

            {/* Slider */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <p style={{
                fontFamily: 'monospace', fontSize: 8, color: DIM,
                letterSpacing: '0.10em', textTransform: 'uppercase',
              }}>
                ZAMAN TÜNELİ
              </p>
              <input
                type="range"
                min={0}
                max={seq.length - 1}
                value={currentIdx}
                onChange={(e) => setCurrentIdx(Number(e.target.value))}
                style={{ width: '100%', accentColor: MUTED, cursor: 'pointer' }}
              />
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <button
                  onClick={() => setCurrentIdx((i) => Math.max(0, i - 1))}
                  style={{
                    background: 'transparent', border: `1px solid ${BORD}`,
                    borderRadius: 4, cursor: 'pointer', color: MUTED, padding: '4px 8px',
                    display: 'flex', alignItems: 'center',
                  }}
                >
                  <ChevronLeft size={12} />
                </button>
                <span style={{ fontFamily: 'monospace', fontSize: 9, color: DIM }}>
                  {fmtTime(current?.ts ?? incident.ts)} · {seq.length} kare
                </span>
                <button
                  onClick={() => setCurrentIdx((i) => Math.min(seq.length - 1, i + 1))}
                  style={{
                    background: 'transparent', border: `1px solid ${BORD}`,
                    borderRadius: 4, cursor: 'pointer', color: MUTED, padding: '4px 8px',
                    display: 'flex', alignItems: 'center',
                  }}
                >
                  <ChevronRight size={12} />
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── SVG Yardımcı Bileşenler ───────────────────────────────────────────────────

function ChartBlock({ label, H, children }: { label: string; H: number; children: React.ReactNode }) {
  return (
    <div>
      <p style={{
        fontFamily: 'monospace', fontSize: 7, color: DIM,
        letterSpacing: '0.10em', textTransform: 'uppercase', marginBottom: 3,
      }}>
        {label}
      </p>
      <div style={{
        background: '#080808', border: `1px solid ${BORD}`,
        borderRadius: 2, overflow: 'hidden', lineHeight: 0,
      }}>
        <svg
          viewBox={`0 0 ${VW} ${H}`}
          preserveAspectRatio="none"
          style={{ width: '100%', height: H, display: 'block' }}
        >
          {children}
        </svg>
      </div>
    </div>
  );
}

function VLine({ x, H, color, dashed }: { x: number; H: number; color: string; dashed?: boolean }) {
  return (
    <line
      x1={x} y1={0} x2={x} y2={H}
      stroke={color}
      strokeWidth={dashed ? 1 : 0.5}
      strokeDasharray={dashed ? '3 2' : undefined}
      strokeOpacity={dashed ? 0.9 : 0.4}
    />
  );
}

function LegendItem({ color, label, dashed }: { color: string; label: string; dashed?: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
      <svg width={16} height={8}>
        <line x1={0} y1={4} x2={16} y2={4}
          stroke={color} strokeWidth={1} strokeDasharray={dashed ? '3 2' : undefined} />
      </svg>
      <span style={{
        fontFamily: 'monospace', fontSize: 8, color: DIM,
        letterSpacing: '0.08em', textTransform: 'uppercase',
      }}>
        {label}
      </span>
    </div>
  );
}
