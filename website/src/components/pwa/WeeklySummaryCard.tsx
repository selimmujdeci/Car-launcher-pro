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
      className="md-card-elevated px-4 py-4"
      aria-label={`${summary.windowLabel} özeti`}
      data-testid="weekly-summary"
    >
      <p className="md-label-m md-on-surface-variant">{summary.windowLabel}</p>

      {summary.headline && (
        <p className="mt-1 md-title-m md-on-surface">{summary.headline}</p>
      )}

      {!compact && summary.facts.length > 0 && (
        <dl className="mt-3 grid grid-cols-2 gap-2">
          {summary.facts.map((f) => (
            <div
              key={f.id}
              className="px-3 py-2.5 flex flex-col gap-0.5"
              style={{ background: 'var(--md-surface-container-high)', borderRadius: 'var(--md-shape-md)' }}
            >
              <dt className="md-label-m md-on-surface-variant">{f.label}</dt>
              <dd className="md-title-m md-on-surface tabular-nums">{f.value}</dd>
              {/* Sayının kapsamadığı şey SESSİZ GEÇİLMEZ. */}
              {f.detail && <dd className="md-body-s md-on-surface-variant">{f.detail}</dd>}
            </div>
          ))}
        </dl>
      )}

      {/* Okunamayan kaynak "kayıt yok" DEĞİLDİR. */}
      {summary.unreadableSources.length > 0 && (
        <p className="mt-2 md-body-s md-on-surface-variant">
          Şu kaynaklar okunamadı: {summary.unreadableSources.join(', ')}
        </p>
      )}
    </section>
  );
}

export const WeeklySummaryCard = memo(WeeklySummaryCardBase);
export default WeeklySummaryCard;
