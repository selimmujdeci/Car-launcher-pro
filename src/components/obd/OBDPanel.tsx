import { memo, useEffect } from 'react';
import { Thermometer, Fuel, type LucideIcon } from 'lucide-react';
import { useOBDState, startOBD } from '../../platform/obdService';

const MetricCard = ({
  icon: Icon,
  label,
  value,
  unit,
  color,
  percent
}: {
  icon: LucideIcon,
  label: string, 
  value: string | number, 
  unit: string, 
  color: string, 
  percent?: number 
}) => (
  <div className="flex-1 flex flex-col gap-2 p-3 rounded-2xl bg-white/[0.03] border border-white/[0.05] group/metric transition-all duration-300 hover:bg-white/[0.06] hover:border-white/[0.1]">
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        <div className={`p-1.5 rounded-lg bg-${color}-500/10 border border-${color}-500/20 text-${color}-400 group-hover/metric:scale-110 transition-transform`}>
          <Icon className="w-3.5 h-3.5" />
        </div>
        <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">{label}</span>
      </div>
      <div className="flex items-baseline gap-0.5">
        <span className="text-sm font-black text-white">{value}</span>
        <span className="text-[9px] font-bold text-slate-600 uppercase">{unit}</span>
      </div>
    </div>
    {percent !== undefined && (
      <div className="h-1 bg-white/5 rounded-full overflow-hidden">
        <div 
          className={`h-full bg-${color}-500 transition-all duration-500`} 
          style={{ width: `${percent}%` }}
        />
      </div>
    )}
  </div>
);

function OBDPanelInner() {
  const obd = useOBDState();

  useEffect(() => {
    startOBD();
  }, []);

  const rpmPercent = (obd.rpm / 8000) * 100;
  const speedPercent = (obd.speed / 240) * 100;

  return (
    <div 
      className="flex flex-col w-full rounded-[2.2rem] border border-white/10 p-5 overflow-hidden relative group transition-all duration-300 shadow-[0_15px_50px_rgba(0,0,0,0.4)]"
      style={{ background: 'linear-gradient(165deg, rgba(15,23,42,0.8) 0%, rgba(10,15,30,0.95) 100%)', backdropFilter: 'blur(40px)' }}
    >
      <div className="absolute top-4 right-5 flex items-center gap-2">
        <div className={`flex items-center gap-1.5 px-2 py-1 rounded-full text-[8px] font-black uppercase tracking-widest border transition-colors ${obd.connectionState === 'connected' ? 'bg-green-500/10 border-green-500/20 text-green-400' : 'bg-amber-500/10 border-amber-500/20 text-amber-400'}`}>
          <div className={`w-1 h-1 rounded-full ${obd.connectionState === 'connected' ? 'bg-green-400 animate-pulse' : 'bg-amber-400'}`} />
          {obd.connectionState === 'connected' ? (obd.source === 'real' ? 'CAN-BUS' : 'MOCK') : 'WAIT'}
        </div>
      </div>

      <div className="text-blue-400 font-black text-[9px] uppercase tracking-[0.4em] mb-4 opacity-60">VERİ PANELİ</div>
      
      <div className="flex flex-col lg:flex-row gap-4 w-full">
        {/* Hız ve RPM Grubu */}
        <div className="flex-[2] flex gap-3">
          <div className="flex-1 flex flex-col justify-center p-4 rounded-2xl bg-white/[0.02] border border-white/5 relative overflow-hidden group/speed">
            <div className="absolute -right-4 -bottom-4 w-24 h-24 bg-blue-500/5 rounded-full blur-2xl pointer-events-none" />
            <div className="flex items-baseline gap-2">
              <span className="text-5xl font-black text-white tracking-tighter tabular-nums">{obd.speed}</span>
              <span className="text-blue-400 font-black text-[10px] uppercase tracking-widest">KM/H</span>
            </div>
            <div className="mt-2 h-1 bg-white/5 rounded-full overflow-hidden">
              <div 
                className="h-full bg-gradient-to-r from-blue-600 to-blue-400 transition-all duration-300" 
                style={{ width: `${speedPercent}%` }}
              />
            </div>
          </div>

          <div className="flex-1 flex flex-col justify-center p-4 rounded-2xl bg-white/[0.02] border border-white/5 relative overflow-hidden group/rpm">
            <div className="flex items-baseline gap-1">
              <span className="text-2xl font-black text-white tracking-tighter tabular-nums">{obd.rpm}</span>
              <span className="text-purple-400 font-black text-[8px] uppercase tracking-widest">RPM</span>
            </div>
            <div className="mt-2 h-1 bg-white/5 rounded-full overflow-hidden">
              <div 
                className="h-full bg-gradient-to-r from-purple-600 to-purple-400 transition-all duration-300" 
                style={{ width: `${rpmPercent}%` }}
              />
            </div>
          </div>
        </div>

        {/* Diğer Metrikler */}
        <div className="flex-1 grid grid-cols-2 gap-3">
          <MetricCard 
            icon={Thermometer} 
            label="MOTOR" 
            value={obd.engineTemp} 
            unit="°C" 
            color="orange" 
            percent={((obd.engineTemp - 40) / 80) * 100}
          />
          <MetricCard 
            icon={Fuel} 
            label="YAKIT" 
            value={Math.round(obd.fuelLevel)} 
            unit="%" 
            color="blue" 
            percent={obd.fuelLevel}
          />
        </div>
      </div>
    </div>
  );
}

export const OBDPanel = memo(OBDPanelInner);
