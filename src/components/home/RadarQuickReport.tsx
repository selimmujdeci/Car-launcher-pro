/**
 * RadarQuickReport.tsx — Eagle Eye hızlı ihbar butonu.
 *
 * Ana ekran veya Harita üzerinde gösterilen tek dokunuşla
 * 'mobile' radar ihbarı gönderir. GPS yoksa hata gösterir.
 * Spam guard (60 s) → radarCommunityService tarafından fırlatılır.
 */

import { useState, useCallback }          from 'react';
import { Radio, CheckCircle, AlertCircle, Loader } from 'lucide-react';
import { useGPSLocation, useGPSHeading }  from '../../platform/gpsService';
import { reportThreat }                   from '../../platform/radar/radarCommunityService';

type Status = 'idle' | 'sending' | 'success' | 'error';

// ── Style maps ────────────────────────────────────────────────────────────────

const BG: Record<Status, string> = {
  idle:    'rgba(234,179,8,0.18)',
  sending: 'rgba(234,179,8,0.10)',
  success: 'rgba(34,197,94,0.20)',
  error:   'rgba(239,68,68,0.20)',
};
const BORDER: Record<Status, string> = {
  idle:    'rgba(234,179,8,0.55)',
  sending: 'rgba(234,179,8,0.25)',
  success: 'rgba(34,197,94,0.50)',
  error:   'rgba(239,68,68,0.45)',
};
const TEXT_COLOR: Record<Status, string> = {
  idle:    '#facc15',
  sending: 'rgba(250,204,21,0.45)',
  success: '#4ade80',
  error:   '#f87171',
};

// ── Component ─────────────────────────────────────────────────────────────────

export function RadarQuickReport() {
  const location = useGPSLocation();
  const heading  = useGPSHeading();

  const [status,   setStatus]   = useState<Status>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleReport = useCallback(async () => {
    if (status === 'sending') return;

    if (!location) {
      setStatus('error');
      setErrorMsg('GPS sinyali yok');
      const t = setTimeout(() => { setStatus('idle'); setErrorMsg(null); }, 4_000);
      return () => clearTimeout(t);
    }

    setStatus('sending');
    try {
      await reportThreat(
        'mobile',
        location.latitude,
        location.longitude,
        (location.speed ?? 0) * 3.6,
        heading ?? 0,
      );
      setStatus('success');
      setTimeout(() => setStatus('idle'), 3_000);
    } catch (err) {
      setStatus('error');
      setErrorMsg(err instanceof Error ? err.message : 'İhbar gönderilemedi');
      setTimeout(() => { setStatus('idle'); setErrorMsg(null); }, 4_000);
    }
  }, [status, location, heading]);

  const icon = (() => {
    const cls = 'w-5 h-5 shrink-0';
    if (status === 'sending') return <Loader   className={`${cls} animate-spin`} style={{ color: TEXT_COLOR.sending }} />;
    if (status === 'success') return <CheckCircle className={cls} style={{ color: TEXT_COLOR.success }} />;
    if (status === 'error')   return <AlertCircle className={cls} style={{ color: TEXT_COLOR.error }} />;
    return <Radio className={cls} style={{ color: TEXT_COLOR.idle }} />;
  })();

  const label = (() => {
    if (status === 'sending') return 'Gönderiliyor…';
    if (status === 'success') return 'İhbar alındı!';
    if (status === 'error')   return errorMsg ?? 'Hata';
    return 'Radar Bildir';
  })();

  return (
    <button
      onClick={handleReport}
      disabled={status === 'sending'}
      aria-label={label}
      style={{
        display:         'flex',
        alignItems:      'center',
        gap:             8,
        padding:         '10px 18px',
        borderRadius:    '1rem',
        background:      BG[status],
        backdropFilter:  'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        border:          `1.5px solid ${BORDER[status]}`,
        boxShadow:       '0 4px 16px rgba(0,0,0,0.30)',
        cursor:          status === 'sending' ? 'not-allowed' : 'pointer',
        transition:      'background 0.25s, border-color 0.25s, opacity 0.2s',
        opacity:         status === 'sending' ? 0.7 : 1,
        userSelect:      'none',
      }}
    >
      {icon}
      <span
        style={{
          fontSize:    13,
          fontWeight:  700,
          color:       TEXT_COLOR[status],
          letterSpacing: '0.03em',
          whiteSpace:  'nowrap',
          transition:  'color 0.25s',
        }}
      >
        {label}
      </span>
    </button>
  );
}
