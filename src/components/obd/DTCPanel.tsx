import { memo, useState, useEffect } from 'react';
import { Capacitor } from '@capacitor/core';
import type { PluginListenerHandle } from '@capacitor/core';
import {
  AlertTriangle, CheckCircle2, RefreshCw, Trash2, Info, ShieldAlert,
  ChevronDown, ChevronUp, Clock, Lock, Camera, Gauge, Terminal, FlaskConical,
} from 'lucide-react';
import {
  useDTCState,
  readDTCCodes, clearDTCCodes, readAllDTCs, readFreezeFrame,
  type DTCCode, type DTCSeverity, type DTCCodeWithStatus, type FreezeFrameResult,
  type DtcScanCompleteness,
} from '../../platform/dtcService';
import { readDiagnosticStatus, type DiagnosticStatusResult } from '../../platform/obd/StandardPidEnums';
import { computeDtcVerdict, DTC_ADVISORY_TEXT, type DtcScanMode } from '../../platform/obd/dtcVerdict';
import { buildScanReport } from '../../platform/obd/scanReport';
import { runFullVehicleScan, type MultiEcuScanReport } from '../../platform/obd/multiEcuScan';
import { buildVehicleVerdict } from '../../platform/obd/verdictEngine';
import { logError } from '../../platform/crashLogger';
import { CarLauncher } from '../../platform/nativePlugin';
import { useDebugStore } from '../../platform/debug';
import { ObdRawView } from '../debug/ObdRawView';
import { SensorPanel } from './SensorPanel';
import { ObdLiveTestPanel } from './ObdLiveTestPanel';

/* ── Severity config ─────────────────────────────────────── */

const SEV: Record<DTCSeverity, { color: string; bg: string; border: string; label: string }> = {
  critical: {
    /* Kritik arıza → danger token */
    color: 'text-[color:var(--oem-danger)]',
    bg:    'bg-[var(--oem-danger-soft)]',
    border:'border-[var(--oem-danger)]',
    label: 'Kritik',
  },
  warning: {
    /* Uyarı → warn token */
    color: 'text-[color:var(--oem-warn)]',
    bg:    'bg-[var(--oem-warn-soft)]',
    border:'border-[var(--oem-warn)]',
    label: 'Uyarı',
  },
  info: {
    /* Bilgi → info token */
    color: 'text-[color:var(--oem-info)]',
    bg:    'bg-[var(--oem-info-soft)]',
    border:'border-[var(--oem-info)]',
    label: 'Bilgi',
  },
};

/* ── DTC Code card ───────────────────────────────────────── */

const DTCCodeCard = memo(function DTCCodeCard({
  code, freezeFrame, ffExpanded, onToggleFreezeFrame,
}: {
  code: DTCCode;
  /** Patch 11B: yalnız `freezeFrame.dtc === code.code` eşleşirse genişletilebilir satır gösterilir. */
  freezeFrame?: FreezeFrameResult | null;
  ffExpanded?: boolean;
  onToggleFreezeFrame?: () => void;
}) {
  const cfg = SEV[code.severity];
  const hasFreezeFrame = !!freezeFrame && freezeFrame.dtc === code.code;

  return (
    <div className={`rounded-2xl border p-4 ${cfg.bg} ${cfg.border}`}>
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          {/* Code + badge */}
          <div className="flex items-center gap-2 mb-1.5 flex-wrap">
            <span className={`font-black text-lg tracking-widest tabular-nums ${cfg.color}`}>
              {code.code}
            </span>
            <span className={`text-[9px] font-black uppercase px-1.5 py-0.5 rounded-full border ${cfg.color} ${cfg.border} ${cfg.bg}`}>
              {cfg.label}
            </span>
            <span className="text-[color:var(--oem-ink-3)] text-[10px]">{code.system}</span>
          </div>

          {/* Description */}
          <div className="text-[color:var(--oem-ink)] text-sm font-semibold leading-snug mb-2">
            {code.description}
          </div>

          {/* Possible causes */}
          {code.possibleCauses.length > 0 && (
            <div>
              <div className="flex items-center gap-1 text-[color:var(--oem-ink-3)] text-[10px] uppercase tracking-widest mb-1.5">
                <Info className="w-3 h-3" />
                Olası Nedenler
              </div>
              <div className="flex flex-wrap gap-1.5">
                {code.possibleCauses.map((cause, i) => (
                  <span
                    key={i}
                    /* Olası neden etiketi → surface-2 / oem-line */
                    className="text-[10px] text-[color:var(--oem-ink-2)] bg-[var(--oem-surface-2)] border border-[var(--oem-line)] px-2 py-0.5 rounded-full"
                  >
                    {cause}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Freeze frame — arıza anı verisi (Patch 11B) */}
          {hasFreezeFrame && (
            <div className="mt-3">
              <button
                onClick={onToggleFreezeFrame}
                className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wider text-[color:var(--oem-ink-2)] opacity-70 hover:opacity-100 transition-opacity"
              >
                <Camera className="w-3.5 h-3.5" />
                Arıza Anı Verisi
                {ffExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              </button>
              {ffExpanded && (
                <div className="mt-2 grid grid-cols-2 gap-2">
                  {freezeFrame!.values.length === 0 ? (
                    <div className="col-span-2 text-[10px] text-[color:var(--oem-ink-3)] opacity-60">
                      Arıza anına ait sensör verisi okunamadı.
                    </div>
                  ) : freezeFrame!.values.map((v) => (
                    <div key={v.pid} className="bg-[var(--oem-surface-2)] border border-[var(--oem-line)] rounded-lg px-2 py-1.5">
                      <div className="text-[9px] text-[color:var(--oem-ink-3)] uppercase tracking-wider">{v.name}</div>
                      <div className="text-xs font-bold text-[color:var(--oem-ink)] tabular-nums">
                        {Number.isInteger(v.value) ? v.value : v.value.toFixed(1)} {v.unit}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <AlertTriangle className={`w-5 h-5 flex-shrink-0 mt-0.5 ${cfg.color}`} />
      </div>
    </div>
  );
});

/* ── Main panel ──────────────────────────────────────────── */

function DTCPanelInner({ active = false }: { active?: boolean }) {
  const dtc = useDTCState();

  // ── Ham OBD trafik teşhisi (adb'siz) ────────────────────────────────────────
  // Panel görünürken ELM327 komut/yanıt yakalamayı aç → "obdTraffic" olayını debug
  // store'a köprüle. Head unit'te adb/logcat yoksa OBD el sıkışması + ham DTC yanıtını
  // ekrandan okumanın tek yolu. Panel gizlenince/unmount'ta kapatılır (sıfır ek yük).
  const [showRaw, setShowRaw] = useState(false);
  const [showLiveTest, setShowLiveTest] = useState(false);
  // Teşhis HTTP sunucusu adresi (PC aynı WiFi'dan ham trafiği JSON çeker) — adb'siz.
  const [diagAddr, setDiagAddr] = useState<string | null>(null);
  useEffect(() => {
    if (!active || !Capacitor.isNativePlatform()) return;
    let handle: PluginListenerHandle | null = null;
    let cancelled = false;

    CarLauncher.setObdTrafficCapture?.({ enable: true }).catch(() => {});
    // GÜVENLİK (P0): Teşhis HTTP sunucusu (port 8899) ağ üzerinden ham OBD + /enable-adb
    // ifşa eder → yalnız development build'de başlat. Release'te native taraf da no-op
    // (BuildConfig.DEBUG) — bu guard ikinci savunma katmanı + gereksiz native çağrıyı önler.
    if (import.meta.env.DEV) {
      // Teşhis portunu aç → PC http://<ip>:8899/ ile ham OBD trafiğini çeker.
      CarLauncher.startDiagServer?.()
        .then((r) => { if (!cancelled && r?.ip) setDiagAddr(`http://${r.ip}:${r.port}/`); })
        .catch(() => {});
    }
    CarLauncher.addListener('obdTraffic', (e) => {
      useDebugStore.getState().pushObdTraffic({
        ts: e.ts || Date.now(), cmd: e.cmd, resp: e.resp, ms: e.ms,
      });
    })
      .then((h) => { if (cancelled) h.remove(); else handle = h; })
      .catch(() => {});

    return () => {
      cancelled = true;
      handle?.remove();
      CarLauncher.setObdTrafficCapture?.({ enable: false }).catch(() => {});
      CarLauncher.stopDiagServer?.().catch(() => {});
      setDiagAddr(null);
    };
  }, [active]);

  // Patch 11: Mode 07/0A/02/readiness — dtcService/StandardPidEnums'in modül durumuna
  // dokunmaz (regresyon-kilitli DTCState/readDTCCodes AYNEN korunur), yalnız bu panelin
  // yerel state'i.
  const [pending, setPending] = useState<DTCCodeWithStatus[]>([]);
  const [permanent, setPermanent] = useState<DTCCodeWithStatus[]>([]);
  const [permanentSupported, setPermanentSupported] = useState(true);
  const [freezeFrame, setFreezeFrame] = useState<FreezeFrameResult | null>(null);
  const [ffExpanded, setFfExpanded] = useState(false);
  const [diagStatus, setDiagStatus] = useState<DiagnosticStatusResult | null>(null);
  const [monitorsExpanded, setMonitorsExpanded] = useState(false);
  const [isDeepScanning, setIsDeepScanning] = useState(false);
  // OBD-OS-F0-1: fail-closed verdi girdileri — mod-bazlı kapsam + PID01 okunabildi mi.
  const [completeness, setCompleteness] = useState<DtcScanCompleteness | null>(null);
  const [statusFailed, setStatusFailed] = useState(false);
  // OBD-OS-F0-6: Mode 04 yazma kapısı — açık onay aşaması + kapı reddi geri bildirimi.
  const [clearArmed, setClearArmed] = useState(false);
  const [clearDenial, setClearDenial] = useState<string | null>(null);
  const [engineRunningWarn, setEngineRunningWarn] = useState(false);
  // OBD-OS-F2: çoklu-ECU tarama sonucu (null = çalışmadı/desteklenmiyor → tek-ECU akışı).
  const [multiEcu, setMultiEcu] = useState<MultiEcuScanReport | null>(null);

  const criticalCount = dtc.codes.filter((c) => c.severity === 'critical').length;
  const warningCount  = dtc.codes.filter((c) => c.severity === 'warning').length;

  const lastReadStr = dtc.lastReadAt
    ? new Date(dtc.lastReadAt).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })
    : null;

  /**
   * Tek buton hepsini okur: mevcut Mode 03 akışı (readDTCCodes — regresyon kilidi
   * AYNEN korunur) + Patch 11 okumaları. Her alt adım fail-soft (dtcService/
   * StandardPidEnums içinde zaten try/catch'li) — biri düşerse diğerleri gelir.
   */
  async function handleFullScan(): Promise<void> {
    await readDTCCodes();
    setIsDeepScanning(true);
    try {
      const [all, ff, diag] = await Promise.all([
        readAllDTCs(),
        readFreezeFrame(),
        readDiagnosticStatus(),
      ]);
      setPending(all.codes.filter((c) => c.status === 'pending'));
      setPermanent(all.codes.filter((c) => c.status === 'permanent'));
      setPermanentSupported(all.permanentSupported);
      setCompleteness(all.completeness);
      setFreezeFrame(ff);
      setDiagStatus(diag);
      // Native'de PID01 (MIL/monitör) okunamadıysa verdi belirsizleşmeli (kanıt eksik).
      setStatusFailed(Capacitor.isNativePlatform() && diag === null);

      // OBD-OS-F2: ÇOKLU-ECU TARAMASI — yukarıdaki akış yalnız motor ECU'sunu görür.
      // Burada araçtaki DİĞER ECU'lar (ABS/airbag/şanzıman…) keşfedilip DTC'leri okunur.
      // Fail-soft: bu adım düşerse mevcut tek-ECU sonucu AYNEN durur (regresyon yok).
      try {
        const scan = await runFullVehicleScan();
        setMultiEcu(scan);
      } catch (e) {
        logError('DTCPanel:MultiEcuScanFailed', e);
        setMultiEcu(null);
      }
    } finally {
      setIsDeepScanning(false);
    }
  }

  /**
   * OBD-OS-F0-6: Mode 04 (hafıza silme) — İKİ AŞAMALI. İlk tıklama yalnız "kurar"
   * (yıkıcı eylemin ne sildiğini söyler); ikinci tıklama `confirmed:true` ile gönderir.
   * Nihai karar YİNE DE servisteki WriteGate'e aittir (hız/tazelik/bağlantı kanıtını
   * UI'dan DEĞİL, OBD servisinden okur) — buradaki onay onun yalnız BİR kapısıdır.
   */
  async function handleClear(): Promise<void> {
    setClearDenial(null);
    if (!clearArmed) { setClearArmed(true); return; }
    const decision = await clearDTCCodes({ confirmed: true });
    setClearArmed(false);
    setEngineRunningWarn(decision.advisories.includes('engine_running'));
    if (!decision.allowed) setClearDenial(decision.userMessage);
  }

  // ── OBD-OS-F0-1: fail-closed verdi ──────────────────────────────────────────
  // "SİSTEM TEMİZ" artık YALNIZ Mode 03'e bakmaz: bekleyen/kalıcı kod, yanan MIL veya
  // düşen bir okuma varsa "temiz" DENMEZ. Kanıt eksikse "kısmi tarama, kesin değil".
  const failedModes: DtcScanMode[] = [];
  if (dtc.error || dtc.isStale || completeness?.stored === 'failed') failedModes.push('stored');
  if (completeness?.pending === 'failed')   failedModes.push('pending');
  if (completeness?.permanent === 'failed') failedModes.push('permanent');
  if (statusFailed)                         failedModes.push('status');

  const verdict = computeDtcVerdict({
    scanRan:        !!dtc.lastReadAt,
    storedCount:    dtc.codes.length,
    pendingCount:   pending.length,
    permanentCount: permanent.length,
    mil:            diagStatus ? diagStatus.mil : null,
    pid01DtcCount:  diagStatus ? diagStatus.dtcCount : null,
    failedModes,
  });

  // OBD-OS-F1-4: tarama KAPSAMI — "temiz" demek yetmez, kullanıcı NE KADARININ
  // tarandığını görmeli. 'unsupported' kapsam kaybı DEĞİL (araçta o mod yok) → rozet
  // bunu "desteklemiyor" diye ayrı söyler, coverage'ı düşürmez.
  const scanReport = buildScanReport({
    stored:    !dtc.lastReadAt ? 'not_run'
             : (dtc.error || dtc.isStale || completeness?.stored === 'failed') ? 'failed' : 'ok',
    pending:   !completeness ? 'not_run' : completeness.pending,
    permanent: !completeness ? 'not_run' : completeness.permanent,
    status:    !dtc.lastReadAt ? 'not_run'
             : statusFailed ? 'failed'
             : diagStatus ? 'ok' : 'not_run',
  });

  // OBD-OS-F4-1: tüm kanıtlar → TEK verdi + AKSİYON. Güven KANITTAN türer: göremediğimiz
  // her şey (düşen okuma, taranmayan ECU, keşif yokluğu) güveni düşürür — sabit değildir.
  const vehicleVerdict = buildVehicleVerdict({
    dtc: verdict,
    scan: scanReport,
    multiEcu,
    criticalCodes: dtc.codes.filter((c) => c.severity === 'critical').map((c) => c.code),
  });

  const readyMonitors  = diagStatus?.monitors.filter((m) => m.available && m.ready).length ?? 0;
  const totalMonitors  = diagStatus?.monitors.filter((m) => m.available).length ?? 0;
  const isBusy = dtc.isReading || isDeepScanning;

  return (
    <div
      className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden"
      style={{ WebkitOverflowScrolling: 'touch', touchAction: 'pan-y', overscrollBehavior: 'contain' } as React.CSSProperties}
    >
    <div className="flex flex-col gap-5 p-6 glass-card border-none !shadow-none">

      {/* ── Title row ──────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-3">
            {/* Başlık ikonu → warn token (tanı/uyarı semantiği) */}
            <div className="w-10 h-10 rounded-xl bg-[var(--oem-warn-soft)] border border-[var(--oem-warn)] flex items-center justify-center">
              <ShieldAlert className="w-6 h-6 text-[color:var(--oem-warn)]" />
            </div>
            <div>
              <span className="text-[color:var(--oem-ink)] font-black text-lg uppercase tracking-widest">Arıza Teşhisi</span>
              {lastReadStr && (
                <div className="text-[color:var(--oem-ink-2)] text-[11px] font-bold uppercase tracking-wider mt-0.5 opacity-60">
                  Son tarama: {lastReadStr}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Severity counters */}
        <div className="flex items-center gap-2.5">
          {criticalCount > 0 && (
            /* Kritik sayaç rozeti → danger token */
            <div className="bg-[var(--oem-danger-soft)] border border-[var(--oem-danger)] rounded-full px-3 py-1.5 text-[color:var(--oem-danger)] text-[10px] font-black uppercase tracking-wider shadow-sm">
              {criticalCount} KRİTİK
            </div>
          )}
          {warningCount > 0 && (
            /* Uyarı sayaç rozeti → warn token */
            <div className="bg-[var(--oem-warn-soft)] border border-[var(--oem-warn)] rounded-full px-3 py-1.5 text-[color:var(--oem-warn)] text-[10px] font-black uppercase tracking-wider shadow-sm">
              {warningCount} UYARI
            </div>
          )}
        </div>
      </div>

      {/* ── Action buttons ─────────────────────────────── */}
      <div className="flex gap-4">
        <button
          onClick={handleFullScan}
          disabled={isBusy}
          className="flex-1 h-14 flex items-center justify-center gap-3 rounded-2xl font-black text-sm uppercase tracking-widest disabled:opacity-50 disabled:cursor-not-allowed transition-all active:scale-95 shadow-md"
          /* Tarama butonu → accent token (aksiyon/birincil) */
          style={{ background: 'var(--oem-accent-soft)', border: '1px solid var(--oem-accent)', color: 'var(--oem-accent)' }}
        >
          <RefreshCw className={`w-5 h-5 ${isBusy ? 'animate-spin' : ''}`} />
          {isBusy ? 'OKUNUYOR…' : 'TARAMAYI BAŞLAT'}
        </button>

        <button
          onClick={handleClear}
          disabled={dtc.isClearing || dtc.codes.length === 0}
          /* Temizle butonu → danger token (yıkıcı eylem) */
          className="flex-1 h-14 flex items-center justify-center gap-3 bg-[var(--oem-danger-soft)] border border-[var(--oem-danger)] text-[color:var(--oem-danger)] rounded-2xl font-black text-sm uppercase tracking-widest hover:opacity-80 disabled:opacity-50 disabled:cursor-not-allowed transition-all active:scale-95 shadow-md"
        >
          <Trash2 className={`w-5 h-5 ${dtc.isClearing ? 'animate-spin' : ''}`} />
          {dtc.isClearing ? 'SİLİNİYOR…' : clearArmed ? 'ONAYLA — KALICI SİL' : 'HAFIZAYI TEMİZLE'}
        </button>
      </div>

      {/* ── OBD-OS-F4-1: ARAÇ VERDİSİ + AKSİYON (8. kapı: "en doğru aksiyon?") ── */}
      {/* Kanıt listelemek yetmez — karar ve aksiyon üretilir. Güven KANITTAN türer:
          "%100 temiz" demek için her şeyi görmüş olmak gerekir. */}
      {vehicleVerdict.level !== 'not_scanned' && (
        <div className={`rounded-2xl border p-4 ${
          vehicleVerdict.level === 'critical'      ? 'border-[var(--oem-danger)] bg-[var(--oem-danger-soft)]'
          : vehicleVerdict.level === 'attention'   ? 'border-[var(--oem-warn)] bg-[var(--oem-warn-soft)]'
          : vehicleVerdict.level === 'inconclusive'? 'border-[var(--oem-warn)] bg-[var(--oem-surface-2)]'
          : 'border-[var(--oem-success)] bg-[var(--oem-success-soft)]'
        }`}>
          <div className="flex items-start justify-between gap-3 mb-2">
            <span className={`font-black text-sm uppercase tracking-wide ${
              vehicleVerdict.level === 'critical'    ? 'text-[color:var(--oem-danger)]'
              : vehicleVerdict.level === 'attention' || vehicleVerdict.level === 'inconclusive'
                                                     ? 'text-[color:var(--oem-warn)]'
              : 'text-[color:var(--oem-success)]'
            }`}>
              {vehicleVerdict.headline}
            </span>
            {/* Güven: sabit değil — ne kadarını görebildiğimizle orantılı. */}
            <span className="shrink-0 text-[10px] font-black uppercase tracking-widest text-[color:var(--oem-text-dim)]">
              güven %{Math.round(vehicleVerdict.confidence * 100)}
            </span>
          </div>

          <div className="text-[11px] leading-relaxed text-[color:var(--oem-text-dim)] mb-3">
            {vehicleVerdict.confidenceReason}
          </div>

          {vehicleVerdict.actions.length > 0 && (
            <div className="space-y-2">
              {vehicleVerdict.actions.map((a) => (
                <div key={a.id} className="flex items-start gap-2.5">
                  <span className={`shrink-0 mt-0.5 w-5 h-5 rounded-full grid place-items-center text-[10px] font-black ${
                    a.priority === 1 ? 'bg-[var(--oem-danger)] text-white'
                    : a.priority === 2 ? 'bg-[var(--oem-warn)] text-black'
                    : 'bg-[var(--oem-surface-3)] text-[color:var(--oem-text-dim)]'
                  }`}>
                    {a.priority}
                  </span>
                  <div className="min-w-0">
                    <div className="text-xs font-bold text-[color:var(--oem-text)]">{a.title}</div>
                    <div className="text-[11px] leading-relaxed text-[color:var(--oem-text-dim)]">{a.reason}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── OBD-OS-F1-4: tarama kapsamı rozeti ─────────────────────── */}
      {/* "Temiz" demek yetmez: kullanıcı NE KADARININ tarandığını görmeli. Kısmi taramada
          coverage<1 ve düşen modlar AÇIKÇA yazılır (sessiz eksiklik = yanlış güven). */}
      {!!dtc.lastReadAt && (
        <div className="rounded-2xl border border-[var(--oem-border)] bg-[var(--oem-surface-2)] p-3.5">
          <div className="flex items-center justify-between gap-3 mb-2.5">
            <span className="text-[10px] font-black uppercase tracking-widest text-[color:var(--oem-text-dim)]">
              Tarama kapsamı
            </span>
            <span className={`text-[10px] font-black uppercase tracking-widest ${
              scanReport.failedCount > 0 ? 'text-[color:var(--oem-warn)]' : 'text-[color:var(--oem-success)]'
            }`}>
              %{Math.round(scanReport.coverage * 100)}
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            {scanReport.modes.filter((m) => m.status !== 'not_run').map((m) => (
              <span
                key={m.mode}
                className={`px-2.5 py-1 rounded-full text-[10px] font-bold border ${
                  m.status === 'ok'
                    ? 'border-[var(--oem-success)] text-[color:var(--oem-success)] bg-[var(--oem-success-soft)]'
                    : m.status === 'failed'
                      ? 'border-[var(--oem-warn)] text-[color:var(--oem-warn)] bg-[var(--oem-warn-soft)]'
                      : 'border-[var(--oem-border)] text-[color:var(--oem-text-dim)]'
                }`}
              >
                {m.label} {m.status === 'ok' ? '✓' : m.status === 'failed' ? 'okunamadı' : 'desteklenmiyor'}
              </span>
            ))}
          </div>
          <div className="mt-2 text-[11px] leading-relaxed text-[color:var(--oem-text-dim)]">
            {scanReport.summary}
          </div>
        </div>
      )}

      {/* ── OBD-OS-F2: ÇOKLU-ECU TARAMASI (Car Scanner farkı) ──────── */}
      {/* Motor DIŞINDAKİ ECU'lar (ABS/airbag/şanzıman…) artık taranıyor. Kod HANGİ ECU'dan
          geldiğini taşır. Keşif çalışmadıysa (probedAt null) bölüm HİÇ gösterilmez —
          "ECU yok" ile "bakılmadı" karıştırılmaz (fail-closed). */}
      {multiEcu && multiEcu.topology.probedAt !== null && (
        <div className="rounded-2xl border border-[var(--oem-border)] bg-[var(--oem-surface-2)] p-3.5">
          <div className="flex items-center justify-between gap-3 mb-2.5">
            <span className="text-[10px] font-black uppercase tracking-widest text-[color:var(--oem-text-dim)]">
              Araç ECU’ları
            </span>
            <span className="text-[10px] font-black uppercase tracking-widest text-[color:var(--oem-accent)]">
              {multiEcu.scannedEcus} ECU tarandı
              {multiEcu.skippedEcus > 0 && ` · ${multiEcu.skippedEcus} atlandı`}
            </span>
          </div>

          {multiEcu.topology.probeEmpty ? (
            <div className="text-[11px] text-[color:var(--oem-text-dim)]">
              Hiçbir ECU yanıt vermedi — adaptör veya araç bu keşfi desteklemiyor olabilir.
            </div>
          ) : (
            <div className="space-y-1.5">
              {multiEcu.results.map((r) => {
                const failed = r.stored === 'failed' && r.pending === 'failed' && r.permanent === 'failed';
                return (
                  <div key={r.ecu.txHeader} className="flex items-center justify-between gap-3 text-xs">
                    <span className="font-bold text-[color:var(--oem-text)]">{r.ecu.label}</span>
                    <span className={
                      failed ? 'text-[color:var(--oem-warn)] font-bold'
                      : r.codes.length > 0 ? 'text-[color:var(--oem-danger)] font-black'
                      : 'text-[color:var(--oem-success)] font-bold'
                    }>
                      {failed ? 'okunamadı'
                        : r.codes.length > 0 ? `${r.codes.length} kod`
                        : 'temiz'}
                    </span>
                  </div>
                );
              })}
            </div>
          )}

          {/* Motor DIŞI ECU'lardan gelen kodlar — bugüne kadar HİÇ görünmüyorlardı. */}
          {multiEcu.allCodes.filter((c) => c.ecuTxHeader !== '7E0').length > 0 && (
            <div className="mt-3 pt-3 border-t border-[var(--oem-border)] space-y-1">
              {multiEcu.allCodes.filter((c) => c.ecuTxHeader !== '7E0').map((c, i) => (
                <div key={`${c.ecuTxHeader}-${c.code}-${i}`} className="flex items-center gap-2 text-xs">
                  <span className="font-black tracking-widest text-[color:var(--oem-danger)]">{c.code}</span>
                  <span className="text-[color:var(--oem-text-dim)]">— {c.ecuLabel}</span>
                </div>
              ))}
            </div>
          )}

          {multiEcu.failedReads > 0 && (
            <div className="mt-2 text-[11px] text-[color:var(--oem-warn)]">
              {multiEcu.failedReads} okuma tamamlanamadı — bu tarama KISMİ, sonuç kesin değil.
            </div>
          )}
        </div>
      )}

      {/* ── OBD-OS-F1-2: MIL/DTC tutarsızlık uyarısı ───────────────── */}
      {/* ECU arıza bildiriyor ama standart modlarda kod yok → üretici-özel kod (UDS 0x19).
          "Kod yok" demek yanlış güven olurdu; taramanın YETMEDİĞİNİ açıkça söylüyoruz. */}
      {verdict.advisories.includes('mil_without_codes') && (
        <div className="rounded-2xl border border-[var(--oem-warn)] bg-[var(--oem-warn-soft)] p-4 flex items-start gap-3">
          <ShieldAlert className="w-5 h-5 shrink-0 text-[color:var(--oem-warn)]" />
          <div className="text-[color:var(--oem-warn)]">
            <div className="font-black text-xs uppercase tracking-wider mb-1">
              {DTC_ADVISORY_TEXT.mil_without_codes.title}
            </div>
            <div className="text-xs leading-relaxed opacity-90">
              {DTC_ADVISORY_TEXT.mil_without_codes.body}
            </div>
          </div>
        </div>
      )}

      {/* ── OBD-OS-F0-6: yazma kapısı geri bildirimi ───────────────── */}
      {clearArmed && !dtc.isClearing && (
        <div className="rounded-2xl border border-[var(--oem-danger)] bg-[var(--oem-danger-soft)] p-4 flex items-start gap-3">
          <ShieldAlert className="w-5 h-5 shrink-0 text-[color:var(--oem-danger)]" />
          <div className="text-xs leading-relaxed text-[color:var(--oem-danger)]">
            <span className="font-black uppercase tracking-wider">Kalıcı işlem.</span>{' '}
            Arıza kanıtı ve emisyon hazırlık verisi (readiness) silinir — araç muayeneye
            "hazır değil" girebilir. Arıza giderilmediyse kod geri gelir.
            Onaylamak için tekrar basın; vazgeçmek için tarama yapın.
          </div>
        </div>
      )}
      {clearDenial && (
        <div className="rounded-2xl border border-[var(--oem-warn)] bg-[var(--oem-warn-soft)] p-4 flex items-start gap-3">
          <Lock className="w-5 h-5 shrink-0 text-[color:var(--oem-warn)]" />
          <div className="text-xs leading-relaxed text-[color:var(--oem-warn)]">{clearDenial}</div>
        </div>
      )}
      {engineRunningWarn && !clearDenial && (
        <div className="rounded-2xl border border-[var(--oem-info)] bg-[var(--oem-info-soft)] p-4 flex items-start gap-3">
          <Info className="w-5 h-5 shrink-0 text-[color:var(--oem-info)]" />
          <div className="text-xs leading-relaxed text-[color:var(--oem-info)]">
            Motor çalışıyordu — arıza hâlâ mevcutsa ECU kodu anında yeniden yazabilir.
          </div>
        </div>
      )}

      {/* ── Codes / empty state ────────────────────────── */}
      <div className="flex-1">
        {dtc.codes.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-5 glass-card border-none !shadow-none">
            {verdict.verdict === 'clean' ? (
              <>
                {/* Fail-closed TEMİZ → good token (yalnız tüm modlar başarılı + bulgu yok) */}
                <div className="w-20 h-20 rounded-full bg-[var(--oem-good-soft)] flex items-center justify-center border border-[var(--oem-good)]">
                  <CheckCircle2 className="w-10 h-10 text-[color:var(--oem-good)]" />
                </div>
                <div className="text-center">
                  <div className="text-[color:var(--oem-good)] font-black text-xl uppercase tracking-widest">SİSTEM TEMİZ</div>
                  <div className="text-[color:var(--oem-ink-2)] text-sm font-bold mt-2 opacity-70 uppercase tracking-wider">
                    Denetlenen tüm modlar temiz
                  </div>
                </div>
              </>
            ) : verdict.verdict === 'issues' ? (
              <>
                {/* Mode 03 boş AMA bekleyen/kalıcı kod veya MIL var → warn token (yalancı temiz DEĞİL) */}
                <div className="w-20 h-20 rounded-full bg-[var(--oem-warn-soft)] flex items-center justify-center border border-[var(--oem-warn)]">
                  <AlertTriangle className="w-10 h-10 text-[color:var(--oem-warn)]" />
                </div>
                <div className="text-center max-w-md">
                  <div className="text-[color:var(--oem-warn)] font-black text-base uppercase tracking-widest leading-snug">
                    Onaylı kod yok — ancak bulgu var
                  </div>
                  <div className="text-[color:var(--oem-ink-2)] text-xs font-bold mt-2 opacity-80">
                    {verdict.reason}
                  </div>
                  <div className="text-[color:var(--oem-ink-3)] text-[11px] font-bold mt-1 opacity-60 uppercase tracking-wider">
                    Aşağıdaki bekleyen/kalıcı kod ve muayene bölümlerine bakın
                  </div>
                </div>
              </>
            ) : verdict.verdict === 'inconclusive' ? (
              <>
                {/* Bir okuma düştü → tarama KISMİ → "temiz" DEME (fail-closed) */}
                <div className="w-20 h-20 rounded-full bg-[var(--oem-warn-soft)] flex items-center justify-center border border-[var(--oem-warn)]">
                  <AlertTriangle className="w-10 h-10 text-[color:var(--oem-warn)]" />
                </div>
                <div className="text-center max-w-md">
                  <div className="text-[color:var(--oem-warn)] font-black text-base uppercase tracking-widest">Kısmi tarama — kesin değil</div>
                  <div className="text-[color:var(--oem-ink-2)] text-xs font-bold mt-2 opacity-80">
                    {verdict.reason}
                  </div>
                </div>
              </>
            ) : (
              <>
                {/* Henüz tarama yapılmadı → surface-3 / oem-line */}
                <div className="w-20 h-20 rounded-full bg-[var(--oem-surface-3)] flex items-center justify-center border border-[var(--oem-line-strong)]">
                  <AlertTriangle className="w-10 h-10 text-[color:var(--oem-ink-2)] opacity-40" />
                </div>
                <div className="text-center">
                  <div className="text-[color:var(--oem-ink-2)] font-black text-lg uppercase tracking-widest opacity-60">HENÜZ TARAMA YAPILMADI</div>
                  <div className="text-[color:var(--oem-ink-2)] text-[11px] font-bold mt-2 opacity-40 uppercase tracking-widest">
                    OBD TARAMASI İÇİN BUTONA BASIN
                  </div>
                </div>
              </>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {/* Sort: critical first */}
            {[...dtc.codes]
              .sort((a, b) => {
                const order: Record<DTCSeverity, number> = { critical: 0, warning: 1, info: 2 };
                return order[a.severity] - order[b.severity];
              })
              .map((code) => (
                <DTCCodeCard
                  key={code.code}
                  code={code}
                  freezeFrame={freezeFrame}
                  ffExpanded={ffExpanded}
                  onToggleFreezeFrame={() => setFfExpanded((v) => !v)}
                />
              ))}
          </div>
        )}
      </div>

      {/* ── Bekleyen / Kalıcı kodlar + Muayene hazırlığı (Patch 11) ────── */}
      {/* Yalnız bir tarama yapıldıysa görünür — taramadan önce anlamsız/gürültü. */}
      {dtc.lastReadAt && (
        <div className="flex flex-col gap-4">
          {/* Bekleyen (Mode 07) */}
          <div>
            <div className="flex items-center gap-2 mb-2 px-1">
              <Clock className="w-4 h-4 text-[color:var(--oem-ink-2)] opacity-60" />
              <span className="text-[color:var(--oem-ink-2)] text-[11px] font-black uppercase tracking-widest opacity-60">
                Bekleyen Kodlar {pending.length > 0 ? `(${pending.length})` : ''}
              </span>
            </div>
            {pending.length === 0 ? (
              <div className="text-[10px] text-[color:var(--oem-ink-3)] opacity-50 px-1">
                Bekleyen arıza kodu yok.
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {pending.map((c) => <DTCCodeCard key={c.code} code={c} />)}
              </div>
            )}
          </div>

          {/* Kalıcı (Mode 0A) */}
          <div>
            <div className="flex items-center gap-2 mb-2 px-1">
              <Lock className="w-4 h-4 text-[color:var(--oem-ink-2)] opacity-60" />
              <span className="text-[color:var(--oem-ink-2)] text-[11px] font-black uppercase tracking-widest opacity-60">
                Kalıcı Kodlar {permanent.length > 0 ? `(${permanent.length})` : ''}
              </span>
            </div>
            {!permanentSupported ? (
              /* Dürüstlük: mod hiç desteklenmiyor — "kod yok" ile KARIŞTIRILMAZ. */
              <div className="text-[10px] text-[color:var(--oem-ink-3)] opacity-50 px-1">
                Bu araç/adaptör kalıcı kod (Mode 0A) bildirmiyor.
              </div>
            ) : permanent.length === 0 ? (
              <div className="text-[10px] text-[color:var(--oem-ink-3)] opacity-50 px-1">
                Kalıcı arıza kodu yok.
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {permanent.map((c) => <DTCCodeCard key={c.code} code={c} />)}
              </div>
            )}
          </div>

          {/* Muayene hazırlığı — readiness monitörleri (Patch 11C) */}
          {diagStatus && (
            <div>
              <button
                onClick={() => setMonitorsExpanded((v) => !v)}
                className="w-full flex items-center justify-between rounded-2xl border p-4 transition-all active:scale-[0.98]"
                style={{
                  background: diagStatus.allReady ? 'var(--oem-good-soft)' : 'var(--oem-warn-soft)',
                  borderColor: diagStatus.allReady ? 'var(--oem-good)' : 'var(--oem-warn)',
                }}
              >
                <div className="flex items-center gap-2.5">
                  <Gauge
                    className="w-5 h-5"
                    style={{ color: diagStatus.allReady ? 'var(--oem-good)' : 'var(--oem-warn)' }}
                  />
                  <span
                    className="text-sm font-black uppercase tracking-widest"
                    style={{ color: diagStatus.allReady ? 'var(--oem-good)' : 'var(--oem-warn)' }}
                  >
                    Muayene Hazırlığı: {readyMonitors}/{totalMonitors} monitör hazır
                  </span>
                </div>
                {monitorsExpanded
                  ? <ChevronUp className="w-4 h-4 text-[color:var(--oem-ink-2)]" />
                  : <ChevronDown className="w-4 h-4 text-[color:var(--oem-ink-2)]" />}
              </button>

              {monitorsExpanded && (
                <div className="mt-2 flex flex-col gap-1.5">
                  <div className="text-[10px] text-[color:var(--oem-ink-3)] px-1 pb-1">
                    OBD standardı: {diagStatus.obdStandard} · MIL: {diagStatus.mil ? 'Yanıyor' : 'Sönük'} · Onaylı DTC: {diagStatus.dtcCount}
                  </div>
                  {diagStatus.monitors.map((m) => (
                    <div
                      key={m.monitor}
                      className="flex items-center justify-between bg-[var(--oem-surface-2)] border border-[var(--oem-line)] rounded-lg px-3 py-1.5"
                    >
                      <span className="text-xs text-[color:var(--oem-ink-2)]">{m.monitor}</span>
                      <span
                        className="text-[9px] font-black uppercase tracking-wider"
                        style={{
                          color: !m.available
                            ? 'var(--oem-ink-3)'
                            : m.ready ? 'var(--oem-good)' : 'var(--oem-warn)',
                        }}
                      >
                        {!m.available ? 'Yok' : m.ready ? 'Hazır' : 'Bekliyor'}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Canlı sensörler (Patch 9A) ─────────────────── */}
      {/* Abonelik yaşam döngüsü `active`e bağlı: drawer kapaliyken native EXTENDED
          polling tamamen durur (DrawerShell unmount etmez — görünürlük prop'la gelir). */}
      <SensorPanel active={active} />

      {/* ── OBD Canlı Test (tüm PID'ler + ham hex + durum) ─────────── */}
      {/* Burst modu + tüm-PID aboneliği YALNIZ bu accordion açıkken çalışır (active &&
          showLiveTest) → kapaliyken native düşük-yük round-robin'e döner. */}
      <div>
        <button
          onClick={() => setShowLiveTest((v) => !v)}
          className="w-full flex items-center justify-between rounded-2xl border border-[var(--oem-line-strong)] bg-[var(--oem-surface-2)] p-4 transition-all active:scale-[0.98]"
        >
          <div className="flex items-center gap-2.5">
            <FlaskConical className="w-5 h-5 text-[color:var(--oem-accent)]" />
            <span className="text-sm font-black uppercase tracking-widest text-[color:var(--oem-ink-2)]">
              OBD Canlı Test (Tüm Veriler)
            </span>
          </div>
          {showLiveTest
            ? <ChevronUp className="w-4 h-4 text-[color:var(--oem-ink-2)]" />
            : <ChevronDown className="w-4 h-4 text-[color:var(--oem-ink-2)]" />}
        </button>

        {showLiveTest && <ObdLiveTestPanel active={active && showLiveTest} />}
      </div>

      {/* ── Ham OBD Trafiği (adb'siz teşhis) ───────────── */}
      {/* Aracın verdiği HAM ELM327 yanıtını gösterir — "hata var ama başka tarayıcıda
          yok" farkının kanıtı burada (ham 43... yanıtı vs çözümlenen kod). */}
      <div>
        <button
          onClick={() => setShowRaw((v) => !v)}
          className="w-full flex items-center justify-between rounded-2xl border border-[var(--oem-line-strong)] bg-[var(--oem-surface-2)] p-4 transition-all active:scale-[0.98]"
        >
          <div className="flex items-center gap-2.5">
            <Terminal className="w-5 h-5 text-[color:var(--oem-ink-2)]" />
            <span className="text-sm font-black uppercase tracking-widest text-[color:var(--oem-ink-2)]">
              Ham OBD Trafiği
            </span>
          </div>
          {showRaw
            ? <ChevronUp className="w-4 h-4 text-[color:var(--oem-ink-2)]" />
            : <ChevronDown className="w-4 h-4 text-[color:var(--oem-ink-2)]" />}
        </button>

        {showRaw && (
          <div className="mt-2 flex flex-col gap-2">
            {diagAddr && (
              <div className="rounded-xl border border-[var(--oem-info)] bg-[var(--oem-info-soft)] px-3 py-2">
                <div className="text-[9px] uppercase tracking-widest text-[color:var(--oem-ink-3)] mb-0.5">
                  PC'den ham trafik (aynı WiFi)
                </div>
                <div className="text-sm font-mono font-bold text-[color:var(--oem-info)] break-all select-all">
                  {diagAddr}
                </div>
              </div>
            )}
            <div className="rounded-2xl border border-[var(--oem-line)] bg-[var(--oem-surface-2)] p-3 h-80">
              <ObdRawView />
            </div>
          </div>
        )}
      </div>

      {/* ── Error ─────────────────────────────────────── */}
      {dtc.error && (
        /* Hata mesajı → danger token */
        <div className="bg-[var(--oem-danger-soft)] border border-[var(--oem-danger)] rounded-2xl p-5 text-[color:var(--oem-danger)] text-sm font-bold flex items-start gap-3 shadow-lg">
          <AlertTriangle className="w-5 h-5 flex-shrink-0 mt-0.5" />
          {dtc.error}
        </div>
      )}

      {/* Disclaimer */}
      <p className="text-[color:var(--oem-ink-2)] text-[10px] font-bold text-center leading-relaxed opacity-40 uppercase tracking-[0.1em] px-8">
        Tanımlamalar genel OBD-II standartlarına dayanmaktadır.
        Kesin teşhis için yetkili servise başvurun.
      </p>
    </div>
    </div>
  );
}

export const DTCPanel = memo(DTCPanelInner);


