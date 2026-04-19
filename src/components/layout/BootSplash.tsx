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
      className={`ultra-premium-root fixed inset-0 z-[5000] flex flex-col items-center justify-center transition-all duration-700 pointer-events-none ${
        phase === 'fade' ? 'opacity-0 scale-110 blur-2xl' : 'opacity-100 scale-100'
      }`}
    >
      <div className="up-ambient-blobs">
        <div className="up-blob up-blob-1" />
        <div className="up-blob up-blob-2" />
      </div>

      <div className="relative flex flex-col items-center select-none z-10">
        <div className="relative mb-10">
          <div className="absolute inset-0 bg-blue-500/20 rounded-full blur-[60px] animate-pulse scale-150" />
          <SteeringWheel size={120} />
        </div>
        
        <div className="text-4xl font-black tracking-[0.4em] uppercase text-primary drop-shadow-2xl">
          CAR LAUNCHER
        </div>
        <div className="flex items-center gap-4 mt-2">
          <div className="h-px w-12 bg-gradient-to-r from-transparent to-blue-500" />
          <div className="text-sm font-black tracking-[0.8em] uppercase text-blue-400">PLATINUM</div>
          <div className="h-px w-12 bg-gradient-to-l from-transparent to-blue-500" />
        </div>
        
        <div className="text-[10px] font-black tracking-[0.5em] uppercase text-secondary mt-8">Sistem Başlatılıyor</div>
      </div>

      <div className="absolute bottom-20 w-64 h-1 var(--panel-bg-secondary) rounded-full overflow-hidden backdrop-blur-md border border-white/5">
        <div className="h-full bg-gradient-to-r from-blue-600 via-blue-400 to-blue-600 rounded-full animate-boot-bar shadow-[0_0_15px_#3b82f6]" />
      </div>
    </div>
  );
});


