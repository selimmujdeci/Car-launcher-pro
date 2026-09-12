/**
 * AdapterDiagnosticsScreen — CAROS LAB · İletişim · Adaptör Tanılama (Faz A6).
 *
 * SALT-OKUNUR. ELM327/Bluetooth/WiFi taşıma ve OBD bağlantı sağlığını tek ekranda
 * gösterir; hiçbir şeyi DEĞİŞTİRMEZ.
 *
 * YAPMADIKLARI (pazarlıksız): AT/OBD komutu gönderme · adaptör kimlik sorgusu (ATI/ATZ) ·
 * bağlantı açma/kapama · reconnect · reset · recovery tetikleme · poll cadence değiştirme ·
 * DTC okuma/silme · native pull · yeni timer/polling/abonelik · yeni global store.
 *
 * ZAMANLAYICI YOK: repodaki CAROS LAB deseni (Session Inspector · Runtime Scheduling ·
 * KWP İzleyici · Araç Parmak İzi) periyodik yenileme kullanmaz — açılışta tek okuma
 * + elle YENİLE.
 *
 * GİZLİLİK: adaptör adı/adresi/seri numarası bu ekrana HİÇ GELMEZ (kaynak katmanı
 * yalnız "kayıtlı mı" bilgisini taşır).
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw, ShieldCheck, AlertTriangle, Plug } from 'lucide-react';
import { readAdapterDiagnosticsSnapshot } from '../../../platform/devtools/adapterDiagnosticsSources';
import {
  buildAdSections, deriveAdVerdict, countByAdClass,
  AD_VERDICT_LABEL,
  type AdVerdict, type AdRawSnapshot,
} from '../../../platform/devtools/adapterDiagnosticsModel';
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

const VERDICT_STYLE: Record<AdVerdict, string> = {
  HEALTHY:        'border-[var(--oem-good)] bg-[var(--oem-good-soft)] text-[var(--oem-good)]',
  TRANSPORT_ONLY: 'border-[var(--oem-warn)] bg-[var(--oem-warn-soft)] text-[var(--oem-warn)]',
  DATA_STALE:     'border-[var(--oem-warn)] bg-[var(--oem-warn-soft)] text-[var(--oem-warn)]',
  DEGRADED:       'border-[var(--oem-warn)] bg-[var(--oem-warn-soft)] text-[var(--oem-warn)]',
  DISCONNECTED:   'border-[var(--oem-danger)] bg-[var(--oem-danger-soft)] text-[var(--oem-danger)]',
  UNKNOWN:        'border-[var(--oem-line-strong)] bg-[var(--oem-surface-2)] text-[var(--oem-ink-2)]',
};

const FieldRow = memo(function FieldRow({ field, nowMs }: { field: InspectorField; nowMs: number }) {
  const age = formatAge(field.updatedAt, nowMs);
  return (
    <div
      data-testid={`ad-field-${field.id}`}
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

export const AdapterDiagnosticsScreen = memo(function AdapterDiagnosticsScreen() {
  // Açılışta TEK okuma. TIMER YOK, ABONELİK YOK, POLLING YOK.
  const [snap, setSnap] = useState<AdRawSnapshot>(() => readAdapterDiagnosticsSnapshot());

  /* Unmount sonrası setState YASAK (zero-leak). */
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const refresh = useCallback(() => {
    if (mountedRef.current) setSnap(readAdapterDiagnosticsSnapshot());
  }, []);

  const sections    = useMemo(() => buildAdSections(snap), [snap]);
  const verdict     = useMemo(() => deriveAdVerdict(snap), [snap]);
  const classCounts = useMemo(() => countByAdClass(sections), [sections]);

  return (
    <div className="flex h-full flex-col gap-2 overflow-y-auto" data-testid="adapter-diagnostics">
      {/* Salt-okunur beyanı */}
      <div className="shrink-0 rounded border border-[var(--oem-line)] bg-[var(--oem-surface-1)] px-3 py-2">
        <div className="flex flex-wrap items-center gap-2 font-mono text-[10px]">
          <span className="flex items-center gap-1 text-[11px] font-bold tracking-wide text-[var(--oem-info)]">
            <Plug size={12} /> ADAPTÖR TANILAMA
          </span>
          <span className="flex items-center gap-1 rounded border border-[var(--oem-good)] bg-[var(--oem-good-soft)] px-1.5 py-0.5 text-[var(--oem-good)]">
            <ShieldCheck size={11} /> SALT OKUNUR — AT/OBD komutu göndermez
          </span>
          <button
            type="button"
            data-testid="ad-refresh"
            onClick={refresh}
            className="flex items-center gap-1 rounded border border-[var(--oem-line-strong)] px-2 py-1 text-[var(--oem-ink-2)] hover:bg-[var(--oem-surface-2)]"
          >
            <RefreshCw size={11} /> YENİLE
          </button>
          <span className="text-[var(--oem-ink-3)]">
            ÖLÇÜLDÜ {classCounts.OBSERVED} · TÜRETİLDİ {classCounts.DERIVED} ·
            KAYNAK YOK {classCounts.UNAVAILABLE}
          </span>
        </div>
        <p className="mt-1 font-mono text-[9px] leading-relaxed text-[var(--oem-ink-3)]">
          Yalnız mevcut senkron getter'lar okunur: AT/OBD komutu, adaptör kimlik sorgusu,
          reconnect, reset veya recovery TETİKLENMEZ. Adaptör adı/adresi/seri numarası
          ekrana hiç gelmez. Periyodik yenileme YOKTUR.
        </p>
      </div>

      {/* Sağlık hükmü — fail-closed */}
      <div
        data-testid="ad-verdict"
        data-verdict={verdict.status}
        title={verdict.status}
        className={`shrink-0 rounded border px-3 py-2 font-mono text-[11px] ${VERDICT_STYLE[verdict.status]}`}
      >
        ADAPTÖR SAĞLIĞI: {AD_VERDICT_LABEL[verdict.status]}
        <ul className="mt-1 list-inside list-disc space-y-0.5 text-[10px] leading-relaxed opacity-80">
          {verdict.reasons.map((r, i) => <li key={i}>{r}</li>)}
        </ul>
        <div className="mt-1 text-[9px] opacity-50">
          "Bağlı" olmak TEK BAŞINA sağlıklı DEMEK DEĞİLDİR: oturum hazırlığı, veri tazeliği
          ve kopma baskısı ayrıca değerlendirilir. Kaynak okunamazsa hüküm BİLİNMİYOR kalır.
        </div>
      </div>

      {/* Bölümler */}
      {sections.map((sec) => (
        <div
          key={sec.id}
          data-testid={`ad-section-${sec.id}`}
          className="shrink-0 rounded border border-[var(--oem-line)] bg-[var(--oem-surface-1)]"
        >
          <div className="flex flex-wrap items-center gap-2 border-b border-[var(--oem-line)] px-3 py-1.5">
            <span className="font-mono text-[11px] uppercase tracking-wide text-[var(--oem-info)]">
              {sec.title}
            </span>
            {sec.id === 'limits' && (
              <span className="flex items-center gap-1 rounded border border-[var(--oem-warn)] bg-[var(--oem-warn-soft)] px-1.5 py-0.5 font-mono text-[9px] text-[var(--oem-warn)]">
                <AlertTriangle size={10} /> GÖZLEM KANALI YOK
              </span>
            )}
          </div>
          <div>
            {sec.fields.map((f) => <FieldRow key={f.id} field={f} nowMs={snap.readAt} />)}
          </div>
        </div>
      ))}

      <p className="shrink-0 pb-2 font-mono text-[9px] leading-relaxed text-[var(--oem-ink-3)]">
        İKİ AYRI SAĞLIK MOTORU vardır: `obdService` ADAPTİF tazelik penceresi kullanır,
        `ObdHealthMonitor` ise MUTLAK 4 sn donma eşiği. Sonuçları birleştirilmez — ikisi de
        ayrı gösterilir ve çeliştiklerinde bu açıkça yazılır. RSSI, native buffer doluluğu,
        klon/orijinal hükmü ve gelişmiş BLE tanısı için JS'e açılmış kaynak YOKTUR; bu
        alanlar tahmin edilmez, KAYNAK YOK olarak beyan edilir.
      </p>
    </div>
  );
});
