import {
  Compass, Music, Phone, ShieldCheck,
  Sun, Thermometer, LayoutGrid,
  Volume2, Battery,
  Sparkles, Moon, Settings
} from 'lucide-react';
import { MiniMapWidget } from '../../map/MiniMapWidget';
import { MediaHub } from '../MediaHub';

export function LuxuryCockpit({ favorites, onLaunch }: { favorites: string[]; onLaunch: (id: string) => void }) {
  return (
    <div className="h-full w-full extreme-bg text-slate-200 p-12 flex flex-col gap-10 overflow-hidden extreme-lux select-none relative">
      <div className="wow-overlay" />
      
      {/* Dynamic Background Light Orbs — blur reduced for GPU perf on Android WebView */}
      <div className="absolute top-[-20%] left-[15%] w-[60%] h-[60%] bg-blue-500/10 rounded-full blur-[80px] animate-pulse" />
      <div className="absolute bottom-[-10%] right-[5%] w-[40%] h-[40%] bg-indigo-500/5 rounded-full blur-[60px] float-slow" />

      {/* HEADER: Ultra-Thin Elegance */}
      <div className="flex justify-between items-center z-10">
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-3 text-blue-300 font-black tracking-[0.5em] uppercase text-[11px] opacity-60">
            <Sparkles className="w-4 h-4" />
            Active Concierge
          </div>
          <h1 className="text-5xl font-extralight text-primary tracking-tight leading-none">
            Welcome, <span className="font-semibold text-primary drop-shadow-[0_0_20px_rgba(255,255,255,0.3)]">Selim</span>
          </h1>
        </div>
        
        <div className="flex gap-6">
            <div className="extreme-card px-10 py-4 rounded-full flex items-center gap-10 border-white/10 shadow-[inset_0_0_20px_rgba(255,255,255,0.02)]">
                <div className="flex items-center gap-4 group">
                    <Sun className="w-5 h-5 text-amber-200 group-hover:rotate-90 transition-transform duration-700" />
                    <span className="text-2xl font-light tabular-nums text-primary">24.5°</span>
                </div>
                <div className="w-px h-6 var(--panel-bg-secondary)" />
                <div className="flex items-center gap-4">
                    <Battery className="w-5 h-5 text-emerald-400" />
                    <span className="text-2xl font-light tabular-nums text-primary">85%</span>
                </div>
            </div>
            <div className="extreme-card px-12 py-4 rounded-full border-white/10 shadow-[0_20px_40px_rgba(0,0,0,0.4)]">
                <span className="text-4xl font-extralight tracking-tighter text-primary tabular-nums">14:45</span>
            </div>
        </div>
      </div>

      {/* MAIN LAYOUT */}
      <div className="flex-1 flex gap-10 z-10 min-h-0">
        
        {/* LEFT: Management Center */}
        <div className="w-[30%] flex flex-col gap-10">
          <div className="extreme-card p-12 rounded-[4rem] flex-1 flex flex-col justify-between group shadow-[inset_0_0_40px_rgba(255,255,255,0.03)] border-white/10 hover:border-white/20 transition-all">
            <div className="absolute top-0 right-0 p-12 opacity-[0.02] group-hover:opacity-[0.08] group-hover:scale-110 transition-all duration-1000">
                <ShieldCheck className="w-64 h-64" />
            </div>
            <div>
                <div className="flex items-center gap-4 mb-12">
                    <div className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_20px_#34d399] animate-pulse" />
                    <span className="text-[11px] font-black tracking-[0.5em] text-slate-500 uppercase">Automotive Health</span>
                </div>
                <div className="space-y-10">
                    {[
                        { label: 'Drive Profile', val: 'Pure Comfort' },
                        { label: 'Air Filtration', val: 'Medical Grade' },
                        { label: 'Next Maintenance', val: '2,450 km' }
                    ].map(item => (
                        <div key={item.label} className="group cursor-default">
                            <div className="flex justify-between items-baseline mb-2">
                                <span className="text-sm text-slate-500 font-medium group-hover:text-slate-300 transition-colors">{item.label}</span>
                                <span className="text-xl font-light text-primary tracking-wide">{item.val}</span>
                            </div>
                            <div className="h-[1px] bg-gradient-to-r from-transparent via-white/10 to-transparent scale-x-0 group-hover:scale-x-100 transition-transform duration-700" />
                        </div>
                    ))}
                </div>
            </div>
            <button className="w-full py-6 bg-white/[0.03] rounded-3xl border border-white/5 text-[11px] font-black tracking-[0.4em] uppercase hover:bg-white/[0.08] hover:border-white/20 transition-all active:scale-95 shadow-xl">
                Intelligence Panel
            </button>
          </div>

          <div className="h-[32%] extreme-card rounded-[3.5rem] p-8 grid grid-cols-2 gap-6">
             {favorites.slice(0, 4).map((id: string, idx: number) => (
                <button 
                  key={id} 
                  onClick={() => onLaunch(id)}
                  className="rgba(15,23,42,0.02) rounded-[3rem] border border-white/5 flex flex-col items-center justify-center gap-4 hover:bg-white/[0.06] hover:border-white/20 transition-all group active:scale-90 shadow-lg"
                >
                  <div className="w-16 h-16 bg-white/[0.03] rounded-[2rem] flex items-center justify-center group-hover:scale-110 group-hover:rotate-6 transition-all duration-500 border border-white/5">
                    {idx === 0 ? <Phone className="w-7 h-7 text-blue-200" /> : <LayoutGrid className="w-7 h-7 text-slate-400" />}
                  </div>
                  <span className="text-[10px] font-black tracking-[0.3em] text-slate-500 uppercase group-hover:text-primary transition-colors">Select {idx + 1}</span>
                </button>
             ))}
          </div>
        </div>

        {/* CENTER: The Scenic Map */}
        <div className="flex-1 flex flex-col gap-10">
          <div className="flex-1 extreme-card rounded-[5rem] overflow-hidden relative shadow-[0_50px_120px_-30px_rgba(0,0,0,1)] group border-white/10">
             <MiniMapWidget />
             <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-black/80 opacity-70 pointer-events-none" />
             <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_120%,rgba(59,130,246,0.1),transparent_50%)] pointer-events-none" />
             
             {/* HUD Overlay v2 */}
             <div className="absolute bottom-12 left-12 right-12 flex justify-between items-end">
                <div className="rgba(15,23,42,0.02) backdrop-blur-xl border border-white/10 p-10 rounded-[4rem] flex items-center gap-10 shadow-2xl group-hover:translate-y-[-10px] transition-transform duration-700">
                    <div className="w-20 h-20 bg-blue-600 rounded-full flex items-center justify-center border border-white/20 shadow-[0_0_40px_rgba(59,130,246,0.4)] group-hover:rotate-[360deg] transition-transform duration-1000">
                        <Compass className="w-10 h-10 text-primary" />
                    </div>
                    <div>
                        <div className="text-[11px] font-black text-blue-300 tracking-[0.5em] uppercase mb-2 opacity-60">Active Navigation</div>
                        <div className="text-3xl font-light text-primary tracking-tight">Coastline Boulevard <span className="text-slate-500 ml-2">6 min</span></div>
                    </div>
                </div>
                
                <div className="rgba(15,23,42,0.02) backdrop-blur-xl border border-white/10 p-10 rounded-[4rem] flex flex-col items-center shadow-2xl min-w-[200px]">
                    <span className="text-[11px] font-black text-slate-500 tracking-[0.5em] uppercase mb-2 opacity-60">Velocity</span>
                    <span className="text-7xl font-extralight text-primary tracking-tighter tabular-nums drop-shadow-2xl">
                        72<span className="text-base ml-2 text-blue-300 font-bold tracking-[0.2em] uppercase">km/h</span>
                    </span>
                </div>
             </div>
          </div>
        </div>

        {/* RIGHT: Sonic Experience */}
        <div className="w-[30%] flex flex-col gap-10">
          <div className="flex-1 extreme-card rounded-[4rem] p-12 flex flex-col relative overflow-hidden group shadow-[inset_0_0_50px_rgba(255,255,255,0.02)]">
             <div className="absolute -bottom-20 -right-20 p-10 opacity-[0.01] group-hover:opacity-[0.06] group-hover:scale-110 transition-all duration-1000">
                <Music className="w-96 h-96 text-primary" />
             </div>
             <div className="flex items-center justify-between mb-12">
                <div className="flex items-center gap-5">
                    <div className="flex gap-1 h-5 items-end">
                        {[1,2,3,4].map(i => (
                          <div 
                            key={i} 
                            className="w-1 bg-blue-300 rounded-full animate-pulse" 
                            style={{ 
                              height: `${40 + (i % 3) * 20}%`, 
                              animationDelay: `${i * 100}ms` 
                            }} 
                          />
                        ))}
                    </div>
                    <span className="text-[11px] font-black tracking-[0.5em] text-slate-500 uppercase">Audio Fidelity</span>
                </div>
                <Volume2 className="w-6 h-6 text-slate-500 hover:text-primary transition-colors" />
             </div>
             
             <div className="flex-1 scale-110 origin-top">
                <MediaHub defaultMusic="spotify" />
             </div>
          </div>

          <div className="h-[28%] grid grid-cols-2 gap-8">
             <button className="extreme-card rounded-[3.5rem] flex flex-col items-center justify-center gap-4 hover:bg-white/[0.05] transition-all group shadow-xl border-white/5">
                <Thermometer className="w-10 h-10 text-slate-500 group-hover:text-blue-200 transition-all duration-500 group-hover:scale-110" />
                <span className="text-[10px] font-black tracking-[0.4em] text-slate-500 uppercase">Climate</span>
             </button>
             <button className="bg-gradient-to-br from-indigo-600 via-blue-700 to-indigo-900 rounded-[3.5rem] flex flex-col items-center justify-center gap-4 shadow-[0_30px_60px_rgba(59,130,246,0.2)] hover:brightness-125 transition-all active:scale-95 group border border-white/10">
                <Moon className="w-10 h-10 text-primary group-hover:rotate-45 transition-transform duration-700" />
                <span className="text-[10px] font-black tracking-[0.4em] text-primary uppercase">Ambient</span>
             </button>
          </div>
        </div>

      </div>

      {/* DOCK: The Control Bar */}
      <div className="h-28 rgba(15,23,42,0.02) backdrop-blur-xl border border-white/10 rounded-[4rem] flex items-center justify-center gap-20 z-10 shadow-[0_40px_100px_rgba(0,0,0,0.6)] max-w-6xl mx-auto px-24 border-t-white/20">
          {[Compass, Phone, LayoutGrid, Music, Settings].map((Icon, idx) => (
              <button key={idx} className={`relative group transition-all duration-500 ${idx === 2 ? 'var(--panel-bg-secondary) p-6 rounded-[2rem] border border-white/20 shadow-2xl scale-110 translate-y-[-10px]' : 'text-slate-500 hover:text-primary hover:scale-125'}`}>
                  <Icon className={`${idx === 2 ? 'w-10 h-10' : 'w-8 h-8'} transition-transform duration-500 group-hover:rotate-6`} />
                  {idx !== 2 && <div className="absolute bottom-[-15px] left-1/2 -translate-x-1/2 w-1.5 h-1.5 bg-blue-400 rounded-full opacity-0 group-hover:opacity-100 shadow-[0_0_10px_#3b82f6] transition-all" />}
              </button>
          ))}
      </div>

    </div>
  );
}



