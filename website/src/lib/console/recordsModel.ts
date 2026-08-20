/**
 * KAYIT MODELİ — yakıt ve servis özeti (#662).
 *
 * Saf: I/O YOK, global durum YOK. "Şimdi" DAİMA parametredir.
 *
 * KURAL: bilinmeyen ölçüm toplama GİRMEZ ve kaç kaydın eksik olduğu AYRICA
 * taşınır. `null` değerleri `0` sayıp ortalama hesaplamak, filo maliyetini
 * sessizce yanlış gösterir.
 */

import type { FuelLogRow, ServiceRow } from './consoleSources';

export interface FuelSummary {
  readonly entries: number;
  readonly totalLiters: number | null;
  readonly totalCost: number | null;
  /** Litre başı ortalama fiyat; hesaplanamıyorsa `null`. */
  readonly avgPricePerL: number | null;
  /** Litre/maliyet bilgisi eksik kayıt sayısı — toplamın kapsamı görünür olsun. */
  readonly missingLiters: number;
  readonly missingPrice: number;
}

export function summarizeFuel(rows: readonly FuelLogRow[]): FuelSummary {
  let totalLiters = 0;
  let litersCount = 0;
  let totalCost = 0;
  let costCount = 0;
  let missingLiters = 0;
  let missingPrice = 0;

  for (const row of rows) {
    if (row.liters === null) { missingLiters += 1; } else { totalLiters += row.liters; litersCount += 1; }
    if (row.liters !== null && row.pricePerL !== null) {
      totalCost += row.liters * row.pricePerL;
      costCount += 1;
    } else {
      missingPrice += 1;
    }
  }

  return {
    entries: rows.length,
    totalLiters: litersCount > 0 ? totalLiters : null,
    totalCost: costCount > 0 ? totalCost : null,
    avgPricePerL: costCount > 0 && totalLiters > 0 ? totalCost / totalLiters : null,
    missingLiters,
    missingPrice,
  };
}

export interface ServiceSummary {
  readonly entries: number;
  readonly totalCost: number | null;
  readonly missingCost: number;
  /** Bakım tarihi yaklaşan/geçmiş kayıtlar. */
  readonly dueSoon: readonly ServiceRow[];
  readonly overdue: readonly ServiceRow[];
}

export const DUE_SOON_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

export function summarizeService(rows: readonly ServiceRow[], now: number): ServiceSummary {
  let totalCost = 0;
  let costCount = 0;
  let missingCost = 0;
  const dueSoon: ServiceRow[] = [];
  const overdue: ServiceRow[] = [];

  for (const row of rows) {
    if (row.cost === null) missingCost += 1;
    else { totalCost += row.cost; costCount += 1; }

    if (row.nextDueOn) {
      const due = new Date(row.nextDueOn).getTime();
      if (!Number.isFinite(due)) continue;
      if (due < now) overdue.push(row);
      else if (due - now <= DUE_SOON_WINDOW_MS) dueSoon.push(row);
    }
  }

  return {
    entries: rows.length,
    totalCost: costCount > 0 ? totalCost : null,
    missingCost,
    dueSoon,
    overdue,
  };
}

/** Tarih metni — geçersizse boş (uydurma tarih YOK). */
export function trDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const ms = new Date(iso).getTime();
  if (!Number.isFinite(ms)) return '';
  const d = new Date(ms);
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
}
