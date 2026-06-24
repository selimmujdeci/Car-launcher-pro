/**
 * isDark — Safety Assistant FAZ 4C
 *
 * headlights.off.dark kuralı için gece/karanlık algısını tema dayNightMode'undan
 * türetir (ilk sürüm). En düşük riskli yol: mevcut altyapı, ek servis yok,
 * sensör bağımlılığı yok (autoBrightness / saat-güneş hesabı KAPSAM DIŞI).
 *
 * Kaynak: useStore settings.dayNightMode ('day' | 'night') — useDayNightManager
 * saatle senkron yazar; biz salt okuyup boolean'a çeviririz.
 */

/** dayNightMode → isDark: yalnız 'night' karanlıktır. */
export function deriveIsDark(dayNightMode: 'day' | 'night'): boolean {
  return dayNightMode === 'night';
}
