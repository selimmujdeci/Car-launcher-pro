import { memo } from 'react';
import { useOBDState } from '../../platform/obdService';
import { useStore } from '../../store/useStore';
import { useSpeedLimit } from '../../platform/speedLimitService';

// Speed Limit Sign Component - Moved outside to fix lint error
const SpeedLimitSign = ({ limit, isOverSpeed }: { limit: number; isOverSpeed: boolean }) => (
  <div className={`relative flex items-center justify-center w-14 h-14 rounded-full border-[6px] bg-white transition-all duration-300 ${isOverSpeed ? 'border-red-600 scale-110 animate-pulse ring-4 ring-red-600/30' : 'border-red-500'}`}>
    <span className="text-xl font-black text-black leading-none">{limit}</span>
  </div>
);

export const DigitalCluster = memo(() => {
  const { speed, rpm, engineTemp, fuelLevel } = useOBDState();
  const { settings } = useStore();
  const { themePack } = settings;
  const speedLimit = useSpeedLimit(speed);

  // Gauge calculations
  const rpmPercent = Math.min((rpm / 8000) * 100, 100);

  if (themePack === 'bmw') {
    return (
      <div className="flex flex-col items-center justify-center w-full h-full p-6 font-sans">
        <div className="relative w-full max-w-2xl aspect-[21/9] flex items-center justify-between">
          {/* RPM Gauge (Left) */}
          <div className="relative w-48 h-48 flex items-center justify-center">
            <svg className="w-full h-full transform -rotate-90">
              <circle
                cx="50%" cy="50%" r="45%"
                fill="none" stroke="currentColor" strokeWidth="4"
                className="text-slate-800"
              />
              <circle
                cx="50%" cy="50%" r="45%"
                fill="none" stroke="currentColor" strokeWidth="8"
                strokeDasharray="283"
                strokeDashoffset={283 - (283 * rpmPercent) / 100}
                className="text-blue-600 transition-all duration-300 ease-out"
                strokeLinecap="round"
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-2xl font-bold text-white">{Math.round(rpm)}</span>
              <span className="text-[10px] text-slate-500 uppercase tracking-widest">RPM</span>
            </div>
          </div>

          {/* Speed (Center) */}
          <div className="flex flex-col items-center relative">
            {/* Speed Limit Sign Overlay */}
            <div className="absolute -top-12 right-0 transform translate-x-1/2">
              <SpeedLimitSign limit={speedLimit.limit} isOverSpeed={speedLimit.isOverSpeed} />
            </div>
            
            <span className="text-8xl font-black text-white tracking-tighter leading-none">{speed}</span>
            <span className="text-sm font-bold text-blue-400 uppercase tracking-[0.3em] mt-2">km/h</span>
            <span className="text-[10px] font-bold text-slate-600 mt-1 uppercase tracking-widest">{speedLimit.roadName}</span>
          </div>

          {/* Temp/Fuel (Right) */}
          <div className="flex flex-col gap-4 w-32">
            <div className="flex flex-col gap-1">
              <div className="flex justify-between text-[10px] font-bold text-slate-500 uppercase">
                <span>Temp</span>
                <span className={engineTemp > 100 ? 'text-red-500' : 'text-blue-400'}>{engineTemp}°C</span>
              </div>
              <div className="h-1 bg-slate-800 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-blue-500 transition-all duration-500"
                  style={{ width: `${Math.min(engineTemp, 120)}%` }}
                />
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <div className="flex justify-between text-[10px] font-bold text-slate-500 uppercase">
                <span>Fuel</span>
                <span className={fuelLevel < 15 ? 'text-red-500' : 'text-blue-400'}>{Math.round(fuelLevel)}%</span>
              </div>
              <div className="h-1 bg-slate-800 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-blue-500 transition-all duration-500"
                  style={{ width: `${fuelLevel}%` }}
                />
              </div>
            </div>
          </div>
        </div>
        
        {/* M-Sport Strip */}
        <div className="flex gap-1 mt-8">
          <div className="w-12 h-1 bg-[#0ea5e9]" />
          <div className="w-12 h-1 bg-[#1d4ed8]" />
          <div className="w-12 h-1 bg-[#ef4444]" />
        </div>
      </div>
    );
  }

  if (themePack === 'mercedes') {
    return (
      <div className="flex flex-col items-center justify-center w-full h-full p-8">
        <div className="relative w-full max-w-3xl h-64 flex items-center justify-around bg-gradient-to-b from-cyan-500/5 to-transparent rounded-[4rem] border border-cyan-500/10 backdrop-blur-xl">
          {/* Speed Limit Sign */}
          <div className="absolute -top-4 left-1/2 transform -translate-x-1/2 -translate-y-1/2 z-20">
             <SpeedLimitSign limit={speedLimit.limit} isOverSpeed={speedLimit.isOverSpeed} />
          </div>

          {/* Circular Gauges with MBUX glow */}
          <div className="relative flex flex-col items-center gap-2">
            <div className="w-40 h-40 rounded-full border-2 border-cyan-500/20 flex items-center justify-center relative overflow-hidden">
               <div 
                 className="absolute bottom-0 left-0 w-full bg-gradient-to-t from-cyan-500/20 to-transparent transition-all duration-500"
                 style={{ height: `${rpmPercent}%` }}
               />
               <div className="relative z-10 flex flex-col items-center">
                 <span className="text-3xl font-light text-cyan-400 leading-none">{(rpm/1000).toFixed(1)}</span>
                 <span className="text-[10px] text-cyan-500/60 uppercase">x1000 RPM</span>
               </div>
            </div>
          </div>

          <div className="flex flex-col items-center gap-0">
            <span className="text-9xl font-extralight text-white leading-none tracking-tighter drop-shadow-[0_0_30px_rgba(6,182,212,0.3)]">{speed}</span>
            <span className="text-xs font-medium text-cyan-400 uppercase tracking-widest -mt-2">KILOMETERS PER HOUR</span>
            <span className="text-[10px] font-bold text-cyan-500/40 mt-1 uppercase tracking-[0.4em]">{speedLimit.roadName}</span>
          </div>

          <div className="relative flex flex-col items-center gap-2">
            <div className="w-40 h-40 rounded-full border-2 border-cyan-500/20 flex items-center justify-center relative overflow-hidden">
               <div 
                 className="absolute bottom-0 left-0 w-full bg-gradient-to-t from-cyan-500/20 to-transparent transition-all duration-500"
                 style={{ height: `${fuelLevel}%` }}
               />
               <div className="relative z-10 flex flex-col items-center">
                 <span className="text-3xl font-light text-cyan-400 leading-none">{Math.round(fuelLevel)}%</span>
                 <span className="text-[10px] text-cyan-500/60 uppercase">FUEL LEVEL</span>
               </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Default / Other themes
  return (
    <div className="flex items-center justify-center w-full h-full gap-12 p-6">
      <div className="absolute top-4 right-4">
        <SpeedLimitSign limit={speedLimit.limit} isOverSpeed={speedLimit.isOverSpeed} />
      </div>
      <div className="flex flex-col items-end">
        <span className="text-7xl font-bold text-white leading-none">{speed}</span>
        <span className="text-sm font-bold text-slate-500 uppercase tracking-widest mt-1">KM/H</span>
      </div>
      <div className="w-px h-16 bg-white/10" />
      <div className="flex flex-col items-start">
        <span className="text-7xl font-bold text-blue-500 leading-none">{rpm}</span>
        <span className="text-sm font-bold text-slate-500 uppercase tracking-widest mt-1">RPM</span>
      </div>
    </div>
  );
});

DigitalCluster.displayName = 'DigitalCluster';
