import {
  Navigation, Music, Settings,
  Battery, Shield, LayoutGrid,
  Search, Mic, Fan, Thermometer
} from 'lucide-react';
import { MiniMapWidget } from '../../map/MiniMapWidget';
import { MediaHub } from '../MediaHub';

export function MinimalCockpit({ favorites, onLaunch }: { favorites: string[]; onLaunch: (id: string) => void }) {
  return (
    <div className="h-full w-full bg-[#000000] text-primary flex overflow-hidden extreme-lux select-none">
      
      {/* LEFT SIDEBAR: The Controller */}
      <div className="w-[320px] border-r border-white/5 flex flex-col p-10 justify-between bg-[#080808] z-20">
        
        {/* Speed & Gear */}
        <div className="space-y-16">
          <div className="flex flex-col">
            <span className="text-[130px] font-extralight leading-none tracking-tighter tabular-nums">72</span>
            <div className="flex items-center gap-3">
                <span className="text-blue-500 font-black tracking-[0.2em] text-xs uppercase">km/h</span>
                <div className="h-px flex-1 var(--panel-bg-secondary)" />
            </div>
          </div>

          <div className="flex justify-between items-center text-3xl font-light italic">
                <span className="text-primary font-black not-italic">P</span>
                <span className="text-slate-800">R</span>
                <span className="text-slate-800">N</span>
                <span className="text-slate-800">D</span>
          </div>

          {/* Critical Stats */}
          <div className="space-y-8">
            <div className="flex items-center justify-between group">
                <div className="flex items-center gap-4 text-slate-400 group-hover:text-primary transition-colors">
                    <Battery className="w-5 h-5" />
                    <span className="text-xl font-light">380 km</span>
                </div>
                <span className="text-xs font-bold text-emerald-500">82%</span>
            </div>
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-4 text-slate-400">
                    <Shield className="w-5 h-5 text-blue-500" />
                    <span className="text-xl font-light">Autosteer</span>
                </div>
            </div>
          </div>
        </div>

        {/* Quick Controls Grid */}
        <div className="grid grid-cols-2 gap-4">
            <button className="h-20 bg-white/[0.03] rounded-3xl flex items-center justify-center hover:var(--panel-bg-secondary) transition-all active:scale-95 border border-white/5">
                <Fan className="w-7 h-7 text-slate-300" />
            </button>
            <button className="h-20 bg-white/[0.03] rounded-3xl flex items-center justify-center hover:var(--panel-bg-secondary) transition-all active:scale-95 border border-white/5">
                <Thermometer className="w-7 h-7 text-slate-300" />
            </button>
            <button className="h-20 bg-white/[0.03] rounded-3xl flex items-center justify-center hover:var(--panel-bg-secondary) transition-all active:scale-95 border border-white/5">
                <Settings className="w-7 h-7 text-slate-300" />
            </button>
            <button className="h-20 bg-blue-600 rounded-3xl flex items-center justify-center shadow-lg active:scale-95">
                <LayoutGrid className="w-7 h-7 text-primary" />
            </button>
        </div>

        {/* Time */}
        <div className="text-center text-slate-600 font-light tracking-widest uppercase text-[10px]">
            1 Nisan 2026 • 14:45
        </div>
      </div>

      {/* RIGHT CONTENT: The Canvas */}
      <div className="flex-1 flex flex-col relative">
        
        {/* Floating Intelligent Search */}
        <div className="absolute top-10 left-1/2 -translate-x-1/2 z-30 w-full max-w-3xl pointer-events-none">
            <div className="bg-[#111111]/90 backdrop-blur-2xl border border-white/10 h-20 rounded-[2.5rem] flex items-center px-10 gap-6 pointer-events-auto shadow-[0_30px_60px_-15px_rgba(0,0,0,0.8)]">
                <Search className="w-6 h-6 text-slate-500" />
                <input 
                    type="text" 
                    placeholder="Where to, Selim?" 
                    className="bg-transparent border-none outline-none flex-1 text-xl font-light placeholder:text-slate-700"
                />
                <div className="w-px h-8 var(--panel-bg-secondary)" />
                <Mic className="w-6 h-6 text-blue-500 hover:scale-125 transition-transform" />
            </div>
        </div>

        {/* Map Engine */}
        <div className="flex-1 z-10 grayscale-[0.2] brightness-[0.8]">
            <MiniMapWidget />
        </div>

        {/* Bottom Contextual HUD */}
        <div className="absolute bottom-10 left-10 right-10 z-30 flex gap-8 items-end pointer-events-none">
            
            {/* Media Controller (The Glass) */}
            <div className="w-[480px] bg-[#0a0a0a]/95 backdrop-blur-3xl border border-white/10 p-10 rounded-[3.5rem] pointer-events-auto shadow-2xl">
                <div className="flex items-center justify-between mb-8">
                    <div className="flex items-center gap-3">
                        <div className="w-1.5 h-1.5 rounded-full bg-blue-500 shadow-[0_0_10px_#3b82f6]" />
                        <span className="text-[10px] font-black tracking-[0.4em] text-slate-500 uppercase">Entertainment</span>
                    </div>
                    <Music className="w-5 h-5 text-slate-600" />
                </div>
                <MediaHub defaultMusic="spotify" />
            </div>

            {/* Application Tray */}
            <div className="flex-1 bg-[#0a0a0a]/95 backdrop-blur-3xl border border-white/10 p-6 rounded-[3.5rem] flex items-center justify-around pointer-events-auto shadow-2xl">
                {favorites.slice(0, 5).map((id: string, idx: number) => (
                    <button 
                        key={id} 
                        onClick={() => onLaunch(id)}
                        className="w-16 h-16 bg-white/[0.03] rounded-3xl flex items-center justify-center hover:var(--panel-bg-secondary) transition-all active:scale-90 border border-white/5 group"
                    >
                        <span className="text-3xl group-hover:scale-125 transition-transform">{idx === 0 ? '🧭' : idx === 1 ? '🎵' : '📱'}</span>
                    </button>
                ))}
                <div className="w-px h-12 var(--panel-bg-secondary)" />
                <button className="w-16 h-16 var(--panel-bg-secondary) rounded-3xl flex items-center justify-center hover:var(--panel-bg-secondary) transition-all">
                    <Navigation className="w-7 h-7 text-slate-400" />
                </button>
            </div>
        </div>

      </div>

    </div>
  );
}



