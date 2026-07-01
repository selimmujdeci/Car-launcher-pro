/**
 * Map Lite Mode — cihaz-bağımlı, pan/zoom SIRASINDA dinamik görsel hafifletme.
 *
 * NEDEN: GE8300 sınıfı zayıf GPU + full-screen raster harita head unit'lerinde pan
 * darboğazı RenderThread'in WebView yüzeyini her karede HWUI'ye composite etmesidir
 * (profil: Slow draw commands 52/52, Slow UI thread 51/52). Kök maliyeti güvenli
 * DİNAMİK biçimde düşürmenin tek yolu kalan: harekette gereksiz/animasyonlu overlay
 * katmanlarını gizleyip GL draw-call sayısını ve sürekli rAF repaint'i azaltmak.
 *
 * GÜVENLİK SINIRLARI (bu cihazda kanıtlandı):
 *  - `setPixelRatio` / `map.resize()` / `setStyle` ÇAĞRILMAZ — canlı GL buffer
 *    realloc bu cihazda 250-750ms stall yapıyor (felaket; geçmişte battı).
 *  - Yalnız `setLayoutProperty(visibility)` kullanılır — uniform/flag, realloc YOK.
 *  - React state YOK, map 'move' aboneliği YOK — tamamen imperative; çağrı yalnız
 *    mevcut start/end handler'larından (dragstart/zoomstart ...).
 *
 * KAPSAM: yalnız zayıf GPU. Normal cihazlarda hiçbir şey yapmaz (no-op) →
 * görsel kalite/tema aynen korunur.
 *
 * Fonksiyonel geometriye DOKUNULMAZ: rota çekirdeği (SEL_LAYER), kenar (ROUTE_CASE)
 * ve konum işareti (user-vehicle) harekette de görünür kalır — harita okunur kalır.
 * Yalnız dekoratif/animasyonlu katmanlar gizlenir.
 */

import type { Map as MapLibreMap } from 'maplibre-gl';
import { hasWeakGpu } from '../../utils/detectWeakGpu';
import {
  ROUTE_SHADOW,
  ROUTE_GLOW_SEL,
  ROUTE_FLOW,
  ALT_BADGE_LAYER,
  DEBUG_LAYER,
} from './_mapState';
import { pauseRouteFlowAnimation, resumeRouteFlowAnimation } from './MapLayerManager';

/** Pan/zoom sırasında gizlenecek dekoratif/animasyonlu overlay katmanları. */
const LITE_HIDE_LAYERS: readonly string[] = [
  'user-glow',     // konum halosu (dekoratif)
  'user-ring',     // konum halkası (dekoratif)
  ROUTE_SHADOW,    // rota derinlik gölgesi
  ROUTE_GLOW_SEL,  // rota neon glow
  ROUTE_FLOW,      // marching-ants akış (sürekli rAF → harekette en pahalısı)
  ALT_BADGE_LAYER, // alternatif rota süre rozetleri (symbol/text)
  DEBUG_LAYER,     // rota debug çizgisi
];

const RESTORE_DEBOUNCE_MS = 220; // etkileşim bitince geri yükleme gecikmesi (spec: 150-300ms)

let _liteActive = false;
let _restoreTimer: ReturnType<typeof setTimeout> | null = null;
/** Gizlemeden ÖNCEki görünürlük — yalnız gerçekten görünür olanları geri açmak için. */
let _prevVisible: string[] = [];

function _isVisible(map: MapLibreMap, id: string): boolean {
  try {
    if (!map.getLayer(id)) return false;
    // 'visibility' undefined ise MapLibre default'u 'visible'
    return map.getLayoutProperty(id, 'visibility') !== 'none';
  } catch {
    return false;
  }
}

function _setVisibility(map: MapLibreMap, id: string, vis: 'none' | 'visible'): void {
  try {
    if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', vis);
  } catch {
    /* katman stil geçişinde olabilir — fail-soft */
  }
}

/**
 * dragstart / zoomstart / pitchstart / rotatestart → çağrılır.
 * Yalnız zayıf GPU'da etki eder. İdempotent.
 */
export function enterMapLiteInteraction(map: MapLibreMap | null | undefined): void {
  if (!map || !hasWeakGpu()) return;
  // Bekleyen geri-yükleme varsa iptal et (kesintisiz arka arkaya gesture'da titreme yok)
  if (_restoreTimer) { clearTimeout(_restoreTimer); _restoreTimer = null; }
  if (_liteActive) return;
  _liteActive = true;

  _prevVisible = [];
  for (const id of LITE_HIDE_LAYERS) {
    if (_isVisible(map, id)) {
      _prevVisible.push(id);                 // sadece görünür olanı not et
      _setVisibility(map, id, 'none');
    }
  }
  // ROUTE_FLOW katmanını gizlemek yetmez — rAF akış döngüsünü de durdur (compositor
  // her kare uyandırma + 80ms setPaintProperty maliyeti). Rota yoksa no-op.
  pauseRouteFlowAnimation();
}

/**
 * dragend / zoomend / pitchend / rotateend → çağrılır.
 * Debounce ile (etkileşim gerçekten bitince) yalnız bizim gizlediğimiz ve önceden
 * görünür olan katmanları geri açar — başka sebeple gizli katmanı yanlışlıkla açmaz.
 */
export function exitMapLiteInteraction(map: MapLibreMap | null | undefined): void {
  if (!map || !_liteActive) return;
  if (_restoreTimer) clearTimeout(_restoreTimer);
  _restoreTimer = setTimeout(() => {
    _restoreTimer = null;
    _liteActive = false;
    const toRestore = _prevVisible;
    _prevVisible = [];
    for (const id of toRestore) _setVisibility(map, id, 'visible');
    // Rota akış animasyonunu geri başlat (rota hâlâ aktifse).
    resumeRouteFlowAnimation();
  }, RESTORE_DEBOUNCE_MS);
}

/** @internal — testler için durum sıfırlama. */
export function _resetMapLiteForTest(): void {
  if (_restoreTimer) { clearTimeout(_restoreTimer); _restoreTimer = null; }
  _liteActive = false;
  _prevVisible = [];
}
