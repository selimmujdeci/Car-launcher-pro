'use client';

import { memo } from 'react';
import type { LiveVehicle } from '@/types/realtime';
import { useCommandTracker } from '@/hooks/useCommandTracker';
import type { CmdPhase, CommandResult } from '@/hooks/useCommandTracker';
import type { CommandType } from '@/lib/commandService';

interface Props { vehicle: LiveVehicle | null }

/* ── Icons ──────────────────────────────────────────────────── */

const SpinIcon = () => (
  <svg className="animate-spin" width="24" height="24" viewBox="0 0 24 24" fill="none">
    <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2"
      strokeDasharray="42" strokeDashoffset="14" opacity="0.35"/>
    <path d="M12 3a9 9 0 019 9" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
  </svg>
);

const QueueIcon = () => (
  <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
    <circle cx="11" cy="11" r="8" stroke="currentColor" strokeWidth="1.8" strokeDasharray="4 2"/>
    <path d="M11 7v4l2.5 2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
  </svg>
);

/* ── Phase label helper ─────────────────────────────────────── */

function phaseLabel(phase: CmdPhase, defaultLabel: string, defaultSub: string) {
  if (phase === 'pending')   return { label: 'Gönderiliyor',   sub: 'Bekle...' };
  if (phase === 'queued')    return { label: defaultLabel,      sub: 'Sıraya alındı' };
  if (phase === 'accepted')  return { label: 'Kabul Edildi',   sub: 'Araç hazır' };
  if (phase === 'executing') return { label: 'Yürütülüyor',    sub: 'Lütfen bekle' };
  if (phase === 'ok')        return { label: defaultLabel,      sub: 'Onaylandı ✓' };
  if (phase === 'err')       return { label: 'Hata',           sub: 'Tekrar dene' };
  return { label: defaultLabel, sub: defaultSub };
}

/* ── Offline banner ─────────────────────────────────────────── */

function OfflineBanner({ plate }: { plate: string }) {
  return (
    <div
      className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl"
      style={{
        background: 'rgba(239,68,68,0.07)',
        border: '1px solid rgba(239,68,68,0.2)',
      }}
    >
      <span className="w-2 h-2 rounded-full bg-red-400 flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-xs font-bold text-red-300/90 leading-tight">Araç bağlantısı kesildi</p>
        <p className="text-[10px] text-red-400/50 mt-0.5 truncate">
          {plate} · Komutlar sıraya alınır (5dk TTL)
        </p>
      </div>
    </div>
  );
}

/* ── Large round button ─────────────────────────────────────── */

const BigBtn = memo(function BigBtn({
  label, sublabel, color, bgColor, borderColor,
  phase, onClick, onRetry, children,
}: {
  label: string; sublabel: string; color: string;
  bgColor: string; borderColor: string;
  phase: CmdPhase; onClick: () => void; onRetry?: () => void;
  children: React.ReactNode;
}) {
  const busy    = ['pending', 'accepted', 'executing'].includes(phase);
  const queued  = phase === 'queued';
  const isErr   = phase === 'err';
  const { label: l, sub } = phaseLabel(phase, label, sublabel);

  const glowOk  = phase === 'ok'   ? `0 0 32px ${color}55, 0 0 12px ${color}30 inset` : '';
  const glowErr = isErr            ? `0 0 20px rgba(239,68,68,0.3)` : '';
  const glow    = glowOk || glowErr || `0 0 16px ${color}18`;

  return (
    <div className="relative flex flex-col gap-1 w-full">
      <button
        onClick={onClick}
        disabled={busy || queued}
        className="flex flex-col items-center justify-center gap-2 w-full aspect-square rounded-3xl transition-all duration-200 select-none active:scale-90 disabled:opacity-70"
        style={{
          background:  isErr ? 'rgba(239,68,68,0.08)' : queued ? 'rgba(251,191,36,0.07)' : bgColor,
          border:      `2px solid ${isErr ? 'rgba(239,68,68,0.35)' : queued ? 'rgba(251,191,36,0.3)' : phase === 'ok' ? color : borderColor}`,
          boxShadow:   glow,
        }}
      >
        <span
          style={{ color: isErr ? '#ef4444' : queued ? '#fbbf24' : color }}
          className="transition-transform duration-150"
        >
          {busy ? <SpinIcon /> : queued ? <QueueIcon /> : children}
        </span>
        <span className="text-[11px] font-black uppercase tracking-[0.3em]"
          style={{ color: isErr ? '#ef4444' : queued ? '#fbbf24' : color }}>
          {l}
        </span>
        <span className="text-[9px] font-medium"
          style={{ color: `${isErr ? '#ef4444' : queued ? '#fbbf24' : color}70` }}>
          {sub}
        </span>
      </button>

      {/* Retry button — sadece err fazında */}
      {isErr && onRetry && (
        <button
          onClick={onRetry}
          className="w-full py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all active:scale-95"
          style={{
            background: 'rgba(239,68,68,0.1)',
            border: '1px solid rgba(239,68,68,0.25)',
            color: '#f87171',
          }}
        >
          ↺ Tekrar Dene
        </button>
      )}
    </div>
  );
});

/* ── Small button ───────────────────────────────────────────── */

const SmallBtn = memo(function SmallBtn({
  label, color, bgColor, borderColor, phase, onClick, onRetry, children,
}: {
  label: string; color: string; bgColor: string; borderColor: string;
  phase: CmdPhase; onClick: () => void; onRetry?: () => void;
  children: React.ReactNode;
}) {
  const busy   = ['pending', 'accepted', 'executing'].includes(phase);
  const queued = phase === 'queued';
  const isErr  = phase === 'err';
  const { label: l } = phaseLabel(phase, label, '');

  return (
    <div className="flex-1 flex flex-col gap-1">
      <button
        onClick={onClick}
        disabled={busy || queued}
        className="flex flex-col items-center justify-center gap-2 w-full py-4 rounded-2xl transition-all duration-200 select-none active:scale-90 disabled:opacity-70 min-h-[72px]"
        style={{
          background:  isErr ? 'rgba(239,68,68,0.07)' : queued ? 'rgba(251,191,36,0.07)' : bgColor,
          border:      `1.5px solid ${isErr ? 'rgba(239,68,68,0.3)' : queued ? 'rgba(251,191,36,0.3)' : phase === 'ok' ? color : borderColor}`,
          boxShadow:   phase === 'ok' ? `0 0 18px ${color}40` : 'none',
        }}
      >
        <span style={{ color: isErr ? '#ef4444' : queued ? '#fbbf24' : color }}
          className={busy ? 'animate-pulse' : ''}>
          {busy ? <SpinIcon /> : queued ? <QueueIcon /> : children}
        </span>
        <span className="text-[9px] font-black uppercase tracking-widest"
          style={{ color: isErr ? '#ef4444' : queued ? '#fbbf24' : color }}>
          {l}
        </span>
      </button>

      {isErr && onRetry && (
        <button
          onClick={onRetry}
          className="w-full py-1 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all active:scale-95"
          style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', color: '#f87171' }}
        >
          ↺ Tekrar
        </button>
      )}
    </div>
  );
});

/* ── Command Toast ──────────────────────────────────────────── */

function CommandToast({ result }: { result: CommandResult }) {
  if (result.queued) {
    return (
      <div
        className="flex items-center gap-3.5 px-4 py-3.5 rounded-2xl"
        style={{
          background:    'linear-gradient(135deg, rgba(251,191,36,0.1), rgba(245,158,11,0.06))',
          border:        '1px solid rgba(251,191,36,0.3)',
          backdropFilter:'blur(16px)',
          boxShadow:     '0 4px 24px rgba(251,191,36,0.12)',
          animation:     'slideUp 0.25s cubic-bezier(0.34,1.56,0.64,1)',
        }}
      >
        <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ background: 'rgba(251,191,36,0.15)', border: '1px solid rgba(251,191,36,0.25)' }}>
          <QueueIcon />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-yellow-300 leading-tight truncate">Sıraya Alındı</p>
          <p className="text-[10px] mt-0.5 text-yellow-400/55">
            Araç çevrimiçi olduğunda otomatik çalışacak (5dk TTL)
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      className="flex items-center gap-3.5 px-4 py-3.5 rounded-2xl"
      style={{
        background:    result.ok
          ? 'linear-gradient(135deg, rgba(52,211,153,0.1), rgba(16,185,129,0.06))'
          : 'linear-gradient(135deg, rgba(239,68,68,0.1), rgba(220,38,38,0.06))',
        border:        `1px solid ${result.ok ? 'rgba(52,211,153,0.3)' : 'rgba(239,68,68,0.3)'}`,
        backdropFilter:'blur(16px)',
        boxShadow:     result.ok
          ? '0 4px 24px rgba(52,211,153,0.15), 0 0 0 1px rgba(52,211,153,0.08) inset'
          : '0 4px 24px rgba(239,68,68,0.15), 0 0 0 1px rgba(239,68,68,0.08) inset',
        animation:     'slideUp 0.25s cubic-bezier(0.34,1.56,0.64,1)',
      }}
    >
      {result.ok ? (
        <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ background: 'rgba(52,211,153,0.15)', border: '1px solid rgba(52,211,153,0.25)' }}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M3 8l3.5 3.5L13 5" stroke="#34d399" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>
      ) : (
        <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.25)' }}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <circle cx="8" cy="8" r="6" stroke="#ef4444" strokeWidth="1.5"/>
            <path d="M6 6l4 4M10 6l-4 4" stroke="#ef4444" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
        </div>
      )}

      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold leading-tight truncate"
          style={{ color: result.ok ? '#34d399' : '#f87171' }}>
          {result.label}
        </p>
        <p className="text-[10px] mt-0.5"
          style={{ color: result.ok ? 'rgba(52,211,153,0.55)' : 'rgba(248,113,113,0.5)' }}>
          {result.ok ? 'Araçta onaylandı' : 'Araç yanıt vermedi'}
        </p>
      </div>

      {result.ok && result.durationMs > 0 && (
        <div
          className="flex-shrink-0 px-2 py-1 rounded-lg text-[9px] font-mono font-bold"
          style={{ background: 'rgba(52,211,153,0.12)', color: 'rgba(52,211,153,0.7)', border: '1px solid rgba(52,211,153,0.2)' }}
        >
          {result.durationMs < 1000
            ? `${result.durationMs}ms'de tamamlandı`
            : `${(result.durationMs / 1000).toFixed(1)}s'de tamamlandı`}
        </div>
      )}
    </div>
  );
}

/* ── Main component ─────────────────────────────────────────── */

export default function MobileCarControl({ vehicle }: Props) {
  const { phases, result, dispatch, retry } = useCommandTracker(vehicle?.id ?? null);

  if (!vehicle) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
        <div className="w-16 h-16 rounded-3xl bg-white/[0.03] border border-white/[0.07] flex items-center justify-center">
          <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
            <path d="M4 18L8 10Q9.5 7 12 7H16Q18.5 7 20 10L24 18V22Q24 24 22 24H6Q4 24 4 22Z"
              stroke="rgba(255,255,255,0.2)" strokeWidth="1.8" strokeLinejoin="round"/>
          </svg>
        </div>
        <p className="text-sm text-white/30">Araç seçilmedi</p>
      </div>
    );
  }

  const isOnline = vehicle.status !== 'offline';

  return (
    <div className="flex flex-col gap-4 px-1">

      {/* Vehicle identity */}
      <div
        className="flex items-center gap-3 px-4 py-3 rounded-2xl"
        style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}
      >
        <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${
          vehicle.status === 'online' ? 'bg-emerald-400 neon-online' :
          vehicle.status === 'alarm'  ? 'bg-red-400 neon-alarm animate-pulse' : 'bg-white/20'
        }`} />
        <div className="flex-1 min-w-0">
          <p className="font-mono font-bold text-white text-sm">{vehicle.plate}</p>
          <p className="text-[10px] text-white/35 truncate">{vehicle.name} · {vehicle.driver}</p>
        </div>
        <span
          className="text-[9px] font-black uppercase tracking-widest px-2.5 py-1 rounded-lg"
          style={{
            color:      isOnline ? '#34d399' : '#ffffff40',
            background: isOnline ? 'rgba(52,211,153,0.1)' : 'rgba(255,255,255,0.04)',
            border:     `1px solid ${isOnline ? 'rgba(52,211,153,0.25)' : 'rgba(255,255,255,0.08)'}`,
          }}
        >
          {vehicle.status === 'online' ? 'Online' : vehicle.status === 'alarm' ? 'Alarm' : 'Offline'}
        </span>
      </div>

      {/* Offline banner */}
      {!isOnline && <OfflineBanner plate={vehicle.plate} />}

      {/* Lock / Unlock */}
      <div className="grid grid-cols-2 gap-4">
        <BigBtn
          label="Kilitle" sublabel="Kapat"
          color="#ef4444" bgColor="rgba(239,68,68,0.07)" borderColor="rgba(239,68,68,0.25)"
          phase={phases.lock ?? 'idle'}
          onClick={() => void dispatch('lock')}
          onRetry={() => void retry('lock')}
        >
          <svg width="36" height="36" viewBox="0 0 36 36" fill="none">
            <rect x="7" y="17" width="22" height="16" rx="4" stroke="currentColor" strokeWidth="2.5"/>
            <path d="M12 17V13a6 6 0 0112 0v4" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/>
            <circle cx="18" cy="25" r="2.5" fill="currentColor"/>
          </svg>
        </BigBtn>

        <BigBtn
          label="Aç" sublabel="Kilidi Kaldır"
          color="#34d399" bgColor="rgba(52,211,153,0.07)" borderColor="rgba(52,211,153,0.25)"
          phase={phases.unlock ?? 'idle'}
          onClick={() => void dispatch('unlock')}
          onRetry={() => void retry('unlock')}
        >
          <svg width="36" height="36" viewBox="0 0 36 36" fill="none">
            <rect x="7" y="17" width="22" height="16" rx="4" stroke="currentColor" strokeWidth="2.5"/>
            <path d="M12 17V13a6 6 0 0112 0" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeDasharray="3 2"/>
          </svg>
        </BigBtn>
      </div>

      {/* Horn + Alarm */}
      <div className="flex gap-3">
        <SmallBtn
          label="Korna" color="#fbbf24"
          bgColor="rgba(251,191,36,0.07)" borderColor="rgba(251,191,36,0.22)"
          phase={phases.horn ?? 'idle'}
          onClick={() => void dispatch('horn')}
          onRetry={() => void retry('horn')}
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
            <path d="M6 9H4a1 1 0 000 2h2m0-2v2m0-2l6-4.5v12L6 13"
              stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M15 7.5a6 6 0 010 9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
            <path d="M17.5 5a9.5 9.5 0 010 14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" opacity="0.5"/>
          </svg>
        </SmallBtn>

        <SmallBtn
          label="Alarm" color="#a78bfa"
          bgColor="rgba(167,139,250,0.07)" borderColor="rgba(167,139,250,0.22)"
          phase={phases.alarm_on ?? 'idle'}
          onClick={() => void dispatch('alarm_on')}
          onRetry={() => void retry('alarm_on')}
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
            <path d="M12 3L21 19H3L12 3Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"/>
            <path d="M12 10v4M12 16.5v.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
          </svg>
        </SmallBtn>
      </div>

      {/* Command toast */}
      {result && <CommandToast result={result} />}

      {/* Telemetry strip */}
      <div className="grid grid-cols-3 gap-2">
        {[
          { label: 'Hız',   value: Math.round(vehicle.speed),      unit: 'km/h', color: vehicle.speed > 90 ? '#ef4444' : vehicle.speed > 60 ? '#fbbf24' : '#34d399' },
          { label: 'Yakıt', value: Math.round(vehicle.fuel),       unit: '%',    color: vehicle.fuel < 15 ? '#ef4444' : vehicle.fuel < 30 ? '#fbbf24' : '#60a5fa' },
          { label: 'Motor', value: Math.round(vehicle.engineTemp), unit: '°C',   color: vehicle.engineTemp > 100 ? '#ef4444' : vehicle.engineTemp > 85 ? '#fbbf24' : '#34d399' },
        ].map(({ label, value, unit, color }) => (
          <div
            key={label}
            className="flex flex-col items-center py-3 rounded-xl"
            style={{ background: `${color}09`, border: `1px solid ${color}20` }}
          >
            <span className="text-[8px] font-black uppercase tracking-widest text-white/30 mb-1">{label}</span>
            <span className="text-lg font-black tabular-nums leading-none" style={{ color }}>{value}</span>
            <span className="text-[9px] font-mono mt-0.5" style={{ color: `${color}60` }}>{unit}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
