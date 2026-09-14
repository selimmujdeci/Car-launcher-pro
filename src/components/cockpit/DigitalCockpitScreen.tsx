/**
 * DigitalCockpitScreen — CarOS Digital Cockpit / Araç Gösterge sayfası.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── BU EKRAN HOME DEĞİLDİR ────────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * HOME (`NewHomeLayout` + tema layout'ları) bu turda HİÇ DEĞİŞTİRİLMEDİ.
 * Burası yalnız yatay kaydırmayla açılan KOMŞU bir sayfadır; kendi dock'u,
 * kendi menüsü, kendi uygulama kısayolu YOKTUR ve olmayacaktır.
 *
 * ── NEDEN TEK BİR SVG ─────────────────────────────────────────────────────
 * Geometri otoritesi `cockpit.layout.json` + `cockpit-ui-overlay.svg`tir ve
 * oradaki koordinatlar BASELINE tabanlı SVG koordinatlarıdır. Aynı ekranı
 * HTML kutularıyla kurmak, her metin için "gözle yaklaştırılmış" bir üst/alt
 * boşluk yazmak demekti — yani tam da paketin yasakladığı şey. Tek bir
 * `viewBox="0 0 1648 928"` SVG'si kullanınca referans x/y değerleri AYNEN
 * yazılabiliyor ve `preserveAspectRatio="xMidYMid meet"` paketin ölçekleme
 * formülünü (`s = min(vw/1648, vh/928)`, ortalanmış) tarayıcı seviyesinde
 * BİREBİR uyguluyor — JS ölçüm/resize dinleyicisi GEREKMİYOR.
 *
 * Etkileşimli öğeler (müzik transportu) SVG içinde `<g>` + görünmez dokunma
 * dikdörtgeni olarak durur; ikinci bir HTML katmanı hizalanmaya çalışmaz.
 *
 * ── DEĞER ÜRETMEZ ─────────────────────────────────────────────────────────
 * Bu bileşen SUNUMDUR. Tüm sayılar `CockpitState`ten gelir; ölçülmemiş alan
 * `—` çizer. Hiçbir yerde `?? 0` YOKTUR.
 *
 * ── PLATFORM BAĞIMSIZ (bilinçli) ──────────────────────────────────────────
 * Bu dosya HİÇBİR platform servisini import ETMEZ (store · obdService ·
 * routingService · mediaService yok). Bağlama işi `DigitalCockpitPage.tsx`
 * dosyasındadır. Ayrım iki şey kazandırır: (1) ekran, ürünün servis grafiği
 * hiç yüklenmeden tek başına render/screenshot edilebilir — pixel-match
 * doğrulaması bu sayede mümkün; (2) sunum katmanı kazara bir otoriteye
 * bağlanamaz.
 */

import { memo } from 'react';
import {
  COCKPIT_CANVAS, COCKPIT_ANCHORS, COCKPIT_REGIONS, COCKPIT_RADII,
  COCKPIT_LEFT_CLUSTER_PATH, COCKPIT_RIGHT_CLUSTER_PATH, COCKPIT_RPM_ARC_PATH,
  cockpitTokensFor, type CockpitTokens,
} from './cockpitLayout';
import {
  EM_DASH, fmtSpeed, fmtRpmThousands, fmtCoolant, fmtRange, fmtConsumption,
  fmtOdometer, fmtAmbient, fmtManeuverDistance, coolantFill, fuelFill,
  type CockpitState,
} from './cockpitDataModel';

const FONT = "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif";

const A = COCKPIT_ANCHORS;

/* ══════════════════════════════════════════════════════════════════════════
 * Devir skalası taksimatı — GEOMETRİ TAHMİN EDİLMEZ, eğriden ÖRNEKLENİR
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * `COCKPIT_RPM_ARC_PATH` bir kuadratik Bézier'dir: `M77 170 Q32 290 57 528`.
 * Referans görselindeki taksimat/rakam konumlarını gözle koymak, paketin
 * "geometriyi tahmin etmeden" kuralını çiğnemek olurdu. Bunun yerine AYNI
 * eğri üzerinde `t` parametresiyle örnekleniyor: `t=0` yayın tepesi (8),
 * `t=1` tabanı (0). Sonuç referansla kendiliğinden örtüşür (örn. `t=0.25`
 * noktası x≈59 → rakam x≈169; referanstaki rakam sütunu da ~168'dedir).
 */
const TACHO_P0 = { x: 77, y: 170 };
const TACHO_P1 = { x: 32, y: 290 };
const TACHO_P2 = { x: 57, y: 528 };

function tachoPoint(t: number): { x: number; y: number } {
  const u = 1 - t;
  const a = u * u, b = 2 * u * t, c = t * t;
  return {
    x: a * TACHO_P0.x + b * TACHO_P1.x + c * TACHO_P2.x,
    y: a * TACHO_P0.y + b * TACHO_P1.y + c * TACHO_P2.y,
  };
}

/** Ana taksimat: 0 · 2 · 4 · 6 · 8 (x1000 rpm) — tabandan tepeye. */
const TACHO_TICKS: readonly { x: number; y: number; label: string }[] =
  [0, 0.25, 0.5, 0.75, 1].map((t) => ({ ...tachoPoint(t), label: String(Math.round(8 * (1 - t))) }));

/** Ara taksimat — ana taksimatların tam ortası (1 · 3 · 5 · 7). */
const TACHO_MINOR_TICKS: readonly { x: number; y: number }[] =
  [0.125, 0.375, 0.625, 0.875].map((t) => tachoPoint(t));

/* ══════════════════════════════════════════════════════════════════════════
 * Yol sahnesi — VEKTÖR (referans PNG'si arka plan olarak KULLANILMAZ)
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * Paket açıkça yasaklıyor: "Dinamik text değerleri hiçbir raster PNG içine
 * gömülmeyecek." `reference_day/night.png` dosyalarının İÇİNDE `72 / 1.8 / 92`
 * gibi değerler PİŞMİŞ durumdadır — bu yüzden onlar arka plan olarak
 * KULLANILAMAZ (kullanılsaydı ekranda iki hız yazardı: biri sahte).
 *
 * Bu yüzden yol sahnesi vektör olarak çizilir: ufuk gradyanı + perspektif
 * şerit + kılavuz şeridi. Gün/gece AYNI geometriyi kullanır, yalnız renk
 * tokenları değişir (paket kuralı).
 */
const RoadScene = memo(function RoadScene({ t, night }: { t: CockpitTokens; night: boolean }) {
  const r = COCKPIT_REGIONS.roadScene;
  const horizon = r.y + r.h * 0.44;      // ufuk çizgisi
  const vx = COCKPIT_CANVAS.width / 2;   // kaçış noktası X
  const bottom = r.y + r.h;
  /** Yolun tabandaki yarı genişliği — referanstaki gibi yol manzarayı DOLDURMAZ. */
  const halfW = 620;
  /** Kaçış noktasındaki yarı genişlik. */
  const halfV = 22;
  /** `t` (0 = ufuk, 1 = taban) için yolun yarı genişliği ve y'si. */
  const rw = (k: number) => halfV + (halfW - halfV) * k * k;      // perspektif (kare)
  const ry = (k: number) => horizon + (bottom - horizon) * k;

  return (
    <g clipPath="url(#roadClip)">
      <rect x={r.x} y={r.y} width={r.w} height={r.h} fill="url(#skyGrad)" />

      {/* Uzak siluet — SÜREKLİ ve düşük kontrastlı bir bant; tek tek kutular
          gibi okunmasın diye ufka oturur ve yol kenarına kadar iner. */}
      <g opacity={night ? 0.42 : 0.22} fill={night ? '#14344F' : '#8FB3CC'}>
        <path d={`M0,${horizon} L0,${horizon - 46} ${
          Array.from({ length: 36 }, (_, i) => {
            const x = i * 47;
            const h = 18 + ((i * 37) % 5) * 13;   // deterministik ritim (rastgele YOK)
            return `L${x},${horizon - h} L${x + 47},${horizon - h}`;
          }).join(' ')
        } L${COCKPIT_CANVAS.width},${horizon} Z`} />
      </g>

      {/* Yol kenarı zemini */}
      <rect x={r.x} y={horizon} width={r.w} height={bottom - horizon}
        fill={night ? '#08131C' : '#D7E3EC'} />

      {/* Yol yüzeyi */}
      <path d={`M${vx - halfV},${horizon} L${vx + halfV},${horizon}
                L${vx + halfW},${bottom} L${vx - halfW},${bottom} Z`}
        fill="url(#roadGrad)" />

      {/* Kenar şeritleri (sürekli beyaz çizgi) */}
      {[-1, 1].map((side) => (
        <path key={side}
          d={`M${vx + side * (halfV - 3)},${horizon} L${vx + side * (halfW - 16)},${bottom}
              L${vx + side * (halfW - 4)},${bottom} L${vx + side * (halfV + 1)},${horizon} Z`}
          fill={night ? '#3C4E5F' : '#FFFFFF'} opacity={night ? 0.65 : 0.9} />
      ))}

      {/* Şerit ayırıcı kesikler — ego şeridinin iki yanı, perspektifle kısalır */}
      {[0.06, 0.18, 0.32, 0.48, 0.66, 0.86].map((k, i) => {
        const k2 = Math.min(1, k + 0.06);
        const y0 = ry(k), y1 = ry(k2);
        const w0 = rw(k), w1 = rw(k2);
        const t0 = 3 + 13 * k, t1 = 3 + 13 * k2;   // çizgi kalınlığı
        return [-1, 1].map((side) => (
          <path key={`${i}-${side}`}
            d={`M${vx + side * w0 * 0.76 - t0},${y0} L${vx + side * w0 * 0.76 + t0},${y0}
                L${vx + side * w1 * 0.76 + t1},${y1} L${vx + side * w1 * 0.76 - t1},${y1} Z`}
            fill={night ? '#5C7186' : '#FFFFFF'} opacity={night ? 0.7 : 0.92} />
        ));
      })}

      {/* Kılavuz şeridi — referanstaki gibi ego şeridini saran İKİ yeşil bant */}
      {[-1, 1].map((side) => (
        <path key={`g${side}`}
          d={`M${vx + side * (rw(0.10) * 0.34 - 5)},${ry(0.10)}
              L${vx + side * (rw(0.10) * 0.34 + 5)},${ry(0.10)}
              L${vx + side * (rw(0.92) * 0.34 + 16)},${ry(0.92)}
              L${vx + side * (rw(0.92) * 0.34 - 16)},${ry(0.92)} Z`}
          fill={t.accentGreen} opacity={night ? 0.85 : 0.68} />
      ))}

      {/* Öndeki araç — soyut siluet (marka taklidi YOK) */}
      <g transform={`translate(${vx},${bottom - 168}) scale(0.66)`}>
        <ellipse cx={0} cy={34} rx={128} ry={16} fill="#000" opacity={night ? 0.42 : 0.16} />
        <rect x={-118} y={-70} width={236} height={104} rx={30}
          fill={night ? '#1B2733' : '#C3CED8'} />
        <rect x={-92} y={-98} width={184} height={48} rx={22}
          fill={night ? '#0E1922' : '#93A6B6'} />
        <rect x={-78} y={-92} width={156} height={34} rx={16}
          fill={night ? '#16242F' : '#7D93A6'} opacity={0.9} />
        <rect x={-104} y={-30} width={54} height={16} rx={8} fill={t.warningRed} />
        <rect x={50} y={-30} width={54} height={16} rx={8} fill={t.warningRed} />
      </g>
    </g>
  );
});

/* ══════════════════════════════════════════════════════════════════════════
 * İKONLAR — VEKTÖR (Unicode glif YOK)
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * Neden glif değil: head unit WebView'lerinde `↱ ⤺ ◀ ▶ Ⅱ` gibi karakterlerin
 * font kapsamı garanti DEĞİLDİR — eksik glif "tofu" kutusu olarak çizilir ve
 * manevra oku sessizce kaybolur. Bu yüzden tüm ikonlar path'tir.
 * Yerel kutu 0..48; çağıran `translate` ile referans çapaya oturtur.
 */
function maneuverIconPath(type: string | null, modifier: string | null): string {
  if (type === 'arrive') return 'M24,6 A18,18 0 1,1 23.9,6 Z M24,17 A7,7 0 1,0 24.1,17 Z';
  switch (modifier) {
    case 'left':
    case 'slight left':
      return 'M42,46 L42,26 Q42,13 29,13 L20,13 L20,4 L2,17 L20,30 L20,21 L29,21 Q34,21 34,26 L34,46 Z';
    case 'sharp left':
      return 'M42,46 L42,28 Q42,14 27,14 L18,14 L18,4 L2,18 L18,32 L18,22 L26,22 Q34,22 34,29 L34,46 Z';
    case 'uturn':
      return 'M12,46 L12,22 Q12,10 24,10 Q36,10 36,22 L36,30 L44,30 L32,45 L20,30 L28,30 L28,22 Q28,18 24,18 Q20,18 20,22 L20,46 Z';
    case 'straight':
      return 'M20,46 L20,18 L11,18 L24,3 L37,18 L28,18 L28,46 Z';
    case 'right':
    case 'slight right':
    default:
      return 'M6,46 L6,26 Q6,13 19,13 L28,13 L28,4 L46,17 L28,30 L28,21 L19,21 Q14,21 14,26 L14,46 Z';
  }
}

/* Alt-yollar AYNI sarım yönünde yazılır; ters sarım `nonzero` kuralında
   birbirini yer ve ikon "elmas" gibi görünürdü (ölçüldü, ilk screenshot). */
const ICON_PREV = 'M4,4 L11,4 L11,40 L4,40 Z M42,4 L42,40 L15,22 Z';
const ICON_NEXT = 'M37,4 L44,4 L44,40 L37,40 Z M6,4 L33,22 L6,40 Z';

/* ══════════════════════════════════════════════════════════════════════════
 * Ekran (SUNUM) — tüm veriyi prop olarak alır
 * ════════════════════════════════════════════════════════════════════════ */

export interface DigitalCockpitScreenProps {
  readonly state: CockpitState;
  readonly mode: 'day' | 'night';
  /** Üst şeritte gösterilecek saat/tarih — kokpit kendi saatini KURMAZ. */
  readonly clock: { readonly time: string; readonly date: string };
  readonly onMediaPrevious?: () => void;
  readonly onMediaToggle?: () => void;
  readonly onMediaNext?: () => void;
}

export const DigitalCockpitScreen = memo(function DigitalCockpitScreen({
  state, mode, clock, onMediaPrevious, onMediaToggle, onMediaNext,
}: DigitalCockpitScreenProps) {
  const t = cockpitTokensFor(mode);
  const night = mode === 'night';

  const cool = coolantFill(state.coolantTempC);
  const fuel = fuelFill(state.fuelLevelPct);

  const panelText = t.panelText;
  const dim = night ? '#94A3B8' : '#CBD5E1';

  return (
    <svg
      data-caros-cockpit="screen"
      data-cockpit-mode={mode}
      width="100%"
      height="100%"
      viewBox={`0 0 ${COCKPIT_CANVAS.width} ${COCKPIT_CANVAS.height}`}
      preserveAspectRatio="xMidYMid meet"
      style={{ display: 'block', background: t.canvas, fontFamily: FONT, touchAction: 'none' }}
      role="img"
      aria-label="Araç gösterge ekranı"
    >
      <defs>
        <clipPath id="artClip">
          <rect x={A.music.artX} y={A.music.artY} width={A.music.artSize} height={A.music.artSize}
            rx={A.music.artRadius} />
        </clipPath>
        <linearGradient id="tachoGrad" x1="0" y1="1" x2="0" y2="0"
          gradientUnits="objectBoundingBox">
          <stop offset="0" stopColor="#FBBF24" />
          <stop offset="0.55" stopColor="#F59E0B" />
          <stop offset="1" stopColor="#EF4444" />
        </linearGradient>
        <clipPath id="roadClip">
          <rect x={COCKPIT_REGIONS.roadScene.x} y={COCKPIT_REGIONS.roadScene.y}
            width={COCKPIT_REGIONS.roadScene.w} height={COCKPIT_REGIONS.roadScene.h} />
        </clipPath>
        <linearGradient id="skyGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={night ? '#071522' : '#BFE0F5'} />
          <stop offset="0.45" stopColor={night ? '#0B1E2E' : '#DCEDF9'} />
          <stop offset="1" stopColor={night ? '#050D14' : '#F2F7FB'} />
        </linearGradient>
        <linearGradient id="roadGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={night ? '#16222E' : '#9AA7B3'} />
          <stop offset="1" stopColor={night ? '#0A1219' : '#6E7C89'} />
        </linearGradient>
        <linearGradient id="clusterShade" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={night ? '#101B25' : '#19232d'} stopOpacity="0.96" />
          <stop offset="1" stopColor={night ? '#060D14' : '#0b1118'} stopOpacity="0.92" />
        </linearGradient>
      </defs>

      {/* ── z5 · Yol sahnesi ───────────────────────────────────────────── */}
      <RoadScene t={t} night={night} />

      {/* ── z30 · Sol küme: devir + motor sıcaklığı ────────────────────── */}
      <g data-cockpit-region="leftCluster">
        <path d={COCKPIT_LEFT_CLUSTER_PATH} fill="url(#clusterShade)"
          stroke={t.border} strokeWidth={2} />
        {/* Devir SKALASI — referanstaki gradyan yay (sarı→turuncu→kırmızı).
            Bu bir SKALADIR, doluluk göstergesi DEĞİLDİR: referansta da yay her
            zaman tam çizilidir ve canlı okuma dijital sayıdır. Taksimat ve
            rakamların yeri GÖZLE KONMADI — `COCKPIT_RPM_ARC_PATH` eğrisi
            üzerinde `tachoTicks()` ile matematiksel örneklendi. */}
        <path d={COCKPIT_RPM_ARC_PATH} fill="none" stroke="url(#tachoGrad)"
          strokeWidth={13} strokeLinecap="round" />
        {TACHO_TICKS.map((tk) => (
          <g key={tk.label}>
            <line x1={tk.x + 24} y1={tk.y} x2={tk.x + 44} y2={tk.y}
              stroke={dim} strokeWidth={3} opacity={0.85} />
            {/* Bu bir SKALA etiketidir, ÖLÇÜM DEĞİLDİR — dürüstlük testi
                gerçek okumalardan ayırabilsin diye işaretlenir. */}
            <text data-cockpit-scale="tacho" x={tk.x + 60} y={tk.y + 9} fill={panelText}
              fontSize={26} fontWeight={600}
              style={{ fontVariantNumeric: 'tabular-nums' }}>{tk.label}</text>
          </g>
        ))}
        {TACHO_MINOR_TICKS.map((tk, i) => (
          <line key={i} x1={tk.x + 28} y1={tk.y} x2={tk.x + 40} y2={tk.y}
            stroke={dim} strokeWidth={2} opacity={0.45} />
        ))}
        <text x={A.left.titleX} y={A.left.titleY} fill={dim} fontSize={A.left.titleSize}>Motor Devri</text>
        <text x={A.left.rpmX} y={A.left.rpmY} fill={panelText} fontSize={A.left.rpmSize}
          fontWeight={700} style={{ fontVariantNumeric: 'tabular-nums' }}>
          {fmtRpmThousands(state.rpm)}
        </text>
        <text x={A.left.rpmUnitX} y={A.left.rpmUnitY} fill={dim} fontSize={A.left.rpmUnitSize}>x1000 rpm</text>
        <line x1={A.left.dividerX1} y1={A.left.dividerY} x2={A.left.dividerX2} y2={A.left.dividerY}
          stroke={t.textSecondary} opacity={0.45} />
        <text x={A.left.coolantTitleX} y={A.left.coolantTitleY} fill={dim} fontSize={A.left.coolantTitleSize}>
          Motor Sıcaklığı
        </text>
        <text x={A.left.coolantX} y={A.left.coolantY} fill={panelText} fontSize={A.left.coolantSize}
          fontWeight={700} style={{ fontVariantNumeric: 'tabular-nums' }}>
          {fmtCoolant(state.coolantTempC)}
        </text>
        <rect x={A.left.barX} y={A.left.barY} width={A.left.barW} height={A.left.barH}
          rx={A.left.barH / 2} fill="#334155" />
        {cool !== null && (
          <rect x={A.left.barX} y={A.left.barY} width={Math.max(A.left.barH, A.left.barW * cool)}
            height={A.left.barH} rx={A.left.barH / 2} fill={t.accentOrange} />
        )}
        <text x={A.left.barX} y={A.left.barY + 34} fill={dim} fontSize={16}>C</text>
        <text x={A.left.barX + A.left.barW - 12} y={A.left.barY + 34} fill={dim} fontSize={16}>H</text>
      </g>

      {/* ── z50 · Hız + hız limiti ─────────────────────────────────────── */}
      <g data-cockpit-region="speedCluster">
        <text x={A.speed.valueX} y={A.speed.valueY} fill={t.textPrimary}
          fontSize={A.speed.valueSize} fontWeight={800} textAnchor="middle"
          style={{ fontVariantNumeric: 'tabular-nums', letterSpacing: '-2px' }}>
          {fmtSpeed(state.speedKmh)}
        </text>
        <text x={A.speed.valueX} y={A.speed.unitY} fill={t.textSecondary}
          fontSize={A.speed.unitSize} textAnchor="middle">km/h</text>
        {/* Levha YALNIZ gösterilebilir hükümde çizilir — sahte sayı yok.
            Kesin değilse çerçeve KESİKLİDİR (SpeedLimitCard ile aynı dürüstlük kuralı). */}
        {state.speedLimitKmh !== null && (
          <g data-cockpit-speedlimit={state.speedLimitDefinitive ? 'definitive' : 'uncertain'}>
            <circle cx={A.speed.limitCx} cy={A.speed.limitCy} r={A.speed.limitR}
              fill="#FFFFFF" stroke={t.warningRed} strokeWidth={A.speed.limitRing}
              strokeDasharray={state.speedLimitDefinitive ? undefined : '9 7'} />
            <text x={A.speed.limitCx} y={A.speed.limitTextY} fill="#111827"
              fontSize={A.speed.limitTextSize} fontWeight={700} textAnchor="middle"
              style={{ fontVariantNumeric: 'tabular-nums' }}>
              {Math.round(state.speedLimitKmh)}
            </text>
          </g>
        )}
      </g>

      {/* ── z30 · Sağ küme: menzil · yakıt · tüketim · odometre ────────── */}
      <g data-cockpit-region="rightCluster">
        <path d={COCKPIT_RIGHT_CLUSTER_PATH} fill="url(#clusterShade)"
          stroke={t.border} strokeWidth={2} />
        <text x={A.right.rangeTitleX} y={A.right.rangeTitleY} fill={dim}
          fontSize={A.right.rangeTitleSize}>Menzil</text>
        <text x={A.right.rangeX} y={A.right.rangeY} fill={panelText} fontSize={A.right.rangeSize}
          fontWeight={700} style={{ fontVariantNumeric: 'tabular-nums' }}>
          {fmtRange(state.rangeKm)}
        </text>
        <text x={A.right.rangeUnitX} y={A.right.rangeUnitY} fill={dim} fontSize={A.right.rangeUnitSize}>km</text>
        <rect x={A.right.fuelBarX} y={A.right.fuelBarY} width={A.right.fuelBarW}
          height={A.right.fuelBarH} rx={A.right.fuelBarH / 2} fill="#334155" />
        {fuel !== null && (
          <rect x={A.right.fuelBarX} y={A.right.fuelBarY}
            width={Math.max(A.right.fuelBarH, A.right.fuelBarW * fuel)}
            height={A.right.fuelBarH} rx={A.right.fuelBarH / 2} fill={t.accentGreen} />
        )}
        <text x={A.right.fuelBarX} y={A.right.fuelBarY + 36} fill={dim} fontSize={16}>E</text>
        <text x={A.right.fuelBarX + A.right.fuelBarW - 10} y={A.right.fuelBarY + 36} fill={dim} fontSize={16}>F</text>
        <line x1={A.right.dividerX1} y1={A.right.dividerY} x2={A.right.dividerX2} y2={A.right.dividerY}
          stroke={t.textSecondary} opacity={0.45} />
        <text x={A.right.consTitleX} y={A.right.consTitleY} fill={dim} fontSize={A.right.consTitleSize}>
          Ortalama Tüketim
        </text>
        <text x={A.right.consX} y={A.right.consY} fill={panelText} fontSize={A.right.consSize}
          fontWeight={700} style={{ fontVariantNumeric: 'tabular-nums' }}>
          {fmtConsumption(state.avgConsumptionL100)}
        </text>
        <text x={A.right.odoTitleX} y={A.right.odoTitleY} fill={dim} fontSize={A.right.odoTitleSize}>
          Toplam Yol
        </text>
        <text x={A.right.odoX} y={A.right.odoY} fill={panelText} fontSize={A.right.odoSize}
          fontWeight={700} style={{ fontVariantNumeric: 'tabular-nums' }}>
          {fmtOdometer(state.odometerKm)}
        </text>
      </g>

      {/* ── z60 · Manevra çubuğu — navigasyon YOKSA HİÇ ÇİZİLMEZ ───────── */}
      {state.maneuver !== null && (
        <g data-cockpit-region="maneuverBar">
          <rect x={COCKPIT_REGIONS.maneuverBar.x} y={COCKPIT_REGIONS.maneuverBar.y}
            width={COCKPIT_REGIONS.maneuverBar.w} height={COCKPIT_REGIONS.maneuverBar.h}
            rx={A.maneuver.radius} fill={night ? 'rgba(12,22,32,0.92)' : 'rgba(248,250,252,0.92)'}
            stroke={t.border} />
          <path
            transform={`translate(${A.maneuver.iconX}, ${A.maneuver.iconY - A.maneuver.iconSize})`}
            d={maneuverIconPath(state.maneuver.type, state.maneuver.modifier)}
            fill={t.textPrimary} />
          <text x={A.maneuver.distX} y={A.maneuver.distY} fill={t.textPrimary}
            fontSize={A.maneuver.distSize} fontWeight={700}
            style={{ fontVariantNumeric: 'tabular-nums' }}>
            {fmtManeuverDistance(state.maneuver.distanceMeters)}
          </text>
          <text x={A.maneuver.streetX} y={A.maneuver.streetY} fill={t.textSecondary}
            fontSize={A.maneuver.streetSize}>
            {(state.maneuver.label ?? EM_DASH).slice(0, 26)}
          </text>
        </g>
      )}

      {/* ── z60 · Müzik kartı ──────────────────────────────────────────── */}
      <g data-cockpit-region="musicCard">
        <rect x={COCKPIT_REGIONS.musicCard.x} y={COCKPIT_REGIONS.musicCard.y}
          width={COCKPIT_REGIONS.musicCard.w} height={COCKPIT_REGIONS.musicCard.h}
          rx={A.music.radius} fill={night ? 'rgba(12,22,32,0.92)' : 'rgba(248,250,252,0.92)'}
          stroke={t.border} />
        {state.media.artworkUrl !== null ? (
          <image href={state.media.artworkUrl} x={A.music.artX} y={A.music.artY}
            width={A.music.artSize} height={A.music.artSize}
            preserveAspectRatio="xMidYMid slice" clipPath="url(#artClip)" />
        ) : (
          <rect x={A.music.artX} y={A.music.artY} width={A.music.artSize} height={A.music.artSize}
            rx={A.music.artRadius} fill={night ? '#1E293B' : '#CBD5E1'} />
        )}
        <text x={A.music.titleX} y={A.music.titleY} fill={t.textPrimary}
          fontSize={A.music.titleSize} fontWeight={700}>
          {(state.media.title ?? EM_DASH).slice(0, 22)}
        </text>
        <text x={A.music.artistX} y={A.music.artistY} fill={t.textSecondary} fontSize={A.music.artistSize}>
          {(state.media.artist ?? EM_DASH).slice(0, 26)}
        </text>

        {/* Transport — kanonik müzik otoritesini sürer, ikinci oynatıcı KURMAZ.
            Görünmez 56×56 dokunma hedefleri paketin taban ölçüsüdür. */}
        <g opacity={state.media.available ? 1 : 0.4}
           pointerEvents={state.media.available ? 'auto' : 'none'} style={{ cursor: 'pointer' }}>
          <g onClick={onMediaPrevious} role="button" aria-label="Önceki parça">
            <rect x={A.music.prevX - 14} y={A.music.prevY - 42} width={56} height={56} fill="transparent" />
            <path transform={`translate(${A.music.prevX - 6}, ${A.music.prevY - 36})`}
              d={ICON_PREV} fill={t.textPrimary} />
          </g>
          <g onClick={onMediaToggle} role="button" aria-label={state.media.playing ? 'Duraklat' : 'Çal'}>
            <circle cx={A.music.playCx} cy={A.music.playCy} r={A.music.playR}
              fill="transparent" stroke={t.accentOrange} strokeWidth={3} />
            {state.media.playing ? (
              <g fill={t.accentOrange}>
                <rect x={A.music.playCx - 14} y={A.music.playCy - 18} width={9} height={36} rx={2} />
                <rect x={A.music.playCx + 5} y={A.music.playCy - 18} width={9} height={36} rx={2} />
              </g>
            ) : (
              <path d={`M${A.music.playCx - 11},${A.music.playCy - 19} L${A.music.playCx + 19},${A.music.playCy}
                        L${A.music.playCx - 11},${A.music.playCy + 19} Z`} fill={t.accentOrange} />
            )}
          </g>
          <g onClick={onMediaNext} role="button" aria-label="Sonraki parça">
            <rect x={A.music.nextX - 14} y={A.music.nextY - 42} width={56} height={56} fill="transparent" />
            <path transform={`translate(${A.music.nextX - 6}, ${A.music.nextY - 36})`}
              d={ICON_NEXT} fill={t.textPrimary} />
          </g>
        </g>
      </g>

      {/* ── z60 · Sürüş asistanı kartı ─────────────────────────────────── */}
      <g data-cockpit-region="assistCard">
        <rect x={COCKPIT_REGIONS.assistCard.x} y={COCKPIT_REGIONS.assistCard.y}
          width={COCKPIT_REGIONS.assistCard.w} height={COCKPIT_REGIONS.assistCard.h}
          rx={A.assist.radius} fill={night ? 'rgba(12,22,32,0.92)' : 'rgba(248,250,252,0.92)'}
          stroke={t.border} />
        <text x={A.assist.titleX} y={A.assist.titleY} fill={t.textSecondary} fontSize={A.assist.titleSize}>
          Sürüş Asistanı
        </text>
        {/* ADAS rozetleri: bu üründe GERÇEK şerit/takip sinyali YOK → `null` →
            rozet HİÇ ÇİZİLMEZ. Sahte "aktif" göstermek yerine sessiz kalınır. */}
        {state.laneAssist !== null && (
          <path transform={`translate(${A.assist.laneX}, ${A.assist.laneY - A.assist.laneSize})`}
            d="M8,44 L20,4 L26,4 L14,44 Z M34,44 L46,4 L40,4 L28,44 Z"
            fill={state.laneAssist ? t.accentGreen : t.textSecondary} />
        )}
        {state.followingAssist !== null && (
          <path transform={`translate(${A.assist.followX}, ${A.assist.followY - A.assist.followSize})`}
            d="M6,30 L10,16 Q11,12 16,12 L32,12 Q37,12 38,16 L42,30 L42,38 L34,38 L34,32 L14,32 L14,38 L6,38 Z"
            fill={state.followingAssist ? t.accentGreen : t.textSecondary} />
        )}
        {state.laneAssist === null && state.followingAssist === null && (
          <text x={A.assist.laneX} y={A.assist.laneY - 6} fill={t.textSecondary} fontSize={22}>
            Sürüş asistanı sinyali yok
          </text>
        )}
        <line x1={A.assist.dividerX} y1={A.assist.dividerY1} x2={A.assist.dividerX} y2={A.assist.dividerY2}
          stroke={t.textSecondary} opacity={0.5} />
        <text x={A.assist.gearX} y={A.assist.gearY} fill={t.textPrimary} fontSize={A.assist.gearSize}
          fontWeight={700} textAnchor="middle">{state.gear ?? EM_DASH}</text>
        <text x={A.assist.gearX} y={A.assist.modeY} fill={t.accentGreen} fontSize={A.assist.modeSize}
          fontWeight={700} textAnchor="middle">{state.driveMode ?? EM_DASH}</text>
      </g>

      {/* ── z90 · Üst sistem şeridi ────────────────────────────────────── */}
      <g data-cockpit-region="topBar">
        <rect x={0} y={0} width={COCKPIT_CANVAS.width} height={COCKPIT_REGIONS.topBar.h}
          fill={night ? 'rgba(4,10,16,0.72)' : 'rgba(255,255,255,0.62)'} />
        <text x={A.topBar.brandX} y={A.topBar.brandY} fill={t.textPrimary}
          fontSize={A.topBar.brandSize} fontWeight={700}
          letterSpacing={A.topBar.brandSpacing}>CAROS</text>
        <line x1={A.topBar.dividerX} y1={A.topBar.dividerY1} x2={A.topBar.dividerX} y2={A.topBar.dividerY2}
          stroke={t.textSecondary} opacity={0.55} />
        <text x={A.topBar.clockX} y={A.topBar.clockY} fill={t.textPrimary} fontSize={A.topBar.clockSize}
          fontWeight={700} style={{ fontVariantNumeric: 'tabular-nums' }}>{clock.time}</text>
        <text x={A.topBar.dateX} y={A.topBar.dateY} fill={t.textSecondary} fontSize={A.topBar.dateSize}>
          {clock.date}
        </text>
        <text x={A.topBar.ambientTempX} y={A.topBar.ambientTempY} fill={t.textPrimary}
          fontSize={A.topBar.ambientTempSize} style={{ fontVariantNumeric: 'tabular-nums' }}>
          {fmtAmbient(state.ambientTempC)}
        </text>
      </g>

      {/* Köşe yarıçapı tokenı kullanılmayan bir sabit olarak kalmasın diye
          kart kenarlığı ile aynı değerden türetilen ince taban çizgisi. */}
      <rect x={0} y={COCKPIT_CANVAS.height - 2} width={COCKPIT_CANVAS.width} height={2}
        fill={t.border} opacity={0.35} rx={COCKPIT_RADII.pill / COCKPIT_RADII.pill} />
    </svg>
  );
});
