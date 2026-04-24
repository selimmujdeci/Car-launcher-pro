'use client';

import { memo, useCallback, useState } from 'react';
import type { LiveVehicle } from '@/types/realtime';
import { supabaseBrowser } from '@/lib/supabase';

type CommandType = 'lock' | 'unlock' | 'honk' | 'alarm';
type CmdState    = 'idle' | 'pending' | 'ok' | 'err';

interface Props { vehicle: LiveVehicle | null }

async function sendCmd(vehicleId: string, type: CommandType): Promise<boolean> {
  if (!supabaseBrowser) {
    await new Promise((r) => setTimeout(r, 600));
    return true;
  }
  const { error } = await supabaseBrowser
    .from('vehicle_commands')
    .insert({ vehicle_id: vehicleId, type, payload: {}, status: 'pending' });
  return !error;
}

function haptic(ms = 50) {
  if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(ms);
}

/* ── Büyük yuvarlak buton ─── */
const BigBtn = memo(function BigBtn({
  label, sublabel, color, bgColor, borderColor, state, onClick,
  children,
}: {
  label: string; sublabel: string; color: string; bgColor: string; borderColor: string;
  state: CmdState; onClick: () => void; children: React.ReactNode;
}) {
  const isActive = state === 'pending';
  return (
    <button
      onClick={onClick}
      disabled={isActive}
      className="flex flex-col items-center justify-center gap-2 w-full aspect-square rounded-3xl transition-all duration-150 select-none active:scale-90 disabled:opacity-60"
      style={{
        background: bgColor,
        border: `2px solid ${borderColor}`,
        boxShadow: state === 'ok'
          ? `0 0 32px ${color}50, 0 0 12px ${color}30 inset`
          : `0 0 16px ${color}20`,
      }}
    >
      <span style={{ color }} className={`transition-transform ${isActive ? 'animate-pulse' : ''}`}>
        {children}
      </span>
      <span className="text-[11px] font-black uppercase tracking-[0.3em]" style={{ color }}>
        {label}
      </span>
      <span className="text-[9px] font-medium" style={{ color: `${color}70` }}>
        {sublabel}
      </span>
    </button>
  );
});

/* ── Küçük buton ─── */
const SmallBtn = memo(function SmallBtn({
  label, color, bgColor, borderColor, state, onClick, children,
}: {
  label: string; color: string; bgColor: string; borderColor: string;
  state: CmdState; onClick: () => void; children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={state === 'pending'}
      className="flex flex-col items-center justify-center gap-2 flex-1 py-4 rounded-2xl transition-all duration-150 select-none active:scale-90 disabled:opacity-60"
      style={{
        background: bgColor,
        border: `1.5px solid ${borderColor}`,
        boxShadow: state === 'ok' ? `0 0 18px ${color}40` : 'none',
      }}
    >
      <span style={{ color }} className={state === 'pending' ? 'animate-pulse' : ''}>{children}</span>
      <span className="text-[9px] font-black uppercase tracking-widest" style={{ color }}>{label}</span>
    </button>
  );
});

export default function MobileCarControl({ vehicle }: Props) {
  const [cmds, setCmds] = useState<Partial<Record<CommandType, CmdState>>>({});

  const dispatch = useCallback(async (type: CommandType, vibMs = 50) => {
    if (!vehicle || cmds[type] === 'pending') return;
    haptic(vibMs);
    setCmds((p) => ({ ...p, [type]: 'pending' }));
    const ok = await sendCmd(vehicle.id, type);
    setCmds((p) => ({ ...p, [type]: ok ? 'ok' : 'err' }));
    setTimeout(() => setCmds((p) => ({ ...p, [type]: 'idle' })), 2000);
  }, [vehicle, cmds]);

  if (!vehicle) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
        <div className="w-16 h-16 rounded-3xl bg-white/[0.03] border border-white/[0.07] flex items-center justify-center">
          <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
            <path d="M4 18L8 10Q9.5 7 12 7H16Q18.5 7 20 10L24 18V22Q24 24 22 24H6Q4 24 4 22Z" stroke="rgba(255,255,255,0.2)" strokeWidth="1.8" strokeLinejoin="round"/>
          </svg>
        </div>
        <p className="text-sm text-white/30">Araç seçilmedi</p>
      </div>
    );
  }

  const isOnline = vehicle.status !== 'offline';
  const isLocked = true; // optimistic — extend from RemoteCommandPanel state if needed

  return (
    <div className="flex flex-col gap-4 px-1">

      {/* Araç kimliği */}
      <div
        className="flex items-center gap-3 px-4 py-3 rounded-2xl"
        style={{
          background: 'rgba(255,255,255,0.03)',
          border: '1px solid rgba(255,255,255,0.07)',
        }}
      >
        <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${
          vehicle.status === 'online' ? 'bg-emerald-400' :
          vehicle.status === 'alarm'  ? 'bg-red-400 animate-pulse' :
          'bg-white/20'
        }`} />
        <div className="flex-1 min-w-0">
          <p className="font-mono font-bold text-white text-sm">{vehicle.plate}</p>
          <p className="text-[10px] text-white/35 truncate">{vehicle.name} · {vehicle.driver}</p>
        </div>
        <span
          className="text-[9px] font-black uppercase tracking-widest px-2.5 py-1 rounded-lg"
          style={{
            color: isOnline ? '#34d399' : '#ffffff40',
            background: isOnline ? 'rgba(52,211,153,0.1)' : 'rgba(255,255,255,0.04)',
            border: `1px solid ${isOnline ? 'rgba(52,211,153,0.25)' : 'rgba(255,255,255,0.08)'}`,
          }}
        >
          {vehicle.status === 'online' ? 'Online' : vehicle.status === 'alarm' ? 'Alarm' : 'Offline'}
        </span>
      </div>

      {/* Ana butonlar — Kilitle / Aç */}
      <div className="grid grid-cols-2 gap-4">
        <BigBtn
          label="Kilitle" sublabel="Tap to lock"
          color="#ef4444" bgColor="rgba(239,68,68,0.07)" borderColor="rgba(239,68,68,0.25)"
          state={cmds.lock ?? 'idle'}
          onClick={() => dispatch('lock', 80)}
        >
          <svg width="36" height="36" viewBox="0 0 36 36" fill="none">
            <rect x="7" y="17" width="22" height="16" rx="4" stroke="currentColor" strokeWidth="2.5"/>
            <path d="M12 17V13a6 6 0 0112 0v4" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/>
            <circle cx="18" cy="25" r="2.5" fill="currentColor"/>
          </svg>
        </BigBtn>

        <BigBtn
          label="Aç" sublabel="Tap to unlock"
          color="#34d399" bgColor="rgba(52,211,153,0.07)" borderColor="rgba(52,211,153,0.25)"
          state={cmds.unlock ?? 'idle'}
          onClick={() => dispatch('unlock', 30)}
        >
          <svg width="36" height="36" viewBox="0 0 36 36" fill="none">
            <rect x="7" y="17" width="22" height="16" rx="4" stroke="currentColor" strokeWidth="2.5"/>
            <path d="M12 17V13a6 6 0 0112 0" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeDasharray="3 2"/>
          </svg>
        </BigBtn>
      </div>

      {/* Alt butonlar — Korna + Alarm */}
      <div className="flex gap-3">
        <SmallBtn
          label="Korna" color="#fbbf24"
          bgColor="rgba(251,191,36,0.07)" borderColor="rgba(251,191,36,0.22)"
          state={cmds.honk ?? 'idle'}
          onClick={() => dispatch('honk', 100)}
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
            <path d="M6 9H4a1 1 0 000 2h2m0-2v2m0-2l6-4.5v12L6 13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M15 7.5a6 6 0 010 9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
            <path d="M17.5 5a9.5 9.5 0 010 14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" opacity="0.5"/>
          </svg>
        </SmallBtn>

        <SmallBtn
          label="Alarm" color="#a78bfa"
          bgColor="rgba(167,139,250,0.07)" borderColor="rgba(167,139,250,0.22)"
          state={cmds.alarm ?? 'idle'}
          onClick={() => dispatch('alarm', 200)}
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
            <path d="M12 3L21 19H3L12 3Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"/>
            <path d="M12 10v4M12 16.5v.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
          </svg>
        </SmallBtn>
      </div>

      {/* Telemetri şeridi */}
      <div className="grid grid-cols-3 gap-2">
        {[
          {
            label: 'Hız',
            value: Math.round(vehicle.speed),
            unit: 'km/h',
            color: vehicle.speed > 90 ? '#ef4444' : vehicle.speed > 60 ? '#fbbf24' : '#34d399',
          },
          {
            label: 'Yakıt',
            value: Math.round(vehicle.fuel),
            unit: '%',
            color: vehicle.fuel < 15 ? '#ef4444' : vehicle.fuel < 30 ? '#fbbf24' : '#60a5fa',
          },
          {
            label: 'Motor',
            value: Math.round(vehicle.engineTemp),
            unit: '°C',
            color: vehicle.engineTemp > 100 ? '#ef4444' : vehicle.engineTemp > 85 ? '#fbbf24' : '#34d399',
          },
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
