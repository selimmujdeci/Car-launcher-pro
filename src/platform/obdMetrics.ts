/**
 * ISO 15031-5 §6.3: Fuel Tank Level (PID 0x2F) → litres + estimated range.
 * Pure — no localStorage, no store access.
 *
 * @param fuelPct  Yakıt yüzdesi (0–100); negatif → -1 döner
 * @param tankL    Depo kapasitesi litre; 0 veya negatif → -1 döner
 * @param avgL100  Ortalama tüketim L/100 km; 0 → menzil hesaplanamaz (-1)
 */
export function computeFuelMetrics(
  fuelPct: number,
  tankL: number,
  avgL100: number,
): { fuelRemainingL: number; estimatedRangeKm: number } {
  if (fuelPct < 0 || tankL <= 0) return { fuelRemainingL: -1, estimatedRangeKm: -1 };
  const fuelRemainingL   = (fuelPct / 100) * tankL;
  const estimatedRangeKm = avgL100 > 0.01
    ? Math.round((fuelRemainingL / avgL100) * 100)
    : -1;
  return { fuelRemainingL: Math.round(fuelRemainingL * 10) / 10, estimatedRangeKm };
}
