/**
 * DtcAuthorityScreen — CAROS LAB · Vehicle · KANONİK DTC OTORİTESİ (P0-OBD-CORE-03).
 *
 * SALT-OKUNUR. Tarama BAŞLATMAZ, OBD komutu GÖNDERMEZ, timer KURMAZ.
 * Yalnız `dtcAuthority` defterini okur (açılışta bir kez + elle YENİLE).
 *
 * ── NEDEN VAR ─────────────────────────────────────────────────────────────
 * DTC sonuçları SEKİZ ayrı state/store/model içinde yaşıyordu; yanlış tüketici
 * yalnız klasik `codes` dizisine (Mode 03) bakıyor ve multi-ECU / pending /
 * permanent / üretici bulgularını KAÇIRIYORDU. Boş dizi de sessizce "araç
 * temiz" hükmüne dönüşüyordu. Bu ekran, ürünün TEK kanonik gerçeğini gösterir:
 * hangi tüketici hangi snapshot'ı okuyorsa, gördüğü tam olarak budur.
 *
 * ── GİZLİLİK ──────────────────────────────────────────────────────────────
 * Yalnız OBD protokol verisi (kod · sınıf · ECU adresi/rolü · protokol).
 * VIN, konum ve kullanıcı verisi bu ekrana GİRMEZ.
 */

import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { RefreshCw, Layers, Cpu } from 'lucide-react';
import {
  readDtcAuthoritySnapshot, type DtcAuthorityLabSnapshot,
} from '../../../platform/devtools/dtcAuthoritySources';
import {
  DTC_OBSERVATION_CLASS_LABEL, DTC_SCAN_OUTCOME_LABEL,
  isCoverageLoss, isMeasuredOutcome,
  type DtcObservation, type DtcServiceScan, type VehicleDtcVerdict,
} from '../../../platform/obd/dtcAuthority';
import { formatDtcDisplayCode } from '../../../platform/obd/udsDtc';

type Tone = 'ok' | 'warn' | 'bad' | 'muted';

const TONE: Readonly<Record<Tone, string>> = {
  ok:    'border-[var(--oem-good)] bg-[var(--oem-good-soft)] text-[var(--oem-good)]',
  warn:  'border-[var(--oem-warn)] bg-[var(--oem-warn-soft)] text-[var(--oem-warn)]',
  bad:   'border-[var(--oem-danger)] bg-[var(--oem-danger-soft)] text-[var(--oem-danger)]',
  muted: 'border-[var(--oem-line-strong)] bg-[var(--oem-surface-2)] text-[var(--oem-ink-3)]',
};

const NA = 'UNAVAILABLE';

/** Hüküm → ton. `unproven` ASLA yeşil gösterilmez. */
function verdictTone(v: VehicleDtcVerdict): Tone {
  switch (v) {
    case 'clean':       return 'ok';
    case 'issues':      return 'bad';
    case 'unproven':    return 'warn';
    default:            return 'muted';   // not_scanned
  }
}

function scanTone(o: DtcServiceScan['outcome']): Tone {
  if (isMeasuredOutcome(o)) return 'ok';
  if (isCoverageLoss(o))    return 'bad';
  return 'muted';                          // unsupported — hata DEĞİL
}

function Chip({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-medium ${TONE[tone]}`}>
      {children}
    </span>
  );
}

const ObsRow = memo(function ObsRow({ o }: { o: DtcObservation }) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded border border-[var(--oem-line)] bg-[var(--oem-surface-1)] px-2 py-1 font-mono text-[10px]">
      {/* P0-OBD-FINISH: LAB da kodu ALT KODUYLA basar — otoritedeki kayıt
          `P0380(11)` ile `P0380(96)` artık AYRI, ekranda da AYRI görünür. */}
      <span className="text-[11px] font-semibold text-[var(--oem-ink-1)]">
        {formatDtcDisplayCode(o.dtcCode, o.failureType)}
      </span>
      <Chip tone="muted">{DTC_OBSERVATION_CLASS_LABEL[o.dtcClass]}</Chip>
      {/* Ham kanıt: ölçülmediyse HİÇ basılmaz (sahte '00' YASAK). */}
      {o.rawStatusByte !== undefined && (
        <span className="text-[var(--oem-ink-3)]">ST {o.rawStatusByte}</span>
      )}
      {o.rawDtc !== undefined && (
        <span className="text-[var(--oem-ink-3)]">ham {o.rawDtc}</span>
      )}
      <span className="flex items-center gap-1 text-[var(--oem-ink-3)]">
        <Cpu size={11} />
        {/* Fonksiyonel okuma tek ECU'ya ait DEĞİLDİR — uydurma adres yazılmaz. */}
        {o.ecuKey ?? 'FONKSİYONEL (7DF)'}
      </span>
      {/* Rol yalnız KANIT varsa gösterilir; 'unknown' bir rol değil, kanıt yokluğudur. */}
      {o.ecuRole !== null && <span className="text-[var(--oem-ink-3)]">rol: {o.ecuRole}</span>}
      <span className="text-[var(--oem-ink-3)]">servis {o.sourceService}</span>
      <span className="text-[var(--oem-ink-3)]">{o.protocol !== null ? `ATDPN ${o.protocol}` : NA}</span>
      <span className="text-[var(--oem-ink-3)]">oturum #{o.sessionEpoch}</span>
    </div>
  );
});

const ScanRow = memo(function ScanRow({ s }: { s: DtcServiceScan }) {
  return (
    <div className="flex flex-wrap items-center gap-2 font-mono text-[10px]">
      <span className="text-[var(--oem-ink-1)]">servis {s.service}</span>
      <span className="text-[var(--oem-ink-3)]">{s.ecuKey ?? 'FONKSİYONEL (7DF)'}</span>
      <Chip tone={scanTone(s.outcome)}>{DTC_SCAN_OUTCOME_LABEL[s.outcome]}</Chip>
      {/* "0 kod" YALNIZ ok taramada anlamlıdır. */}
      <span className={isMeasuredOutcome(s.outcome) ? 'text-[var(--oem-ink-1)]' : 'text-[var(--oem-ink-3)]'}>
        {isMeasuredOutcome(s.outcome) ? `${s.codeCount} kod` : NA}
      </span>
    </div>
  );
});

/** Bu snapshot'ı okuyan tüketiciler — hangi ekranın neye baktığı görünsün. */
const CONSUMERS: readonly string[] = [
  'DTC Paneli (UI)',
  'Mavi sesli asistan (commandExecutor)',
  'Mavi araç sağlığı (platformCoreMaviVoiceWiring)',
  'AI Mechanic aracı (maviTools.read_dtc)',
  'Uzak teşhis (remoteDiagnosticCommands)',
];

export default function DtcAuthorityScreen() {
  const [snap, setSnap] = useState<DtcAuthorityLabSnapshot | null>(null);
  /** Zero-leak: sökülmüş bileşene setState YAPILMAZ. */
  const mountedRef = useRef(true);

  const refresh = useCallback(() => {
    const s = readDtcAuthoritySnapshot();
    if (mountedRef.current) setSnap(s);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    refresh();                       // açılışta TEK okuma — abonelik/timer YOK
    return () => { mountedRef.current = false; };
  }, [refresh]);

  const sum = snap?.summary ?? null;
  const v   = snap?.verdict ?? null;

  return (
    <div className="flex flex-col gap-3 p-3" data-testid="dtc-authority-screen">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Layers size={14} className="text-[var(--oem-ink-3)]" />
          <span className="text-[12px] font-semibold text-[var(--oem-ink-1)]">Kanonik DTC Otoritesi</span>
          <span className="font-mono text-[10px] text-[var(--oem-ink-3)]">
            oturum {sum && sum.sessionEpoch >= 0 ? `#${sum.sessionEpoch}` : NA}
          </span>
        </div>
        <button
          onClick={refresh}
          className="flex items-center gap-1 rounded border border-[var(--oem-line-strong)] px-2 py-1 text-[10px] text-[var(--oem-ink-2)]"
        >
          <RefreshCw size={11} /> YENİLE
        </button>
      </div>

      {/* HÜKÜM — en üstte: "temiz" demenin TEK yeri burasıdır. */}
      {v !== null && (
        <div className={`rounded border px-2 py-1.5 ${TONE[verdictTone(v.verdict)]}`}>
          <div className="text-[10px] font-black uppercase tracking-wider">{v.verdict}</div>
          <div className="mt-0.5 text-[10px] leading-relaxed">{v.message}</div>
          {v.lossServices.length > 0 && (
            <div className="mt-0.5 font-mono text-[10px]">
              kapsam kaybı: {v.lossServices.join(' · ')}
            </div>
          )}
        </div>
      )}

      {sum !== null && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div className={`rounded border px-2 py-1.5 ${TONE[sum.total > 0 ? 'bad' : 'muted']}`}>
            <div className="text-[10px] opacity-90">Toplam gözlem</div>
            <div className="font-mono text-[11px] font-semibold">{sum.total}</div>
          </div>
          <div className={`rounded border px-2 py-1.5 ${TONE[sum.scannedServices > 0 ? 'ok' : 'muted']}`}>
            <div className="text-[10px] opacity-90">Taranan servis</div>
            <div className="font-mono text-[11px] font-semibold">{sum.scannedServices}</div>
          </div>
          <div className={`rounded border px-2 py-1.5 ${TONE[sum.failedServices > 0 ? 'bad' : 'muted']}`}>
            <div className="text-[10px] opacity-90">Düşen servis</div>
            <div className="font-mono text-[11px] font-semibold">{sum.failedServices}</div>
          </div>
          <div className={`rounded border px-2 py-1.5 ${TONE.muted}`}>
            <div className="text-[10px] opacity-90">Atlanan servis</div>
            <div className="font-mono text-[11px] font-semibold">{sum.skippedServices}</div>
          </div>
        </div>
      )}

      {/* Sınıfa göre */}
      {sum !== null && (
        <div className="flex flex-wrap gap-2">
          {(Object.keys(sum.byClass) as Array<keyof typeof sum.byClass>).map((k) => (
            <Chip key={k} tone={sum.byClass[k] > 0 ? 'bad' : 'muted'}>
              {DTC_OBSERVATION_CLASS_LABEL[k]}: {sum.byClass[k]}
            </Chip>
          ))}
        </div>
      )}

      {/* ECU'ya göre */}
      {sum !== null && sum.byEcu.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {sum.byEcu.map((e) => (
            <Chip key={e.ecuKey} tone="warn">
              {e.ecuKey === 'FUNC' ? 'FONKSİYONEL' : e.ecuKey}
              {e.ecuRole !== null ? ` (${e.ecuRole})` : ''}: {e.count}
            </Chip>
          ))}
        </div>
      )}

      {/* Servis tarama sonuçları */}
      <div className="grid gap-1">
        <div className="font-mono text-[10px] text-[var(--oem-ink-3)]">SERVİS TARAMA SONUÇLARI</div>
        {snap === null || snap.snap.scans.length === 0 ? (
          <div className="font-mono text-[10px] text-[var(--oem-ink-3)]">
            Hiç tarama yapılmadı — bu &quot;arıza yok&quot; DEMEK DEĞİLDİR.
          </div>
        ) : snap.snap.scans.map((s) => <ScanRow key={`${s.service}-${s.ecuKey ?? 'F'}`} s={s} />)}
      </div>

      {/* Gözlemler */}
      <div className="grid gap-1">
        <div className="font-mono text-[10px] text-[var(--oem-ink-3)]">GÖZLEMLER</div>
        {snap === null || snap.snap.observations.length === 0 ? (
          <div className="font-mono text-[10px] text-[var(--oem-ink-3)]">
            Gözlem yok. Bu &quot;temiz&quot; DEMEK DEĞİLDİR — hüküm için yukarıdaki karta bakın.
          </div>
        ) : snap.snap.observations.map((o) => (
          <ObsRow
            key={`${o.dtcCode}-${o.dtcClass}-${o.ecuKey ?? 'F'}-${o.failureType ?? ''}-${o.rawStatusByte ?? ''}`}
            o={o}
          />
        ))}
      </div>

      {/* Tüketiciler */}
      <div className="grid gap-0.5">
        <div className="font-mono text-[10px] text-[var(--oem-ink-3)]">BU SNAPSHOT&apos;I OKUYAN TÜKETİCİLER</div>
        {CONSUMERS.map((c) => (
          <div key={c} className="font-mono text-[10px] text-[var(--oem-ink-2)]">· {c}</div>
        ))}
      </div>

      <div className="font-mono text-[10px] text-[var(--oem-ink-3)]">
        son tarama: {sum?.lastScanAt != null ? new Date(sum.lastScanAt).toLocaleTimeString('tr-TR') : NA}
      </div>
    </div>
  );
}
