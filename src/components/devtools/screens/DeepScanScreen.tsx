/**
 * DeepScanScreen — CAROS LAB · Araç · Derin Tarama (SALT-OKUNUR gözlem).
 *
 * TARAMA BAŞLATMAZ. `startScan()` · `triggerDeepScanOfflinePass()` ·
 * `startPlatformCoreDeepScanWiring()` · `reset()` · `cancel()` ÇAĞRILMAZ.
 * Ekranı açmak araca tek bir sorgu bile göndermez ve YENİ AKIŞ ÜRETMEZ.
 *
 * ZAMANLAYICI YOK: repodaki CAROS LAB deseni — açılışta tek okuma + elle YENİLE.
 * (Tarama yürürken ilerlemeyi canlı izlemek isteyen, YENİLE'ye basar; periyodik
 * okuma taramanın kendi zamanlamasını gözleyen bir ekranda ölçümü kirletirdi.)
 *
 * ── NEDEN ARTIK PLACEHOLDER DEĞİL ───────────────────────────────────────────
 * Katalog gerekçesi "tek ve güvenli giriş noktası yok, iki ayrı akış var" idi.
 * Bu gerekçe taramayı ÇALIŞTIRMAK için geçerlidir; GÖZLEMLEMEK için değil —
 * ve asıl teşhis değeri tam olarak o iki akışın yan yana görülmesindedir.
 *
 * GİZLİLİK: VIN, ham ECU/PID/DID listesi, uyarı ve hata METİNLERİ bu ekrana
 * GELMEZ — yalnız ADET · enum · faz · yüzde · damga; parmak izi ilk 12 karakter.
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw, ShieldCheck, ScanSearch } from 'lucide-react';
import {
  readDeepScanObservation, type DeepScanObservationRawSnapshot,
} from '../../../platform/devtools/deepScanObservationSources';
import {
  buildRuntimeFields, buildWiringFields, resolveDeepScanAuthority,
  deepScanAuthorityTone, DEEP_SCAN_AUTHORITY_LABEL,
  type DeepScanTone, type DeepScanFieldsInput,
} from '../../../platform/devtools/deepScanObservationModel';
import {
  formatAge, OBSERVABILITY_LABEL,
  type InspectorField, type Observability,
} from '../../../platform/devtools/sessionInspectorModel';

const CLASS_STYLE: Record<Observability, string> = {
  OBSERVED:    'border-[var(--oem-good)] bg-[var(--oem-good-soft)] text-[var(--oem-good)]',
  DERIVED:     'border-[var(--oem-info)] bg-[var(--oem-info-soft)] text-[var(--oem-info)]',
  UNAVAILABLE: 'border-[var(--oem-line-strong)] bg-[var(--oem-surface-2)] text-[var(--oem-ink-3)]',
  STALE:       'border-[var(--oem-warn)] bg-[var(--oem-warn-soft)] text-[var(--oem-warn)]',
};

const TONE_STYLE: Record<DeepScanTone, string> = {
  ok:    'border-[var(--oem-good)] bg-[var(--oem-good-soft)] text-[var(--oem-good)]',
  muted: 'border-[var(--oem-line-strong)] bg-[var(--oem-surface-2)] text-[var(--oem-ink-3)]',
  warn:  'border-[var(--oem-warn)] bg-[var(--oem-warn-soft)] text-[var(--oem-warn)]',
  bad:   'border-[var(--oem-danger)] bg-[var(--oem-danger-soft)] text-[var(--oem-danger)]',
};

const FieldRow = memo(function FieldRow({ field, nowMs }: { field: InspectorField; nowMs: number }) {
  const age = formatAge(field.updatedAt, nowMs);
  return (
    <div
      data-testid={`ds-field-${field.id}`}
      data-class={field.klass}
      className="grid grid-cols-[1fr_auto] gap-x-3 border-b border-[var(--oem-line)] px-2 py-1.5 last:border-b-0"
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="font-mono text-[11px] text-[var(--oem-ink-2)]">{field.label}</span>
          <span className="break-all font-mono text-[11px] text-[var(--oem-ink)]">{field.value}</span>
        </div>
        <div className="mt-0.5 font-mono text-[9px] text-[var(--oem-ink-3)]">
          {field.source}
          {age ? <> · {age}</> : <> · zaman damgası yok</>}
        </div>
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

const Section = memo(function Section({
  title, fields, nowMs,
}: { title: string; fields: readonly InspectorField[]; nowMs: number }) {
  return (
    <div className="shrink-0 rounded border border-[var(--oem-line)] bg-[var(--oem-surface-1)]">
      <div className="border-b border-[var(--oem-line)] px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-[var(--oem-ink-2)]">
        {title}
      </div>
      {fields.map((f) => <FieldRow key={f.id} field={f} nowMs={nowMs} />)}
    </div>
  );
});

export const DeepScanScreen = memo(function DeepScanScreen() {
  const [snap, setSnap] = useState<DeepScanObservationRawSnapshot>(
    () => readDeepScanObservation(Date.now()),
  );

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const refresh = useCallback(() => {
    if (mountedRef.current) setSnap(readDeepScanObservation(Date.now()));
  }, []);

  const nowMs = snap.readAt;

  const authority = useMemo(
    () => resolveDeepScanAuthority({
      runtimeStatus: snap.runtime?.status ?? null,
      wiringPresent: snap.wiring === null ? null : snap.wiring.present,
    }),
    [snap.runtime, snap.wiring],
  );

  const fieldsInput = useMemo<DeepScanFieldsInput>(() => ({
    runtime: snap.runtime,
    wiring: snap.wiring === null ? null : {
      present: snap.wiring.present,
      started: snap.wiring.started,
      runtimeState: String(snap.wiring.runtimeState),
      scanState: String(snap.wiring.scanState),
      ignitionConfirmed: snap.wiring.ignitionConfirmed,
      progressPercent: snap.wiring.progressPercent,
      warningCount: snap.wiring.warningCount,
      lastErrorCode: snap.wiring.lastErrorCode,
      lastTransitionAt: snap.wiring.lastTransitionAt,
    },
    offlinePass: snap.offlinePass === null ? null : {
      present: snap.offlinePass.present,
      started: snap.offlinePass.started,
      running: snap.offlinePass.running,
      active: snap.offlinePass.active,
      cancelled: snap.offlinePass.cancelled,
      triggerCount: snap.offlinePass.triggerCount,
      lastRun: snap.offlinePass.lastRun,
      lastDuration: snap.offlinePass.lastDuration,
      lastResult: snap.offlinePass.lastResult === null ? null : String(snap.offlinePass.lastResult),
      lastReason: snap.offlinePass.lastReason === null ? null : String(snap.offlinePass.lastReason),
    },
    nowMs,
  }), [snap, nowMs]);

  const runtimeFields = useMemo(() => buildRuntimeFields(fieldsInput), [fieldsInput]);
  const wiringFields  = useMemo(() => buildWiringFields(fieldsInput), [fieldsInput]);

  return (
    <div className="flex h-full flex-col gap-2 overflow-y-auto" data-testid="deep-scan">
      <div className="shrink-0 rounded border border-[var(--oem-line)] bg-[var(--oem-surface-1)] px-3 py-2">
        <div className="flex flex-wrap items-center gap-2 font-mono text-[10px]">
          <span className="flex items-center gap-1 text-[11px] font-bold tracking-wide text-[var(--oem-info)]">
            <ScanSearch size={12} /> DERİN TARAMA
          </span>
          <span className="flex items-center gap-1 rounded border border-[var(--oem-good)] bg-[var(--oem-good-soft)] px-1.5 py-0.5 text-[var(--oem-good)]">
            <ShieldCheck size={11} /> SALT OKUNUR — tarama başlatmaz
          </span>
          <button
            type="button"
            data-testid="ds-refresh"
            onClick={refresh}
            className="flex items-center gap-1 rounded border border-[var(--oem-line-strong)] px-2 py-1 text-[var(--oem-ink-2)] hover:bg-[var(--oem-surface-2)]"
          >
            <RefreshCw size={11} /> YENİLE
          </button>
          <span
            data-testid="ds-authority"
            data-authority={authority}
            className={`rounded border px-1.5 py-0.5 ${TONE_STYLE[deepScanAuthorityTone(authority)]}`}
          >
            {DEEP_SCAN_AUTHORITY_LABEL[authority]}
          </span>
          {snap.runtime?.fingerprintPrefix && (
            <span className="rounded border border-[var(--oem-line-strong)] px-1.5 py-0.5 font-mono text-[9px] text-[var(--oem-ink-3)]">
              fp {snap.runtime.fingerprintPrefix}
            </span>
          )}
        </div>
        <p className="mt-1 font-mono text-[9px] leading-relaxed text-[var(--oem-ink-3)]">
          İKİ AYRI AKIŞ: tarama runtime durum makinesi ve SystemBoot wiring
          (ignition-tetikli, fail-closed). Bu ekran ikisini yan yana gösterir — asıl
          teşhis değeri buradadır. Yeni bir üçüncü giriş noktası AÇILMADI; ekran
          hiçbir tarama tetiklemez. VIN, ham ECU/PID/DID listesi, uyarı ve hata
          metinleri bu ekrana GELMEZ.
        </p>
      </div>

      <Section title="Akış 1 — tarama runtime"          fields={runtimeFields} nowMs={nowMs} />
      <Section title="Akış 2 — wiring + çevrimdışı geçiş" fields={wiringFields}  nowMs={nowMs} />
    </div>
  );
});
