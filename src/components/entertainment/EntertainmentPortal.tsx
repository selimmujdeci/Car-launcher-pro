import { memo, useState, useCallback, useEffect, useRef } from 'react';
import { Coffee, Tv, Play, Check } from 'lucide-react';
import { openApp } from '../../platform/appLauncher';
import { APP_MAP } from '../../data/apps';
import {
  useBreakReminderState, enableBreakReminder, disableBreakReminder,
  setBreakInterval, dismissBreakAlert, updateBreakReminder,
} from '../../platform/breakReminderService';
import { useOBDState } from '../../platform/obdService';

const CARD = { background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.10)', borderRadius: 24, padding: 20 };
const DARK_BG = 'rgba(10,14,26,0.95)';

/* ── Nefes Egzersizi ─── */
type BreathPhase = 'inhale' | 'hold' | 'exhale' | 'idle';

const BreathingExercise = memo(function BreathingExercise() {
  const [phase, setPhase] = useState<BreathPhase>('idle');
  const [count, setCount] = useState(0);
  const [rounds, setRounds] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const PHASES = {
    inhale: { label: 'Nefes Al',  durationS: 4, color: '#3b82f6' },
    hold:   { label: 'Tut',       durationS: 4, color: '#8b5cf6' },
    exhale: { label: 'Nefes Ver', durationS: 6, color: '#22c55e' },
    idle:   { label: 'Başlat',    durationS: 0, color: '#64748b' },
  } as const;
  const nextPhase: Record<BreathPhase, BreathPhase> = { inhale: 'hold', hold: 'exhale', exhale: 'inhale', idle: 'inhale' };

  const startCycle = useCallback(() => { setPhase('inhale'); setCount(0); }, []);
  const stop = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    setPhase('idle'); setCount(0);
  }, []);

  useEffect(() => {
    if (phase === 'idle') return;
    const cfg = PHASES[phase];
    setCount(cfg.durationS);
    timerRef.current = setInterval(() => {
      setCount(c => {
        if (c <= 1) {
          clearInterval(timerRef.current!);
          const np = nextPhase[phase];
          setPhase(np);
          if (np === 'inhale') setRounds(r => r + 1);
          return 0;
        }
        return c - 1;
      });
    }, 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  const cfg = PHASES[phase];

  return (
    <div style={{ ...CARD, border: '1px solid rgba(52,211,153,0.20)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20 }}>
        <div style={{ width: 4, height: 16, borderRadius: 4, background: '#34d399' }} />
        <span style={{ color: '#d1fae5', fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.2em' }}>Nefes Egzersizi</span>
        {rounds > 0 && <span style={{ background: 'rgba(52,211,153,0.15)', color: '#34d399', fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 9 }}>{rounds} Tur</span>}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20 }}>
        <div style={{
          width: 140, height: 140, borderRadius: '50%',
          border: `6px solid ${cfg.color}40`,
          borderTopColor: cfg.color,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          transition: 'transform 1s, border-color 0.5s',
          transform: phase === 'inhale' ? 'scale(1.15)' : phase === 'exhale' ? 'scale(0.85)' : 'scale(1)',
        }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ color: '#fff', fontSize: 36, fontWeight: 900, lineHeight: 1 }}>{count || '0'}</div>
            <div style={{ color: cfg.color, fontSize: 12, fontWeight: 800, textTransform: 'uppercase' }}>{cfg.label}</div>
          </div>
        </div>

        {phase === 'idle' ? (
          <button onClick={startCycle} style={{ width: '100%', height: 52, borderRadius: 16, background: '#10b981', color: '#fff', fontWeight: 800, fontSize: 14, textTransform: 'uppercase', letterSpacing: '0.1em', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
            <Play size={16} /> BAŞLAT
          </button>
        ) : (
          <button onClick={stop} style={{ width: '100%', height: 52, borderRadius: 16, background: 'rgba(239,68,68,0.15)', color: '#f87171', fontWeight: 800, fontSize: 14, textTransform: 'uppercase', letterSpacing: '0.1em', border: '1px solid rgba(239,68,68,0.30)', cursor: 'pointer' }}>
            DURDUR
          </button>
        )}
      </div>
    </div>
  );
});

/* ── Eğlence Uygulamaları ─── */
const EntApps = memo(function EntApps() {
  const entApps = [
    { id: 'youtube' }, { id: 'spotify' }, { id: 'browser' }, { id: 'camera' },
  ];
  return (
    <div style={{ ...CARD, border: '1px solid rgba(168,85,247,0.20)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
        <div style={{ width: 4, height: 16, borderRadius: 4, background: '#a78bfa' }} />
        <span style={{ color: '#ede9fe', fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.2em' }}>Eğlence</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12 }}>
        {entApps.map(({ id }) => {
          const app = APP_MAP[id];
          if (!app) return null;
          return (
            <button
              key={id}
              onClick={() => openApp(app)}
              style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, padding: '18px 8px', borderRadius: 16, background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.12)', cursor: 'pointer' }}
            >
              <span style={{ fontSize: 28 }}>{app.icon}</span>
              <span style={{ color: '#e2e8f0', fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{app.name}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
});

/* ── Mola Hatırlatıcı ─── */
const BreakReminderManager = memo(function BreakReminderManager() {
  const br = useBreakReminderState();
  const intervals = [60, 90, 120, 150, 180];
  const handleToggle = useCallback(() => { br.enabled ? disableBreakReminder() : enableBreakReminder(); }, [br.enabled]);
  const elapsedMin = Math.round(br.drivingElapsedMin);
  const remainMin = Math.max(0, br.intervalMin - elapsedMin);
  const pct = br.intervalMin > 0 ? Math.min(100, (elapsedMin / br.intervalMin) * 100) : 0;

  return (
    <div style={{ ...CARD, border: '1px solid rgba(251,191,36,0.20)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 4, height: 16, borderRadius: 4, background: '#fbbf24' }} />
          <span style={{ color: '#fef3c7', fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.2em' }}>Mola Hatırlatıcı</span>
        </div>
        <button onClick={handleToggle} style={{ width: 52, height: 28, borderRadius: 14, background: br.enabled ? '#f59e0b' : 'rgba(255,255,255,0.10)', border: 'none', cursor: 'pointer', padding: 3, transition: 'background 0.2s', display: 'flex', alignItems: 'center' }}>
          <span style={{ width: 22, height: 22, borderRadius: '50%', background: '#fff', display: 'block', transform: br.enabled ? 'translateX(24px)' : 'translateX(0)', transition: 'transform 0.2s' }} />
        </button>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {intervals.map(min => (
          <button key={min} onClick={() => setBreakInterval(min)} style={{ flex: 1, height: 40, borderRadius: 12, background: br.intervalMin === min ? '#f59e0b' : 'rgba(255,255,255,0.07)', color: br.intervalMin === min ? '#fff' : '#94a3b8', border: `1px solid ${br.intervalMin === min ? 'transparent' : 'rgba(255,255,255,0.10)'}`, fontSize: 10, fontWeight: 800, textTransform: 'uppercase', cursor: 'pointer' }}>
            {min < 60 ? `${min}D` : `${min / 60}S`}
          </button>
        ))}
      </div>

      {br.enabled && br.drivingStartedAt !== null && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
            <span style={{ color: '#94a3b8', fontSize: 11, fontWeight: 700, textTransform: 'uppercase' }}>Sürüş Süresi</span>
            <span style={{ color: pct > 80 ? '#fbbf24' : '#e2e8f0', fontSize: 11, fontWeight: 800 }}>{elapsedMin} / {br.intervalMin} DK</span>
          </div>
          <div style={{ height: 10, background: 'rgba(255,255,255,0.08)', borderRadius: 5, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${pct}%`, background: pct > 90 ? '#ef4444' : pct > 70 ? '#f59e0b' : '#10b981', borderRadius: 5, transition: 'width 0.5s' }} />
          </div>
          <div style={{ color: '#64748b', fontSize: 10, fontWeight: 600, marginTop: 8 }}>
            {remainMin > 0 ? `${remainMin} dakika sonra mola` : 'Mola zamanı!'}
          </div>
        </div>
      )}
      {br.enabled && br.drivingStartedAt === null && (
        <div style={{ color: '#64748b', fontSize: 11, fontWeight: 600, textAlign: 'center', padding: '8px 0' }}>Araç hareket etmeyi bekliyor…</div>
      )}
    </div>
  );
});

/* ── Mola Overlay ─── */
export const BreakAlertOverlay = memo(function BreakAlertOverlay() {
  const br = useBreakReminderState();
  if (!br.alertVisible) return null;
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 80, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(12px)', padding: '0 24px' }}>
      <div style={{ maxWidth: 420, width: '100%', background: 'rgba(10,14,26,0.97)', border: '1px solid rgba(251,191,36,0.30)', borderRadius: 40, overflow: 'hidden', boxShadow: '0 0 60px rgba(245,158,11,0.20)' }}>
        <div style={{ height: 4, background: 'linear-gradient(90deg,#f59e0b,#f97316,#f59e0b)' }} />
        <div style={{ padding: 40, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 28, textAlign: 'center' }}>
          <div style={{ width: 88, height: 88, borderRadius: '50%', background: 'rgba(251,191,36,0.10)', border: '1px solid rgba(251,191,36,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Coffee size={44} color="#fbbf24" />
          </div>
          <div>
            <div style={{ color: '#fff', fontSize: 26, fontWeight: 900, textTransform: 'uppercase' }}>MOLA ZAMANI!</div>
            <div style={{ color: '#94a3b8', fontSize: 15, marginTop: 12, lineHeight: 1.6 }}>
              <span style={{ color: '#fbbf24', fontWeight: 700 }}>{Math.round(br.drivingElapsedMin)} dakika</span> kesintisiz sürüş yaptın.
            </div>
          </div>
          <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 10 }}>
            <button onClick={dismissBreakAlert} style={{ width: '100%', height: 60, borderRadius: 20, background: '#f59e0b', color: '#fff', fontWeight: 800, fontSize: 15, textTransform: 'uppercase', letterSpacing: '0.1em', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
              <Check size={20} /> ANLADIM, 30 DK SONRA
            </button>
            <button onClick={dismissBreakAlert} style={{ height: 48, borderRadius: 16, background: 'none', color: '#64748b', fontWeight: 600, fontSize: 13, textTransform: 'uppercase', border: 'none', cursor: 'pointer' }}>
              KAPAT
            </button>
          </div>
        </div>
      </div>
    </div>
  );
});

/* ── Ana Portal ─── */
export const EntertainmentPortal = memo(function EntertainmentPortal() {
  const obd = useOBDState();
  useEffect(() => { updateBreakReminder(obd.speed); }, [obd.speed]);
  const isParked = obd.speed === 0;

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: DARK_BG, overflow: 'hidden' }}>
      {/* Başlık */}
      <div style={{ flexShrink: 0, padding: '20px 24px', borderBottom: '1px solid rgba(255,255,255,0.08)', display: 'flex', alignItems: 'center', gap: 16, background: 'rgba(255,255,255,0.03)' }}>
        <div style={{ width: 52, height: 52, borderRadius: 20, background: 'rgba(168,85,247,0.15)', border: '1px solid rgba(168,85,247,0.30)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Tv size={26} color="#a78bfa" />
        </div>
        <div>
          <div style={{ color: '#fff', fontWeight: 900, fontSize: 20, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Eğlence Portalı</div>
          <div style={{ color: '#64748b', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.25em' }}>Park Modu & Sürüş Destek</div>
        </div>
        {isParked && (
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(16,185,129,0.10)', border: '1px solid rgba(16,185,129,0.25)', borderRadius: 16, padding: '6px 16px' }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#10b981' }} />
            <span style={{ color: '#10b981', fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.15em' }}>AKTİF</span>
          </div>
        )}
      </div>

      {/* İçerik */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '20px 20px 88px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        {!isParked && (
          <div style={{ borderRadius: 16, background: 'rgba(251,191,36,0.10)', border: '1px solid rgba(251,191,36,0.30)', padding: '12px 20px', display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#fbbf24', flexShrink: 0 }} />
            <span style={{ color: '#fbbf24', fontSize: 13, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.1em' }}>
              ARAÇ HAREKET EDİYOR — {Math.round(obd.speed)} KM/H
            </span>
          </div>
        )}
        <EntApps />
        <BreakReminderManager />
        <BreathingExercise />
        <div style={{ height: 16 }} />
      </div>
    </div>
  );
});

export default EntertainmentPortal;
