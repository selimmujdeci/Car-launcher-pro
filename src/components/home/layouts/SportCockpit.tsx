import { useState, useEffect } from 'react';
import {
  Zap, Navigation, Music, Shield,
  Settings, Phone, Cpu,
  Activity, Thermometer, Wind, Droplets
} from 'lucide-react';
import { MiniMapWidget } from '../../map/MiniMapWidget';
import { MediaHub } from '../MediaHub';

// --- Hyper Neon Gauge v2 ---
const NeonGauge = ({ speed }: { speed: number }) => {
  const percentage = Math.min(speed / 260, 1);
  const strokeDash = 540;
  const offset = strokeDash - (strokeDash * percentage * 0.75);

  return (
    <div className="relative w-[500px] h-[500px] flex items-center justify-center scale-110">
      {/* Dynamic Glow Layers */}
      <div className="absolute inset-0 rounded-full border-[2px] border-cyan-500/5 shadow-[0_0_150px_rgba(0,242,255,0.1)]" />
      <div className="absolute inset-12 rounded-full var(--panel-bg-secondary) border border-white/10 shadow-inner backdrop-blur-xl" />
      
      {/* The Mechanical Ring */}
      <div className="absolute inset-8 rounded-full border-[15px] border-primary/5 shadow-[inset_0_0_30px_rgba(0,0,0,0.05)]" />

      <svg className="w-full h-full -rotate-[225deg] filter drop-shadow-[0_0_25px_rgba(0,242,255,0.4)]">
        <defs>
          <linearGradient id="hyperG" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#06b6d4" />
            <stop offset="100%" stopColor="#3b82f6" />
          </linearGradient>
        </defs>
        
        {/* Track with Depth */}
        <circle
          cx="250" cy="250" r="200"
          stroke="rgba(255,255,255,0.05)" strokeWidth="30"
          fill="transparent"
          strokeDasharray={strokeDash}
          strokeDashoffset={strokeDash * 0.25}
        />
        
        {/* Animated Progress Rail */}
        <circle
          cx="250" cy="250" r="200"
          stroke="url(#hyperG)" strokeWidth="24"
          fill="transparent"
          strokeDasharray={strokeDash}
          strokeDashoffset={offset}
          strokeLinecap="round"
          className="transition-all duration-500 ease-out"
        />
      </svg>

      {/* Speed Readout - Projector Style */}
      <div className="absolute flex flex-col items-center z-10">
        <div className="relative">
            <span className="text-[160px] font-black text-primary leading-none tracking-tighter italic drop-shadow-2xl">
                {Math.round(speed || 0)}
            </span>
            <div className="absolute -top-6 -right-12 px-4 py-1 bg-cyan-500 text-primary text-xs font-black uppercase tracking-[0.3em] italic skew-x-[-20deg] shadow-[0_0_20px_rgba(6,182,212,0.5)]">
                TURBO
            </div>
        </div>
        <div className="flex flex-col items-center -mt-6">
          <span className="text-cyan-600 font-black tracking-[0.6em] text-sm uppercase opacity-80">KM / H</span>
          <div className="h-2.5 w-48 var(--panel-bg-secondary) mt-4 rounded-full overflow-hidden border border-white/10">
             <div className="h-full bg-cyan-500 shadow-[0_0_15px_rgba(6,182,212,0.6)]" style={{ width: `${(speed / 260) * 100}%` }} />
          </div>
        </div>
      </div>

      {/* Mechanical Ticks */}
      <div className="absolute inset-0 pointer-events-none">
        {[...Array(40)].map((_, i) => {
          const angle = (i * 6.75) - 225;
          const active = i < (speed / 6.5);
          return (
            <div 
              key={i}
              className={`absolute top-1/2 left-1/2 w-[3px] origin-bottom transition-all duration-700 ${active ? 'bg-cyan-500 shadow-[0_0_15px_rgba(6,182,212,0.5)] opacity-100' : 'bg-primary/10 opacity-30'}`}
              style={{ 
                transform: `translate(-50%, -235px) rotate(${angle}deg)`,
                height: i % 5 === 0 ? '40px' : '15px'
              }}
            />
          );
        })}
      </div>
    </div>
  );
};

export function SportCockpit() {
  const [fakeSpeed, setFakeSpeed] = useState(0);

  useEffect(() => {
    const itv = setInterval(() => {
      setFakeSpeed(prev => {
        const target = 140 + Math.random() * 8;
        return Math.floor(prev + (target - prev) * 0.05);
      });
    }, 200);
    return () => clearInterval(itv);
  }, []);

  return (
    <div className="h-full w-full bg-transparent text-primary p-8 flex gap-8 overflow-hidden select-none relative">
      
      {/* Animated Scanline Effect */}
      <div className="absolute inset-0 pointer-events-none opacity-[0.03] mix-blend-overlay" 
           style={{ background: 'repeating-linear-gradient(0deg, transparent, transparent 2px, #000 3px, transparent 4px)', backgroundSize: '100% 4px' }} />

      {/* LEFT: Dynamic Intelligence */}
      <div className="w-[28%] flex flex-col gap-8 z-10">
        <div className="glass-card p-10 rounded-[3rem] border-l-[12px] border-cyan-500 skew-x-[-6deg] group overflow-visible shadow-2xl">
          <div className="absolute -top-4 -left-4 w-12 h-12 bg-cyan-500 flex items-center justify-center skew-x-[6deg] shadow-[0_8px_30px_rgba(6,182,212,0.4)]">
              <Activity className="w-7 h-7 text-primary stroke-[3px]" />
          </div>
          <div className="text-8xl font-black italic tracking-tighter text-primary tabular-nums drop-shadow-xl">14:45</div>
          <div className="flex items-center gap-3 mt-4">
             <div className="w-3 h-3 bg-cyan-500 rounded-full animate-ping" />
             <span className="text-cyan-600 font-black tracking-[0.4em] text-[11px] uppercase">Telemetry Active</span>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-6">
          <div className="glass-card p-6 rounded-[2.5rem] group hover:var(--panel-bg-secondary) transition-all shadow-lg border-white/10">
            <Zap className="w-6 h-6 text-amber-500 mb-4" />
            <div className="text-secondary text-[10px] font-black uppercase tracking-widest mb-1 opacity-60">Energy</div>
            <div className="text-4xl font-black italic text-primary leading-none">420<span className="text-sm text-cyan-600 ml-1">km</span></div>
            <div className="mt-4 h-1.5 w-full bg-primary/10 rounded-full overflow-hidden">
                <div className="h-full bg-gradient-to-r from-amber-500 to-orange-500 shadow-[0_0_10px_rgba(245,158,11,0.4)]" style={{ width: '65%' }} />
            </div>
          </div>
          <div className="glass-card p-6 rounded-[2.5rem] group shadow-lg border-white/10">
            <Shield className="w-6 h-6 text-emerald-500 mb-4" />
            <div className="text-secondary text-[10px] font-black uppercase tracking-widest mb-1 opacity-60">Safety</div>
            <div className="text-4xl font-black italic text-emerald-600 leading-none">ELITE</div>
            <div className="mt-4 flex gap-1.5">
                {[1,2,3,4,5].map(i => <div key={i} className="h-1.5 flex-1 bg-emerald-500 rounded-full shadow-[0_0_8px_rgba(16,185,129,0.3)]" />)}
            </div>
          </div>
        </div>

        <div className="flex-1 glass-card rounded-[3rem] p-8 flex flex-col gap-5 shadow-xl border-white/10">
           <div className="text-[11px] font-black text-secondary uppercase tracking-[0.4em] mb-4 flex items-center justify-between opacity-60">
              <span>Drive Modes</span>
              <Settings className="w-4 h-4" />
           </div>
           {['TRACK', 'DRIFT', 'CITY', 'STEALTH'].map((mode, idx) => (
             <button 
                key={mode} 
                className={`w-full h-16 rounded-[1.25rem] flex items-center gap-6 px-6 transition-all border group relative ${idx === 0 ? 'bg-cyan-500 border-cyan-400 text-primary shadow-[0_10px_30px_rgba(6,182,212,0.3)]' : 'var(--panel-bg-secondary) border-white/10 text-secondary hover:var(--panel-bg-secondary)'}`}
             >
                <span className="font-black text-sm tracking-[0.3em] uppercase italic">{mode}</span>
                <div className={`absolute right-6 w-3 h-3 rounded-full ${idx === 0 ? 'bg-white shadow-[0_0_10px_rgba(255,255,255,0.5)]' : 'bg-primary/10'}`} />
             </button>
           ))}
        </div>
      </div>

      {/* CENTER: THE ENGINE */}
      <div className="flex-1 flex flex-col items-center justify-center relative z-10">
        <div className="absolute top-0 flex gap-6 skew-x-[-15deg]">
            <div className="px-12 py-3 bg-red-600 text-primary text-sm font-black tracking-[0.5em] shadow-[0_10px_40px_rgba(220,38,38,0.4)] border-b-4 border-red-800 uppercase">Extreme Perf</div>
            <div className="px-12 py-3 var(--panel-bg-secondary) backdrop-blur-xl border border-white/20 text-sm font-black tracking-[0.4em] text-primary uppercase shadow-lg">Aero Active</div>
        </div>
        
        <NeonGauge speed={fakeSpeed} />

        <div className="mt-12 grid grid-cols-3 gap-10 w-full max-w-3xl skew-x-[-8deg]">
            {[
                { label: 'Coolant', val: '92°C', icon: Thermometer, color: 'text-cyan-600' },
                { label: 'G-Force', val: '1.24 G', icon: Wind, color: 'text-indigo-600' },
                { label: 'Traction', val: '98%', icon: Droplets, color: 'text-blue-600' }
            ].map(stat => (
                <div key={stat.label} className="glass-card p-6 flex flex-col items-center border-b-4 border-b-cyan-500/50 shadow-lg border-white/10">
                    <stat.icon className={`w-6 h-6 ${stat.color} mb-2`} />
                    <div className="text-[10px] text-secondary font-black uppercase tracking-widest opacity-60">{stat.label}</div>
                    <div className="text-3xl font-black italic tracking-tighter text-primary">{stat.val}</div>
                </div>
            ))}
        </div>
      </div>

      {/* RIGHT: TACTICAL VIEW */}
      <div className="w-[32%] flex flex-col gap-8 z-10">
        <div className="h-[48%] rounded-[4rem] overflow-hidden border-2 border-white/10 relative shadow-2xl group skew-x-[-2deg]">
           <MiniMapWidget />
           <div className="absolute inset-0 bg-gradient-to-t from-white/20 via-transparent to-transparent opacity-40 pointer-events-none" />
           <div className="absolute bottom-10 left-10 flex items-center gap-6">
              <div className="w-20 h-20 bg-cyan-500 rounded-[2rem] flex items-center justify-center shadow-[0_10px_40px_rgba(6,182,212,0.4)] skew-x-[4deg]">
                <Navigation className="w-10 h-10 text-primary stroke-[3px]" />
              </div>
              <div className="skew-x-[2deg]">
                <div className="text-[11px] font-black text-cyan-700 uppercase tracking-[0.5em] mb-2 leading-none opacity-80">Tactical Path</div>
                <div className="text-3xl font-black italic uppercase tracking-tighter drop-shadow-sm">Downtown Sector 7</div>
              </div>
           </div>
        </div>

        <div className="flex-1 glass-card rounded-[3.5rem] p-10 flex flex-col relative overflow-hidden group shadow-xl border-white/10">
           <div className="absolute -top-20 -right-20 p-8 opacity-[0.03] group-hover:opacity-[0.08] transition-opacity">
              <Music className="w-72 h-72 text-primary" />
           </div>
           <div className="flex items-center justify-between mb-8">
              <div className="flex items-center gap-4">
                <div className="w-2 h-6 bg-cyan-500 rounded-full shadow-[0_0_10px_rgba(6,182,212,0.5)]" />
                <span className="text-[12px] font-black tracking-[0.5em] text-secondary uppercase opacity-60">Sonic Output</span>
              </div>
              <Cpu className="w-6 h-6 text-cyan-600" />
           </div>
           <div className="flex-1 scale-110 origin-top">
              <MediaHub defaultMusic="spotify" />
           </div>
        </div>

        <div className="h-24 flex gap-6">
            <button className="w-24 glass-card rounded-[2rem] flex items-center justify-center var(--panel-bg-secondary) hover:bg-white/15 transition-all border-white/10 active:scale-90 shadow-md">
                <Settings className="w-8 h-8 text-secondary" />
            </button>
            <button className="w-24 glass-card rounded-[2rem] flex items-center justify-center var(--panel-bg-secondary) hover:bg-white/15 transition-all border-white/10 active:scale-90 shadow-md">
                <Phone className="w-8 h-8 text-secondary" />
            </button>
            <button className="flex-1 bg-gradient-to-br from-cyan-500 via-blue-600 to-indigo-700 rounded-[2.5rem] flex items-center justify-center gap-6 shadow-[0_10px_40px_rgba(6,182,212,0.3)] hover:brightness-110 active:scale-95 transition-all border border-white/20">
                <Cpu className="w-8 h-8 text-primary" />
                <span className="font-black italic uppercase tracking-[0.3em] text-lg text-primary">System Overdrive</span>
            </button>
        </div>
      </div>
    </div>
  );
}



