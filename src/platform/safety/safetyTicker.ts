/**
 * safetyTicker — React-bağımsız interval kontrolcüsü (FAZ 2.6)
 *
 * SORUMLULUK:
 *   Aktif alert varlığına göre setInterval başlatır veya durdurur.
 *   React import'u yok → fake timers ile saf test edilebilir.
 *
 * TASARIM KARARI (AKTİF ALERT YOKKEN TIMER YOK):
 *   Boşta tick döngüsü bulundurmamak için sync(false) çağrısında interval
 *   temizlenir. Bir sonraki sync(true) ile yeniden başlar. Bu sayede:
 *     - Düşük güç tüketimi (araç duruyorsa, koşul yoksa CPU döngüsü yok).
 *     - Motorun kendi-kendini durdurma mantığı: tick callback false döndürdüğünde
 *       (hasActiveAlerts=false) interval kendiliğinden silinir.
 *
 * MODÜL-SEVİYE STATE YOK:
 *   Her createSafetyTicker() çağrısı bağımsız bir örnek üretir.
 *   Birden fazla hook örneği çakışmaz.
 */

/** SafetyTicker arayüzü — createSafetyTicker() dönüş tipi. */
export interface SafetyTicker {
  /**
   * Aktif alert durumuna göre interval'i başlat veya durdur.
   *
   * @param hasActiveAlerts true → interval yoksa başlat; false → varsa durdur.
   */
  sync(hasActiveAlerts: boolean): void;

  /**
   * Interval'i temizle (unmount / dispose).
   * Tekrar çağrılırsa sessizce devam eder (idempotent).
   */
  dispose(): void;
}

/**
 * React-bağımsız interval kontrolcüsü oluşturur.
 *
 * @param intervalMs - Tick aralığı (ms). Önerilen: 500ms.
 * @param tick       - Her interval tetiklendiğinde çağrılır.
 *                     true döndürürse interval çalışmaya devam eder.
 *                     false döndürürse interval kendini durdurur (aktif alert kalmadı).
 */
export function createSafetyTicker(
  intervalMs: number,
  tick: () => boolean,
): SafetyTicker {
  // Her örnek kendi timer id'sini tutar; modül-seviye state yok.
  let timerId: ReturnType<typeof setInterval> | null = null;

  /** İç yardımcı: çalışan interval'i temizle. */
  function stop(): void {
    if (timerId !== null) {
      clearInterval(timerId);
      timerId = null;
    }
  }

  return {
    sync(hasActiveAlerts: boolean): void {
      if (hasActiveAlerts) {
        // Aktif alert var — interval yoksa başlat (çift başlatmayı önle).
        if (timerId === null) {
          timerId = setInterval(() => {
            // tick false döndürdüğünde (koşul kalktı) interval kendini durdurur.
            const active = tick();
            if (!active) {
              stop();
            }
          }, intervalMs);
        }
        // timerId !== null: zaten çalışıyor → hiçbir şey yapma.
      } else {
        // Aktif alert yok — interval çalışıyorsa durdur.
        stop();
      }
    },

    dispose(): void {
      // Unmount veya yeniden oluşturma temizliği (idempotent).
      stop();
    },
  };
}
