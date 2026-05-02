import { memo } from 'react';
import { 
  Search, Navigation, Music, Phone, LayoutGrid, Settings, 
  Battery, Wind, Thermometer, Droplets, Sun, Moon,
  Volume2, Mic, Bell, Wifi, Map as MapIcon,
  ChevronRight, MoreHorizontal
} from 'lucide-react';
import { useStore } from '../../../store/useStore';
import { MiniMapWidget } from '../../map/MiniMapWidget';
import { useOBDState } from '../../../platform/obdService';
import { useGPSLocation, resolveSpeedKmh } from '../../../platform/gpsService';
import { useMediaState } from '../../../platform/mediaService';
import { useClock } from '../../../hooks/useClock';
import { useDeviceStatus } from '../../../platform/deviceApi';

/* ── SPEED GAUGE COMPONENT ───────────────────────────────── */
const SpeedGauge = memo(({ speed, isNight }: { speed: number, isNight: boolean }) => {
  const percentage = Math.min(speed / 260, 1);
  const strokeDash = 440;
  const offset = strokeDash - (strokeDash * percentage * 0.75);

  return (
    <div className="relative w-[var(--lp-speedo,420px)] h-[var(--lp-speedo,420px)] flex items-center justify-center">
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
        
        <circle cx="210" cy="210" r="180" stroke={isNight ? "rgba(30, 41, 59, 0.3)" : "rgba(224, 242, 254, 0.3)"} strokeWidth="12" fill="transparent" strokeDasharray={strokeDash} strokeDashoffset={strokeDash * 0.25} strokeLinecap="round" />
        <circle cx="210" cy="210" r="180" stroke="url(#gaugeGradient)" strokeWidth="12" fill="transparent" strokeDasharray={strokeDash} strokeDashoffset={offset} strokeLinecap="round" filter="url(#gaugeGlow)" className="transition-all duration-700 ease-out" style={{ opacity: isNight ? 0.5 : 1 }} />
      </svg>

      <div className="flex flex-col items-center z-10">
        <span className={`text-[var(--lp-speed-font,120px)] font-bold leading-none tracking-tighter tabular-nums ${isNight ? 'text-slate-200' : 'text-slate-800'}`}>
          {Math.round(speed || 0)}
        </span>
        <span className={`text-sm font-black tracking-[0.4em] uppercase -mt-2 ${isNight ? 'text-blue-400/60' : 'text-blue-500/80'}`}>
          KM / H
        </span>
      </div>
    </div>
  );
});

export function ReplicationCockpit({ favorites: _favorites, onLaunch }: { favorites: string[]; onLaunch: (id: string) => void }) {
  const { settings } = useStore();
  const isNight = settings.dayNightMode === 'night';
  const obd = useOBDState();
  const gps = useGPSLocation();
  const device = useDeviceStatus();
  const { track } = useMediaState();
  const { time } = useClock(settings.use24Hour, true);

  const speed = resolveSpeedKmh(gps, obd.speed ?? 0);
  const rpm = obd.rpm ?? 0;
  const temp = obd.engineTemp ?? 0;
  const fuel = obd.fuelLevel ?? 0;

  const themeClasses = isNight ? "bg-[#020617] text-slate-400" : "bg-[#f8fafc] text-slate-500";
  const cardClasses = isNight ? "bg-[#0f172a]/60 border-white/5 shadow-2xl backdrop-blur-md" : "bg-white/70 border-slate-200 shadow-xl backdrop-blur-md";
  const textPrimary = isNight ? "text-slate-100" : "text-slate-900";
  const textSecondary = isNight ? "text-slate-400" : "text-slate-500";
  const accentColor = isNight ? "text-blue-400" : "text-blue-500";
  const accentBg = isNight ? "bg-blue-500/10" : "bg-blue-500/5";

  return (
    <div className={`h-full w-full flex flex-col p-6 gap-6 transition-colors duration-1000 ${themeClasses} font-sans select-none overflow-hidden relative`}>
      <div className={`absolute top-[-10%] left-[20%] w-[50%] h-[50%] rounded-full blur-[120px] opacity-20 pointer-events-none transition-all duration-1000 ${isNight ? 'bg-blue-900/40' : 'bg-sky-200'}`} />
      
      {/* TOP BAR */}
      <div className="flex justify-between items-center px-4 z-20">
        <div className="flex items-center gap-8">
          <div className="flex flex-col">
            <span className={`text-4xl font-bold tracking-tight tabular-nums ${textPrimary}`}>{time}</span>
            <div className="flex items-center gap-2 mt-1">
              {isNight ? <Moon className="w-4 h-4 text-slate-600" /> : <Sun className="w-4 h-4 text-amber-500" />}
              <span className="text-sm font-medium">Hava Durumu --°C</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-6">
          <div className={`flex items-center gap-3 px-6 py-2 rounded-full border ${isNight ? 'border-white/10 bg-white/5' : 'border-slate-200 bg-white'}`}>
             <Battery className="w-5 h-5 text-emerald-500" />
             <span className={`text-lg font-bold tabular-nums ${textPrimary}`}>{device.ready ? `${device.battery}%` : '--'}</span>
             <div className="w-px h-4 bg-slate-700/20 mx-2" />
             <span className="text-sm font-semibold opacity-60">{Math.round((fuel/100)*650)} KM</span>
          </div>
          <div className="flex items-center gap-4">
             <Wifi className="w-5 h-5 opacity-60" />
             <Bell className="w-5 h-5 opacity-60" />
             <Settings onClick={() => onLaunch('settings')} className="w-5 h-5 opacity-60 cursor-pointer" />
          </div>
        </div>
      </div>

      {/* MAIN GRID */}
      <div className="flex-1 flex gap-6 min-h-0 z-10">
        <div className="w-[30%] flex flex-col gap-6">
          <div className={`flex-1 rounded-[2.5rem] border overflow-hidden flex flex-col relative ${cardClasses}`}>
            <div className="absolute top-6 left-6 right-6 z-20">
               <div className={`flex items-center gap-4 px-6 py-4 rounded-2xl border ${isNight ? 'bg-slate-900/80 border-white/5' : 'bg-slate-50 border-slate-200'}`}>
                  <Search className="w-5 h-5 opacity-40" />
                  <span className="text-sm font-medium opacity-40">Nereye gidiyorsunuz?</span>
               </div>
            </div>
            <div className="flex-1 w-full relative">
               <MiniMapWidget />
            </div>
            <div className="p-6 grid grid-cols-2 gap-4">
               <div className={`p-5 rounded-3xl border ${isNight ? 'bg-white/5 border-white/5' : 'bg-slate-50 border-slate-100'}`}>
                  <span className="text-[10px] font-black uppercase tracking-widest opacity-40 mb-1 block">Varış</span>
                  <div className="flex items-baseline gap-1">
                    <span className={`text-2xl font-bold ${textPrimary}`}>--</span>
                    <span className="text-xs font-bold opacity-40">dk</span>
                  </div>
               </div>
               <div className={`p-5 rounded-3xl border ${isNight ? 'bg-white/5 border-white/5' : 'bg-slate-50 border-slate-100'}`}>
                  <span className="text-[10px] font-black uppercase tracking-widest opacity-40 mb-1 block">Mesafe</span>
                  <div className="flex items-baseline gap-1">
                    <span className={`text-2xl font-bold ${textPrimary}`}>--</span>
                    <span className="text-xs font-bold opacity-40">km</span>
                  </div>
               </div>
            </div>
          </div>
        </div>

        {/* CENTER COLUMN: CLUSTER */}
        <div className="flex-1 flex flex-col items-center justify-between py-4 relative">
          <SpeedGauge speed={speed} isNight={isNight} />
          <div className={`w-full max-w-2xl grid grid-cols-3 gap-8 p-8 rounded-[3rem] border ${cardClasses}`}>
             {[
               { label: 'RPM', val: rpm.toLocaleString(), unit: '', icon: Wind, color: 'text-blue-500' },
               { label: 'Sıcaklık', val: Math.round(temp), unit: '°C', icon: Thermometer, color: 'text-emerald-500' },
               { label: 'Yakıt', val: Math.round(fuel), unit: '%', icon: Droplets, color: 'text-sky-500' }
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

        {/* RIGHT COLUMN: MEDIA */}
        <div className="w-[30%] flex flex-col gap-6">
          <div className={`flex-1 rounded-[2.5rem] border p-8 flex flex-col relative overflow-hidden ${cardClasses}`}>
             <div className="flex items-center justify-between mb-8">
                <div className="flex items-center gap-3">
                   <div className={`p-2 rounded-xl ${accentBg}`}>
                      <Music className={`w-5 h-5 ${accentColor}`} />
                   </div>
                   <span className="text-xs font-bold uppercase tracking-widest opacity-60">Müzik</span>
                </div>
                <MoreHorizontal className="w-5 h-5 opacity-40" />
             </div>
             
             <div className="flex-1 flex flex-col justify-center">
                <div className="w-full aspect-square rounded-[2rem] bg-slate-800 shadow-2xl mb-6 flex items-center justify-center overflow-hidden relative">
                   {track.albumArt ? <img src={track.albumArt} className="w-full h-full object-cover" alt="" /> : <Music className="w-20 h-20 text-white/20" />}
                </div>
                <h3 className={`text-2xl font-bold mb-1 truncate ${textPrimary}`}>{track.title || 'Müzik çalınmıyor'}</h3>
                <p className={`text-sm font-medium opacity-60 mb-8 ${textSecondary}`}>{track.artist || 'Sinyal yok'}</p>
                
                <div className="flex items-center gap-4">
                   <div className={`flex-1 h-1.5 rounded-full relative overflow-hidden ${isNight ? 'bg-white/10' : 'bg-slate-200'}`}>
                      <div className="absolute top-0 left-0 h-full w-[0%] bg-blue-500" />
                   </div>
                   <span className="text-[10px] font-bold tabular-nums opacity-40">--:-- / --:--</span>
                </div>
             </div>
          </div>

          <div className="grid grid-cols-4 gap-4 h-24">
             {[Phone, LayoutGrid, MapIcon, Mic].map((Icon, i) => (
               <button key={i} onClick={() => onLaunch(i === 0 ? 'phone' : i === 2 ? 'maps' : 'apps')} className={`rounded-3xl border flex items-center justify-center hover:scale-105 active:scale-95 transition-all ${cardClasses}`}>
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
                <button key={i} onClick={() => onLaunch(i === 0 ? 'apps' : i === 1 ? 'maps' : i === 2 ? 'music' : 'phone')} className={`p-4 rounded-2xl transition-all ${i === 0 ? (isNight ? 'bg-blue-500/20 text-blue-400' : 'bg-blue-500/10 text-blue-600') : 'text-slate-500 hover:text-blue-500'}`}>
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
             <div onClick={() => onLaunch('settings')} className="flex items-center gap-3 cursor-pointer">
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
