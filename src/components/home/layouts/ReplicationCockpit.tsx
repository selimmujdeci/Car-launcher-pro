import { useState, useEffect } from 'react';
import { 
  Search, Navigation, Music, Phone, LayoutGrid, Settings, 
  Battery, Wind, Thermometer, Droplets, Sun,
  Volume2, Mic, Bell, Wifi, Map as MapIcon,
  ChevronRight, MoreHorizontal
} from 'lucide-react';
import { useStore } from '../../../store/useStore';
import { MiniMapWidget } from '../../map/MiniMapWidget';

/* ── SPEED GAUGE COMPONENT ───────────────────────────────── */
const SpeedGauge = ({ speed, isNight }: { speed: number, isNight: boolean }) => {
  const percentage = Math.min(speed / 260, 1);
  const strokeDash = 440;
  const offset = strokeDash - (strokeDash * percentage * 0.75);

  return (
    <div className="relative w-[420px] h-[420px] flex items-center justify-center">
      {/* Outer Glow Arc */}
      <svg className="absolute inset-0 w-full h-full -rotate-[225deg] overflow-visible">
        <defs>
          <linearGradient id="gaugeGradient" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor={isNight ? "#1e40af" : "#0ea5e9"} />
            <stop offset="100%" stopColor={isNight ? "#3b82f6" : "#22d3ee"} />
          </linearGradient>
          <filter id="gaugeGlow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation={isNight ? "2" : "8"} result="blur" />
            <feComposite in="SourceGraphic" in2="blur" operator="over" />
          </filter>
        </defs>
        
        {/* Track */}
        <circle
          cx="210" cy="210" r="180"
          stroke={isNight ? "rgba(30, 41, 59, 0.3)" : "rgba(224, 242, 254, 0.3)"}
          strokeWidth="12"
          fill="transparent"
          strokeDasharray={strokeDash}
          strokeDashoffset={strokeDash * 0.25}
          strokeLinecap="round"
        />
        
        {/* Progress */}
        <circle
          cx="210" cy="210" r="180"
          stroke="url(#gaugeGradient)"
          strokeWidth="12"
          fill="transparent"
          strokeDasharray={strokeDash}
          strokeDashoffset={offset}
          strokeLinecap="round"
          filter="url(#gaugeGlow)"
          className="transition-all duration-700 ease-out"
          style={{ opacity: isNight ? 0.5 : 1 }}
        />
      </svg>

      {/* Speed Readout */}
      <div className="flex flex-col items-center z-10">
        <span className={`text-[120px] font-bold leading-none tracking-tighter tabular-nums ${isNight ? 'text-slate-200' : 'text-slate-800'}`}>
          {speed}
        </span>
        <span className={`text-sm font-black tracking-[0.4em] uppercase -mt-2 ${isNight ? 'text-blue-400/60' : 'text-blue-500/80'}`}>
          KM / H
        </span>
      </div>

      {/* Ticks */}
      <div className="absolute inset-0 pointer-events-none">
        {[...Array(31)].map((_, i) => {
          const angle = (i * 9) - 225;
          const active = i < (speed / 8.6);
          return (
            <div 
              key={i}
              className={`absolute top-1/2 left-1/2 w-[2px] origin-bottom transition-all duration-500 ${
                active 
                  ? (isNight ? 'bg-blue-500/50 shadow-[0_0_8px_rgba(59,130,246,0.3)]' : 'bg-sky-400 shadow-[0_0_12px_rgba(56,189,248,0.5)]') 
                  : (isNight ? 'bg-slate-800' : 'bg-slate-200')
              }`}
              style={{ 
                transform: `translate(-50%, -195px) rotate(${angle}deg)`,
                height: i % 5 === 0 ? '15px' : '8px',
                opacity: active ? 1 : 0.3
              }}
            />
          );
        })}
      </div>
    </div>
  );
};

export function ReplicationCockpit({ favorites, onLaunch }: { favorites: string[]; onLaunch: (id: string) => void }) {
  const { settings } = useStore();
  const isNight = settings.dayNightMode === 'night';
  const [speed, setSpeed] = useState(87);

  // Debug usage to satisfy TS
  useEffect(() => {
    console.log('ReplicationCockpit mounted with favorites:', favorites.length);
  }, [favorites, onLaunch]);

  // Mock speed drift
  useEffect(() => {
    const itv = setInterval(() => {
      setSpeed(s => {
        const delta = Math.random() > 0.5 ? 1 : -1;
        const next = s + delta;
        return next > 90 ? 89 : next < 84 ? 85 : next;
      });
    }, 1500);
    return () => clearInterval(itv);
  }, []);

  const themeClasses = isNight 
    ? "bg-[#020617] text-slate-400" 
    : "bg-[#f8fafc] text-slate-500";

  const cardClasses = isNight
    ? "bg-[#0f172a]/60 border-white/5 shadow-2xl backdrop-blur-md"
    : "bg-white/70 border-slate-200 shadow-xl backdrop-blur-md";

  const textPrimary = isNight ? "text-slate-100" : "text-slate-900";
  const textSecondary = isNight ? "text-slate-400" : "text-slate-500";
  const accentColor = isNight ? "text-blue-400" : "text-blue-500";
  const accentBg = isNight ? "bg-blue-500/10" : "bg-blue-500/5";

  return (
    <div className={`h-full w-full flex flex-col p-6 gap-6 transition-colors duration-1000 ${themeClasses} font-sans select-none overflow-hidden relative`}>
      
      {/* Background Orbs */}
      <div className={`absolute top-[-10%] left-[20%] w-[50%] h-[50%] rounded-full blur-[120px] opacity-20 pointer-events-none transition-all duration-1000 ${isNight ? 'bg-blue-900/40' : 'bg-sky-200'}`} />
      <div className={`absolute bottom-[-10%] right-[10%] w-[40%] h-[40%] rounded-full blur-[100px] opacity-10 pointer-events-none transition-all duration-1000 ${isNight ? 'bg-indigo-900/30' : 'bg-blue-100'}`} />

      {/* TOP BAR */}
      <div className="flex justify-between items-center px-4 z-20">
        <div className="flex items-center gap-8">
          <div className="flex flex-col">
            <span className={`text-4xl font-bold tracking-tight tabular-nums ${textPrimary}`}>14:31:23</span>
            <div className="flex items-center gap-2 mt-1">
              <Sun className={`w-4 h-4 ${isNight ? 'text-slate-600' : 'text-amber-500'}`} />
              <span className="text-sm font-medium">18°C İstanbul</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-6">
          <div className={`flex items-center gap-3 px-6 py-2 rounded-full border ${isNight ? 'border-white/10 bg-white/5' : 'border-slate-200 bg-white'}`}>
             <Battery className="w-5 h-5 text-emerald-500" />
             <span className={`text-lg font-bold tabular-nums ${textPrimary}`}>85%</span>
             <div className="w-px h-4 bg-slate-700/20 mx-2" />
             <span className="text-sm font-semibold opacity-60">420 KM</span>
          </div>
          <div className="flex items-center gap-4">
             <Wifi className="w-5 h-5 opacity-60" />
             <Bell className="w-5 h-5 opacity-60" />
             <Settings className="w-5 h-5 opacity-60" />
          </div>
        </div>
      </div>

      {/* MAIN GRID */}
      <div className="flex-1 flex gap-6 min-h-0 z-10">
        
        {/* LEFT COLUMN: NAVIGATION */}
        <div className="w-[30%] flex flex-col gap-6">
          <div className={`flex-1 rounded-[2.5rem] border overflow-hidden flex flex-col relative ${cardClasses}`}>
            {/* Search Bar */}
            <div className="absolute top-6 left-6 right-6 z-20">
               <div className={`flex items-center gap-4 px-6 py-4 rounded-2xl border ${isNight ? 'bg-slate-900/80 border-white/5' : 'bg-slate-50 border-slate-200'}`}>
                  <Search className="w-5 h-5 opacity-40" />
                  <span className="text-sm font-medium opacity-40">Nereye gidiyorsunuz?</span>
               </div>
            </div>

            <div className="flex-1 w-full relative">
               <MiniMapWidget />
               <div className={`absolute inset-0 pointer-events-none ${isNight ? 'bg-blue-900/10' : 'bg-transparent'}`} />
            </div>

            {/* Trip Cards */}
            <div className="p-6 grid grid-cols-2 gap-4">
               <div className={`p-5 rounded-3xl border ${isNight ? 'bg-white/5 border-white/5' : 'bg-slate-50 border-slate-100'}`}>
                  <span className="text-[10px] font-black uppercase tracking-widest opacity-40 mb-1 block">Varış Süresi</span>
                  <div className="flex items-baseline gap-1">
                    <span className={`text-2xl font-bold ${textPrimary}`}>12</span>
                    <span className="text-xs font-bold opacity-40">dk</span>
                  </div>
               </div>
               <div className={`p-5 rounded-3xl border ${isNight ? 'bg-white/5 border-white/5' : 'bg-slate-50 border-slate-100'}`}>
                  <span className="text-[10px] font-black uppercase tracking-widest opacity-40 mb-1 block">Mesafe</span>
                  <div className="flex items-baseline gap-1">
                    <span className={`text-2xl font-bold ${textPrimary}`}>8.4</span>
                    <span className="text-xs font-bold opacity-40">km</span>
                  </div>
               </div>
            </div>
          </div>
        </div>

        {/* CENTER COLUMN: CLUSTER */}
        <div className="flex-1 flex flex-col items-center justify-between py-4 relative">
          
          {/* Car Background / Road Visualization Placeholder */}
          <div className="absolute inset-0 flex items-center justify-center opacity-40 pointer-events-none">
             <div className={`w-[80%] h-[300px] rounded-full blur-[100px] ${isNight ? 'bg-blue-900/20' : 'bg-sky-100/50'}`} />
          </div>

          <SpeedGauge speed={speed} isNight={isNight} />

          {/* Stats Bar */}
          <div className={`w-full max-w-2xl grid grid-cols-3 gap-8 p-8 rounded-[3rem] border ${cardClasses}`}>
             {[
               { label: 'RPM', val: '2450', unit: '', icon: Wind, color: 'text-blue-500' },
               { label: 'Sıcaklık', val: '92', unit: '°C', icon: Thermometer, color: 'text-emerald-500' },
               { label: 'Yakıt', val: '65', unit: '%', icon: Droplets, color: 'text-sky-500' }
             ].map(stat => (
               <div key={stat.label} className="flex flex-col items-center gap-1">
                 <stat.icon className={`w-5 h-5 ${stat.color} mb-1 opacity-80`} />
                 <span className="text-[10px] font-black uppercase tracking-widest opacity-40">{stat.label}</span>
                 <div className="flex items-baseline gap-0.5">
                    <span className={`text-2xl font-bold tabular-nums ${textPrimary}`}>{stat.val}</span>
                    <span className="text-[10px] font-bold opacity-40">{stat.unit}</span>
                 </div>
               </div>
             ))}
          </div>
        </div>

        {/* RIGHT COLUMN: MEDIA & APPS */}
        <div className="w-[30%] flex flex-col gap-6">
          {/* Music Card */}
          <div className={`flex-1 rounded-[2.5rem] border p-8 flex flex-col relative overflow-hidden ${cardClasses}`}>
             <div className="flex items-center justify-between mb-8">
                <div className="flex items-center gap-3">
                   <div className={`p-2 rounded-xl ${accentBg}`}>
                      <Music className={`w-5 h-5 ${accentColor}`} />
                   </div>
                   <span className="text-xs font-bold uppercase tracking-widest opacity-60">Şu an çalıyor</span>
                </div>
                <MoreHorizontal className="w-5 h-5 opacity-40" />
             </div>
             
             <div className="flex-1 flex flex-col justify-center">
                <div className="w-full aspect-square rounded-[2rem] bg-gradient-to-br from-blue-500 to-indigo-600 shadow-2xl mb-6 flex items-center justify-center overflow-hidden">
                   <div className="absolute inset-0 opacity-20 bg-[url('https://images.unsplash.com/photo-1614613535308-eb5fbd3d2c17?q=80&w=500')] bg-cover bg-center" />
                   <Music className="w-20 h-20 text-white/40 relative z-10" />
                </div>
                <h3 className={`text-2xl font-bold mb-1 truncate ${textPrimary}`}>Midnight City</h3>
                <p className={`text-sm font-medium opacity-60 mb-8 ${textSecondary}`}>M83 • Hurry Up, We're Dreaming</p>
                
                <div className="flex items-center gap-4">
                   <div className={`flex-1 h-1.5 rounded-full relative overflow-hidden ${isNight ? 'bg-white/10' : 'bg-slate-200'}`}>
                      <div className="absolute top-0 left-0 h-full w-[45%] bg-blue-500 shadow-[0_0_10px_rgba(59,130,246,0.5)]" />
                   </div>
                   <span className="text-[10px] font-bold tabular-nums opacity-40">1:42 / 4:03</span>
                </div>
             </div>
          </div>

          {/* Quick Apps */}
          <div className="grid grid-cols-4 gap-4 h-24">
             {[Phone, LayoutGrid, MapIcon, Mic].map((Icon, i) => (
               <button key={i} className={`rounded-3xl border flex items-center justify-center hover:scale-105 active:scale-95 transition-all ${cardClasses}`}>
                  <Icon className={`w-6 h-6 ${i === 0 ? 'text-emerald-500' : textSecondary}`} />
               </button>
             ))}
          </div>
        </div>

      </div>

      {/* BOTTOM DOCK */}
      <div className={`h-24 rounded-[2.5rem] border flex items-center justify-between px-10 z-20 ${cardClasses}`}>
          <div className="flex items-center gap-10">
             {[LayoutGrid, Navigation, Music, Phone].map((Icon, i) => (
                <button key={i} className={`p-4 rounded-2xl transition-all ${i === 0 ? (isNight ? 'bg-blue-500/20 text-blue-400' : 'bg-blue-500/10 text-blue-600') : 'text-slate-500 hover:text-blue-500'}`}>
                   <Icon className="w-7 h-7" />
                </button>
             ))}
          </div>

          <div className={`h-12 w-px ${isNight ? 'bg-white/10' : 'bg-slate-200'}`} />

          <div className="flex items-center gap-10">
             <div className="flex items-center gap-4">
                <Volume2 className="w-6 h-6 opacity-40" />
                <div className={`w-32 h-2 rounded-full relative overflow-hidden ${isNight ? 'bg-white/10' : 'bg-slate-200'}`}>
                   <div className="absolute top-0 left-0 h-full w-[60%] bg-slate-400" />
                </div>
             </div>
             <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-full bg-slate-500/20 flex items-center justify-center overflow-hidden border ${isNight ? 'border-white/10' : 'border-slate-200'}`}>
                   <span className="text-xs font-bold">S</span>
                </div>
                <ChevronRight className="w-5 h-5 opacity-40" />
             </div>
          </div>
      </div>

    </div>
  );
}
