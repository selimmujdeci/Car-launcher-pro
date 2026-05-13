import { memo, useId, type CSSProperties } from 'react';
import { Cpu } from 'lucide-react';

/** Ağır atalet hissi — 400 ms OEM geçişleri ile uyumlu cubic-bezier */
export const HEAVY_INERTIA_EASE = 'cubic-bezier(0.22, 1, 0.36, 1)' as const;
export const HEAVY_INERTIA_MS   = 400 as const;

export const diagnosticPulseTransitionStyle: CSSProperties = {
  transitionProperty:       'opacity, transform, filter',
  transitionDuration:       `${HEAVY_INERTIA_MS}ms`,
  transitionTimingFunction: HEAVY_INERTIA_EASE,
};

/** Tailwind slate-700 */
const PULSE_STROKE = '#334155';
/** Tailwind blue-500 @ 20% opacity */
const CORE_FILL = 'rgba(59, 130, 246, 0.2)';

/**
 * "Araç bağlantısı bekleniyor" ve benzeri bekleme durumları: merkez ECU, 1 Hz dışa yayılan slate nabız,
 * mavi yarı saydam çekirdek dolgusu.
 */
export const DiagnosticPulse = memo(function DiagnosticPulse({
  className = '',
  labelId,
}: {
  className?: string;
  /** Erişilebilirlik: canlı bölge başlığı */
  labelId?: string;
}) {
  const rid = useId().replace(/:/g, '');

  return (
    <div
      className={`relative flex h-44 w-44 max-w-[min(100%,220px)] flex-col items-center justify-center ${className}`}
      style={diagnosticPulseTransitionStyle}
      role={labelId ? 'group' : undefined}
      aria-labelledby={labelId}
      aria-hidden={labelId ? undefined : true}
    >
      <svg
        viewBox="0 0 200 200"
        className="absolute inset-0 h-full w-full"
        aria-hidden
      >
        <circle cx="100" cy="100" r="36" fill={CORE_FILL} />

        {[0, 1, 2].map((i) => (
          <circle
            key={`${rid}-wave-${i}`}
            cx="100"
            cy="100"
            r="32"
            fill="none"
            stroke={PULSE_STROKE}
            strokeWidth="1.5"
            strokeOpacity="0.55"
          >
            <animate
              attributeName="r"
              values="30;92"
              dur="1s"
              repeatCount="indefinite"
              begin={`${i / 3}s`}
              calcMode="spline"
              keySplines="0.4 0 0.2 1"
              keyTimes="0;1"
            />
            <animate
              attributeName="stroke-opacity"
              values="0.42;0"
              dur="1s"
              repeatCount="indefinite"
              begin={`${i / 3}s`}
              calcMode="spline"
              keySplines="0.4 0 0.2 1"
              keyTimes="0;1"
            />
          </circle>
        ))}
      </svg>

      <div className="relative z-[1] flex items-center justify-center" aria-hidden>
        <Cpu className="h-10 w-10 text-slate-700" strokeWidth={1.35} />
      </div>
    </div>
  );
});
