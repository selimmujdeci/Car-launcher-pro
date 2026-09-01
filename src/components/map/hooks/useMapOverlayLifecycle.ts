/**
 * useMapOverlayLifecycle — P0-NAV-02 · harita yüzeyi ↔ overlay köprüleri.
 *
 * ── NE TAŞINDI ────────────────────────────────────────────────────────────
 * `FullMapView` içindeki **bitişik üç efekt**, olduğu gibi:
 *   1. alternatif rota seçim köprüsü (`registerAltRouteSelectCallback`)
 *   2. haritaya dokununca kontrolleri göster
 *   3. haritaya uzun basış → o noktayı hedef seç
 *
 * ── DAVRANIŞ DEĞİŞMEDİ (pazarlıksız) ──────────────────────────────────────
 * Üç efekt de kaynakta ARDIŞIKTI ve bu hook `FullMapView` içinde tam olarak
 * o konumda çağrılır → React'in efekt BİLDİRİM SIRASI birebir korunur.
 * Bağımlılık dizileri, gövdeler ve temizleyiciler harfi harfine aynıdır.
 * Yeni state, yeni timer, yeni abonelik EKLENMEDİ.
 *
 * ── BU HOOK'UN DOKUNMADIKLARI ─────────────────────────────────────────────
 * Kamera/takip davranışı (`cameraFollowAuthority`), harita örneği sahipliği
 * (`initializeMap`) ve rota motoru bu turda ELLENMEDİ.
 */

import { useEffect, type RefObject } from 'react';
import { registerAltRouteSelectCallback } from '../../../platform/mapService';
import { selectAltRoute } from '../../../platform/routingService';
import { startNavigation } from '../../../platform/navigationService';
import type { MapRef } from './_mapSurfaceInternals';

export interface MapOverlayLifecycleOptions {
  readonly mapRef: RefObject<MapRef | null>;
  readonly mapStatus: string;
  /** Kontrolleri görünür kılan kararlı geri çağırım (`useCallback`). */
  readonly showControls: () => void;
}

export function useMapOverlayLifecycle({
  mapRef, mapStatus, showControls,
}: MapOverlayLifecycleOptions): void {
  // C7.2 — alternatif rota seçim köprüsü: mapService click → routingService
  // mapService, style.load sonrası etkileşimleri otomatik yeniler (persistence garantisi).
  useEffect(() => {
    return registerAltRouteSelectCallback((idx) => selectAltRoute(idx));
  }, []);

  // Haritaya tıklanınca kontrolleri göster (MapLibre canvas olayları)
  useEffect(() => {
    if (mapStatus !== 'READY' || !mapRef.current) return;
    const map = mapRef.current;
    map.on('mousedown', showControls);
    map.on('touchstart', showControls);
    return () => {
      map.off('mousedown', showControls);
      map.off('touchstart', showControls);
    };
  }, [mapRef, mapStatus, showControls]);

  // Haritaya uzun basış (sağ tık / contextmenu) → o noktayı hedef seç
  useEffect(() => {
    if (mapStatus !== 'READY' || !mapRef.current) return;
    const map = mapRef.current;
    const onLongPress = (e: { lngLat: { lng: number; lat: number } }) => {
      const { lng, lat } = e.lngLat;
      startNavigation({
        id: `map-${Date.now()}`,
        name: 'Haritadan Seçilen Nokta',
        latitude: lat,
        longitude: lng,
        type: 'history',
      }, false, 'USER_MAP');   // kütük #429: haritada uzun basış
    };
    map.on('contextmenu', onLongPress);
    return () => { map.off('contextmenu', onLongPress); };
  }, [mapRef, mapStatus]);
}
