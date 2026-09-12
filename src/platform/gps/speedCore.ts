import { _haversineMeters, _bearingDeg } from './gpsMath';

/** Course-delta için minimum yer değiştirme (metre). Bunun altında GPS jitter'ı
 *  yön üretir → park/durağan halde harita döner. ~4m: 1Hz'de ~14 km/h üstü hareket. */
export const COURSE_DELTA_MIN_M = 4;

/** Durağan araç jitter bastırma eşiği (km/h) — altındaki değerler 0 sayılır.
 *
 * SAHA (cihazda ölçüldü 2026-08-03): eşik 0.8 km/h iken PARK hâlindeki araçta
 * gösterge **1 km/h**'de takılı kalıyordu. Kaynak konum-delta yolu DEĞİL, GPS
 * **Doppler gürültüsü**: durağan alıcı tipik olarak 0.2–0.4 m/s (0.7–1.4 km/h)
 * bildirir ve 0.8 eşiğini aşar. Kullanıcı talebi net: "durduğum yerde 0".
 *
 * 2.5 km/h seçildi: yürüme hızının (≈5 km/h) altında, dolayısıyla ANLAMLI hiçbir
 * araç hareketini gizlemez; dur-kalk trafiğinde sürünme (5–10 km/h) hâlâ görünür.
 * Doppler'in durağan gürültü bandının ise üstündedir. */
export const GPS_SPEED_DEADZONE_KMH = 2.5;
/** Bu süreden eski GPS fix'inden gelen hız kabul edilmez */
export const GPS_SPEED_MAX_AGE_MS   = 4000;
/** GPS Doppler spike / uydu lock jitter: bu değerin üstü fiziksel olarak imkansız */
export const GPS_SPEED_MAX_KMH      = 280;

/**
 * Ham GPS hızına deadzone + stale + spike filtresi uygular.
 * EMA kasıtlı olarak yok — Doppler hızı donanım seviyesinde filtreli;
 * yazılım EMA sadece gecikme ekler.
 *
 * @param rawSpeedMs Ham hız m/s (GPS Doppler veya delta hesabı)
 * @param dataAgeMs  Timestamp yaşı ms — GPS fix'in ne kadar eski olduğu
 * @returns Filtrelenmiş hız m/s, veya undefined (stale / spike)
 */
export function applySpeedFilters(
  rawSpeedMs: number,
  dataAgeMs: number,
): number | undefined {
  if (dataAgeMs > GPS_SPEED_MAX_AGE_MS) return undefined;

  const rawKmh = rawSpeedMs * 3.6;
  if (rawKmh > GPS_SPEED_MAX_KMH) return undefined;

  // Deadzone: durağan araç jitter'ı bastır, ama 0'a HEMEN düş (EMA yok)
  return (rawKmh < GPS_SPEED_DEADZONE_KMH ? 0 : rawKmh) / 3.6;
}

export interface PrevPosition {
  lat: number;
  lng: number;
  ts: number;
  /** Bu fix'in bildirdiği doğruluk yarıçapı (m) — çift-fix gürültü tabanı için. */
  accuracy?: number;
}

/**
 * İki konum arasındaki hızı Haversine delta ile hesaplar.
 * Tamamen saf — state mutasyonu yok; çağıran _prevForSpeed'i yönetir.
 *
 * @param lat   Mevcut enlem
 * @param lng   Mevcut boylam
 * @param ts    Mevcut timestamp (ms, genellikle Date.now())
 * @param prev  Bir önceki konum kaydı; ilk çağrıda null
 * @returns Hız m/s veya undefined (yetersiz dt veya ilk fix)
 */
/**
 * Konum GÜRÜLTÜ TABANI (m) — bunun altındaki yer değiştirme HAREKET DEĞİLDİR.
 *
 * SAHA KUSURU (cihazda ölçüldü 2026-08-03): araç PARK hâlindeyken hız paneli
 * **116 km/h** gösterdi ve kırmızı "MAX 73 → YAVAŞLA" uyarısını tetikledi;
 * aynı anda gerçek hız 0'dı. KÖK: bu fonksiyon iki fix arası mesafeyi süreye
 * bölüyor ama **konum belirsizliğini hiç hesaba katmıyordu**. Ekrandaki rozet
 * `GPS ±6m` iken 6 m'lik salınım 0.5 sn'ye bölününce 43 km/h, 16 m'lik salınım
 * 116 km/h üretir. Deadzone 0.8 km/h ve spike filtresi 280 km/h olduğundan
 * sahte değer ikisinin ARASINDAN geçiyordu.
 *
 * İLKE: ölçüm belirsizliğinden küçük bir yer değiştirme İDDİA EDİLEMEZ.
 * GPS doğruluğu `accuracy` yarıçapıdır; park hâlinde ardışık fix'ler bu
 * yarıçapın 2 katına kadar salınır. Taban bu yüzden `2 × accuracy`dir.
 *
 * NOT: bu yol yalnız Doppler hızı GÜVENİLMEZ olduğunda kullanılan YEDEKtir
 * (bkz. pickRawSpeed). Doppler çalışırken hız ondan gelir, taban devreye
 * girmez. Yedek yolda düşük hızı az göstermek, park hâlinde 116 km/h
 * uydurmaktan kat kat iyidir.
 */
export const GPS_NOISE_FLOOR_MIN_M   = 2.5;
/* TAVAN — cihazda ölçülen doğruluğun ALTINDA kalmamalı (2026-08-03).
   Eski değer 12 m idi; aynı gün park hâlindeki telefonda `accuracy` **14.9 m**
   ölçüldü. Taban ölçüm belirsizliğinden küçük olunca kapı ANLAMSIZLAŞIR:
   24 m'lik saf gürültü sıçraması "gerçek yer değiştirme" sayılıp 61.6 km/h
   hayaletini onayladı. Tavan gerçekçi kötü doğruluğun ÜSTÜNDE olmalı. */
export const GPS_NOISE_FLOOR_MAX_M   = 40;
export const GPS_NOISE_ACCURACY_MULT = 2;
/** Doğruluk BİLDİRİLMEMİŞSE varsayılan yarıçap (m).
 *  Körken iyimser davranmak (0 varsaymak) hayalet hızı geri getirir; tipik
 *  şehir içi GPS doğruluğu varsayılır. */
export const GPS_ACCURACY_ASSUMED_M  = 5;

/**
 * Verilen doğruluk yarıçap(lar)ından gürültü tabanını üretir (saf).
 *
 * İKİ FIX'İN BELİRSİZLİĞİ (2026-08-03): yer değiştirme İKİ ölçümün farkıdır,
 * dolayısıyla belirsizliği de İKİSİNİN birleşimidir. Yalnız GÜNCEL doğruluğa
 * bakmak kapıyı zayıflatıyordu: önceki fix ±14.9 m, güncel fix ±8.5 m iken
 * taban 17 m çıkıyor, oysa 24 m'lik fark hâlâ tamamen gürültü olabilir.
 * KÖTÜ olan doğruluk esas alınır — belirsizlikte iyimserlik hayalet üretir.
 */
export function noiseFloorM(accuracyM?: number, prevAccuracyM?: number): number {
  const cur  = Number.isFinite(accuracyM ?? NaN) ? (accuracyM as number) : GPS_ACCURACY_ASSUMED_M;
  const prev = Number.isFinite(prevAccuracyM ?? NaN) ? (prevAccuracyM as number) : cur;
  const a    = Math.max(cur, prev);
  return Math.min(GPS_NOISE_FLOOR_MAX_M, Math.max(GPS_NOISE_FLOOR_MIN_M, a * GPS_NOISE_ACCURACY_MULT));
}

/**
 * Doppler ↔ yer değiştirme çapraz kontrolünün uygulanabildiği EN UZUN aralık (sn).
 *
 * SAHA KUSURU (cihazda ölçüldü 2026-08-03): eski sınır 10 sn idi ve telefonun
 * PARK hâlindeki fix aralığı **tam ~10 sn** çıktı (ardışık damgalar: 9.994 sn,
 * **10.002 sn**, 9.996 sn). Yani fix'lerin yarısı sınırın kıl payı dışında
 * kalıp kontrolü TAMAMEN atlıyordu — ve atlandığında ham Doppler doğrulanmadan
 * geçiyordu (**fail-open**). Bir güven kapısının arıza yönü "doğrula" değil
 * "olduğu gibi geçir" olamaz; üstelik aralık uzadıkça saçma iddia DAHA
 * tehlikelidir, daha az değil.
 */
export const DOPPLER_CHECK_MAX_DT_SEC = 30;

export function computeSpeedDelta(
  lat: number,
  lng: number,
  ts: number,
  prev: PrevPosition | null,
  accuracyM?: number,
): number | undefined {
  if (!prev) return undefined;
  const dt = (ts - prev.ts) / 1000; // saniye
  if (dt < 0.5 || dt > 10) return undefined;
  const distM = _haversineMeters(prev.lat, prev.lng, lat, lng);
  if (!Number.isFinite(distM)) return undefined;
  // Belirsizlik yarıçapı içindeki oynama = DURUYOR (bkz. yukarıdaki gerekçe).
  if (distM <= noiseFloorM(accuracyM)) return 0;
  return distM / dt; // m/s
}

/** Doppler hızına güvenmek için alt eşik (m/s). Bazı GPS çipleri/WebView'ler
 *  hareket halindeyken bile coords.speed=0 bildirir ("Doppler'e saplanma") —
 *  0 finite olduğu için eski `gpsSpeed ?? delta` fallback'i HİÇ devreye girmiyordu. */
export const DOPPLER_TRUST_MIN_MS = 0.15;

/**
 * Ham hız seçimi — SAHA FIX (2026-07-04, "harita ters gidiyor + takip etmiyor"):
 * cihaz Doppler hızını 0'a saplarsa tüm hareket tespiti (sürüş görünümü,
 * kamera takibi, rAF uyandırma) ölüyordu. Kural: Doppler > eşik ise ona güven;
 * aksi halde konum-delta hızı (varsa) kullan; o da yoksa Doppler'i aynen döndür
 * (0 = gerçekten durağan senaryosu bozulmaz — delta da 0'a yakın çıkar).
 */
export function pickRawSpeed(
  dopplerMs: number | undefined,
  deltaMs: number | undefined,
): number | undefined {
  if (dopplerMs != null && Number.isFinite(dopplerMs) && dopplerMs > DOPPLER_TRUST_MIN_MS) {
    return dopplerMs;
  }
  if (deltaMs != null && Number.isFinite(deltaMs)) return deltaMs;
  return dopplerMs;
}

/**
 * Doppler hızını YER DEĞİŞTİRME kanıtıyla çapraz doğrular (SAF).
 *
 * SAHA (cihazda ölçüldü 2026-08-03): araç PARK hâlindeyken gösterge **58 km/h**
 * yazdı; aynı anda araç işaretçisi ve rota ekrandan kayboldu — çünkü sahte hız
 * 5 km/h "durakta" eşiğini aşınca kamera normal sürüş yoluna geçip look-ahead'i
 * büyütüyor ve aracın çok ilerisine uçuyor. Konum-delta yoluna eklenen
 * belirsizlik tabanı bu değeri YAKALAMAZ: değer **Doppler**'den geliyordu ve
 * `pickRawSpeed` Doppler'e koşulsuz güveniyordu (deadzone 2.5 km/h, spike
 * filtresi 280 km/h → 58 ikisinin ARASINDAN geçiyor).
 *
 * FİZİK: Doppler `v` diyorsa `Δt` sürede `v·Δt` kadar yer değiştirmiş olmalıyız.
 * Ölçülen yer değiştirme belirsizlik tabanının altındaysa VE iddia edilen
 * mesafe o tabanın belirgin katıysa, Doppler yalan söylüyordur.
 *
 * GÜVENLİ TARAF: kısa `Δt`'de gerçek hız da küçük mesafe üretir; bu yüzden
 * override YALNIZ iddia edilen mesafe tabanın `CLAIM_FACTOR` katını aştığında
 * uygulanır. 58 km/h'te bu ~1.5 sn'de tetiklenir; 30 km/h'lik GERÇEK hareket
 * ise zaten tabanın üstünde yer değiştirme üretir ve dokunulmaz.
 */
export const DOPPLER_CLAIM_FACTOR = 3;

export function reconcileDopplerWithDisplacement(
  dopplerMs:   number | undefined,
  /** Ölçülen yer değiştirme (m). Belirsizlik tabanı altındaysa 0 gelmelidir. */
  displacedM:  number,
  /** Bu yer değiştirmenin ölçüldüğü süre (s). */
  dtSec:       number,
  /** Konum belirsizlik tabanı (m) — bkz. noiseFloorM. */
  floorM:      number,
): number | undefined {
  if (dopplerMs == null || !Number.isFinite(dopplerMs) || dopplerMs <= 0) return dopplerMs;
  if (!Number.isFinite(displacedM) || !Number.isFinite(dtSec) || dtSec <= 0) return dopplerMs;
  // Ölçüm gerçekten "hiç kıpırdamadı" demiyorsa karışma.
  if (displacedM > floorM) return dopplerMs;
  const claimedM = dopplerMs * dtSec;
  // İddia, belirsizliğin belirgin katı değilse kanıt yetersiz → dokunma.
  if (claimedM <= floorM * DOPPLER_CLAIM_FACTOR) return dopplerMs;
  return 0;   // hareket YOK: Doppler hayaleti
}

/**
 * GPS, bearing (coords.heading) sağlamadığında konum farkından "course over ground"
 * yönü hesaplar. Head unit'lerde pusula (manyetometre) yoktur ve bazı GPS modülleri
 * heading vermez → yön bu fallback olmadan null/0 (kuzey) kalır ve harita YANLIŞ
 * (ters) yöne döner. Yalnız yeterli yer değiştirme varsa döner (jitter koruması).
 *
 * @returns Yön (0–360°) veya null (ilk fix / yetersiz hareket / geçersiz dt)
 */
export function computeCourseDelta(
  lat: number,
  lng: number,
  prev: PrevPosition | null,
): number | null {
  if (!prev) return null;
  const distM = _haversineMeters(prev.lat, prev.lng, lat, lng);
  if (!Number.isFinite(distM) || distM < COURSE_DELTA_MIN_M) return null;
  return _bearingDeg(prev.lat, prev.lng, lat, lng);
}

/** Altında "hareket" iddiasının TEYİT gerektirdiği hız (km/h). */
export const MOTION_CONFIRM_KMH = 1.5;

/**
 * TEK FIX'LİK HAREKET İDDİASINI TEYİT ET (saf).
 *
 * ── NEDEN (cihazda ölçüldü 2026-08-03) ──────────────────────────────────────
 * `reconcileDopplerWithDisplacement` yer değiştirme gürültü tabanının ALTINDA
 * kalan İDDİALARI çürütemez: 60 örnekte 3'ü 1.5 km/h'yi aştı, en yüksek
 * **22.74 km/h**; o anda yer değiştirme 5.9 m, taban 6 m idi — yani tek fix
 * çiftinden gerçek hareketten AYIRT EDİLEMEZ. Sonuç: araç park hâlindeyken
 * işaretçi nabzı ve marker tazelemesi açılıp haritayı saniyede 17 kez
 * çizdiriyordu (ısı), ayrıca sürücüye zıplayan hız gösteriliyordu.
 *
 * FİZİKSEL AYIRT EDİCİ: gerçek hareket SÜREKLİDİR, gürültü değildir. Bir araç
 * 0 → 22 → 0 km/h'yi iki saniyede yapmaz; GPS gürültüsü tam olarak bunu yapar.
 * Bu yüzden yer değiştirmeyle DOĞRULANMAMIŞ bir hız iddiası, ancak bir ÖNCEKİ
 * fix'te de eşiğin üstündeyse kabul edilir.
 *
 * MALİYET (bilinçli): gerçekten yola çıkarken hız göstergesi 0'dan bir fix
 * (~1 sn) geç kalkar. Park hâlinde 22 km/h uydurmaktan kat kat iyidir; üstelik
 * ilk fix zaten yer değiştirmeyle doğrulanırsa gecikme HİÇ olmaz.
 */
export function confirmMotion(
  speedMs: number | undefined,
  /** Karşılaştıracak ÖNCEKİ fix var mı? Yoksa iddiayı çürütecek KANIT da yoktur. */
  evidenceAvailable: boolean,
  displacementCorroborated: boolean,
  prevAboveThreshold: boolean,
): number | undefined {
  if (speedMs == null || !Number.isFinite(speedMs)) return speedMs;
  if (speedMs * 3.6 <= MOTION_CONFIRM_KMH) return speedMs;   // zaten düşük
  /* ⚠️ KANIT YOKSA REDDETME (ilk denememdeki hata — iki mevcut test yakaladı):
     önceki konum yokken yer değiştirme ölçülemez, yani iddiayı ÇÜRÜTECEK bir
     şey de yoktur. Gerçekten hareket eden bir aracın İLK fix'ini sıfırlamak,
     hayalet hızı bastırmaktan daha büyük bir kusurdur. Kanıt yoksa sensöre
     güvenilir; ikinci fix'ten itibaren kapı zaten devrededir. */
  if (!evidenceAvailable) return speedMs;
  if (displacementCorroborated) return speedMs;              // yer değiştirme KANITLADI
  if (prevAboveThreshold) return speedMs;                    // SÜREKLİ → gerçek
  return 0;                                                  // tek fix'lik iddia → teyitsiz
}
