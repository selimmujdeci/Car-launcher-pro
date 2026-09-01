/**
 * useMapStyleLifecycle — P0-NAV-02 · harita STİL/TEMA yaşam döngüsü.
 *
 * ── NE TAŞINDI ────────────────────────────────────────────────────────────
 * `FullMapView` içindeki **bitişik üç efekt**, olduğu gibi:
 *   1. harita modu değişimi (yol / uydu / hibrit) → stil değiştir
 *   2. karo render modu değişimi (raster ↔ vektör) → stil değiştir
 *   3. navigasyon + AR durumu → otomatik geçiş motoruna bildir + odak modu
 *
 * ── DAVRANIŞ DEĞİŞMEDİ (pazarlıksız) ──────────────────────────────────────
 * Üçü de kaynakta ARDIŞIKTI ve bu hook `FullMapView` içinde tam olarak o
 * konumda çağrılır → efekt BİLDİRİM SIRASI birebir korunur. İlk-render atlama
 * bayrakları (`modeInitRef` / `renderInitRef`), navigasyon sırasında stil
 * değişimini atlama kuralı ve fade kararı harfi harfine aynıdır.
 *
 * ── NEDEN İLK-RENDER BAYRAKLARI DIŞARIDAN GELİYOR ─────────────────────────
 * `modeInitRef` / `renderInitRef` `FullMapView`in ilk kurulum akışıyla aynı
 * ömre sahiptir; hook içinde YENİDEN yaratılsalardı, harita yeniden kurulunca
 * (WebGL context kaybı → re-init) ilk stil değişimi sessizce ATLANIRDI.
 * Sahiplik bilinçli olarak çağıranda bırakıldı.
 */

import { useEffect, useRef, type RefObject } from 'react';
import { notifyNavigationRender, getMapNight, getResolvedTileMode } from '../../../platform/mapSourceManager';
import { setNavigationFocusMode } from '../../../platform/mapService';
import {
  applyMapDeclutter, invalidateMapDeclutter,
} from '../../../platform/map/MapLayerManager';
import { NavStatus } from '../../../platform/navigationService';
import type { MapRef } from './_mapSurfaceInternals';

export interface MapStyleLifecycleOptions {
  readonly mapRef: RefObject<MapRef | null>;
  /** Harita modu (`road` / `satellite` / `hybrid`). */
  readonly mode: string;
  /** Karo render modu (`raster` / `vector`). */
  readonly tileRender: string;
  /** Navigasyon durumu — sıcak yoldan okunduğu için REF. */
  readonly navStatusRef: RefObject<string>;
  readonly isNavigating: boolean;
  readonly arState: string;
  readonly modeInitRef: RefObject<boolean>;
  readonly renderInitRef: RefObject<boolean>;
  /** Stil sürümü — `setStyle` katmanları sildiğinde artar (yeniden uygulama tetiği). */
  readonly styleKey: number;
  readonly mapStatus: string;
  /** Paylaşılan stil değiştirme yardımcısı — sahibi `FullMapView`de kalır. */
  readonly doStyleSwitch: (map: MapRef, withFadeOverlay: boolean) => void;
}

export function useMapStyleLifecycle({
  mapRef, mode, tileRender, navStatusRef, isNavigating, arState,
  modeInitRef, renderInitRef, doStyleSwitch, styleKey, mapStatus,
}: MapStyleLifecycleOptions): void {
  // Map mode change (road/satellite/hybrid) — switch tile style
  useEffect(() => {
    if (!modeInitRef.current) {
      modeInitRef.current = true;
      return;
    }
    if (!mapRef.current) return;
    doStyleSwitch(mapRef.current, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- bağımlılık dizisi TAŞIMADAN ÖNCEKİYLE birebir aynı (davranış kilidi)
  }, [mode]);

  // Tile render mode change (raster ↔ vector) — auto-driven by navigation/AR state
  useEffect(() => {
    if (!renderInitRef.current) {
      renderInitRef.current = true;
      return;
    }
    if (!mapRef.current) return;
    // Navigasyon sırasında style switch atla — setStyle() tüm rota katmanlarını siler
    // ve rota geçici olarak kayboluyor. tileRender geçişi (raster↔vector) yalnızca
    // IDLE modda anlamlıdır; navigasyon tile'ları OSM raster üzerinden zaten akar.
    if (navStatusRef.current !== NavStatus.IDLE) return;
    // Raster switch (nav start): no fade, no delay — immediate for safety.
    // Vector switch (idle): soft fade-in from dark background.
    const instant = tileRender === 'raster';
    doStyleSwitch(mapRef.current, !instant);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- bağımlılık dizisi TAŞIMADAN ÖNCEKİYLE birebir aynı (davranış kilidi)
  }, [tileRender]);

  /* ── NİYET ↔ UYGULANAN MUTABAKATI (#825, CİHAZDA CDP İLE ÖLÇÜLDÜ) ────────
   * KÖK NEDEN: `tileRender` (NİYET) ile ekrana fiilen çizilen stil
   * (`getResolvedTileMode()`) birbirinden kalıcı olarak sapabiliyordu; üstteki
   * `[tileRender]` efekti bu sapmayı kapatamıyordu çünkü SAHİPSİZ kalan İKİ
   * pencere var:
   *
   *   (A) FullMapView UNMOUNT'ta `notifyLowFPS(false)` çağırır; o da 2500 ms
   *       sonra `tileRender:'vector'` yazar. Ama o an bu bileşen YOK ve
   *       `MiniMapWidget` `tileRender`a HİÇ abone değildir (yalnız `mapMode`e
   *       bakar) → niyet 'vector'a geçer, ekranda raster KALIR.
   *   (B) FullMapView yeniden MOUNT olduğunda efekt bir kez koşar ama harita
   *       örneği ASENKRON kurulduğu için `mapRef.current` HENÜZ NULL'dur →
   *       erken döner; `isNavigating` bir daha değişmediği için BİR DAHA ASLA
   *       koşmaz → sapma kalıcılaşır.
   *
   * CİHAZDA ÖLÇÜLEN KANIT (2026-08-24, Xiaomi 23090RA98I, CDP):
   *   sapık hâlde  → `map.getStyle().name = 'OSM Map'`, 8 katman, tek raster
   *                  katmanı (gece boyası: contrast .4 / brightness ≤.25 /
   *                  saturation −.58) → ekranda okunaksız gri-kahve.
   *   zorla yeniden çözdürünce → `'Vector (Automotive Night)'`, 30 katman,
   *                  `omv` kaynağı → istenen koyu palet.
   *   `tiles.openfreemap.org/planet` → HTTP 200, 17 ms (vektör ERİŞİLEBİLİRDİ;
   *   yani kusur ağ/kaynak değil, YALNIZ stilin yeniden çözülmemesiydi).
   *
   * ÇÖZÜM: mutabakat penceresi `isNavigating` kenarıyla sınırlı kalmaz; harita
   * HAZIR olduğunda ve niyet değiştiğinde de bakılır. Navigasyon sırasında
   * restyle YASAĞI (rota katmanlarını siler) AYNEN korunur.
   *
   * SONSUZ DÖNGÜ KORUMASI (pazarlıksız): niyet 'vector' olsa bile
   * `buildVectorStyle` kaynak yoksa raster'a düşer → sapma KAPANMAZ. Aynı niyet
   * için ikinci bir deneme YAPILMAZ (`attemptedRef`); niyet gerçekten
   * değişmeden yeniden denenmez. Sapma kapanınca çapa temizlenir. */
  const attemptedRef = useRef<string | null>(null);
  useEffect(() => {
    if (isNavigating) return;                          // navigasyonda restyle YOK
    if (mapStatus !== 'READY') return;                 // (B) harita henüz kurulmadı
    if (!mapRef.current) return;
    if (navStatusRef.current !== NavStatus.IDLE) return;
    if (getResolvedTileMode() === tileRender) {        // senkron → çapayı bırak
      attemptedRef.current = null;
      return;
    }
    if (attemptedRef.current === tileRender) return;   // bu niyet zaten denendi
    attemptedRef.current = tileRender;
    const instant = tileRender === 'raster';
    doStyleSwitch(mapRef.current, !instant);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sahipsiz iki pencereyi de kapatır
  }, [isNavigating, tileRender, mapStatus]);

  // Navigation + AR state → notify auto-switch engine + apply focus mode
  useEffect(() => {
    const arActive = arState === 'active' || arState === 'degraded';
    notifyNavigationRender(isNavigating, arActive);
    // Focus mode: yardımcı yol katmanlarını navigasyon aktifken soldur
    if (mapRef.current && mapRef.current.isStyleLoaded()) {
      setNavigationFocusMode(mapRef.current, isNavigating);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- bağımlılık dizisi TAŞIMADAN ÖNCEKİYLE birebir aynı (davranış kilidi)
  }, [isNavigating, arState]);

  /* ── GÜRÜLTÜ SÖZLEŞMESİ (P0-NAV-03) ──────────────────────────────────────
   * Tam ekran profilini uygular: bina/POI/şehir etiketi/kalkan gece-gündüze ve
   * rehberlik durumuna göre ölçülü geri çekilir. YOL katmanları bu sözleşmeye
   * DAHİL DEĞİLDİR — onların tek sahibi `NAV_SUPPRESS_TIERS`tir ve tam ekranda
   * tablo AYNEN geçirilir (bkz. `mapDeclutterModel` başlığı).
   *
   * `styleKey` bağımlılıkta: `setStyle` tüm katmanları siler, sözleşme yeniden
   * yazılmalıdır. Stil henüz yüklü değilse uygulayıcı anahtarı İŞLEMEZ →
   * bir sonraki tetikte tekrar denenir (sahte "uygulandı" durumu yok). */
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    invalidateMapDeclutter();          // yüzey/stil değişti → yeniden yaz
    try {
      applyMapDeclutter(map, 'FULL', getMapNight(), isNavigating);
    } catch { /* fail-soft — gürültü sözleşmesi kamerayı/rotayı ASLA bozmaz */ }
  }, [mapRef, isNavigating, styleKey, mapStatus, mode, tileRender]);
}
