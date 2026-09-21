/**
 * TripComputerScreen — YOLCULUK BİLGİSAYARI sayfasının SUNUMU.
 *
 * Platformdan TAMAMEN bağımsızdır: prop alır, JSX döner.
 *
 * ── BU EKRAN OBD EKRANI DEĞİLDİR ──────────────────────────────────────────
 * OBD sayfası "araç şu anda teknik olarak ne yapıyor" sorusunu yanıtlar;
 * burası "bu yolculuk nasıl geçiyor/geçti". Motor telemetrisi (devir, motor
 * sıcaklığı, PID) BURADA GÖSTERİLMEZ — onlar OBD sayfasına aittir.
 *
 * ── KOMPOZİSYON ───────────────────────────────────────────────────────────
 * Merkezde tek büyük HALKA: dilimleri yolculuğun GERÇEK zaman bileşimidir,
 * ortasında gidilen mesafe durur. Ekranın en görsel öğesi dekorasyon değil,
 * ölçümün kendisidir. Sağda üç panel: HIZ · YOLCULUK/ZAMAN · YAKIT VE MALİYET.
 *
 * ── GELİŞTİRME SUNUM POLİTİKASI (YALNIZ BU EKRAN) ─────────────────────────
 * Hedef bilgi kümesindeki her alan ekranda KALIR. Verisi henüz akmayan alan
 * ekranda 0 gösterir; böylece gerçek araç testinde hangi toplama zincirinin
 * takip edileceği görülür.
 *
 * Bu YALNIZCA sunum katmanıdır. Model/domain katmanı dokunulmamıştır:
 * `Metric.value` null kalır ve `Metric.source` UNAVAILABLE kalır. Gerçek bir
 * sıfır ile veri yokluğu domain'de BİRLEŞTİRİLMEZ. Ekranda ayrım iki sessiz
 * kanaldan okunur: sayı soluk renkte çizilir ve altındaki küçük etiket kaynak
 * yerine "veri yok" der. `data-trip-source` özniteliği de gerçek domain
 * kaynağını taşımaya devam eder.
 *
 * Bar/halka gibi ORANSAL çizimler ölçüm yoksa DOLDURULMAZ — sahte doluluk
 * üretmek, boş bir alana 0 yazmaktan farklı bir iddiadır.
 */

import { memo } from 'react';
import type { Metric } from '../../platform/trip/tripCanonicalModel';
import {
  has, consumptionL100, timeComposition, formatDuration,
  type TripComputerState,
} from './tripComputerModel';

export type TripMode = 'day' | 'night';

export interface TripComputerScreenProps {
  readonly state: TripComputerState;
  readonly mode: TripMode;
  readonly clock: { readonly time: string; readonly date: string };
  readonly onHome: () => void;
}

/* ══════════════════════════════════════════════════════════════════════════
 * Tema — OBD sayfasıyla AYNI token ailesi (tek CarOS dili)
 * ════════════════════════════════════════════════════════════════════════ */

interface Tokens {
  bg: string; panel: string; panelMuted: string; line: string; lineSoft: string;
  txt: string; txt2: string; txt3: string; dash: string;
  track: string; accent: string; accentSoft: string; onAccent: string;
  moving: string; idle: string; unknown: string;
  ok: string; okSoftBg: string; okSoftLine: string; warn: string;
}

const NIGHT: Tokens = {
  bg: '#06080A', panel: '#0D1116', panelMuted: '#0A0E12', line: '#1E262F', lineSoft: '#141B22',
  txt: '#E9F1F7', txt2: '#7C8B99', txt3: '#56646F', dash: '#39434D',
  track: '#161E26', accent: '#4FE0C8', accentSoft: 'rgba(79,224,200,0.14)', onAccent: '#04211D',
  moving: '#4FE0C8', idle: '#5A8BD6', unknown: '#3A4550',
  ok: '#52D98A', okSoftBg: 'rgba(82,217,138,0.10)', okSoftLine: 'rgba(82,217,138,0.34)',
  warn: '#F5B544',
};

const DAY: Tokens = {
  bg: '#E7EAEE', panel: '#F7F9FA', panelMuted: '#EFF2F5', line: '#CDD3DA', lineSoft: '#DFE4E9',
  txt: '#10151A', txt2: '#525E6B', txt3: '#68747F', dash: '#A6AFB8',
  track: '#E1E5EA', accent: '#0E9E8C', accentSoft: 'rgba(14,158,140,0.12)', onAccent: '#FFFFFF',
  moving: '#0E9E8C', idle: '#3E6FB0', unknown: '#AAB3BC',
  ok: '#12793F', okSoftBg: 'rgba(18,121,63,0.10)', okSoftLine: 'rgba(18,121,63,0.32)',
  warn: '#A96800',
};

/* ══════════════════════════════════════════════════════════════════════════
 * Biçimlendirme — GELİŞTİRME SUNUM POLİTİKASI burada uygulanır
 * ════════════════════════════════════════════════════════════════════════ */

const SOURCE_LABEL: Record<string, string> = {
  MEASURED: 'ölçülen', DERIVED: 'hesaplanan', ESTIMATED: 'tahmini', UNAVAILABLE: 'veri yok',
};

/** Alanın altındaki küçük kaynak etiketi. Veri yoksa bunu açıkça söyler. */
function srcLabel(m: Metric): string {
  return SOURCE_LABEL[m.source] ?? 'veri yok';
}

/**
 * Sayı biçimi. Ölçüm yoksa politika gereği 0 yazılır — model null kalmaya
 * devam eder, burada yalnız ÇİZİM kararı verilir.
 */
function fmt(m: Metric, digits = 0): string {
  const v = has(m) ? m.value! : 0;
  return v.toLocaleString('tr-TR', {
    minimumFractionDigits: digits, maximumFractionDigits: digits,
  });
}

/** Süre biçimi. Ölçüm yoksa "0 dk". */
function fmtDur(m: Metric): string {
  return formatDuration(has(m) ? m.value : null) ?? '0 dk';
}

/** Bileşim dakikası. Bileşim hiç ölçülmediyse "0 dk". */
function fmtMin(min: number, measured: boolean): string {
  return (measured ? formatDuration(min) : null) ?? '0 dk';
}

/** Saat. Saat için 0 anlamsızdır; yokluk boş saat yuvasıyla gösterilir. */
function fmtClock(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms) || ms <= 0) return '--:--';
  try {
    return new Date(ms).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', hour12: false });
  } catch { return '--:--'; }
}

/* ══════════════════════════════════════════════════════════════════════════
 * HALKA — dilimler GERÇEK zaman bileşimi
 * ════════════════════════════════════════════════════════════════════════ */

/** r=132 · tam çember · çevre 829.4. Boşluk bırakmadan üç dilim. */
const R = 132;
const RING_C = 2 * Math.PI * R;

interface Slice { readonly len: number; readonly offset: number; readonly color: string }

function ringSlices(movingMin: number, idleMin: number, unknownMin: number, t: Tokens): Slice[] {
  const total = movingMin + idleMin + unknownMin;
  if (total <= 0) return [];
  const out: Slice[] = [];
  let acc = 0;
  for (const [min, color] of [
    [movingMin, t.moving], [idleMin, t.idle], [unknownMin, t.unknown],
  ] as const) {
    if (min <= 0) continue;
    const len = (min / total) * RING_C;
    out.push({ len, offset: -acc, color });
    acc += len;
  }
  return out;
}

/* ══════════════════════════════════════════════════════════════════════════
 * Parçalar
 * ════════════════════════════════════════════════════════════════════════ */

/** Sağ sütun paneli — ortak kabuk. */
function Panel(props: {
  readonly title: string; readonly t: Tokens; readonly testId: string;
  readonly children: React.ReactNode;
}): React.ReactElement {
  const { title, t, testId, children } = props;
  return (
    <section className="tripc-card" data-trip-card={testId}
      style={{ background: t.panel, border: `1px solid ${t.line}` }}>
      <div className="tripc-cap" style={{ color: t.txt3 }}>{title}</div>
      {children}
    </section>
  );
}

/**
 * Panel içi ölçüm hücresi: sayı · birim · etiket · kaynak.
 * Veri yoksa sayı SOLUK çizilir ve kaynak satırı "veri yok" der.
 */
function Cell(props: {
  readonly label: string; readonly metric: Metric; readonly t: Tokens;
  readonly testId: string; readonly unit?: string; readonly digits?: number;
  readonly text?: string; readonly size?: 'lg' | 'md';
}): React.ReactElement {
  const { label, metric, t, testId, unit, digits = 0, text, size = 'md' } = props;
  const known = has(metric);
  return (
    <div className={size === 'lg' ? 'tripc-cell tripc-cell--lg' : 'tripc-cell'}
      data-trip-cell={testId} data-trip-source={metric.source}>
      <div className="tripc-cell-num" style={{ color: known ? t.txt : t.dash }}>
        <span data-trip-value={testId}>{text ?? fmt(metric, digits)}</span>
        {unit !== undefined && <i style={{ color: known ? t.txt2 : t.dash }}>{unit}</i>}
      </div>
      <div className="tripc-cell-label" style={{ color: t.txt2 }}>{label}</div>
      <div className="tripc-cell-src" data-trip-src={testId} style={{ color: t.txt3 }}>{srcLabel(metric)}</div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
 * Ekran
 * ════════════════════════════════════════════════════════════════════════ */

export const TripComputerScreen = memo(function TripComputerScreen(
  { state, mode, clock, onHome }: TripComputerScreenProps,
): React.ReactElement {
  const t = mode === 'night' ? NIGHT : DAY;
  const m = state.metrics;
  const none = state.view === 'none';
  const active = state.view === 'active';

  const comp = timeComposition(m);
  const slices = comp.measured ? ringSlices(comp.movingMin, comp.idleMin, comp.unknownMin, t) : [];
  const cons = consumptionL100(m);

  /* Oransal çizimler: ölçüm yoksa DOLDURULMAZ (sahte doluluk üretme). */
  const speedRatio = has(m.averageSpeedKmh) && has(m.maximumSpeedKmh) && m.maximumSpeedKmh.value! > 0
    ? Math.min(1, m.averageSpeedKmh.value! / m.maximumSpeedKmh.value!)
    : null;
  const fuelRatio = has(m.fuelUsedL) && state.tankL !== null && state.tankL > 0
    ? Math.min(1, m.fuelUsedL.value! / state.tankL)
    : null;

  /** Bileşim payı. Ölçüm yoksa 0 — çizim de yapılmaz. */
  const share = (min: number): number =>
    comp.measured && comp.totalMin > 0 ? (min / comp.totalMin) * 100 : 0;

  return (
    <div className="tripc" data-trip-theme={mode} data-trip-view={state.view}
      style={{ background: t.bg, color: t.txt }}>
      <style>{CSS}</style>

      {/* ── ÜST ÇUBUK ─────────────────────────────────────────────────── */}
      <header className="tripc-top">
        <div className="tripc-brand">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke={t.accent}
            strokeWidth="1.6" aria-hidden="true">
            <circle cx="12" cy="12" r="9" /><path d="M12 7v5l3.5 2" />
          </svg>
          <span className="tripc-wordmark">CAROS</span>
          <span className="tripc-sep" style={{ background: t.line }} />
          <h1 className="tripc-title" style={{ color: t.txt2 }}>YOLCULUK BİLGİSAYARI</h1>
        </div>

        <div className="tripc-spacer" />

        <div className="tripc-dots" role="img" aria-label="Sayfa 4 / 4: Yolculuk">
          <i style={{ background: t.line }} /><i style={{ background: t.line }} />
          <i style={{ background: t.line }} /><i className="tripc-dot-on" style={{ background: t.accent }} />
        </div>

        <span className="tripc-sep" style={{ background: t.line }} />

        {!none && (
          <div className="tripc-chip" data-trip-chip=""
            style={{
              background: active ? t.okSoftBg : 'transparent',
              border: `1px solid ${active ? t.okSoftLine : t.line}`,
            }}>
            {active && <i style={{ background: t.ok }} />}
            <span style={{ color: active ? t.ok : t.txt2 }}>
              {active ? 'SÜREN YOLCULUK' : 'SON YOLCULUK'}
            </span>
          </div>
        )}

        <div className="tripc-clock">
          <div className="tripc-clock-time">{clock.time}</div>
          <div className="tripc-clock-date" style={{ color: t.txt3 }}>{clock.date}</div>
        </div>
      </header>

      {none ? (
        <section className="tripc-empty" data-trip-empty=""
          style={{ background: t.panelMuted, border: `1px solid ${t.track}` }}>
          <div className="tripc-empty-icon" style={{ background: t.panel, border: `1px solid ${t.line}` }}>
            <svg width="52" height="52" viewBox="0 0 24 24" fill="none" stroke={t.txt3}
              strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="9" /><path d="M12 7v5l3.5 2" />
            </svg>
          </div>
          <h2 className="tripc-empty-title">Henüz bir yolculuk kaydı yok</h2>
          <p className="tripc-empty-text" style={{ color: t.txt2 }}>
            Araç hareket ettiğinde yolculuk kendiliğinden başlar ve bu sayfa ölçümlerle dolar.
          </p>
        </section>
      ) : (
        <div className="tripc-body">

          {/* ══ SOL — HALKA ══ */}
          <section className="tripc-stage" style={{ background: t.panel, border: `1px solid ${t.line}` }}>
            <div className="tripc-ring-wrap">
              <svg viewBox="0 0 320 320" className="tripc-ring" role="img"
                aria-label={`Gidilen mesafe ${fmt(m.distanceKm, 1)} kilometre`}>
                {/* dış ince hat — çerçeve hissi, veri iddiası değil */}
                <circle cx="160" cy="160" r={R + 22} fill="none" stroke={t.lineSoft} strokeWidth="1" />
                <circle cx="160" cy="160" r={R} fill="none" stroke={t.track} strokeWidth="26" />
                <g transform="rotate(-90 160 160)">
                  {slices.map((s, i) => (
                    <circle key={String(i)} cx="160" cy="160" r={R} fill="none" stroke={s.color}
                      strokeWidth="26" strokeDasharray={`${s.len} ${RING_C}`} strokeDashoffset={s.offset} />
                  ))}
                </g>
                <text x="160" y="150" textAnchor="middle" className="tripc-ring-num"
                  fill={has(m.distanceKm) ? t.txt : t.dash}>
                  <tspan data-trip-value="distance">{fmt(m.distanceKm, 1)}</tspan>
                </text>
                <text x="160" y="186" textAnchor="middle" fontSize="20" fill={t.txt2} letterSpacing="2">km</text>
                <text x="160" y="212" textAnchor="middle" fontSize="12" fill={t.txt3} letterSpacing="1.4"
                  data-trip-src="distance">
                  {srcLabel(m.distanceKm).toLocaleUpperCase('tr-TR')}
                </text>
              </svg>
            </div>

            {/* süre + ortalama hız — halkanın altında, hairline ile ayrık */}
            <div className="tripc-stage-stats">
              <div className="tripc-stat" data-trip-hero="duration" data-trip-source={m.durationMin.source}>
                <div className="tripc-stat-num" style={{ color: has(m.durationMin) ? t.txt : t.dash }}>
                  <span data-trip-value="duration">{fmtDur(m.durationMin)}</span>
                </div>
                <div className="tripc-stat-label" style={{ color: t.txt3 }}>
                  YOLCULUK SÜRESİ · {srcLabel(m.durationMin)}
                </div>
              </div>
              <span className="tripc-stat-rule" style={{ background: t.line }} />
              <div className="tripc-stat" data-trip-hero="avgSpeed" data-trip-source={m.averageSpeedKmh.source}>
                <div className="tripc-stat-num" style={{ color: has(m.averageSpeedKmh) ? t.txt : t.dash }}>
                  <span data-trip-value="avgSpeed">{fmt(m.averageSpeedKmh)}</span>
                  <i style={{ color: t.txt2 }}>km/s</i>
                </div>
                <div className="tripc-stat-label" style={{ color: t.txt3 }}>
                  ORTALAMA HIZ · {srcLabel(m.averageSpeedKmh)}
                </div>
              </div>
            </div>

            {/* halka açıklaması — hangi renk ne */}
            <div className="tripc-legend">
              <span style={{ color: t.txt2 }}>
                <i style={{ background: t.moving }} />Hareket {fmtMin(comp.movingMin, comp.measured)}
              </span>
              <span style={{ color: t.txt2 }}>
                <i style={{ background: t.idle }} />Duruş {fmtMin(comp.idleMin, comp.measured)}
              </span>
              {comp.measured && comp.unknownMin > 0 && (
                <span style={{ color: t.txt2 }}>
                  <i style={{ background: t.unknown }} />Ölçülemeyen {fmtMin(comp.unknownMin, true)}
                </span>
              )}
              {!comp.measured && (
                <span style={{ color: t.txt3 }} data-trip-comp-none="">Süre bileşimi henüz ölçülmedi</span>
              )}
            </div>
          </section>

          {/* ══ SAĞ SÜTUN — HIZ · ZAMAN · YAKIT ══ */}
          <div className="tripc-side">

            {/* PANEL 1 — HIZ (sürüş olayları burada kompakt tek satır) */}
            <Panel title="HIZ" t={t} testId="speed">
              <div className="tripc-speed-row">
                <div className="tripc-speed-main" data-trip-cell="maxSpeed" data-trip-source={m.maximumSpeedKmh.source}>
                  <span className="tripc-speed-num" style={{ color: has(m.maximumSpeedKmh) ? t.txt : t.dash }}>
                    <span data-trip-value="maxSpeed">{fmt(m.maximumSpeedKmh)}</span>
                  </span>
                  <i style={{ color: t.txt2 }}>km/s</i>
                </div>
                <span className="tripc-speed-cap" style={{ color: t.txt3 }}>
                  MAKSİMUM · {srcLabel(m.maximumSpeedKmh)}
                </span>
              </div>

              <div className="tripc-band" style={{ background: t.track }}>
                {speedRatio !== null && (
                  <>
                    <span className="tripc-band-fill" style={{ width: `${speedRatio * 100}%`, background: t.accent }} />
                    <span className="tripc-band-mark" style={{ left: `${speedRatio * 100}%`, background: t.txt }} />
                  </>
                )}
              </div>
              <div className="tripc-band-foot" style={{ color: t.txt2 }}>
                <span data-trip-cell="avgSpeedFoot" data-trip-source={m.averageSpeedKmh.source}>
                  ortalama {fmt(m.averageSpeedKmh)} km/s
                </span>
                <span>maksimum {fmt(m.maximumSpeedKmh)} km/s</span>
              </div>

              {/* sürüş olayları — ayrı kart değil, hızın altında ince satır */}
              <div className="tripc-inline" style={{ borderTop: `1px solid ${t.lineSoft}` }}>
                <span data-trip-cell="harshBrake" data-trip-source={m.harshBrakeCount.source}
                  style={{ color: t.txt2 }}>
                  Sert fren
                  <b data-trip-value="harshBrake"
                    style={{ color: has(m.harshBrakeCount) ? t.txt : t.dash }}>{fmt(m.harshBrakeCount)}</b>
                </span>
                <span data-trip-cell="harshAccel" data-trip-source={m.harshAccelCount.source}
                  style={{ color: t.txt2 }}>
                  Ani hızlanma
                  <b data-trip-value="harshAccel"
                    style={{ color: has(m.harshAccelCount) ? t.txt : t.dash }}>{fmt(m.harshAccelCount)}</b>
                </span>
              </div>
            </Panel>

            {/* PANEL 2 — YOLCULUK VE ZAMAN */}
            <Panel title="YOLCULUK VE ZAMAN" t={t} testId="time">
              <div className="tripc-grid3">
                <Cell label="Hareket" metric={m.movingTimeMin} t={t} testId="movingMin"
                  text={fmtMin(comp.movingMin, comp.measured)} />
                <Cell label="Duruş" metric={m.idleTimeMin} t={t} testId="idleMin"
                  text={fmtMin(comp.idleMin, comp.measured)} />
                <Cell label="Duruş sayısı" metric={m.stopCount} t={t} testId="stopCount" />
              </div>

              {/* KRONOLOJİK DEĞİL — TOPLAM ORAN. Etiketi bunu açıkça söyler. */}
              <div className="tripc-band" data-trip-bar="" style={{ background: t.track }}>
                {comp.measured && (
                  <span className="tripc-band-split">
                    <span style={{ width: `${share(comp.movingMin)}%`, background: t.moving }} />
                    <span style={{ width: `${share(comp.idleMin)}%`, background: t.idle }} />
                    <span style={{ width: `${share(comp.unknownMin)}%`, background: t.unknown }} />
                  </span>
                )}
              </div>
              <div className="tripc-band-foot" style={{ color: t.txt2 }}>
                <span>hareket %{Math.round(share(comp.movingMin))} · duruş %{Math.round(share(comp.idleMin))}</span>
                <span style={{ color: t.txt3 }}>toplam oran</span>
              </div>

              <div className="tripc-inline" style={{ borderTop: `1px solid ${t.lineSoft}` }}>
                <span style={{ color: t.txt2 }}>
                  Başlangıç
                  <b data-trip-value="startedAt" style={{ color: t.txt }}>{fmtClock(state.startedAtMs)}</b>
                </span>
                <span style={{ color: t.txt2 }}>
                  {/* SÜREN yolculukta bitiş saati YOKTUR; duvar saatini bitiş gibi gösterme. */}
                  Bitiş
                  <b data-trip-value="endedAt" style={{ color: active ? t.txt2 : t.txt }}>
                    {active ? 'sürüyor' : fmtClock(state.endedAtMs)}
                  </b>
                </span>
              </div>
            </Panel>

            {/* PANEL 3 — YAKIT VE MALİYET */}
            <Panel title="YAKIT VE MALİYET" t={t} testId="fuel">
              <div className="tripc-grid3">
                <Cell label="Kullanılan" metric={m.fuelUsedL} t={t} testId="fuelUsed"
                  unit="L" digits={2} size="lg" />
                <Cell label="Ortalama" metric={cons} t={t} testId="consumption" unit="L/100km" digits={1} />
                <Cell label="Maliyet" metric={m.estimatedCost} t={t} testId="cost"
                  unit={state.currency ?? '₺'} digits={2} />
              </div>

              {/* depoya oran — depo yapılandırılmamışsa ÇİZİLMEZ */}
              <div className="tripc-band" style={{ background: t.track }}>
                {fuelRatio !== null && (
                  <span className="tripc-band-fill" style={{ width: `${fuelRatio * 100}%`, background: t.accent }} />
                )}
              </div>
              <div className="tripc-band-foot" style={{ color: t.txt2 }}>
                <span>
                  {state.tankL !== null && state.tankL > 0
                    ? `${fmt(m.fuelUsedL, 2)} L / ${state.tankL.toLocaleString('tr-TR')} L depo`
                    : 'Depo hacmi yapılandırılmadı'}
                </span>
                {state.priceSource !== null && (
                  <span data-trip-price-source="" style={{ color: t.txt3 }}>
                    fiyat: {state.priceSource}
                  </span>
                )}
              </div>
            </Panel>
          </div>
        </div>
      )}

      {/* ── ALT ŞERİT ─────────────────────────────────────────────────── */}
      <footer className="tripc-bottom">
        <button type="button" className="tripc-home" data-trip-home=""
          onClick={onHome} style={{ background: t.accent, color: t.onAccent }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M3 11l9-8 9 8" /><path d="M5 10v10h14V10" />
          </svg>
          <span className="tripc-home-title">Ana Sayfa</span>
        </button>
        <div className="tripc-foot-note" style={{ color: t.txt3 }}>
          Geliştirme sunumu · verisi akmayan alan soluk 0 ve "veri yok" etiketiyle çizilir
        </div>
      </footer>
    </div>
  );
});

/* ══════════════════════════════════════════════════════════════════════════
 * Yerleşim — landscape araç ekranı öncelikli
 * ════════════════════════════════════════════════════════════════════════ */

const CSS = `
.tripc{width:100%;height:100%;box-sizing:border-box;display:flex;flex-direction:column;
  gap:clamp(8px,1.1vh,14px);padding:clamp(10px,1.7vh,20px) clamp(14px,1.7vw,26px);
  font-family:'Saira','Segoe UI',system-ui,sans-serif;overflow:hidden;
  font-variant-numeric:tabular-nums;}

.tripc-top{position:relative;flex:0 0 auto;display:flex;align-items:center;
  gap:clamp(10px,1.3vw,22px);min-height:40px;}
.tripc-brand{display:flex;align-items:center;gap:clamp(8px,0.8vw,13px);min-width:0;}
.tripc-wordmark{font-size:clamp(15px,1.3vw,22px);font-weight:700;letter-spacing:3.4px;}
.tripc-title{margin:0;font-size:clamp(10px,0.9vw,15px);font-weight:500;letter-spacing:1.6px;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.tripc-sep{width:1px;height:24px;flex:0 0 auto;}
.tripc-spacer{flex:1 1 auto;}
.tripc-dots{display:flex;align-items:center;gap:8px;}
.tripc-dots i{width:7px;height:7px;border-radius:4px;display:block;}
.tripc-dots i.tripc-dot-on{width:24px;}
.tripc-chip{display:flex;align-items:center;gap:9px;height:34px;padding:0 13px;border-radius:17px;
  white-space:nowrap;}
.tripc-chip i{width:9px;height:9px;border-radius:5px;display:block;}
.tripc-chip span{font-size:clamp(10px,0.78vw,13px);font-weight:600;letter-spacing:1.3px;}
.tripc-clock{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);
  text-align:center;white-space:nowrap;pointer-events:none;}
.tripc-clock-time{font-size:clamp(20px,1.9vw,34px);font-weight:600;line-height:1;letter-spacing:0.5px;}
.tripc-clock-date{font-size:clamp(10px,0.75vw,13px);margin-top:2px;}

.tripc-cap{font-size:clamp(9px,0.68vw,11px);font-weight:600;letter-spacing:1.8px;}

.tripc-body{flex:1 1 auto;min-height:0;display:flex;gap:clamp(10px,1.1vw,18px);}

/* SOL — halka sahnesi */
.tripc-stage{flex:1 1 auto;min-width:0;box-sizing:border-box;border-radius:18px;
  padding:clamp(10px,1.4vh,20px);display:flex;flex-direction:column;align-items:center;
  gap:clamp(6px,1vh,14px);}
.tripc-ring-wrap{flex:1 1 auto;min-height:0;width:100%;display:flex;align-items:center;
  justify-content:center;}
.tripc-ring{height:100%;max-height:100%;width:auto;max-width:100%;}
.tripc-ring-num{font-family:'Saira Condensed','Saira',sans-serif;font-size:96px;font-weight:700;}
.tripc-stage-stats{flex:0 0 auto;display:flex;align-items:stretch;gap:clamp(14px,2vw,40px);}
.tripc-stat{display:flex;flex-direction:column;align-items:center;gap:4px;}
.tripc-stat-rule{width:1px;align-self:stretch;}
.tripc-stat-num{display:flex;align-items:baseline;gap:6px;font-weight:700;line-height:1;
  font-size:clamp(22px,2.3vw,42px);white-space:nowrap;}
.tripc-stat-num i{font-style:normal;font-weight:400;font-size:clamp(11px,1vw,18px);}
.tripc-stat-label{font-size:clamp(9px,0.72vw,12px);letter-spacing:1.1px;text-transform:uppercase;
  white-space:nowrap;}
.tripc-legend{flex:0 0 auto;display:flex;align-items:center;gap:clamp(10px,1.4vw,26px);
  font-size:clamp(10px,0.8vw,13px);white-space:nowrap;overflow:hidden;}
.tripc-legend i{display:inline-block;width:9px;height:9px;border-radius:3px;margin-right:6px;}

/* SAĞ sütun */
.tripc-side{flex:0 0 clamp(300px,27vw,440px);display:flex;flex-direction:column;
  gap:clamp(8px,1vh,14px);min-height:0;}
.tripc-card{flex:1 1 0;min-height:0;box-sizing:border-box;border-radius:16px;
  padding:clamp(9px,1.2vh,16px) clamp(12px,1.1vw,20px);display:flex;flex-direction:column;
  justify-content:center;gap:clamp(5px,0.8vh,10px);}

.tripc-speed-row{display:flex;align-items:baseline;justify-content:space-between;gap:10px;}
.tripc-speed-main{display:flex;align-items:baseline;gap:6px;}
.tripc-speed-num{font-weight:700;line-height:1;font-size:clamp(26px,2.5vw,46px);}
.tripc-speed-main i{font-style:normal;font-weight:400;font-size:clamp(11px,0.95vw,17px);}
.tripc-speed-cap{font-size:clamp(9px,0.7vw,11px);letter-spacing:1.1px;white-space:nowrap;}

.tripc-band{position:relative;height:clamp(8px,1vh,12px);border-radius:6px;overflow:hidden;}
.tripc-band-fill{display:block;height:100%;border-radius:6px;}
.tripc-band-split{display:flex;height:100%;width:100%;}
.tripc-band-split span{display:block;height:100%;}
.tripc-band-mark{position:absolute;top:-3px;width:2px;height:calc(100% + 6px);border-radius:1px;
  transform:translateX(-1px);}
.tripc-band-foot{display:flex;justify-content:space-between;gap:10px;
  font-size:clamp(9px,0.74vw,12px);white-space:nowrap;}

/* panel içi ölçüm hücreleri */
.tripc-grid3{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));
  gap:clamp(6px,0.7vw,14px);align-items:end;}
.tripc-cell{min-width:0;}
.tripc-cell-num{display:flex;align-items:baseline;gap:4px;font-weight:700;line-height:1;
  font-size:clamp(17px,1.65vw,29px);white-space:nowrap;}
.tripc-cell--lg .tripc-cell-num{font-size:clamp(21px,2vw,36px);}
.tripc-cell-num i{font-style:normal;font-weight:400;font-size:clamp(9px,0.72vw,12px);}
.tripc-cell-label{margin-top:3px;font-size:clamp(9px,0.72vw,12px);white-space:nowrap;
  overflow:hidden;text-overflow:ellipsis;}
.tripc-cell-src{font-size:clamp(8px,0.62vw,10px);letter-spacing:0.5px;white-space:nowrap;
  overflow:hidden;text-overflow:ellipsis;}

/* ince alt satır (sürüş olayları · başlangıç-bitiş) */
.tripc-inline{display:flex;justify-content:space-between;gap:10px;padding-top:clamp(4px,0.6vh,8px);
  font-size:clamp(10px,0.78vw,13px);white-space:nowrap;}
.tripc-inline b{font-weight:700;margin-left:5px;font-size:clamp(12px,0.95vw,16px);}

/* BOŞ */
.tripc-empty{flex:1 1 auto;min-height:0;border-radius:18px;display:flex;flex-direction:column;
  align-items:center;justify-content:center;text-align:center;padding:20px;gap:clamp(8px,1.3vh,16px);}
.tripc-empty-icon{width:clamp(70px,7.5vh,110px);height:clamp(70px,7.5vh,110px);border-radius:50%;
  display:flex;align-items:center;justify-content:center;}
.tripc-empty-title{margin:0;font-size:clamp(22px,2.6vw,42px);font-weight:700;line-height:1.1;}
.tripc-empty-text{margin:0;max-width:640px;font-size:clamp(12px,1vw,17px);line-height:1.6;}

/* ALT */
.tripc-bottom{flex:0 0 auto;display:flex;gap:clamp(8px,0.9vw,16px);align-items:center;}
.tripc-home{flex:0 0 auto;min-width:150px;min-height:50px;border:0;border-radius:13px;cursor:pointer;
  padding:0 clamp(12px,1.1vw,18px);display:flex;align-items:center;justify-content:center;gap:9px;
  font-family:inherit;}
.tripc-home:active{filter:brightness(0.94);}
.tripc-home-title{font-size:clamp(13px,1vw,17px);font-weight:700;}
.tripc-foot-note{flex:1 1 auto;min-width:0;font-size:clamp(9px,0.7vw,11px);text-align:right;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}

@media (max-width:1100px){
  .tripc-side{flex-basis:264px;}
  .tripc-clock{position:static;transform:none;text-align:right;}
  .tripc-clock-time{font-size:clamp(16px,1.5vw,21px);}
  .tripc-ring-num{font-size:74px;}
}
@media (max-width:820px){
  .tripc-body{flex-direction:column;}
  .tripc-side{flex:0 0 auto;}
  .tripc-title,.tripc-clock-date,.tripc-foot-note,.tripc-cell-src{display:none;}
}
`;

export default TripComputerScreen;
