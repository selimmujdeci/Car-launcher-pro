import { memo } from 'react';

const ClockHand = ({
  angle, length, width, color, cx, cy,
}: { angle: number; length: number; width: number; color: string; cx: number; cy: number }) => {
  const rad = (angle - 90) * (Math.PI / 180);
  const x2  = cx + length * Math.cos(rad);
  const y2  = cy + length * Math.sin(rad);
  return <line x1={cx} y1={cy} x2={x2} y2={y2} stroke={color} strokeWidth={width} strokeLinecap="round" />;
};

export const AnalogClock = memo(function AnalogClock({
  size = 200, hours, minutes, seconds, showSeconds,
}: {
  size?: number;
  hours: number;
  minutes: number;
  seconds: number;
  showSeconds: boolean;
}) {
  const cx = size / 2;
  const cy = size / 2;
  const r  = size * 0.42;
  const hourAngle   = (hours + minutes / 60) * 30;
  const minuteAngle = (minutes + seconds / 60) * 6;
  const secondAngle = seconds * 6;

  return (
    <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} xmlns="http://www.w3.org/2000/svg">
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="1" />
      {[...Array(12)].map((_, i) => {
        const angle = i * 30;
        const rad   = (angle - 90) * (Math.PI / 180);
        const isBig = i % 3 === 0;
        const start = r * (isBig ? 0.85 : 0.88);
        const end   = r * (isBig ? 1    : 0.95);
        return (
          <line
            key={i}
            x1={cx + start * Math.cos(rad)} y1={cy + start * Math.sin(rad)}
            x2={cx + end   * Math.cos(rad)} y2={cy + end   * Math.sin(rad)}
            stroke={isBig ? 'rgba(255,255,255,0.4)' : 'rgba(255,255,255,0.15)'}
            strokeWidth={isBig ? 1.5 : 0.8}
            strokeLinecap="round"
          />
        );
      })}
      <ClockHand angle={hourAngle}   length={r * 0.50} width={2.5} color="rgba(255,255,255,0.9)" cx={cx} cy={cy} />
      <ClockHand angle={minuteAngle} length={r * 0.72} width={1.5} color="rgba(255,255,255,0.7)" cx={cx} cy={cy} />
      {showSeconds && (
        <g filter="drop-shadow(0 0 6px rgba(59,130,246,0.5))">
          <ClockHand angle={secondAngle} length={r * 0.85} width={1} color="#3b82f6" cx={cx} cy={cy} />
        </g>
      )}
      <circle cx={cx} cy={cy} r="3" fill="white" />
    </svg>
  );
});
