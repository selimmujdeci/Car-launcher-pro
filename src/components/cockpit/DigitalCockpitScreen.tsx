/**
 * CarOS Digital Cockpit — yalnız sunum. Veri/transport DigitalCockpitPage'den
 * gelir; HOME, navigation, media ve vehicle authority burada kurulmaz.
 * Tek SVG tuval + native medya düğmeleri; ölçüm/timer/animasyon döngüsü yok.
 */
import { memo, useId } from 'react';
import {
  COCKPIT_CANVAS, COCKPIT_REGIONS, COCKPIT_MIN_TOUCH_PX,
  COCKPIT_RPM_ARC_PATH, COCKPIT_TACHO_TICKS, cockpitTachoPoint,
  cockpitTokensFor, type CockpitTokens,
} from './cockpitLayout';
import {
  EM_DASH, fmtSpeed, fmtRpmThousands, fmtCoolant, fmtRange, fmtConsumption,
  fmtOdometer, fmtAmbient, fmtManeuverDistance, coolantFill, fuelFill, rpmFill,
  bandOrNull, COCKPIT_BANDS, type CockpitState, type CockpitManeuver,
} from './cockpitDataModel';
import '../../styles/fonts.css';
import './digitalCockpit.css';

type PaletteProps = { t: CockpitTokens };

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
      <path d="M320 450 Q512 400 704 450Z" fill={t.horizon} opacity={0.45} />
      <path d="M322 450 Q512 400 702 450 M368 450 Q512 419 656 450"
        fill="none" stroke={t.horizonLine} strokeWidth={1} />
      <path d="M419 450 Q512 437 605 450" fill="none" stroke={t.horizonLine} opacity={0.45} />
    </g>
  );
});

const EngineZone = memo(function EngineZone({ rpm, redline, coolant, freshness, t }: PaletteProps & {
  rpm: number | null; redline: number | null; coolant: number | null;
  freshness: CockpitState['coolantFreshness'];
}) {
  // 8000 yalnız skala tabanı; araçtan gelmeyen bir kırmızı bölge çizilmez.
  const scaleMax = Math.max(8000, bandOrNull(redline, COCKPIT_BANDS.rpm) ?? 8000);
  const fill = rpmFill(rpm, scaleMax);
  const tip = fill === null ? null : cockpitTachoPoint(fill, 94);
  const liveCoolant = freshness === 'LIVE' ? coolant : null;
  const cool = coolantFill(liveCoolant);
  return (
    <g data-cockpit-region="leftCluster">
      <text x={168} y={127} textAnchor="middle" className="caros-cockpit-eyebrow" fill={t.textSecondary}>MOTOR DEVRİ</text>
      <path d={COCKPIT_RPM_ARC_PATH} fill="none" stroke={t.track} strokeWidth={4} />
      {fill !== null && fill > 0 && (
        <path data-cockpit-rpm-fill="" d={COCKPIT_RPM_ARC_PATH} pathLength={100}
          fill="none" stroke={t.accent} strokeWidth={4} strokeDasharray={`${fill * 100} 100`} />
      )}
      {COCKPIT_TACHO_TICKS.map((tick, i) => (
        <g key={i}>
          <line x1={tick.inner.x} y1={tick.inner.y} x2={tick.outer.x} y2={tick.outer.y}
            stroke={tick.major ? t.textSecondary : t.track} strokeWidth={tick.major ? 1.5 : 1} />
          {tick.major && <text data-cockpit-scale="tacho" x={tick.label.x} y={tick.label.y + 4}
            textAnchor="middle" fontSize={11} fill={t.textSecondary}>{tick.fraction * scaleMax / 1000}</text>}
        </g>
      ))}
      {tip && <circle data-cockpit-rpm-marker="" cx={tip.x} cy={tip.y} r={4} fill={t.accent} />}
      <text data-cockpit-value="rpm" x={168} y={254} textAnchor="middle"
        fontSize={51} fontWeight={500} letterSpacing={-2} fill={t.textPrimary}>{fmtRpmThousands(rpm)}</text>
      <text x={168} y={278} textAnchor="middle" fontSize={12} fill={t.textSecondary}>×1000 rpm</text>

      <line x1={62} y1={324} x2={274} y2={324} stroke={t.border} />
      <text x={62} y={351} fontSize={13} fill={t.textSecondary}>Motor sıcaklığı</text>
      <text data-cockpit-value="coolant" x={274} y={378} textAnchor="end"
        fontSize={28} fontWeight={500} fill={t.textPrimary}>{fmtCoolant(liveCoolant)}</text>
      {freshness === 'STALE' && <text x={62} y={377} fontSize={11} fill={t.textSecondary}>Veri güncel değil</text>}
      <rect x={62} y={396} width={212} height={4} rx={2} fill={t.track} />
      {cool !== null && <rect data-cockpit-coolant-fill="" x={62} y={396} width={212 * cool} height={4} rx={2} fill={t.accent} />}
      <text x={62} y={418} fontSize={11} fill={t.textSecondary}>C</text>
      <text x={274} y={418} fontSize={11} textAnchor="end" fill={t.textSecondary}>H</text>
    </g>
  );
});

const SpeedZone = memo(function SpeedZone({ speed, limit, definitive, t }: PaletteProps & {
  speed: number | null; limit: number | null; definitive: boolean;
}) {
  const validLimit = bandOrNull(limit, COCKPIT_BANDS.speed);
  return (
    <g data-cockpit-region="speedCluster">
      <text x={512} y={134} textAnchor="middle" className="caros-cockpit-eyebrow" fill={t.textSecondary}>HIZ</text>
      <text data-cockpit-value="speed" x={512} y={270} textAnchor="middle"
        fontSize={150} fontWeight={500} letterSpacing={-7} fill={t.textPrimary}>{fmtSpeed(speed)}</text>
      <text x={512} y={301} textAnchor="middle" fontSize={16} fill={t.textSecondary}>km/h</text>
      {validLimit !== null && (
        <g data-cockpit-speedlimit={definitive ? 'definitive' : 'uncertain'}
          aria-label={`${definitive ? 'Hız sınırı' : 'Kesin olmayan hız sınırı'}: ${Math.round(validLimit)} km/h`}>
          <circle cx={638} cy={304} r={21} fill={t.sign} stroke={t.warningRed} strokeWidth={4}
            strokeDasharray={definitive ? undefined : '6 4'} />
          <text x={638} y={311} fontSize={validLimit >= 100 ? 17 : 20} textAnchor="middle"
            fontWeight={700} fill="#233239">{Math.round(validLimit)}</text>
        </g>
      )}
    </g>
  );
});

const VehicleZone = memo(function VehicleZone({ range, fuelLevel, consumption, odometer, t }: PaletteProps & {
  range: number | null; fuelLevel: number | null; consumption: number | null; odometer: number | null;
}) {
  const fuel = fuelFill(fuelLevel);
  return (
    <g data-cockpit-region="rightCluster">
      <text x={748} y={127} className="caros-cockpit-eyebrow" fill={t.textSecondary}>MENZİL</text>
      <text data-cockpit-value="range" x={748} y={210} fontSize={58} letterSpacing={-2}
        fontWeight={500} fill={t.textPrimary}>{fmtRange(range)}</text>
      <text x={962} y={210} textAnchor="end" fontSize={15} fill={t.textSecondary}>km</text>
      <text x={748} y={249} fontSize={13} fill={t.textSecondary}>Yakıt</text>
      <text data-cockpit-value="fuel" x={962} y={249} textAnchor="end" fontSize={15}
        fill={t.textPrimary}>{fuel === null ? EM_DASH : `%${Math.round(fuel * 100)}`}</text>
      <rect x={748} y={263} width={214} height={4} rx={2} fill={t.track} />
      {fuel !== null && <rect data-cockpit-fuel-fill="" x={748} y={263} width={214 * fuel} height={4} rx={2} fill={t.accent} />}
      <line x1={748} y1={293} x2={962} y2={293} stroke={t.border} />
      <text x={748} y={320} fontSize={13} fill={t.textSecondary}>Ort. tüketim</text>
      <text x={962} y={320} textAnchor="end" fontSize={10} fill={t.textSecondary}>Profil değeri</text>
      <text data-cockpit-value="consumption" x={748} y={349} fontSize={22} fontWeight={500}
        fill={t.textPrimary}>{fmtConsumption(consumption)}</text>
      <text x={748} y={389} fontSize={13} fill={t.textSecondary}>Toplam yol</text>
      <text data-cockpit-value="odometer" x={748} y={418} fontSize={22} fontWeight={500}
        fill={t.textPrimary}>{fmtOdometer(odometer)}</text>
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

const ManeuverZone = memo(function ManeuverZone({ distanceMeters, label, type, modifier, t }: PaletteProps & CockpitManeuver) {
  const path = maneuverIconPath(type, modifier);
  return (
    <g data-cockpit-region="maneuverBar">
      {path ? <path data-cockpit-maneuver-icon="" d={path} transform="translate(419 341) scale(.65)"
        fill="none" stroke={t.accent} strokeWidth={5} strokeLinecap="round" strokeLinejoin="round" />
        : <text data-cockpit-maneuver-unknown="" x={435} y={368} textAnchor="middle" fontSize={24} fill={t.textSecondary}>{EM_DASH}</text>}
      <text data-cockpit-value="maneuverDistance" x={464} y={370} fontSize={28} fontWeight={500}
        fill={t.textPrimary}>{fmtManeuverDistance(distanceMeters)}</text>
      <Copy x={COCKPIT_REGIONS.maneuverBar.x} y={386} width={COCKPIT_REGIONS.maneuverBar.w}
        color={t.textSecondary} center>{label ?? EM_DASH}</Copy>
    </g>
  );
});

const TransportButton = memo(function TransportButton({ label, path, onClick, disabled, primary, t }: PaletteProps & {
  label: string; path: string; onClick?: () => void; disabled: boolean; primary?: boolean;
}) {
  return (
    <button type="button" className="caros-cockpit-transport" aria-label={label} disabled={disabled || !onClick}
      onClick={onClick} style={{ width: COCKPIT_MIN_TOUCH_PX, height: COCKPIT_MIN_TOUCH_PX,
        color: primary ? t.canvas : t.textPrimary, background: primary ? t.accent : 'transparent',
        borderColor: primary ? t.accent : t.border }}>
      <svg width={22} height={22} viewBox="0 0 24 24" aria-hidden="true"><path d={path} fill="currentColor" /></svg>
    </button>
  );
});

const MediaZone = memo(function MediaZone({ title, artist, artworkUrl, playing, available, onMediaPrevious, onMediaToggle, onMediaNext, t }: PaletteProps &
  CockpitState['media'] & Pick<DigitalCockpitScreenProps, 'onMediaPrevious' | 'onMediaToggle' | 'onMediaNext'>) {
  return (
    <g data-cockpit-region="musicCard" data-no-page-swipe="">
      <rect x={40} y={496} width={64} height={64} rx={10} fill={t.accentSoft} />
      <path d="M67 520V541M67 521L85 517V537M67 526L85 522M67 539C59 535 56 545 62 546C67 548 68 543 67 539M85 535C77 531 74 541 80 542C85 544 86 539 85 535"
        fill="none" stroke={t.accent} strokeWidth={1.5} aria-hidden="true" />
      {artworkUrl !== null && <foreignObject x={40} y={496} width={64} height={64}>
        <img key={artworkUrl} className="caros-cockpit-art" src={artworkUrl} alt="Albüm kapağı" width={64} height={64}
          decoding="async" onError={(event) => { event.currentTarget.style.visibility = 'hidden'; }} />
      </foreignObject>}
      <text x={120} y={505} fontSize={10} letterSpacing={1.5} fill={t.textSecondary}>MEDYA</text>
      <Copy x={120} y={511} width={282} size={17} weight={600} color={t.textPrimary}>{title ?? EM_DASH}</Copy>
      <Copy x={120} y={536} width={282} size={13} color={t.textSecondary}>{artist ?? EM_DASH}</Copy>
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

const DrivingZone = memo(function DrivingZone({ gear, driveMode, t }: PaletteProps & Pick<CockpitState, 'gear' | 'driveMode'>) {
  return (
    <g data-cockpit-region="assistCard">
      <text x={706} y={513} textAnchor="middle" fontSize={10} letterSpacing={1.5} fill={t.textSecondary}>VİTES</text>
      <text data-cockpit-value="gear" x={706} y={546} textAnchor="middle" fontSize={26}
        fontWeight={500} fill={t.textPrimary}>{gear ?? EM_DASH}</text>
      <line x1={748} y1={506} x2={748} y2={550} stroke={t.border} />
      <text x={774} y={513} fontSize={10} letterSpacing={1.5} fill={t.textSecondary}>SÜRÜŞ TERCİHİ</text>
      <text data-cockpit-value="driveMode" x={774} y={543} fontSize={18} fontWeight={500}
        fill={t.textPrimary}>{driveMode ?? EM_DASH}</text>
    </g>
  );
});

const TopBar = memo(function TopBar({ time, date, ambient, t }: PaletteProps & {
  time: string; date: string; ambient: number | null;
}) {
  return (
    <g data-cockpit-region="topBar">
      <text x={32} y={39} fontSize={18} fontWeight={600} letterSpacing={3} fill={t.textPrimary}>CAROS</text>
      <text x={118} y={39} fontSize={10} fontWeight={600} letterSpacing={1.5} fill={t.detail}>PRO</text>
      <line x1={172} y1={23} x2={172} y2={44} stroke={t.border} />
      <text x={195} y={38} fontSize={12} fill={t.textSecondary}>Dış ortam</text>
      <text data-cockpit-value="ambient" x={267} y={39} fontSize={16} fill={t.textPrimary}>{fmtAmbient(ambient)}</text>
      <Copy x={652} y={23} width={196} size={12} color={t.textSecondary}>{date}</Copy>
      <text x={990} y={41} textAnchor="end" fontSize={24} fontWeight={500} fill={t.textPrimary}>{time}</text>
      <line x1={32} y1={66} x2={992} y2={66} stroke={t.border} />
      <line x1={32} y1={66} x2={96} y2={66} stroke={t.detail} strokeWidth={2} />
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
  const surfaceId = `cockpit-surface-${useId().replace(/:/g, '')}`;
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
      </defs>
      {/* Tek instrument yüzeyi; derinlik ince kenarlarla, filtre kullanmadan. */}
      <rect x={24} y={91} width={976} height={366} rx={24} fill={t.border} />
      <rect x={24} y={88} width={976} height={366} rx={24} fill={`url(#${surfaceId})`} stroke={t.border} />
      <path d="M48 89H976" fill="none" stroke={t.edge} />
      <path d="M310 147Q332 276 310 416M714 147Q692 276 714 416"
        fill="none" stroke={t.border} />
      <Horizon t={t} />
      <EngineZone rpm={state.rpm} redline={state.rpmRedline} coolant={state.coolantTempC} freshness={state.coolantFreshness} t={t} />
      <SpeedZone speed={state.speedKmh} limit={state.speedLimitKmh} definitive={state.speedLimitDefinitive} t={t} />
      <VehicleZone range={state.rangeKm} fuelLevel={state.fuelLevelPct} consumption={state.avgConsumptionL100} odometer={state.odometerKm} t={t} />
      {state.maneuver !== null ? <ManeuverZone {...state.maneuver} t={t} /> : (
        <g data-cockpit-navigation="unavailable">
          <text x={512} y={364} textAnchor="middle" fontSize={11} letterSpacing={2} fill={t.textSecondary}>NAVİGASYON</text>
          <text x={512} y={393} textAnchor="middle" fontSize={14} fill={t.textSecondary}>Yönlendirme bilgisi yok</text>
        </g>
      )}
      <rect x={24} y={480} width={976} height={96} rx={18} fill={t.shelf} stroke={t.border} />
      <path d="M42 481H982" stroke={t.edge} />
      <line x1={658} y1={501} x2={658} y2={555} stroke={t.border} />
      <MediaZone {...state.media} t={t} onMediaPrevious={onMediaPrevious} onMediaToggle={onMediaToggle} onMediaNext={onMediaNext} />
      <DrivingZone gear={state.gear} driveMode={state.driveMode} t={t} />
      <TopBar time={clock.time} date={clock.date} ambient={state.ambientTempC} t={t} />
    </svg>
  );
});
