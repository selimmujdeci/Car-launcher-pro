'use client';

/**
 * EvidenceCoverageCards — Fleet Dashboard · KANIT KARTLARI.
 *
 * ── BU BİR AI PANELİ DEĞİLDİR ─────────────────────────────────────────
 * Cevap/öneri/cümle üretilmez. Kartlar yalnız kanıtın kapsamını, kalitesini
 * ve **eksiklerini** gösterir.
 *
 * ── DÜRÜSTLÜK KURALLARI ───────────────────────────────────────────────
 *   · Kanıt yoksa BOŞ KART değil, GEREKÇE gösterilir.
 *   · Bilinmeyen değer `—` gösterilir, **`0` değil**.
 *   · Süresi dolmuş kanıt GİZLENMEZ (silinmediği yazılır).
 *   · Bütünlük bozuksa AÇIKÇA görünür.
 */

import {
  buildEvidenceCoverageView, evidenceAbsenceExplanation,
  type EvidenceCoverageRow, type EvidenceCard,
} from '@/lib/fleet/evidenceCoverageView';

export interface EvidenceCoverageCardsProps {
  /** `get_evidence_coverage()` satırı; yoksa `null`. */
  readonly row: EvidenceCoverageRow | null;
}

function valueText(c: EvidenceCard): string {
  if (c.value === null) return '—';
  return c.unit === 'PERCENT' ? `%${c.value}` : String(c.value);
}

export function EvidenceCoverageCards({ row }: EvidenceCoverageCardsProps) {
  const v = buildEvidenceCoverageView(row);

  if (!v.present) {
    return (
      <section
        data-testid="evidence-coverage-absent"
        className="rounded-xl border border-neutral-800 bg-neutral-900/60 p-4"
      >
        <h3 className="mb-1 text-sm font-semibold text-neutral-100">Kanıt Kapsamı</h3>
        <p className="text-[12px] text-neutral-400">{evidenceAbsenceExplanation(v)}</p>
        {v.missingVehicleCount !== null && (
          <p className="mt-1 text-[11px] text-neutral-500">
            {v.missingVehicleCount} aracın hiç kanıtı yok
          </p>
        )}
      </section>
    );
  }

  return (
    <section data-testid="evidence-coverage-cards" className="flex flex-col gap-2">
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        {v.cards.map((c) => (
          <div
            key={c.key}
            data-testid={`evidence-card-${c.key}`}
            data-known={c.known ? 'true' : 'false'}
            className="rounded-xl border border-neutral-800 bg-neutral-900/60 p-3"
          >
            <div className="text-[11px] text-neutral-500">{c.label}</div>
            <div className="font-mono text-lg text-neutral-100">{valueText(c)}</div>
            <div className="text-[11px] text-neutral-500">{c.detail}</div>
          </div>
        ))}
      </div>

      {/* Bütünlük bozuksa GİZLENMEZ. */}
      {v.integrityOk === false && (
        <p data-testid="evidence-integrity-broken" className="text-[11px] text-amber-500">
          Kanıt bütünlüğü bozuk: kaynağı veya güveni bilinmeyen aktif kanıt var.
        </p>
      )}

      <p className="text-[10px] leading-relaxed text-neutral-600">
        Bu kartlar bir <strong>öneri değildir</strong>: burada tahmin veya
        yorum yoktur — yalnız kanıtın kapsamı, kalitesi ve eksikleri.
        Bilinmeyen değer <strong>boş bırakılır</strong> (<code>0</code> değil):
        düşük kapsam &quot;filo kötü&quot; değil,{' '}
        <strong>&quot;bilmiyoruz&quot;</strong> demektir. Süresi dolan kanıt{' '}
        <strong>silinmez</strong> — geçmişte söylenmiş bir şeyin dayanağı
        kaybolursa o iddia açıklanamaz hâle gelir.
        {v.chainLinkCount !== null && (
          <span className="ml-1 text-neutral-700">
            ({v.chainLinkCount} kanıt bağı)
          </span>
        )}
      </p>
    </section>
  );
}

export default EvidenceCoverageCards;
