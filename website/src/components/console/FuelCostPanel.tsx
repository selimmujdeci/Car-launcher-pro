'use client';

/**
 * YAKIT MALİYET PANELİ (V-16/5).
 *
 * SALT-OKUNUR ve SAF: kendi verisini çekmez, saat okumaz, timer kurmaz.
 * Satırlar dışarıdan gelir; hesap `fuelCostModel` içindedir.
 *
 * ── NEDEN ROZET ZORUNLU ─────────────────────────────────────────────────────
 * Prod ölçümü (2026-08-22): yakıt **ölçülmüyor** (`ESTIMATED`) ve yakıt fiyatı
 * **hiç girilmemiş** (`DEFAULT_FALLBACK`). Tutarı sade bir "₺" olarak
 * göstermek, ölçülmemiş bir sayıyı ölçülmüş gibi sunmak olurdu. Bu yüzden:
 *  · her toplamın yanında KANIT GÜCÜ rozeti,
 *  · altında ne yapılması gerektiğini söyleyen bir cümle bulunur.
 *
 * Üç ayrı "yok" (okunamadı · yolculuk yok · maliyet üretilemez) AYRI görünür.
 */

import { memo, useMemo } from 'react';
import {
  summarizeFuelCost, costDisclaimer,
  QUALITY_LABEL, COST_VERDICT_LABEL,
  type TripCostRow, type CostQuality,
} from '@/lib/console/fuelCostModel';

const QUALITY_STYLE: Record<CostQuality, string> = {
  MEASURED:       'border-emerald-400/30 text-emerald-300/90',
  ESTIMATED:      'border-amber-400/30 text-amber-300/90',
  FALLBACK_PRICE: 'border-orange-400/35 text-orange-300/90',
  UNKNOWN:        'border-hair text-t3',
};

/** `null` → "—". Sahte 0 YAZILMAZ. */
function tr(v: number | null, digits = 2): string {
  if (v === null || !Number.isFinite(v)) return '—';
  return v.toFixed(digits).replace('.', ',');
}

interface Props {
  /** `null` = OKUNAMADI — "yolculuk yok" ile KARIŞTIRILMAZ. */
  readonly rows: readonly TripCostRow[] | null;
}

export default memo(function FuelCostPanel({ rows }: Props) {
  const s = useMemo(() => summarizeFuelCost(rows), [rows]);
  const note = useMemo(() => costDisclaimer(s), [s]);

  return (
    <div
      data-testid="fuel-cost-panel"
      data-verdict={s.verdict}
      data-quality={s.quality}
      className="p-4 rounded-sm bg-bezel border border-hair flex flex-col gap-2"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-t3">Yakıt maliyeti</span>
        <span className="text-[11px] text-t2">{COST_VERDICT_LABEL[s.verdict]}</span>
      </div>

      {s.verdict === 'OK' && (
        <>
          <div className="flex items-center gap-2">
            <span className="cn-num text-[18px] text-t1">{tr(s.cost)} TL</span>
            <span
              data-testid="fuel-cost-quality"
              className={`text-[9px] uppercase tracking-[0.14em] px-1.5 py-0.5 border ${QUALITY_STYLE[s.quality]}`}
              style={{ borderRadius: 2 }}
            >
              {QUALITY_LABEL[s.quality]}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
            <span className="text-t3">Mesafe</span>
            <span className="cn-num text-t2 text-right">{tr(s.distanceKm, 1)} km</span>

            <span className="text-t3">Yakıt</span>
            <span className="cn-num text-t2 text-right">{tr(s.litres)} L</span>

            <span className="text-t3">100 km başına</span>
            <span className="cn-num text-t2 text-right">{tr(s.costPer100Km)} TL</span>

            <span className="text-t3">100 km tüketim</span>
            <span className="cn-num text-t2 text-right">{tr(s.litresPer100Km)} L</span>

            <span className="text-t3">Hesaba giren yolculuk</span>
            <span className="cn-num text-t2 text-right">
              {s.costedTripCount} / {s.tripCount}
            </span>
          </div>
        </>
      )}

      {/* Dürüstlük cümlesi HER durumda görünür — rozet kaçırılsa bile bu okunur. */}
      <p className="text-[10px] leading-relaxed text-t3">{note}</p>
    </div>
  );
});
