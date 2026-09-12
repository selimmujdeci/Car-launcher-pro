/**
 * NavigationCoreScreen — CAROS LAB · Araç · Navigation Core.
 *
 * SALT-OKUNUR. Navigasyonu BAŞLATAMAZ, DURDURAMAZ, DEĞİŞTİREMEZ; rota isteği
 * TETİKLEMEZ, hedef SEÇTİRMEZ, reroute ZORLAMAZ.
 *
 * ZAMANLAYICI YOK: repodaki CAROS LAB deseni — açılışta tek okuma + elle YENİLE.
 *
 * GİZLİLİK: enlem/boylam, hedef adı, adres ve rota geometrisi BU EKRANA GELMEZ
 * (`LocationEngineScreen` ile aynı karar). Konum kişisel veridir; tanı için
 * gereken varlık/yaş/dik mesafe gösterilir, koordinatın kendisi değil.
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw, ShieldCheck, Navigation2, AlertTriangle } from 'lucide-react';
import {
  readNavigationCoreSnapshot, type NavigationCoreRawSnapshot,
} from '../../../platform/devtools/navigationCoreSources';
import {
  buildNavigationCoreCards, countByNavCoreClass, deriveNavCoreVerdict,
  NAV_CORE_VERDICT_LABEL, type NavCoreVerdict,
} from '../../../platform/devtools/navigationCoreModel';
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

const VERDICT_STYLE: Record<NavCoreVerdict, string> = {
  IDLE:               'border-[var(--oem-line-strong)] bg-[var(--oem-surface-2)] text-[var(--oem-ink-2)]',
  TRACKING:           'border-[var(--oem-good)] bg-[var(--oem-good-soft)] text-[var(--oem-good)]',
  DEGRADED_TRACKING:  'border-[var(--oem-warn)] bg-[var(--oem-warn-soft)] text-[var(--oem-warn)]',
  REROUTING:          'border-[var(--oem-info)] bg-[var(--oem-info-soft)] text-[var(--oem-info)]',
  STRAIGHT_LINE_ONLY: 'border-[var(--oem-danger)] bg-[var(--oem-danger-soft)] text-[var(--oem-danger)]',
  NO_PROVIDER:        'border-[var(--oem-danger)] bg-[var(--oem-danger-soft)] text-[var(--oem-danger)]',
  UNAVAILABLE:        'border-[var(--oem-line-strong)] bg-[var(--oem-surface-2)] text-[var(--oem-ink-3)]',
};

const FieldRow = memo(function FieldRow({ field, nowMs }: { field: InspectorField; nowMs: number }) {
  const age = formatAge(field.updatedAt, nowMs);
  return (
    <div
      data-testid={`nc-field-${field.id}`}
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

export const NavigationCoreScreen = memo(function NavigationCoreScreen() {
  // Açılışta TEK okuma. TIMER YOK, ABONELİK YOK, POLLING YOK.
  const [snap, setSnap] = useState<NavigationCoreRawSnapshot>(() => readNavigationCoreSnapshot());

  /* Unmount sonrası setState YASAK (zero-leak). */
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const refresh = useCallback(() => {
    if (mountedRef.current) setSnap(readNavigationCoreSnapshot());
  }, []);

  const cards       = useMemo(() => buildNavigationCoreCards(snap), [snap]);
  const verdict     = useMemo(() => deriveNavCoreVerdict(snap), [snap]);
  const classCounts = useMemo(() => countByNavCoreClass(cards), [cards]);

  return (
    <div className="flex h-full flex-col gap-2 overflow-y-auto" data-testid="navigation-core">
      {/* Salt-okunur beyanı */}
      <div className="shrink-0 rounded border border-[var(--oem-line)] bg-[var(--oem-surface-1)] px-3 py-2">
        <div className="flex flex-wrap items-center gap-2 font-mono text-[10px]">
          <span className="flex items-center gap-1 text-[11px] font-bold tracking-wide text-[var(--oem-info)]">
            <Navigation2 size={12} /> NAVIGATION CORE
          </span>
          <span className="flex items-center gap-1 rounded border border-[var(--oem-good)] bg-[var(--oem-good-soft)] px-1.5 py-0.5 text-[var(--oem-good)]">
            <ShieldCheck size={11} /> SALT OKUNUR — navigasyona dokunmaz
          </span>
          <button
            type="button"
            data-testid="nc-refresh"
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
          Yalnız mevcut senkron getter'lar okunur: rota isteği, reroute, hedef seçimi,
          navigasyon başlatma/durdurma ve ağ çağrısı TETİKLENMEZ. ENLEM/BOYLAM, hedef adı,
          adres ve rota geometrisi bu ekrana HİÇ gelmez. Periyodik yenileme YOKTUR.
        </p>
      </div>

      {/* Hüküm — fail-closed */}
      <div
        data-testid="nc-verdict"
        data-verdict={verdict.status}
        title={verdict.status}
        className={`shrink-0 rounded border px-3 py-2 font-mono text-[11px] ${VERDICT_STYLE[verdict.status]}`}
      >
        NAVİGASYON GERÇEĞİ: {NAV_CORE_VERDICT_LABEL[verdict.status]}
        <ul className="mt-1 list-inside list-disc space-y-0.5 text-[10px] leading-relaxed opacity-80">
          {verdict.reasons.map((r, i) => <li key={i}>{r}</li>)}
        </ul>
        <div className="mt-1 text-[9px] opacity-50">
          "Haritada rota çizildi" ile "araç doğru yolda doğru zamanda yönlendiriliyor"
          AYNI ŞEY DEĞİLDİR. Bu ekran ikisini birbirine karıştırmaz.
        </div>
      </div>

      {/* Kartlar */}
      {cards.map((card) => (
        <div
          key={card.id}
          data-testid={`nc-card-${card.id}`}
          className="shrink-0 rounded border border-[var(--oem-line)] bg-[var(--oem-surface-1)]"
        >
          <div className="flex flex-wrap items-center gap-2 border-b border-[var(--oem-line)] px-3 py-1.5">
            <span className="font-mono text-[11px] uppercase tracking-wide text-[var(--oem-info)]">
              {card.title}
            </span>
            {card.id === 'truth' && snap.straightLineActive && (
              <span className="flex items-center gap-1 rounded border border-[var(--oem-danger)] bg-[var(--oem-danger-soft)] px-1.5 py-0.5 font-mono text-[9px] text-[var(--oem-danger)]">
                <AlertTriangle size={10} /> GERÇEK ROTA YOK
              </span>
            )}
          </div>
          <div>
            {card.fields.map((f) => <FieldRow key={f.id} field={f} nowMs={snap.readAt} />)}
          </div>
        </div>
      ))}

      <p className="shrink-0 pb-2 font-mono text-[9px] leading-relaxed text-[var(--oem-ink-3)]">
        KAPSAM SINIRI (dürüstlük): map matching **rota-göreli**dir, tam yol-ağı
        eşleştirmesi DEĞİLDİR — cihazda yol ağı grafiği (`routing-graph.bin`) yoktur.
        "KORİDOR DIŞI" aracın aktif rotada olmadığını söyler; HANGİ yolda olduğunu
        SÖYLEYEMEZ, o veri cihazda yok. Trafik verisi yoktur; ETA yalnız hız geçmişi
        ve durma tamponundan türetilir. Bu ekrandaki hiçbir alan gerçek araç
        doğrulaması yerine GEÇMEZ — saha kütüğü tek otoritedir.
      </p>
    </div>
  );
});

export default NavigationCoreScreen;
