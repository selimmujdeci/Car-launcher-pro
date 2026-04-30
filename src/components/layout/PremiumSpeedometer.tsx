/**
 * PremiumSpeedometer — Optimized Automotive Speedometer
 *
 * Performans mimarisi:
 *  - Hız: useFusedSpeed() — tek subscription, OBD+GPS sensor fusion + RAF animasyon
 *  - RPM/Sıcaklık/Yakıt: dar seçici hook'lar (useOBDRPM, useOBDEngineTemp, useOBDFuelLevel)
 *    → her biri yalnızca kendi alanı değişince re-render tetikler
 *  - SVG arc: displaySpeed (RAF interpole) ile hesaplanır — React state ile değil
 *  - Lite mod (2 GB RAM): GPU efektleri kapalı, RAF interpolasyon yok, glow filter yok
 */
import { memo, useMemo } from 'react';
import { useFusedSpeed }   from '../../platform/speedFusion';
import { useOBDRPM, useOBDEngineTemp, useOBDFuelLevel } from '../../platform/obdService';
import { getPerformanceMode } from '../../platform/performanceMode';
import { useRafSmoothed, useRafSmoothedPercent } from '../../platform/rafSmoother';

/* ── Props ──────────────────────────────────────────────────── */

interface Props {
  className?: string;
  compact?: boolean;
  numSize?: 'sm' | 'md' | 'lg' | 'xl';
}

/* ── SVG sabitler (değişmez → useMemo dışında) ─────────────── */

const RADIUS   = 108;
const CIRC     = 2 * Math.PI * RADIUS;   // ≈ 678.6
const ARC      = CIRC * 0.75;            // 270° ≈ 508.9
const MAX_SPD  = 240;
const MAX_RPM  = 8000;

const FONT_SIZE: Record<string, number> = { sm: 54, md: 66, lg: 78, xl: 96 };

const TICK_MAJOR = [0, 60, 120, 180, 240];
const TICK_MINOR = Array.from({ length: 27 }, (_, i) => (i / 26) * MAX_SPD)
  .filter((s) => !TICK_MAJOR.some((m) => Math.abs(s - m) < 5));

/* ── Yardımcılar ────────────────────────────────────────────── */

function tickCoords(spd: number, rOuter: number, rInner: number) {
  const angle = (135 + (spd / MAX_SPD) * 270) * (Math.PI / 180);
  return {
    x1: 150 + Math.cos(angle) * rOuter, y1: 150 + Math.sin(angle) * rOuter,
    x2: 150 + Math.cos(angle) * rInner, y2: 150 + Math.sin(angle) * rInner,
  };
}

/* ── Tick SVG grupları (sabit, re-render yok) ───────────────── */
const MajorTicks = memo(function MajorTicks() {
  return (
    <>
      {TICK_MAJOR.map((spd) => {
        const { x1, y1, x2, y2 } = tickCoords(spd, RADIUS + 6, RADIUS - 4);
        return <line key={spd} x1={x1} y1={y1} x2={x2} y2={y2}
          stroke="rgba(255,255,255,0.30)" strokeWidth="1.5" strokeLinecap="round" />;
      })}
    </>
  );
});

const MinorTicks = memo(function MinorTicks() {
  return (
    <>
      {TICK_MINOR.map((spd, i) => {
        const { x1, y1, x2, y2 } = tickCoords(spd, RADIUS + 4, RADIUS);
        return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2}
          stroke="rgba(255,255,255,0.12)" strokeWidth="1" strokeLinecap="round" />;
      })}
    </>
  );
});

/* ── Data row — her biri kendi narrow hook'unu kullanır ─────── */
const DataRow = memo(function DataRow() {
  // useOBDRPM() artık dahili RAF α=0.20 ile akıcı — tekrar sarmaya gerek yok
  const rpm        = useOBDRPM();
  const engineTemp = useOBDEngineTemp();
  const fuelLevel  = useOBDFuelLevel();

  // Sıcaklık ve yakıt için rafSmoother: obdService hook'ları bunları sarmalamıyor
  const displayTemp = useRafSmoothed(engineTemp, 0.06); // termal kütle — çok yavaş
  const displayFuel = useRafSmoothedPercent(fuelLevel); // titreme bastırma

  // -1 = ELM327 henüz bağlanmadı → "---" göster (sahte değer yok)
  const rpmStr  = rpm < 0        ? '---' : rpm.toLocaleString();
  const tempStr = engineTemp < 0 ? '---' : `${Math.round(displayTemp)}°`;
  const fuelStr = fuelLevel  < 0 ? '---' : `${Math.round(displayFuel)}%`;

  return (
    <div className="grid grid-cols-3 gap-2 w-full px-3 pb-2 flex-shrink-0">
      {([
        { label: 'RPM', value: rpmStr,  warn: false },
        { label: '°C',  value: tempStr, warn: engineTemp >= 0 && engineTemp > 100 },
        { label: 'YKT', value: fuelStr, warn: fuelLevel  >= 0 && fuelLevel  < 15  },
      ] as const).map(({ label, value, warn }) => (
        <div key={label}
          className="flex flex-col items-center gap-0.5 py-2 rounded-xl bg-white/[0.05] border border-white/[0.08] backdrop-blur-[12px]"
        >
          <span className="text-[9px] font-black uppercase tracking-widest text-white/40">{label}</span>
          <span className={`text-base font-black tabular-nums leading-none ${warn ? 'text-red-400' : 'text-white'}`}>{value}</span>
        </div>
      ))}
    </div>
  );
});

/* ── Ana bileşen ────────────────────────────────────────────── */

export const PremiumSpeedometer = memo(function PremiumSpeedometer({
  className = '',
  compact = false,
  numSize = 'lg',
}: Props) {
  const { displaySpeed, data } = useFusedSpeed();
  const perfMode  = getPerformanceMode();
  const isLite    = perfMode === 'lite';
  const noSignal  = data.source === 'none'; // ELM327 bağlı değil + GPS fix yok

  // SVG arc offset — RAF displaySpeed ile hesaplanır → animasyon CSS transition'sız
  const spdOffset = useMemo(
    () => ARC - Math.min(displaySpeed / MAX_SPD, 1) * ARC,
    [displaySpeed],
  );

  const textY  = numSize === 'xl' ? 158 : numSize === 'lg' ? 152 : 148;
  const kmhY   = numSize === 'xl' ? 186 : numSize === 'lg' ? 181 : 176;
  const fSize  = FONT_SIZE[numSize];

  // Lite modda glow/blur filtreler devre dışı — GPU belleği tasarrufu
  const glowFilter = isLite
    ? undefined
    : 'drop-shadow(0 0 12px var(--pack-accent, #3b82f6))';
  const outerGlow  = isLite
    ? undefined
    : 'drop-shadow(0 0 32px var(--pack-glow, rgba(59,130,246,0.35)))';

  // Plausibility uyarısı rengi
  const arcColor = data.plausibilityWarning
    ? 'var(--pack-warn, #f59e0b)'
    : 'var(--pack-accent, #3b82f6)';

  return (
    <div className={`flex flex-col items-center justify-center w-full h-full select-none ${className}`}>
      <div className="relative w-full flex-1 min-h-0 flex items-center justify-center">
        <svg
          viewBox="0 0 300 300"
          className="w-full h-full max-w-[320px] max-h-[320px]"
          style={{ filter: outerGlow, overflow: 'visible' }}
        >
          {/* ── Defs (lite modda glow filter yok) ── */}
          {!isLite && (
            <defs>
              <filter id="speedo-glow" x="-50%" y="-50%" width="200%" height="200%">
                <feGaussianBlur stdDeviation="4" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>
          )}

          {/* Ambient glow (premium/balanced only) */}
          {!isLite && (
            <circle cx="150" cy="150" r="130"
              fill="none"
              stroke="var(--pack-accent, #3b82f6)"
              strokeWidth="60"
              opacity="0.025"
            />
          )}

          {/* Outer ring border */}
          <circle cx="150" cy="150" r={RADIUS + 10}
            fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="1"
          />

          {/* Background track */}
          <circle cx="150" cy="150" r={RADIUS}
            fill="none" stroke="rgba(255,255,255,0.10)" strokeWidth="12"
            strokeDasharray={`${ARC} ${CIRC}`} strokeLinecap="round"
            transform="rotate(135 150 150)"
          />

          {/* Speed arc — sinyal yoksa gizli; RAF-driven, CSS transition YOK */}
          {!noSignal && (
            <circle
              cx="150" cy="150" r={RADIUS}
              fill="none"
              stroke={arcColor}
              strokeWidth="14"
              strokeDasharray={`${ARC} ${CIRC}`}
              strokeDashoffset={spdOffset}
              strokeLinecap="round"
              transform="rotate(135 150 150)"
              style={glowFilter ? { filter: glowFilter } : undefined}
            />
          )}

          {/* Inner thin ring (premium/balanced only) */}
          {!isLite && (
            <circle
              cx="150" cy="150" r={RADIUS - 20}
              fill="none"
              stroke={arcColor}
              strokeWidth="3"
              strokeDasharray={`${ARC} ${CIRC}`}
              strokeDashoffset={spdOffset}
              strokeLinecap="round"
              transform="rotate(135 150 150)"
              opacity="0.3"
            />
          )}

          {/* Ticks — memo ile sabit, re-render yok */}
          <MajorTicks />
          {!isLite && <MinorTicks />}

          {/* Hız rakamı — data.speed (anlık raw), lerp KULLANILMAZ */}
          {!noSignal && (
            <text
              x="150" y={textY}
              textAnchor="middle" dominantBaseline="middle"
              fontSize={fSize} fontWeight="900" fill="var(--speedo-color,#1e293b)"
              letterSpacing="-2"
              fontFamily="system-ui,-apple-system,sans-serif"
            >
              {data.speed}
            </text>
          )}

          {/* km/h etiketi */}
          <text
            x="150" y={kmhY}
            textAnchor="middle"
            fontSize="11" fontWeight="900"
            fill={noSignal ? 'rgba(255,255,255,0.25)' : arcColor}
            letterSpacing="5"
            fontFamily="system-ui,-apple-system,sans-serif"
          >
            KM/H
          </text>

          {/* Sinyal bekleniyorsa merkeze uyarı metni */}
          {noSignal && (
            <text
              x="150" y={textY}
              textAnchor="middle" dominantBaseline="middle"
              fontSize="13" fontWeight="700"
              fill="rgba(255,255,255,0.35)"
              letterSpacing="1"
              fontFamily="system-ui,-apple-system,sans-serif"
            >
              SİNYAL BEKLENİYOR
            </text>
          )}

          {/* Kaynak göstergesi — GPS/OBD/Fused (compact modda gizli) */}
          {!compact && !noSignal && (
            <text
              x="150" y="240"
              textAnchor="middle"
              fontSize="8" fontWeight="600"
              fill={data.plausibilityWarning ? 'var(--pack-warn,#f59e0b)' : 'rgba(255,255,255,0.30)'}
              letterSpacing="3"
              fontFamily="system-ui,-apple-system,sans-serif"
            >
              {data.source === 'fused' ? 'OBD+GPS' : data.source.toUpperCase()}
            </text>
          )}

          {/* RPM micro arc (premium/balanced only) */}
          {!compact && !isLite && (
            <RpmArc />
          )}
        </svg>

        {/* Ambient center glow (lite modda yok) */}
        {!isLite && (
          <div
            className="absolute inset-0 rounded-full pointer-events-none"
            style={{
              background: 'radial-gradient(ellipse at center, var(--pack-glow, rgba(59,130,246,0.08)) 0%, transparent 65%)',
            }}
          />
        )}
      </div>

      {/* Data row — ayrı memo bileşen, kendi narrow hook'larını kullanıyor */}
      {!compact && <DataRow />}
    </div>
  );
});

/* ── RPM arc — ayrı memo → sadece RPM değişince render ──────── */
const RpmArc = memo(function RpmArc() {
  // useOBDRPM() dahili RAF α=0.20 — SVG arc doğrudan akıcı değeri alır
  const rpm       = useOBDRPM();
  const rpmOffset = ARC - Math.min(rpm / MAX_RPM, 1) * ARC * 0.7;

  return (
    <>
      <circle
        cx="150" cy="150" r={RADIUS - 30}
        fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="5"
        strokeDasharray={`${ARC * 0.7} ${CIRC}`} strokeLinecap="round"
        transform="rotate(165 150 150)"
      />
      <circle
        cx="150" cy="150" r={RADIUS - 30}
        fill="none" stroke="var(--pack-accent, #3b82f6)" strokeWidth="4"
        strokeDasharray={`${ARC * 0.7} ${CIRC}`}
        strokeDashoffset={rpmOffset}
        strokeLinecap="round"
        transform="rotate(165 150 150)"
        opacity="0.45"
      />
    </>
  );
});
