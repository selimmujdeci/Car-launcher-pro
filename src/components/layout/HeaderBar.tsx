import { memo } from 'react';
import { Wifi, Bluetooth, Battery, BatteryCharging } from 'lucide-react';
import { useStore } from '../../store/useStore';
import { useDeviceStatus } from '../../platform/deviceApi';
import { useClock, useAnalogClock } from '../../hooks/useClock';
import { AnalogClock } from '../common/AnalogClock';
import { SmartContextBanner } from '../common/SmartContextBanner';
import type { useSmartEngine } from '../../platform/smartEngine';

/* ── StatusPill ──────────────────────────────────────────── */

const StatusPill = memo(function StatusPill({
  icon: Icon, label, active,
}: { icon: typeof Wifi; label: string; active: boolean }) {
  return (
    <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors duration-200 border ${
      active ? 'bg-white/[0.07] border-white/[0.08] text-white' : 'bg-white/[0.03] border-white/[0.05] text-slate-600'
    }`}>
      <Icon className={`w-3.5 h-3.5 flex-shrink-0 ${active ? 'text-blue-400' : 'text-slate-600'}`} />
      <span className="truncate max-w-[80px]">{label}</span>
    </div>
  );
});

const DeviceStatusBar = memo(function DeviceStatusBar() {
  const s = useDeviceStatus();
  if (!s.ready) {
    return (
      <div className="flex items-center gap-2">
        {[56, 72, 48].map((w, i) => (
          <div key={i} className="h-7 rounded-full bg-white/5 animate-pulse" style={{ width: w }} />
        ))}
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2">
      <StatusPill icon={Bluetooth} label={s.btConnected ? (s.btDevice || 'BT') : 'Bluetooth'} active={s.btConnected} />
      <StatusPill icon={Wifi}      label={s.wifiConnected ? (s.wifiName || 'Wi-Fi') : 'Wi-Fi'} active={s.wifiConnected} />
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
      <div className="flex items-center gap-4">
        <AnalogClock size={52} hours={analog.hours} minutes={analog.minutes} seconds={analog.seconds} showSeconds={showSeconds} />
        <div className="flex flex-col gap-1">
          <span className="text-slate-400 text-sm font-medium">{time}</span>
          <span className="text-slate-600 text-xs tracking-wide">{date}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-baseline gap-3">
      <div className="text-[28px] font-semibold leading-none text-white tabular-nums tracking-tight" style={{ textShadow: '0 0 30px rgba(255,255,255,0.06)' }}>
        {time}
      </div>
      <div className="text-xs font-medium tracking-wide text-slate-500">{date}</div>
    </div>
  );
});

/* ── HeaderBar ───────────────────────────────────────────── */

interface Props {
  smart:    ReturnType<typeof useSmartEngine>;
  onLaunch: (id: string) => void;
}

export const HeaderBar = memo(function HeaderBar({ smart, onLaunch }: Props) {
  const { settings } = useStore();

  return (
    <>
      <div className="flex items-center justify-between px-5 pt-2.5 pb-1 flex-shrink-0 relative z-30">
        <ClockArea use24Hour={settings.use24Hour} showSeconds={settings.showSeconds} clockStyle={settings.clockStyle} />
        <DeviceStatusBar />
      </div>
      <SmartContextBanner
        smart={smart}
        enabled={settings.smartContextEnabled}
        onLaunch={onLaunch}
      />
    </>
  );
});
