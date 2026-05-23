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

/* ── StatusPill — larger touch-zone & ink for driving glanceability ── */

const StatusPill = memo(function StatusPill({
  icon: Icon, label, active,
}: { icon: typeof Wifi; label: string; active: boolean }) {
  return (
    <div className={`flex items-center gap-2.5 px-5 py-2.5 rounded-2xl text-[12px] font-black transition-all duration-300 border shadow-sm ${
      active
        ? 'bg-white/[0.08] border-white/[0.14] text-primary'
        : 'bg-white/[0.04] border-white/[0.08] text-secondary opacity-75'
    }`}>
      <Icon className={`w-5 h-5 flex-shrink-0 ${active ? 'text-blue-400 drop-shadow-[0_0_10px_rgba(96,165,250,0.55)]' : 'text-secondary'}`} />
      <span className="truncate max-w-[110px] uppercase tracking-widest">{label}</span>
    </div>
  );
});

const VehiclePill = memo(function VehiclePill() {
  const { activeProfile, isDetected } = useVehicleProfile();
  if (!isDetected || !activeProfile) return null;
  return (
    <div
      data-status="vehicle"
      className="flex items-center gap-2.5 px-5 py-2.5 rounded-2xl text-[12px] font-black border bg-emerald-500/[0.10] border-emerald-500/[0.25] text-emerald-300 shadow-sm uppercase tracking-widest"
      title={`Araç profili: ${activeProfile.name}`}
    >
      <Car className="w-5 h-5 flex-shrink-0 text-emerald-400 drop-shadow-[0_0_10px_rgba(16,185,129,0.55)]" />
      <span className="truncate max-w-[110px]">{activeProfile.name}</span>
    </div>
  );
});

const DeviceStatusBar = memo(function DeviceStatusBar() {
  const s = useDeviceStatus();
  if (!s.ready) {
    return (
      <div className="flex items-center gap-3">
        {[72, 96, 60].map((w, i) => (
          <div key={i} className="h-11 rounded-2xl bg-white/[0.05] animate-pulse" style={{ width: w }} />
        ))}
      </div>
    );
  }
  return (
    <div className="flex items-center gap-3">
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
      <div className="flex items-center gap-6">
        <AnalogClock size={72} hours={analog.hours} minutes={analog.minutes} seconds={analog.seconds} showSeconds={showSeconds} />
        <div className="flex flex-col gap-1">
          <span className="text-primary text-xl font-black tracking-tight">{time}</span>
          <span className="text-secondary text-[11px] font-black uppercase tracking-[0.22em] opacity-65">{date}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="premium-clock-time text-[56px] font-extralight leading-none text-primary tabular-nums tracking-[-0.04em] drop-shadow-md">
        {time}
      </div>
      <div className="text-[11px] font-black tracking-[0.32em] text-secondary uppercase opacity-65 ml-0.5">{date}</div>
    </div>
  );
});

/* ── InlineChips — header içi hızlı eylem chipleri ──────── */

const CHIP_COLORS: Record<string, { bg: string; border: string }> = {
  maps:    { bg: 'rgba(37,99,235,0.20)',  border: 'rgba(59,130,246,0.40)' },
  waze:    { bg: 'rgba(37,99,235,0.20)',  border: 'rgba(59,130,246,0.40)' },
  spotify: { bg: 'rgba(29,185,84,0.18)',  border: 'rgba(34,197,94,0.35)' },
  youtube: { bg: 'rgba(239,68,68,0.18)',  border: 'rgba(239,68,68,0.35)' },
  phone:   { bg: 'rgba(34,197,94,0.18)',  border: 'rgba(34,197,94,0.35)' },
};
const DEFAULT_CHIP = { bg: 'rgba(255,255,255,0.06)', border: 'rgba(255,255,255,0.12)' };

const InlineChips = memo(function InlineChips({
  smart, onLaunch,
}: { smart: SmartSnapshot; onLaunch: (id: string) => void }) {
  const chips = smart.quickActions.slice(0, 4);
  if (chips.length === 0) return null;

  return (
    <div className="flex items-center gap-2.5 flex-1 justify-center px-5">
      {chips.map((action) => {
        const app = APP_MAP[action.appId];
        const c   = CHIP_COLORS[action.appId] ?? DEFAULT_CHIP;
        return (
          <button
            key={action.id}
            onClick={() => onLaunch(action.appId)}
            className="flex items-center gap-2 pl-3 pr-3.5 py-2 rounded-xl border active:scale-[0.94] transition-all"
            style={{ background: c.bg, borderColor: c.border, minHeight: 44 }}
          >
            <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
              style={{ background: c.border }}>
              {app
                ? <span className="text-sm leading-none">{app.icon}</span>
                : action.icon.startsWith('🎵')
                  ? <Music className="w-3.5 h-3.5 text-primary" />
                  : <Navigation2 className="w-3.5 h-3.5 text-primary" />
              }
            </div>
            <span className="text-primary text-[13px] font-bold tracking-tight whitespace-nowrap">
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
  const use24Hour = useStore(s => s.settings.use24Hour);
  const showSeconds = useStore(s => s.settings.showSeconds);
  const clockStyle = useStore(s => s.settings.clockStyle);
  const smartContextEnabled = useStore(s => s.settings.smartContextEnabled);

  const chipsEnabled = smartContextEnabled && smart.quickActions.length > 0;

  return (
    <>
      <div
        data-layout-zone="header"
        className="flex items-center justify-between px-7 pt-3.5 pb-2.5 flex-shrink-0 relative z-30"
      >
        {/* Ambient backdrop wash — pointer-none, additive only.
            Falls to transparent under SAFE_MODE/OLED/sunlight via --oem-* tokens. */}
        <span aria-hidden style={{
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
          background:
            'linear-gradient(180deg, var(--oem-ambient-cool, transparent), transparent 65%)',
        }}/>
        {/* Premium hairline at bottom — luxury separator above content */}
        <span aria-hidden style={{
          position: 'absolute',
          left: '5%', right: '5%',
          bottom: 0,
          height: 1,
          pointerEvents: 'none',
          background:
            'linear-gradient(90deg, transparent, var(--oem-line-strong, rgba(255,255,255,0.18)) 30%, var(--oem-line-strong, rgba(255,255,255,0.18)) 70%, transparent)',
          opacity: 0.85,
        }}/>

        <ClockArea use24Hour={use24Hour} showSeconds={showSeconds} clockStyle={clockStyle} />
        {chipsEnabled && <InlineChips smart={smart} onLaunch={onLaunch} />}
        <DeviceStatusBar />
      </div>
      <SmartContextBanner
        smart={smart}
        enabled={smartContextEnabled}
        onLaunch={onLaunch}
        ctxSuggestions={ctxSuggestions}
        onOpenMap={onOpenMap}
        onOpenDrawer={onOpenDrawer}
      />
    </>
  );
});
