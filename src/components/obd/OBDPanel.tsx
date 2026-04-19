import { memo } from 'react';
import {
  Thermometer, Fuel, Zap, Battery, BatteryCharging,
  Gauge, Wind, Flame, type LucideIcon,
} from 'lucide-react';
import { useOBDState, type VehicleType } from '../../platform/obdService';
import { useStore } from '../../store/useStore';

/* ── Metric card ─────────────────────────────────────────── */

const MetricCard = ({
  icon: Icon, label, value, unit, color, percent, warn,
}: {
  icon: LucideIcon; label: string; value: string | number;
  unit: string; color: string; percent?: number; warn?: boolean;
}) => (
  <div className={`flex-1 flex flex-col gap-2 p-3 rounded-2xl border transition-all duration-300
    ${warn
      ? 'bg-red-500/10 border-red-500/30'
      : 'bg-white/[0.03] border-white/[0.05] hover:bg-white/[0.06] hover:border-white/[0.1]'
    } group/metric`}>
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        <div className={`p-1.5 rounded-lg bg-${color}-500/10 border border-${color}-500/20 text-${color}-400 group-hover/metric:scale-110 transition-transform`}>
          <Icon className="w-3.5 h-3.5" />
        </div>
        <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">{label}</span>
      </div>
      <div className="flex items-baseline gap-0.5">
        <span className={`text-sm font-black tabular-nums ${warn ? 'text-red-400' : 'text-white'}`}>{value}</span>
        <span className="text-[9px] font-bold text-slate-600 uppercase">{unit}</span>
      </div>
    </div>
    {percent !== undefined && (
      <div className="h-1 bg-white/5 rounded-full overflow-hidden">
        <div
          className={`h-full transition-all duration-500 ${
            warn ? 'bg-red-500' : `bg-${color}-500`
          }`}
          style={{ width: `${Math.max(0, Math.min(100, percent))}%` }}
        />
      </div>
    )}
  </div>
);

/* ── Vehicle type badge ──────────────────────────────────── */

const TYPE_LABELS: Record<VehicleType, string> = {
  ice:    'BENZİN',
  diesel: 'DİZEL',
  ev:     'ELEKTRİK',
  hybrid: 'HİBRİT',
  phev:   'P-HİBRİT',
};

const TYPE_COLORS: Record<VehicleType, string> = {
  ice:    'blue',
  diesel: 'amber',
  ev:     'emerald',
  hybrid: 'cyan',
  phev:   'violet',
};

/* ── Speed + primary metric block ───────────────────────── */

function SpeedBlock({ speed, maxSpeed }: { speed: number; maxSpeed: number }) {
  return (
    <div className="flex-1 flex flex-col justify-center p-5 rounded-2xl bg-white/[0.04] border border-white/10 relative overflow-hidden">
      <div className="absolute -right-4 -bottom-4 w-24 h-24 bg-blue-500/10 rounded-full blur-2xl pointer-events-none" />
      <div className="flex items-baseline gap-2.5">
        <span className="text-6xl font-black text-white tracking-tighter tabular-nums">{speed}</span>
        <span className="text-blue-400 font-black text-[12px] uppercase tracking-widest">KM/H</span>
      </div>
      <div className="mt-3 h-1.5 bg-white/5 rounded-full overflow-hidden">
        <div
          className="h-full bg-gradient-to-r from-blue-600 to-blue-400 transition-all duration-300 shadow-[0_0_10px_rgba(59,130,246,0.5)]"
          style={{ width: `${(speed / maxSpeed) * 100}%` }}
        />
      </div>
    </div>
  );
}

/* ── ICE / Diesel main view ──────────────────────────────── */

function ICEView({ obd, maxRpm }: { obd: ReturnType<typeof useOBDState>; maxRpm: number }) {
  const rpmPercent = obd.rpm > 0 ? (obd.rpm / maxRpm) * 100 : 0;
  const tempWarn   = obd.engineTemp > 100;
  const fuelWarn   = obd.fuelLevel > 0 && obd.fuelLevel < 12;

  return (
    <div className="flex flex-col lg:flex-row gap-5 w-full">
      <div className="flex-[2] flex gap-4">
        <SpeedBlock speed={obd.speed} maxSpeed={240} />
        <div className="flex-1 flex flex-col justify-center p-5 rounded-2xl bg-white/[0.04] border border-white/10 relative overflow-hidden">
          <div className="flex items-baseline gap-1.5">
            <span className="text-3xl font-black text-white tracking-tighter tabular-nums">
              {obd.rpm > 0 ? obd.rpm : '—'}
            </span>
            <span className="text-purple-400 font-black text-[10px] uppercase tracking-widest">RPM</span>
          </div>
          <div className="mt-3 h-1.5 bg-white/5 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-purple-600 to-purple-400 transition-all duration-300"
              style={{ width: `${rpmPercent}%` }}
            />
          </div>
          {/* Diesel: boost basıncı */}
          {obd.boostPressure > 0 && (
            <div className="mt-2 flex items-center gap-1">
              <Wind className="w-3 h-3 text-cyan-400" />
              <span className="text-[9px] text-cyan-400 font-bold">{obd.boostPressure} kPa</span>
            </div>
          )}
        </div>
      </div>

      <div className="flex-1 grid grid-cols-2 gap-4">
        <MetricCard
          icon={Thermometer} label="MOTOR" unit="°C"
          value={obd.engineTemp > 0 ? obd.engineTemp : '—'}
          color={tempWarn ? 'red' : 'orange'}
          percent={obd.engineTemp > 0 ? ((obd.engineTemp - 40) / 80) * 100 : undefined}
          warn={tempWarn}
        />
        <MetricCard
          icon={Fuel} label="YAKIT" unit="%"
          value={obd.fuelLevel > 0 ? Math.round(obd.fuelLevel) : '—'}
          color={fuelWarn ? 'red' : 'blue'}
          percent={obd.fuelLevel > 0 ? obd.fuelLevel : undefined}
          warn={fuelWarn}
        />
        {obd.throttle > 0 && (
          <MetricCard
            icon={Gauge} label="GAZ" unit="%"
            value={obd.throttle} color="cyan"
            percent={obd.throttle}
          />
        )}
        {obd.egt > 0 && (
          <MetricCard
            icon={Flame} label="EGT" unit="°C"
            value={obd.egt} color="red"
            warn={obd.egt > 650}
          />
        )}
      </div>
    </div>
  );
}

/* ── EV main view ────────────────────────────────────────── */

function EVView({ obd }: { obd: ReturnType<typeof useOBDState> }) {
  const battWarn  = obd.batteryLevel >= 0 && obd.batteryLevel < 15;
  const tempWarn  = obd.batteryTemp > 42;
  const charging  = obd.chargingState === 'charging' || obd.chargingState === 'fast_charging';
  const isRegen   = obd.motorPower < 0;

  return (
    <div className="flex flex-col lg:flex-row gap-5 w-full">
      <div className="flex-[2] flex gap-4">
        <SpeedBlock speed={obd.speed} maxSpeed={240} />

        {/* Batarya büyük gösterge */}
        <div className={`flex-1 flex flex-col justify-center p-5 rounded-2xl border relative overflow-hidden ${
          charging ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-white/[0.04] border-white/10'
        }`}>
          <div className="flex items-center gap-2 mb-1">
            {charging
              ? <BatteryCharging className="w-4 h-4 text-emerald-400" />
              : <Battery className="w-4 h-4 text-emerald-400" />
            }
            <span className="text-[9px] font-bold text-emerald-400 uppercase tracking-widest">
              {charging ? (obd.chargingState === 'fast_charging' ? 'HIZLI ŞRJ' : 'ŞARJ') : 'BATARYA'}
            </span>
          </div>
          <div className="flex items-baseline gap-1.5">
            <span className={`text-4xl font-black tracking-tighter tabular-nums ${battWarn ? 'text-red-400' : 'text-white'}`}>
              {obd.batteryLevel >= 0 ? Math.round(obd.batteryLevel) : '—'}
            </span>
            <span className="text-emerald-400 font-black text-[10px] uppercase">%</span>
          </div>
          {obd.batteryLevel >= 0 && (
            <div className="mt-2 h-1.5 bg-white/5 rounded-full overflow-hidden">
              <div
                className={`h-full transition-all duration-500 ${battWarn ? 'bg-red-500' : charging ? 'bg-emerald-400' : 'bg-emerald-600'}`}
                style={{ width: `${obd.batteryLevel}%` }}
              />
            </div>
          )}
          {charging && obd.chargingPower > 0 && (
            <div className="mt-1 text-[9px] text-emerald-400 font-bold">{obd.chargingPower.toFixed(1)} kW</div>
          )}
        </div>
      </div>

      <div className="flex-1 grid grid-cols-2 gap-4">
        {obd.range >= 0 && (
          <MetricCard
            icon={Gauge} label="MENZİL" unit="KM"
            value={Math.round(obd.range)} color="blue"
          />
        )}
        {obd.motorPower !== -1 && (
          <MetricCard
            icon={Zap} label={isRegen ? 'REGEN' : 'GÜÇ'} unit="KW"
            value={Math.abs(Math.round(obd.motorPower))}
            color={isRegen ? 'emerald' : 'yellow'}
          />
        )}
        {obd.batteryTemp > 0 && (
          <MetricCard
            icon={Thermometer} label="BAT. ISI" unit="°C"
            value={obd.batteryTemp} color={tempWarn ? 'red' : 'orange'}
            warn={tempWarn}
          />
        )}
        {obd.throttle > 0 && (
          <MetricCard
            icon={Gauge} label="PEDAL" unit="%"
            value={obd.throttle} color="cyan"
            percent={obd.throttle}
          />
        )}
      </div>
    </div>
  );
}

/* ── Hybrid main view ────────────────────────────────────── */

function HybridView({ obd, maxRpm }: { obd: ReturnType<typeof useOBDState>; maxRpm: number }) {
  const fuelWarn = obd.fuelLevel > 0 && obd.fuelLevel < 12;
  const battWarn = obd.batteryLevel >= 0 && obd.batteryLevel < 15;

  return (
    <div className="flex flex-col lg:flex-row gap-5 w-full">
      <div className="flex-[2] flex gap-4">
        <SpeedBlock speed={obd.speed} maxSpeed={240} />

        {/* Batarya + yakıt ikili */}
        <div className="flex-1 flex flex-col gap-2">
          <div className={`flex-1 flex flex-col justify-center px-4 py-3 rounded-xl border ${
            battWarn ? 'bg-red-500/10 border-red-500/25' : 'bg-emerald-500/10 border-emerald-500/20'
          }`}>
            <span className="text-[8px] font-bold text-emerald-400 uppercase tracking-widest mb-0.5">BATARYA</span>
            <div className="flex items-baseline gap-1">
              <span className={`text-2xl font-black tabular-nums ${battWarn ? 'text-red-400' : 'text-white'}`}>
                {obd.batteryLevel >= 0 ? Math.round(obd.batteryLevel) : '—'}
              </span>
              <span className="text-[9px] text-emerald-400 font-bold">%</span>
            </div>
            {obd.batteryLevel >= 0 && (
              <div className="mt-1 h-1 bg-white/5 rounded-full overflow-hidden">
                <div className={`h-full ${battWarn ? 'bg-red-500' : 'bg-emerald-500'}`}
                  style={{ width: `${obd.batteryLevel}%` }} />
              </div>
            )}
          </div>
          <div className={`flex-1 flex flex-col justify-center px-4 py-3 rounded-xl border ${
            fuelWarn ? 'bg-red-500/10 border-red-500/25' : 'bg-blue-500/10 border-blue-500/20'
          }`}>
            <span className="text-[8px] font-bold text-blue-400 uppercase tracking-widest mb-0.5">YAKIT</span>
            <div className="flex items-baseline gap-1">
              <span className={`text-2xl font-black tabular-nums ${fuelWarn ? 'text-red-400' : 'text-white'}`}>
                {obd.fuelLevel > 0 ? Math.round(obd.fuelLevel) : '—'}
              </span>
              <span className="text-[9px] text-blue-400 font-bold">%</span>
            </div>
            {obd.fuelLevel > 0 && (
              <div className="mt-1 h-1 bg-white/5 rounded-full overflow-hidden">
                <div className={`h-full ${fuelWarn ? 'bg-red-500' : 'bg-blue-500'}`}
                  style={{ width: `${obd.fuelLevel}%` }} />
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="flex-1 grid grid-cols-2 gap-3">
        {obd.range >= 0 && (
          <MetricCard icon={Gauge} label="MENZİL" unit="KM"
            value={Math.round(obd.range)} color="blue" />
        )}
        {obd.motorPower !== -1 && (
          <MetricCard icon={Zap} label="ELK. GÜÇ" unit="KW"
            value={Math.abs(Math.round(obd.motorPower))} color="emerald" />
        )}
        {obd.engineTemp > 0 && (
          <MetricCard icon={Thermometer} label="MOTOR ISI" unit="°C"
            value={obd.engineTemp} color="orange"
            warn={obd.engineTemp > 100} />
        )}
        {obd.rpm > 0 && maxRpm > 0 && (
          <MetricCard icon={Gauge} label="RPM" unit=""
            value={obd.rpm} color="purple"
            percent={(obd.rpm / maxRpm) * 100} />
        )}
      </div>
    </div>
  );
}

/* ── Main OBD Panel ──────────────────────────────────────── */

function OBDPanelInner() {
  const obd = useOBDState();
  const { settings } = useStore();

  // Aktif araç profilinden araç tipini al
  const activeProfile = settings.vehicleProfiles.find(
    (p) => p.id === settings.activeVehicleProfileId,
  );
  const vehicleType: VehicleType = activeProfile?.vehicleType ?? obd.vehicleType;
  const maxRpm   = activeProfile?.maxRpm ?? 8000;
  const typeColor = TYPE_COLORS[vehicleType];

  return (
    <div className="flex flex-col w-full glass-card p-6 overflow-hidden relative group transition-all duration-300 border-none !shadow-none">

      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3">
          <span className={`text-[10px] font-black uppercase tracking-[0.4em] text-${typeColor}-400`}>
            {TYPE_LABELS[vehicleType]}
          </span>
          <span className="text-white/20 text-[10px]">|</span>
          <span className="text-white/30 text-[10px] font-bold uppercase tracking-widest">VERİ PANELİ</span>
        </div>

        {/* Bağlantı durumu */}
        <div className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest border transition-colors ${
          obd.connectionState === 'connected'
            ? 'bg-green-500/10 border-green-500/25 text-emerald-400'
            : 'bg-amber-500/10 border-amber-500/25 text-amber-400'
        }`}>
          <div className={`w-1.5 h-1.5 rounded-full ${
            obd.connectionState === 'connected'
              ? 'bg-emerald-500 animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.6)]'
              : 'bg-amber-500'
          }`} />
          {obd.connectionState === 'connected'
            ? (obd.source === 'real' ? 'CAN-BUS' : 'DEMO')
            : 'BAĞLANILIYOR'}
        </div>
      </div>

      {/* Vehicle-type-specific content */}
      {(vehicleType === 'ev') && (
        <EVView obd={obd} />
      )}
      {(vehicleType === 'hybrid' || vehicleType === 'phev') && (
        <HybridView obd={obd} maxRpm={maxRpm} />
      )}
      {(vehicleType === 'ice' || vehicleType === 'diesel') && (
        <ICEView obd={obd} maxRpm={maxRpm} />
      )}
    </div>
  );
}

export const OBDPanel = memo(OBDPanelInner);
