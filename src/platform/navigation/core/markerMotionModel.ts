/**
 * markerMotionModel.ts — araç işaretinin EKRANDA nerede çizileceği (SAF).
 *
 * SAF: I/O YOK · timer YOK · RAF YOK · `Date.now` YOK · React YOK · global durum YOK.
 * Saat DIŞARIDAN gelir → testler deterministiktir.
 *
 * ── NEDEN VAR ───────────────────────────────────────────────────────────────
 * Denetimde ölçülen kusur: **aynı üründe iki farklı akıcılık.**
 *   · `FullMapView` kendi RAF döngüsünde `interpolateNavPoint` ile ara değer
 *     üretiyordu (akıcı).
 *   · `MiniMapWidget` marker'ı DOĞRUDAN GPS geri çağrısında güncelliyordu
 *     (`MiniMapWidget.tsx:535`) ve GPS tavanı 2 Hz'dir
 *     (`gpsService.ts` `GPS_NAV_MAX_INTERVAL_MS = 500`) → araç saniyede iki kez
 *     ZIPLIYORDU. "Amatör görünüm" şikâyetinin en görünür kaynağı buydu.
 *
 * Bu dosya "şu anda nereye çizilmeli?" sorusunun TEK cevabını üretir. İki ekran
 * da aynı fonksiyondan geçer → farklı akıcılık YAPISAL olarak imkânsızdır.
 *
 * ── DÜRÜSTLÜK SINIRLARI ─────────────────────────────────────────────────────
 *  · **Yapay mesafe üretilmez:** araç gerçekten hareket etmiyorsa (hız eşiğin
 *    altında) ekstrapolasyon YAPILMAZ — duran araç ekranda kaymaz.
 *  · **Büyük GPS sıçraması animasyonla meşrulaştırılmaz:** sıçrama tespit
 *    edilirse ara değer üretilmez, konum doğrudan uygulanır ve durum
 *    `SNAP_CORRECTION` olarak İLAN EDİLİR.
 *  · **Bayat konumda hareket uydurulmaz:** `STALE` durumunda son konum donar.
 */

/** İşaretin hareket durumu. */
export type MarkerMotionState =
  /** İki fix arası ara değer üretiliyor (normal akıcı hareket). */
  | 'INTERPOLATING'
  /** Son fix'e ulaşıldı; sınırlı ekstrapolasyon veya doğrudan takip. */
  | 'TRACKING'
  /** Konum sıçradı veya eşleştirme düzeltmesi uygulanıyor — animasyon YOK. */
  | 'SNAP_CORRECTION'
  /** GPS doğruluğu bozuk — hareket gösterilir ama ekstrapolasyon yapılmaz. */
  | 'GPS_DEGRADED'
  /** Konum çok yaşlı — işaret DONAR. */
  | 'STALE'
  /** Hiç örnek yok. */
  | 'UNKNOWN';

export const MARKER_MOTION_STATE_LABEL: Readonly<Record<MarkerMotionState, string>> = {
  INTERPOLATING:   'ARA DEĞER',
  TRACKING:        'TAKİP',
  SNAP_CORRECTION: 'DÜZELTME (animasyonsuz)',
  GPS_DEGRADED:    'GPS BOZUK',
  STALE:           'BAYAT — DONDU',
  UNKNOWN:         'BİLİNMİYOR',
} as const;

export interface MotionSample {
  readonly lat: number;
  readonly lon: number;
  /** Derece; bilinmiyorsa `null` → önceki yön KORUNUR (ani dönüş yok). */
  readonly headingDeg: number | null;
  readonly speedKmh: number;
  /** GPS doğruluk yarıçapı (m); bilinmiyorsa `null`. */
  readonly accuracyM: number | null;
  /** Monotonik zaman damgası (`performance.now`). */
  readonly tsMs: number;
  /** Bu örnek rota üzerine oturtulmuş (map-matched) mu. */
  readonly matched: boolean;
}

export interface RenderedMotion {
  /** Çizilecek konum — `state === 'UNKNOWN'` iken `null`. */
  readonly lat: number | null;
  readonly lon: number | null;
  /** Çizilecek yön (derece) — `null` = yön bilinmiyor, çağıran öncekini korur. */
  readonly bearingDeg: number | null;
  readonly state: MarkerMotionState;
  /** [0..1+] — iki fix arasındaki ilerleme; >1 = ekstrapolasyon. */
  readonly interpolationProgress: number;
  /** Son gerçek örneğin yaşı (ms). */
  readonly sourceAgeMs: number;
  /** [0..1] — yaş ve doğrulukla azalır. Uydurma değil TÜREVDİR. */
  readonly confidence: number;
  readonly reason: string;
}

/* ── Eşikler ────────────────────────────────────────────────────────────────
 * Bunlar uydurulmadı; mevcut ölçülmüş davranıştan türetildi:
 *  · GPS tavanı 2 Hz (`GPS_NAV_MAX_INTERVAL_MS = 500`) → iki fix arası ~500 ms.
 *  · `FullMapView` DR kapısı GPS'i 5 sn'de bayat sayıyor (`GPS_STALE_MS`).
 *  · Sapma kapısı 50 m üstü doğruluğu "zayıf sinyal" sayıyor
 *    (`routingService.updateRouteProgress` reroute kapısı). */

/** Bu süreden sonra konum bayat sayılır → işaret DONAR. */
export const MOTION_STALE_MS = 5_000;
/** Ekstrapolasyon için izin verilen azami süre (ms) — zombi hareket önlenir. */
export const MOTION_MAX_EXTRAPOLATION_MS = 700;
/** Bu hızın altında ekstrapolasyon YAPILMAZ (duran araç kaymaz). */
export const MOTION_MIN_EXTRAPOLATION_KMH = 3;
/** Bu doğruluğun üstünde GPS bozuk sayılır. */
export const MOTION_DEGRADED_ACCURACY_M = 50;
/** Sıçrama toleransı: beklenen yer değiştirmenin bu katı + doğruluk payı. */
export const MOTION_JUMP_FACTOR = 3;
/** Sıçrama kapısının taban payı (m) — düşük hızda gürültü sıçrama sayılmasın. */
export const MOTION_JUMP_FLOOR_M = 25;

const _EMPTY: RenderedMotion = {
  lat: null, lon: null, bearingDeg: null, state: 'UNKNOWN',
  interpolationProgress: 0, sourceAgeMs: 0, confidence: 0,
  reason: 'hiç konum örneği yok',
};

function _lerp(a: number, b: number, t: number): number { return a + (b - a) * t; }

/** Açısal ara değer — 0/360 geçişini kısa yaydan yapar. */
export function lerpBearing(a: number, b: number, t: number): number {
  /* ⚠️ JS `%` KALAN operatörüdür, modulo değil: negatif girdide negatif döner.
     Bu tuzak `utils/interpolation.lerpAngle` içinde GERÇEK bir kusura yol
     açmıştı — araç KUZEYE giderken (350°→10°) işaret 180° ters dönüyordu.
     Burada gerçek modulo uygulanır. */
  const diff = ((((b - a + 180) % 360) + 360) % 360) - 180;
  return (((a + diff * t) % 360) + 360) % 360;
}

function _haversineM(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 6_371_000;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLon = ((bLon - aLon) * Math.PI) / 180;
  const s = Math.sin(dLat / 2) ** 2
    + Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

/**
 * İki örnek arasındaki yer değiştirme FİZİKSEL olarak mümkün mü.
 *
 * Mümkün değilse bu bir GPS sıçramasıdır (tünel çıkışı, çok yollu yansıma) ve
 * ara değerle YUMUŞATILMAZ: yumuşatmak, olmamış bir hareketi olmuş gibi
 * göstermektir. Doğrudan uygulanır ve durum ilan edilir.
 */
export function isImplausibleJump(prev: MotionSample, cur: MotionSample): boolean {
  const dtSec = Math.max(0, (cur.tsMs - prev.tsMs) / 1000);
  const movedM = _haversineM(prev.lat, prev.lon, cur.lat, cur.lon);
  const speedKmh = Math.max(prev.speedKmh, cur.speedKmh);
  const expectedM = (speedKmh / 3.6) * dtSec;
  const accM = Math.max(prev.accuracyM ?? 0, cur.accuracyM ?? 0);
  const budget = Math.max(MOTION_JUMP_FLOOR_M, expectedM * MOTION_JUMP_FACTOR + accM);
  return movedM > budget;
}

export interface RenderedMotionInput {
  /** Bir önceki gerçek örnek — `null` = tek örnek var. */
  readonly prev: MotionSample | null;
  /** En son gerçek örnek. */
  readonly cur: MotionSample | null;
  /** Şimdiki monotonik zaman. */
  readonly nowMs: number;
  /** Önceki karede çizilen yön — yön bilinmiyorsa KORUNUR. */
  readonly lastBearingDeg?: number | null;
}

/**
 * O anda çizilecek konumu/yönü hesaplar.
 *
 * Çağıran her karede (RAF) çağırabilir; fonksiyon SAFtır ve durum tutmaz.
 */
export function computeRenderedMotion(input: RenderedMotionInput): RenderedMotion {
  const { prev, cur, nowMs, lastBearingDeg = null } = input;
  if (!cur || !Number.isFinite(cur.lat) || !Number.isFinite(cur.lon)) return _EMPTY;

  const ageMs = Math.max(0, nowMs - cur.tsMs);
  const bearingOf = (s: MotionSample): number | null =>
    (s.headingDeg !== null && Number.isFinite(s.headingDeg)) ? s.headingDeg : lastBearingDeg;

  /* ── BAYAT: hareket UYDURULMAZ, işaret donar ─────────────────────────────── */
  if (ageMs > MOTION_STALE_MS) {
    return {
      lat: cur.lat, lon: cur.lon, bearingDeg: bearingOf(cur),
      state: 'STALE', interpolationProgress: 1, sourceAgeMs: ageMs, confidence: 0,
      reason: 'konum çok yaşlı — işaret donduruldu',
    };
  }

  const accM = cur.accuracyM;
  const degraded = accM !== null && Number.isFinite(accM) && accM > MOTION_DEGRADED_ACCURACY_M;

  /* ── Tek örnek: ara değer üretilemez ─────────────────────────────────────── */
  if (!prev) {
    return {
      lat: cur.lat, lon: cur.lon, bearingDeg: bearingOf(cur),
      state: degraded ? 'GPS_DEGRADED' : 'TRACKING',
      interpolationProgress: 1, sourceAgeMs: ageMs,
      confidence: degraded ? 0.3 : 0.7,
      reason: degraded ? 'tek örnek + GPS doğruluğu zayıf' : 'tek örnek — ara değer yok',
    };
  }

  /* ── SIÇRAMA: animasyonla MEŞRULAŞTIRILMAZ ───────────────────────────────── */
  if (isImplausibleJump(prev, cur)) {
    return {
      lat: cur.lat, lon: cur.lon, bearingDeg: bearingOf(cur),
      state: 'SNAP_CORRECTION', interpolationProgress: 1, sourceAgeMs: ageMs,
      confidence: 0.4,
      reason: 'fiziksel olarak mümkün olmayan sıçrama — doğrudan uygulandı',
    };
  }

  /* ── EŞLEŞTİRME DÜZELTMESİ: rota üzerine oturma da bir sıçramadır ─────────
   * Ham fix'ten map-matched konuma geçiş görsel olarak ani olabilir; ara değer
   * üretmek yerine kontrollü biçimde doğrudan uygulanır ve ilan edilir. */
  if (cur.matched !== prev.matched) {
    return {
      lat: cur.lat, lon: cur.lon, bearingDeg: bearingOf(cur),
      state: 'SNAP_CORRECTION', interpolationProgress: 1, sourceAgeMs: ageMs,
      confidence: 0.6,
      reason: 'eşleştirme kaynağı değişti — kontrollü düzeltme',
    };
  }

  const spanMs = cur.tsMs - prev.tsMs;
  if (!(spanMs > 0)) {
    return {
      lat: cur.lat, lon: cur.lon, bearingDeg: bearingOf(cur),
      state: degraded ? 'GPS_DEGRADED' : 'TRACKING',
      interpolationProgress: 1, sourceAgeMs: ageMs,
      confidence: degraded ? 0.3 : 0.6,
      reason: 'geçersiz zaman aralığı',
    };
  }

  const rawT = (nowMs - prev.tsMs) / spanMs;

  /* ── EKSTRAPOLASYON KAPISI ────────────────────────────────────────────────
   * `t > 1` demek son fix'in ÖTESİNE geçmek demektir. İzin verilir, ama:
   *  (a) yalnız araç GERÇEKTEN hareket ediyorsa (yapay mesafe yasağı),
   *  (b) yalnız `MOTION_MAX_EXTRAPOLATION_MS` kadar (zombi hareket yok),
   *  (c) GPS bozukken HİÇ (gürültüyü ileri taşımak yanlıştır).
   *
   * ⚠️ ESKİ KODDAKİ ÇELİŞKİ: `interpolateNavPoint` yorumu "maksimum 1,5 saniye"
   * diyordu ama kod `t`'yi 2.5 ile sınırlıyordu — sınır SÜRE değil ORANDI, yani
   * fix aralığına göre değişiyordu. Burada sınır açıkça SÜREdir. */
  const moving = cur.speedKmh >= MOTION_MIN_EXTRAPOLATION_KMH;
  const maxT = (!degraded && moving)
    ? 1 + MOTION_MAX_EXTRAPOLATION_MS / spanMs
    : 1;
  const t = Math.max(0, Math.min(rawT, maxT));

  const pb = bearingOf(prev);
  const cb = bearingOf(cur);
  const bearingDeg = (pb !== null && cb !== null) ? lerpBearing(pb, cb, Math.min(1, t)) : (cb ?? pb);

  const ageFactor = 1 - Math.min(1, ageMs / MOTION_STALE_MS);
  const confidence = Math.max(0, Math.min(1, degraded ? ageFactor * 0.4 : ageFactor));

  return {
    lat: _lerp(prev.lat, cur.lat, t),
    lon: _lerp(prev.lon, cur.lon, t),
    bearingDeg,
    state: degraded ? 'GPS_DEGRADED' : (t < 1 ? 'INTERPOLATING' : 'TRACKING'),
    interpolationProgress: t,
    sourceAgeMs: ageMs,
    confidence,
    reason: degraded
      ? 'GPS doğruluğu zayıf — ekstrapolasyon kapalı'
      : (t < 1 ? 'iki fix arası ara değer' : 'sınırlı ekstrapolasyon'),
  };
}
