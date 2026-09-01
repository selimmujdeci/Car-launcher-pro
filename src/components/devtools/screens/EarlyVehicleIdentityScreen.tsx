/**
 * EarlyVehicleIdentityScreen — CAROS LAB · Araç · Erken Araç Kimliği.
 *
 * SALT-OKUNUR. Kimlik turu KOŞTURMAZ, ECU keşfi yapmaz, PDU göndermez, bağlam
 * AKTİVE ETMEZ, depoya yazmaz, timer kurmaz, ağa çıkmaz. Yalnız mevcut senkron
 * getter'ları okur.
 *
 * ── EKRANIN TEK İDDİASI ─────────────────────────────────────────────────────
 * "Tam araç taramasından ÖNCE bu araç TANINDI MI, KANITI NE, ve o kimlik
 *  hangi kalıcı bölümü açtı."
 * KAYNAK YOK ≠ DENENMEDİ ≠ BAŞARISIZ ≠ BAŞARILI — dördü ayrı gösterilir.
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw, ShieldCheck, Fingerprint } from 'lucide-react';
import {
  readEarlyIdentitySnapshot,
  type EarlyIdentityRawSnapshot,
} from '../../../platform/devtools/earlyIdentitySources';
import {
  buildEarlyIdentityCards, countByEarlyIdentityClass, deriveEarlyIdentityVerdict,
  EARLY_IDENTITY_VERDICT_LABEL, type EarlyIdentityVerdict,
} from '../../../platform/devtools/earlyIdentityLabModel';
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

const VERDICT_STYLE: Record<EarlyIdentityVerdict, string> = {
  NEVER_EVALUATED: 'border-[var(--oem-line-strong)] bg-[var(--oem-surface-2)] text-[var(--oem-ink-2)]',
  BLOCKED:         'border-[var(--oem-line-strong)] bg-[var(--oem-surface-2)] text-[var(--oem-ink-2)]',
  DEFERRED:        'border-[var(--oem-info)] bg-[var(--oem-info-soft)] text-[var(--oem-info)]',
  UNAVAILABLE:     'border-[var(--oem-warn)] bg-[var(--oem-warn-soft)] text-[var(--oem-warn)]',
  WEAK:            'border-[var(--oem-warn)] bg-[var(--oem-warn-soft)] text-[var(--oem-warn)]',
  CONFLICT:        'border-[var(--oem-danger)] bg-[var(--oem-danger-soft)] text-[var(--oem-danger)]',
  IDENTIFIED:      'border-[var(--oem-good)] bg-[var(--oem-good-soft)] text-[var(--oem-good)]',
};

const FieldRow = memo(function FieldRow(
  { field, nowMs }: { field: InspectorField; nowMs: number },
) {
  const age = formatAge(field.updatedAt, nowMs);
  return (
    <div
      data-testid={`early-id-field-${field.id}`}
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

export const EarlyVehicleIdentityScreen = memo(function EarlyVehicleIdentityScreen() {
  // Açılışta TEK okuma. TIMER YOK, ABONELİK YOK, POLLING YOK.
  const [snap, setSnap] = useState<EarlyIdentityRawSnapshot>(
    () => readEarlyIdentitySnapshot());

  /* Unmount sonrası setState YASAK (zero-leak). */
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const refresh = useCallback(() => {
    if (mountedRef.current) setSnap(readEarlyIdentitySnapshot());
  }, []);

  const cards = useMemo(() => buildEarlyIdentityCards(snap), [snap]);
  const verdict = useMemo(() => deriveEarlyIdentityVerdict(snap), [snap]);
  const counts = useMemo(() => countByEarlyIdentityClass(cards), [cards]);

  return (
    <div className="flex h-full flex-col gap-2 overflow-y-auto" data-testid="early-vehicle-identity">
      <div className="shrink-0 rounded border border-[var(--oem-line)] bg-[var(--oem-surface-1)] px-3 py-2">
        <div className="flex flex-wrap items-center gap-2 font-mono text-[10px]">
          <span className="flex items-center gap-1 text-[11px] font-bold tracking-wide text-[var(--oem-info)]">
            <Fingerprint size={12} /> ERKEN ARAÇ KİMLİĞİ
          </span>
          <span className="flex items-center gap-1 rounded border border-[var(--oem-good)] bg-[var(--oem-good-soft)] px-1.5 py-0.5 text-[var(--oem-good)]">
            <ShieldCheck size={11} /> SALT OKUNUR — ölçüm tetiklemez
          </span>
          <button
            type="button"
            data-testid="early-id-refresh"
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
          Bu ekran kimlik turu KOŞTURMAZ, ECU keşfi yapmaz, PDU göndermez, araç
          bağlamı AKTİVE ETMEZ. <b>KAYNAK YOK ≠ DENENMEDİ ≠ BAŞARISIZ ≠ BAŞARILI</b> —
          dördü ayrı gösterilir.
        </p>
      </div>

      <div
        data-testid="early-id-verdict"
        data-verdict={verdict.status}
        title={verdict.status}
        className={`shrink-0 rounded border px-3 py-2 font-mono text-[11px] ${VERDICT_STYLE[verdict.status]}`}
      >
        ERKEN KİMLİK GERÇEĞİ: {EARLY_IDENTITY_VERDICT_LABEL[verdict.status]}
        <ul className="mt-1 list-inside list-disc space-y-0.5 text-[10px] leading-relaxed opacity-80">
          {verdict.reasons.map((r, i) => <li key={i}>{r}</li>)}
        </ul>
        <div className="mt-1 text-[9px] opacity-50">
          Erken kimlik bir KULLANILABİLİRLİK KAPISI DEĞİLDİR: bu tur düşse bile
          normal OBD/PID akışı aynen çalışır.
        </div>
      </div>

      {cards.map((card) => (
        <div
          key={card.id}
          data-testid={`early-id-card-${card.id}`}
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
        KAPSAM SINIRI (dürüstlük): erken kimlik YALNIZ CAN/UDS (0x22) yolunda
        ölçülür — KWP/ISO kimlik LID tanımı bu repoda YOKTUR ve uydurulmaz, o
        araçlarda tur ENGELLİ biter. En çok ÜÇ salt-okunur istek gönderilir;
        10 xx oturum komutu, 3E keepalive ve SecurityAccess YOKTUR. Ham
        kalibrasyon/seri/VIN değeri hiçbir kalıcı yüzeye (bölüm · katalog ·
        sicil · iz export) YAZILMAZ — yalnız geri döndürülemez karma taşınır.
        Erken kimlikle tam tarama kimliği YAPISAL OLARAK farklı ID üretir;
        birleştirme yalnız aynı ECU üzerinde aynı DID aynı karmayı verdiğinde
        yapılır, çelişkide kalıcılık DONDURULUR. Gerçek araç doğrulaması
        YAPILMADI — saha kütüğü tek otoritedir.
      </p>
    </div>
  );
});

export default EarlyVehicleIdentityScreen;
