// Premium OEM navigation map — ported from design handoff map.jsx
// Replaces MiniMapWidget in OEM cockpit context. Uses CSS vars from oem-cockpit.css.

import '../../styles/oem-cockpit.css';

// ── Pre-computed building footprints (deterministic, no Math.random per render) ──
const CITY_PLOTS = (() => {
  const plots: Array<{ x: number; y: number; w: number; h: number; ext: number; variant: number; shimmer: boolean }> = [];
  const rows = [
    { y: 50,  band: [50, 90],  stripe: 0 },
    { y: 160, band: [55, 110], stripe: 1 },
    { y: 270, band: [60, 120], stripe: 0 },
    { y: 380, band: [50, 90],  stripe: 1 },
    { y: 580, band: [70, 130], stripe: 0 },
    { y: 700, band: [55, 95],  stripe: 1 },
    { y: 810, band: [50, 90],  stripe: 0 },
    { y: 910, band: [45, 80],  stripe: 1 },
  ];
  let seed = 1337;
  const rand = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
  rows.forEach(row => {
    let x = 30;
    while (x < 1570) {
      const w = 40 + Math.floor(rand() * 90);
      const h = row.band[0] + Math.floor(rand() * (row.band[1] - row.band[0]));
      const ext = 6 + Math.floor(rand() * 10);
      const arterials = [380, 760, 1120];
      const inArt = arterials.some(a => x < a + 28 && x + w > a - 28);
      if (!inArt && (x + w) < 1570) {
        plots.push({ x, y: row.y, w, h, ext, variant: row.stripe ^ (Math.floor(rand() * 2)), shimmer: rand() > 0.88 });
      }
      x += w + 10 + Math.floor(rand() * 14);
    }
  });
  return plots;
})();

function BuildingBlocks() {
  return (
    <g>
      {CITY_PLOTS.map((b, i) => (
        <rect key={'sh' + i} x={b.x + 4} y={b.y + 6} width={b.w} height={b.h} rx="3"
          fill="rgba(0,0,0,0.35)" style={{ filter: 'blur(3px)' }} />
      ))}
      {CITY_PLOTS.map((b, i) => (
        <path key={'ex' + i}
          d={`M ${b.x + b.w} ${b.y} L ${b.x + b.w + b.ext} ${b.y + b.ext} L ${b.x + b.w + b.ext} ${b.y + b.h + b.ext} L ${b.x + b.w} ${b.y + b.h} Z M ${b.x} ${b.y + b.h} L ${b.x + b.ext} ${b.y + b.h + b.ext} L ${b.x + b.w + b.ext} ${b.y + b.h + b.ext} L ${b.x + b.w} ${b.y + b.h} Z`}
          style={{ fill: 'var(--map-bldg-extrude)' }} opacity="0.9" />
      ))}
      {CITY_PLOTS.map((b, i) => (
        <g key={'rf' + i}>
          <rect x={b.x} y={b.y} width={b.w} height={b.h} rx="3"
            fill={b.variant ? 'url(#oemBldgG2)' : 'url(#oemBldgG)'} />
          <rect x={b.x} y={b.y} width={b.w} height="2" rx="1" style={{ fill: 'var(--map-bldg-edge)' }} />
          <rect x={b.x} y={b.y} width="1.5" height={b.h} style={{ fill: 'var(--map-bldg-edge)' }} opacity="0.5" />
          <rect x={b.x} y={b.y} width={b.w} height={b.h} rx="3"
            fill="none" style={{ stroke: 'var(--map-bldg-stroke)' }} strokeWidth="0.6" />
          {b.shimmer && (
            <g style={{ fill: 'var(--map-bldg-window)' }}>
              <rect x={b.x + 6}  y={b.y + 10} width="3" height="3" />
              <rect x={b.x + 14} y={b.y + 10} width="3" height="3" />
              <rect x={b.x + 6}  y={b.y + 22} width="3" height="3" />
              <rect x={b.x + 22} y={b.y + 18} width="3" height="3" />
            </g>
          )}
        </g>
      ))}
    </g>
  );
}

function POIs() {
  const pois = [
    { x: 240,  y: 230, type: 'charge', label: '350 kW · Hızlı Şarj' },
    { x: 770,  y: 220, type: 'fuel',   label: 'Petrol Ofisi' },
    { x: 720,  y: 700, type: 'food',   label: 'Kahve' },
    { x: 1200, y: 640, type: 'charge', label: 'Tofaş · Şarj' },
    { x: 290,  y: 700, type: 'food',   label: 'Lokanta' },
  ];
  return (
    <g>
      {pois.map((p, i) => {
        const c = `var(--map-poi-${p.type})`;
        return (
          <g key={i}>
            {/* OEM amber outer halo — additive luxury ambient (transparent under SAFE_MODE) */}
            <circle cx={p.x} cy={p.y} r="26" fill="var(--oem-amber-glow, transparent)" opacity="0.55" />
            <circle cx={p.x} cy={p.y} r="20" fill={c} opacity="0.10" />
            <circle cx={p.x} cy={p.y} r="15" style={{ fill: 'var(--map-poi-bg)' }} stroke={c} strokeWidth="2.5" />
            {p.type === 'charge' && (
              <path d={`M ${p.x - 4} ${p.y - 6} L ${p.x + 2} ${p.y - 1} L ${p.x - 1} ${p.y - 1} L ${p.x + 4} ${p.y + 6} L ${p.x - 2} ${p.y + 1} L ${p.x + 1} ${p.y + 1} Z`} fill={c} />
            )}
            {p.type === 'fuel' && (
              <g style={{ stroke: c }} strokeWidth="2" fill="none" strokeLinecap="round">
                <rect x={p.x - 4.5} y={p.y - 5} width="7" height="10" rx="1" />
                <path d={`M ${p.x + 3} ${p.y - 2} L ${p.x + 6} ${p.y - 2} L ${p.x + 6} ${p.y + 3}`} />
              </g>
            )}
            {p.type === 'food' && (
              <g style={{ stroke: c }} strokeWidth="2" fill="none">
                <circle cx={p.x} cy={p.y} r="5" />
                <circle cx={p.x} cy={p.y} r="1.5" fill={c} />
              </g>
            )}
            {p.label && (
              <g>
                <rect x={p.x + 20} y={p.y - 10} width={p.label.length * 7.2 + 14} height="20" rx="10"
                  style={{ fill: 'var(--map-poi-bg)' }} stroke="rgba(0,0,0,0.2)" strokeWidth="0.5" />
                <text x={p.x + 27} y={p.y + 4} fontFamily="Manrope, sans-serif" fontSize="11" fontWeight="600"
                  style={{ fill: 'var(--map-poi-text)' }} letterSpacing="0.01em">{p.label}</text>
              </g>
            )}
          </g>
        );
      })}
    </g>
  );
}

export function DestinationPin() {
  return (
    <svg width="64" height="80" viewBox="0 0 64 80">
      <defs>
        <linearGradient id="oemPinG" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" style={{ stopColor: 'var(--map-route-a)' }} />
          <stop offset="1" style={{ stopColor: 'var(--map-route-b)' }} />
        </linearGradient>
        <radialGradient id="oemPinHalo">
          <stop offset="0" stopColor="oklch(85% 0.12 60 / 0.55)" />
          <stop offset="1" stopColor="oklch(85% 0.12 60 / 0)" />
        </radialGradient>
      </defs>
      <circle cx="32" cy="32" r="30" fill="url(#oemPinHalo)" />
      <ellipse cx="32" cy="74" rx="14" ry="4" fill="rgba(0,0,0,0.55)" />
      <path d="M32 8 C 19 8 9 18 9 30 C 9 42 24 60 32 70 C 40 60 55 42 55 30 C 55 18 45 8 32 8 Z"
        fill="url(#oemPinG)" stroke="rgba(20,12,4,0.7)" strokeWidth="1.6" />
      <circle cx="32" cy="30" r="9" fill="#1A140A" opacity="0.92" />
      <circle cx="32" cy="30" r="3.5" fill="oklch(92% 0.08 80)" />
      <path d="M22 16 Q26 12 32 12" stroke="rgba(255,250,235,0.5)" strokeWidth="2" fill="none" strokeLinecap="round" />
    </svg>
  );
}

export function CarPuck({ heading = 35 }: { heading?: number }) {
  return (
    <div style={{ position: 'relative', width: 0, height: 0 }}>
      <div style={{
        position: 'absolute', width: 108, height: 108,
        marginLeft: -54, marginTop: -54,
        borderRadius: 999,
        background: 'radial-gradient(circle, oklch(80% 0.12 60 / 0.30), transparent 70%)',
        animation: 'oemHaloPulse 4s ease-in-out infinite',
      }} />
      <svg width="120" height="120" viewBox="-60 -60 120 120" style={{
        position: 'absolute', left: -60, top: -60,
        transform: `rotate(${heading}deg)`,
      }}>
        <defs>
          <linearGradient id="oemConeG" x1="0" y1="1" x2="0" y2="0">
            <stop offset="0" stopColor="oklch(86% 0.12 60 / 0)" />
            <stop offset="1" stopColor="oklch(86% 0.12 60 / 0.55)" />
          </linearGradient>
        </defs>
        <path d="M 0 0 L -36 -52 Q 0 -68 36 -52 Z" fill="url(#oemConeG)" />
      </svg>
      <div style={{
        position: 'absolute', left: -16, top: -16, width: 32, height: 32, borderRadius: 999,
        background: 'linear-gradient(135deg, oklch(90% 0.10 70), oklch(58% 0.13 45))',
        border: '4px solid #1A140A',
        boxShadow: '0 0 0 2px oklch(70% 0.10 60 / 0.65), 0 0 0 8px rgba(255,235,200,0.05), 0 10px 30px oklch(60% 0.13 50 / 0.6)',
      }} />
    </div>
  );
}

function ParkArea() {
  return (
    <g>
      <path d="M 1040 120 Q 1200 80 1400 140 L 1480 360 Q 1420 440 1240 420 Q 1100 400 1020 320 Z"
        fill="url(#oemParkG)" />
      <path d="M 1040 120 Q 1200 80 1400 140 L 1480 360 Q 1420 440 1240 420 Q 1100 400 1020 320 Z"
        fill="none" style={{ stroke: 'var(--map-park-edge)' }} strokeWidth="2.5" />
      {[
        [1110, 170], [1190, 180], [1260, 190], [1340, 200], [1410, 210],
        [1140, 240], [1220, 250], [1290, 260], [1370, 270], [1430, 280],
        [1170, 310], [1250, 320], [1330, 330], [1400, 340],
        [1210, 380], [1290, 390], [1360, 400],
      ].map(([cx, cy], i) => (
        <g key={i}>
          <ellipse cx={(cx ?? 0) + 2} cy={(cy ?? 0) + 3} rx="13" ry="6" fill="rgba(0,0,0,0.20)" />
          <circle cx={cx} cy={cy} r="11" style={{ fill: 'var(--map-tree)' }} />
          <circle cx={(cx ?? 0) - 2} cy={(cy ?? 0) - 2} r="6" style={{ fill: 'var(--map-tree-hi)' }} opacity="0.7" />
        </g>
      ))}
    </g>
  );
}

function Water() {
  return (
    <g>
      <path d="M -40 900 Q 200 840 480 880 Q 760 920 1040 860 Q 1280 820 1640 720 L 1640 1040 L -40 1040 Z"
        fill="url(#oemWaterG)" />
      <path d="M -40 900 Q 200 840 480 880 Q 760 920 1040 860 Q 1280 820 1640 720"
        fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="2" />
      <path d="M 200 900 Q 400 880 600 895 M 800 910 Q 1000 880 1200 870 M 300 950 Q 500 935 700 945"
        fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="1.5" />
    </g>
  );
}

// ── Main MapVignette export ───────────────────────────────────────────────────
export function OEMMapVignette({
  route = false,
  heading = 35,
  children,
}: {
  route?: boolean;
  heading?: number;
  children?: React.ReactNode;
}) {
  return (
    <div style={{ width: '100%', height: '100%', position: 'relative', overflow: 'hidden',
      background: 'linear-gradient(180deg, var(--map-bg-1), var(--map-bg-2) 60%, var(--map-bg-3))' }}>
      <svg viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice"
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
        <defs>
          <linearGradient id="oemHwyG" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" style={{ stopColor: 'var(--map-hwy-a)' }} />
            <stop offset="1" style={{ stopColor: 'var(--map-hwy-b)' }} />
          </linearGradient>
          <linearGradient id="oemArtG" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" style={{ stopColor: 'var(--map-art-a)' }} />
            <stop offset="1" style={{ stopColor: 'var(--map-art-b)' }} />
          </linearGradient>
          <linearGradient id="oemParkG" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" style={{ stopColor: 'var(--map-park-a)' }} />
            <stop offset="1" style={{ stopColor: 'var(--map-park-b)' }} />
          </linearGradient>
          <linearGradient id="oemWaterG" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" style={{ stopColor: 'var(--map-water-a)' }} />
            <stop offset="1" style={{ stopColor: 'var(--map-water-b)' }} />
          </linearGradient>
          <linearGradient id="oemBldgG" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" style={{ stopColor: 'var(--map-bldg-1a)' }} />
            <stop offset="1" style={{ stopColor: 'var(--map-bldg-1b)' }} />
          </linearGradient>
          <linearGradient id="oemBldgG2" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" style={{ stopColor: 'var(--map-bldg-2a)' }} />
            <stop offset="1" style={{ stopColor: 'var(--map-bldg-2b)' }} />
          </linearGradient>
          <linearGradient id="oemRouteGrad" x1="0" y1="1" x2="1" y2="0">
            <stop offset="0"   style={{ stopColor: 'var(--map-route-a)' }} />
            <stop offset="0.6" style={{ stopColor: 'var(--map-route-b)' }} />
            <stop offset="1"   style={{ stopColor: 'var(--map-route-a)' }} />
          </linearGradient>
          <linearGradient id="oemHazeG" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" style={{ stopColor: 'var(--map-haze)' }} stopOpacity="0.8" />
            <stop offset="1" style={{ stopColor: 'var(--map-haze)' }} stopOpacity="0" />
          </linearGradient>
          <filter id="oemRouteGlow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="14" />
          </filter>
          <filter id="oemSoftGlow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="6" />
          </filter>
        </defs>

        <ParkArea />
        <Water />
        <BuildingBlocks />

        {/* Highway E-W */}
        <g>
          <path d="M -60 480 Q 280 470 580 460 T 1160 440 Q 1380 432 1660 420"
            style={{ stroke: 'var(--map-casing)' }} strokeWidth="58" fill="none" strokeLinecap="round" />
          <path d="M -60 480 Q 280 470 580 460 T 1160 440 Q 1380 432 1660 420"
            stroke="url(#oemHwyG)" strokeWidth="50" fill="none" strokeLinecap="round" />
          <path d="M -60 480 Q 280 470 580 460 T 1160 440 Q 1380 432 1660 420"
            style={{ stroke: 'var(--map-divider-warn)' }} strokeWidth="2" fill="none" />
          <path d="M -60 466 Q 280 456 580 446 T 1160 426 Q 1380 418 1660 406"
            style={{ stroke: 'var(--map-centerline)' }} strokeWidth="1.6" fill="none" strokeDasharray="14 18" />
          <path d="M -60 494 Q 280 484 580 474 T 1160 454 Q 1380 446 1660 434"
            style={{ stroke: 'var(--map-centerline)' }} strokeWidth="1.6" fill="none" strokeDasharray="14 18" />
          <path d="M 540 462 Q 700 454 880 446" style={{ stroke: 'var(--map-traffic-yellow)' }} strokeWidth="6" fill="none" strokeLinecap="round" />
          <path d="M 1140 442 Q 1320 432 1500 422" style={{ stroke: 'var(--map-traffic-red)' }} strokeWidth="6" fill="none" strokeLinecap="round" />
          <path d="M -60 480 Q 80 476 200 472" style={{ stroke: 'var(--map-traffic-green)' }} strokeWidth="6" fill="none" strokeLinecap="round" />
        </g>

        {/* Arterials N-S */}
        <g>
          <path d="M 360 -40 L 400 1040" style={{ stroke: 'var(--map-casing)' }} strokeWidth="42" fill="none" />
          <path d="M 360 -40 L 400 1040" stroke="url(#oemArtG)" strokeWidth="34" fill="none" />
          <path d="M 360 -40 L 400 1040" style={{ stroke: 'var(--map-centerline)' }} strokeWidth="1.4" fill="none" strokeDasharray="12 16" />
          <path d="M 740 -40 L 780 1040" style={{ stroke: 'var(--map-casing)' }} strokeWidth="38" fill="none" />
          <path d="M 740 -40 L 780 1040" stroke="url(#oemArtG)" strokeWidth="30" fill="none" />
          <path d="M 740 -40 L 780 1040" style={{ stroke: 'var(--map-centerline)' }} strokeWidth="1.4" fill="none" strokeDasharray="12 16" />
          <path d="M 1100 -40 L 1140 1040" style={{ stroke: 'var(--map-casing)' }} strokeWidth="34" fill="none" />
          <path d="M 1100 -40 L 1140 1040" stroke="url(#oemArtG)" strokeWidth="26" fill="none" />
        </g>

        {/* Secondary E-W */}
        <g style={{ stroke: 'var(--map-secondary-casing)' }} strokeWidth="20" fill="none" strokeLinecap="round">
          <path d="M -40 220 L 1640 210" /><path d="M -40 760 L 1640 750" /><path d="M -40 100 L 1640 90" />
        </g>
        <g style={{ stroke: 'var(--map-secondary)' }} strokeWidth="14" fill="none" strokeLinecap="round">
          <path d="M -40 220 L 1640 210" /><path d="M -40 760 L 1640 750" /><path d="M -40 100 L 1640 90" />
        </g>

        {/* Residential */}
        <g style={{ stroke: 'var(--map-residential-casing)' }} strokeWidth="11" fill="none" strokeLinecap="round" opacity="0.95">
          <path d="M -40 320 L 1640 320" /><path d="M -40 640 L 1640 640" /><path d="M -40 870 L 1640 870" />
          <path d="M 120 -10 L 140 1040" /><path d="M 540 -10 L 560 1040" />
          <path d="M 920 -10 L 940 1040" /><path d="M 1320 -10 L 1340 1040" />
        </g>
        <g style={{ stroke: 'var(--map-residential)' }} strokeWidth="7" fill="none" strokeLinecap="round" opacity="0.95">
          <path d="M -40 320 L 1640 320" /><path d="M -40 640 L 1640 640" /><path d="M -40 870 L 1640 870" />
          <path d="M 120 -10 L 140 1040" /><path d="M 540 -10 L 560 1040" />
          <path d="M 920 -10 L 940 1040" /><path d="M 1320 -10 L 1340 1040" />
        </g>

        {/* Junction circles */}
        <g>
          {([[400, 460], [780, 450], [1140, 442]] as [number, number][]).map(([cx, cy], i) => (
            <circle key={i} cx={cx} cy={cy} r="6" style={{ fill: 'var(--map-junction)' }} />
          ))}
        </g>

        {/* Street labels */}
        <g fontFamily="Manrope, sans-serif" fontWeight="700" letterSpacing="0.06em">
          <text x="280" y="450" fontSize="20" style={{ fill: 'var(--map-label-halo)' }}
            stroke="var(--map-label-halo)" strokeWidth="4" paintOrder="stroke">FATİH SULTAN MEHMET BLV</text>
          <text x="280" y="450" fontSize="20" style={{ fill: 'var(--map-label)' }}>FATİH SULTAN MEHMET BLV</text>
          <text x="394" y="760" fontSize="17" style={{ fill: 'var(--map-label)' }} transform="rotate(89.2 394 760)">VATAN CAD</text>
          <text x="774" y="760" fontSize="17" style={{ fill: 'var(--map-label)' }} transform="rotate(89.2 774 760)">HALASKARGAZİ CAD</text>
          <text x="1134" y="760" fontSize="17" style={{ fill: 'var(--map-label)' }} transform="rotate(89.2 1134 760)">BÜYÜKDERE CAD</text>
        </g>
        <g fontFamily="Manrope, sans-serif" fontWeight="600" letterSpacing="0.02em">
          <text x="560" y="756" fontSize="13" style={{ fill: 'var(--map-label-minor)' }}>İstiklal Sk.</text>
          <text x="940" y="636" fontSize="13" style={{ fill: 'var(--map-label-minor)' }}>Cumhuriyet Cad.</text>
        </g>

        {/* District labels */}
        <g fontFamily="Manrope, sans-serif" fontWeight="800" letterSpacing="0.32em">
          <text x="100" y="160" fontSize="34" style={{ fill: 'var(--map-district)' }}>NİŞANTAŞI</text>
          <text x="560" y="620" fontSize="32" style={{ fill: 'var(--map-district)' }}>ŞİŞLİ</text>
          <text x="1180" y="290" fontSize="28" style={{ fill: 'var(--map-district-park)' }}>MAÇKA PARKI</text>
          <text x="1080" y="970" fontSize="26" style={{ fill: 'var(--map-district-water)' }}>BOĞAZ</text>
        </g>

        <POIs />

        {/* Route overlay */}
        {route && (
          <g>
            <path d="M 320 870 Q 380 760 460 700 T 600 580 Q 700 500 820 460 Q 980 410 1120 360 Q 1240 320 1320 220"
              style={{ stroke: 'var(--map-route-halo)' }} strokeWidth="64" fill="none"
              strokeLinecap="round" strokeLinejoin="round" opacity="0.30" filter="url(#oemRouteGlow)" />
            <path d="M 320 870 Q 380 760 460 700 T 600 580 Q 700 500 820 460 Q 980 410 1120 360 Q 1240 320 1320 220"
              style={{ stroke: 'var(--map-route-a)' }} strokeWidth="38" fill="none"
              strokeLinecap="round" strokeLinejoin="round" opacity="0.35" />
            <path d="M 320 870 Q 380 760 460 700 T 600 580 Q 700 500 820 460 Q 980 410 1120 360 Q 1240 320 1320 220"
              style={{ stroke: 'var(--map-casing)' }} strokeWidth="26" fill="none"
              strokeLinecap="round" strokeLinejoin="round" />
            <path d="M 320 870 Q 380 760 460 700 T 600 580 Q 700 500 820 460 Q 980 410 1120 360 Q 1240 320 1320 220"
              stroke="url(#oemRouteGrad)" strokeWidth="20" fill="none"
              strokeLinecap="round" strokeLinejoin="round" />
            <path d="M 320 870 Q 380 760 460 700 T 600 580 Q 700 500 820 460 Q 980 410 1120 360 Q 1240 320 1320 220"
              style={{ stroke: 'var(--map-route-flow)' }} strokeWidth="6" fill="none"
              strokeLinecap="round" strokeDasharray="3 32" className="oem-route-flow" />
            <g>
              <circle cx="600" cy="580" r="22" fill="rgba(0,0,0,0.55)" filter="url(#oemSoftGlow)" />
              <circle cx="600" cy="580" r="14" style={{ fill: 'var(--map-route-a)' }} />
              <path d="M 593 580 L 600 573 L 607 580 M 600 573 L 600 588"
                stroke="#1A140A" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
            </g>
          </g>
        )}

        {/* Atmospheric horizon haze */}
        <rect x="0" y="0" width="1600" height="200" fill="url(#oemHazeG)" pointerEvents="none" />
      </svg>

      {/* Car puck */}
      <div style={{ position: 'absolute', left: '20%', top: '87%' }}>
        <CarPuck heading={heading} />
      </div>

      {/* Destination pin */}
      {route && (
        <div style={{ position: 'absolute', left: '82%', top: '22%', transform: 'translate(-50%, -100%)' }}>
          <DestinationPin />
        </div>
      )}

      {/* Radial vignette */}
      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none',
        background: 'radial-gradient(110% 80% at 50% 45%, transparent 35%, var(--map-vignette) 100%)' }} />

      {/* Top windshield glow */}
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '20%', pointerEvents: 'none',
        background: 'linear-gradient(180deg, var(--map-spill-top), transparent)' }} />

      {/* Map grain texture */}
      <div className="oem-map-grain" style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }} />

      {children}
    </div>
  );
}
