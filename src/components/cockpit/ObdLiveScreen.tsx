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

/* §11 — GÜNDÜZ: saf beyaz panel araç içinde göz alır ve güneş yansımasını
   artırır. Panel kırıldı (#F7F9FA), zemin bir tık koyulaştırıldı; metin
   kontrastı 4.5:1 üzerinde KALDI (txt3 #68747F → panel üstünde ~4.9:1). */
const DAY: Tokens = {
  bg: '#E7EAEE', panel: '#F7F9FA', panelMuted: '#EFF2F5', line: '#CDD3DA', lineDash: '#C2C9D1',
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
      {/* §1: sürüşte önce RAKAM algılanmalı — etiket ve dekorasyon sonra. */}
      <text data-obd-value={testId} x="130" y="142" fontSize="82" fontWeight="700"
        textAnchor="middle" fill={stateColor(reading, t)} className="obdlive-gauge-num">
        {num(reading)}
      </text>
      <text x="130" y="176" fontSize="14" textAnchor="middle" fill={t.txt2} letterSpacing="1.5">
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

/** LEVEL 2 — orta ölçüm kartı. Desteklenmeyen alan KESİKLİ ve SÖNÜK çizilir. */
function Metric(props: {
  readonly label: string; readonly reading: Reading; readonly unit: string;
  readonly min: number; readonly max: number; readonly digits?: number;
  readonly t: Tokens; readonly testId: string;
  /** Kaynak/alt bilgi — verilmezse ölçümün kendi durumu yazılır. */
  readonly note?: string;
}): React.ReactElement {
  const { label, reading, unit, min, max, digits = 0, t, testId, note } = props;
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
      <div className="obdlive-tile-state" data-obd-note={testId} style={{
        color: reading.state === 'live' ? t.txt3
          : reading.state === 'stale' ? t.warn
            : reading.state === 'unread' ? t.warn : t.txt3,
      }}>
        {note ?? STATE_LABEL[reading.state].toLocaleUpperCase('tr-TR')}
      </div>
    </div>
  );
}

/** LEVEL 3 — ileri PID'ler için kompakt satır. Hiyerarşide en altta durur. */
function Minor(props: {
  readonly label: string; readonly reading: Reading; readonly unit: string;
  readonly digits?: number; readonly t: Tokens; readonly testId: string;
}): React.ReactElement {
  const { label, reading, unit, digits = 0, t, testId } = props;
  const muted = reading.state === 'unsupported' || reading.state === 'offline';
  return (
    <div className="obdlive-minor-item" data-obd-tile={testId} data-obd-state={reading.state}
      style={{
        background: muted ? t.panelMuted : t.panel,
        border: `1px ${muted ? 'dashed' : 'solid'} ${muted ? t.lineDash : t.line}`,
      }}>
      <span className="obdlive-minor-label" style={{ color: muted ? t.txt3 : t.txt2 }}>{label}</span>
      <span className="obdlive-minor-value" style={{ color: stateColor(reading, t) }}>
        <span data-obd-value={testId}>{num(reading, digits)}</span>
        {hasNumber(reading)
          ? <i style={{ color: t.txt2 }}>{unit}</i>
          : <i style={{ color: t.txt3 }}>{STATE_LABEL[reading.state]}</i>}
      </span>
    </div>
  );
}

/** Yakıt okumasının kaynağı — görsel iddia veri kaynağıyla uyuşmalı (§6). */
const FUEL_NOTE: Record<string, string> = {
  'ecu':            'ECU · PID 2F',
  'ecu-calibrated': 'ECU · KALİBRELİ',
};

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
          {/* ── LEVEL 1 · KAHRAMAN — RPM ve HIZ ────────────────────────── */}
          <section className="obdlive-hero">
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
          </section>

          {/* ── LEVEL 2 · ORTA — motor/sürüş verileri ───────────────────── */}
          <section className="obdlive-mid">
            <Metric label="Soğutma Suyu"   reading={state.engineTemp}     unit="°C" min={-20} max={130} t={t} testId="engineTemp" />
            <Metric label="Akü Voltajı"    reading={state.batteryVoltage} unit="V"  min={10}  max={15}  digits={1} t={t} testId="batteryVoltage" />
            <Metric label="Gaz Kelebeği"   reading={state.throttle}       unit="%"  min={0}   max={100} t={t} testId="throttle" />
            <Metric label="Yakıt Seviyesi" reading={state.fuelLevel}      unit="%"  min={0}   max={100} t={t} testId="fuelLevel"
              note={FUEL_NOTE[state.fuelProvenance]} />
          </section>

          {/* ── LEVEL 3 · KÜÇÜK — ileri PID'ler ─────────────────────────── */}
          <section className="obdlive-minor">
            <Minor label="Emme Havası"     reading={state.intakeTemp}    unit="°C"  t={t} testId="intakeTemp" />
            <Minor label="Turbo Basıncı"   reading={state.boostPressure} unit="kPa" t={t} testId="boostPressure" />
            <Minor label="Egzoz Gazı Sıc." reading={state.egt}           unit="°C"  t={t} testId="egt" />
            {state.isElectrified && (
              <>
                <Minor label="Batarya (SoC)" reading={state.batteryLevel} unit="%"  t={t} testId="batteryLevel" />
                <Minor label="Batarya Sıc."  reading={state.batteryTemp}  unit="°C" t={t} testId="batteryTemp" />
                <Minor label="Motor Gücü"    reading={state.motorPower}   unit="kW" t={t} testId="motorPower" />
              </>
            )}
          </section>
        </>
      )}

      {/* ── ALT ŞERİT — kontrol ve bağlam, veriden BASKIN DEĞİL ────────── */}
      <footer className="obdlive-bottom">
        {/* §3: navigasyon kontrolü canlı veriden büyük olmamalı — kompakt ama
            sürüşte güvenle basılabilir (≈ 150×56). Davranış değişmedi. */}
        <button type="button" className="obdlive-home" data-obd-home=""
          onClick={onHome} style={{ background: t.accent, color: t.onAccent }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M3 11l9-8 9 8" /><path d="M5 10v10h14V10" />
          </svg>
          <span className="obdlive-home-title">Ana Sayfa</span>
        </button>

        <div className="obdlive-panel obdlive-dtc" style={{ background: t.panel, border: `1px solid ${t.line}` }}>
          <div className="obdlive-dtc-icon" style={{
            background: state.dtc === 'clean' ? t.okSoftBg : t.warnSoftBg,
            border: `1px solid ${state.dtc === 'clean' ? t.okSoftLine : t.warnSoftLine}`,
          }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
              stroke={state.dtc === 'clean' ? t.ok : t.warn} strokeWidth="1.8"
              strokeLinecap="round" aria-hidden="true">
              <circle cx="12" cy="12" r="9" /><path d="M12 8v5M12 16.5v.01" />
            </svg>
          </div>
          <div className="obdlive-dtc-body">
            <div className="obdlive-cap" style={{ color: t.txt3 }}>ARIZA KODLARI</div>
            <div className="obdlive-dtc-head" data-obd-value="dtc">
              {state.dtcReading ? 'Taranıyor…'
                : state.dtc === 'offline' ? 'Okunamıyor'
                  : state.dtc === 'unscanned' ? 'Henüz taranmadı'
                    : state.dtc === 'clean' ? 'Arıza kodu yok'
                      : `${state.dtcCount} arıza kodu`}
            </div>
          </div>
          {onScanDtc && state.dtc !== 'offline' && (
            <button type="button" className="obdlive-scan" onClick={onScanDtc}
              style={{ background: t.panelMuted, border: `1px solid ${t.line}`, color: t.txt }}>TARA</button>
          )}
        </div>

        {/* §2 + §9: teknik bağlantı ayrıntısı ve veri kalitesi — küçük,
            ikincil ve TEK yerde (üst çubuktaki tazelik rozetiyle tekrar etmez). */}
        <div className="obdlive-panel obdlive-quality" style={{ background: t.panel, border: `1px solid ${t.line}` }}>
          <div className="obdlive-cap" style={{ color: t.txt3 }}>VERİ KALİTESİ</div>
          <div className="obdlive-quality-line" data-obd-value="coverage">
            <strong style={{ color: t.ok }}>{state.coverage.live} canlı</strong>
            {state.coverage.stale > 0 && <><span style={{ color: t.txt3 }}> · </span><strong style={{ color: t.warn }}>{state.coverage.stale} gecikmiş</strong></>}
            {state.coverage.unsupported > 0 && <><span style={{ color: t.txt3 }}> · </span><span style={{ color: t.txt2 }}>{state.coverage.unsupported} desteklenmiyor</span></>}
            {state.coverage.unread > 0 && <><span style={{ color: t.txt3 }}> · </span><span style={{ color: t.txt2 }}>{state.coverage.unread} okunmadı</span></>}
          </div>
          <div className="obdlive-conn-detail" data-obd-conn="" style={{ color: t.txt3, borderTop: `1px solid ${t.line}` }}>
            {(state.deviceName || 'Adaptör bilinmiyor')}
            {' · '}{state.source === 'real' ? 'Gerçek ECU' : state.source === 'mock' ? 'Benzetim' : 'Kaynak yok'}
            {' · '}{fmtClockMs(state.lastSeenMs)}
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
  gap:clamp(8px,1.2vh,16px);padding:clamp(12px,2vh,24px) clamp(16px,2vw,32px);
  font-family:'Saira','Segoe UI',system-ui,sans-serif;overflow:hidden;
  font-variant-numeric:tabular-nums;}

/* ── ÜST ÇUBUK ────────────────────────────────────────────────────────── */
.obdlive-top{position:relative;flex:0 0 auto;display:flex;align-items:center;
  gap:clamp(10px,1.4vw,24px);min-height:44px;}
.obdlive-brand{display:flex;align-items:center;gap:clamp(8px,0.9vw,14px);min-width:0;}
.obdlive-wordmark{font-size:clamp(16px,1.4vw,23px);font-weight:700;letter-spacing:3.5px;}
.obdlive-title{margin:0;font-size:clamp(11px,0.95vw,15px);font-weight:500;letter-spacing:1.6px;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.obdlive-sep{width:1px;height:26px;flex:0 0 auto;}
.obdlive-spacer{flex:1 1 auto;}
.obdlive-dots{display:flex;align-items:center;gap:9px;}
.obdlive-dots i{width:7px;height:7px;border-radius:4px;display:block;}
.obdlive-dots i.obdlive-dot-on{width:26px;}
.obdlive-chip{display:flex;align-items:center;gap:10px;height:38px;padding:0 15px;border-radius:19px;
  white-space:nowrap;}
.obdlive-chip i{width:9px;height:9px;border-radius:5px;display:block;}
.obdlive-chip span{font-size:clamp(11px,0.85vw,14px);font-weight:600;letter-spacing:1.3px;}
/* Saat üst çubuğun GERÇEK ortasında — iki yandaki öbeklerden bağımsız. */
.obdlive-clock{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);
  text-align:center;white-space:nowrap;pointer-events:none;}
.obdlive-clock-time{font-size:clamp(22px,2.1vw,36px);font-weight:600;line-height:1;
  letter-spacing:0.5px;}
.obdlive-clock-date{font-size:clamp(10px,0.8vw,14px);margin-top:3px;white-space:nowrap;}

.obdlive-panel{box-sizing:border-box;border-radius:16px;min-width:0;}
.obdlive-cap{font-size:clamp(9px,0.7vw,12px);font-weight:600;letter-spacing:2px;}

/* ── LEVEL 1 · gauge'lar en çok alanı alır ────────────────────────────── */
.obdlive-hero{flex:1 1 auto;min-height:0;display:flex;gap:clamp(10px,1vw,18px);}
.obdlive-gauge-panel{flex:1 1 0;display:flex;flex-direction:column;align-items:center;
  padding:clamp(10px,1.4vh,18px);min-width:150px;}
.obdlive-gauge{width:100%;height:100%;min-height:0;flex:1 1 auto;}
.obdlive-gauge-num{font-weight:700;}

/* ── LEVEL 2 · orta kartlar ───────────────────────────────────────────── */
.obdlive-mid{flex:0 0 auto;display:grid;grid-template-columns:repeat(4,minmax(0,1fr));
  gap:clamp(8px,1vw,18px);}
.obdlive-tile{border-radius:16px;padding:clamp(9px,1.2vh,16px) clamp(10px,1vw,18px);
  display:flex;flex-direction:column;justify-content:space-between;gap:clamp(5px,0.7vh,9px);
  min-width:0;}
.obdlive-tile-label{font-size:clamp(11px,0.85vw,14px);white-space:nowrap;overflow:hidden;
  text-overflow:ellipsis;}
.obdlive-tile-value{display:flex;align-items:baseline;gap:5px;font-size:clamp(28px,2.9vw,52px);
  font-weight:700;line-height:1;}
.obdlive-tile-unit{font-size:clamp(11px,0.95vw,17px);font-weight:400;}
.obdlive-tile-state{font-size:clamp(8px,0.65vw,11px);letter-spacing:0.8px;white-space:nowrap;
  overflow:hidden;text-overflow:ellipsis;}
.obdlive-bar{height:6px;border-radius:3px;overflow:hidden;}
.obdlive-bar-fill{height:100%;border-radius:3px;}

/* ── LEVEL 3 · ileri PID şeridi ───────────────────────────────────────── */
.obdlive-minor{flex:0 0 auto;display:flex;gap:clamp(8px,0.8vw,14px);flex-wrap:wrap;}
.obdlive-minor-item{flex:1 1 0;min-width:140px;border-radius:12px;
  padding:clamp(7px,0.9vh,11px) clamp(10px,0.9vw,16px);display:flex;align-items:baseline;
  justify-content:space-between;gap:10px;}
.obdlive-minor-label{font-size:clamp(10px,0.78vw,13px);white-space:nowrap;overflow:hidden;
  text-overflow:ellipsis;}
.obdlive-minor-value{font-size:clamp(15px,1.25vw,22px);font-weight:600;white-space:nowrap;}
.obdlive-minor-value i{font-style:normal;font-size:clamp(9px,0.72vw,12px);margin-left:4px;
  font-weight:400;}

/* ── BAĞLANTI YOK ─────────────────────────────────────────────────────── */
.obdlive-empty{flex:1 1 auto;min-height:0;border-radius:20px;display:flex;flex-direction:column;
  align-items:center;justify-content:center;text-align:center;padding:24px;gap:clamp(8px,1.4vh,16px);}
.obdlive-empty-icon{width:clamp(76px,8vh,120px);height:clamp(76px,8vh,120px);border-radius:50%;
  display:flex;align-items:center;justify-content:center;}
.obdlive-empty-title{margin:0;font-size:clamp(24px,2.8vw,48px);font-weight:700;line-height:1.08;}
.obdlive-empty-text{margin:0;max-width:700px;font-size:clamp(13px,1.05vw,17px);line-height:1.6;}
.obdlive-empty-note{margin:0;padding:11px 18px;border-radius:11px;font-size:clamp(11px,0.85vw,14px);}

/* ── ALT ŞERİT ────────────────────────────────────────────────────────── */
.obdlive-bottom{flex:0 0 auto;display:flex;gap:clamp(8px,1vw,16px);align-items:stretch;}
.obdlive-home{flex:0 0 auto;min-width:150px;min-height:56px;border:0;border-radius:14px;
  cursor:pointer;padding:0 clamp(14px,1.2vw,20px);display:flex;align-items:center;
  justify-content:center;gap:10px;font-family:inherit;}
.obdlive-home:active{filter:brightness(0.94);}
.obdlive-home-title{font-size:clamp(14px,1.1vw,18px);font-weight:700;letter-spacing:0.3px;}
.obdlive-dtc{flex:1 1 auto;padding:clamp(8px,1vh,14px) clamp(12px,1.2vw,20px);display:flex;
  align-items:center;gap:clamp(10px,1vw,16px);}
.obdlive-dtc-icon{width:40px;height:40px;flex:0 0 auto;border-radius:20px;display:flex;
  align-items:center;justify-content:center;}
.obdlive-dtc-body{flex:1 1 auto;min-width:0;}
.obdlive-dtc-head{font-size:clamp(15px,1.25vw,22px);font-weight:600;line-height:1.15;margin-top:3px;}
.obdlive-scan{flex:0 0 auto;min-height:44px;padding:0 20px;border-radius:11px;cursor:pointer;
  font-family:inherit;font-size:clamp(12px,0.9vw,14px);font-weight:600;letter-spacing:1px;}
.obdlive-quality{flex:0 1 330px;min-width:200px;padding:clamp(8px,1vh,14px) clamp(12px,1.2vw,20px);
  display:flex;flex-direction:column;justify-content:center;gap:5px;}
.obdlive-quality-line{font-size:clamp(12px,1vw,16px);font-weight:600;white-space:nowrap;
  overflow:hidden;text-overflow:ellipsis;}
.obdlive-conn-detail{font-size:clamp(9px,0.72vw,12px);padding-top:5px;margin-top:2px;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}

/* ── DAR EKRANLAR (§15) ───────────────────────────────────────────────── */
@media (max-width:1100px){
  .obdlive-mid{grid-template-columns:repeat(2,minmax(0,1fr));}
  .obdlive-clock{position:static;transform:none;text-align:right;}
  .obdlive-clock-time{font-size:clamp(17px,1.6vw,22px);}
  .obdlive-quality{flex-basis:240px;}
}
@media (max-width:820px){
  .obdlive-hero{flex-wrap:wrap;}
  .obdlive-gauge-panel{flex-basis:calc(50% - 9px);}
  .obdlive-title,.obdlive-clock-date{display:none;}
  .obdlive-minor-item{min-width:calc(50% - 7px);}
}
`;

export default ObdLiveScreen;
