/**
 * rafSmoother — Generic RAF lerp hook for fluid sensor data visualization.
 *
 * Problem: OBD/GPS verisi 3 Hz'de gelir (ELM327 poll cycle ≤ 3 s).
 *           Her güncelleme ekranda "sıçrama" yaratır — AGAMA kadranlarındaki
 *           akıcılıktan uzak, ham ve mekanik bir his verir.
 *
 * Çözüm: requestAnimationFrame tabanlı linear interpolation (lerp).
 *   - RAF ≈ 60 fps'de çalışır; sensor verisi geldiğinde yeni "hedef" set edilir.
 *   - Her frame, görsel değeri hedef yönünde alpha kadar kaydırır.
 *   - React render döngüsünden bağımsız: RAF tick'i setDisplay() çağırır,
 *     ancak RAF'ın kendisi React dışında çalışır → sıfır gereksiz re-render.
 *   - Lite mod: interpolasyon devre dışı → bellek kısıtlı cihazlarda ham değer.
 *
 * AGAMA-level alpha değerleri:
 *   speed:        speedFusion.ts içinde (0.18 premium / 0.25 balanced)
 *   rpm:          0.12  (motor ibresi — yavaş tepki, uzun süpürme hissi)
 *   engineTemp:   0.06  (termal kütle — çok yavaş, neredeyse statik)
 *   fuelLevel:    0.04  (statik görünmeli, titremeden korunur)
 *   batteryLevel: 0.05  (EV — yavaş tüketim eğrisi)
 *   motorPower:   0.20  (ani değişir, hızlı tepki beklenir)
 *
 * Kullanım:
 *   const displayRpm = useRafSmoothed(rpm, 0.12);
 */

import { useState, useRef, useEffect } from 'react';
import { getPerformanceMode } from './performanceMode';

/**
 * useRafSmoothed — sensor değerini 60fps'de akıcı bir görsel değere çevirir.
 *
 * @param target - Ham sensor değeri (OBD/GPS hızıyla güncellenir)
 * @param alpha  - Lerp katsayısı per-frame @ 60fps.
 *                 0.06 = çok yumuşak (ısı, yakıt)
 *                 0.12 = normal (RPM, batarya)
 *                 0.20 = hızlı (motor gücü, anlık değişkenler)
 * @returns      - 60fps'de güncellenen görsel değer (tam sayı)
 */
export function useRafSmoothed(target: number, alpha = 0.15): number {
  const displayRef = useRef(target);   // mevcut görsel değer (float)
  const targetRef  = useRef(target);   // hedef değer (sensor güncellemesiyle set)
  const alphaRef   = useRef(alpha);    // lerp katsayısı (ref = render tetiklemez)
  const rafRef     = useRef(0);        // RAF ID (0 = çalışmıyor)
  const [display, setDisplay] = useState(target);

  // Alpha ref'i güncel tut — prop değişiminde render tetiklemez
  alphaRef.current = alpha;

  useEffect(() => {
    const isLite = getPerformanceMode() === 'lite';

    if (isLite) {
      // Lite mod: RAF overhead yok, doğrudan geçir
      displayRef.current = target;
      setDisplay(target);
      return;
    }

    targetRef.current = target;

    // RAF zaten çalışıyorsa yalnızca hedefi güncelle.
    // Çalışan tick() her frame'de targetRef.current'ı okur → otomatik yönelir.
    if (rafRef.current !== 0) return;

    // RAF tick — React render döngüsünden bağımsız
    function tick() {
      const diff = targetRef.current - displayRef.current;

      if (Math.abs(diff) < 0.5) {
        // Hedefe ulaştı — snap et ve dur
        displayRef.current = targetRef.current;
        setDisplay(Math.round(targetRef.current));
        rafRef.current = 0;
        return;
      }

      // Lerp: her frame alfa kadar ilerle
      displayRef.current = displayRef.current + diff * alphaRef.current;
      setDisplay(Math.round(displayRef.current));
      rafRef.current = requestAnimationFrame(tick);
    }

    rafRef.current = requestAnimationFrame(tick);
  }, [target]);

  // Unmount temizliği — RAF iptal (effect her target değişiminde temizleme yapmaz;
  // RAF zaten çalışıyorsa "return early" yapıyoruz, bu nedenle sızıntı yok)
  useEffect(() => () => {
    if (rafRef.current !== 0) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    }
  }, []);

  return display;
}

/**
 * useRafSmoothedPercent — 0-100 arası yüzde değerler için özelleşmiş versiyon.
 * Yakıt ve batarya gibi yavaş değişen ölçümler için ideal.
 *
 * @param target - 0-100 arası ham değer
 * @returns      - Yumuşatılmış görsel değer (1 ondalık hassasiyet için float)
 */
export function useRafSmoothedPercent(target: number): number {
  // Yakıt / SoC: çok yavaş alpha, küçük sıçramalar görünmez
  return useRafSmoothed(target, 0.05);
}
