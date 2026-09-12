/**
 * CapabilityLearningScreen — CAROS LAB · Araç · Araç Öğrenmesi / Yetenek Çizgesi.
 *
 * SALT-OKUNUR. Keşif KOŞTURMAZ, PDU göndermez, depoya YAZMAZ, öğrenme silmez,
 * timer kurmaz, ağa çıkmaz. Yalnız mevcut senkron getter'ları okur.
 *
 * ── EKRANIN TEK İDDİASI ─────────────────────────────────────────────────────
 * "Bu cihaz NE ÖĞRENDİ, KANITI NE, ve o öğrenme ÜRÜNE GÜVENİLİR Mİ."
 * Hiç öğrenme yoksa ya da depo güvenilmezse sayaç `0` değil **KAYNAK YOK** yazar.
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw, ShieldCheck, Brain } from 'lucide-react';
import {
  readCapabilityLearningSnapshot,
  type CapabilityLearningRawSnapshot,
} from '../../../platform/devtools/capabilityLearningSources';
import {
  buildLearningCards, countByLearningClass, deriveLearningVerdict,
  LEARNING_VERDICT_LABEL, type LearningVerdict,
} from '../../../platform/devtools/capabilityLearningModel';
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

const VERDICT_STYLE: Record<LearningVerdict, string> = {
  NEVER_LEARNED:       'border-[var(--oem-line-strong)] bg-[var(--oem-surface-2)] text-[var(--oem-ink-2)]',
  STORE_UNTRUSTWORTHY: 'border-[var(--oem-danger)] bg-[var(--oem-danger-soft)] text-[var(--oem-danger)]',
  CONFLICTED:          'border-[var(--oem-warn)] bg-[var(--oem-warn-soft)] text-[var(--oem-warn)]',
  UNTRUSTED_ONLY:      'border-[var(--oem-info)] bg-[var(--oem-info-soft)] text-[var(--oem-info)]',
  LEARNED:             'border-[var(--oem-good)] bg-[var(--oem-good-soft)] text-[var(--oem-good)]',
};

const FieldRow = memo(function FieldRow({ field, nowMs }: { field: InspectorField; nowMs: number }) {
  const age = formatAge(field.updatedAt, nowMs);
  return (
    <div
      data-testid={`learn-field-${field.id}`}
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

export const CapabilityLearningScreen = memo(function CapabilityLearningScreen() {
  // Açılışta TEK okuma. TIMER YOK, ABONELİK YOK, POLLING YOK.
  const [snap, setSnap] = useState<CapabilityLearningRawSnapshot>(
    () => readCapabilityLearningSnapshot());

  /* Unmount sonrası setState YASAK (zero-leak). */
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const refresh = useCallback(() => {
    if (mountedRef.current) setSnap(readCapabilityLearningSnapshot());
  }, []);

  const cards = useMemo(() => buildLearningCards(snap), [snap]);
  const verdict = useMemo(() => deriveLearningVerdict(snap), [snap]);
  const counts = useMemo(() => countByLearningClass(cards), [cards]);

  return (
    <div className="flex h-full flex-col gap-2 overflow-y-auto" data-testid="capability-learning">
      <div className="shrink-0 rounded border border-[var(--oem-line)] bg-[var(--oem-surface-1)] px-3 py-2">
        <div className="flex flex-wrap items-center gap-2 font-mono text-[10px]">
          <span className="flex items-center gap-1 text-[11px] font-bold tracking-wide text-[var(--oem-info)]">
            <Brain size={12} /> ARAÇ ÖĞRENMESİ / YETENEK ÇİZGESİ
          </span>
          <span className="flex items-center gap-1 rounded border border-[var(--oem-good)] bg-[var(--oem-good-soft)] px-1.5 py-0.5 text-[var(--oem-good)]">
            <ShieldCheck size={11} /> SALT OKUNUR — öğrenme yazmaz
          </span>
          <button
            type="button"
            data-testid="learn-refresh"
            onClick={refresh}
            className="flex items-center gap-1 rounded border border-[var(--oem-line-strong)] px-2 py-1 text-[var(--oem-ink-2)] hover:bg-[var(--oem-surface-2)]"
          >
            <RefreshCw size={11} /> YENİLE
          </button>
          <span className="text-[var(--oem-ink-3)]">
            ÖLÇÜLDÜ {counts.OBSERVED} · TÜRETİLDİ {counts.DERIVED} ·
            KAYNAK YOK {counts.UNAVAILABLE}
          </span>
        </div>
        <p className="mt-1 font-mono text-[9px] leading-relaxed text-[var(--oem-ink-3)]">
          Bu ekran keşif KOŞTURMAZ, PDU göndermez, depoya YAZMAZ. Yalnız öğrenme
          belleğini okur. Hiç öğrenme yoksa ya da depo güvenilmezse sayaç
          <b> 0 değil KAYNAK YOK</b> gösterir.
        </p>
      </div>

      <div
        data-testid="learn-verdict"
        data-verdict={verdict.status}
        title={verdict.status}
        className={`shrink-0 rounded border px-3 py-2 font-mono text-[11px] ${VERDICT_STYLE[verdict.status]}`}
      >
        ÖĞRENME GERÇEĞİ: {LEARNING_VERDICT_LABEL[verdict.status]}
        <ul className="mt-1 list-inside list-disc space-y-0.5 text-[10px] leading-relaxed opacity-80">
          {verdict.reasons.map((r, i) => <li key={i}>{r}</li>)}
        </ul>
        <div className="mt-1 text-[9px] opacity-50">
          Yalnız CANLI araç kanıtı ürün öğrenmesi üretir; replay/sentetik veri
          yeniden kullanıma AÇILMAZ.
        </div>
      </div>

      {cards.map((card) => (
        <div
          key={card.id}
          data-testid={`learn-card-${card.id}`}
          className="shrink-0 rounded border border-[var(--oem-line)] bg-[var(--oem-surface-1)]"
        >
          <div className="flex flex-wrap items-center gap-2 border-b border-[var(--oem-line)] px-3 py-1.5">
            <span className="font-mono text-[11px] uppercase tracking-wide text-[var(--oem-info)]">
              {card.title}
            </span>
          </div>
          <div>
            {card.fields.map((f) => <FieldRow key={f.id} field={f} nowMs={snap.readAt} />)}
          </div>
        </div>
      ))}

      <p className="shrink-0 pb-2 font-mono text-[9px] leading-relaxed text-[var(--oem-ink-3)]">
        KAPSAM SINIRI (dürüstlük): öğrenme YALNIZ YEREL'dir — Supabase/FleetKB'ye
        tek bayt yazılmaz (Cloud FleetMemory bu turun DIŞINDA). Ham VIN/MAC depoya
        GİRMEZ; kimlikler geri döndürülemez karmalardır. Öğrenme hiçbir destructive
        servisi AÇMAZ ve F4-A native güvenlik kapısını gevşetemez. `PRESENT → ABSENT`
        dönüşü tek ölçümle olmaz (kota) ve çelişki sessizce çözülmez. Bozuk ya da
        şeması uyuşmayan depo yok sayılır ve "öğrendik" DENMEZ. Gerçek araç
        doğrulaması YAPILMADI — saha kütüğü tek otoritedir.
      </p>
    </div>
  );
});

export default CapabilityLearningScreen;
