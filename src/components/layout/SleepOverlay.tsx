import { memo } from 'react';
import { useClock, useAnalogClock } from '../../hooks/useClock';
import { AnalogClock } from '../common/AnalogClock';

interface Props {
  use24Hour:   boolean;
  showSeconds: boolean;
  clockStyle:  'digital' | 'analog';
  onWake:      () => void;
}

export const SleepOverlay = memo(function SleepOverlay({ use24Hour, showSeconds, clockStyle, onWake }: Props) {
  const clk    = useClock(use24Hour, showSeconds);
  const analog = useAnalogClock();

  return (
    <div
      className="sleep-overlay fixed inset-0 z-40 bg-black flex flex-col items-center justify-center cursor-pointer select-none"
      onClick={onWake}
    >
      <div className="absolute w-96 h-96 rounded-full bg-blue-500/[0.04] blur-[100px] pointer-events-none" />
      <div className="relative z-10 pointer-events-none mb-6">
        {clockStyle === 'analog' ? (
          <AnalogClock size={240} hours={analog.hours} minutes={analog.minutes} seconds={analog.seconds} showSeconds={showSeconds} />
        ) : (
          <div className="text-[110px] font-extralight tabular-nums tracking-tight text-white leading-none drop-shadow-[0_0_30px_rgba(255,255,255,0.08)]">
            {clk.time}
          </div>
        )}
      </div>
      <div className="text-slate-600 text-base tracking-[0.35em] uppercase pointer-events-none z-10">
        {clk.date}
      </div>
      <div className="fixed bottom-8 text-white/20 text-[10px] tracking-[0.4em] pointer-events-none">
        DOKUNUN
      </div>
    </div>
  );
});
