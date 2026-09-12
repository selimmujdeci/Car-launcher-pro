/**
 * VehicleFingerprintScreen — CAROS LAB · Araç · Araç Parmak İzi (Faz A5).
 *
 * SALT-OKUNUR. Bu ekran kimlik ÜRETMEZ, hash HESAPLAMAZ, keşif BAŞLATMAZ ve araca
 * HİÇBİR komut göndermez. Yalnız zaten kalıcı olan kayıtları okur.
 *
 * YAPMADIKLARI (pazarlıksız): VIN okuma · DID/PID sorgusu · handshake · Deep Scan ·
 * bağlantı açma/kapama · reconnect · ECU write · DTC okuma/silme · native pull ·
 * yeni timer/polling/abonelik · yeni global store.
 *
 * ⚠️ `discoveryFingerprint.getVehicleFingerprint()` BİLEREK ÇAĞRILMAZ: o fonksiyon
 * araca gerçek bir UDS isteği (DID F190) gönderir. Gözlem ekranı araç trafiği üretmez.
 *
 * ZAMANLAYICI YOK: repodaki CAROS LAB deseni (Session Inspector · Runtime Scheduling ·
 * KWP İzleyici) periyodik yenileme kullanmaz — açılışta tek okuma + elle YENİLE.
 *
 * GİZLİLİK: ham VIN, plaka ve adaptör MAC'i bu ekrana HİÇ GELMEZ (kaynak katmanı
 * taşımaz) ve hiçbir alanda gösterilmez; yalnız geri çevrilemez özetler görünür.
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw, ShieldCheck, Fingerprint } from 'lucide-react';
import { readVehicleFingerprintSnapshot } from '../../../platform/devtools/vehicleFingerprintSources';
import {
  buildVfSections, deriveVfEvidence, countByVfClass,
  VF_EVIDENCE_LABEL,
  type VfEvidenceHealth, type VfRawSnapshot,
} from '../../../platform/devtools/vehicleFingerprintModel';
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

const HEALTH_STYLE: Record<VfEvidenceHealth, string> = {
  READY:     'border-[var(--oem-good)] bg-[var(--oem-good-soft)] text-[var(--oem-good)]',
  PARTIAL:   'border-[var(--oem-warn)] bg-[var(--oem-warn-soft)] text-[var(--oem-warn)]',
  NO_SOURCE: 'border-[var(--oem-line-strong)] bg-[var(--oem-surface-2)] text-[var(--oem-ink-2)]',
};

const FieldRow = memo(function FieldRow({ field, nowMs }: { field: InspectorField; nowMs: number }) {
  const age = formatAge(field.updatedAt, nowMs);
  return (
    <div
      data-testid={`vf-field-${field.id}`}
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

export const VehicleFingerprintScreen = memo(function VehicleFingerprintScreen() {
  // Açılışta TEK okuma. TIMER YOK, ABONELİK YOK, POLLING YOK.
  const [snap, setSnap] = useState<VfRawSnapshot>(() => readVehicleFingerprintSnapshot());

  /* Unmount sonrası setState YASAK (zero-leak). Okuma senkron olsa da kapı,
     ileride bir kaynağın async'e dönmesi hâlinde de sözleşmeyi korur. */
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const refresh = useCallback(() => {
    if (mountedRef.current) setSnap(readVehicleFingerprintSnapshot());
  }, []);

  const sections    = useMemo(() => buildVfSections(snap), [snap]);
  const health      = useMemo(() => deriveVfEvidence(snap), [snap]);
  const classCounts = useMemo(() => countByVfClass(sections), [sections]);

  return (
    <div className="flex h-full flex-col gap-2 overflow-y-auto" data-testid="vehicle-fingerprint">
      {/* Salt-okunur beyanı */}
      <div className="shrink-0 rounded border border-[var(--oem-line)] bg-[var(--oem-surface-1)] px-3 py-2">
        <div className="flex flex-wrap items-center gap-2 font-mono text-[10px]">
          <span className="flex items-center gap-1 text-[11px] font-bold tracking-wide text-[var(--oem-info)]">
            <Fingerprint size={12} /> ARAÇ PARMAK İZİ
          </span>
          <span className="flex items-center gap-1 rounded border border-[var(--oem-good)] bg-[var(--oem-good-soft)] px-1.5 py-0.5 text-[var(--oem-good)]">
            <ShieldCheck size={11} /> SALT OKUNUR — araca sorgu göndermez
          </span>
          <button
            type="button"
            data-testid="vf-refresh"
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
          Yalnız ZATEN KAYITLI kimlik ve keşif kanıtları okunur; VIN okuma, DID/PID sorgusu,
          handshake veya tarama TETİKLENMEZ. Ham VIN, plaka ve adaptör MAC'i bu ekrana hiç
          gelmez — yalnız geri çevrilemez özetler gösterilir. Periyodik yenileme YOKTUR.
        </p>
      </div>

      {/* Kanıt sağlığı — fail-closed */}
      <div
        data-testid="vf-health"
        data-health={health.status}
        title={health.status}
        className={`shrink-0 rounded border px-3 py-2 font-mono text-[11px] ${HEALTH_STYLE[health.status]}`}
      >
        KANIT SAĞLIĞI: {VF_EVIDENCE_LABEL[health.status]} ({health.presentCount}/{health.totalSources} kaynak)
        {health.missing.length > 0 && (
          <ul className="mt-1 list-inside list-disc space-y-0.5 text-[10px] leading-relaxed opacity-80">
            {health.missing.map((m) => <li key={m.key}>{m.key}: {m.reason}</li>)}
          </ul>
        )}
        <div className="mt-1 text-[9px] opacity-50">
          Kimlik kaydı YOKSA hiçbir koşulda HAZIR denmez: kanıtların hangi araca ait olduğu
          bilinmeden "hazır" demek yanlış olurdu. Boş liste ile KAYNAK YOK ayrı gösterilir.
        </div>
      </div>

      {/* Bölümler */}
      {sections.map((sec) => (
        <div
          key={sec.id}
          data-testid={`vf-section-${sec.id}`}
          className="shrink-0 rounded border border-[var(--oem-line)] bg-[var(--oem-surface-1)]"
        >
          <div className="flex flex-wrap items-center gap-2 border-b border-[var(--oem-line)] px-3 py-1.5">
            <span className="font-mono text-[11px] uppercase tracking-wide text-[var(--oem-info)]">
              {sec.title}
            </span>
          </div>
          <div>
            {sec.fields.map((f) => <FieldRow key={f.id} field={f} nowMs={snap.readAt} />)}
          </div>
        </div>
      ))}

      <p className="shrink-0 pb-2 font-mono text-[9px] leading-relaxed text-[var(--oem-ink-3)]">
        Parmak izi hash'i ve VIN özeti GERİ ÇEVRİLEMEZ; ham VIN hiçbir alanda gösterilmez ve
        loglanmaz. Hash yoksa üretilmez, zaman damgası yoksa "şimdi" yazılmaz. Listeler
        bounded'dır (toplam sayı ayrıca beyan edilir) — kesilen kuyruk gizlenmez.
      </p>
    </div>
  );
});
