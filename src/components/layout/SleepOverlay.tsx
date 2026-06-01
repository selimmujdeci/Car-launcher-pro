import { memo, useSyncExternalStore } from 'react';
import { ChevronUp } from 'lucide-react';
import { useClock, useAnalogClock } from '../../hooks/useClock';
import { AnalogClock } from '../common/AnalogClock';
import { runtimeManager } from '../../core/runtime/AdaptiveRuntimeManager';
import { RuntimeMode } from '../../core/runtime/runtimeTypes';
import '../../styles/oem-cockpit.css';

interface Props {
  use24Hour:   boolean;
  showSeconds: boolean;
  clockStyle:  'digital' | 'analog';
  onWake:      () => void;
}

/* SAFE_MODE subscription — disable animations under SAFE_MODE */
function subscribeRuntime(cb: () => void) { return runtimeManager.subscribe(cb); }
function getRuntimeMode() { return runtimeManager.getMode(); }

export const SleepOverlay = memo(function SleepOverlay({ use24Hour, showSeconds, clockStyle, onWake }: Props) {
  const clk    = useClock(use24Hour, showSeconds);
  const analog = useAnalogClock();
  const runtimeMode = useSyncExternalStore(subscribeRuntime, getRuntimeMode, getRuntimeMode);
  const isSafeMode = runtimeMode === RuntimeMode.SAFE_MODE;

  return (
    <div
      className="ultra-premium-root fixed inset-0 z-[4000] flex flex-col items-center justify-center cursor-pointer select-none transition-all duration-1000"
      onClick={onWake}
      style={{ background: '#000000' }}
    >
      {/* Ambient blobs — extremely dim for OLED safety (opacity-10) */}
      <div className="up-ambient-blobs">
        <div className="up-blob up-blob-1 !opacity-10" />
        <div className="up-blob up-blob-2 !opacity-10" />
      </div>

      {/* OLED Cinematic Clock */}
      <div className="relative z-10 pointer-events-none mb-10">
        {clockStyle === 'analog' ? (
          <div
            style={{
              filter: isSafeMode
                ? 'none'
                : 'drop-shadow(0 0 50px oklch(80% 0.13 60 / 0.32))',
            }}
          >
            <AnalogClock
              size={320}
              hours={analog.hours}
              minutes={analog.minutes}
              seconds={analog.seconds}
              showSeconds={showSeconds}
            />
          </div>
        ) : (
          <div
            className="tabular-nums tracking-tight leading-none italic"
            style={{
              fontSize: 160,
              // font-thin per spec
              fontWeight: 100,
              color: 'var(--oem-ink, #F0EBE0)',
              textShadow: isSafeMode
                ? 'none'
                : '0 0 80px oklch(80% 0.13 60 / 0.30),' +
                  ' 0 0 30px oklch(86% 0.10 70 / 0.20)',
              letterSpacing: '-0.04em',
            }}
          >
            {clk.time}
          </div>
        )}
      </div>

      {/* Date pill — minimal glass */}
      <div
        className="relative z-10 px-8 py-3 rounded-2xl"
        style={{
          background: 'rgba(8,10,14,0.65)',
          border: '1px solid var(--oem-line, rgba(255,240,210,0.08))',
          backdropFilter: isSafeMode ? 'none' : 'blur(24px) saturate(120%)',
          WebkitBackdropFilter: isSafeMode ? 'none' : 'blur(24px) saturate(120%)',
          boxShadow: '0 24px 56px -28px rgba(0,0,0,0.85)',
        }}
      >
        <div
          className="font-black uppercase text-center"
          style={{
            fontSize: 20,
            letterSpacing: '0.4em',
            color: 'var(--oem-ink-2, rgba(240,235,224,0.74))',
          }}
        >
          {clk.date}
        </div>
      </div>

      {/* Unlock gesture indicator — soft amber gradient pill (bottom) */}
      <div
        className="fixed bottom-12 flex flex-col items-center gap-3 pointer-events-none"
        style={{
          // Subtle bounce — disabled under SAFE_MODE
          animation: isSafeMode ? 'none' : 'oemHaloPulse 3.2s ease-in-out infinite',
        }}
      >
        <ChevronUp
          className="w-5 h-5"
          style={{
            color: 'var(--oem-amber, oklch(80% 0.13 60))',
            filter: isSafeMode ? 'none' : 'drop-shadow(0 0 10px oklch(80% 0.13 60 / 0.55))',
          }}
        />
        <div
          className="flex items-center gap-3 px-5 py-2.5 rounded-full"
          style={{
            background:
              'linear-gradient(180deg, var(--oem-amber-soft, oklch(80% 0.13 60 / 0.20)), transparent 70%),' +
              ' rgba(8,10,14,0.55)',
            border: '1px solid var(--oem-line-warm, oklch(66% 0.10 55 / 0.42))',
            boxShadow: isSafeMode
              ? 'none'
              : '0 0 22px var(--oem-amber-glow, oklch(80% 0.13 60 / 0.36)),' +
                ' 0 1px 0 rgba(255,240,210,0.10) inset',
          }}
        >
          <div
            className="font-black uppercase"
            style={{
              fontSize: 11,
              letterSpacing: '0.36em',
              color: 'var(--oem-amber, oklch(80% 0.13 60))',
            }}
          >
            Yukarı Kaydır — Sistemi Uyandır
          </div>
        </div>
      </div>
    </div>
  );
});
