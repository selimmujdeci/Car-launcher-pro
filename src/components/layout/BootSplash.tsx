import { memo, useSyncExternalStore } from 'react';
import { runtimeManager } from '../../core/runtime/AdaptiveRuntimeManager';
import { RuntimeMode } from '../../core/runtime/runtimeTypes';
import '../../styles/oem-cockpit.css';

export type BootPhase = 'show' | 'fade' | 'done';

/* SAFE_MODE subscription — disable halo-pulse for GPU safety */
function subscribeRuntime(cb: () => void) { return runtimeManager.subscribe(cb); }
function getRuntimeMode() { return runtimeManager.getMode(); }

/* ── Cinematic Steering Wheel — high-fidelity OEM emblem ───
 *
 * Yapı:
 *   - Dış jant (kromaj amber gradient stroke + ışıltı)
 *   - Volant kolları (3 kol, 120° eşit aralık)
 *   - Geniş merkez göbek + amber halo + iç pul
 *   - Üst yansıma highlight'i
 */
const CinematicWheel = memo(function CinematicWheel({ size = 144 }: { size?: number }) {
  const cx = size / 2;
  const cy = size / 2;
  const rim = size * 0.42;
  const hub = size * 0.18; // larger hub per spec
  const sw  = size * 0.06;

  const spoke = (angleDeg: number, inner: boolean) => {
    const rad  = (angleDeg - 90) * (Math.PI / 180);
    const dist = inner ? hub * 1.15 : rim - sw * 0.3;
    return { x: cx + dist * Math.cos(rad), y: cy + dist * Math.sin(rad) };
  };

  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      width={size}
      height={size}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      style={{ overflow: 'visible' }}
    >
      <defs>
        <linearGradient id="bootRimG" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0"   stopColor="oklch(92% 0.05 90)" />
          <stop offset="0.5" stopColor="oklch(80% 0.13 60)" />
          <stop offset="1"   stopColor="oklch(54% 0.13 50)" />
        </linearGradient>
        <radialGradient id="bootHubG" cx="35%" cy="30%" r="80%">
          <stop offset="0"   stopColor="oklch(95% 0.06 80)" />
          <stop offset="0.55" stopColor="oklch(76% 0.12 60)" />
          <stop offset="1"   stopColor="oklch(40% 0.10 45)" />
        </radialGradient>
        <radialGradient id="bootHaloG" cx="50%" cy="50%" r="50%">
          <stop offset="0"   stopColor="oklch(80% 0.13 60 / 0.55)" />
          <stop offset="1"   stopColor="oklch(80% 0.13 60 / 0)" />
        </radialGradient>
      </defs>

      {/* Soft outer amber halo */}
      <circle cx={cx} cy={cy} r={rim * 1.45} fill="url(#bootHaloG)" />

      {/* Outer rim shadow ring */}
      <circle cx={cx} cy={cy} r={rim + sw * 0.45} stroke="rgba(0,0,0,0.55)" strokeWidth={sw * 0.6} />

      {/* Chrome rim — amber gradient stroke */}
      <circle
        cx={cx} cy={cy} r={rim}
        stroke="url(#bootRimG)" strokeWidth={sw}
        style={{ filter: 'drop-shadow(0 0 14px oklch(80% 0.13 60 / 0.45))' }}
      />

      {/* Rim top specular highlight */}
      <path
        d={`M ${cx - rim * 0.6} ${cy - rim * 0.85} A ${rim} ${rim} 0 0 1 ${cx + rim * 0.6} ${cy - rim * 0.85}`}
        stroke="oklch(98% 0.03 85 / 0.55)" strokeWidth={sw * 0.4} strokeLinecap="round" fill="none"
      />

      {/* Spokes — 3 arms, 120° apart */}
      {[0, 120, 240].map((a) => {
        const from = spoke(a, true);
        const to   = spoke(a, false);
        return (
          <line
            key={a}
            x1={from.x} y1={from.y} x2={to.x} y2={to.y}
            stroke="url(#bootRimG)" strokeWidth={sw * 0.75} strokeLinecap="round"
            style={{ filter: 'drop-shadow(0 1px 3px rgba(0,0,0,0.55))' }}
          />
        );
      })}

      {/* Hub backdrop — slight shadow ring */}
      <circle cx={cx} cy={cy} r={hub + 2} fill="rgba(0,0,0,0.55)" />

      {/* Hub — amber gradient + glow */}
      <circle
        cx={cx} cy={cy} r={hub}
        fill="url(#bootHubG)"
        style={{ filter: 'drop-shadow(0 0 18px oklch(80% 0.13 60 / 0.65))' }}
      />

      {/* Hub inner pip — emblematic */}
      <circle cx={cx} cy={cy} r={hub * 0.42} fill="oklch(22% 0.04 50)" />
      <circle cx={cx - hub * 0.15} cy={cy - hub * 0.15} r={hub * 0.16} fill="oklch(96% 0.05 80)" opacity="0.55" />
    </svg>
  );
});

export const BootSplash = memo(function BootSplash({ phase }: { phase: BootPhase }) {
  const runtimeMode = useSyncExternalStore(subscribeRuntime, getRuntimeMode, getRuntimeMode);
  const isSafeMode = runtimeMode === RuntimeMode.SAFE_MODE;

  if (phase === 'done') return null;

  return (
    <div
      className={`ultra-premium-root fixed inset-0 z-[5000] flex flex-col items-center justify-center transition-all duration-700 pointer-events-none ${
        phase === 'fade' ? 'opacity-0 scale-110 blur-2xl' : 'opacity-100 scale-100'
      }`}
    >
      {/* Ambient blobs */}
      <div className="up-ambient-blobs">
        <div className="up-blob up-blob-1" />
        <div className="up-blob up-blob-2" />
      </div>

      {/* Logo + halo-pulse + brand */}
      <div className="relative flex flex-col items-center select-none z-10">
        <div className="relative mb-10">
          {/* Halo-pulse — disabled under SAFE_MODE */}
          {!isSafeMode && (
            <div
              className="oem-halo-pulse"
              style={{
                position: 'absolute',
                inset: -56,
                borderRadius: '999px',
                background: 'radial-gradient(circle, oklch(80% 0.13 60 / 0.32), transparent 65%)',
                filter: 'blur(28px)',
                pointerEvents: 'none',
              }}
            />
          )}
          <CinematicWheel size={144} />
        </div>

        {/* CarOS PRO — font-black, tracking-[0.4em] */}
        <div
          className="font-black uppercase"
          style={{
            fontSize: 40,
            letterSpacing: '0.4em',
            color: 'var(--oem-ink, #F0EBE0)',
            textShadow:
              '0 0 60px oklch(80% 0.13 60 / 0.42),' +
              ' 0 4px 14px rgba(0,0,0,0.65)',
          }}
        >
          CarOS <span style={{ color: 'var(--oem-amber, oklch(80% 0.13 60))' }}>PRO</span>
        </div>

        {/* PLATINUM subtitle */}
        <div className="flex items-center gap-4 mt-3">
          <div
            className="h-px w-12"
            style={{ background: 'linear-gradient(90deg, transparent, var(--oem-amber, oklch(80% 0.13 60)))' }}
          />
          <div
            className="font-black uppercase"
            style={{
              fontSize: 12,
              letterSpacing: '0.8em',
              color: 'var(--oem-amber, oklch(80% 0.13 60))',
              textShadow: '0 0 18px oklch(80% 0.13 60 / 0.45)',
            }}
          >
            PLATINUM
          </div>
          <div
            className="h-px w-12"
            style={{ background: 'linear-gradient(270deg, transparent, var(--oem-amber, oklch(80% 0.13 60)))' }}
          />
        </div>

        <div
          className="font-black uppercase mt-8"
          style={{
            fontSize: 10,
            letterSpacing: '0.5em',
            color: 'var(--oem-ink-3, rgba(240,235,224,0.52))',
          }}
        >
          Sistem Başlatılıyor
        </div>
      </div>

      {/* Progress bar — 4px amber gradient */}
      <div
        className="absolute bottom-20 rounded-full overflow-hidden"
        style={{
          width: 280,
          height: 4,
          background: 'var(--oem-line-strong, rgba(255,240,210,0.18))',
          boxShadow: 'inset 0 1px 1px rgba(0,0,0,0.35)',
        }}
      >
        <div
          className="h-full rounded-full animate-boot-bar"
          style={{
            background: 'linear-gradient(90deg, oklch(72% 0.11 55), oklch(86% 0.10 70), oklch(92% 0.05 90))',
            boxShadow:
              '0 0 18px oklch(80% 0.13 60 / 0.65),' +
              ' 0 0 36px oklch(86% 0.10 70 / 0.35)',
          }}
        />
      </div>
    </div>
  );
});
