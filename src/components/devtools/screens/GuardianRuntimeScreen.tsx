/**
 * GuardianRuntimeScreen — CAROS LAB · Çalışma Zamanı · Guardian Runtime.
 *
 * SALT-OKUNUR. Guardian tick'ini TETİKLEYEMEZ, kadansını DEĞİŞTİREMEZ, kuralları
 * ÇALIŞTIRAMAZ, eşik/severity DEĞİŞTİREMEZ, OBD/GPS'e komut GÖNDEREMEZ.
 *
 * ZAMANLAYICI YOK: repodaki CAROS LAB deseni — açılışta tek okuma + elle YENİLE.
 * (Periyodik yenileme, ölçtüğümüz bütçenin kendisini kirletirdi.)
 *
 * GİZLİLİK: koordinat bu ekrana GELMEZ (Guardian GPS'ten yalnız hız okur);
 * risk olaylarının serbest metni ve hata mesajları TAŞINMAZ.
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw, ShieldCheck, Activity, AlertTriangle } from 'lucide-react';
import {
  readGuardianRuntimeSnapshot, type GuardianRuntimeRawSnapshot,
} from '../../../platform/devtools/guardianRuntimeSources';
import {
  buildGuardianCards, countByGuardianClass, deriveGuardianVerdict,
  GUARDIAN_VERDICT_LABEL, type GuardianVerdict,
} from '../../../platform/devtools/guardianRuntimeModel';
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

const VERDICT_STYLE: Record<GuardianVerdict, string> = {
  NOT_RUNNING: 'border-[var(--oem-danger)] bg-[var(--oem-danger-soft)] text-[var(--oem-danger)]',
  NO_TICK_YET: 'border-[var(--oem-line-strong)] bg-[var(--oem-surface-2)] text-[var(--oem-ink-2)]',
  OVER_BUDGET: 'border-[var(--oem-danger)] bg-[var(--oem-danger-soft)] text-[var(--oem-danger)]',
  NEAR_BUDGET: 'border-[var(--oem-warn)] bg-[var(--oem-warn-soft)] text-[var(--oem-warn)]',
  ERRORING:    'border-[var(--oem-warn)] bg-[var(--oem-warn-soft)] text-[var(--oem-warn)]',
  NO_INPUT:    'border-[var(--oem-info)] bg-[var(--oem-info-soft)] text-[var(--oem-info)]',
  RUNNING:     'border-[var(--oem-good)] bg-[var(--oem-good-soft)] text-[var(--oem-good)]',
};

const FieldRow = memo(function FieldRow({ field, nowMs }: { field: InspectorField; nowMs: number }) {
  const age = formatAge(field.updatedAt, nowMs);
  return (
    <div
      data-testid={`gr-field-${field.id}`}
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

export const GuardianRuntimeScreen = memo(function GuardianRuntimeScreen() {
  // Açılışta TEK okuma. TIMER YOK, ABONELİK YOK, POLLING YOK.
  const [snap, setSnap] = useState<GuardianRuntimeRawSnapshot>(() => readGuardianRuntimeSnapshot());

  /* Unmount sonrası setState YASAK (zero-leak). */
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const refresh = useCallback(() => {
    if (mountedRef.current) setSnap(readGuardianRuntimeSnapshot());
  }, []);

  const cards       = useMemo(() => buildGuardianCards(snap), [snap]);
  const verdict     = useMemo(() => deriveGuardianVerdict(snap), [snap]);
  const classCounts = useMemo(() => countByGuardianClass(cards), [cards]);

  return (
    <div className="flex h-full flex-col gap-2 overflow-y-auto" data-testid="guardian-runtime">
      {/* Salt-okunur beyanı */}
      <div className="shrink-0 rounded border border-[var(--oem-line)] bg-[var(--oem-surface-1)] px-3 py-2">
        <div className="flex flex-wrap items-center gap-2 font-mono text-[10px]">
          <span className="flex items-center gap-1 text-[11px] font-bold tracking-wide text-[var(--oem-info)]">
            <Activity size={12} /> GUARDIAN RUNTIME
          </span>
          <span className="flex items-center gap-1 rounded border border-[var(--oem-good)] bg-[var(--oem-good-soft)] px-1.5 py-0.5 text-[var(--oem-good)]">
            <ShieldCheck size={11} /> SALT OKUNUR — tick'e dokunmaz
          </span>
          <button
            type="button"
            data-testid="gr-refresh"
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
          Yalnız mevcut senkron getter okunur: Guardian tick'i TETİKLENMEZ, kadans
          DEĞİŞTİRİLMEZ, kural/eşik/severity DEĞİŞTİRİLMEZ, OBD sorgusu veya GPS
          düzeltmesi İSTENMEZ, ağ çağrısı YAPILMAZ. Periyodik yenileme YOKTUR —
          ölçtüğümüz bütçenin kendisini kirletirdi.
        </p>
      </div>

      {/* Hüküm — fail-closed */}
      <div
        data-testid="gr-verdict"
        data-verdict={verdict.status}
        title={verdict.status}
        className={`shrink-0 rounded border px-3 py-2 font-mono text-[11px] ${VERDICT_STYLE[verdict.status]}`}
      >
        GUARDIAN GERÇEĞİ: {GUARDIAN_VERDICT_LABEL[verdict.status]}
        <ul className="mt-1 list-inside list-disc space-y-0.5 text-[10px] leading-relaxed opacity-80">
          {verdict.reasons.map((r, i) => <li key={i}>{r}</li>)}
        </ul>
        <div className="mt-1 text-[9px] opacity-50">
          "Motor koşuyor" ile "sürücü uyarıldı" AYNI ŞEY DEĞİLDİR. Bu tur Guardian'a
          kalp atışı verir, ses vermez.
        </div>
      </div>

      {/* Kartlar */}
      {cards.map((card) => (
        <div
          key={card.id}
          data-testid={`gr-card-${card.id}`}
          className="shrink-0 rounded border border-[var(--oem-line)] bg-[var(--oem-surface-1)]"
        >
          <div className="flex flex-wrap items-center gap-2 border-b border-[var(--oem-line)] px-3 py-1.5">
            <span className="font-mono text-[11px] uppercase tracking-wide text-[var(--oem-info)]">
              {card.title}
            </span>
            {card.id === 'budget' && snap.runtime.overHardLimitCount > 0 && (
              <span className="flex items-center gap-1 rounded border border-[var(--oem-danger)] bg-[var(--oem-danger-soft)] px-1.5 py-0.5 font-mono text-[9px] text-[var(--oem-danger)]">
                <AlertTriangle size={10} /> #494 TAVANI AŞILDI
              </span>
            )}
          </div>
          <div>
            {card.fields.map((f) => <FieldRow key={f.id} field={f} nowMs={snap.readAt} />)}
          </div>
        </div>
      ))}

      <p className="shrink-0 pb-2 font-mono text-[9px] leading-relaxed text-[var(--oem-ink-3)]">
        KAPSAM SINIRI (dürüstlük): Guardian'ın 8 kuralından bugün fiilen KOŞAN
        yalnız <b>vehicle-health</b>'tir. GPS hızı okunur ama hiçbir kurala girmez
        (map dilimleri üretilmiyor). Hava · viraj · yokuş · yol tehlikesi · hız
        kamerası · yorgunluk kuralları veri kaynağı beklemektedir; konum tabanlı
        olanlar şartlı kilit <b>#508</b>, yorgunluk <b>#509</b> altındadır. Bu
        ekrandaki süre ölçümleri ÇALIŞTIĞI CİHAZA aittir — geliştirme makinesinde
        alınan sayı head unit sonucu SAYILMAZ. Saha kütüğü tek otoritedir.
      </p>
    </div>
  );
});

export default GuardianRuntimeScreen;
