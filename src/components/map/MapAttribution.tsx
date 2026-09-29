/**
 * MapAttribution — harita veri sağlayıcılarının lisans atfı (ODbL/OSM, OpenMapTiles,
 * TomTom, Esri). Yayın öncesi zorunlu (2026-09-27: harita atfı hiç görünmüyordu).
 *
 * MapLibre'nin kendi `attributionControl`ü BİLEREK kapalı kalır: style JSON'daki
 * `attribution` alanını HTML olarak basar ve kurulu sürüm GHSA-jrc7-96c5-q579
 * aralığında (bkz. maplibreXssContainmentW13.test). Bu yüzden atıf burada sabit,
 * DÜZ METİN olarak (React text node — HTML değil) çizilir; uzak kaynak içeriği
 * DOM'a girmez. Harita dokunuşlarını engellemez.
 */
import { memo } from 'react';

/** Ürünün harita katmanlarında kullandığı sağlayıcılar (kaynak tanımlarındaki atıflarla aynı). */
export const MAP_ATTRIBUTION_TEXT = '© OpenStreetMap katkıcıları · © OpenMapTiles · © TomTom · © Esri';

export const MapAttribution = memo(function MapAttribution({ compact = false }: { compact?: boolean }) {
  return (
    <div
      data-map-attribution=""
      aria-label="Harita verisi atfı"
      style={{
        position: 'absolute', left: 6, bottom: 4, zIndex: 'var(--z-map-honesty)', pointerEvents: 'none',
        maxWidth: 'calc(100% - 12px)', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis',
        fontSize: compact ? 8 : 10, lineHeight: 1.4, padding: '1px 5px', borderRadius: 4,
        color: 'rgba(255,255,255,0.78)', background: 'rgba(0,0,0,0.38)', fontFamily: 'Inter, "Segoe UI", sans-serif',
      }}
    >
      {MAP_ATTRIBUTION_TEXT}
    </div>
  );
});
