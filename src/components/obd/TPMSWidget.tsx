import { memo } from 'react';
import { useStore, type TireData } from '../../store/useStore';

const Tire = ({ data, label, pos }: { data: TireData; label: string; pos: string }) => (
  <div className={`absolute ${pos} flex flex-col items-center group`}>
    <div className={`w-10 h-16 rounded-lg border-2 transition-all duration-300 flex items-center justify-center ${
      data.status === 'low' ? 'border-red-500 bg-red-500/20 shadow-[0_0_15px_rgba(239,68,68,0.4)]' : 
      data.status === 'high' ? 'border-yellow-500 bg-yellow-500/20' : 
      'border-blue-500/50 bg-blue-500/10'
    }`}>
      <span className="text-[10px] font-bold text-primary tabular-nums">{data.pressure}</span>
    </div>
    <div className="mt-1 flex flex-col items-center">
      <span className="text-[8px] text-slate-500 uppercase font-black tracking-tighter">{label}</span>
      <span className={`text-[9px] font-bold ${data.temp > 50 ? 'text-orange-400' : 'text-slate-400'}`}>{data.temp}°C</span>
    </div>
  </div>
);

export const TPMSWidget = memo(() => {
  const { settings } = useStore();
  const { tpms } = settings;

  return (
    <div className="relative w-48 h-64 bg-[rgba(255,255,255,0.05)]/50 rounded-3xl border border-white/5 flex items-center justify-center overflow-hidden">
      {/* Car Body Outline */}
      <div className="relative w-24 h-44 border-2 border-slate-800 rounded-[2rem] opacity-50">
        <div className="absolute top-4 left-0 right-0 h-10 border-b border-slate-800" /> {/* Windshield */}
        <div className="absolute bottom-8 left-0 right-0 h-8 border-t border-slate-800" /> {/* Rear window */}
      </div>

      {/* Tires */}
      <Tire data={tpms.fl} label="Ön Sol" pos="top-4 -left-2" />
      <Tire data={tpms.fr} label="Ön Sağ" pos="top-4 -right-2" />
      <Tire data={tpms.rl} label="Arka Sol" pos="bottom-4 -left-2" />
      <Tire data={tpms.rr} label="Arka Sağ" pos="bottom-4 -right-2" />

      {/* Center Label */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-center pointer-events-none">
        <div className="text-[10px] text-blue-400 font-bold uppercase tracking-[0.2em]">TPMS</div>
        <div className="text-[8px] text-slate-600 font-medium">BAR / PSI</div>
      </div>
    </div>
  );
});

TPMSWidget.displayName = 'TPMSWidget';


