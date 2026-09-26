'use client';

/**
 * HAFTALIK ÖZET KARTI — `buildWeeklySummary` projeksiyonunun TEK görünümü (F5).
 *
 * Burada eşik, sayma, tarih matematiği YOKTUR: hepsi projeksiyondadır. Kart
 * yalnız basar. Aynı bileşen iki yüzeyde kullanılır (Aracım ana ekranı ve
 * Araç Hafızası) — ikinci bir özet dili doğmasın diye.
 *
 * Yüzey hangi kaynakları OKUDUYSA yalnız onlar görünür: okunmamış kaynak için
 * "0" BASILMAZ (projeksiyon zaten `uncoveredSources`ta tutar).
 */

import { memo } from 'react';
import type { WeeklySummary } from '@/lib/home/weeklySummary';

function WeeklySummaryCardBase({
  summary, compact = false,
}: { summary: WeeklySummary; compact?: boolean }) {
  return (
    <section
      className="rounded-2xl px-4 py-3.5"
      style={{ background: 'var(--pwa-surface-3)', border: '1px solid var(--pwa-border-soft)' }}
      aria-label={`${summary.windowLabel} özeti`}
      data-testid="weekly-summary"
    >
      <p className="text-[9px] font-black uppercase tracking-widest pwa-text-3">
        {summary.windowLabel}
      </p>

      {summary.headline && (
        <p className="mt-1 text-[13px] font-bold pwa-text leading-snug">{summary.headline}</p>
      )}

      {!compact && summary.facts.length > 0 && (
        <dl className="mt-3 grid grid-cols-3 gap-2">
          {summary.facts.map((f) => (
            <div
              key={f.id}
              className="px-2.5 py-2 rounded-xl flex flex-col gap-0.5"
              style={{ background: 'rgba(0,0,0,0.18)', border: '1px solid var(--pwa-border-soft)' }}
            >
              <dt className="text-[9px] font-black uppercase tracking-wider pwa-text-3">
                {f.label}
              </dt>
              <dd className="text-[13px] font-bold tabular-nums pwa-text">{f.value}</dd>
              {/* Sayının kapsamadığı şey SESSİZ GEÇİLMEZ. */}
              {f.detail && <dd className="text-[10px] leading-snug pwa-text-3">{f.detail}</dd>}
            </div>
          ))}
        </dl>
      )}

      {/* Okunamayan kaynak "kayıt yok" DEĞİLDİR. */}
      {summary.unreadableSources.length > 0 && (
        <p className="mt-2 text-[10px] pwa-text-3 leading-snug">
          Şu kaynaklar okunamadı: {summary.unreadableSources.join(', ')}
        </p>
      )}
    </section>
  );
}

export const WeeklySummaryCard = memo(WeeklySummaryCardBase);
export default WeeklySummaryCard;
