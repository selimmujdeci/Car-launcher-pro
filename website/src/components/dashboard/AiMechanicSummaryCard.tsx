'use client';

/**
 * AiMechanicSummaryCard — Fleet Dashboard · AI MECHANIC ÖZETİ (SALT-OKUNUR).
 *
 * ── BU BİR SERVİS/TAMİR PANELİ DEĞİLDİR ────────────────────────────────
 * Öneri · tamir tavsiyesi · parça · maliyet YOKTUR (P1 yalnız TEŞHİS).
 *
 * ── AI MECHANIC KARAR ÜRETMEZ ──────────────────────────────────────────
 * Kartlar, MAVI Reasoning Engine kararlarından sunucuda TÜRETİLEN sayıları
 * gösterir. LLM yok, yeni karar/güven/kanıt yok.
 *
 * Aktif komut YOK: analiz tetiklenmez, karar ilerletilmez, hiçbir şey yazılmaz.
 */

import {
  buildMechanicView,
  type AiMechanicSummaryRow, type MechanicCard, type MechanicCardTone,
} from '@/lib/fleet/aiMechanicView';

export interface AiMechanicSummaryCardProps {
  /** `get_ai_mechanic_summary()` satırı; yoksa `null` (okunamadı). */
  readonly summary: AiMechanicSummaryRow | null;
}

function valueText(c: MechanicCard): string {
  if (c.value === null) return '—';                 // ÖLÇÜLMEDİ — 0 DEĞİL
  return c.unit === 'PERCENT' ? `%${c.value}` : String(c.value);
}

const TONE_CLASS: Record<MechanicCardTone, string> = {
  NEUTRAL: 'border-white/10 bg-white/5 text-white',
  GOOD:    'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
  WARN:    'border-amber-500/30 bg-amber-500/10 text-amber-300',
  BAD:     'border-red-500/30 bg-red-500/10 text-red-300',
};

export function AiMechanicSummaryCard({ summary }: AiMechanicSummaryCardProps) {
  const view = buildMechanicView(summary);

  return (
    <section className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-white">AI Mechanic</h3>
        <span className="text-[11px] text-white/40">
          Salt-okunur teşhis · karar üretmez · öneri yok
        </span>
      </div>

      {view.absence && (
        <p className="mb-3 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-[11px] leading-relaxed text-amber-200/80">
          {view.absence}
        </p>
      )}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {view.cards.map((c) => (
          <div key={c.id} className={`rounded-lg border px-3 py-2 ${TONE_CLASS[c.tone]}`}>
            <div className="text-[10px] uppercase tracking-wide opacity-60">{c.label}</div>
            <div className="mt-0.5 font-mono text-lg font-semibold">{valueText(c)}</div>
            <div className="mt-1 text-[10px] leading-snug opacity-50">{c.detail}</div>
          </div>
        ))}
      </div>

      <div className="mt-3">
        <div className="mb-1 text-[10px] uppercase tracking-wide text-white/40">
          Kategori dağılımı
        </div>
        <div className="flex flex-wrap gap-1.5">
          {view.categories.map((k) => (
            <span
              key={k.label}
              className={`rounded border px-2 py-0.5 text-[11px] ${
                k.count > 0
                  ? 'border-sky-500/30 bg-sky-500/10 text-sky-300'
                  : 'border-white/10 bg-white/5 text-white/40'
              }`}
            >
              {k.label} {k.count}
            </span>
          ))}
        </div>
      </div>

      <p className="mt-3 text-[10px] leading-relaxed text-white/35">
        Her satır MAVI Reasoning Engine kararının yorumudur; güven MAVI tarafından
        türetilir ve burada yeniden hesaplanmaz. Çelişki bir arıza kanıtı değil bilgi
        eksikliğidir. Bu kart hiçbir işlem tetiklemez.
      </p>
    </section>
  );
}
