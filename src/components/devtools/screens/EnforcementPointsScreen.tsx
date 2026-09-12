/**
 * EnforcementPointsScreen — CAROS LAB · Araç · Denetim Noktası Verisi.
 *
 * SALT-OKUNUR. Paket İNDİRMEZ/YENİLEMEZ, Guardian tick'ini TETİKLEMEZ, eşik
 * DEĞİŞTİRMEZ, konum düzeltmesi İSTEMEZ, ağa ÇIKMAZ.
 *
 * ZAMANLAYICI YOK: açılışta tek okuma + elle YENİLE (repodaki LAB deseni).
 *
 * GİZLİLİK: aracın konumu, noktaların koordinatları ve kaynağın serbest metin
 * etiketleri bu ekrana GELMEZ — yalnız sayılar, durumlar ve skaler mesafe.
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw, ShieldCheck, MapPin, AlertTriangle } from 'lucide-react';
import {
  readEnforcementPointsSnapshot, type EnforcementPointsRawSnapshot,
} from '../../../platform/devtools/enforcementPointsSources';
import {
  buildEnforcementCards, countByEnforcementClass, deriveEnforcementVerdict,
  ENFORCEMENT_VERDICT_LABEL, type EnforcementVerdict,
} from '../../../platform/devtools/enforcementPointsModel';
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

const VERDICT_STYLE: Record<EnforcementVerdict, string> = {
  NO_PACKAGE:     'border-[var(--oem-danger)] bg-[var(--oem-danger-soft)] text-[var(--oem-danger)]',
  NEVER_QUERIED:  'border-[var(--oem-line-strong)] bg-[var(--oem-surface-2)] text-[var(--oem-ink-2)]',
  POSITION_BLIND: 'border-[var(--oem-warn)] bg-[var(--oem-warn-soft)] text-[var(--oem-warn)]',
  HEADING_BLIND:  'border-[var(--oem-info)] bg-[var(--oem-info-soft)] text-[var(--oem-info)]',
  NO_POINTS_NEAR: 'border-[var(--oem-info)] bg-[var(--oem-info-soft)] text-[var(--oem-info)]',
  EMITTING:       'border-[var(--oem-good)] bg-[var(--oem-good-soft)] text-[var(--oem-good)]',
};

const FieldRow = memo(function FieldRow({ field, nowMs }: { field: InspectorField; nowMs: number }) {
  const age = formatAge(field.updatedAt, nowMs);
  return (
    <div
      data-testid={`ep-field-${field.id}`}
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

export const EnforcementPointsScreen = memo(function EnforcementPointsScreen() {
  // Açılışta TEK okuma. TIMER YOK, ABONELİK YOK, POLLING YOK.
  const [snap, setSnap] = useState<EnforcementPointsRawSnapshot>(() => readEnforcementPointsSnapshot());

  /* Unmount sonrası setState YASAK (zero-leak). */
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const refresh = useCallback(() => {
    if (mountedRef.current) setSnap(readEnforcementPointsSnapshot());
  }, []);

  const cards       = useMemo(() => buildEnforcementCards(snap), [snap]);
  const verdict     = useMemo(() => deriveEnforcementVerdict(snap), [snap]);
  const classCounts = useMemo(() => countByEnforcementClass(cards), [cards]);

  return (
    <div className="flex h-full flex-col gap-2 overflow-y-auto" data-testid="enforcement-points">
      {/* Salt-okunur beyanı */}
      <div className="shrink-0 rounded border border-[var(--oem-line)] bg-[var(--oem-surface-1)] px-3 py-2">
        <div className="flex flex-wrap items-center gap-2 font-mono text-[10px]">
          <span className="flex items-center gap-1 text-[11px] font-bold tracking-wide text-[var(--oem-info)]">
            <MapPin size={12} /> DENETİM NOKTASI VERİSİ
          </span>
          <span className="flex items-center gap-1 rounded border border-[var(--oem-good)] bg-[var(--oem-good-soft)] px-1.5 py-0.5 text-[var(--oem-good)]">
            <ShieldCheck size={11} /> SALT OKUNUR — paket indirmez
          </span>
          <button
            type="button"
            data-testid="ep-refresh"
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
          Yalnız mevcut senkron getter okunur: paket İNDİRİLMEZ/YENİLENMEZ, Guardian
          tick'i TETİKLENMEZ, eşik/severity DEĞİŞTİRİLMEZ, konum düzeltmesi
          İSTENMEZ, ağ çağrısı YAPILMAZ. Cihaz kaynağa (EGM) hiçbir zaman doğrudan
          bağlanmaz — okunan şey uygulamaya gömülü pakettir.
        </p>
      </div>

      {/* Hüküm — fail-closed */}
      <div
        data-testid="ep-verdict"
        data-verdict={verdict.status}
        title={verdict.status}
        className={`shrink-0 rounded border px-3 py-2 font-mono text-[11px] ${VERDICT_STYLE[verdict.status]}`}
      >
        DENETİM NOKTASI GERÇEĞİ: {ENFORCEMENT_VERDICT_LABEL[verdict.status]}
        <ul className="mt-1 list-inside list-disc space-y-0.5 text-[10px] leading-relaxed opacity-80">
          {verdict.reasons.map((r, i) => <li key={i}>{r}</li>)}
        </ul>
        <div className="mt-1 text-[9px] opacity-50">
          "Uyarı çıkmıyor" ile "yolda denetim yok" AYNI ŞEY DEĞİLDİR. Bu ekran
          ikisini ayırt etmek için vardır.
        </div>
      </div>

      {/* Kartlar */}
      {cards.map((card) => (
        <div
          key={card.id}
          data-testid={`ep-card-${card.id}`}
          className="shrink-0 rounded border border-[var(--oem-line)] bg-[var(--oem-surface-1)]"
        >
          <div className="flex flex-wrap items-center gap-2 border-b border-[var(--oem-line)] px-3 py-1.5">
            <span className="font-mono text-[11px] uppercase tracking-wide text-[var(--oem-info)]">
              {card.title}
            </span>
            {card.id === 'gates' && snap.gates.uncertainPosition > 0 && (
              <span className="flex items-center gap-1 rounded border border-[var(--oem-warn)] bg-[var(--oem-warn-soft)] px-1.5 py-0.5 font-mono text-[9px] text-[var(--oem-warn)]">
                <AlertTriangle size={10} /> #508 İZİ VAR
              </span>
            )}
          </div>
          <div>
            {card.fields.map((f) => <FieldRow key={f.id} field={f} nowMs={snap.readAt} />)}
          </div>
        </div>
      ))}

      <p className="shrink-0 pb-2 font-mono text-[9px] leading-relaxed text-[var(--oem-ink-3)]">
        KAPSAM SINIRI (dürüstlük): kaynağın kapsamı ÖLÇÜLDÜ ve <b>eksiktir</b> —
        Mersin ilinde 0 kayıt, Mersin merkez–Tarsus koridorunda üç bağımsız kaynakta
        da 0 kayıt vardır. <b>Mobil radar hiçbir statik kaynakta yoktur</b> ve bu
        özellik kapsamı dışındadır. Bu yüzden uyarı çıkmaması "yolda denetim yok"
        anlamına GELMEZ; ürün böyle bir vaat vermez. Tür bilgisi kayıtların
        %93'ünde yoktur → dil "denetim noktası"dır, "radar" değildir. Hız limiti
        kaynakta hiç yoktur → uyarı hız eşiği iddia etmez. Paket tazeleme
        politikası HENÜZ KARARLAŞTIRILMAMIŞTIR (ADR §6-D.3). Gerçek araç
        doğrulaması YAPILMADI — saha kütüğü tek otoritedir.
      </p>
    </div>
  );
});

export default EnforcementPointsScreen;
