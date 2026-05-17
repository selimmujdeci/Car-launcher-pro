import { useId, memo, type CSSProperties } from 'react';
import { HEAVY_INERTIA_EASE, HEAVY_INERTIA_MS } from '../DiagnosticPulse';
import { WRITE_LOCK_THRESHOLD } from '../../../platform/expert/TrustEngine';

export const HEAVY_INERTIA_STYLE: CSSProperties = {
  transitionProperty:       'opacity, transform, color, background-color, border-color, stroke, stroke-dashoffset',
  transitionDuration:       `${HEAVY_INERTIA_MS}ms`,
  transitionTimingFunction: HEAVY_INERTIA_EASE,
};

function gaugeAccent(score: number, writeLocked: boolean): string {
  if (writeLocked || score < WRITE_LOCK_THRESHOLD) return '#ef4444';
  if (score <= 85) return '#f59e0b';
  return '#22c55e';
}

function gaugeLabel(score: number, writeLocked: boolean): string {
  if (writeLocked || score < WRITE_LOCK_THRESHOLD) return 'Yazma Kilidi';
  if (score <= 85) return 'Kısıtlı İzleme';
  return 'Nominal Çalışma';
}

type AccessLevelBadge = 'LOCKED' | 'LIMITED' | 'VERIFIED';

function resolveAccessLevel(score: number, writeLocked: boolean): AccessLevelBadge {
  if (writeLocked || score < WRITE_LOCK_THRESHOLD) return 'LOCKED';
  if (score <= 85) return 'LIMITED';
  return 'VERIFIED';
}

/** Rozet görünen metin — iç mantık anahtarları (LOCKED vb.) değişmez */
const ACCESS_LEVEL_LABEL: Record<AccessLevelBadge, string> = {
  LOCKED:   'KİLİTLİ',
  LIMITED:  'KISITLI',
  VERIFIED: 'DOĞRULANDI',
};

const ACCESS_LEVEL_STYLE: Record<AccessLevelBadge, { ring: string; fg: string }> = {
  LOCKED: {
    ring: 'border-red-400/45 bg-red-950/55 shadow-[0_0_28px_rgba(239,68,68,0.22)]',
    fg:   'text-red-100',
  },
  LIMITED: {
    ring: 'border-amber-400/45 bg-amber-950/40 shadow-[0_0_28px_rgba(245,158,11,0.18)]',
    fg:   'text-amber-100',
  },
  VERIFIED: {
    ring: 'border-emerald-400/40 bg-emerald-950/45 shadow-[0_0_28px_rgba(34,197,94,0.2)]',
    fg:   'text-emerald-100',
  },
};

/** Yalnızca SECURE durumunda — ağır atalet 400 ms; güven yayı 180° ark + 1 Hz nabız */
export const ExpertTrustGauge = memo(function ExpertTrustGauge({
  score,
  writeLocked,
}: {
  score:       number;
  writeLocked: boolean;
}) {
  const filterId    = useId().replace(/:/g, '');
  const accent      = gaugeAccent(score, writeLocked);
  const accessLevel = resolveAccessLevel(score, writeLocked);
  const badge       = ACCESS_LEVEL_STYLE[accessLevel];
  const arcDash     = 100;
  const arcOffset   = arcDash - (arcDash * score) / 100;

  return (
    <div
      className="relative flex flex-col items-center justify-center overflow-hidden rounded-2xl border border-white/[0.06] bg-white/[0.02] p-6"
      style={HEAVY_INERTIA_STYLE}
    >
      <div
        className="absolute left-0 right-0 top-0 h-1"
        style={{ ...HEAVY_INERTIA_STYLE, background: accent }}
      />

      <div className="relative z-[1] flex w-full max-w-[260px] flex-col items-center">
        <p className="text-[9px] font-black uppercase tracking-[0.38em] text-white/35">Erişim Seviyesi</p>
        <div
          className={`mt-3 rounded-2xl border px-5 py-2.5 ${badge.ring} ${badge.fg}`}
          style={HEAVY_INERTIA_STYLE}
        >
          <span className="block text-center text-[13px] font-black uppercase tracking-[0.28em]">
            {ACCESS_LEVEL_LABEL[accessLevel]}
          </span>
        </div>

        <p className="mt-3 text-center text-[9px] font-bold uppercase tracking-[0.22em] text-cyan-400/75">
          Donanımsal Güven: MÜHÜRLÜ (TEE)
        </p>

        <div className="relative mt-1 h-[108px] w-full max-w-[220px]">
          <svg
            className="h-full w-full overflow-visible"
            viewBox="0 0 120 78"
            fill="none"
            aria-hidden
          >
            <defs>
              <filter id={filterId} x="-40%" y="-40%" width="180%" height="180%">
                <feGaussianBlur stdDeviation="2.2" result="b" />
                <feMerge>
                  <feMergeNode in="b" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>
            <path
              d="M 14 72 A 46 46 0 0 1 106 72"
              stroke="rgba(255,255,255,0.07)"
              strokeWidth="7"
              strokeLinecap="round"
              pathLength={arcDash}
            />
            <path
              className="trust-gauge-arc-pulse"
              d="M 14 72 A 46 46 0 0 1 106 72"
              stroke={accent}
              strokeWidth="7"
              strokeLinecap="round"
              pathLength={arcDash}
              strokeDasharray={arcDash}
              strokeDashoffset={arcOffset}
              filter={`url(#${filterId})`}
              style={{
                ...HEAVY_INERTIA_STYLE,
                transitionProperty: 'stroke, stroke-dashoffset',
              }}
            />
          </svg>
        </div>

        <div className="mt-1 flex flex-col items-center gap-0.5 text-center">
          <span
            className="text-[10px] font-black uppercase tracking-widest"
            style={{ ...HEAVY_INERTIA_STYLE, color: accent }}
          >
            {gaugeLabel(score, writeLocked)}
          </span>
          <div className="flex items-baseline gap-2 text-white/38">
            <span className="text-[9px] font-bold uppercase tracking-widest">Güven skoru</span>
            <span
              className="font-mono text-sm font-black tabular-nums text-white/55"
              style={HEAVY_INERTIA_STYLE}
            >
              {Math.round(score)}
            </span>
          </div>
        </div>
      </div>

      <p className="relative z-[1] mt-4 text-center text-[11px] font-medium leading-relaxed text-white/40">
        {writeLocked
          ? 'Güven skoru yapılandırılmış eşiğe ulaşana kadar yazma işlemleri engellenir.'
          : 'Geçerli güven politikası ve eşikler çerçevesinde yazma işlemlerine izin verilir.'}
      </p>
    </div>
  );
});
