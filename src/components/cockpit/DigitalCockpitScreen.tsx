/**
 * CarOS Digital Cockpit — yalnız sunum. Veri/transport DigitalCockpitPage'den
 * gelir; HOME, navigation, media ve vehicle authority burada kurulmaz.
 * Tek SVG tuval + native medya düğmeleri; ölçüm/timer/animasyon döngüsü yok.
 *
 * Görsel dil (2026-09-23): modern dijital küme — simetrik üç gösterge
 * (segmentli devir · ışıldayan hız halkası · segmentli yakıt/menzil).
 * Işıma SVG filtresiyle DEĞİL, katmanlı çizgilerle yapılır (zayıf GPU'da ucuz).
 * Doluluklar yalnız ÖLÇÜLMÜŞ değerden gelir; bilinmeyen değer em dash'tir ve
 * gösterge boş kalır — sahte 0/değer ÜRETİLMEZ. Kırmızı bölge yalnız araçtan
 * gelen devir sınırıyla çizilir.
 */
import { memo, useId } from 'react';
import {
  COCKPIT_CANVAS, COCKPIT_REGIONS, COCKPIT_MIN_TOUCH_PX,
  cockpitTokensFor, type CockpitTokens,
} from './cockpitLayout';
import {
  EM_DASH, fmtSpeed, fmtRpmThousands, fmtCoolant, fmtRange, fmtConsumption,
  fmtOdometer, fmtAmbient, fmtManeuverDistance, coolantFill, fuelFill, rpmFill,
  bandOrNull, COCKPIT_BANDS, type CockpitState, type CockpitManeuver,
} from './cockpitDataModel';
import '../../styles/fonts.css';
import './digitalCockpit.css';

/** Tuvale özgü gradyan kimlikleri (aynı sayfada iki kokpit çakışmasın). */
interface Ids { ring: string; fill: string; glow: string; fade: string; shelf: string }
type PaletteProps = { t: CockpitTokens; ids: Ids };

/** Ölçülmüş değer birincil, em dash sakin renkle çizilir (bilgi aynı, gürültü az). */
const valueFill = (text: string, t: CockpitTokens): string => (text === EM_DASH ? t.muted : t.textPrimary);

/* ── Kutupsal geometri (saf, modül yüklenirken bir kez) ─────────────────── */
const rad = (deg: number) => (deg * Math.PI) / 180;
const polar = (cx: number, cy: number, r: number, deg: number) =>
  ({ x: +(cx + Math.cos(rad(deg)) * r).toFixed(2), y: +(cy + Math.sin(rad(deg)) * r).toFixed(2) });
function arcPath(cx: number, cy: number, r: number, from: number, sweep: number): string {
  const a = polar(cx, cy, r, from);
  const b = polar(cx, cy, r, from + sweep);
  return `M${a.x} ${a.y} A${r} ${r} 0 ${sweep > 180 ? 1 : 0} 1 ${b.x} ${b.y}`;
}

/** Yan göstergeler: 250° yay, alt kısmı açık. Segmentler radyal kısa çubuklar. */
const SIDE_FROM = 145;
const SIDE_SWEEP = 250;
function segments(cx: number, cy: number, count: number, r1: number, r2: number) {
  return Object.freeze(Array.from({ length: count }, (_, i) => {
    const frac = (i + 0.5) / count;
    const deg = SIDE_FROM + SIDE_SWEEP * frac;
    return { frac, a: polar(cx, cy, r1, deg), b: polar(cx, cy, r2, deg) };
  }));
}

const RPM_C = { x: 168, y: 250 };
const RPM_SEGMENTS = segments(RPM_C.x, RPM_C.y, 36, 84, 102);
const RPM_LABELS = Object.freeze([0, 0.25, 0.5, 0.75, 1].map((f) => ({ f, p: polar(RPM_C.x, RPM_C.y, 68, SIDE_FROM + SIDE_SWEEP * f) })));

const FUEL_C = { x: 856, y: 250 };
const FUEL_SEGMENTS = segments(FUEL_C.x, FUEL_C.y, 24, 84, 102);

/* Hız halkası: alt kısmı açık 240°, merkez (512,238) r=128. */
const SPEED_C = { x: 512, y: 238 };
const SPEED_R = 128;
const SPEED_FROM = 150;
const SPEED_SWEEP = 240;
const SPEED_MAX = 240;
const SPEED_RING_PATH = arcPath(SPEED_C.x, SPEED_C.y, SPEED_R, SPEED_FROM, SPEED_SWEEP);
const SPEED_TICKS = Object.freeze(Array.from({ length: 13 }, (_, i) => {
  const deg = SPEED_FROM + (SPEED_SWEEP * i) / 12;
  const major = i % 2 === 0;
  return { major, a: polar(SPEED_C.x, SPEED_C.y, SPEED_R - 12, deg), b: polar(SPEED_C.x, SPEED_C.y, SPEED_R - (major ? 22 : 17), deg) };
}));

/** Uzun başlıkları ölçüm/timer olmadan sınırlar; tam metin erişilebilir kalır. */
function Copy({ x, y, width, height = 24, children, size = 16, weight = 400, color, center = false }: {
  x: number; y: number; width: number; height?: number; children: string;
  size?: number; weight?: number; color: string; center?: boolean;
}) {
  return (
    <foreignObject x={x} y={y} width={width} height={height}>
      <div data-cockpit-copy="" className="caros-cockpit-copy" title={children}
        style={{ fontSize: size, fontWeight: weight, color, lineHeight: `${height}px`, textAlign: center ? 'center' : 'left' }}>
        {children}
      </div>
    </foreignObject>
  );
}

/** Yalnız yüzey konturları: coğrafya, şerit, rota veya algılanmış araç değildir. */
const Horizon = memo(function Horizon({ t }: PaletteProps) {
  return (
    <g data-cockpit-region="roadScene" data-cockpit-decoration="abstract-horizon" aria-hidden="true" pointerEvents="none">
      <path d="M320 452 Q512 414 704 452Z" fill={t.horizon} opacity={0.6} />
      <path d="M380 452 Q512 428 644 452" fill="none" stroke={t.horizonLine} strokeWidth={1} opacity={0.6} />
    </g>
  );
});

const EngineZone = memo(function EngineZone({ rpm, redline, coolant, freshness, t, ids }: PaletteProps & {
  rpm: number | null; redline: number | null; coolant: number | null;
  freshness: CockpitState['coolantFreshness'];
}) {
  // 8000 yalnız skala tabanı; kırmızı bölge YALNIZ araçtan gelen sınırla çizilir.
  const knownRedline = bandOrNull(redline, COCKPIT_BANDS.rpm);
  const scaleMax = Math.max(8000, knownRedline ?? 8000);
  const redFrac = knownRedline !== null && knownRedline < scaleMax ? knownRedline / scaleMax : null;
  const fill = rpmFill(rpm, scaleMax);
  const tip = fill === null ? null : polar(RPM_C.x, RPM_C.y, 93, SIDE_FROM + SIDE_SWEEP * fill);
  const liveCoolant = freshness === 'LIVE' ? coolant : null;
  const cool = coolantFill(liveCoolant);
  const rpmText = fmtRpmThousands(rpm);
  const coolText = fmtCoolant(liveCoolant);
  const isRed = (f: number) => redFrac !== null && f >= redFrac;
  return (
    <g data-cockpit-region="leftCluster">
      <text x={168} y={127} textAnchor="middle" className="caros-cockpit-eyebrow" fill={t.textSecondary}>MOTOR DEVRİ</text>
      {RPM_SEGMENTS.map((s, i) => (
        <line key={i} x1={s.a.x} y1={s.a.y} x2={s.b.x} y2={s.b.y} strokeWidth={4} strokeLinecap="round"
          stroke={isRed(s.frac) ? t.warningRed : t.track} opacity={isRed(s.frac) ? 0.35 : 1} />
      ))}
      {fill !== null && fill > 0 && (
        <g data-cockpit-rpm-fill="">
          {RPM_SEGMENTS.filter((s) => s.frac <= fill).map((s, i) => (
            <g key={i}>
              <line x1={s.a.x} y1={s.a.y} x2={s.b.x} y2={s.b.y} strokeWidth={9} strokeLinecap="round"
                stroke={isRed(s.frac) ? t.warningRed : t.glow} opacity={0.35} />
              <line x1={s.a.x} y1={s.a.y} x2={s.b.x} y2={s.b.y} strokeWidth={4} strokeLinecap="round"
                stroke={isRed(s.frac) ? t.warningRed : `url(#${ids.ring})`} />
            </g>
          ))}
        </g>
      )}
      {RPM_LABELS.map(({ f, p }) => (
        <text key={f} data-cockpit-scale="tacho" x={p.x} y={p.y + 4} textAnchor="middle" fontSize={11}
          fontWeight={500} fill={t.textSecondary}>{f * scaleMax / 1000}</text>
      ))}
      {tip && <circle data-cockpit-rpm-marker="" cx={tip.x} cy={tip.y} r={3} fill={t.accentHigh} />}
      <text data-cockpit-value="rpm" x={168} y={264} textAnchor="middle" className="caros-cockpit-numeral"
        fontSize={46} fontWeight={300} letterSpacing={-1.5} fill={valueFill(rpmText, t)}>{rpmText}</text>
      <text x={168} y={286} textAnchor="middle" fontSize={10} letterSpacing={1.5} fill={t.textSecondary}>×1000 rpm</text>

      <text x={62} y={356} className="caros-cockpit-label" fill={t.textSecondary}>Motor sıcaklığı</text>
      <text data-cockpit-value="coolant" x={274} y={384} textAnchor="end" className="caros-cockpit-numeral"
        fontSize={24} fontWeight={400} fill={valueFill(coolText, t)}>{coolText}</text>
      {freshness === 'STALE' && <text x={62} y={383} fontSize={11} fill={t.textSecondary}>Veri güncel değil</text>}
      <rect x={62} y={398} width={212} height={5} rx={2.5} fill={t.track} />
      {cool !== null && <rect data-cockpit-coolant-fill="" x={62} y={398} width={212 * cool} height={5} rx={2.5} fill={`url(#${ids.fill})`} />}
      <text x={62} y={421} fontSize={10} letterSpacing={1} fill={t.textSecondary}>C</text>
      <text x={274} y={421} fontSize={10} letterSpacing={1} textAnchor="end" fill={t.textSecondary}>H</text>
    </g>
  );
});

const SpeedZone = memo(function SpeedZone({ speed, limit, definitive, over, curve, t, ids }: PaletteProps & {
  speed: number | null; limit: number | null; definitive: boolean; over: boolean;
  curve: CockpitState['curve'];
}) {
  const validLimit = bandOrNull(limit, COCKPIT_BANDS.speed);
  const validSpeed = bandOrNull(speed, COCKPIT_BANDS.speed);
  const ringFill = validSpeed === null ? null : Math.min(1, Math.max(0, validSpeed / SPEED_MAX));
  const tip = ringFill === null ? null : polar(SPEED_C.x, SPEED_C.y, SPEED_R, SPEED_FROM + SPEED_SWEEP * ringFill);
  const speedText = fmtSpeed(speed);
  const dash = ringFill === null ? null : `${ringFill * 100} 100`;
  return (
    <g data-cockpit-region="speedCluster">
      <circle cx={SPEED_C.x} cy={SPEED_C.y} r={170} fill={`url(#${ids.glow})`} aria-hidden="true" />
      <path d={SPEED_RING_PATH} fill="none" stroke={t.track} strokeWidth={6} strokeLinecap="round" />
      {SPEED_TICKS.map((k, i) => (
        <line key={i} x1={k.a.x} y1={k.a.y} x2={k.b.x} y2={k.b.y} strokeLinecap="round"
          stroke={k.major ? t.textSecondary : t.track} strokeWidth={k.major ? 2 : 1.5} />
      ))}
      {dash !== null && ringFill !== null && ringFill > 0 && (
        <g data-cockpit-speed-fill="">
          <path d={SPEED_RING_PATH} pathLength={100} fill="none" stroke={t.glow} strokeWidth={18}
            strokeLinecap="round" strokeDasharray={dash} opacity={0.25} />
          <path d={SPEED_RING_PATH} pathLength={100} fill="none" stroke={`url(#${ids.ring})`} strokeWidth={6}
            strokeLinecap="round" strokeDasharray={dash} />
          {tip && <circle cx={tip.x} cy={tip.y} r={5} fill={t.textPrimary} />}
        </g>
      )}
      <text x={512} y={160} textAnchor="middle" className="caros-cockpit-eyebrow" fill={t.textSecondary}>HIZ</text>
      <text data-cockpit-value="speed" x={512} y={284} textAnchor="middle" className="caros-cockpit-numeral"
        fontSize={132} fontWeight={200} letterSpacing={-5} fill={valueFill(speedText, t)}>{speedText}</text>
      <text x={512} y={312} textAnchor="middle" fontSize={13} letterSpacing={2.5} fill={t.textSecondary}>km/h</text>
      {curve && (
        /* Öndeki viraj — hız sınırı levhasının SİMETRİĞİ (sol üst), sarı uyarı levhası. */
        <g data-cockpit-curve={curve.direction}
          aria-label={`${curve.direction === 'right' ? 'Sağa' : 'Sola'} viraj, önerilen ${curve.advisoryKmh} km/h`}>
          <rect x={348} y={116} width={32} height={32} rx={4} transform="rotate(45 364 132)"
            fill="#FFC107" stroke={validSpeed !== null && validSpeed > curve.advisoryKmh + 5 ? t.warningRed : '#1f2937'}
            strokeWidth={validSpeed !== null && validSpeed > curve.advisoryKmh + 5 ? 3.5 : 1.5} />
          <text x={364} y={139} fontSize={curve.advisoryKmh >= 100 ? 15 : 18} textAnchor="middle"
            fontWeight={800} fill="#111">{curve.advisoryKmh}</text>
          <text x={364} y={178} fontSize={11} textAnchor="middle" fill={t.textSecondary}>
            {`${curve.direction === 'right' ? 'SAĞ VİRAJ' : 'SOL VİRAJ'}${curve.distanceM >= 50 ? ` · ${Math.round(curve.distanceM / 50) * 50} m` : ''}`}</text>
        </g>
      )}
      {validLimit !== null && (() => {
        /* Aşımda levha KIRMIZIYA döner — karar veri katmanında (overspeedModel). */
        return (
          <g data-cockpit-speedlimit={definitive ? 'definitive' : 'uncertain'}
            data-cockpit-overspeed={over ? 'true' : undefined}
            aria-label={`${definitive ? 'Hız sınırı' : 'Kesin olmayan hız sınırı'}: ${Math.round(validLimit)} km/h`}>
            <circle cx={660} cy={132} r={21} fill={over ? t.warningRed : t.sign} stroke={t.warningRed} strokeWidth={4}
              strokeDasharray={definitive ? undefined : '6 4'} />
            <text x={660} y={139} fontSize={validLimit >= 100 ? 17 : 20} textAnchor="middle"
              fontWeight={700} fill={over ? '#ffffff' : '#233239'}>{Math.round(validLimit)}</text>
          </g>
        );
      })()}
    </g>
  );
});

const VehicleZone = memo(function VehicleZone({ range, fuelLevel, consumption, odometer, t, ids }: PaletteProps & {
  range: number | null; fuelLevel: number | null; consumption: number | null; odometer: number | null;
}) {
  const fuel = fuelFill(fuelLevel);
  const rangeText = fmtRange(range);
  const fuelText = fuel === null ? EM_DASH : `%${Math.round(fuel * 100)}`;
  const consText = fmtConsumption(consumption);
  const odoText = fmtOdometer(odometer);
  const eLabel = polar(FUEL_C.x, FUEL_C.y, 68, SIDE_FROM);
  const fLabel = polar(FUEL_C.x, FUEL_C.y, 68, SIDE_FROM + SIDE_SWEEP);
  const lowFuel = (f: number) => f < 0.15;
  return (
    <g data-cockpit-region="rightCluster">
      <text x={856} y={127} textAnchor="middle" className="caros-cockpit-eyebrow" fill={t.textSecondary}>MENZİL</text>
      {FUEL_SEGMENTS.map((s, i) => (
        <line key={i} x1={s.a.x} y1={s.a.y} x2={s.b.x} y2={s.b.y} strokeWidth={5} strokeLinecap="round" stroke={t.track} />
      ))}
      {fuel !== null && (
        <g data-cockpit-fuel-gauge="">
          {FUEL_SEGMENTS.filter((s) => s.frac <= fuel).map((s, i) => (
            <line key={i} x1={s.a.x} y1={s.a.y} x2={s.b.x} y2={s.b.y} strokeWidth={5} strokeLinecap="round"
              stroke={lowFuel(s.frac) && fuel < 0.15 ? t.warningRed : `url(#${ids.ring})`} />
          ))}
        </g>
      )}
      <text x={eLabel.x} y={eLabel.y + 4} textAnchor="middle" fontSize={11} fontWeight={500} fill={t.textSecondary}>E</text>
      <text x={fLabel.x} y={fLabel.y + 4} textAnchor="middle" fontSize={11} fontWeight={500} fill={t.textSecondary}>F</text>
      <text data-cockpit-value="range" x={856} y={264} textAnchor="middle" fontSize={46} letterSpacing={-1.5}
        className="caros-cockpit-numeral" fontWeight={300} fill={valueFill(rangeText, t)}>{rangeText}</text>
      <text x={856} y={286} textAnchor="middle" fontSize={10} letterSpacing={1.5} fill={t.textSecondary}>km</text>
      <text x={834} y={318} textAnchor="end" fontSize={10} letterSpacing={1.5} fill={t.textSecondary}>Yakıt</text>
      <text data-cockpit-value="fuel" x={842} y={318} fontSize={13} fontWeight={500}
        fill={valueFill(fuelText, t)}>{fuelText}</text>
      {/* Yatay yakıt çubuğu: segment göstergesinin sayısal karşılığı (aynı ölçüm). */}
      <rect x={812} y={326} width={88} height={3} rx={1.5} fill={t.track} />
      {fuel !== null && <rect data-cockpit-fuel-fill="" x={812} y={326} width={88 * fuel} height={3} rx={1.5} fill={`url(#${ids.fill})`} />}

      <text x={748} y={362} className="caros-cockpit-label" fill={t.textSecondary}>Ort. tüketim</text>
      <text data-cockpit-value="consumption" x={748} y={390} fontSize={20} fontWeight={400} className="caros-cockpit-numeral"
        fill={valueFill(consText, t)}>{consText}</text>
      <text x={748} y={412} fontSize={10} letterSpacing={0.5} fill={t.muted}>Profil değeri</text>
      <text x={962} y={362} textAnchor="end" className="caros-cockpit-label" fill={t.textSecondary}>Toplam yol</text>
      <text data-cockpit-value="odometer" x={962} y={390} textAnchor="end" fontSize={20} fontWeight={400} className="caros-cockpit-numeral"
        fill={valueFill(odoText, t)}>{odoText}</text>
    </g>
  );
});

/** Bilinmeyen manevra asla varsayılan sağa dönüşe dönüşmez. */
function maneuverIconPath(type: string | null, modifier: string | null): string | null {
  if (type === 'arrive') return 'M9 42V5M10 6H39L31 16L39 26H10';
  // Dönel kavşak/çıkış gibi özel tiplerde kanıtsız dönüş oku yerine nötr bilgi.
  if (!['turn', 'continue', 'new name', 'depart', 'fork', 'merge', 'end of road', 'on ramp', 'off ramp'].includes(type ?? '')) return null;
  switch (modifier) {
    case 'left': return 'M38 43V25Q38 15 28 15H8M19 4L8 15L19 26';
    case 'right': return 'M10 43V25Q10 15 20 15H40M29 4L40 15L29 26';
    case 'slight left': return 'M33 44V29L12 8M12 25V8H29';
    case 'slight right': return 'M15 44V29L36 8M19 8H36V25';
    case 'sharp left': return 'M37 44V11L10 32M10 15V32H27';
    case 'sharp right': return 'M11 44V11L38 32M21 32H38V15';
    case 'uturn': return 'M10 44V18A14 14 0 0 1 38 18V33M28 23L38 33L46 23';
    case 'straight': return 'M24 44V5M10 19L24 5L38 19';
    default: return null;
  }
}

const ROUNDABOUT_TYPES = new Set(['roundabout', 'rotary', 'roundabout turn']);
/** Dönel kavşak halkası + giriş kolu (48×48 kutu). */
const ROUNDABOUT_RING_PATH = 'M24 47V38M24 38A15 15 0 1 1 24.01 38';

/** Dönüşe bu mesafe kala manevra kartı vurgulanır (Google/OEM "şimdi" hâli). */
export const MANEUVER_IMMINENT_M = 100;

/**
 * Manevra simgesi (48×48 kutuda tasarlanır, `size` px'e ölçeklenir).
 * Dönel kavşak YALNIZ çıkış numarası biliniyorsa çizilir (numara halkanın
 * içinde); bilinmiyorsa `null` → çağıran nötr "—" gösterir (uydurma yok).
 */
function ManeuverGlyph({ type, modifier, exit, cx, cy, size, color }: {
  type: string | null; modifier: string | null; exit: number | null | undefined;
  cx: number; cy: number; size: number; color: string;
}) {
  const k = size / 48;
  const tf = `translate(${cx - size / 2} ${cy - size / 2}) scale(${k})`;
  if (ROUNDABOUT_TYPES.has(type ?? '') && modifier === 'uturn') {
    return <path data-cockpit-maneuver-icon="" d={maneuverIconPath('turn', 'uturn')!} transform={tf}
      fill="none" stroke={color} strokeWidth={5} strokeLinecap="round" strokeLinejoin="round" />;
  }
  if (ROUNDABOUT_TYPES.has(type ?? '') && typeof exit === 'number' && exit > 0) {
    return (
      <g data-cockpit-maneuver-icon="" data-cockpit-roundabout-exit={exit} transform={tf}>
        <path d={ROUNDABOUT_RING_PATH} fill="none" stroke={color} strokeWidth={4.5} strokeLinecap="round" />
        <text x={24} y={30} textAnchor="middle" fontSize={20} fontWeight={800} fill={color}>{exit}</text>
      </g>
    );
  }
  const path = maneuverIconPath(type, modifier);
  if (!path) return null;
  return <path data-cockpit-maneuver-icon="" d={path} transform={tf}
    fill="none" stroke={color} strokeWidth={5} strokeLinecap="round" strokeLinejoin="round" />;
}

function hasGlyph(type: string | null, modifier: string | null, exit: number | null | undefined): boolean {
  if (ROUNDABOUT_TYPES.has(type ?? '')) return modifier === 'uturn' || (typeof exit === 'number' && exit > 0);
  return maneuverIconPath(type, modifier) !== null;
}

const ManeuverZone = memo(function ManeuverZone({ distanceMeters, label, type, modifier, roundaboutExit, then, t }: Omit<PaletteProps, 'ids'> & CockpitManeuver) {
  const imminent = distanceMeters !== null && distanceMeters <= MANEUVER_IMMINENT_M;
  const known = hasGlyph(type, modifier, roundaboutExit);
  const thenKnown = then ? hasGlyph(then.type, then.modifier, null) : false;
  const pillFill = imminent ? t.accent : t.accentSoft;
  const badgeFill = imminent ? t.canvas : t.accent;
  const glyphColor = imminent ? t.accentHigh : t.canvas;
  const distColor = imminent ? t.canvas : t.textPrimary;
  const exitLabel = ROUNDABOUT_TYPES.has(type ?? '') && typeof roundaboutExit === 'number' && roundaboutExit > 0
    ? `${roundaboutExit}. çıkış` : null;
  const caption = [exitLabel, label].filter(Boolean).join(' · ') || EM_DASH;
  return (
    <g data-cockpit-region="maneuverBar" data-cockpit-maneuver-imminent={imminent ? 'true' : undefined}>
      <rect x={372} y={330} width={280} height={58} rx={29} fill={pillFill} stroke={imminent ? t.accentHigh : t.border} />
      <circle cx={402} cy={359} r={24} fill={badgeFill} />
      {known
        ? <ManeuverGlyph type={type} modifier={modifier} exit={roundaboutExit} cx={402} cy={359}
            size={ROUNDABOUT_TYPES.has(type ?? '') ? 40 : 32} color={glyphColor} />
        : <text data-cockpit-maneuver-unknown="" x={402} y={367} textAnchor="middle" fontSize={24} fill={imminent ? t.muted : t.canvas}>{EM_DASH}</text>}
      <text data-cockpit-value="maneuverDistance" x={438} y={371} fontSize={32} fontWeight={500} className="caros-cockpit-numeral"
        fill={distColor}>{fmtManeuverDistance(distanceMeters)}</text>
      {then && thenKnown && (
        <g data-cockpit-maneuver-then="">
          <text x={590} y={352} textAnchor="middle" fontSize={10} letterSpacing={1} fill={imminent ? t.canvas : t.textSecondary}>ARDINDAN</text>
          <ManeuverGlyph type={then.type} modifier={then.modifier} exit={null} cx={590} cy={370} size={20}
            color={imminent ? t.canvas : t.accentHigh} />
        </g>
      )}
      <Copy x={COCKPIT_REGIONS.maneuverBar.x} y={394} width={COCKPIT_REGIONS.maneuverBar.w}
        color={t.textSecondary} center>{caption}</Copy>
    </g>
  );
});

const TransportButton = memo(function TransportButton({ label, path, onClick, disabled, primary, t }: Omit<PaletteProps, 'ids'> & {
  label: string; path: string; onClick?: () => void; disabled: boolean; primary?: boolean;
}) {
  return (
    <button type="button" className="caros-cockpit-transport" data-primary={primary ? 'true' : undefined}
      aria-label={label} disabled={disabled || !onClick}
      onClick={onClick} style={{ width: COCKPIT_MIN_TOUCH_PX, height: COCKPIT_MIN_TOUCH_PX,
        color: primary ? t.canvas : t.textPrimary, background: primary ? t.accent : t.accentSoft,
        borderColor: primary ? t.accent : t.border }}>
      <svg width={primary ? 24 : 20} height={primary ? 24 : 20} viewBox="0 0 24 24" aria-hidden="true"><path d={path} fill="currentColor" /></svg>
    </button>
  );
});

const MediaZone = memo(function MediaZone({ title, artist, artworkUrl, playing, available, onMediaPrevious, onMediaToggle, onMediaNext, t }: Omit<PaletteProps, 'ids'> &
  CockpitState['media'] & Pick<DigitalCockpitScreenProps, 'onMediaPrevious' | 'onMediaToggle' | 'onMediaNext'>) {
  return (
    <g data-cockpit-region="musicCard" data-no-page-swipe="">
      <rect x={40} y={496} width={64} height={64} rx={12} fill={t.accentSoft} />
      <path d="M67 520V541M67 521L85 517V537M67 526L85 522M67 539C59 535 56 545 62 546C67 548 68 543 67 539M85 535C77 531 74 541 80 542C85 544 86 539 85 535"
        fill="none" stroke={t.accent} strokeWidth={1.5} aria-hidden="true" />
      {artworkUrl !== null && <foreignObject x={40} y={496} width={64} height={64}>
        <img key={artworkUrl} className="caros-cockpit-art" src={artworkUrl} alt="Albüm kapağı" width={64} height={64}
          decoding="async" onError={(event) => { event.currentTarget.style.visibility = 'hidden'; }} />
      </foreignObject>}
      <text x={120} y={509} fontSize={10} letterSpacing={2} fill={t.accent}>MEDYA</text>
      <Copy x={120} y={514} width={282} size={17} weight={600} color={title ? t.textPrimary : t.muted}>{title ?? EM_DASH}</Copy>
      <Copy x={120} y={538} width={282} size={13} color={t.textSecondary}>{artist ?? EM_DASH}</Copy>
      <foreignObject x={420} y={500} width={212} height={64}>
        <div className="caros-cockpit-controls" style={{ color: t.accent }}>
          <TransportButton label="Önceki parça" path="M5 5H7V19H5ZM19 5V19L8 12Z" t={t} disabled={!available} onClick={onMediaPrevious} />
          <TransportButton label={playing ? 'Duraklat' : 'Çal'} primary t={t} disabled={!available} onClick={onMediaToggle}
            path={playing ? 'M6 5H10V19H6ZM14 5H18V19H14Z' : 'M7 4L20 12L7 20Z'} />
          <TransportButton label="Sonraki parça" path="M17 5H19V19H17ZM5 5L16 12L5 19Z" t={t} disabled={!available} onClick={onMediaNext} />
        </div>
      </foreignObject>
    </g>
  );
});

const DrivingZone = memo(function DrivingZone({ gear, driveMode, t }: Omit<PaletteProps, 'ids'> & Pick<CockpitState, 'gear' | 'driveMode'>) {
  const gearText = gear ?? EM_DASH;
  const modeText = driveMode ?? EM_DASH;
  return (
    <g data-cockpit-region="assistCard">
      <text x={706} y={513} textAnchor="middle" fontSize={10} letterSpacing={2} fill={t.textSecondary}>VİTES</text>
      <text data-cockpit-value="gear" x={706} y={550} textAnchor="middle" fontSize={32} className="caros-cockpit-numeral"
        fontWeight={500} fill={gear ? t.accentHigh : t.muted}>{gearText}</text>
      <line x1={748} y1={506} x2={748} y2={550} stroke={t.border} />
      <text x={774} y={513} fontSize={10} letterSpacing={2} fill={t.textSecondary}>SÜRÜŞ TERCİHİ</text>
      <text data-cockpit-value="driveMode" x={774} y={545} fontSize={18} fontWeight={600} letterSpacing={1.5}
        fill={valueFill(modeText, t)}>{modeText}</text>
    </g>
  );
});

const TopBar = memo(function TopBar({ time, date, ambient, t, ids }: PaletteProps & {
  time: string; date: string; ambient: number | null;
}) {
  const ambText = fmtAmbient(ambient);
  return (
    <g data-cockpit-region="topBar">
      <text x={32} y={39} fontSize={17} fontWeight={600} letterSpacing={4} fill={t.textPrimary}>CAROS</text>
      <text x={120} y={39} fontSize={10} fontWeight={600} letterSpacing={2} fill={t.detail}>PRO</text>
      <line x1={172} y1={25} x2={172} y2={43} stroke={t.border} />
      <text x={195} y={38} className="caros-cockpit-label" fill={t.textSecondary}>Dış ortam</text>
      <text data-cockpit-value="ambient" x={267} y={39} fontSize={16} fill={valueFill(ambText, t)}>{ambText}</text>
      <Copy x={652} y={23} width={196} size={12} color={t.textSecondary}>{date}</Copy>
      <text x={990} y={41} textAnchor="end" fontSize={24} fontWeight={300} letterSpacing={-0.5} className="caros-cockpit-numeral"
        fill={t.textPrimary}>{time}</text>
      <line x1={32} y1={66} x2={992} y2={66} stroke={`url(#${ids.fade})`} />
    </g>
  );
});

export interface DigitalCockpitScreenProps {
  readonly state: CockpitState;
  readonly mode: 'day' | 'night';
  readonly clock: { readonly time: string; readonly date: string };
  readonly onMediaPrevious?: () => void;
  readonly onMediaToggle?: () => void;
  readonly onMediaNext?: () => void;
}

export const DigitalCockpitScreen = memo(function DigitalCockpitScreen({
  state, mode, clock, onMediaPrevious, onMediaToggle, onMediaNext,
}: DigitalCockpitScreenProps) {
  const t = cockpitTokensFor(mode);
  const base = `cockpit-${useId().replace(/:/g, '')}`;
  const surfaceId = `${base}-surface`;
  const ids: Ids = { ring: `${base}-ring`, fill: `${base}-fill`, glow: `${base}-glow`, fade: `${base}-fade`, shelf: `${base}-shelf` };
  const vignette = `${base}-vignette`;
  return (
    <svg data-caros-cockpit="screen" data-cockpit-mode={mode} className="caros-cockpit-screen"
      width="100%" height="100%" viewBox={`0 0 ${COCKPIT_CANVAS.width} ${COCKPIT_CANVAS.height}`}
      preserveAspectRatio="xMidYMid meet" style={{ background: t.canvas }}
      role="group" aria-label="Araç gösterge ekranı">
      <defs>
        <linearGradient id={surfaceId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={t.surfaceTop} />
          <stop offset="1" stopColor={t.surfaceBottom} />
        </linearGradient>
        <linearGradient id={ids.shelf} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={t.surfaceTop} />
          <stop offset="1" stopColor={t.shelf} />
        </linearGradient>
        <linearGradient id={ids.ring} x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor={t.accent} />
          <stop offset="1" stopColor={t.accentHigh} />
        </linearGradient>
        <linearGradient id={ids.fill} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor={t.accent} />
          <stop offset="1" stopColor={t.accentHigh} />
        </linearGradient>
        <radialGradient id={ids.glow} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor={t.glow} stopOpacity={0.45} />
          <stop offset="0.6" stopColor={t.glow} stopOpacity={0.12} />
          <stop offset="1" stopColor={t.glow} stopOpacity={0} />
        </radialGradient>
        <radialGradient id={vignette} cx="0.5" cy="0.4" r="0.75">
          <stop offset="0" stopColor={t.surfaceTop} stopOpacity={0.9} />
          <stop offset="1" stopColor={t.canvas} stopOpacity={0} />
        </radialGradient>
        {/* Kenarlarda sönen kıl çizgi — yatay ayraçlar. */}
        <linearGradient id={ids.fade} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor={t.border} stopOpacity={0} />
          <stop offset="0.15" stopColor={t.border} stopOpacity={1} />
          <stop offset="0.85" stopColor={t.border} stopOpacity={1} />
          <stop offset="1" stopColor={t.border} stopOpacity={0} />
        </linearGradient>
      </defs>
      <rect x={0} y={0} width={1024} height={600} fill={`url(#${vignette})`} />
      {/* Tek enstrüman yüzeyi; derinlik ince kenar + üst ışık çizgisiyle, filtre yok. */}
      <rect x={24} y={88} width={976} height={366} rx={28} fill={`url(#${surfaceId})`} stroke={t.border} />
      <path d="M56 89H968" fill="none" stroke={t.edge} strokeLinecap="round" />
      <Horizon t={t} ids={ids} />
      <EngineZone rpm={state.rpm} redline={state.rpmRedline} coolant={state.coolantTempC} freshness={state.coolantFreshness} t={t} ids={ids} />
      <SpeedZone speed={state.speedKmh} limit={state.speedLimitKmh} definitive={state.speedLimitDefinitive}
        over={state.speedOverLimit === true} curve={state.curve ?? null} t={t} ids={ids} />
      <VehicleZone range={state.rangeKm} fuelLevel={state.fuelLevelPct} consumption={state.avgConsumptionL100} odometer={state.odometerKm} t={t} ids={ids} />
      {state.maneuver !== null ? <ManeuverZone {...state.maneuver} t={t} /> : (
        <g data-cockpit-navigation="unavailable">
          <text x={512} y={368} textAnchor="middle" fontSize={10} letterSpacing={2.5} fill={t.textSecondary}>NAVİGASYON</text>
          <text x={512} y={392} textAnchor="middle" fontSize={13} fill={t.muted}>Yönlendirme bilgisi yok</text>
        </g>
      )}
      <rect x={24} y={480} width={976} height={96} rx={22} fill={`url(#${ids.shelf})`} stroke={t.border} />
      <path d="M50 481H974" stroke={t.edge} strokeLinecap="round" />
      <line x1={658} y1={504} x2={658} y2={552} stroke={t.border} />
      <MediaZone {...state.media} t={t} onMediaPrevious={onMediaPrevious} onMediaToggle={onMediaToggle} onMediaNext={onMediaNext} />
      <DrivingZone gear={state.gear} driveMode={state.driveMode} t={t} />
      <TopBar time={clock.time} date={clock.date} ambient={state.ambientTempC} t={t} ids={ids} />
    </svg>
  );
});
