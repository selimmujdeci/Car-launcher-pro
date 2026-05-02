/**
 * PremiumSpeedometer — SAB-Exclusive Gauge (PROMPT 4)
 *
 * Performans mimarisi:
 *  - Hız sayısı + hız arc + RPM arc: SAB Atomics.load → doğrudan DOM ref mutasyonu
 *    → React render döngüsünden TAMAMEN ayrık, 60 FPS, sıfır re-render maliyeti
 *  - noSignal / source / plausibilityWarning: useFusedSpeed() metadata-only
 *    → saniyeler mertebesinde değişir, re-render etkisi ihmal edilebilir
 *  - Sıcaklık / yakıt: dar seçici hook'lar (DataRow) — OBD frekansı ~300ms
 *  - Lite mod (2 GB RAM): GPU efektleri kapalı, glow filter yok
 *
 * Kritik kural: speedTextRef / speedArcRef / rpmArcRef null kontrolü her
 * onFrame callback'inde zorunludur — noSignal durumunda element DOM'da olmaz.
 */

import { memo, useRef, useMemo } from 'react';
import { useFusedSpeed }          from '../../platform/speedFusion';
import { useOBDRPM, useOBDEngineTemp, useOBDFuelLevel } from '../../platform/obdService';
import { getPerformanceMode }     from '../../platform/performanceMode';
import { useRafSmoothed, useRafSmoothedPercent } from '../../platform/rafSmoother';
import { useSABDirectUpdate, SAB_IDX } from '../../hooks/useSABDirectUpdate';

/* ── Props ──────────────────────────────────────────────────── */

interface Props {
  className?: string;
  compact?:   boolean;
  numSize?:   'sm' | 'md' | 'lg' | 'xl';
}

/* ── SVG sabitler ───────────────────────────────────────────── */

const RADIUS  = 108;
const CIRC    = 2 * Math.PI * RADIUS;
const ARC     = CIRC * 0.75;
const MAX_SPD = 240;
const MAX_RPM = 8000;

const FONT_SIZE: Record<string, number> = { sm: 54, md: 66, lg: 78, xl: 96 };

const TICK_MAJOR = [0, 60, 120, 180, 240];
const TICK_MINOR = Array.from({ length: 27 }, (_, i) => (i / 26) * MAX_SPD)
  .filter((s) => !TICK_MAJOR.some((m) => Math.abs(s - m) < 5));

function tickCoords(spd: number, rOuter: number, rInner: number) {
  const angle = (135 + (spd / MAX_SPD) * 270) * (Math.PI / 180);
  return {
    x1: 150 + Math.cos(angle) * rOuter, y1: 150 + Math.sin(angle) * rOuter,
    x2: 150 + Math.cos(angle) * rInner, y2: 150 + Math.sin(angle) * rInner,
  };
}

/* ── Tick grupları (sabit — memo ile re-render yok) ─────────── */

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

/* ── DataRow — OBD frekansında güncellenır (not 60 FPS) ─────── */

const DataRow = memo(function DataRow() {
  const rpm        = useOBDRPM();
  const engineTemp = useOBDEngineTemp();
  const fuelLevel  = useOBDFuelLevel();

  const displayTemp = useRafSmoothed(engineTemp, 0.06);
  const displayFuel = useRafSmoothedPercent(fuelLevel);

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
  compact   = false,
  numSize   = 'lg',
}: Props) {
  // ── Metadata: saniyeler mertebesinde değişen durum değerleri ──────────────
  // Bunlar 60 FPS'de değil; React render maliyeti ihmal edilebilir.
  const { data }  = useFusedSpeed();
  const perfMode  = getPerformanceMode();
  const isLite    = perfMode === 'lite';
  const noSignal  = data.source === 'none';

  const textY  = numSize === 'xl' ? 158 : numSize === 'lg' ? 152 : 148;
  const kmhY   = numSize === 'xl' ? 186 : numSize === 'lg' ? 181 : 176;
  const fSize  = FONT_SIZE[numSize];

  const glowFilter = isLite
    ? undefined
    : 'drop-shadow(0 0 12px var(--pack-accent, #3b82f6))';
  const outerGlow  = isLite
    ? undefined
    : 'drop-shadow(0 0 32px var(--pack-glow, rgba(59,130,246,0.35)))';

  const arcColor = data.plausibilityWarning
    ? 'var(--pack-warn, #f59e0b)'
    : 'var(--pack-accent, #3b82f6)';

  // ── DOM Refs — SAB onFrame callback'leri bunlara yazar ───────────────────
  // React render döngüsü dışında mutasyon — sıfır yeniden render
  const speedTextRef = useRef<SVGTextElement>(null);
  const speedArcRef  = useRef<SVGCircleElement>(null);
  const rpmArcRef    = useRef<SVGCircleElement>(null);

  // ── İlk render için statik dashoffset — SAB devreye girene kadar ─────────
  const initSpdOffset = useMemo(
    () => ARC - Math.min((data.speed ?? 0) / MAX_SPD, 1) * ARC,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [], // sadece ilk render — sonrasını SAB yönetir
  );

  // ── SAB → Hız rakamı + hız arc (60 FPS, sıfır re-render) ─────────────────
  useSABDirectUpdate(SAB_IDX.SPEED, (_raw, smoothed) => {
    // Rakam: EMA-smoothed → her frame kademeli değişim (Google Maps gibi)
    if (speedTextRef.current) {
      speedTextRef.current.textContent = String(Math.max(0, Math.round(smoothed)));
    }
    // Arc: EMA-smoothed → akıcı iğne hareketi
    const offset = ARC - Math.min(smoothed / MAX_SPD, 1) * ARC;
    if (speedArcRef.current) {
      speedArcRef.current.setAttribute('stroke-dashoffset', String(offset));
    }
  }, 0.30);

  // ── SAB → RPM arc (60 FPS, sıfır re-render) ──────────────────────────────
  useSABDirectUpdate(SAB_IDX.RPM, (_raw, smoothed) => {
    const offset = ARC - Math.min(smoothed / MAX_RPM, 1) * ARC * 0.7;
    if (rpmArcRef.current) {
      rpmArcRef.current.setAttribute('stroke-dashoffset', String(offset));
    }
  }, 0.25);

  return (
    <div className={`flex flex-col items-center justify-center w-full h-full select-none ${className}`}>
      <div className="relative w-full flex-1 min-h-0 flex items-center justify-center">
        <svg
          viewBox="0 0 300 300"
          className="w-full h-full max-w-[320px] max-h-[320px]"
          style={{ filter: outerGlow, overflow: 'visible' }}
        >
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

          {!isLite && (
            <circle cx="150" cy="150" r="130"
              fill="none"
              stroke="var(--pack-accent, #3b82f6)"
              strokeWidth="60"
              opacity="0.025"
            />
          )}

          <circle cx="150" cy="150" r={RADIUS + 10}
            fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="1"
          />

          {/* Background track */}
          <circle cx="150" cy="150" r={RADIUS}
            fill="none" stroke="rgba(255,255,255,0.10)" strokeWidth="12"
            strokeDasharray={`${ARC} ${CIRC}`} strokeLinecap="round"
            transform="rotate(135 150 150)"
          />

          {/* Hız arc — SAB ref ile doğrudan güncellenir; React useMemo YOK */}
          {!noSignal && (
            <circle
              ref={speedArcRef}
              cx="150" cy="150" r={RADIUS}
              fill="none"
              stroke={arcColor}
              strokeWidth="14"
              strokeDasharray={`${ARC} ${CIRC}`}
              strokeDashoffset={initSpdOffset}
              strokeLinecap="round"
              transform="rotate(135 150 150)"
              style={glowFilter ? { filter: glowFilter } : undefined}
            />
          )}

          {!isLite && !noSignal && (
            <circle
              cx="150" cy="150" r={RADIUS - 20}
              fill="none"
              stroke={arcColor}
              strokeWidth="3"
              strokeDasharray={`${ARC} ${CIRC}`}
              strokeDashoffset={initSpdOffset}
              strokeLinecap="round"
              transform="rotate(135 150 150)"
              opacity="0.3"
            />
          )}

          <MajorTicks />
          {!isLite && <MinorTicks />}

          {/* Hız rakamı — SAB ref ile doğrudan güncellenir */}
          {!noSignal && (
            <text
              ref={speedTextRef}
              x="150" y={textY}
              textAnchor="middle" dominantBaseline="middle"
              fontSize={fSize} fontWeight="900" fill="var(--speedo-color,#1e293b)"
              letterSpacing="-2"
              fontFamily="system-ui,-apple-system,sans-serif"
            >
              {data.speed}
            </text>
          )}

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

          {/* RPM micro arc — SAB ref ile doğrudan güncellenir */}
          {!compact && !isLite && (
            <>
              <circle
                cx="150" cy="150" r={RADIUS - 30}
                fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="5"
                strokeDasharray={`${ARC * 0.7} ${CIRC}`} strokeLinecap="round"
                transform="rotate(165 150 150)"
              />
              <circle
                ref={rpmArcRef}
                cx="150" cy="150" r={RADIUS - 30}
                fill="none" stroke="var(--pack-accent, #3b82f6)" strokeWidth="4"
                strokeDasharray={`${ARC * 0.7} ${CIRC}`}
                strokeDashoffset={ARC * 0.7} // başlangıç: 0 RPM
                strokeLinecap="round"
                transform="rotate(165 150 150)"
                opacity="0.45"
              />
            </>
          )}
        </svg>

        {!isLite && (
          <div
            className="absolute inset-0 rounded-full pointer-events-none"
            style={{
              background: 'radial-gradient(ellipse at center, var(--pack-glow, rgba(59,130,246,0.08)) 0%, transparent 65%)',
            }}
          />
        )}
      </div>

      {!compact && <DataRow />}
    </div>
  );
});
