/**
 * Entertainment Portal — Park Modu Eğlence + Mola Hatırlatıcı.
 *
 * Park modu: OBD hızı = 0 ve belirli bir süre (10 sn) beklendikten sonra açılır.
 * İçerik: uygulama hızlı erişim, mola hatırlatıcı yönetimi, rahatlama araçları.
 */

import { memo, useState, useCallback, useEffect, useRef } from 'react';
import { Coffee, Tv, Play, Check, Leaf } from 'lucide-react';
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
    <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-5 flex flex-col items-center gap-4">
      <div className="flex items-center gap-2">
        <Leaf className="w-4 h-4 text-emerald-400" />
        <span className="text-slate-500 text-[10px] uppercase tracking-widest">Nefes Egzersizi</span>
        {rounds > 0 && <span className="text-slate-600 text-xs">{rounds} tur</span>}
      </div>

      {/* Animasyon çemberi */}
      <div className="relative flex items-center justify-center">
        <div
          className="w-28 h-28 rounded-full border-4 flex items-center justify-center transition-all duration-1000"
          style={{
            borderColor: cfg.color,
            boxShadow: phase !== 'idle' ? `0 0 24px ${cfg.color}40, inset 0 0 24px ${cfg.color}10` : 'none',
            transform: phase === 'inhale' ? 'scale(1.12)' : phase === 'exhale' ? 'scale(0.88)' : 'scale(1)',
          }}
        >
          <div className="text-center">
            <div className="text-white text-3xl font-black tabular-nums">{count || ''}</div>
            <div className="text-[11px] font-bold" style={{ color: cfg.color }}>{cfg.label}</div>
          </div>
        </div>
      </div>

      <div className="flex gap-3">
        {phase === 'idle' ? (
          <button
            onClick={startCycle}
            className="px-6 py-2.5 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 text-sm font-bold active:scale-95 transition-all flex items-center gap-2"
          >
            <Play className="w-3.5 h-3.5 fill-current" />
            Başlat
          </button>
        ) : (
          <button
            onClick={stop}
            className="px-6 py-2.5 rounded-xl bg-white/5 border border-white/10 text-slate-400 text-sm font-bold active:scale-95 transition-all"
          >
            Durdur
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
    <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-4">
      <div className="flex items-center gap-2 mb-3">
        <Tv className="w-4 h-4 text-purple-400" />
        <span className="text-slate-500 text-[10px] uppercase tracking-widest">Park Modu İçerik</span>
      </div>
      <div className="grid grid-cols-4 gap-2">
        {entApps.map((a) => {
          const appItem = APP_MAP[a.id];
          if (!appItem) return null;
          return (
            <button
              key={a.id}
              onClick={() => openApp(appItem)}
              className="flex flex-col items-center gap-2 py-3 rounded-xl bg-white/5 border border-white/5 active:scale-90 transition-transform hover:bg-white/10"
            >
              <span className="text-2xl">{appItem.icon}</span>
              <span className="text-slate-400 text-[10px] font-bold truncate w-full text-center">{appItem.name}</span>
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
    <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-4">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Coffee className="w-4 h-4 text-amber-400" />
          <span className="text-white/70 text-sm font-bold">Mola Hatırlatıcı</span>
        </div>
        <button
          onClick={handleToggle}
          className={`relative w-12 h-6 rounded-full transition-all ${br.enabled ? 'bg-amber-500' : 'bg-white/10'}`}
        >
          <span className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow-md transition-all ${br.enabled ? 'left-7' : 'left-1'}`} />
        </button>
      </div>

      {/* Süre seçimi */}
      <div className="flex gap-1.5 mb-4">
        {intervals.map((min) => (
          <button
            key={min}
            onClick={() => setBreakInterval(min)}
            className={`
              flex-1 h-8 rounded-xl text-xs font-bold transition-all active:scale-95
              ${br.intervalMin === min
                ? 'bg-amber-500/20 border border-amber-500/40 text-amber-400'
                : 'bg-white/5 border border-white/5 text-slate-600 hover:text-white hover:bg-white/10'}
            `}
          >
            {min < 60 ? `${min}d` : `${min / 60}s`}
          </button>
        ))}
      </div>

      {/* İlerleme */}
      {br.enabled && br.drivingStartedAt !== null && (
        <div>
          <div className="flex justify-between text-xs mb-1.5">
            <span className="text-slate-500">Sürüş süresi</span>
            <span className={`font-bold ${pct > 80 ? 'text-amber-400' : 'text-slate-300'}`}>
              {elapsedMin} / {br.intervalMin} dk
            </span>
          </div>
          <div className="w-full h-2 bg-white/10 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${pct > 90 ? 'bg-red-500' : pct > 70 ? 'bg-amber-500' : 'bg-emerald-500'}`}
              style={{ width: `${pct}%` }}
            />
          </div>
          <div className="text-slate-600 text-[10px] mt-1.5">
            {remainMin > 0 ? `${remainMin} dakika sonra mola hatırlatması` : 'Mola zamanı geldi!'}
          </div>
        </div>
      )}

      {br.enabled && br.drivingStartedAt === null && (
        <div className="text-slate-700 text-xs text-center py-2">Araç hareket etmeyi bekliyor…</div>
      )}
    </div>
  );
});

/* ── Mola Uyarısı Overlay ────────────────────────────────── */

export const BreakAlertOverlay = memo(function BreakAlertOverlay() {
  const br = useBreakReminderState();
  if (!br.alertVisible) return null;

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in">
      <div className="mx-4 max-w-sm w-full bg-[#0d1628] border border-amber-500/30 rounded-3xl shadow-2xl overflow-hidden">
        <div className="h-1 bg-gradient-to-r from-amber-500 to-orange-500" />
        <div className="p-8 flex flex-col items-center gap-5 text-center">
          <div className="w-20 h-20 rounded-full bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
            <Coffee className="w-10 h-10 text-amber-400" />
          </div>
          <div>
            <div className="text-white text-2xl font-bold">Mola Zamanı!</div>
            <div className="text-slate-400 text-sm mt-2 leading-relaxed">
              {Math.round(br.drivingElapsedMin)} dakika kesintisiz sürüş yaptın.<br />
              Bir kahve molasına ne dersin?
            </div>
          </div>
          <button
            onClick={dismissBreakAlert}
            className="w-full h-14 rounded-2xl bg-amber-500/15 border border-amber-500/30 text-amber-400 font-bold text-base active:scale-95 transition-all flex items-center justify-center gap-2"
          >
            <Check className="w-5 h-5" />
            Anladım, 30 dk sonra hatırlat
          </button>
          <button
            onClick={dismissBreakAlert}
            className="text-slate-600 text-sm hover:text-white transition-colors"
          >
            Kapat
          </button>
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
    <div className="h-full flex flex-col bg-[#060d1a] text-white overflow-hidden">
      {/* Başlık */}
      <div className="flex-shrink-0 px-6 py-5 border-b border-white/5">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center">
            <Tv className="w-5 h-5 text-purple-400" />
          </div>
          <div>
            <div className="text-white font-bold text-lg tracking-tight">Eğlence Portalı</div>
            <div className="text-slate-500 text-xs">Park Modu & Mola Araçları</div>
          </div>
          {isParked && (
            <div className="ml-auto flex items-center gap-1.5 bg-emerald-500/10 border border-emerald-500/20 rounded-xl px-3 py-1">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-emerald-400 text-[10px] font-bold">Park</span>
            </div>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
        {/* Park modunda içerik */}
        {isParked ? (
          <EntApps />
        ) : (
          <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-6 text-center">
            <div className="text-slate-600 text-sm">
              İçerik kilidini açmak için aracı park edin
            </div>
            <div className="text-slate-700 text-xs mt-1">
              Hız: {Math.round(obd.speed)} km/h
            </div>
          </div>
        )}

        {/* Mola Hatırlatıcı */}
        <BreakReminderManager />

        {/* Nefes egzersizi (her zaman erişilebilir) */}
        <BreathingExercise />
      </div>
    </div>
  );
});

export default EntertainmentPortal;
