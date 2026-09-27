/**
 * cockpitShowcase — Sürücü ekranının İMZA görünümleri (kullanıcı isteği
 * 2026-09-27: "sürüş ekranlarını çoğaltalım, kullanıcıyı cezbeden"):
 *
 *   neon   — CarOS imzası: mavi→mor→turuncu ışıklı halkalar, neon yol
 *   sport  — ortada parçalı devir kadranı, vites ışık çubuğu, karbon doku
 *   luxury — krom çerçeveli kronograf kadranlar, altın ibreler
 *   aurora — dev hız rakamı, cam kartlar, yumuşak renk dalgaları
 *
 * Yalnız sunum; veri `CockpitState`ten gelir. Diğer görünümlerle AYNI dürüstlük:
 * bilinmeyen değer "—", ibre/dolgu ÇİZİLMEZ, "0" yazılmaz; kırmızı bölge yalnız
 * araçtan gelen devir sınırıyla; motor sıcaklığı yalnız LIVE ise.
 *
 * PERFORMANS (kullanıcı sorusu "uygulamaya yük oluyor mu"): SVG filtresi/blur
 * YOK — ışıma katmanlı yarı saydam çizgi, aurora dalgaları sabit radyal gradyan.
 * Timer/animasyon döngüsü yok; yalnız seçili görünüm çizilir.
 * Bu görünümlerin kendi imza renkleri vardır; gündüz de koyu çizilir (OEM kümeleri gibi).
 * Koordinatlar 1280×720 tasarım birimidir (ekran `scale(0.8)` uygular).
 */
import { memo } from 'react';
import type { CockpitTokens } from './cockpitLayout';
import {
  EM_DASH, fmtSpeed, fmtCoolant, fmtRange, coolantFill, fuelFill, rpmFill, bandOrNull, COCKPIT_BANDS,
  type CockpitState,
} from './cockpitDataModel';
import { LimitSign } from './cockpitClusters';

export type ShowcaseStyle = 'neon' | 'sport' | 'luxury' | 'aurora';

const rad = (deg: number) => (deg * Math.PI) / 180;
const polar = (cx: number, cy: number, r: number, deg: number) =>
  ({ x: +(cx + Math.cos(rad(deg)) * r).toFixed(2), y: +(cy + Math.sin(rad(deg)) * r).toFixed(2) });
function arcPath(cx: number, cy: number, r: number, from: number, sweep: number): string {
  const a = polar(cx, cy, r, from);
  const b = polar(cx, cy, r, from + sweep);
  return `M${a.x} ${a.y} A${r} ${r} 0 ${sweep > 180 ? 1 : 0} 1 ${b.x} ${b.y}`;
}

/** Tasarım alanının tamamı (ekran üstündeki 12 px kaydırma dahil). */
const BG = { x: 0, y: -16, w: 1280, h: 752 } as const;

interface Derived {
  speedText: string;
  speedFrac: number | null;
  rpm: number | null;
  rpmMax: number;
  rpmFrac: number | null;
  redFrom: number | null;
  fuel: number | null;
  coolant: number | null;
  coolantText: string;
  rangeText: string;
}

function derive(state: CockpitState): Derived {
  const speed = bandOrNull(state.speedKmh, COCKPIT_BANDS.speed);
  const knownRedline = bandOrNull(state.rpmRedline, COCKPIT_BANDS.rpm);
  const rpmMax = Math.max(8000, knownRedline ?? 8000);
  const liveCoolant = state.coolantFreshness === 'LIVE' ? state.coolantTempC : null;
  return {
    speedText: fmtSpeed(state.speedKmh),
    speedFrac: speed === null ? null : Math.min(1, Math.max(0, speed / 240)),
    rpm: bandOrNull(state.rpm, COCKPIT_BANDS.rpm),
    rpmMax,
    rpmFrac: rpmFill(state.rpm, rpmMax),
    redFrom: knownRedline !== null && knownRedline < rpmMax ? knownRedline / rpmMax : null,
    fuel: fuelFill(state.fuelLevelPct),
    coolant: coolantFill(liveCoolant),
    coolantText: fmtCoolant(liveCoolant),
    rangeText: fmtRange(state.rangeKm),
  };
}

const rpmK = (rpm: number | null) => (rpm === null ? EM_DASH : (rpm / 1000).toLocaleString('tr-TR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }));
const rpmFull = (rpm: number | null) => (rpm === null ? `${EM_DASH} rpm` : `${Math.round(rpm).toLocaleString('tr-TR')} rpm`);

/** Ölçek etiketleri (ölçüm DEĞİL — `data-cockpit-scale`). */
function ScaleLabels({ cx, cy, r, from, sweep, values, size, fill, font }: {
  cx: number; cy: number; r: number; from: number; sweep: number; values: readonly number[]; size: number; fill: string; font?: string;
}) {
  return (
    <>
      {values.map((v, i) => {
        const p = polar(cx, cy, r, from + (sweep * i) / (values.length - 1));
        return <text key={i} data-cockpit-scale="dial" x={p.x} y={p.y + size * 0.36} textAnchor="middle" fontSize={size}
          fontFamily={font} fill={fill}>{v}</text>;
      })}
    </>
  );
}

function Ticks({ cx, cy, r1, r2, from, sweep, n, stroke, width }: {
  cx: number; cy: number; r1: number; r2: number; from: number; sweep: number; n: number; stroke: string; width: number;
}) {
  return (
    <g stroke={stroke} strokeWidth={width} strokeLinecap="round">
      {Array.from({ length: n + 1 }, (_, i) => {
        const deg = from + (sweep * i) / n;
        const a = polar(cx, cy, r1, deg), b = polar(cx, cy, r2, deg);
        return <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} />;
      })}
    </g>
  );
}

/* ── A · NEON ─────────────────────────────────────────────────────────────── */

const N_FROM = 140, N_SWEEP = 260, N_R = 190;
const NEON = { blue: '#2f7bff', violet: '#b58cff', orange: '#ff7a1a', ink: '#f2f6ff', dim: '#8a97b4', track: '#141a2a' };

function NeonGauge({ id, cx, cy, frac, redFrom, region, children }: {
  id: string; cx: number; cy: number; frac: number | null; redFrom: number | null; region: string; children: React.ReactNode;
}) {
  const arc = arcPath(cx, cy, N_R, N_FROM, N_SWEEP);
  const dash = frac === null ? null : `${frac * 100} 100`;
  return (
    <g data-cockpit-region={region}>
      <circle cx={cx} cy={cy} r={N_R + 26} fill={`url(#${id}-inner)`} />
      <path d={arc} fill="none" stroke={NEON.track} strokeWidth={16} strokeLinecap="round" />
      {redFrom !== null && (
        <path d={arcPath(cx, cy, N_R, N_FROM + N_SWEEP * redFrom, N_SWEEP * (1 - redFrom))} fill="none"
          stroke="#ff3b3b" strokeOpacity={0.45} strokeWidth={16} />
      )}
      {dash !== null && frac !== null && frac > 0 && (
        <g data-cockpit-speed-fill={region === 'speedCluster' ? '' : undefined} data-cockpit-rpm-marker={region === 'rightCluster' ? '' : undefined}>
          <path d={arc} pathLength={100} fill="none" stroke={`url(#${id}-arc)`} strokeWidth={34} strokeOpacity={0.22}
            strokeLinecap="round" strokeDasharray={dash} />
          <path d={arc} pathLength={100} fill="none" stroke={`url(#${id}-arc)`} strokeWidth={14}
            strokeLinecap="round" strokeDasharray={dash} />
        </g>
      )}
      <Ticks cx={cx} cy={cy} r1={N_R - 30} r2={N_R - 20} from={N_FROM} sweep={N_SWEEP} n={48} stroke="#3b4a6b" width={2} />
      <Ticks cx={cx} cy={cy} r1={N_R - 34} r2={N_R - 20} from={N_FROM} sweep={N_SWEEP} n={12} stroke="#8aa4d6" width={3} />
      {children}
    </g>
  );
}

const NeonCluster = memo(function NeonCluster({ state, t, idBase }: { state: CockpitState; t: CockpitTokens; idBase: string }) {
  const d = derive(state);
  return (
    <g data-cockpit-style="neon">
      <defs>
        <radialGradient id={`${idBase}-nbg`} cx="0.5" cy="0.55" r="0.75">
          <stop offset="0" stopColor="#0b1020" /><stop offset="1" stopColor="#000" />
        </radialGradient>
        <radialGradient id={`${idBase}-n-inner`} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#0d1426" /><stop offset="0.85" stopColor="#070a14" /><stop offset="1" stopColor="#000" stopOpacity={0} />
        </radialGradient>
        <linearGradient id={`${idBase}-n-arc`} x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor={NEON.blue} /><stop offset="0.55" stopColor={NEON.violet} /><stop offset="1" stopColor={NEON.orange} />
        </linearGradient>
        <linearGradient id={`${idBase}-n-road-b`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={NEON.blue} stopOpacity={0} /><stop offset="1" stopColor={NEON.blue} stopOpacity={0.9} />
        </linearGradient>
        <linearGradient id={`${idBase}-n-road-o`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={NEON.orange} stopOpacity={0} /><stop offset="1" stopColor={NEON.orange} stopOpacity={0.9} />
        </linearGradient>
      </defs>
      <rect {...{ x: BG.x, y: BG.y, width: BG.w, height: BG.h }} fill={`url(#${idBase}-nbg)`} />
      <g aria-hidden="true" data-cockpit-decoration="neon-road">
        <line x1={600} y1={250} x2={420} y2={736} stroke={`url(#${idBase}-n-road-b)`} strokeWidth={10} strokeOpacity={0.25} />
        <line x1={600} y1={250} x2={420} y2={736} stroke={`url(#${idBase}-n-road-b)`} strokeWidth={3} />
        <line x1={680} y1={250} x2={860} y2={736} stroke={`url(#${idBase}-n-road-o)`} strokeWidth={10} strokeOpacity={0.25} />
        <line x1={680} y1={250} x2={860} y2={736} stroke={`url(#${idBase}-n-road-o)`} strokeWidth={3} />
        {[0, 1, 2, 3, 4, 5].map((i) => {
          const f = i / 6, y = 300 + f * f * 360;
          return <rect key={i} x={638 - f} y={y} width={4 + f * 3} height={10 + f * 36} fill="#7fa6ff" fillOpacity={0.2 + f * 0.5} />;
        })}
      </g>
      <NeonGauge id={`${idBase}-n`} cx={330} cy={370} frac={d.speedFrac} redFrom={null} region="speedCluster">
        <ScaleLabels cx={330} cy={370} r={N_R - 58} from={N_FROM} sweep={N_SWEEP} values={[0, 40, 80, 120, 160, 200, 240]} size={17} fill={NEON.dim} />
        <text data-cockpit-value="speed" x={330} y={388} textAnchor="middle" fontSize={96} fontWeight={300}
          className="caros-cockpit-numeral" fill={state.speedOverLimit ? t.warningRed : d.speedText === EM_DASH ? t.muted : NEON.ink}>{d.speedText}</text>
        <text x={330} y={428} textAnchor="middle" fontSize={18} letterSpacing={4} fill="#7fa6ff">KM/H</text>
      </NeonGauge>
      <NeonGauge id={`${idBase}-n`} cx={950} cy={370} frac={d.rpmFrac} redFrom={d.redFrom} region="rightCluster">
        <ScaleLabels cx={950} cy={370} r={N_R - 58} from={N_FROM} sweep={N_SWEEP}
          values={Array.from({ length: d.rpmMax / 1000 + 1 }, (_, i) => i)} size={17} fill={NEON.dim} />
        <text data-cockpit-value="gear" x={950} y={388} textAnchor="middle" fontSize={96} fontWeight={300}
          className="caros-cockpit-numeral" fill={state.gear ? NEON.ink : t.muted}>{state.gear ?? EM_DASH}</text>
        <text x={950} y={428} textAnchor="middle" fontSize={18} letterSpacing={4} fill="#7fa6ff">VİTES</text>
        <text data-cockpit-value="rpm" x={950} y={462} textAnchor="middle" fontSize={17}
          className="caros-cockpit-numeral" fill={d.rpm === null ? t.muted : NEON.dim}>{rpmFull(d.rpm)}</text>
      </NeonGauge>
      <LimitSign limit={state.speedLimitKmh} definitive={state.speedLimitDefinitive} over={state.speedOverLimit === true}
        cx={640} cy={180} r={34} t={t} />
      <g data-cockpit-region="leftCluster">
        <text x={130} y={626} fontSize={16} fill={NEON.dim}>Menzil</text>
        <text x={130} y={658} fontSize={26} className="caros-cockpit-numeral" fill={d.rangeText === EM_DASH ? t.muted : NEON.ink}>
          {d.rangeText}<tspan fontSize={15} fill={NEON.dim}> km</tspan></text>
        <rect x={250} y={642} width={150} height={8} rx={4} fill={NEON.track} />
        {d.fuel !== null && <rect data-cockpit-bar="fuel" x={250} y={642} width={150 * d.fuel} height={8} rx={4} fill={`url(#${idBase}-n-arc)`} />}
      </g>
      <g data-cockpit-region="assistCard">
        <text x={1150} y={626} textAnchor="end" fontSize={16} fill={NEON.dim}>Motor</text>
        <text x={1150} y={658} textAnchor="end" fontSize={26} className="caros-cockpit-numeral"
          fill={d.coolantText === EM_DASH ? t.muted : NEON.ink}>{d.coolantText}</text>
      </g>
    </g>
  );
});

/* ── B · SPOR ─────────────────────────────────────────────────────────────── */

const S_FROM = 135, S_SWEEP = 270, S_SEG = 56, S_C = { x: 640, y: 420 }, S_R = 232;
const SPORT = { yellow: '#ffd11a', red: '#ff2a2a', off: '#232323', ink: '#ffffff', dim: '#9a9a9a' };

const SportCluster = memo(function SportCluster({ state, t, idBase }: { state: CockpitState; t: CockpitTokens; idBase: string }) {
  const d = derive(state);
  const lit = d.rpmFrac === null ? 0 : Math.round(d.rpmFrac * S_SEG);
  const redSeg = d.redFrom === null ? null : Math.round(d.redFrom * S_SEG);
  const leds = 15;
  const ledLit = d.rpmFrac === null ? 0 : Math.round(d.rpmFrac * leds);
  const bar = (x: number, frac: number | null, color: string, title: string, value: string, sub: string, attr: string) => (
    <g data-cockpit-bar={attr}>
      <text x={x} y={206} textAnchor="middle" fontSize={14} letterSpacing={2} fill={SPORT.dim}>{title}</text>
      <rect x={x - 9} y={220} width={18} height={290} rx={4} fill="#1d1d1d" />
      {frac !== null && <rect x={x - 9} y={220 + 290 * (1 - frac)} width={18} height={290 * frac} rx={4} fill={color} />}
      <text x={x} y={548} textAnchor="middle" fontSize={24} fontWeight={700} className="caros-cockpit-numeral"
        fill={value.startsWith(EM_DASH) ? t.muted : SPORT.ink}>{value}</text>
      <text x={x} y={574} textAnchor="middle" fontSize={13} fill={SPORT.dim}>{sub}</text>
    </g>
  );
  return (
    <g data-cockpit-style="sport">
      <defs>
        <pattern id={`${idBase}-carbon`} width={8} height={8} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width={8} height={8} fill="#0b0b0b" /><rect width={4} height={8} fill="#121212" />
        </pattern>
        <radialGradient id={`${idBase}-svig`} cx="0.5" cy="0.5" r="0.7">
          <stop offset="0.5" stopColor="#000" stopOpacity={0} /><stop offset="1" stopColor="#000" />
        </radialGradient>
      </defs>
      <rect {...{ x: BG.x, y: BG.y, width: BG.w, height: BG.h }} fill={`url(#${idBase}-carbon)`} />
      <rect {...{ x: BG.x, y: BG.y, width: BG.w, height: BG.h }} fill={`url(#${idBase}-svig)`} />
      <g data-cockpit-decoration="shift-lights" aria-hidden="true">
        {Array.from({ length: leds }, (_, i) => {
          const c = i < 7 ? '#22c55e' : i < 12 ? SPORT.yellow : SPORT.red;
          return <rect key={i} x={425 + i * 29} y={146} width={22} height={11} rx={3} fill={c} fillOpacity={i < ledLit ? 1 : 0.14} />;
        })}
      </g>
      <g data-cockpit-region="rightCluster">
        <circle cx={S_C.x} cy={S_C.y} r={S_R + 30} fill="#070707" stroke="#262626" strokeWidth={2} />
        {Array.from({ length: S_SEG }, (_, i) => {
          const a = S_FROM + (S_SWEEP * i) / S_SEG, b = S_FROM + (S_SWEEP * (i + 0.72)) / S_SEG;
          const red = redSeg !== null && i >= redSeg;
          const on = i < lit;
          const color = red ? (on ? SPORT.red : '#4a1212') : on ? SPORT.yellow : SPORT.off;
          return <path key={i} data-cockpit-rpm-marker={on && i === lit - 1 ? '' : undefined}
            d={arcPath(S_C.x, S_C.y, S_R, a, b - a)} fill="none" stroke={color} strokeWidth={30} />;
        })}
        <ScaleLabels cx={S_C.x} cy={S_C.y} r={S_R - 48} from={S_FROM} sweep={S_SWEEP}
          values={Array.from({ length: d.rpmMax / 1000 + 1 }, (_, i) => i)} size={22} fill="#bdbdbd" />
        <text data-cockpit-value="rpm" x={S_C.x} y={S_C.y - 112} textAnchor="middle" fontSize={16}
          className="caros-cockpit-numeral" fill={d.rpm === null ? t.muted : SPORT.dim}>{rpmFull(d.rpm)}</text>
      </g>
      <g data-cockpit-region="speedCluster">
        <text data-cockpit-value="speed" x={S_C.x} y={S_C.y + 22} textAnchor="middle" fontSize={148} fontWeight={800}
          fontStyle="italic" className="caros-cockpit-numeral"
          fill={state.speedOverLimit ? t.warningRed : d.speedText === EM_DASH ? t.muted : SPORT.ink}>{d.speedText}</text>
        <text x={S_C.x} y={S_C.y + 62} textAnchor="middle" fontSize={18} letterSpacing={6} fill={SPORT.yellow}>KM/H</text>
        {state.gear && (
          <g data-cockpit-value="gear">
            <rect x={S_C.x - 36} y={S_C.y + 88} width={72} height={72} rx={10} fill={SPORT.yellow} />
            <text x={S_C.x} y={S_C.y + 142} textAnchor="middle" fontSize={54} fontWeight={900} fill="#000">{state.gear}</text>
          </g>
        )}
        <LimitSign limit={state.speedLimitKmh} definitive={state.speedLimitDefinitive} over={state.speedOverLimit === true}
          cx={920} cy={220} r={34} t={t} />
      </g>
      {bar(150, d.coolant, d.coolant !== null && d.coolant > 0.85 ? t.warningRed : '#38bdf8', 'MOTOR', d.coolantText, 'C · H', 'coolant')}
      {bar(1130, d.fuel, d.fuel !== null && d.fuel < 0.15 ? t.warningRed : SPORT.yellow, 'YAKIT', `${d.rangeText} km`, 'menzil', 'fuel')}
    </g>
  );
});

/* ── C · LÜKS (krom kronograf) ───────────────────────────────────────────── */

const L_FROM = 135, L_SWEEP = 270, L_R = 205;
const LUX = { ink: '#f5efe2', cream: '#e9dcc0', dim: '#9aa4b8', gold: '#c9a96a' };

function LuxDial({ idBase, cx, cy, frac, redFrom, labels, windowText, unit, region, valueAttr, t }: {
  idBase: string; cx: number; cy: number; frac: number | null; redFrom: number | null; labels: readonly number[];
  windowText: string; unit: string; region: string; valueAttr: string; t: CockpitTokens;
}) {
  const deg = frac === null ? null : L_FROM + L_SWEEP * frac;
  const tip = deg === null ? null : polar(cx, cy, L_R - 26, deg);
  const tail = deg === null ? null : polar(cx, cy, 22, deg + 180);
  return (
    <g data-cockpit-region={region}>
      <circle cx={cx} cy={cy} r={L_R + 16} fill={`url(#${idBase}-lchrome)`} />
      <circle cx={cx} cy={cy} r={L_R + 6} fill={`url(#${idBase}-lface)`} />
      {redFrom !== null && (
        <path d={arcPath(cx, cy, L_R - 6, L_FROM + L_SWEEP * redFrom, L_SWEEP * (1 - redFrom))} fill="none"
          stroke="#c0392b" strokeWidth={8} opacity={0.9} />
      )}
      <Ticks cx={cx} cy={cy} r1={L_R - 10} r2={L_R} from={L_FROM} sweep={L_SWEEP} n={60} stroke="#8d98ad" width={1.2} />
      <Ticks cx={cx} cy={cy} r1={L_R - 22} r2={L_R} from={L_FROM} sweep={L_SWEEP} n={labels.length - 1} stroke={LUX.cream} width={3} />
      <ScaleLabels cx={cx} cy={cy} r={L_R - 44} from={L_FROM} sweep={L_SWEEP} values={labels} size={20}
        fill={LUX.cream} font='Georgia, "Times New Roman", serif' />
      <text data-cockpit-value={valueAttr} x={cx} y={cy + L_R * 0.46} textAnchor="middle" fontSize={40}
        fontFamily='Georgia, "Times New Roman", serif' className="caros-cockpit-numeral"
        fill={windowText === EM_DASH ? t.muted : LUX.ink}>{windowText}</text>
      <text x={cx} y={cy + L_R * 0.46 + 26} textAnchor="middle" fontSize={13} letterSpacing={4} fill={LUX.dim}>{unit}</text>
      {tip && tail && (
        <line data-cockpit-needle="" x1={tail.x} y1={tail.y} x2={tip.x} y2={tip.y} stroke={`url(#${idBase}-lgold)`}
          strokeWidth={5} strokeLinecap="round" />
      )}
      <circle cx={cx} cy={cy} r={12} fill={`url(#${idBase}-lchrome)`} />
      <circle cx={cx} cy={cy} r={5} fill={LUX.gold} />
    </g>
  );
}

const LuxuryCluster = memo(function LuxuryCluster({ state, t, idBase, date }: { state: CockpitState; t: CockpitTokens; idBase: string; date: string }) {
  const d = derive(state);
  return (
    <g data-cockpit-style="luxury">
      <defs>
        <radialGradient id={`${idBase}-lbg`} cx="0.5" cy="0.45" r="0.8">
          <stop offset="0" stopColor="#16213a" /><stop offset="1" stopColor="#05080f" />
        </radialGradient>
        <linearGradient id={`${idBase}-lchrome`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f4f6fa" /><stop offset="0.45" stopColor="#6b7486" />
          <stop offset="0.5" stopColor="#dfe4ec" /><stop offset="1" stopColor="#3a4150" />
        </linearGradient>
        <radialGradient id={`${idBase}-lface`} cx="0.5" cy="0.4" r="0.7">
          <stop offset="0" stopColor="#1c2944" /><stop offset="1" stopColor="#080d18" />
        </radialGradient>
        <linearGradient id={`${idBase}-lgold`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#f7e2ae" /><stop offset="1" stopColor="#b98a3e" />
        </linearGradient>
      </defs>
      <rect {...{ x: BG.x, y: BG.y, width: BG.w, height: BG.h }} fill={`url(#${idBase}-lbg)`} />
      <LuxDial idBase={idBase} cx={330} cy={380} frac={d.speedFrac} redFrom={null} labels={[0, 40, 80, 120, 160, 200, 240]}
        windowText={d.speedText} unit="KM/H" region="speedCluster" valueAttr="speed" t={t} />
      <LuxDial idBase={idBase} cx={950} cy={380} frac={d.rpmFrac} redFrom={d.redFrom}
        labels={Array.from({ length: d.rpmMax / 1000 + 1 }, (_, i) => i)}
        windowText={rpmK(d.rpm)} unit="×1000 RPM" region="rightCluster" valueAttr="rpm" t={t} />
      <g data-cockpit-region="leftCluster">
        <rect x={565} y={250} width={150} height={236} rx={24} fill="#0b1222" stroke={`url(#${idBase}-lchrome)`} strokeWidth={2} />
        {date && <text x={640} y={290} textAnchor="middle" fontSize={15} fill={LUX.dim}>{date}</text>}
        <line x1={590} y1={310} x2={690} y2={310} stroke="#2a3a5c" />
        <text data-cockpit-value="gear" x={640} y={382} textAnchor="middle" fontSize={64} fontFamily='Georgia, "Times New Roman", serif'
          fill={state.gear ? LUX.cream : t.muted}>{state.gear ?? EM_DASH}</text>
        <text x={640} y={430} textAnchor="middle" fontSize={15} className="caros-cockpit-numeral"
          fill={d.rangeText === EM_DASH ? t.muted : LUX.dim}>{`${d.rangeText} km menzil`}</text>
        <text x={640} y={458} textAnchor="middle" fontSize={15} className="caros-cockpit-numeral"
          fill={d.coolantText === EM_DASH ? t.muted : LUX.dim}>{`Motor ${d.coolantText}`}</text>
      </g>
      <LimitSign limit={state.speedLimitKmh} definitive={state.speedLimitDefinitive} over={state.speedOverLimit === true}
        cx={640} cy={556} r={30} t={t} />
    </g>
  );
});

/* ── D · AURORA (cam) ────────────────────────────────────────────────────── */

const AURORA = { ink: '#ffffff', soft: '#cfe7ff', card: 'rgba(255,255,255,0.07)', cardEdge: 'rgba(255,255,255,0.14)' };

const AuroraCluster = memo(function AuroraCluster({ state, t, idBase }: { state: CockpitState; t: CockpitTokens; idBase: string }) {
  const d = derive(state);
  const arc = arcPath(640, 560, 300, 240, 60);
  const card = (x: number, y: number, title: string, value: string, sub: string | null, region: string) => (
    <g data-cockpit-region={region}>
      <rect x={x} y={y} width={250} height={130} rx={26} fill={AURORA.card} stroke={AURORA.cardEdge} />
      <text x={x + 24} y={y + 38} fontSize={15} fill={AURORA.soft} fillOpacity={0.75}>{title}</text>
      <text x={x + 24} y={y + 86} fontSize={40} fontWeight={300} className="caros-cockpit-numeral"
        fill={value.startsWith(EM_DASH) ? t.muted : AURORA.ink}>{value}</text>
      {sub && <text x={x + 24} y={y + 114} fontSize={14} fill={AURORA.soft} fillOpacity={0.65}>{sub}</text>}
    </g>
  );
  const blob = (id: string, color: string) => (
    <radialGradient id={id} cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stopColor={color} stopOpacity={0.75} /><stop offset="0.6" stopColor={color} stopOpacity={0.25} />
      <stop offset="1" stopColor={color} stopOpacity={0} />
    </radialGradient>
  );
  return (
    <g data-cockpit-style="aurora">
      <defs>
        <linearGradient id={`${idBase}-abg`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#050b1a" /><stop offset="1" stopColor="#0a0616" />
        </linearGradient>
        {blob(`${idBase}-ab1`, '#0fb5a6')}{blob(`${idBase}-ab2`, '#6a4cff')}{blob(`${idBase}-ab3`, '#1e6bff')}
        <linearGradient id={`${idBase}-aarc`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#34d3c5" /><stop offset="1" stopColor="#8b7bff" />
        </linearGradient>
      </defs>
      <rect {...{ x: BG.x, y: BG.y, width: BG.w, height: BG.h }} fill={`url(#${idBase}-abg)`} />
      <g aria-hidden="true" data-cockpit-decoration="aurora">
        <ellipse cx={300} cy={640} rx={520} ry={240} fill={`url(#${idBase}-ab1)`} />
        <ellipse cx={900} cy={120} rx={500} ry={230} fill={`url(#${idBase}-ab2)`} />
        <ellipse cx={1080} cy={640} rx={380} ry={200} fill={`url(#${idBase}-ab3)`} />
      </g>
      <g data-cockpit-region="speedCluster">
        <text data-cockpit-value="speed" x={640} y={330} textAnchor="middle" fontSize={190} fontWeight={200}
          className="caros-cockpit-numeral"
          fill={state.speedOverLimit ? t.warningRed : d.speedText === EM_DASH ? t.muted : AURORA.ink}>{d.speedText}</text>
        <text x={640} y={372} textAnchor="middle" fontSize={20} letterSpacing={8} fill={AURORA.soft} fillOpacity={0.8}>KM/H</text>
      </g>
      <g data-cockpit-region="rightCluster">
        <path d={arc} fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth={10} strokeLinecap="round" />
        {d.rpmFrac !== null && d.rpmFrac > 0 && (
          <path data-cockpit-rpm-marker="" d={arc} pathLength={100} fill="none" stroke={`url(#${idBase}-aarc)`} strokeWidth={10}
            strokeLinecap="round" strokeDasharray={`${d.rpmFrac * 100} 100`} />
        )}
        <text data-cockpit-value="rpm" x={640} y={440} textAnchor="middle" fontSize={18} className="caros-cockpit-numeral"
          fill={d.rpm === null ? t.muted : AURORA.soft}>{[state.gear, rpmFull(d.rpm)].filter(Boolean).join(' · ')}</text>
      </g>
      {card(64, 190, 'Menzil', `${d.rangeText} km`, d.fuel === null ? null : `Yakıt %${Math.round(d.fuel * 100)}`, 'leftCluster')}
      {card(64, 340, 'Motor', d.coolantText, null, 'coolantCard')}
      {card(966, 190, 'Vites', state.gear ?? EM_DASH, null, 'gearCard')}
      <g data-cockpit-region="assistCard">
        <rect x={966} y={340} width={250} height={130} rx={26} fill={AURORA.card} stroke={AURORA.cardEdge} />
        <text x={990} y={378} fontSize={15} fill={AURORA.soft} fillOpacity={0.75}>Hız sınırı</text>
        {bandOrNull(state.speedLimitKmh, COCKPIT_BANDS.speed) === null
          ? <text x={990} y={426} fontSize={40} fontWeight={300} fill={t.muted}>{EM_DASH}</text>
          : <LimitSign limit={state.speedLimitKmh} definitive={state.speedLimitDefinitive} over={state.speedOverLimit === true}
              cx={1091} cy={416} r={36} t={t} />}
      </g>
    </g>
  );
});

export const ShowcaseCluster = memo(function ShowcaseCluster({ style, state, t, idBase, date }: {
  style: ShowcaseStyle; state: CockpitState; t: CockpitTokens; idBase: string; date: string;
}) {
  switch (style) {
    case 'neon': return <NeonCluster state={state} t={t} idBase={idBase} />;
    case 'sport': return <SportCluster state={state} t={t} idBase={idBase} />;
    case 'luxury': return <LuxuryCluster state={state} t={t} idBase={idBase} date={date} />;
    case 'aurora': return <AuroraCluster state={state} t={t} idBase={idBase} />;
  }
});
