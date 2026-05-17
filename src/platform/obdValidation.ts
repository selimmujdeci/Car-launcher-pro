/** Ardışık "OBD speed=0 iken GPS>10 km/h" sayısı eşiği → EV profili geçersiz */
export const VALIDATION_THRESHOLD     = 5;
/** GPS hız eşiği (km/h) — altında tutarsızlık sayılmaz */
export const VALIDATION_GPS_KMH       = 10;
/** ICE/Diesel guard: hareket eşiği (km/h) */
export const ICE_RPM_SPEED_THRESHOLD  = 10;
/** ICE/Diesel guard: bu süre boyunca RPM=-1 → StandardProfile'e dön */
export const ICE_RPM_TIMEOUT_MS       = 10_000;

/**
 * EV profili doğrulama: OBD speed=0 iken GPS speed>eşik ise ardışık miss sayar.
 * VALIDATION_THRESHOLD kez ardışık tutarsızlıkta fallback kararı verir.
 *
 * Pure — sadece boolean ve sayaç döner; _applyDetectedProfile çağrısı hâlâ
 * orkestratör (Service) tarafından yapılır.
 */
export function shouldFallbackFromEV(
  obdSpeed: number,
  gpsSpeed: number,
  currentMisses: number,
): { isInvalid: boolean; nextMisses: number } {
  if (obdSpeed > 0) return { isInvalid: false, nextMisses: 0 }; // OBD speed geçerli

  // obdSpeed === 0
  if (gpsSpeed <= VALIDATION_GPS_KMH) return { isInvalid: false, nextMisses: 0 }; // GPS de yavaş → tutarsızlık yok

  // obdSpeed=0 AND gpsSpeed > eşik → miss
  const nextMisses = currentMisses + 1;
  if (nextMisses >= VALIDATION_THRESHOLD) return { isInvalid: true, nextMisses: 0 };
  return { isInvalid: false, nextMisses };
}

/**
 * ICE/Diesel profili doğrulama: speed>10 km/h iken RPM=-1 süresini izler.
 * ICE_RPM_TIMEOUT_MS boyunca RPM gelmezse fallback kararı verir.
 *
 * Pure — sadece boolean ve zamanlayıcı başlangıcı döner.
 */
export function shouldFallbackFromICE(
  obdSpeed: number,
  obdRpm: number,
  missStart: number | null,
): { isInvalid: boolean; nextMissStart: number | null } {
  if (obdSpeed > ICE_RPM_SPEED_THRESHOLD && obdRpm === -1) {
    const now = Date.now();
    if (missStart === null) return { isInvalid: false, nextMissStart: now }; // zamanlayıcıyı başlat
    if (now - missStart >= ICE_RPM_TIMEOUT_MS) return { isInvalid: true, nextMissStart: null }; // süre doldu
    return { isInvalid: false, nextMissStart: missStart }; // zamanlayıcı çalışıyor
  }
  return { isInvalid: false, nextMissStart: null }; // RPM geldi veya araç yavaş → sıfırla
}
