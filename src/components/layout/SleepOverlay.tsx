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
      className="ultra-premium-root fixed inset-0 z-[4000] flex flex-col items-center justify-center cursor-pointer select-none transition-all duration-1000"
      onClick={onWake}
    >
      <div className="up-ambient-blobs">
        <div className="up-blob up-blob-1 !opacity-20" />
        <div className="up-blob up-blob-2 !opacity-20" />
      </div>

      <div className="relative z-10 pointer-events-none mb-10 group">
        {clockStyle === 'analog' ? (
          <div className="drop-shadow-[0_0_50px_rgba(59,130,246,0.3)]">
            <AnalogClock size={320} hours={analog.hours} minutes={analog.minutes} seconds={analog.seconds} showSeconds={showSeconds} />
          </div>
        ) : (
          <div className="text-[160px] font-black tabular-nums tracking-tighter text-primary leading-none drop-shadow-[0_0_60px_rgba(255,255,255,0.15)] italic">
            {clk.time}
          </div>
        )}
      </div>

      <div className="relative z-10 px-8 py-3 rounded-2xl glass-card border-white/5 backdrop-blur-3xl shadow-2xl">
        <div className="text-primary font-black text-xl tracking-[0.4em] uppercase text-center drop-shadow-md">
          {clk.date}
        </div>
      </div>

      <div className="fixed bottom-12 flex flex-col items-center gap-4 animate-bounce">
        <div className="text-secondary text-[10px] font-black tracking-[0.6em] uppercase">Sistemi Uyandır</div>
        <div className="w-1 h-12 rounded-full bg-gradient-to-b from-blue-500 to-transparent shadow-[0_0_15px_rgba(59,130,246,0.5)]" />
      </div>
    </div>
  );
});


