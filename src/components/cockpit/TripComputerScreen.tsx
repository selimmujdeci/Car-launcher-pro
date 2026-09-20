/**
 * TripComputerScreen — YOLCULUK BİLGİSAYARI sayfasının SUNUMU.
 *
 * Platformdan TAMAMEN bağımsızdır: prop alır, JSX döner.
 *
 * ── BU EKRAN OBD EKRANI DEĞİLDİR ──────────────────────────────────────────
 * OBD sayfası "araç şu anda teknik olarak ne yapıyor" sorusunu yanıtlar.
 * Burası "bu yolculuk nasıl geçiyor/geçti" sorusunu yanıtlar. Bu yüzden
 * tek bir PID gösterilmez; yalnız yolculuk ölçümleri vardır.
 *
 * ── HİYERARŞİ ─────────────────────────────────────────────────────────────
 *   ÜÇ ANA DEĞER   mesafe · süre · ortalama hız — uzaktan okunur
 *   İKİNCİL        maksimum hız · yakıt · tüketim · maliyet
 *   ZAMAN BİLEŞİMİ tek geniş çubuk: hareket / duruş / ÖLÇÜLEMEYEN
 *   ALT            duruş sayısı · başlangıç · Ana Sayfa
 *
 * ── HIZ GRAFİĞİ NEDEN YOK ─────────────────────────────────────────────────
 * Referansta yolculuk boyunca bir hız grafiği vardı. Bu kod tabanında
 * yolculuk uzunluğunda hız geçmişi TUTULMUYOR: `navigationService`teki
 * `_speedHistory` 30 saniyelik yuvarlanan bir penceredir ve sürekli
 * budanır. Grafik çizmek yeni bir telemetri/geçmiş sistemi kurmayı
 * gerektirirdi — bu görevin sınırları dışındadır. Sahte bir eğri çizmek
 * yerine yeri GERÇEKTEN ÖLÇÜLEN zaman bileşimine verildi.
 *
 * ── DÜRÜSTLÜK ─────────────────────────────────────────────────────────────
 * Her değer kaynağıyla birlikte gelir (`Metric.source`). Ölçülmemiş alan
 * sayı DEĞİL durum gösterir; tahmini değer ölçülen gibi sunulmaz.
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
 * Tema token'ları — OBD sayfasıyla AYNI aile (tek CarOS dili)
 * ════════════════════════════════════════════════════════════════════════ */

interface Tokens {
  bg: string; panel: string; panelMuted: string; line: string;
  txt: string; txt2: string; txt3: string; dash: string;
  track: string; accent: string; onAccent: string;
  moving: string; idle: string; unknown: string;
  okSoftBg: string; okSoftLine: string; ok: string;
}

const NIGHT: Tokens = {
  bg: '#06080A', panel: '#0D1116', panelMuted: '#0A0E12', line: '#1E262F',
  txt: '#E9F1F7', txt2: '#7C8B99', txt3: '#56646F', dash: '#39434D',
  track: '#161E26', accent: '#4FE0C8', onAccent: '#04211D',
  moving: '#4FE0C8', idle: '#5A8BD6', unknown: '#3A4550',
  okSoftBg: 'rgba(82,217,138,0.10)', okSoftLine: 'rgba(82,217,138,0.34)', ok: '#52D98A',
};

const DAY: Tokens = {
  bg: '#E7EAEE', panel: '#F7F9FA', panelMuted: '#EFF2F5', line: '#CDD3DA',
  txt: '#10151A', txt2: '#525E6B', txt3: '#68747F', dash: '#A6AFB8',
  track: '#E1E5EA', accent: '#0E9E8C', onAccent: '#FFFFFF',
  moving: '#0E9E8C', idle: '#3E6FB0', unknown: '#AAB3BC',
  okSoftBg: 'rgba(18,121,63,0.10)', okSoftLine: 'rgba(18,121,63,0.32)', ok: '#12793F',
};

/* ══════════════════════════════════════════════════════════════════════════
 * Dürüst biçimlendirme
 * ════════════════════════════════════════════════════════════════════════ */

/** Kaynak rozetinde ne yazar — ÖLÇÜLEN ile TAHMİNİ karışmaz. */
const SOURCE_LABEL: Record<string, string> = {
  MEASURED:    'ölçülen',
  DERIVED:     'hesaplanan',
  ESTIMATED:   'tahmini',
  UNAVAILABLE: 'yok',
};

function fmt(m: Metric, digits = 0): string {
  if (!has(m)) return '—';
  return m.value!.toLocaleString('tr-TR', {
    minimumFractionDigits: digits, maximumFractionDigits: digits,
  });
}

function fmtClock(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms) || ms <= 0) return '—';
  try {
    return new Date(ms).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', hour12: false });
  } catch { return '—'; }
}

/* ══════════════════════════════════════════════════════════════════════════
 * Parçalar
 * ════════════════════════════════════════════════════════════════════════ */

/** ANA DEĞER — uzaktan okunur; kaynağı altında küçük yazar. */
function Hero(props: {
  readonly label: string; readonly value: string; readonly unit: string;
  readonly source: string; readonly t: Tokens; readonly testId: string;
  readonly known: boolean;
}): React.ReactElement {
  const { label, value, unit, source, t, testId, known } = props;
  return (
    <div className="tripc-hero" data-trip-hero={testId} data-trip-source={source}
      style={{ background: t.panel, border: `1px solid ${t.line}` }}>
      <div className="tripc-hero-label" style={{ color: t.txt3 }}>{label}</div>
      <div className="tripc-hero-value" style={{ color: known ? t.txt : t.dash }}>
        <span data-trip-value={testId}>{value}</span>
        {known && <i style={{ color: t.txt2 }}>{unit}</i>}
      </div>
      <div className="tripc-hero-src" style={{ color: t.txt3 }}>
        {known ? SOURCE_LABEL[source] : 'ölçüm yok'}
      </div>
    </div>
  );
}

/** İKİNCİL değer — daha küçük ama rahat okunur. */
function Cell(props: {
  readonly label: string; readonly metric: Metric; readonly unit: string;
  readonly digits?: number; readonly t: Tokens; readonly testId: string;
  readonly prefix?: string;
}): React.ReactElement {
  const { label, metric, unit, digits = 0, t, testId, prefix } = props;
  const known = has(metric);
  return (
    <div className="tripc-cell" data-trip-cell={testId} data-trip-source={metric.source}
      style={{ background: t.panel, border: `1px solid ${t.line}` }}>
      <div className="tripc-cell-label" style={{ color: t.txt2 }}>{label}</div>
      <div className="tripc-cell-value" style={{ color: known ? t.txt : t.dash }}>
        {known && prefix ? <span className="tripc-prefix" style={{ color: t.txt2 }}>{prefix}</span> : null}
        <span data-trip-value={testId}>{fmt(metric, digits)}</span>
        {known && <i style={{ color: t.txt2 }}>{unit}</i>}
      </div>
      <div className="tripc-cell-src" style={{ color: t.txt3 }}>
        {known ? SOURCE_LABEL[metric.source] : 'ölçüm yok'}
      </div>
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

  const durationText = formatDuration(has(m.durationMin) ? m.durationMin.value : null);
  const comp = timeComposition(m);
  const cons = consumptionL100(m);

  const stateLabel = state.view === 'active' ? 'SÜREN YOLCULUK' : 'SON YOLCULUK';

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
              background: state.view === 'active' ? t.okSoftBg : 'transparent',
              border: `1px solid ${state.view === 'active' ? t.okSoftLine : t.line}`,
            }}>
            {state.view === 'active' && <i style={{ background: t.ok }} />}
            <span style={{ color: state.view === 'active' ? t.ok : t.txt2 }}>{stateLabel}</span>
          </div>
        )}

        {/* Saat ve tarih — üst çubuğun gerçek ortasında. */}
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
        <>
          {/* ── ÜÇ ANA DEĞER ────────────────────────────────────────────── */}
          <section className="tripc-heroes">
            <Hero label="Gidilen Mesafe" testId="distance" t={t}
              value={fmt(m.distanceKm, 1)} unit="km"
              source={m.distanceKm.source} known={has(m.distanceKm)} />
            <Hero label="Yolculuk Süresi" testId="duration" t={t}
              value={durationText ?? '—'} unit=""
              source={m.durationMin.source} known={durationText !== null} />
            <Hero label="Ortalama Hız" testId="avgSpeed" t={t}
              value={fmt(m.averageSpeedKmh)} unit="km/s"
              source={m.averageSpeedKmh.source} known={has(m.averageSpeedKmh)} />
          </section>

          {/* ── İKİNCİL DEĞERLER ───────────────────────────────────────── */}
          <section className="tripc-cells">
            <Cell label="Maksimum Hız"     metric={m.maximumSpeedKmh} unit="km/s" t={t} testId="maxSpeed" />
            <Cell label="Kullanılan Yakıt" metric={m.fuelUsedL} unit="L" digits={2} t={t} testId="fuelUsed" />
            <Cell label="Ortalama Tüketim" metric={cons} unit="L/100km" digits={1} t={t} testId="consumption" />
            <Cell label="Yolculuk Maliyeti" metric={m.estimatedCost} unit={state.currency ?? ''}
              digits={2} t={t} testId="cost" />
          </section>

          {/* ── ZAMAN BİLEŞİMİ — sahte grafik yerine GERÇEK ölçüm ───────── */}
          <section className="tripc-time" style={{ background: t.panel, border: `1px solid ${t.line}` }}>
            <div className="tripc-time-head">
              <span className="tripc-cap" style={{ color: t.txt3 }}>ZAMAN BİLEŞİMİ</span>
              <span className="tripc-time-legend">
                <span style={{ color: t.txt2 }}><i style={{ background: t.moving }} />Hareket {formatDuration(comp.movingMin) ?? '—'}</span>
                <span style={{ color: t.txt2 }}><i style={{ background: t.idle }} />Duruş {formatDuration(comp.idleMin) ?? '—'}</span>
                {comp.unknownMin > 0 && (
                  <span style={{ color: t.txt2 }}><i style={{ background: t.unknown }} />Ölçülemeyen {formatDuration(comp.unknownMin) ?? '—'}</span>
                )}
              </span>
            </div>

            {comp.measured && comp.totalMin > 0 ? (
              <div className="tripc-bar" data-trip-bar="" style={{ background: t.track }}>
                <span style={{ width: `${(comp.movingMin / comp.totalMin) * 100}%`, background: t.moving }} />
                <span style={{ width: `${(comp.idleMin / comp.totalMin) * 100}%`, background: t.idle }} />
                <span style={{ width: `${(comp.unknownMin / comp.totalMin) * 100}%`, background: t.unknown }} />
              </div>
            ) : (
              /* Ölçüm yoksa BOŞ çubuk çizilmez — sahte doluluk üretilmez. */
              <div className="tripc-bar-none" style={{ color: t.txt3 }}>
                Süre bileşimi bu yolculuk için ölçülmedi
              </div>
            )}

            <div className="tripc-time-foot">
              <span style={{ color: t.txt2 }}>
                Duruş sayısı <strong data-trip-value="stopCount" style={{ color: has(m.stopCount) ? t.txt : t.dash }}>{fmt(m.stopCount)}</strong>
              </span>
              <span style={{ color: t.txt2 }}>
                Başlangıç <strong data-trip-value="startedAt" style={{ color: t.txt }}>{fmtClock(state.startedAtMs)}</strong>
              </span>
              {state.endedAtMs !== null && (
                <span style={{ color: t.txt2 }}>
                  Bitiş <strong style={{ color: t.txt }}>{fmtClock(state.endedAtMs)}</strong>
                </span>
              )}
              {state.priceSource !== null && (
                <span style={{ color: t.txt3 }} data-trip-price-source="">
                  Yakıt fiyatı: {state.priceSource}
                </span>
              )}
            </div>
          </section>
        </>
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
          Her değer kaynağıyla gösterilir · ölçülmeyen alan sayı yerine durum taşır
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
  gap:clamp(10px,1.4vh,18px);padding:clamp(12px,2vh,24px) clamp(16px,2vw,32px);
  font-family:'Saira','Segoe UI',system-ui,sans-serif;overflow:hidden;
  font-variant-numeric:tabular-nums;}

.tripc-top{position:relative;flex:0 0 auto;display:flex;align-items:center;
  gap:clamp(10px,1.3vw,22px);min-height:42px;}
.tripc-brand{display:flex;align-items:center;gap:clamp(8px,0.8vw,13px);min-width:0;}
.tripc-wordmark{font-size:clamp(15px,1.3vw,22px);font-weight:700;letter-spacing:3.4px;}
.tripc-title{margin:0;font-size:clamp(10px,0.9vw,15px);font-weight:500;letter-spacing:1.6px;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.tripc-sep{width:1px;height:24px;flex:0 0 auto;}
.tripc-spacer{flex:1 1 auto;}
.tripc-dots{display:flex;align-items:center;gap:8px;}
.tripc-dots i{width:7px;height:7px;border-radius:4px;display:block;}
.tripc-dots i.tripc-dot-on{width:24px;}
.tripc-chip{display:flex;align-items:center;gap:9px;height:36px;padding:0 14px;border-radius:18px;
  white-space:nowrap;}
.tripc-chip i{width:9px;height:9px;border-radius:5px;display:block;}
.tripc-chip span{font-size:clamp(10px,0.8vw,13px);font-weight:600;letter-spacing:1.3px;}
.tripc-clock{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);
  text-align:center;white-space:nowrap;pointer-events:none;}
.tripc-clock-time{font-size:clamp(20px,1.9vw,34px);font-weight:600;line-height:1;
  letter-spacing:0.5px;}
.tripc-clock-date{font-size:clamp(10px,0.75vw,13px);margin-top:2px;}

.tripc-cap{font-size:clamp(9px,0.68vw,11px);font-weight:600;letter-spacing:1.8px;}

/* ÜÇ ANA DEĞER */
.tripc-heroes{flex:1 1 auto;min-height:0;display:grid;
  grid-template-columns:repeat(3,minmax(0,1fr));gap:clamp(10px,1.1vw,18px);}
.tripc-hero{box-sizing:border-box;border-radius:16px;min-width:0;display:flex;
  flex-direction:column;align-items:center;justify-content:center;
  gap:clamp(4px,0.8vh,10px);padding:clamp(10px,1.4vh,20px);}
.tripc-hero-label{font-size:clamp(11px,0.95vw,16px);letter-spacing:0.6px;text-align:center;}
.tripc-hero-value{display:flex;align-items:baseline;gap:8px;font-weight:700;line-height:1;
  font-size:clamp(38px,5.2vw,96px);white-space:nowrap;}
.tripc-hero-value i{font-style:normal;font-weight:400;font-size:clamp(13px,1.3vw,24px);}
.tripc-hero-src{font-size:clamp(9px,0.72vw,12px);letter-spacing:1px;text-transform:uppercase;}

/* İKİNCİL */
.tripc-cells{flex:0 0 auto;display:grid;grid-template-columns:repeat(4,minmax(0,1fr));
  gap:clamp(8px,1vw,16px);}
.tripc-cell{box-sizing:border-box;border-radius:14px;min-width:0;padding:clamp(8px,1.1vh,14px)
  clamp(10px,1vw,18px);display:flex;flex-direction:column;gap:clamp(3px,0.5vh,6px);}
.tripc-cell-label{font-size:clamp(10px,0.82vw,14px);white-space:nowrap;overflow:hidden;
  text-overflow:ellipsis;}
.tripc-cell-value{display:flex;align-items:baseline;gap:5px;font-weight:700;line-height:1;
  font-size:clamp(20px,2.1vw,40px);white-space:nowrap;}
.tripc-cell-value i{font-style:normal;font-weight:400;font-size:clamp(10px,0.85vw,15px);}
.tripc-prefix{font-weight:400;font-size:clamp(12px,1vw,18px);}
.tripc-cell-src{font-size:clamp(8px,0.65vw,11px);letter-spacing:0.9px;text-transform:uppercase;}

/* ZAMAN BİLEŞİMİ */
.tripc-time{flex:0 0 auto;box-sizing:border-box;border-radius:14px;
  padding:clamp(9px,1.2vh,16px) clamp(12px,1.2vw,20px);display:flex;flex-direction:column;
  gap:clamp(6px,0.9vh,12px);}
.tripc-time-head{display:flex;align-items:center;justify-content:space-between;gap:12px;}
.tripc-time-legend{display:flex;align-items:center;gap:clamp(10px,1.2vw,22px);
  font-size:clamp(10px,0.82vw,14px);white-space:nowrap;overflow:hidden;}
.tripc-time-legend i{display:inline-block;width:9px;height:9px;border-radius:3px;
  margin-right:6px;vertical-align:baseline;}
.tripc-bar{height:clamp(10px,1.3vh,18px);border-radius:6px;overflow:hidden;display:flex;}
.tripc-bar span{display:block;height:100%;}
.tripc-bar-none{font-size:clamp(10px,0.82vw,13px);padding:6px 0;}
.tripc-time-foot{display:flex;align-items:center;gap:clamp(12px,1.6vw,30px);
  font-size:clamp(10px,0.82vw,14px);white-space:nowrap;overflow:hidden;}
.tripc-time-foot strong{font-weight:600;margin-left:5px;}

/* BOŞ */
.tripc-empty{flex:1 1 auto;min-height:0;border-radius:18px;display:flex;flex-direction:column;
  align-items:center;justify-content:center;text-align:center;padding:20px;
  gap:clamp(8px,1.3vh,16px);}
.tripc-empty-icon{width:clamp(70px,7.5vh,110px);height:clamp(70px,7.5vh,110px);border-radius:50%;
  display:flex;align-items:center;justify-content:center;}
.tripc-empty-title{margin:0;font-size:clamp(22px,2.6vw,42px);font-weight:700;line-height:1.1;}
.tripc-empty-text{margin:0;max-width:640px;font-size:clamp(12px,1vw,17px);line-height:1.6;}

/* ALT */
.tripc-bottom{flex:0 0 auto;display:flex;gap:clamp(8px,0.9vw,16px);align-items:center;}
.tripc-home{flex:0 0 auto;min-width:150px;min-height:52px;border:0;border-radius:13px;
  cursor:pointer;padding:0 clamp(12px,1.1vw,18px);display:flex;align-items:center;
  justify-content:center;gap:9px;font-family:inherit;}
.tripc-home:active{filter:brightness(0.94);}
.tripc-home-title{font-size:clamp(13px,1vw,17px);font-weight:700;}
.tripc-foot-note{flex:1 1 auto;min-width:0;font-size:clamp(9px,0.7vw,11px);text-align:right;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}

@media (max-width:1100px){
  .tripc-cells{grid-template-columns:repeat(2,minmax(0,1fr));}
  .tripc-clock{position:static;transform:none;text-align:right;}
  .tripc-clock-time{font-size:clamp(16px,1.5vw,21px);}
  .tripc-time-legend{font-size:11px;gap:10px;}
}
@media (max-width:820px){
  .tripc-heroes{grid-template-columns:1fr;}
  .tripc-title,.tripc-clock-date,.tripc-foot-note{display:none;}
}
`;

export default TripComputerScreen;
