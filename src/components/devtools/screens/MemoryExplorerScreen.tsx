/**
 * MemoryExplorerScreen — CAROS LAB · Yapay Zekâ · Bellek Gezgini.
 *
 * SALT-OKUNUR. Hafızaya kayıt EKLEMEZ, SİLMEZ, temizlemez; bütçe değiştirmez,
 * hassas veri kapısını gevşetmez, Mavi'yi çağırmaz.
 *
 * ZAMANLAYICI YOK: repodaki CAROS LAB deseni — açılışta tek okuma + elle YENİLE.
 *
 * ── GİZLİLİK — BU EKRANIN TANIMLAYICI KURALI ───────────────────────────────
 * Hafıza kayıtlarının içeriği KULLANICI METNİDİR. Bu ekran metni GÖSTERMEZ:
 * ne tamamını, ne kırpılmışını, ne ilk harfini, ne uzunluğunu, ne özetini.
 * Yalnız ADET · YAŞ · KÖKEN SINIFI · POLİTİKA görünür. Bir hafıza gezgininin
 * "gezinme" işlevi burada bilinçli olarak YOKTUR — ham komut/transkript LAB'a
 * taşınamaz (CLAUDE.md gözlemlenebilirlik kuralı 6).
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw, ShieldCheck, Brain, EyeOff } from 'lucide-react';
import {
  readAiMemorySnapshot, type AiMemoryRawSnapshot,
} from '../../../platform/devtools/aiMemorySources';
import {
  buildMemoryFields, deriveMemoryVerdict, memoryVerdictTone,
  MEMORY_VERDICT_LABEL, type MemoryTone,
} from '../../../platform/devtools/aiMemoryModel';
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

const TONE_STYLE: Record<MemoryTone, string> = {
  ok:    'border-[var(--oem-good)] bg-[var(--oem-good-soft)] text-[var(--oem-good)]',
  muted: 'border-[var(--oem-line-strong)] bg-[var(--oem-surface-2)] text-[var(--oem-ink-3)]',
  warn:  'border-[var(--oem-warn)] bg-[var(--oem-warn-soft)] text-[var(--oem-warn)]',
};

const FieldRow = memo(function FieldRow({ field, nowMs }: { field: InspectorField; nowMs: number }) {
  const age = formatAge(field.updatedAt, nowMs);
  return (
    <div
      data-testid={`mem-field-${field.id}`}
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

export const MemoryExplorerScreen = memo(function MemoryExplorerScreen() {
  const [snap, setSnap] = useState<AiMemoryRawSnapshot>(
    () => readAiMemorySnapshot(Date.now()),
  );

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const refresh = useCallback(() => {
    if (mountedRef.current) setSnap(readAiMemorySnapshot(Date.now()));
  }, []);

  const nowMs = snap.readAt;

  const verdict = useMemo(
    () => deriveMemoryVerdict({ shortTerm: snap.shortTerm, capacity: snap.shortTermCapacity }),
    [snap.shortTerm, snap.shortTermCapacity],
  );

  const fields = useMemo(() => buildMemoryFields({ ...snap, nowMs }), [snap, nowMs]);

  return (
    <div className="flex h-full flex-col gap-2 overflow-y-auto" data-testid="memory-explorer">
      <div className="shrink-0 rounded border border-[var(--oem-line)] bg-[var(--oem-surface-1)] px-3 py-2">
        <div className="flex flex-wrap items-center gap-2 font-mono text-[10px]">
          <span className="flex items-center gap-1 text-[11px] font-bold tracking-wide text-[var(--oem-info)]">
            <Brain size={12} /> BELLEK GEZGİNİ
          </span>
          <span className="flex items-center gap-1 rounded border border-[var(--oem-good)] bg-[var(--oem-good-soft)] px-1.5 py-0.5 text-[var(--oem-good)]">
            <ShieldCheck size={11} /> SALT OKUNUR — hafızaya yazmaz
          </span>
          <button
            type="button"
            data-testid="mem-refresh"
            onClick={refresh}
            className="flex items-center gap-1 rounded border border-[var(--oem-line-strong)] px-2 py-1 text-[var(--oem-ink-2)] hover:bg-[var(--oem-surface-2)]"
          >
            <RefreshCw size={11} /> YENİLE
          </button>
          <span
            data-testid="mem-verdict"
            data-verdict={verdict}
            className={`rounded border px-1.5 py-0.5 ${TONE_STYLE[memoryVerdictTone(verdict)]}`}
          >
            {MEMORY_VERDICT_LABEL[verdict]}
          </span>
        </div>
      </div>

      {/* Gizlilik beyanı — bu ekranın en önemli sözleşmesi */}
      <div
        data-testid="mem-privacy"
        className="shrink-0 rounded border border-[var(--oem-info)] bg-[var(--oem-info-soft)] px-3 py-2"
      >
        <div className="flex items-center gap-1 font-mono text-[10px] text-[var(--oem-info)]">
          <EyeOff size={11} /> İÇERİK GÖSTERİLMEZ
        </div>
        <p className="mt-1 text-[9px] leading-relaxed text-[var(--oem-ink-2)]">
          Hafıza kayıtlarının içeriği kullanıcı metnidir. Bu ekran metni ne tam, ne kırpılmış,
          ne ilk harfiyle, ne uzunluğuyla, ne de özetiyle gösterir — yalnız ADET · YAŞ ·
          KÖKEN SINIFI · POLİTİKA. “Gezinme” işlevi bilinçli olarak YOKTUR.
        </p>
      </div>

      <div className="shrink-0 rounded border border-[var(--oem-line)] bg-[var(--oem-surface-1)]">
        {fields.map((f) => <FieldRow key={f.id} field={f} nowMs={nowMs} />)}
      </div>
    </div>
  );
});
