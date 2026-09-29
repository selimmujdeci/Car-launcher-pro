/**
 * routeFuelCost — rota önizlemesinde gösterilen "Yakıt ~1.370 TL" tutarı (SAF).
 *
 * İKİNCİ HESAP YOK: fiyat/tüketim seçimi `resolveFuelCategory`, tutar
 * `computeFuelCost` (Trip Cost yakıt sağlayıcısı) — LAB'daki yakıt kalemiyle
 * aynı zincir. Bu dosya yalnız mesafeyi bacağa çevirir ve gösterim için yuvarlar.
 *
 * GÖSTERİLMEZ (`null`): mesafe yok · fiyat verilemedi (EV, yakıt türü bilinmiyor,
 * tablo yok…) · yuvarlanmış tutar 0. "0 TL" ya da uydurma tutar YAZILMAZ.
 *
 * SAF: I/O YOK · `Date.now()` YOK (zaman çağırandan gelir).
 */
import { resolveFuelCategory, type FuelPricePack } from './fuelPricePack';
import { computeFuelCost } from './providers/fuelCostProvider';

/** Gösterim yuvarlaması (TL) — tahminde kuruş hassasiyeti sahte kesinliktir. */
export const ROUTE_FUEL_COST_ROUND_TO = 10;

export interface RouteFuelCostView {
  /** Yuvarlanmış tutar (> 0). */
  readonly amount:   number;
  readonly currency: string;
  /** Fiyat tazelik süresini aştı mı. */
  readonly stale:    boolean;
  /** Fiyatın gözlem gününden bu yana geçen gün. */
  readonly ageDays:  number | null;
}

export function computeRouteFuelCost(p: {
  distanceM:   number;
  vehicleType: string | null | undefined;
  pack:        FuelPricePack | null;
  nowMs:       number;
  currency?:   string;
}): RouteFuelCostView | null {
  if (!Number.isFinite(p.distanceM) || p.distanceM <= 0) return null;
  const currency = p.currency ?? 'TRY';
  const fuel = resolveFuelCategory({
    vehicleType: p.vehicleType, pack: p.pack, nowMs: p.nowMs, reportCurrency: currency,
  });
  if (fuel.input.pricePerLiter === undefined) return null;
  const item = computeFuelCost({
    legs:              [{ distanceKm: p.distanceM / 1000 }],
    consumptionL100Km: fuel.input.consumptionL100Km,
    pricePerLiter:     fuel.input.pricePerLiter,
    currency,
    source:            fuel.input.source,
    confidence:        fuel.input.confidence,
    stale:             fuel.input.stale,
  });
  if (item.value === null) return null;
  const amount = Math.round(item.value / ROUTE_FUEL_COST_ROUND_TO) * ROUTE_FUEL_COST_ROUND_TO;
  if (amount <= 0) return null;
  return { amount, currency, stale: item.status === 'stale', ageDays: fuel.ageDays };
}

/** "1370" → "1.370" (Türkçe binlik ayırıcı; eski WebView'da Intl'e güvenmez). */
function groupThousands(n: number): string {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

/** Etiket metni: "Yakıt ~1.370 TL · tahmini" / bayatsa "· fiyat 16 gün önce". */
export function formatRouteFuelCost(v: RouteFuelCostView): string {
  const unit = v.currency === 'TRY' ? 'TL' : v.currency;
  const tail = v.stale && v.ageDays !== null ? `fiyat ${v.ageDays} gün önce` : 'tahmini';
  return `Yakıt ~${groupThousands(v.amount)} ${unit} · ${tail}`;
}
