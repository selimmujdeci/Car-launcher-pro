/**
 * Entertainment Portal — Park Modu Eğlence + Mola Hatırlatıcı.
 *
 * Park modu: OBD hızı = 0 ve belirli bir süre (10 sn) beklendikten sonra açılır.
 * İçerik: uygulama hızlı erişim, mola hatırlatıcı yönetimi, rahatlama araçları.
 */

import { memo, useState, useCallback, useEffect, useRef } from 'react';
import { Coffee, Tv, Play, Check } from 'lucide-react';
import { openApp } from '../../platform/appLauncher';
import { APP_MAP } from '../../data/apps';
import {
  useBreakReminderState,
  enableBreakReminder,
  disableBreakReminder,
  setBreakInterval,
  dismissBreakAlert,
  updateBreakReminder,
} from '../../platform/breakReminderService';
import { useOBDState } from '../../platform/obdService';

/* ── Basit Nefes Egzersizi ───────────────────────────────── */

type BreathPhase = 'inhale' | 'hold' | 'exhale' | 'idle';

const BreathingExercise = memo(function BreathingExercise() {
  const [phase, setPhase]   = useState<BreathPhase>('idle');
  const [count, setCount]   = useState(0);
  const [rounds, setRounds] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const PHASES: Record<BreathPhase, { label: string; durationS: number; color: string }> = {
    inhale: { label: 'Nefes Al',  durationS: 4, color: '#3b82f6' },
    hold:   { label: 'Tut',       durationS: 4, color: '#8b5cf6' },
    exhale: { label: 'Nefes Ver', durationS: 6, color: '#22c55e' },
    idle:   { label: 'Başlat',    durationS: 0, color: '#64748b' },
  };

  const nextPhase: Record<BreathPhase, BreathPhase> = {
    inhale: 'hold',
    hold:   'exhale',
    exhale: 'inhale',
    idle:   'inhale',
  };

  const startCycle = useCallback(() => {
    setPhase('inhale');
    setCount(0);
  }, []);

  const stop = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    setPhase('idle');
    setCount(0);
  }, []);

  useEffect(() => {
    if (phase === 'idle') return;
    const cfg = PHASES[phase];
    setCount(cfg.durationS);

    timerRef.current = setInterval(() => {
      setCount((c) => {
        if (c <= 1) {
          clearInterval(timerRef.current!);
          const np = nextPhase[phase];
          setPhase(np);
          if (np === 'inhale') setRounds((r) => r + 1);
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
    <div className="rounded-3xl border border-emerald-500/15 bg-[#0d1628] backdrop-blur-xl p-6 flex flex-col items-center gap-6 shadow-2xl relative overflow-hidden group">
      <div className="absolute inset-0 bg-gradient-to-b from-emerald-500/6 to-transparent opacity-80" />
      
      <div className="flex items-center gap-2 z-10">
        <div className="w-1.5 h-4 rounded-full bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.6)]" />
        <span className="text-slate-300 text-[11px] font-black uppercase tracking-[0.2em]">Nefes Egzersizi</span>
        {rounds > 0 && (
          <span className="bg-emerald-500/20 text-emerald-400 text-[10px] font-bold px-2 py-0.5 rounded-full border border-emerald-500/20">
            {rounds} Tur
          </span>
        )}
      </div>

      {/* Animasyon çemberi */}
      <div className="relative flex items-center justify-center z-10">
        <div
          className="w-36 h-36 rounded-full border-[6px] flex items-center justify-center transition-all duration-1000 shadow-[0_0_40px_rgba(0,0,0,0.3)]"
          style={{
            borderColor: `${cfg.color}30`,
            borderTopColor: cfg.color,
            boxShadow: phase !== 'idle' ? `0 0 30px ${cfg.color}20, inset 0 0 30px ${cfg.color}10` : 'none',
            transform: phase === 'inhale' ? 'scale(1.15)' : phase === 'exhale' ? 'scale(0.85)' : 'scale(1)',
          }}
        >
          <div className="text-center">
            <div className="text-white text-4xl font-black tabular-nums drop-shadow-lg">{count || '0'}</div>
            <div className="text-[12px] font-black uppercase tracking-wider" style={{ color: cfg.color }}>{cfg.label}</div>
          </div>
        </div>
        
        {/* Dekoratif halkalar */}
        <div className="absolute inset-[-12px] border border-white/5 rounded-full animate-pulse" />
        {phase !== 'idle' && (
           <div 
             className="absolute inset-0 rounded-full animate-ping opacity-20" 
             style={{ backgroundColor: cfg.color }}
           />
        )}
      </div>

      <div className="flex gap-4 z-10 w-full">
        {phase === 'idle' ? (
          <button
            onClick={startCycle}
            className="flex-1 h-14 rounded-2xl bg-emerald-500 text-white font-black text-sm uppercase tracking-widest shadow-lg shadow-emerald-500/20 active:scale-95 transition-all flex items-center justify-center gap-3"
          >
            <Play className="w-4 h-4 fill-current" />
            BAŞLAT
          </button>
        ) : (
          <button
            onClick={stop}
            className="flex-1 h-14 rounded-2xl bg-white/10 border border-white/10 text-white font-black text-sm uppercase tracking-widest hover:bg-red-500/20 hover:text-red-400 hover:border-red-500/30 active:scale-95 transition-all"
          >
            DURDUR
          </button>
        )}
      </div>
    </div>
  );
});

/* ── Hızlı Uygulama Erişimi ──────────────────────────────── */

const EntApps = memo(function EntApps() {
  const entApps = [
    { id: 'youtube',  label: 'YouTube',  icon: '▶️' },
    { id: 'spotify',  label: 'Spotify',  icon: '🎵' },
    { id: 'browser',  label: 'Tarayıcı', icon: '🌐' },
    { id: 'camera',   label: 'Kamera',   icon: '📷' },
  ];

  return (
    <div className="rounded-3xl border border-purple-500/15 bg-[#0d1628] backdrop-blur-xl p-5 shadow-xl relative overflow-hidden group">
      <div className="absolute inset-0 bg-gradient-to-br from-purple-500/8 to-transparent" />
      <div className="flex items-center gap-2 mb-5 relative z-10">
        <div className="w-1.5 h-4 rounded-full bg-purple-400 shadow-[0_0_10px_rgba(192,132,252,0.6)]" />
        <span className="text-slate-200 text-[11px] font-black uppercase tracking-[0.2em]">Eğlence</span>
      </div>
      <div className="grid grid-cols-4 gap-3 relative z-10">
        {entApps.map((a) => {
          const appItem = APP_MAP[a.id];
          if (!appItem) return null;
          return (
            <button
              key={a.id}
              onClick={() => openApp(appItem)}
              className="group flex flex-col items-center gap-3 py-5 rounded-2xl bg-white/[0.08] border border-white/[0.1] active:scale-90 transition-all hover:bg-purple-500/15 hover:border-purple-400/30 shadow-lg"
            >
              <span className="text-3xl filter drop-shadow-md group-hover:scale-110 transition-transform">{appItem.icon}</span>
              <span className="text-slate-200 text-[10px] font-black uppercase tracking-wider truncate w-full text-center px-1">{appItem.name}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
});

/* ── Mola Hatırlatıcı Yönetimi ───────────────────────────── */

const BreakReminderManager = memo(function BreakReminderManager() {
  const br = useBreakReminderState();

  const intervals = [60, 90, 120, 150, 180];

  const handleToggle = useCallback(() => {
    if (br.enabled) disableBreakReminder();
    else enableBreakReminder();
  }, [br.enabled]);

  const elapsedMin = Math.round(br.drivingElapsedMin);
  const remainMin  = Math.max(0, br.intervalMin - elapsedMin);
  const pct        = br.intervalMin > 0 ? Math.min(100, (elapsedMin / br.intervalMin) * 100) : 0;

  return (
    <div className="rounded-3xl border border-amber-500/15 bg-[#0d1628] backdrop-blur-xl p-5 shadow-xl relative overflow-hidden group">
      <div className="absolute inset-0 bg-gradient-to-br from-amber-500/6 to-transparent" />

      <div className="flex items-center justify-between mb-6 relative z-10">
        <div className="flex items-center gap-2">
          <div className="w-1.5 h-4 rounded-full bg-amber-400 shadow-[0_0_10px_rgba(251,191,36,0.6)]" />
          <span className="text-slate-300 text-[11px] font-black uppercase tracking-[0.2em]">Mola Hatırlatıcı</span>
        </div>
        <button
          onClick={handleToggle}
          className={`relative w-14 h-7 rounded-full transition-all p-1 shadow-inner ${br.enabled ? 'bg-amber-500 shadow-amber-500/20' : 'bg-white/10'}`}
        >
          <span className={`block w-5 h-5 rounded-full bg-white shadow-lg transition-all transform ${br.enabled ? 'translate-x-7' : 'translate-x-0'}`} />
        </button>
      </div>

      {/* Süre seçimi */}
      <div className="flex gap-2 mb-6 relative z-10">
        {intervals.map((min) => (
          <button
            key={min}
            onClick={() => setBreakInterval(min)}
            className={`
              flex-1 h-10 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all active:scale-95 shadow-md
              ${br.intervalMin === min
                ? 'bg-amber-500 text-white border-transparent'
                : 'bg-white/5 border border-white/5 text-slate-400 hover:text-white hover:bg-white/10'}
            `}
          >
            {min < 60 ? `${min}D` : `${min / 60}S`}
          </button>
        ))}
      </div>

      {/* İlerleme */}
      {br.enabled && br.drivingStartedAt !== null && (
        <div className="relative z-10">
          <div className="flex justify-between text-[11px] font-black uppercase tracking-wider mb-2">
            <span className="text-slate-400">Sürüş Süresi</span>
            <span className={pct > 80 ? 'text-amber-400' : 'text-slate-200'}>
              {elapsedMin} / {br.intervalMin} DK
            </span>
          </div>
          <div className="w-full h-3 bg-black/40 rounded-full overflow-hidden p-0.5 border border-white/5">
            <div
              className={`h-full rounded-full transition-all shadow-[0_0_10px_rgba(0,0,0,0.5)] ${pct > 90 ? 'bg-red-500' : pct > 70 ? 'bg-amber-500' : 'bg-emerald-500'}`}
              style={{ width: `${pct}%` }}
            />
          </div>
          <div className="text-slate-500 text-[10px] font-bold mt-2.5 flex items-center gap-2">
            <div className={`w-1.5 h-1.5 rounded-full ${pct > 90 ? 'bg-red-500 animate-pulse' : 'bg-slate-600'}`} />
            {remainMin > 0 ? `${remainMin} dakika sonra mola hatırlatması` : 'Mola zamanı geldi!'}
          </div>
        </div>
      )}

      {br.enabled && br.drivingStartedAt === null && (
        <div className="text-slate-500 text-[11px] font-bold text-center py-2 bg-black/20 rounded-xl border border-white/5">
          ARAÇ HAREKET ETMEYİ BEKLİYOR…
        </div>
      )}
    </div>
  );
});

/* ── Mola Uyarısı Overlay ────────────────────────────────── */

export const BreakAlertOverlay = memo(function BreakAlertOverlay() {
  const br = useBreakReminderState();
  if (!br.alertVisible) return null;

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/80 backdrop-blur-md animate-fade-in px-6">
      <div className="max-w-md w-full bg-[#0d1628] border border-amber-500/30 rounded-[2.5rem] shadow-[0_0_50px_rgba(245,158,11,0.2)] overflow-hidden">
        <div className="h-2 bg-gradient-to-r from-amber-500 via-orange-500 to-amber-500" />
        <div className="p-10 flex flex-col items-center gap-8 text-center">
          <div className="w-24 h-24 rounded-full bg-amber-500/10 border border-amber-500/20 flex items-center justify-center relative">
            <div className="absolute inset-0 rounded-full animate-ping bg-amber-500/10" />
            <Coffee className="w-12 h-12 text-amber-400 z-10" />
          </div>
          <div>
            <div className="text-white text-3xl font-black uppercase tracking-tight">MOLA ZAMANI!</div>
            <div className="text-slate-400 text-base mt-4 leading-relaxed font-medium">
              <span className="text-amber-400 font-bold">{Math.round(br.drivingElapsedMin)} dakika</span> kesintisiz sürüş yaptın.<br />
              Güvenliğin için bir kahve molasına ne dersin?
            </div>
          </div>
          <div className="w-full flex flex-col gap-3">
            <button
              onClick={dismissBreakAlert}
              className="w-full h-16 rounded-[1.25rem] bg-amber-500 text-white font-black text-base uppercase tracking-widest shadow-xl shadow-amber-500/30 active:scale-95 transition-all flex items-center justify-center gap-3"
            >
              <Check className="w-6 h-6" />
              ANLADIM, 30 DK SONRA
            </button>
            <button
              onClick={dismissBreakAlert}
              className="h-14 rounded-[1.25rem] text-slate-500 font-bold text-sm uppercase tracking-widest hover:text-white transition-colors"
            >
              KAPAT
            </button>
          </div>
        </div>
      </div>
    </div>
  );
});

/* ── Ana Portal ──────────────────────────────────────────── */

export const EntertainmentPortal = memo(function EntertainmentPortal() {
  const obd = useOBDState();

  // Sürüşü takip et
  useEffect(() => {
    updateBreakReminder(obd.speed);
  }, [obd.speed]);

  const isParked = obd.speed === 0;

  return (
    <div className="h-full flex flex-col bg-[#060d1a] text-white overflow-hidden relative" data-editable="entertainment" data-editable-type="card">
      <div className="absolute inset-0 bg-gradient-to-b from-blue-500/[0.02] to-transparent pointer-events-none" />
      
      {/* Başlık */}
      <div className="flex-shrink-0 px-8 py-7 border-b border-white/5 relative z-10 backdrop-blur-md bg-black/10">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-[1.25rem] bg-purple-500/15 border border-purple-500/30 flex items-center justify-center shadow-lg shadow-purple-500/10">
            <Tv className="w-6 h-6 text-purple-400" />
          </div>
          <div>
            <div className="text-white font-black text-xl tracking-tight uppercase">Eğlence Portalı</div>
            <div className="text-slate-400 text-[10px] font-bold uppercase tracking-[0.25em]">Park Modu & Sürüş Destek</div>
          </div>
          {isParked && (
            <div className="ml-auto flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/20 rounded-2xl px-4 py-1.5 shadow-inner">
              <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-emerald-400 text-[10px] font-black uppercase tracking-widest">PARK</span>
            </div>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6 flex flex-col gap-6 relative z-10 custom-scrollbar">
        {/* Sürüş uyarısı */}
        {!isParked && (
          <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 px-6 py-4 flex items-center gap-4 animate-pulse">
            <div className="w-3 h-3 rounded-full bg-amber-400 flex-shrink-0 shadow-[0_0_10px_rgba(251,191,36,0.8)]" />
            <span className="text-amber-400 text-sm font-black uppercase tracking-wider">ARAÇ HAREKET EDİYOR — {Math.round(obd.speed)} KM/H</span>
          </div>
        )}

        <EntApps />
        <BreakReminderManager />
        <BreathingExercise />
        
        {/* Alt boşluk */}
        <div className="h-4 flex-shrink-0" />
      </div>
    </div>
  );
});

export default EntertainmentPortal;
