/**
 * PremiumNavDemoScreen
 *
 * Referans görüntüyle birebir eşleşen tam ekran navigasyon simülasyonu.
 * SVG tabanlı gece şehri sahnesinin üzerine bindirilen premium araç UI overlay'leri.
 *
 * Kullanım:
 *   <PremiumNavDemoScreen speedKmh={45} speedLimitKmh={50} />
 */
import { memo, useState, useCallback } from 'react';
import {
  ArrowLeft, ArrowRight, ArrowUp, Navigation2,
  Volume2, VolumeX, AlertTriangle, MoreHorizontal,
  Music2, Phone, Grid2X2, Settings, ChevronDown,
  X, Menu as MenuIcon, RotateCcw,
} from 'lucide-react';

/* ── Perspektif yardımcıları ─────────────────────────────── */

const VP_Y    = 318;   // kaçış noktası y (%39 yukarıdan)
const BOT_Y   = 830;   // yolun alt kenarı (ekran dışı biraz)
const TOP_L   = 418;   // yol sol kenarı — ufuk seviyesinde
const TOP_R   = 782;   // yol sağ kenarı — ufuk seviyesinde
const BOT_L   = -120;  // yol sol kenarı — alt (geniş perspektif)
const BOT_R   = 1320;  // yol sağ kenarı — alt

/** Yol üzerinde herhangi bir y yüksekliğinde, frac [0..1] arasındaki x koordinatı */
function rx(frac: number, y: number): number {
  const t  = Math.max(0, (y - VP_Y) / (BOT_Y - VP_Y));
  const le = TOP_L + t * (BOT_L - TOP_L);
  const re = TOP_R + t * (BOT_R - TOP_R);
  return le + frac * (re - le);
}

/** 4 köşeli şerit poligonu için SVG points string'i */
function lanePoly(
  fracL: number, fracR: number,
  yTop: number, yBot: number,
): string {
  return [
    `${rx(fracL, yTop).toFixed(1)},${yTop}`,
    `${rx(fracR, yTop).toFixed(1)},${yTop}`,
    `${rx(fracR, yBot).toFixed(1)},${yBot}`,
    `${rx(fracL, yBot).toFixed(1)},${yBot}`,
  ].join(' ');
}

/** Kesik çizgi segmentleri (beyaz yol çizgileri) */
function DashLine({
  frac, startY, endY, step, dashLen, lw = 0.0065, opacity = 0.72, color = '#ffffff',
}: {
  frac: number; startY: number; endY: number;
  step: number; dashLen: number; lw?: number; opacity?: number; color?: string;
}) {
  const segs: React.ReactElement[] = [];
  let y = startY;
  let k = 0;
  while (y < endY) {
    const y1 = y;
    const y2 = Math.min(y + dashLen, endY);
    segs.push(
      <polygon key={k++} fill={color} fillOpacity={opacity}
        points={lanePoly(frac - lw, frac + lw, y1, y2)} />,
    );
    y += step;
  }
  return <>{segs}</>;
}

/** Yol üzerindeki perspektif navigasyon oku */
function RoadArrow({ frac, yCenter }: { frac: number; yCenter: number }) {
  const scale = Math.max(0, (yCenter - VP_Y) / (BOT_Y - VP_Y));
  const cx    = rx(frac, yCenter);
  const w     = scale * 28;
  const h     = scale * 50;
  return (
    <g opacity={0.55 * scale}>
      <polygon
        points={`${cx},${yCenter - h * 0.9} ${cx - w},${yCenter + h * 0.2} ${cx - w * 0.35},${yCenter + h * 0.2} ${cx - w * 0.35},${yCenter + h * 0.6} ${cx + w * 0.35},${yCenter + h * 0.6} ${cx + w * 0.35},${yCenter + h * 0.2} ${cx + w},${yCenter + h * 0.2}`}
        fill="rgba(100,180,255,0.85)"
      />
    </g>
  );
}

/* ══════════════════════════════════════════════════════════ */
/* ── ROAD SCENE (SVG) ────────────────────────────────────── */
/* ══════════════════════════════════════════════════════════ */

const RoadScene = memo(function RoadScene() {
  /* Bina pencereleri — sol/sağ yapılar için */
  const leftBuildings = [
    { x: -5, w: 118, baseY: 310, h: 290, windows: [[14, 50], [14, 90], [14, 130], [14, 170], [14, 210], [55, 50], [55, 90], [55, 130], [55, 170], [86, 70], [86, 110], [86, 150]] },
    { x: 125, w: 88, baseY: 310, h: 360, windows: [[15, 30], [15, 65], [15, 100], [15, 135], [15, 170], [15, 205], [50, 30], [50, 65], [50, 100], [50, 135], [50, 170], [65, 55], [65, 90]] },
    { x: 222, w: 115, baseY: 310, h: 220, windows: [[16, 60], [16, 95], [16, 130], [60, 60], [60, 95], [60, 130], [90, 75], [90, 110]] },
    { x: 348, w: 95, baseY: 310, h: 310, windows: [[14, 40], [14, 75], [14, 110], [14, 145], [14, 180], [55, 40], [55, 75], [55, 110], [55, 145], [75, 60], [75, 95]] },
  ];
  const rightBuildings = [
    { x: 1082, w: 118, baseY: 310, h: 290, windows: [[14, 50], [14, 90], [14, 130], [14, 170], [14, 210], [55, 50], [55, 90], [55, 130], [55, 170], [86, 70], [86, 110], [86, 150]] },
    { x: 988, w: 88, baseY: 310, h: 360, windows: [[15, 30], [15, 65], [15, 100], [15, 135], [15, 170], [15, 205], [50, 30], [50, 65], [50, 100], [50, 135], [50, 170]] },
    { x: 864, w: 115, baseY: 310, h: 220, windows: [[16, 60], [16, 95], [16, 130], [60, 60], [60, 95], [60, 130], [90, 75], [90, 110]] },
    { x: 758, w: 95, baseY: 310, h: 310, windows: [[14, 40], [14, 75], [14, 110], [14, 145], [55, 40], [55, 75], [55, 110], [55, 145]] },
  ];

  return (
    <svg
      viewBox="0 0 1200 800"
      preserveAspectRatio="xMidYMid slice"
      className="absolute inset-0 w-full h-full"
      aria-hidden="true"
    >
      <defs>
        {/* Filtreler */}
        <filter id="blueRouteGlow" x="-80%" y="-80%" width="260%" height="260%">
          <feGaussianBlur stdDeviation="18" result="blur1"/>
          <feGaussianBlur stdDeviation="6"  result="blur2" in="SourceGraphic"/>
          <feMerge><feMergeNode in="blur1"/><feMergeNode in="blur2"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
        <filter id="softGlow" x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="6" result="b"/>
          <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
        <filter id="lampGlow">
          <feGaussianBlur stdDeviation="5" result="b"/>
          <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
        <filter id="buildingFog">
          <feGaussianBlur stdDeviation="1.5"/>
        </filter>
        {/* Gradyanlar */}
        <linearGradient id="skyGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor="#030609"/>
          <stop offset="45%"  stopColor="#0a1222"/>
          <stop offset="100%" stopColor="#162040"/>
        </linearGradient>
        <linearGradient id="roadGrad" x1="0" x2="0" y1="318" y2="800" gradientUnits="userSpaceOnUse">
          <stop offset="0%"   stopColor="#1c2332"/>
          <stop offset="50%"  stopColor="#1e2738"/>
          <stop offset="100%" stopColor="#252e42"/>
        </linearGradient>
        <linearGradient id="reflectionGrad" x1="0" x2="0" y1="500" y2="800" gradientUnits="userSpaceOnUse">
          <stop offset="0%"   stopColor="rgba(50,80,160,0)"/>
          <stop offset="100%" stopColor="rgba(50,80,160,0.12)"/>
        </linearGradient>
        <linearGradient id="routeGrad" x1="0" x2="0" y1="318" y2="800" gradientUnits="userSpaceOnUse">
          <stop offset="0%"   stopColor="rgba(40,120,255,0.0)"/>
          <stop offset="40%"  stopColor="rgba(60,140,255,0.85)"/>
          <stop offset="100%" stopColor="rgba(80,160,255,0.95)"/>
        </linearGradient>
        <linearGradient id="routeGlowGrad" x1="0" x2="0" y1="318" y2="800" gradientUnits="userSpaceOnUse">
          <stop offset="0%"   stopColor="rgba(30,100,255,0)"/>
          <stop offset="40%"  stopColor="rgba(30,100,255,0.35)"/>
          <stop offset="100%" stopColor="rgba(60,140,255,0.45)"/>
        </linearGradient>
        <radialGradient id="horizonGlow" cx="50%" cy="50%" r="50%">
          <stop offset="0%"   stopColor="rgba(30,80,200,0.18)"/>
          <stop offset="100%" stopColor="rgba(30,80,200,0)"/>
        </radialGradient>
        <linearGradient id="carBodyGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor="#2a3040"/>
          <stop offset="60%"  stopColor="#1a1e2a"/>
          <stop offset="100%" stopColor="#0e1018"/>
        </linearGradient>
        <radialGradient id="carRoofShine" cx="50%" cy="30%" r="60%">
          <stop offset="0%"   stopColor="rgba(80,120,200,0.3)"/>
          <stop offset="100%" stopColor="rgba(80,120,200,0)"/>
        </radialGradient>
        <linearGradient id="shoulderGrad" x1="0" x2="0" y1="318" y2="800" gradientUnits="userSpaceOnUse">
          <stop offset="0%"   stopColor="#141820"/>
          <stop offset="100%" stopColor="#1a1f2c"/>
        </linearGradient>
      </defs>

      {/* ── GÖK YÜZEYİ ───────────────────────────────────────── */}
      <rect x="0" y="0" width="1200" height="800" fill="url(#skyGrad)"/>

      {/* Ufuk parlaması */}
      <ellipse cx="600" cy="318" rx="520" ry="100" fill="url(#horizonGlow)"/>

      {/* Uzak şehir ışıkları — ufuk üstü */}
      {[100,180,260,340,420,500,580,660,740,820,900,980,1060,1140].map((bx, i) => (
        <rect key={i} x={bx - 1} y={260 + (i % 3) * 15} width={2 + (i % 3)} height={50 - (i % 5) * 6}
          fill={`rgba(${180 + (i%3)*20}, ${160 + (i%5)*10}, ${100 + (i%2)*40}, ${0.25 + (i%4)*0.08})`}/>
      ))}

      {/* ── SOL BİNALAR ─────────────────────────────────────── */}
      {leftBuildings.map((b, bi) => (
        <g key={`lb${bi}`}>
          {/* Bina gövdesi */}
          <rect x={b.x} y={b.baseY - b.h} width={b.w} height={b.h}
            fill={`rgb(${18 + bi * 4}, ${22 + bi * 3}, ${32 + bi * 3})`}/>
          {/* Bina kenar gölgesi */}
          <rect x={b.x + b.w - 6} y={b.baseY - b.h} width={6} height={b.h}
            fill="rgba(0,0,0,0.3)"/>
          {/* Pencereler */}
          {b.windows.map(([wx, wy], wi) => (
            <rect key={wi} x={b.x + wx} y={b.baseY - b.h + wy} width={16} height={10}
              fill={wi % 3 === 0
                ? `rgba(255,230,160,${0.5 + (wi % 5) * 0.1})`
                : wi % 3 === 1
                  ? `rgba(180,210,255,${0.4 + (wi % 4) * 0.1})`
                  : `rgba(40,60,90,0.5)`}
              rx={1}/>
          ))}
          {/* Çatı ışığı */}
          <rect x={b.x + b.w * 0.4} y={b.baseY - b.h - 3} width={6} height={6}
            fill="rgba(255,100,80,0.7)" rx={3}/>
        </g>
      ))}

      {/* ── SAĞ BİNALAR ─────────────────────────────────────── */}
      {rightBuildings.map((b, bi) => (
        <g key={`rb${bi}`}>
          <rect x={b.x} y={b.baseY - b.h} width={b.w} height={b.h}
            fill={`rgb(${18 + bi * 4}, ${22 + bi * 3}, ${32 + bi * 3})`}/>
          <rect x={b.x} y={b.baseY - b.h} width={6} height={b.h}
            fill="rgba(0,0,0,0.3)"/>
          {b.windows.map(([wx, wy], wi) => (
            <rect key={wi} x={b.x + wx} y={b.baseY - b.h + wy} width={16} height={10}
              fill={wi % 3 === 0
                ? `rgba(255,230,160,${0.5 + (wi % 5) * 0.1})`
                : wi % 3 === 1
                  ? `rgba(180,210,255,${0.4 + (wi % 4) * 0.1})`
                  : `rgba(40,60,90,0.5)`}
              rx={1}/>
          ))}
          <rect x={b.x + b.w * 0.4} y={b.baseY - b.h - 3} width={6} height={6}
            fill="rgba(255,100,80,0.7)" rx={3}/>
        </g>
      ))}

      {/* ── YOL BANKET (kenar şeritler) ──────────────────────── */}
      {/* Sol banket */}
      <polygon points={lanePoly(0, 0.1, VP_Y, 800)} fill="url(#shoulderGrad)"/>
      {/* Sağ banket */}
      <polygon points={lanePoly(0.9, 1.0, VP_Y, 800)} fill="url(#shoulderGrad)"/>

      {/* ── YOL YÜZEYİ ───────────────────────────────────────── */}
      <polygon
        points={`${TOP_L},${VP_Y} ${TOP_R},${VP_Y} ${BOT_R},${BOT_Y} ${BOT_L},${BOT_Y}`}
        fill="url(#roadGrad)"
      />

      {/* Yol yansıması (merkez parlaklık) */}
      <polygon points={lanePoly(0.45, 0.55, VP_Y, 800)} fill="url(#reflectionGrad)"/>

      {/* ── MAVI ROTA — geniş dış hale ───────────────────────── */}
      <polygon
        filter="url(#blueRouteGlow)"
        points={lanePoly(0.38, 0.62, VP_Y + 15, 820)}
        fill="url(#routeGlowGrad)"
      />
      {/* Orta parlak rota şeridi */}
      <polygon
        points={lanePoly(0.43, 0.57, VP_Y + 20, 820)}
        fill="url(#routeGrad)"
      />
      {/* İç çekirdek çizgisi */}
      <polygon
        points={lanePoly(0.477, 0.523, VP_Y + 25, 820)}
        fill="rgba(140,200,255,0.9)"
      />

      {/* ── YOL OK İŞARETLERİ (navigasyon yönü) ─────────────── */}
      <RoadArrow frac={0.5} yCenter={560} />
      <RoadArrow frac={0.5} yCenter={460} />

      {/* ── ŞERIT ÇİZGİLERİ ─────────────────────────────────── */}
      {/* Dış beyaz kenarlıklar — sol ve sağ */}
      <DashLine frac={0.10} startY={VP_Y + 10} endY={800} step={52} dashLen={30} lw={0.012} opacity={0.9} />
      <DashLine frac={0.90} startY={VP_Y + 10} endY={800} step={52} dashLen={30} lw={0.012} opacity={0.9} />

      {/* Şerit iç kesik çizgiler */}
      <DashLine frac={0.275} startY={VP_Y + 8}  endY={780} step={46} dashLen={26} lw={0.008} opacity={0.65}/>
      <DashLine frac={0.725} startY={VP_Y + 8}  endY={780} step={46} dashLen={26} lw={0.008} opacity={0.65}/>

      {/* Merkez çift çizgi — sol */}
      <DashLine frac={0.493} startY={VP_Y + 5} endY={800} step={16} dashLen={16} lw={0.0055} opacity={0.80} color="#ffffff"/>
      {/* Merkez çift çizgi — sağ */}
      <DashLine frac={0.507} startY={VP_Y + 5} endY={800} step={16} dashLen={16} lw={0.0055} opacity={0.80} color="#ffffff"/>

      {/* ── SOKAK LAMBALARI ──────────────────────────────────── */}
      {[380, 500, 620, 720].map((y, i) => {
        const lx = rx(0.09, y) - 18;
        const rx2 = rx(0.91, y) + 18;
        const opacity = 0.65 + i * 0.08;
        const glowR = 12 + i * 3;
        return (
          <g key={`lamp${i}`}>
            {/* Sol lamba direği */}
            <line x1={lx} y1={y} x2={lx} y2={VP_Y + (y - VP_Y) * 0.1} stroke="rgba(80,90,100,0.5)" strokeWidth={2 + i * 0.5}/>
            <circle cx={lx} cy={VP_Y + (y - VP_Y) * 0.1} r={glowR} fill="rgba(255,200,80,0)" filter="url(#lampGlow)"/>
            <circle cx={lx} cy={VP_Y + (y - VP_Y) * 0.1} r={4 + i} fill={`rgba(255,200,80,${opacity})`}/>
            {/* Sağ lamba */}
            <line x1={rx2} y1={y} x2={rx2} y2={VP_Y + (y - VP_Y) * 0.1} stroke="rgba(80,90,100,0.5)" strokeWidth={2 + i * 0.5}/>
            <circle cx={rx2} cy={VP_Y + (y - VP_Y) * 0.1} r={glowR} fill="rgba(255,200,80,0)" filter="url(#lampGlow)"/>
            <circle cx={rx2} cy={VP_Y + (y - VP_Y) * 0.1} r={4 + i} fill={`rgba(255,200,80,${opacity})`}/>
          </g>
        );
      })}

      {/* ── YOL TABELASI (uzakta) ─────────────────────────────── */}
      <g transform="translate(450, 340)">
        <rect x="0" y="-3" width="300" height="36" rx="4" fill="#1a2d8a" stroke="rgba(255,255,255,0.4)" strokeWidth="2"/>
        <text x="150" y="19" textAnchor="middle" fill="white" fontFamily="system-ui,sans-serif" fontSize="14" fontWeight="700" letterSpacing="1">
          ATATÜRK CAD.
        </text>
        {/* Direk */}
        <rect x="40" y="33" width="6" height="20" fill="rgba(120,130,150,0.6)"/>
        <rect x="254" y="33" width="6" height="20" fill="rgba(120,130,150,0.6)"/>
      </g>

      {/* ── ARABA SİLHOUETTİ ─────────────────────────────────── */}
      <g transform="translate(510, 640)">
        {/* Gövde gölgesi */}
        <ellipse cx="90" cy="165" rx="85" ry="18" fill="rgba(0,0,0,0.6)"/>
        {/* Gövde alt */}
        <path d="M 5,145 Q 5,160 20,165 L 160,165 Q 175,160 175,145 L 175,110 Q 175,95 160,90 L 20,90 Q 5,95 5,110 Z"
          fill="url(#carBodyGrad)"/>
        {/* Kabinin alt kısmı */}
        <path d="M 30,90 L 45,48 Q 55,38 75,36 L 105,36 Q 125,38 135,48 L 150,90 Z"
          fill="rgb(22,26,38)"/>
        {/* Kabin üst */}
        <path d="M 45,48 Q 58,28 90,25 Q 122,28 135,48 Z"
          fill="rgb(18,22,32)"/>
        {/* Kabin parlaması */}
        <path d="M 45,48 Q 58,28 90,25 Q 122,28 135,48 Z"
          fill="url(#carRoofShine)"/>
        {/* Ön cam — soluk mavi */}
        <path d="M 50,88 L 60,50 Q 70,40 90,38 Q 110,40 120,50 L 130,88 Z"
          fill="rgba(40,70,130,0.5)" stroke="rgba(80,120,200,0.3)" strokeWidth="1"/>
        {/* Yan kapı çizgisi */}
        <line x1="20" y1="105" x2="160" y2="105" stroke="rgba(60,80,120,0.4)" strokeWidth="1.5"/>
        {/* Arka stop lambaları */}
        <rect x="8"  y="108" width="25" height="18" rx="4" fill="rgba(220,40,40,0.85)" filter="url(#softGlow)"/>
        <rect x="147" y="108" width="25" height="18" rx="4" fill="rgba(220,40,40,0.85)" filter="url(#softGlow)"/>
        {/* Tekerlek */}
        <ellipse cx="40"  cy="158" rx="26" ry="14" fill="rgb(14,16,22)" stroke="rgba(60,70,100,0.7)" strokeWidth="2"/>
        <ellipse cx="40"  cy="158" rx="16" ry="9"  fill="rgb(25,30,45)"/>
        <ellipse cx="140" cy="158" rx="26" ry="14" fill="rgb(14,16,22)" stroke="rgba(60,70,100,0.7)" strokeWidth="2"/>
        <ellipse cx="140" cy="158" rx="16" ry="9"  fill="rgb(25,30,45)"/>
        {/* Tekerlek yansıması */}
        <line x1="16" y1="155" x2="64"  y2="155" stroke="rgba(60,80,130,0.3)" strokeWidth="1"/>
        <line x1="116" y1="155" x2="164" y2="155" stroke="rgba(60,80,130,0.3)" strokeWidth="1"/>
      </g>

      {/* ── VİGNETTE (kenar karartma) ────────────────────────── */}
      <radialGradient id="vignette" cx="50%" cy="50%" r="70%">
        <stop offset="0%"   stopColor="transparent"/>
        <stop offset="100%" stopColor="rgba(0,0,0,0.55)"/>
      </radialGradient>
      <rect width="1200" height="800" fill="url(#vignette)"/>

      {/* Alt gradient geçişi (UI panelin altına kaybolur) */}
      <linearGradient id="bottomFade" x1="0" x2="0" y1="680" y2="800" gradientUnits="userSpaceOnUse">
        <stop offset="0%"   stopColor="transparent"/>
        <stop offset="100%" stopColor="rgba(8,12,22,0.9)"/>
      </linearGradient>
      <rect y="680" width="1200" height="120" fill="url(#bottomFade)"/>
    </svg>
  );
});

/* ══════════════════════════════════════════════════════════ */
/* ── TurnPanel (üst sol) ─────────────────────────────────── */
/* ══════════════════════════════════════════════════════════ */

const TurnPanel = memo(function TurnPanel({
  distance, instruction, streetName, nextInstruction, nextDistance,
  mod = 'left',
}: {
  distance: string; instruction: string; streetName: string;
  nextInstruction: string; nextDistance: string; mod?: string;
}) {
  return (
    <div className="absolute top-5 left-5 z-20 flex flex-col gap-2.5 pointer-events-auto"
      style={{ maxWidth: 370, minWidth: 320 }}>

      {/* Ana dönüş kartı */}
      <div className="flex items-stretch overflow-hidden"
        style={{
          borderRadius: 22,
          background: 'rgba(8,13,24,0.86)',
          backdropFilter: 'blur(28px) saturate(1.4)',
          boxShadow: '0 20px 60px rgba(0,0,0,0.7), 0 0 0 1px rgba(255,255,255,0.08)',
        }}
      >
        {/* Ok alanı — mavi gradient */}
        <div className="flex items-center justify-center flex-shrink-0"
          style={{
            width: 88, minHeight: 100,
            background: mod === 'left' || mod.includes('left')
              ? 'linear-gradient(155deg,#2563eb,#1d4ed8)'
              : mod === 'right' || mod.includes('right')
                ? 'linear-gradient(155deg,#2563eb,#1d4ed8)'
                : 'linear-gradient(155deg,#0f4ac0,#1e40af)',
          }}
        >
          {mod.includes('left')
            ? <ArrowLeft  className="w-14 h-14 text-white drop-shadow-[0_2px_8px_rgba(0,0,0,0.4)]"/>
            : mod.includes('right')
              ? <ArrowRight className="w-14 h-14 text-white drop-shadow-[0_2px_8px_rgba(0,0,0,0.4)]"/>
              : <ArrowUp    className="w-14 h-14 text-white drop-shadow-[0_2px_8px_rgba(0,0,0,0.4)]"/>}
        </div>

        {/* Metin alanı */}
        <div className="flex flex-col justify-center px-5 py-4 min-w-0 flex-1">
          <span className="font-black text-white leading-none mb-1 tabular-nums"
            style={{ fontSize: 38, letterSpacing: '-0.03em' }}>
            {distance}
          </span>
          <span className="font-bold text-white leading-snug mb-0.5"
            style={{ fontSize: 17, opacity: 0.92 }}>
            {instruction}
          </span>
          <span className="font-black uppercase tracking-wide truncate"
            style={{ fontSize: 13, color: '#60a5fa' }}>
            {streetName}
          </span>
        </div>
      </div>

      {/* Sonraki adım chip */}
      <div className="flex items-center gap-3 px-4 py-2.5"
        style={{
          borderRadius: 16,
          background: 'rgba(8,13,24,0.78)',
          backdropFilter: 'blur(24px)',
          boxShadow: '0 8px 24px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.07)',
        }}
      >
        <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ background: 'rgba(255,255,255,0.08)' }}>
          <RotateCcw className="w-4 h-4 text-white opacity-70"/>
        </div>
        <div className="min-w-0 flex-1">
          <span className="text-white font-bold text-sm truncate block leading-tight">
            {nextInstruction}
          </span>
          <span className="text-slate-400 font-semibold text-xs mt-0.5 block">
            {nextDistance}
          </span>
        </div>
      </div>
    </div>
  );
});

/* ══════════════════════════════════════════════════════════ */
/* ── RoadSignsPanel (üst orta) ───────────────────────────── */
/* ══════════════════════════════════════════════════════════ */

const RoadSignsPanel = memo(function RoadSignsPanel({
  signs,
}: { signs: string[] }) {
  return (
    <div className="absolute top-5 left-1/2 -translate-x-1/2 z-20 flex gap-3 pointer-events-none">
      {signs.map((sign, i) => (
        <div key={i} className="flex flex-col items-center"
          style={{
            minWidth: 140,
            background: 'linear-gradient(155deg,#1e3a8a,#1e40af)',
            borderRadius: 14,
            padding: '8px 20px 6px',
            boxShadow: '0 6px 24px rgba(0,0,0,0.55), 0 0 0 2px rgba(255,255,255,0.18), inset 0 1px 0 rgba(255,255,255,0.15)',
          }}
        >
          <span className="text-white font-black uppercase tracking-wider leading-tight text-center"
            style={{ fontSize: 13 }}>
            {sign}
          </span>
          <ChevronDown className="w-4 h-4 text-white mt-1" style={{ opacity: 0.85 }}/>
        </div>
      ))}
    </div>
  );
});

/* ══════════════════════════════════════════════════════════ */
/* ── LeftButtons ─────────────────────────────────────────── */
/* ══════════════════════════════════════════════════════════ */

const LeftButtons = memo(function LeftButtons({
  muted, onToggleMute,
}: { muted: boolean; onToggleMute: () => void }) {
  const btnStyle = {
    background: 'rgba(8,13,24,0.80)',
    backdropFilter: 'blur(20px)',
    boxShadow: '0 4px 16px rgba(0,0,0,0.45), 0 0 0 1px rgba(255,255,255,0.09)',
  };

  return (
    <div className="absolute z-20 flex flex-col gap-3"
      style={{ left: 20, top: '50%', transform: 'translateY(-50%)' }}>

      {/* Navigasyon — kırmızı aktif */}
      <button className="w-12 h-12 rounded-2xl flex items-center justify-center active:scale-90 transition-transform"
        style={{
          background: 'linear-gradient(135deg,#ef4444,#b91c1c)',
          boxShadow: '0 4px 20px rgba(239,68,68,0.55), 0 0 0 1px rgba(255,255,255,0.12)',
        }}>
        <Navigation2 className="w-5 h-5 text-white fill-white"/>
      </button>

      {/* Ses */}
      <button className="w-12 h-12 rounded-2xl flex items-center justify-center active:scale-90 transition-transform" style={btnStyle}
        onClick={onToggleMute}>
        {muted
          ? <VolumeX className="w-5 h-5 text-slate-300"/>
          : <Volume2  className="w-5 h-5 text-white"/>}
      </button>

      {/* Uyarı */}
      <button className="w-12 h-12 rounded-2xl flex items-center justify-center active:scale-90 transition-transform" style={btnStyle}>
        <AlertTriangle className="w-5 h-5 text-amber-400"/>
      </button>

      {/* Menü */}
      <button className="w-12 h-12 rounded-2xl flex items-center justify-center active:scale-90 transition-transform" style={btnStyle}>
        <MoreHorizontal className="w-5 h-5 text-white"/>
      </button>
    </div>
  );
});

/* ══════════════════════════════════════════════════════════ */
/* ── SpeedPanel (sağ) ────────────────────────────────────── */
/* ══════════════════════════════════════════════════════════ */

const SpeedPanel = memo(function SpeedPanel({
  speedKmh, limitKmh,
}: { speedKmh: number; limitKmh: number }) {
  const over = speedKmh > limitKmh + 5;
  return (
    <div className="absolute z-20 flex flex-col items-center gap-3"
      style={{ right: 20, top: '50%', transform: 'translateY(-50%)' }}>

      {/* Hız limiti tabelası — trafik işareti */}
      <div className="flex items-center justify-center"
        style={{
          width: 64, height: 64,
          borderRadius: '50%',
          background: '#ffffff',
          border: '5px solid #dc2626',
          boxShadow: '0 4px 20px rgba(0,0,0,0.55), 0 0 12px rgba(220,38,38,0.25)',
        }}>
        <span className="font-black text-black tabular-nums" style={{ fontSize: 22, letterSpacing: '-0.03em' }}>
          {limitKmh}
        </span>
      </div>

      {/* Mevcut hız kartı */}
      <div className="flex flex-col items-center px-4 py-3"
        style={{
          borderRadius: 20,
          background: 'rgba(8,13,24,0.88)',
          backdropFilter: 'blur(24px)',
          boxShadow: `0 8px 32px rgba(0,0,0,0.6), 0 0 0 1px ${over ? 'rgba(239,68,68,0.45)' : 'rgba(255,255,255,0.09)'}`,
          minWidth: 90,
        }}>
        {/* Küçük limit rozeti */}
        <div className="flex items-center justify-center mb-1"
          style={{
            width: 30, height: 30, borderRadius: '50%',
            background: '#ffffff', border: '3px solid #dc2626',
          }}>
          <span className="font-black text-black" style={{ fontSize: 11 }}>{limitKmh}</span>
        </div>

        {/* Büyük hız */}
        <span className="font-black tabular-nums leading-none"
          style={{
            fontSize: 46,
            color: over ? '#f87171' : '#ffffff',
            letterSpacing: '-0.04em',
          }}>
          {Math.round(speedKmh)}
        </span>
        <span className="font-bold uppercase tracking-widest mt-0.5"
          style={{ fontSize: 10, color: '#94a3b8' }}>
          km/h
        </span>
      </div>
    </div>
  );
});

/* ══════════════════════════════════════════════════════════ */
/* ── LaneGuidance (alt orta) ─────────────────────────────── */
/* ══════════════════════════════════════════════════════════ */

const LaneGuidance = memo(function LaneGuidance({
  lanes,
}: { lanes: Array<{ dir: 'left' | 'straight' | 'right'; active: boolean }> }) {
  return (
    <div className="absolute z-20 left-1/2 -translate-x-1/2"
      style={{ bottom: 158 }}>
      <div className="flex items-center gap-2 px-3 py-2.5"
        style={{
          borderRadius: 18,
          background: 'rgba(8,13,24,0.88)',
          backdropFilter: 'blur(24px)',
          boxShadow: '0 8px 32px rgba(0,0,0,0.7), 0 0 0 1px rgba(255,255,255,0.09)',
        }}>
        {lanes.map((lane, i) => (
          <div key={i} className="flex items-center justify-center transition-all"
            style={{
              width: 56, height: 50,
              borderRadius: 12,
              background: lane.active
                ? 'linear-gradient(155deg,#2563eb,#1d4ed8)'
                : 'rgba(255,255,255,0.06)',
              border: lane.active
                ? '1px solid rgba(96,165,250,0.5)'
                : '1px solid rgba(255,255,255,0.07)',
              boxShadow: lane.active ? '0 4px 16px rgba(37,99,235,0.5)' : 'none',
              color: lane.active ? '#ffffff' : 'rgba(255,255,255,0.28)',
            }}>
            {lane.dir === 'left'
              ? <ArrowLeft  className="w-6 h-6"/>
              : lane.dir === 'right'
                ? <ArrowRight className="w-6 h-6"/>
                : <ArrowUp    className="w-6 h-6"/>}
          </div>
        ))}
      </div>
    </div>
  );
});

/* ══════════════════════════════════════════════════════════ */
/* ── NavInfoBar (alt çubuk) ──────────────────────────────── */
/* ══════════════════════════════════════════════════════════ */

const NavInfoBar = memo(function NavInfoBar({
  duration, distance, arrivalTime, progress, onStop,
}: {
  duration: string; distance: string; arrivalTime: string;
  progress: number; onStop: () => void;
}) {
  return (
    <div className="absolute inset-x-0 z-20"
      style={{
        bottom: 60,
        background: 'rgba(6,9,18,0.95)',
        backdropFilter: 'blur(24px)',
        borderTop: '1px solid rgba(255,255,255,0.08)',
        boxShadow: '0 -20px 60px rgba(0,0,0,0.6)',
      }}>

      {/* Metrik satırı */}
      <div className="flex items-stretch px-3">
        {/* X butonu */}
        <button onClick={onStop}
          className="flex items-center justify-center my-2 rounded-2xl active:scale-90 transition-transform flex-shrink-0"
          style={{
            width: 56, height: 56,
            background: 'rgba(239,68,68,0.14)',
            border: '1px solid rgba(239,68,68,0.28)',
          }}>
          <X className="w-6 h-6 text-red-400"/>
        </button>

        {/* Süre */}
        <InfoCell value={duration} label="Süre"/>
        <InfoDiv/>
        {/* Mesafe */}
        <InfoCell value={distance} label="Mesafe"/>
        <InfoDiv/>
        {/* Varış */}
        <InfoCell value={arrivalTime} label="Varış zamanı"/>

        {/* Menü */}
        <button
          className="flex items-center justify-center my-2 ml-1 rounded-2xl active:scale-90 transition-transform flex-shrink-0"
          style={{
            width: 56, height: 56,
            background: 'rgba(255,255,255,0.06)',
            border: '1px solid rgba(255,255,255,0.10)',
          }}>
          <MenuIcon className="w-6 h-6 text-white"/>
        </button>
      </div>

      {/* İlerleme çubuğu */}
      <div className="relative mx-5 mb-2" style={{ height: 6, borderRadius: 3, background: 'rgba(255,255,255,0.10)' }}>
        <div className="h-full transition-all duration-500"
          style={{
            width: `${Math.max(2, Math.min(98, progress * 100))}%`,
            borderRadius: 3,
            background: 'linear-gradient(90deg,#2563eb,#60a5fa)',
            boxShadow: '0 0 10px rgba(96,165,250,0.7)',
          }}/>
        {/* Araç işaretçisi */}
        <div className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 flex items-center justify-center"
          style={{
            left: `${Math.max(2, Math.min(98, progress * 100))}%`,
            width: 18, height: 18, borderRadius: '50%',
            background: '#2563eb',
            border: '2px solid #ffffff',
            boxShadow: '0 0 10px rgba(37,99,235,0.9)',
          }}>
          <Navigation2 className="w-2.5 h-2.5 text-white fill-white"/>
        </div>
      </div>
    </div>
  );
});

function InfoCell({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center py-3">
      <span className="text-white font-black tabular-nums leading-none"
        style={{ fontSize: 26, letterSpacing: '-0.03em' }}>
        {value}
      </span>
      <span className="font-bold uppercase tracking-wider mt-1.5"
        style={{ fontSize: 10, color: '#64748b' }}>
        {label}
      </span>
    </div>
  );
}

function InfoDiv() {
  return <div className="my-4 flex-shrink-0" style={{ width: 1, background: 'rgba(255,255,255,0.10)' }}/>;
}

/* ══════════════════════════════════════════════════════════ */
/* ── BottomNavBar ────────────────────────────────────────── */
/* ══════════════════════════════════════════════════════════ */

const BottomNavBar = memo(function BottomNavBar({
  activeTab = 'nav', onTab,
}: { activeTab?: string; onTab?: (id: string) => void }) {
  const tabs = [
    { id: 'nav',      label: 'Navigasyon',  icon: <Navigation2 className="w-5 h-5"/> },
    { id: 'media',    label: 'Medya',       icon: <Music2      className="w-5 h-5"/> },
    { id: 'phone',    label: 'Telefon',     icon: <Phone       className="w-5 h-5"/> },
    { id: 'apps',     label: 'Uygulamalar', icon: <Grid2X2     className="w-5 h-5"/> },
    { id: 'settings', label: 'Ayarlar',     icon: <Settings    className="w-5 h-5"/> },
  ];

  return (
    <div className="absolute inset-x-0 bottom-0 z-20 flex"
      style={{
        height: 60,
        background: 'rgba(6,9,18,0.97)',
        backdropFilter: 'blur(24px)',
        borderTop: '1px solid rgba(255,255,255,0.07)',
      }}>
      {tabs.map((tab) => {
        const active = tab.id === activeTab;
        return (
          <button key={tab.id} onClick={() => onTab?.(tab.id)}
            className="flex-1 flex flex-col items-center justify-center gap-0.5 relative active:opacity-60 transition-opacity">
            {/* Aktif üst çizgi */}
            {active && (
              <div className="absolute top-0 left-1/2 -translate-x-1/2 rounded-b"
                style={{ width: 28, height: 2.5, background: '#3b82f6' }}/>
            )}
            <span style={{ color: active ? '#3b82f6' : 'rgba(255,255,255,0.38)' }}>
              {tab.icon}
            </span>
            <span className="font-semibold leading-none"
              style={{
                fontSize: 9.5,
                color: active ? '#3b82f6' : 'rgba(255,255,255,0.35)',
                letterSpacing: '0.03em',
              }}>
              {tab.label}
            </span>
          </button>
        );
      })}
    </div>
  );
});

/* ══════════════════════════════════════════════════════════ */
/* ── Üst sağ: Saat + Ses ikonu ───────────────────────────── */
/* ══════════════════════════════════════════════════════════ */

function TopRightBar({ time, muted }: { time: string; muted: boolean }) {
  return (
    <div className="absolute top-5 right-5 z-20 flex items-center gap-3 pointer-events-none">
      <span className="text-white font-black tabular-nums"
        style={{ fontSize: 20, letterSpacing: '-0.02em', textShadow: '0 2px 8px rgba(0,0,0,0.7)' }}>
        {time}
      </span>
      <div className="w-9 h-9 rounded-xl flex items-center justify-center"
        style={{
          background: 'rgba(8,13,24,0.70)',
          backdropFilter: 'blur(16px)',
          border: '1px solid rgba(255,255,255,0.09)',
        }}>
        {muted
          ? <VolumeX className="w-4 h-4 text-white opacity-60"/>
          : <Volume2  className="w-4 h-4 text-white opacity-70"/>}
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════ */
/* ── ANA EXPORT ──────────────────────────────────────────── */
/* ══════════════════════════════════════════════════════════ */

export interface PremiumNavDemoScreenProps {
  speedKmh?:     number;
  speedLimitKmh?: number;
  /** Harici navigasyon verisi — opsiyonel, yoksa demo verisi kullanılır */
  distance?:     string;
  instruction?:  string;
  streetName?:   string;
  nextInstruction?: string;
  nextDistance?:   string;
  signs?:        string[];
  duration?:     string;
  distanceInfo?: string;
  arrivalTime?:  string;
  progress?:     number;
  onStop?:       () => void;
  onNavTab?:     (id: string) => void;
  activeTab?:    string;
}

export const PremiumNavDemoScreen = memo(function PremiumNavDemoScreen({
  speedKmh      = 45,
  speedLimitKmh = 50,
  distance      = '350 m',
  instruction   = 'Sola dönün',
  streetName    = 'Atatürk Caddesi',
  nextInstruction = 'Cumhuriyet Meydanı',
  nextDistance    = '1.2 km',
  signs         = ['Atatürk Cad.', 'Şehir Merkezi Terminal'],
  duration      = '2 sa 15 dk',
  distanceInfo  = '189 km',
  arrivalTime   = '00:57',
  progress      = 0.28,
  onStop,
  onNavTab,
  activeTab     = 'nav',
}: PremiumNavDemoScreenProps) {
  const [muted, setMuted] = useState(false);
  const toggleMute = useCallback(() => setMuted(m => !m), []);

  const now   = new Date();
  const timeStr = `${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}`;

  const lanes: Array<{ dir: 'left' | 'straight' | 'right'; active: boolean }> = [
    { dir: 'left',     active: true  },
    { dir: 'straight', active: false },
    { dir: 'straight', active: false },
    { dir: 'right',    active: false },
  ];

  return (
    <div className="relative w-full h-full overflow-hidden select-none"
      style={{ background: '#060912', fontFamily: "'Inter', system-ui, -apple-system, sans-serif" }}>

      {/* ═══ SAHNE ARKAPLAN ═══ */}
      <RoadScene/>

      {/* ═══ UI OVERLAY'LERİ ═══ */}

      {/* Üst sol: dönüş talimatı */}
      <TurnPanel
        distance={distance}
        instruction={instruction}
        streetName={streetName}
        nextInstruction={nextInstruction}
        nextDistance={nextDistance}
        mod="left"
      />

      {/* Üst orta: yol tabelaları */}
      <RoadSignsPanel signs={signs}/>

      {/* Üst sağ: saat + ses */}
      <TopRightBar time={timeStr} muted={muted}/>

      {/* Sol dikey butonlar */}
      <LeftButtons muted={muted} onToggleMute={toggleMute}/>

      {/* Sağ: hız paneli */}
      <SpeedPanel speedKmh={speedKmh} limitKmh={speedLimitKmh}/>

      {/* Alt orta: şerit rehberi */}
      <LaneGuidance lanes={lanes}/>

      {/* Alt bilgi çubuğu */}
      <NavInfoBar
        duration={duration}
        distance={distanceInfo}
        arrivalTime={arrivalTime}
        progress={progress}
        onStop={onStop ?? (() => {})}
      />

      {/* En alt nav çubuğu */}
      <BottomNavBar activeTab={activeTab} onTab={onNavTab}/>
    </div>
  );
});
