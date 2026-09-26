/**
 * ObdLiveScreen — OBD CANLI VERİLERİ sayfasının SUNUMU.
 *
 * Platformdan TAMAMEN bağımsızdır: prop alır, JSX döner. Hiçbir servise,
 * store'a ya da native köprüye dokunmaz — bağlama `ObdLivePage.tsx`tedir.
 *
 * ── HİYERARŞİ (ürün kararı) ───────────────────────────────────────────────
 *   BÜYÜK GÖSTERGE   motor devri · araç hızı
 *   KÜÇÜK GÖSTERGE   aynı görsel dilde, daha küçük — önemli canlı ölçümler
 *   İKİNCİL LİSTE    düşük öncelikli / ileri teknik PID'ler, sağda
 * Veri SADELEŞTİRMEK İÇİN SİLİNMEZ; önem sırasına göre BOYUTLANDIRILIR.
 *
 * ── TEK GÖSTERGE AİLESİ ───────────────────────────────────────────────────
 * Büyük ve küçük gösterge AYNI bileşendir (`Gauge`, `size` varyantı): aynı
 * yay geometrisi, aynı yazı ailesi, aynı vurgu mantığı, aynı gün/gece
 * davranışı. Böylece ekran tek bir sistemin parçası gibi okunur.
 *
 * ── ÖLÇEK NEREDEN GELİR ───────────────────────────────────────────────────
 * Her göstergenin alt/üst sınırı ve birimi kanonik `STANDARD_PID_MAP`
 * kaydından gelir (`obdPidCatalog`). UYARI BÖLGESİ ÇİZİLMEZ: repoda
 * kanonik bir eşik otoritesi YOKTUR ve kırmızı/yeşil sınır uydurmak yanlış
 * bir iddia olurdu. Yay nötrdür; anlam sayının kendisindedir.
 *
 * ── DÜRÜSTLÜK ─────────────────────────────────────────────────────────────
 * Sayı YALNIZ gerçek ölçüm varken çizilir. `Desteklenmiyor` · `ECU vermiyor`
 * · `Henüz okunmadı` · `Gecikmiş` · `Bağlı değil` ayrı ayrı gösterilir.
 * Hesaplanan değerler (kalan yakıt, tahmini menzil) ECU ölçümü gibi
 * SUNULMAZ; etiketleri bunu söyler.
 */

import { memo } from 'react';
import type { ObdLiveState } from './useObdLiveData';
import { fillRatio, hasNumber, type Reading } from './obdLiveModel';
import { entriesForTier, BATTERY_VOLTAGE_KEY, type CatalogEntry } from './obdPidCatalog';

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
  ok: string; warn: string; okSoftBg: string; okSoftLine: string;
  warnSoftBg: string; warnSoftLine: string;
}

const NIGHT: Tokens = {
  bg: '#06080A', panel: '#0D1116', panelMuted: '#0A0E12', line: '#1E262F', lineDash: '#202832',
  txt: '#E9F1F7', txt2: '#7C8B99', txt3: '#56646F', tick: '#4A5763', dash: '#39434D',
  track: '#161E26', trackEmpty: '#11171D', accent: '#4FE0C8', onAccent: '#04211D',
  ok: '#52D98A', warn: '#F5B544',
  okSoftBg: 'rgba(82,217,138,0.10)', okSoftLine: 'rgba(82,217,138,0.34)',
  warnSoftBg: 'rgba(245,181,68,0.12)', warnSoftLine: 'rgba(245,181,68,0.34)',
};

/* §13 — GÜNDÜZ: saf beyaz panel araç içinde göz alır. Panel kırıldı,
   zemin bir tık koyulaştırıldı; metin kontrastı 4.5:1 üzerinde KALDI. */
const DAY: Tokens = {
  bg: '#E7EAEE', panel: '#F7F9FA', panelMuted: '#EFF2F5', line: '#CDD3DA', lineDash: '#C2C9D1',
  txt: '#10151A', txt2: '#525E6B', txt3: '#68747F', tick: '#78838E', dash: '#A6AFB8',
  track: '#CBD3DB', trackEmpty: '#E7EAEE', accent: '#0E9E8C', onAccent: '#FFFFFF',
  ok: '#12793F', warn: '#A96800',
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
  no_data:     'ECU vermiyor',
  unread:      'Henüz okunmadı',
  offline:     'Bağlı değil',
};

/**
 * Gösterilecek ondalık basamak.
 *
 * Yalnız kayıt aralığına bakmak YETMEZ: MAF'ın aralığı 0–655 g/s'dir ama
 * tipik değeri 3,2'dir ve "3" yazmak gerçek çözünürlüğü yok eder. Karar bu
 * yüzden aralığı VE o anki büyüklüğü birlikte okur. Bu bir GÖSTERİM
 * kararıdır; ölçümün kendisine dokunmaz.
 */
function digitsFor(entry: Pick<CatalogEntry, 'max' | 'min' | 'unit'>, r: Reading): number {
  const span = entry.max - entry.min;
  if (span <= 3) return 2;                 // lambda · O2 voltajı
  if (entry.unit === '%') return 0;        // yüzdeler tam sayı okunur
  const v = Math.abs(r.value ?? 0);
  if (v === 0) return 0;                   // "0,00" gereksiz; sıfırda çözünürlük kaybı yok
  if (v < 1) return 2;
  if (v < 10) return 1;                    // MAF 3,2 g/s
  if (span <= 40) return 1;                // akü voltajı 14,2 V
  return 0;
}

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

/** Kanonik `lastSeenMs` → saat. 0/geçersiz ise UYDURULMAZ. */
function fmtClockMs(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '—';
  try { return new Date(ms).toLocaleTimeString('tr-TR', { hour12: false }); } catch { return '—'; }
}

/* ══════════════════════════════════════════════════════════════════════════
 * TEK GÖSTERGE AİLESİ — büyük ve küçük AYNI bileşen
 * ════════════════════════════════════════════════════════════════════════ */

/** 250° süpürme · r=104 · çevre 653.5 · yay 453.8. İki boyutta da aynı. */
const ARC_LEN = 453.8;
const CIRC = 653.5;

const TICK_POS = [
  { x: 64.5, y: 180 }, { x: 59, y: 97 }, { x: 130, y: 54 },
  { x: 201, y: 97 }, { x: 195.5, y: 180 },
] as const;

interface GaugeProps {
  readonly reading: Reading;
  readonly entry: CatalogEntry;
  readonly size: 'large' | 'mini';
  readonly t: Tokens;
  /** Kaynak/alt bilgi — verilmezse ölçümün kendi durumu yazılır. */
  readonly note?: string;
}

function Gauge({ reading, entry, size, t, note }: GaugeProps): React.ReactElement {
  const large = size === 'large';
  const ratio = fillRatio(reading, entry.min, entry.max);

  /* Sıfır merkezli ölçümlerde (yakıt trim gibi) yay ORTADAN açılır; soldan
     doldurmak "−2 %" için yanlış bir görsel iddia olurdu. */
  const zeroRatio = entry.centered ? (0 - entry.min) / (entry.max - entry.min) : 0;
  let dashOffset = 0;
  let dashLen = 0;
  if (ratio !== null) {
    if (entry.centered) {
      const lo = Math.min(zeroRatio, ratio);
      const hi = Math.max(zeroRatio, ratio);
      dashOffset = -lo * ARC_LEN;
      dashLen = Math.max(1.5, (hi - lo) * ARC_LEN);
    } else {
      dashLen = Math.max(ratio > 0 ? 2 : 0, ratio * ARC_LEN);
    }
  }

  const stroke = large ? 15 : 13;
  const valueSize = large ? 82 : 52;
  const unitSize = large ? 14 : 13;
  const tickSize = large ? 13 : 0;   // küçük göstergede uç etiketleri kalabalık yapar

  return (
    <svg viewBox="0 0 260 206" role="img"
      aria-label={`${entry.label}${hasNumber(reading) ? `: ${num(reading, digitsFor(entry, reading))} ${entry.unit}` : ''}`}
      className={large ? 'obdlive-gauge-svg obdlive-gauge-svg--lg' : 'obdlive-gauge-svg'}>
      <g transform="rotate(145 130 130)">
        <circle cx="130" cy="130" r="104" fill="none" stroke={t.track} strokeWidth={stroke}
          strokeLinecap="round" strokeDasharray={`${ARC_LEN} ${CIRC}`} />
        {dashLen > 0 && (
          <circle cx="130" cy="130" r="104" fill="none" stroke={t.accent} strokeWidth={stroke}
            strokeLinecap="round" strokeDasharray={`${dashLen} ${CIRC}`}
            strokeDashoffset={dashOffset} />
        )}
      </g>

      {tickSize > 0 && (
        <>
          <text x={TICK_POS[0].x} y={TICK_POS[0].y} fontSize={tickSize} textAnchor="middle" fill={t.tick}>
            {Math.round(entry.min).toLocaleString('tr-TR')}
          </text>
          <text x={TICK_POS[2].x} y={TICK_POS[2].y} fontSize={tickSize} textAnchor="middle" fill={t.tick}>
            {Math.round((entry.min + entry.max) / 2).toLocaleString('tr-TR')}
          </text>
          <text x={TICK_POS[4].x} y={TICK_POS[4].y} fontSize={tickSize} textAnchor="middle" fill={t.tick}>
            {Math.round(entry.max).toLocaleString('tr-TR')}
          </text>
        </>
      )}

      <text data-obd-value={entry.key} x="130" y={large ? 142 : 138} fontSize={valueSize}
        fontWeight="700" textAnchor="middle" fill={stateColor(reading, t)} className="obdlive-gauge-num">
        {num(reading, digitsFor(entry, reading))}
      </text>
      <text x="130" y={large ? 176 : 168} fontSize={unitSize} textAnchor="middle"
        fill={hasNumber(reading) ? t.txt2 : t.txt3} letterSpacing="0.8">
        {note ?? (hasNumber(reading) ? entry.unit : STATE_LABEL[reading.state])}
      </text>
    </svg>
  );
}

/** Küçük gösterge kutusu — desteklenmeyen PID KESİKLİ ve SÖNÜK çizilir. */
function MiniGauge(props: {
  readonly entry: CatalogEntry; readonly reading: Reading; readonly t: Tokens;
  readonly note?: string;
}): React.ReactElement {
  const { entry, reading, t, note } = props;
  const muted = reading.state === 'unsupported' || reading.state === 'no_data'
    || reading.state === 'offline';
  return (
    <div className="obdlive-mini" data-obd-tile={entry.key} data-obd-state={reading.state}
      style={{
        background: muted ? t.panelMuted : t.panel,
        border: `1px ${muted ? 'dashed' : 'solid'} ${muted ? t.lineDash : t.line}`,
      }}>
      <div className="obdlive-mini-label" style={{ color: muted ? t.txt3 : t.txt2 }}>{entry.label}</div>
      <Gauge reading={reading} entry={entry} size="mini" t={t} note={note} />
    </div>
  );
}

/** İkincil liste satırı — anlamlı aralık yoksa SAHTE doluluk çizilmez (§7). */
function ListRow(props: {
  readonly entry: CatalogEntry; readonly reading: Reading; readonly t: Tokens;
  readonly note?: string;
}): React.ReactElement {
  const { entry, reading, t, note } = props;
  const ratio = entry.bar ? fillRatio(reading, entry.min, entry.max) : null;
  const known = hasNumber(reading);
  return (
    <div className="obdlive-row" data-obd-row={entry.key} data-obd-state={reading.state}
      style={{ borderBottom: `1px solid ${t.line}` }}>
      <span className="obdlive-row-label" style={{ color: known ? t.txt2 : t.txt3 }}>{entry.label}</span>

      {entry.bar ? (
        <span className="obdlive-row-bar" data-obd-bar={entry.key}
          style={{ background: ratio === null ? t.trackEmpty : t.track }}>
          {ratio !== null && (
            <span className="obdlive-row-bar-fill" style={{ width: `${ratio * 100}%`, background: t.accent }} />
          )}
        </span>
      ) : (
        /* Sayaç/mesafe: doluluk anlamsız — çubuk HİÇ çizilmez. */
        <span className="obdlive-row-bar obdlive-row-bar--none" />
      )}

      <span className="obdlive-row-value" style={{ color: stateColor(reading, t) }}>
        <span data-obd-value={entry.key}>{num(reading, digitsFor(entry, reading))}</span>
        <i style={{ color: known ? t.txt2 : t.txt3 }}>
          {note ?? (known ? entry.unit : STATE_LABEL[reading.state])}
        </i>
      </span>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
 * Ekran
 * ════════════════════════════════════════════════════════════════════════ */

/** Çekirdek PID'lerin kanonik alan karşılığı (ana yoldan akanlar). */
function coreReading(key: string, s: ObdLiveState): Reading {
  switch (key) {
    case '0C': return s.rpm;
    case '0D': return s.speed;
    case '05': return s.engineTemp;
    case '11': return s.throttle;
    case '2F': return s.fuelLevel;
    case '0F': return s.intakeTemp;
    case '0B': return s.boostPressure;      // PID 0x0B = emme manifoldu (MAP)
    case BATTERY_VOLTAGE_KEY: return s.batteryVoltage;
    default:   return { state: 'unread', value: null };
  }
}

const FUEL_NOTE: Record<string, string | undefined> = {
  'ecu':            'ECU · 2F',
  'ecu-calibrated': 'ECU · kalibreli',
};

export const ObdLiveScreen = memo(function ObdLiveScreen(
  { state, mode, clock, onHome, onScanDtc }: ObdLiveScreenProps,
): React.ReactElement {
  const t = mode === 'night' ? NIGHT : DAY;
  const offline = state.link === 'offline';

  const read = (e: CatalogEntry): Reading =>
    e.core ? coreReading(e.key, state) : (state.extended[e.key] ?? { state: 'unread', value: null });

  const linkLabel = offline ? 'BAĞLI DEĞİL'
    : state.link === 'waiting' ? 'VERİ BEKLENİYOR'
      : state.link === 'stale' ? 'GECİKMİŞ' : 'CANLI';
  const linkColor = offline ? t.txt2 : state.link === 'live' ? t.ok : t.warn;
  const linkBg = offline ? 'transparent' : state.link === 'live' ? t.okSoftBg : t.warnSoftBg;
  const linkLine = offline ? t.line : state.link === 'live' ? t.okSoftLine : t.warnSoftLine;

  const largeEntries = entriesForTier('large');
  const miniEntries = entriesForTier('mini');
  const listEntries = entriesForTier('list');

  return (
    <div className="obdlive" data-obd-theme={mode} data-obd-link={state.link}
      style={{ background: t.bg, color: t.txt }}>
      <style>{CSS}</style>

      {/* ── ÜST ÇUBUK ─────────────────────────────────────────────────── */}
      <header className="obdlive-top">
        <div className="obdlive-brand">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke={t.accent}
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
            <svg width="54" height="54" viewBox="0 0 24 24" fill="none" stroke={t.tick}
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
        <div className="obdlive-body">
          {/* ══ SOL + ORTA ══ */}
          <div className="obdlive-main">

            {/* LARGE */}
            <section className="obdlive-hero">
              {largeEntries.map((e) => (
                <div key={e.key} className="obdlive-panel obdlive-hero-panel"
                  style={{ background: t.panel, border: `1px solid ${t.line}` }}>
                  <div className="obdlive-cap" style={{ color: t.txt3 }}>
                    {e.label.toLocaleUpperCase('tr-TR')}
                  </div>
                  <Gauge reading={coreReading(e.key, state)} entry={e} size="large" t={t} />
                </div>
              ))}
            </section>

            {/* MINI */}
            <section className="obdlive-minis">
              {miniEntries.map((e) => (
                <MiniGauge key={e.key} entry={e} reading={read(e)} t={t}
                  note={e.key === '2F' ? FUEL_NOTE[state.fuelProvenance] : undefined} />
              ))}
            </section>

            {/* DURUM ŞERİDİ */}
            <section className="obdlive-status">
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

              <div className="obdlive-panel obdlive-quality" style={{ background: t.panel, border: `1px solid ${t.line}` }}>
                <div className="obdlive-cap" style={{ color: t.txt3 }}>VERİ KALİTESİ</div>
                <div className="obdlive-quality-line" data-obd-value="coverage">
                  <strong style={{ color: t.ok }}>{state.coverage.live} canlı</strong>
                  {state.coverage.stale > 0 && <><span style={{ color: t.txt3 }}> · </span><strong style={{ color: t.warn }}>{state.coverage.stale} gecikmiş</strong></>}
                  {state.coverage.unsupported > 0 && <><span style={{ color: t.txt3 }}> · </span><span style={{ color: t.txt2 }}>{state.coverage.unsupported} yok</span></>}
                  {state.coverage.unread > 0 && <><span style={{ color: t.txt3 }}> · </span><span style={{ color: t.txt2 }}>{state.coverage.unread} bekliyor</span></>}
                </div>
                <div className="obdlive-conn-detail" data-obd-conn="" style={{ color: t.txt3, borderTop: `1px solid ${t.line}` }}>
                  {(state.deviceName || 'Adaptör bilinmiyor')}
                  {' · '}{state.source === 'real' ? 'Gerçek ECU' : state.source === 'mock' ? 'Benzetim' : 'Kaynak yok'}
                  {' · '}{fmtClockMs(state.lastSeenMs)}
                </div>
              </div>
            </section>
          </div>

          {/* ══ SAĞ — İKİNCİL OBD VERİLERİ ══ */}
          <aside className="obdlive-side obdlive-panel" data-obd-side=""
            style={{ background: t.panel, border: `1px solid ${t.line}` }}>
            <div className="obdlive-side-head" style={{ borderBottom: `1px solid ${t.line}` }}>
              <span className="obdlive-cap" style={{ color: t.txt3 }}>DİĞER OBD VERİLERİ</span>
              <span className="obdlive-side-count" style={{ color: t.txt3 }}>{listEntries.length}</span>
            </div>

            <div className="obdlive-side-scroll">
              {listEntries.map((e) => (
                <ListRow key={e.key} entry={e} reading={read(e)} t={t} />
              ))}

              {/* Hesaplanan değerler — ECU PID'i DEĞİL, etiketi bunu söyler (§12). */}
              <ListRow t={t} reading={state.fuelRemainingL}
                entry={{ key: 'calc-fuel-l', tier: 'list', core: true, label: 'Kalan yakıt (hesaplanan)', unit: 'L', min: 0, max: 80, bar: true, centered: false }}
                note={hasNumber(state.fuelRemainingL) ? 'L · hesaplanan' : undefined} />
              <ListRow t={t} reading={state.estimatedRangeKm}
                entry={{ key: 'calc-range-km', tier: 'list', core: true, label: 'Menzil (tahmini)', unit: 'km', min: 0, max: 1200, bar: true, centered: false }}
                note={hasNumber(state.estimatedRangeKm) ? 'km · tahmini' : undefined} />
            </div>
          </aside>
        </div>
      )}

      {/* ── ALT ŞERİT ─────────────────────────────────────────────────── */}
      <footer className="obdlive-bottom">
        <button type="button" className="obdlive-home" data-obd-home=""
          onClick={onHome} style={{ background: t.accent, color: t.onAccent }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M3 11l9-8 9 8" /><path d="M5 10v10h14V10" />
          </svg>
          <span className="obdlive-home-title">Ana Sayfa</span>
        </button>
        <div className="obdlive-foot-note" style={{ color: t.txt3 }}>
          Ölçek ve birimler SAE J1979 kayıt otoritesinden okunur · uyarı bölgesi çizilmez
        </div>
      </footer>
    </div>
  );
});

/* ══════════════════════════════════════════════════════════════════════════
 * Yerleşim — landscape head unit öncelikli, dar ekranlarda taşmaz (§14)
 * ════════════════════════════════════════════════════════════════════════ */

const CSS = `
.obdlive{width:100%;height:100%;box-sizing:border-box;display:flex;flex-direction:column;
  gap:clamp(8px,1.1vh,14px);padding:clamp(10px,1.7vh,20px) clamp(14px,1.7vw,26px);
  font-family:'Saira','Segoe UI',system-ui,sans-serif;overflow:hidden;
  font-variant-numeric:tabular-nums;}

.obdlive-top{position:relative;flex:0 0 auto;display:flex;align-items:center;
  gap:clamp(10px,1.3vw,22px);min-height:42px;}
.obdlive-brand{display:flex;align-items:center;gap:clamp(8px,0.8vw,13px);min-width:0;}
.obdlive-wordmark{font-size:clamp(15px,1.3vw,22px);font-weight:700;letter-spacing:3.4px;}
.obdlive-title{margin:0;font-size:clamp(10px,0.9vw,15px);font-weight:500;letter-spacing:1.6px;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.obdlive-sep{width:1px;height:24px;flex:0 0 auto;}
.obdlive-spacer{flex:1 1 auto;}
.obdlive-dots{display:flex;align-items:center;gap:8px;}
.obdlive-dots i{width:7px;height:7px;border-radius:4px;display:block;}
.obdlive-dots i.obdlive-dot-on{width:24px;}
.obdlive-chip{display:flex;align-items:center;gap:9px;height:36px;padding:0 14px;border-radius:18px;
  white-space:nowrap;}
.obdlive-chip i{width:9px;height:9px;border-radius:5px;display:block;}
.obdlive-chip span{font-size:clamp(10px,0.8vw,13px);font-weight:600;letter-spacing:1.3px;}
.obdlive-clock{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);
  text-align:center;white-space:nowrap;pointer-events:none;}
.obdlive-clock-time{font-size:clamp(20px,1.9vw,34px);font-weight:600;line-height:1;
  letter-spacing:0.5px;}
.obdlive-clock-date{font-size:clamp(10px,0.75vw,13px);margin-top:2px;white-space:nowrap;}

.obdlive-panel{box-sizing:border-box;border-radius:14px;min-width:0;}
.obdlive-cap{font-size:clamp(9px,0.68vw,11px);font-weight:600;letter-spacing:1.8px;}

.obdlive-body{flex:1 1 auto;min-height:0;display:flex;gap:clamp(8px,0.9vw,16px);}
.obdlive-main{flex:1 1 auto;min-width:0;min-height:0;display:flex;flex-direction:column;
  gap:clamp(8px,0.9vh,14px);}

/* LARGE */
.obdlive-hero{flex:1 1 auto;min-height:0;display:flex;gap:clamp(8px,0.9vw,16px);}
.obdlive-hero-panel{flex:1 1 0;display:flex;flex-direction:column;align-items:center;
  padding:clamp(8px,1.1vh,14px);min-width:140px;}
.obdlive-gauge-svg{width:100%;height:100%;min-height:0;flex:1 1 auto;}
.obdlive-gauge-num{font-weight:700;}

/* MINI — aynı görsel dil, daha küçük */
.obdlive-minis{flex:0 0 auto;display:grid;grid-template-columns:repeat(6,minmax(0,1fr));
  gap:clamp(6px,0.7vw,12px);}
.obdlive-mini{border-radius:14px;padding:clamp(6px,0.8vh,10px) clamp(6px,0.5vw,10px) 2px;
  display:flex;flex-direction:column;align-items:center;min-width:0;}
.obdlive-mini-label{font-size:clamp(9px,0.7vw,12px);white-space:nowrap;overflow:hidden;
  text-overflow:ellipsis;max-width:100%;text-align:center;}
.obdlive-mini .obdlive-gauge-svg{height:clamp(54px,9vh,96px);}

/* DURUM */
.obdlive-status{flex:0 0 auto;display:flex;gap:clamp(8px,0.9vw,16px);}
.obdlive-dtc{flex:1 1 auto;padding:clamp(7px,0.9vh,12px) clamp(10px,1vw,18px);display:flex;
  align-items:center;gap:clamp(8px,0.9vw,14px);}
.obdlive-dtc-icon{width:38px;height:38px;flex:0 0 auto;border-radius:19px;display:flex;
  align-items:center;justify-content:center;}
.obdlive-dtc-body{flex:1 1 auto;min-width:0;}
.obdlive-dtc-head{font-size:clamp(14px,1.15vw,20px);font-weight:600;line-height:1.15;margin-top:2px;}
.obdlive-scan{flex:0 0 auto;min-height:44px;padding:0 18px;border-radius:10px;cursor:pointer;
  font-family:inherit;font-size:clamp(11px,0.85vw,14px);font-weight:600;letter-spacing:1px;}
.obdlive-quality{flex:0 1 300px;min-width:180px;padding:clamp(7px,0.9vh,12px) clamp(10px,1vw,18px);
  display:flex;flex-direction:column;justify-content:center;gap:4px;}
.obdlive-quality-line{font-size:clamp(11px,0.9vw,15px);font-weight:600;white-space:nowrap;
  overflow:hidden;text-overflow:ellipsis;}
.obdlive-conn-detail{font-size:clamp(9px,0.7vw,11px);padding-top:4px;white-space:nowrap;
  overflow:hidden;text-overflow:ellipsis;}

/* SAĞ LİSTE */
.obdlive-side{flex:0 0 clamp(236px,24vw,400px);display:flex;flex-direction:column;
  padding:clamp(8px,1vh,14px) 0 0;min-height:0;}
.obdlive-side-head{display:flex;align-items:center;justify-content:space-between;
  padding:0 clamp(10px,1vw,16px) clamp(6px,0.8vh,10px);}
.obdlive-side-count{font-size:clamp(9px,0.7vw,11px);font-weight:600;}
.obdlive-side-scroll{flex:1 1 auto;min-height:0;overflow-y:auto;overscroll-behavior:contain;
  padding:0 clamp(10px,1vw,16px);}
.obdlive-row{display:flex;align-items:center;gap:clamp(6px,0.6vw,10px);
  padding:clamp(5px,0.65vh,9px) 0;}
.obdlive-row:last-child{border-bottom:0 !important;}
.obdlive-row-label{flex:1 1 auto;min-width:0;font-size:clamp(10px,0.78vw,13px);
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.obdlive-row-bar{flex:0 0 clamp(34px,3.4vw,54px);height:5px;border-radius:3px;
  overflow:hidden;display:block;}
.obdlive-row-bar--none{background:transparent !important;}
.obdlive-row-bar-fill{display:block;height:100%;border-radius:3px;}
.obdlive-row-value{flex:0 0 auto;font-size:clamp(12px,0.98vw,17px);font-weight:600;
  white-space:nowrap;text-align:right;min-width:clamp(62px,6vw,96px);}
.obdlive-row-value i{font-style:normal;font-weight:400;font-size:clamp(8px,0.62vw,10px);
  margin-left:4px;}

/* BAĞLANTI YOK */
.obdlive-empty{flex:1 1 auto;min-height:0;border-radius:18px;display:flex;flex-direction:column;
  align-items:center;justify-content:center;text-align:center;padding:20px;gap:clamp(6px,1.2vh,14px);}
.obdlive-empty-icon{width:clamp(70px,7.5vh,112px);height:clamp(70px,7.5vh,112px);border-radius:50%;
  display:flex;align-items:center;justify-content:center;}
.obdlive-empty-title{margin:0;font-size:clamp(22px,2.6vw,44px);font-weight:700;line-height:1.08;}
.obdlive-empty-text{margin:0;max-width:680px;font-size:clamp(12px,1vw,17px);line-height:1.6;}
.obdlive-empty-note{margin:0;padding:10px 16px;border-radius:10px;font-size:clamp(10px,0.8vw,13px);}

/* ALT */
.obdlive-bottom{flex:0 0 auto;display:flex;gap:clamp(8px,0.9vw,16px);align-items:center;}
.obdlive-home{flex:0 0 auto;min-width:150px;min-height:52px;border:0;border-radius:13px;
  cursor:pointer;padding:0 clamp(12px,1.1vw,18px);display:flex;align-items:center;
  justify-content:center;gap:9px;font-family:inherit;}
.obdlive-home:active{filter:brightness(0.94);}
.obdlive-home-title{font-size:clamp(13px,1vw,17px);font-weight:700;}
.obdlive-foot-note{flex:1 1 auto;min-width:0;font-size:clamp(9px,0.7vw,11px);text-align:right;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}

/* KISA EKRANLAR (telefon landscape ≈ 900×400) — hero ezilmez, ana sütun kayar.
   Head unit (1024×600) bu kırılıma GİRMEZ; orada her şey tek ekrana sığar. */
@media (max-height:520px){
  .obdlive-main{overflow-y:auto;overscroll-behavior:contain;}
  .obdlive-hero{flex:0 0 auto;height:clamp(180px,46vh,260px);}
  .obdlive-side{flex-basis:clamp(220px,24vw,320px);}
}

/* DAR EKRANLAR — 1024 px head unit sağ liste ile KALIR; yalnız daha darda yığılır */
@media (max-width:960px){
  .obdlive-minis{grid-template-columns:repeat(4,minmax(0,1fr));}
  .obdlive-clock{position:static;transform:none;text-align:right;}
  .obdlive-clock-time{font-size:clamp(16px,1.5vw,21px);}
}
@media (max-width:880px){
  .obdlive-body{flex-direction:column;overflow-y:auto;overscroll-behavior:contain;}
  .obdlive-main{flex:0 0 auto;overflow:visible;}
  .obdlive-hero{flex:0 0 auto;height:clamp(180px,40vh,260px);}
  .obdlive-side{flex:0 0 auto;}
  .obdlive-side-scroll{overflow:visible;}
}
@media (max-width:640px){
  .obdlive-hero{flex-wrap:wrap;height:auto;}
  .obdlive-hero-panel{flex-basis:calc(50% - 8px);min-height:170px;}
  .obdlive-minis{grid-template-columns:repeat(2,minmax(0,1fr));}
  .obdlive-title,.obdlive-clock-date,.obdlive-foot-note{display:none;}
}
`;

export default ObdLiveScreen;
