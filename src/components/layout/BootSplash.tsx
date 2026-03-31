import { memo } from 'react';

export type BootPhase = 'show' | 'fade' | 'done';

const SteeringWheel = memo(function SteeringWheel({ size = 48 }: { size?: number }) {
  const cx = size / 2, cy = size / 2, r = size * 0.42;
  const hub = size * 0.11;
  const sw  = size * 0.055;
  const spoke = (angleDeg: number, inner: boolean) => {
    const rad  = (angleDeg - 90) * (Math.PI / 180);
    const dist = inner ? hub * 1.3 : r;
    return { x: cx + dist * Math.cos(rad), y: cy + dist * Math.sin(rad) };
  };
  return (
    <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx={cx} cy={cy} r={r} stroke="#3b82f6" strokeWidth={sw * 0.6} opacity="0.2" />
      <circle cx={cx} cy={cy} r={r} stroke="#3b82f6" strokeWidth={sw * 0.5} />
      <circle cx={cx} cy={cy} r={hub} fill="#3b82f6" />
      {[0, 120, 240].map((a) => {
        const from = spoke(a, true);
        const to   = spoke(a, false);
        return <line key={a} x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke="#3b82f6" strokeWidth={sw * 0.6} strokeLinecap="round" />;
      })}
    </svg>
  );
});

export const BootSplash = memo(function BootSplash({ phase }: { phase: BootPhase }) {
  if (phase === 'done') return null;
  return (
    <div
      className={`fixed inset-0 z-50 flex flex-col items-center justify-center transition-opacity duration-300 pointer-events-none ${
        phase === 'fade' ? 'opacity-0' : 'opacity-100'
      }`}
      style={{ background: '#060d1a' }}
    >
      <div className="flex flex-col items-center mb-10 select-none">
        <div className="relative mb-5">
          <div className="absolute inset-0 bg-blue-500/15 rounded-full blur-xl scale-150" />
          <SteeringWheel size={64} />
        </div>
        <div className="text-xl font-bold tracking-[0.2em] uppercase text-white">Car Launcher</div>
        <div className="text-[11px] font-semibold tracking-[0.45em] uppercase text-blue-500 mt-1">Pro</div>
        <div className="text-[9px] font-medium tracking-[0.3em] uppercase text-slate-600 mt-2">Araç Kontrol Merkezi</div>
      </div>
      <div className="w-28 h-px bg-white/5 rounded-full overflow-hidden">
        <div className="h-full bg-blue-500 rounded-full animate-boot-bar" />
      </div>
    </div>
  );
});
