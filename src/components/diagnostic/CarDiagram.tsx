import { memo } from 'react';
import type { ZoneStatus, ZoneState } from '../../platform/diagnostic/diagnosticStore';

const FILL: Record<ZoneState, string> = {
  ok:       '#0f172a',
  warn:     '#7c2d12',
  critical: '#7f1d1d',
  open:     '#78350f',
  low:      '#3b2005',
};

const STROKE: Record<ZoneState, string> = {
  ok:       '#1e293b',
  warn:     '#ea580c',
  critical: '#ef4444',
  open:     '#f97316',
  low:      '#eab308',
};

const GLOW: Record<ZoneState, string | undefined> = {
  ok:       undefined,
  warn:     undefined,
  critical: 'drop-shadow(0 0 5px #ef4444)',
  open:     'drop-shadow(0 0 4px #f97316)',
  low:      'drop-shadow(0 0 4px #eab308)',
};

interface ZoneRectProps extends React.SVGProps<SVGRectElement> {
  state: ZoneState;
}
function ZoneRect({ state, ...rest }: ZoneRectProps) {
  return (
    <rect
      fill={FILL[state]}
      stroke={STROKE[state]}
      strokeWidth={state === 'ok' ? 0.5 : 1.5}
      style={{ filter: GLOW[state] }}
      className={state === 'critical' ? 'animate-pulse' : undefined}
      {...rest}
    />
  );
}

interface WheelProps {
  state: ZoneState;
  cx: number;
  cy: number;
  label: string;
}
function Wheel({ state, cx, cy, label }: WheelProps) {
  return (
    <>
      <ellipse
        cx={cx} cy={cy} rx={9} ry={21}
        fill={FILL[state]}
        stroke={STROKE[state]}
        strokeWidth={state === 'ok' ? 0.5 : 2}
        style={{ filter: GLOW[state] }}
        className={state === 'critical' ? 'animate-pulse' : undefined}
      />
      <text
        x={cx} y={cy + 32}
        textAnchor="middle"
        fill={state === 'ok' ? '#374151' : STROKE[state]}
        fontSize="6.5"
        fontFamily="monospace"
      >
        {label}
      </text>
      {state !== 'ok' && (
        <text
          x={cx} y={cy}
          textAnchor="middle"
          dominantBaseline="middle"
          fill={STROKE[state]}
          fontSize="8"
          fontFamily="monospace"
        >
          {state === 'low' ? '↓' : '!'}
        </text>
      )}
    </>
  );
}

interface BadgeProps {
  state: ZoneState;
  cx: number;
  cy: number;
  label: string;
}
function Badge({ state, cx, cy, label }: BadgeProps) {
  if (state === 'ok') return null;
  return (
    <>
      <circle
        cx={cx} cy={cy} r={7}
        fill={FILL[state]}
        stroke={STROKE[state]}
        strokeWidth={1.5}
        style={{ filter: GLOW[state] }}
        className={state === 'critical' ? 'animate-pulse' : undefined}
      />
      <text
        x={cx} y={cy + 14}
        textAnchor="middle"
        fill={STROKE[state]}
        fontSize="6"
        fontFamily="monospace"
      >
        {label}
      </text>
    </>
  );
}

interface Props {
  zones: ZoneStatus;
  onZoneClick?: (zone: keyof ZoneStatus) => void;
}

export const CarDiagram = memo(function CarDiagram({ zones, onZoneClick }: Props) {
  const click = (zone: keyof ZoneStatus) => () => onZoneClick?.(zone);

  return (
    <svg
      viewBox="0 0 200 380"
      xmlns="http://www.w3.org/2000/svg"
      className="w-full select-none"
      style={{ maxWidth: 160 }}
    >
      {/* ── Car body base ────────────────────────────────── */}
      <rect x="30" y="22" width="140" height="330" rx="14"
        fill="#070d1a" stroke="#1e293b" strokeWidth="1.5"/>

      {/* ── Hood / Engine ───────────────────────────────── */}
      <ZoneRect
        state={zones.engine}
        x="33" y="24" width="134" height="92" rx="12"
        onClick={click('engine')}
        style={{ cursor: onZoneClick ? 'pointer' : undefined, filter: GLOW[zones.engine] }}
      />
      <text x="100" y="62" textAnchor="middle" fill="#6b7280" fontSize="9" fontFamily="monospace">MOTOR</text>
      {zones.engine !== 'ok' && (
        <text x="100" y="76" textAnchor="middle" fill={STROKE[zones.engine]} fontSize="7.5" fontFamily="monospace">⚠ DTC</text>
      )}

      {/* ── Windshield ──────────────────────────────────── */}
      <rect x="40" y="113" width="120" height="19" rx="3"
        fill="#0c1a3d" stroke="#1d4ed8" strokeWidth="0.5" opacity="0.9"/>

      {/* ── Front cabin divider ─────────────────────────── */}
      <line x1="100" y1="132" x2="100" y2="210" stroke="#1e293b" strokeWidth="0.8"/>

      {/* ── Front left door ─────────────────────────────── */}
      <ZoneRect
        state={zones.doorFL}
        x="33" y="132" width="65" height="78" rx="3"
        onClick={click('doorFL')}
        style={{ cursor: onZoneClick ? 'pointer' : undefined, filter: GLOW[zones.doorFL] }}
      />
      <text x="65" y="175" textAnchor="middle" fill={zones.doorFL !== 'ok' ? STROKE[zones.doorFL] : '#374151'} fontSize="7" fontFamily="monospace">
        {zones.doorFL === 'open' ? 'AÇIK' : 'ÖN-SOL'}
      </text>

      {/* ── Front right door ────────────────────────────── */}
      <ZoneRect
        state={zones.doorFR}
        x="102" y="132" width="65" height="78" rx="3"
        onClick={click('doorFR')}
        style={{ cursor: onZoneClick ? 'pointer' : undefined, filter: GLOW[zones.doorFR] }}
      />
      <text x="135" y="175" textAnchor="middle" fill={zones.doorFR !== 'ok' ? STROKE[zones.doorFR] : '#374151'} fontSize="7" fontFamily="monospace">
        {zones.doorFR === 'open' ? 'AÇIK' : 'ÖN-SAĞ'}
      </text>

      {/* ── Door sill separator ─────────────────────────── */}
      <line x1="33" y1="211" x2="167" y2="211" stroke="#1e293b" strokeWidth="0.8"/>
      <line x1="100" y1="211" x2="100" y2="288" stroke="#1e293b" strokeWidth="0.8"/>

      {/* ── Rear left door ──────────────────────────────── */}
      <ZoneRect
        state={zones.doorRL}
        x="33" y="212" width="65" height="68" rx="3"
        onClick={click('doorRL')}
        style={{ cursor: onZoneClick ? 'pointer' : undefined, filter: GLOW[zones.doorRL] }}
      />
      <text x="65" y="250" textAnchor="middle" fill={zones.doorRL !== 'ok' ? STROKE[zones.doorRL] : '#374151'} fontSize="7" fontFamily="monospace">
        {zones.doorRL === 'open' ? 'AÇIK' : 'AK-SOL'}
      </text>

      {/* ── Rear right door ─────────────────────────────── */}
      <ZoneRect
        state={zones.doorRR}
        x="102" y="212" width="65" height="68" rx="3"
        onClick={click('doorRR')}
        style={{ cursor: onZoneClick ? 'pointer' : undefined, filter: GLOW[zones.doorRR] }}
      />
      <text x="135" y="250" textAnchor="middle" fill={zones.doorRR !== 'ok' ? STROKE[zones.doorRR] : '#374151'} fontSize="7" fontFamily="monospace">
        {zones.doorRR === 'open' ? 'AÇIK' : 'AK-SAĞ'}
      </text>

      {/* ── Rear window ─────────────────────────────────── */}
      <rect x="40" y="281" width="120" height="18" rx="3"
        fill="#0c1a3d" stroke="#1d4ed8" strokeWidth="0.5" opacity="0.9"/>

      {/* ── Trunk ───────────────────────────────────────── */}
      <ZoneRect
        state={zones.trunk}
        x="33" y="300" width="134" height="48" rx="10"
        onClick={click('trunk')}
        style={{ cursor: onZoneClick ? 'pointer' : undefined, filter: GLOW[zones.trunk] }}
      />
      <text x="100" y="328" textAnchor="middle" fill={zones.trunk !== 'ok' ? STROKE[zones.trunk] : '#374151'} fontSize="8" fontFamily="monospace">
        {zones.trunk === 'open' ? 'BAGAJ AÇIK' : 'BAGAJ'}
      </text>

      {/* ── Wheels ──────────────────────────────────────── */}
      <Wheel state={zones.wheelFL} cx={18} cy={153} label="FL"/>
      <Wheel state={zones.wheelFR} cx={182} cy={153} label="FR"/>
      <Wheel state={zones.wheelRL} cx={18} cy={230} label="RL"/>
      <Wheel state={zones.wheelRR} cx={182} cy={230} label="RR"/>

      {/* ── Secondary system badges (only when fault) ───── */}
      <Badge state={zones.network}      cx={100} cy={163} label="AĞ"/>
      <Badge state={zones.transmission} cx={100} cy={245} label="ŞNZ"/>
      <Badge state={zones.brakes}       cx={55}  cy={163} label="FR"/>
    </svg>
  );
});
