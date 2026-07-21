/**
 * CostEngine — Faz A saf orkestratör — TRIP-COST-A1.
 *
 * `TripPlan + CostProvider[] → CostReport`. Her provider'ı DETERMİNİSTİK
 * sırayla çağırır, kalemleri toplar, ConfidenceLedger'a devreder. Faz A'da
 * SYNC tutulur (tripRecommendationEngine deseniyle tutarlı — async provider
 * YOK); gerçek servis provider'ı EKLENMEDİ (yalnız DI ile alınan provider'lar
 * çalıştırılır).
 *
 * Provider İZOLASYONU (anayasa gereği — bkz. docs-local/TRIP_COST_AI_ARCHITECTURE.md §5):
 *   Bir provider throw ederse VEYA geçersiz `CostItem` üretirse (bkz.
 *   `normalizeCostItem`), TÜM rapor ÇÖKMEZ — yalnız O provider'ın kalemleri
 *   iptal edilir ve yerine tek bir bounded `unknown` kalem konur; diğer
 *   provider'lar normal çalışmaya devam eder.
 *
 * Saflık: girdi (`plan`, provider çıktıları) MUTASYONA UĞRATILMAZ; global
 * durum okunmaz/yazılmaz; ağ/store/EventBus/singleton YOK.
 */
import type { TripPlan, CostItem, CostReport } from './models';
import { normalizeCostItem } from './models';
import { buildCostReport } from './confidenceLedger';
import type { CostProvider, CostProviderContext } from './providers/types';

/**
 * `TripPlan`i verilen provider listesiyle değerlendirir → `CostReport`.
 *
 * @param plan            Değerlendirilecek yolculuk planı (mutasyona UĞRATILMAZ).
 * @param providers        Çalıştırılacak provider'lar — DETERMİNİSTİK sırayla
 *                          (dizi sırası == çağrı sırası == rapor öğe sırası).
 * @param reportCurrency   Raporun toplanacağı para birimi. Verilmezse `plan.currency`.
 */
export function runCostEngine(
  plan: TripPlan,
  providers: readonly CostProvider[],
  reportCurrency?: string,
): CostReport {
  const currency: string = reportCurrency ?? plan.currency;
  const ctx: CostProviderContext = { reportCurrency: currency };

  const items: CostItem[] = [];

  for (let i = 0; i < providers.length; i++) {
    const provider = providers[i];
    const label = provider.name || `provider_${i}`;

    try {
      const raw = provider(plan, ctx);
      const list = Array.isArray(raw) ? raw : [raw];
      // Savunma katmanı: provider'ın döndürdüğü her kalem yeniden doğrulanır.
      // Herhangi biri geçersizse (throw) — TÜM provider'ın katkısı iptal edilir
      // (aşağıdaki catch), kısmi/yarı-geçerli kalem SIZDIRILMAZ.
      const validated = list.map((it) => normalizeCostItem(it));
      items.push(...validated);
    } catch {
      items.push(
        normalizeCostItem({
          id:         `${label}-error`,
          category:   label,
          value:      null,
          currency,
          source:     'unknown',
          confidence: 0,
          editable:   false,
          status:     'unknown',
          noteKey:    'provider_error',
        }),
      );
    }
  }

  return buildCostReport(items, currency);
}
