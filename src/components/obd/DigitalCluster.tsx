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
                className="text-primary/5"
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
              <span className="text-3xl font-black text-primary">{Math.round(rpm)}</span>
              <span className="text-[10px] text-secondary uppercase tracking-[0.2em] font-black">RPM</span>
            </div>
          </div>

          {/* Speed (Center) */}
          <div className="flex flex-col items-center relative">
            {/* Speed Limit Sign Overlay */}
            <div className="absolute -top-14 right-0 transform translate-x-1/2">
              <SpeedLimitSign limit={speedLimit.limit} isOverSpeed={speedLimit.isOverSpeed} />
            </div>
            
            <span className="text-[10rem] font-black text-primary tracking-tighter leading-none drop-shadow-xl">{Math.round(speed || 0)}</span>
            <span className="text-sm font-black text-blue-500 uppercase tracking-[0.4em] mt-2">km/h</span>
            <span className="text-[11px] font-black text-secondary mt-1 uppercase tracking-[0.2em] opacity-60">{speedLimit.roadName}</span>
          </div>

          {/* Temp/Fuel (Right) */}
          <div className="flex flex-col gap-5 w-36">
            <div className="flex flex-col gap-1.5">
              <div className="flex justify-between text-[10px] font-black text-secondary uppercase tracking-widest">
                <span>Temp</span>
                <span className={engineTemp > 100 ? 'text-red-500' : 'text-blue-500'}>{engineTemp}°C</span>
              </div>
              <div className="h-1.5 var(--panel-bg-secondary) rounded-full overflow-hidden">
                <div 
                  className="h-full bg-blue-600 transition-all duration-500 shadow-[0_0_8px_rgba(37,99,235,0.4)]"
                  style={{ width: `${Math.min(engineTemp, 120)}%` }}
                />
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <div className="flex justify-between text-[10px] font-black text-secondary uppercase tracking-widest">
                <span>Fuel</span>
                <span className={fuelLevel < 15 ? 'text-red-500' : 'text-emerald-500'}>{Math.round(fuelLevel)}%</span>
              </div>
              <div className="h-1.5 var(--panel-bg-secondary) rounded-full overflow-hidden">
                <div 
                  className="h-full bg-emerald-500 transition-all duration-500 shadow-[0_0_8px_rgba(16,185,129,0.4)]"
                  style={{ width: `${fuelLevel}%` }}
                />
              </div>
            </div>
          </div>
        </div>
        
        {/* M-Sport Strip */}
        <div className="flex gap-1.5 mt-8 opacity-40">
          <div className="w-14 h-1 bg-[#0ea5e9]" />
          <div className="w-14 h-1 bg-[#1d4ed8]" />
          <div className="w-14 h-1 bg-[#ef4444]" />
        </div>
      </div>
    );
  }

  if (themePack === 'mercedes') {
    return (
      <div className="flex flex-col items-center justify-center w-full h-full p-8">
        <div className="relative w-full max-w-4xl h-72 flex items-center justify-around glass-card border-none !shadow-none">
          {/* Speed Limit Sign */}
          <div className="absolute -top-6 left-1/2 transform -translate-x-1/2 -translate-y-1/2 z-20 scale-110">
             <SpeedLimitSign limit={speedLimit.limit} isOverSpeed={speedLimit.isOverSpeed} />
          </div>

          {/* Circular Gauges with MBUX glow */}
          <div className="relative flex flex-col items-center gap-3">
            <div className="w-44 h-44 rounded-full border-2 border-cyan-500/20 flex items-center justify-center relative overflow-hidden shadow-[inset_0_0_20px_rgba(6,182,212,0.1)]">
               <div 
                 className="absolute bottom-0 left-0 w-full bg-gradient-to-t from-cyan-500/25 to-transparent transition-all duration-700"
                 style={{ height: `${rpmPercent}%` }}
               />
               <div className="relative z-10 flex flex-col items-center">
                 <span className="text-4xl font-light text-cyan-500 leading-none">{(rpm/1000).toFixed(1)}</span>
                 <span className="text-[10px] text-cyan-500/60 uppercase font-black tracking-widest mt-1">x1000 RPM</span>
               </div>
            </div>
          </div>

          <div className="flex flex-col items-center gap-0">
            <span className="text-[11rem] font-extralight text-primary leading-none tracking-tighter drop-shadow-[0_0_40px_rgba(6,182,212,0.25)]">{Math.round(speed || 0)}</span>
            <span className="text-xs font-black text-cyan-500 uppercase tracking-[0.5em] -mt-4">KILOMETERS PER HOUR</span>
            <span className="text-[11px] font-black text-cyan-500/40 mt-2 uppercase tracking-[0.4em]">{speedLimit.roadName}</span>
          </div>

          <div className="relative flex flex-col items-center gap-3">
            <div className="w-44 h-44 rounded-full border-2 border-cyan-500/20 flex items-center justify-center relative overflow-hidden shadow-[inset_0_0_20px_rgba(6,182,212,0.1)]">
               <div 
                 className="absolute bottom-0 left-0 w-full bg-gradient-to-t from-cyan-500/25 to-transparent transition-all duration-700"
                 style={{ height: `${fuelLevel}%` }}
               />
               <div className="relative z-10 flex flex-col items-center">
                 <span className="text-4xl font-light text-cyan-500 leading-none">{Math.round(fuelLevel)}%</span>
                 <span className="text-[10px] text-cyan-500/60 uppercase font-black tracking-widest mt-1">FUEL LEVEL</span>
               </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Default / Other themes
  return (
    <div className="flex items-center justify-center w-full h-full gap-16 p-8 glass-card border-none !shadow-none">
      <div className="absolute top-6 right-8">
        <SpeedLimitSign limit={speedLimit.limit} isOverSpeed={speedLimit.isOverSpeed} />
      </div>
      <div className="flex flex-col items-end">
        <span className="text-9xl font-black text-primary leading-none tracking-tighter">{Math.round(speed || 0)}</span>
        <span className="text-base font-black text-secondary uppercase tracking-[0.3em] mt-2">KM/H</span>
      </div>
      <div className="w-px h-24 bg-primary/10" />
      <div className="flex flex-col items-start">
        <span className="text-9xl font-black text-blue-600 leading-none tracking-tighter">{rpm}</span>
        <span className="text-base font-black text-secondary uppercase tracking-[0.3em] mt-2">RPM</span>
      </div>
    </div>
  );
});

DigitalCluster.displayName = 'DigitalCluster';


