/**
 * _safeLayerOps — MapLibre katman işlemleri için VARLIK KONTROLLÜ sarmalayıcılar.
 *
 * ── NEDEN (saha 2026-08-02, gerçek cihaz) ───────────────────────────────────
 * Düşük-GPU modunda (`perf-low`) rota yığınının dekoratif katmanları
 * (`car-route-shadow` · `car-route-glow-sel` · `car-route-flow`) BİLEREK
 * oluşturulmaz. Buna karşın `moveLayer` / `setPaintProperty` çağrıları
 * koşulsuz yapılıyordu.
 *
 * Kritik ayrıntı: MapLibre bu durumda **throw ETMEZ** — `map.fire(ErrorEvent)`
 * ile bir `error` olayı yayınlar. Bu yüzden çağrıları saran `try { } catch { }`
 * blokları HİÇBİR ŞEY yakalamıyordu ve her çağrı uygulamanın hata defterine
 * düşüyordu. Cihazdan okunan `cl_crash_log`'ta **son 50 kaydın 50'si** bu
 * gürültüydü:
 *   `Cannot style non-existing layer "car-route-glow-sel"`      ×12
 *   `The layer 'car-route-shadow' does not exist … cannot be moved` ×8
 *   `The layer 'car-route-glow-sel' … cannot be moved`             ×8
 *   `The layer 'car-route-flow' … cannot be moved`                 ×8
 * Gerçek bir harita arızası bu gürültünün altında kaybolurdu.
 *
 * ── KURAL ───────────────────────────────────────────────────────────────────
 * Katmanın YOKLUĞU bir hata DEĞİLDİR (düşük-uçta beklenen durumdur) → sessizce
 * atlanır. `try/catch` yine de KORUNUR: stil yeniden yüklenirken `getLayer` ile
 * çağrı arasında katman kaybolabilir (yarış).
 */

import type { Map as MapLibreMap } from 'maplibre-gl';

/** Katman varsa en üste taşır; yoksa sessizce atlar (hata olayı YAYINLANMAZ). */
export function safeMoveLayer(map: MapLibreMap, layerId: string): void {
  try {
    if (!map.getLayer(layerId)) return;
    map.moveLayer(layerId);
  } catch { /* stil yeniden yükleniyor — sonraki tick düzeltir */ }
}

/** Katman varsa paint özelliğini yazar; yoksa sessizce atlar. */
export function safeSetPaint(
  map: MapLibreMap,
  layerId: string,
  property: string,
  value: unknown,
): void {
  try {
    if (!map.getLayer(layerId)) return;
    map.setPaintProperty(layerId, property, value);
  } catch { /* stil yeniden yükleniyor — sonraki tick düzeltir */ }
}

/** Katman varsa layout özelliğini yazar; yoksa sessizce atlar. */
export function safeSetLayout(
  map: MapLibreMap,
  layerId: string,
  property: string,
  value: unknown,
): void {
  try {
    if (!map.getLayer(layerId)) return;
    map.setLayoutProperty(layerId, property, value);
  } catch { /* stil yeniden yükleniyor — sonraki tick düzeltir */ }
}
