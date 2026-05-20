/**
 * CandidateStatusPanel — CAN sinyal doğrulama durumu
 *
 * candidate / verified / rejectedCandidate durumlarını gösterir.
 * Production guard: sadece verified + confidence ≥ 0.80 production'a geçer.
 */

import { useState, useEffect } from 'react';
import { CheckCircle, XCircle, Clock, AlertTriangle } from 'lucide-react';
import {
  getAllCandidates,
  onCandidateUpdate,
  resetCandidate,
  isProductionSafe,
  type CanSignalCandidate,
  type CandidateState,
} from '../../platform/canBus/CanSignalValidator';

const STATE_COLOR: Record<CandidateState, string> = {
  candidate:         '#f59e0b',
  verified:          '#22c55e',
  rejectedCandidate: '#ef4444',
};

const STATE_ICON: Record<CandidateState, React.ReactNode> = {
  candidate:         <Clock size={12} />,
  verified:          <CheckCircle size={12} />,
  rejectedCandidate: <XCircle size={12} />,
};

const STATE_LABEL: Record<CandidateState, string> = {
  candidate:         'Aday',
  verified:          'Doğrulandı',
  rejectedCandidate: 'Reddedildi',
};

function ConfidenceBar({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const color = value >= 0.8 ? '#22c55e' : value >= 0.5 ? '#f59e0b' : '#ef4444';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <div style={{
        flex: 1, height: 4, background: 'rgba(255,255,255,0.08)', borderRadius: 2, overflow: 'hidden'
      }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 2 }} />
      </div>
      <span style={{ fontSize: 10, color, minWidth: 28, textAlign: 'right' }}>{pct}%</span>
    </div>
  );
}

function CandidateRow({ c }: { c: CanSignalCandidate }) {
  const color  = STATE_COLOR[c.state];
  const safe   = isProductionSafe(c.canId, c.signalName);
  const canHex = `0x${c.canId.toString(16).toUpperCase().padStart(3, '0')}`;

  return (
    <div style={{
      padding: '8px 10px',
      background: 'rgba(255,255,255,0.03)',
      border: `1px solid ${c.state === 'verified' ? 'rgba(34,197,94,0.2)' : 'rgba(255,255,255,0.06)'}`,
      borderRadius: 6,
      display: 'flex',
      flexDirection: 'column',
      gap: 5,
    }}>
      {/* Başlık satırı */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ color, display: 'flex', alignItems: 'center' }}>{STATE_ICON[c.state]}</span>
        <span style={{ fontSize: 11, fontWeight: 700, color: '#e2e8f0' }}>
          {canHex} · {c.signalName}
        </span>
        <span style={{
          marginLeft: 'auto',
          fontSize: 9,
          fontWeight: 700,
          padding: '2px 6px',
          borderRadius: 4,
          background: `${color}22`,
          color,
        }}>
          {STATE_LABEL[c.state]}
          {safe && ' ✓ PROD'}
        </span>
      </div>

      {/* Decode formülü */}
      <div style={{ fontSize: 10, color: '#64748b', fontFamily: 'monospace' }}>
        {c.decodeFormula}
      </div>

      {/* Güven çubuğu */}
      <ConfidenceBar value={c.confidence} />

      {/* İstatistikler */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(3, 1fr)',
        gap: 4,
        fontSize: 10,
        color: '#475569',
      }}>
        <span>Örnek: <b style={{ color: '#94a3b8' }}>{c.sampleCount}</b></span>
        <span>Geçerli: <b style={{ color: '#22c55e' }}>{c.validCount}</b></span>
        <span>Jitter: <b style={{ color: c.jitterCount > 2 ? '#ef4444' : '#94a3b8' }}>{c.jitterCount}</b></span>
      </div>

      {/* Son değer */}
      {c.lastValue !== null && (
        <div style={{ fontSize: 10, color: '#64748b' }}>
          Son: <b style={{ color: '#94a3b8', fontFamily: 'monospace' }}>{String(c.lastValue)}</b>
        </div>
      )}

      {/* Ret sebebi */}
      {c.rejectionReason && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: '#f87171' }}>
          <AlertTriangle size={10} />
          {c.rejectionReason}
        </div>
      )}

      {/* Sıfırla butonu */}
      {c.state === 'rejectedCandidate' && (
        <button
          onClick={() => resetCandidate(c.canId, c.signalName)}
          style={{
            padding: '3px 8px',
            fontSize: 9,
            fontWeight: 700,
            background: 'rgba(255,255,255,0.05)',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: 4,
            color: '#94a3b8',
            cursor: 'pointer',
            alignSelf: 'flex-start',
          }}
        >
          Sıfırla
        </button>
      )}
    </div>
  );
}

export function CandidateStatusPanel() {
  const [candidates, setCandidates] = useState<CanSignalCandidate[]>(getAllCandidates);

  useEffect(() => {
    const unsub = onCandidateUpdate(() => {
      setCandidates(getAllCandidates());
    });
    return unsub;
  }, []);

  if (candidates.length === 0) return null;

  const verified  = candidates.filter(c => c.state === 'verified').length;
  const rejected  = candidates.filter(c => c.state === 'rejectedCandidate').length;
  const candidate = candidates.filter(c => c.state === 'candidate').length;

  return (
    <div style={{ padding: '12px 0' }}>
      {/* Başlık */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <span style={{
          fontSize: 11, fontWeight: 700, letterSpacing: '0.1em',
          color: '#64748b', textTransform: 'uppercase',
        }}>
          CAN Sinyal Doğrulama
        </span>
        <div style={{ display: 'flex', gap: 6, marginLeft: 'auto' }}>
          {verified  > 0 && <span style={{ fontSize: 10, color: '#22c55e' }}>✓ {verified}</span>}
          {candidate > 0 && <span style={{ fontSize: 10, color: '#f59e0b' }}>⏳ {candidate}</span>}
          {rejected  > 0 && <span style={{ fontSize: 10, color: '#ef4444' }}>✗ {rejected}</span>}
        </div>
      </div>

      {/* Production guard uyarısı */}
      {verified === 0 && (
        <div style={{
          padding: '6px 10px', marginBottom: 10,
          background: 'rgba(245,158,11,0.08)',
          border: '1px solid rgba(245,158,11,0.2)',
          borderRadius: 6, fontSize: 10, color: '#f59e0b',
        }}>
          Hiçbir sinyal verified değil — production'a geçiş engellendi.
        </div>
      )}

      {/* Aday listesi */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {candidates.map(c => (
          <CandidateRow key={`${c.canId}:${c.signalName}`} c={c} />
        ))}
      </div>
    </div>
  );
}
