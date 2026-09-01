/**
 * DiscoveryCapabilityScreen — CAROS LAB · Araç · Keşif / Yetenek Haritası.
 *
 * SALT-OKUNUR. Keşif turu BAŞLATMAZ, PDU GÖNDERMEZ, oturum AÇMAZ, bütçe
 * DEĞİŞTİRMEZ, ağa ÇIKMAZ. Yalnız mevcut senkron getter'ları okur.
 *
 * ZAMANLAYICI YOK: açılışta tek okuma + elle YENİLE (repodaki LAB deseni).
 *
 * ── EKRANIN TEK İDDİASI ─────────────────────────────────────────────────────
 * "Bu ECU'da hangi servis HANGİ KOŞULLA ölçüldü." Ölçülmemiş hiçbir şey sayı
 * olarak görünmez; hiç yoklama yapılmadıysa `0` değil **KAYNAK YOK** yazar.
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw, ShieldCheck, Radar } from 'lucide-react';
import {
  readDiscoveryCapabilitySnapshot,
  type DiscoveryCapabilityRawSnapshot,
} from '../../../platform/devtools/discoveryCapabilitySources';
import {
  buildDiscoveryCards, countByDiscoveryClass, deriveDiscoveryVerdict,
  DISCOVERY_VERDICT_LABEL, type DiscoveryVerdict,
} from '../../../platform/devtools/discoveryCapabilityModel';
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

const VERDICT_STYLE: Record<DiscoveryVerdict, string> = {
  NEVER_PROBED: 'border-[var(--oem-line-strong)] bg-[var(--oem-surface-2)] text-[var(--oem-ink-2)]',
  NO_BRIDGE:    'border-[var(--oem-danger)] bg-[var(--oem-danger-soft)] text-[var(--oem-danger)]',
  INCOMPLETE:   'border-[var(--oem-warn)] bg-[var(--oem-warn-soft)] text-[var(--oem-warn)]',
  MEASURED:     'border-[var(--oem-good)] bg-[var(--oem-good-soft)] text-[var(--oem-good)]',
};

const FieldRow = memo(function FieldRow({ field, nowMs }: { field: InspectorField; nowMs: number }) {
  const age = formatAge(field.updatedAt, nowMs);
  return (
    <div
      data-testid={`disc-field-${field.id}`}
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

export const DiscoveryCapabilityScreen = memo(function DiscoveryCapabilityScreen() {
  // Açılışta TEK okuma. TIMER YOK, ABONELİK YOK, POLLING YOK.
  const [snap, setSnap] = useState<DiscoveryCapabilityRawSnapshot>(
    () => readDiscoveryCapabilitySnapshot());

  /* Unmount sonrası setState YASAK (zero-leak). */
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const refresh = useCallback(() => {
    if (mountedRef.current) setSnap(readDiscoveryCapabilitySnapshot());
  }, []);

  const cards = useMemo(() => buildDiscoveryCards(snap), [snap]);
  const verdict = useMemo(() => deriveDiscoveryVerdict(snap), [snap]);
  const counts = useMemo(() => countByDiscoveryClass(cards), [cards]);

  return (
    <div className="flex h-full flex-col gap-2 overflow-y-auto" data-testid="discovery-capability">
      <div className="shrink-0 rounded border border-[var(--oem-line)] bg-[var(--oem-surface-1)] px-3 py-2">
        <div className="flex flex-wrap items-center gap-2 font-mono text-[10px]">
          <span className="flex items-center gap-1 text-[11px] font-bold tracking-wide text-[var(--oem-info)]">
            <Radar size={12} /> KEŞİF / YETENEK HARİTASI
          </span>
          <span className="flex items-center gap-1 rounded border border-[var(--oem-good)] bg-[var(--oem-good-soft)] px-1.5 py-0.5 text-[var(--oem-good)]">
            <ShieldCheck size={11} /> SALT OKUNUR — keşif başlatmaz
          </span>
          <button
            type="button"
            data-testid="disc-refresh"
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
          Bu ekran keşif TURU BAŞLATMAZ, PDU göndermez, oturum açmaz, bütçe
          değiştirmez. Yalnız mevcut defteri okur. Yoklama yapılmadıysa sayaç
          <b> 0 değil KAYNAK YOK</b> gösterir — "sorduk ve bulamadık" ile
          "hiç sormadık" aynı şey değildir.
        </p>
      </div>

      <div
        data-testid="disc-verdict"
        data-verdict={verdict.status}
        title={verdict.status}
        className={`shrink-0 rounded border px-3 py-2 font-mono text-[11px] ${VERDICT_STYLE[verdict.status]}`}
      >
        KEŞİF GERÇEĞİ: {DISCOVERY_VERDICT_LABEL[verdict.status]}
        <ul className="mt-1 list-inside list-disc space-y-0.5 text-[10px] leading-relaxed opacity-80">
          {verdict.reasons.map((r, i) => <li key={i}>{r}</li>)}
        </ul>
        <div className="mt-1 text-[9px] opacity-50">
          NRC 0x11 DIŞINDA hiçbir negatif yanıt "servis yok" sayılmaz; köprünün
          taşıyamaması ARACIN sınırı değildir.
        </div>
      </div>

      {cards.map((card) => (
        <div
          key={card.id}
          data-testid={`disc-card-${card.id}`}
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
        KAPSAM SINIRI (dürüstlük): keşif YALNIZ CDDL'de TANIMLI salt-okunur
        servisleri yoklar — kör <code>00..FF</code> servis ya da alt fonksiyon
        taraması YOKTUR. Destructive servisler korpusa GİREMEZ (F4-A native
        kapısı ayrıca ve bağımsız olarak son sözü söyler). Bu faz FleetMemory
        yazmaz, öğrenme yapmaz, profil güveni YÜKSELTMEZ; defter süreç ömürlüdür
        ve diske yazılmaz. VariantPattern eşleşmesi bu fazda <b>otomatik güven
        yükseltmez</b>. Gerçek araç doğrulaması YAPILMADI — saha kütüğü tek
        otoritedir.
      </p>
    </div>
  );
});

export default DiscoveryCapabilityScreen;
