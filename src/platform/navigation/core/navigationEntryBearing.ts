/**
 * navigationEntryBearing.ts — navigasyon GİRİŞ kamerasının yön kararı (#625).
 *
 * ── NEDEN VAR (cihazda ÖLÇÜLDÜ, 2026-08-18 07:31, Xiaomi 23090RA98I) ────────
 * Rota aktifken (27,3 km · Mersin/Akdeniz) gece haritasında rota EKRANDA HİÇ
 * YOKTU. Boya kusursuzdu (çekirdek `#79b0ff` → WCAG parlaklık 0,424 = hedefin
 * birebir kendisi), ama MapLibre 5 rota katmanının hiçbirini çizmiyordu:
 * rotanın **309 noktasının 0'ı** görüş alanındaydı. Ölçüm:
 *
 *     araç ekranda (451, 301) · rotanın ilk noktası (465, **432**)
 *     pencere 902×405  → rota, ekranın 27 px ALTINDA kalıyor
 *     kamera bearing −42,5° (kuzeybatı) · rota güneybatıya gidiyor
 *     kamera zoom 18,0 · pitch 38 → `enterNavigationView` sabitlerinin BİREBİR kendisi
 *
 * KÖK: `enterNavigationView` altı çağrı yerinin HEPSİNDE `bear =
 * headingRef.current ?? 0` ile, yani **GPS heading** ile çağrılıyordu — kendi
 * dokümantasyonu *"first route step direction or GPS heading"* dediği hâlde
 * rota yönü hiç kullanılmıyordu. Araç park hâlindeyken GPS heading FİZİKSEL
 * OLARAK ANLAMSIZDIR (Doppler yok; değer son hareketten kalır ya da gürültüdür),
 * `?? 0` dalı ise kamerayı düpedüz KUZEYE çevirir. Kamera bir kez yanlış yöne
 * kurulduktan sonra araç hareket etmediği sürece hiçbir kod bunu düzeltmez:
 * `setDrivingView`in durakta yön düzeltmesi (`oriented`) ancak sürüş dalında
 * çalışır ve o dal >5 km/h ister.
 *
 * OEM KARŞILAŞTIRMASI: Google/BMW/Mercedes'te "Başlat"a basıldığı an kamera
 * rotanın ilk adımına döner — araç dursa bile. Bizde dönmüyordu.
 *
 * SAF: I/O yok · timer yok · `Date.now` yok · modül durumu yok · React yok.
 * Karar yalnız verilen girdilerden türetilir ve GEREKÇESİ birlikte döner
 * (gözlemlenebilirlik: LAB bu gerekçeyi olduğu gibi gösterebilir).
 */

import { segmentBearingDeg, hav } from './geo';

/**
 * GPS heading'in güvenilir sayıldığı en düşük hız (km/h).
 *
 * `CAMERA_CFG.JITTER_SPEED_KMH` ile AYNI değerdir ve bu tesadüf değildir:
 * kamera motorunun "durakta GPS heading'i kovalama" eşiği de budur
 * (`MapInteractionManager._standstillFix`). Aynı fizik, aynı eşik — ikinci bir
 * "hareket ediyor mu" otoritesi KURULMAZ.
 */
export const HEADING_TRUST_KMH = 5;

/**
 * Rotanın ileri yönünü hesaplarken kabul edilen EN KISA taban (metre).
 * Bunun altında iki nokta arası açı GPS/geometri gürültüsüne boğulur ve
 * kamerayı rastgele döndürür. Üründeki mevcut iki kopyada da 8 m'ydi.
 */
export const ROUTE_FORWARD_MIN_M = 8;

/** Giriş yönünün NEREDEN geldiği — kanıtlı gerekçe, tahmin değil. */
export type EntryBearingSource = 'ROUTE' | 'GPS_HEADING' | 'CAMERA_HOLD';

export interface EntryBearingInput {
  /** Rotanın ileri yönü (0..360) — hesaplanamadıysa null. */
  readonly routeBearing: number | null;
  /** GPS heading (0..360) — yoksa null. */
  readonly gpsHeading: number | null;
  /** Anlık hız (km/h) — bilinmiyorsa null (durağan VARSAYILIR: fail-safe). */
  readonly speedKmh: number | null;
  /** Kameranın MEVCUT yönü — son çare; okunamadıysa null. */
  readonly currentBearing: number | null;
}

export interface EntryBearingDecision {
  /**
   * Uygulanacak yön. `null` = KAMERAYI DÖNDÜRME (hiçbir güvenilir kaynak yok).
   * Çağıran bunu "kuzeye çevir" diye yorumlamamalıdır — eski `?? 0` kusuru
   * tam olarak buydu.
   */
  readonly bearing: number | null;
  readonly source: EntryBearingSource;
  /** Kararın tek cümlelik gerekçesi — LAB'da olduğu gibi gösterilebilir. */
  readonly reason: string;
}

function _norm(deg: number | null): number | null {
  if (deg === null || !Number.isFinite(deg)) return null;
  return ((deg % 360) + 360) % 360;
}

/**
 * Giriş kamerasının yönünü KARARA bağla.
 *
 * ── SÖZLEŞME ────────────────────────────────────────────────────────────────
 *  · Araç durağansa (hız < `HEADING_TRUST_KMH`, ya da hız BİLİNMİYORSA) yön
 *    ROTADAN alınır. Gerekçe fiziktir: durağan araçta GPS heading ölçülemez.
 *  · Araç hareket hâlindeyse GPS heading üstündür — MEVCUT DAVRANIŞ KORUNUR.
 *    Sürücü rotadan çıkmış olabilir; o durumda doğru olan gerçek yöndür.
 *  · Hiçbir güvenilir kaynak yoksa kamera OLDUĞU GİBİ bırakılır (`CAMERA_HOLD`).
 *    Kuzeye çevirmek bir karar değil, kaybedilmiş bir varsayılandır.
 */
export function resolveEntryBearing(input: EntryBearingInput): EntryBearingDecision {
  const route = _norm(input.routeBearing);
  const gps   = _norm(input.gpsHeading);
  const cur   = _norm(input.currentBearing);

  /* Hız bilinmiyorsa DURAĞAN sayılır: yanlış tarafa düşmenin bedeli simetrik
     değildir. Durağanı hareketli sanmak kamerayı gürültülü heading'e bağlar
     (ölçülen kusur); hareketliyi durağan sanmak yalnız kamerayı rotaya hizalar
     ve bir sonraki tick zaten gerçek heading'i getirir. */
  const moving = input.speedKmh !== null
    && Number.isFinite(input.speedKmh)
    && input.speedKmh >= HEADING_TRUST_KMH;

  if (!moving) {
    if (route !== null) {
      return {
        bearing: route, source: 'ROUTE',
        reason: `Araç durağan (${input.speedKmh === null ? 'hız bilinmiyor' : `${Math.round(input.speedKmh)} km/h`})`
          + ' — GPS heading ölçülemez; yön ROTADAN alındı.',
      };
    }
    if (gps !== null) {
      return {
        bearing: gps, source: 'GPS_HEADING',
        reason: 'Araç durağan ama rota yönü hesaplanamadı (adım yok ya da taban '
          + `${ROUTE_FORWARD_MIN_M} m altında); son bilinen GPS heading kullanıldı.`,
      };
    }
    return {
      bearing: cur, source: 'CAMERA_HOLD',
      reason: 'Ne rota yönü ne GPS heading var — kamera DÖNDÜRÜLMEDİ '
        + '(kuzeye çevirmek bir karar değildir).',
    };
  }

  if (gps !== null) {
    return {
      bearing: gps, source: 'GPS_HEADING',
      reason: `Araç hareket hâlinde (${Math.round(input.speedKmh as number)} km/h) — `
        + 'GPS heading güvenilir ve sürücünün GERÇEK yönüdür (rotadan çıkmış olabilir).',
    };
  }
  if (route !== null) {
    return {
      bearing: route, source: 'ROUTE',
      reason: 'Araç hareket hâlinde ama GPS heading yok — yön ROTADAN alındı.',
    };
  }
  return {
    bearing: cur, source: 'CAMERA_HOLD',
    reason: 'Hareket hâlinde ama hiçbir yön kaynağı okunamadı — kamera DÖNDÜRÜLMEDİ.',
  };
}

/** Rota adımının kamera için yeterli olan en küçük yapısal şekli. */
export interface RouteStepLike {
  /** `[lon, lat]` — üründeki `RouteStep.coordinate` ile aynı sıra. */
  readonly coordinate?: readonly number[] | null;
}

/**
 * Rotanın İLERİ yönü: araçtan BİR SONRAKİ manevra adımına olan açı.
 *
 * ── NEDEN BU OTORİTE ────────────────────────────────────────────────────────
 * Üründe bu hesabın İKİ kopyası vardı (`FullMapView` ve `MiniMapWidget`) ve
 * ikisi de aynı kuralı uyguluyordu: `currentStepIndex + 1` adımı, 8 m'den
 * yakınsa üretme. Üçüncü bir kopya yazmak yerine kural BURAYA taşındı; iki
 * çağıran da bunu kullanır. Paralel bir "ileri yön" otoritesi KURULMAZ.
 *
 * @returns 0..360 derece, ya da hesaplanamadıysa `null` (uydurma YOK).
 */
export function resolveRouteForwardBearing(
  lat: number,
  lng: number,
  steps: readonly RouteStepLike[] | null | undefined,
  currentStepIndex: number,
): number | null {
  if (!steps || steps.length === 0) return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  const next = currentStepIndex + 1;
  if (next < 0 || next >= steps.length) return null;

  const c = steps[next]?.coordinate;
  if (!c || c.length < 2) return null;
  const lon2 = c[0];
  const lat2 = c[1];
  if (!Number.isFinite(lon2) || !Number.isFinite(lat2)) return null;

  /* Taban çok kısaysa açı gürültüdür — ÜRETİLMEZ (kanıtsız bilgi yasağı). */
  if (hav(lat, lng, lat2, lon2) <= ROUTE_FORWARD_MIN_M) return null;

  return segmentBearingDeg(lat, lng, lat2, lon2);
}
