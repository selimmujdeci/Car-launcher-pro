/**
 * KnowledgeExplorerScreen — CAROS LAB · Yapay Zekâ · Bilgi Tabanı Gezgini.
 *
 * SALT-OKUNUR. Kayıt EKLEMEZ, SİLMEZ, temizlemez; keşif TETİKLEMEZ, araca
 * sorgu GÖNDERMEZ, öğrenme motorunu BAŞLATMAZ (`startVehicleKnowledgeBase()`
 * çağrılmaz — ekran açmak öğrenme başlatmaz).
 *
 * ZAMANLAYICI YOK: repodaki CAROS LAB deseni — açılışta tek okuma + elle YENİLE.
 *
 * GİZLİLİK: ham VIN, tam parmak izi hash'i, ham ECU adres listesi ve firmware
 * sürüm dizeleri bu ekrana GELMEZ — maskeli VIN (yalnız WMI açık), hash ön eki
 * ve ADETLER gösterilir.
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw, ShieldCheck, Library } from 'lucide-react';
import {
  readKnowledgeBaseSnapshot, type KnowledgeBaseRawSnapshot,
} from '../../../platform/devtools/knowledgeBaseSources';
import {
  buildKnowledgeFields, buildVehicleFields, deriveKnowledgeVerdict,
  knowledgeVerdictTone, isConfirmed,
  KNOWLEDGE_VERDICT_LABEL, type KnowledgeTone,
} from '../../../platform/devtools/knowledgeBaseModel';
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

const TONE_STYLE: Record<KnowledgeTone, string> = {
  ok:    'border-[var(--oem-good)] bg-[var(--oem-good-soft)] text-[var(--oem-good)]',
  muted: 'border-[var(--oem-line-strong)] bg-[var(--oem-surface-2)] text-[var(--oem-ink-3)]',
  warn:  'border-[var(--oem-warn)] bg-[var(--oem-warn-soft)] text-[var(--oem-warn)]',
};

const FieldRow = memo(function FieldRow({ field, nowMs }: { field: InspectorField; nowMs: number }) {
  const age = formatAge(field.updatedAt, nowMs);
  return (
    <div
      data-testid={`kb-field-${field.id}`}
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

export const KnowledgeExplorerScreen = memo(function KnowledgeExplorerScreen() {
  const [snap, setSnap] = useState<KnowledgeBaseRawSnapshot>(
    () => readKnowledgeBaseSnapshot(Date.now()),
  );

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const refresh = useCallback(() => {
    if (mountedRef.current) setSnap(readKnowledgeBaseSnapshot(Date.now()));
  }, []);

  const nowMs = snap.readAt;

  const verdict = useMemo(
    () => deriveKnowledgeVerdict({ vehicles: snap.vehicles, maxRecords: snap.maxRecords }),
    [snap.vehicles, snap.maxRecords],
  );

  const summaryFields = useMemo(
    () => buildKnowledgeFields({ vehicles: snap.vehicles, maxRecords: snap.maxRecords, nowMs }),
    [snap.vehicles, snap.maxRecords, nowMs],
  );

  return (
    <div className="flex h-full flex-col gap-2 overflow-y-auto" data-testid="knowledge-explorer">
      <div className="shrink-0 rounded border border-[var(--oem-line)] bg-[var(--oem-surface-1)] px-3 py-2">
        <div className="flex flex-wrap items-center gap-2 font-mono text-[10px]">
          <span className="flex items-center gap-1 text-[11px] font-bold tracking-wide text-[var(--oem-info)]">
            <Library size={12} /> BİLGİ TABANI GEZGİNİ
          </span>
          <span className="flex items-center gap-1 rounded border border-[var(--oem-good)] bg-[var(--oem-good-soft)] px-1.5 py-0.5 text-[var(--oem-good)]">
            <ShieldCheck size={11} /> SALT OKUNUR — keşif tetiklemez
          </span>
          <button
            type="button"
            data-testid="kb-refresh"
            onClick={refresh}
            className="flex items-center gap-1 rounded border border-[var(--oem-line-strong)] px-2 py-1 text-[var(--oem-ink-2)] hover:bg-[var(--oem-surface-2)]"
          >
            <RefreshCw size={11} /> YENİLE
          </button>
          <span
            data-testid="kb-verdict"
            data-verdict={verdict}
            className={`rounded border px-1.5 py-0.5 ${TONE_STYLE[knowledgeVerdictTone(verdict)]}`}
          >
            {KNOWLEDGE_VERDICT_LABEL[verdict]}
          </span>
        </div>
        <p className="mt-1 font-mono text-[9px] leading-relaxed text-[var(--oem-ink-3)]">
          Ham VIN, tam parmak izi hash'i, ECU adres listesi ve firmware sürüm dizeleri bu
          ekrana GELMEZ. TEK gözlemli profil KANIT SAYILMAZ — aynı araç en az iki kez
          görülmelidir.
        </p>
      </div>

      <div className="shrink-0 rounded border border-[var(--oem-line)] bg-[var(--oem-surface-1)]">
        <div className="border-b border-[var(--oem-line)] px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-[var(--oem-ink-2)]">
          DEPO ÖZETİ
        </div>
        {summaryFields.map((f) => <FieldRow key={f.id} field={f} nowMs={nowMs} />)}
      </div>

      {(snap.vehicles ?? []).map((v) => (
        <div
          key={v.fingerprintPrefix}
          data-testid={`kb-vehicle-${v.fingerprintPrefix}`}
          data-confirmed={isConfirmed(v) ? 'yes' : 'no'}
          className="shrink-0 rounded border border-[var(--oem-line)] bg-[var(--oem-surface-1)]"
        >
          <div className="flex items-center gap-2 border-b border-[var(--oem-line)] px-2 py-1">
            <span className="font-mono text-[10px] uppercase tracking-wider text-[var(--oem-ink-2)]">
              ARAÇ {v.fingerprintPrefix}
            </span>
            <span
              className={`rounded border px-1.5 py-0.5 font-mono text-[9px] ${
                isConfirmed(v) ? TONE_STYLE.ok : TONE_STYLE.warn
              }`}
            >
              {isConfirmed(v) ? 'DOĞRULANMIŞ' : 'TEK GÖZLEM — KANIT DEĞİL'}
            </span>
          </div>
          {buildVehicleFields(v, nowMs).map((f) => (
            <FieldRow key={f.id} field={f} nowMs={nowMs} />
          ))}
        </div>
      ))}
    </div>
  );
});
