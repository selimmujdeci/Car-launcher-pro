import { memo } from 'react';
import { Wifi, Bluetooth, Battery, BatteryCharging, Car, Navigation2, Music } from 'lucide-react';
import { useStore } from '../../store/useStore';
import { useDeviceStatus } from '../../platform/deviceApi';
import { useClock, useAnalogClock } from '../../hooks/useClock';
import { useVehicleProfile } from '../../hooks/useVehicleProfile';
import { AnalogClock } from '../common/AnalogClock';
import { SmartContextBanner } from '../common/SmartContextBanner';
import type { useSmartEngine, SmartSnapshot } from '../../platform/smartEngine';
import type { CtxSuggestion } from '../../platform/contextEngine';
import { APP_MAP } from '../../data/apps';

/* ── StatusPill ──────────────────────────────────────────── */

const StatusPill = memo(function StatusPill({
  icon: Icon, label, active,
}: { icon: typeof Wifi; label: string; active: boolean }) {
  return (
    <div className={`flex items-center gap-2 px-4 py-2 rounded-2xl text-[11px] font-black transition-all duration-300 border shadow-sm ${
      active
        ? 'bg-white/80 border-black/8 text-primary'
        : 'bg-white/60 border-black/6 text-secondary opacity-70'
    }`}>
      <Icon className={`w-4 h-4 flex-shrink-0 ${active ? 'text-blue-500 drop-shadow-[0_0_8px_rgba(59,130,246,0.4)]' : 'text-secondary'}`} />
      <span className="truncate max-w-[90px] uppercase tracking-widest">{label}</span>
    </div>
  );
});

const VehiclePill = memo(function VehiclePill() {
  const { activeProfile, isDetected } = useVehicleProfile();
  if (!isDetected || !activeProfile) return null;
  return (
    <div
      data-status="vehicle"
      className="flex items-center gap-2 px-4 py-2 rounded-2xl text-[11px] font-black border bg-emerald-500/10 border-emerald-500/25 text-emerald-600 shadow-sm uppercase tracking-widest"
      title={`Araç profili: ${activeProfile.name}`}
    >
      <Car className="w-4 h-4 flex-shrink-0 text-emerald-500 drop-shadow-[0_0_8px_rgba(16,185,129,0.4)]" />
      <span className="truncate max-w-[90px]">{activeProfile.name}</span>
    </div>
  );
});

const DeviceStatusBar = memo(function DeviceStatusBar() {
  const s = useDeviceStatus();
  if (!s.ready) {
    return (
      <div className="flex items-center gap-2.5">
        {[60, 80, 50].map((w, i) => (
          <div key={i} className="h-9 rounded-2xl var(--panel-bg-secondary) animate-pulse" style={{ width: w }} />
        ))}
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2.5">
      <VehiclePill />
      <div data-status="bt"><StatusPill icon={Bluetooth} label={s.btConnected ? (s.btDevice || 'BT') : 'BT'} active={s.btConnected} /></div>
      <div data-status="wifi"><StatusPill icon={Wifi}      label={s.wifiConnected ? (s.wifiName || 'WIFI') : 'WIFI'} active={s.wifiConnected} /></div>
      <StatusPill icon={s.charging ? BatteryCharging : Battery} label={`${s.battery}%`} active={s.battery > 20} />
    </div>
  );
});

const ClockArea = memo(function ClockArea({
  use24Hour, showSeconds, clockStyle,
}: { use24Hour: boolean; showSeconds: boolean; clockStyle: 'digital' | 'analog' }) {
  const { time, date } = useClock(use24Hour, showSeconds);
  const analog         = useAnalogClock();

  if (clockStyle === 'analog') {
    return (
      <div className="flex items-center gap-5">
        <AnalogClock size={60} hours={analog.hours} minutes={analog.minutes} seconds={analog.seconds} showSeconds={showSeconds} />
        <div className="flex flex-col gap-0.5">
          <span className="text-primary text-base font-black tracking-tight">{time}</span>
          <span className="text-secondary text-[10px] font-black uppercase tracking-[0.2em] opacity-60">{date}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-0.5">
      <div className="premium-clock-time text-[42px] font-black leading-none text-primary tabular-nums tracking-tighter drop-shadow-md">
        {time}
      </div>
      <div className="text-[10px] font-black tracking-[0.3em] text-secondary uppercase opacity-60 ml-1">{date}</div>
    </div>
  );
});

/* ── InlineChips — header içi hızlı eylem chipleri ──────── */

const CHIP_COLORS: Record<string, { bg: string; border: string }> = {
  maps:    { bg: 'rgba(37,99,235,0.18)',  border: 'rgba(59,130,246,0.35)' },
  waze:    { bg: 'rgba(37,99,235,0.18)',  border: 'rgba(59,130,246,0.35)' },
  spotify: { bg: 'rgba(29,185,84,0.15)',  border: 'rgba(34,197,94,0.3)' },
  youtube: { bg: 'rgba(239,68,68,0.15)',  border: 'rgba(239,68,68,0.3)' },
  phone:   { bg: 'rgba(34,197,94,0.15)',  border: 'rgba(34,197,94,0.3)' },
};
const DEFAULT_CHIP = { bg: 'rgba(0,0,0,0.05)', border: 'rgba(0,0,0,0.10)' };

const InlineChips = memo(function InlineChips({
  smart, onLaunch,
}: { smart: SmartSnapshot; onLaunch: (id: string) => void }) {
  const chips = smart.quickActions.slice(0, 4);
  if (chips.length === 0) return null;

  return (
    <div className="flex items-center gap-2 flex-1 justify-center px-4">
      {chips.map((action) => {
        const app = APP_MAP[action.appId];
        const c   = CHIP_COLORS[action.appId] ?? DEFAULT_CHIP;
        return (
          <button
            key={action.id}
            onClick={() => onLaunch(action.appId)}
            className="flex items-center gap-1.5 pl-2.5 pr-3 py-1.5 rounded-xl border active:scale-[0.94] transition-all"
            style={{ background: c.bg, borderColor: c.border }}
          >
            <div className="w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0"
              style={{ background: c.border }}>
              {app
                ? <span className="text-xs leading-none">{app.icon}</span>
                : action.icon.startsWith('🎵')
                  ? <Music className="w-3 h-3 text-primary" />
                  : <Navigation2 className="w-3 h-3 text-primary" />
              }
            </div>
            <span className="text-primary text-[12px] font-bold tracking-tight whitespace-nowrap">
              {action.label}
            </span>
          </button>
        );
      })}
    </div>
  );
});

/* ── HeaderBar ───────────────────────────────────────────── */

interface Props {
  smart:           ReturnType<typeof useSmartEngine>;
  onLaunch:        (id: string) => void;
  ctxSuggestions?: CtxSuggestion[];
  onOpenMap?:      () => void;
  onOpenDrawer?:   (drawer: string) => void;
}

export const HeaderBar = memo(function HeaderBar({
  smart, onLaunch, ctxSuggestions, onOpenMap, onOpenDrawer,
}: Props) {
  const { settings } = useStore();
  const chipsEnabled = settings.smartContextEnabled && smart.quickActions.length > 0;

  return (
    <>
      <div data-layout-zone="header" className="flex items-center justify-between px-5 pt-2.5 pb-1 flex-shrink-0 relative z-30">
        <ClockArea use24Hour={settings.use24Hour} showSeconds={settings.showSeconds} clockStyle={settings.clockStyle} />
        {chipsEnabled && <InlineChips smart={smart} onLaunch={onLaunch} />}
        <DeviceStatusBar />
      </div>
      <SmartContextBanner
        smart={smart}
        enabled={settings.smartContextEnabled}
        onLaunch={onLaunch}
        ctxSuggestions={ctxSuggestions}
        onOpenMap={onOpenMap}
        onOpenDrawer={onOpenDrawer}
      />
    </>
  );
});


