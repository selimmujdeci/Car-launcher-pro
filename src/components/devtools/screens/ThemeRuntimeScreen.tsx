/**
 * ThemeRuntimeScreen — CAROS LAB · Çalışma Zamanı · Tema Manifesti.
 *
 * SALT-OKUNUR. Tema UYGULAMAZ, manifest GÖNDERMEZ/SİLMEZ, önizleme köprüsünü
 * TETİKLEMEZ, depoya YAZMAZ, ağa ÇIKMAZ.
 *
 * ZAMANLAYICI YOK: açılışta tek okuma + elle YENİLE (repodaki LAB deseni).
 *
 * GİZLİLİK: manifest İÇERİĞİ (renk değerleri, üretilen CSS metni, tema adı)
 * ekrana TAŞINMAZ — yalnız sayı, durum ve zaman.
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw, ShieldCheck, Palette } from 'lucide-react';
import {
  readThemeRuntimeSnapshot, type ThemeRuntimeRawSnapshot,
} from '../../../platform/devtools/themeRuntimeSources';
import {
  buildThemeRuntimeCards, countByThemeClass, deriveThemeRuntimeVerdict,
  THEME_RUNTIME_VERDICT_LABEL, type ThemeRuntimeVerdict,
} from '../../../platform/devtools/themeRuntimeModel';
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

const VERDICT_STYLE: Record<ThemeRuntimeVerdict, string> = {
  RUNTIME_UNAVAILABLE: 'border-[var(--oem-danger)] bg-[var(--oem-danger-soft)] text-[var(--oem-danger)]',
  NEVER_APPLIED:       'border-[var(--oem-line-strong)] bg-[var(--oem-surface-2)] text-[var(--oem-ink-2)]',
  REJECTED_LAST:       'border-[var(--oem-warn)] bg-[var(--oem-warn-soft)] text-[var(--oem-warn)]',
  PARTIAL_APPLY:       'border-[var(--oem-warn)] bg-[var(--oem-warn-soft)] text-[var(--oem-warn)]',
  APPLIED_EMPTY:       'border-[var(--oem-info)] bg-[var(--oem-info-soft)] text-[var(--oem-info)]',
  APPLIED_ACTIVE:      'border-[var(--oem-good)] bg-[var(--oem-good-soft)] text-[var(--oem-good)]',
};

const FieldRow = memo(function FieldRow({ field, nowMs }: { field: InspectorField; nowMs: number }) {
  const age = formatAge(field.updatedAt, nowMs);
  return (
    <div
      data-testid={`tr-field-${field.id}`}
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

export const ThemeRuntimeScreen = memo(function ThemeRuntimeScreen() {
  // Açılışta TEK okuma. TIMER YOK, ABONELİK YOK, POLLING YOK.
  const [snap, setSnap] = useState<ThemeRuntimeRawSnapshot>(() => readThemeRuntimeSnapshot());

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const refresh = useCallback(() => {
    if (mountedRef.current) setSnap(readThemeRuntimeSnapshot());
  }, []);

  const cards = useMemo(() => buildThemeRuntimeCards(snap), [snap]);
  const verdict = useMemo(() => deriveThemeRuntimeVerdict(snap), [snap]);
  const classCounts = useMemo(() => countByThemeClass(cards), [cards]);

  return (
    <div className="flex h-full flex-col gap-2 overflow-y-auto" data-testid="theme-runtime">
      <div className="shrink-0 rounded border border-[var(--oem-line)] bg-[var(--oem-surface-1)] px-3 py-2">
        <div className="flex flex-wrap items-center gap-2 font-mono text-[10px]">
          <span className="flex items-center gap-1 text-[11px] font-bold tracking-wide text-[var(--oem-info)]">
            <Palette size={12} /> TEMA MANİFESTİ ÇALIŞMA ZAMANI
          </span>
          <span className="flex items-center gap-1 rounded border border-[var(--oem-good)] bg-[var(--oem-good-soft)] px-1.5 py-0.5 text-[var(--oem-good)]">
            <ShieldCheck size={11} /> SALT OKUNUR — tema uygulamaz
          </span>
          <button
            type="button"
            data-testid="tr-refresh"
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
          Yalnız mevcut senkron getter'lar ve DOM sayımı okunur: manifest
          UYGULANMAZ/GÖNDERİLMEZ/SİLİNMEZ, önizleme köprüsü TETİKLENMEZ, depoya
          YAZILMAZ, ağ çağrısı YAPILMAZ. Renk değerleri, üretilen CSS metni ve tema
          adı bu ekrana TAŞINMAZ — yalnız sayı, durum ve zaman.
        </p>
      </div>

      <div
        data-testid="tr-verdict"
        data-verdict={verdict.status}
        title={verdict.status}
        className={`shrink-0 rounded border px-3 py-2 font-mono text-[11px] ${VERDICT_STYLE[verdict.status]}`}
      >
        TEMA GERÇEĞİ: {THEME_RUNTIME_VERDICT_LABEL[verdict.status]}
        <ul className="mt-1 list-inside list-disc space-y-0.5 text-[10px] leading-relaxed opacity-80">
          {verdict.reasons.map((r, i) => <li key={i}>{r}</li>)}
        </ul>
        <div className="mt-1 text-[9px] opacity-50">
          &quot;Manifest uygulandı&quot; ile &quot;görünüm değişti&quot; AYNI ŞEY DEĞİLDİR:
          içi boş manifest de başarıyla uygulanır ve ekranı değiştirmez.
        </div>
      </div>

      {cards.map((card) => (
        <div
          key={card.id}
          data-testid={`tr-card-${card.id}`}
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
        KAPSAM SINIRI (dürüstlük): &quot;DOM&apos;da data-editable&quot; sayısı YALNIZCA o an
        çizili olan ekranı ölçer — kapalı çekmecedeki bileşenler görünmez, bu bir
        eksiklik DEĞİLDİR. Uygulama sayaçları OTURUM İÇİdir (kalıcı değil).
        Gerçek araç doğrulaması YAPILMADI — saha kütüğü tek otoritedir.
      </p>
    </div>
  );
});

export default ThemeRuntimeScreen;
