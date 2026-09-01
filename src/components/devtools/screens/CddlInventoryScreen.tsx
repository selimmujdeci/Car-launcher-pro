/**
 * CddlInventoryScreen — CAROS LAB · Geliştirici · CDDL ENVANTERİ (P0-VDK-F3B).
 *
 * SALT-OKUNUR. Tanı tanım katmanının (CDDL v1) envanterini ve doğrulama
 * sonucunu gösterir; hiçbir şeyi yüklemez, değiştirmez, çalıştırmaz.
 *
 * YAPMADIKLARI (pazarlıksız): profil yükleme/içe aktarma · BYOD import ·
 * prosedür ÇALIŞTIRMA · AT/OBD komutu · bağlantı açma · yeni timer/abonelik ·
 * yeni global store.
 *
 * ZAMANLAYICI YOK: repodaki CAROS LAB deseni — açılışta tek okuma + elle YENİLE.
 *
 * GİZLİLİK: ham VIN bu ekrana GELMEZ; varyant kanıtı yalnız WMI (üretici öneki)
 * ve VDS DESENİ taşır — ikisi de araca değil, MODELE özgüdür.
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw, ShieldCheck, Library, AlertTriangle } from 'lucide-react';
import {
  readCddlInventorySnapshot, type CddlInventorySnapshot,
} from '../../../platform/devtools/cddlInventorySources';
import {
  buildCddlInventoryView, CDDL_VERDICT_LABEL, type CddlVerdict,
} from '../../../platform/devtools/cddlInventoryModel';
import {
  OBSERVABILITY_LABEL, type InspectorField, type Observability,
} from '../../../platform/devtools/sessionInspectorModel';

const CLASS_STYLE: Record<Observability, string> = {
  OBSERVED:    'border-[var(--oem-good)] bg-[var(--oem-good-soft)] text-[var(--oem-good)]',
  DERIVED:     'border-[var(--oem-info)] bg-[var(--oem-info-soft)] text-[var(--oem-info)]',
  UNAVAILABLE: 'border-[var(--oem-line-strong)] bg-[var(--oem-surface-2)] text-[var(--oem-ink-3)]',
  STALE:       'border-[var(--oem-warn)] bg-[var(--oem-warn-soft)] text-[var(--oem-warn)]',
};

const VERDICT_STYLE: Record<CddlVerdict, string> = {
  VALID:                    'border-[var(--oem-good)] bg-[var(--oem-good-soft)] text-[var(--oem-good)]',
  INVALID:                  'border-[var(--oem-danger)] bg-[var(--oem-danger-soft)] text-[var(--oem-danger)]',
  UNTRUSTED_SOURCE_PRESENT: 'border-[var(--oem-warn)] bg-[var(--oem-warn-soft)] text-[var(--oem-warn)]',
  UNAVAILABLE:              'border-[var(--oem-line-strong)] bg-[var(--oem-surface-2)] text-[var(--oem-ink-2)]',
  UNKNOWN:                  'border-[var(--oem-line-strong)] bg-[var(--oem-surface-2)] text-[var(--oem-ink-2)]',
};

const FieldRow = memo(function FieldRow({ field }: { field: InspectorField }) {
  return (
    <div
      data-testid={`cddl-field-${field.id}`}
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

export const CddlInventoryScreen = memo(function CddlInventoryScreen() {
  // Açılışta TEK okuma. TIMER YOK, ABONELİK YOK, POLLING YOK.
  const [snap, setSnap] = useState<CddlInventorySnapshot>(() => readCddlInventorySnapshot());

  /* Unmount sonrası setState YASAK (zero-leak). */
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const refresh = useCallback(() => {
    if (mountedRef.current) setSnap(readCddlInventorySnapshot());
  }, []);

  const view = useMemo(() => buildCddlInventoryView(snap), [snap]);

  return (
    <div className="flex h-full flex-col gap-2 overflow-y-auto" data-testid="cddl-inventory">
      {/* Salt-okunur beyanı */}
      <div className="shrink-0 rounded border border-[var(--oem-line)] bg-[var(--oem-surface-1)] px-3 py-2">
        <div className="flex flex-wrap items-center gap-2 font-mono text-[10px]">
          <span className="flex items-center gap-1 text-[11px] font-bold tracking-wide text-[var(--oem-info)]">
            <Library size={12} /> CDDL ENVANTERİ
          </span>
          <span className="flex items-center gap-1 rounded border border-[var(--oem-good)] bg-[var(--oem-good-soft)] px-1.5 py-0.5 text-[var(--oem-good)]">
            <ShieldCheck size={11} /> SALT OKUNUR — profil yüklemez, prosedür çalıştırmaz
          </span>
          <button
            type="button"
            data-testid="cddl-refresh"
            onClick={refresh}
            className="flex items-center gap-1 rounded border border-[var(--oem-line-strong)] px-2 py-1 text-[var(--oem-ink-2)] hover:bg-[var(--oem-surface-2)]"
          >
            <RefreshCw size={11} /> YENİLE
          </button>
        </div>
        <p className="mt-1 font-mono text-[9px] leading-relaxed text-[var(--oem-ink-3)]">
          CDDL, mevcut OEM profillerini ve DID tanımlarını TEK sözleşmede okunabilir kılar.
          Mevcut profil sistemi SİLİNMEDİ ve OTORİTE olarak kalır — köprü TEK YÖNLÜDÜR
          (legacy → CDDL). Belgenin ayrı bir deposu YOKTUR: her okumada mevcut kayıtlardan
          yeniden kurulur. Periyodik yenileme YOKTUR.
        </p>
      </div>

      {/* Hüküm — fail-closed */}
      <div
        data-testid="cddl-verdict"
        data-verdict={view.verdict}
        title={view.verdict}
        className={`shrink-0 rounded border px-3 py-2 font-mono text-[11px] ${VERDICT_STYLE[view.verdict]}`}
      >
        CDDL DURUMU: {CDDL_VERDICT_LABEL[view.verdict]}
        <div className="mt-1 text-[9px] opacity-60">
          Doğrulama düşerse ya da `learned`/`byod` kaynak görülürse GEÇERLİ DENMEZ.
          Bu fazda ürün yoluna YALNIZ `builtin` kaynak girer.
        </div>
      </div>

      {/* Bölümler */}
      {view.sections.map((sec) => (
        <div
          key={sec.id}
          data-testid={`cddl-section-${sec.id}`}
          className="shrink-0 rounded border border-[var(--oem-line)] bg-[var(--oem-surface-1)]"
        >
          <div className="flex flex-wrap items-center gap-2 border-b border-[var(--oem-line)] px-3 py-1.5">
            <span className="font-mono text-[11px] uppercase tracking-wide text-[var(--oem-info)]">
              {sec.title}
            </span>
            {sec.id === 'source' && (
              <span className="flex items-center gap-1 rounded border border-[var(--oem-warn)] bg-[var(--oem-warn-soft)] px-1.5 py-0.5 font-mono text-[9px] text-[var(--oem-warn)]">
                <AlertTriangle size={10} /> learned/BYOD ÜRÜN YOLUNA GİRMEZ (F4)
              </span>
            )}
          </div>
          <div>
            {sec.fields.map((f) => <FieldRow key={f.id} field={f} />)}
          </div>
        </div>
      ))}

      <p className="shrink-0 pb-2 font-mono text-[9px] leading-relaxed text-[var(--oem-ink-3)]">
        BU FAZDA YAPILMAYANLAR (bilinçli): `ProcedureDef` yalnız BİLDİRİMDİR — yürütücü
        YAZILMADI ve yazılmadığı testle kilitlidir. `ComParam` zaman aşımlarını VERİ olarak
        temsil eder ama hiçbir runtime davranışını sürmez; otorite `protocolProfile`dedir.
        BYOD içe aktarımı, Discovery/Learning ve Self-Healing bu turun DIŞINDADIR.
        Destructive (yazma/aktüatör/reset/security) servisler varsayılan REDDEDİLİR ve
        `ServiceDef` onlardan PDU ÜRETMEZ.
      </p>
    </div>
  );
});

export default CddlInventoryScreen;
