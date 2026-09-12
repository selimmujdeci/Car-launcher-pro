/**
 * CostProvider arayüzü — Faz A saf sözleşme — TRIP-COST-A1.
 *
 * `tripRecommendationEngine.resolveSignal` sözleşmesinin genelleştirilmişi:
 * her provider SAF bir fonksiyondur, `TripPlan`i ve ortak bağlamı okur,
 * bir veya birden fazla `CostItem` üretir. Ağ/servis/OBD/store DOKUNMAZ —
 * gerçek veri kaynağına bağlanmak wiring katmanının (Faz A'da YOK) işidir.
 */
import type { TripPlan, CostItem } from '../models';

/** Tüm provider'ların paylaştığı ortak, minimal bağlam. Faz A'da yalnız
 *  raporun toplanacağı para birimini taşır — servis/store referansı YOK. */
export interface CostProviderContext {
  reportCurrency: string;
}

/**
 * SAF maliyet sağlayıcısı: `(plan, ctx) → CostItem | CostItem[]`.
 * Provider içeride throw EDEBİLİR — CostEngine bunu yakalayıp o provider
 * için bounded `unknown` kaleme çevirir (bkz. costEngine.ts); rapor bütünü
 * ÇÖKMEZ. Provider FONKSİYON ADI (`Function.name`) hata teşhisinde kullanılır
 * — isimsiz/anonim fonksiyon geçirmek yerine `function fuelProvider(...) {}`
 * gibi isimli fonksiyon/const kullanmak önerilir.
 */
export type CostProvider = (plan: TripPlan, ctx: CostProviderContext) => CostItem | CostItem[];
