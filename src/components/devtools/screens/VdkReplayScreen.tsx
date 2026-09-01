/**
 * VdkReplayScreen — CAROS LAB · İletişim · VDK REPLAY (P0-VDK-F2B).
 *
 * SALT-OKUNUR. Doğrulanmış bir izin ürün yolu üzerinde yeniden çalıştırılmasının
 * SONUCUNU gösterir; hiçbir şeyi başlatmaz, durdurmaz, değiştirmez.
 *
 * YAPMADIKLARI (pazarlıksız): replay BAŞLATMA/DURDURMA · iz dosyası okuma/import ·
 * AT/OBD komutu · bağlantı açma/kapama · recovery tetikleme · DTC okuma/silme ·
 * yeni timer/polling/abonelik · yeni global store.
 *
 * ZAMANLAYICI YOK: repodaki CAROS LAB deseni (Session Inspector · Adaptör Tanılama)
 * periyodik yenileme kullanmaz — açılışta tek okuma + elle YENİLE.
 *
 * GİZLİLİK: ham istek/yanıt gövdesi bu ekrana HİÇ GELMEZ; yalnız sayım ve sonuç
 * sınıfı taşınır. Ham hex kendi ekranında (Evidence Viewer) kalır.
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { RefreshCw, ShieldCheck, History, AlertTriangle, Download } from 'lucide-react';
import {
  buildCurrentTracePackage, currentTracePackageFileName,
} from '../../../platform/obd/traceRecorder';
import { readVdkReplaySnapshot, type VdkReplayRawSnapshot } from '../../../platform/devtools/vdkReplaySources';
import {
  buildVdkReplayView, REPLAY_VERDICT_LABEL, type ReplayLabVerdict,
} from '../../../platform/devtools/vdkReplayModel';
import {
  OBSERVABILITY_LABEL, type InspectorField, type Observability,
} from '../../../platform/devtools/sessionInspectorModel';

const CLASS_STYLE: Record<Observability, string> = {
  OBSERVED:    'border-[var(--oem-good)] bg-[var(--oem-good-soft)] text-[var(--oem-good)]',
  DERIVED:     'border-[var(--oem-info)] bg-[var(--oem-info-soft)] text-[var(--oem-info)]',
  UNAVAILABLE: 'border-[var(--oem-line-strong)] bg-[var(--oem-surface-2)] text-[var(--oem-ink-3)]',
  STALE:       'border-[var(--oem-warn)] bg-[var(--oem-warn-soft)] text-[var(--oem-warn)]',
};

const VERDICT_STYLE: Record<ReplayLabVerdict, string> = {
  PASS:            'border-[var(--oem-good)] bg-[var(--oem-good-soft)] text-[var(--oem-good)]',
  PARITY_MISMATCH: 'border-[var(--oem-danger)] bg-[var(--oem-danger-soft)] text-[var(--oem-danger)]',
  TRACE_INVALID:   'border-[var(--oem-danger)] bg-[var(--oem-danger-soft)] text-[var(--oem-danger)]',
  INCOMPLETE:      'border-[var(--oem-warn)] bg-[var(--oem-warn-soft)] text-[var(--oem-warn)]',
  UNKNOWN:         'border-[var(--oem-line-strong)] bg-[var(--oem-surface-2)] text-[var(--oem-ink-2)]',
};

const FieldRow = memo(function FieldRow({ field }: { field: InspectorField }) {
  return (
    <div
      data-testid={`vr-field-${field.id}`}
      data-class={field.klass}
      className="grid grid-cols-[1fr_auto] gap-x-3 border-b border-[var(--oem-line)] px-2 py-1.5 last:border-b-0"
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="font-mono text-[11px] text-[var(--oem-ink-2)]">{field.label}</span>
          <span className="break-all font-mono text-[11px] text-[var(--oem-ink)]">{field.value}</span>
        </div>
        <div className="mt-0.5 font-mono text-[9px] text-[var(--oem-ink-3)]">{field.source}</div>
        {field.note && (
          <div className="mt-0.5 text-[9px] leading-relaxed text-[var(--oem-ink-3)]">{field.note}</div>
        )}
      </div>
      <span
        title={field.klass}
        className={`h-fit shrink-0 rounded border px-1.5 py-0.5 font-mono text-[9px] ${CLASS_STYLE[field.klass]}`}
      >
        {OBSERVABILITY_LABEL[field.klass]}
      </span>
    </div>
  );
});

export const VdkReplayScreen = memo(function VdkReplayScreen() {
  // Açılışta TEK okuma. TIMER YOK, ABONELİK YOK, POLLING YOK.
  const [snap, setSnap] = useState<VdkReplayRawSnapshot>(() => readVdkReplaySnapshot());

  /* Unmount sonrası setState YASAK (zero-leak). */
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const refresh = useCallback(() => {
    if (mountedRef.current) setSnap(readVdkReplaySnapshot());
  }, []);

  const view = useMemo(() => buildVdkReplayView(snap), [snap]);

  /* ── P0-VDK-F2C2 · SAHA YAKALAMA ────────────────────────────────────────
     İzi cihazdan DIŞARI alır. Araca TEK BAYT GİTMEZ: yalnız bu süreçte
     zaten üretilmiş kanonik defter okunur ve dosyaya yazılır — `Raw OBD
     Traffic` ekranındaki dışa aktarımla AYNI desen ve AYNI sınırlar.
     Maskeleme yazım anında uygulanmıştır; maskelenmemiş tek olay varsa
     export kapısı paketi REDDEDER (fail-closed). */
  const [exportMsg, setExportMsg] = useState<string | null>(null);
  const exportTrace = useCallback(async () => {
    const wallMs = (() => { try { return Date.now(); } catch { return null; } })();
    const result = buildCurrentTracePackage(wallMs);
    if (!result.ok) {
      if (mountedRef.current) setExportMsg(`REDDEDİLDİ · ${result.rejection}: ${result.detail}`);
      return;
    }
    const fileName = currentTracePackageFileName(wallMs);
    const suffix = `${result.pkg.manifest.eventCount} olay · checksum ${result.pkg.manifest.checksum}`;
    try {
      if (!Capacitor.isNativePlatform()) {
        const blob = new Blob([result.body], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = fileName; a.click();
        URL.revokeObjectURL(url);
        if (mountedRef.current) setExportMsg(`İndirilenler/${fileName} · ${suffix}`);
        return;
      }
      const { Filesystem, Directory, Encoding } = await import('@capacitor/filesystem');
      let savedPath: string;
      try {
        const res = await Filesystem.writeFile({
          path: fileName, data: result.body, directory: Directory.Documents,
          encoding: Encoding.UTF8, recursive: true,
        });
        savedPath = res.uri || `Documents/${fileName}`;
      } catch {
        const res = await Filesystem.writeFile({
          path: fileName, data: result.body, directory: Directory.External,
          encoding: Encoding.UTF8, recursive: true,
        });
        savedPath = res.uri || `External/${fileName}`;
      }
      if (mountedRef.current) setExportMsg(`${savedPath} · ${suffix}`);
    } catch {
      if (mountedRef.current) setExportMsg('Dosya kaydı başarısız.');
    }
  }, []);

  return (
    <div className="flex h-full flex-col gap-2 overflow-y-auto" data-testid="vdk-replay">
      {/* Salt-okunur beyanı */}
      <div className="shrink-0 rounded border border-[var(--oem-line)] bg-[var(--oem-surface-1)] px-3 py-2">
        <div className="flex flex-wrap items-center gap-2 font-mono text-[10px]">
          <span className="flex items-center gap-1 text-[11px] font-bold tracking-wide text-[var(--oem-info)]">
            <History size={12} /> VDK REPLAY
          </span>
          <span className="flex items-center gap-1 rounded border border-[var(--oem-good)] bg-[var(--oem-good-soft)] px-1.5 py-0.5 text-[var(--oem-good)]">
            <ShieldCheck size={11} /> SALT OKUNUR — replay başlatmaz/durdurmaz
          </span>
          <button
            type="button"
            data-testid="vr-refresh"
            onClick={refresh}
            className="flex items-center gap-1 rounded border border-[var(--oem-line-strong)] px-2 py-1 text-[var(--oem-ink-2)] hover:bg-[var(--oem-surface-2)]"
          >
            <RefreshCw size={11} /> YENİLE
          </button>
          <button
            type="button"
            data-testid="vr-export"
            onClick={() => { void exportTrace(); }}
            className="flex items-center gap-1 rounded border border-[var(--oem-line-strong)] px-2 py-1 text-[var(--oem-ink-2)] hover:bg-[var(--oem-surface-2)]"
          >
            <Download size={11} /> İZ PAKETİNİ DIŞA AKTAR
          </button>
        </div>
        {exportMsg && (
          <div
            data-testid="vr-export-msg"
            className="mt-1 break-all font-mono text-[9px] text-[var(--oem-ink-3)]"
          >
            {exportMsg} · dışa aktarım MASKELİDİR ve araca komut GÖNDERMEZ.
          </div>
        )}
        <p className="mt-1 font-mono text-[9px] leading-relaxed text-[var(--oem-ink-3)]">
          Replay, doğrulanmış bir izi ÜRÜNÜN NORMAL tanı yolundan geçirir: ham yanıtı
          mevcut çözümleyici çözer, hükmü mevcut otorite verir. Replay kod ÜRETMEZ ve
          yanıt UYDURMAZ. Ham istek/yanıt gövdesi bu ekrana gelmez. Periyodik yenileme YOKTUR.
        </p>
      </div>

      {/* Hüküm — fail-closed */}
      <div
        data-testid="vr-verdict"
        data-verdict={view.verdict}
        title={view.verdict}
        className={`shrink-0 rounded border px-3 py-2 font-mono text-[11px] ${VERDICT_STYLE[view.verdict]}`}
      >
        REPLAY HÜKMÜ: {REPLAY_VERDICT_LABEL[view.verdict]}
        <div className="mt-1 text-[9px] opacity-60">
          Tek bir uyuşmazlık, tükenme ya da ölçülmemiş yanıt bile PASS'i düşürür —
          "çoğu tuttu" bir hüküm değildir. Koşu yoksa hüküm BİLİNMİYOR kalır.
        </div>
      </div>

      {/* Bölümler */}
      {view.sections.map((sec) => (
        <div
          key={sec.id}
          data-testid={`vr-section-${sec.id}`}
          className="shrink-0 rounded border border-[var(--oem-line)] bg-[var(--oem-surface-1)]"
        >
          <div className="flex flex-wrap items-center gap-2 border-b border-[var(--oem-line)] px-3 py-1.5">
            <span className="font-mono text-[11px] uppercase tracking-wide text-[var(--oem-info)]">
              {sec.title}
            </span>
            {sec.id === 'functional' && (
              <span className="rounded border border-[var(--oem-info)] bg-[var(--oem-info-soft)] px-1.5 py-0.5 font-mono text-[9px] text-[var(--oem-info)]">
                KANONİK TS = ÜRÜN OTORİTESİ · NATIVE = PARİTE TANIĞI
              </span>
            )}
            {sec.id === 'gaps' && (
              <span className="flex items-center gap-1 rounded border border-[var(--oem-warn)] bg-[var(--oem-warn-soft)] px-1.5 py-0.5 font-mono text-[9px] text-[var(--oem-warn)]">
                <AlertTriangle size={10} /> BU FAZDA ÇÖZÜLMEZ
              </span>
            )}
          </div>
          <div>
            {sec.fields.map((f) => <FieldRow key={f.id} field={f} />)}
          </div>
        </div>
      ))}

      <p className="shrink-0 pb-2 font-mono text-[9px] leading-relaxed text-[var(--oem-ink-3)]">
        ANLAM OTORİTESİ TEKTİR: fonksiyonel Mode 03/07/0A kodları artık kanonik TS
        çözümleyicisinden (`functionalDtc`) çıkar — üretici zinciriyle (UDS 0x19 · KWP
        0x18/0x13) AYNI katmanda. Native `ElmProtocol.parseDtcResponse` yalnız PARİTE
        TANIĞI olarak korunur ve ürün sonucunu EZEMEZ. Ham gövde köprüden gelmiyorsa ya da
        `DTC_RAW_MAX` sınırında KIRPILMIŞSA kanonik çözüm otorite OLAMAZ: sonuç açıkça
        `LEGACY_NATIVE` damgalanır ve "kanonik parite kanıtlanmadı" olarak gösterilir.
        Kanonik ile native çeliştiğinde kanonik kazanır ama çelişki bu ekranda GÖRÜNÜR
        kalır — sessizce biri seçilmez.
      </p>
    </div>
  );
});

export default VdkReplayScreen;
