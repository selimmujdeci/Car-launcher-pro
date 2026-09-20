/**
 * ObdLiveScreen — OBD CANLI VERİLERİ sayfasının SUNUMU.
 *
 * Platformdan TAMAMEN bağımsızdır: prop alır, JSX döner. Hiçbir servise,
 * store'a ya da native köprüye dokunmaz — bağlama `ObdLivePage.tsx`tedir.
 *
 * ── TASARIM KARARI: HİYERARŞİ ─────────────────────────────────────────────
 * Sürüş sırasında bakılan bir ekranda her şeyin aynı büyüklükte olması
 * hiyerarşiyi yok eder ve tarama süresini uzatır. Üç kademe vardır:
 *   1) KAHRAMAN  — motor devri + araç hızı (tek bakışta)
 *   2) İKİNCİL   — altı ölçüm kartı; DESTEKLİ olanlar dolu, olmayanlar
 *                  kesikli ve sönük — yani göz onları atlar
 *   3) ALT ŞERİT — ANA SAYFA · arıza kodları · veri kalitesi
 *
 * ── DÜRÜSTLÜK ─────────────────────────────────────────────────────────────
 * Sayı YALNIZ gerçek ölçüm varken çizilir. `Desteklenmiyor` · `Henüz
 * okunmadı` · `Gecikmiş` · `Bağlı değil` ayrı ayrı gösterilir; hiçbiri `0`
 * ile karıştırılmaz. Kararların sahibi `obdLiveModel.ts`tir.
 *
 * ── GÜN/GECE ──────────────────────────────────────────────────────────────
 * Geometri İKİ TEMADA DA AYNIDIR; yalnız renk token'ları değişir. Tema
 * kararı buraya `mode` propuyla gelir (CarOS'un tek otoritesi
 * `settings.dayNightMode`); bu dosya kendi tema kaynağını KURMAZ.
 */

import { memo } from 'react';
import type { ObdLiveState } from './useObdLiveData';
import { fillRatio, hasNumber, type Reading } from './obdLiveModel';

export type ObdMode = 'day' | 'night';

export interface ObdLiveScreenProps {
  readonly state: ObdLiveState;
  readonly mode: ObdMode;
  readonly clock: { readonly time: string; readonly date: string };
  /** Sürücünün ana ekrana dönüşü — sayfa kendi gezinmesine sahip değildir. */
  readonly onHome: () => void;
  /** Arıza taraması — sayfa taramayı KENDİ başlatmaz, sahibine devreder. */
  readonly onScanDtc?: () => void;
}

/* ══════════════════════════════════════════════════════════════════════════
 * Tema token'ları — geometri değil, YALNIZ renk
 * ════════════════════════════════════════════════════════════════════════ */

interface Tokens {
  bg: string; panel: string; panelMuted: string; line: string; lineDash: string;
  txt: string; txt2: string; txt3: string; tick: string; dash: string;
  track: string; trackEmpty: string; accent: string; onAccent: string;
  ok: string; warn: string; danger: string; okSoftBg: string; okSoftLine: string;
  warnSoftBg: string; warnSoftLine: string;
}

const NIGHT: Tokens = {
  bg: '#06080A', panel: '#0D1116', panelMuted: '#0A0E12', line: '#1E262F', lineDash: '#202832',
  txt: '#E9F1F7', txt2: '#7C8B99', txt3: '#56646F', tick: '#4A5763', dash: '#39434D',
  track: '#161E26', trackEmpty: '#11171D', accent: '#4FE0C8', onAccent: '#04211D',
  ok: '#52D98A', warn: '#F5B544', danger: '#FF5F52',
  okSoftBg: 'rgba(82,217,138,0.10)', okSoftLine: 'rgba(82,217,138,0.34)',
  warnSoftBg: 'rgba(245,181,68,0.12)', warnSoftLine: 'rgba(245,181,68,0.34)',
};

const DAY: Tokens = {
  bg: '#EDEFF2', panel: '#FFFFFF', panelMuted: '#F3F5F8', line: '#D2D8DF', lineDash: '#C6CDD5',
  txt: '#10151A', txt2: '#525E6B', txt3: '#68747F', tick: '#78838E', dash: '#A6AFB8',
  track: '#E1E5EA', trackEmpty: '#E7EAEE', accent: '#0E9E8C', onAccent: '#FFFFFF',
  ok: '#12793F', warn: '#A96800', danger: '#C0392C',
  okSoftBg: 'rgba(18,121,63,0.10)', okSoftLine: 'rgba(18,121,63,0.32)',
  warnSoftBg: 'rgba(169,104,0,0.10)', warnSoftLine: 'rgba(169,104,0,0.32)',
};

/* ══════════════════════════════════════════════════════════════════════════
 * Dürüst biçimlendirme
 * ════════════════════════════════════════════════════════════════════════ */

const STATE_LABEL: Record<Reading['state'], string> = {
  live:        'Canlı',
  stale:       'Gecikmiş',
  unsupported: 'Desteklenmiyor',
  unread:      'Henüz okunmadı',
  offline:     'Bağlı değil',
};

/** Ölçüm sayısı ya da `—`. SIFIR ASLA UYDURULMAZ. */
function num(r: Reading, digits = 0): string {
  if (!hasNumber(r)) return '—';
  return r.value!.toLocaleString('tr-TR', {
    minimumFractionDigits: digits, maximumFractionDigits: digits,
  });
}

function stateColor(r: Reading, t: Tokens): string {
  if (r.state === 'live')  return t.txt;
  if (r.state === 'stale') return t.warn;
  return t.dash;
}

/* ══════════════════════════════════════════════════════════════════════════
 * Yardımcı parçalar
 * ════════════════════════════════════════════════════════════════════════ */

/** 250° süpürmeli radyal gösterge. r=104 · çevre 653.5 · yay 453.8. */
const ARC_LEN = 453.8;
const CIRC = 653.5;

function Gauge(props: {
  readonly reading: Reading; readonly max: number; readonly unit: string;
  readonly labels: readonly string[]; readonly redlineFrom?: number;
  readonly t: Tokens; readonly testId: string; readonly aria: string;
}): React.ReactElement {
  const { reading, max, unit, labels, redlineFrom, t, testId, aria } = props;
  const ratio = fillRatio(reading, 0, max);
  const valueLen = ratio === null ? 0 : Math.max(ratio > 0 ? 2 : 0, ratio * ARC_LEN);
  const redOffset = redlineFrom === undefined ? 0 : (redlineFrom / max) * ARC_LEN;
  const redLen = redlineFrom === undefined ? 0 : ARC_LEN - redOffset;
  const pos = [
    { x: 64.5, y: 180 }, { x: 59, y: 97 }, { x: 130, y: 54 },
    { x: 201, y: 97 }, { x: 195.5, y: 180 },
  ];

  return (
    <svg viewBox="0 0 260 246" role="img" aria-label={aria} className="obdlive-gauge">
      <g transform="rotate(145 130 130)">
        <circle cx="130" cy="130" r="104" fill="none" stroke={t.track} strokeWidth="15"
          strokeLinecap="round" strokeDasharray={`${ARC_LEN} ${CIRC}`} />
        {redLen > 0 && (
          <circle cx="130" cy="130" r="104" fill="none" stroke={t.danger} strokeWidth="15"
            strokeDasharray={`${redLen} ${CIRC}`} strokeDashoffset={-redOffset} opacity="0.85" />
        )}
        {valueLen > 0 && (
          <circle cx="130" cy="130" r="104" fill="none" stroke={t.accent} strokeWidth="15"
            strokeLinecap="round" strokeDasharray={`${valueLen} ${CIRC}`} />
        )}
      </g>
      {labels.map((l, i) => (
        <text key={l + String(i)} x={pos[i]!.x} y={pos[i]!.y} fontSize="13" textAnchor="middle"
          fill={redlineFrom !== undefined && i === labels.length - 1 ? t.danger : t.tick}>{l}</text>
      ))}
      <text data-obd-value={testId} x="130" y="140" fontSize="66" fontWeight="700"
        textAnchor="middle" fill={stateColor(reading, t)} className="obdlive-gauge-num">
        {num(reading)}
      </text>
      <text x="130" y="166" fontSize="15" textAnchor="middle" fill={t.txt2} letterSpacing="1.5">
        {hasNumber(reading) ? unit : STATE_LABEL[reading.state]}
      </text>
    </svg>
  );
}

/** Kanonik `lastSeenMs` → saat. 0/geçersiz ise UYDURULMAZ. */
function fmtClockMs(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '—';
  try {
    return new Date(ms).toLocaleTimeString('tr-TR', { hour12: false });
  } catch { return '—'; }
}

/** Sayısal olmayan gövde durumu kartı (kapılar · TPMS). */
function StatusTile(props: {
  readonly label: string; readonly text: string; readonly note: string;
  readonly known: boolean; readonly ok: boolean; readonly t: Tokens; readonly testId: string;
}): React.ReactElement {
  const { label, text, note, known, ok, t, testId } = props;
  return (
    <div className="obdlive-tile" data-obd-tile={testId} data-obd-state={known ? 'live' : 'unread'}
      style={{
        background: known ? t.panel : t.panelMuted,
        border: `1px ${known ? 'solid' : 'dashed'} ${known ? t.line : t.lineDash}`,
      }}>
      <div className="obdlive-tile-label" style={{ color: known ? t.txt2 : t.txt3 }}>{label}</div>
      <div className="obdlive-tile-value" style={{ fontSize: 'clamp(16px,1.6vw,30px)', color: known ? t.txt : t.dash }}>
        <span data-obd-value={testId}>{text}</span>
      </div>
      <div className="obdlive-bar" style={{ background: known ? t.track : t.trackEmpty }}>
        {known && <div className="obdlive-bar-fill" style={{ width: '100%', background: ok ? t.ok : t.warn }} />}
      </div>
      <div className="obdlive-tile-state" style={{ color: known ? t.txt3 : t.warn }}>{note}</div>
    </div>
  );
}

/** İkincil ölçüm kartı — desteklenmeyen alan KESİKLİ ve SÖNÜK çizilir. */
function Tile(props: {
  readonly label: string; readonly reading: Reading; readonly unit: string;
  readonly min: number; readonly max: number; readonly digits?: number;
  readonly t: Tokens; readonly testId: string;
}): React.ReactElement {
  const { label, reading, unit, min, max, digits = 0, t, testId } = props;
  const ratio = fillRatio(reading, min, max);
  const muted = reading.state === 'unsupported' || reading.state === 'offline';

  return (
    <div className="obdlive-tile" data-obd-tile={testId} data-obd-state={reading.state}
      style={{
        background: muted ? t.panelMuted : t.panel,
        border: `1px ${muted ? 'dashed' : 'solid'} ${muted ? t.lineDash : t.line}`,
      }}>
      <div className="obdlive-tile-label" style={{ color: muted ? t.txt3 : t.txt2 }}>{label}</div>
      <div className="obdlive-tile-value" style={{ color: stateColor(reading, t) }}>
        <span data-obd-value={testId}>{num(reading, digits)}</span>
        {hasNumber(reading) && <span className="obdlive-tile-unit" style={{ color: t.txt2 }}>{unit}</span>}
      </div>
      <div className="obdlive-bar" style={{ background: ratio === null ? t.trackEmpty : t.track }}>
        {ratio !== null && (
          <div className="obdlive-bar-fill" style={{ width: `${ratio * 100}%`, background: t.accent }} />
        )}
      </div>
      <div className="obdlive-tile-state" style={{
        color: reading.state === 'live' ? t.txt3
          : reading.state === 'stale' ? t.warn
            : reading.state === 'unread' ? t.warn : t.txt3,
      }}>
        {STATE_LABEL[reading.state].toLocaleUpperCase('tr-TR')}
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
 * Ekran
 * ════════════════════════════════════════════════════════════════════════ */

export const ObdLiveScreen = memo(function ObdLiveScreen(
  { state, mode, clock, onHome, onScanDtc }: ObdLiveScreenProps,
): React.ReactElement {
  const t = mode === 'night' ? NIGHT : DAY;
  const offline = state.link === 'offline';

  const linkLabel = offline ? 'BAĞLI DEĞİL'
    : state.link === 'waiting' ? 'VERİ BEKLENİYOR'
      : state.link === 'stale' ? 'GECİKMİŞ' : 'CANLI';
  const linkColor = offline ? t.txt2
    : state.link === 'live' ? t.ok : t.warn;
  const linkBg = offline ? 'transparent'
    : state.link === 'live' ? t.okSoftBg : t.warnSoftBg;
  const linkLine = offline ? t.line
    : state.link === 'live' ? t.okSoftLine : t.warnSoftLine;

  return (
    <div className="obdlive" data-obd-theme={mode} data-obd-link={state.link}
      style={{ background: t.bg, color: t.txt }}>
      <style>{CSS}</style>

      {/* ── ÜST ÇUBUK ─────────────────────────────────────────────────── */}
      <header className="obdlive-top">
        <div className="obdlive-brand">
          <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke={t.accent}
            strokeWidth="1.6" aria-hidden="true">
            <circle cx="12" cy="12" r="9" /><path d="M12 3v3M12 18v3M3 12h3M18 12h3" />
            <path d="M12 12l4.5-4.5" />
          </svg>
          <span className="obdlive-wordmark">CAROS</span>
          <span className="obdlive-sep" style={{ background: t.line }} />
          <h1 className="obdlive-title" style={{ color: t.txt2 }}>OBD CANLI VERİLERİ</h1>
        </div>

        <div className="obdlive-spacer" />

        <div className="obdlive-dots" role="img" aria-label="Sayfa 3 / 3: OBD">
          <i style={{ background: t.line }} /><i style={{ background: t.line }} />
          <i className="obdlive-dot-on" style={{ background: t.accent }} />
        </div>

        <span className="obdlive-sep" style={{ background: t.line }} />

        <div className="obdlive-chip" data-obd-link-chip=""
          style={{ background: linkBg, border: `1px solid ${linkLine}` }}>
          <i style={{ background: linkColor }} />
          <span style={{ color: linkColor }}>{linkLabel}</span>
        </div>

        <div className="obdlive-clock">
          <div className="obdlive-clock-time">{clock.time}</div>
          <div className="obdlive-clock-date" style={{ color: t.txt3 }}>{clock.date}</div>
        </div>
      </header>

      {offline ? (
        /* ── BAĞLANTI YOK — sahte sıfırlarla dolu gösterge YOK ────────── */
        <section className="obdlive-empty" data-obd-empty=""
          style={{ background: t.panelMuted, border: `1px solid ${t.track}` }}>
          <div className="obdlive-empty-icon" style={{ background: t.panel, border: `1px solid ${t.lineDash}` }}>
            <svg width="58" height="58" viewBox="0 0 24 24" fill="none" stroke={t.tick}
              strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M7 4h10l1.5 5.5a4 4 0 0 1-.6 3.4l-1.7 2.4a3 3 0 0 0-.55 1.73V20H8.35v-2.97a3 3 0 0 0-.55-1.73L6.1 12.9a4 4 0 0 1-.6-3.4Z" />
              <path d="M10 8.5v2M14 8.5v2" />
            </svg>
          </div>
          <h2 className="obdlive-empty-title">OBD bağlantısı bekleniyor</h2>
          <p className="obdlive-empty-text" style={{ color: t.txt2 }}>
            Canlı motor verisi için OBD adaptörünün araca takılı ve kontağın açık olması
            gerekir. Bağlantı kurulduğunda bu sayfa kendiliğinden dolar.
          </p>
          <p className="obdlive-empty-note" style={{ color: t.txt3, border: `1px solid ${t.line}`, background: t.panel }}>
            Bağlantı yokken ölçüm gösterilmez — sıfır değerler gerçek okuma değildir.
          </p>
        </section>
      ) : (
        <>
          {/* ── KAHRAMAN SIRA ───────────────────────────────────────────── */}
          <section className="obdlive-hero">
            <div className="obdlive-panel obdlive-conn" style={{ background: t.panel, border: `1px solid ${t.line}` }}>
              <div className="obdlive-cap" style={{ color: t.txt3 }}>BAĞLANTI</div>
              <div className="obdlive-conn-state" style={{ color: state.link === 'live' ? t.ok : t.warn }}>
                {state.link === 'waiting' ? 'Veri bekleniyor' : state.link === 'stale' ? 'Gecikmiş' : 'Bağlı'}
              </div>
              <div className="obdlive-hr" style={{ background: t.line }} />
              <dl className="obdlive-kv">
                <div><dt style={{ color: t.txt2 }}>Adaptör</dt><dd>{state.deviceName || 'Bilinmiyor'}</dd></div>
                <div><dt style={{ color: t.txt2 }}>Kaynak</dt><dd>{state.source === 'real' ? 'Gerçek ECU' : state.source === 'mock' ? 'Benzetim' : 'Yok'}</dd></div>
                <div><dt style={{ color: t.txt2 }}>Araç tipi</dt><dd>{state.vehicleType.toLocaleUpperCase('tr-TR')}</dd></div>
                <div><dt style={{ color: t.txt2 }}>Son ECU verisi</dt><dd>{fmtClockMs(state.lastSeenMs)}</dd></div>
              </dl>
            </div>

            <div className="obdlive-panel obdlive-gauge-panel" style={{ background: t.panel, border: `1px solid ${t.line}` }}>
              <div className="obdlive-cap" style={{ color: t.txt3 }}>MOTOR DEVRİ</div>
              <Gauge reading={state.rpm} max={8000} unit="d/dk" labels={['0', '2', '4', '6', '8']}
                redlineFrom={6500} t={t} testId="rpm" aria="Motor devri" />
            </div>

            <div className="obdlive-panel obdlive-gauge-panel" style={{ background: t.panel, border: `1px solid ${t.line}` }}>
              <div className="obdlive-cap" style={{ color: t.txt3 }}>ARAÇ HIZI</div>
              <Gauge reading={state.speed} max={260} unit="km/s" labels={['0', '60', '130', '200', '260']}
                t={t} testId="speed" aria="Araç hızı" />
            </div>

            <div className="obdlive-panel obdlive-load" style={{ background: t.panel, border: `1px solid ${t.line}` }}>
              <div className="obdlive-cap" style={{ color: t.txt3 }}>ANLIK YÜK</div>

              <div className="obdlive-meter">
                <div className="obdlive-meter-head">
                  <span style={{ color: t.txt2 }}>Gaz Kelebeği</span>
                  <span className="obdlive-meter-num" style={{ color: stateColor(state.throttle, t) }}>
                    <span data-obd-value="throttle">{num(state.throttle)}</span>
                    {hasNumber(state.throttle) && <i style={{ color: t.txt2 }}>%</i>}
                  </span>
                </div>
                <div className="obdlive-bar" style={{ background: fillRatio(state.throttle, 0, 100) === null ? t.trackEmpty : t.track }}>
                  {fillRatio(state.throttle, 0, 100) !== null && (
                    <div className="obdlive-bar-fill" style={{ width: `${fillRatio(state.throttle, 0, 100)! * 100}%`, background: t.accent }} />
                  )}
                </div>
              </div>

              <div className="obdlive-meter">
                <div className="obdlive-meter-head">
                  <span style={{ color: t.txt2 }}>Yakıt Seviyesi</span>
                  <span className="obdlive-meter-num" style={{ color: stateColor(state.fuelLevel, t) }}>
                    <span data-obd-value="fuelLevel">{num(state.fuelLevel)}</span>
                    {hasNumber(state.fuelLevel) && <i style={{ color: t.txt2 }}>%</i>}
                  </span>
                </div>
                <div className="obdlive-bar" style={{ background: fillRatio(state.fuelLevel, 0, 100) === null ? t.trackEmpty : t.track }}>
                  {fillRatio(state.fuelLevel, 0, 100) !== null && (
                    <div className="obdlive-bar-fill" style={{ width: `${fillRatio(state.fuelLevel, 0, 100)! * 100}%`, background: t.accent }} />
                  )}
                </div>
              </div>

              <div className="obdlive-hr" style={{ background: t.line }} />

              <div className="obdlive-volt">
                <div>
                  <div style={{ color: t.txt2 }}>Akü Voltajı</div>
                  <div className="obdlive-volt-note" style={{ color: t.txt3 }}>
                    {STATE_LABEL[state.batteryVoltage.state]}
                  </div>
                </div>
                <div className="obdlive-volt-num" style={{ color: stateColor(state.batteryVoltage, t) }}>
                  <span data-obd-value="batteryVoltage">{num(state.batteryVoltage, 1)}</span>
                  {hasNumber(state.batteryVoltage) && <i style={{ color: t.txt2 }}>V</i>}
                </div>
              </div>
            </div>
          </section>

          {/* ── İKİNCİL SIRA ────────────────────────────────────────────── */}
          <section className="obdlive-tiles">
            <Tile label="Soğutma Suyu"   reading={state.engineTemp}    unit="°C"  min={-20} max={130} t={t} testId="engineTemp" />
            <Tile label="Emme Havası"    reading={state.intakeTemp}    unit="°C"  min={-20} max={80}  t={t} testId="intakeTemp" />
            <Tile label="Turbo Basıncı"  reading={state.boostPressure} unit="kPa" min={0}   max={250} t={t} testId="boostPressure" />
            <Tile label="Egzoz Gazı Sıc." reading={state.egt}          unit="°C"  min={0}   max={900} t={t} testId="egt" />
            <StatusTile label="Kapılar" testId="doors" t={t}
              known={state.doorsAllClosed !== null}
              text={state.doorsAllClosed === null ? '—' : state.doorsAllClosed ? 'Tümü kapalı' : 'Açık kapı var'}
              ok={state.doorsAllClosed === true}
              note={state.doorsAllClosed === null ? 'DESTEKLENMİYOR' : 'CAN VERİSİ'} />
            <StatusTile label="Lastik Basıncı" testId="tpms" t={t}
              known={state.tpmsAvailable}
              text={state.tpmsAvailable ? 'Sensör bağlı' : '—'}
              ok={state.tpmsAvailable}
              note={state.tpmsAvailable ? 'CAN VERİSİ' : 'HENÜZ OKUNMADI'} />
          </section>
        </>
      )}

      {/* ── ALT ŞERİT ─────────────────────────────────────────────────── */}
      <footer className="obdlive-bottom">
        <button type="button" className="obdlive-home" data-obd-home=""
          onClick={onHome} style={{ background: t.accent, color: t.onAccent }}>
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M3 11l9-8 9 8" /><path d="M5 10v10h14V10" />
          </svg>
          <span>
            <span className="obdlive-home-title">ANA SAYFA</span>
            <span className="obdlive-home-sub">Ana ekrana dön</span>
          </span>
        </button>

        <div className="obdlive-panel obdlive-dtc" style={{ background: t.panel, border: `1px solid ${t.line}` }}>
          <div className="obdlive-dtc-icon" style={{
            background: state.dtc === 'faults' ? t.warnSoftBg : state.dtc === 'clean' ? t.okSoftBg : t.warnSoftBg,
            border: `1px solid ${state.dtc === 'clean' ? t.okSoftLine : t.warnSoftLine}`,
          }}>
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none"
              stroke={state.dtc === 'clean' ? t.ok : t.warn} strokeWidth="1.8"
              strokeLinecap="round" aria-hidden="true">
              <circle cx="12" cy="12" r="9" /><path d="M12 8v5M12 16.5v.01" />
            </svg>
          </div>
          <div className="obdlive-dtc-body">
            <div className="obdlive-cap" style={{ color: t.txt3 }}>ARIZA KODLARI (DTC)</div>
            <div className="obdlive-dtc-head" data-obd-value="dtc">
              {state.dtcReading ? 'Taranıyor…'
                : state.dtc === 'offline' ? 'Okunamıyor'
                  : state.dtc === 'unscanned' ? 'Henüz taranmadı'
                    : state.dtc === 'clean' ? 'Arıza kodu yok'
                      : `${state.dtcCount} arıza kodu`}
            </div>
            <div className="obdlive-dtc-note" style={{ color: t.txt2 }}>
              {state.dtc === 'unscanned'
                ? 'Bu oturumda arıza kodu okuması yapılmadı — “arıza yok” anlamına gelmez.'
                : state.dtc === 'offline'
                  ? 'Arıza kodları yalnız OBD bağlıyken okunabilir.'
                  : 'Son taramanın sonucu.'}
            </div>
          </div>
          {onScanDtc && state.dtc !== 'offline' && (
            <button type="button" className="obdlive-scan" onClick={onScanDtc}
              style={{ background: t.panelMuted, border: `1px solid ${t.line}`, color: t.txt }}>TARA</button>
          )}
        </div>

        <div className="obdlive-panel obdlive-quality" style={{ background: t.panel, border: `1px solid ${t.line}` }}>
          <div className="obdlive-cap" style={{ color: t.txt3 }}>VERİ KALİTESİ</div>
          <div className="obdlive-kv-row">
            <span style={{ color: t.txt2 }}>Okunan ölçüm</span>
            <strong data-obd-value="coverage">{state.coverage.readable} / {state.coverage.total}</strong>
          </div>
          <div className="obdlive-kv-row">
            <span style={{ color: t.txt2 }}>Tazelik</span>
            <strong style={{ color: linkColor }}>{linkLabel.charAt(0) + linkLabel.slice(1).toLocaleLowerCase('tr-TR')}</strong>
          </div>
        </div>
      </footer>
    </div>
  );
});

/* ══════════════════════════════════════════════════════════════════════════
 * Yerleşim — landscape head unit öncelikli, dar ekranlarda taşmaz (§15)
 * ════════════════════════════════════════════════════════════════════════ */

const CSS = `
.obdlive{width:100%;height:100%;box-sizing:border-box;display:flex;flex-direction:column;
  gap:clamp(10px,1.4vh,18px);padding:clamp(14px,2.2vh,26px) clamp(16px,2vw,32px);
  font-family:'Saira','Segoe UI',system-ui,sans-serif;overflow:hidden;
  font-variant-numeric:tabular-nums;}
.obdlive-top{flex:0 0 auto;display:flex;align-items:center;gap:clamp(10px,1.4vw,24px);min-height:44px;}
.obdlive-brand{display:flex;align-items:center;gap:clamp(8px,0.9vw,14px);min-width:0;}
.obdlive-wordmark{font-size:clamp(17px,1.5vw,25px);font-weight:700;letter-spacing:3.5px;}
.obdlive-title{margin:0;font-size:clamp(11px,1vw,16px);font-weight:500;letter-spacing:1.6px;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.obdlive-sep{width:1px;height:26px;flex:0 0 auto;}
.obdlive-spacer{flex:1 1 auto;}
.obdlive-dots{display:flex;align-items:center;gap:9px;}
.obdlive-dots i{width:7px;height:7px;border-radius:4px;display:block;}
.obdlive-dots i.obdlive-dot-on{width:26px;}
.obdlive-chip{display:flex;align-items:center;gap:10px;height:40px;padding:0 16px;border-radius:20px;
  white-space:nowrap;}
.obdlive-chip i{width:9px;height:9px;border-radius:5px;display:block;}
.obdlive-chip span{font-size:clamp(11px,0.85vw,14px);font-weight:600;letter-spacing:1.3px;}
.obdlive-clock{text-align:right;}
.obdlive-clock-time{font-size:clamp(18px,1.6vw,27px);font-weight:600;line-height:1;}
.obdlive-clock-date{font-size:clamp(10px,0.75vw,12px);margin-top:3px;white-space:nowrap;}

.obdlive-panel{box-sizing:border-box;border-radius:18px;min-width:0;}
.obdlive-cap{font-size:clamp(10px,0.72vw,12px);font-weight:600;letter-spacing:2px;}
.obdlive-hr{height:1px;}

.obdlive-hero{flex:1 1 auto;min-height:0;display:flex;gap:clamp(10px,1vw,18px);}
.obdlive-conn{flex:0 1 340px;min-width:190px;padding:clamp(12px,1.6vh,22px) clamp(12px,1.2vw,24px);
  display:flex;flex-direction:column;gap:clamp(8px,1.2vh,18px);}
.obdlive-conn-state{font-size:clamp(24px,2.4vw,42px);font-weight:700;line-height:1;}
.obdlive-kv{margin:0;display:flex;flex-direction:column;gap:clamp(6px,1vh,14px);}
.obdlive-kv>div{display:flex;justify-content:space-between;align-items:baseline;gap:10px;}
.obdlive-kv dt{font-size:clamp(11px,0.85vw,14px);}
.obdlive-kv dd{margin:0;font-size:clamp(12px,0.9vw,15px);font-weight:500;text-align:right;}
.obdlive-gauge-panel{flex:1 1 0;display:flex;flex-direction:column;align-items:center;
  padding:clamp(10px,1.4vh,20px);min-width:150px;}
.obdlive-gauge{width:100%;height:100%;min-height:0;flex:1 1 auto;}
.obdlive-gauge-num{font-weight:700;}
.obdlive-load{flex:0 1 340px;min-width:190px;padding:clamp(12px,1.6vh,22px) clamp(12px,1.2vw,24px);
  display:flex;flex-direction:column;gap:clamp(8px,1.6vh,20px);}
.obdlive-meter-head{display:flex;justify-content:space-between;align-items:baseline;
  margin-bottom:9px;font-size:clamp(11px,0.9vw,15px);gap:8px;}
.obdlive-meter-num{font-size:clamp(20px,1.8vw,30px);font-weight:600;}
.obdlive-meter-num i{font-style:normal;font-size:clamp(10px,0.8vw,14px);margin-left:4px;}
.obdlive-volt{display:flex;justify-content:space-between;align-items:flex-end;gap:10px;
  font-size:clamp(11px,0.9vw,15px);}
.obdlive-volt-note{font-size:clamp(9px,0.72vw,12px);margin-top:4px;}
.obdlive-volt-num{font-size:clamp(26px,2.5vw,44px);font-weight:700;line-height:1;}
.obdlive-volt-num i{font-style:normal;font-size:clamp(11px,0.9vw,16px);margin-left:5px;}

.obdlive-bar{height:7px;border-radius:4px;overflow:hidden;}
.obdlive-bar-fill{height:100%;border-radius:4px;}

.obdlive-tiles{flex:0 0 auto;display:grid;grid-template-columns:repeat(6,minmax(0,1fr));
  gap:clamp(8px,1vw,18px);}
.obdlive-tile{border-radius:18px;padding:clamp(10px,1.4vh,18px);display:flex;flex-direction:column;
  justify-content:space-between;gap:clamp(6px,0.8vh,10px);min-width:0;}
.obdlive-tile-label{font-size:clamp(10px,0.8vw,13px);white-space:nowrap;overflow:hidden;
  text-overflow:ellipsis;}
.obdlive-tile-value{display:flex;align-items:baseline;gap:5px;font-size:clamp(26px,2.8vw,50px);
  font-weight:700;line-height:1;}
.obdlive-tile-unit{font-size:clamp(10px,0.9vw,16px);font-weight:400;}
.obdlive-tile-state{font-size:clamp(8px,0.65vw,11px);letter-spacing:0.8px;white-space:nowrap;
  overflow:hidden;text-overflow:ellipsis;}

.obdlive-empty{flex:1 1 auto;min-height:0;border-radius:22px;display:flex;flex-direction:column;
  align-items:center;justify-content:center;text-align:center;padding:24px;gap:clamp(8px,1.4vh,16px);}
.obdlive-empty-icon{width:clamp(80px,9vh,132px);height:clamp(80px,9vh,132px);border-radius:50%;
  display:flex;align-items:center;justify-content:center;}
.obdlive-empty-title{margin:0;font-size:clamp(26px,3vw,52px);font-weight:700;line-height:1.08;}
.obdlive-empty-text{margin:0;max-width:720px;font-size:clamp(13px,1.1vw,18px);line-height:1.6;}
.obdlive-empty-note{margin:0;padding:12px 20px;border-radius:12px;font-size:clamp(11px,0.9vw,14px);}

.obdlive-bottom{flex:0 0 auto;display:flex;gap:clamp(8px,1vw,18px);align-items:stretch;}
.obdlive-home{flex:0 0 auto;min-width:200px;min-height:88px;border:0;border-radius:18px;cursor:pointer;
  padding:clamp(10px,1.4vh,20px) clamp(14px,1.4vw,24px);display:flex;align-items:center;
  gap:clamp(10px,1vw,18px);font-family:inherit;text-align:left;}
.obdlive-home:active{filter:brightness(0.94);}
.obdlive-home-title{display:block;font-size:clamp(18px,1.7vw,30px);font-weight:700;line-height:1.05;}
.obdlive-home-sub{display:block;font-size:clamp(10px,0.8vw,13px);opacity:0.72;margin-top:3px;}
.obdlive-dtc{flex:1 1 auto;padding:clamp(10px,1.4vh,18px) clamp(14px,1.4vw,24px);display:flex;
  align-items:center;gap:clamp(10px,1.2vw,20px);}
.obdlive-dtc-icon{width:52px;height:52px;flex:0 0 auto;border-radius:26px;display:flex;
  align-items:center;justify-content:center;}
.obdlive-dtc-body{flex:1 1 auto;min-width:0;}
.obdlive-dtc-head{font-size:clamp(16px,1.5vw,26px);font-weight:600;line-height:1.1;margin-top:5px;}
.obdlive-dtc-note{font-size:clamp(10px,0.85vw,13px);margin-top:3px;}
.obdlive-scan{flex:0 0 auto;min-height:56px;padding:0 24px;border-radius:12px;cursor:pointer;
  font-family:inherit;font-size:clamp(12px,0.95vw,15px);font-weight:600;letter-spacing:1px;}
.obdlive-quality{flex:0 1 300px;min-width:170px;padding:clamp(10px,1.4vh,18px) clamp(14px,1.4vw,24px);
  display:flex;flex-direction:column;justify-content:center;gap:clamp(6px,1vh,12px);}
.obdlive-kv-row{display:flex;justify-content:space-between;align-items:baseline;gap:10px;
  font-size:clamp(11px,0.9vw,14px);}
.obdlive-kv-row strong{font-size:clamp(13px,1vw,16px);font-weight:600;}

@media (max-width:1100px){
  .obdlive-tiles{grid-template-columns:repeat(3,minmax(0,1fr));}
  .obdlive-conn,.obdlive-load{flex-basis:230px;}
}
@media (max-width:820px){
  .obdlive-hero{flex-wrap:wrap;}
  .obdlive-conn,.obdlive-load{flex-basis:100%;}
  .obdlive-gauge-panel{flex-basis:calc(50% - 9px);}
  .obdlive-title,.obdlive-clock-date{display:none;}
}
`;

export default ObdLiveScreen;
