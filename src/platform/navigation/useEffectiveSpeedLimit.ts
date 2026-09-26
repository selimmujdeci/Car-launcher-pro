/**
 * useEffectiveSpeedLimit.ts — UYGULANABİLİR hız sınırının TEK UI girişi.
 *
 * ── NEDEN BU DOSYA VAR (görev §0: "iki ayrı motor kurma") ───────────────────
 * Denetimde bulunan somut kusur: mini harita ile tam ekran AYNI değeri
 * göstermiyordu.
 *   · `MiniMapWidget` paylaşılan gözlemi okuyup `classifySpeedLimit` ile
 *     sınıflandırıyordu (bayat/çıkarım/çelişki elenmiş).
 *   · `NavigationHUD` ise `useSpeedLimitByLocation` hook'unun DÖNÜŞ DEĞERİNİ
 *     kullanıyordu. O değer hook'un YEREL state'idir ve yalnız **sorgu sahibi**
 *     örnekte dolar. Mini harita önce mount olduğunda sahiplik onda kalıyor,
 *     tam ekrandaki hook `null` dönüyor ve **HUD levhası hiç çıkmıyordu**;
 *     tersi durumda ise HUD sınıflandırmadan geçmemiş ham değeri gösteriyordu.
 *
 * Artık iki ekran da bu hook'u çağırır: aynı konum, aynı sınıflandırma, aynı
 * araç sınıfı, aynı hüküm. İkinci otorite YOKTUR.
 *
 * Bu hook YENİ VERİ KAYNAĞI DEĞİLDİR: mevcut Overpass sorgu döngüsünü
 * (`useSpeedLimitByLocation`, modül düzeyinde tek sahipli) ve mevcut araç
 * sınıfı çalışma zamanını okur; kendisi ağa çıkmaz, timer kurmaz.
 */

import { useSpeedLimitByLocation, useSpeedLimitObservation } from '../speedLimitService';
import { classifySpeedLimit } from './core/speedLimitTruthModel';
import { resolveRoadClass } from './policy/roadClassResolver';
import {
  computeEffectiveSpeedLimit, type EffectiveSpeedLimit,
} from './core/vehicleAwareSpeedLimitAuthority';
import { useVehicleClassSnapshot } from '../vehicle/vehicleClassRuntime';
import { useGPSLocation } from '../gpsService';
import { useNavigation, NavStatus, getSnappedMarkerPosition, getRouteProgressPoint } from '../navigationService';
import { getRouteState } from '../routingService';
import { speedLimitOnRouteAt } from '../routing/tomtomRouting';
import type { SpeedLimitObservation } from './core/speedLimitTruthModel';

/**
 * Aktif rotanın sağlayıcısı (TomTom) aracın bulunduğu segment için yasal hız
 * sınırı bildirdiyse onu GÖZLEM olarak döndürür; yoksa `null`.
 * Koşul: navigasyon canlı ve araç rotaya OTURMUŞ (`getRouteProgressPoint` —
 * koridor dışında null) — aksi hâlde rotanın limiti aracın yolu olmayabilir.
 * Yeni otorite DEĞİL: aynı sınıflandırıcıdan (`classifySpeedLimit`) geçer.
 */
function _routeSpeedLimitObservation(navLive: boolean): SpeedLimitObservation | null {
  if (!navLive) return null;
  try {
    const prog = getRouteProgressPoint();
    if (!prog) return null;
    const kmh = speedLimitOnRouteAt(getRouteState().speedLimitSections ?? [], prog.segIdx);
    if (kmh === null) return null;
    return {
      kmh, source: 'route', resolvedAtMs: performance.now(),
      resolvedAtLat: prog.lat, resolvedAtLon: prog.lon, conflicting: false, highway: null,
    };
  } catch { return null; }
}

/**
 * Aracın hız limiti için KANONİK konumu.
 *
 * Rota aktifken map-matched (snapped) konum tercih edilir — aracın gerçekten
 * üzerinde olduğu segment odur. Harita SÜRÜKLENDİĞİNDE kamera merkezi değişir
 * ama bu değer DEĞİŞMEZ → levha yanlış yola göre güncellenmez (görev §9).
 */
export function useSpeedLimitAnchor(): { lat: number | null; lon: number | null } {
  const location = useGPSLocation();
  const { status } = useNavigation();
  const navLive = status === NavStatus.ACTIVE || status === NavStatus.REROUTING;
  const snapped = navLive ? getSnappedMarkerPosition() : null;
  return {
    lat: snapped?.lat ?? location?.latitude ?? null,
    lon: snapped?.lon ?? location?.longitude ?? null,
  };
}

/**
 * Yol + araç birleşik hız sınırı hükmü.
 *
 * `allowInferred = false`: yol SINIFINDAN çıkarım levha sayılmaz ve
 * gösterilmez. Bu kilit bilinçlidir — çıkarım tablosu zaten M1 (otomobil)
 * yasal değerleridir; onu bir N1 araca "yol limiti" diye sunmak bu turun
 * kapattığı hatanın ta kendisidir.
 */
export function useEffectiveSpeedLimit(): EffectiveSpeedLimit {
  const { lat, lon } = useSpeedLimitAnchor();

  /* Sorgu döngüsünün sahipliği servis içinde modül düzeyinde kilitlidir:
     iki bileşen de çağırsa YALNIZ biri ağ trafiği açar. */
  useSpeedLimitByLocation(lat, lon);
  const obs = useSpeedLimitObservation();
  const vehicle = useVehicleClassSnapshot();
  const { status } = useNavigation();

  /* Rotada ve sağlayıcı sınır bildirdiyse o kullanılır (Türkiye'de OSM `maxspeed`
     kapsamı zayıf); yoksa OSM sorgusu — ikisi AYNI sınıflandırıcıdan geçer. */
  const routeObs = _routeSpeedLimitObservation(
    status === NavStatus.ACTIVE || status === NavStatus.REROUTING);
  const chosen: SpeedLimitObservation = routeObs ?? obs;
  const road = classifySpeedLimit(chosen, { lat, lon, nowMs: performance.now() }, false);
  const roadClass = resolveRoadClass({
    highway: obs.highway ?? null,
    postedKmh: chosen.kmh,
    postedSource: chosen.source,
  });

  return computeEffectiveSpeedLimit({ road, roadClass, vehicleClass: vehicle.profile });
}
