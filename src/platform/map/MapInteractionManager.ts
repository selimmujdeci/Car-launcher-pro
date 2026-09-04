// ══════════════════════════════════════════════════════════════════════════
// CarOS Pro — MapInteractionManager
//
// Sorumluluk: kamera etkileşimleri (flyTo/easeTo/jumpTo), sürüş görünümü
// kamera pipeline'ı, kamera kısıtlamaları (bounds/pitch), harita olay
// dinleyicileri (route click/hover) ve sürüş modu store bayrağı.
//
// Bağımlılık: _mapState + MapLayerManager (flow/intersection). Davranış
// değişikliği YOK; mapService.ts'ten birebir taşındı.
// ══════════════════════════════════════════════════════════════════════════
import maplibregl, { Map as MapLibreMap } from 'maplibre-gl';
import type { LngLatLike } from 'maplibre-gl';
import {
  CAMERA_CFG,
  resetCameraSmooth,
  computeCameraTarget,
  dampCameraToward,
  computeAnticipatedBearing,
  clampTopPadForVehicle,
  isVehicleFramed,
} from '../cameraEngine';
import {
  resolveSpeedBand, SPEED_BANDS, resolveManeuverBand, type SpeedBand,
} from '../navigation/core/cameraPolicyModel';
import {
  resolveTopPadForAnchor, updateAnchorBias, limitStep, limitAngleStep,
  ANCHOR_MAX_STEP, ZOOM_MAX_STEP, PITCH_MAX_STEP_DEG, BEARING_MAX_STEP_DEG,
} from './core/cameraCompositionModel';
import {
  resolveEntryBearing, type EntryBearingDecision,
} from '../navigation/core/navigationEntryBearing';
import { useHazardStore } from '../../store/useHazardStore';
import {
  M,
  useMapStore,
  ALT_TOUCH_PAD,
  ROUTE_SHADOW,
  ROUTE_GLOW_SEL,
  ROUTE_CASE,
  ROUTE_FLOW,
  SEL_LAYER,
} from './_mapState';
import {
  _updateFlowSpeed, _applyIntersectionSuppression, resolveRouteWidths, syncRouteColor,
} from './MapLayerManager';
import { routeWidthExpression } from './core/routeWidthModel';
import { safeSetPaint } from './_safeLayerOps';
import { noteLegacyCameraOutcome } from '../navigation/cameraShadowRuntime';
/* ARCH-06/F1 — YALNIZ SAYAÇ: kaç kamera komutu üretildi. Koordinat/bearing
   ölçüm katmanına TAŞINMAZ; kamera otoritesi bu modülde KALIR. */
import { bumpPerf } from '../perf/perfCounters';

/**
 * #617 — PARK/DURUŞ ÇERÇEVESİNİN TEK OTORİTESİ (sokak seviyesi).
 *
 * ÖLÇÜLEN KUSUR (cihazda, Xiaomi 23090RA98I): park zoom'u kodda ÜÇ ayrı yerde
 * ÜÇ ayrı sayıyla yazılıydı — ilk kurulum **16**, "Ortala" düğmesi **16,5**,
 * `exitDrivingView` **15,5**. Açılışta GPS oynaması kısa süre sürüş modunu
 * açıp kapatınca `exitDrivingView` çalışıyor ve `easeTo({zoom: 15.5})` ile
 * doğru çerçeveyi EZİYORDU. Arayüz bu telefonda 0,679 kat ölçeklendiği için
 * (kutu 781 CSS px → ekranda 530 px) bir kademe eksik zoom ekranda ~1,5 kat
 * daha geniş alan demek: yollar saç teli gibi ince ve sık görünüyor —
 * kullanıcının "saçma sapan yükleniyor" dediği tablo. Ölçüm: ardışık
 * açılışlarda 16 / 15,5 / 16 / 15,5 dönüşümlü.
 *
 * Sayı artık TEK yerde. Değiştirilecekse burada değiştirilir; çağrı yerlerine
 * ikinci bir park zoom'u YAZILMAZ (kilit: `mapParkViewZoom.test.ts`).
 */
export const PARK_VIEW_ZOOM = 16;

export function setMapCenter(map: MapLibreMap, center: LngLatLike, zoom?: number, animated = true) {
  if (!map) return;

  if (animated) {
    map.flyTo({
      center,
      zoom: zoom ?? map.getZoom(),
      duration: 1000,
    });
  } else {
    map.setCenter(center);
    if (zoom !== undefined) map.setZoom(zoom);
  }
}

export function setMapHeading(map: MapLibreMap, heading: number) {
  if (!map || !isFinite(heading)) return;
  map.setBearing(heading);
}

/**
 * Alternatif rota seçim callback'ini kaydet.
 * FullMapView mount'unda bir kez çağrılır; dönen fonksiyon kaydı iptal eder.
 */
export function registerAltRouteSelectCallback(cb: (realIdx: number) => void): () => void {
  M.onAltRouteSelect = cb;
  return () => { if (M.onAltRouteSelect === cb) M.onAltRouteSelect = null; };
}

/** Zombi listener'ları temizle. */
export function _cleanupRouteInteractions(): void {
  M.routeInteractionCleanup?.();
  M.routeInteractionCleanup = null;
}

/**
 * Alternatif rota katmanına dokunmatik dostu tıklama + hover etkileşimleri kur.
 * style.load sonrası her çağrıda önceki listener'lar temizlenerek yeniden kurulur.
 * 24px bbox padding: sürüş anında ince gri hatta dokunmayı tolere eder.
 */
export function _setupRouteInteractions(map: MapLibreMap): void {
  _cleanupRouteInteractions();

  const onMapClick = (e: maplibregl.MapMouseEvent) => {
    if (!map.getLayer('car-route-alt-fill')) return;
    const pt = e.point;
    const features = map.queryRenderedFeatures(
      [
        [pt.x - ALT_TOUCH_PAD, pt.y - ALT_TOUCH_PAD],
        [pt.x + ALT_TOUCH_PAD, pt.y + ALT_TOUCH_PAD],
      ],
      { layers: ['car-route-alt-fill'] },
    );
    const feat = features[0];
    if (!feat?.properties) return;
    const realIdx = feat.properties.altRealIdx;
    if (realIdx !== undefined && M.onAltRouteSelect) {
      M.onAltRouteSelect(Number(realIdx));
    }
  };

  const onEnter = () => { map.getCanvas().style.cursor = 'pointer'; };
  const onLeave = () => { map.getCanvas().style.cursor = ''; };

  map.on('click', onMapClick);
  map.on('mouseenter', 'car-route-alt-fill', onEnter);
  map.on('mouseleave', 'car-route-alt-fill', onLeave);

  M.routeInteractionCleanup = () => {
    try { map.off('click', onMapClick); } catch { /* ignore */ }
    try { map.off('mouseenter', 'car-route-alt-fill', onEnter); } catch { /* ignore */ }
    try { map.off('mouseleave', 'car-route-alt-fill', onLeave); } catch { /* ignore */ }
    try { map.getCanvas().style.cursor = ''; } catch { /* ignore */ }
  };
}

// ── Driving mode ─────────────────────────────────────────────
// Kamera hesaplamaları cameraEngine.ts'e taşındı (Faz 3.1).

/**
 * Navigation (driving) view — Faz 3.1 cinematic camera.
 *
 * @param turnApproachM  Bir sonraki manevra noktasına mesafe (metre)
 * @param obdSpeedKmh    GPS hız sıfırsa OBD fallback
 * @param nextTurnBearing Manevra sonrası yön — turn anticipation için (opsiyonel)
 */
/** Driving-view şu an aktif mi — exitDrivingView'i İDEMPOTENT yapar.
 *  Yoksa MiniMapWidget her heading (pusula) değişiminde exitDrivingView çağırıp
 *  her seferinde 800ms easeTo başlatıyor → kamera animasyonları bitmeden yenileniyor
 *  → map.isMoving() kalıcı true → MapLibre idle'da 90fps render (cihaz profili 2026-06-17). */
let _drivingViewActive = false;

/** Durakta haritanın rota yönünden bu kadar sapması TOLERE edilir (derece).
 *  Üstünde kamera bir kez uygulanır ve yön düzeltilir; altında hiç iş yapılmaz
 *  (salınım olmaz). Cihazda ölçülen bozuk durum 140.6° idi. */
const STANDSTILL_BEARING_TOLERANCE_DEG = 15;

/**
 * ÖĞRENİLEN İLERİ-BAKIŞ TAVANI (m) — aracı ekranda tutmak için.
 *
 * ⚠️ İLK UYGULAMAM ISINMA ÜRETTİ (kullanıcı bildirdi 2026-08-03): çerçeve
 * düzeltmesini HER KAREDE yineleyen bir döngüyle yapmıştım — araç çerçeve
 * dışındayken kare başına 3 ek `jumpTo`, yani **kare başına 5 harita yeniden
 * çizimi**. 6-7 Hz kamera temposunda bu GPU yükünü katlıyor.
 *
 * DOĞRUSU: düzeltmeyi her karede TEKRARLAMAK değil, SONUCUNU HATIRLAMAK.
 * Taşma görülünce tavan yarılanır ve bundan SONRAKİ karelerde merkez zaten
 * tavanlı hesaplanır → ek `jumpTo` GEREKMEZ. Bol paylı çerçevede tavan
 * kademeli gevşer (hız/zoom değişince eski kısıt yapışıp kalmasın).
 * Kararlı durumda maliyet: kare başına 1 `project()` — değişiklikten önceki
 * hâlle aynı sayıda `jumpTo`.
 */
let _lookCapM = Number.POSITIVE_INFINITY;

/** Kamera bağlamı değişince (yeni rota/oturum) tavan sıfırlanır. */
export function resetLookAheadCap(): void { _lookCapM = Number.POSITIVE_INFINITY; }

/**
 * KAMERA KADANSI ÖLÇÜMÜ — sönümlemenin tempoya bağımlılığını kesen çapa.
 *
 * `cameraEngine`in üstel sönümlemesi çağrı BAŞINA çalışır; alfaları sahada
 * 150 ms'lik tempoda ayarlandı. Ama `setDrivingView` üründe üç farklı tempoda
 * çağrılıyor (tam ekran 150 ms · mini harita GPS fix hızı ≈ 500 ms · ölü
 * hesaplama yolu 16 ms) → aynı alfa 3,3× tembel ve 9,4× hırçın kameralar
 * üretiyordu (ölçüm ve tam gerekçe: `cameraEngine.CAMERA_CFG.CALIBRATION_DT_MS`).
 *
 * Saati BURASI okur, motor DEĞİL: `cameraEngine` saf ve deterministik kalır
 * (testlerde Δt enjekte edilir). `performance.now()` monotoniktir → sistem
 * saati geri alınsa bile Δt negatife düşmez.
 *
 * `null` = ölçüm yok (ilk kare / oturum sıfırlaması) → motor kalibrasyon
 * aralığını varsayar, yani bugünkü davranış AYNEN sürer (fail-soft).
 */
let _lastDampTs: number | null = null;

/** Kamera oturumu sıfırlandı → kadans ölçümü de sıfırlanır (yapay Δt yok). */
function _resetCameraCadence(): void { _lastDampTs = null; }

/* ── Akıcı takip kamerası (2026-08-13) ────────────────────────────────────── */

/** Sabit hızlı geçiş. Tick'ler zincirlendiği için her adımda ivmelenip yavaşlayan
 *  bir eğri (MapLibre varsayılanı) "nabız gibi atan" bir his üretirdi. */
const _LINEAR_EASING = (t: number): number => t;

/** `easeTo` süresi için güvenli alt/üst sınır (ms). Süre ölçülen tick'e eşitlenir;
 *  tavan, uygulama arka plandan dönünce oluşan devasa Δt'nin kamerayı saniyelerce
 *  süzülterek "geriden gelmesine" engel olur. */
const CAMERA_EASE_MIN_MS = 60;
const CAMERA_EASE_MAX_MS = 320;

/** Son ölçülen tick'ten türeyen animasyon süresi. */
let _lastEaseDtMs: number | null = null;
function _cameraEaseDurationMs(): number {
  const dt = _lastEaseDtMs;
  if (dt === null || !Number.isFinite(dt)) return CAMERA_EASE_MIN_MS;
  return Math.max(CAMERA_EASE_MIN_MS, Math.min(CAMERA_EASE_MAX_MS, dt));
}

/** Düşük-uç GPU (Mali-400 sınıfı head unit) — ara kare çizmek burada yüktür.
 *  Kaynak `perf-low` sınıfıdır; `MapLayerManager` de AYNI kapıyı kullanır
 *  (ikinci bir cihaz-sınıfı otoritesi doğmaz). */
function _isLowEndCamera(): boolean {
  try {
    return typeof document !== 'undefined'
      && document.documentElement.classList.contains('perf-low');
  } catch {
    return true; // okunamıyorsa UCUZ tarafta kal
  }
}

/** Bu çağrı ile bir öncekinin arasındaki süre (ms); ilk çağrıda `undefined`. */
function _nextCameraDt(): number | undefined {
  let dt: number | undefined;
  try {
    const now = performance.now();
    if (_lastDampTs !== null && now > _lastDampTs) dt = now - _lastDampTs;
    _lastDampTs = now;
  } catch {
    /* saat okunamıyorsa Δt ölçülmez → motor kalibrasyon aralığını kullanır */
  }
  return dt;
}

/**
 * Gölge gözlem ucu — ÜRÜN DAVRANIŞINI DEĞİŞTİRMEZ.
 *
 * Yalnız legacy'nin ürettiği skalerleri `cameraShadowRuntime`e bildirir.
 * Harita nesnesi YALNIZ viewport oranı için okunur (yön tespiti); gölge
 * katmanına harita GEÇMEZ ve koordinat GEÇMEZ. Her hata yutulur.
 */
function _reportShadow(
  map: MapLibreMap,
  applied: boolean,
  zoom: number | null,
  pitch: number | null,
  bearing: number | null,
  anchorY: number | null,
  speedKmh: number,
  lookAheadM: number | null,
  standstillFix: boolean,
): void {
  try {
    const cv = map.getCanvas();
    const w = cv.clientWidth, h = cv.clientHeight;
    noteLegacyCameraOutcome({
      applied, zoom, pitch, bearing, anchorY, standstillFix, lookAheadM,
      speedKmh,
      orientation: h > w ? 'PORTRAIT' : 'LANDSCAPE',
      /* Bu fonksiyon hem mini hem tam ekran tarafından çağrılır; ölçü
         ayrımı yapılamadığı için viewport profili `FULL` raporlanır ve bu
         sınır raporda açıkça yazılıdır (açık borç). */
      viewport: 'FULL',
    });
  } catch { /* gölge gözlem kamerayı ASLA bozmaz */ }
}

/* ── P0-NAV-03 · KOMPOZİSYON DURUMU (tek kamera politikası) ─────────────────
 * Aracın ekrandaki yeri artık `cameraPolicyModel.SPEED_BANDS[*].anchorY`den
 * gelir; eski `CAMERA_CFG.TOP_PAD_*` eğrisi kompozisyon için KULLANILMAZ.
 * Böylece iki paralel kompozisyon teke iner — `cameraShadowRuntime`ın ölçtüğü
 * `anchorYDelta` bu turdan sonra sıfıra yaklaşmalıdır (cihaz kabul ölçütü).
 *
 * `cameraFollowAuthority` DOKUNULMADI: o "kamera sürülebilir mi"ye karar verir,
 * burası yalnız "sürülüyorsa nasıl çerçevelenir"i hesaplar. */
let _camPrevBand: SpeedBand | null = null;
/** Ölçülen ileri-bakış payı (px) — analitik tahmin DEĞİL (bkz. model başlığı). */
let _anchorBiasPx = 0;
/** Bir önceki karede UYGULANAN anchor — kare başı sıçrama sınırı için. */
let _prevAppliedAnchor: number | null = null;
let _prevAppliedZoom: number | null = null;
let _prevAppliedPitch: number | null = null;
let _prevAppliedBearing: number | null = null;

/** @internal — oturum/test sıfırlaması. */
export function _resetCameraComposition(): void {
  _camPrevBand = null;
  _anchorBiasPx = 0;
  _prevAppliedAnchor = null;
  _prevAppliedZoom = null;
  _prevAppliedPitch = null;
  _prevAppliedBearing = null;
}

export function setDrivingView(
  map: MapLibreMap,
  lat: number,
  lng: number,
  heading: number,
  speedKmh: number,
  containerHeight: number,
  turnApproachM?: number,
  obdSpeedKmh?: number,
  nextTurnBearing?: number,
  /** Rotanın İLERİ yönü (araçtan bir sonraki rota noktasına). Durakta kamera
   *  yönü BUNDAN alınır — bkz. `_standstillFix` gerekçesi. */
  routeBearing?: number,
  /**
   * `turnApproachM`in KAYNAĞI (kanonik rota durumundan gelir — bu katman
   * HESAPLAMAZ, yalnız TAŞIR). `ALONG_ROUTE` değilse manevra kamerası
   * UYGULANMAZ; gerekçe `cameraPolicyModel.resolveManeuverBand` içindedir.
   */
  maneuverDistanceSource?: 'ALONG_ROUTE' | 'STRAIGHT_LINE' | 'UNKNOWN',
) {
  // ⭐ SAHA KÖK NEDEN (2026-07-04, "harita sabit kalıyor + gitme yönüne dönmüyor"):
  // Buradaki eski `!map.isStyleLoaded()` guard'ı sürüş kamerasını YAPISAL olarak
  // öldürüyordu — isStyleLoaded() şu iki durumda false döner ve ikisi de sürüşte
  // NORMAL haldir:
  //   1) updateUserMarker'ın setData'sı stili aynı senkron karede "kirli" işaretler
  //      → marker'dan hemen sonra çağrılan setDrivingView %100 erken dönüyordu.
  //   2) Hareket halinde sürekli yeni tile yüklenir → sourceCache.loaded()=false.
  // jumpTo/easeTo kamera işlemleri stil GEREKTİRMEZ; aşağıdaki stil-bağımlı işler
  // zaten getLayer() + try/catch korumalı. Bu yüzden guard yalnız map varlığıdır.
  // (84237ff + 4bd4ed5 hareket-tespiti fix'leri semptomu tedavi ediyordu; katil buydu.)
  if (!map) return;
  _drivingViewActive = true;

  // ── Dead Reckoning speed fusion ──────────────────────────────────────────
  const effectiveSpeed = speedKmh > 0 ? speedKmh : (obdSpeedKmh ?? 0);

  /* ── Movement jitter filter — düşük hızda GPS mikro titremeleri ───────────
   *
   * SAHA KUSURU (cihazda ölçüldü 2026-08-03): filtre YALNIZ "gereksiz
   * güncellemeyi" değil, **yanlış duran kamerayı DÜZELTMEYİ de** engelliyordu.
   * Kullanıcı rota çizdi, araç dururken (≈2 km/h, GPS oynaması < 0.8 m)
   * `setDrivingView` her karede erken dönüyor → sürüş kamerası HİÇ
   * uygulanmıyor → kamera en son nerede kaldıysa orada donuyordu. Ölçüm:
   *   canvas 902×405 · araç ekran y = 857 → **alt kenardan 452 px AŞAĞIDA**
   *   padTop = 0 (sürüş padding'i hiç uygulanmamış) · drivingMode = true
   * Kullanıcının tarifi: "rota çizdim, böyle dengesiz duruyor" — araç
   * görünmüyor, rota ekranın kenarında kalıyordu.
   *
   * DÜZELTME: titreşim filtresi yalnız kamera ZATEN DOĞRU çerçevelenmişken
   * uygulanır. Araç güvenli alanın dışındaysa kare atlanmaz, kamera
   * düzeltilir. (Bu, #330'daki look-ahead klipsinden AYRI bir kusurdur:
   * orada kamera çalışıyor ama aracı aşağı itiyordu, burada HİÇ çalışmıyor.)
   *
   * ⚠️ İLK DENEMEDE REGRESYON ÜRETTİ (cihazda ölçüldü, aynı gün): yalnız
   * "çerçeve bozuksa uygula" demek YETMEDİ — POZİTİF GERİ BESLEME doğdu.
   * Araç 0 m hareket ederken kamera merkezi 7 sn'de 63 m'ye varan sıçramalar
   * yaptı ve bearing -60° → 138° arası **~200° döndü**: çerçeve bozuk →
   * kamera uygula → kamera durakta gürültülü GPS heading'ini kovalayıp döner
   * → dönünce çerçeve yine bozulur → tekrar uygula … Kullanıcının tarifi:
   * *"harita durduğum yerde durmadan hareket ediyor."*
   *
   * DOĞRU AYRIM: durakta düzeltmenin SEBEBİ çerçevedir, yön değil. O yüzden
   * bu durumda YALNIZ yeniden ortalama yapılır; bearing/zoom/pitch MEVCUT
   * değerlerinde DONDURULUR (aşağıdaki `_standstillFix`). Böylece tek bir
   * düzeltme yeter, sonraki karelerde çerçeve doğru olduğu için filtre
   * devreye girer ve kamera tamamen durur. */
  /* ⚠️ İKİNCİ REGRESYON — ÖLÇÜM YANILTTI (cihazda, aynı gün):
   * "durakta" kararı KONUM FARKINA bağlıydı (`< 0.8 m`). Ama sahada GPS
   * doğruluğu **±3–6 m** ölçüldü (ekrandaki rozet: `GPS ±6m`): duran araçta
   * bile ardışık fix'ler 0.8 m'yi RAHATÇA aşıyor → "durakta" dalı neredeyse
   * hiç çalışmıyor → kamera normal yola girip gürültülü GPS heading'ini
   * kovalıyor ve harita **kendi kendine dönüyor**. Doğrulama ölçümüm yanıltıcı
   * çıkmıştı çünkü o an fix birebir tekrar ediyordu (konum farkı tam 0).
   *
   * DOĞRU SİNYAL KONUM DEĞİL HIZDIR: GPS heading'i ancak araç gerçekten
   * hareket ederken anlamlıdır. Eşiğin altında bearing/zoom/pitch KOŞULSUZ
   * dondurulur — konum gürültüsü ne yaparsa yapsın kamera DÖNMEZ. */
  const _standstillFix = effectiveSpeed < CAMERA_CFG.JITTER_SPEED_KMH;

  if (_standstillFix) {
    const dLat  = (lat - M.lastJumpLat) * 111_320;
    const dLng  = (lng - M.lastJumpLng) * 111_320 * Math.cos((lat * Math.PI) / 180);
    /* Durakta eşik GPS gürültü bandının üstünde olmalı (bkz. sabit yorumu):
       0.8 m ile duran araçta kamera her fix'te yeniden ortalanıp harita kayıyordu. */
    if (Math.sqrt(dLat * dLat + dLng * dLng) < CAMERA_CFG.STANDSTILL_RECENTER_MIN_M) {
      let framed = false;
      try {
        const p = map.project([lng, lat]);
        const cv = map.getCanvas();
        framed = isVehicleFramed(p.x, p.y, cv.clientWidth, cv.clientHeight);
      } catch { framed = false; } // ölçemiyorsak kamerayı uygula (fail-open)

      /* ── YÖN de "doğru kamera"nın parçasıdır (cihazda ölçüldü 2026-08-03) ──
       * Yalnız ÇERÇEVEYE bakmak yetmedi: araç ekranda doğru yerdeydi ama harita
       * rotanın 140.6° TERSİNE bakıyordu (harita 8.5°, rota 149.1°) → sürücü
       * "geri geri mi gideceğim" diye sordu. Kamera "zaten doğru" sayılıp her
       * karede erken dönüldüğü için rota yönü hiç uygulanmıyordu.
       * Doğru kamera = araç çerçevede VE harita rotaya bakıyor. */
      const oriented =
        !Number.isFinite(routeBearing ?? NaN) ||
        Math.abs(((((routeBearing as number) - map.getBearing()) % 360) + 540) % 360 - 180)
          <= STANDSTILL_BEARING_TOLERANCE_DEG;

      if (framed && oriented) {
        /* GÖLGE GÖZLEM (NAVIGATION_CAMERA_SHADOW): kamera bu karede
           UYGULANMADI. Politikanın aynı anda ne diyeceğini kaydeder; ürün
           davranışı DEĞİŞMEZ — bu çağrı hiçbir şey uygulamaz ve throw etmez. */
        _reportShadow(map, false, null, null, null, null, effectiveSpeed, 0, true);
        return;   // çerçeve VE yön doğru → hiç iş yapma
      }
    }
  }
  M.lastJumpLat = lat;
  M.lastJumpLng = lng;

  /* ── MANEVRA KAMERASI KAPISI (kanonik kural, burada İCAT EDİLMEZ) ────────
   * ÖLÇÜLEN KUSUR: `turnApproachM` üretime `distanceToNextTurnSource`
   * DENETLENMEDEN geliyordu (`FullMapView` yalnız `steps.length`e bakıyordu).
   * Kaynak `STRAIGHT_LINE` iken kuş uçuşu mesafe virajlı yaklaşımda gerçek
   * yol mesafesinden KISA çıkar → kamera kavşağa ERKEN girer, zoom ve yön
   * öngörüsü olmayan bir manevraya göre kurulur.
   *
   * Kural ZATEN vardı ama yalnız GÖLGEDE koşuyordu: `cameraPolicyModel.
   * resolveManeuverBand` kaynak `ALONG_ROUTE` değilse `'NONE'` döndürür ve
   * `decideCameraPolicy` bunu `applyManeuverCamera: false` yapar — o karar
   * üretimde HİÇ TÜKETİLMİYORDU (yalnız `cameraShadowRuntime` + LAB).
   * Burada kapı KANONİK modelden okunur; ikinci bir eşik/kural KURULMAZ.
   *
   * Kaynak BİLDİRİLMEMİŞSE (eski çağrı) davranış DEĞİŞMEZ — `undefined`
   * geriye dönük uyum için `ALONG_ROUTE` sayılır; kilit testi bu iki yolu
   * ayrı ayrı denetler. */
  const _maneuverBand = resolveManeuverBand(
    turnApproachM ?? null,
    maneuverDistanceSource ?? 'ALONG_ROUTE',
  );
  const _gatedTurnM = _maneuverBand === 'NONE' ? undefined : turnApproachM;

  // ── Camera target → smooth (Faz 3.1/3.3/3.4) ───────────────────────────
  const target = computeCameraTarget(effectiveSpeed, _gatedTurnM);

  // Turn anticipation + inertia + momentum model (Faz 3.4)
  const anticipatedBearing = computeAnticipatedBearing(heading, _gatedTurnM, nextTurnBearing);
  /* Δt tam BURADA okunur, fonksiyonun tepesinde DEĞİL: yukarıdaki durakta
     erken-dönüş yolu sönümleme yapmaz; orada saati tüketmek bir sonraki
     gerçek tick'in Δt'sini SIFIRLAR ve kamerayı yapay biçimde hızlandırırdı. */
  /* Aynı Δt hem sönümlemeyi hem `easeTo` süresini besler: animasyon TAM bir
     tick sürer → bir sonraki başlarken önceki bitmiş olur (üst üste binme yok). */
  const _tickDtMs          = _nextCameraDt();
  _lastEaseDtMs            = _tickDtMs ?? null;
  const smooth             = dampCameraToward(
    target, anticipatedBearing, effectiveSpeed, _tickDtMs,
  );

  // Route energy: hız + acceleration delta ile senkron pulse (Faz 3.4)
  _updateFlowSpeed(effectiveSpeed, smooth.deltaSpeed);

  // ── Camera Lockdown (Phase H4) ────────────────────────────────────────────
  const { globalRiskScore: _hzRisk, hazardStatus: _hzStatus } = useHazardStore.getState();
  const _isLockdown = _hzStatus === 'ATTENTION';

  const _lookAhead = _isLockdown ? smooth.lookAheadM * 0.5 : smooth.lookAheadM;
  const _pitch     = _isLockdown ? Math.min(smooth.pitch, 45) : smooth.pitch;

  let _zoom = smooth.zoom;
  if (_hzRisk > 0.4 && M.lastHazardZoom > 0) {
    // Risk arttıkça izin verilen max zoom değişimi küçülür: 0.4→0.06, 1.0→0.02
    const maxDelta = Math.max(0.02, 0.10 * (1 - _hzRisk));
    _zoom = M.lastHazardZoom + Math.max(-maxDelta, Math.min(maxDelta, _zoom - M.lastHazardZoom));
  }
  M.lastHazardZoom = _zoom;

  /* DURAKTA DÜZELTME: yalnız yeniden ortalama. Bearing/zoom/pitch mevcut
     değerlerinde DONDURULUR — durakta GPS heading'i gürültüdür ve onu
     kovalamak haritayı kendi kendine döndürür (ölçülen regresyon: 7 sn'de
     ~200° dönme, araç 0 m hareket ederken). Look-ahead da 0'lanır: aracı
     çerçeveye almak istiyoruz, ileri bakmak değil. */
  /* DURAKTA YÖN: dondurmak TEK BAŞINA yetmez — donan değer eski/rastgele bir
     yön olabilir ve harita gideceğin yöne bakmaz. Kullanıcı bunu şöyle tarif
     etti: *"geri geri mi gideceğim"* — rota ekranda ARKAYA doğru görünüyordu.
     Doğru kaynak GPS heading'i (durakta gürültü) DEĞİL, ROTANIN İLERİ
     YÖNÜdür: sabittir (geometriden gelir, titremez) ve sürücünün gerçekten
     gideceği yönü gösterir. Rota yoksa mevcut bearing korunur. */
  const _bearing = _standstillFix
    ? (Number.isFinite(routeBearing ?? NaN) ? (routeBearing as number) : map.getBearing())
    : limitAngleStep(_prevAppliedBearing, smooth.bearing, BEARING_MAX_STEP_DEG);
  _prevAppliedBearing = _bearing;
  /* P0-NAV-03 — kare başı SERT tavan. Sönümleme yumuşak bir yaklaşımdır ama
     hedef bir karede büyük sıçrarsa ilk adım da büyüktür; bu sınır o adımı
     keser. Durakta zaten dondurulmuş değerler kullanılır → sınırlayıcı YALNIZ
     hareket hâlinde iş görür. */
  const _zoomEff = _standstillFix
    ? map.getZoom()
    : limitStep(_prevAppliedZoom, _zoom, ZOOM_MAX_STEP);
  const _pitchEff = _standstillFix
    ? map.getPitch()
    : limitStep(_prevAppliedPitch, _pitch, PITCH_MAX_STEP_DEG);
  _prevAppliedZoom  = _zoomEff;
  _prevAppliedPitch = _pitchEff;
  /* Öğrenilen tavan BAŞTAN uygulanır — düzeltme sonraki karelere maliyet
     çıkarmaz (bkz. `_lookCapM`). */
  const _lookEff = _standstillFix ? 0 : Math.min(_lookAhead, _lookCapM);

  // Look-ahead centre — kilitli değerler ile hesaplanır
  const _lookDeg   = _lookEff / 111_320;
  const _cosLat    = Math.max(0.001, Math.cos((lat * Math.PI) / 180));
  const _bearRad   = (_bearing * Math.PI) / 180;
  const centerLat  = lat + _lookDeg * Math.cos(_bearRad);
  const centerLng  = lng + _lookDeg * Math.sin(_bearRad) / _cosLat;

  /* ── KOMPOZİSYON: aracın yeri POLİTİKADAN gelir (P0-NAV-03) ───────────────
   * Eski satır `containerHeight * target.topPadFrac` idi — `cameraPolicyModel`
   * ile YARIŞAN ikinci bir kompozisyon eğrisi. Artık hedef doğrudan aracın
   * ekrandaki oranıdır (`anchorY`) ve padding ondan TÜRETİLİR; ileri bakış payı
   * tahmin edilmez, `map.project` ile ÖLÇÜLÜP geri beslenir (aşağıya bakınız). */
  /* Ekran yönü FAIL-SOFT okunur: `getCanvas()` harita henüz kurulurken
     atabilir ve bu çağrı kamera uygulamasının ÖNÜNDEDİR — korumasız bırakmak,
     stil kapısı kusurunun (bu dosyanın §1 notu) aynısını geri getirirdi:
     kamera bir yan okuma yüzünden hiç uygulanmaz. Ölçülemezse YATAY varsayılır
     (head unit'lerin baskın hâli) ve kamera çalışmaya DEVAM eder. */
  let _orientation: 'LANDSCAPE' | 'PORTRAIT' = 'LANDSCAPE';
  try {
    const _cvNow = map.getCanvas();
    if (_cvNow && _cvNow.clientHeight > _cvNow.clientWidth) _orientation = 'PORTRAIT';
  } catch { /* ölçülemedi → yatay varsayılır */ }
  const _band = resolveSpeedBand(effectiveSpeed, _camPrevBand);
  _camPrevBand = _band;
  const _bandProfile = SPEED_BANDS.find((b) => b.id === _band) ?? SPEED_BANDS[0];
  const _wantAnchor = _orientation === 'PORTRAIT'
    ? _bandProfile.anchorYPortrait
    : _bandProfile.anchorYLandscape;
  /* Kare başı sıçrama tavanı: bant atlaması (CITY → CRUISE) anchor'ı bir karede
     zıplatır; sönümlemeden ÖNCE gelen sert sınır haritanın kaymasını engeller. */
  const _anchorY = limitStep(_prevAppliedAnchor, _wantAnchor, ANCHOR_MAX_STEP);
  _prevAppliedAnchor = _anchorY;

  const _padDecision = resolveTopPadForAnchor({
    anchorY: _anchorY,
    containerHeight,
    lookAheadPx: _anchorBiasPx,
  });
  const topPad = Math.round(_padDecision.topPad);

  /* ── KAMERA UYGULAMA: SIÇRAMA mı, AKIŞ mı (saha 2026-08-13) ────────────────
   * Eski yorum *"rAF loop 150ms throttle zaten smooth hissettiriyor"* diyordu;
   * ölçüldüğünde bu DOĞRU DEĞİLDİ: `jumpTo` bir animasyon üretmez, kamerayı o
   * kareye ANINDA taşır. Kamera 150 ms'de bir uygulandığı için harita fiilen
   * **6,7 fps**te güncelleniyordu — kullanıcının tarifi: *"harita akıcı değil,
   * takıla takıla gidiyor."* Araç işaretçisi 60 ms'de (~16 fps) güncellendiği
   * için işaretçi akarken zemin basamak basamak kayıyor, ayrışma daha da
   * göze batıyordu.
   *
   * Düzeltme: kareler arasını MapLibre'ın kendisi doldursun — süresi ÖLÇÜLEN
   * tick aralığına EŞİT, LİNEER bir `easeTo`. Süre tick'e eşit olduğu için
   * her animasyon bir sonraki başlamadan tam biter; üst üste binen animasyon
   * (bu dosyanın §126 notundaki 800 ms `easeTo` kusuru) OLUŞMAZ.
   *
   * ── BÜTÇE KAPILARI (yeni maliyet gelişigüzel açılmaz) ─────────────────────
   *  · `perf-low` (Mali-400 sınıfı head unit) → ESKİ DAVRANIŞ (`jumpTo`).
   *    Ara kareleri çizmek o GPU'da kazanç değil yüktür.
   *  · DURAKTA → `jumpTo`. §126'da ölçülen gerçek zarar buydu: boşta süren
   *    animasyon `map.isMoving()`i kalıcı `true` yapıp MapLibre'ı idle'da
   *    90 fps render'a sokuyordu. Araç durmuşken interpolasyonun kazancı da
   *    yoktur (zaten hareket yok).
   * Yani ek maliyet YALNIZ araç gerçekten hareket ederken ve GPU'su olan
   * cihazda doğar — tam da akıcılığın görüldüğü yerde. */
  const _smoothPan = !_standstillFix && !_isLowEndCamera();
  const _cameraOpts = {
    center:  [centerLng, centerLat] as [number, number],
    bearing: _bearing,
    zoom:    _zoomEff,
    pitch:   _pitchEff,
    padding: { top: topPad, bottom: 0, left: 0, right: 0 },
  };
  if (_smoothPan) {
    bumpPerf('map.cameraCommand');
    map.easeTo({
      ..._cameraOpts,
      duration: _cameraEaseDurationMs(),
      easing:   _LINEAR_EASING,   // sabit hız — her tick'te ivmelenip durmaz
      essential: true,            // "reduce motion" bunu KAPATAMAZ (takip kamerası)
    });
  } else {
    bumpPerf('map.cameraCommand');
    map.jumpTo(_cameraOpts);
  }

  // ── Araç ekran-içi garantisi (saha 2026-08-03) ────────────────────────────
  // Kamera aracın ÖNÜNÜ merkeze alır; `topPadFrac` orandır ama `lookAheadM`
  // metredir → kısa ekranlarda (telefon yatayı ~400 px) araç ALT KENARDAN
  // TAŞIYOR ve hız arttıkça büsbütün kayboluyordu. Tam gerekçe ve ölçüm:
  // `cameraEngine.clampTopPadForVehicle`.
  //
  // Ölçüm `map.project` ile YAPILIR (tahmin değil): pitch/bearing/zoom hepsi
  // hesaba katılmış GERÇEK ekran konumu. Taşma yoksa ikinci jumpTo ÇALIŞMAZ —
  // head unit yolu bu bloktan maliyetsiz çıkar.
  try {
    const _vehY    = map.project([lng, lat]).y;
    const _fixedPad = clampTopPadForVehicle(_vehY, containerHeight, topPad);
    let _padEff = topPad;
    if (_fixedPad !== null) {
      _padEff = _fixedPad;
      bumpPerf('map.cameraCommand');
      map.jumpTo({
        center:  [centerLng, centerLat],
        bearing: _bearing,
        zoom:    _zoomEff,
        pitch:   _pitchEff,
        padding: { top: _fixedPad, bottom: 0, left: 0, right: 0 },
      });
    }

    /* ── ARAÇ EKRANDA KALIR — PAZARLIKSIZ (saha 2026-08-03) ──────────────────
     * Yukarıdaki padding klipsi TEK BAŞINA yetmiyor: padding 0'a kadar kısılsa
     * bile ileri bakış yeterince büyükse araç ekranın ALTINDA kalır — klips
     * DOYUMA ULAŞIP SESSİZCE BAŞARISIZ OLUR. Cihazda ölçüldü: `padding.top = 0`
     * uygulanmışken araç ekran y ≈ 1217 px, canvas yüksekliği 405 px → araç
     * ekranın 800 px ALTINDA. Kullanıcı bunu "araba gidince görünmüyor,
     * geride kalıyor" ve "harita dengesiz duruyor" diye bildirdi.
     *
     * O ölçümdeki ileri bakış 121.8 m idi ve kaynağı PARK hâlindeki telefonda
     * 55–61 km/h'lik SAHTE GPS hızıydı. Hız otoritesi ayrıca düzeltildi, ama
     * kamera hiçbir hız değerine GÜVENMEK ZORUNDA KALMAMALI: hangi hız gelirse
     * gelsin araç ekranda kalır. Bu bir görsel tercih değil, sürüş güvenliği
     * invaryantıdır — sürücü kendi aracını göremezse ekran yanıltıcıdır.
     *
     * Yöntem: taşma GÖRÜLDÜĞÜNDE ileri-bakış tavanı (`_lookCapM`) yarılanır ve
     * bir kez düzeltilir; sonraki karelerde merkez zaten tavanlı hesaplandığı
     * için EK `jumpTo` gerekmez. Araç çerçevedeyse hiç iş yapılmaz — normal
     * sürüşte maliyet kare başına tek `project()`. (İlk uygulamam bunu her
     * karede yineleyen bir döngüyle yapıyordu ve cihazı ısıtıyordu.) */
    const _cv = map.getCanvas();
    const _h  = _cv.clientHeight;
    const _p2 = map.project([lng, lat]);
    const _framedNow = isVehicleFramed(_p2.x, _p2.y, _cv.clientWidth, _h);

    if (!_framedNow && _lookEff > 0) {
      // Taşma → tavanı YARILA ve BİR KEZ düzelt. Sonraki kareler tavanlı gelir.
      _lookCapM = _lookEff * 0.5;
      const _ld = _lookCapM / 111_320;
      bumpPerf('map.cameraCommand');
      map.jumpTo({
        center: [
          lng + (_ld * Math.sin(_bearRad)) / _cosLat,
          lat + _ld * Math.cos(_bearRad),
        ],
        bearing: _bearing,
        zoom:    _zoomEff,
        pitch:   _pitchEff,
        padding: { top: _padEff, bottom: 0, left: 0, right: 0 },
      });
    } else if (_framedNow && Number.isFinite(_lookCapM) && _p2.y < _h * 0.6) {
      /* Bol pay var → tavanı kademeli gevşet. Hız düşünce veya zoom değişince
         eski kısıt kalıcı olmasın; gevşeme yavaş olduğu için salınım yapmaz. */
      _lookCapM = _lookCapM * 1.15 + 3;
    }
    /* GÖLGE GÖZLEM — legacy'nin GERÇEKTEN uyguladığı değerler.
       `_p2.y` ZATEN yukarıda çerçeve denetimi için hesaplandı; gölge katmanı
       için EK Map API çağrısı YAPILMAZ. Koordinat GEÇİRİLMEZ. */
    /* ── ÖLÇÜLEN ANCHOR GERİ BESLEMESİ (P0-NAV-03) ────────────────────────
     * `_p2.y` ZATEN ölçüldü (ek Map API çağrısı YOK). İstenen anchor ile
     * gerçekleşen arasındaki fark küçük bir kazançla padding yanlılığına
     * işlenir → pitch/zoom/ekran boyu ne olursa olsun kompozisyon yakınsar.
     * Analitik `lookAheadPx` tahmini bilinçle KULLANILMADI: düz Mercator
     * pitch'i saymaz ve hatayı aracı ekran DIŞINA iten yönde yapar. */
    if (_h > 0 && !_standstillFix) {
      _anchorBiasPx = updateAnchorBias({
        prevBiasPx: _anchorBiasPx,
        measuredAnchorY: _p2.y / _h,
        desiredAnchorY: _anchorY,
        containerHeight: _h,
      }).biasPx;
    }
    _reportShadow(map, true, _zoomEff, _pitchEff, _bearing,
      _h > 0 ? _p2.y / _h : null, effectiveSpeed, _lookEff, _standstillFix);
  } catch { /* project() harita hazır değilken atabilir — kamera olduğu gibi kalır */ }

  // Smooth pitch tek kaynak — elevation + perspective aynı değeri kullanır ✓
  const pitch = smooth.pitch;

  // ── Elevation pass — dynamic shadow offset & blur (pitch + speed + zoom) ────
  const _currentZoom = map.getZoom();
  const _pitchChanged = Math.abs(pitch - M.lastShadowPitch) >= 3;
  const _zoomChanged  = Math.abs(_currentZoom - M.lastShadowZoom) >= 0.5;
  if ((_pitchChanged || _zoomChanged) && map.getLayer(ROUTE_SHADOW)) {
    M.lastShadowPitch = pitch;
    M.lastShadowZoom  = _currentZoom;
    M.lastBlurReduced = effectiveSpeed > 20;

    const shadowOffset  = Math.round(2 + (pitch / 72) * 10);
    const pitchBlur     = 5 + (pitch / 72) * 6;
    const speedScale    = effectiveSpeed > 20 ? 0.45 : 1.0;
    const zoomSharpness = 1 - Math.max(0, Math.min(1, (_currentZoom - 12) / 6)) * 0.65;
    const shadowBlur    = Math.max(1.5, Math.round(pitchBlur * speedScale * zoomSharpness));
    const glowBlur      = Math.max(2.5, Math.round((8 + (pitch / 72) * 4) * speedScale * zoomSharpness));
    safeSetPaint(map, ROUTE_SHADOW,   'line-offset', shadowOffset);
    safeSetPaint(map, ROUTE_SHADOW,   'line-blur',   shadowBlur);
    safeSetPaint(map, ROUTE_GLOW_SEL, 'line-blur',   glowBlur);
  }

  // ── Perspective correction ─────────────────────────────────────────────────
  /* ⚠️ ESKİ HÂL BEŞ KATMANIN İKİSİNİ EZİYORDU (ölçülen kusur — bkz.
   * `core/routeWidthModel` başlığı). Buradaki sayılar (8/32 · 14/38) kurulum
   * sayılarından (4/10 · 6/14) TAMAMEN BAĞIMSIZDI ve `perspScale` kapısı
   * durağan pitch'te bile ilk karede açıldığı için rota, navigasyon başlar
   * başlamaz 3,2× kalınlaşıyordu. Dahası gölge · halo · akış kalınlıkları
   * kurulumda kalıyordu → z18'de sıralama CASE 46 > CORE 39 > GLOW 24 >
   * SHADOW 22 olup neon halo ile derinlik gölgesi TAMAMEN kayboluyordu
   * (iki `line-blur` katmanı GPU yakıp ekrana hiçbir şey çizmiyordu).
   *
   * Artık BEŞİ de aynı politikadan, aynı çekirdekten türer; perspektif yalnız
   * bir ÇARPANDIR. Kalınlıkların mutlak seviyesi bilerek KORUNDU (referans
   * head unit'te çekirdek ve kılıf birebir aynı) — bu tur seviyeyi değil
   * TUTARLILIĞI ve viewport duyarlılığını düzeltir. */
  const perspScale = 1 + (pitch / 72) * 0.4;
  if (Math.abs(perspScale - M.lastPerspectiveScale) >= 0.06 && map.getLayer(SEL_LAYER)) {
    M.lastPerspectiveScale = perspScale;
    const rw = resolveRouteWidths(map, perspScale);
    safeSetPaint(map, ROUTE_SHADOW,   'line-width', routeWidthExpression(rw.shadow));
    safeSetPaint(map, ROUTE_GLOW_SEL, 'line-width', routeWidthExpression(rw.glow));
    safeSetPaint(map, ROUTE_CASE,     'line-width', routeWidthExpression(rw.casing));
    safeSetPaint(map, SEL_LAYER,      'line-width', routeWidthExpression(rw.core));
    safeSetPaint(map, ROUTE_FLOW,     'line-width', routeWidthExpression(rw.flow));
  }

  /* ── Maneuver tier — yalnız KADEME hesabı (renk kararı burada DEĞİL) ────────
   * AYNI KAPI: rota vurgusunun manevraya yaklaşınca güçlenmesi de bir MANEVRA
   * kararıdır. Kaynak yol-boyu değilse kademe YÜKSELMEZ — aksi hâlde kamera
   * susarken rota rengi hâlâ "kavşak geliyor" derdi (iki yüzey, iki gerçek). */
  const _mTier = !_gatedTurnM || _gatedTurnM >= 200 ? 0
    : _gatedTurnM >= 50 ? 1
    : 2;

  /* ── ROTA RENGİ — TEK KARAR NOKTASI (PR-3a) ────────────────────────────────
   * ⚠️ ESKİ HÂLDE BURADA İKİ AYRI BLOK VARDI ve ikisi de aynı iki özelliği
   * (`ROUTE_CASE`/`ROUTE_GLOW_SEL` `line-color`) KENDİ önbelleğine bakarak
   * yazıyordu — manevra bloğu `M.lastManeuverTier`, risk bloğu
   * `M.lastExternalRiskAlert`. Hakem yoktu ve manevra bloğu ÖNCE koşuyordu:
   *     risk 0,6 → amber · kademe 0→1 → amber · kademe 1→0 → BEYAZ
   *     risk hâlâ 0,6 ama bayrak değişmediği için risk bloğu HİÇ çalışmaz
   * → tehlike aktifken uyarı rengi KALICI olarak kayboluyordu (K1).
   *
   * Artık renk bir DURUM DEĞİŞİMİNDEN değil ANLIK DURUMDAN türer; öncelik
   * `core/routeColorModel` içinde açıkça tehlike > manevra > normal'dir ve
   * dedup tek anahtarladır. Boyayı yazan tek yer `MapLayerManager`tir. */
  syncRouteColor(map, _mTier, useHazardStore.getState().globalRiskScore > 0.5);

  // ── Intersection road suppression + tunnel glow (Faz 3.2) ──────────────────
  /* Bu blok RENK değil OPAKLIK yazar (`line-opacity`) — renk hakemiyle
     çakışmaz ve bilerek ayrı bırakıldı. */
  if (M.focusModeActive && _mTier !== M.lastIntersectionTier) {
    M.lastIntersectionTier = _mTier;
    _applyIntersectionSuppression(map, _mTier);
    const _glowOp = [0.20, 0.27, 0.36][_mTier] ?? 0.20;
    safeSetPaint(map, ROUTE_GLOW_SEL, 'line-opacity', _glowOp);
  }
}

/* ── Giriş kamerası yön kararının GÖZLEM YANKISI (#625) ────────────────────
 * Kararın gerekçesi CAROS LAB'da okunabilsin diye saklanır. Tek nesne,
 * büyümez, geçmiş tutmaz; ürün akışını hiçbir şekilde etkilemez. */
let _lastEntryBearing: (EntryBearingDecision & { at: number }) | null = null;

/** Son giriş kamerası yön kararı — hiç girilmediyse null. */
export function getLastEntryBearingDecision(): (EntryBearingDecision & { at: number }) | null {
  return _lastEntryBearing;
}

/** Test yalıtımı — üretim yolunda ÇAĞRILMAZ. */
export function _resetEntryBearingForTest(): void { _lastEntryBearing = null; }

/**
 * Navigation entry animation — called ONCE when the user taps "Başlat".
 *
 * ── #625: YÖN ARTIK KARARA BAĞLI ────────────────────────────────────────────
 * Eskiden bu fonksiyon HER çağrı yerinde `headingRef.current ?? 0` ile, yani
 * ham GPS heading (ya da kuzey) ile çağrılıyordu — dokümantasyonu "first route
 * step direction or GPS heading" dediği hâlde rota yönü hiç kullanılmıyordu.
 * Cihazda ölçülen sonuç: park hâlindeki araçta kamera rotanın 257° tersine
 * kuruldu ve rotanın 309 noktasının **0'ı** ekranda kaldı; araç hareket
 * etmediği için hiçbir kod bunu düzeltmedi (`setDrivingView`in yön düzeltmesi
 * >5 km/h ister). Karar artık `resolveEntryBearing` içinde ve gerekçesiyle
 * birlikte saklanıyor.
 *
 * @param gpsHeading      Ham GPS heading (derece) — durağan araçta ANLAMSIZDIR.
 * @param routeBearing    Rotanın ileri yönü (`resolveRouteForwardBearing`), yoksa null.
 * @param speedKmh        Anlık hız; bilinmiyorsa null → DURAĞAN varsayılır (fail-safe).
 */
export function enterNavigationView(
  map: MapLibreMap,
  lat: number,
  lng: number,
  gpsHeading: number,
  containerHeight: number,
  routeBearing?: number | null,
  speedKmh?: number | null,
) {
  // easeTo kamera işlemi stil gerektirmez — isStyleLoaded() tile yüklenirken de
  // false döndüğünden "Başlat" anında giriş animasyonunu sessizce yutuyordu
  // (setDrivingView'daki kök nedenin kardeşi, 2026-07-04).
  if (!map) return;

  const TARGET_ZOOM    = 18.0; // Yakın yol detayı
  const TARGET_PITCH   = 38;   // 40°+ üzerinde siyah köşe riski artar
  const DURATION_MS    = 1000; // Yumuşak giriş animasyonu

  let _curBear: number | null = null;
  try { _curBear = map.getBearing(); } catch { _curBear = null; }

  const _decision = resolveEntryBearing({
    routeBearing: routeBearing ?? null,
    gpsHeading: Number.isFinite(gpsHeading) ? gpsHeading : null,
    speedKmh: speedKmh ?? null,
    currentBearing: _curBear,
  });
  _lastEntryBearing = { ..._decision, at: Date.now() };

  /* `bearing === null` = "kamerayı döndürme". Mevcut yön okunamadıysa (harita
     bozuk) 0'a düşmek zorundayız; ama bu artık bir VARSAYILAN değil, ölçülmüş
     bir yokluğun son çaresidir. */
  const bearing = _decision.bearing ?? _curBear ?? 0;

  // Smooth camera state'i giriş noktasıyla eşitle — ilk tick'te jump olmasın
  resetCameraSmooth({ zoom: TARGET_ZOOM, pitch: TARGET_PITCH, lookAheadM: 30, bearing });
  /* Giriş animasyonu boyunca geçen süre bir "tick aralığı" DEĞİLDİR; ölçümü
     sıfırla ki ilk takip karesi 1 sn'lik sahte bir Δt ile hesaplanmasın. */
  _resetCameraCadence();

  const lookAheadDeg = 30 / 111_320;
  const headRad      = (bearing * Math.PI) / 180;
  const cosLat       = Math.max(0.001, Math.cos((lat * Math.PI) / 180));
  const centerLat    = lat + lookAheadDeg * Math.cos(headRad);
  const centerLng    = lng + lookAheadDeg * Math.sin(headRad) / cosLat;

  const topPad = Math.round(containerHeight * 0.48);

  bumpPerf('map.cameraCommand');
  map.easeTo({
    center:  [centerLng, centerLat],
    bearing,
    zoom:    TARGET_ZOOM,
    pitch:   TARGET_PITCH,
    padding: { top: topPad, bottom: 0, left: 0, right: 0 },
    duration: DURATION_MS,
    essential: true,
  });
}

/**
 * Reset bearing, zoom, pitch and padding after leaving driving mode.
 */
export function exitDrivingView(map: MapLibreMap) {
  if (!map) return;
  // İDEMPOTENT: zaten driving-view dışındaysak HİÇBİR ŞEY yapma. Aksi halde her
  // heading değişiminde easeTo başlar → isMoving kalıcı true → sürekli render.
  if (!_drivingViewActive) return;
  _drivingViewActive = false;
  M.lastPerspectiveScale  = 1.0;
  M.lastShadowPitch       = -1.0;
  M.lastShadowZoom        = -1.0;
  M.lastMoodScore         = -1.0;
  M.lastHazardZoom        = 0;
  // Camera smooth state'i sıfırla — sonraki navigasyonda jump olmasın
  resetCameraSmooth({ zoom: PARK_VIEW_ZOOM, pitch: 0, lookAheadM: 0, bearing: 0 });
  /* Sürüş bittiğinde kadans ölçümü de biter: bir sonraki oturumun ilk karesi
     "iki oturum arası geçen süre" kadar Δt görmemelidir. */
  _resetCameraCadence();
  /* Route layer state restore — burada da renk ELLE yazılmaz. Sürüş bitti:
     kademe 0, tehlike ANLIK durumdan okunur. Tehlike hâlâ yüksekse rota amber
     KALIR; eskiden burada koşulsuz beyaza dönülüyordu (K1'in üçüncü yolu). */
  if (map.isStyleLoaded()) {
    syncRouteColor(map, 0, useHazardStore.getState().globalRiskScore > 0.5, true);
  }
  bumpPerf('map.cameraCommand');
  map.easeTo({
    bearing: 0,
    zoom: PARK_VIEW_ZOOM,
    pitch: 0,
    padding: { top: 0, bottom: 0, left: 0, right: 0 },
    duration: 800,
  });
}

export function setDrivingMode(enabled: boolean) {
  useMapStore.setState({ drivingMode: enabled });
}

export function useDrivingMode() {
  return useMapStore((s) => s.drivingMode);
}
