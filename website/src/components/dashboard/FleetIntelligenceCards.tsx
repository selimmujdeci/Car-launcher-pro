'use client';

/**
 * FleetIntelligenceCards — Fleet Dashboard · FİLO ZEKÂSI KARTLARI.
 *
 * ── BU BİR ÖNERİ PANELİ DEĞİLDİR ──────────────────────────────────────
 * Cümle üretilmez, tavsiye verilmez, uyarı metni yazılmaz. Kartlar yalnız
 * kanıt sayılarını, kanıtlı değişimleri ve **bilinmeyenleri** gösterir.
 * Mavi ileride bu kanıtı kullanarak cümleyi KENDİSİ kuracaktır.
 *
 * ── DÜRÜSTLÜK KURALLARI ───────────────────────────────────────────────
 *   · Kanıt yoksa BOŞ PANO değil, GEREKÇE gösterilir.
 *   · Bilinmeyen değer `—` gösterilir, **`0` değil**.
 *   · "Bilinmeyenler" kartı GİZLENMEZ — dürüstlüğün ana göstergesi.
 *   · Tek araçtan gelen içgörü "filo iddiası değil" olarak işaretlenir.
 */

import {
  buildFleetIntelligenceView, fleetIntelligenceAbsenceExplanation,
  type FleetIntelligenceRow, type FleetCard,
} from '@/lib/fleet/fleetIntelligenceView';

export interface FleetIntelligenceCardsProps {
  /** `get_fleet_intelligence()` satırı; yoksa `null`. */
  readonly row: FleetIntelligenceRow | null;
  /** Dış saat — bileşen saf kalsın diye parametre (test edilebilirlik). */
  readonly nowMs?: number;
}

function valueText(c: FleetCard): string {
  if (c.value === null) return '—';
  if (c.unit === 'PERCENT') return `%${c.value}`;
  if (c.unit === 'DAYS') return `${c.value} gün`;
  return String(c.value);
}

export function FleetIntelligenceCards({ row, nowMs }: FleetIntelligenceCardsProps) {
  const v = buildFleetIntelligenceView(row, nowMs ?? Date.now());

  if (!v.present) {
    return (
      <section
        data-testid="fleet-intelligence-absent"
        className="rounded-xl border border-neutral-800 bg-neutral-900/60 p-4"
      >
        <h3 className="mb-1 text-sm font-semibold text-neutral-100">Filo Zekâsı</h3>
        <p className="text-[12px] text-neutral-400">
          {fleetIntelligenceAbsenceExplanation(v)}
        </p>
        {v.vehiclesTotal !== null && (
          <p className="mt-1 text-[11px] text-neutral-500">
            {v.vehiclesReporting ?? 0}/{v.vehiclesTotal} araç veri gönderiyor
          </p>
        )}
      </section>
    );
  }

  return (
    <section data-testid="fleet-intelligence-cards" className="flex flex-col gap-2">
      <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
        {v.cards.map((c) => (
          <div
            key={c.key}
            data-testid={`fleet-card-${c.key}`}
            data-known={c.known ? 'true' : 'false'}
            className="rounded-xl border border-neutral-800 bg-neutral-900/60 p-3"
          >
            <div className="text-[11px] text-neutral-500">{c.label}</div>
            <div className="font-mono text-lg text-neutral-100">{valueText(c)}</div>
            <div className="text-[11px] text-neutral-500">{c.detail}</div>
          </div>
        ))}
      </div>

      <p className="text-[10px] leading-relaxed text-neutral-600">
        Bu kartlar bir <strong>öneri değildir</strong>: burada tahmin, tavsiye
        veya yorum yoktur — yalnız kanıt sayıları ve kanıtlı değişimler.
        Bilinmeyen değer <strong>boş bırakılır</strong> (<code>0</code> değil).
        Tek araçtan gelen içgörü <strong>filo iddiası sayılmaz</strong>. Düşük
        veri kapsamı &quot;filo kötü&quot; değil,
        <strong> &quot;bilmiyoruz&quot;</strong> demektir.
      </p>
    </section>
  );
}

export default FleetIntelligenceCards;
