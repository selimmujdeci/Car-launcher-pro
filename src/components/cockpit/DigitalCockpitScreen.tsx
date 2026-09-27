/**
 * CarOS Digital Cockpit — yalnız sunum. Veri/transport DigitalCockpitPage'den
 * gelir; HOME, navigation, media ve vehicle authority burada kurulmaz.
 * Tek SVG tuval; ölçüm/timer/animasyon döngüsü yok.
 *
 * Görsel dil (2026-09-26, kullanıcı referansı "birebir"): solda kahraman hız
 * kadranı, sağda devir, ortada perspektif yol + kendi aracımız (DEKORASYON —
 * şerit/araç algılama İDDİASI YOK, başka araç çizilmez), üstte sıradaki dönüş,
 * altta menzil · kilometre · müzik satırı.
 *
 * Tasarım 1280×720 referans koordinatlarında yazılır ve 1024×600 tuvale tek
 * `scale(0.8)` ile oturur (daire/yazı bozulmaz).
 *
 * FAIL-CLOSED: ekran HER ZAMAN dolu (kullanıcı kararı 2026-09-27: "ekran boş
 * olmasın, veri gelince dolsun"). Ölçülmemiş değer "—" yazılır, ibre/dolgu
 * çizilmez; "0" YAZILMAZ (motor çalışırken 0 devir, yakıt varken 0 km menzil
 * sürücüyü yanıltır). Sahte 0/değer ÜRETİLMEZ. Kırmızı bölge yalnız araçtan gelen devir
 * sınırıyla çizilir. Işıma SVG filtresiyle DEĞİL, katmanlı çizgilerle (zayıf GPU).
 */
import { memo, useId } from 'react';
import {
  COCKPIT_CANVAS, COCKPIT_MIN_TOUCH_PX, COCKPIT_DESIGN_SCALE as DESIGN_SCALE, COCKPIT_DESIGN_OFFSET_Y as DESIGN_OFFSET_Y,
  cockpitTokensFor, type CockpitTokens,
} from './cockpitLayout';
import {
  EM_DASH, fmtSpeed, fmtCoolant, fmtRange, fmtConsumption, fmtOdometer, fmtAmbient,
  fmtManeuverDistance, coolantFill, fuelFill, rpmFill, bandOrNull, COCKPIT_BANDS,
  type CockpitState, type CockpitManeuver,
} from './cockpitDataModel';
import carRearUrl from '../../assets/cockpit/car-rear.webp';
import '../../styles/fonts.css';
import './digitalCockpit.css';

interface Ids { ring: string; lane: string; edge: string; floor: string; bg: string; shadow: string }
type PaletteProps = { t: CockpitTokens; ids: Ids };

/* ── Kutupsal geometri (saf, modül yüklenirken bir kez) ─────────────────── */
const rad = (deg: number) => (deg * Math.PI) / 180;
const polar = (cx: number, cy: number, r: number, deg: number) =>
  ({ x: +(cx + Math.cos(rad(deg)) * r).toFixed(2), y: +(cy + Math.sin(rad(deg)) * r).toFixed(2) });
function arcPath(cx: number, cy: number, r: number, from: number, sweep: number): string {
  const a = polar(cx, cy, r, from);
  const b = polar(cx, cy, r, from + sweep);
  return `M${a.x} ${a.y} A${r} ${r} 0 ${sweep > 180 ? 1 : 0} 1 ${b.x} ${b.y}`;
}

/* Kadranlar: alt kısmı açık 240° yay, r=150. */
const DIAL_FROM = 150;
const DIAL_SWEEP = 240;
const DIAL_R = 150;
const SPEED_C = { x: 224, y: 300 };
const RPM_C = { x: 1056, y: 300 };
const SPEED_MAX = 240;
const SPEED_ARC = arcPath(SPEED_C.x, SPEED_C.y, DIAL_R, DIAL_FROM, DIAL_SWEEP);
const RPM_ARC = arcPath(RPM_C.x, RPM_C.y, DIAL_R, DIAL_FROM, DIAL_SWEEP);
const SPEED_LABELS = Object.freeze([0, 40, 80, 120, 160, 200, 240].map((v) =>
  ({ v, p: polar(SPEED_C.x, SPEED_C.y, 124, DIAL_FROM + (DIAL_SWEEP * v) / SPEED_MAX) })));

/** Uzun başlıkları ölçüm/timer olmadan sınırlar; tam metin erişilebilir kalır. */
function Copy({ x, y, width, height = 26, children, size = 18, weight = 400, color, center = false }: {
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

/**
 * Yol + kendi aracımız — YALNIZ DEKORASYON: şerit, rota, trafik ya da algılanmış
 * araç DEĞİLDİR (ADAS sinyali yok). Başka araç çizilmez.
 */
const DecorativeRoad = memo(function DecorativeRoad({ ids }: { ids: Ids }) {
  return (
    <g data-cockpit-region="roadScene" data-cockpit-decoration="abstract-horizon" aria-hidden="true" pointerEvents="none">
      <polygon points="600,250 680,250 1010,720 270,720" fill={`url(#${ids.floor})`} />
      <polygon points="618,300 662,300 820,720 460,720" fill={`url(#${ids.lane})`} />
      <line x1={618} y1={300} x2={460} y2={720} stroke={`url(#${ids.edge})`} strokeWidth={5} />
      <line x1={662} y1={300} x2={820} y2={720} stroke={`url(#${ids.edge})`} strokeWidth={5} />
      <g stroke="#9fb0c8" strokeOpacity={0.35} strokeWidth={3} strokeDasharray="26 30">
        <line x1={596} y1={270} x2={330} y2={720} />
        <line x1={684} y1={270} x2={950} y2={720} />
      </g>
      <g stroke="#5fb4ff" strokeOpacity={0.22} strokeWidth={2}>
        <line x1={566} y1={420} x2={714} y2={420} />
        <line x1={540} y1={500} x2={740} y2={500} />
      </g>
      <ellipse cx={640} cy={640} rx={140} ry={20} fill={`url(#${ids.shadow})`} />
      <image href={carRearUrl} x={515} y={452} width={250} height={204} preserveAspectRatio="xMidYMid meet" />
    </g>
  );
});

const SpeedZone = memo(function SpeedZone({ speed, limit, definitive, over, curve, t, ids }: PaletteProps & {
  speed: number | null; limit: number | null; definitive: boolean; over: boolean;
  curve: CockpitState['curve'];
}) {
  const validLimit = bandOrNull(limit, COCKPIT_BANDS.speed);
  const validSpeed = bandOrNull(speed, COCKPIT_BANDS.speed);
  const fill = validSpeed === null ? null : Math.min(1, Math.max(0, validSpeed / SPEED_MAX));
  const dash = fill === null ? null : `${fill * 100} 100`;
  const speedText = fmtSpeed(speed);
  return (
    <g data-cockpit-region="speedCluster">
      <path d={SPEED_ARC} fill="none" stroke={t.track} strokeWidth={10} strokeLinecap="round" />
      {dash !== null && fill !== null && fill > 0 && (
        <g data-cockpit-speed-fill="">
          <path d={SPEED_ARC} pathLength={100} fill="none" stroke={t.glow} strokeWidth={22}
            strokeLinecap="round" strokeDasharray={dash} opacity={0.3} />
          <path d={SPEED_ARC} pathLength={100} fill="none" stroke={`url(#${ids.ring})`} strokeWidth={8}
            strokeLinecap="round" strokeDasharray={dash} />
        </g>
      )}
      {SPEED_LABELS.map(({ v, p }) => (
        <text key={v} data-cockpit-scale="speed" x={p.x} y={p.y + 6} textAnchor="middle" fontSize={17}
          fill={t.muted}>{v}</text>
      ))}
      <text data-cockpit-value="speed" x={224} y={344} textAnchor="middle" className="caros-cockpit-numeral"
        fontSize={132} fontWeight={300} letterSpacing={-6}
        fill={over ? t.warningRed : speedText === EM_DASH ? t.muted : t.textPrimary}>{speedText}</text>
      <text x={224} y={380} textAnchor="middle" fontSize={20} letterSpacing={1} fill={t.textSecondary}>km/h</text>
      {validLimit !== null && (
        /* Aşımda levha KIRMIZIYA döner — karar veri katmanında (overspeedModel). */
        <g data-cockpit-speedlimit={definitive ? 'definitive' : 'uncertain'}
          data-cockpit-overspeed={over ? 'true' : undefined}
          aria-label={`${definitive ? 'Hız sınırı' : 'Kesin olmayan hız sınırı'}: ${Math.round(validLimit)} km/h`}>
          <circle cx={362} cy={442} r={28} fill={over ? t.warningRed : t.sign} stroke={t.warningRed} strokeWidth={8}
            strokeDasharray={definitive ? undefined : '8 5'} />
          <text x={362} y={451} fontSize={validLimit >= 100 ? 22 : 26} textAnchor="middle"
            fontWeight={800} fill={over ? '#ffffff' : '#111'}>{Math.round(validLimit)}</text>
        </g>
      )}
      {curve && (
        /* Öndeki viraj — hız sınırı levhasının yanında sarı uyarı levhası. */
        <g data-cockpit-curve={curve.direction}
          aria-label={`${curve.direction === 'right' ? 'Sağa' : 'Sola'} viraj, önerilen ${curve.advisoryKmh} km/h`}>
          <rect x={80} y={426} width={36} height={36} rx={5} transform="rotate(45 98 444)"
            fill="#FFC107" stroke={validSpeed !== null && validSpeed > curve.advisoryKmh + 5 ? t.warningRed : '#1f2937'}
            strokeWidth={validSpeed !== null && validSpeed > curve.advisoryKmh + 5 ? 4 : 2} />
          <text x={98} y={452} fontSize={curve.advisoryKmh >= 100 ? 17 : 20} textAnchor="middle"
            fontWeight={800} fill="#111">{curve.advisoryKmh}</text>
          <text x={98} y={496} fontSize={13} textAnchor="middle" fill={t.textSecondary}>
            {`${curve.direction === 'right' ? 'SAĞ VİRAJ' : 'SOL VİRAJ'}${curve.distanceM >= 50 ? ` · ${Math.round(curve.distanceM / 50) * 50} m` : ''}`}</text>
        </g>
      )}
    </g>
  );
});

/** Devir kadranı — her zaman çizilir; devir bilinmiyorsa "—", ibre/dolgu yok. */
const EngineZone = memo(function EngineZone({ rpm, redline, gear, t, ids }: PaletteProps & {
  rpm: number | null; redline: number | null; gear: string | null;
}) {
  // 8000 yalnız skala tabanı; kırmızı bölge YALNIZ araçtan gelen sınırla çizilir.
  const knownRedline = bandOrNull(redline, COCKPIT_BANDS.rpm);
  const scaleMax = Math.max(8000, knownRedline ?? 8000);
  const redFrac = knownRedline !== null && knownRedline < scaleMax ? knownRedline / scaleMax : null;
  const fill = rpmFill(rpm, scaleMax);
  const tip = fill === null ? null : polar(RPM_C.x, RPM_C.y, DIAL_R, DIAL_FROM + DIAL_SWEEP * fill);
  const validRpm = bandOrNull(rpm, COCKPIT_BANDS.rpm);
  const rpmText = validRpm === null ? EM_DASH : Math.round(validRpm).toLocaleString('tr-TR');
  const labels = Array.from({ length: scaleMax / 1000 + 1 }, (_, i) =>
    ({ v: i, p: polar(RPM_C.x, RPM_C.y, 124, DIAL_FROM + (DIAL_SWEEP * i * 1000) / scaleMax) }));
  const redArc = redFrac !== null
    ? arcPath(RPM_C.x, RPM_C.y, DIAL_R, DIAL_FROM + DIAL_SWEEP * redFrac, DIAL_SWEEP * (1 - redFrac)) : null;
  const dash = fill === null ? null : `${fill * 100} 100`;
  return (
    <g data-cockpit-region="rightCluster">
      <path d={RPM_ARC} fill="none" stroke={t.track} strokeWidth={10} strokeLinecap="round" />
      {redArc && <path d={redArc} fill="none" stroke={t.warningRed} strokeWidth={8} strokeLinecap="round" opacity={0.9} />}
      {dash !== null && fill !== null && fill > 0 && (
        <path data-cockpit-rpm-fill="" d={RPM_ARC} pathLength={100} fill="none" stroke={`url(#${ids.ring})`}
          strokeWidth={8} strokeLinecap="round" strokeDasharray={dash} />
      )}
      {tip && <circle data-cockpit-rpm-marker="" cx={tip.x} cy={tip.y} r={6} fill={t.textPrimary} />}
      {labels.map(({ v, p }) => (
        <text key={v} data-cockpit-scale="tacho" x={p.x} y={p.y + 6} textAnchor="middle" fontSize={17}
          fill={t.muted}>{v}</text>
      ))}
      <text data-cockpit-value="rpm" x={1056} y={312} textAnchor="middle" className="caros-cockpit-numeral"
        fontSize={56} fontWeight={300} letterSpacing={-2} fill={rpmText === EM_DASH ? t.muted : t.textPrimary}>{rpmText}</text>
      <text x={1056} y={340} textAnchor="middle" fontSize={17} fill={t.textSecondary}>rpm</text>
      {gear && (
        <text data-cockpit-value="gear" x={1056} y={404} textAnchor="middle" className="caros-cockpit-numeral"
          fontSize={44} fontWeight={600} fill={t.accentHigh}>{gear}</text>
      )}
    </g>
  );
});

/* Küçük yarım kadranlar (alt köşeler): üstte 180° yay, r=58. */
const MINI_R = 58;
const MINI_ARC = (cx: number, cy: number) => arcPath(cx, cy, MINI_R, 180, 180);

/** Menzil + yakıt kadranı (sol alt) — yakıt yayı, ortada menzil; bilinmiyorsa "—", yay boş. */
const RangeZone = memo(function RangeZone({ range, fuelLevel, consumption, t, ids }: PaletteProps & {
  range: number | null; fuelLevel: number | null; consumption: number | null;
}) {
  const cx = 150; const cy = 650;
  const fuel = fuelFill(fuelLevel);
  const rangeText = fmtRange(range);
  const consText = fmtConsumption(consumption);
  const arc = MINI_ARC(cx, cy);
  const tip = fuel === null ? null : polar(cx, cy, MINI_R, 180 + 180 * fuel);
  return (
    <g data-cockpit-region="leftCluster">
      <path d={arc} fill="none" stroke={t.track} strokeWidth={8} strokeLinecap="round" />
      {fuel !== null && (
        <path data-cockpit-fuel-fill={Math.round(fuel * 100)} d={arc} pathLength={100} fill="none" strokeWidth={8}
          strokeLinecap="round" strokeDasharray={`${fuel * 100} 100`} opacity={fuel > 0 ? 1 : 0}
          stroke={fuel < 0.15 ? t.warningRed : `url(#${ids.ring})`} />
      )}
      {tip && <circle cx={tip.x} cy={tip.y} r={5} fill={t.textPrimary} />}
      <text x={cx - MINI_R} y={cy + 24} textAnchor="middle" fontSize={14} fill={t.muted}>E</text>
      <text x={cx + MINI_R} y={cy + 24} textAnchor="middle" fontSize={14} fill={t.muted}>F</text>
      <text data-cockpit-value="range" x={cx} y={cy - 8} textAnchor="middle" fontSize={26} fontWeight={600}
        className="caros-cockpit-numeral" fill={rangeText === EM_DASH ? t.muted : t.textPrimary}>{rangeText}</text>
      <text x={cx} y={cy + 14} textAnchor="middle" fontSize={14} fill={t.textSecondary}>km menzil</text>
      {fuel !== null && (
        <text data-cockpit-value="fuel" x={cx + MINI_R + 18} y={cy - 36} fontSize={15} fontWeight={600}
          className="caros-cockpit-numeral" fill={t.textSecondary}>{`%${Math.round(fuel * 100)}`}</text>
      )}
      {consumption !== null && consText !== EM_DASH && (
        <text data-cockpit-value="consumption" x={cx} y={cy + 44} textAnchor="middle" fontSize={13}
          className="caros-cockpit-numeral" fill={t.textSecondary}>{`Ort. ${consText}`}</text>
      )}
    </g>
  );
});

/** Motor sıcaklığı kadranı (sağ alt, kilometrenin solunda) — yalnız CANLI ölçüm; bayatsa "—" + not. */
const CoolantDial = memo(function CoolantDial({ coolant, freshness, t, ids }: PaletteProps & {
  coolant: number | null; freshness: CockpitState['coolantFreshness'];
}) {
  const cx = 1130; const cy = 650;
  const live = freshness === 'LIVE' ? coolant : null;
  const cool = coolantFill(live);
  const text = fmtCoolant(live);
  const arc = MINI_ARC(cx, cy);
  const tip = cool === null ? null : polar(cx, cy, MINI_R, 180 + 180 * cool);
  return (
    <g data-cockpit-coolant="">
      <path d={arc} fill="none" stroke={t.track} strokeWidth={8} strokeLinecap="round" />
      <path d={arcPath(cx, cy, MINI_R, 180 + 180 * 0.85, 180 * 0.15)} fill="none" stroke={t.warningRed}
        strokeWidth={8} strokeLinecap="round" opacity={0.55} />
      {cool !== null && (
        <path data-cockpit-coolant-fill={Math.round(cool * 100)} d={arc} pathLength={100} fill="none"
          stroke={`url(#${ids.ring})`} strokeWidth={8} strokeLinecap="round"
          strokeDasharray={`${cool * 100} 100`} opacity={cool > 0 ? 1 : 0} />
      )}
      {tip && <circle cx={tip.x} cy={tip.y} r={5} fill={t.textPrimary} />}
      <text x={cx - MINI_R} y={cy + 24} textAnchor="middle" fontSize={14} fill={t.muted}>C</text>
      <text x={cx + MINI_R} y={cy + 24} textAnchor="middle" fontSize={14} fill={t.muted}>H</text>
      <text data-cockpit-value="coolant" x={cx} y={cy - 8} textAnchor="middle" fontSize={26} fontWeight={600}
        className="caros-cockpit-numeral" fill={text === EM_DASH ? t.muted : t.textPrimary}>{text}</text>
      <text x={cx} y={cy + 14} textAnchor="middle" fontSize={14} fill={t.textSecondary}>
        {freshness === 'STALE' ? 'Veri güncel değil' : 'Motor'}</text>
    </g>
  );
});

/** Kilometre + sürüş modu (sağ alt) — kilometre her zaman ("— km"), mod yalnız ölçülürse. */
const OdoZone = memo(function OdoZone({ odometer, driveMode, t }: Omit<PaletteProps, 'ids'> & {
  odometer: number | null; driveMode: string | null;
}) {
  const odoText = fmtOdometer(odometer);
  return (
    <g data-cockpit-region="assistCard">
      {driveMode && (
        <text data-cockpit-value="driveMode" x={1216} y={96} textAnchor="end" fontSize={16} fontWeight={700}
          letterSpacing={2} fill={t.accentHigh}>{driveMode}</text>
      )}
      <text data-cockpit-value="odometer" x={1216} y={560} textAnchor="end" fontSize={20} fontWeight={600}
        className="caros-cockpit-numeral" fill={odoText === EM_DASH ? t.muted : t.textPrimary}>
        {odoText === EM_DASH ? `${EM_DASH} km` : odoText}</text>
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

/** Üst orta dönüş kartı — navigasyon yoksa HİÇ çizilmez. */
const ManeuverZone = memo(function ManeuverZone({ distanceMeters, label, type, modifier, roundaboutExit, then, t }: Omit<PaletteProps, 'ids'> & CockpitManeuver) {
  const imminent = distanceMeters !== null && distanceMeters <= MANEUVER_IMMINENT_M;
  const known = hasGlyph(type, modifier, roundaboutExit);
  const thenKnown = then ? hasGlyph(then.type, then.modifier, null) : false;
  const exitLabel = ROUNDABOUT_TYPES.has(type ?? '') && typeof roundaboutExit === 'number' && roundaboutExit > 0
    ? `${roundaboutExit}. çıkış` : null;
  const caption = [exitLabel, label].filter(Boolean).join(' · ') || EM_DASH;
  const ink = imminent ? t.canvas : t.textPrimary;
  return (
    <g data-cockpit-region="maneuverBar" data-cockpit-maneuver-imminent={imminent ? 'true' : undefined}>
      <rect x={470} y={14} width={340} height={96} rx={18}
        fill={imminent ? t.accent : t.accentSoft} fillOpacity={imminent ? 1 : 0.55}
        stroke={imminent ? t.accentHigh : t.accent} strokeOpacity={imminent ? 1 : 0.45} />
      {known
        ? <ManeuverGlyph type={type} modifier={modifier} exit={roundaboutExit} cx={516} cy={62}
            size={ROUNDABOUT_TYPES.has(type ?? '') ? 50 : 44} color={ink} />
        : <text data-cockpit-maneuver-unknown="" x={516} y={72} textAnchor="middle" fontSize={30} fill={imminent ? t.canvas : t.muted}>{EM_DASH}</text>}
      <text data-cockpit-value="maneuverDistance" x={556} y={62} fontSize={38} fontWeight={700} letterSpacing={-0.5}
        className="caros-cockpit-numeral" fill={ink}>{fmtManeuverDistance(distanceMeters)}</text>
      <Copy x={556} y={70} width={then && thenKnown ? 180 : 236} size={18} color={imminent ? t.canvas : t.textSecondary}>{caption}</Copy>
      {then && thenKnown && (
        <g data-cockpit-maneuver-then="">
          <text x={772} y={44} textAnchor="middle" fontSize={11} letterSpacing={1} fill={imminent ? t.canvas : t.textSecondary}>ARDINDAN</text>
          <ManeuverGlyph type={then.type} modifier={then.modifier} exit={null} cx={772} cy={72} size={28}
            color={imminent ? t.canvas : t.accentHigh} />
        </g>
      )}
    </g>
  );
});

/** Rota yokken üst kart — ESKİ adım GÖSTERİLMEZ, yalnız durum söylenir. */
const NoRouteCard = memo(function NoRouteCard({ t }: Omit<PaletteProps, 'ids'>) {
  return (
    <g data-cockpit-navigation="unavailable">
      <rect x={530} y={26} width={220} height={60} rx={16} fill={t.accentSoft} fillOpacity={0.35}
        stroke={t.border} />
      <text x={640} y={64} textAnchor="middle" fontSize={20} fill={t.muted}>Rota yok</text>
    </g>
  );
});

/** Alt orta müzik satırı — dokununca çal/duraklat (tek büyük dokunma hedefi). */
const MediaZone = memo(function MediaZone({ title, artist, playing, available, onMediaToggle, t }: Omit<PaletteProps, 'ids'> &
  CockpitState['media'] & Pick<DigitalCockpitScreenProps, 'onMediaToggle'>) {
  // Dokunma hedefi gerçek ekranda ≥56 px: tasarım ölçeği (0.8) telafi edilir.
  const hIdle = Math.ceil(COCKPIT_MIN_TOUCH_PX / DESIGN_SCALE);
  if (!title) {
    return (
      <g data-cockpit-media="idle">
        <text x={640} y={720 - hIdle / 2 + 6} textAnchor="middle" fontSize={18} fill={t.muted}>Müzik çalmıyor</text>
      </g>
    );
  }
  const line = artist ? `${title} · ${artist}` : title;
  // Dokunma hedefi gerçek ekranda ≥56 px: tasarım ölçeği (0.8) telafi edilir.
  const h = Math.ceil(COCKPIT_MIN_TOUCH_PX / DESIGN_SCALE);
  return (
    <g data-cockpit-region="musicCard" data-no-page-swipe="">
      <foreignObject x={430} y={720 - h} width={420} height={h}>
        <button type="button" className="caros-cockpit-media-line"
          aria-label={playing ? `Duraklat: ${line}` : `Çal: ${line}`}
          disabled={!available || !onMediaToggle} onClick={onMediaToggle}
          style={{ width: 420, height: h, color: t.textSecondary }}>
          <span className="caros-cockpit-media-dot" style={{ background: playing ? t.accentHigh : t.muted }} />
          <span data-cockpit-copy="" className="caros-cockpit-media-text">
            <b style={{ color: t.textPrimary }}>{title}</b>{artist ? ` · ${artist}` : ''}
          </span>
        </button>
      </foreignObject>
    </g>
  );
});

const TopBar = memo(function TopBar({ time, ambient, t }: Omit<PaletteProps, 'ids'> & { time: string; ambient: number | null }) {
  const ambText = fmtAmbient(ambient);
  return (
    <g data-cockpit-region="topBar">
      <text x={64} y={46} fontSize={22} fontWeight={500} className="caros-cockpit-numeral" fill={t.textSecondary}>{time}</text>
      <text data-cockpit-value="ambient" x={1216} y={46} textAnchor="end" fontSize={22} fontWeight={500}
        fill={ambText === EM_DASH ? t.muted : t.textSecondary}>{ambText === EM_DASH ? `${EM_DASH}°C` : ambText}</text>
    </g>
  );
});

export interface DigitalCockpitScreenProps {
  readonly state: CockpitState;
  readonly mode: 'day' | 'night';
  readonly clock: { readonly time: string; readonly date: string };
  /** Geriye uyum: gösterge ekranında transport tek dokunuştur (çal/duraklat). */
  readonly onMediaPrevious?: () => void;
  readonly onMediaToggle?: () => void;
  readonly onMediaNext?: () => void;
}

export const DigitalCockpitScreen = memo(function DigitalCockpitScreen({
  state, mode, clock, onMediaToggle,
}: DigitalCockpitScreenProps) {
  const t = cockpitTokensFor(mode);
  const base = `cockpit-${useId().replace(/:/g, '')}`;
  const ids: Ids = {
    ring: `${base}-ring`, lane: `${base}-lane`, edge: `${base}-edge`,
    floor: `${base}-floor`, bg: `${base}-bg`, shadow: `${base}-shadow`,
  };
  return (
    <svg data-caros-cockpit="screen" data-cockpit-mode={mode} className="caros-cockpit-screen"
      width="100%" height="100%" viewBox={`0 0 ${COCKPIT_CANVAS.width} ${COCKPIT_CANVAS.height}`}
      preserveAspectRatio="xMidYMid meet" style={{ background: t.canvas }}
      role="group" aria-label="Araç gösterge ekranı">
      <defs>
        <radialGradient id={ids.bg} cx="0.5" cy="0.58" r="0.62">
          <stop offset="0" stopColor={t.surfaceTop} />
          <stop offset="0.55" stopColor={t.surfaceBottom} />
          <stop offset="1" stopColor={t.canvas} />
        </radialGradient>
        <linearGradient id={ids.ring} x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor={t.accent} />
          <stop offset="1" stopColor={t.accentHigh} />
        </linearGradient>
        <linearGradient id={ids.floor} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={t.horizon} stopOpacity={0} />
          <stop offset="0.35" stopColor={t.horizon} stopOpacity={0.85} />
          <stop offset="1" stopColor={t.horizonLine} />
        </linearGradient>
        <linearGradient id={ids.lane} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={t.accent} stopOpacity={0} />
          <stop offset="0.6" stopColor={t.accent} stopOpacity={0.3} />
          <stop offset="1" stopColor={t.accent} stopOpacity={0.55} />
        </linearGradient>
        <linearGradient id={ids.edge} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={t.accentHigh} stopOpacity={0} />
          <stop offset="1" stopColor={t.accentHigh} stopOpacity={0.95} />
        </linearGradient>
        <radialGradient id={ids.shadow} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#000" stopOpacity={0.75} />
          <stop offset="1" stopColor="#000" stopOpacity={0} />
        </radialGradient>
      </defs>
      <rect x={0} y={0} width={COCKPIT_CANVAS.width} height={COCKPIT_CANVAS.height} fill={`url(#${ids.bg})`} />
      <g transform={`translate(0 ${DESIGN_OFFSET_Y}) scale(${DESIGN_SCALE})`}>
        <DecorativeRoad ids={ids} />
        <SpeedZone speed={state.speedKmh} limit={state.speedLimitKmh} definitive={state.speedLimitDefinitive}
          over={state.speedOverLimit === true} curve={state.curve ?? null} t={t} ids={ids} />
        <EngineZone rpm={state.rpm} redline={state.rpmRedline} gear={state.gear} t={t} ids={ids} />
        <CoolantDial coolant={state.coolantTempC} freshness={state.coolantFreshness} t={t} ids={ids} />
        {state.maneuver !== null ? <ManeuverZone {...state.maneuver} t={t} /> : <NoRouteCard t={t} />}
        <RangeZone range={state.rangeKm} fuelLevel={state.fuelLevelPct} consumption={state.avgConsumptionL100} t={t} ids={ids} />
        <OdoZone odometer={state.odometerKm} driveMode={state.driveMode} t={t} />
        <MediaZone {...state.media} t={t} onMediaToggle={onMediaToggle} />
        <TopBar time={clock.time} ambient={state.ambientTempC} t={t} />
      </g>
    </svg>
  );
});
