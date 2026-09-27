/**
 * cockpitClusters — Sürücü ekranının ALTERNATİF görünümleri (kullanıcı isteği
 * 2026-09-27: "kimi eskiyi sever kimi yeniyi — hepsine hitap edilmeli").
 *
 *   analog  — ibreli iki büyük kadran, krom çerçeve (klasik araç)
 *   retro   — krem kadran yüzü, siyah rakamlar (70'ler–80'ler)
 *   digital — dev hız rakamı + yatay bölmeli devir çubuğu + dikey yakıt/sıcaklık
 *
 * Yalnız sunum; veri `CockpitState`ten gelir. FAIL-CLOSED: değer bilinmiyorsa
 * İBRE ÇİZİLMEZ (ibre sahte bir 0'da durmaz) ve pencerede "—" yazar. Kırmızı
 * bölge yalnız araçtan gelen devir sınırıyla çizilir. SVG filtresi yok (zayıf GPU).
 * Koordinatlar 1280×720 tasarım birimidir (ekran `scale(0.8)` uygular).
 */
import { memo } from 'react';
import type { CockpitTokens } from './cockpitLayout';
import {
  EM_DASH, fmtSpeed, fmtCoolant, fmtRange, coolantFill, fuelFill, rpmFill, bandOrNull, COCKPIT_BANDS,
  type CockpitState,
} from './cockpitDataModel';

const rad = (deg: number) => (deg * Math.PI) / 180;
const polar = (cx: number, cy: number, r: number, deg: number) =>
  ({ x: +(cx + Math.cos(rad(deg)) * r).toFixed(2), y: +(cy + Math.sin(rad(deg)) * r).toFixed(2) });
function arcPath(cx: number, cy: number, r: number, from: number, sweep: number): string {
  const a = polar(cx, cy, r, from);
  const b = polar(cx, cy, r, from + sweep);
  return `M${a.x} ${a.y} A${r} ${r} 0 ${sweep > 180 ? 1 : 0} 1 ${b.x} ${b.y}`;
}

/* ── Hız sınırı levhası — TÜM görünümlerde aynı kural ─────────────────── */

/** Kesin değilse kesikli çerçeve; aşımda levha kırmızı (karar veri katmanında). */
export function LimitSign({ limit, definitive, over, cx, cy, r = 28, t }: {
  limit: number | null; definitive: boolean; over: boolean; cx: number; cy: number; r?: number; t: CockpitTokens;
}) {
  const valid = bandOrNull(limit, COCKPIT_BANDS.speed);
  if (valid === null) return null;
  return (
    <g data-cockpit-speedlimit={definitive ? 'definitive' : 'uncertain'}
      data-cockpit-overspeed={over ? 'true' : undefined}
      aria-label={`${definitive ? 'Hız sınırı' : 'Kesin olmayan hız sınırı'}: ${Math.round(valid)} km/h`}>
      <circle cx={cx} cy={cy} r={r} fill={over ? t.warningRed : t.sign} stroke={t.warningRed} strokeWidth={r * 0.28}
        strokeDasharray={definitive ? undefined : '8 5'} />
      <text x={cx} y={cy + r * 0.32} fontSize={valid >= 100 ? r * 0.78 : r * 0.92} textAnchor="middle"
        fontWeight={800} fill={over ? '#ffffff' : '#111'}>{Math.round(valid)}</text>
    </g>
  );
}

/* ── İbreli kadran (analog + retro) ───────────────────────────────────── */

type Face = 'analog' | 'retro';
const A_FROM = 135;
const A_SWEEP = 270;

interface FacePalette { face: string; faceEdge: string; bezelHi: string; bezelLo: string; tick: string; num: string; needle: string; window: string; windowInk: string; font: string }

function palette(face: Face, mode: 'day' | 'night', t: CockpitTokens): FacePalette {
  if (face === 'retro') {
    return mode === 'night'
      ? { face: '#D9CBA8', faceEdge: '#B9A77F', bezelHi: '#3A2E22', bezelLo: '#120D08', tick: '#1B140C', num: '#1B140C',
          needle: t.accent, window: '#1B140C', windowInk: '#F1E6CC', font: 'Georgia, "Times New Roman", serif' }
      : { face: '#F3E9D2', faceEdge: '#D8C69F', bezelHi: '#4A3B2B', bezelLo: '#1A120B', tick: '#1B140C', num: '#1B140C',
          needle: t.accent, window: '#1B140C', windowInk: '#F6EDD8', font: 'Georgia, "Times New Roman", serif' };
  }
  return mode === 'night'
    ? { face: '#0E1622', faceEdge: '#04070B', bezelHi: '#D9DEE5', bezelLo: '#4A525E', tick: '#E6ECF3', num: '#E6ECF3',
        needle: t.accent, window: '#04070B', windowInk: t.textPrimary, font: 'inherit' }
    : { face: '#F4F6F9', faceEdge: '#CDD5DF', bezelHi: '#FFFFFF', bezelLo: '#8A93A0', tick: '#0B1220', num: '#0B1220',
        needle: t.accent, window: '#0B1220', windowInk: '#F4F6F9', font: 'inherit' };
}

/**
 * Tek ibreli kadran. `value` bilinmiyorsa ibre ÇİZİLMEZ; pencerede "—".
 * `redFrom` (0-1) yalnız araçtan gelen kesin sınır varsa verilir.
 */
function NeedleDial({ id, cx, cy, r, max, major, minorPerMajor, labelDiv = 1, value, windowText, unit, redFrom, face, mode, t, region }: {
  id: string; cx: number; cy: number; r: number; max: number; major: number; minorPerMajor: number; labelDiv?: number;
  value: number | null; windowText: string; unit: string; redFrom: number | null;
  face: Face; mode: 'day' | 'night'; t: CockpitTokens; region: string;
}) {
  const p = palette(face, mode, t);
  const steps = Math.round(max / major) * minorPerMajor;
  const ticks = Array.from({ length: steps + 1 }, (_, i) => {
    const f = i / steps;
    const isMajor = i % minorPerMajor === 0;
    const deg = A_FROM + A_SWEEP * f;
    return { f, isMajor, a: polar(cx, cy, r - 14, deg), b: polar(cx, cy, r - (isMajor ? 40 : 26), deg),
      l: isMajor ? polar(cx, cy, r - 66, deg) : null, label: isMajor ? Math.round((f * max) / labelDiv) : null };
  });
  const frac = value === null ? null : Math.max(0, Math.min(1, value / max));
  const needleDeg = frac === null ? null : A_FROM + A_SWEEP * frac;
  const tip = needleDeg === null ? null : polar(cx, cy, r - 22, needleDeg);
  const tail = needleDeg === null ? null : polar(cx, cy, 26, needleDeg + 180);
  const side = needleDeg === null ? null : { a: polar(cx, cy, 7, needleDeg + 90), b: polar(cx, cy, 7, needleDeg - 90) };
  return (
    <g data-cockpit-region={region}>
      <defs>
        <radialGradient id={`${id}-face`} cx="0.5" cy="0.45" r="0.6">
          <stop offset="0" stopColor={p.face} />
          <stop offset="1" stopColor={p.faceEdge} />
        </radialGradient>
        <linearGradient id={`${id}-bezel`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={p.bezelHi} />
          <stop offset="1" stopColor={p.bezelLo} />
        </linearGradient>
      </defs>
      <circle cx={cx} cy={cy} r={r + 8} fill={`url(#${id}-bezel)`} />
      <circle cx={cx} cy={cy} r={r} fill={`url(#${id}-face)`} />
      {redFrom !== null && (
        <path d={arcPath(cx, cy, r - 20, A_FROM + A_SWEEP * redFrom, A_SWEEP * (1 - redFrom))} fill="none"
          stroke={t.warningRed} strokeWidth={10} opacity={0.85} />
      )}
      {ticks.map((k, i) => (
        <line key={i} x1={k.a.x} y1={k.a.y} x2={k.b.x} y2={k.b.y} stroke={redFrom !== null && k.f >= redFrom ? t.warningRed : p.tick}
          strokeWidth={k.isMajor ? 4 : 2} strokeLinecap="round" />
      ))}
      {ticks.filter((k) => k.l).map((k, i) => (
        <text key={i} data-cockpit-scale="dial" x={k.l!.x} y={k.l!.y + 9} textAnchor="middle" fontSize={r * 0.13}
          fontWeight={face === 'retro' ? 700 : 500} fontFamily={p.font} fill={p.num}>{k.label}</text>
      ))}
      <text x={cx} y={cy - r * 0.32} textAnchor="middle" fontSize={r * 0.085} letterSpacing={2}
        fontFamily={p.font} fill={p.num} opacity={0.7}>{unit}</text>
      {/* Pencere metnin boyuna göre genişler ("2.100 · D" retro tek aralıklı yazıda taşıyordu). */}
      <rect x={cx - (windowText.length > 5 ? 84 : 62)} y={cy + r * 0.34} width={windowText.length > 5 ? 168 : 124}
        height={44} rx={8} fill={p.window} opacity={0.9} />
      <text data-cockpit-value={region === 'speedCluster' ? 'speed' : 'rpm'} x={cx} y={cy + r * 0.34 + 32}
        textAnchor="middle" fontSize={windowText.length > 5 ? 24 : 30} fontWeight={600} fontFamily={face === 'retro' ? '"Courier New", monospace' : 'inherit'}
        className="caros-cockpit-numeral" fill={windowText === EM_DASH ? t.muted : p.windowInk}>{windowText}</text>
      {tip && tail && side && (
        <g data-cockpit-needle="">
          <polygon points={`${tip.x},${tip.y} ${side.a.x},${side.a.y} ${tail.x},${tail.y} ${side.b.x},${side.b.y}`} fill={p.needle} />
        </g>
      )}
      <circle cx={cx} cy={cy} r={16} fill={p.bezelLo} stroke={p.bezelHi} strokeWidth={2} />
    </g>
  );
}

/** Analog / Retro küme: solda hız, sağda devir (ibreli). */
export const ClassicCluster = memo(function ClassicCluster({ state, face, mode, t, idBase }: {
  state: CockpitState; face: Face; mode: 'day' | 'night'; t: CockpitTokens; idBase: string;
}) {
  const speed = bandOrNull(state.speedKmh, COCKPIT_BANDS.speed);
  const rpm = bandOrNull(state.rpm, COCKPIT_BANDS.rpm);
  const knownRedline = bandOrNull(state.rpmRedline, COCKPIT_BANDS.rpm);
  const rpmMax = Math.max(8000, knownRedline ?? 8000);
  const rpmText = rpm === null ? EM_DASH : Math.round(rpm).toLocaleString('tr-TR');
  return (
    <g data-cockpit-style={face}>
      <NeedleDial id={`${idBase}-spd`} cx={400} cy={370} r={210} max={240} major={20} minorPerMajor={2}
        value={speed} windowText={fmtSpeed(state.speedKmh)} unit="km/h" redFrom={null}
        face={face} mode={mode} t={t} region="speedCluster" />
      <NeedleDial id={`${idBase}-rpm`} cx={880} cy={370} r={210} max={rpmMax} major={1000} minorPerMajor={2} labelDiv={1000}
        value={rpm} windowText={state.gear ? `${rpmText} · ${state.gear}` : rpmText} unit="×1000 rpm"
        redFrom={knownRedline !== null && knownRedline < rpmMax ? knownRedline / rpmMax : null}
        face={face} mode={mode} t={t} region="rightCluster" />
      <LimitSign limit={state.speedLimitKmh} definitive={state.speedLimitDefinitive} over={state.speedOverLimit === true}
        cx={640} cy={560} r={30} t={t} />
    </g>
  );
});

/* ── Tam dijital küme ──────────────────────────────────────────────────── */

const SEG = 40;

/** Dev hız rakamı, yatay bölmeli devir çubuğu, dikey yakıt ve sıcaklık çubukları. */
export const DigitalCluster = memo(function DigitalCluster({ state, t }: { state: CockpitState; t: CockpitTokens }) {
  const speedText = fmtSpeed(state.speedKmh);
  const knownRedline = bandOrNull(state.rpmRedline, COCKPIT_BANDS.rpm);
  const rpmMax = Math.max(8000, knownRedline ?? 8000);
  const fill = rpmFill(state.rpm, rpmMax);
  const lit = fill === null ? 0 : Math.round(fill * SEG);
  const redSeg = knownRedline !== null && knownRedline < rpmMax ? Math.round((knownRedline / rpmMax) * SEG) : null;
  const rpm = bandOrNull(state.rpm, COCKPIT_BANDS.rpm);
  const fuel = fuelFill(state.fuelLevelPct);
  const liveCoolant = state.coolantFreshness === 'LIVE' ? state.coolantTempC : null;
  const cool = coolantFill(liveCoolant);
  const segW = 700 / SEG;
  const bar = (x: number, frac: number | null, color: string, label: string, top: string, bottom: string, value: string, attr: string) => (
    <g data-cockpit-bar={attr}>
      <text x={x + 15} y={228} textAnchor="middle" fontSize={16} fill={t.muted}>{top}</text>
      {Array.from({ length: 14 }, (_, i) => {
        const on = frac !== null && i < Math.round(frac * 14);
        return <rect key={i} x={x} y={560 - (i + 1) * 22} width={30} height={16} rx={3}
          fill={on ? color : t.track} />;
      })}
      <text x={x + 15} y={588} textAnchor="middle" fontSize={16} fill={t.muted}>{bottom}</text>
      <text x={x + 15} y={622} textAnchor="middle" fontSize={20} fontWeight={600} className="caros-cockpit-numeral"
        fill={value.startsWith(EM_DASH) ? t.muted : t.textPrimary}>{value}</text>
      <text x={x + 15} y={646} textAnchor="middle" fontSize={13} fill={t.textSecondary}>{label}</text>
    </g>
  );
  return (
    <g data-cockpit-style="digital">
      <g data-cockpit-region="rightCluster">
        {Array.from({ length: SEG }, (_, i) => {
          const red = redSeg !== null && i >= redSeg;
          const on = i < lit;
          return <rect key={i} x={290 + i * segW} y={150} width={segW - 4} height={34} rx={3}
            fill={on ? (red ? t.warningRed : t.accent) : red ? t.warningRed : t.track} opacity={on ? 1 : red ? 0.3 : 1} />;
        })}
        {Array.from({ length: rpmMax / 1000 + 1 }, (_, i) => (
          <text key={i} data-cockpit-scale="tacho" x={290 + (700 * i * 1000) / rpmMax} y={210} textAnchor="middle"
            fontSize={16} fill={t.muted}>{i}</text>
        ))}
        <text data-cockpit-value="rpm" x={990} y={140} textAnchor="end" fontSize={22} fontWeight={600}
          className="caros-cockpit-numeral" fill={rpm === null ? t.muted : t.textPrimary}>
          {rpm === null ? `${EM_DASH} rpm` : `${Math.round(rpm).toLocaleString('tr-TR')} rpm`}</text>
      </g>
      <g data-cockpit-region="speedCluster">
        <text data-cockpit-value="speed" x={640} y={450} textAnchor="middle" fontSize={230} fontWeight={200}
          letterSpacing={-8} className="caros-cockpit-numeral"
          fill={state.speedOverLimit ? t.warningRed : speedText === EM_DASH ? t.muted : t.textPrimary}>{speedText}</text>
        <text x={640} y={500} textAnchor="middle" fontSize={24} letterSpacing={3} fill={t.textSecondary}>km/h</text>
        {state.gear && (
          <text data-cockpit-value="gear" x={420} y={420} textAnchor="middle" fontSize={64} fontWeight={600}
            className="caros-cockpit-numeral" fill={t.accentHigh}>{state.gear}</text>
        )}
        <LimitSign limit={state.speedLimitKmh} definitive={state.speedLimitDefinitive}
          over={state.speedOverLimit === true} cx={870} cy={360} r={36} t={t} />
      </g>
      {bar(70, fuel, fuel !== null && fuel < 0.15 ? t.warningRed : t.accent, 'menzil', 'F', 'E',
        `${fmtRange(state.rangeKm)} km`, 'fuel')}
      {bar(1180, cool, cool !== null && cool > 0.85 ? t.warningRed : t.accent, 'motor', 'H', 'C',
        fmtCoolant(liveCoolant), 'coolant')}
    </g>
  );
});
