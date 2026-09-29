/**
 * Rota mesafe eşikleri — BAĞIMLILIKSIZ yaprak modül.
 *
 * Neden ayrı dosya: `routingService` ↔ `navEgoHorizonBridge` arasında döngüsel
 * import var (routingService → offlineRoutingService → SystemBoot →
 * navigationSessionRuntime → navEgoHorizonBridge → routingService). Köprü bu
 * eşiği modül üst düzeyinde okuduğu için dev sunucusunda (paketlenmemiş ESM)
 * "Cannot access 'REROUTE_THRESHOLD_M' before initialization" ile açılışta
 * çöküyordu. Yaprak modül her zaman önce değerlendirilir → TDZ imkânsız.
 *
 * Mesafe hiyerarşisi (navigationService ile tutarlı kalmalı):
 *   ARRIVAL (20) < STEP_ADVANCE (30) < MANEUVER_STACK (50) < REROUTE (55)
 *   25m güvenli bölge: STEP_ADVANCE (30m) → REROUTE (55m) — adım ilerleme ve reroute çakışmaz.
 */
export const REROUTE_THRESHOLD_M        = 55; // metre — rota sapma reroute eşiği (STEP_ADVANCE+25m güvenli bölge)
export const STEP_ADVANCE_THRESHOLD_M   = 30; // metre — advance to next turn instruction
export const MANEUVER_STACK_THRESHOLD_M = 50; // metre — back-to-back turns shown together
