import { memo } from 'react';
import {
  Thermometer, Fuel, Zap, Battery, BatteryCharging,
  Gauge, Wind, Flame, DoorOpen, Lightbulb, type LucideIcon,
  ShieldAlert, Navigation, Snowflake, ParkingSquare,
  UserCheck, Droplets, Cpu, CircleDot,
} from 'lucide-react';
import { useOBDState, type VehicleType } from '../../platform/obdService';
import { useStore } from '../../store/useStore';
import { useUnifiedVehicleStore } from '../../platform/vehicleDataLayer';

/* ── Metric card ─────────────────────────────────────────── */

const MetricCard = ({
  icon: Icon, label, value, unit, color, percent, warn,
}: {
  icon: LucideIcon; label: string; value: string | number;
  unit: string; color: string; percent?: number; warn?: boolean;
}) => (
  <div
    className="flex-1 flex flex-col gap-2 transition-all duration-300 group/metric"
    style={{
      padding: 'var(--lp-space-md, 10px)',
      borderRadius: 'var(--lp-radius-lg, 16px)',
      background: warn ? 'rgba(239,68,68,0.1)' : 'rgba(255,255,255,0.03)',
      border: `1px solid ${warn ? 'rgba(239,68,68,0.3)' : 'rgba(255,255,255,0.055)'}`,
    }}
  >
    <div className="flex items-center justify-between gap-2">
      <div className="flex items-center gap-2 min-w-0">
        <div
          className="flex items-center justify-center shrink-0 group-hover/metric:scale-110 transition-transform"
          style={{
            width: 'calc(var(--lp-icon-sm, 16px) + 12px)',
            height: 'calc(var(--lp-icon-sm, 16px) + 12px)',
            borderRadius: 'var(--lp-radius-sm, 6px)',
            background: warn ? 'rgba(239,68,68,0.12)' : `${color}12`,
            border: `1px solid ${warn ? 'rgba(239,68,68,0.2)' : `${color}22`}`,
          }}
        >
          <Icon
            style={{
              width: 'var(--lp-icon-sm, 16px)',
              height: 'var(--lp-icon-sm, 16px)',
              color: warn ? '#ef4444' : color,
            }}
          />
        </div>
        <span
          className="font-bold text-slate-500 uppercase tracking-widest truncate"
          style={{ fontSize: 'var(--lp-font-xs, 10px)' }}
        >
          {label}
        </span>
      </div>
      <div className="flex items-baseline gap-0.5 shrink-0">
        <span
          className={`font-black tabular-nums ${warn ? 'text-red-400' : 'text-white'}`}
          style={{ fontSize: 'var(--lp-font-lg, 17px)' }}
        >
          {value}
        </span>
        <span
          className="font-bold text-slate-600 uppercase"
          style={{ fontSize: 'var(--lp-font-xs, 10px)' }}
        >
          {unit}
        </span>
      </div>
    </div>
    {percent !== undefined && (
      <div className="bg-white/5 rounded-full overflow-hidden" style={{ height: '3px' }}>
        <div
          className="h-full transition-all duration-500"
          style={{
            width: `${Math.max(0, Math.min(100, percent))}%`,
            background: warn ? '#ef4444' : color,
          }}
        />
      </div>
    )}
  </div>
);

/* ── Status badge ─────────────────────────────────────────── */

const StatusBadge = ({
  icon: Icon, label, color, warn = false,
}: { icon: LucideIcon; label: string; color: string; warn?: boolean }) => (
  <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-widest border`}
    style={{
      background: warn ? 'rgba(239,68,68,0.12)' : `${color}12`,
      borderColor: warn ? 'rgba(239,68,68,0.35)' : `${color}35`,
      color: warn ? '#ef4444' : color,
    }}>
    <Icon className="w-3 h-3" />
    {label}
  </div>
);

/* ── Gear display ─────────────────────────────────────────── */

function GearBadge({ gearPos }: { gearPos: number }) {
  const label = gearPos === -1 ? 'R' : gearPos === 0 ? 'N' : `D${gearPos}`;
  const color = gearPos === -1 ? '#ef4444' : gearPos === 0 ? '#94a3b8' : '#60a5fa';
  return (
    <div className="flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-black uppercase tracking-widest border"
      style={{ background: `${color}12`, borderColor: `${color}35`, color }}>
      <CircleDot className="w-3 h-3" />
      VİTES {label}
    </div>
  );
}

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
        <span className="text-6xl font-black text-white tracking-tighter tabular-nums">{Math.round(speed || 0)}</span>
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

function ICEView({ obd, maxRpm, canRpm, canCoolant, canThrottle }: {
  obd: ReturnType<typeof useOBDState>;
  maxRpm: number;
  canRpm: number | null;
  canCoolant: number | null;
  canThrottle: number | null;
}) {
  const rpm         = canRpm ?? (obd.rpm > 0 ? obd.rpm : null);
  const coolant     = canCoolant ?? (obd.engineTemp > 0 ? obd.engineTemp : null);
  const throttle    = canThrottle ?? (obd.throttle > 0 ? obd.throttle : null);
  const rpmPercent  = rpm ? (rpm / maxRpm) * 100 : 0;
  const tempWarn    = (coolant ?? 0) > 100;
  const fuelWarn    = obd.fuelLevel > 0 && obd.fuelLevel < 12;

  return (
    <div className="flex flex-col lg:flex-row gap-5 w-full">
      <div className="flex-[2] flex gap-4">
        <SpeedBlock speed={obd.speed} maxSpeed={240} />
        <div className="flex-1 flex flex-col justify-center p-5 rounded-2xl bg-white/[0.04] border border-white/10 relative overflow-hidden">
          <div className="flex items-baseline gap-1.5">
            <span className="text-3xl font-black text-white tracking-tighter tabular-nums">
              {rpm ? Math.round(rpm) : '—'}
            </span>
            <span className="text-purple-400 font-black text-[10px] uppercase tracking-widest">RPM</span>
          </div>
          <div className="mt-3 h-1.5 bg-white/5 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-purple-600 to-purple-400 transition-all duration-300"
              style={{ width: `${rpmPercent}%` }}
            />
          </div>
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
          value={coolant != null ? Math.round(coolant) : '—'}
          color={tempWarn ? 'red' : 'orange'}
          percent={coolant != null ? ((coolant - 40) / 80) * 100 : undefined}
          warn={tempWarn}
        />
        <MetricCard
          icon={Fuel} label="YAKIT" unit="%"
          value={obd.fuelLevel > 0 ? Math.round(obd.fuelLevel) : '—'}
          color={fuelWarn ? 'red' : 'blue'}
          percent={obd.fuelLevel > 0 ? obd.fuelLevel : undefined}
          warn={fuelWarn}
        />
        {throttle != null && (
          <MetricCard icon={Gauge} label="GAZ" unit="%" value={Math.round(throttle)} color="cyan" percent={throttle} />
        )}
        {obd.egt > 0 && (
          <MetricCard icon={Flame} label="EGT" unit="°C" value={obd.egt} color="red" warn={obd.egt > 650} />
        )}
      </div>
    </div>
  );
}

/* ── EV main view ────────────────────────────────────────── */

function EVView({ obd, canThrottle }: {
  obd: ReturnType<typeof useOBDState>;
  canThrottle: number | null;
}) {
  const throttle = canThrottle ?? (obd.throttle > 0 ? obd.throttle : null);
  const battWarn = obd.batteryLevel >= 0 && obd.batteryLevel < 15;
  const tempWarn = obd.batteryTemp > 42;
  const charging = obd.chargingState === 'charging' || obd.chargingState === 'fast_charging';
  const isRegen  = obd.motorPower < 0;

  return (
    <div className="flex flex-col lg:flex-row gap-5 w-full">
      <div className="flex-[2] flex gap-4">
        <SpeedBlock speed={obd.speed} maxSpeed={240} />
        <div className={`flex-1 flex flex-col justify-center p-5 rounded-2xl border relative overflow-hidden ${
          charging ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-white/[0.04] border-white/10'
        }`}>
          <div className="flex items-center gap-2 mb-1">
            {charging ? <BatteryCharging className="w-4 h-4 text-emerald-400" /> : <Battery className="w-4 h-4 text-emerald-400" />}
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
              <div className={`h-full transition-all duration-500 ${battWarn ? 'bg-red-500' : charging ? 'bg-emerald-400' : 'bg-emerald-600'}`}
                style={{ width: `${obd.batteryLevel}%` }} />
            </div>
          )}
          {charging && obd.chargingPower > 0 && (
            <div className="mt-1 text-[9px] text-emerald-400 font-bold">{obd.chargingPower.toFixed(1)} kW</div>
          )}
        </div>
      </div>
      <div className="flex-1 grid grid-cols-2 gap-4">
        {obd.range >= 0 && <MetricCard icon={Gauge} label="MENZİL" unit="KM" value={Math.round(obd.range)} color="blue" />}
        {obd.motorPower !== -1 && (
          <MetricCard icon={Zap} label={isRegen ? 'REGEN' : 'GÜÇ'} unit="KW"
            value={Math.abs(Math.round(obd.motorPower))} color={isRegen ? 'emerald' : 'yellow'} />
        )}
        {obd.batteryTemp > 0 && (
          <MetricCard icon={Thermometer} label="BAT. ISI" unit="°C" value={obd.batteryTemp} color={tempWarn ? 'red' : 'orange'} warn={tempWarn} />
        )}
        {throttle != null && (
          <MetricCard icon={Gauge} label="PEDAL" unit="%" value={Math.round(throttle)} color="cyan" percent={throttle} />
        )}
      </div>
    </div>
  );
}

/* ── Hybrid main view ────────────────────────────────────── */

function HybridView({ obd, maxRpm, canRpm }: {
  obd: ReturnType<typeof useOBDState>;
  maxRpm: number;
  canRpm: number | null;
}) {
  const fuelWarn = obd.fuelLevel > 0 && obd.fuelLevel < 12;
  const battWarn = obd.batteryLevel >= 0 && obd.batteryLevel < 15;
  const rpm      = canRpm ?? (obd.rpm > 0 ? obd.rpm : null);

  return (
    <div className="flex flex-col lg:flex-row gap-5 w-full">
      <div className="flex-[2] flex gap-4">
        <SpeedBlock speed={obd.speed} maxSpeed={240} />
        <div className="flex-1 flex flex-col gap-2">
          <div className={`flex-1 flex flex-col justify-center px-4 py-3 rounded-xl border ${battWarn ? 'bg-red-500/10 border-red-500/25' : 'bg-emerald-500/10 border-emerald-500/20'}`}>
            <span className="text-[8px] font-bold text-emerald-400 uppercase tracking-widest mb-0.5">BATARYA</span>
            <div className="flex items-baseline gap-1">
              <span className={`text-2xl font-black tabular-nums ${battWarn ? 'text-red-400' : 'text-white'}`}>
                {obd.batteryLevel >= 0 ? Math.round(obd.batteryLevel) : '—'}
              </span>
              <span className="text-[9px] text-emerald-400 font-bold">%</span>
            </div>
            {obd.batteryLevel >= 0 && (
              <div className="mt-1 h-1 bg-white/5 rounded-full overflow-hidden">
                <div className={`h-full ${battWarn ? 'bg-red-500' : 'bg-emerald-500'}`} style={{ width: `${obd.batteryLevel}%` }} />
              </div>
            )}
          </div>
          <div className={`flex-1 flex flex-col justify-center px-4 py-3 rounded-xl border ${fuelWarn ? 'bg-red-500/10 border-red-500/25' : 'bg-blue-500/10 border-blue-500/20'}`}>
            <span className="text-[8px] font-bold text-blue-400 uppercase tracking-widest mb-0.5">YAKIT</span>
            <div className="flex items-baseline gap-1">
              <span className={`text-2xl font-black tabular-nums ${fuelWarn ? 'text-red-400' : 'text-white'}`}>
                {obd.fuelLevel > 0 ? Math.round(obd.fuelLevel) : '—'}
              </span>
              <span className="text-[9px] text-blue-400 font-bold">%</span>
            </div>
            {obd.fuelLevel > 0 && (
              <div className="mt-1 h-1 bg-white/5 rounded-full overflow-hidden">
                <div className={`h-full ${fuelWarn ? 'bg-red-500' : 'bg-blue-500'}`} style={{ width: `${obd.fuelLevel}%` }} />
              </div>
            )}
          </div>
        </div>
      </div>
      <div className="flex-1 grid grid-cols-2 gap-3">
        {obd.range >= 0 && <MetricCard icon={Gauge} label="MENZİL" unit="KM" value={Math.round(obd.range)} color="blue" />}
        {obd.motorPower !== -1 && <MetricCard icon={Zap} label="ELK. GÜÇ" unit="KW" value={Math.abs(Math.round(obd.motorPower))} color="emerald" />}
        {obd.engineTemp > 0 && <MetricCard icon={Thermometer} label="MOTOR ISI" unit="°C" value={obd.engineTemp} color="orange" warn={obd.engineTemp > 100} />}
        {rpm != null && rpm > 0 && maxRpm > 0 && <MetricCard icon={Gauge} label="RPM" unit="" value={Math.round(rpm)} color="purple" percent={(rpm / maxRpm) * 100} />}
      </div>
    </div>
  );
}

/* ── CAN Extras Panel ────────────────────────────────────── */

function CanExtrasPanel() {
  const s = useUnifiedVehicleStore((st) => ({
    oilTemp:     st.canOilTemp,
    battVolt:    st.canBatteryVolt,
    ambient:     st.canAmbientTemp,
    abs:         st.canAbs,
    tcs:         st.canTractionControl,
    esc:         st.canStabilityControl,
    parkBrake:   st.canParkingBrake,
    seatbelt:    st.canSeatbelt,
    wipers:      st.canWipers,
    ac:          st.canAirCondition,
    cruise:      st.canCruiseControl,
    gearPos:     st.canGearPos,
    speed:       st.speed,
  }));

  const hasMetrics  = s.oilTemp != null || s.battVolt != null || s.ambient != null;
  const seatbeltOff = s.seatbelt === false && (s.speed ?? 0) > 5;
  const hasBadges   = s.abs || s.tcs || s.esc || s.parkBrake || seatbeltOff || s.wipers || s.ac || s.cruise || s.gearPos != null;

  if (!hasMetrics && !hasBadges) return null;

  return (
    <div className="mt-4 flex flex-col gap-3">

      {/* Durum rozetleri */}
      {hasBadges && (
        <div className="flex flex-wrap gap-2">
          {/* Vites */}
          {s.gearPos != null && <GearBadge gearPos={s.gearPos} />}

          {/* Güvenlik uyarıları */}
          {s.abs      && <StatusBadge icon={ShieldAlert}   label="ABS"     color="#ef4444" warn />}
          {s.tcs      && <StatusBadge icon={ShieldAlert}   label="TCS"     color="#f59e0b" warn />}
          {s.esc      && <StatusBadge icon={ShieldAlert}   label="ESC"     color="#f59e0b" warn />}
          {s.parkBrake&& <StatusBadge icon={ParkingSquare} label="EL FRENİ"color="#ef4444" warn />}
          {seatbeltOff&& <StatusBadge icon={UserCheck}     label="KEMER YOK" color="#ef4444" warn />}

          {/* Konfor durumu */}
          {s.wipers   && <StatusBadge icon={Droplets}  label="SİLECEK"  color="#60a5fa" />}
          {s.ac       && <StatusBadge icon={Snowflake}  label="KLİMA"    color="#22d3ee" />}
          {s.cruise   && <StatusBadge icon={Navigation} label="SEYIR"    color="#a78bfa" />}
        </div>
      )}

      {/* Sayısal ek veriler */}
      {hasMetrics && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {s.oilTemp != null && (
            <MetricCard icon={Droplets} label="YAĞ ISI" unit="°C"
              value={Math.round(s.oilTemp)} color={s.oilTemp > 130 ? 'red' : 'amber'}
              warn={s.oilTemp > 130} />
          )}
          {s.battVolt != null && (
            <MetricCard icon={Cpu} label="AKÜ" unit="V"
              value={s.battVolt.toFixed(1)} color={s.battVolt < 11.5 ? 'red' : 'emerald'}
              warn={s.battVolt < 11.5} />
          )}
          {s.ambient != null && (
            <MetricCard icon={Thermometer} label="DIŞ HAVA" unit="°C"
              value={Math.round(s.ambient)} color="sky" />
          )}
        </div>
      )}
    </div>
  );
}

/* ── Main OBD Panel ──────────────────────────────────────── */

function OBDPanelInner() {
  const obd = useOBDState();
  const { settings } = useStore();

  // Mevcut CAN extras
  const canDoorOpen   = useUnifiedVehicleStore((s) => s.canDoorOpen);
  const canHeadlights = useUnifiedVehicleStore((s) => s.canHeadlights);
  const canRpm        = useUnifiedVehicleStore((s) => s.canRpm);
  const canCoolant    = useUnifiedVehicleStore((s) => s.canCoolantTemp);
  const canThrottle   = useUnifiedVehicleStore((s) => s.canThrottle);

  const activeProfile = settings.vehicleProfiles.find((p) => p.id === settings.activeVehicleProfileId);
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
        <div className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest border transition-colors ${
          obd.connectionState === 'connected'
            ? 'bg-green-500/10 border-green-500/25 text-emerald-400'
            : obd.connectionState === 'error'
              ? 'bg-red-500/10 border-red-500/25 text-red-400'
              : obd.connectionState === 'initializing'
                ? 'bg-sky-500/10 border-sky-500/25 text-sky-400'
                : 'bg-amber-500/10 border-amber-500/25 text-amber-400'
        }`}>
          <div className={`w-1.5 h-1.5 rounded-full ${
            obd.connectionState === 'connected'
              ? 'bg-emerald-500 animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.6)]'
              : obd.connectionState === 'error' ? 'bg-red-500'
              : obd.connectionState === 'initializing' ? 'bg-sky-400 animate-pulse'
              : 'bg-amber-500 animate-pulse'
          }`} />
          {obd.connectionState === 'connected'
            ? (obd.source === 'real' ? 'CAN-BUS' : 'DEMO')
            : obd.connectionState === 'error'     ? 'BAĞLANTI YOK'
            : obd.connectionState === 'initializing' ? 'EL SIKIŞILIYOR'
            : obd.connectionState === 'reconnecting' ? 'YENİDEN BAĞL.'
            : 'BAĞLANILIYOR'}
        </div>
      </div>

      {/* Kapı / Far rozetleri */}
      {(canDoorOpen || canHeadlights) && (
        <div className="flex items-center gap-3 mb-4">
          {canDoorOpen && (
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-400 text-[10px] font-black uppercase tracking-widest">
              <DoorOpen className="w-3 h-3" />KAPI AÇIK
            </div>
          )}
          {canHeadlights && (
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-yellow-400/15 border border-yellow-400/30 text-yellow-400 text-[10px] font-black uppercase tracking-widest">
              <Lightbulb className="w-3 h-3" />FARLAR AÇIK
            </div>
          )}
        </div>
      )}

      {/* Araç tipine göre ana görünüm */}
      {vehicleType === 'ev' && (
        <EVView obd={obd} canThrottle={canThrottle} />
      )}
      {(vehicleType === 'hybrid' || vehicleType === 'phev') && (
        <HybridView obd={obd} maxRpm={maxRpm} canRpm={canRpm} />
      )}
      {(vehicleType === 'ice' || vehicleType === 'diesel') && (
        <ICEView obd={obd} maxRpm={maxRpm} canRpm={canRpm} canCoolant={canCoolant} canThrottle={canThrottle} />
      )}

      {/* CAN Ekstra Veriler (güvenlik + konfor + ek metrikler) */}
      <CanExtrasPanel />
    </div>
  );
}

export const OBDPanel = memo(OBDPanelInner);
